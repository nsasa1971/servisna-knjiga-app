/* Poziv novog korisnika — samo za prijavljene admine.
   POST /.netlify/functions/invite-user   Authorization: Bearer <access token>
   body: { email, ime?, uloga: "admin" | "serviser" } */

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Dozvoljen je samo POST" });

  const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_ || !KEY) return json(500, { error: "Server nije podešen (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Niste prijavljeni" });

  const svc = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

  // 1) ko zove? (token se proverava kod Supabase Auth)
  const ur = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } });
  if (!ur.ok) return json(401, { error: "Sesija nije važeća, prijavi se ponovo" });
  const korisnik = await ur.json();

  // 2) da li je admin?
  const pr = await fetch(`${URL_}/rest/v1/profili?id=eq.${encodeURIComponent(korisnik.id)}&select=uloga`, { headers: svc });
  const [profil] = pr.ok ? await pr.json() : [];
  if (!profil || profil.uloga !== "admin") return json(403, { error: "Samo admin može da poziva korisnike" });

  // 3) validacija
  let telo;
  try { telo = await req.json(); } catch { return json(400, { error: "Neispravan zahtev" }); }
  const email = String(telo.email || "").trim().toLowerCase();
  const ime = String(telo.ime || "").trim().slice(0, 80);
  const uloga = telo.uloga === "admin" ? "admin" : "serviser";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Neispravna e-mail adresa" });

  // 4) poziv (Supabase šalje mejl sa linkom za postavljanje lozinke)
  const redirect = process.env.SITE_URL ? `?redirect_to=${encodeURIComponent(process.env.SITE_URL)}` : "";
  const ir = await fetch(`${URL_}/auth/v1/invite${redirect}`, {
    method: "POST", headers: svc, body: JSON.stringify({ email, data: ime ? { ime } : {} }),
  });
  const novi = await ir.json().catch(() => ({}));
  if (!ir.ok) {
    const poruka = novi.msg || novi.message || novi.error_description || "Poziv nije uspeo";
    return json(ir.status === 422 || ir.status === 400 ? 400 : 502, { error: poruka });
  }

  // 5) uloga (trigger je postavio 'serviser'; service_role zaobilazi zaštitu uloge)
  if (uloga === "admin" && novi.id) {
    const ar = await fetch(`${URL_}/rest/v1/profili?id=eq.${encodeURIComponent(novi.id)}`, {
      method: "PATCH", headers: { ...svc, Prefer: "return=minimal" }, body: JSON.stringify({ uloga: "admin" }),
    });
    if (!ar.ok) return json(502, { error: "Poziv je poslat, ali uloga nije postavljena. Promeni je u tabu Korisnici." });
  }
  return json(200, { ok: true, email });
};
