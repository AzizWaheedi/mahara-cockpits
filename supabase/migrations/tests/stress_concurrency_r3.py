#!/usr/bin/env python3
"""Round 3 concurrency and idempotency stress against the REAL live-calls
tables on Creative Triage (20261003a, b and c applied, dark).

    python3 supabase/migrations/tests/stress_concurrency_r3.py            # every check
    python3 supabase/migrations/tests/stress_concurrency_r3.py slot_sender claim_twenty   # some, by name

What is new here
  Migration 20261003d is not applied in production, so its functions cannot
  be called by name there, and applying it in a rolled-back transaction per
  press serialises every press behind the first (two sessions cannot replace
  one function at once). Each press here makes its own copy of d's function,
  word for word, in its own session's pg_temp schema (create function
  pg_temp.<name>, the body read from the migration file at run time), and
  calls that copy. The presses then run in real parallel against the real,
  committed tables, with d's own locks and statements:

    slot_*        cockpit_sales_message_slot: the sender ceiling, a request id
                  pressed twenty times at once, the two-minute gap a lead, the
                  day's template ceiling, and templates and free messages from
                  one sender at once (lock order: templates, lead, sender).
    lease_tries   cockpit_sales_room_event_lease: twenty room.event runs lease
                  one Zoom event at once; one holds it and one try is counted.
    claim_twenty  cockpit_sales_live_claim: twenty closers, each Ready in an
                  empty standby room, press Take on one offer whose lead is in
                  the setter's room. Its two audit inserts become no-ops in the
                  copy (cockpit_audit_log cannot be deleted from); nothing else
                  in the function changes.
    claim_two_offers  one closer takes two offers at once (two leads, each in
                  a setter's room): one claim; the other lead's room untouched.
    claim_host_race   the take_host_busy check against a room the closer is
                  opening for another lead at the same moment (its insert not
                  yet committed when the claim reads).

Synthetic rows only: contact ids start with 'stress-r3-', host and seat
emails end with '@stress.invalid'; every check deletes exactly the rows it
made. The pg_cron sweep runs at second :00 and would act on (and audit) a
live synthetic room, so every check that commits such rows starts between
second 4 and 38 of a minute and is gone in seconds. Nothing here calls
HighLevel, Zoom, Google or Slack, and no audit row is ever written.

Exit code 0 only when every check held and nothing synthetic is left.
"""
import json
import os
import re
import secrets
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stress_concurrency as sc  # noqa: E402  (q, lit, SqlError, in_window)

q, lit, SqlError = sc.q, sc.lit, sc.SqlError
RUN = "stress-r3-" + secrets.token_hex(4)
HOST = "@stress.invalid"
D_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "20261003d_live_calls_hardening.sql")
REST_S = 6  # between checks: the management API throttles bursts that follow each other

RESULTS = []
LIVE_IDS: list = []


class Throttled(Exception):
    """The management API turned requests away for load (other runs share it):
    that burst never ran as one, so the check is run again, never judged."""


def no_throttle(out):
    for o in out:
        if o[0] == "err" and ("throttled" in o[1].text or o[1].status == 429):
            raise Throttled(o[1].text[:80])
    return out


def _moment(lead_s: float) -> str:
    """One shared moment lead_s from now, once the database has room: a burst
    never takes the connections the cockpits need (at most 60 in use)."""
    for _ in range(5):
        row = q("select (select count(*) from pg_stat_activity)::int as n, "
                f"(clock_timestamp() + make_interval(secs => {lead_s}))::text as at", write=False)[0]
        if row["n"] + 20 <= 60:
            return row["at"]
        time.sleep(2)
    raise SqlError(0, "the database is busy (over 40 connections in use); run again later")


def burst(sqls, width: int = 20, lead_s: float = 2.5):
    """Every statement waits for one shared moment, then runs on its own
    connection: real parallel presses. No rest after it (rows of a check
    live only seconds); main() rests between checks."""
    at = _moment(lead_s)

    def one(s):
        try:
            return ("ok", q(f"select pg_sleep_until({lit(at)}::timestamptz);\n{s}"))
        except SqlError as e:
            return ("err", e)

    with ThreadPoolExecutor(min(width, len(sqls))) as ex:
        return no_throttle(list(ex.map(one, sqls)))


