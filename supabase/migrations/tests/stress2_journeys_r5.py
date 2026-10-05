#!/usr/bin/env python3
"""JOURNEYS stress, second series, round 5: a rep's journey on the SQL itself.

    python3 supabase/migrations/tests/stress2_journeys_r5.py                    # every journey below
    python3 supabase/migrations/tests/stress2_journeys_r5.py late_open_settle   # one journey

Built on the day simulation (stress_time_day.py): ONE transaction that ends
in rollback, on temp copies (pg_temp) of the live-calls tables, with the
deployed functions, triggers and presence view, and migrations 20261003d and
20261004a (the repo's) rewritten to read the temp tables and a fake clock.
The sweep runs every minute; the room worker, the door and sales-api's
settle are played in between. Synthetic names only (contacts
'stress-tday-{tag}-...', hosts '...@stress.invalid'). After the run a
read-only query proves nothing of it is in public.

Exit 0 only when every check passed. A FAIL is a finding: its name says what
should hold, its detail what the journey did.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stress2_journeys as j1  # noqa: E402
import stress_time_day as sd  # noqa: E402
from stress_time_day import Day, contact, kw, lit  # noqa: E402

# 20261004a's settle (S1) reads the lead's calls (dials) and the lead copy
# (phone8): without temp copies of them its block fails and nothing settles.
for _t in ("cockpit_sales_dials", "cockpit_sales_leads"):
    if _t not in sd.TABLES:
        sd.TABLES.append(_t)


# ---------------------------------------------------------------------------
# Thursday 8 October 10:00 to 10:40 (Kuwait): a booked intro whose lead opens
# the video link only after the room closed
# ---------------------------------------------------------------------------

def late_open_settle() -> Day:
    """The setter's booked intro at 10:00. The call at 10:00 rings out; the
    setter sends a Zoom link (fallback room for the intro) and goes in. The
    lead does not open it in time: the sweep's R4 closes the room at lead_by
    (10:10). At 10:13 the lead taps the link on WhatsApp; the door shows them
    "This call has ended" and stores only its door.open row with after_end
    (sales-live handler.ts recordOpen: no open columns on a closed room).
    At start + settle (10:20) the sweep's S1 decides whether the intro is a
    no-show. A Zoom join after the close holds the settle ('someone joined
    the meeting after the room closed'); an open of the link after it is the
    same lead coming late, inside the intro's own window."""
    d = Day("Late open, then the settle", kw("2026-10-08 09:58:00"), kw("2026-10-08 10:30:00"))
    d.person("setter", "setter")
    d.booked("appt-late", "lead-late", "setter", kw("2026-10-08 10:00:00"))
    d.fallback_room(kw("2026-10-08 10:00:10"), "setter", "lead-late", "appt-late")
    d.host_in(kw("2026-10-08 10:00:40"), "setter")
    lead = lit(contact("lead-late"))
    d.at(kw("2026-10-08 10:13:00"),
         "insert into pg_temp.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, text, detail) "
         "select r.id, 'door.open', 'door', 'stress-tday-open-' || r.id::text, pg_temp.sim_now(), pg_temp.sim_now(), "
         "'The lead opened the link after the room closed.', "
         "jsonb_build_object('device', 'phone', 'room_state', r.state, 'after_end', true) "
         f"from pg_temp.cockpit_sales_rooms as r where r.contact_id = {lead}")
    d.run(d.start, d.end)

    room = (f"(select string_agg(r.state || '/' || coalesce(r.end_reason, '-') || ' ended ' || "
            f"coalesce(to_char(r.ended_at at time zone 'Asia/Kuwait', 'HH24:MI'), '-') || ' settled ' || "
            f"coalesce(r.settled_mark, '-'), '; ') from pg_temp.cockpit_sales_rooms as r where r.contact_id = {lead})")
    appt = f"(select a.status from pg_temp.cockpit_sales_appointments as a where a.appointment_id = {lit(contact('appt-late'))})"
    d.check("setup: the room closed before the lead opened the link, and the door's late open is stored",
            f"exists (select 1 from pg_temp.cockpit_sales_rooms as r where r.contact_id = {lead} and r.state = 'expired' "
            "and r.ended_at < " + sd.ts(kw("2026-10-08 10:13:00")) + ") and exists (select 1 from "
            "pg_temp.cockpit_sales_room_events as e join pg_temp.cockpit_sales_rooms as r on r.id = e.room_id "
            f"where r.contact_id = {lead} and e.kind = 'door.open')",
            room)
    d.check("an intro whose lead opened the link at 10:13 (inside start + settle) is not settled a no-show "
            "as if nobody came",
            f"coalesce({appt}, '-') <> 'noshow'",
            f"'appointment ' || coalesce({appt}, '-') || '; room ' || coalesce({room}, '-')")
    return d


DAYS = {"late_open_settle": late_open_settle}


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
