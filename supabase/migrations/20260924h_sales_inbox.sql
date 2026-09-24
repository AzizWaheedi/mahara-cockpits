-- Replies: the newest conversations in the sales sub-account, so the cockpit
-- can put a lead who just wrote back at the top of the day. Read from
-- HighLevel's conversation search by the sales-mirror function every three
-- minutes (the 100 most recent). The message text is kept short: this is a
-- pointer to the conversation, not a copy of it.

begin;

create table if not exists public.cockpit_sales_inbox (
  conversation_id text primary key,
  contact_id text,
  contact_name text,
  last_message_at timestamptz,
  last_direction text,
  last_type text,
  last_body text,
  unread integer,
  inbound_whatsapp_at timestamptz,
  assigned_to text,
  mirrored_at timestamptz not null default now()
);

create index if not exists cockpit_sales_inbox_at on public.cockpit_sales_inbox (last_message_at desc);
create index if not exists cockpit_sales_inbox_contact on public.cockpit_sales_inbox (contact_id);

alter table public.cockpit_sales_inbox enable row level security;
drop policy if exists cockpit_sales_inbox_seat_read on public.cockpit_sales_inbox;
create policy cockpit_sales_inbox_seat_read on public.cockpit_sales_inbox
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on table public.cockpit_sales_inbox from public, anon, authenticated;
grant select on table public.cockpit_sales_inbox to authenticated;
grant all on table public.cockpit_sales_inbox to service_role;

commit;
