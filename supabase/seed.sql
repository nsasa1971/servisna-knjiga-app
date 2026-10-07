-- =====================================================================
-- Jednokratni unos postojeće evidencije (tabela KONTROLA.xlsx, 5 objekata).
-- Pokreni JEDNOM, posle schema.sql, u Supabase SQL editoru.
-- Zaštita od duplog pokretanja: ništa se ne upisuje ako već postoji objekat
-- sa istim nazivom.
-- Izvršava se kao postgres u SQL editoru (zaobilazi RLS); created_by/kreirao
-- ostaju prazni (NULL).
-- =====================================================================
do $$
declare
  o     jsonb;
  i     jsonb;
  v_obj uuid;
  v_ins uuid;
  v_kom int;
  v_tip text;
  v_vrsta text;
  podaci jsonb := '[
    {"naziv":"SIM","adresa":"Dunavska 83","osoba":"Dragana Andrejić","tel":"064 859 98 14","email":"a.dragana@simns.rs","sistemi":[
      {"tip":"PP aparati","kom":7,"datum":"2026-07-28","vrsta":"Redovna kontrola"},
      {"tip":"Hidrantska mreža","kom":2,"datum":"2026-07-28","vrsta":"Redovna kontrola"}]},
    {"naziv":"SZ Tadeuša Košćuškog 74","adresa":"Tadeuša Košćuškog 74","osoba":"Irena Mičanović","tel":"063 376867","email":"irena.micanovic73@gmail.com","sistemi":[
      {"tip":"PP aparati","kom":6,"datum":"2026-07-28","vrsta":"Redovna kontrola"}]},
    {"naziv":"KARAORMAN-SAM KOMERC","adresa":"Dunavska 73","osoba":"Vesna Kanlić","tel":"063 208396","email":"vesna.kanlic@karaorman-sam.rs","sistemi":[
      {"tip":"PP aparati","kom":8,"datum":"2026-07-29","vrsta":"Redovna kontrola"}]},
    {"naziv":"FE-PRODUCT","adresa":"Dunavska 71","osoba":"Jovanka Simonović","tel":"063 211363","email":"feproduct@mts.rs","sistemi":[
      {"tip":"PP aparati","kom":1,"datum":"2026-07-30","vrsta":"Redovna kontrola"}]},
    {"naziv":"eArhiv","adresa":"Grmovačka 20","osoba":"Žarko Martinović","tel":"064 8766611","email":"jelena.stjelja@inception.rs","sistemi":[
      {"tip":"Hidrantska mreža","kom":4,"datum":"2026-08-03","vrsta":"Prvo kontrolisanje"}]}
  ]'::jsonb;
begin
  for o in select * from jsonb_array_elements(podaci) loop
    if exists (select 1 from public.objekti where naziv = o->>'naziv') then
      raise notice 'Preskačem % (već postoji)', o->>'naziv';
      continue;
    end if;

    insert into public.objekti (naziv, adresa, kontakt_osoba, telefon, email)
    values (o->>'naziv', o->>'adresa', o->>'osoba', o->>'tel', o->>'email')
    returning id into v_obj;

    for i in select * from jsonb_array_elements(o->'sistemi') loop
      v_tip   := i->>'tip';
      v_kom   := (i->>'kom')::int;
      v_vrsta := i->>'vrsta';

      insert into public.instalacije (objekat_id, tip, oznaka, interval_meseci)
      values (
        v_obj, v_tip,
        -- srpska množina: 1 aparat, 2-4 aparata, 5+ aparata (11-14 -> "aparata")
        v_kom || ' ' || case
          when v_tip = 'PP aparati' then
            case when v_kom % 100 between 11 and 14 then 'aparata'
                 when v_kom % 10 = 1 then 'aparat'
                 when v_kom % 10 between 2 and 4 then 'aparata'
                 else 'aparata' end
          else
            case when v_kom % 100 between 11 and 14 then 'hidranata'
                 when v_kom % 10 = 1 then 'hidrant'
                 when v_kom % 10 between 2 and 4 then 'hidranta'
                 else 'hidranata' end
        end,
        case v_tip when 'PP aparati' then 6 when 'Hidrantska mreža' then 6 else 12 end
      ) returning id into v_ins;

      insert into public.servisi (instalacija_id, datum, vrsta, opis)
      values (
        v_ins, (i->>'datum')::date, v_vrsta,
        v_kom || ' kom. — ' ||
        case when v_vrsta = 'Prvo kontrolisanje' then 'prva kontrola' else 'periodična kontrola' end
      );
    end loop;
  end loop;
end $$;

-- Provera:
-- select o.naziv, i.tip, i.oznaka, s.datum, s.vrsta
-- from objekti o join instalacije i on i.objekat_id=o.id left join servisi s on s.instalacija_id=i.id
-- order by o.naziv;
