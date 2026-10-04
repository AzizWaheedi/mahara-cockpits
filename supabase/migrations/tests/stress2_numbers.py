#!/usr/bin/env python3
"""Second series, round 1, numbers and data integrity, on the live database
(Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/stress2_numbers.py

waves-members-unordered-pages: the Follow-ups page reads a wave's members
page by page (WavesCard.tsx, readAll: .range(from, to) with no .order()),
1,000 rows a request (PostgREST's max_rows on Creative Triage), and counts
them (waves.ts countMembers: booked, settled and measured per arm, the
effect line's numerators and denominators). Without an order, each page is
"rows 1,000 to 1,999 of whatever order the plan gives now". The desk's waves
run (every five minutes) moves members between states (outcomes: sent ->
closed or booked; sync: drafted -> sent), and a moved row is a new tuple:
between two page reads it can leave the page it was on and land on a later
one. The reader then counts some members twice and others never.

The check below reads the pages as PostgREST would (wave_id in (...), limit
1000 offset n, no order by), with the desk's outcomes update between the
first and second page, and compares what was read with the members there
are. Every other readAll in the cockpit orders by a unique key.

settle-alert-ignores-cockpit-mark: the sweep's S1 reads the intro's status
from the mirror (cockpit_sales_appointments, B2B's copy: HighLevel to B2B
every 15 minutes, then the cockpit's three-minute run), never the cockpit's
own marks (cockpit_sales_dispositions). A fallback room the lead opened but
never joined is "not evidence", so S1 sets settled_mark none and raises
"Mark it shown or a no-show" at the intro's start + 20 minutes, even when the
setter marked the intro shown in the dialer five minutes earlier (or the
count marked it from the lead's second room). sales-api's own settle reads
the marks and says "the call was already marked", with no alert.

Synthetic rows only: one wave (made_by stress@stress.invalid) and its
members, whose contact_id starts with 'stress-s2n-'; for the settle check,
rooms, an appointment and marks whose contact_id starts with 'stress-s2n-'
and hosts at @stress.invalid. Nothing is committed,
so the desk, the pg_cron jobs and the page never see them. A FAIL is a
finding.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import q  # noqa: E402  (the management API call with its 429 wait)

SQL = r"""
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create temp table s2_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;
create temp table s2_wave (id uuid primary key) on commit drop;
with w as (
  insert into public.cockpit_sales_followup_waves (pool, segment, per_day, holdout_share, state, made_by, note)
  values ('never_booked', 'reactivate', 40, 0.1, 'draft', 'stress@stress.invalid', 'stress2 numbers: pagination check')
  returning id
)
insert into pg_temp.s2_wave select id from w;

-- 3,000 members, as an enrolled pool looks two weeks in: a tenth held back.
insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state, event_at, due_at, sent_at)
select (select id from pg_temp.s2_wave),
       'stress-s2n-' || lpad(i::text, 5, '0'),
       case when i % 10 = 0 then 'holdout' else 'wave' end,
       case when i % 10 = 0 then 'held_out' else 'sent' end,
       now() - make_interval(days => i % 300),
       now() - interval '15 days',
       case when i % 10 = 0 then null else now() - interval '15 days' end
  from generate_series(1, 3000) as i;
analyze public.cockpit_sales_followup_wave_members;

-- The pages as PostgREST asks them: the wave ids as a literal list
-- (select=wave_id,arm,state,due_at,sent_at&wave_id=in.(...), Range n-n+999),
-- so the plan is the one the page gets (a sequential scan once one wave
-- holds most of the table), never one shaped by a subquery.
create temp table s2_read (page integer, contact_id text, state text) on commit drop;
create temp table s2_read2 (page integer, contact_id text) on commit drop;
do $$
declare
  w uuid := (select id from pg_temp.s2_wave);
  page_sql text := 'select contact_id, state from public.cockpit_sales_followup_wave_members where wave_id = any (%L::uuid[]) limit 1000 offset %s';
  ordered_sql text := 'select contact_id from public.cockpit_sales_followup_wave_members where wave_id = any (%L::uuid[]) order by contact_id limit 1000 offset %s';
