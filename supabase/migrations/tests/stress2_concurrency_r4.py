#!/usr/bin/env python3
"""Second series, round 4: concurrency and idempotency against the REAL
cockpit_sales_dispositions table on Creative Triage (20261003a, b, c and d
applied, dark). 20261004a is not applied in production yet, so the mark's
one-step replace (cockpit_sales_disposition_replace, 20261004a section 6)
runs as a pg_temp copy of 20261004a's function on each caller's own
connection; the table and its one-current index
(cockpit_sales_dispositions_current) are the real ones.

    python3 supabase/migrations/tests/stress2_concurrency_r4.py               # every check
    python3 supabase/migrations/tests/stress2_concurrency_r4.py replace_25    # one, by name

What is new here
  - replace_25: one call, its current mark read by 25 presses at one moment
    (index.ts markAppointment reads the current mark, then replaces it): a
    rep's Showed in the dialer and on the lead page, the closer's mark, the
    live count's quiet showed at the join. Each press supersedes the mark it
    read and inserts its own. Every press must either land or be told the
    call was marked a moment ago; a raw unique violation is what index.ts
    answers a person as "That did not work: database 409: duplicate key ...",
    and that press's mark is lost.
  - first_mark_25: the same with no mark yet (p_current_id null): 25 first
    marks of one call at once.
  Both also check the one-current rule held (one current mark at the end).

Synthetic rows only: contact and appointment ids start with this run's
'stress-' prefix, every marker email ends with '@stress.invalid'; each check
deletes exactly the rows it made. Nothing here calls HighLevel, Zoom, Google
or Slack, and nothing writes cockpit_audit_log.

Exit code 0 only when every check held and nothing synthetic is left.
"""
import json
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stress2_concurrency as s2  # noqa: E402  (q, burst, lit, _function_text)

lit, q = s2.lit, s2.q
RUN = "stress-s2c4-" + secrets.token_hex(4)
HOST = "@stress.invalid"
RESULTS = []

REPLACE_V2 = (s2._function_text("cockpit_sales_disposition_replace")
              .replace("public.cockpit_sales_disposition_replace", "pg_temp.cockpit_sales_disposition_replace")
              .replace("security definer\n", ""))


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail else ""))


def cleanup():
    q(f"delete from public.cockpit_sales_dispositions where contact_id like '{RUN}-%';")


def leftovers():
    return q(f"select (select count(*) from public.cockpit_sales_dispositions where contact_id like '{RUN}-%') as dispositions",
             write=False)[0]


def mark_row(appt: str, contact: str, i: int) -> dict:
    return {
        "appointment_id": appt,
        "contact_id": contact,
        "call_type": "intro",
        "start_at": "2026-10-05T10:00:00Z",
        "status": "showed" if i % 2 == 0 else "noshow",
        "reason": None,
        "note": f"Stress check {i}, removed at once.",
        "marked_by": f"{RUN}-seat{i}{HOST}",
        "crm": "off",
    }


def replace_sql(current_id, row: dict) -> str:
    cur = "null" if current_id is None else f"{int(current_id)}::bigint"
    # One row always (the management API answers an earlier statement's rows
    # when the last one has none): the new mark's id, or 'changed' when the
    # function wrote nothing because another mark landed first (fix round 4).
    return (REPLACE_V2 + "\n" +
            f"select coalesce((select id::text from pg_temp.cockpit_sales_disposition_replace({cur}, "
            f"{lit(json.dumps(row))}::jsonb) limit 1), 'changed') as id")


def outcome(o) -> str:
    if o[0] == "ok":
        rows = o[1] or []
        if rows and rows[-1].get("id") == "changed":
            return "changed (read the call again)"
        return "landed" if rows and rows[-1].get("id") else "no row"
    e = o[1]
    if "cockpit_sales_dispositions_current" in e.text or "23505" in e.text:
        return "raw unique violation (23505)"
    return "error: " + e.text[:120]


def tally(xs):
    t = {}
    for x in xs:
        t[x] = t.get(x, 0) + 1
    return dict(sorted(t.items()))


def t_replace_25():
    contact = f"{RUN}-lead-a"
    appt = f"{RUN}-appt-a"
    try:
        first = q(f"insert into public.cockpit_sales_dispositions (appointment_id, contact_id, call_type, start_at, status, note, marked_by, crm) "
                  f"values ({lit(appt)}, {lit(contact)}, 'intro', '2026-10-05T10:00:00Z', 'noshow', 'Stress check, removed at once.', "
                  f"{lit(RUN + '-seed' + HOST)}, 'off') returning id")
        cur = int(first[0]["id"])
        out = s2.burst([replace_sql(cur, mark_row(appt, contact, i)) for i in range(25)])
        got = [outcome(o) for o in out]
        current = int(q(f"select count(*)::int as n from public.cockpit_sales_dispositions where appointment_id = {lit(appt)} "
                        "and superseded_at is null", write=False)[0]["n"])
        check("control: one current mark per call after 25 presses at once", current == 1, f"current={current}")
        raw = sum(1 for g in got if g.startswith("raw"))
        check("replace_25: 25 marks of one call at once (each read the same current mark): none answered with a raw "
              "unique violation, which index.ts says to a person as 'That did not work: database 409 ...' and drops the mark",
              raw == 0, f"answers={json.dumps(tally(got))}")
        check("replace_25 (fix round 4): one lands, every other is told the call changed (index.ts reads it again)",
              got.count("landed") == 1 and got.count("changed (read the call again)") == 24, f"answers={json.dumps(tally(got))}")
    finally:
        cleanup()


def t_first_mark_25():
    contact = f"{RUN}-lead-b"
    appt = f"{RUN}-appt-b"
    try:
        out = s2.burst([replace_sql(None, mark_row(appt, contact, i)) for i in range(25)])
        got = [outcome(o) for o in out]
        current = int(q(f"select count(*)::int as n from public.cockpit_sales_dispositions where appointment_id = {lit(appt)} "
                        "and superseded_at is null", write=False)[0]["n"])
        check("control: one current mark after 25 first marks at once", current == 1, f"current={current}")
        raw = sum(1 for g in got if g.startswith("raw"))
        check("first_mark_25: 25 first marks of one unmarked call at once: none answered with a raw unique violation",
              raw == 0, f"answers={json.dumps(tally(got))}")
        check("first_mark_25 (fix round 4): one lands, every other is told the call changed",
              got.count("landed") == 1 and got.count("changed (read the call again)") == 24, f"answers={json.dumps(tally(got))}")
    finally:
        cleanup()


CHECKS = {
    "replace_25": t_replace_25,
    "first_mark_25": t_first_mark_25,
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