def staggered(sqls_with_delay):
    """Each (sql, delay_s) starts delay_s after one shared moment, on its own connection."""
    at = _moment(2.5)

    def one(item):
        sql, delay = item
        t0 = time.time()
        try:
            out = ("ok", q(f"select pg_sleep_until({lit(at)}::timestamptz + make_interval(secs => {delay}));\n{sql}"))
        except SqlError as e:
            out = ("err", e)
        return out + (round(time.time() - t0, 2),)

    with ThreadPoolExecutor(len(sqls_with_delay)) as ex:
        return no_throttle(list(ex.map(one, sqls_with_delay)))


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail else ""))


# ---------------------------------------------------------------------------
# d's functions as session copies in pg_temp
# ---------------------------------------------------------------------------

def d_function(name: str, *, no_audit: bool = False) -> str:
    """The `create or replace function public.<name>` statement of migration
    d, word for word, made in pg_temp. With no_audit, its inserts into
    cockpit_audit_log become `null;` (the log cannot be deleted from)."""
    text = open(D_FILE).read()
    start = text.index(f"create or replace function public.{name}(")
    body_open = text.index("$$", start)
    body_close = text.index("$$;", body_open + 2)
    sql = text[start:body_close + 3]
    sql = sql.replace(f"create or replace function public.{name}(", f"create or replace function pg_temp.{name}(", 1)
    if no_audit:
        sql, n = re.subn(r"insert into public\.cockpit_audit_log\b.*?\);\n", "null;\n", sql, flags=re.S)
        if n == 0:
            raise SystemExit(f"{name}: no audit insert found to take out; the copy would write the audit log.")
    if "cockpit_audit_log" in sql:
        raise SystemExit(f"{name}: the copy still writes cockpit_audit_log.")
    return sql


SLOT = None
LEASE = None
CLAIM = None


def slot_call(row: dict, limits: dict) -> str:
    return (f"{SLOT}\nselect pg_temp.cockpit_sales_message_slot({lit(json.dumps(row))}::jsonb, "
            f"{lit(json.dumps(limits))}::jsonb) as out")


def outs_of(burst_out):
    """Each press's answer code ('ok', 'repeat', a ceiling), or 'error: ...'."""
    codes = []
    for o in burst_out:
        if o[0] == "ok" and o[1]:
            v = o[1][0].get("out")
            v = json.loads(v) if isinstance(v, str) else (v or {})
            codes.append(str(v.get("code")))
        elif o[0] == "err":
            codes.append("error: " + o[1].text[:160])
        else:
            codes.append("no answer")
    return codes


def tally(codes):
    t = {}
    for c in codes:
        t[c] = t.get(c, 0) + 1
    return dict(sorted(t.items()))


# ---------------------------------------------------------------------------
# Cleanup: only this run's rows
# ---------------------------------------------------------------------------

MINE_ROOMS = f"(contact_id like '{RUN}-%' or host_email like '{RUN}-%{HOST}')"


def cleanup():
    q(f"""
      delete from public.cockpit_sales_messages where contact_id like '{RUN}-%';
      delete from public.cockpit_sales_room_events
       where dedupe_key like '{RUN}%'
          or room_id in (select id from public.cockpit_sales_rooms where {MINE_ROOMS})
          or detail->>'handover_id' in (select id::text from public.cockpit_sales_live where contact_id like '{RUN}-%');
      -- A handover in room_ready must keep its room_id (cockpit_sales_live_room_check):
      -- the rooms let go of the handover first, then the handovers go, then the rooms.
      update public.cockpit_sales_rooms set replaced_by = null, handover_id = null
       where {MINE_ROOMS} and (replaced_by is not null or handover_id is not null);
      delete from public.cockpit_sales_live where contact_id like '{RUN}-%';
      delete from public.cockpit_sales_rooms where {MINE_ROOMS};
    """)


def leftovers():
    return q(f"""
      select (select count(*) from public.cockpit_sales_rooms where {MINE_ROOMS}) as rooms,
             (select count(*) from public.cockpit_sales_live where contact_id like '{RUN}-%') as live,
             (select count(*) from public.cockpit_sales_messages where contact_id like '{RUN}-%') as messages,
             (select count(*) from public.cockpit_sales_room_events where dedupe_key like '{RUN}%'
                 or detail->>'handover_id' in ({",".join(lit(x) for x in LIVE_IDS) or "''"})) as events,
             (select count(*) from public.cockpit_audit_log where actor_email like '{RUN}-%' or entity_id like '{RUN}-%'
                 or metadata->>'contact_id' like '{RUN}-%') as audit
    """, write=False)[0]


