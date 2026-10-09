// comment-watch: the client comment watch, native (see watch.ts).
//
// Runs on Supabase (Creative Triage bldgtotkfmhoxmlzowdx), scheduled by
// pg_cron job mahara-comment-watch at minute 7, 22, 37 and 52 (migration
// 20261009i). Deploy with --no-verify-jwt: pg_cron sends x-cron-secret, not a
// user token. Keys by name: CRON_SECRET, CLICKUP_API_TOKEN, optional
// COMMENT_WATCH_APPLY (exactly "true" to write rules to ClickUp) and
// COMMENT_WATCH_ONLY_TASKS, and the SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// every function gets. Nothing here logs a key.

import {createClient} from 'npm:@supabase/supabase-js@2';
import {handle, type Admin} from './watch.ts';

Deno.serve(req =>
  handle(req, name => Deno.env.get(name), (url, key) => createClient(url, key, {auth: {persistSession: false}}) as unknown as Admin),
);
