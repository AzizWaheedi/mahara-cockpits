-- The scheduled CEO extensions pass, native (2026-10-09).
--
-- What. One pg_cron job, mahara-ceo-extensions-auto, runs every hour at
-- minute 47. It posts {"operation":"ceo.extensions.applyAuto"} to the Edge
-- Function ceo-extensions-sync, a cron-only door that runs extensionsAuto
-- from cockpit-ceo-api/endpoints.ts. That operation reads the Client Extension Form
-- on Typeform and the client cards, and keeps the ClickUp field "Current
-- extension (weeks)" in line with the form. It sends only the values that
-- changed since the last confirmed write.
--
-- Why. The Convex job applyAuto (apps/media-buyer-cockpit/convex/ceo/
-- extensions.ts) stopped with the Convex pause. The port to Supabase
-- (supabase/functions/cockpit-ceo-api/extensions.ts and endpoints.ts) has no
-- caller until this schedule exists, so a new extension on the form only
-- reached ClickUp when the founder pressed the button.
--
-- Safe by default. The pass is a dry run unless the Edge secret
-- CEO_EXTENSIONS_APPLY is exactly "true". A dry run writes nothing to
-- ClickUp. It records its plan in cockpit_sync_state under the key
-- 'ceo-extensions-auto' (last_run_at, ok, note, rows_seen). A live write goes
-- through the tools.ts helpers, so each ClickUp and Typeform call lands in
-- cockpit_ceo_provider_health, and cockpit_ceo_extension_write_record leaves
-- one audit row per card in the same transaction. The cron door accepts only
-- this one operation.
--
-- Depends on
--   20261009d_ceo_endpoints_native.sql: cockpit_ceo_extension_cards(),
--     cockpit_ceo_extension_write_record(), cockpit_ceo_extension_field_writes
--     and the cockpit_sync_state grant for service_role.
--   The vault secret cockpit_sync_secret (the other mahara jobs use it) and
--     the same value as the Edge secret CRON_SECRET on ceo-extensions-sync.
--   The Edge secrets CLICKUP_API_TOKEN and TYPEFORM_TOKEN. The field ID is
--     found by name unless CLICKUP_EXTENSION_FIELD is set. Without a secret
--     the run answers in plain words and cockpit_sync_state shows ok = false.
--   The Edge Function ceo-extensions-sync, deployed with --verify-jwt=false
--     before this migration: pg_cron sends x-cron-secret and no user token,
--     like the other mahara jobs. cockpit-ceo-api keeps verify_jwt on, so the
--     founder endpoint (bank import and the rest) stays behind the gateway.
--
-- Minute 47 is free in every other mahara schedule: billing 7/17/37,
-- onboarding 4-59/10, hiring 1-59/10, 6-59/10 and 8/38, clickup-writeback
-- 5/35 and every 2 minutes, comment-watch 7/22/37/52, ai-watch every 5.

BEGIN;

-- cron:begin
SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname = 'mahara-ceo-extensions-auto';
SELECT cron.schedule('mahara-ceo-extensions-auto','47 * * * *',$job$ select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/ceo-extensions-sync', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')), body := '{"operation":"ceo.extensions.applyAuto"}'::jsonb, timeout_milliseconds := 150000); $job$);
-- cron:end

NOTIFY pgrst,'reload schema';
COMMIT;