# ---------------------------------------------------------------------------
# The message slot
# ---------------------------------------------------------------------------

def msg_row(i, *, contact=None, sender=None, template=False, request_id=None):
    return {
        "request_id": request_id or str(uuid.uuid4()),
        "contact_id": contact or f"{RUN}-lead-{i}",
        "channel": "whatsapp",
        "via": "workflow" if template else "conversation",
        "template_key": "opener_ar" if template else None,
        "body": "stress",
        "source": "rep",
        "sent_by": sender or f"{RUN}-sender{HOST}",
    }


def kuwait_day_start():
    return q("select (date_trunc('day', now() at time zone 'Asia/Kuwait') at time zone 'Asia/Kuwait')::text as d, "
             "(date_trunc('month', now() at time zone 'Asia/Kuwait') at time zone 'Asia/Kuwait')::text as m", write=False)[0]


def templates_today(day):
    return int(q(f"select count(*)::int as n from public.cockpit_sales_messages where via = 'workflow' and state <> 'failed' "
                 f"and created_at >= {lit(day)}::timestamptz", write=False)[0]["n"])


def t_slot_sender():
    """Twenty free messages from one sender at once, with a ceiling of 10 (the
    real one is 30 in ten minutes; the limit comes from sales-api): exactly
    10 rows, the other 10 told the ceiling. No press errs or waits out its lock."""
    try:
        lim = {"sender_max": 10, "sender_window_s": 600}
        out = burst([slot_call(msg_row(i), lim) for i in range(20)], width=20)
        codes = outs_of(out)
        rows = int(q(f"select count(*)::int as n from public.cockpit_sales_messages where sent_by = {lit(RUN + '-sender' + HOST)}",
                     write=False)[0]["n"])
        check("twenty free messages from one sender at once under a ceiling of 10: exactly 10 written, 10 told the ceiling",
              tally(codes) == {"ok": 10, "sender_ceiling": 10} and rows == 10, f"answers={tally(codes)} rows={rows}")
    finally:
        cleanup()


def t_slot_same_request():
    """The same request id from twenty tabs at once: one row; nineteen answers
    are that row (repeat), none an error."""
    try:
        rid = str(uuid.uuid4())
        out = burst([slot_call(msg_row(0, contact=f"{RUN}-lead-same", request_id=rid), {}) for _ in range(20)], width=20)
        codes = outs_of(out)
        rows = int(q(f"select count(*)::int as n from public.cockpit_sales_messages where request_id = {lit(rid)}::uuid",
                     write=False)[0]["n"])
        check("one request id pressed twenty times at once: one row, nineteen repeats",
              tally(codes) == {"ok": 1, "repeat": 19} and rows == 1, f"answers={tally(codes)} rows={rows}")
    finally:
        cleanup()


def t_slot_lead_gap():
    """Twenty templates to one lead from twenty senders at once: one goes,
    nineteen are told the lead had one a moment ago."""
    try:
        day = kuwait_day_start()
        lim = {"lead_gap_s": 120, "per_day": 250, "month_cap": 1000000, "day_start": day["d"], "month_start": day["m"]}
        out = burst([slot_call(msg_row(i, contact=f"{RUN}-lead-gap", sender=f"{RUN}-s{i}{HOST}", template=True), lim)
                        for i in range(20)], width=20)
        codes = outs_of(out)
        check("twenty templates to one lead at once: one written, nineteen told the two-minute gap",
              tally(codes) == {"lead_gap": 19, "ok": 1}, f"answers={tally(codes)}")
    finally:
        cleanup()


def t_slot_per_day():
    """Twenty templates to twenty leads at once with seven left under the
    day's ceiling: exactly seven written."""
    try:
        day = kuwait_day_start()
        base = templates_today(day["d"])
        lim = {"lead_gap_s": 120, "per_day": base + 7, "month_cap": 1000000, "day_start": day["d"], "month_start": day["m"]}
        out = burst([slot_call(msg_row(i, sender=f"{RUN}-s{i}{HOST}", template=True), lim) for i in range(20)], width=20)
        codes = outs_of(out)
        check("twenty templates at once with seven left today: exactly seven written, thirteen told the day's ceiling",
              tally(codes) == {"ok": 7, "per_day": 13}, f"answers={tally(codes)} (templates today before: {base})")
    finally:
        cleanup()


