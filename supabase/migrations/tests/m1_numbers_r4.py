#!/usr/bin/env python3
"""Milestone 1, video-link round 4, NUMBERS AND RECORDS, on the live database
(Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_numbers_r4.py

The repo's 20261003d and 20261004a (not applied in production yet) are
applied inside the transaction, the rooms setting is switched to the pilot's
values by a manager (m1-scope.md section 3), and then the sweep's close of a
setter's Meet room is read as sales-api's "I can't let them in" reads it
right after (rooms.ts knockAfterClose: the knock is recorded on the closed
room by PATCH ...&state=eq.expired&result=eq.no_join&lead_in_at=is.null; round 4 fix: the row as read):

  A. control: a room nobody joined, its lead's ten minutes over: the sweep
     closes it once (one room.sweep audit row), expired lead_no_show, result
     no_join, lead_in_at null, so the knock's write finds the room;
  B. the same room after "That was not the lead" (the taken-back join kept
     in lead_in_at as evidence, count_undo_at and taken_back_join_at beside
     it; cockpit_sales_room_join_stands says nobody joined): the sweep closes
     it the same way, result no_join with no join that stands, and the
     knock's write must find it too. It does not: lead_in_at is not null.
  C. a closer's Zoom room (the worker makes every meeting with the waiting
     room on for people outside the account, desk/rooms.py): someone knocked
     (lead_waiting_at), the closer let them in (lead_in), then pressed "That
     was not the lead"; the real lead never came. The room is a no-show of
     the room (lead_no_show, no_join), never "the lead knocked but was not
     let in" (not_admitted, admit_blocked): the one who knocked was let in.

A FAIL is a finding; checks named "control" pass. Synthetic rows only:
contact ids start with 'stress-m1n4-', people end with '@stress.invalid'.
Nothing is committed, so the pg_cron jobs never see the rows and no post
reaches sales-live or Slack (pg_net's queue is rolled back).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import q  # noqa: E402  (the management API call with its 429 wait)

ROOM_A = "00000000-0000-4000-8000-0000000a4a01"
ROOM_B = "00000000-0000-4000-8000-0000000a4b02"
ROOM_C = "00000000-0000-4000-8000-0000000a4c03"

CHECKS = r"""
create temp table m1n4_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('stress-m1n4-boss@stress.invalid', 'Stress Boss', 'manager', true, 'stress-m1n4')
on conflict (email) do nothing;

-- The manager names themself in the write's own transaction (round 6's settings guard).
select set_config('mahara.actor', 'stress-m1n4-boss@stress.invalid', true);
update public.cockpit_sales_settings
   set value = value || jsonb_build_object(
         'enabled', true,
         'test_only', true,
         'settle', false,
         'wrap', false,
         'count_on_join', false,
         'short_link', false,
         'providers', '{"meet": true, "zoom": true}'::jsonb,
         'send', '{"whatsapp_text": true, "whatsapp_template": true, "email": true}'::jsonb),
       updated_by = 'stress-m1n4-boss@stress.invalid', updated_at = clock_timestamp()
 where key = 'rooms';
-- Nobody named for the rest of the run.
select set_config('mahara.actor', '', true);
update public.cockpit_sales_settings
   set value = jsonb_set(jsonb_set(value, '{enabled}', 'false'), '{slack}', 'false')
 where key = 'live';

-- Two manual Meet rooms (two setters: one open room per host), opened 15 minutes ago, the link sent
-- 14 minutes ago, the host in; the lead's ten minutes and the open grace over.
insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                        join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                        link_sent_at, link_channels, host_by, lead_by, ends_at, version)
select v.id::uuid, gen_random_uuid(), v.contact, 'manual', 'intro', 'meet',
       'stress-m1n4-setter-' || v.tag || '@stress.invalid', 'stress-m1n4-setter-' || v.tag || '@stress.invalid', 'open',
       'https://meet.google.com/stress-mn4-' || v.tag, 'stress-m1n4-evt-' || v.tag,
       now() - interval '16 minutes', now() - interval '16 minutes', now() - interval '15 minutes',
       now() - interval '14 minutes', now() - interval '14 minutes', '{email}',
       now() + interval '5 minutes', now() + interval '10 minutes', now() + interval '15 minutes', 3
  from (values ('%(a)s', 'stress-m1n4-lead-a', 'aaa'), ('%(b)s', 'stress-m1n4-lead-b', 'bbb')) as v(id, contact, tag);

