import { danasBeograd, isoDatum, izracunajPodsetnike, sastaviEmail } from "./rok.mjs";

/* Jednom dnevno: nađi instalacije u zoni 30/7 dana, pošalji jedan zbirni mejl adminima
   (Resend) i zapamti šta je poslato u tabeli podsetnici_poslati. */
export async function pokreni(env = process.env, now = new Date()) {
  const URL_ = (env.SUPABASE_URL || "").replace(/\/$/, "");
  const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const primaoci = (env.ADMIN_EMAIL || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!URL_ || !KEY) throw new Error("Nedostaju SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  if (!primaoci.length) throw new Error("Nedostaje ADMIN_EMAIL");
  const dryRun = !!env.DRY_RUN;
  if (!dryRun && !env.RESEND_API_KEY) throw new Error("Nedostaje RESEND_API_KEY");

  const hdr = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
  async function rest(path, opts = {}) {
    const r = await fetch(`${URL_}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...opts.headers } });
    if (!r.ok) throw new Error(`Supabase ${path.split("?")[0]}: ${r.status} ${await r.text()}`);
    const tekst = await r.text();
    return tekst ? JSON.parse(tekst) : null; // return=minimal vraća prazno telo
  }
  async function sve(tabela) {
    const out = [];
    for (let od = 0; ; od += 1000) {
      const red = await rest(`${tabela}?select=*&order=id&limit=1000&offset=${od}`);
      out.push(...red);
      if (red.length < 1000) return out;
    }
  }

  const [objekti, instalacije, servisi, poslato] = await Promise.all(
    ["objekti", "instalacije", "servisi", "podsetnici_poslati"].map(sve));
  const danas = danasBeograd(now);
  const stavke = izracunajPodsetnike({ objekti, instalacije, servisi, poslato, danas });
  if (!stavke.length) return { poslato: 0 };

  const { subject, html, text } = sastaviEmail(stavke, env.SITE_URL);
  if (dryRun) {
    console.log(`[DRY_RUN] Za: ${primaoci.join(", ")}\nNaslov: ${subject}\n\n${text}`);
    return { poslato: 0, dryRun: true, stavki: stavke.length };
  }

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      // isti dan + isti sadržaj => Resend ne šalje duplikat ako funkcija bude ponovo pokrenuta
      "Idempotency-Key": `podsetnici-${isoDatum(danas)}-${stavke.length}`,
    },
    body: JSON.stringify({
      from: env.MAIL_FROM || "Servisna knjiga <onboarding@resend.dev>",
      to: primaoci, subject, html, text,
    }),
  });
  if (!r.ok) throw new Error(`Resend: ${r.status} ${await r.text()}`);

  await rest("podsetnici_poslati?on_conflict=instalacija_id,prag_dana,rok_datum", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(stavke.map(({ instalacija_id, prag_dana, rok_datum }) =>
      ({ instalacija_id, prag_dana, rok_datum }))),
  });
  return { poslato: stavke.length };
}
