#!/usr/bin/env python3
"""Concurrency and idempotency stress against the REAL live-calls tables on
Creative Triage (the three 20261003 migrations are applied there, dark).

    python3 supabase/migrations/tests/stress_concurrency.py            # every check
    python3 supabase/migrations/tests/stress_concurrency.py lease ...  # some checks by name

What it does
  Each check makes its own synthetic rows (contact_id starts with
  'stress-conc-', host and seat emails end with '@stress.invalid', event
  dedupe keys start with the run's prefix), fires up to PARALLEL requests at
  the same instant (every request sleeps until one shared moment, then
  presses), reads the outcome, and deletes exactly the rows it made. Nothing
  here calls HighLevel, Zoom, Google or Slack, and no database function that
  writes cockpit_audit_log is ever committed: the audit log cannot be
  deleted from, so the claim function itself is only run inside a
  transaction that rolls back.

  The pg_cron jobs mahara-sales-rooms-sweep (every minute, at :00) and
  mahara-sales-watchdog (every 5 minutes) run on these tables. A room with
  a lead that is not final would be posted to sales-live/cron as a tick if a
  sweep ran while it existed, so every check that commits such a room starts
  only between second 4 and second 38 of a minute and is gone in seconds.
  Events here use source 'stress', which the sweep never replays.

  Requests go through the Supabase management API (database/query), each on
  its own connection. PARALLEL stays at 20: the database allows 90
  connections and the cockpits need theirs.

Round 2 (r2_*): Not now from thirty closers at once on a real handover row;
the real claim function (rolled back) for a closer who hosts another lead's
room; the claim's standby read racing the sweep's standby refresh (two
sessions in a set order, committed synthetic standby rooms that live for
seconds); the real sweep (rolled back) racing the worker's open, and twenty
sweeps at once.

Exit code 0 only when every check held and no synthetic row is left.
"""
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor

REF = "bldgtotkfmhoxmlzowdx"
PARALLEL = 20
PACE_S = 6
RUN = "stress-conc-" + secrets.token_hex(4)
HOST = "@stress.invalid"


def token() -> str:
    t = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if t:
        return t
    return open(os.path.expanduser("~/.config/mahara/sb_mgmt_token")).read().strip()


TOKEN = token()


class SqlError(Exception):
    def __init__(self, status, text):
        super().__init__(text)
        self.status = status
        self.text = text

    @property
    def code(self):
        m = re.search(r"ERROR:\s+([0-9A-Z]{5}):", self.text)
        return m.group(1) if m else None

    @property
    def constraint(self):
        m = re.search(r'constraint \\?"([a-z0-9_]+)\\?"', self.text)
        return m.group(1) if m else None


def hardening() -> str:
    """Migration 20261003d's statements (not applied in production yet), for a
    rolled-back transaction, so a check reads the repo's functions."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import run_checks  # noqa: E402
    return run_checks.hardening_sql()


def q(sql: str, write: bool = True):
    """One request on its own connection. A throttled or refused-for-connections
    request never ran, so it is sent again; any other error is the answer."""
    body = json.dumps({"query": sql, "read_only": not write}).encode()
    for attempt in range(8):
        req = urllib.request.Request(
            f"https://api.supabase.com/v1/projects/{REF}/database/query", data=body, method="POST",
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "mahara-sales/1"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read() or b"null") or []
        except urllib.error.HTTPError as e:
            text = e.read().decode()
            if e.code == 429 or "too many clients" in text or "remaining connection slots" in text:
                time.sleep(2.0 * (attempt + 1))
                continue
            raise SqlError(e.code, text)
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as e:
            # A connection refused or reset before an answer (the TLS handshake)
            # never reached the database: sent again. Anything else is the answer.
            reason = getattr(e, "reason", e)
            if isinstance(reason, (ConnectionResetError, ConnectionRefusedError)) and attempt < 7:
                time.sleep(2.0 * (attempt + 1))
                continue
            raise SqlError(0, f"no answer: {reason}")
    raise SqlError(429, "throttled 8 times")


def lit(v) -> str:
    """A SQL literal for a value this script made (never outside input)."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def burst(sqls, lead_s: float = 2.5, width: int = PARALLEL):
    """Every statement waits for one shared moment, then runs: real parallel presses.
    It waits first while the database is busy (other agents, the cockpits), so a
    burst never takes the connections the cockpits need."""
    for _ in range(30):
        row = q("select (select count(*) from pg_stat_activity)::int as n, "
                "(clock_timestamp() + make_interval(secs => %s))::text as at" % lead_s, write=False)[0]
        if row["n"] + len(sqls) <= 60:
            break
        time.sleep(2)
    at = row["at"]
    # The management API answers the last statement that returned rows, so a
    # write that matched nothing would show the sleep's row: each press is
    # counted in a CTE that always answers one row.
    wrapped = [f"select pg_sleep_until({lit(at)}::timestamptz);\n{press(s)}" for s in sqls]

    def one(s):
        try:
            return ("ok", q(s))
        except SqlError as e:
            return ("err", e)

    with ThreadPoolExecutor(min(width, len(wrapped))) as ex:
        out = list(ex.map(one, wrapped))
    # The management API throttles bursts: a short rest keeps the next one parallel.
    time.sleep(PACE_S)
    return out


