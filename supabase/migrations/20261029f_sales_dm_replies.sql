-- Replies to Instagram and Facebook DMs from the cockpit's Messages page
-- (Aziz, 2026-10-29: "the DMs that we get"). sales-api's convo.send writes
-- every send here first, so the two DM channels join WhatsApp, SMS and email.
-- HighLevel sends a DM reply up to seven days after the lead's own last DM
-- (sales-api lib.ts DM_WINDOW_HOURS); the window is checked live per send.

begin;

alter table public.cockpit_sales_messages drop constraint if exists cockpit_sales_messages_channel_check;
alter table public.cockpit_sales_messages add constraint cockpit_sales_messages_channel_check
  check (channel = any (array['whatsapp', 'sms', 'email', 'instagram', 'facebook']));

commit;
