#!/usr/bin/env python3
"""Stress round 1, numbers and data integrity, on the live database (Creative Triage).

    python3 supabase/migrations/tests/stress_numbers.py

The three migrations 20261003a, b and c are applied in production (dark:
every switch off, the tables empty). This runner proves what the SQL does
with the numbers, without leaving anything behind:

A. ONE transaction that ends in rollback (lock_timeout 5 s): synthetic
   appointments and closed rooms, then the real cockpit_sales_rooms_sweep(),
   then checks on which rooms it posted to be settled as no-shows (D14). A
   no-show is a hard number in the B2B show rate, so the sweep may only post
   one on evidence that nobody came. Nothing in A is committed, so no settle
   event ever reaches sales-api and nothing is sent anywhere.
B. Two races against committed rows: 25 count claims at once on one room
   (the guarded write rooms.ts countClaim makes), and 25 event leases at once
   on one event (cockpit_sales_room_event_lease). Exactly one of each may
   win. The room is final, its lead_in_at three hours old and it has no
   appointment, and the event's source is not one the sweep replays, so the
   live pg_cron jobs never pick them up. Both rows are deleted at the end,
   by id, and a read-only query proves none is left.

Synthetic rows only: contact ids start with 'stress-numbers-', host emails
end with '@stress.invalid', appointment ids start with 'stress-numbers-'.
Nothing writes HighLevel, Zoom, Google or Slack, and nothing is deployed.
Exit code 0 only when every check passed and nothing persisted.
"""
import concurrent.futures
import json
import os
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402  (token handling, the management API call, the transaction guard)

PREFIX = "stress-numbers-"
INTRO_CAL = "dsqmJ393Dwl9fDSbIVOI"

