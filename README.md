# Servisna knjiga — Vatrosprem Inovacije

Interna web aplikacija za evidenciju objekata, instalacija (PP aparati, hidranti, sprinkler…) i servisa,
sa rokovima kontrole i dnevnim email podsetnicima. Cilj: `https://app.vatrospremdoo.rs`.

| Deo | Tehnologija |
|---|---|
| Frontend | statički `public/index.html` (vanilla JS, bez build koraka) |
| Baza + prijava | Supabase (Postgres + Auth + RLS) |
| Pozivanje korisnika | Netlify Function `invite-user` |
| Email podsetnici | Netlify Scheduled Function `reminders` + Resend |

```
public/               index.html, config.js  (ovo se objavljuje)
netlify/functions/    invite-user.mjs, reminders.mjs
netlify/lib/          logika rokova i slanja (testirana)
supabase/             schema.sql, seed.sql
servisna-knjiga-v4.html   stara localStorage verzija (samo referenca, ne objavljuje se)
```

## 1. Supabase

1. U SQL editoru pokreni `supabase/schema.sql`, pa jednom `supabase/seed.sql` (5 postojećih objekata).
2. **Authentication → Users → Add user** za prvi nalog (Auto Confirm). Prvi nalog u sistemu postaje `admin`, ostali `serviser`.
3. **Authentication → URL Configuration:**
   - *Site URL*: `https://app.vatrospremdoo.rs`
   - *Redirect URLs*: dodaj `https://app.vatrospremdoo.rs` (i `https://<ime-sajta>.netlify.app` dok DNS nije povezan)
4. Pozivnice i reset lozinke šalje Supabase. Ugrađeni mailer ima **vrlo nizak limit (nekoliko mejlova na sat)** i šalje samo
   članovima tima projekta. Za stvarnu upotrebu u **Project Settings → Authentication → SMTP** ukucaj Resend SMTP
   (`smtp.resend.com`, port 465, user `resend`, lozinka = Resend API ključ) i verifikovan domen.
5. Opciono: u **Authentication → Providers → Email** isključi *Allow new users to sign up* — nalozi se prave samo pozivom.
6. `public/config.js` sadrži `SUPABASE_URL` i `SUPABASE_ANON_KEY` (javni ključ — pristup štiti RLS).

## 2. Resend

1. Napravi nalog na resend.com i API ključ.
2. Dok domen nije verifikovan, kod šalje sa `onboarding@resend.dev`, što Resend dozvoljava **samo na email vlasnika Resend naloga**.
   Za slanje na `boban.inovacije@gmail.com` i `aleksandar.inovacije@gmail.com` verifikuj domen
   (**Domains → Add Domain**, upiši DNS zapise) i postavi `MAIL_FROM`, npr. `Servisna knjiga <podsetnik@vatrospremdoo.rs>`.

## 3. Netlify (poseban projekat, ne mešati sa glavnim sajtom)

1. **Add new site → Import from Git** → ovaj repo, grana `main`. Podešavanja se čitaju iz `netlify.toml`
   (publish `public`, functions `netlify/functions`).
2. **Site configuration → Environment variables:**

| Varijabla | Vrednost |
|---|---|
| `SUPABASE_URL` | `https://rxfteqarfngqjfhhmfsi.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → *service_role* (**tajna, samo ovde**) |
| `RESEND_API_KEY` | Resend API ključ |
| `ADMIN_EMAIL` | `boban.inovacije@gmail.com,aleksandar.inovacije@gmail.com` |
| `MAIL_FROM` | `Servisna knjiga <onboarding@resend.dev>` dok se domen ne verifikuje |
| `SITE_URL` | `https://app.vatrospremdoo.rs` |

3. **Domain management → Add domain** `app.vatrospremdoo.rs`; kod DNS-a napravi `CNAME app → <ime-sajta>.netlify.app`.
4. Posle deploy-a proveri **Logs → Functions → reminders** (pokreće se svaki dan u 06:00 UTC, tj. 07:00/08:00 po Beogradu).
   Scheduled funkcije rade samo na objavljenom (published) deploy-u.

## Email podsetnici

Jednom dnevno funkcija računa rok svake instalacije (isto kao aplikacija: poslednji rad koji resetuje rok + interval)
i šalje **jedan zbirni mejl** za sve instalacije koje su ušle u zonu **30 dana** (8–30) ili **7 dana** (0–7 do roka).

- Duplikati: svaka (instalacija, prag, rok) se upisuje u `podsetnici_poslati`. Kad se upiše novi servis, rok se
  pomera pa se podsetnik za sledeći ciklus ponovo šalje.
- Ne šalju se instalacije koje već kasne ni one bez ijedne kontrole (vidljive su u tabu „Za poziv").
- Prvo pokretanje posle deploy-a šalje sve što je trenutno u zoni.
- Provera bez slanja i bez upisa:
  `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… ADMIN_EMAIL=a@b.rs npm run podsetnici:dry-run`

## Korisnici

Tab **Korisnici** (samo admin): promena uloge i **Pošalji poziv** (ime, e-mail, uloga). Pozvani dobija mejl,
postavlja lozinku i ulazi. Funkcija `invite-user` proverava da je pozivalac admin. Na login ekranu postoji „Zaboravljena lozinka?".

## Razvoj i testovi

```
npm test      # logika rokova i email sadržaj (node:test, bez zavisnosti)
```
Lokalno (opciono): `npx netlify-cli dev` pokreće sajt i funkcije sa env varijablama iz `.env`.
