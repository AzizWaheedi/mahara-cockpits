-- The dialer brought level with the call centre's (Aziz, 2026-09-24: "For
-- the dialer, it works as smoothly as it should be at the call center"):
--
-- - Maqsam's own record of each call is matched to the attempt (call id,
--   state, seconds), so a call nobody answered saves itself as No answer and
--   the next lead comes up, as mahara-power-dialer does (matchCall and
--   isNoAnswer, src/domain.mjs).
-- - An outcome can be saved without a call through the dialer (the rep rang
--   from the softphone or a mobile): a manual attempt.
-- - A call can be booked from the dialer on the HighLevel calendar; every
--   booking is written down before HighLevel is asked, read back after, and
--   one booking per lead can be in flight at a time.

begin;

alter table public.cockpit_sales_attempts
  -- The queue the rep was working when they called (setter or closer).
  add column if not exists as_role text
    check (as_role is null or as_role in ('setter', 'closer')),
  -- Saved without a call through the dialer.
  add column if not exists manual boolean not null default false,
  -- Maqsam's call, once its history shows it.
  add column if not exists maqsam_call_id text,
  add column if not exists call_state text,
  add column if not exists call_duration_s integer,
  add column if not exists call_checked_at timestamptz,
  -- Saved by the dialer itself from Maqsam's record (no answer, 0 seconds).
  add column if not exists auto_saved boolean not null default false,
  -- The call booked on this attempt.
  add column if not exists appointment_id text;

create index if not exists cockpit_sales_attempts_saved
  on public.cockpit_sales_attempts (rep_email, saved_at desc) where state = 'saved';

create table if not exists public.cockpit_sales_bookings (
  id uuid primary key default gen_random_uuid(),
  contact_id text not null,
  attempt_id uuid,
  kind text not null check (kind in ('intro', 'demo')),
  calendar_id text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  -- Who the call is with: the booker, or the calendar's round robin.
  assigned_user_id text,
  rep_email text not null,
  note text,
  -- creating: HighLevel is being asked; booked: created and read back;
  -- unverified: created, but the read-back did not match or failed;
  -- failed: HighLevel refused, nothing was booked.
  state text not null default 'creating'
    check (state in ('creating', 'booked', 'unverified', 'failed')),
  appointment_id text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- One booking in flight per lead: a double click cannot book twice.
create unique index if not exists cockpit_sales_bookings_one_in_flight
  on public.cockpit_sales_bookings (contact_id) where state = 'creating';
create index if not exists cockpit_sales_bookings_contact
  on public.cockpit_sales_bookings (contact_id, created_at desc);
create index if not exists cockpit_sales_bookings_rep
  on public.cockpit_sales_bookings (rep_email, created_at desc);

alter table public.cockpit_sales_bookings enable row level security;
drop policy if exists cockpit_sales_bookings_seat_read on public.cockpit_sales_bookings;
create policy cockpit_sales_bookings_seat_read on public.cockpit_sales_bookings
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_bookings from public, anon, authenticated;
grant select on public.cockpit_sales_bookings to authenticated;
grant all on public.cockpit_sales_bookings to service_role;

notify pgrst, 'reload schema';

commit;
