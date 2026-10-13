"""Stress round 1, numbers and data integrity: every write leaves an audit row
(the repo's standing rule, the build brief: cockpit_audit_log). The SQL sweep
writes one for each room it closes (room.sweep) and sales-api one for each
action; the desk's two writers of numbers, the room worker and the waves
job, are checked here. Every room, lead and key is invented.

    python3 -m unittest tests.test_stress_numbers_audit

A test that fails here is a finding, kept as a regression test for its fix.
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, rooms, waves  # noqa: E402
from tests import fakes  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_rooms import RoomsCase, rid  # noqa: E402
from tests.test_waves import NOW, members, routes, run, seed, wave  # noqa: E402

AUDIT = "cockpit_audit_log"
fakes.PK.setdefault(AUDIT, ("action", "entity_type", "entity_id"))


def audit_posts(calls) -> list:
    return [c for c in calls if c[0] == "POST" and AUDIT in c[1]]


class WorkerWritesAreAudited(RoomsCase):
    def test_a_room_the_worker_claims_and_opens_leaves_audit_rows(self):
        self.env.pg.tables.setdefault(AUDIT, {})
        self.env.add_room()
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["state"], "open")
        posts = [x for x in self.env.net.log if x[1] == "POST" and AUDIT in x[2]]
        # requested -> creating -> open is two state changes of a room a person can see and count.
        self.assertGreaterEqual(len(posts), 1, "the worker moved a room twice and wrote no audit row")

    def test_a_room_the_worker_fails_leaves_an_audit_row(self):
        self.env.pg.tables.setdefault(AUDIT, {})
        self.env.add_room(provider="zoom", host_email="nobody@example.test")
        self.tick(self.env.worker(zoom=False))
        self.assertIn(self.env.room()["state"], ("failed", "requested", "creating"))
        if self.env.room()["state"] == "failed":
            posts = [x for x in self.env.net.log if x[1] == "POST" and AUDIT in x[2]]
            self.assertGreaterEqual(len(posts), 1, "the worker failed a room and wrote no audit row")


class WaveWritesAreAudited(unittest.TestCase):
    def test_enrolment_drafting_and_a_stop_leave_audit_rows(self):
        pg = FakePostgrest()
        pg.tables.setdefault(AUDIT, {})
        routes(pg)
        for i in range(30):
            seed(pg, f"stress-au{i:02d}", "no_show_cancelled", days=i + 1)
        wave(pg, "w1", "no_show_cancelled", per_day=10)
        run(pg)
        self.assertTrue(members(pg, "w1"), "the wave enrolled nobody")
        drafted = [m for m in members(pg, "w1") if m["state"] == "drafted"]
        self.assertTrue(drafted)
        # A manager stops it; the desk takes its open openers back (followups -> expired).
        pg.one(waves.WAVES, id="w1").update({"state": "done", "done_reason": "Stopped by a manager."})
        run(pg, now=NOW + timedelta(minutes=5))
        self.assertTrue(any(f.get("status") == "expired" for f in pg.rows(waves.FOLLOWUPS)))
        self.assertGreaterEqual(len(audit_posts(pg.calls)), 1,
                                "the desk enrolled leads into arms, wrote openers and took them back with no audit row")


if __name__ == "__main__":
    unittest.main()
