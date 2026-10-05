#!/usr/bin/env python3
"""Second series, round 1: concurrency and idempotency against the REAL
live-calls tables and functions on Creative Triage (20261003a, b, c and d
applied, dark: every switch off, rooms.test_only true).

    python3 supabase/migrations/tests/stress2_concurrency.py              # every check
    python3 supabase/migrations/tests/stress2_concurrency.py slot_sender  # one, by name

What is new here
  - public.cockpit_sales_message_slot itself (d applied; round 3 ran a
    pg_temp copy) under 100 callers per check: the sender's ceiling, one
    request id pressed 100 times, the lead's two-minute gap for templates
    with free messages beside it, and the day's template ceiling. The
    database allows 90 connections and the cockpits need theirs, so the 100
    go in bursts of up to WIDTH that each wait for one shared moment (the
    ceiling is crossed inside a burst, with every caller of that burst
    contending for the same locks).
  - The handover offer's end and a press that lands after it: the real
    claim function and the real sweep, in one transaction that rolls back.

Synthetic rows only: contact ids start with 'stress-', every sender and
seat email ends with '@stress.invalid'; each check deletes exactly the rows
it made (messages by this run's contact prefix). Nothing here calls
HighLevel, Zoom, Google or Slack. The sweep check runs inside a transaction
that rolls back (its pg_net posts and audit rows go with it), started
between second 4 and 38 of a minute so the cron sweep (at :00) is not
holding the sweep's lock.

Exit code 0 only when every check held and nothing synthetic is left.
"""
import json
import os
import secrets
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stress_concurrency as sc  # noqa: E402  (q, lit, SqlError, in_window)

lit, SqlError, in_window = sc.lit, sc.SqlError, sc.in_window

import re  # noqa: E402

import run_checks  # noqa: E402

# Fix round 1 (4 October 2026): the repo's 20261004a is not applied in
# production yet, so the checks of what it changed run it themselves: the
# claim and the sweep inside the check's own rolled-back transaction, and the
# message slot as a pg_temp copy made on each burst connection.
HARDENING_2 = run_checks.HARDENING_2
_MIG2 = run_checks.strip_transaction(HARDENING_2, open(os.path.join(run_checks.MIGRATIONS, HARDENING_2)).read())


def _function_text(name: str) -> str:
    m = re.search(r"create or replace function public\." + name + r"\(.*?\n\$\$;", _MIG2, re.S)
    if not m:
        raise SystemExit(f"{HARDENING_2} has no function {name}.")
    return m.group(0)


# The slot as 20261004a makes it, on the burst's own connection (pg_temp), with
# the words helper it calls; the tables it reads and writes are the real ones.
SLOT_V2 = (_function_text("cockpit_sales_norm_words").replace("public.cockpit_sales_norm_words", "pg_temp.cockpit_sales_norm_words")
           + "\n" + _function_text("cockpit_sales_message_slot")
           .replace("public.cockpit_sales_message_slot", "pg_temp.cockpit_sales_message_slot")
           .replace("public.cockpit_sales_norm_words", "pg_temp.cockpit_sales_norm_words")
           .replace("security definer\n", "")
           # 20261004a adds ghl_asked_at in the same file (fix round 5); the
           # copy runs on a database without it, where no row is ever read as
           # unasked (a row with no such column is as before: in flight).
           .replace("m.ghl_asked_at is null", "(to_jsonb(m) ? 'ghl_asked_at' and to_jsonb(m) ->> 'ghl_asked_at' is null)")
           .replace("twin.ghl_asked_at is null",
                    "(to_jsonb(twin) ? 'ghl_asked_at' and to_jsonb(twin) ->> 'ghl_asked_at' is null)"))


def q(sql: str, write: bool = True):
    """sc.q, waiting out the management API's throttle (other agents share the
    token): a 429 that outlasts sc.q's own retries never ran, so it is sent
    again after a longer rest. Bursts call sc.q directly."""
    for attempt in range(10):
        try:
            return sc.q(sql, write)
        except SqlError as e:
            if e.status != 429 or attempt == 9:
                raise
            time.sleep(15)
RUN = "stress-s2c-" + secrets.token_hex(4)
HOST = "@stress.invalid"
WIDTH = 25
REST_S = 10
RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail else ""))


