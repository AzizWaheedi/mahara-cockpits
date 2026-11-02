-- SMS paused on the sales sub-account (Aziz, 2026-10-29: "pause the SMS
-- messages ... we don't even have anything connected to SMS? It's just
-- WhatsApp and email").
--
-- What was going out: every WhatsApp step in the HighLevel workflows has an
-- SMS twin that goes through the third-party "WA2 Connector" (a custom SMS
-- provider). 1,854 of the 4,810 conversations carry them; none was ever
-- marked delivered and none was ever answered. The public API cannot edit a
-- workflow, so the pause is HighLevel's own per-channel do not disturb: SMS
-- only, on every contact with a phone. Workflows skip an SMS step for a
-- contact on SMS do not disturb; WhatsApp, email and calls are untouched
-- (checked on the test contact and on a real lead the same day: the general
-- do not disturb stays off and the other channels keep their settings).
--
-- One row per contact keeps what its SMS setting was before, so switching
-- the pause off (setting sms_pause.on = false) puts each contact back as it
-- was. The sales-conversations worker keeps new contacts paused and does the
-- restoring; nothing here writes to HighLevel.

begin;

create table if not exists public.cockpit_sales_sms_pause (
  contact_id text primary key,
  -- The contact's SMS do not disturb before the pause; null when none was set.
  before jsonb,
  -- Already on do not disturb for everything, or already off for SMS: left alone.
  untouched text check (untouched is null or untouched in ('dnd_all', 'sms_already_off', 'no_phone')),
  paused_at timestamptz,
  restored_at timestamptz,
  error text check (error is null or length(error) <= 500),
  tries integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists cockpit_sales_sms_pause_open
  on public.cockpit_sales_sms_pause (paused_at) where restored_at is null;

alter table public.cockpit_sales_sms_pause enable row level security;
drop policy if exists cockpit_sales_sms_pause_seat_read on public.cockpit_sales_sms_pause;
create policy cockpit_sales_sms_pause_seat_read on public.cockpit_sales_sms_pause
  for select to authenticated using ((select public.cockpit_sales_seat()));
revoke all on table public.cockpit_sales_sms_pause from public, anon, authenticated;
grant select on table public.cockpit_sales_sms_pause to authenticated;
grant all on table public.cockpit_sales_sms_pause to service_role;

-- On, as Aziz asked. A manager turns it off from the Messages page
-- (sales-api sms.pause), which the worker then undoes contact by contact.
insert into public.cockpit_sales_settings (key, value, updated_by, updated_at)
values ('sms_pause',
        jsonb_build_object('on', true, 'since', now(), 'by', 'aziz@maharamedia.com',
                           'why', 'SMS is not connected: the WA2 Connector copies of WhatsApp steps were cluttering the conversations.'),
        'aziz@maharamedia.com', now())
on conflict (key) do nothing;

commit;
