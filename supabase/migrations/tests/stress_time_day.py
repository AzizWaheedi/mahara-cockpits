#!/usr/bin/env python3
"""TIME stress, round 2: whole days of rooms on a fake clock, the SQL itself.

    python3 supabase/migrations/tests/stress_time_day.py            # every day below
    python3 supabase/migrations/tests/stress_time_day.py thursday   # one day

Round 1 (stress_time.py) ran the sweep once over rooms set to every moment
of a day. This file runs the day itself: the sweep every minute, the
watchdog every five, on a clock that only this run moves, with the room
worker, the hosts and sales-api's settle played in between, so a rule that
is right on its own minute but wrong over a sequence of minutes (a settle
tried three times during a short outage, an alert kept until the night
resolves it, a room wrapped after its own deadlines) shows.

How it stays off every real row
  Everything runs in ONE transaction that ends in rollback, on temp copies
  (pg_temp) of the live-calls tables: rooms, room events, handovers,
  availability, appointments, people, room hosts, attempts, settings,
  status rows, alerts, messages and the audit log. The functions, the
  triggers and the presence view are the deployed 20261003a ones with
  migration 20261003d (the repo's) applied over them, each rewritten to read
  the temp tables and a fake clock (pg_temp.sim_now() for now()), with its
  own advisory-lock keys, so the minute's real sweep never waits on it. The
  watchdog's vault read and Slack post go to temp tables. The real tables
  are only read (the settings rows, to copy them, and the function text).
  Synthetic names: contacts 'stress-tday-{tag}-...', hosts '...@stress.invalid'.
  After the run, a read-only query proves nothing of it is in public.

Exit 0 only when every check passed. A FAIL is a finding: its name says what
should hold, its detail what the day did.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_checks  # noqa: E402  (query(), strip_transaction(), migration d's path)

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATION_D = os.path.join(os.path.dirname(HERE), "20261003d_live_calls_hardening.sql")
TAG = secrets.token_hex(3)
KW = timezone(timedelta(hours=3))

TABLES = ["cockpit_sales_rooms", "cockpit_sales_room_events", "cockpit_sales_live", "cockpit_sales_availability",
          "cockpit_sales_appointments", "cockpit_sales_people", "cockpit_sales_room_hosts", "cockpit_sales_attempts",
          "cockpit_sales_settings", "cockpit_sales_worker_status", "cockpit_sales_alerts", "cockpit_sales_messages",
          "cockpit_audit_log", "cockpit_sales_room_secrets",
          # 20261004a's S1 reads the cockpit's own marks (stress2, fix round 1).
          "cockpit_sales_dispositions"]
# The deployed functions the sweep, the triggers and the watchdog call (20261003a, b, c);
# migration d's text then replaces the ones it changes.
FUNCTIONS = ["cockpit_sales_setting_int", "cockpit_sales_room_code", "cockpit_sales_rooms_guard",
             "cockpit_sales_rooms_link_replaced", "cockpit_sales_live_guard", "cockpit_sales_touch_version",
             "cockpit_sales_touch_updated", "cockpit_sales_rooms_close", "cockpit_sales_live_move",
             "cockpit_sales_room_pending", "cockpit_sales_room_event_lease", "cockpit_sales_live_claim",
             "cockpit_sales_alert_hours", "cockpit_sales_alert_words", "cockpit_sales_alert_set",
             "cockpit_sales_rooms_sweep", "cockpit_sales_watchdog",
             # Migration d (applied): the worker-status trigger and the live-hours check call these.
             "cockpit_sales_worker_status_clock", "cockpit_sales_live_hours_open"]


def lit(v: str) -> str:
    return "'" + str(v).replace("'", "''") + "'"


def kw(s: str) -> datetime:
    """'2026-10-08 13:00:00' on Kuwait's clock."""
    return datetime.fromisoformat(s).replace(tzinfo=KW)


def ts(t: datetime) -> str:
    return f"'{t.isoformat()}'::timestamptz"


def contact(name: str) -> str:
    return f"stress-tday-{TAG}-{name}"


def email(name: str) -> str:
    return f"st-{TAG}-{name}@stress.invalid"


def rewrite(src: str) -> str:
    """A deployed or migration text, made to run on the temp copies and the fake clock."""
    out = src.replace("public.cockpit_", "pg_temp.cockpit_")
    out = re.sub(r"\bnow\(\)", "pg_temp.sim_now()", out)
    out = re.sub(r"(?i)\bsecurity definer\b", "", out)
    out = out.replace("hashtext('cockpit_sales_rooms_sweep')", "hashtext('stress_tday_sweep')")
    out = out.replace("hashtext(''cockpit_sales_rooms_sweep'')", "hashtext(''stress_tday_sweep'')")
    out = out.replace("hashtext('cockpit_sales_watchdog')", "hashtext('stress_tday_watchdog')")
    out = out.replace("vault.decrypted_secrets", "pg_temp.fake_vault")
    out = out.replace("net._http_response", "pg_temp.fake_http_response")
    out = out.replace("net.http_post(", "pg_temp.fake_http_post(")
    out = re.sub(r"(?im)^\s*notify\s+pgrst[^;]*;", "", out)
    return out


MIGRATION_2 = os.path.join(os.path.dirname(HERE), "20261004a_live_calls_hardening_2.sql")


def migration_d() -> str:
    """Migration d and the second series' 20261004a (fix round 1), both the repo's."""
    text = "\n".join(run_checks.strip_transaction(os.path.basename(f), open(f).read()) for f in (MIGRATION_D, MIGRATION_2))
    out = rewrite(text)
    # Grants to API roles mean nothing on temp objects; keep the text plain.
    out = re.sub(r"(?im)^\s*(revoke|grant)\s[^;]*;", "", out)
    # Nor do seat policies (they call the seat check, which is not copied).
    out = re.sub(r"(?ims)^\s*(drop|create) policy\s[^;]*;", "", out)
    # The follow-up agent's tables are not copied: 20261004a's round 5 column
    # on the openers' meta (Approve all's request) is left out of the day.
    out = re.sub(r"(?ims)^\s*(alter table|comment on column|create index if not exists [a-z_]+\s+on)\s+"
                 r"pg_temp\.cockpit_sales_followup_meta\b[^;]*;", "", out)
    if "public.cockpit_" in out or re.search(r"\bnow\(\)", out):
        raise SystemExit("Migration d still names a real table or the real clock after the rewrite.")
    return out