def press(sql: str) -> str:
    """A write as one row: n (rows it changed) and rows (what it returned)."""
    if re.match(r"\s*(update|insert|delete)\b", sql, re.I):
        return f"with p as ({sql.strip().rstrip(';')}) select count(*)::int as n, coalesce(json_agg(p), '[]'::json) as rows from p"
    return sql


def landed(o) -> bool:
    """A burst answer whose write changed a row."""
    return o[0] == "ok" and bool(o[1]) and int(o[1][0].get("n", 0)) > 0


def first_row(o) -> dict:
    return (o[1][0].get("rows") or [{}])[0]


def in_window():
    """Start only between second 4 and 38 of a minute: the sweep runs at :00."""
    for _ in range(90):
        s = float(q("select extract(second from clock_timestamp())::float as s", write=False)[0]["s"])
        if 4 <= s <= 38:
            return
        time.sleep(max(0.5, (64 - s) if s > 38 else 4 - s))


# ---------------------------------------------------------------------------
# Rows this run makes, and their removal (only this run's rows, by prefix)
# ---------------------------------------------------------------------------

def room_sql(i, *, request_id=None, contact=None, host=None, state="requested", purpose="manual", extra=None, no_contact=False):
    cols = {
        "request_id": request_id or str(uuid.uuid4()),
        "contact_id": None if no_contact else contact if contact is not None else f"{RUN}-lead-{i}",
        "purpose": purpose,
        "call_kind": "intro",
        "provider": "meet",
        "host_email": host or f"{RUN}-host-{i}{HOST}",
        "made_by": "stress-conc",
        "state": state,
    }
    if state in ("open", "host_in", "lead_in"):
        cols["join_url"] = "https://meet.google.com/str-ess-tst"
    cols.update(extra or {})
    names = ", ".join(cols)
    vals = ", ".join(lit(v) for v in cols.values())
    return f"insert into public.cockpit_sales_rooms ({names}) values ({vals}) returning id, code, version, state"


MINE_ROOMS = f"(contact_id like '{RUN}-%' or host_email like '{RUN}-%{HOST}')"


def cleanup():
    q(f"""
      update public.cockpit_sales_live set room_id = null where contact_id like '{RUN}-%';
      delete from public.cockpit_sales_room_events
       where dedupe_key like '{RUN}%'
          or room_id in (select id from public.cockpit_sales_rooms where {MINE_ROOMS});
      update public.cockpit_sales_rooms set replaced_by = null where {MINE_ROOMS} and replaced_by is not null;
      delete from public.cockpit_sales_rooms where {MINE_ROOMS};
      delete from public.cockpit_sales_live where contact_id like '{RUN}-%';
    """)


def leftovers():
    return q(f"""
      select (select count(*) from public.cockpit_sales_rooms where {MINE_ROOMS}) as rooms,
             (select count(*) from public.cockpit_sales_live where contact_id like '{RUN}-%') as live,
             (select count(*) from public.cockpit_sales_room_events where dedupe_key like '{RUN}%') as events,
             (select count(*) from public.cockpit_audit_log where actor_email like '{RUN}-%' or entity_id like '{RUN}-%') as audit
    """, write=False)[0]


# ---------------------------------------------------------------------------
# The checks
# ---------------------------------------------------------------------------

RESULTS = []


def refusals(out):
    """The distinct (SQLSTATE, constraint) of a burst's errors; an error neither names shows its own words."""
    return sorted({(o[1].code, o[1].constraint) if o[1].code else ("?", o[1].text[:160]) for o in out if o[0] == "err"}, key=str)


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))


