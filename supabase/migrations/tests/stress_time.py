#!/usr/bin/env python3
"""TIME stress for the room sweep, on the live Creative Triage tables, rolled back.

    python3 supabase/migrations/tests/stress_time.py

Every scenario is one synthetic room (contact_id 'stress-time-{tag}-{name}',
host_email 'st-{tag}-{name}@stress.invalid') whose times are set to where a
room would be N seconds into its life, so one run of the sweep sees a whole
day of rooms at once: one second before and one second after every deadline,
holds, graces and caps, the standby refresh, the booked guard, the settle
of a booked intro and the offer's end. The sweep is the deployed
cockpit_sales_rooms_sweep() itself, copied into pg_temp with three changes
only: it reads its two settings from a temp table (rooms and providers on,
so the standby refresh can be seen; the real settings row is never
touched), it writes its status row to a temp table, and it takes its own
advisory lock (so it never makes the minute's real sweep skip).

Everything runs in ONE transaction that ends in rollback: no row this run
makes survives it (no room, event, appointment, person, audit row). The
script checks that afterwards, read only.

Exit 0 only when every check passed. A failing check is a finding: its name
says the rule, its detail what the sweep did.
"""
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_checks  # noqa: E402  (migration d's text, without its own transaction)

REF = "bldgtotkfmhoxmlzowdx"
HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATION = os.path.join(os.path.dirname(HERE), "20261003d_live_calls_hardening.sql")


def token() -> str:
    t = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if t:
        return t
    path = os.path.expanduser("~/.config/mahara/sb_mgmt_token")
    if not os.path.exists(path):
        sys.exit("No management token: set SUPABASE_ACCESS_TOKEN or write it to ~/.config/mahara/sb_mgmt_token.")
    return open(path).read().strip()


def query(sql: str, write: bool):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": sql, "read_only": not write}).encode(),
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json", "User-Agent": "mahara-sales/1"},
        method="POST",
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            raise SystemExit(f"The database refused the run (HTTP {e.code}): {e.read().decode()[:3000]}")
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as e:
            reason = getattr(e, "reason", e)
            early = isinstance(reason, (ConnectionResetError, ConnectionRefusedError))
            if attempt == 2 or (write and not early):
                raise SystemExit(f"Could not finish the call: {reason}. Nothing was committed (the run rolls back).")
            time.sleep(3 * (attempt + 1))


TAG = secrets.token_hex(4)


def cid(name: str) -> str:
    return f"stress-time-{TAG}-{name}"


def host(name: str) -> str:
    return f"st-{TAG}-{name}@stress.invalid"