SETUP = r"""
set local lock_timeout = '5s';
set local statement_timeout = '115s';
set local check_function_bodies = off;
set local client_min_messages = warning;

create temp table sim_clock (t timestamptz not null) on commit drop;
insert into pg_temp.sim_clock (t) values ({t0});
create function pg_temp.sim_now() returns timestamptz language sql volatile as $f$ select t from pg_temp.sim_clock $f$;

create temp table sim_flags (api_up boolean not null, worker_on boolean not null,
                             ghl_up boolean not null default true) on commit drop;
insert into pg_temp.sim_flags values (true, true);
create temp table sim_hosts (email text primary key, auto_join boolean not null default true) on commit drop;
create temp table sim_actions (n serial primary key, at timestamptz not null, sql text not null, done boolean not null default false) on commit drop;
create temp table sim_log (t timestamptz, email text, presence text, why text, standby_live integer, live_rooms jsonb) on commit drop;
create temp table sim_sweeps (t timestamptz, out jsonb) on commit drop;
create temp table sim_checks (n serial, name text, ok boolean, detail text) on commit drop;

create temp table fake_vault (name text, decrypted_secret text) on commit drop;
insert into pg_temp.fake_vault values ('sales_alerts_slack_webhook', 'https://stress.invalid/hook');
create temp table fake_http_response (id bigint, status_code integer, error_msg text, timed_out boolean) on commit drop;
create temp table fake_posts (id bigserial primary key, at timestamptz, body jsonb) on commit drop;
-- Each post is answered 200 at once, as pg_net records a working Slack or
-- door answer (fix round 4: a post with no answer at all is pg_net's own
-- silence, which the watchdog posts again and the tick reports).
create function pg_temp.fake_http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer)
returns bigint language sql volatile as $f$
  with p as (insert into pg_temp.fake_posts (at, body) values (pg_temp.sim_now(), body) returning id)
  insert into pg_temp.fake_http_response (id, status_code, error_msg, timed_out)
  select p.id, 200, null, false from p
  returning id
$f$;
"""

CLONE = r"""
do $clone$
declare
  t text;
  r record;
  src text;
begin
  foreach t in array array[{tables}] loop
    execute format('create temp table %I (like public.%I including all) on commit drop', t, t);
  end loop;
  -- Defaults on the real clock read the fake one.
  for r in
    select c.relname, a.attname, pg_get_expr(d.adbin, d.adrelid) as def
      from pg_attrdef as d
      join pg_attribute as a on a.attrelid = d.adrelid and a.attnum = d.adnum
      join pg_class as c on c.oid = d.adrelid
     where c.relnamespace = pg_my_temp_schema() and pg_get_expr(d.adbin, d.adrelid) ~ '\mnow\(\)'
  loop
    execute format('alter table pg_temp.%I alter column %I set default %s', r.relname, r.attname,
                   regexp_replace(r.def, '\mnow\(\)', 'pg_temp.sim_now()', 'g'));
  end loop;
  -- The deployed functions, on the temp tables and the fake clock.
  for r in
    select p.oid from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (array[{functions}])
  loop
    src := pg_get_functiondef(r.oid);
    src := replace(src, 'public.cockpit_', 'pg_temp.cockpit_');
    src := regexp_replace(src, '\mnow\(\)', 'pg_temp.sim_now()', 'g');
    src := regexp_replace(src, 'SECURITY DEFINER', '', 'gi');
    src := replace(src, 'hashtext(''cockpit_sales_rooms_sweep'')', 'hashtext(''stress_tday_sweep'')');
    src := replace(src, 'hashtext(''cockpit_sales_watchdog'')', 'hashtext(''stress_tday_watchdog'')');
    src := replace(src, 'vault.decrypted_secrets', 'pg_temp.fake_vault');
    src := replace(src, 'net._http_response', 'pg_temp.fake_http_response');
    src := replace(src, 'net.http_post(', 'pg_temp.fake_http_post(');
    if src ~ 'public\.cockpit_' then
      raise exception 'A copied function still names a real table: %', left(src, 200);
    end if;
    execute src;
  end loop;
  -- The deployed triggers, on the temp tables (the audit log's immutability is left out).
  for r in
    select pg_get_triggerdef(tg.oid) as def
      from pg_trigger as tg
      join pg_class as c on c.oid = tg.tgrelid
      join pg_namespace as n on n.oid = c.relnamespace
     where n.nspname = 'public' and not tg.tgisinternal and c.relname = any (array[{tables}])
       and tg.tgname <> 'trg_cockpit_audit_log_immutable'
  loop
    src := replace(r.def, ' ON public.', ' ON pg_temp.');
    src := regexp_replace(src, 'EXECUTE FUNCTION (public\.)?cockpit_', 'EXECUTE FUNCTION pg_temp.cockpit_');
    execute src;
  end loop;
end
$clone$;
"""

SETTINGS = r"""
insert into pg_temp.cockpit_sales_settings (key, value)
select s.key, s.value from public.cockpit_sales_settings as s
 where s.key in ('rooms', 'live', 'followups', 'whatsapp_guard', 'threads');
-- Rooms and live calls on (only in this run's copy), both providers, live hours as shipped.
update pg_temp.cockpit_sales_settings
   set value = value || '{"enabled": true, "test_only": false, "providers": {"zoom": true, "meet": true}}'::jsonb
 where key = 'rooms';
update pg_temp.cockpit_sales_settings
   set value = value || '{"enabled": true, "standby": true,
     "hours": {"days": [6, 0, 1, 2, 3, 4], "from": "10:00", "to": "20:00", "tz": "Asia/Kuwait"}}'::jsonb
 where key = 'live';
"""

