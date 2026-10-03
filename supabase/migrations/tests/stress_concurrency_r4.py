#!/usr/bin/env python3
"""Round 4 concurrency and idempotency stress against the REAL live-calls
tables on Creative Triage (20261003a, b and c applied, dark).

    python3 supabase/migrations/tests/stress_concurrency_r4.py               # every check
    python3 supabase/migrations/tests/stress_concurrency_r4.py count_twenty  # one, by name

What is new here: the live count's claim across the rooms of ONE lead.
rooms.ts runCount reads the lead's other rooms (standingCount: a count
that stands, or one claimed and still in flight, within three hours of this
join) and only then writes this room's own claim (countClaim: a PATCH on
this room's row, expect count_claimed_at null and count_result null). The
two are separate requests, and the claim is on a different row from the
siblings it read, so nothing in the database stops two rooms of one lead
from both claiming: each read happened before the other's claim. The tick
carries every room with a lead, and every room joined in the last hour, in
one body, and runs each room's count in the background side by side;
reopenSiblings runs the counts of every room it reopens side by side; two
ticks (a sweep that overran) do the same.

Each press here is that read and that claim as ONE statement (a single
snapshot: the narrowest the window can be; rooms.ts's two requests make it
wider), twenty presses at one shared moment, each on its own connection.
When the fix adds a database claim that decides per lead (a function
public.cockpit_sales_room_count_claim(p_room_id uuid) returning the room id
when this call holds the count, or null), the presses call it instead, so
the check stays as the regression test.

    count_twenty     twenty rooms of one lead, each counted once, at once:
                     at most one count is claimed for the conversation.
    count_doubled    two rooms of one lead, each pressed ten times at once
                     (two ticks of an overrun sweep, the join's own count):
                     one claim in all.

Synthetic rows only: contact ids start with 'stress-r4-', host emails end
with '@stress.invalid'; every check deletes exactly the rows it made. The
rooms are final (ended, the lead joined minutes ago), so the one-room-per-
lead index lets twenty of them stand. pg_cron's sweep runs at second :00:
every check starts between second 4 and 38 and is gone in seconds (with
rooms switched off the sweep skips anyway). Nothing here calls HighLevel,
Zoom, Google or Slack, and no audit row is written.

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

q, lit, SqlError, in_window = sc.q, sc.lit, sc.SqlError, sc.in_window
RUN = "stress-r4-" + secrets.token_hex(4)
HOST = "@stress.invalid"
REST_S = 6
SIBLING_JOIN_H = 3  # rooms.ts SIBLING_JOIN_H

RESULTS = []


class Throttled(Exception):
    """The management API turned requests away for load: that burst never ran as one."""


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {detail}" if detail else ""))


def _moment(lead_s: float) -> str:
    """One shared moment lead_s from now, once the database has room (at most 60 connections in use)."""
    for _ in range(5):
        row = q("select (select count(*) from pg_stat_activity)::int as n, "
                f"(clock_timestamp() + make_interval(secs => {lead_s}))::text as at", write=False)[0]
        if row["n"] + 20 <= 60:
            return row["at"]
        time.sleep(2)
    raise SqlError(0, "the database is busy (over 40 connections in use); run again later")


def burst(sqls, width: int = 20, lead_s: float = 2.5):
    at = _moment(lead_s)

    def one(s):
        try:
            return ("ok", q(f"select pg_sleep_until({lit(at)}::timestamptz);\n{s}"))
        except SqlError as e:
            return ("err", e)

    with ThreadPoolExecutor(min(width, len(sqls))) as ex:
        out = list(ex.map(one, sqls))
    for o in out:
        if o[0] == "err" and ("throttled" in o[1].text or o[1].status == 429):
            raise Throttled(o[1].text[:80])
    return out


MINE_ROOMS = f"(contact_id like '{RUN}-%' or host_email like '{RUN}-%{HOST}')"


def cleanup():
    q(f"""
      delete from public.cockpit_sales_room_events
       where room_id in (select id from public.cockpit_sales_rooms where {MINE_ROOMS});
      delete from public.cockpit_sales_rooms where {MINE_ROOMS};
    """)


def leftovers():
    return q(f"""
      select (select count(*) from public.cockpit_sales_rooms where {MINE_ROOMS}) as rooms,
             (select count(*) from public.cockpit_audit_log where actor_email like '{RUN}-%' or entity_id like '{RUN}-%'
                 or metadata->>'contact_id' like '{RUN}-%') as audit
    """, write=False)[0]


def db_claim_function() -> bool:
    return bool(q("select to_regprocedure('public.cockpit_sales_room_count_claim(uuid)') is not null as ok", write=False)[0]["ok"])


def joined_rooms(lead: str, n: int, *, tag: str) -> list:
    """n final rooms of one lead, each joined a few minutes ago and never counted."""
    values = []
    for i in range(n):
        values.append("(" + ", ".join([
            lit(str(uuid.uuid4())), lit(lead), "'manual'", "'intro'", "'meet'",
            lit(f"{RUN}-{tag}-host-{i}{HOST}"), lit(f"{RUN}-desk"), "'ended'",
            "'https://meet.google.com/str-ess-tst'",
            f"now() - make_interval(secs => {300 - i * 10})",  # joined 5 minutes ago and after
            "'joined'",
            f"now() - make_interval(secs => {120 - i})",
        ]) + ")")
    rows = q(f"""
      insert into public.cockpit_sales_rooms
        (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url, lead_in_at, result, ended_at)
      values {", ".join(values)}
      returning id
    """)
    return [r["id"] for r in rows]


def count_press(room_id: str, use_db: bool) -> str:
    """One count of one room, as rooms.ts makes it: standingCount (another
    room of the lead whose count stands or is in flight, within three hours
    of this join) and, when there is none, countClaim (this room's claim,
    expect count_claimed_at null and count_result null). One statement."""
    if use_db:
        return f"select public.cockpit_sales_room_count_claim({lit(room_id)}::uuid)::text as claimed"
    return f"""
      with me as (select id, contact_id, lead_in_at from public.cockpit_sales_rooms where id = {lit(room_id)}::uuid),
      sib as (
        select count(*) as n
          from public.cockpit_sales_rooms as x, me
         where x.contact_id = me.contact_id and x.id <> me.id
           and x.lead_in_at >= me.lead_in_at - interval '{SIBLING_JOIN_H} hours'
           and x.lead_in_at <= me.lead_in_at + interval '{SIBLING_JOIN_H} hours'
           and x.count_claimed_at is not null
           and (x.count_result is null or x.count_result in ('unclear', 'booked', 'moved'))
      ),
      claim as (
        update public.cockpit_sales_rooms as r
           set count_claimed_at = clock_timestamp(), count_result = null, count_appointment_id = null, count_undo_at = null
         where r.id = {lit(room_id)}::uuid and r.count_claimed_at is null and r.count_result is null
           and (select n from sib) = 0
        returning r.id
      )
      select (select id::text from claim) as claimed
    """


def claimed_of(out) -> list:
    return [o[1][0]["claimed"] for o in out if o[0] == "ok" and o[1] and o[1][0].get("claimed")]


def errors_of(out) -> list:
    return sorted({o[1].text[:160] for o in out if o[0] == "err"})


def t_count_twenty():
    """Twenty rooms of one lead (the lead joined, the call dropped, another
    room; an outage's backlog), each counted once, all at once: at most one
    claim, so at most one "Live ·" booking for the conversation."""
    in_window()
    lead = f"{RUN}-lead-twenty"
    ids = joined_rooms(lead, 20, tag="twenty")
    use_db = db_claim_function()
    try:
        out = burst([count_press(i, use_db) for i in ids])
        got = claimed_of(out)
        standing = q(f"select count(*)::int as n from public.cockpit_sales_rooms where contact_id = {lit(lead)} "
                     "and count_claimed_at is not null", write=False)[0]["n"]
    finally:
        cleanup()
    check("count_twenty: twenty rooms of one lead counted at once claim one count",
          len(got) == 1 and standing == 1 and not errors_of(out),
          f"claims answered {len(got)}, claimed rows {standing}, errors {errors_of(out)}"
          f" ({'database claim' if use_db else 'rooms.ts read then claim'})")


def t_count_doubled():
    """Two rooms of one lead, each pressed ten times at once (two ticks of
    a sweep that overran, and the join's own count): one claim in all."""
    in_window()
    lead = f"{RUN}-lead-doubled"
    ids = joined_rooms(lead, 2, tag="doubled")
    use_db = db_claim_function()
    try:
        out = burst([count_press(ids[k % 2], use_db) for k in range(20)])
        got = claimed_of(out)
        rows = q(f"select id::text, count_claimed_at is not null as claimed from public.cockpit_sales_rooms "
                 f"where contact_id = {lit(lead)} order by id", write=False)
    finally:
        cleanup()
    n = sum(1 for r in rows if r["claimed"])
    check("count_doubled: two rooms of one lead, ten presses each at once, claim one count",
          n == 1 and len(got) == 1 and not errors_of(out),
          f"claimed rows {n} of 2, claims answered {len(got)}, errors {errors_of(out)}")


CHECKS = {
    "count_twenty": t_count_twenty,
    "count_doubled": t_count_doubled,
}


def main():
    sys.stdout.reconfigure(line_buffering=True)
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
        print(f"\nleft behind: {left}")
        check("nothing synthetic left behind; no audit row written",
              int(left["rooms"]) == 0 and int(left["audit"]) == 0, json.dumps(left))
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)} passed, {len(failed)} failed.")
    sys.exit(0 if not failed else 1)


if __name__ == "__main__":
    main()
