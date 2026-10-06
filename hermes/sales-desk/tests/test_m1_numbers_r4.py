"""Milestone 1, video-link round 4, NUMBERS AND RECORDS: the room worker's
close of a finished Zoom room reads the join that stands, as every other
reader does (cockpit_sales_room_join_stands, desk/rooms.py join_stands,
sales-live door.ts leadReached, roomlogic.ts leadJoined).

"That was not the lead" keeps the taken-back join's time in lead_in_at as
evidence (taken_back_join_at and count_undo_at beside it); the room waits
for the real lead and, when nobody comes, the sweep closes it expired
(lead_no_show). Worker._scan_finals reads the raw lead_in_at as "a room a
lead reached": it never ends or deletes that Zoom meeting, drops the host
link and counts it in its status sentence as closed. The real lead's link
then still opens a live meeting no room tracks, and the worker's "N closed"
counts a meeting it left running.

A test that fails here is a finding; tests named "control" pass. Every room,
seat and meeting is invented; no test reaches the network.

    cd hermes/sales-desk && python3 -m unittest tests.test_m1_numbers_r4
"""
from __future__ import annotations

import os
import unittest
from typing import Any

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms  # noqa: E402
from tests.test_rooms import SETTER, T0, RoomsCase, rid  # noqa: E402


class FinishedZoomRoomIsClosed(RoomsCase):
    def expired(self, **over: Any) -> str:
        """A setter's Zoom room the sweep closed as a no-show 2 s ago; its
        meeting still started at Zoom with only the host in it."""
        m = self.env.zoom._make("zu-setter", {"topic": "Mahara call NOTL01"})
        self.env.zoom.meetings[str(m["id"])]["status"] = "started"
        self.env.add_room(1, **{"code": "NOTL01", "state": "expired", "end_reason": "lead_no_show", "result": "no_join",
                                "provider_meeting_id": str(m["id"]), "host_in_at": rooms.iso(T0 - 900),
                                "ended_at": rooms.iso(T0 - 2), **over})
        self.env.pg.put(rooms.SECRETS, {"room_id": rid(1), "start_url": m["start_url"], "expires_at": None})
        mid = str(m["id"])
        self.env.zoom.participants[mid] = [{"id": "zu-setter", "user_name": "Host", "email": SETTER}]
        return mid

    def test_control_nobody_joined_the_meeting_is_ended_and_deleted(self):
        mid = self.expired()
        self.env.worker().run(seconds=0)
        self.assertNotIn(mid, self.env.zoom.meetings)

    def test_a_join_taken_back_by_that_was_not_the_lead_is_no_join_so_the_meeting_is_ended_too(self):
        # Someone joined at T0-800 (lead_in), the host pressed "That was not
        # the lead" at T0-760; the real lead never came.
        mid = self.expired(lead_in_at=rooms.iso(T0 - 800), lead_in_seen_at=rooms.iso(T0 - 800),
                           count_undo_at=rooms.iso(T0 - 760), taken_back_join_at=rooms.iso(T0 - 800))
        self.assertFalse(rooms.join_stands(self.env.room()))
        self.env.worker().run(seconds=0)
        self.assertNotIn(mid, self.env.zoom.meetings,
                         "the meeting of a room nobody joined is left running at Zoom because of a taken-back join")


if __name__ == "__main__":
    unittest.main()
