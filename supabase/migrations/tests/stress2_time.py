#!/usr/bin/env python3
"""TIME stress, second series, round 1: the SQL itself on a fake clock.

    python3 supabase/migrations/tests/stress2_time.py             # every day below
    python3 supabase/migrations/tests/stress2_time.py second_try  # one day

Built on round 2's day simulation (stress_time_day.py): ONE transaction that
ends in rollback, on temp copies (pg_temp) of the live-calls tables, with the
deployed functions, triggers and presence view and migration 20261003d (the
repo's) rewritten to read the temp tables and a fake clock. The sweep runs
every step, the watchdog every five minutes, and the room worker, the hosts
and sales-api's settle are played in between. Synthetic names only:
contacts 'stress-tday-{tag}-...', hosts '...@stress.invalid'. After the run a
read-only query proves nothing of it is in public.

Exit 0 only when every check passed. A FAIL is a finding: its name says what
should hold, its detail what the day did.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_checks  # noqa: E402
import stress_time_day as sd  # noqa: E402
from stress_time_day import Day, contact, email, kw, lit, ts  # noqa: E402

# Migration d is applied now: the deployed worker-status trigger calls its own
# function, which the round 2 copy list predates.
for _fn in ("cockpit_sales_worker_status_clock", "cockpit_sales_live_hours_open"):
    if _fn not in sd.FUNCTIONS:
        sd.FUNCTIONS.append(_fn)


# ---------------------------------------------------------------------------
# Thursday 8 October 10:50 to 11:45 (Kuwait): a second try at the intro
# ---------------------------------------------------------------------------

def second_try() -> Day:
    """The setter's intro is at 11:00. They ring at 10:58, no answer, and send
    a video link (room A); the lead never opens it and R4 closes it at 11:09.
    The intro is still in the dialer (to 11:20), so at 11:15 the setter rings
    again, no answer, and sends a second link (room B), which the lead never
    opens either; R4 closes it at 11:26. Nobody joined either room. At 11:21
    (start + settle) room A is due to be settled while room B is still open."""
    d = Day("Second try", kw("2026-10-08 10:50:00"), kw("2026-10-08 11:45:00"))
    d.person("setter", "setter")
    d.booked("appt-2", "lead-2", "setter", kw("2026-10-08 11:00:00"))
    d.fallback_room(kw("2026-10-08 10:58:00"), "setter", "lead-2", "appt-2")
    d.host_in(kw("2026-10-08 10:58:40"), "setter")
    d.fallback_room(kw("2026-10-08 11:15:00"), "setter", "lead-2", "appt-2")
    d.host_in(kw("2026-10-08 11:15:40"), "setter")
    d.run(d.start, d.end)

    lead = lit(contact("lead-2"))
    rooms = (f"(select string_agg(r.code || ' ' || r.state || '/' || coalesce(r.end_reason, '-') || ' made ' || "
             f"to_char(r.requested_at at time zone 'Asia/Kuwait', 'HH24:MI') || ' lead_in=' || coalesce(r.lead_in_at::text, 'never') || "
             f"' settled=' || coalesce(r.settled_mark, '-'), '; ' order by r.requested_at) "
             f"from pg_temp.cockpit_sales_rooms as r where r.contact_id = {lead})")
    alerts = (f"(select string_agg(a.dedupe_key || ' open=' || (a.resolved_at is null)::text || ': ' || a.message, ' | ') "
              f"from pg_temp.cockpit_sales_alerts as a where a.kind = 'room_mark_intro')")
    appt = f"(select x.status from pg_temp.cockpit_sales_appointments as x where x.appointment_id = {lit(contact('appt-2'))})"

    d.check("setup: nobody joined either room, and the intro is settled a no-show by the second room",
            f"{appt} = 'noshow' and not exists (select 1 from pg_temp.cockpit_sales_rooms as r "
            f"where r.contact_id = {lead} and r.lead_in_at is not null)",
            f"{rooms} || ' intro=' || {appt}")
    d.check("no alert says the lead joined another room for this call when nobody joined any room "
            "(room B was only still open when room A came due at 11:21)",
            "not exists (select 1 from pg_temp.cockpit_sales_alerts as a where a.kind = 'room_mark_intro' "
            "and a.message ~* 'joined another room')",
            f"{alerts} || ' rooms: ' || {rooms}")
    d.check("once the intro is settled a no-show, no open alert asks a person to mark it shown or a no-show",
            f"not ({appt} = 'noshow' and exists (select 1 from pg_temp.cockpit_sales_alerts as a "
            "where a.kind = 'room_mark_intro' and a.resolved_at is null))",
            f"'intro=' || {appt} || ' alerts: ' || coalesce({alerts}, 'none')")
    return d


# ---------------------------------------------------------------------------
# Thursday 8 October 13:45 to 15:10 (Kuwait): a demo that ends early
# ---------------------------------------------------------------------------

def early_end() -> Day:
    """The closer's demo is booked 14:00 to 15:00 (rooms.lengths_min: a demo is
    60 minutes; the presence view holds them on a call that long). It ends at
    14:46 and the closer presses I'm available at 14:47 (rooms.ts
    live.availability makes a standby room on press). The sweep's booked
    guard (R6) reads a booked call as running for rooms.booking_min (45, the
    live booking's slot), so from 14:45 it no longer closes the standby room
    though the presence view still holds the closer on the 14:00 demo."""
    d = Day("Early end", kw("2026-10-08 13:45:00"), kw("2026-10-08 15:10:00"))
    d.person("closer-e", "closer", auto_join=False)
    d.booked("appt-e", "lead-e", "closer-e", kw("2026-10-08 14:00:00"), kind="demo")
    d.available(kw("2026-10-08 14:47:00"), "closer-e", kw("2026-10-08 16:47:00"))
    d.run(d.start, d.end)
    who = lit(email("closer-e"))
    d.check("while the presence view holds the closer on their booked demo (14:47 to 15:00), no standby room of "
            "theirs stays open (R6: a booked call running now, Zoom allows one meeting per host)",
            f"not exists (select 1 from pg_temp.sim_log as l where l.email = {who} and l.presence = 'on_call' "
            "and l.why = 'appointment' and l.standby_live > 0)",
            f"(select string_agg(to_char(l.t at time zone 'Asia/Kuwait', 'HH24:MI') || '=' || coalesce(l.presence, '-') || "
            f"'/' || coalesce(l.why, '-') || ' standby=' || l.standby_live, ' ') from pg_temp.sim_log as l "
            f"where l.email = {who} and l.t >= {ts(kw('2026-10-08 14:46:00'))} and l.t <= {ts(kw('2026-10-08 15:01:00'))})")
    return d


DAYS = {"second_try": second_try, "early_end": early_end}


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