-- I'm in (both), as roomlogic.ts writes it.
update public.cockpit_sales_rooms set state = 'host_in', host_in_at = now() - interval '13 minutes'
 where id in ('%(a)s', '%(b)s');
-- B: The lead is in at -8 min, then That was not the lead at -7 min (roomlogic.ts notLead's patch).
update public.cockpit_sales_rooms set state = 'lead_in', lead_in_at = now() - interval '8 minutes'
 where id = '%(b)s';
update public.cockpit_sales_rooms
   set state = 'host_in', count_undo_at = now() - interval '7 minutes', taken_back_join_at = lead_in_at
 where id = '%(b)s';
-- The lead's ten minutes and the grace are over for both (lead_by passed).
update public.cockpit_sales_rooms set lead_by = now() - interval '4 minutes', host_by = now() - interval '1 minute'
 where id in ('%(a)s', '%(b)s');


-- C. A closer's Zoom room: a knock at -10 min, let in at -9 min (lead_in),
-- That was not the lead at -8 min; the real lead never came.
insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                        join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                        link_sent_at, link_channels, host_by, lead_by, ends_at, version)
values ('%(c)s', gen_random_uuid(), 'stress-m1n4-lead-c', 'fallback', 'demo', 'zoom',
        'stress-m1n4-closer-ccc@stress.invalid', 'stress-m1n4-closer-ccc@stress.invalid', 'open',
        'https://us06web.zoom.us/j/85550004444?pwd=x', '85550004444',
        now() - interval '16 minutes', now() - interval '16 minutes', now() - interval '15 minutes',
        now() - interval '14 minutes', now() - interval '14 minutes', '{email}',
        now() + interval '5 minutes', now() + interval '10 minutes', now() + interval '45 minutes', 3);
update public.cockpit_sales_rooms set state = 'host_in', host_in_at = now() - interval '13 minutes' where id = '%(c)s';
update public.cockpit_sales_rooms set lead_waiting_at = now() - interval '10 minutes' where id = '%(c)s';
update public.cockpit_sales_rooms set state = 'lead_in', lead_in_at = now() - interval '9 minutes' where id = '%(c)s';
update public.cockpit_sales_rooms
   set state = 'host_in', count_undo_at = now() - interval '8 minutes', taken_back_join_at = lead_in_at
 where id = '%(c)s';
update public.cockpit_sales_rooms set lead_by = now() - interval '4 minutes', host_by = now() - interval '1 minute'
 where id = '%(c)s';

create temp table m1n4_sweep on commit drop as select public.cockpit_sales_rooms_sweep() as out;

insert into pg_temp.m1n4_checks (name, ok, detail)
select case r.id when '%(a)s' then 'control: A, nobody joined: closed once, expired lead_no_show, no_join, no join on the row'
                 else 'B, the join taken back: closed once, expired lead_no_show, no_join, and no join that stands' end,
       r.state = 'expired' and r.end_reason = 'lead_no_show' and r.result = 'no_join'
         and not public.cockpit_sales_room_join_stands(r.lead_in_at, r.count_undo_at, r.taken_back_join_at)
         and (select count(*) from public.cockpit_audit_log as a where a.action = 'room.sweep' and a.entity_id = r.id::text) = 1,
       format('state %s, end_reason %s, result %s, lead_in_at %s, audit rows %s, sweep errors %s', r.state, r.end_reason, r.result,
              coalesce(r.lead_in_at::text, 'null'),
              (select count(*) from public.cockpit_audit_log as a where a.action = 'room.sweep' and a.entity_id = r.id::text),
              (select out -> 'errors' from pg_temp.m1n4_sweep))
  from public.cockpit_sales_rooms as r where r.id in ('%(a)s', '%(b)s')
 order by r.id;

