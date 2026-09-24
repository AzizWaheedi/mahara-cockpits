-- Talking to a lead from the cockpit (Aziz, 2026-09-24: "in the dialer, they
-- should be able to talk to the lead, and in the lead section as well, using
-- the GoHighLevel integration ... and the touch point, the same way you can
-- send messages straight away").
--
-- Every message a rep (or, later, the follow-up agent after a rep approves)
-- sends goes through sales-api to HighLevel's conversations API on the sales
-- sub-account, and is written here first:
-- - request_id is unique, so a double tap or a retry never sends twice;
-- - state follows HighLevel's own status, read back after the send (a
--   WhatsApp send HighLevel accepts can still fail: Meta's marketing cap, an
--   empty wallet), and the failure's reason is kept;
-- - the lead's conversation itself stays in HighLevel, read live.
--
-- Read by any seat; written by sales-api only (service role).

begin;

create table if not exists public.cockpit_sales_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  contact_id text not null,
  channel text not null check (channel in ('whatsapp', 'sms', 'email')),
  subject text check (subject is null or length(subject) <= 300),
  body text not null check (length(body) between 1 and 10000),
  -- rep: typed by the rep; followup: an agent's draft a rep approved.
  source text not null default 'rep' check (source in ('rep', 'followup')),
  followup_id uuid,
  sent_by text not null,
  state text not null default 'sending'
    check (state in ('sending', 'sent', 'delivered', 'read', 'failed')),
  ghl_message_id text,
  ghl_conversation_id text,
  provider_status text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cockpit_sales_messages_contact_idx
  on public.cockpit_sales_messages (contact_id, created_at desc);
create index if not exists cockpit_sales_messages_sender_idx
  on public.cockpit_sales_messages (sent_by, created_at desc);

alter table public.cockpit_sales_messages enable row level security;

drop policy if exists cockpit_sales_messages_seat_read on public.cockpit_sales_messages;
create policy cockpit_sales_messages_seat_read on public.cockpit_sales_messages
  for select to authenticated
  using (public.cockpit_sales_seat());

revoke all on public.cockpit_sales_messages from anon, authenticated;
grant select on public.cockpit_sales_messages to authenticated;
grant all on public.cockpit_sales_messages to service_role;

-- Which channels the cockpit may send on. WhatsApp is the official line on
-- the sales sub-account; email goes out through HighLevel's own email
-- (replies come back into the same conversation). SMS stays off: the sales
-- team does not use it and the line is WhatsApp.
insert into public.cockpit_sales_settings (key, value, updated_by)
values ('messaging', '{"whatsapp": true, "email": true, "sms": false}'::jsonb, 'migration')
on conflict (key) do nothing;

notify pgrst, 'reload schema';

commit;
