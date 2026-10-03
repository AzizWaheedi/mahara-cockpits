"""Chaos round 3 (3 October 2026): the room worker's host check when Zoom
fails half-way.

The host check (rooms --check-hosts, every 10 minutes) writes each seat's
Zoom status and `zoom_live_until`: when the host's live Zoom meeting ends.
sales-api reads it as "the host is in a live Zoom meeting" (createRefusal's
zoom_live: one meeting per host on Zoom) and the presence view reads it as
on_call, so no live lead is offered to a closer already in a Zoom call.

When Zoom answers the user but not the live-meetings list, the check writes
zoom_live_until = null over the last known value: a closer in a client's
Zoom call reads as free. Missing is never zero: a list that could not be
read keeps the last known value.

    python3 -m unittest tests.test_stress_chaos_r3
"""
from __future__ import annotations

import unittest

from desk import rooms
from tests.test_rooms import CLOSER, SETTER, RoomsCase


class HostCheckLiveListFails(RoomsCase):
    def seats(self):
        for email, role in ((SETTER, "setter"), (CLOSER, "closer")):
            self.env.pg.put("cockpit_sales_people", {"email": email, "name": "Invented Name", "role": role,
                                                     "active": True, "via_portal": True})
        self.env.zoom.live["zu-closer"] = [{"id": 1, "start_time": "2026-10-03T09:50:00Z", "duration": 60}]
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]

    def test_held_the_closer_in_a_live_zoom_meeting_is_written(self):
        self.seats()
        self.env.worker().check_hosts()
        self.assertEqual(self.env.pg.one(rooms.HOSTS, email=CLOSER)["zoom_live_until"], "2026-10-03T10:50:00.000Z")

    def test_zoom_fails_the_live_list_ten_minutes_later_the_last_known_meeting_stays(self):
        self.seats()
        self.env.worker().check_hosts()
        self.assertEqual(self.env.pg.one(rooms.HOSTS, email=CLOSER)["zoom_live_until"], "2026-10-03T10:50:00.000Z")
        # Ten minutes on, the closer is still in that meeting; Zoom answers the
        # user but fails the live-meetings list (a 503, or a timeout).
        self.env.clock.advance(600)
        # Every try fails (the sender's own retries included).
        self.env.zoom.script = [{"method": "GET", "path": "/users/zu-closer/meetings", "status": 503} for _ in range(6)]
        self.env.worker().check_hosts()
        row = self.env.pg.one(rooms.HOSTS, email=CLOSER)
        # The check wrote zoom_live_until = null: "not in a meeting" from a
        # list it could not read.
        self.assertEqual(row["zoom_live_until"], "2026-10-03T10:50:00.000Z")


if __name__ == "__main__":
    unittest.main()