# The room worker, sales-api's link on worker.ready, the hosts who come into
# their standby room, and sales-api's settle, as played between sweeps.
ACTORS = r"""
create function pg_temp.sim_worker() returns void language plpgsql as $f$
begin
  if not (select f.worker_on from pg_temp.sim_flags as f) then
    return;
  end if;
  update pg_temp.cockpit_sales_rooms set state = 'creating', worker_run = 'sim' where state = 'requested';
  update pg_temp.cockpit_sales_rooms
     set state = 'open', join_url = 'https://stress.invalid/j/' || code, provider_meeting_id = 'sim-' || code
   where state = 'creating' and worker_run = 'sim';
  -- sales-api on worker.ready: the link goes, and the lead has `lead` from it (roomlogic linkDue, link_sent).
  if (select f.api_up from pg_temp.sim_flags as f) then
    update pg_temp.cockpit_sales_rooms
       set link_claimed_at = pg_temp.sim_now(), link_sent_at = pg_temp.sim_now(), link_channels = array['whatsapp_text'],
           lead_by = pg_temp.sim_now() + interval '600 seconds'
     where state in ('open', 'host_in') and contact_id is not null and purpose in ('fallback', 'manual')
       and link_sent_at is null;
  end if;
  update pg_temp.cockpit_sales_rooms as r
     set state = 'host_in'
    from pg_temp.sim_hosts as h
   where r.host_email = h.email and h.auto_join and r.state = 'open' and r.purpose = 'standby'
     and r.opened_at <= pg_temp.sim_now() - interval '30 seconds';
end
$f$;

-- sales-api's room.event for what the sweep posted (cron door), while it is up:
-- sweep.settle leases the settle event, marks the intro a no-show and
-- finishes the event; sweep.replay leases and finishes each event.
create function pg_temp.sim_api(p_out jsonb) returns void language plpgsql as $f$
declare
  rid text;
  eid text;
  rm record;
begin
  if not (select f.api_up from pg_temp.sim_flags as f) then
    return;
  end if;
  for rid in select jsonb_array_elements_text(coalesce(p_out -> 'settle', '[]')) loop
    -- HighLevel cannot be read: room.event takes the settle (a real try,
    -- counted by the lease) and gives it back for the next sweep, as
    -- rooms.ts settle() does when the contact is not read.
    if not (select f.ghl_up from pg_temp.sim_flags as f) then
      if pg_temp.cockpit_sales_room_event_lease(p_dedupe_key => 'sweep.settle:' || rid, p_seconds => 30) is not null then
        update pg_temp.cockpit_sales_room_events set lease_until = null where dedupe_key = 'sweep.settle:' || rid;
      end if;
      continue;
    end if;
    if pg_temp.cockpit_sales_room_event_lease(p_dedupe_key => 'sweep.settle:' || rid, p_seconds => 30) is not null then
      select * into rm from pg_temp.cockpit_sales_rooms where id = rid::uuid;
      update pg_temp.cockpit_sales_rooms set settled_mark = 'noshow' where id = rid::uuid and settled_mark is null;
      update pg_temp.cockpit_sales_appointments set status = 'noshow' where appointment_id = rm.appointment_id;
      update pg_temp.cockpit_sales_room_events set handled_at = pg_temp.sim_now(), lease_until = null
       where dedupe_key = 'sweep.settle:' || rid;
    end if;
  end loop;
  for eid in select jsonb_array_elements_text(coalesce(p_out -> 'replay', '[]')) loop
    if pg_temp.cockpit_sales_room_event_lease(p_event_id => eid::uuid, p_seconds => 30) is not null then
      update pg_temp.cockpit_sales_room_events set handled_at = pg_temp.sim_now(), lease_until = null where id = eid::uuid;
    end if;
  end loop;
end
$f$;

create function pg_temp.sim_observe() returns void language sql as $f$
  insert into pg_temp.sim_log (t, email, presence, why, standby_live, live_rooms)
  select pg_temp.sim_now(), h.email, p.state, p.why,
         (select count(*) from pg_temp.cockpit_sales_rooms as r
           where r.host_email = h.email and r.purpose = 'standby'
             and r.state in ('requested', 'creating', 'open', 'host_in', 'lead_in'))::integer,
         (select coalesce(jsonb_agg(jsonb_build_object('purpose', r.purpose, 'state', r.state)), '[]'::jsonb)
            from pg_temp.cockpit_sales_rooms as r
           where r.host_email = h.email and r.state in ('requested', 'creating', 'open', 'host_in', 'lead_in'))
    from pg_temp.sim_hosts as h
    left join pg_temp.cockpit_sales_presence as p on p.email = h.email
$f$;

-- One run of the day: every step a minute (or `step` seconds), actions at
-- their own second, the sweep at each step, the watchdog every 5 minutes.
create function pg_temp.sim_run(p_from timestamptz, p_to timestamptz, p_step interval) returns integer
language plpgsql as $f$
declare
  cur timestamptz := p_from;
  a record;
  o jsonb;
  steps integer := 0;
begin
  while cur <= p_to loop
    for a in select x.n, x.at, x.sql from pg_temp.sim_actions as x where x.at <= cur and not x.done order by x.at, x.n loop
      update pg_temp.sim_clock set t = a.at;
      execute a.sql;
      update pg_temp.sim_actions as x set done = true where x.n = a.n;
      perform pg_temp.sim_worker();
    end loop;
    update pg_temp.sim_clock set t = cur;
    o := pg_temp.cockpit_sales_rooms_sweep();
    insert into pg_temp.sim_sweeps (t, out) values (cur, o);
    perform pg_temp.sim_api(o);
    perform pg_temp.sim_worker();
    if extract(minute from cur)::integer % 5 = 0 and extract(second from cur)::integer = 0 then
      perform pg_temp.cockpit_sales_watchdog();
    end if;
    perform pg_temp.sim_observe();
    steps := steps + 1;
    cur := cur + p_step;
  end loop;
  return steps;
end
$f$;
"""


