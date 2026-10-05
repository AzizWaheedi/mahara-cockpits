#!/usr/bin/env python3
"""JOURNEYS stress, second series, round 3: a rep's journey on the SQL itself.

    python3 supabase/migrations/tests/stress2_journeys_r3.py                     # every journey below
    python3 supabase/migrations/tests/stress2_journeys_r3.py meet_standby_hour   # one journey

Built on the day simulation (stress_time_day.py): ONE transaction that ends
in rollback, on temp copies (pg_temp) of the live-calls tables, with the
deployed functions, triggers and presence view, and migrations 20261003d and
20261004a (the repo's) rewritten to read the temp tables and a fake clock.
The sweep runs every minute; the room worker is played in between. Synthetic
names only (contacts 'stress-tday-{tag}-...', hosts '...@stress.invalid').
After the run a read-only query proves nothing of it is in public.

Exit 0 only when every check passed. A FAIL is a finding: its name says what
should hold, its detail what the journey did.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stress2_journeys as j1  # noqa: E402
import stress_time_day as sd  # noqa: E402
from stress_time_day import Day, email, kw, lit, ts  # noqa: E402


# ---------------------------------------------------------------------------
# Thursday 8 October 10:00 to 10:50 (Kuwait): a setter waits in a Meet standby room
# ---------------------------------------------------------------------------

def meet_standby_hour() -> Day:
    """The setter (Zoom seat pending, Google fine: Meet is theirs, roomlogic
    defaultProvider) presses I'm available at 10:02 until 12:02. The worker
    makes the Meet standby room; the setter presses Join my room, then I'm in
    (the strip's Meet press, room.mark host_in), and waits in the Meet for a
    live lead. Meet does not close a meeting with one person in it; that is
    Zoom's 40-minute rule (glossary 1.9, the reason for R5's standby_max)."""
    d = Day("Meet standby, an hour", kw("2026-10-08 10:00:00"), kw("2026-10-08 10:50:00"))
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
    rooms = (f"(select string_agg(r.provider || ' ' || r.state || '/' || coalesce(r.end_reason, '-') || ' opened ' || "
             f"coalesce(to_char(r.opened_at at time zone 'Asia/Kuwait', 'HH24:MI'), '-') || ' ended ' || "
             f"coalesce(to_char(r.ended_at at time zone 'Asia/Kuwait', 'HH24:MI'), '-'), '; ' order by r.requested_at) "
             f"from pg_temp.cockpit_sales_rooms as r where r.host_email = {me} and r.purpose = 'standby')")
    said = (f"(select string_agg(distinct e.text, ' | ') from pg_temp.cockpit_sales_room_events as e "
            f"join pg_temp.cockpit_sales_rooms as r on r.id = e.room_id where r.host_email = {me} "
            "and e.text ~* 'zoom')")
    d.check("setup: the standby room was made on Meet and the setter was in it (Ready)",
            f"exists (select 1 from pg_temp.sim_log as l where l.email = {me} and l.presence = 'ready')",
            rooms)
    d.check("a Meet standby room with its host in it is not closed at standby_max for Zoom's 40-minute rule",
            f"not exists (select 1 from pg_temp.cockpit_sales_rooms as r where r.host_email = {me} "
            "and r.purpose = 'standby' and r.provider = 'meet' and r.end_reason = 'standby_refresh')",
            f"{rooms} || ' said: ' || coalesce({said}, '-')")
    return d


DAYS = {"meet_standby_hour": meet_standby_hour}


def main() -> None:
    names = sys.argv[1:] or list(DAYS)
    failed_total = 0
    for name in names:
        day = DAYS[name]()
        rows = j1.query(sd.compose(day), write=True) or []
        failed = [r for r in rows if not r.get("ok")]
        failed_total += len(failed) + (0 if rows else 1)
        print(f"== {day.name} (run tag {sd.TAG}): {len(rows) - len(failed)} passed, {len(failed)} failed")
        for r in rows:
            print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}  ({r.get('detail')})")
    left = j1.query(sd.LEFTOVERS, False) or []
    if left:
        print("LEFT BEHIND after the rollback:", [x["what"] for x in left])
        sys.exit(2)
    print("Nothing persisted: the run used temp copies only and rolled back.")
    sys.exit(0 if not failed_total else 1)


if __name__ == "__main__":
    main()