def _moment(width: int, lead_s: float = 2.5) -> str:
    """One shared moment lead_s from now, once the database has room for `width` more connections (60 in use at most)."""
    for _ in range(30):
        row = q("select (select count(*) from pg_stat_activity)::int as n, "
                f"(clock_timestamp() + make_interval(secs => {lead_s}))::text as at", write=False)[0]
        if row["n"] + width <= 60:
            return row["at"]
        time.sleep(2)
    raise SystemExit("The database stayed busy (over 60 connections in use); try again later.")


def burst(sqls, lead_s: float = 2.5):
    """Every statement waits for one shared moment on its own connection, then runs."""
    at = _moment(len(sqls), lead_s)
    wrapped = [f"select pg_sleep_until({lit(at)}::timestamptz);\n{s}" for s in sqls]

    def one(s):
        try:
            return ("ok", sc.q(s))
        except SqlError as e:
            return ("err", e)

    with ThreadPoolExecutor(len(wrapped)) as ex:
        out = list(ex.map(one, wrapped))
    time.sleep(REST_S)
    return out


def hundred(sqls):
    """100 presses as bursts of WIDTH, each burst at one shared moment."""
    out = []
    for i in range(0, len(sqls), WIDTH):
        out += burst(sqls[i:i + WIDTH])
    return out


def cleanup():
    q(f"delete from public.cockpit_sales_messages where contact_id like '{RUN}-%';"
      f"delete from public.cockpit_sales_live where contact_id like '{RUN}-%';"
      f"delete from public.cockpit_sales_availability where email like '{RUN}-%{HOST}';")


def leftovers():
    return q(f"""
      select (select count(*) from public.cockpit_sales_messages where contact_id like '{RUN}-%') as messages,
             (select count(*) from public.cockpit_sales_live where contact_id like '{RUN}-%') as live,
             (select count(*) from public.cockpit_sales_availability where email like '{RUN}-%{HOST}') as availability,
             (select count(*) from public.cockpit_audit_log where actor_email like '{RUN}-%' or entity_id like '{RUN}-%') as audit
    """, write=False)[0]


# ---------------------------------------------------------------------------
# The message slot, the real function
# ---------------------------------------------------------------------------

def msg_row(i, *, contact=None, sender=None, template=False, request_id=None):
    return {
        "request_id": request_id or str(uuid.uuid4()),
        "contact_id": contact or f"{RUN}-lead-{i}",
        "channel": "whatsapp",
        "via": "workflow" if template else "conversation",
        "template_key": "call_link_ar" if template else None,
        "body": "Stress check, removed at once.",
        "source": "room" if template else "rep",
        "sent_by": sender or f"{RUN}-sender{HOST}",
    }


def slot_sql(row: dict, limits: dict, v2: bool = False) -> str:
    if v2:
        return (SLOT_V2 + "\n" + f"select pg_temp.cockpit_sales_message_slot({lit(json.dumps(row))}::jsonb, "
                f"{lit(json.dumps(limits))}::jsonb) as out")
    return (f"select public.cockpit_sales_message_slot({lit(json.dumps(row))}::jsonb, "
            f"{lit(json.dumps(limits))}::jsonb) as out")


def codes_of(out):
    codes = []
    for o in out:
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


def day_bounds():
    return q("select (date_trunc('day', now() at time zone 'Asia/Kuwait') at time zone 'Asia/Kuwait')::text as d, "
             "(date_trunc('month', now() at time zone 'Asia/Kuwait') at time zone 'Asia/Kuwait')::text as m, "
             "now()::text as now", write=False)[0]


def t_slot_sender():
    """100 free messages from one sender at once, 100 leads (a stuck page, a
    script, or a leaked session flooding from one seat): the real limits
    sales-api passes (30 in ten minutes). Exactly 30 rows; the other 70 are
    told the ceiling; nothing errs or times out on its lock."""
    try:
        lim = {"sender_max": 30, "sender_window_s": 600, "lead_gap_s": 120}
        sender = f"{RUN}-flood{HOST}"
        out = hundred([slot_sql(msg_row(i, sender=sender), lim) for i in range(100)])
        t = tally(codes_of(out))
        rows = int(q(f"select count(*)::int as n from public.cockpit_sales_messages where sent_by = {lit(sender)}", write=False)[0]["n"])
        check("100 free messages from one sender at once: 30 rows, 70 told the ceiling, no errors",
              t.get("ok") == 30 and t.get("sender_ceiling") == 70 and rows == 30 and len(t) == 2, f"answers={t} rows={rows}")
    finally:
        cleanup()