def t_lease():
    """room.event delivered 20 times at once, five rounds (100 presses): the
    lease (cockpit_sales_room_event_lease) gives each event to exactly one."""
    in_window()
    keys = [f"{RUN}:lease:{n}" for n in range(5)]
    rows = q("insert into public.cockpit_sales_room_events (kind, source, dedupe_key, text) values "
             + ", ".join(f"('stress.lease', 'stress', {lit(k)}, 'Stress check, removed at once.')" for k in keys)
             + " returning id, dedupe_key")
    try:
        for n, r in enumerate(rows):
            by = f"p_event_id => {lit(r['id'])}::uuid" if n % 2 == 0 else f"p_dedupe_key => {lit(r['dedupe_key'])}"
            out = burst([f"select public.cockpit_sales_room_event_lease({by}, p_seconds => 30) as got" for _ in range(PARALLEL)])
            errs = [o[1] for o in out if o[0] == "err"]
            got = [o[1][0]["got"] for o in out if o[0] == "ok" and o[1] and o[1][0].get("got")]
            check(f"lease round {n + 1}: {PARALLEL} room.event runs at once, one holds the event",
                  len(got) == 1 and not errs, f"holders={len(got)} errors={[e.code for e in errs]}")
        # A released event (lease_until null) is taken again by exactly one of the next burst.
        q(f"update public.cockpit_sales_room_events set lease_until = null where dedupe_key = {lit(keys[0])}")
        out = burst([f"select public.cockpit_sales_room_event_lease(p_dedupe_key => {lit(keys[0])}, p_seconds => 30) as got"
                     for _ in range(PARALLEL)])
        got = [o for o in out if o[0] == "ok" and o[1] and o[1][0].get("got")]
        check("a released event is taken again by exactly one of twenty", len(got) == 1, f"holders={len(got)}")
        # A handled event is never leased, whatever arrives at once.
        q(f"update public.cockpit_sales_room_events set handled_at = now(), lease_until = null where dedupe_key = {lit(keys[1])}")
        out = burst([f"select public.cockpit_sales_room_event_lease(p_dedupe_key => {lit(keys[1])}, p_seconds => 30) as got"
                     for _ in range(PARALLEL)])
        got = [o for o in out if o[0] == "ok" and o[1] and o[1][0].get("got")]
        check("a handled event is leased by none of twenty", len(got) == 0, f"holders={len(got)}")
    finally:
        cleanup()


def t_same_request():
    """A double press (and a retry while the first is still in flight): twenty
    inserts with ONE request_id for one lead and one host. One room; every
    other insert must be refused by cockpit_sales_rooms_request_id_key, the
    only name sales-api's createRoom reads as "the same request again" (a
    one_per_lead or one_per_host name would tell the press that made the room
    that the lead already has one)."""
    in_window()
    rid = str(uuid.uuid4())
    try:
        out = burst([room_sql(0, request_id=rid) for _ in range(PARALLEL)])
        made = [o for o in out if landed(o)]
        names = refusals(out)
        n = q(f"select count(*)::int as n from public.cockpit_sales_rooms where request_id = {lit(rid)}", write=False)[0]["n"]
        check("twenty inserts with one request id make one room", len(made) == 1 and n == 1, f"made={len(made)} rows={n}")
        check("every twin is refused on cockpit_sales_rooms_request_id_key (sales-api's twin path), never another name",
              names == [("23505", "cockpit_sales_rooms_request_id_key")], f"refusals={names}")
    finally:
        cleanup()


def t_one_per_lead_host():
    """Fifty-style presses with their own request ids: one room per lead, one per host."""
    in_window()
    try:
        out = burst([room_sql(i, contact=f"{RUN}-lead-one", host=f"{RUN}-host-{i}{HOST}") for i in range(PARALLEL)])
        made = [o for o in out if landed(o)]
        names = refusals(out)
        check("twenty rooms for one lead at once: one made, the rest refused on one_per_lead",
              len(made) == 1 and names == [("23505", "cockpit_sales_rooms_one_per_lead")], f"made={len(made)} refusals={names}")
        cleanup()
        in_window()
        out = burst([room_sql(i, host=f"{RUN}-host-one{HOST}") for i in range(PARALLEL)])
        made = [o for o in out if landed(o)]
        names = refusals(out)
        check("twenty rooms for one host at once: one made, the rest refused on one_per_host",
              len(made) == 1 and names == [("23505", "cockpit_sales_rooms_one_per_host")], f"made={len(made)} refusals={names}")
        cleanup()
        in_window()
        out = burst([room_sql(i) for i in range(PARALLEL)])
        codes = q(f"select count(*)::int as n, count(distinct code)::int as codes from public.cockpit_sales_rooms where {MINE_ROOMS}",
                  write=False)[0]
        check("twenty different rooms at once: all made, twenty different codes (the guard's code pick under load)",
              all(o[0] == "ok" for o in out) and codes["n"] == PARALLEL and codes["codes"] == PARALLEL, f"{codes}")
    finally:
        cleanup()


