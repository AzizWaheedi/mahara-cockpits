-- Client chats are read through the WhatsApp functions only (2026-10-12).
--
-- Live before this migration: anon and authenticated held every privilege on
-- wa_threads, wa_messages, wa_drafts and wa_state, and the policies from
-- 20260924r let any active seat read every client chat and rewrite drafts
-- through the REST API, whatever clients that seat covers.
--
-- Checked first (read-only, 2026-10-12): every WhatsApp function the browsers
-- call is SECURITY DEFINER (cockpit_wa_inbox, cockpit_comms_overview,
-- cockpit_wa_reply_context, cockpit_wa_reply_begin, cockpit_wa_archive,
-- cockpit_wa_history, cockpit_csm_projection_booking_context), no view reads
-- these tables, none is in a realtime publication, and apps/*/src has no
-- .from('wa_...') read. The inbox worker writes with the service key, which
-- this migration leaves alone.
BEGIN;

DROP POLICY IF EXISTS wa_threads_seat ON public.wa_threads;
DROP POLICY IF EXISTS wa_messages_seat ON public.wa_messages;
DROP POLICY IF EXISTS wa_drafts_seat ON public.wa_drafts;

ALTER TABLE public.wa_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wa_threads, public.wa_messages, public.wa_drafts, public.wa_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.wa_threads, public.wa_messages, public.wa_drafts, public.wa_state TO service_role;

COMMIT;