def t_slot_mixed():
    """Forty sends from one sender at once, half templates (to forty leads),
    half free messages, under a ceiling of 12 and five templates left today:
    exactly 12 rows, at most 5 of them templates, no deadlock, no lock wait
    run out."""
    try:
        day = kuwait_day_start()
        base = templates_today(day["d"])
        lim = {"sender_max": 12, "sender_window_s": 600, "lead_gap_s": 120, "per_day": base + 5, "month_cap": 1000000,
               "day_start": day["d"], "month_start": day["m"]}
        sqls = [slot_call(msg_row(i, template=(i % 2 == 0)), lim) for i in range(40)]
        out = burst(sqls, width=20)
        codes = outs_of(out)
        made = q(f"select count(*)::int as n, count(*) filter (where via = 'workflow')::int as t "
                 f"from public.cockpit_sales_messages where sent_by = {lit(RUN + '-sender' + HOST)}", write=False)[0]
        errs = [c for c in codes if c.startswith("error") or c == "no answer"]
        check("forty templates and free messages from one sender at once: exactly the ceiling written, templates within the day's",
              int(made["n"]) == 12 and int(made["t"]) <= 5 and not errs and codes.count("ok") == 12,
              f"answers={tally(codes)} rows={made['n']} templates={made['t']} errors={errs[:2]}")
    finally:
        cleanup()


# ---------------------------------------------------------------------------
# The event lease
# ---------------------------------------------------------------------------

def t_lease_tries():
    """One Zoom event (the door's), twenty room.event runs leasing it at once:
    one holds it, the try counted once. The event lives a few seconds (the
    sweep replays a Zoom event only after event_replay, 20 s, and only at :00)."""
    sc.in_window()
    try:
        key = f"{RUN}-zoom-ev"
        eid = q(f"""insert into public.cockpit_sales_room_events (kind, source, dedupe_key, text, detail)
                    values ('zoom.meeting.participant_joined', 'zoom', {lit(key)}, 'stress', '{{}}'::jsonb) returning id""")[0]["id"]
        out = burst([f"{LEASE}\nselect pg_temp.cockpit_sales_room_event_lease({lit(eid)}::uuid, null, 30)::text as got"
                        for _ in range(20)], width=20)
        got = [o[1][0].get("got") for o in out if o[0] == "ok" and o[1]]
        holders = [g for g in got if g]
        errs = [o[1].text[:120] for o in out if o[0] == "err"]
        row = q(f"select tries, lease_until is not null as held from public.cockpit_sales_room_events where id = {lit(eid)}",
                write=False)[0]
        check("twenty room.event runs lease one Zoom event at once: one holds it, one try counted",
              len(holders) == 1 and int(row["tries"]) == 1 and row["held"] and not errs,
              f"holders={len(holders)} tries={row['tries']} errors={errs[:2]}")
    finally:
        cleanup()


# ---------------------------------------------------------------------------
# The handover claim
# ---------------------------------------------------------------------------

def room_values(*, host, contact, purpose, state, kind="intro", provider="meet"):
    cols = {
        "request_id": str(uuid.uuid4()),
        "contact_id": contact,
        "purpose": purpose,
        "call_kind": kind,
        "provider": provider,
        "host_email": host,
        "made_by": host,
        "state": state,
        "join_url": "https://meet.google.com/str-ess-tst" if state in ("open", "host_in", "lead_in") else None,
    }
    return cols


def insert_room(**kw) -> str:
    cols = room_values(**kw)
    names = ", ".join(cols)
    vals = ", ".join(lit(v) for v in cols.values())
    return q(f"insert into public.cockpit_sales_rooms ({names}) values ({vals}) returning id")[0]["id"]


def insert_offer(contact, offered_to) -> str:
    arr = "array[" + ",".join(lit(c) for c in offered_to) + "]::text[]"
    lid = q(f"""insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, offered_to, offer_until)
                values ({lit(str(uuid.uuid4()))}, {lit(contact)}, {lit(RUN + '-setter' + HOST)}, 'demo', 'on_call',
                        {arr}, now() + interval '2 minutes') returning id""")[0]["id"]
    LIVE_IDS.append(str(lid))
    return lid


def claim_call(live_id, email) -> str:
    return (f"{CLAIM}\nselect l.claimed_by, l.claim_room, l.state, l.room_id::text as room_id "
            f"from pg_temp.cockpit_sales_live_claim({lit(live_id)}::uuid, {lit(email)}, null) as l")


