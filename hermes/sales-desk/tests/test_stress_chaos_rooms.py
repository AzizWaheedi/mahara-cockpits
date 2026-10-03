"""Chaos round 1 (3 October 2026): the room worker on a VPS whose clock is
not the database's.

The worker writes claimed_at, opened_at, host_by and ends_at from its own
clock; the SQL sweep (cockpit_sales_rooms_sweep, the one owner of every
timer) judges them on the database's now(). supabase/migrations/tests/
stress_chaos.py shows the sweep failing a room claimed a second ago (VPS
125 s behind) and expiring a handover room opened a second ago (VPS 3
minutes behind). These tests pin the worker's side: whatever it writes must
be on the database's clock, or left for the database to stamp, or the
worker must refuse to make rooms and say why in its status row.

    python3 -m unittest tests.test_stress_chaos_rooms
"""
from __future__ import annotations

import unittest

from desk import rooms
from tests.test_rooms import CLOSER, RoomsCase

SLACK_S = 5.0


class ClockSkew(RoomsCase):
    def _check(self, behind: float) -> None:
        env = self.env
        db_now = env.clock() + behind  # the database's clock, ahead of this VPS
        env.add_room(1, provider="zoom", purpose="handover", call_kind="demo", host_email=CLOSER,
                     contact_id="contact-test-skew", requested_at=rooms.iso(db_now - 1))
        self.tick(env.worker())
        r = env.room(1)
        asked = rooms.parse_ts(r["requested_at"])
        if r["state"] == "requested":
            # The worker refused to make rooms on a clock it cannot trust: it must say so.
            detail = " ".join(str(row.get("detail") or "") for row in env.pg.rows("cockpit_sales_worker_status"))
            self.assertRegex(detail.lower(), r"clock")
            return
        claimed = rooms.parse_ts(r.get("claimed_at"))
        opened = rooms.parse_ts(r.get("opened_at"))
        host_by = rooms.parse_ts(r.get("host_by"))
        ends_at = rooms.parse_ts(r.get("ends_at"))
        # Nothing happens before the room was asked for, on the database's clock.
        if claimed is not None:
            self.assertGreaterEqual(claimed, asked - SLACK_S, "claimed_at is before the room was asked for")
        if opened is not None:
            self.assertGreaterEqual(opened, asked - SLACK_S, "opened_at is before the room was asked for")
        # The closer gets the handover wait (120 s) from now on the database's clock.
        if host_by is not None:
            self.assertGreaterEqual(host_by, db_now + 120 - SLACK_S, "host_by is already past for the sweep")
        if ends_at is not None:
            self.assertGreaterEqual(ends_at, db_now + 60 * 60 - SLACK_S, "ends_at cuts the demo short")

    def test_vps_three_minutes_behind_the_database(self):
        self._check(180.0)

    def test_vps_125_seconds_behind_the_database(self):
        self._check(125.0)


if __name__ == "__main__":
    unittest.main()
