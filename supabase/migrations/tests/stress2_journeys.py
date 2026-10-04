#!/usr/bin/env python3
"""JOURNEYS stress, second series, round 1: a rep's whole journey on the SQL itself.

    python3 supabase/migrations/tests/stress2_journeys.py               # every journey below
    python3 supabase/migrations/tests/stress2_journeys.py meet_standby  # one journey

Built on round 2's day simulation (stress_time_day.py): ONE transaction that
ends in rollback, on temp copies (pg_temp) of the live-calls tables, with the
deployed functions, triggers and presence view and migration 20261003d (the
repo's) rewritten to read the temp tables and a fake clock. The sweep runs
every minute; the room worker is played in between. Synthetic names only:
contacts 'stress-tday-{tag}-...', hosts '...@stress.invalid'. After the run a
read-only query proves nothing of it is in public.

Exit 0 only when every check passed. A FAIL is a finding: its name says what
should hold, its detail what the journey did.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_checks  # noqa: E402
import stress_time_day as sd  # noqa: E402
from stress_time_day import Day, email, kw, lit, ts  # noqa: E402

# Migration d is applied now: the deployed worker-status trigger calls its own
# function, which the round 2 copy list predates.
for _fn in ("cockpit_sales_worker_status_clock", "cockpit_sales_live_hours_open"):
    if _fn not in sd.FUNCTIONS:
        sd.FUNCTIONS.append(_fn)


# ---------------------------------------------------------------------------
# Thursday 8 October 10:00 to 10:30 (Kuwait): a setter goes Available on Meet
# ---------------------------------------------------------------------------

def meet_standby() -> Day:
    """The setter (Zoom pending, Google fine: Meet is theirs) presses I'm
    available at 10:02. sales-api asks for a standby room on Meet (roomlogic
    defaultProvider); the worker makes it. The setter presses Join my room
    and sits in the Meet. Meet sends no join signal; since fix round 1 the
    strip's Join my room on a Meet standby room also says the rep is in
    (room.mark host_in, apps/sales-cockpit rooms.ts stripActions), so the
    simulated host joins as the cockpit now has them (auto_join true). Before
    the fix nothing moved the room to host_in and R3 closed it at 10:08."""
    d = Day("Meet standby", kw("2026-10-08 10:00:00"), kw("2026-10-08 10:30:00"))
    d.person("setter", "setter", auto_join=True)
    d.sql.append("update pg_temp.cockpit_sales_room_hosts set zoom_status = 'pending', google_ok = true "
                 f"where email = {lit(email('setter'))};")
    t = kw("2026-10-08 10:02:00")
    d.at(t, "insert into pg_temp.cockpit_sales_availability (email, state, until, via, reason) values "
            f"({lit(email('setter'))}, 'available', {ts(kw('2026-10-08 12:02:00'))}, 'cockpit', null) "
            "on conflict (email) do update set state = excluded.state, until = excluded.until, via = excluded.via, reason = null")
    d.at(t, "insert into pg_temp.cockpit_sales_rooms (request_id, purpose, call_kind, provider, host_email, made_by) "
            f"values (gen_random_uuid(), 'standby', 'intro', 'meet', {lit(email('setter'))}, {lit(email('setter'))})")
    d.run(d.start, d.end)

    me = lit(email("setter"))
    log = (f"(select string_agg(to_char(l.t at time zone 'Asia/Kuwait', 'HH24:MI') || ' ' || coalesce(l.presence, '-') "
           f"|| ' standby=' || l.standby_live, ', ' order by l.t) from pg_temp.sim_log as l where l.email = {me} "
           f"and l.t between {ts(kw('2026-10-08 10:02:00'))} and {ts(kw('2026-10-08 10:12:00'))})")
    room = (f"(select string_agg(r.provider || ' ' || r.state || '/' || coalesce(r.end_reason, '-') || ' at ' || "
            f"coalesce(to_char(r.ended_at at time zone 'Asia/Kuwait', 'HH24:MI'), '-'), '; ') "
            f"from pg_temp.cockpit_sales_rooms as r where r.host_email = {me} and r.purpose = 'standby')")

    d.check("setup: the standby room was made on Meet and opened",
            f"exists (select 1 from pg_temp.cockpit_sales_rooms as r where r.host_email = {me} "
            "and r.purpose = 'standby' and r.provider = 'meet' and r.opened_at is not null)",
            room)
    d.check("a rep sitting in their own Meet standby room can become Ready (the strip's 'In your room')",
            f"exists (select 1 from pg_temp.sim_log as l where l.email = {me} and l.presence = 'ready')",
            f"{log} || ' room: ' || {room}")
    d.check("the sweep does not close the Meet standby room under a rep who pressed Join my room "
            "(no screen let them say they were in)",
            f"not exists (select 1 from pg_temp.cockpit_sales_rooms as r where r.host_email = {me} "
            "and r.purpose = 'standby' and r.end_reason = 'host_not_in')",
            room)
    d.check("after that close the seat is not left Available with no room and no word why",
            f"not exists (select 1 from pg_temp.sim_log as l where l.email = {me} and l.presence = 'available' "
            f"and l.standby_live = 0 and l.t > {ts(kw('2026-10-08 10:10:00'))})",
            f"(select string_agg(to_char(l.t at time zone 'Asia/Kuwait', 'HH24:MI') || ' ' || l.presence || "
            f"' standby=' || l.standby_live, ', ' order by l.t) from pg_temp.sim_log as l where l.email = {me} "
            f"and l.t between {ts(kw('2026-10-08 10:08:00'))} and {ts(kw('2026-10-08 10:12:00'))})")
    return d


DAYS = {"meet_standby": meet_standby}


SQ_PY = os.environ.get(
    "SQ_PY",
    "/private/tmp/claude-501/-Users-abdulazizwaheedi-mahara-cockpits/1742ac47-cfcd-4db7-b565-33e64c239220/scratchpad/sales/sq.py")


def query(sql: str, write: bool):
    """Through sq.py (the session's SQL door) when it is there, else run_checks.query."""
    if not os.path.exists(SQ_PY):
        return run_checks.query(sql, write)
    import json
    import subprocess
    args = [sys.executable, SQ_PY, "triage"] + (["--write"] if write else [])
    out = subprocess.run(args, input=sql, capture_output=True, text=True, timeout=300)
    if out.returncode != 0:
        raise SystemExit(f"sq.py failed: {out.stdout[:2000]} {out.stderr[:2000]}")
    return json.loads(out.stdout or "null")


def main() -> None:
    names = sys.argv[1:] or list(DAYS)
    failed_total = 0
    for name in names:
        day = DAYS[name]()
        rows = query(sd.compose(day), write=True) or []
        failed = [r for r in rows if not r.get("ok")]
        failed_total += len(failed) + (0 if rows else 1)
        print(f"== {day.name} (run tag {sd.TAG}): {len(rows) - len(failed)} passed, {len(failed)} failed")
        for r in rows:
            print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}  ({r.get('detail')})")
    left = query(sd.LEFTOVERS, False) or []
    if left:
        print("LEFT BEHIND after the rollback:", [x["what"] for x in left])
        sys.exit(2)
    print("Nothing persisted: the run used temp copies only and rolled back.")
    sys.exit(0 if not failed_total else 1)


if __name__ == "__main__":
    main()