def t_claim_twenty():
    """Twenty closers, each Ready in an empty standby room, press Take at once
    on one offer whose lead is in the setter's room: one claim; the setter's
    room cancelled once ("replaced") and pointing at the adopted room; one
    standby room adopted; nineteen standby rooms still empty; one live.claimed
    event."""
    sc.in_window()
    try:
        lead = f"{RUN}-lead-take"
        setter_room = insert_room(host=f"{RUN}-setter{HOST}", contact=lead, purpose="fallback", state="host_in")
        closers = [f"{RUN}-closer{i}{HOST}" for i in range(20)]
        q("insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url) values "
          + ", ".join(f"({lit(str(uuid.uuid4()))}, null, 'standby', 'demo', 'meet', {lit(c)}, {lit(c)}, 'host_in', 'https://meet.google.com/str-ess-tst')"
                      for c in closers))
        lid = insert_offer(lead, closers)
        out = burst([claim_call(lid, c) for c in closers], width=20)
        won = [o[1][0] for o in out if o[0] == "ok" and o[1] and o[1][0].get("claimed_by")]
        errs = [o[1].text[:160] for o in out if o[0] == "err"]
        s = q(f"""select
                    (select state from public.cockpit_sales_rooms where id = {lit(setter_room)}) as setter_state,
                    (select replaced_by::text from public.cockpit_sales_rooms where id = {lit(setter_room)}) as replaced_by,
                    (select count(*) from public.cockpit_sales_rooms where host_email like '{RUN}-closer%' and purpose = 'standby'
                        and contact_id is null and state = 'host_in')::int as empty_standby,
                    (select count(*) from public.cockpit_sales_rooms where contact_id = {lit(lead)} and purpose = 'handover'
                        and state in ('open','host_in','lead_in'))::int as adopted,
                    (select count(*) from public.cockpit_sales_room_events where kind = 'live.claimed'
                        and detail->>'handover_id' = {lit(lid)})::int as claimed_events,
                    (select state || '/' || coalesce(claim_room, '-') from public.cockpit_sales_live where id = {lit(lid)}) as live""",
              write=False)[0]
        ok = (len(won) == 1 and not errs and s["setter_state"] == "cancelled" and s["adopted"] == 1 and s["empty_standby"] == 19
              and s["claimed_events"] == 1 and s["live"] == "room_ready/standby" and s["replaced_by"] == won[0]["room_id"])
        check("twenty closers in standby rooms take one offer at once: one claim, the setter's room replaced once, one standby adopted",
              ok, f"winners={len(won)} {json.dumps(s)} errors={errs[:2]}")
    finally:
        cleanup()


def t_claim_two_offers():
    """One closer, Ready in an empty standby room, takes two offers at once
    (two leads, each in a setter's room): one claim, one lead's room replaced;
    the other lead's room is untouched (the losing claim leaves nothing)."""
    sc.in_window()
    try:
        me = f"{RUN}-closer-two{HOST}"
        q(f"insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url) "
          f"values ({lit(str(uuid.uuid4()))}, null, 'standby', 'demo', 'meet', {lit(me)}, {lit(me)}, 'host_in', 'https://meet.google.com/str-ess-tst')")
        leads = [f"{RUN}-lead-two-a", f"{RUN}-lead-two-b"]
        rooms_ = [insert_room(host=f"{RUN}-setter{i}{HOST}", contact=leads[i], purpose="fallback", state="host_in") for i in range(2)]
        offers = [insert_offer(leads[i], [me]) for i in range(2)]
        out = burst([claim_call(offers[i], me) for i in range(2) for _ in range(5)], width=10)
        won = [o[1][0] for o in out if o[0] == "ok" and o[1] and o[1][0].get("claimed_by")]
        refused = sorted({(o[1].code, o[1].constraint or ("take_host_busy" if "take_host_busy" in o[1].text else None))
                          for o in out if o[0] == "err"}, key=str)
        states = q(f"select id::text, state from public.cockpit_sales_rooms where id in ({lit(rooms_[0])}, {lit(rooms_[1])})", write=False)
        st = {r["id"]: r["state"] for r in states}
        cancelled = [i for i in range(2) if st.get(rooms_[i]) == "cancelled"]
        check("one closer takes two offers at once (five presses each): one claim, exactly one lead's room replaced, the other untouched",
              len(won) == 1 and len(cancelled) == 1
              and set(refused) <= {("23505", "cockpit_sales_live_one_claim_per_closer"), ("P0001", "take_host_busy")},
              f"claims={len(won)} rooms={[st.get(r) for r in rooms_]} refusals={refused}")
    finally:
        cleanup()


