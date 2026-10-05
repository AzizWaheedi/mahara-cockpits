#!/usr/bin/env python3
"""TIME stress, second series, round 6: the SQL sweep on a fake clock.

    python3 supabase/migrations/tests/stress2_time_r6.py            # every day below
    python3 supabase/migrations/tests/stress2_time_r6.py late_try   # one day

Built on round 2's day simulation (stress_time_day.py): ONE transaction that
ends in rollback, on temp copies (pg_temp) of the live-calls tables, with the
deployed functions and migrations d and 20261004a (the repo's) rewritten to
read the temp tables and a fake clock. Synthetic names only: contacts
'stress-tday-{tag}-...', hosts '...@stress.invalid'. After the run a
read-only query proves nothing of it is in public.

Exit 0 only when every check passed. A FAIL is a finding.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_checks  # noqa: E402
import stress_time_day as sd  # noqa: E402
from stress_time_day import Day, contact, kw, lit  # noqa: E402

for _fn in ("cockpit_sales_worker_status_clock", "cockpit_sales_live_hours_open"):
    if _fn not in sd.FUNCTIONS:
        sd.FUNCTIONS.append(_fn)
# 20261004a's S1 reads the dials and the leads (the lead reached by phone).
for _t in ("cockpit_sales_dials", "cockpit_sales_leads"):
    if _t not in sd.TABLES:
        sd.TABLES.append(_t)


# ---------------------------------------------------------------------------
# Thursday 8 October 10:55 to 14:00 (Kuwait): a late first try at the intro
# ---------------------------------------------------------------------------

def late_try() -> Day:
    """The setter's intro is at 11:00. Busy with another call, they first ring
    it at 11:19:30 (the dialer's intro item runs to 11:20); no answer, saved
    11:20:10; the video link is pressed at 11:21:00. sales-api judges the
    room by the call it follows (rooms.ts ATTEMPT_CARRIES_MS, stress2 round
    5): the room carries the intro (appointment_id and appointment_start_at)
    and its message says "I just tried to call you for your intro call". The
    lead never opens it; R4 closes it at about 11:31.

    The control: the 13:00 intro, rung at 13:19:30, its link pressed at
    13:19:50 (inside start + settle): settled a no-show."""
    d = Day("Late try", kw("2026-10-08 10:55:00"), kw("2026-10-08 14:00:00"))
    d.person("setter", "setter")
    d.booked("appt-late", "lead-late", "setter", kw("2026-10-08 11:00:00"))
    # Fix round 6: createRoom stores the call the room followed (11:19:30) as
    # appointment_call_at, and the settle judges the room by it.
    d.fallback_room(kw("2026-10-08 11:21:00"), "setter", "lead-late", "appt-late",
                    call_at=kw("2026-10-08 11:19:30"))
    d.host_in(kw("2026-10-08 11:21:40"), "setter")
    d.booked("appt-ctl", "lead-ctl", "setter", kw("2026-10-08 13:00:00"))
    d.fallback_room(kw("2026-10-08 13:19:50"), "setter", "lead-ctl", "appt-ctl")
    d.host_in(kw("2026-10-08 13:20:20"), "setter")
    d.run(d.start, d.end)

    def appt(name: str) -> str:
        return f"(select x.status from pg_temp.cockpit_sales_appointments as x where x.appointment_id = {lit(contact(name))})"

    def rooms(lead: str) -> str:
        return (f"(select string_agg(r.code || ' ' || r.state || '/' || coalesce(r.result, '-') || ' asked ' || "
                f"to_char(r.requested_at at time zone 'Asia/Kuwait', 'HH24:MI:SS') || ' carries=' || "
                f"coalesce(r.appointment_id, '-') || ' settled=' || coalesce(r.settled_mark, '-'), '; ') "
                f"from pg_temp.cockpit_sales_rooms as r where r.contact_id = {lit(contact(lead))})")

    alerts = ("(select string_agg(a.dedupe_key || ' open=' || (a.resolved_at is null)::text, ' | ') "
              "from pg_temp.cockpit_sales_alerts as a where a.kind = 'room_mark_intro')")
    lines = ("(select string_agg(e.kind || ': ' || coalesce(e.text, ''), ' | ') from pg_temp.cockpit_sales_room_events as e "
             "join pg_temp.cockpit_sales_rooms as r on r.id = e.room_id "
             f"where r.contact_id = {lit(contact('lead-late'))} and e.kind like 'sweep.settle%')")

    d.check("control: the 13:00 intro's room, asked for at 13:19:50 and closed empty, is settled a no-show",
            f"{appt('appt-ctl')} = 'noshow'", f"{rooms('lead-ctl')} || ' intro=' || {appt('appt-ctl')}")
    d.check("setup: the late-try room carries the 11:00 intro and closed with nobody in it",
            f"exists (select 1 from pg_temp.cockpit_sales_rooms as r where r.contact_id = {lit(contact('lead-late'))} "
            f"and r.appointment_id = {lit(contact('appt-late'))} and r.state = 'expired' and r.lead_in_at is null)",
            rooms("lead-late"))
    d.check("the 11:00 intro whose only room closed empty is settled a no-show, or a person is asked to mark it "
            "(an open room_mark_intro alert); never left confirmed with nobody told",
            f"{appt('appt-late')} = 'noshow' or exists (select 1 from pg_temp.cockpit_sales_alerts as a "
            "join pg_temp.cockpit_sales_rooms as r on a.dedupe_key = 'room:' || r.id::text || ':mark_intro' "
            f"where r.contact_id = {lit(contact('lead-late'))} and a.resolved_at is null)",
            f"'intro=' || {appt('appt-late')} || ' rooms: ' || {rooms('lead-late')} || ' alerts: ' || "
            f"coalesce({alerts}, 'none') || ' lines: ' || coalesce({lines}, 'none')")
    d.check("the sweep ran without a rule failing",
            "not exists (select 1 from pg_temp.sim_sweeps as s where jsonb_array_length(coalesce(s.out -> 'errors', '[]')) > 0)",
            "(select string_agg(distinct (s.out -> 'errors')::text, ' | ') from pg_temp.sim_sweeps as s "
            "where jsonb_array_length(coalesce(s.out -> 'errors', '[]')) > 0)")
    return d


DAYS = {"late_try": late_try}


def main() -> None:
    names = sys.argv[1:] or list(DAYS)
    failed_total = 0
    for name in names:
        day = DAYS[name]()
        rows = run_checks.query(sd.compose(day), write=True) or []
        failed = [r for r in rows if not r.get("ok")]
        failed_total += len(failed) + (0 if rows else 1)
        print(f"== {day.name} (run tag {sd.TAG}): {len(rows) - len(failed)} passed, {len(failed)} failed")
        for r in rows:
            print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}  ({r.get('detail')})")
    left = run_checks.query(sd.LEFTOVERS, False) or []
    if left:
        print("LEFT BEHIND after the rollback:", [x["what"] for x in left])
        sys.exit(2)
    print("Nothing persisted: the run used temp copies only and rolled back.")
    sys.exit(0 if not failed_total else 1)


if __name__ == "__main__":
    main()