def t_mark_vs_opens():
    """A rep's guarded press (state and version, as roomlogic guardFilter
    writes it) racing the lead's link opens (the door's open columns): the
    press lands exactly once, the opens never move the version, the first
    open is written once."""
    in_window()
    try:
        r = q(room_sql(0, state="open"))[0]
        rid, v = r["id"], int(r["version"])
        marks = [f"""update public.cockpit_sales_rooms set state = 'host_in', host_in_at = now()
                      where id = {lit(rid)} and state = 'open' and version = {v} and host_in_at is null
                      returning version""" for _ in range(PARALLEL // 2)]
        opens = []
        for k in range(PARALLEL // 2):
            at = f"now() - interval '{k} seconds'"
            dev = ["phone", "tablet", "computer"][k % 3]
            opens.append(f"""update public.cockpit_sales_rooms set first_open_at = {at}, last_open_at = {at}, open_device = {lit(dev)}
                              where id = {lit(rid)} and first_open_at is null returning version""")
        out = burst(marks + opens)
        landed_ = [o for o in out[: len(marks)] if landed(o)]
        opened = [o for o in out[len(marks):] if landed(o)]
        errs = [o[1].text[:120] for o in out if o[0] == "err"]
        row = q(f"select state, version, first_open_at is not null as opened, open_device from public.cockpit_sales_rooms where id = {lit(rid)}",
                write=False)[0]
        check("ten I'm in presses and ten link opens at once: the press lands once, version moves by exactly one",
              len(landed_) == 1 and row["state"] == "host_in" and int(row["version"]) == v + 1 and not errs,
              f"landed={len(landed_)} version {v}->{row['version']} errors={errs}")
        check("the first open is written once and the device kept", len(opened) == 1 and row["opened"] and row["open_device"],
              f"opens landed={len(opened)} device={row['open_device']}")
        # The later opens: twenty last_open_at writes at once, each a different time; the latest stays.
        in_window()
        later = [f"""update public.cockpit_sales_rooms set last_open_at = now() + interval '{k} seconds', first_open_at = now() + interval '1 hour'
                      where id = {lit(rid)} returning version""" for k in range(PARALLEL)]
        before = q(f"select first_open_at::text as f from public.cockpit_sales_rooms where id = {lit(rid)}", write=False)[0]["f"]
        out = burst(later)
        row2 = q(f"""select version, first_open_at::text as f, extract(epoch from (last_open_at - first_open_at))::int as gap
                      from public.cockpit_sales_rooms where id = {lit(rid)}""", write=False)[0]
        check("twenty later opens at once: the first open never moves later, the version never moves",
              row2["f"] == before and int(row2["version"]) == v + 1 and all(o[0] == "ok" for o in out),
              f"first {before} -> {row2['f']}, version {row2['version']}")
    finally:
        cleanup()


def t_worker_vs_cancel():
    """Cancel while the worker opens the room (contract-v2 section 4): the
    worker's open (state creating and its run) and the rep's cancel (state
    creating and the version) arrive together, ten of each. Exactly one kind
    lands; a finished room is never opened again."""
    in_window()
    try:
        run = f"{RUN}-run"
        r = q(room_sql(0, state="creating", extra={"worker_run": run, "claimed_at": "now"}).replace("'now'", "now()"))[0]
        rid, v = r["id"], int(r["version"])
        opens = [f"""update public.cockpit_sales_rooms set state = 'open', join_url = 'https://meet.google.com/str-ess-tst',
                         provider_meeting_id = 'stress', opened_at = now(), error = null, version = {v + 1}
                      where id = {lit(rid)} and state = 'creating' and worker_run = {lit(run)} returning state""" for _ in range(PARALLEL // 2)]
        cancels = [f"""update public.cockpit_sales_rooms set state = 'cancelled', result = 'cancelled', ended_at = now()
                        where id = {lit(rid)} and state = 'creating' and version = {v} returning state""" for _ in range(PARALLEL // 2)]
        out = burst(opens + cancels)
        o_ok = [o for o in out[: len(opens)] if landed(o)]
        c_ok = [o for o in out[len(opens):] if landed(o)]
        errs = [o[1].text[:100] for o in out if o[0] == "err"]
        row = q(f"select state, version from public.cockpit_sales_rooms where id = {lit(rid)}", write=False)[0]
        check("ten worker opens and ten cancels at once: exactly one write lands, the version moves by one",
              len(o_ok) + len(c_ok) == 1 and int(row["version"]) == v + 1 and not errs,
              f"opens={len(o_ok)} cancels={len(c_ok)} state={row['state']} version={row['version']} errors={errs}")
        # Now the losers try once more, all at once: a finished room never moves; an open room is not re-opened.
        out = burst([f"update public.cockpit_sales_rooms set state = 'open' where id = {lit(rid)} returning state"
                     for _ in range(PARALLEL // 2)])
        if row["state"] == "cancelled":
            errs = [o[1] for o in out if o[0] == "err"]
            check("a cancelled room refuses every later open (the guard trigger), under load",
                  len(errs) == len(out) and all(e.code == "P0001" for e in errs), f"refused={len(errs)}/{len(out)}")
        else:
            row2 = q(f"select state, version from public.cockpit_sales_rooms where id = {lit(rid)}", write=False)[0]
            check("an open room written open again ten times at once keeps its version",
                  int(row2["version"]) == v + 1, f"version={row2['version']}")
    finally:
        cleanup()


def t_claim_statement():
    """Two closers (twenty) taking one offer. The claim function writes the
    audit log, which cannot be deleted, so committed parallel presses run
    its first statement word for word (the only step two claims race on):
    exactly one closer gets the row. Then one closer taking ten offers at
    once: cockpit_sales_live_one_claim_per_closer lets one through and names
    itself to the rest, which sales-api reads as "You already have a live call.\""""
    in_window()
    try:
        closers = [f"{RUN}-closer-{i}{HOST}" for i in range(PARALLEL)]
        arr = "array[" + ",".join(lit(c) for c in closers) + "]::text[]"
        lid = q(f"""insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, offered_to, offer_until)
                    values ({lit(str(uuid.uuid4()))}, {lit(RUN + '-lead-offer')}, {lit(RUN + '-setter' + HOST)}, 'demo', 'manual',
                            {arr}, now() + interval '10 minutes') returning id""")[0]["id"]
        out = burst([f"""update public.cockpit_sales_live as x set state = 'claimed', claimed_by = {lit(c)}, claimed_at = now(), claim_room = null
                          where x.id = {lit(lid)} and x.state = 'offered' and x.offer_until > now() and {lit(c)} = any (x.offered_to)
                          returning x.claimed_by, x.version""" for c in closers])
        won = [first_row(o) for o in out if landed(o)]
        errs = [o[1].text[:100] for o in out if o[0] == "err"]
        row = q(f"select state, claimed_by, version from public.cockpit_sales_live where id = {lit(lid)}", write=False)[0]
        check("twenty closers take one offer at once: exactly one holds it, the version moves once",
              len(won) == 1 and row["claimed_by"] == won[0]["claimed_by"] and int(row["version"]) == 2 and not errs,
              f"winners={len(won)} version={row['version']} errors={errs}")
        cleanup()
        in_window()
        me = f"{RUN}-closer-x{HOST}"
        ids = q("insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, offered_to, offer_until) values "
                + ", ".join(f"({lit(str(uuid.uuid4()))}, {lit(f'{RUN}-lead-o{i}')}, {lit(RUN + '-setter' + HOST)}, 'demo', 'manual', "
                            f"array[{lit(me)}]::text[], now() + interval '10 minutes')" for i in range(10))
                + " returning id")
        out = burst([f"""update public.cockpit_sales_live as x set state = 'claimed', claimed_by = {lit(me)}, claimed_at = now()
                          where x.id = {lit(r['id'])} and x.state = 'offered' and x.offer_until > now() and {lit(me)} = any (x.offered_to)
                          returning x.id""" for r in ids])
        won = [o for o in out if landed(o)]
        names = refusals(out)
        check("one closer takes ten offers at once: one claim, nine refused on live_one_claim_per_closer",
              len(won) == 1 and names == [("23505", "cockpit_sales_live_one_claim_per_closer")], f"claims={len(won)} refusals={names}")
    finally:
        cleanup()


def t_claim_function_same_closer():
    """The real claim function, rolled back: the closer who already holds the
    offer calls it again (the second tab, the retry). It answers nothing, the
    same empty answer as "someone else took it"; sales-api must look at the
    row before it says "Someone else took this lead." (see
    stress_concurrency_rooms.test.ts). Nothing persists: rollback."""
    me = f"{RUN}-closer-a{HOST}"
    other = f"{RUN}-closer-b{HOST}"
    rows = q(f"""
      begin;
      create temp table sc_out (step text, n int) on commit drop;
      insert into public.cockpit_sales_live (id, request_id, contact_id, asked_by, kind, reason, offered_to, offer_until)
      values ('00000000-0000-4000-8000-0000000c0de1', {lit(str(uuid.uuid4()))}, {lit(RUN + '-lead-fn')}, {lit(RUN + '-setter' + HOST)},
              'demo', 'manual', array[{lit(me)}, {lit(other)}]::text[], now() + interval '10 minutes');
      insert into sc_out select 'first', count(*) from public.cockpit_sales_live_claim('00000000-0000-4000-8000-0000000c0de1', {lit(me)}, null);
      insert into sc_out select 'same_closer_again', count(*) from public.cockpit_sales_live_claim('00000000-0000-4000-8000-0000000c0de1', {lit(me)}, null);
      insert into sc_out select 'other_closer', count(*) from public.cockpit_sales_live_claim('00000000-0000-4000-8000-0000000c0de1', {lit(other)}, null);
      insert into sc_out select 'claimed_events', count(*) from public.cockpit_sales_room_events where dedupe_key like 'live.claimed:00000000-0000-4000-8000-0000000c0de1:%';
      select step, n from sc_out order by step;
      rollback;
    """)
    got = {r["step"]: int(r["n"]) for r in rows}
    check("claim function (rolled back): first take 1 row, a second take by anyone 0 rows, one live.claimed event",
          got == {"first": 1, "same_closer_again": 0, "other_closer": 0, "claimed_events": 1}, json.dumps(got))


# ---------------------------------------------------------------------------
# Round 2: wider bursts, two sessions in a set order, the sweep itself
# ---------------------------------------------------------------------------

def staggered(sqls_with_delay):
    """Each (sql, delay_s) starts delay_s after one shared moment, on its own
    connection: session A takes its locks, session B arrives while A holds them."""
    row = q("select (clock_timestamp() + interval '2.5 seconds')::text as at", write=False)[0]
    at = row["at"]

    def one(item):
        sql, delay = item
        t0 = time.time()
        try:
            out = ("ok", q(f"select pg_sleep_until({lit(at)}::timestamptz + make_interval(secs => {delay}));\n{sql}"))
        except SqlError as e:
            out = ("err", e)
        return out + (round(time.time() - t0, 2),)

    with ThreadPoolExecutor(len(sqls_with_delay)) as ex:
        out = list(ex.map(one, sqls_with_delay))
    time.sleep(PACE_S)
    return out


def t_r2_decline():
    """Not now from thirty closers at once, each the way rooms.ts liveDecline
    writes it (read declined_by, write only where it is still what was read,
    up to min(60, 5 + offered_to) tries), on a real handover row: every one
    lands, none is told "This changed a moment ago.", and the version (what a
    closer acts on) never moves."""
    in_window()
    n = 30
    closers = [f"{RUN}-dcl-{i}{HOST}" for i in range(n)]
    arr = "array[" + ",".join(lit(c) for c in closers) + "]::text[]"
    try:
        lid = q(f"""insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, offered_to, offer_until)
                    values ({lit(str(uuid.uuid4()))}, {lit(RUN + '-lead-decline')}, {lit(RUN + '-setter' + HOST)}, 'demo', 'on_call',
                            {arr}, now() + interval '10 minutes') returning id""")[0]["id"]
        tries = min(60, 5 + n)
        fn = """create function pg_temp.decline(p_id uuid, p_me text, p_tries int) returns int language plpgsql as $f$
                declare d text[]; s text; i int;
                begin
                  for i in 1 .. p_tries loop
                    select x.declined_by, x.state into d, s from public.cockpit_sales_live as x where x.id = p_id;
                    if s is distinct from 'offered' then return -2; end if;
                    if p_me = any (d) then return i; end if;
                    update public.cockpit_sales_live as x set declined_by = d || p_me
                     where x.id = p_id and x.state = 'offered' and x.declined_by = d;
                    if found then return i; end if;
                  end loop;
                  return -1;
                end $f$;"""
        out = burst([f"{fn}\nselect pg_temp.decline({lit(lid)}::uuid, {lit(c)}, {tries}) as tries" for c in closers], width=n)
        got = [int(o[1][0]["tries"]) for o in out if o[0] == "ok" and o[1]]
        errs = [o[1].text[:120] for o in out if o[0] == "err"]
        row = q(f"select version, cardinality(declined_by) as n, (select count(distinct v) from unnest(declined_by) as v) as uniq "
                f"from public.cockpit_sales_live where id = {lit(lid)}", write=False)[0]
        check(f"{n} closers press Not now at once: every one lands within its tries, the list holds each once, the version stays",
              len(got) == n and all(g >= 1 for g in got) and int(row["n"]) == n and int(row["uniq"]) == n and int(row["version"]) == 1 and not errs,
              f"landed={sum(1 for g in got if g >= 1)} gave_up={sum(1 for g in got if g < 0)} most_tries={max(got or [0])} "
              f"list={row['n']} version={row['version']} errors={errs[:2]}")
    finally:
        cleanup()


def t_r2_claim_other_room():
    """The real claim function (20261003d applied in the same rolled-back
    transaction): the offer reached a closer while they were Ready; they then
    opened a room for another lead from the dialer and pressed Take. Before
    the fix the claim succeeded, cancelled the setter's room that the lead is
    being handed over from ("replaced") and adopted nothing, so sales-api's
    room for the closer was refused (one room per host): the lead lost their
    room and the closer held a lead with none. Now it is refused
    (take_host_busy) before anything moves."""
    me = f"{RUN}-closer-busy{HOST}"
    setter_ = f"{RUN}-setter-busy{HOST}"
    rows = q(f"""
      begin;
      {hardening()}
      insert into public.cockpit_sales_live (id, request_id, contact_id, asked_by, kind, reason, offered_to, offer_until)
      values ('00000000-0000-4000-8000-0000000c0de2', {lit(str(uuid.uuid4()))}, {lit(RUN + '-lead-take')}, {lit(setter_)},
              'demo', 'on_call', array[{lit(me)}]::text[], now() + interval '10 minutes');
      insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, trigger, call_kind, provider, host_email, made_by, state, join_url)
      values ('00000000-0000-4000-8000-0000000c0de3', {lit(str(uuid.uuid4()))}, {lit(RUN + '-lead-take')}, 'fallback', 'no_answer', 'intro', 'meet',
              {lit(setter_)}, 'stress-conc', 'host_in', 'https://meet.google.com/str-ess-tst');
      insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, trigger, call_kind, provider, host_email, made_by, state, join_url)
      values ({lit(str(uuid.uuid4()))}, {lit(RUN + '-lead-other')}, 'fallback', 'no_answer', 'intro', 'zoom',
              {lit(me)}, 'stress-conc', 'host_in', 'https://us06web.zoom.us/j/1');
      create temp table sc_claim (claim_room text, state text, room_id uuid, refused text) on commit drop;
      do $c$
      begin
        insert into sc_claim (claim_room, state, room_id)
        select claim_room, state, room_id from public.cockpit_sales_live_claim('00000000-0000-4000-8000-0000000c0de2', {lit(me)}, null);
      exception when others then
        insert into sc_claim (refused) values (left(sqlerrm, 200));
      end
      $c$;
      select (select count(*) from sc_claim where refused is null)::int as claimed,
             (select claim_room from sc_claim where refused is null) as claim_room,
             (select refused from sc_claim where refused is not null) as refused,
             (select state from public.cockpit_sales_rooms where id = '00000000-0000-4000-8000-0000000c0de3') as setter_room,
             (select end_reason from public.cockpit_sales_rooms where id = '00000000-0000-4000-8000-0000000c0de3') as setter_reason;
      rollback;
    """)
    got = rows[0] if rows else {}
    check("a Take from a closer who hosts another lead's room leaves the setter's room with this lead open (or is refused)",
          int(got.get("claimed") or 0) == 0 or got.get("setter_room") in ("open", "host_in", "lead_in"), json.dumps(got))


def t_r2_standby_refresh_vs_claim():
    """The sweep's R5 refresh (end the old standby room and make a fresh one
    in the same transaction) and a Take arriving while it runs. The claim's
    standby read (cockpit_sales_live_claim, word for word) waits for the old
    room's lock, then finds it ended, and cannot see the fresh room the sweep
    made: it adopts nothing, although the closer has a standby room. Then
    sales-api's handover room is refused (one room per host)."""
    in_window()
    h = f"{RUN}-host-sb{HOST}"
    try:
        old = q(room_sql(0, host=h, no_contact=True, purpose="standby", state="open"))[0]["id"]
        refresh = f"""
          begin;
          select x.id from public.cockpit_sales_rooms as x where x.id = {lit(old)} for update;
          update public.cockpit_sales_rooms set state = 'ended', end_reason = 'standby_refresh' where id = {lit(old)};
          insert into public.cockpit_sales_rooms (request_id, purpose, call_kind, provider, host_email, made_by)
          values (gen_random_uuid(), 'standby', 'intro', 'meet', {lit(h)}, 'stress-conc');
          select pg_sleep(3);
          commit;
          select 1 as done;"""
        # The claim's two reads since fix round 3 (20261003d): the second,
        # with a snapshot of its own, sees the room the refresh made.
        pick = f"""select x.id from public.cockpit_sales_rooms as x
             where x.host_email = {lit(h)} and x.purpose = 'standby' and x.contact_id is null
               and x.state in ('requested', 'creating', 'open', 'host_in')
             order by x.requested_at desc
             limit 1
             for update"""
        claim_read = f"""
          begin;
          create temp table sc_pick (id uuid) on commit drop;
          insert into sc_pick {pick};
          insert into sc_pick select p.id from ({pick}) as p where not exists (select 1 from sc_pick);
          select (select count(*) from sc_pick)::int as adopted;
          rollback;"""
        out = staggered([(refresh, 0), (claim_read, 1)])
        b = out[1]
        adopted = int(b[1][0]["adopted"]) if b[0] == "ok" and b[1] else None
        fresh = q(f"select count(*)::int as n from public.cockpit_sales_rooms where host_email = {lit(h)} "
                  f"and purpose = 'standby' and state in ('requested', 'creating', 'open', 'host_in')", write=False)[0]["n"]
        check("a Take during the standby refresh finds the closer's standby room (old or fresh) to adopt",
              adopted == 1, f"adopted={adopted} fresh_standby_rooms_now={fresh} waited={b[2]}s "
              f"refresh={'ok' if out[0][0] == 'ok' else out[0][1].text[:120]}")
    finally:
        cleanup()


def t_r2_sweep_vs_worker():
    """The worker opening a room (its guarded write, held in a transaction for
    a few seconds as a slow answer holds it) while the real sweep runs
    (rolled back) with that room past R2's create timeout: the sweep skips
    the locked room, never waits on it, never fails it; the worker's open
    lands. Then twenty sweeps at once (rolled back): exactly one runs."""
    in_window()
    try:
        run = f"{RUN}-run"
        rid = q(room_sql(0, state="creating", extra={"worker_run": run}))[0]["id"]
        q(f"update public.cockpit_sales_rooms set claimed_at = now() - interval '5 minutes', requested_at = now() - interval '5 minutes' "
          f"where id = {lit(rid)}")
        worker = f"""
          begin;
          update public.cockpit_sales_rooms set state = 'open', join_url = 'https://meet.google.com/str-ess-tst',
                 provider_meeting_id = 'stress', opened_at = now(), error = null, version = version + 1
           where id = {lit(rid)} and state = 'creating' and worker_run = {lit(run)};
          select pg_sleep(4);
          commit;
          select 1 as done;"""
        sweep = """
          begin;
          create temp table sw_t on commit drop as select clock_timestamp() as t0;
          create temp table sw_out on commit drop as select public.cockpit_sales_rooms_sweep() as r;
          select (r ? 'skipped') as skipped, coalesce((r ->> 'create_timeout')::int, -1) as create_timeout,
                 coalesce(r -> 'errors', '[]'::jsonb)::text as errors,
                 round(extract(epoch from clock_timestamp() - (select t0 from sw_t))::numeric, 2)::float as secs from sw_out;
          rollback;"""
        out = staggered([(worker, 0), (sweep, 1)])
        s = out[1]
        res = s[1][0] if s[0] == "ok" and s[1] else {}
        row = q(f"select state from public.cockpit_sales_rooms where id = {lit(rid)}", write=False)[0]
        check("the sweep runs past a room the worker is opening (skip locked): no wait, no failure, the open lands",
              s[0] == "ok" and not res.get("skipped") and int(res.get("create_timeout", -1)) == 0 and res.get("errors") == "[]"
              and float(res.get("secs", 99)) < 2.0 and row["state"] == "open",
              f"sweep={res or s[1].text[:160]} room={row['state']}")
        cleanup()
        in_window()
        many = """
          begin;
          create temp table sw_many on commit drop as select public.cockpit_sales_rooms_sweep() as r;
          select pg_sleep(1.5);
          select (r ? 'skipped') as skipped from sw_many;
          rollback;"""
        out = burst([many for _ in range(20)])
        ran = [o for o in out if o[0] == "ok" and o[1] and o[1][0].get("skipped") is False]
        errs = [o[1].text[:120] for o in out if o[0] == "err"]
        check("twenty sweeps at once (rolled back): exactly one runs, the rest step aside", len(ran) == 1 and not errs,
              f"ran={len(ran)} errors={errs[:2]}")
    finally:
        cleanup()


CHECKS = {
    "lease": t_lease,
    "same_request": t_same_request,
    "one_per": t_one_per_lead_host,
    "mark_vs_opens": t_mark_vs_opens,
    "worker_vs_cancel": t_worker_vs_cancel,
    "claim": t_claim_statement,
    "claim_fn": t_claim_function_same_closer,
    "r2_decline": t_r2_decline,
    "r2_claim_other_room": t_r2_claim_other_room,
    "r2_standby_refresh": t_r2_standby_refresh_vs_claim,
    "r2_sweep_vs_worker": t_r2_sweep_vs_worker,
}


def main():
    sys.stdout.reconfigure(line_buffering=True)
    names = sys.argv[1:] or list(CHECKS)
    print(f"run {RUN}: {', '.join(names)}")
    try:
        for n in names:
            try:
                CHECKS[n]()
            except SqlError as e:
                check(f"{n}: the check itself", False, f"SQL error {e.status}: {e.text[:300]}")
    finally:
        cleanup()
        left = leftovers()
        clean = all(int(v) == 0 for k, v in left.items() if k != "audit")
        print(f"\nleft behind: {left}")
        check("nothing synthetic left behind (rooms, handovers, events); no audit row written", clean and int(left["audit"]) == 0,
              json.dumps(left))
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)} passed, {len(failed)} failed.")
    sys.exit(0 if not failed else 1)


if __name__ == "__main__":
    main()
