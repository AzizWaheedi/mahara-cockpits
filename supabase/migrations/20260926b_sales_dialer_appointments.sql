-- The dialer works appointments as well as leads (Aziz, 2026-09-26):
--
-- - the intro call itself: intros are phone calls the setter makes at the
--   booked minute, so the dialer brings each one up for its setter then;
-- - confirmations: "If anybody's booked more than 24 hours out, the dialer
--   should be prioritizing them as a confirmation", by call or by text, to
--   raise the show rate.
--
-- The calendars confirm every booking on their own (autoConfirm), so
-- HighLevel's "confirmed" status says nothing about the lead. A lead's own
-- confirmation is kept here instead.

begin;

create table if not exists public.cockpit_sales_confirmations (
  id uuid primary key default gen_random_uuid(),
  appointment_id text not null,
  contact_id text,
  call_type text check (call_type is null or call_type in ('intro', 'demo')),
  start_at timestamptz,
  -- confirmed: the lead said they will be there; no_answer: tried, no one
  -- picked up; message_sent: a confirmation message went out; reschedule:
  -- moved to another time; cancelled: they will not come.
  result text not null
    check (result in ('confirmed', 'no_answer', 'message_sent', 'reschedule', 'cancelled')),
  via text not null check (via in ('call', 'whatsapp', 'email', 'reply', 'cockpit')),
  note text,
  by_email text not null,
  at timestamptz not null default now(),
  attempt_id uuid
);

create index if not exists cockpit_sales_confirmations_appt
  on public.cockpit_sales_confirmations (appointment_id, at desc);
create index if not exists cockpit_sales_confirmations_recent
  on public.cockpit_sales_confirmations (at desc);

alter table public.cockpit_sales_confirmations enable row level security;
drop policy if exists cockpit_sales_confirmations_seat_read on public.cockpit_sales_confirmations;
create policy cockpit_sales_confirmations_seat_read on public.cockpit_sales_confirmations
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_confirmations from public, anon, authenticated;
grant select on public.cockpit_sales_confirmations to authenticated;
grant all on public.cockpit_sales_confirmations to service_role;

-- What the dialer item was: a lead to call, the intro call itself, or a
-- confirmation; and the outcomes an appointment can end in.
alter table public.cockpit_sales_attempts
  add column if not exists item_kind text not null default 'lead'
    check (item_kind in ('lead', 'intro', 'confirm'));

alter table public.cockpit_sales_attempts drop constraint if exists cockpit_sales_attempts_outcome_check;
alter table public.cockpit_sales_attempts add constraint cockpit_sales_attempts_outcome_check
  check (outcome is null or outcome in (
    'no_answer', 'callback', 'booked', 'not_interested', 'disqualified', 'wrong_number', 'handled',
    'confirmed', 'rescheduled', 'cancelled', 'showed', 'noshow'
  ));

notify pgrst, 'reload schema';

commit;