SETTLE_SQL = r"""
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';
-- 20261003d is applied here (the composed text below), so the run checks the repo's S1.
%(hardening)s
create temp table sn_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, calendar_id, start_at, status, origin)
values ('stress-numbers-appt-meet',  'stress-numbers-lead-1', 'intro', '%(cal)s', now() - interval '25 minutes', 'confirmed', 'ghl'),
       ('stress-numbers-appt-twin',  'stress-numbers-lead-2', 'intro', '%(cal)s', now() - interval '50 minutes', 'confirmed', 'ghl'),
       ('stress-numbers-appt-knock', 'stress-numbers-lead-3', 'intro', '%(cal)s', now() - interval '25 minutes', 'confirmed', 'ghl'),
       ('stress-numbers-appt-plain', 'stress-numbers-lead-4', 'intro', '%(cal)s', now() - interval '25 minutes', 'confirmed', 'ghl');

-- Closed fallback rooms, as the sweep leaves them.
create temp table sn_rooms (name text primary key, id uuid not null) on commit drop;
with made as (
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, trigger, call_kind, provider, host_email, made_by, appointment_id,
     state, result, end_reason, join_url, opened_at, link_sent_at, host_in_at, first_open_at, last_open_at,
     lead_waiting_at, lead_in_at, ended_at)
  values
    -- 1. Meet sends no join signal; the setter was in, the lead opened the link, nobody pressed "The lead is in".
    (gen_random_uuid(), 'stress-numbers-lead-1', 'fallback', 'no_answer', 'intro', 'meet', 's1@stress.invalid', 's1@stress.invalid',
     'stress-numbers-appt-meet', 'expired', 'no_join', 'lead_no_show', 'https://meet.google.com/abc-defg-hij',
     now() - interval '24 minutes', now() - interval '23 minutes', now() - interval '23 minutes',
     now() - interval '22 minutes', now() - interval '22 minutes', null, null, now() - interval '10 minutes'),
    -- 2a. The first link ran out with nobody in it ...
    (gen_random_uuid(), 'stress-numbers-lead-2', 'fallback', 'no_answer', 'intro', 'zoom', 's2@stress.invalid', 's2@stress.invalid',
     'stress-numbers-appt-twin', 'expired', 'no_join', 'lead_no_show', 'https://zoom.example.invalid/j/1',
     now() - interval '49 minutes', now() - interval '48 minutes', null, null, null, null, null, now() - interval '36 minutes'),
    -- 2b. ... and the lead joined the second room for the same intro (count_on_join off: nothing marked).
    (gen_random_uuid(), 'stress-numbers-lead-2', 'fallback', 'no_answer', 'intro', 'zoom', 's2b@stress.invalid', 's2b@stress.invalid',
     'stress-numbers-appt-twin', 'ended', 'joined', null, 'https://zoom.example.invalid/j/2',
     now() - interval '35 minutes', now() - interval '35 minutes', now() - interval '34 minutes',
     now() - interval '34 minutes', now() - interval '34 minutes', null, now() - interval '33 minutes', now() - interval '5 minutes'),
    -- 3. The lead knocked and was never let in: never a no-show.
    (gen_random_uuid(), 'stress-numbers-lead-3', 'fallback', 'no_answer', 'intro', 'zoom', 's3@stress.invalid', 's3@stress.invalid',
     'stress-numbers-appt-knock', 'expired', 'admit_blocked', 'not_admitted', 'https://zoom.example.invalid/j/3',
     now() - interval '24 minutes', now() - interval '23 minutes', now() - interval '23 minutes', null, null,
     now() - interval '20 minutes', null, now() - interval '10 minutes'),
    -- 4. Zoom, the link never opened, nobody came: the one that IS a no-show.
    (gen_random_uuid(), 'stress-numbers-lead-4', 'fallback', 'no_answer', 'intro', 'zoom', 's4@stress.invalid', 's4@stress.invalid',
     'stress-numbers-appt-plain', 'expired', 'no_join', 'lead_no_show', 'https://zoom.example.invalid/j/4',
     now() - interval '24 minutes', now() - interval '23 minutes', null, null, null, null, null, now() - interval '10 minutes')
  returning id, host_email
)
insert into pg_temp.sn_rooms (name, id)
select case host_email when 's1@stress.invalid' then 'meet_opened' when 's2@stress.invalid' then 'twin_empty'
                       when 's2b@stress.invalid' then 'twin_joined' when 's3@stress.invalid' then 'knocked'
                       else 'plain' end, id
  from made;
-- Each room was asked for just before it opened (a room settles only the
-- intro it was made for: 20261003d roomForThisStart).
update public.cockpit_sales_rooms as x set requested_at = x.opened_at - interval '30 seconds'
  from pg_temp.sn_rooms as r where r.id = x.id;
-- Zoom reported the plain room's meeting (its start, read by room.event):
-- only then is Zoom's silence about the lead evidence (20261003d).
insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at)
select r.id, 'zoom.meeting.started', 'zoom', 'stress-numbers-started-' || r.id::text, now() - interval '24 minutes', now() - interval '24 minutes'
  from pg_temp.sn_rooms as r where r.name = 'plain';

-- 5. An open Zoom room whose lead never came: the sweep closes it, and the close leaves an audit row.
insert into public.cockpit_sales_rooms
  (request_id, contact_id, purpose, trigger, call_kind, provider, host_email, made_by, state, join_url,
   opened_at, link_sent_at, lead_by, host_by, ends_at)
values (gen_random_uuid(), 'stress-numbers-lead-5', 'fallback', 'no_answer', 'intro', 'zoom', 's5@stress.invalid',
        's5@stress.invalid', 'open', 'https://zoom.example.invalid/j/5', now() - interval '20 minutes',
        now() - interval '19 minutes', now() - interval '9 minutes', now() + interval '10 minutes', now() + interval '10 minutes');
insert into pg_temp.sn_rooms (name, id)
select 'open_past_lead_by', id from public.cockpit_sales_rooms where host_email = 's5@stress.invalid';

-- The real sweep, in this transaction (it skips while the cron's own run holds its lock).
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
  insert into pg_temp.sn_checks (name, ok, detail)
  values ('the sweep ran here and raised no rule error', not (r ? 'skipped') and coalesce(jsonb_array_length(r -> 'errors'), 0) = 0,
          left((r -> 'errors')::text, 300));
end $$;

create function pg_temp.settle_posted(p_name text) returns boolean language sql as $$
  select exists (select 1 from public.cockpit_sales_room_events as e
                   join pg_temp.sn_rooms as r on e.room_id = r.id
                  where r.name = p_name and e.dedupe_key = 'sweep.settle:' || r.id::text)
$$;

insert into pg_temp.sn_checks (name, ok, detail) values
  ('a Meet room the lead opened with the setter in it, no press: no no-show is posted (missing is never zero)',
   not pg_temp.settle_posted('meet_opened'), 'posted: ' || pg_temp.settle_posted('meet_opened')),
  ('the lead joined a second room for the same intro: the first room posts no no-show',
   not pg_temp.settle_posted('twin_empty'), 'posted: ' || pg_temp.settle_posted('twin_empty')),
  ('the room the lead joined is never settled',
   not pg_temp.settle_posted('twin_joined'), null),
  ('a room the lead knocked on (admit_blocked) is never settled',
   not pg_temp.settle_posted('knocked'), null),
  ('a Zoom room never opened, nobody in it, 20 minutes after the intro: settled as a no-show (the rule still works)',
   pg_temp.settle_posted('plain'), null),
  ('the sweep closes a room past its lead deadline with one audit row',
   (select count(*) = 1 from public.cockpit_audit_log as a join pg_temp.sn_rooms as r on a.entity_id = r.id::text
     where r.name = 'open_past_lead_by' and a.action = 'room.sweep'),
   (select string_agg(x.state || '/' || coalesce(x.result, '-'), ',') from public.cockpit_sales_rooms as x
      join pg_temp.sn_rooms as r on r.id = x.id where r.name = 'open_past_lead_by'));

select name, ok, detail from pg_temp.sn_checks order by n;
rollback;
""" % {"cal": INTRO_CAL, "hardening": run_checks.hardening_sql()}

