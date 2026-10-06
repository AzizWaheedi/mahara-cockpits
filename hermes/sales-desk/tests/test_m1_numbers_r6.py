"""Milestone 1, video-link round 6, NUMBERS AND RECORDS: the room worker's
own audit rows when a write lands and its answer is lost.

Round 1 (test_m1_numbers_r1) made the open and the fail of a room the worker
had claimed write their audit row when the database did the write and the
answer never came (Worker.finish and Worker.fail read the room back and
write the row with answer_lost). Two more room writes of the worker take
the same road and are checked here, with the pilot's settings (rooms on,
Meet and Zoom on, test_only on):

  - the claim (requested to creating, Worker.claim): the room is made by this
    run from the orphan path, so it opens with no room.worker.claim row;
  - the fail of a room nobody claimed (requested to failed,
    Worker._fail_unclaimed): a room asked for while a provider was off, or
    one the worker found too late. Its lost answer is read back as "failed
    with this sentence", and no room.worker.fail row is written.

A test that fails here is a finding; tests named "control" pass. Every room,
seat, meeting and key is invented; no test reaches the network.

    cd hermes/sales-desk && python3 -m unittest tests.test_m1_numbers_r6
"""
from __future__ import annotations

import json
import os
import unittest
from typing import Any, Optional
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, rooms  # noqa: E402
from desk.http import HttpError  # noqa: E402
from tests.test_rooms import RoomsCase, rid  # noqa: E402

AUDIT = "cockpit_audit_log"


class AuditTap:
    """The test's one HTTP layer with every audit row the worker posts kept,
    and the answer of the next room write that sets `lose_state` lost (the
    database did the write; the answer never came)."""

    def __init__(self, net):
        self.net = net
        self.rows: list[dict[str, Any]] = []
        self.lose_state: Optional[str] = None
        self.lost = 0

    def __call__(self, method: str, url: str, **kw: Any):
        if method == "POST" and f"/rest/v1/{AUDIT}" in url:
            data = kw.get("data")
            self.rows.append(json.loads(data.decode()) if data else (kw.get("json_body") or {}))
            return 201, {}, b""
        body = None
        if method == "PATCH" and f"/rest/v1/{rooms.ROOMS}?" in url:
            raw = kw.get("data")
            body = json.loads(raw.decode()) if raw else (kw.get("json_body") or {})
        if self.lose_state and body is not None and body.get("state") == self.lose_state:
            self.lose_state = None
            self.net(method, url, **kw)       # the write lands
            self.lost += 1
            raise HttpError(0, "TimeoutError: timed out", b"", url)
        return self.net(method, url, **kw)

    def actions(self, room_id: str) -> list[str]:
        return [r.get("action") for r in self.rows if r.get("entity_id") == room_id]


class WorkerRowsWhenTheAnswerIsLost(RoomsCase):
    def setUp(self):
        super().setUp()
        self.patch.stop()
        self.tap = AuditTap(self.env.net)
        self.patch = mock.patch.object(http, "request", self.tap)
        self.patch.start()

    def _zoom_off(self) -> None:
        # The pilot as a manager left it for a moment: Zoom off, Meet on (the
        # setter's Zoom seat still pending). A closer's Zoom room asked a
        # moment before is failed unclaimed, with what to do.
        cur = self.env.pg.one("cockpit_sales_settings", key="rooms")
        cur["value"] = {**cur["value"], "providers": {"zoom": False, "meet": True}}

    # ---- the claim -----------------------------------------------------------
    def test_control_a_room_claimed_with_its_answer_leaves_one_claim_row(self):
        self.env.add_room()
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["state"], "open")
        acts = self.tap.actions(rid(1))
        self.assertEqual((acts.count("room.worker.claim"), acts.count("room.worker.open")), (1, 1), acts)

    def test_the_claim_landed_and_its_answer_was_lost_still_leaves_one_claim_row(self):
        # The claim's write lands (the room is creating, this run's) and its
        # answer never comes: the same run finds its own room on the orphan
        # path a moment later and makes it.
        self.env.add_room()
        self.tap.lose_state = "creating"
        w = self.env.worker()
        for _ in range(4):
            self.tick(w)
            self.env.clock.advance(3)
        row = self.env.room()
        self.assertEqual(self.tap.lost, 1)
        self.assertEqual(row["state"], "open", row)
        acts = self.tap.actions(rid(1))
        # Found: the room was claimed (claimed_at, worker_run) and opened by
        # this run with no room.worker.claim row in the ledger.
        self.assertEqual(acts.count("room.worker.claim"), 1, f"the room was claimed with no audit row: {acts}")

    # ---- the fail of a room nobody claimed ---------------------------------------
    def test_control_a_room_failed_unclaimed_with_its_answer_leaves_one_fail_row(self):
        self._zoom_off()
        self.env.add_room()
        self.tick(self.env.worker())
        row = self.env.room()
        self.assertEqual(row["state"], "failed", row)
        acts = self.tap.actions(rid(1))
        self.assertEqual(acts.count("room.worker.fail"), 1, acts)

    def test_a_room_failed_unclaimed_whose_answer_was_lost_still_leaves_one_fail_row(self):
        self._zoom_off()
        self.env.add_room()
        self.tap.lose_state = "failed"
        self.tick(self.env.worker())
        row = self.env.room()
        self.assertEqual(self.tap.lost, 1)
        self.assertEqual(row["state"], "failed", row)
        self.assertEqual(self.env.api.kinds(rid(1)), ["worker.failed"])  # read back and told sales-api
        acts = self.tap.actions(rid(1))
        # Found: Worker._fail_unclaimed reads the room back as failed with its
        # sentence and goes on (the rep is told), but writes no
        # room.worker.fail row, as Worker.fail does since round 1.
        self.assertEqual(acts.count("room.worker.fail"), 1, f"the room failed with no audit row: {acts}")

    def test_a_room_found_too_late_whose_fail_answer_was_lost_still_leaves_one_fail_row(self):
        # A room asked for long before (the sweep was not running): the
        # worker fails it unclaimed with "did not pick this room up in time".
        self.env.add_room(requested_at=rooms.iso(self.env.clock() - 11 * 60))
        self.tap.lose_state = "failed"
        self.tick(self.env.worker())
        row = self.env.room()
        self.assertEqual(self.tap.lost, 1)
        self.assertEqual(row["state"], "failed", row)
        acts = self.tap.actions(rid(1))
        self.assertEqual(acts.count("room.worker.fail"), 1, f"the room failed with no audit row: {acts}")


if __name__ == "__main__":
    unittest.main()
