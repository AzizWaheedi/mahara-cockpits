"""Stress series 2, round 2, chaos on the desk side (2026-10-04): every
dependency failing, hanging or answering garbage at a step. Each test drives
the real code through the fakes the lane's own tests use and asserts what
must hold; a failing test names a defect for the fix lane. Every room, lead,
seat and line is invented; nothing reaches the network.

    python3 -m unittest tests.test_stress2_chaos_r2
"""
from __future__ import annotations

import os
import unittest

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms  # noqa: E402
from tests.test_rooms import CLOSER, RoomsCase  # noqa: E402


# ---------------------------------------------------------------------------
# 1. Zoom's live-meeting list stops answering after a meeting was seen.
#    check_hosts keeps the last known zoom_live_until when the live list
#    cannot be read (missing is never zero), but it writes checked_at = now
#    on every check whose user read worked. 20261004a's presence view holds a
#    host on a Zoom call while "zoom_live_until is not null and checked_at >
#    now() - 15 minutes" (the floor for a meeting the last check SAW live).
#    So a demo seen at 10:00 and ended at 11:00, followed by a live list
#    that fails (Zoom's 5xx or 429 on GET /users/{id}/meetings?type=live) at
#    every check, holds the closer "on a call" (why = 'zoom') for as long as
#    the list fails: each check renews the floor from a meeting that ended
#    hours ago. The strip says On a call, and Available makes no standby room.
# ---------------------------------------------------------------------------

class TheLiveListStopsAnsweringAfterAMeeting(RoomsCase):
    def _floor_holds(self, row: dict, now: float) -> bool:
        """20261004a's presence view, zoom_live: (zoom_live_until > now) or
        (zoom_live_until is not null and checked_at > now - 15 minutes)."""
        until = rooms.parse_ts(row.get("zoom_live_until"))
        checked = rooms.parse_ts(row.get("checked_at"))
        return bool((until is not None and until > now)
                    or (until is not None and checked is not None and checked > now - 15 * 60))

    def test_held_control_a_live_list_that_answers_lets_the_closer_go(self):
        self.env.pg.put("cockpit_sales_people", {"email": CLOSER, "name": "Invented Name", "role": "closer",
                                                 "active": True, "via_portal": True})
        now = self.env.clock()
        self.env.zoom.live["zu-closer"] = [{"id": 99001, "start_time": rooms.iso(now - 30 * 60), "duration": 60}]
        self.env.worker().check_hosts()
        self.env.clock.advance(2 * 3600)
        self.env.zoom.live["zu-closer"] = []
        self.env.worker().check_hosts()
        row = self.env.pg.one(rooms.HOSTS, email=CLOSER)
        self.assertFalse(self._floor_holds(row, self.env.clock()))

    def test_a_live_list_that_fails_never_renews_the_floor_of_a_meeting_that_ended_hours_ago(self):
        self.env.pg.put("cockpit_sales_people", {"email": CLOSER, "name": "Invented Name", "role": "closer",
                                                 "active": True, "via_portal": True})
        now = self.env.clock()
        # 10:00: the closer is in a 60-minute demo that started at 09:30 (ends 10:30).
        self.env.zoom.live["zu-closer"] = [{"id": 99001, "start_time": rooms.iso(now - 30 * 60), "duration": 60}]
        self.env.worker().check_hosts()
        first = self.env.pg.one(rooms.HOSTS, email=CLOSER)
        self.assertIsNotNone(first.get("zoom_live_until"))
        # From 10:30 the demo is over. Zoom's live-meeting list answers 503 at
        # every check from then on (the user read still works).
        self.env.zoom.live["zu-closer"] = []
        for _ in range(12):
            self.env.clock.advance(10 * 60)
            self.env.zoom.script.append({"method": "GET", "path": "/users/zu-closer/meetings", "status": 503,
                                         "body": {"code": 503, "message": "Service unavailable"}})
            self.env.zoom.script.append({"method": "GET", "path": "/users/zu-closer/meetings", "status": 503,
                                         "body": {"code": 503, "message": "Service unavailable"}})
            self.env.zoom.script.append({"method": "GET", "path": "/users/zu-closer/meetings", "status": 503,
                                         "body": {"code": 503, "message": "Service unavailable"}})
            self.env.worker().check_hosts()
        row = self.env.pg.one(rooms.HOSTS, email=CLOSER)
        t = self.env.clock()
        # 12:00: the demo ended 90 minutes ago; nobody has seen the closer in a meeting since 10:00.
        self.assertFalse(
            self._floor_holds(row, t),
            f"at {rooms.iso(t)} the host row says zoom_live_until={row.get('zoom_live_until')} "
            f"checked_at={row.get('checked_at')}: the presence view holds the closer on a Zoom call from a meeting "
            "that ended 90 minutes ago, renewed by checks that never read the live list")


if __name__ == "__main__":
    unittest.main()
