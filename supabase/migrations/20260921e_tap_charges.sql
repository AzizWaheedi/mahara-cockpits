-- Tap charges, synced inside Supabase
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- Aziz, 2026-09-21: "We moved from Convex to Supabase anyway." The Tap key
-- lives in Supabase (an Edge Function secret), the Edge Function
-- tap-charges-sync pulls captured charges every 15 minutes into this table,
-- and the CEO cockpit reads the table the way it reads whop_payments.

begin;

create table if not exists public.cockpit_tap_charges (
  id           text primary key,
  day          date not null,
  at           timestamptz not null,
  status       text not null,
  live         boolean not null default true,
  currency     text not null,
  amount       numeric(14,3) not null,
  usd          numeric(14,2),
  email        text,
  name         text,
  description  text,
  reference    text,
  raw          jsonb,
  captured_at  timestamptz not null default now()
);
comment on table public.cockpit_tap_charges is
  'Captured live Tap charges pulled by the tap-charges-sync Edge Function: one row per charge, the Kuwait day of transaction.created, the amount in its currency and in USD at the cockpit''s fixed rates, the customer''s email and name for matching.';
create index if not exists cockpit_tap_charges_day_idx on public.cockpit_tap_charges (day);

create table if not exists public.cockpit_sync_state (
  key          text primary key,
  last_run_at  timestamptz,
  last_ok_at   timestamptz,
  ok           boolean not null default false,
  note         text,
  rows_seen    integer,
  updated_at   timestamptz not null default now()
);
comment on table public.cockpit_sync_state is
  'One row per cockpit sync running inside Supabase (tap-charges-sync, ...): when it last ran, when it last succeeded, and a plain note when it did not.';

alter table public.cockpit_tap_charges enable row level security;
alter table public.cockpit_sync_state  enable row level security;
revoke all on public.cockpit_tap_charges from anon, authenticated;
revoke all on public.cockpit_sync_state  from anon, authenticated;

commit;