class Day:
    """One simulated day: its people, calls, actions, the run, and the checks."""

    def __init__(self, name: str, start: datetime, end: datetime):
        self.name, self.start, self.end = name, start, end
        self.sql: list[str] = []
        self.runs: list[tuple[datetime, datetime, int]] = []
        self.checks: list[str] = []

    # -- the world -------------------------------------------------------------
    def person(self, who: str, role: str, auto_join: bool = True) -> None:
        self.sql.append(
            "insert into pg_temp.cockpit_sales_people (email, name, role, active, ghl_user_id) values "
            f"({lit(email(who))}, 'Stress Day', {lit(role)}, true, {lit(contact(who) + '-user')});")
        self.sql.append(f"insert into pg_temp.sim_hosts (email, auto_join) values ({lit(email(who))}, {str(auto_join).lower()});")
        self.sql.append(
            "insert into pg_temp.cockpit_sales_room_hosts (email, zoom_user_id, zoom_status, google_ok) values "
            f"({lit(email(who))}, {lit(contact(who) + '-zoom')}, 'licensed', true);")

    def booked(self, appt: str, lead: str, host: str, start: datetime, kind: str = "intro", status: str = "confirmed") -> None:
        self.sql.append(
            "insert into pg_temp.cockpit_sales_appointments (appointment_id, contact_id, calendar_id, call_type, start_at, "
            f"status, assigned_user_id, origin) values ({lit(contact(appt))}, {lit(contact(lead))}, 'stress-cal', "
            f"{lit(kind)}, {ts(start)}, {lit(status)}, {lit(contact(host) + '-user')}, 'ghl');")

    def at(self, t: datetime, sql: str) -> None:
        self.sql.append(f"insert into pg_temp.sim_actions (at, sql) values ({ts(t)}, {lit(sql)});")

    def run(self, frm: datetime, to: datetime, step_s: int = 60) -> None:
        self.sql.append(f"select pg_temp.sim_run({ts(frm)}, {ts(to)}, interval '{step_s} seconds');")

    def check(self, name: str, ok: str, detail: str) -> None:
        self.sql.append(
            f"insert into pg_temp.sim_checks (name, ok, detail) values ({lit(self.name + ': ' + name)}, "
            f"coalesce(({ok}), false), coalesce(({detail})::text, 'nothing'));")

    # -- what reps and sales-api do ---------------------------------------------
    def fallback_room(self, t: datetime, host: str, lead: str, appt: str | None = None,
                      call_at: datetime | None = None) -> None:
        """rooms.ts room.create after a missed dial (sales-api inserts it requested; the worker makes it).
        `call_at`: the missed call the room followed, which createRoom stores as appointment_call_at
        when that call put the room inside the intro's window (20261004a, stress2 round 6)."""
        cols = {"request_id": "gen_random_uuid()", "contact_id": lit(contact(lead)), "purpose": "'fallback'",
                "trigger": "'no_answer'", "call_kind": "'intro'", "provider": "'zoom'", "host_email": lit(email(host)),
                "made_by": lit(email(host)), "send_on": "'open'"}
        if appt:
            cols["appointment_id"] = lit(contact(appt))
            cols["appointment_start_at"] = (f"(select a.start_at from pg_temp.cockpit_sales_appointments as a "
                                            f"where a.appointment_id = {lit(contact(appt))})")
        if call_at is not None:
            cols["appointment_call_at"] = f"{lit(call_at.isoformat())}::timestamptz"
        self.at(t, f"insert into pg_temp.cockpit_sales_rooms ({', '.join(cols)}) values ({', '.join(cols.values())})")

    def host_in(self, t: datetime, host: str) -> None:
        """The host joins; Zoom reports the meeting's start and room.event reads it
        (a Zoom room's silence about the lead is evidence only then, 20261003d)."""
        self.at(t, "insert into pg_temp.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at) "
                   "select r.id, 'zoom.meeting.started', 'zoom', 'stress-tday-started-' || r.id::text, pg_temp.sim_now(), "
                   f"pg_temp.sim_now() from pg_temp.cockpit_sales_rooms as r where r.host_email = {lit(email(host))} "
                   "and r.state = 'open' and r.provider = 'zoom'")
        self.at(t, "update pg_temp.cockpit_sales_rooms set state = 'host_in' "
                   f"where host_email = {lit(email(host))} and state = 'open'")

    def lead_opens(self, t: datetime, lead: str) -> None:
        """The door's counted open (door.ts OPEN_COLUMNS)."""
        self.at(t, "update pg_temp.cockpit_sales_rooms set first_open_at = coalesce(first_open_at, pg_temp.sim_now()), "
                   f"last_open_at = pg_temp.sim_now() where contact_id = {lit(contact(lead))} "
                   "and state in ('open', 'host_in')")

    def lead_joins(self, t: datetime, lead: str) -> None:
        """Zoom's participant_joined, read by room.event at once."""
        self.at(t, "update pg_temp.cockpit_sales_rooms set state = 'lead_in' "
                   f"where contact_id = {lit(contact(lead))} and state in ('open', 'host_in')")

    def available(self, t: datetime, host: str, until: datetime, kind: str = "demo") -> None:
        """rooms.ts live.availability {state: available}: the row, then a standby room."""
        self.at(t, "insert into pg_temp.cockpit_sales_availability (email, state, until, via, reason) values "
                   f"({lit(email(host))}, 'available', {ts(until)}, 'cockpit', null) "
                   "on conflict (email) do update set state = excluded.state, until = excluded.until, "
                   "via = excluded.via, reason = null")
        self.at(t, "insert into pg_temp.cockpit_sales_rooms (request_id, purpose, call_kind, provider, host_email, made_by) "
                   f"values (gen_random_uuid(), 'standby', {lit(kind)}, 'zoom', {lit(email(host))}, {lit(email(host))})")

    def wrap(self, t: datetime, host: str, lead: str, appt: str, start: datetime, end: datetime, kind: str = "demo") -> None:
        """rooms.ts room.wrap as wrapPlan and wrapRoomRow write it: inserted open with the
        booked call's own link, host_by start + 15 min, lead_by start + 20 min, ends_at its end."""
        self.at(t, "insert into pg_temp.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, "
                   "made_by, appointment_id, send_on, state, opened_at, join_url, provider_meeting_id, host_by, lead_by, ends_at) "
                   f"values (gen_random_uuid(), {lit(contact(lead))}, 'booked', {lit(kind)}, 'zoom', {lit(email(host))}, "
                   f"{lit(email(host))}, {lit(contact(appt))}, 'open', 'open', pg_temp.sim_now(), "
                   "'https://us06web.zoom.us/j/81234567890?pwd=stress', '81234567890', "
                   f"{ts(start + timedelta(minutes=15))}, {ts(start + timedelta(minutes=20))}, {ts(end)})")

    def api(self, t: datetime, up: bool) -> None:
        self.at(t, f"update pg_temp.sim_flags set api_up = {str(up).lower()}")

    def ghl(self, t: datetime, up: bool) -> None:
        """HighLevel readable or not (sales-api is up and answers, but releases the settle)."""
        self.at(t, f"update pg_temp.sim_flags set ghl_up = {str(up).lower()}")