begin
  execute format('insert into pg_temp.s2_read select 1, x.contact_id, x.state from (' || page_sql || ') as x', array[w], 0);
  -- The desk's outcomes run lands between the two requests: members whose
  -- 14 days ran out are closed (waves.py outcomes, sent/held_out -> closed).
  update public.cockpit_sales_followup_wave_members as m
     set state = 'closed', closed_at = now()
   where m.wave_id = w
     and m.contact_id in (select r.contact_id from pg_temp.s2_read as r where r.page = 1 order by r.contact_id limit 400);
  execute format('insert into pg_temp.s2_read select 2, x.contact_id, x.state from (' || page_sql || ') as x', array[w], 1000);
  execute format('insert into pg_temp.s2_read select 3, x.contact_id, x.state from (' || page_sql || ') as x', array[w], 2000);

  -- Control: the same pages ordered by contact_id (every other readAll in
  -- the cockpit orders by a unique key), across the same kind of update.
  execute format('insert into pg_temp.s2_read2 select 1, x.contact_id from (' || ordered_sql || ') as x', array[w], 0);
  update public.cockpit_sales_followup_wave_members as m
     set state = 'booked', booked_at = now()
   where m.wave_id = w
     and m.contact_id in (select r.contact_id from pg_temp.s2_read2 as r where r.page = 1 order by r.contact_id desc limit 400);
  execute format('insert into pg_temp.s2_read2 select 2, x.contact_id from (' || ordered_sql || ') as x', array[w], 1000);
  execute format('insert into pg_temp.s2_read2 select 3, x.contact_id from (' || ordered_sql || ') as x', array[w], 2000);
end $$;

-- What the unordered read does (the finding, kept as a record, not a check):
-- members read twice and never. Fix round 1: WavesCard orders the read by
-- wave_id and contact_id (a unique key), the read below; the card's own test
-- (stress2_numbers_ui.test.ts) pins that order.
insert into pg_temp.s2_checks (name, ok, detail)
select 'record: the unordered pages (WavesCard before fix round 1) across one desk run',
       true,
       format('rows read %s, distinct members %s, read twice %s, never read %s (of 3000)',
              count(*), count(distinct contact_id),
              count(*) - count(distinct contact_id), 3000 - count(distinct contact_id))
  from pg_temp.s2_read;
insert into pg_temp.s2_checks (name, ok, detail)
select 'waves-members-unordered-pages: the pages ordered by contact_id (as WavesCard reads them now) hold every member exactly once',
       count(*) = 3000 and count(distinct contact_id) = 3000,
       format('rows read %s, distinct members %s', count(*), count(distinct contact_id))
  from pg_temp.s2_read2;

select name, ok, detail from pg_temp.s2_checks order by n;
rollback;
"""


SETTLE_SQL = r"""
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';
-- ===== 20261004a (the repo's fix round 1, rolled back with the rest) =====
{MIG2}
create temp table s2_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

-- Two booked intros that started 25 minutes ago; the mirror still says
-- confirmed for both (B2B's 15-minute sync has not run since the marks).
insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, calendar_id, start_at, status, origin)
values ('stress-s2n-appt-marked', 'stress-s2n-lead-marked', 'intro', 'dsqmJ393Dwl9fDSbIVOI', now() - interval '25 minutes', 'confirmed', 'ghl'),
       ('stress-s2n-appt-open',   'stress-s2n-lead-open',   'intro', 'dsqmJ393Dwl9fDSbIVOI', now() - interval '25 minutes', 'confirmed', 'ghl');
-- The setter marked the first intro shown in the dialer 5 minutes ago (they
-- reached the lead by phone after the link): the cockpit's active mark.
insert into public.cockpit_sales_dispositions (appointment_id, contact_id, call_type, start_at, status, marked_by, marked_at, crm, crm_at)
values ('stress-s2n-appt-marked', 'stress-s2n-lead-marked', 'intro', now() - interval '25 minutes', 'showed',
        'setter-marked@stress.invalid', now() - interval '5 minutes', 'written', now() - interval '5 minutes');

-- Each intro's fallback room: the link went, the lead opened it, nobody
-- joined, R4 closed it (expired, no_join).
create temp table s2_rooms (name text primary key, id uuid not null) on commit drop;
with made as (
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, trigger, call_kind, provider, host_email, made_by, appointment_id, appointment_start_at,
     state, result, end_reason, join_url, provider_meeting_id, opened_at, link_sent_at, first_open_at, last_open_at, host_in_at, ended_at)
  select gen_random_uuid(), 'stress-s2n-lead-' || v.n, 'fallback', 'no_answer', 'intro', 'meet',
         'setter-' || v.n || '@stress.invalid', 'setter-' || v.n || '@stress.invalid', 'stress-s2n-appt-' || v.n,
         now() - interval '25 minutes', 'expired', 'no_join', 'lead_no_show', 'https://meet.example.invalid/' || v.n,
         'stress-s2n-evt-' || v.n, now() - interval '24 minutes', now() - interval '24 minutes', now() - interval '22 minutes',
         now() - interval '22 minutes', now() - interval '23 minutes', now() - interval '10 minutes'
    from (values ('marked'), ('open')) as v(n)
  returning id, contact_id
)
insert into pg_temp.s2_rooms (name, id) select substr(contact_id, length('stress-s2n-lead-') + 1), id from made;
update public.cockpit_sales_rooms as x set requested_at = now() - interval '24 minutes 30 seconds'
  from pg_temp.s2_rooms as r where r.id = x.id;

