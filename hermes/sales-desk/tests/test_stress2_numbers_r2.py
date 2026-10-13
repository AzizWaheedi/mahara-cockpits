"""Second series, round 2, numbers and data integrity, desk side: a live
call only a hand press reported. Every lead and figure is invented.

    python3 -m unittest tests.test_stress2_numbers_r2

Since the final review (rooms.ts leadEvidence), a join that only "The lead
is in" reports (every Meet room: Meet sends no join signal, and a setter's
Zoom seat is still pending, so a setter's rooms are Meet) is never booked or
marked by the count: it is recorded count_result self_reported and waits for
a manager's confirm (room.count_confirm), possibly for days. The desk reads
live calls only from rooms whose count booked or moved one
(followups.live_calls: count_result in (booked, moved)), so a lead the setter
just talked to on video is, to the desk, a lead nobody reached: still in the
never-booked pool, and a no-show the "we missed you" sequence goes to. The
round-2 test of the first series (test_stress_numbers_live_calls_seen) seeds
a Meet room with count_result booked, a state the count no longer writes.

A failure here is a finding.
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu  # noqa: E402
from desk import http, waves  # noqa: E402
from tests import fakes  # noqa: E402
from tests.test_waves import NOW, sb, seed  # noqa: E402

fakes.PK.setdefault("cockpit_sales_rooms", ("id",))


def pg_with_rooms() -> fakes.FakePostgrest:
    pg = fakes.FakePostgrest()
    pg.tables.setdefault("cockpit_sales_rooms", {})
    return pg


def hand_pressed_join(pg: fakes.FakePostgrest, c: str, joined, appointment_id=None) -> None:
    """The setter's Meet room the lead joined, as sales-api leaves it: the host
    pressed The lead is in, the count recorded self_reported (a manager confirms)."""
    pg.put("cockpit_sales_rooms", {
        "id": f"room-{c}", "contact_id": c, "purpose": "fallback" if appointment_id else "manual",
        "trigger": "no_answer", "call_kind": "intro", "provider": "meet", "host_email": "setter@stress.invalid",
        "appointment_id": appointment_id, "state": "ended", "result": "joined", "end_reason": "finished",
        "lead_in_at": joined.isoformat(), "ended_at": (joined + timedelta(minutes=25)).isoformat(),
        "count_claimed_at": joined.isoformat(), "count_result": "self_reported", "count_appointment_id": None,
    })


class HandPressedJoinSeen(unittest.TestCase):
    def test_self_reported_join_lead_left_in_never_booked_pool(self):
        """A new tagged lead never booked: the setter's dial went unanswered, a Meet link went, the lead
        joined three hours ago and talked for twenty-five minutes (The lead is in, pressed by the setter).
        The never-booked pool, and so a backlog opener, must not take a lead who just had that call."""
        pg = pg_with_rooms()
        seed(pg, "stress-s2n2-desk-1", "never_booked", days=2)
        hand_pressed_join(pg, "stress-s2n2-desk-1", NOW - timedelta(hours=3))
        with mock.patch.object(http, "request", pg):
            out = waves.pools(sb(), NOW)
        self.assertNotIn("stress-s2n2-desk-1", [c for c, _ in out["never_booked"]],
                         "a lead who talked to the setter live an hour ago is still 'never booked'")

    def test_self_reported_join_gets_no_show_sequence(self):
        """The setter marked the 09:00 intro a no-show at 09:10 (no answer), sent a Meet link, and the
        lead joined at 09:12 and had the intro (The lead is in). The desk must not write the no-show
        sequence ("we missed you, let's find another time") to the lead who just had the call."""
        pg = pg_with_rooms()
        c = "stress-s2n2-desk-2"
        start = NOW - timedelta(hours=1)
        lead = {"contact_id": c, "name": "Omar", "country": "Kuwait", "tags": ["roas-qualified"],
                "lead_created_at": (NOW - timedelta(days=3)).isoformat(), "lead_class": "qualified",
                "phone": "+96550000000", "dnd": False}
        pg.put("cockpit_sales_leads", lead)
        intro = {"appointment_id": f"{c}-intro", "contact_id": c, "call_type": "intro", "status": "noshow",
                 "start_at": start.isoformat(), "booked_at": (start - timedelta(days=2)).isoformat()}
        hand_pressed_join(pg, c, start + timedelta(minutes=12), appointment_id=intro["appointment_id"])
        with mock.patch.object(http, "request", pg):
            calendar = fu.with_live([intro], fu.live_calls(sb(), [c]))
        picked = fu.pick(NOW, inbox=[], calendar=calendar, leads=[lead])
        self.assertNotIn(("no_show", c), [(p["segment"], p["contact_id"]) for p in picked],
                         "the no-show sequence is drafted for a lead who joined the video call and had the intro")


if __name__ == "__main__":
    unittest.main()
