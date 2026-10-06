-- The churn tracker, inside the client success cockpit (the CEO, 2026-10-01:
-- "make the churn tracker part of the csm cockpit in the same logic in
-- mahara context for tracking churn and link to it instead").
--
-- The logic is mahara-context's churn tracker
-- (skills/meta/clickup-board-design/references/churn-tracker-build.md) and
-- the churn definition the CSM contract carries
-- (skills/meta/comp-structure-design/references/churn-and-billing-timelines.md):
--
--   * Churn is a client lost mid-programme, before day 90 from launch. A
--     client who completes the term is never churn, whether or not they
--     renew; renewals are a separate line.
--   * One row per departure, logged the day it happens: client, date left,
--     launch date, reason, MRR lost, CSM. Days into term and "counts as"
--     are worked out, never typed.
--   * Per month, two numbers are typed: active clients at the start (or
--     carried from the month before) and new clients. Churned, completed,
--     active at the end, the rates and the rolling three months follow.
--   * Churn is never reversed: a client who comes back is a reactivation;
--     a wrong row is removed by the CEO or an admin, with the reason kept.
--
-- a) cockpit_churn_departures: the register.
-- b) cockpit_churn_months: the two typed numbers a month, and for months
--    before the register the old sheet's count of clients lost.
-- c) cockpit_churn_log: every change, who made it and what it was.
-- d) The months the old Churn Tracker MaharaMedia 2026 sheet recorded
--    (January, August, September 2026), so the history is not lost when
--    the links move to the cockpit.
--
-- The service role is the only door (convex/churn.ts in the client success
-- cockpit). Idempotent.

begin;

-- a) ----------------------------------------------------------------------------
create table if not exists public.cockpit_churn_departures (
  id               bigserial primary key,
  client           text not null check (length(btrim(client)) > 0),
  clickup_task_id  text,
  left_on          date not null,
  launched_on      date,
  reason           text not null check (reason in (
                     'Cancelled', 'Refund', 'Chargeback', 'Non-payment 14+ days',
                     'Paused past 14 days', 'Ghosted', 'Completed term, did not renew',
                     'Other')),
  mrr_lost_usd     numeric check (mrr_lost_usd is null or mrr_lost_usd >= 0),
  csm              text,
  note             text,
  source           text not null default 'cockpit' check (source in ('cockpit', 'sheet')),
  created_by       text not null,
  created_at       timestamptz not null default now(),
  updated_by       text,
  updated_at       timestamptz not null default now(),
  removed_at       timestamptz,
  removed_by       text,
  removed_why      text,
  check (launched_on is null or launched_on <= left_on)
);
comment on table public.cockpit_churn_departures is
  'The churn register: one row per client who left, logged the day it happens. Days into term = left_on - launched_on; under 90 is churn, 90 or more is a completed term. Rows are removed (removed_at), never deleted.';
create unique index if not exists cockpit_churn_departures_card_day
  on public.cockpit_churn_departures (clickup_task_id, left_on)
  where removed_at is null and clickup_task_id is not null;
create index if not exists cockpit_churn_departures_left_on
  on public.cockpit_churn_departures (left_on desc) where removed_at is null;

-- b) ----------------------------------------------------------------------------
create table if not exists public.cockpit_churn_months (
  month                 text primary key check (month ~ '^\d{4}-\d{2}$'),
  active_at_start       integer check (active_at_start is null or active_at_start >= 0),
  new_clients           integer check (new_clients is null or new_clients >= 0),
  lost_before_register  integer check (lost_before_register is null or lost_before_register >= 0),
  note                  text,
  updated_by            text not null,
  updated_at            timestamptz not null default now()
);
comment on table public.cockpit_churn_months is
  'The two numbers typed for a month (active clients at the start, new clients). A blank start is carried from the month before. lost_before_register is the old sheet''s count for a month the register does not cover.';

-- c) ----------------------------------------------------------------------------
create table if not exists public.cockpit_churn_log (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  by_whom  text not null,
  what     text not null,
  detail   jsonb
);
create index if not exists cockpit_churn_log_at on public.cockpit_churn_log (at desc);

alter table public.cockpit_churn_departures enable row level security;
alter table public.cockpit_churn_months     enable row level security;
alter table public.cockpit_churn_log        enable row level security;

revoke all on public.cockpit_churn_departures from anon, authenticated;
revoke all on public.cockpit_churn_months     from anon, authenticated;
revoke all on public.cockpit_churn_log        from anon, authenticated;
revoke all on sequence public.cockpit_churn_departures_id_seq from anon, authenticated;
revoke all on sequence public.cockpit_churn_log_id_seq        from anon, authenticated;

grant all on public.cockpit_churn_departures to service_role;
grant all on public.cockpit_churn_months     to service_role;
grant all on public.cockpit_churn_log        to service_role;
grant usage, select on sequence public.cockpit_churn_departures_id_seq to service_role;
grant usage, select on sequence public.cockpit_churn_log_id_seq        to service_role;

-- d) ----------------------------------------------------------------------------
with seeded as (
  insert into public.cockpit_churn_months
    (month, active_at_start, new_clients, lost_before_register, note, updated_by)
  values
    ('2026-01', 15, 5, 3,
     'From the old Churn Tracker sheet: 15 at the start, 3 lost ($5,000 MRR), 5 new ($10,000 MRR). The sheet did not split mid-programme losses from completed terms.',
     'churn tracker setup'),
    ('2026-08', null, 10, 2,
     'From the old Churn Tracker sheet: 2 lost, 10 new ($20,000 MRR). No start count was recorded.',
     'churn tracker setup'),
    ('2026-09', 22, null, 1,
     'From the old Churn Tracker sheet: 22 at the start, 1 lost. New clients were not recorded.',
     'churn tracker setup')
  on conflict (month) do nothing
  returning month
)
insert into public.cockpit_churn_log (by_whom, what, detail)
select 'churn tracker setup', format('brought in %s from the old sheet', month),
       jsonb_build_object('sheet', '1p8CAd5pL9zKjc1mZ73Gc_hoj4NSWHfFPs4FoC_WuBUU', 'tab', '01: Churn Tracker')
  from seeded;

notify pgrst, 'reload schema';

commit;