def t_claim_host_race():
    """The take_host_busy check is a read under the offer's lock only. A
    closer with no standby room opens a room for another lead (its insert in
    flight, not yet committed) while their Take on an offer runs: the claim
    sees no room of theirs, cancels the setter's room with the lead
    ("replaced") and holds the lead with no room; the closer's other room
    then lands, so the handover's own room can never be made (one room per
    host). What must hold: the claim is refused, or it waits for the other
    room and refuses then; the setter's room is never cancelled for a room
    the closer cannot have."""
    sc.in_window()
    try:
        me = f"{RUN}-closer-race{HOST}"
        lead = f"{RUN}-lead-race"
        setter_room = insert_room(host=f"{RUN}-setter{HOST}", contact=lead, purpose="fallback", state="host_in")
        lid = insert_offer(lead, [me])
        other = room_values(host=me, contact=f"{RUN}-lead-other", purpose="fallback", state="open", provider="zoom")
        names = ", ".join(other)
        vals = ", ".join(lit(v) for v in other.values())
        # Session B: the closer's room for another lead, its insert open for two seconds
        # (a slow commit, a trigger waiting on a lock). Session A: the Take, half a second in.
        out = staggered([
            (f"begin; insert into public.cockpit_sales_rooms ({names}) values ({vals}); select pg_sleep(2); commit; select 1 as done", 0),
            (claim_call(lid, me), 0.5),
        ])
        claim = out[1]
        claimed = claim[0] == "ok" and bool(claim[1]) and bool(claim[1][0].get("claimed_by"))
        s = q(f"""select (select state from public.cockpit_sales_rooms where id = {lit(setter_room)}) as setter_state,
                         (select count(*) from public.cockpit_sales_rooms where host_email = {lit(me)}
                             and state in ('requested','creating','open','host_in','lead_in'))::int as closer_rooms,
                         (select state || '/' || coalesce(claim_room, '-') || '/' || coalesce(room_id::text, 'no room')
                            from public.cockpit_sales_live where id = {lit(lid)}) as live""", write=False)[0]
        bad = claimed and s["setter_state"] == "cancelled" and s["closer_rooms"] >= 1 and s["live"].endswith("/no room")
        check("a Take while the closer's room for another lead is being written: the setter's room with this lead is never cancelled for a room the closer cannot have",
              not bad, f"claim={'claimed' if claimed else (claim[1].text[:120] if claim[0] == 'err' else 'nothing')} "
                       f"(took {claim[2]}s) {json.dumps(s)}")
    finally:
        cleanup()


# ---------------------------------------------------------------------------
# The rooms guard on "That was not the lead" (what roomlogic.ts reads after it)
# ---------------------------------------------------------------------------

