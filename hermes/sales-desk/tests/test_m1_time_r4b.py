"""Milestone 1, video-link round 4 (second run), the TIME angle on the room
worker: the VPS clock and the database's apart, at the edge of Zoom's day.

Zoom's daily cap on one user's meeting creates resets at 00:00 UTC (03:00 in
Kuwait). The worker remembers the cap in cockpit_sales_room_hosts
.zoom_capped_until (20261004a), and sales-api refuses that host's Zoom rooms
until then ("zoom_capped": "... Zoom allows more from 03:00 Kuwait. Use
Meet."). The worker keeps working while its clock is up to CLOCK_STOP_S (60 s)
off the database's (it writes every time it stores on the database's clock,
db_now). The pilot settings (m1-scope.md section 3); every room, lead and
seat is invented; nothing reaches the network.

    python3 -m unittest tests.test_m1_time_r4b
"""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timezone

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms  # noqa: E402
from tests.test_rooms import SETTER, RoomsCase  # noqa: E402
from tests.test_stress2_providers_r2 import DAILY_CAP  # noqa: E402

# Zoom's own day ends at 00:00 UTC on Thursday 8 October (03:00 Kuwait).
ZOOM_RESET = datetime(2026, 10, 8, 0, 0, tzinfo=timezone.utc).timestamp()


class ZoomCapAcrossUtcMidnightWithTheVpsAhead(RoomsCase):
    def _cap_hit(self, *, vps: float, db_offset: float) -> dict:
        """A Zoom room whose create meets Zoom's daily cap, with the VPS clock
        reading `vps` and the database `db_offset` seconds off it."""
        self.env.clock.t = vps
        self.env.zoom.script = [{"method": "POST", "path": "/meetings", "status": 429, "body": DAILY_CAP}] * 3
        self.env.add_room(1, host_email=SETTER)
        w = self.env.worker()
        w.sb.clock_offset = db_offset
        self.tick(w)
        room = self.env.room(1)
        self.assertEqual(room["state"], "failed")
        self.assertEqual(room.get("error"), rooms.SAY["zoom_daily_cap"])
        host = self.env.pg.one(rooms.HOSTS, email=SETTER) or {}
        return {"until": rooms.parse_ts(host.get("zoom_capped_until"))}

    def test_control_clocks_together_the_cap_ends_at_zooms_reset(self):
        # 23:59:20 UTC on both clocks: Zoom's day still has 40 s.
        got = self._cap_hit(vps=ZOOM_RESET - 40, db_offset=0.0)
        self.assertEqual(got["until"], ZOOM_RESET)

    def test_vps_50_s_ahead_the_cap_still_ends_at_zooms_reset(self):
        # Zoom (and the database) read 23:59:20 UTC: the cap is Wednesday's.
        # The VPS reads 00:00:10 UTC Thursday, 50 s ahead, inside the 60 s the
        # worker keeps working with (CLOCK_STOP_S).
        got = self._cap_hit(vps=ZOOM_RESET + 10, db_offset=-50.0)
        # Found when it fails: _remember_zoom_cap computes the reset from
        # self.clock() (the VPS clock), not from the database's clock it
        # writes every other time on (db_now): the next 00:00 UTC after
        # 00:00:10 is Friday's, so zoom_capped_until is a whole day late.
        # sales-api refuses that host's Zoom rooms ("zoom_capped") through
        # Thursday, past the 03:00 Kuwait its own sentence promises, and the
        # presence view keeps Meet as the seat's default all day.
        self.assertEqual(
            got["until"], ZOOM_RESET,
            f"zoom_capped_until is {rooms.iso(got['until']) if got['until'] else None}, "
            f"{(got['until'] or 0) - ZOOM_RESET:.0f} s after Zoom's own reset",
        )


if __name__ == "__main__":
    unittest.main()