LEFTOVERS = r"""
select 'room ' || id::text as what from public.cockpit_sales_rooms
 where contact_id like 'stress-numbers-%' or host_email like '%@stress.invalid' and contact_id like 'stress-numbers-%'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where dedupe_key like 'stress-numbers-%'
union all
select 'appointment ' || appointment_id from public.cockpit_sales_appointments where appointment_id like 'stress-numbers-%'
union all
select 'audit ' || id::text from public.cockpit_audit_log
 where entity_type = 'cockpit_sales_rooms' and (metadata ->> 'code') is not null
   and entity_id in (select id::text from public.cockpit_sales_rooms where contact_id like 'stress-numbers-%')
"""


def q(sql: str, write: bool):
    """One statement through the management API. A 429 (the API's own throttle, before anything
    runs) is waited out and sent again; anything else is run_checks.query's answer."""
    import time
    import urllib.error
    import urllib.request
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{run_checks.REF}/database/query",
        data=json.dumps({"query": sql, "read_only": not write}).encode(),
        headers={"Authorization": f"Bearer {run_checks.token()}", "Content-Type": "application/json",
                 "User-Agent": "mahara-sales/1"},
        method="POST",
    )
    for attempt in range(12):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read() or b"null") or []
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 11:
                time.sleep(2 + attempt)
                continue
            raise SystemExit(f"The database refused the statement (HTTP {e.code}): {e.read().decode()[:600]}")
    return []


def part_a() -> list:
    tx = [s.lower() for s in run_checks.top_level_statements(SETTLE_SQL) if run_checks.TX.match(s)]
    if tx != ["begin", "rollback"]:
        sys.exit(f"Refusing to run: transaction statements {tx}.")
    return q(SETTLE_SQL, write=True)


