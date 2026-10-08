/* Logika rokova — ista kao u public/index.html (stanjeInst), ali sa UTC datumima. */

const DAN = 86400000;

/* Samo ove vrste rada NE pomeraju rok; sve ostalo (i nepoznato) ga pomera. */
const NE_RESETUJE = new Set(["Popravka", "Izlazak bez rada"]);
export const resetuje = (vrsta) => !NE_RESETUJE.has(vrsta);

export function parseDatum(s) {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export const isoDatum = (d) => d.toISOString().slice(0, 10);
export const srpskiDatum = (d) =>
  `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}.`;

export function plusMeseci(d, m) {
  const r = new Date(d.getTime());
  const dan = r.getUTCDate();
  r.setUTCMonth(r.getUTCMonth() + m);
  if (r.getUTCDate() < dan) r.setUTCDate(0); // 31. jan + 1 mes. -> 28/29. feb
  return r;
}

/* Današnji datum u Beogradu (kao UTC ponoć), bez obzira na vremensku zonu servera. */
export function danasBeograd(now = new Date()) {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade" }).format(now);
  return parseDatum(s);
}

/* srpska množina: 1 dan, 2-4 dana, 5+ dana (11-14 -> dana) */
export function rec(n, jedn, dvaCet, mnozina) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return mnozina;
  if (b === 1) return jedn;
  if (b >= 2 && b <= 4) return dvaCet;
  return mnozina;
}

/*
 * Vraća instalacije koje su ušle u zonu 7 ili 30 dana, a za taj (instalacija, prag, rok)
 * podsetnik još nije poslat. Zona 7 = 0..7 dana do roka, zona 30 = 8..30 dana.
 * Instalacije bez ijedne kontrole i one koje već kasne se ne šalju (vidljive su u aplikaciji).
 */
export function izracunajPodsetnike({ objekti, instalacije, servisi, poslato, danas }) {
  const objekat = new Map(objekti.map((o) => [o.id, o]));
  const poslednji = new Map();
  for (const s of servisi) {
    if (!resetuje(s.vrsta)) continue;
    const p = poslednji.get(s.instalacija_id);
    if (!p || s.datum > p) poslednji.set(s.instalacija_id, s.datum);
  }
  const vecPoslato = new Set(poslato.map((p) => `${p.instalacija_id}|${p.prag_dana}|${p.rok_datum}`));

  const stavke = [];
  for (const inst of instalacije) {
    const datum = poslednji.get(inst.id);
    if (!datum) continue;
    const rok = plusMeseci(parseDatum(datum), inst.interval_meseci || 6);
    const dana = Math.round((rok.getTime() - danas.getTime()) / DAN);
    const prag = dana >= 0 && dana <= 7 ? 7 : dana > 7 && dana <= 30 ? 30 : null;
    if (!prag) continue;
    const rokIso = isoDatum(rok);
    if (vecPoslato.has(`${inst.id}|${prag}|${rokIso}`)) continue;
    const o = objekat.get(inst.objekat_id) || {};
    stavke.push({
      instalacija_id: inst.id, prag_dana: prag, rok_datum: rokIso, dana,
      tip: inst.tip, oznaka: inst.oznaka || "",
      objekat: o.naziv || "—", adresa: o.adresa || "", kontakt: o.kontakt_osoba || "", telefon: o.telefon || "",
    });
  }
  return stavke.sort((a, b) => a.dana - b.dana || a.objekat.localeCompare(b.objekat, "sr"));
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function sastaviEmail(stavke, siteUrl) {
  const n = stavke.length;
  const hitne = stavke.filter((s) => s.prag_dana === 7);
  const subject = `Podsetnik: ${n} ${rec(n, "instalacija", "instalacije", "instalacija")} uskoro na kontrolu` +
    (hitne.length ? ` (${hitne.length} u narednih 7 dana)` : "");
  const tekstRoka = (s) => (s.dana === 0 ? "rok je danas" : `za ${s.dana} ${rec(s.dana, "dan", "dana", "dana")}`);
  const naziv = (s) => s.tip + (s.oznaka ? ` — ${s.oznaka}` : "");

  const grupe = [[7, "U narednih 7 dana"], [30, "U narednih 30 dana"]]
    .map(([prag, naslov]) => [naslov, stavke.filter((s) => s.prag_dana === prag)])
    .filter(([, l]) => l.length);

  const text = grupe.map(([naslov, l]) =>
    `${naslov.toUpperCase()}\n` + l.map((s) =>
      `- ${s.objekat}${s.adresa ? ` (${s.adresa})` : ""}: ${naziv(s)} — ${tekstRoka(s)}, rok ${srpskiDatum(parseDatum(s.rok_datum))}` +
      (s.kontakt || s.telefon ? `\n  kontakt: ${[s.kontakt, s.telefon].filter(Boolean).join(", ")}` : "")
    ).join("\n")).join("\n\n") + (siteUrl ? `\n\nOtvori aplikaciju: ${siteUrl}` : "");

  const html = `<div style="font-family:Arial,sans-serif;color:#0E1C20;max-width:620px">
<h2 style="color:#0E3B43;margin:0 0 12px">Podsetnik za kontrolu</h2>` +
    grupe.map(([naslov, l]) =>
      `<h3 style="margin:18px 0 6px;color:${naslov.includes("7") ? "#DC3B2B" : "#CF7D00"}">${esc(naslov)}</h3>` +
      `<table style="border-collapse:collapse;width:100%;font-size:14px">` +
      l.map((s) => `<tr><td style="padding:7px 8px;border-bottom:1px solid #D8E3E6"><b>${esc(s.objekat)}</b>` +
        `${s.adresa ? `<br><span style="color:#5E767C">${esc(s.adresa)}</span>` : ""}` +
        `${s.kontakt || s.telefon ? `<br><span style="color:#5E767C">${esc([s.kontakt, s.telefon].filter(Boolean).join(", "))}</span>` : ""}</td>` +
        `<td style="padding:7px 8px;border-bottom:1px solid #D8E3E6">${esc(naziv(s))}</td>` +
        `<td style="padding:7px 8px;border-bottom:1px solid #D8E3E6;white-space:nowrap">${esc(tekstRoka(s))}<br>` +
        `<span style="color:#5E767C">${srpskiDatum(parseDatum(s.rok_datum))}</span></td></tr>`).join("") +
      `</table>`).join("") +
    (siteUrl ? `<p style="margin-top:20px"><a href="${esc(siteUrl)}" style="color:#00A3AD">Otvori servisnu knjigu</a></p>` : "") +
    `</div>`;
  return { subject, html, text };
}
