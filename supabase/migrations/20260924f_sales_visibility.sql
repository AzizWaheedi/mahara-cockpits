-- What a rep may see of other reps (Aziz, 2026-09-24): their own numbers,
-- a team board of rates, and nobody else's pay.
--
-- 1. Seats: a rep reads their own row (with their pay rule and goals); a
--    manager reads every row. Everyone with a seat reads the team list
--    (names, roles and the HighLevel ids the calendar needs) through
--    cockpit_sales_team, which carries no pay and no goals.
-- 2. Scorecards: one row per person per window. A rep reads their own; a
--    manager reads all. cockpit_sales_board is the rates only, for everyone
--    with a seat.

begin;

drop policy if exists cockpit_sales_people_seat_read on public.cockpit_sales_people;
drop policy if exists cockpit_sales_people_own_read on public.cockpit_sales_people;
create policy cockpit_sales_people_own_read on public.cockpit_sales_people
  for select to authenticated
  using (
    public.cockpit_sales_manager()
    or (public.cockpit_sales_seat() and email = public.cockpit_sales_email())
  );

create or replace view public.cockpit_sales_team as
select p.email, p.name, p.role, p.ghl_user_id, p.b2b_rep_id, p.active, p.via_portal
  from public.cockpit_sales_people as p
 where public.cockpit_sales_seat();

revoke all on public.cockpit_sales_team from public, anon, authenticated;
grant select on public.cockpit_sales_team to authenticated, service_role;

drop table if exists public.cockpit_sales_scorecards;
create table public.cockpit_sales_scorecards (
  window_key text not null,
  -- B2B's person_key: the sales_reps id, or a name B2B could not resolve.
  person_key text not null,
  from_day date not null,
  to_day date not null,
  display_name text,
  role text,
  is_known boolean,
  row jsonb not null,
  computed_at timestamptz not null default now(),
  primary key (window_key, person_key)
);

alter table public.cockpit_sales_scorecards enable row level security;
create policy cockpit_sales_scorecards_own_read on public.cockpit_sales_scorecards
  for select to authenticated
  using (
    public.cockpit_sales_manager()
    or (
      public.cockpit_sales_seat()
      and person_key = (
        select p.b2b_rep_id::text from public.cockpit_sales_people as p
         where p.email = public.cockpit_sales_email()
      )
    )
  );
revoke all on table public.cockpit_sales_scorecards from public, anon, authenticated;
grant select on table public.cockpit_sales_scorecards to authenticated;
grant all on table public.cockpit_sales_scorecards to service_role;

-- Rates only. Qualified rate = qualified ÷ shown; close rate on all shown
-- demos beside B2B's close_rate, which is on qualified demos.
create or replace view public.cockpit_sales_board as
select
  s.window_key,
  s.person_key,
  s.display_name,
  s.role,
  s.from_day,
  s.to_day,
  (s.row ->> 'show_rate')::numeric as show_rate,
  (s.row ->> 'noshow_rate')::numeric as noshow_rate,
  (s.row ->> 'disqualified_rate')::numeric as disqualified_rate,
  case when (s.row ->> 'calls_shown')::numeric > 0
       then round(100 * (s.row ->> 'calls_qualified')::numeric / (s.row ->> 'calls_shown')::numeric, 1)
  end as qualified_rate,
  (s.row ->> 'close_rate')::numeric as qualified_close_rate,
  case when (s.row ->> 'demos_shown')::numeric > 0
       then round(100 * (s.row ->> 'closes')::numeric / (s.row ->> 'demos_shown')::numeric, 1)
  end as close_rate,
  ((s.row ->> 'calls_due')::numeric > 0) as has_calls,
  s.computed_at
  from public.cockpit_sales_scorecards as s
 where public.cockpit_sales_seat();

revoke all on public.cockpit_sales_board from public, anon, authenticated;
grant select on public.cockpit_sales_board to authenticated, service_role;

commit;
