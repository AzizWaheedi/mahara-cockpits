-- The end of day, filled in the cockpit (Aziz, 2026-09-24: "The end-of-day
-- should be integrated into the thing, the same way the media buyer and the
-- client success have that thing"; his tenth answer that morning: "Yes EOD").
--
-- Setters and closers filed EODs on two Typeforms ("EOD Form — Setter"
-- x0FWfEpA, "EOD Form — Sales Rep" BfnrbVWJ), which Make copied into the
-- EOD Reports sheet's "Setter" and "Sales Rep" tabs and posted to
-- #eods-salesreps. The cockpit's form asks the same questions, fills the
-- numbers it already knows (Maqsam's dials and talk time, the calendar's
-- shows, the deals) for the rep to check, and goes out the way the other
-- cockpits' EODs go: a row in eod_outbox that hermes/eod-out posts to Slack
-- as text (EOD Radar reads the text) and appends to the tab in its own
-- column order.
--
-- eod_outbox.sheet_at: the worker now writes the sheet row on its own
-- clock. Before, a Slack refusal (a bot not invited to the channel) also
-- kept the row out of the sheet, and every retry risked a second row.

begin;

create table if not exists public.cockpit_sales_eods (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  role text not null check (role in ('setter', 'closer')),
  -- The Kuwait working day it is for; a filing before 04:00 is yesterday's.
  day date not null,
  answers jsonb not null default '{}'::jsonb,
  -- What the cockpit counted when the form was opened, kept beside the
  -- answers, so a changed number is visible as a change.
  computed jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  outbox_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email, day, role)
);

create index if not exists cockpit_sales_eods_day_idx on public.cockpit_sales_eods (day desc);

alter table public.cockpit_sales_eods enable row level security;

drop policy if exists cockpit_sales_eods_read on public.cockpit_sales_eods;
create policy cockpit_sales_eods_read on public.cockpit_sales_eods
  for select to authenticated
  using (
    public.cockpit_sales_seat()
    and (email = public.cockpit_sales_email() or public.cockpit_sales_manager())
  );

revoke all on public.cockpit_sales_eods from anon, authenticated;
grant select on public.cockpit_sales_eods to authenticated;
grant all on public.cockpit_sales_eods to service_role;

alter table public.eod_outbox add column if not exists sheet_at timestamptz;
alter table public.eod_outbox add column if not exists sheet_error text;

-- A rep may see where their own EOD got to: the outbox row's state, and
-- nothing else of anyone's (the outbox has no policies of its own).
create or replace view public.cockpit_sales_eod_status
with (security_invoker = false) as
select e.id as eod_id, e.email, e.day, e.role, o.status, o.slack_ts, o.sent_at,
       o.sheet_at, o.error, o.sheet_error, o.attempts
from public.cockpit_sales_eods as e
join public.eod_outbox as o on o.id = e.outbox_id
where public.cockpit_sales_seat()
  and (e.email = public.cockpit_sales_email() or public.cockpit_sales_manager());

revoke all on public.cockpit_sales_eod_status from anon, authenticated;
grant select on public.cockpit_sales_eod_status to authenticated;

notify pgrst, 'reload schema';

commit;
