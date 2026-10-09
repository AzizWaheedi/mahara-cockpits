-- The browser writes billing only through cockpit_billing_write (20261009a).
-- Split from 20261009a so it is applied in the same release as the client
-- success and media buyer cockpits that call cockpit_billing_write; before
-- that release the live frontends still wrote these tables directly.
-- Reads are unchanged. The service role keeps its grants.
BEGIN;
DROP POLICY IF EXISTS cockpit_billing_accounts_write ON public.cockpit_billing_accounts;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.cockpit_billing_accounts, public.cockpit_billing_events,
  public.cockpit_billing_inbox FROM anon, authenticated;
REVOKE USAGE ON SEQUENCE public.cockpit_billing_events_id_seq, public.cockpit_billing_inbox_id_seq FROM anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
