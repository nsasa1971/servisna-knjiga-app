-- =====================================================================
-- Servisna knjiga — Vatrosprem Inovacije
-- Supabase šema + RLS. Pokreni ceo fajl u Supabase SQL editoru.
-- Bezbedno za ponovno pokretanje (idempotentno).
-- =====================================================================

-- ---------- tabele ----------------------------------------------------

create table if not exists public.profili (
  id         uuid primary key references auth.users(id) on delete cascade,
  ime        text,
  email      text,
  uloga      text not null default 'serviser' check (uloga in ('admin','serviser')),
  created_at timestamptz not null default now()
);

create table if not exists public.objekti (
  id             uuid primary key default gen_random_uuid(),
  naziv          text not null,
  adresa         text not null default '',
  kontakt_osoba  text not null default '',
  telefon        text not null default '',
  email          text not null default '',
  created_by     uuid references public.profili(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now()
);

create table if not exists public.instalacije (
  id               uuid primary key default gen_random_uuid(),
  objekat_id       uuid not null references public.objekti(id) on delete cascade,
  tip              text not null,
  oznaka           text not null default '',
  interval_meseci  integer not null default 6 check (interval_meseci > 0),
  created_at       timestamptz not null default now()
);
create index if not exists instalacije_objekat_idx on public.instalacije(objekat_id);

create table if not exists public.servisi (
  id              uuid primary key default gen_random_uuid(),
  instalacija_id  uuid not null references public.instalacije(id) on delete cascade,
  datum           date not null,
  vrsta           text not null,
  opis            text not null default '',
  kreirao         uuid references public.profili(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists servisi_instalacija_idx on public.servisi(instalacija_id, datum);

-- ---------- arhiviranje klijenta (brisanje) ---------------------------
-- Klijent se ne briše fizički: objekat dobija arhiviran_at (soft delete),
-- instalacije se brišu, a servisi ostaju kao arhivski zapisi. Zato servis
-- čuva sopstveni snimak objekta i sistema (objekat_id, sistem_tip,
-- sistem_oznaka) i instalacija_id sme da bude NULL. Za servise ODVOJENE
-- od instalacije važi: instalacija_id is null => arhiva (vidi je samo admin).
alter table public.objekti
  add column if not exists arhiviran_at timestamptz,
  add column if not exists arhivirao    uuid references public.profili(id) on delete set null;

alter table public.servisi
  add column if not exists objekat_id     uuid references public.objekti(id) on delete set null,
  add column if not exists sistem_tip     text,
  add column if not exists sistem_oznaka  text;
alter table public.servisi alter column instalacija_id drop not null;
create index if not exists servisi_objekat_idx on public.servisi(objekat_id);

-- Backfill snimka za već postojeće servise.
update public.servisi s
   set objekat_id = i.objekat_id, sistem_tip = i.tip, sistem_oznaka = i.oznaka
  from public.instalacije i
 where s.instalacija_id = i.id and s.objekat_id is null;

-- Novi servis automatski upisuje snimak objekta/sistema.
create or replace function public.servis_snimak()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.instalacija_id is not null then
    select i.objekat_id, i.tip, i.oznaka
      into new.objekat_id, new.sistem_tip, new.sistem_oznaka
      from instalacije i where i.id = new.instalacija_id;
  end if;
  return new;
end;
$$;

drop trigger if exists servisi_snimak on public.servisi;
create trigger servisi_snimak
  before insert on public.servisi
  for each row execute function public.servis_snimak();

-- Evidencija poslatih email podsetnika (za izbegavanje duplikata).
-- Jedan podsetnik po (instalacija, prag, rok): kad servis pomeri rok,
-- rok_datum se menja pa se podsetnik za novi ciklus ponovo šalje.
create table if not exists public.podsetnici_poslati (
  id              uuid primary key default gen_random_uuid(),
  instalacija_id  uuid not null references public.instalacije(id) on delete cascade,
  prag_dana       integer not null check (prag_dana in (30, 7)),
  rok_datum       date not null,
  poslato_at      timestamptz not null default now(),
  unique (instalacija_id, prag_dana, rok_datum)
);

-- ---------- pomoćne funkcije ------------------------------------------

-- Da li je trenutni korisnik admin (security definer da RLS na profili
-- ne pravi rekurziju).
create or replace function public.je_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profili where id = auth.uid() and uloga = 'admin'
  );
$$;

-- Automatski profil pri kreiranju naloga u auth.users.
-- Prvi nalog u sistemu postaje 'admin', svi ostali 'serviser'.
create or replace function public.novi_korisnik()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profili (id, ime, email, uloga)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'ime', split_part(new.email, '@', 1)),
    new.email,
    case when exists (select 1 from public.profili) then 'serviser' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.novi_korisnik();

-- Backfill: ako već postoje nalozi napravljeni pre ove migracije.
insert into public.profili (id, ime, email, uloga)
select u.id, split_part(u.email, '@', 1), u.email,
       case when row_number() over (order by u.created_at) = 1
             and not exists (select 1 from public.profili) then 'admin' else 'serviser' end
from auth.users u
on conflict (id) do nothing;

-- Serviser ne sme sam sebi da promeni ulogu / id (samo admin).
create or replace function public.zastiti_profil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.je_admin() and auth.uid() is not null then
    if new.uloga is distinct from old.uloga or new.id is distinct from old.id then
      raise exception 'Samo admin može da menja uloge';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profili_zastita on public.profili;
create trigger profili_zastita
  before update on public.profili
  for each row execute function public.zastiti_profil();

-- Atomsko čuvanje objekta sa više sistema (forma "Dodaj još jedan sistem").
-- p_objekat:  {"id": <uuid|null>, "naziv", "adresa", "kontakt_osoba", "telefon", "email"}
-- p_sistemi:  [{"tip","oznaka","interval_meseci","datum","vrsta","opis"}, ...]
--             datum je opcioni (poslednji rad); ako je zadat, upisuje se i servis.
-- Ako je p_objekat.id zadat, sistemi se DODAJU postojećem objektu.
create or replace function public.sacuvaj_objekat_sa_sistemima(p_objekat jsonb, p_sistemi jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id   uuid;
  v_inst uuid;
  s      jsonb;
begin
  if auth.uid() is null then
    raise exception 'Niste prijavljeni';
  end if;

  if nullif(p_objekat->>'id', '') is not null then
    v_id := (p_objekat->>'id')::uuid;
    update objekti set
      naziv         = coalesce(p_objekat->>'naziv', naziv),
      adresa        = coalesce(p_objekat->>'adresa', adresa),
      kontakt_osoba = coalesce(p_objekat->>'kontakt_osoba', kontakt_osoba),
      telefon       = coalesce(p_objekat->>'telefon', telefon),
      email         = coalesce(p_objekat->>'email', email)
    where id = v_id and arhiviran_at is null;
    if not found then
      raise exception 'Klijent ne postoji ili je obrisan (arhiviran)';
    end if;
  else
    insert into objekti (naziv, adresa, kontakt_osoba, telefon, email)
    values (
      p_objekat->>'naziv',
      coalesce(p_objekat->>'adresa', ''),
      coalesce(p_objekat->>'kontakt_osoba', ''),
      coalesce(p_objekat->>'telefon', ''),
      coalesce(p_objekat->>'email', '')
    ) returning id into v_id;
  end if;

  for s in select * from jsonb_array_elements(coalesce(p_sistemi, '[]'::jsonb)) loop
    insert into instalacije (objekat_id, tip, oznaka, interval_meseci)
    values (
      v_id,
      s->>'tip',
      coalesce(s->>'oznaka', ''),
      coalesce(nullif(s->>'interval_meseci', '')::int, 6)
    ) returning id into v_inst;

    if nullif(s->>'datum', '') is not null then
      insert into servisi (instalacija_id, datum, vrsta, opis)
      values (
        v_inst,
        (s->>'datum')::date,
        coalesce(nullif(s->>'vrsta', ''), 'Redovna kontrola'),
        coalesce(s->>'opis', '')
      );
    end if;
  end loop;

  return v_id;
end;
$$;

-- Brisanje (arhiviranje) klijenta — samo admin.
-- Briše sve instalacije klijenta (sa podsetnicima), ali istoriju servisa
-- zadržava: servis se odvaja od instalacije (instalacija_id = NULL) uz snimak
-- sistema, a objekat dobija arhiviran_at i nestaje sa glavnog ekrana.
create or replace function public.obrisi_klijenta(p_objekat_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.je_admin() then
    raise exception 'Samo admin može da briše klijente';
  end if;

  perform 1 from objekti where id = p_objekat_id and arhiviran_at is null for update;
  if not found then
    raise exception 'Klijent ne postoji ili je već obrisan';
  end if;

  update servisi s
     set objekat_id = i.objekat_id, sistem_tip = i.tip, sistem_oznaka = i.oznaka,
         instalacija_id = null
    from instalacije i
   where s.instalacija_id = i.id and i.objekat_id = p_objekat_id;

  delete from instalacije where objekat_id = p_objekat_id;

  update objekti
     set arhiviran_at = now(), arhivirao = auth.uid()
   where id = p_objekat_id;
end;
$$;

-- ---------- RLS --------------------------------------------------------

alter table public.profili            enable row level security;
alter table public.objekti            enable row level security;
alter table public.instalacije        enable row level security;
alter table public.servisi            enable row level security;
alter table public.podsetnici_poslati enable row level security;

-- profili: svi ulogovani čitaju (za prikaz "ko je uneo"), svako menja
-- svoj red (ime), a samo admin upravlja svima (uloge, brisanje).
drop policy if exists profili_select on public.profili;
create policy profili_select on public.profili
  for select to authenticated using (true);

drop policy if exists profili_update_own on public.profili;
create policy profili_update_own on public.profili
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profili_admin_all on public.profili;
create policy profili_admin_all on public.profili
  for all to authenticated
  using (public.je_admin()) with check (public.je_admin());

-- objekti: svi ulogovani vide i menjaju AKTIVNE objekte; arhivirane vidi i
-- menja samo admin, a fizički DELETE je dozvoljen samo adminu (aplikacija
-- koristi obrisi_klijenta() koji arhivira umesto da briše).
drop policy if exists objekti_all on public.objekti;
drop policy if exists objekti_select on public.objekti;
create policy objekti_select on public.objekti
  for select to authenticated using (arhiviran_at is null or public.je_admin());

drop policy if exists objekti_insert on public.objekti;
create policy objekti_insert on public.objekti
  for insert to authenticated with check (arhiviran_at is null);

drop policy if exists objekti_update on public.objekti;
create policy objekti_update on public.objekti
  for update to authenticated
  using (arhiviran_at is null or public.je_admin())
  with check (arhiviran_at is null or public.je_admin());

drop policy if exists objekti_delete on public.objekti;
create policy objekti_delete on public.objekti
  for delete to authenticated using (public.je_admin());

-- instalacije: pun CRUD, ali ne može da se doda/prebaci na arhiviran objekat.
drop policy if exists instalacije_all on public.instalacije;
drop policy if exists instalacije_select on public.instalacije;
create policy instalacije_select on public.instalacije
  for select to authenticated using (true);

drop policy if exists instalacije_insert on public.instalacije;
create policy instalacije_insert on public.instalacije
  for insert to authenticated
  with check (exists (select 1 from public.objekti o where o.id = objekat_id and o.arhiviran_at is null));

drop policy if exists instalacije_update on public.instalacije;
create policy instalacije_update on public.instalacije
  for update to authenticated
  using (true)
  with check (exists (select 1 from public.objekti o where o.id = objekat_id and o.arhiviran_at is null));

drop policy if exists instalacije_delete on public.instalacije;
create policy instalacije_delete on public.instalacije
  for delete to authenticated using (true);

-- servisi: pun CRUD nad servisima vezanim za instalaciju; arhivske servise
-- (instalacija_id is null) vidi i dira samo admin.
drop policy if exists servisi_all on public.servisi;
create policy servisi_all on public.servisi
  for all to authenticated
  using (instalacija_id is not null or public.je_admin())
  with check (instalacija_id is not null or public.je_admin());

-- podsetnici_poslati: bez politika => klijenti (anon/authenticated) nemaju
-- pristup. Piše je samo Netlify funkcija sa service_role ključem
-- (koji zaobilazi RLS).

-- ---------- privilegije ------------------------------------------------

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.objekti, public.instalacije, public.servisi to authenticated;
grant select, update on public.profili to authenticated;
grant delete on public.profili to authenticated;  -- ograničeno RLS-om na admina
grant execute on function public.sacuvaj_objekat_sa_sistemima(jsonb, jsonb) to authenticated;
revoke execute on function public.sacuvaj_objekat_sa_sistemima(jsonb, jsonb) from anon;
grant execute on function public.obrisi_klijenta(uuid) to authenticated;
revoke execute on function public.obrisi_klijenta(uuid) from anon;
