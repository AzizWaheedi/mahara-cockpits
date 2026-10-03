#!/usr/bin/env python3
"""TIME stress, round 3: a night between a confirmation call and the intro it
confirms, and a demo that runs past its slot, on a fake clock, the SQL itself.

    python3 supabase/migrations/tests/stress_time_r3.py             # every day below
    python3 supabase/migrations/tests/stress_time_r3.py confirm     # one day

Built on round 2's day simulation (stress_time_day.py): ONE transaction that
ends in rollback, on temp copies (pg_temp) of the live-calls tables, with the
deployed functions, triggers and presence view and migration 20261003d (the
repo's) rewritten to read the temp tables and a fake clock. The sweep runs
every step, the watchdog every five minutes, and the room worker, the hosts
and sales-api's settle are played in between. Synthetic names only: contacts
'stress-tday-{tag}-...', hosts '...@stress.invalid'. After the run a
read-only query proves nothing of it is in public.

Exit 0 only when every check passed. A FAIL is a finding: its name says what
should hold, its detail what the day did.
"""
from __future__ import annotations

import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_checks  # noqa: E402
import stress_time_day as sd  # noqa: E402
from stress_time_day import Day, contact, email, kw, lit, ts  # noqa: E402


# ---------------------------------------------------------------------------
# Wednesday 7 October 17:55 to Thursday 8 October 15:30 (Kuwait)
# ---------------------------------------------------------------------------

def confirm() -> Day:
    """The dialer puts an intro's confirmation call on the evening before a
    call that starts before noon (desk followups.py confirm_from: 18:00), and
    a "confirm" item for a booked intro passes the intro's appointment_id to
    "Send a video link" (DialerPage.tsx videoAsk). The lead does not answer
    the confirmation call nor open the link; the room closes at 18:1x. The
    next morning the intro itself happens by phone at 11:00 and nobody has
    marked it by 11:21 (the call is still going)."""
    d = Day("Confirm", kw("2026-10-07 17:55:00"), kw("2026-10-08 15:30:00"))
    d.person("setter", "setter")
    # A. The confirmation call's room, 17 hours before the intro.
    d.booked("appt-cf", "lead-cf", "setter", kw("2026-10-08 11:00:00"))
    d.fallback_room(kw("2026-10-07 18:00:00"), "setter", "lead-cf", "appt-cf")
    d.host_in(kw("2026-10-07 18:00:40"), "setter")
    # B. The same morning, 09:00: a confirmation call for a 15:00 intro (09:00
    # that day for a call after noon), no answer, a link nobody opens.
    d.person("setter-b", "setter")
    d.booked("appt-cf9", "lead-cf9", "setter-b", kw("2026-10-08 15:00:00"))
    d.fallback_room(kw("2026-10-08 09:00:00"), "setter-b", "lead-cf9", "appt-cf9")
    d.host_in(kw("2026-10-08 09:00:40"), "setter-b")
    # Control: the setter rings at the intro's own time (10:58), no answer, an
    # empty room: D14's no-show at 11:20 (start + settle) is the design.
    d.booked("appt-own", "lead-own", "setter-b", kw("2026-10-08 11:00:00"))
    d.fallback_room(kw("2026-10-08 10:58:00"), "setter-b", "lead-own", "appt-own")
    d.host_in(kw("2026-10-08 10:58:40"), "setter-b")

    d.run(d.start, kw("2026-10-07 18:30:00"))
    d.run(kw("2026-10-07 18:40:00"), kw("2026-10-08 08:50:00"), step_s=600)
    d.run(kw("2026-10-08 08:55:00"), kw("2026-10-08 09:30:00"))
    d.run(kw("2026-10-08 09:40:00"), kw("2026-10-08 10:50:00"), step_s=600)
    d.run(kw("2026-10-08 10:55:00"), kw("2026-10-08 11:40:00"))
    d.run(kw("2026-10-08 11:50:00"), kw("2026-10-08 15:10:00"), step_s=600)
    d.run(kw("2026-10-08 15:15:00"), d.end)

    def rstate(lead: str) -> str:
        return (f"(select r.state || '/' || coalesce(r.end_reason, '-') || '/' || coalesce(r.result, '-') || "
                f"' made ' || to_char(r.requested_at at time zone 'Asia/Kuwait', 'Dy HH24:MI') || "
                f"' settled=' || coalesce(r.settled_mark, '-') from pg_temp.cockpit_sales_rooms as r "
                f"where r.contact_id = {lit(contact(lead))} order by r.requested_at limit 1)")

    def appt(a: str) -> str:
        return f"(select x.status from pg_temp.cockpit_sales_appointments as x where x.appointment_id = {lit(contact(a))})"

    d.check("A the confirmation call's empty room at 18:00 the evening before never settles the 11:00 intro "
            "a no-show at 11:21 (it says nothing about whether the lead came to the intro)",
            f"{appt('appt-cf')} <> 'noshow'",
            f"{rstate('lead-cf')} || ' intro=' || {appt('appt-cf')}")
    d.check("B a 09:00 confirmation call's empty room never settles that day's 15:00 intro a no-show at 15:21",
            f"{appt('appt-cf9')} <> 'noshow'",
            f"{rstate('lead-cf9')} || ' intro=' || {appt('appt-cf9')}")
    d.check("control: a room made at the intro's own time (10:58) that closed empty settles the intro a no-show "
            "at 11:21 (D14)",
            f"{appt('appt-own')} = 'noshow'",
            f"{rstate('lead-own')} || ' intro=' || {appt('appt-own')}")
    d.check("No sweep in the night reported a failing rule",
            "not exists (select 1 from pg_temp.sim_sweeps as s where jsonb_array_length(coalesce(s.out -> 'errors', '[]')) > 0 "
            "or s.out ? 'skipped')",
            "(select string_agg(to_char(s.t at time zone 'Asia/Kuwait', 'HH24:MI') || ' ' || "
            "coalesce(s.out ->> 'skipped', (s.out -> 'errors')::text), '; ') from pg_temp.sim_sweeps as s "
            "where jsonb_array_length(coalesce(s.out -> 'errors', '[]')) > 0 or s.out ? 'skipped')")
    return d