do $$
declare
  r jsonb;
  i integer;
begin
  for i in 1 .. 20 loop
    r := public.cockpit_sales_rooms_sweep();
    exit when not (r ? 'skipped');
    perform pg_sleep(0.5);
  end loop;
  insert into pg_temp.s2_checks (name, ok, detail)
  values ('the sweep ran here and raised no rule error', not (r ? 'skipped') and coalesce(jsonb_array_length(r -> 'errors'), 0) = 0,
          left((r -> 'errors')::text, 300));
end $$;

create function pg_temp.alerted(p_name text) returns boolean language sql as $f$
  select exists (select 1 from public.cockpit_sales_alerts as a
                   join pg_temp.s2_rooms as r on a.dedupe_key = 'room:' || r.id::text || ':mark_intro'
                  where r.name = p_name and a.resolved_at is null)
$f$;

insert into pg_temp.s2_checks (name, ok, detail) values
  ('settle-alert-ignores-cockpit-mark: the setter marked the intro shown in the dialer; the sweep must not ask a person to mark it shown or a no-show',
   not pg_temp.alerted('marked'),
   'alert raised: ' || pg_temp.alerted('marked') || coalesce('; ' || (select a.message from public.cockpit_sales_alerts as a
     join pg_temp.s2_rooms as r on a.dedupe_key = 'room:' || r.id::text || ':mark_intro' where r.name = 'marked' limit 1), '')),
  ('control: the same room for an intro nobody marked asks a person (the lead opened the link, so no no-show is written)',
   pg_temp.alerted('open'), 'alert raised: ' || pg_temp.alerted('open'));

select name, ok, detail from pg_temp.s2_checks order by n;
rollback;
"""

LEFTOVERS = r"""
select 'member ' || contact_id as what from public.cockpit_sales_followup_wave_members where contact_id like 'stress-s2n-%'
union all
select 'wave ' || id::text from public.cockpit_sales_followup_waves where made_by = 'stress@stress.invalid'
union all
select 'room ' || id::text from public.cockpit_sales_rooms where contact_id like 'stress-s2n-%'
union all
select 'appointment ' || appointment_id from public.cockpit_sales_appointments where appointment_id like 'stress-s2n-%'
union all
select 'mark ' || id::text from public.cockpit_sales_dispositions where appointment_id like 'stress-s2n-%'
union all
select 'alert ' || id::text from public.cockpit_sales_alerts where detail ->> 'code' is not null
   and (detail ->> 'room_id') in (select id::text from public.cockpit_sales_rooms where contact_id like 'stress-s2n-%')
"""


def rolled_back(sql: str) -> list:
    tx = [s.lower() for s in run_checks.top_level_statements(sql) if run_checks.TX.match(s)]
    if tx != ["begin", "rollback"]:
        sys.exit(f"Refusing to run: transaction statements {tx}.")
    return q(sql, write=True)


# The repo's 20261004a (not applied in production yet) inside the settle check's own transaction.
SETTLE_SQL = SETTLE_SQL.replace(
    "{MIG2}",
    run_checks.strip_transaction(run_checks.HARDENING_2, open(os.path.join(run_checks.MIGRATIONS, run_checks.HARDENING_2)).read()),
)


def main():
    before = q(LEFTOVERS, write=False)
    if before:
        sys.exit(f"Synthetic rows from an earlier run are still there: {[r['what'] for r in before]}. Remove them first.")
    rows = rolled_back(SQL) + rolled_back(SETTLE_SQL)
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
    main()