def part_b() -> list:
    checks = []
    tag = uuid.uuid4().hex[:8]
    contact = f"{PREFIX}race-{tag}"
    host = f"race-{tag}@stress.invalid"
    made = q(f"""
      insert into public.cockpit_sales_rooms
        (request_id, contact_id, purpose, trigger, call_kind, provider, host_email, made_by, state, result,
         join_url, opened_at, host_in_at, lead_in_at, ended_at)
      values (gen_random_uuid(), '{contact}', 'manual', 'manual', 'intro', 'zoom', '{host}', '{host}', 'ended', 'joined',
              'https://zoom.example.invalid/j/9', now() - interval '4 hours', now() - interval '4 hours',
              now() - interval '3 hours', now() - interval '2 hours')
      returning id::text as id""", write=True)
    room = made[0]["id"]
    ev = q(f"""
      insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, text)
      values ('{room}', 'stress.race', 'stress', 'stress-numbers-{tag}', 'A synthetic event for a lease race.')
      returning id::text as id""", write=True)[0]["id"]
    try:
        claim = (f"update public.cockpit_sales_rooms set count_claimed_at = clock_timestamp() "
                 f"where id = '{room}' and count_claimed_at is null returning id::text as id")
        lease = f"select public.cockpit_sales_room_event_lease(p_event_id => '{ev}'::uuid, p_seconds => 30)::text as id"
        with concurrent.futures.ThreadPoolExecutor(max_workers=25) as pool:
            claims = list(pool.map(lambda _: q(claim, True), range(25)))
            leases = list(pool.map(lambda _: q(lease, True), range(25)))
        won = sum(1 for r in claims if r)
        checks.append({"name": "25 count claims at once on one room: exactly one wins", "ok": won == 1, "detail": f"{won} won"})
        held = sum(1 for r in leases if r and r[0].get("id"))
        checks.append({"name": "25 leases at once on one event: exactly one holds it", "ok": held == 1, "detail": f"{held} held"})
    finally:
        q(f"delete from public.cockpit_sales_room_events where id = '{ev}' and dedupe_key = 'stress-numbers-{tag}'", True)
        gone = q(f"delete from public.cockpit_sales_rooms where id = '{room}' and contact_id = '{contact}' "
                 f"and host_email = '{host}' returning id::text as id", True)
        checks.append({"name": "the race's two rows are deleted, and only they", "ok": len(gone) == 1, "detail": None})
    return checks


def b2b_read(sql: str) -> list:
    """One read-only statement on B2B (flwboeijllbtrufxkhts), which this build never writes."""
    import urllib.request
    req = urllib.request.Request(
        "https://api.supabase.com/v1/projects/flwboeijllbtrufxkhts/database/query",
        data=json.dumps({"query": sql, "read_only": True}).encode(),
        headers={"Authorization": f"Bearer {run_checks.token()}", "Content-Type": "application/json",
                 "User-Agent": "mahara-sales/1"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read() or b"null") or []


def part_c() -> list:
    """D25: "Live ·" calls stay out of the 60% and 75% show-rate targets. countLive books a new live
    call only on rooms.live_calendar_id (20261003d), never on an intro or demo calendar; B2B's show
    rate (b2b_window_metrics, the one show rate on every screen) counts every call on a calendar in
    its calendar_call_type_map. So the check: the live calendar is not set (no live booking can be
    made) or it is outside that map (or B2B's function filters "Live" itself)."""
    rows = q("select value ->> 'live_calendar_id' as cal from public.cockpit_sales_settings where key = 'rooms'", write=False)
    cal = (rows[0] or {}).get("cal") if rows else None
    fn = b2b_read("select pg_get_functiondef(p.oid) as def from pg_proc as p "
                  "where p.pronamespace = 'public'::regnamespace and p.proname = 'b2b_window_metrics'")
    body = (fn[0]["def"] if fn else "") or ""
    mapped = []
    if cal:
        safe = str(cal).replace("'", "''")
        mapped = b2b_read(f"select calendar_id from calendar_call_type_map where is_active and calendar_id = '{safe}'")
    apart = not cal or not mapped or ("Live" in body)
    detail = ("rooms.live_calendar_id is not set, so no live booking is made" if not cal
              else f"rooms.live_calendar_id {'is in' if mapped else 'is outside'} B2B's show-rate map")
    return [{"name": "B2B's show rate keeps live-call bookings apart from the targets (D25) before count_on_join can go on",
             "ok": apart, "detail": detail}]


def main():
    before = q(LEFTOVERS, write=False)
    if before:
        sys.exit(f"Synthetic rows from an earlier run are still there: {[r['what'] for r in before]}. Remove them first.")
    rows = part_a() + part_b() + part_c()
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
