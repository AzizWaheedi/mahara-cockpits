-- The sync and the CEO refresh read the waves 1-2 views through the management API's read-only
-- connection (role supabase_read_only_user, transport.ts read_only:true). cockpit_extensions_v
-- (and cockpit_client_lifecycle_v and cockpit_late_payments_v, which read it) calls the immutable
-- date helper cockpit_billing_iso_day, which only postgres and service_role could run, so the
-- w12read1 release's sync dry run failed with "permission denied for function
-- cockpit_billing_iso_day" (2026-11-01). The helper only parses a date string; the read-only
-- role may run it. Applies twice.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_read_only_user') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_billing_iso_day(text) TO supabase_read_only_user';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
