#!/usr/bin/env python3
"""Second series, round 3: concurrency and idempotency against the REAL
live-calls tables and functions on Creative Triage (20261003a, b, c and d
applied, dark: every switch off, rooms.test_only true). 20261004a is not
applied in production yet, so the message slot runs as the pg_temp copy of
20261004a's function on each burst's own connection (stress2_concurrency.py
SLOT_V2); the event lease is the real, applied function.

    python3 supabase/migrations/tests/stress2_concurrency_r3.py              # every check
    python3 supabase/migrations/tests/stress2_concurrency_r3.py lease_release  # one, by name

What is new here
  - lease_release: rooms.ts held a room's link send under one event lease
    and gave it back in a `finally` with releaseEvent, a PATCH by dedupe key
    and handled_at alone, so a run whose lease ran out gave back the lease
    the run that took over held. Since fix round 3 the lease stores its
    holder's token (20261004a section 6b) and a release is guarded on it.
    Run as one rolled-back transaction on a pg_temp copy of 20261004a's
    lease function (the column added and rolled back with it).
  - slot_mixed_100: the slot under 100 presses at one moment (bursts of 25)
    of four kinds mixed in each burst: templates to one lead from 25 seats,
    the same free words to that lead from 25 seats, one request id pressed 25
    times, and templates to 25 other leads with five left in the day. Checks
    that no press errs or waits out its lock, and that every ceiling holds.

Synthetic rows only: contact ids start with 'stress-', every sender email ends
with '@stress.invalid', events use source 'stress' (never replayed by the
sweep) and a dedupe key that starts with this run's prefix; each check deletes
exactly the rows it made. Nothing here calls HighLevel, Zoom, Google or Slack,
and nothing writes cockpit_audit_log.

Exit code 0 only when every check held and nothing synthetic is left.
"""
import json
import os
import secrets
import sys
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stress2_concurrency as s2  # noqa: E402  (q, burst, hundred, SLOT_V2, lit, codes_of, tally)

lit, q = s2.lit, s2.q
RUN = "stress-s2c3-" + secrets.token_hex(4)
HOST = "@stress.invalid"
RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail else ""))


def cleanup():
    q(f"delete from public.cockpit_sales_messages where contact_id like '{RUN}-%';"
      f"delete from public.cockpit_sales_room_events where source = 'stress' and dedupe_key like '{RUN}-%';")


def leftovers():
    return q(f"""
      select (select count(*) from public.cockpit_sales_messages where contact_id like '{RUN}-%') as messages,
             (select count(*) from public.cockpit_sales_room_events where dedupe_key like '{RUN}-%') as events
    """, write=False)[0]


# ---------------------------------------------------------------------------
# The link's send lease, given back by a run that no longer holds it
# ---------------------------------------------------------------------------

MIGRATION = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "20261004a_live_calls_hardening_2.sql")


def lease_v2_sql() -> str:
    """20261004a's section 6b (the lease with its holder's token) as a pg_temp
    copy, with the column it needs; run only inside a rolled-back transaction."""
    src = open(MIGRATION).read()
    a = src.index("create or replace function public.cockpit_sales_room_event_lease(")
    b = src.index("$$;", a) + 3
    fn = src[a:b].replace("public.cockpit_sales_room_event_lease(", "pg_temp.cockpit_sales_room_event_lease(")
    return ("set local lock_timeout = '3s';\n"
            "alter table public.cockpit_sales_room_events add column if not exists lease_token uuid;\n" + fn + "\n")


def t_lease_release():
    """Run A takes the room's link lease and is still sending when it runs
    out (here: its lease_until is moved into the past, inside one rolled-back
    transaction, since now() stands still in one). The minute's re-ask, run
    B, takes the lease. A finishes and gives the lease back the way rooms.ts
    does since fix round 3 (guarded on its own token, 20261004a). A third run,
    C, must not get the lease while B still holds it."""
    key = f"{RUN}-link.send:00000000-0000-4000-8000-000000000001"
    ta, tb, tc = (str(uuid.uuid4()) for _ in range(3))
    lease = (lambda t: f"pg_temp.cockpit_sales_room_event_lease(p_event_id => null, p_dedupe_key => {lit(key)}, "
                       f"p_seconds => 30, p_token => {lit(t)}::uuid)::text")
    sql = ("begin;\n" + lease_v2_sql() +
           "create temp table s2c3_steps (n serial, step text, got text) on commit drop;\n"
           "insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, text) values "
           f"(null, 'link.send', 'stress', {lit(key)}, 'Stress check, rolled back.');\n"
           f"insert into s2c3_steps (step, got) select 'a', {lease(ta)};\n"
           f"insert into s2c3_steps (step, got) select 'second_while_held', {lease(tc)};\n"
           "update public.cockpit_sales_room_events set lease_until = now() - interval '1 second' "
           f"where dedupe_key = {lit(key)};\n"
           f"insert into s2c3_steps (step, got) select 'b', {lease(tb)};\n"
           "with rel as (update public.cockpit_sales_room_events set lease_until = null "
           f"where dedupe_key = {lit(key)} and handled_at is null and lease_token = {lit(ta)}::uuid returning 1) "
           "insert into s2c3_steps (step, got) select 'a_released_rows', count(*)::text from rel;\n"
           f"insert into s2c3_steps (step, got) select 'c', {lease(tc)};\n"
           "with rel as (update public.cockpit_sales_room_events set lease_until = null "
           f"where dedupe_key = {lit(key)} and handled_at is null and lease_token = {lit(tb)}::uuid returning 1) "
           "insert into s2c3_steps (step, got) select 'b_released_rows', count(*)::text from rel;\n"
           f"insert into s2c3_steps (step, got) select 'd_after_b', {lease(tc)};\n"
           "select step, got from s2c3_steps order by n;\n"
           "rollback;")
    try:
        rows = {r["step"]: r.get("got") for r in (q(sql) or [])}
        check("control: a held lease is not handed out twice",
              rows.get("a") is not None and rows.get("second_while_held") is None, json.dumps(rows))
        check("lease_release: a run whose lease ran out does not give back the lease the next run holds "
              "(a third run gets nothing while the second still sends)",
              rows.get("b") is not None and rows.get("a_released_rows") == "0" and rows.get("c") is None,
              json.dumps(rows))
        check("lease_release: the run that holds the lease gives it back with its own token",
              rows.get("b_released_rows") == "1" and rows.get("d_after_b") is not None, json.dumps(rows))
    finally:
        cleanup()


