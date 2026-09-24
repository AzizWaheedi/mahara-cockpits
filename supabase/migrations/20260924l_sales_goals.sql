-- Goals by the month (Aziz, 2026-09-24: "What about their goals section? ...
-- We should be able to put projections and past numbers").
--
-- One row per rep, month and measure. The rep is B2B's sales_reps id, the
-- same person_key the scorecards use, so a manager can set Tahrir's goals
-- before Tahrir has a seat, and past months line up with past scorecards.
-- A manager sets the goal; the rep (or a manager) puts their own forecast
-- beside it. A month with no row falls back to the standing monthly goal on
-- the rep's seat (cockpit_sales_people.goals), which is what the cockpit
-- used before this table. Actuals are never stored here: they come from the
-- monthly scorecards the mirror computes from B2B and, for dials, Maqsam.
--
-- Written only by the sales-api Edge Function (service role), which checks
-- who may set what and writes the audit row.

begin;

create table if not exists public.cockpit_sales_goals (
  -- B2B's sales_reps id as text, as cockpit_sales_scorecards.person_key.
  person_key text not null,
  month date not null check (month = date_trunc('month', month)::date),
  metric text not null
    check (metric in ('booked', 'shown', 'closes', 'cash', 'dials')),
  goal numeric check (goal is null or (goal >= 0 and goal <= 10000000)),
  forecast numeric
    check (forecast is null or (forecast >= 0 and forecast <= 10000000)),
  note text check (note is null or length(note) <= 500),
  goal_by text,
  goal_at timestamptz,
  forecast_by text,
  forecast_at timestamptz,
  primary key (person_key, month, metric)
);

comment on table public.cockpit_sales_goals is
  'Sales cockpit: monthly goal (set by a manager) and forecast (set by the person or a manager) per measure. Written by sales-api only.';

alter table public.cockpit_sales_goals enable row level security;

-- A rep reads their own goals; a manager reads everyone's.
drop policy if exists cockpit_sales_goals_read on public.cockpit_sales_goals;
create policy cockpit_sales_goals_read on public.cockpit_sales_goals
  for select to authenticated
  using (
    public.cockpit_sales_seat()
    and (
      public.cockpit_sales_manager()
      or person_key = (
        select p.b2b_rep_id::text from public.cockpit_sales_people as p
        where p.email = public.cockpit_sales_email()
      )
    )
  );

revoke all on public.cockpit_sales_goals from anon, authenticated;
grant select on public.cockpit_sales_goals to authenticated;
grant all on public.cockpit_sales_goals to service_role;

-- Outbound dials by Maqsam address and Kuwait month, for the goals history.
-- security_invoker: the dials table's own row security decides who reads.
create or replace view public.cockpit_sales_dials_monthly
with (security_invoker = true) as
select
  lower(agent_email) as agent_email,
  to_char(date_trunc('month', occurred_at at time zone 'Asia/Kuwait'), 'YYYY-MM') as month,
  count(*) filter (where direction = 'outbound') as outbound,
  -- Maqsam leaves handling_s empty on outbound calls; "completed" is the
  -- state of an outbound call somebody answered (the others: no_answer,
  -- busy, blocked, failed).
  count(*) filter (where direction = 'outbound' and state = 'completed') as connected
from public.cockpit_sales_dials
where agent_email is not null
group by 1, 2;

revoke all on public.cockpit_sales_dials_monthly from anon, authenticated;
grant select on public.cockpit_sales_dials_monthly to authenticated;
grant select on public.cockpit_sales_dials_monthly to service_role;

notify pgrst, 'reload schema';

commit;