# ---------------------------------------------------------------------------
# Thursday 8 October 09:55 to 12:05 (Kuwait): a demo that runs past its slot
# ---------------------------------------------------------------------------

def overrun() -> Day:
    """The closer is Available from 10:00 to 12:00. Their demo is booked
    10:30 (a 45-minute slot, as booking_min says) and runs to 11:45 on the
    closer's own Zoom meeting, scheduled for 60 minutes. The host check runs
    every 10 minutes and writes what it writes since fix round 3 (desk
    rooms.py zoom_seat): while Zoom lists the meeting as live,
    zoom_live_until = the later of the meeting's start_time + duration and
    the next check + 5 minutes (it wrote start_time + duration alone before,
    already past from 11:30 on)."""
    d = Day("Overrun", kw("2026-10-08 09:55:00"), kw("2026-10-08 12:05:00"))
    d.person("closer-o", "closer")
    d.booked("appt-o", "lead-o", "closer-o", kw("2026-10-08 10:30:00"), kind="demo")
    d.available(kw("2026-10-08 10:00:00"), "closer-o", kw("2026-10-08 12:00:00"))
    sched_end = kw("2026-10-08 11:30:00")
    t = kw("2026-10-08 10:30:00")
    while t <= kw("2026-10-08 11:40:00"):
        held = max(sched_end, t + timedelta(minutes=15))  # rooms.py HOSTS_EVERY + LIVE_MARGIN_S
        d.at(t, f"update pg_temp.cockpit_sales_room_hosts set zoom_live_until = {ts(held)} "
                f"where email = {lit(email('closer-o'))}")
        t += timedelta(minutes=10)
    d.at(kw("2026-10-08 11:50:00"), "update pg_temp.cockpit_sales_room_hosts set zoom_live_until = null "
                                    f"where email = {lit(email('closer-o'))}")
    d.run(d.start, d.end)
    who = lit(email("closer-o"))
    d.check("the closer is on a call for the whole demo, 10:30 to 11:45, though it runs past its slot and its "
            "meeting's scheduled hour (never offered as ready or available while Zoom lists the meeting as live)",
            f"not exists (select 1 from pg_temp.sim_log as l where l.email = {who} and l.presence <> 'on_call' "
            f"and l.t >= {ts(kw('2026-10-08 10:30:00'))} and l.t < {ts(kw('2026-10-08 11:45:00'))})",
            f"(select string_agg(to_char(l.t at time zone 'Asia/Kuwait', 'HH24:MI') || '=' || coalesce(l.presence, '-') || "
            f"'/' || coalesce(l.why, '-'), ' ') from pg_temp.sim_log as l where l.email = {who} and l.presence <> 'on_call' "
            f"and l.t >= {ts(kw('2026-10-08 10:30:00'))} and l.t < {ts(kw('2026-10-08 11:45:00'))})")
    return d


DAYS = {"confirm": confirm, "overrun": overrun}


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