def t_slot_same_request():
    """One request id pressed 100 times at once (a double tap times fifty, a
    retry storm after a lost answer): one row, 99 answers that it is a
    repeat of that row, no error."""
    try:
        lim = {"sender_max": 30, "sender_window_s": 600}
        rid = str(uuid.uuid4())
        row = msg_row(0, request_id=rid, sender=f"{RUN}-twin{HOST}")
        out = hundred([slot_sql(row, lim) for _ in range(100)])
        t = tally(codes_of(out))
        ids = set()
        for o in out:
            if o[0] == "ok" and o[1]:
                v = o[1][0].get("out")
                v = json.loads(v) if isinstance(v, str) else (v or {})
                if v.get("row"):
                    ids.add(str(v["row"].get("id")))
        rows = int(q(f"select count(*)::int as n from public.cockpit_sales_messages where request_id = {lit(rid)}", write=False)[0]["n"])
        check("one request id pressed 100 times at once: one row, 99 repeats of that row, no errors",
              t.get("ok") == 1 and t.get("repeat") == 99 and rows == 1 and len(ids) == 1, f"answers={t} rows={rows} row_ids={len(ids)}")
    finally:
        cleanup()


def t_slot_lead_gap():
    """One lead, 75 WhatsApp templates at once from 75 senders (the room's
    link, a backlog opener, reps' own templates) and 25 free messages beside
    them: one template row, the other 74 told the lead's two minutes; every
    free message gets its row (the gap is the templates' own)."""
    try:
        b = day_bounds()
        lead = f"{RUN}-gap-lead"
        lim = {"sender_max": 30, "sender_window_s": 600, "lead_gap_s": 120, "per_day": 1_000_000,
               "month_cap": 1_000_000, "day_start": b["d"], "month_start": b["m"]}
        sqls = []
        for i in range(100):
            template = i % 4 != 0
            sqls.append(slot_sql(msg_row(i, contact=lead, sender=f"{RUN}-gap-{i}{HOST}", template=template), lim))
        out = hundred(sqls)
        codes = codes_of(out)
        tmpl = tally([c for i, c in enumerate(codes) if i % 4 != 0])
        free = tally([c for i, c in enumerate(codes) if i % 4 == 0])
        rows = q(f"select via, count(*)::int as n from public.cockpit_sales_messages where contact_id = {lit(lead)} group by via", write=False)
        by = {r["via"]: int(r["n"]) for r in rows}
        check("one lead, 75 templates and 25 free messages at once: 1 template row (74 told the gap), 25 free rows, no errors",
              tmpl.get("ok") == 1 and tmpl.get("lead_gap") == 74 and free.get("ok") == 25 and by.get("workflow") == 1
              and by.get("conversation") == 25, f"templates={tmpl} free={free} rows={by}")
    finally:
        cleanup()


def t_slot_per_day():
    """100 WhatsApp templates at once to 100 leads from 100 senders, with the
    day's ceiling 12 above what the day already holds: exactly 12 rows, the
    other 88 told the day is spent (per_day)."""
    try:
        start = q("select (now() - interval '5 seconds')::text as t", write=False)[0]["t"]
        base = int(q(f"select count(*)::int as n from public.cockpit_sales_messages where via = 'workflow' and state <> 'failed' "
                     f"and created_at >= {lit(start)}::timestamptz", write=False)[0]["n"])
        b = day_bounds()
        lim = {"sender_max": 30, "sender_window_s": 600, "lead_gap_s": 120, "per_day": base + 12,
               "month_cap": 1_000_000, "day_start": start, "month_start": b["m"]}
        out = hundred([slot_sql(msg_row(i, contact=f"{RUN}-day-{i}", sender=f"{RUN}-day-{i}{HOST}", template=True), lim)
                       for i in range(100)])
        t = tally(codes_of(out))
        mine = int(q(f"select count(*)::int as n from public.cockpit_sales_messages where contact_id like '{RUN}-day-%'", write=False)[0]["n"])
        others = int(q(f"select count(*)::int as n from public.cockpit_sales_messages where via = 'workflow' and state <> 'failed' "
                       f"and created_at >= {lit(start)}::timestamptz and contact_id not like '{RUN}-%'", write=False)[0]["n"])
        ok = t.get("ok") == 12 - (others - base) and t.get("per_day") == 100 - t.get("ok", 0) and mine == t.get("ok")
        check("100 templates at once with 12 left in the day: 12 rows, 88 told the day is spent, no errors",
              ok, f"answers={t} rows={mine} others_in_window={others} base={base}")
    finally:
        cleanup()