def lit(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


def ago(s: int) -> str:
    return f"now() - interval '{s} seconds'" if s >= 0 else f"now() + interval '{-s} seconds'"


def ahead(s: int) -> str:
    return ago(-s)


JOIN = "'https://stress.invalid/j/123456789'"

# ---------------------------------------------------------------------------
# Scenarios: name -> the room's columns as SQL expressions
# ---------------------------------------------------------------------------

ROOMS: dict[str, dict[str, str]] = {}
EXTRA: list[str] = []
CHECKS: list[tuple[str, str, str]] = []  # (name, ok expression, detail expression), each over `r` = the room


def room(name: str, *, lead: bool = True, **cols: str) -> None:
    base = {
        "request_id": "gen_random_uuid()",
        "contact_id": lit(cid(name)) if lead else "null",
        "purpose": "'fallback'",
        "call_kind": "'intro'",
        "provider": "'zoom'",
        "host_email": lit(host(name)),
        "made_by": "'stress-time'",
    }
    base.update(cols)
    ROOMS[name] = base


def check(name: str, room_name: str, ok: str, detail: str = "r.state || '/' || coalesce(r.end_reason, '-') || '/' || coalesce(r.result, '-')") -> None:
    CHECKS.append((name, ok.replace("{H}", lit(host(room_name))).replace("{C}", lit(cid(room_name))),
                   detail.replace("{H}", lit(host(room_name))).replace("{C}", lit(cid(room_name))), room_name))


def appointment(name: str, start: str, status: str = "confirmed", call_type: str = "demo") -> None:
    """A booked call for the room `name`'s host (who becomes a closer with a HighLevel user)."""
    EXTRA.append(
        "insert into public.cockpit_sales_people (email, name, role, active, ghl_user_id) values "
        f"({lit(host(name))}, 'Stress Time', 'closer', true, {lit(cid(name) + '-user')});")
    EXTRA.append(
        "insert into public.cockpit_sales_appointments (appointment_id, contact_id, calendar_id, call_type, start_at, "
        "status, assigned_user_id, origin) values "
        f"({lit(cid(name) + '-appt')}, {lit(cid(name) + '-lead')}, 'stress-cal', {lit(call_type)}, {start}, "
        f"{lit(status)}, {lit(cid(name) + '-user')}, 'ghl');")


def available(name: str, until: str, state: str = "available", updated: str = "now()") -> None:
    EXTRA.append(
        "insert into public.cockpit_sales_availability (email, state, until, via) values "
        f"({lit(host(name))}, {lit(state)}, {until if state == 'available' else 'null'}, 'cockpit');")


def event(name: str, *, at: str, source: str = "zoom", kind: str = "zoom.meeting.participant_joined",
          handled: str = "null", detail: str = "'{}'::jsonb") -> None:
    EXTRA.append(
        "insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, detail) "
        f"select r.id, {lit(kind)}, {lit(source)}, {lit(cid(name) + '-ev-' + secrets.token_hex(3))}, {at}, {handled}, {detail} "
        f"from public.cockpit_sales_rooms as r where r.host_email = {lit(host(name))} and r.made_by = 'stress-time';")


S_OPEN = {"state": "'open'", "join_url": JOIN}
S_IN = {"state": "'host_in'", "join_url": JOIN}

# R1 requested -> failed at requested + 60 s (strictly after).
room("r1-59", state="'requested'", requested_at=ago(59))
room("r1-61", state="'requested'", requested_at=ago(61))
check("R1 a room requested 59 s ago is still waiting for the worker", "r1-59", "r.state = 'requested'")
check("R1 a room requested 61 s ago fails (request_timeout)", "r1-61", "r.state = 'failed' and r.end_reason = 'request_timeout'")

# R2 creating -> failed at claimed + 120 s.
room("r2-119", state="'creating'", requested_at=ago(125), claimed_at=ago(119))
room("r2-121", state="'creating'", requested_at=ago(125), claimed_at=ago(121))
check("R2 a room claimed 119 s ago is still being made", "r2-119", "r.state = 'creating'")
check("R2 a room claimed 121 s ago fails (create_timeout)", "r2-121", "r.state = 'failed' and r.end_reason = 'create_timeout'")

# R3 open: the host is not in by host_by.
for n, hb in (("r3-minus1", -1), ("r3-plus1", 1)):
    room(n, **S_OPEN, requested_at=ago(300), opened_at=ago(290), link_sent_at=ago(289),
         host_by=ahead(hb), lead_by=ahead(600))
check("R3 host_by one second ahead: the room stays open", "r3-plus1", "r.state = 'open'")
check("R3 host_by one second past: closed host_not_in", "r3-minus1", "r.state = 'expired' and r.end_reason = 'host_not_in'")
# ... held by an unhandled Zoom event, at most 300 s past due.
room("r3-held", **S_OPEN, requested_at=ago(300), opened_at=ago(290), host_by=ago(1), lead_by=ahead(600))
event("r3-held", at=ago(10))
room("r3-held-301", **S_OPEN, requested_at=ago(900), opened_at=ago(890), host_by=ago(301), lead_by=ahead(600))
event("r3-held-301", at=ago(10))
room("r3-held-299", **S_OPEN, requested_at=ago(900), opened_at=ago(890), host_by=ago(299), lead_by=ahead(600))
event("r3-held-299", at=ago(10))
check("R3 a waiting Zoom event holds the timer just past due", "r3-held", "r.state = 'open'")
check("R3 the hold still stands 299 s past due", "r3-held-299", "r.state = 'open'")
check("R3 the hold ends 301 s past due: closed", "r3-held-301", "r.state = 'expired' and r.end_reason = 'host_not_in'")

# R4 the lead: lead_by, the open grace, its cap, the knock.
for n, lb in (("r4-minus1", -1), ("r4-plus1", 1)):
    room(n, **S_IN, requested_at=ago(700), opened_at=ago(690), host_in_at=ago(680), link_sent_at=ago(600 + lb),
         host_by=ago(100), lead_by=ahead(lb))
check("R4 lead_by one second ahead: the room waits", "r4-plus1", "r.state = 'host_in'")
check("R4 lead_by one second past: lead_no_show, no_join", "r4-minus1",
      "r.state = 'expired' and r.end_reason = 'lead_no_show' and r.result = 'no_join'")
room("r4-grace-in", **S_IN, requested_at=ago(700), opened_at=ago(690), host_in_at=ago(680), link_sent_at=ago(660),
     lead_by=ago(60), first_open_at=ago(400), last_open_at=ago(179))
room("r4-grace-out", **S_IN, requested_at=ago(700), opened_at=ago(690), host_in_at=ago(680), link_sent_at=ago(660),
     lead_by=ago(60), first_open_at=ago(400), last_open_at=ago(181))
check("R4 an open 179 s ago keeps the room one more second", "r4-grace-in", "r.state = 'host_in'")
check("R4 an open 181 s ago no longer does", "r4-grace-out", "r.state = 'expired' and r.end_reason = 'lead_no_show'")
room("r4-cap", **S_IN, requested_at=ago(900), opened_at=ago(890), host_in_at=ago(880), link_sent_at=ago(800),
     lead_by=ago(200), first_open_at=ago(700), last_open_at=ago(5))
check("R4 the grace is capped at link + lead + grace (a lead reopening the link cannot hold it)", "r4-cap",
      "r.state = 'expired' and r.end_reason = 'lead_no_show'")
room("r4-knock-in", **S_IN, requested_at=ago(700), opened_at=ago(690), host_in_at=ago(680), link_sent_at=ago(630),
     lead_by=ago(30), lead_waiting_at=ago(100))
room("r4-knock-out", **S_IN, requested_at=ago(800), opened_at=ago(790), host_in_at=ago(780), link_sent_at=ago(700),
     lead_by=ago(100), lead_waiting_at=ago(181))
check("R4 a knock 100 s ago keeps the room open", "r4-knock-in", "r.state = 'host_in'")
check("R4 a knock never let in: not_admitted, admit_blocked (never a no-show)", "r4-knock-out",
      "r.state = 'expired' and r.end_reason = 'not_admitted' and r.result = 'admit_blocked'")
# Booked: host_by start + 15, lead_by start + 20, ends at the appointment's end.
for n, start_ago in (("r4-booked-19", 19 * 60), ("r4-booked-21", 21 * 60)):
    room(n, **S_IN, purpose="'booked'", call_kind="'demo'", appointment_id=lit(cid(n) + "-appt"),
         requested_at=ago(start_ago + 600), opened_at=ago(start_ago + 600), host_in_at=ago(start_ago),
         host_by=ago(start_ago - 15 * 60), lead_by=ago(start_ago - 20 * 60), ends_at=ago(start_ago - 45 * 60))
check("R4 a booked call 19 minutes in still waits for its lead", "r4-booked-19", "r.state = 'host_in'")
check("R4 a booked call 21 minutes in with no lead closes", "r4-booked-21", "r.state = 'expired' and r.end_reason = 'lead_no_show'")

# R9 the backstop: requested + length + no_end_signal (intro: 30 + 30 min).
for n, mins in (("r9-59", 59), ("r9-61", 61)):
    room(n, **S_IN, requested_at=ago(mins * 60), opened_at=ago(mins * 60 - 5), host_in_at=ago(mins * 60 - 10),
         lead_by=ahead(3600), host_by=ahead(3600))
check("R9 59 minutes in (deadlines damaged): not yet", "r9-59", "r.state = 'host_in'")
check("R9 61 minutes in: closed no_deadline whatever its deadlines say", "r9-61",
      "r.state = 'expired' and r.end_reason = 'no_deadline'")

# R7 no end signal: ends_at + 1800 s.
for n, s in (("r7-1799", 1799), ("r7-1801", 1801)):
    room(n, state="'lead_in'", join_url=JOIN, requested_at=ago(s + 1900), opened_at=ago(s + 1890),
         host_in_at=ago(s + 1880), lead_in_at=ago(s + 1800), ends_at=ago(s), link_sent_at=ago(s + 1850))
check("R7 1799 s past ends_at: the call is still on", "r7-1799", "r.state = 'lead_in'")
check("R7 1801 s past ends_at: ended no_end_signal, joined", "r7-1801",
      "r.state = 'ended' and r.end_reason = 'no_end_signal' and r.result = 'joined'")

# A1 Available ends; R8 its empty standby room closes.
available("a1-gone", ago(1))
available("a1-left", ahead(1))
room("a1-gone", lead=False, purpose="'standby'", call_kind="'demo'", **S_IN, requested_at=ago(900),
     opened_at=ago(890), host_in_at=ago(880))
check("A1+R8 Available ran out a second ago: the empty standby room closes (host_away)", "a1-gone",
      "r.state = 'ended' and r.end_reason = 'host_away'")
CHECKS.append(("A1 Available one second past its end is Away (expired)",
               f"(select a.state = 'away' and a.reason = 'expired' from public.cockpit_sales_availability as a where a.email = {lit(host('a1-gone'))})",
               f"(select a.state || '/' || coalesce(a.reason, '-') from public.cockpit_sales_availability as a where a.email = {lit(host('a1-gone'))})", None))
CHECKS.append(("A1 Available one second before its end stays",
               f"(select a.state = 'available' from public.cockpit_sales_availability as a where a.email = {lit(host('a1-left'))})",
               f"(select a.state from public.cockpit_sales_availability as a where a.email = {lit(host('a1-left'))})", None))

# R5 standby refresh after standby_max (2100 s): a fresh room only while the
# host stays Available long enough and no booked call falls inside its life
# (roomlogic.ts refreshWanted: standby_max + booked_guard ahead).
def standby(name: str, in_for: int) -> None:
    room(name, lead=False, purpose="'standby'", call_kind="'demo'", **S_IN, requested_at=ago(in_for + 20),
         opened_at=ago(in_for + 10), host_in_at=ago(in_for))


standby("r5-plain", 2101)
available("r5-plain", ahead(3600))
standby("r5-not-yet", 2099)
available("r5-not-yet", ahead(3600))
standby("r5-short", 2101)
available("r5-short", ahead(299))
standby("r5-booked-601", 2101)
available("r5-booked-601", ahead(3600))
appointment("r5-booked-601", ahead(601))
standby("r5-booked-now", 2101)
available("r5-booked-now", ahead(3600))
appointment("r5-booked-now", ago(60))

FRESH = "(select count(*) from public.cockpit_sales_rooms as f where f.host_email = {H} and f.made_by = 'sweep' and f.state = 'requested')"
check("R5 2099 s in a standby room: kept", "r5-not-yet", "r.state = 'host_in'")
check("R5 2101 s in: closed (standby_refresh) and one fresh room asked for", "r5-plain",
      f"r.state = 'ended' and r.end_reason = 'standby_refresh' and {FRESH} = 1",
      f"r.state || '/' || coalesce(r.end_reason, '-') || ' fresh=' || {FRESH}")
check("R5 Available ends in 299 s: no fresh room", "r5-short", f"r.state = 'ended' and {FRESH} = 0",
      f"r.state || ' fresh=' || {FRESH}")
check("R5 a booked call 601 s ahead falls inside the fresh room's 35 minutes: no fresh room (refreshWanted)",
      "r5-booked-601", f"r.state = 'ended' and {FRESH} = 0", f"r.state || ' fresh=' || {FRESH}")
check("R5 the host's booked call started a minute ago: no fresh standby room during it",
      "r5-booked-now", f"r.state = 'ended' and {FRESH} = 0", f"r.state || ' fresh=' || {FRESH}")

# R6 the booked guard: an empty standby room ends 600 s before a booked call.
for n, start in (("r6-600", ahead(600)), ("r6-601", ahead(601)), ("r6-started", ago(60))):
    standby(n, 300)
    available(n, ahead(3600))
    appointment(n, start)
check("R6 a booked call 600 s ahead: the standby room ends (booked_call_soon)", "r6-600",
      "r.state = 'ended' and r.end_reason = 'booked_call_soon'")
check("R6 601 s ahead: not yet", "r6-601", "r.state = 'host_in'")
check("R6 a booked call that started a minute ago (booked late, or mirrored after its start): the standby room ends",
      "r6-started", "r.state = 'ended' and r.end_reason = 'booked_call_soon'")
CHECKS.append((
    "R6 a closer whose standby room just closed for a call 10 minutes away is not offered leads (presence not ready/available)",
    f"(select p.state not in ('ready', 'available') from public.cockpit_sales_presence as p where p.email = {lit(host('r6-600'))})",
    f"(select p.state || '/' || coalesce(p.reason, '-') || '/' || coalesce(p.why, '-') from public.cockpit_sales_presence as p where p.email = {lit(host('r6-600'))})",
    None))

# L1 the offer's end: offer_until + 30 s <= now (20261004a, stress2 round 2: the
# claim's own p_at window, so a Take pressed in time still finds the row
# offered); one miss sets Away, Not now does not.
available("l1-miss", ahead(3600))
available("l1-declined", ahead(3600))
available("l1-early", ahead(3600))
EXTRA.append(
    "insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, offered_to, declined_by, offer_until) values "
    f"(gen_random_uuid(), {lit(cid('l1'))}, {lit(host('l1-setter'))}, 'demo', 'on_call', "
    f"array[{lit(host('l1-miss'))}, {lit(host('l1-declined'))}], array[{lit(host('l1-declined'))}], now() - interval '30 seconds'), "
    f"(gen_random_uuid(), {lit(cid('l1-early'))}, {lit(host('l1-setter'))}, 'demo', 'on_call', "
    f"array[{lit(host('l1-early'))}], '{{}}', now() - interval '29 seconds');")
for label, h, want in (("L1 the offer ended 30 s ago (its claim window is over): the closer who missed it is Away (missed_offer)", "l1-miss",
                        "a.state = 'away' and a.reason = 'missed_offer'"),
                       ("L1 the closer who pressed Not now stays available", "l1-declined", "a.state = 'available'"),
                       ("L1 an offer that ended 29 s ago is still held for a Take pressed in time; its closer stays available", "l1-early",
                        "a.state = 'available'")):
    CHECKS.append((label, f"(select {want} from public.cockpit_sales_availability as a where a.email = {lit(host(h))})",
                   f"(select a.state || '/' || coalesce(a.reason, '-') from public.cockpit_sales_availability as a where a.email = {lit(host(h))})",
                   None))
CHECKS.append(("L1 the handover whose offer ended 30 s ago is expired, the one 29 s past its end is still offered",
               f"(select bool_and(case l.contact_id when {lit(cid('l1'))} then l.state = 'expired' else l.state = 'offered' end) "
               f"from public.cockpit_sales_live as l where l.contact_id in ({lit(cid('l1'))}, {lit(cid('l1-early'))}))",
               f"(select string_agg(l.contact_id || '=' || l.state, ', ') from public.cockpit_sales_live as l "
               f"where l.contact_id in ({lit(cid('l1'))}, {lit(cid('l1-early'))}))", None))

# S1 settling a fallback room for a booked intro: start + 1200 s (strictly after).
def settle_room(name: str, *, req_ago: int, ended_ago: int, start: str, end_reason: str = "lead_no_show") -> None:
    room(name, state="'expired'", join_url=JOIN, appointment_id=lit(cid(name) + "-appt"), requested_at=ago(req_ago),
         opened_at=ago(req_ago - 5), link_sent_at=ago(req_ago - 10), ended_at=ago(ended_ago), result="'no_join'",
         end_reason=lit(end_reason))
    EXTRA.append(
        "insert into public.cockpit_sales_appointments (appointment_id, contact_id, calendar_id, call_type, start_at, status, origin) "
        f"values ({lit(cid(name) + '-appt')}, {lit(cid(name))}, 'stress-cal', 'intro', {start}, 'confirmed', 'ghl');")


SETTLE = "(select count(*) from public.cockpit_sales_room_events as e where e.room_id = r.id and e.source = 'settle')"
settle_room("s1-1201", req_ago=1500, ended_ago=890, start=ago(1201))
settle_room("s1-1199", req_ago=1500, ended_ago=890, start=ago(1199))
# Zoom reported each meeting (its start, read): its silence about the lead is evidence (20261003d).
for n in ("s1-1201", "s1-1199"):
    event(n, at=ago(1490), handled=ago(1489), kind="zoom.meeting.started")
check("S1 start + 1201 s: the closed-empty fallback room is due to settle", "s1-1201", f"{SETTLE} = 1",
      f"'settle events=' || {SETTLE}")
check("S1 start + 1199 s: not yet", "s1-1199", f"{SETTLE} = 0", f"'settle events=' || {SETTLE}")
# The intro was moved to today after yesterday's room closed empty: yesterday's room says nothing about today's call.
settle_room("s1-moved", req_ago=86400 + 900, ended_ago=86400, start=ago(21 * 60))
check("S1 a room that closed a day before the (moved) intro's start does not settle that intro as a no-show",
      "s1-moved", f"{SETTLE} = 0", f"'settle events=' || {SETTLE}")
# The lead joined one second after the sweep closed the room: Zoom's join is stored (refused: final).
settle_room("s1-latejoin", req_ago=1500, ended_ago=890, start=ago(1500))
event("s1-latejoin", at=ago(889), handled=ago(888),
      detail="""'{"refused": {"code": "final"}, "participant": {"role": "lead"}}'::jsonb""")
check("S1 a lead whose Zoom join landed one second after the sweep closed the room is not settled a no-show",
      "s1-latejoin", f"{SETTLE} = 0", f"'settle events=' || {SETTLE}")

# L2 a taker who never got into the room: claimed + 120 s.
for n, s in (("l2-119", 119), ("l2-121", 121)):
    EXTRA.append(
        "insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, state, offered_to, "
        "offer_until, claimed_by, claimed_at, claim_room) values "
        f"(gen_random_uuid(), {lit(cid(n))}, {lit(host('l2-setter'))}, 'demo', 'on_call', 'claimed', "
        f"array[{lit(host(n))}], {ago(s + 30)}, {lit(host(n))}, {ago(s)}, 'none');")
LIVE = "(select l.state || '/' || coalesce(l.end_reason, '-') from public.cockpit_sales_live as l where l.contact_id = {C})"
CHECKS.append(("L2 claimed 119 s ago with no room yet: still claimed",
               f"{LIVE.format(C=lit(cid('l2-119')))} = 'claimed/-'", LIVE.format(C=lit(cid("l2-119"))), None))
CHECKS.append(("L2 claimed 121 s ago and the taker is not in a room: expired rep_not_in_room",
               f"{LIVE.format(C=lit(cid('l2-121')))} = 'expired/rep_not_in_room'", LIVE.format(C=lit(cid("l2-121"))), None))

# L3 the taker left before the lead came: offered again once, only while the
# lead still has more than a minute.
for n, lead_left in (("l3-61", 61), ("l3-59", 59)):
    room(n, state="'expired'", purpose="'handover'", call_kind="'demo'", join_url=JOIN, requested_at=ago(400),
         opened_at=ago(390), link_sent_at=ago(380), host_in_at=ago(370), lead_by=ahead(lead_left),
         ended_at=ago(5), end_reason="'host_not_in'", result="'no_join'")
    available(n + "-b", ahead(3600))
    EXTRA.append(
        "insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, state, offered_to, "
        "offer_until, claimed_by, claimed_at, claim_room, room_id) select gen_random_uuid(), "
        f"{lit(cid(n) + '-lead')}, {lit(host('l3-setter'))}, 'demo', 'on_call', 'room_ready', "
        f"array[{lit(host(n))}, {lit(host(n + '-b'))}], {ago(300)}, {lit(host(n))}, {ago(290)}, 'none', r.id "
        f"from public.cockpit_sales_rooms as r where r.host_email = {lit(host(n))} and r.made_by = 'stress-time';")
REOFFER = ("(select l.state || ' until+' || coalesce(round(extract(epoch from l.offer_until - now()))::text, '-') "
           "|| ' to=' || array_to_string(l.offered_to, ',') from public.cockpit_sales_live as l where l.contact_id = {C})")
CHECKS.append(("L3 the lead has 61 s left: offered again to the other closer, until the lead's deadline",
               f"(select l.state = 'offered' and l.reoffers = 1 and l.offer_until = now() + interval '61 seconds' "
               f"and l.offered_to = array[{lit(host('l3-61-b'))}] from public.cockpit_sales_live as l "
               f"where l.contact_id = {lit(cid('l3-61') + '-lead')})",
               REOFFER.format(C=lit(cid("l3-61") + "-lead")), None))
CHECKS.append(("L3 the lead has 59 s left: not offered again, the handover ends",
               f"(select l.state = 'expired' from public.cockpit_sales_live as l where l.contact_id = {lit(cid('l3-59') + '-lead')})",
               REOFFER.format(C=lit(cid("l3-59") + "-lead")), None))

# E1 replay after 20 s; E0 gives up after 10 real tries (leases by
# room.event, 20 s after the last) or a day (20261003d: a pick is not a try,
# so an outage never gives up a Zoom join).
def bare_event(name: str, **cols: str) -> None:
    base = {"kind": "'zoom.meeting.participant_joined'", "source": "'zoom'", "dedupe_key": lit(cid(name) + "-ev")}
    base.update(cols)
    EXTRA.append(f"insert into public.cockpit_sales_room_events ({', '.join(base)}) values ({', '.join(base.values())});")


bare_event("e1-19", at=ago(19))
bare_event("e1-21", at=ago(21))
bare_event("e1-held", at=ago(60), lease_until=ahead(10))
bare_event("e0-10tries", at=ago(200), tries="10", last_try_at=ago(21))
bare_event("e0-10tries-recent", at=ago(200), tries="10", last_try_at=ago(19))
bare_event("e1-picked-3", at=ago(200), tries="0", last_try_at=ago(21))
bare_event("e0-day", at="now() - interval '1 day 1 second'")
bare_event("e1-day-edge", at="now() - interval '1 day' + interval '1 second'")
EV = ("(select coalesce(e.handled_at = now(), false)::text || '/' || e.tries || '/' || coalesce(e.detail ->> 'gave_up', '-') "
      "|| '/' || coalesce(e.detail ->> 'too_old', '-') || '/' || coalesce(e.last_try_at = now(), false)::text "
      "from public.cockpit_sales_room_events as e where e.dedupe_key = {K})")
for label, name, want in (
        ("E1 an event 19 s old is not sent back yet", "e1-19", "false/0/-/-/false"),
        ("E1 an event 21 s old is sent back to room.event (picked; the try counts when room.event takes it)", "e1-21", "false/0/-/-/true"),
        ("E1 a held (leased) event is neither replayed nor given up", "e1-held", "false/0/-/-/false"),
        ("E0 10 tries, the last 21 s ago: given up", "e0-10tries", "true/10/true/-/false"),
        ("E0 10 tries, the last 19 s ago: not yet given up", "e0-10tries-recent", "false/10/-/-/false"),
        ("E1 picked three times with nobody answering (an outage): never given up, sent back again", "e1-picked-3", "false/0/-/-/true"),
        ("E0 an event a day and a second old is given up as too old, never replayed", "e0-day", "true/0/true/true/false"),
        ("E1 an event a second short of a day old is still replayed", "e1-day-edge", "false/0/-/-/true")):
    k = lit(cid(name) + "-ev")
    CHECKS.append((label, f"{EV.format(K=k)} = {lit(want)}", EV.format(K=k), None))

# Watchdog hours: Saturday to Thursday, 09:00 to 21:00 Kuwait (UTC+3).
HOURS = [
    ("2026-10-08 20:59:59+03", True, "Thursday 20:59:59"),
    ("2026-10-08 21:00:00+03", False, "Thursday 21:00:00"),
    ("2026-10-09 10:00:00+03", False, "Friday 10:00"),
    ("2026-10-09 23:59:59+03", False, "Friday 23:59:59"),
    ("2026-10-10 08:59:59+03", False, "Saturday 08:59:59"),
    ("2026-10-10 09:00:00+03", True, "Saturday 09:00:00"),
    ("2026-10-08 06:00:00+00", True, "Thursday 09:00 Kuwait = 06:00 UTC"),
    ("2026-10-08 05:59:59+00", False, "Thursday 08:59:59 Kuwait"),
    ("2026-10-08 23:30:00+00", False, "Friday 02:30 Kuwait, still Thursday in UTC"),
]
for at, want, label in HOURS:
    CHECKS.append((f"Watchdog hours {label}: {'posts' if want else 'waits'}",
                   f"public.cockpit_sales_alert_hours('{at}'::timestamptz) = {str(want).lower()}",
                   f"public.cockpit_sales_alert_hours('{at}'::timestamptz)::text", None))


# ---------------------------------------------------------------------------
# The one transaction
# ---------------------------------------------------------------------------

COPY = r"""
do $copy$
declare
  src text;
begin
  src := pg_get_functiondef('public.cockpit_sales_rooms_sweep()'::regprocedure);
  src := replace(src, 'CREATE OR REPLACE FUNCTION public.cockpit_sales_rooms_sweep()', 'CREATE FUNCTION pg_temp.stress_sweep()');
  src := replace(src, 'public.cockpit_sales_settings', 'pg_temp.stress_settings');
  src := replace(src, 'public.cockpit_sales_worker_status', 'pg_temp.stress_status');
  src := replace(src, 'hashtext(''cockpit_sales_rooms_sweep'')', 'hashtext(''stress_time_sweep'')');
  if position('pg_temp.stress_sweep' in src) = 0 or position('pg_temp.stress_settings' in src) = 0
     or position('pg_temp.stress_status' in src) = 0 or position('stress_time_sweep' in src) = 0 then
    raise exception 'The sweep copy did not take: the deployed function text changed shape.';
  end if;
  execute src;
end
$copy$;
"""


def compose() -> str:
    parts = ["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '90s';",
             "-- ===== 20261003d (the repo's sweep and view, rolled back with the rest) =====",
             run_checks.hardening_sql(),
             "create temp table stress_settings (key text primary key, value jsonb not null) on commit drop;",
             "insert into pg_temp.stress_settings (key, value) select s.key, s.value || case s.key "
             "when 'rooms' then '{\"enabled\": true, \"providers\": {\"zoom\": true, \"meet\": true}}'::jsonb "
             "else '{\"enabled\": true, \"standby\": true, \"hours\": {\"days\": [0, 1, 2, 3, 4, 5, 6], "
             "\"from\": \"00:00\", \"to\": \"24:00\", \"tz\": \"Asia/Kuwait\"}}'::jsonb end "
             "from public.cockpit_sales_settings as s where s.key in ('rooms', 'live');",
             "create temp table stress_status (worker text, job text, ok boolean, detail text, at timestamptz, "
             "primary key (worker, job)) on commit drop;",
             "create temp table stress_checks (n serial, name text, ok boolean, detail text) on commit drop;",
             "create temp table stress_out (r jsonb) on commit drop;",
             COPY]
    for name, cols in ROOMS.items():
        keys = ", ".join(cols)
        vals = ", ".join(cols.values())
        parts.append(f"insert into public.cockpit_sales_rooms ({keys}) values ({vals});")
    parts += EXTRA
    parts.append("insert into pg_temp.stress_out (r) select pg_temp.stress_sweep();")
    for name, ok, detail, room_name in CHECKS:
        if room_name is None:
            parts.append(f"insert into pg_temp.stress_checks (name, ok, detail) values ({lit(name)}, coalesce(({ok}), false), "
                         f"coalesce(({detail})::text, 'no row'));")
        else:
            where = f"r.host_email = {lit(host(room_name))} and r.made_by = 'stress-time'"
            parts.append(
                f"insert into pg_temp.stress_checks (name, ok, detail) values ({lit(name)}, "
                f"coalesce((select ({ok}) from public.cockpit_sales_rooms as r where {where}), false), "
                f"coalesce((select ({detail})::text from public.cockpit_sales_rooms as r where {where}), 'no row'));")
    parts.append("insert into pg_temp.stress_checks (name, ok, detail) select 'The sweep copy ran with no rule failing', "
                 "jsonb_array_length(coalesce(o.r -> 'errors', '[]')) = 0 and not (o.r ? 'skipped'), "
                 "coalesce(o.r ->> 'skipped', (o.r -> 'errors')::text) from pg_temp.stress_out as o;")
    parts.append("select name, ok, detail from pg_temp.stress_checks order by n;")
    parts.append("rollback;")
    return "\n".join(parts)


LEFTOVERS = f"""
select 'room ' || host_email as what from public.cockpit_sales_rooms where host_email like 'st-{TAG}-%' or contact_id like 'stress-time-{TAG}-%'
union all select 'event ' || dedupe_key from public.cockpit_sales_room_events where dedupe_key like 'stress-time-{TAG}-%'
union all select 'person ' || email from public.cockpit_sales_people where email like 'st-{TAG}-%'
union all select 'appointment ' || appointment_id from public.cockpit_sales_appointments where appointment_id like 'stress-time-{TAG}-%'
union all select 'availability ' || email from public.cockpit_sales_availability where email like 'st-{TAG}-%'
union all select 'live ' || contact_id from public.cockpit_sales_live where contact_id like 'stress-time-{TAG}-%'
union all select 'audit ' || entity_id from public.cockpit_audit_log where metadata ->> 'contact_id' like 'stress-time-{TAG}-%'
"""


def deployed_matches_repo() -> str:
    """Whether the deployed sweep is the repo's (so the run tests this branch)."""
    text = open(MIGRATION).read()
    m = re.search(r"create or replace function public\.cockpit_sales_rooms_sweep\(\).*?\nas \$\$\n(.*?)\n\$\$;", text, re.S)
    rows = query("select md5(prosrc) as h, prosrc from pg_proc where oid = 'public.cockpit_sales_rooms_sweep()'::regprocedure", False)
    if not m or not rows:
        return "could not compare"
    import hashlib
    repo = hashlib.md5(("\n" + m.group(1) + "\n").encode()).hexdigest()
    return ("same as the repo" if repo == rows[0]["h"]
            else "not yet the repo's 20261003d (the run applies d first, so it tests the repo's)")


def main() -> None:
    print(f"run tag {TAG}; deployed sweep: {deployed_matches_repo()}")
    rows = query(compose(), write=True) or []
    failed = [r for r in rows if not r.get("ok")]
    for r in rows:
        print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}  ({r.get('detail')})")
    print(f"\n{len(rows) - len(failed)} passed, {len(failed)} failed, {len(rows)} checks.")
    left = query(LEFTOVERS, False) or []
    if left:
        print("LEFT BEHIND after the rollback:", [x["what"] for x in left])
        sys.exit(2)
    print("Nothing persisted: no room, event, person, appointment, availability, handover or audit row of this run is left.")
    sys.exit(0 if rows and not failed else 1)


if __name__ == "__main__":
    main()
