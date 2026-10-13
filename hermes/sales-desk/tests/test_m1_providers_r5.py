"""Milestone 1, video-link round 5, provider quirks on the room worker's side
(2026-10-06): what the host check stores when a closer is seen in a Zoom
meeting, and how long that holds. Each test drives the real worker through the
fakes the lane's own tests use (tests/test_rooms.py); a failing test names a
defect for the fix lane. Every seat and meeting is invented; nothing reaches
the network.

    python3 -m unittest tests.test_m1_providers_r5
"""
from __future__ import annotations

import os

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms  # noqa: E402
from tests.test_rooms import CLOSER, RoomsCase  # noqa: E402


# ---------------------------------------------------------------------------
# 1. The closer's Zoom meeting is seen live by the host check (every 10
#    minutes). zoom_seat stores zoom_live_until as the meeting's own
#    scheduled end (start_time + duration), not when it was seen. sales-api's
#    providerRefusal reads that column as "in another meeting" until it
#    passes, so a 60-minute meeting seen five minutes in holds the closer's
#    Zoom rooms "busy" for the next 55 minutes of the column, whatever Zoom
#    says. Most meetings end before their slot; the next check (up to ten
#    minutes on) is the only thing that clears it. The worker itself reads
#    Zoom's live list at each create, so nothing needs the column to hold
#    longer than the check that saw it.
# ---------------------------------------------------------------------------

class HostCheckStoresTheScheduledEnd(RoomsCase):
    def test_held_control_a_meeting_with_no_duration_is_stamped_with_the_check(self):
        w = self.env.worker("run-host-ctl")
        now = self.env.clock()
        self.env.zoom.live["zu-closer"] = [{"id": 55500000001, "topic": "Team sync", "start_time": rooms.iso(now - 300)}]
        seat = w.zoom_seat(CLOSER, f"{CLOSER} (closer)")
        until = rooms.parse_ts(seat.get("live_until"))
        self.assertIsNotNone(until)
        self.assertLessEqual(until - now, 60)

    def test_zoom_busy_held_to_scheduled_end(self):
        w = self.env.worker("run-host")
        now = self.env.clock()
        # A 60-minute team meeting that started five minutes ago (it will end at minute 8).
        self.env.zoom.live["zu-closer"] = [{"id": 55500000002, "topic": "Team sync", "start_time": rooms.iso(now - 300),
                                            "duration": 60}]
        seat = w.zoom_seat(CLOSER, f"{CLOSER} (closer)")
        until = rooms.parse_ts(seat.get("live_until"))
        self.assertIsNotNone(until)
        held = (until or now) - now
        self.assertLessEqual(
            held, 15 * 60,
            f"The host check saw the closer's meeting once, five minutes into a 60-minute slot, and stored "
            f"zoom_live_until {round(held / 60)} minutes ahead; sales-api refuses the closer's Zoom rooms "
            "(\"Your Zoom is in another meeting\") until then or the next check, though the meeting may have ended")


if __name__ == "__main__":
    import unittest

    unittest.main()