def t_slot_same_words():
    """One lead, the same WhatsApp words sent twice at once: one rep's Send in
    two tabs (each tab its own request id), or a setter and a manager both
    answering the lead's reply with the same snippet. Each send gets its row
    and goes, so the lead gets the message twice; and once the WA Connector
    is said to be off (whatsapp_guard.connector_off), index.ts duplicateWatch
    reads the two identical messages in the conversation as the connector's
    copy and pauses WhatsApp for every rep and every automatic send
    (sendrules.ts duplicatePair; stress2_concurrency_sends.test.ts). Within
    the duplicate window, a second send of the same words to the same lead
    must not get a row of its own."""
    try:
        lim = {"sender_max": 30, "sender_window_s": 600, "lead_gap_s": 120}
        lead = f"{RUN}-words-lead"
        words = "Are you free for a quick call now? Stress check, removed at once."
        sqls = []
        for i in range(2):
            r = msg_row(i, contact=lead, sender=f"{RUN}-tab{HOST}")  # one rep, two tabs
            r["body"] = words
            sqls.append(slot_sql(r, lim, v2=True))
        for i in range(2):
            r = msg_row(i, contact=lead, sender=f"{RUN}-seat-{i}{HOST}")  # two seats, one snippet
            r["body"] = words if i == 0 else "  " + words.upper() + "  "  # the same words, as compared
            sqls.append(slot_sql(r, lim, v2=True))
        t = tally(codes_of(burst(sqls)))
        rows = int(q(f"select count(*)::int as n from public.cockpit_sales_messages where contact_id = {lit(lead)} "
                     f"and body = {lit(words)}", write=False)[0]["n"])
        rows_all = int(q(f"select count(*)::int as n from public.cockpit_sales_messages where contact_id = {lit(lead)}", write=False)[0]["n"])
        check("the same WhatsApp words to one lead four times at once (two tabs, two seats): one row goes, not four",
              rows_all == 1 and t.get("ok") == 1 and t.get("same_words") == 3, f"answers={t} rows={rows_all}")
    finally:
        cleanup()


# ---------------------------------------------------------------------------
# A press that lands after the offer's end (the real claim and the real sweep, rolled back)
# ---------------------------------------------------------------------------

def t_late_take_made_away():
    """A closer, Available, offered a handover. They press Take with seconds
    left; sales-api reads the lead from HighLevel (up to its timeout) before
    it claims, so the claim lands after offer_until and answers nothing
    (rooms.ts then says "Someone else took this lead.", the TS check in
    stress2_concurrency_rooms.test.ts). Nothing records that they pressed.
    The next sweep's L1 then makes them Away for missing the offer: a closer
    who pressed Take is Away, told they missed it, and the lead's handover
    ends with nobody. The press was the closer's answer; it must not count
    as a miss. Nothing persists: rollback."""
    in_window()
    me = f"{RUN}-late-closer{HOST}"
    lid = str(uuid.uuid4())
    rows = q(f"""
      begin;
      {_MIG2}
      insert into public.cockpit_sales_availability (email, state, until, via)
      values ({lit(me)}, 'available', now() + interval '1 hour', 'cockpit')
      on conflict (email) do update set state = 'available', until = excluded.until, reason = null;
      insert into public.cockpit_sales_live (id, request_id, contact_id, asked_by, kind, reason, offered_to, offer_until)
      values ({lit(lid)}, {lit(str(uuid.uuid4()))}, {lit(RUN + '-late-lead')}, {lit(RUN + '-setter' + HOST)}, 'demo', 'on_call',
              array[{lit(me)}]::text[], now() - interval '2 seconds');
      create temp table s2_out (step text, v text) on commit drop;
      insert into s2_out select 'claim_rows', count(*)::text from public.cockpit_sales_live_claim({lit(lid)}, {lit(me)}, null);
      insert into s2_out select 'sweep_skipped', (r ? 'skipped')::text from (select public.cockpit_sales_rooms_sweep() as r) as s;
      insert into s2_out select 'offer_state', state from public.cockpit_sales_live where id = {lit(lid)};
      insert into s2_out select 'seat_state', state from public.cockpit_sales_availability where email = {lit(me)};
      insert into s2_out select 'seat_reason', coalesce(reason, '') from public.cockpit_sales_availability where email = {lit(me)};
      select step, v from s2_out order by step;
      rollback;
    """)
    got = {r["step"]: r["v"] for r in rows}
    ran = got.get("sweep_skipped") == "false"
    check("a Take that landed after the offer's end does not make the closer who pressed it Away for a missed offer",
          ran and not (got.get("seat_state") == "away" and got.get("seat_reason") == "missed_offer"),
          json.dumps(got) + ("" if ran else " (the cron sweep held the lock; run again)"))