def t_guard_not_lead():
    """rooms.ts writes "That was not the lead" as state host_in, count_undo_at
    and lead_by, leaving lead_in_at as it was; roomlogic.ts then tells a
    re-delivered Zoom join of that same person from a new one by comparing its
    time with lead_in_at ("the join that was taken back, delivered again by
    Zoom, is not a new join"). The database's guard sets lead_in_at to null on
    that very write, in production (20261003a) and in 20261003d alike, so on
    the real row nothing is left to compare with: the second event of the same
    join is read as a new join. What must hold: after the press, the row still
    says when the taken-back join happened (lead_in_at, or a column of its own
    that roomlogic reads)."""
    sc.in_window()
    try:
        rid = insert_room(host=f"{RUN}-closer-nl{HOST}", contact=f"{RUN}-lead-nl", purpose="fallback", state="lead_in", provider="zoom")
        before = q(f"select lead_in_at::text as t, version from public.cockpit_sales_rooms where id = {lit(rid)}", write=False)[0]
        q(f"""update public.cockpit_sales_rooms
                 set state = 'host_in', count_undo_at = now(), lead_by = now() + interval '180 seconds', version = {int(before['version']) + 1}
               where id = {lit(rid)} and state = 'lead_in' and version = {int(before['version'])}""")
        after = q(f"select state, lead_in_at::text as t, count_undo_at is not null as undo from public.cockpit_sales_rooms where id = {lit(rid)}",
                  write=False)[0]
        # Until 20261003d is applied, production's guard clears lead_in_at on
        # this write (fixed in d, checked below). roomlogic.ts takenBack then
        # bounds the re-delivered join by count_undo_at, which the press
        # always writes: what must hold here is that the row keeps one or the
        # other (fix round 3).
        check("production guard (20261003a, until 20261003d is applied): after That was not the lead, the row still "
              "says when the taken-back join happened (lead_in_at), or when it was taken back (count_undo_at)",
              after["state"] == "host_in" and after["undo"] and (after["t"] is not None or after["undo"]),
              f"lead_in_at before={before['t']} after={after['t']} state={after['state']} count_undo_at set={after['undo']}")
    finally:
        cleanup()
    # The same write under 20261003d's guard, in one rolled-back transaction.
    text = open(D_FILE).read()
    start = text.index("create or replace function public.cockpit_sales_rooms_guard()")
    end = text.index("$$;", text.index("$$", start) + 2) + 3
    guard = text[start:end]
    req = str(uuid.uuid4())
    out = q(f"""begin;
      set local lock_timeout = '5s';
      -- 20261003d's column the guard stamps (fix round 3), in this rolled-back run only.
      alter table public.cockpit_sales_rooms add column if not exists lead_in_seen_at timestamptz;
      {guard}
      insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url)
      values ({lit(req)}, {lit(RUN + '-lead-nl-d')}, 'fallback', 'intro', 'zoom', {lit(RUN + '-closer-nld' + HOST)},
              {lit(RUN + '-closer-nld' + HOST)}, 'lead_in', 'https://zoom.example/j/1');
      update public.cockpit_sales_rooms set state = 'host_in', count_undo_at = now(), version = version + 1
       where request_id = {lit(req)}::uuid;
      select state, lead_in_at::text as t from public.cockpit_sales_rooms where request_id = {lit(req)}::uuid;
      rollback;""")
    row = (out or [{}])[0] if isinstance(out, list) else {}
    left = q(f"select count(*)::int as n from public.cockpit_sales_rooms where request_id = {lit(req)}::uuid", write=False)[0]["n"]
    check("20261003d guard (rolled back): after That was not the lead, the row still says when the taken-back join happened",
          row.get("state") == "host_in" and row.get("t") is not None and int(left) == 0,
          f"after={row} rolled back={int(left) == 0}")


CHECKS = {
    "slot_sender": t_slot_sender,
    "slot_same_request": t_slot_same_request,
    "slot_lead_gap": t_slot_lead_gap,
    "slot_per_day": t_slot_per_day,
    "slot_mixed": t_slot_mixed,
    "lease_tries": t_lease_tries,
    "claim_twenty": t_claim_twenty,
    "claim_two_offers": t_claim_two_offers,
    "claim_host_race": t_claim_host_race,
    "guard_not_lead": t_guard_not_lead,
}


def main():
    global SLOT, LEASE, CLAIM
    sys.stdout.reconfigure(line_buffering=True)
    SLOT = d_function("cockpit_sales_message_slot")
    LEASE = d_function("cockpit_sales_room_event_lease")
    CLAIM = d_function("cockpit_sales_live_claim", no_audit=True)
    names = sys.argv[1:] or list(CHECKS)
    print(f"run {RUN}: {', '.join(names)}")
    try:
        for n in names:
            for attempt in range(4):
                try:
                    CHECKS[n]()
                except (Throttled, SqlError) as e:
                    if isinstance(e, SqlError) and e.status != 429:
                        check(f"{n}: the check itself", False, f"SQL error {e.status}: {e.text[:300]}")
                        break
                    print(f"      {n}: the management API was busy ({str(e)[:80]}); run again in 20 s")
                    cleanup()
                    time.sleep(20)
                    continue
                break
            else:
                check(f"{n}: the check itself", False, "the management API was busy four times running; run it again later")
            time.sleep(REST_S)
    finally:
        cleanup()
        left = leftovers()
        clean = all(int(v) == 0 for k, v in left.items() if k != "audit")
        print(f"\nleft behind: {left}")
        check("nothing synthetic left behind (rooms, handovers, messages, events); no audit row written",
              clean and int(left["audit"]) == 0, json.dumps(left))
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)} passed, {len(failed)} failed.")
    sys.exit(0 if not failed else 1)


if __name__ == "__main__":
    main()
