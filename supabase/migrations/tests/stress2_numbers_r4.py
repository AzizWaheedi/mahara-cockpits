#!/usr/bin/env python3
"""Second series, round 4, numbers and data integrity, on the live database
(Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/stress2_numbers_r4.py

closer-live-call-copied-as-intro-takes-setter-credit: fix round 3 copies a
live booking into cockpit_sales_appointments (rooms.ts copyLiveBooking) so
the setter's pay estimate and EOD see it. The lead page and the dialer ask
every room as call_kind "intro" (LeadPage.tsx VideoPicker, DialerPage.tsx
videoAsk), whoever the seat is, so a closer's video call with a lead after
the lead's demo is booked and copied as a held INTRO assigned to the
closer. cockpit_sales_setter_deals (20260927a) credits a deal whose form
leaves the setter blank (every deal since 24 September so far) to the rep
assigned the lead's latest intro before the deal, on any calendar: the
closer's live "intro" takes the deal off the setter's pay.

The check runs the function's own body with only its caller check (who may
read whose deals) made true, as a pg_temp function inside the transaction:
the real setter's rep (read, never written), and synthetic rows for one
lead (contact and appointment ids start with 'stress-s2n4-'). Nothing is
committed. Fix round 4 redefines the function in 20261004a (not applied in
production yet), so the body is 20261004a's while that file defines it, and
the deployed one (pg_get_functiondef) otherwise; `--deployed` checks the
deployed one (the finding, until 20261004a is applied).
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import q  # noqa: E402  (the management API call with its 429 wait)

INTRO_CAL = "dsqmJ393Dwl9fDSbIVOI"
DEMO_CAL = "jQqXS1YuFnmGZKLkrE62"

SQL = r"""
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create temp table s2n4_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

%(probe)s

create temp table s2n4_rep on commit drop as
select r.id::text as rep_id, r.ghl_user_id
  from public.cockpit_sales_people as p
  join public.cockpit_sales_reps as r on r.id = p.b2b_rep_id
 where p.active and p.role = 'setter' and r.ghl_user_id is not null
 limit 1;

-- The lead: the setter's intro (held) three days ago, the closer's demo
-- (held) two days ago, the deal today with the setter left blank.
insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, calendar_id, start_at, booked_at, status, assigned_user_id, origin)
select 'stress-s2n4-intro', 'stress-s2n4-lead-1', 'intro', '%(intro)s', now() - interval '3 days', now() - interval '4 days',
       'showed', r.ghl_user_id, 'b2b'
  from pg_temp.s2n4_rep as r;
insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, calendar_id, start_at, booked_at, status, assigned_user_id, origin)
values ('stress-s2n4-demo', 'stress-s2n4-lead-1', 'demo', '%(demo)s', now() - interval '2 days', now() - interval '3 days',
        'showed', 'G-stress-s2n4-closer', 'b2b');
insert into public.cockpit_sales_deals (response_id, submitted_at, closer, contact_id, client_name, cash_collected, contracted_revenue, setter)
values ('stress-s2n4-deal-1', now(), 'Stress Closer', 'stress-s2n4-lead-1', 'Stress Lead', 1000, 1000, null);

insert into pg_temp.s2n4_checks (name, ok, detail)
select 'control: before any live call, the blank-setter deal is credited to the setter by the lead''s intro',
       exists (select 1 from pg_temp.s2n4_setter_deals((select rep_id from pg_temp.s2n4_rep), now() - interval '1 hour', now() + interval '1 hour') as d
                where d.response_id = 'stress-s2n4-deal-1' and d.credited_by = 'intro'),
       format('setter rep found: %s', (select count(*) from pg_temp.s2n4_rep));

-- An hour ago the closer sent the lead a video link from the lead page and
-- the lead joined: the count booked "Live · Stress" on rooms.live_calendar_id
-- and copied it as rooms.ts copyLiveBooking writes it (call_type from the
-- room's call_kind, "intro"; the host's HighLevel user; origin ghl).
insert into public.cockpit_sales_appointments (appointment_id, contact_id, contact_name, call_type, calendar_id, start_at, booked_at, status, assigned_user_id, origin)
values ('stress-s2n4-live', 'stress-s2n4-lead-1', 'Stress', 'intro',
        coalesce((select value ->> 'live_calendar_id' from public.cockpit_sales_settings where key = 'rooms'), 'stress-s2n4-livecal'),
        now() - interval '1 hour', now() - interval '1 hour', 'showed', 'G-stress-s2n4-closer', 'ghl');
