// invoice-tap: Tap payment links for cockpit invoices (Aziz, 2026-11-05: "Ecom
// is the main one, but I need to have WHOP and Tap as backups").
//
// Runs on Supabase (Creative Triage bldgtotkfmhoxmlzowdx), verify_jwt off.
// Secrets (Edge Function secrets): TAP_SECRET_KEY (live, shared with
// tap-charges-sync), CRON_SECRET; SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// come with every function. The doors and operations are in door.ts.

import { makeHandler } from "./door.ts";

Deno.serve(makeHandler({ env: name => Deno.env.get(name), fetch: (...a) => fetch(...a), now: () => Date.now() }));
