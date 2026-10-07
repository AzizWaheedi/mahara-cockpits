#!/usr/bin/env python3
"""Second series, round 2: concurrency and idempotency against the REAL
live-calls tables and functions on Creative Triage (20261003a, b, c and d
applied, dark: every switch off, rooms.test_only true). 20261004a is not
applied in production yet, so every check that reads what it changed runs it
inside its own rolled-back transaction (the claim and the sweep), or as a
pg_temp copy on the burst's own connection (the message slot), as
stress2_concurrency.py does.

    python3 supabase/migrations/tests/stress2_concurrency_r2.py              # every check
    python3 supabase/migrations/tests/stress2_concurrency_r2.py take_sweep   # one, by name

What is new here
  - take_sweep: a Take pressed before the offer's end whose claim runs after
    it (HighLevel's contact read in between, up to its 15 s) with the
    minute's sweep in between: 20261004a's p_at judges the claim at the
    press, but only while the row still says offered; the sweep's L1 moves
    it at offer_until with no grace, and makes the closer who pressed Away
    for a "missed offer". The real claim and the real sweep, rolled back.
  - slot_same_words_100: 100 seats (and tabs) send one lead the same
    WhatsApp words at the same moment, with the words differing only in
    case, spacing and zero-width marks: one row, 99 told "same_words".

Synthetic rows only: contact ids start with 'stress-', every sender and seat
email ends with '@stress.invalid'; each check deletes exactly the rows it made
(messages by this run's contact prefix). Nothing here calls HighLevel, Zoom,
Google or Slack. The sweep check runs inside a transaction that rolls back
(its pg_net posts and audit rows go with it), started between second 4 and 38
of a minute so the cron sweep (at :00) is not holding the sweep's lock.

Exit code 0 only when every check held and nothing synthetic is left.
"""
import json
import os
import secrets
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stress2_concurrency as s2  # noqa: E402  (q, burst, hundred, SLOT_V2, _MIG2, lit, in_window)

lit, q, in_window = s2.lit, s2.q, s2.in_window
RUN = "stress-s2c2-" + secrets.token_hex(4)
HOST = "@stress.invalid"
RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail else ""))


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
# A Take in time, the minute's sweep, then the claim (rolled back)
# ---------------------------------------------------------------------------

def t_take_sweep():
    """The closer is Available and offered a handover. They press Take eight
    seconds before the offer's end. rooms.ts liveTake reads the lead from
    HighLevel (liveio.ts gives it up to 15 s) and the closer's rooms before
    it claims; the minute's sweep (pg_cron, every minute) runs inside that
    read, two seconds after the offer's end. Then the claim runs, with the
    press's own time (p_at). Within one transaction now() is one moment: the
    offer ended 2 s before it, the press was 10 s before it.

    Wanted: the press was in time, so the closer holds the lead (or, at the
    least, is not made Away for a missed offer they answered). Rolled back."""
    in_window()
    me = f"{RUN}-closer{HOST}"
    lid = str(uuid.uuid4())
    rows = q(f"""
      begin;
      {s2._MIG2}
      {s2._LIVE_ON}
      insert into public.cockpit_sales_availability (email, state, until, via)
      values ({lit(me)}, 'available', now() + interval '1 hour', 'cockpit')
      on conflict (email) do update set state = 'available', until = excluded.until, reason = null;
      insert into public.cockpit_sales_live (id, request_id, contact_id, asked_by, kind, reason, offered_to, offer_until)
      values ({lit(lid)}, {lit(str(uuid.uuid4()))}, {lit(RUN + '-lead')}, {lit(RUN + '-setter' + HOST)}, 'demo', 'on_call',
              array[{lit(me)}]::text[], now() - interval '2 seconds');
      create temp table s2r2_out (step text, v text) on commit drop;
      -- The minute's sweep, inside HighLevel's contact read.
      insert into s2r2_out select 'sweep_skipped', (r ? 'skipped')::text from (select public.cockpit_sales_rooms_sweep() as r) as s;
      -- The claim, judged at the press (ten seconds ago, eight before the end).
      insert into s2r2_out select 'claimed_by', coalesce(max(claimed_by), '')
        from public.cockpit_sales_live_claim({lit(lid)}, {lit(me)}, null, now() - interval '10 seconds');
      insert into s2r2_out select 'offer_state', state from public.cockpit_sales_live where id = {lit(lid)};
      insert into s2r2_out select 'seat_state', state from public.cockpit_sales_availability where email = {lit(me)};
      insert into s2r2_out select 'seat_reason', coalesce(reason, '') from public.cockpit_sales_availability where email = {lit(me)};
      select step, v from s2r2_out order by step;
      rollback;
    """)
    got = {r["step"]: r["v"] for r in rows}
    ran = got.get("sweep_skipped") == "false"
    held = got.get("claimed_by") == me.lower()
    away = got.get("seat_state") == "away" and got.get("seat_reason") == "missed_offer"
    check("a Take pressed 8 s before the offer's end, the minute's sweep inside HighLevel's read, then the claim: "
          "the closer holds the lead and is not made Away for a missed offer",
          ran and held and not away,
          json.dumps(got) + ("" if ran else " (the cron sweep held the lock; run again)"))


# ---------------------------------------------------------------------------
# The message slot: one lead, the same words from 100 seats at once
# ---------------------------------------------------------------------------

def t_slot_same_words_100():
    """100 presses at one moment (in bursts of 25), each its own request id:
    25 seats with the same snippet, each also from a second tab, and the
    rest the same words in another case, with extra spaces or a zero-width
    mark. One free WhatsApp row; 99 answered same_words; none errs."""
    try:
        # The four bursts (and the database's own waits between them) can take
        # over a minute, so the duplicate window is the longest a manager may
        # set (600 s): every press here falls inside one window.
        lim = {"sender_max": 30, "sender_window_s": 600, "lead_gap_s": 120, "dup_window_s": 600}
        lead = f"{RUN}-words-lead"
        words = "Are you free for a quick call now? Stress check, removed at once."
        variants = [words, words.upper(), "  " + words.replace(" ", "   ") + " ", words.replace("call", "c​all")]
        sqls = []
        for i in range(100):
            row = {
                "request_id": str(uuid.uuid4()),
                "contact_id": lead,
                "channel": "whatsapp",
                "via": "conversation",
                "template_key": None,
                "body": variants[i % len(variants)],
                "source": "rep",
                "sent_by": f"{RUN}-seat-{i % 25}{HOST}",
            }
            sqls.append(s2.slot_sql(row, lim, v2=True))
        out = s2.hundred(sqls)
        t = s2.tally(s2.codes_of(out))
        n = int(q(f"select count(*)::int as n from public.cockpit_sales_messages where contact_id = {lit(lead)}", write=False)[0]["n"])
        errs = sum(v for k, v in t.items() if k.startswith("error: no answer"))
        check("one lead, the same WhatsApp words from 100 presses at once (25 seats, case, spacing, a zero-width mark): one row, the rest same_words",
              n == 1 and t.get("ok") == 1 and t.get("same_words", 0) + errs == 99, f"answers={t} rows={n}")
    finally:
        cleanup()


CHECKS = {
    "take_sweep": t_take_sweep,
    "slot_same_words_100": t_slot_same_words_100,
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