-- The room whose count booked it (rooms.ts countCreate writes count_result
-- booked and the booking's id on the room before it copies the booking).
insert into public.cockpit_sales_rooms
  (request_id, contact_id, purpose, trigger, call_kind, provider, host_email, made_by, state, result, end_reason,
   join_url, provider_meeting_id, opened_at, link_sent_at, host_in_at, lead_in_at, ended_at,
   count_claimed_at, count_result, count_appointment_id)
values (gen_random_uuid(), 'stress-s2n4-lead-1', 'manual', 'manual', 'intro', 'meet',
        'closer-s2n4@stress.invalid', 'closer-s2n4@stress.invalid', 'ended', 'joined', 'finished',
        'https://meet.example.invalid/stress-s2n4', 'stress-s2n4-evt', now() - interval '65 minutes',
        now() - interval '64 minutes', now() - interval '63 minutes', now() - interval '1 hour', now() - interval '40 minutes',
        now() - interval '59 minutes', 'booked', 'stress-s2n4-live');

insert into pg_temp.s2n4_checks (name, ok, detail)
select 'closer-live-call-copied-as-intro-takes-setter-credit: the closer''s live call (copied as an intro) must not take the blank-setter deal off the setter''s pay',
       exists (select 1 from pg_temp.s2n4_setter_deals((select rep_id from pg_temp.s2n4_rep), now() - interval '1 hour', now() + interval '1 hour') as d
                where d.response_id = 'stress-s2n4-deal-1' and d.credited_by = 'intro'),
       format('deals credited to the setter now: %s; the lead''s latest intro is %s',
              (select count(*) from pg_temp.s2n4_setter_deals((select rep_id from pg_temp.s2n4_rep), now() - interval '1 hour', now() + interval '1 hour')
                where response_id = 'stress-s2n4-deal-1'),
              (select appointment_id || ' on ' || calendar_id from public.cockpit_sales_appointments
                where contact_id = 'stress-s2n4-lead-1' and call_type = 'intro' order by start_at desc limit 1));

select name, ok, detail from pg_temp.s2n4_checks order by n;
rollback;
"""

DEPLOYED_PROBE = r"""
-- The production function, its caller check made true (nothing else changed).
do $do$
declare
  body text := pg_get_functiondef('public.cockpit_sales_setter_deals(text,timestamptz,timestamptz)'::regprocedure);
  probe text;
begin
  probe := replace(body, 'FUNCTION public.cockpit_sales_setter_deals(', 'FUNCTION pg_temp.s2n4_setter_deals(');
  probe := regexp_replace(probe, 'with allowed as \(.*?\),\s*rep as', 'with allowed as (select true as ok), rep as');
  if probe = body or position('select true as ok' in probe) = 0 then
    raise exception 'the probe could not be made from the function body';
  end if;
  execute probe;
end
$do$;
"""


def migration_probe() -> str:
    """20261004a's cockpit_sales_setter_deals as a pg_temp function, its caller check made true."""
    mig = open(os.path.join(os.path.dirname(HERE), "20261004a_live_calls_hardening_2.sql")).read()
    m = re.search(r"create or replace function public\.cockpit_sales_setter_deals\(.*?\n\$\$;", mig, re.S)
    if not m:
        return ""
    body = m.group(0).replace("create or replace function public.cockpit_sales_setter_deals(",
                              "create function pg_temp.s2n4_setter_deals(")
    probe = re.sub(r"with allowed as \(.*?\),\s*rep as", "with allowed as (select true as ok), rep as", body, flags=re.S)
    if probe == body or "select true as ok" not in probe or "pg_temp.s2n4_setter_deals" not in probe:
        raise SystemExit("20261004a's setter_deals could not be made into a probe")
    return probe


def compose(deployed: bool = False) -> str:
    probe = DEPLOYED_PROBE if deployed else (migration_probe() or DEPLOYED_PROBE)
    return SQL.replace("%(intro)s", INTRO_CAL).replace("%(demo)s", DEMO_CAL).replace("%(probe)s", probe)

LEFTOVERS = r"""
select 'appointment ' || appointment_id as what from public.cockpit_sales_appointments where appointment_id like 'stress-s2n4-%'
union all
select 'room ' || id::text from public.cockpit_sales_rooms where contact_id like 'stress-s2n4-%'
union all
select 'deal ' || response_id from public.cockpit_sales_deals where response_id like 'stress-s2n4-%'
"""


def rolled_back(sql: str) -> list:
    tx = [s.lower() for s in run_checks.top_level_statements(sql) if run_checks.TX.match(s)]
    if tx != ["begin", "rollback"]:
        sys.exit(f"Refusing to run: transaction statements {tx}.")
    return q(sql, write=True)


def main():
    before = q(LEFTOVERS, write=False)
    if before:
        sys.exit(f"Synthetic rows from an earlier run are still there: {[r['what'] for r in before]}. Remove them first.")
    rows = rolled_back(compose("--deployed" in sys.argv[1:]))
    failed = [r for r in rows if not r.get("ok")]
    for r in rows:
        print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}" + (f"  ({r.get('detail')})" if r.get("detail") else ""))
    print(f"\n{len(rows) - len(failed)} passed, {len(failed)} failed, {len(rows)} checks.")
    after = q(LEFTOVERS, write=False)
    if after:
        print("LEFT BEHIND:", json.dumps([r["what"] for r in after]))
        sys.exit(1)
    print("Nothing persisted.")
    sys.exit(0 if rows and not failed else 1)


if __name__ == "__main__":
    if sys.argv[1:] == ["--sql"]:
        # The one rolled-back transaction, for sq.py (python3 sq.py triage --write < it).
        print(compose())
    elif sys.argv[1:] == ["--leftovers"]:
        print(LEFTOVERS)
    else:
        main()
