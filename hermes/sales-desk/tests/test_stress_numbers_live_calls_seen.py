"""Stress round 2, numbers and data integrity, desk side: a live call the
count booked is a call the desk can see. Every lead and figure is invented.

    python3 -m unittest tests.test_stress_numbers_live_calls_seen

When a tagged lead joins a video room, sales-api's count books a "Live ·"
call on rooms.live_calendar_id and marks it shown (D2). D25 keeps that
calendar out of B2B's show-rate map, and the cockpit's appointments copy
(sales-mirror) takes intro and demo calls from B2B only (follow-up and
callback calendars from HighLevel), so the live call never reaches
cockpit_sales_appointments or the cockpit_sales_calendar view. The room row
(cockpit_sales_rooms: lead_in_at, count_result booked or moved,
count_appointment_id) is the cockpit's only record of it.

The desk decides who is in a backlog pool, who is "never booked", and what
an opener did, from cockpit_sales_calendar alone. So a lead who just had
their intro live is still "never booked" (an opener and the "new" sequence
go to them), and a wave lead whose reply turned into a live call is not
"booked" in the wave's comparison. A failure here is a finding, kept as a
regression test for its fix.
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, waves  # noqa: E402
from tests import fakes  # noqa: E402
from tests.test_waves import NOW, ago, members, sb, seed, wave  # noqa: E402

fakes.PK.setdefault("cockpit_sales_rooms", ("id",))
LIVE_CAL = "LiveCallsOnlyCalendar"


def pg_with_rooms() -> fakes.FakePostgrest:
    pg = fakes.FakePostgrest()
    pg.tables.setdefault("cockpit_sales_rooms", {})
    return pg


def live_call(pg: fakes.FakePostgrest, c: str, joined) -> None:
    """The room the lead joined, as sales-api leaves it once the count booked the live call."""
    pg.put("cockpit_sales_rooms", {
        "id": f"room-{c}", "contact_id": c, "purpose": "fallback", "trigger": "no_answer", "call_kind": "intro",
        "provider": "meet", "host_email": "setter@stress.invalid", "state": "ended", "result": "joined",
        "lead_in_at": joined.isoformat(), "ended_at": (joined + timedelta(minutes=20)).isoformat(),
        "count_claimed_at": joined.isoformat(), "count_result": "booked", "count_appointment_id": f"live-{c}",
    })


class LiveCallsSeen(unittest.TestCase):
    def test_live_call_invisible_to_desk_pool(self):
        """A new tagged lead: the setter's dial went unanswered, the lead joined the video link three
        hours ago and talked for twenty minutes; the count booked "Live · Omar" and marked it shown.
        That lead has had their intro: never "never booked"."""
        pg = pg_with_rooms()
        seed(pg, "stress-live-1", "never_booked", days=2)
        live_call(pg, "stress-live-1", NOW - timedelta(hours=3))
        with mock.patch.object(http, "request", pg):
            out = waves.pools(sb(), NOW)
        self.assertNotIn("stress-live-1", [c for c, _ in out["never_booked"]],
                         "a lead who just had their intro on a live call is still in the never-booked pool")

    def test_live_call_invisible_to_desk_wave_outcome(self):
        """A wave lead had their opener, wrote back two days later, and the setter took them into a
        video room the same hour: the count booked the live call. That is the opener's booking."""
        pg = pg_with_rooms()
        wave(pg, "w1", "no_show_cancelled")
        t0 = NOW - timedelta(days=15)
        pg.put(waves.MEMBERS, {"wave_id": "w1", "contact_id": "stress-live-2", "arm": "wave", "state": "sent",
                               "sent_at": t0.isoformat(), "added_at": ago(days=16)})
        live_call(pg, "stress-live-2", t0 + timedelta(days=2))
        with mock.patch.object(http, "request", pg):
            waves.outcomes(sb(), ["w1"], NOW)
        m = members(pg, "w1")[0]
        self.assertEqual(m["state"], "booked", "the live call the opener led to is not counted as a booking")


if __name__ == "__main__":
    unittest.main()
