-- Billing and Communications (WhatsApp / Meetings) Access Policies
-- Creative Triage (bldgtotkfmhoxmlzowdx)

BEGIN;

-- 1. Cockpit Billing Accounts
GRANT SELECT, INSERT, UPDATE ON public.cockpit_billing_accounts TO authenticated;

DROP POLICY IF EXISTS cockpit_billing_accounts_ceo ON public.cockpit_billing_accounts;
DROP POLICY IF EXISTS cockpit_billing_accounts_seat ON public.cockpit_billing_accounts;
CREATE POLICY cockpit_billing_accounts_seat ON public.cockpit_billing_accounts
FOR SELECT TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

DROP POLICY IF EXISTS cockpit_billing_accounts_write ON public.cockpit_billing_accounts;
CREATE POLICY cockpit_billing_accounts_write ON public.cockpit_billing_accounts
FOR UPDATE TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo())
WITH CHECK (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

-- 2. Cockpit Billing Events
GRANT SELECT, INSERT ON public.cockpit_billing_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.cockpit_billing_events_id_seq TO authenticated;

DROP POLICY IF EXISTS cockpit_billing_events_seat ON public.cockpit_billing_events;
CREATE POLICY cockpit_billing_events_seat ON public.cockpit_billing_events
FOR ALL TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo())
WITH CHECK (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

-- 3. Cockpit Billing Inbox
GRANT SELECT, INSERT, UPDATE ON public.cockpit_billing_inbox TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.cockpit_billing_inbox_id_seq TO authenticated;

DROP POLICY IF EXISTS cockpit_billing_inbox_seat ON public.cockpit_billing_inbox;
CREATE POLICY cockpit_billing_inbox_seat ON public.cockpit_billing_inbox
FOR ALL TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo())
WITH CHECK (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

-- 4. WhatsApp Threads, Messages, Drafts
GRANT SELECT ON public.wa_threads TO authenticated;
GRANT SELECT ON public.wa_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.wa_drafts TO authenticated;

DROP POLICY IF EXISTS wa_threads_seat ON public.wa_threads;
CREATE POLICY wa_threads_seat ON public.wa_threads
FOR SELECT TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

DROP POLICY IF EXISTS wa_messages_seat ON public.wa_messages;
CREATE POLICY wa_messages_seat ON public.wa_messages
FOR SELECT TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

DROP POLICY IF EXISTS wa_drafts_seat ON public.wa_drafts;
CREATE POLICY wa_drafts_seat ON public.wa_drafts
FOR ALL TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo())
WITH CHECK (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

COMMIT;