insert into pg_temp.m1n4_checks (name, ok, detail)
select 'C, a Zoom room whose knocker was let in and taken back, the real lead never came: closed as the lead not joining, never as a knock nobody let in',
       r.state = 'expired' and r.end_reason = 'lead_no_show' and r.result = 'no_join',
       format('state %s, end_reason %s, result %s; its timeline says: %s', r.state, r.end_reason, r.result,
              (select e.text from public.cockpit_sales_room_events as e where e.room_id = r.id and e.source = 'sweep' limit 1))
  from public.cockpit_sales_rooms as r where r.id = '%(c)s';

-- The knock's write, as sales-api sends it since round 4 (rooms.ts
-- knockAfterClose: PostgREST id=eq.&state=eq.expired&result=eq.no_join
-- &version=eq.{as read}&lead_in_at={as read}, body {result: admit_blocked}):
-- guarded on the row as read, never on "no join time at all", since a join
-- That was not the lead took back keeps its time in lead_in_at.
create temp table m1n4_knock (id uuid) on commit drop;
with seen as (
  select r.id, r.version, r.lead_in_at from public.cockpit_sales_rooms as r where r.id in ('%(a)s', '%(b)s')
), k as (
  update public.cockpit_sales_rooms as r set result = 'admit_blocked'
    from seen
   where r.id = seen.id and r.state = 'expired' and r.result = 'no_join'
     and r.version = seen.version and r.lead_in_at is not distinct from seen.lead_in_at
  returning r.id
)
insert into pg_temp.m1n4_knock select id from k;

insert into pg_temp.m1n4_checks (name, ok, detail)
select 'control: A, the lead knocking right after the close: the knock is recorded on the room (admit_blocked)',
       exists (select 1 from pg_temp.m1n4_knock where id = '%(a)s'),
       (select result from public.cockpit_sales_rooms where id = '%(a)s');
insert into pg_temp.m1n4_checks (name, ok, detail)
select 'B, the real lead knocking right after the close of a room whose only join was taken back: the knock is recorded too',
       exists (select 1 from pg_temp.m1n4_knock where id = '%(b)s'),
       format('result %s (the knock''s write found %s of 1 room)', (select result from public.cockpit_sales_rooms where id = '%(b)s'),
              (select count(*) from pg_temp.m1n4_knock where id = '%(b)s'));

select name, ok, detail from pg_temp.m1n4_checks order by n;
"""

LEFTOVERS = r"""
select 'room ' || id::text as what from public.cockpit_sales_rooms where contact_id like 'stress-m1n4-%' or host_email like 'stress-m1n4-%'
union all
select 'person ' || email from public.cockpit_sales_people where email like 'stress-m1n4-%'
union all
select 'audit ' || action from public.cockpit_audit_log where metadata ->> 'by' = 'stress-m1n4-boss@stress.invalid'
   or entity_id in ('%(a)s', '%(b)s', '%(c)s')
"""


def fill(sql: str) -> str:
    return sql.replace("%(a)s", ROOM_A).replace("%(b)s", ROOM_B).replace("%(c)s", ROOM_C)


def compose() -> str:
    parts = ["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '100s';",
             "-- ===== 20261003d + 20261004a (the repo's, idempotent) =====", run_checks.hardening_sql(),
             fill(CHECKS), "rollback;"]
    sql = "\n".join(parts)
    tx = [s.lower() for s in run_checks.top_level_statements(sql) if run_checks.TX.match(s)]
    if tx != ["begin", "rollback"]:
        sys.exit(f"Refusing to run: transaction statements {tx}.")
    return sql


def main():
    before = q(fill(LEFTOVERS), write=False)
    if before:
        sys.exit(f"Synthetic rows from an earlier run are still there: {[r['what'] for r in before]}. Remove them first.")
    rows = q(compose(), write=True)
    failed = [r for r in rows if not r.get("ok")]
    for r in rows:
        print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}" + (f"  ({r.get('detail')})" if r.get("detail") else ""))
    print(f"\n{len(rows) - len(failed)} passed, {len(failed)} failed, {len(rows)} checks.")
    after = q(fill(LEFTOVERS), write=False)
    if after:
        print("LEFT BEHIND:", json.dumps([r["what"] for r in after]))
        sys.exit(1)
    print("Nothing persisted.")
    sys.exit(0 if rows and not failed else 1)


if __name__ == "__main__":
    main()