# ---------------------------------------------------------------------------
# The message slot under 100 mixed presses
# ---------------------------------------------------------------------------

def t_slot_mixed_100():
    try:
        start = q("select (now() - interval '5 seconds')::text as t", write=False)[0]["t"]
        base = int(q(f"select count(*)::int as n from public.cockpit_sales_messages where via = 'workflow' and state <> 'failed' "
                     f"and created_at >= {lit(start)}::timestamptz", write=False)[0]["n"])
        b = s2.day_bounds()
        lim = {"sender_max": 30, "sender_window_s": 600, "lead_gap_s": 120, "per_day": base + 5,
               "month_cap": 1_000_000, "day_start": start, "month_start": b["m"], "dup_window_s": 600}
        lead = f"{RUN}-mix-lead"
        words = "Can we talk now? Stress check, removed at once."
        rid = str(uuid.uuid4())
        sqls, kinds = [], []
        for i in range(25):
            # A template to the one lead, from its own seat.
            r = s2.msg_row(i, contact=lead, sender=f"{RUN}-t-{i}{HOST}", template=True)
            sqls.append(s2.slot_sql(r, lim, v2=True)); kinds.append("lead_template")
            # The same free words to that lead, from another seat.
            r = s2.msg_row(i, contact=lead, sender=f"{RUN}-w-{i}{HOST}")
            r["body"] = words
            sqls.append(s2.slot_sql(r, lim, v2=True)); kinds.append("same_words")
            # One request id pressed again and again (a retry storm), its own words.
            r = s2.msg_row(i, contact=lead, sender=f"{RUN}-r{HOST}", request_id=rid)
            r["body"] = "One press, many retries. Stress check, removed at once."
            sqls.append(s2.slot_sql(r, lim, v2=True)); kinds.append("repeat")
            # A template to another lead, with five left in the day.
            r = s2.msg_row(i, contact=f"{RUN}-mix-other-{i}", sender=f"{RUN}-o-{i}{HOST}", template=True)
            sqls.append(s2.slot_sql(r, lim, v2=True)); kinds.append("other_template")
        out = s2.hundred(sqls)
        codes = s2.codes_of(out)
        by = {k: s2.tally([c for c, kk in zip(codes, kinds) if kk == k]) for k in sorted(set(kinds))}
        errs = [c for c in codes if c.startswith("error") or c == "no answer"]
        rows = q(f"select via, body, request_id, contact_id from public.cockpit_sales_messages where contact_id like '{RUN}-mix-%'",
                 write=False)
        lead_tpl = sum(1 for r in rows if r["contact_id"] == lead and r["via"] == "workflow")
        same = sum(1 for r in rows if r["contact_id"] == lead and r["body"] == words)
        rep = sum(1 for r in rows if r["request_id"] == rid)
        tpl_all = sum(1 for r in rows if r["via"] == "workflow")
        others = int(q(f"select count(*)::int as n from public.cockpit_sales_messages where via = 'workflow' and state <> 'failed' "
                       f"and created_at >= {lit(start)}::timestamptz and contact_id not like '{RUN}-%'", write=False)[0]["n"])
        ok = (not errs and lead_tpl <= 1 and same == 1 and rep == 1 and tpl_all + (others - base) <= 5)
        check("100 mixed presses at once (lead templates, the same words, one request id, templates to others with "
              "five left): no error, one template for the lead, one row of the words, one row of the id, the day's five",
              ok, f"answers={json.dumps(by)} rows: lead_templates={lead_tpl} same_words={same} one_id={rep} "
                  f"templates={tpl_all} others_in_window={others - base} errors={errs[:3]}")
    finally:
        cleanup()


CHECKS = {
    "lease_release": t_lease_release,
    "slot_mixed_100": t_slot_mixed_100,
}


def main():
    names = sys.argv[1:] or list(CHECKS)
    try:
        s2.run_all(CHECKS, names, RESULTS, cleanup)
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
