// hiring-sync: the hiring jobs that ran on Convex until 2026-10-07, now on
// Supabase (Creative Triage bldgtotkfmhoxmlzowdx).
//
// pg_cron posts {"job": "mirror"} every 10 minutes, {"job": "intake"} every
// 30 and {"job": "engine"} every 10 (migration 20261009c_hiring_native.sql),
// with x-cron-secret from the vault. Deploy with --no-verify-jwt: the cron
// secret is this door's only key. {"job": "doctor"} names the missing keys.
//
// Secrets read by name: GHL_HIRING_PIT, GHL_HIRING_LOCATION, TYPEFORM_TOKEN,
// CRON_SECRET, HIRING_APPLY (GoHighLevel writes, "true" or a dry run).
// The schedule never messages a candidate: the engine only writes drafts.

import { cronDoor } from "../_shared/hiring/doors.ts";

Deno.serve(req => cronDoor(req, { env: name => Deno.env.get(name) }));
