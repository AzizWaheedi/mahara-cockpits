// hiring-api: the CEO cockpit Hiring tab's actions (refreshNow, grade,
// reassign, setEngine, drafts, sendDraft), ported from Convex hiring.actions,
// and since 2026-10-11 headhunt (queue "Find people for this role" for the
// VPS recruiting agent) and headhunts (read the requests and answers).
//
// Deploy with JWT verification on. Every call is checked again here: the
// caller's token must belong to the CEO (public.cockpit_is_ceo()), and every
// action writes a cockpit_audit_log row before it changes anything.
//
// GoHighLevel writes are dry runs unless HIRING_APPLY is "true". A draft is
// sent only by sendDraft, only when HIRING_SEND_ENABLED is "true".

import { apiDoor } from "../_shared/hiring/doors.ts";

Deno.serve(req => apiDoor(req, { env: name => Deno.env.get(name) }));
