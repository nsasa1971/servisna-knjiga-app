/* Lokalna provera podsetnika bez slanja mejla:
     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ADMIN_EMAIL=a@b.rs npm run podsetnici:dry-run
   (DRY_RUN=1 je već postavljen u npm skripti; ništa se ne šalje i ne upisuje.) */
import { pokreni } from "../netlify/lib/podsetnici.mjs";
console.log(await pokreni());