# ---------------------------------------------------------------------------
# Thursday 8 October 2026 (Kuwait), 09:00 to Friday 00:15
# ---------------------------------------------------------------------------

def thursday() -> Day:
    d = Day("Thursday", kw("2026-10-08 09:00:00"), kw("2026-10-09 00:15:00"))
    for who, role in (("setter", "setter"), ("closer-d", "closer"), ("closer-e", "closer"), ("closer-c", "closer"),
                      ("closer-f", "closer")):
        d.person(who, role)

    # A. A booked intro at 13:00: the setter rings at 12:58, no answer, sends a
    # video link; the lead never opens it. The room closes at 13:09; the intro
    # is due to be settled a no-show at start + 20 min. sales-api (or the cron
    # door) is down for four minutes from 13:20:30, a deploy.
    d.booked("appt-a", "lead-a", "setter", kw("2026-10-08 13:00:00"))
    d.fallback_room(kw("2026-10-08 12:58:00"), "setter", "lead-a", "appt-a")
    d.host_in(kw("2026-10-08 12:58:40"), "setter")
    d.api(kw("2026-10-08 13:20:30"), False)
    d.api(kw("2026-10-08 13:24:30"), True)
    # A0. The same at 14:00 with sales-api up throughout (the control).
    d.booked("appt-a0", "lead-a0", "setter", kw("2026-10-08 14:00:00"))
    d.fallback_room(kw("2026-10-08 13:58:00"), "setter", "lead-a0", "appt-a0")
    d.host_in(kw("2026-10-08 13:58:40"), "setter")

    # B. A second booked intro, at 16:00, and HighLevel unreadable from its
    # settle time for 15 minutes (16:20:30 to 16:35:30): sales-api takes the
    # settle every minute and gives it back (ten real tries), so the sweep
    # gives it up, and a person is told which intro to mark.
    d.person("setter-b", "setter")
    d.booked("appt-b", "lead-b", "setter-b", kw("2026-10-08 16:00:00"))
    d.fallback_room(kw("2026-10-08 15:58:00"), "setter-b", "lead-b", "appt-b")
    d.host_in(kw("2026-10-08 15:58:40"), "setter-b")
    d.ghl(kw("2026-10-08 16:20:30"), False)
    d.ghl(kw("2026-10-08 16:35:30"), True)
    # B2. A third booked intro at 18:00 and the same outage at its settle time:
    # the day's give-up alert, posted after B, is posted again with its new count.
    d.person("setter-b2", "setter")
    d.booked("appt-b2", "lead-b2", "setter-b2", kw("2026-10-08 18:00:00"))
    d.fallback_room(kw("2026-10-08 17:58:00"), "setter-b2", "lead-b2", "appt-b2")
    d.host_in(kw("2026-10-08 17:58:40"), "setter-b2")
    d.ghl(kw("2026-10-08 18:20:30"), False)
    d.ghl(kw("2026-10-08 18:35:30"), True)

    # C. The closer's booked demo at 15:00 (45 minutes). The lead is late and the
    # closer wraps the call in a room at 15:21, inside the call (room.wrap
    # accepts it until the call's end).
    d.booked("appt-c", "lead-c", "closer-c", kw("2026-10-08 15:00:00"), kind="demo")
    d.wrap(kw("2026-10-08 15:21:00"), "closer-c", "lead-c", "appt-c", kw("2026-10-08 15:00:00"), kw("2026-10-08 15:45:00"))
    # C2. A booked demo at 17:00 wrapped at 17:14:40; the closer gets in at 17:15:20.
    d.booked("appt-c2", "lead-c2", "closer-f", kw("2026-10-08 17:00:00"), kind="demo")
    d.wrap(kw("2026-10-08 17:14:40"), "closer-f", "lead-c2", "appt-c2", kw("2026-10-08 17:00:00"), kw("2026-10-08 17:45:00"))
    d.at(kw("2026-10-08 17:15:20"), "update pg_temp.cockpit_sales_rooms set state = 'host_in' "
                                    f"where host_email = {lit(email('closer-f'))} and purpose = 'booked' and state = 'open'")

    # D. A closer Available 10:00 to 12:00 with a booked demo at 11:20.
    d.booked("appt-d", "lead-d", "closer-d", kw("2026-10-08 11:20:00"), kind="demo")
    d.available(kw("2026-10-08 10:00:00"), "closer-d", kw("2026-10-08 12:00:00"))
    # E. A closer Available 13:00 to 15:00 with nothing booked: a standby room
    # all along, made fresh every 35 minutes.
    d.available(kw("2026-10-08 13:00:00"), "closer-e", kw("2026-10-08 15:00:00"))
    # F. The same closer Available again at 19:10, capped at the window's end (20:00).
    d.available(kw("2026-10-08 19:10:00"), "closer-e", kw("2026-10-08 20:00:00"))

    # G. A lead opening the link one second before, and one second after,
    # lead_by, then joining before the room's last second (16:00 and 16:30).
    d.fallback_room(kw("2026-10-08 16:00:00"), "setter", "lead-g1")
    d.host_in(kw("2026-10-08 16:00:30"), "setter")
    d.lead_opens(kw("2026-10-08 16:09:59"), "lead-g1")
    d.lead_joins(kw("2026-10-08 16:12:58"), "lead-g1")
    d.at(kw("2026-10-08 16:20:00"), "update pg_temp.cockpit_sales_rooms set state = 'ended', result = 'joined', "
                                    f"end_reason = 'finished' where contact_id = {lit(contact('lead-g1'))} and state = 'lead_in'")
    d.fallback_room(kw("2026-10-08 16:30:00"), "setter", "lead-g2")
    d.host_in(kw("2026-10-08 16:30:30"), "setter")
    d.lead_opens(kw("2026-10-08 16:40:01"), "lead-g2")
    d.lead_joins(kw("2026-10-08 16:43:00"), "lead-g2")
    d.at(kw("2026-10-08 16:50:00"), "update pg_temp.cockpit_sales_rooms set state = 'ended', result = 'joined', "
                                    f"end_reason = 'finished' where contact_id = {lit(contact('lead-g2'))} and state = 'lead_in'")
    # G3. Zoom's join at 17:43:59 is stored but room.event has not read it when
    # the 17:44:00 sweep runs (the door's forward is in flight); read at 17:44:05.
    d.fallback_room(kw("2026-10-08 17:30:00"), "setter", "lead-g3")
    d.host_in(kw("2026-10-08 17:30:30"), "setter")
    d.lead_opens(kw("2026-10-08 17:40:30"), "lead-g3")
    d.at(kw("2026-10-08 17:43:59"),
         "insert into pg_temp.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at) "
         "select r.id, 'zoom.meeting.participant_joined', 'zoom', 'stress-tday-g3-join', pg_temp.sim_now() "
         f"from pg_temp.cockpit_sales_rooms as r where r.contact_id = {lit(contact('lead-g3'))} and r.state = 'host_in'")
    d.at(kw("2026-10-08 17:44:05"),
         "update pg_temp.cockpit_sales_rooms set state = 'lead_in' "
         f"where contact_id = {lit(contact('lead-g3'))} and state in ('open', 'host_in')")
    d.at(kw("2026-10-08 17:44:05"),
         "update pg_temp.cockpit_sales_room_events set handled_at = pg_temp.sim_now() where dedupe_key = 'stress-tday-g3-join'")

    # H. Across midnight: a room at 23:57, its lead joins at 00:06:59 (lead_by 00:07:00).
    d.fallback_room(kw("2026-10-08 23:57:00"), "setter", "lead-h")
    d.host_in(kw("2026-10-08 23:57:30"), "setter")
    d.lead_joins(kw("2026-10-09 00:06:59"), "lead-h")

    d.run(d.start, d.end)

    room = lambda lead: f"(select r from pg_temp.cockpit_sales_rooms as r where r.contact_id = {lit(contact(lead))} order by r.requested_at limit 1)"  # noqa: E731
    rstate = lambda lead: (f"(select r.state || '/' || coalesce(r.end_reason, '-') || '/' || coalesce(r.result, '-') || "  # noqa: E731
                           f"' settled=' || coalesce(r.settled_mark, '-') from pg_temp.cockpit_sales_rooms as r "
                           f"where r.contact_id = {lit(contact(lead))} order by r.requested_at limit 1)")
    settle_ev = lambda lead: (f"(select coalesce(e.handled_at::text, 'open') || ' tries=' || e.tries || ' gave_up=' || "  # noqa: E731
                              f"coalesce(e.detail ->> 'gave_up', '-') from pg_temp.cockpit_sales_room_events as e "
                              f"join pg_temp.cockpit_sales_rooms as r on r.id = e.room_id "
                              f"where r.contact_id = {lit(contact(lead))} and e.source = 'settle')")
    appt_status = lambda appt: (f"(select a.status from pg_temp.cockpit_sales_appointments as a "  # noqa: E731
                                f"where a.appointment_id = {lit(contact(appt))})")

    d.check("A0 control: sales-api up, the empty room's booked intro is settled a no-show at start + 21 min",
            f"{appt_status('appt-a0')} = 'noshow'",
            f"{rstate('lead-a0')} || ' appt=' || {appt_status('appt-a0')} || ' event: ' || coalesce({settle_ev('lead-a0')}, 'none')")
    d.check("A a four-minute sales-api outage at the settle time does not lose the no-show: the intro is settled "
            "once sales-api is back (or a person is told to mark it)",
            f"{appt_status('appt-a')} = 'noshow' or exists (select 1 from pg_temp.cockpit_sales_alerts as a "
            f"where a.kind = 'room_mark_intro' and a.detail ->> 'room_id' = ({room('lead-a')}).id::text)",
            f"{rstate('lead-a')} || ' appt=' || {appt_status('appt-a')} || ' event: ' || coalesce({settle_ev('lead-a')}, 'none')")

    d.check("A a four-minute outage uses none of the settle's tries: nothing is given up before 16:00 "
            "(a try is counted when room.event takes the settle, never when the sweep only picks it)",
            "not exists (select 1 from pg_temp.cockpit_sales_room_events as e where e.detail ? 'gave_up' "
            f"and e.handled_at < {ts(kw('2026-10-08 16:00:00'))})",
            "(select string_agg(e.dedupe_key || ' tries=' || e.tries, '; ') from pg_temp.cockpit_sales_room_events as e "
            f"where e.detail ? 'gave_up' and e.handled_at < {ts(kw('2026-10-08 16:00:00'))})")
    d.check("B a settle given up after ten real tries (HighLevel unreadable for 15 minutes) leaves settled_mark none "
            "and a 'mark this intro' alert naming the room, posted to #sales-alerts in working hours",
            f"({room('lead-b')}).settled_mark = 'none' and exists (select 1 from pg_temp.cockpit_sales_alerts as a "
            f"where a.kind = 'room_mark_intro' and a.detail ->> 'room_id' = ({room('lead-b')}).id::text) "
            "and exists (select 1 from pg_temp.fake_posts as p where p.body ->> 'text' ~* 'could not be written' "
            f"and p.at > {ts(kw('2026-10-08 16:20:00'))} and p.at <= {ts(kw('2026-10-08 17:00:00'))})",
            f"{rstate('lead-b')} || ' event: ' || coalesce({settle_ev('lead-b')}, 'none') || ' posts: ' || "
            "(select string_agg(to_char(p.at at time zone 'Asia/Kuwait', 'HH24:MI') || ' ' || left(p.body ->> 'text', 70), ' | ') "
            "from pg_temp.fake_posts as p)")
    d.check("B2 the day's give-up alert is posted again when its count rises after the first post (16:3x, then 18:3x)",
            "(select count(*) from pg_temp.fake_posts as p where p.body ->> 'text' ~* 'given up today' "
            f"and p.at <= {ts(kw('2026-10-08 21:00:00'))}) >= 2",
            "(select string_agg(to_char(p.at at time zone 'Asia/Kuwait', 'HH24:MI') || ' ' || left(p.body ->> 'text', 50), ' | ') "
            "from pg_temp.fake_posts as p where p.body ->> 'text' ~* 'given up today') || ' alert: ' || "
            "(select string_agg(a.dedupe_key || ' detail=' || (a.detail ->> 'count') || ' posted ' || "
            "coalesce(to_char(a.posted_at at time zone 'Asia/Kuwait', 'HH24:MI'), 'never'), '; ') "
            "from pg_temp.cockpit_sales_alerts as a where a.kind = 'room_events_gave_up')")

    d.check("C a booked demo wrapped 21 minutes in (room.wrap accepts it until the call's end) still has a room "
            "a minute later: the sweep did not close it on deadlines that had passed before it was made",
            f"exists (select 1 from pg_temp.sim_log as l where l.email = {lit(email('closer-c'))} "
            f"and l.t = {ts(kw('2026-10-08 15:22:00'))} and l.live_rooms @> '[{{\"purpose\": \"booked\"}}]')",
            f"{rstate('lead-c')} || ' ended ' || coalesce(to_char(({room('lead-c')}).ended_at at time zone 'Asia/Kuwait', 'HH24:MI:SS'), '-')")
    d.check("C2 a booked demo wrapped at 17:14:40, the closer in at 17:15:20: the room stands",
            f"({room('lead-c2')}).state = 'host_in' or ({room('lead-c2')}).end_reason = 'lead_no_show'",
            rstate("lead-c2"))

    d_av = lit(email("closer-d"))
    d.check("D never a standby room while the closer's booked demo is near or running (11:10 to 12:05)",
            f"not exists (select 1 from pg_temp.sim_log as l where l.email = {d_av} and l.standby_live > 0 "
            f"and l.t >= {ts(kw('2026-10-08 11:10:00'))} and l.t < {ts(kw('2026-10-08 12:05:00'))})",
            f"(select string_agg(to_char(l.t at time zone 'Asia/Kuwait', 'HH24:MI'), ' ') from pg_temp.sim_log as l "
            f"where l.email = {d_av} and l.standby_live > 0 and l.t >= {ts(kw('2026-10-08 11:10:00'))} "
            f"and l.t < {ts(kw('2026-10-08 12:05:00'))})")
    d.check("D the closer is never offered as ready or available from 10 minutes before the demo to its end",
            f"not exists (select 1 from pg_temp.sim_log as l where l.email = {d_av} and l.presence in ('ready', 'available') "
            f"and l.t >= {ts(kw('2026-10-08 11:10:00'))} and l.t < {ts(kw('2026-10-08 12:05:00'))})",
            f"(select string_agg(to_char(l.t at time zone 'Asia/Kuwait', 'HH24:MI') || '=' || l.presence || '/' || coalesce(l.why, '-'), ' ') "
            f"from pg_temp.sim_log as l where l.email = {d_av} and l.presence in ('ready', 'available') "
            f"and l.t >= {ts(kw('2026-10-08 11:10:00'))} and l.t < {ts(kw('2026-10-08 12:05:00'))})")

    e_av = lit(email("closer-e"))
    d.check("E two hours Available with nothing booked: never two standby rooms at once",
            f"not exists (select 1 from pg_temp.sim_log as l where l.email = {e_av} and l.standby_live > 1)",
            f"(select max(l.standby_live) from pg_temp.sim_log as l where l.email = {e_av})")
    d.check("E ready (in a standby room) every minute from 13:02 to 14:59 but the minute of each refresh",
            f"(select count(*) from pg_temp.sim_log as l where l.email = {e_av} and l.presence <> 'ready' "
            f"and l.t >= {ts(kw('2026-10-08 13:02:00'))} and l.t < {ts(kw('2026-10-08 15:00:00'))}) <= 3",
            f"(select string_agg(to_char(l.t at time zone 'Asia/Kuwait', 'HH24:MI') || '=' || coalesce(l.presence, '-'), ' ') "
            f"from pg_temp.sim_log as l where l.email = {e_av} and l.presence <> 'ready' "
            f"and l.t >= {ts(kw('2026-10-08 13:02:00'))} and l.t < {ts(kw('2026-10-08 15:00:00'))})")
    d.check("E a standby room every 35 minutes (13:00, 13:35, 14:10, 14:45), the last closed when Available ends at 15:00",
            f"(select count(*) from pg_temp.cockpit_sales_rooms as r where r.host_email = {e_av} and r.purpose = 'standby' "
            f"and r.requested_at < {ts(kw('2026-10-08 15:00:00'))}) = 4 and not exists (select 1 from pg_temp.sim_log as l "
            f"where l.email = {e_av} and l.standby_live > 0 and l.t > {ts(kw('2026-10-08 15:01:00'))} "
            f"and l.t < {ts(kw('2026-10-08 19:10:00'))})",
            f"(select string_agg(to_char(r.requested_at at time zone 'Asia/Kuwait', 'HH24:MI:SS') || '-' || "
            f"coalesce(to_char(r.ended_at at time zone 'Asia/Kuwait', 'HH24:MI:SS'), 'open') || ' ' || coalesce(r.end_reason, '-'), ', ' "
            f"order by r.requested_at) from pg_temp.cockpit_sales_rooms as r where r.host_email = {e_av} and r.purpose = 'standby')")
    d.check("F Available at 19:10 (until 20:00): no standby room after 20:01, and the closer is away after 20:00",
            f"not exists (select 1 from pg_temp.sim_log as l where l.email = {e_av} and (l.standby_live > 0 or l.presence <> 'away') "
            f"and l.t > {ts(kw('2026-10-08 20:01:00'))})",
            f"(select string_agg(to_char(l.t at time zone 'Asia/Kuwait', 'HH24:MI') || '=' || coalesce(l.presence, '-') || '/' || l.standby_live, ' ') "
            f"from pg_temp.sim_log as l where l.email = {e_av} and (l.standby_live > 0 or l.presence <> 'away') "
            f"and l.t > {ts(kw('2026-10-08 20:01:00'))})")

    for lead, label in (("lead-g1", "G1 opened a second before lead_by, joined at 16:12:58"),
                        ("lead-g2", "G2 opened a second after lead_by, joined at 16:43:00"),
                        ("lead-g3", "G3 Zoom's join stored a second before the sweep, read five seconds after it"),
                        ("lead-h", "H across Kuwait's midnight, joined a second before lead_by")):
        d.check(f"{label}: the room reached lead_in and was never closed as a no-show",
                f"({room(lead)}).lead_in_at is not null and coalesce(({room(lead)}).end_reason, '-') <> 'lead_no_show'",
                rstate(lead))
    d.check("No sweep in the day reported a failing rule",
            "not exists (select 1 from pg_temp.sim_sweeps as s where jsonb_array_length(coalesce(s.out -> 'errors', '[]')) > 0 "
            "or s.out ? 'skipped')",
            "(select string_agg(to_char(s.t at time zone 'Asia/Kuwait', 'HH24:MI') || ' ' || coalesce(s.out ->> 'skipped', (s.out -> 'errors')::text), '; ') "
            "from pg_temp.sim_sweeps as s where jsonb_array_length(coalesce(s.out -> 'errors', '[]')) > 0 or s.out ? 'skipped')")
    return d


