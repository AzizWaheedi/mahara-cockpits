"""Milestone 1, video-link round 5, the TIME angle on the room worker: what
the worker does with the Zoom meeting of a room the sweep's R3 closed at the
host's wait (host_by) while the lead's ten minutes sales-api started for the
rep's own delivery (lead_by) were still running.

HighLevel took no send for the link's ten minutes of re-asks, so sales-api
said the link did not go (final: "Copy the link and send it another way")
and started the lead's ten minutes (rooms.ts startLeadWait: lead_by = now +
10 minutes). It never moves host_by for that (keepHostWait runs only for a
link that went), and the sweep's R3 extends the host's wait only for a room
whose link_sent_at is set: R3 closes the room host_not_in five minutes into
the rep's ten (sales-api m1_time_r5.test.ts, migrations/tests/m1_time_r5.py).
The rep, as told, sent the Zoom link from their own WhatsApp and has not
opened Zoom yet. The pilot settings (m1-scope.md section 3); every room, lead
and seat is invented; nothing reaches the network.

A test that fails here is a finding; tests named "control" pass.

    cd hermes/sales-desk && python3 -m unittest tests.test_m1_time_r5
"""
from __future__ import annotations

import os
import unittest
from typing import Any

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms  # noqa: E402
from tests.test_rooms import T0, RoomsCase, rid  # noqa: E402

FINAL = "HighLevel did not take the link in 10 minutes (HighLevel said 429: Too Many Requests)."


class LinkLeftToTheRepRoomClosedAtHostBy(RoomsCase):
    def closed(self, **over: Any) -> str:
        """The setter's lead-page Zoom room, opened 16 minutes ago, its link
        left to the rep 5 minutes ago (lead_by 5 minutes ahead), closed by R3
        at host_by 2 s ago; its meeting never started (the host has not
        opened Zoom) and nobody is in it."""
        m = self.env.zoom._make("zu-setter", {"topic": "Mahara call LEFT01"})
        self.env.zoom.meetings[str(m["id"])]["status"] = "waiting"
        row = {"code": "LEFT01", "purpose": "manual", "state": "expired", "end_reason": "host_not_in",
               "result": "no_join", "provider_meeting_id": str(m["id"]), "opened_at": rooms.iso(T0 - 960),
               "link_claimed_at": rooms.iso(T0 - 960), "link_sent_at": None, "refusal": FINAL,
               "host_by": rooms.iso(T0 - 60), "lead_by": rooms.iso(T0 + 300), "ended_at": rooms.iso(T0 - 2)}
        row.update(over)
        self.env.add_room(1, **row)
        self.env.pg.put(rooms.SECRETS, {"room_id": rid(1), "start_url": m["start_url"], "expires_at": None})
        return str(m["id"])

    def test_control_a_room_whose_ten_minutes_are_over_has_its_meeting_deleted(self):
        mid = self.closed(lead_by=rooms.iso(T0 - 2))
        self.env.worker().run(seconds=0)
        self.assertNotIn(mid, self.env.zoom.meetings)

    def test_the_link_the_rep_sent_by_hand_still_opens_a_meeting_while_its_ten_minutes_run(self):
        mid = self.closed()
        self.env.worker().run(seconds=0)
        # Found when it fails: the room the sweep's R3 closed at host_by is a
        # finished room nobody joined, so _scan_finals queues its meeting and
        # close_meeting deletes it (status "waiting"): the Zoom link the rep
        # sent from their own WhatsApp two minutes ago, as the panel told
        # them to, is a dead meeting when the lead taps it, five minutes
        # before the ten sales-api started for it end.
        self.assertIn(mid, self.env.zoom.meetings,
                      "the meeting behind the link the rep was told to send by hand is deleted before lead_by")


if __name__ == "__main__":
    unittest.main()
