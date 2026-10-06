"""Milestone 1, video-link round 6, the CONCURRENCY angle on the room
worker: what the worker does with the Zoom meeting of a room a person (or
the minute's tick) closed through sales-api, which deletes the room's host
link (rooms.ts carryOut: delete_secret, synchronously, right after the state
write) while the worker finds finished rooms to close only through the host
links left in cockpit_sales_room_secrets (_scan_finals).

The pilot settings (m1-scope.md section 3); every room, lead and seat is
invented; nothing reaches the network.

A test that fails here is a finding; tests named "control" pass.

    cd hermes/sales-desk && python3 -m unittest tests.test_m1_concurrency_r6
"""
from __future__ import annotations

import os
import unittest
from typing import Any

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms  # noqa: E402
from tests.test_rooms import T0, RoomsCase, rid  # noqa: E402


class ClosedThroughSalesApi(RoomsCase):
    def closed(self, secret: bool, **over: Any) -> str:
        """The closer's lead-page Zoom room, opened 6 minutes ago, its link
        sent by email; closed 2 s ago by a press through sales-api (End
        room: ended, no_join). Its meeting never started and nobody is in it."""
        m = self.env.zoom._make("zu-closer", {"topic": "Mahara call ENDED1"})
        self.env.zoom.meetings[str(m["id"])]["status"] = "waiting"
        row = {"code": "ENDED1", "purpose": "manual", "state": "ended", "result": "no_join",
               "provider_meeting_id": str(m["id"]), "opened_at": rooms.iso(T0 - 360),
               "link_claimed_at": rooms.iso(T0 - 355), "link_sent_at": rooms.iso(T0 - 350),
               "lead_by": rooms.iso(T0 + 250), "ended_at": rooms.iso(T0 - 2)}
        row.update(over)
        self.env.add_room(1, **row)
        if secret:
            self.env.pg.put(rooms.SECRETS, {"room_id": rid(1), "start_url": m["start_url"], "expires_at": None})
        return str(m["id"])

    def test_control_a_room_the_sweep_closed_keeps_its_host_link_and_its_meeting_is_deleted(self):
        mid = self.closed(True, state="expired", end_reason="lead_no_show", lead_by=rooms.iso(T0 - 2))
        self.env.worker().run(seconds=0)
        self.assertNotIn(mid, self.env.zoom.meetings)

    def test_m1_conc_r6_press_end_deletes_host_link_so_worker_never_closes_zoom_meeting(self):
        """End room pressed in the cockpit: sales-api's carryOut deletes the
        host link in the same request; the worker's scan of finished rooms
        reads only rooms that still hold one, so the meeting the lead's link
        opens is never deleted (a lead who opens the link later waits in a
        waiting room nobody watches)."""
        mid = self.closed(False)
        w = self.env.worker()
        w.run(seconds=0)
        w.run(seconds=0)
        self.assertNotIn(mid, self.env.zoom.meetings)


if __name__ == "__main__":
    unittest.main()