def t_take_in_time():
    """Fix round 1: the claim is judged at the press (p_at, at most 30 s
    back). A Take pressed 10 s before the offer's end whose claim runs 5 s
    after it (HighLevel's contact read in between) holds the lead; one whose
    press is 40 s old is judged 30 s back at most. Rolled back."""
    in_window()
    me = f"{RUN}-intime-closer{HOST}"
    lid = str(uuid.uuid4())
    lid2 = str(uuid.uuid4())
    rows = q(f"""
      begin;
      {_MIG2}
      insert into public.cockpit_sales_live (id, request_id, contact_id, asked_by, kind, reason, offered_to, offer_until)
      values ({lit(lid)}, {lit(str(uuid.uuid4()))}, {lit(RUN + '-intime-lead')}, {lit(RUN + '-setter' + HOST)}, 'demo', 'on_call',
              array[{lit(me)}]::text[], now() - interval '5 seconds'),
             ({lit(lid2)}, {lit(str(uuid.uuid4()))}, {lit(RUN + '-intime-lead2')}, {lit(RUN + '-setter' + HOST)}, 'demo', 'on_call',
              array[{lit(me)}]::text[], now() - interval '35 seconds');
      create temp table s2_out (step text, v text) on commit drop;
      insert into s2_out select 'claimed', coalesce(max(claimed_by), '')
        from public.cockpit_sales_live_claim({lit(lid)}, {lit(me)}, null, now() - interval '15 seconds');
      insert into s2_out select 'too_old', count(*)::text
        from public.cockpit_sales_live_claim({lit(lid2)}, {lit(me)}, null, now() - interval '40 seconds');
      insert into s2_out select 'too_old_declined', (({lit(me)})::text = any (declined_by))::text
        from public.cockpit_sales_live where id = {lit(lid2)};
      select step, v from s2_out order by step;
      rollback;
    """)
    got = {r["step"]: r["v"] for r in rows}
    check("a Take pressed before the offer's end holds the lead though its claim runs after the end",
          got.get("claimed") == me.lower(), json.dumps(got))
    check("a press older than 30 s is judged 30 s back at most (no claim), and is the closer's answer (declined_by)",
          got.get("too_old") == "0" and got.get("too_old_declined") == "true", json.dumps(got))


CHECKS = {
    "slot_sender": t_slot_sender,
    "slot_same_request": t_slot_same_request,
    "slot_lead_gap": t_slot_lead_gap,
    "slot_per_day": t_slot_per_day,
    "slot_same_words": t_slot_same_words,
    "late_take": t_late_take_made_away,
    "take_in_time": t_take_in_time,
}


def main():
    names = sys.argv[1:] or list(CHECKS)
    try:
        for n in names:
            CHECKS[n]()
    finally:
        cleanup()
    left = leftovers()
    clean = all(int(v) == 0 for v in left.values())
    print(f"{'PASS' if clean else 'FAIL'}  nothing synthetic left: {json.dumps(left)}")
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)} of {len(RESULTS)} checks held.")
    sys.exit(0 if not failed and clean else 1)


if __name__ == "__main__":
    main()