# ---------------------------------------------------------------------------
# Friday 9 October 10:55 to Saturday 10 October 09:35 (Kuwait)
# ---------------------------------------------------------------------------

def friday() -> Day:
    """Booked intros happen on Fridays (41 in the last 120 days). The watchdog
    posts from 09:00 to 21:00, Saturday to Thursday."""
    d = Day("Friday", kw("2026-10-09 10:55:00"), kw("2026-10-10 09:35:00"))
    d.person("setter", "setter")
    d.booked("appt-fri", "lead-fri", "setter", kw("2026-10-09 11:00:00"))
    d.fallback_room(kw("2026-10-09 10:58:00"), "setter", "lead-fri", "appt-fri")
    d.host_in(kw("2026-10-09 10:58:40"), "setter")
    # HighLevel unreadable from the settle time for 15 minutes: ten real tries, then given up.
    d.ghl(kw("2026-10-09 11:20:30"), False)
    d.ghl(kw("2026-10-09 11:35:30"), True)
    d.run(d.start, kw("2026-10-09 11:40:00"))
    d.run(kw("2026-10-09 11:45:00"), d.end, step_s=300)

    d.check("the settle event of Friday's intro was given up after ten real tries (the setup of the next check)",
            "exists (select 1 from pg_temp.cockpit_sales_room_events as e where e.source = 'settle' and e.detail ? 'gave_up')",
            "(select string_agg(e.dedupe_key || ' tries=' || e.tries || ' ' || coalesce(e.detail ->> 'gave_up', 'not given up'), '; ') "
            "from pg_temp.cockpit_sales_room_events as e where e.source = 'settle')")
    d.check("a room event given up on a Friday reaches #sales-alerts by Saturday 09:35 (the watchdog's first working run): "
            "the day's alert is not resolved at midnight before it was posted, and the room's own alert is posted too",
            "exists (select 1 from pg_temp.fake_posts as p where p.body ->> 'text' ~* 'given up' "
            f"and p.at >= {ts(kw('2026-10-10 09:00:00'))}) "
            "and exists (select 1 from pg_temp.fake_posts as p where p.body ->> 'text' ~* 'could not be written' "
            f"and p.at >= {ts(kw('2026-10-10 09:00:00'))})",
            "(select string_agg(a.dedupe_key || ' raised ' || to_char(a.raised_at at time zone 'Asia/Kuwait', 'Dy HH24:MI') || "
            "' resolved ' || coalesce(to_char(a.resolved_at at time zone 'Asia/Kuwait', 'Dy HH24:MI'), 'no') || ' posted ' || "
            "coalesce(to_char(a.posted_at at time zone 'Asia/Kuwait', 'Dy HH24:MI'), 'never'), '; ') "
            "from pg_temp.cockpit_sales_alerts as a where a.kind = 'room_events_gave_up') || ' posts=' || "
            "(select count(*) from pg_temp.fake_posts)")
    return d


