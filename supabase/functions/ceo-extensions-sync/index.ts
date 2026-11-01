// ceo-extensions-sync: the hourly CEO automatic extension pass, retired in
// waves 1 and 2 (see run.ts): it writes nothing and answers "Retired: the
// billing sheet writes the extension field."
//
// Runs on Supabase (Creative Triage bldgtotkfmhoxmlzowdx), scheduled by
// pg_cron job mahara-ceo-extensions-auto (migration 20261009k) until the C1
// window unschedules it. Deploy with --no-verify-jwt: pg_cron sends
// x-cron-secret, not a user token. Keys by name: CRON_SECRET and the
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY every function gets. Nothing here
// logs a key.

import {createClient} from 'npm:@supabase/supabase-js@2';
import {handle, type Admin} from './run.ts';

Deno.serve(req => handle(req, name => Deno.env.get(name), (url, key) => createClient(url, key, {auth: {persistSession: false}}) as unknown as Admin));
