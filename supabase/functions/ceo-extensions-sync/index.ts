// ceo-extensions-sync: the hourly CEO automatic extension pass (see run.ts).
//
// Runs on Supabase (Creative Triage bldgtotkfmhoxmlzowdx), scheduled by
// pg_cron job mahara-ceo-extensions-auto (migration 20261009k).
// Deploy with --no-verify-jwt: pg_cron sends x-cron-secret, not a user token.
// Keys by name: CRON_SECRET, CLICKUP_API_TOKEN, TYPEFORM_TOKEN,
// CEO_EXTENSIONS_APPLY (live writes only when 'true'), and the SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY every function gets. Nothing here logs a key.

import {createClient} from 'npm:@supabase/supabase-js@2';
import {handle, type Admin} from './run.ts';

Deno.serve(req => handle(req, name => Deno.env.get(name), (url, key) => createClient(url, key, {auth: {persistSession: false}}) as unknown as Admin));