DAYS = {"thursday": thursday, "friday": friday}


def compose(day: Day) -> str:
    q = lambda xs: ", ".join(lit(x) for x in xs)  # noqa: E731
    parts = ["begin;",
             SETUP.replace("{t0}", ts(day.start)),
             CLONE.replace("{tables}", q(TABLES)).replace("{functions}", q(FUNCTIONS)),
             "-- ===== 20261003d (the repo's), on the temp copies and the fake clock =====",
             migration_d(),
             SETTINGS,
             ACTORS,
             *day.sql,
             "select name, ok, detail from pg_temp.sim_checks order by n;",
             "rollback;"]
    return "\n".join(parts)


LEFTOVERS = f"""
select 'room ' || host_email as what from public.cockpit_sales_rooms where host_email like 'st-{TAG}-%' or contact_id like 'stress-tday-{TAG}-%'
union all select 'event ' || dedupe_key from public.cockpit_sales_room_events where dedupe_key like 'stress-tday-%'
union all select 'person ' || email from public.cockpit_sales_people where email like 'st-{TAG}-%'
union all select 'appointment ' || appointment_id from public.cockpit_sales_appointments where appointment_id like 'stress-tday-{TAG}-%'
union all select 'availability ' || email from public.cockpit_sales_availability where email like 'st-{TAG}-%'
union all select 'alert ' || dedupe_key from public.cockpit_sales_alerts where message like '%stress%' and raised_at > now() - interval '1 hour'
"""


def main() -> None:
    names = sys.argv[1:] or list(DAYS)
    failed_total = 0
    for name in names:
        day = DAYS[name]()
        rows = run_checks.query(compose(day), write=True) or []
        failed = [r for r in rows if not r.get("ok")]
        failed_total += len(failed) + (0 if rows else 1)
        print(f"== {day.name} (run tag {TAG}): {len(rows) - len(failed)} passed, {len(failed)} failed")
        for r in rows:
            print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}  ({r.get('detail')})")
    left = run_checks.query(LEFTOVERS, False) or []
    if left:
        print("LEFT BEHIND after the rollback:", [x["what"] for x in left])
        sys.exit(2)
    print("Nothing persisted: the run used temp copies only and rolled back.")
    sys.exit(0 if not failed_total else 1)


if __name__ == "__main__":
    main()
