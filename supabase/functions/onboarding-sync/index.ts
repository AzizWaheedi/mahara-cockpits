// onboarding-sync: the scheduled onboarding links and forms sync (see sync.ts).
//
// Runs on Supabase (Creative Triage bldgtotkfmhoxmlzowdx), scheduled by
// pg_cron job mahara-onboarding-sync every 10 minutes (migration 20261009b).
// Deploy with --no-verify-jwt: pg_cron sends x-cron-secret, not a user token.
// Keys by name: CRON_SECRET, CLICKUP_API_TOKEN, TYPEFORM_TOKEN, and the
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY every function gets. Nothing
// here logs a key.

import {createClient} from 'npm:@supabase/supabase-js@2';
import {handle, type Admin} from './sync.ts';

Deno.serve(req =>
  handle(req, name => Deno.env.get(name), (url, key) => createClient(url, key, {auth: {persistSession: false}}) as unknown as Admin),
);
