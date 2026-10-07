"""Milestone 1, video-link round 1, NUMBERS AND RECORDS: the room worker's
own audit rows. Every room change the worker makes leaves one row in
cockpit_audit_log (desk/rooms.py Worker._audit: room.worker.claim,
room.worker.open, room.worker.fail), whatever happens to the database's
answer.

The pilot's settings (rooms on, Meet and Zoom on). A write that landed and
whose answer was lost (a timeout after the database did the work) is the
case the worker already handles for the room itself ("it opened; only the
answer was lost"): its audit row must be written then too, or the room's
record says it was never opened (or never failed) by anyone.

A test that fails here is a finding; tests named "control" pass. Every room,
seat, meeting and key is invented; no test reaches the network.

    cd hermes/sales-desk && python3 -m unittest tests.test_m1_numbers_r1
"""
from __future__ import annotations

import json
import os
import unittest
from typing import Any, Optional

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms  # noqa: E402
from desk.http import HttpError  # noqa: E402
from tests.test_rooms import SETTER, RoomsCase, rid  # noqa: E402

AUDIT = "cockpit_audit_log"


class AuditTap:
    """Wraps the test's one HTTP layer: records every audit row the worker
    posts, and can lose the answer of the next room write whose body sets a
    given state (the database did the write; the answer never came)."""

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
        if (self.lose_state and method == "PATCH" and f"/rest/v1/{rooms.ROOMS}?" in url and kw.get("data")
                and json.loads(kw["data"].decode()).get("state") == self.lose_state):
            self.lose_state = None
            self.net(method, url, **kw)       # the write lands
            self.lost += 1
            raise HttpError(0, "TimeoutError: timed out", b"", url)
        return self.net(method, url, **kw)

    def actions(self, room_id: str) -> list[str]:
        return [r.get("action") for r in self.rows if r.get("entity_id") == room_id]


class WorkerAuditRows(RoomsCase):
    def setUp(self):
        super().setUp()
        self.patch.stop()
        self.tap = AuditTap(self.env.net)
        from unittest import mock
        from desk import http
        self.patch = mock.patch.object(http, "request", self.tap)
        self.patch.start()

    def test_control_a_zoom_room_made_with_every_answer_leaves_one_claim_and_one_open_row(self):
        self.env.add_room()
        self.tick(self.env.worker())
        self.assertEqual(self.env.room()["state"], "open")
        acts = self.tap.actions(rid(1))
        self.assertEqual((acts.count("room.worker.claim"), acts.count("room.worker.open")), (1, 1), acts)

    def test_the_open_write_landed_and_its_answer_was_lost_still_leaves_one_open_row(self):
        self.env.add_room()
        self.tap.lose_state = "open"
        self.tick(self.env.worker())
        self.assertEqual(self.tap.lost, 1)
        self.assertEqual(self.env.room()["state"], "open")
        self.assertEqual(self.env.api.kinds(rid(1)), ["worker.ready"])  # the worker read it back and went on
        acts = self.tap.actions(rid(1))
        self.assertEqual(acts.count("room.worker.open"), 1, f"the room opened with no audit row: {acts}")

    def test_the_fail_write_landed_and_its_answer_was_lost_still_leaves_one_fail_row(self):
        # Zoom refuses the host (no such user), so the worker fails the room.
        self.env.zoom.users.pop(SETTER, None)
        self.env.add_room()
        self.tap.lose_state = "failed"
        self.tick(self.env.worker())
        row = self.env.room()
        self.assertEqual(row["state"], "failed", row)
        self.assertEqual(self.tap.lost, 1)
        acts = self.tap.actions(rid(1))
        self.assertEqual(acts.count("room.worker.fail"), 1, f"the room failed with no audit row: {acts}")


class ZoomReportReadsTheTakeBack(RoomsCase):
    """The host check's Zoom participant report (Worker.report_check) feeds the
    health line ("Zoom and the cockpit disagree on N rooms today"), the
    room-hosts status row and a room_report alert. The cockpit's own word on
    a join is the join that stands: "That was not the lead" takes it back and
    the room keeps lead_in_at as the taken-back join's time (20261004a guard,
    taken_back_join_at), so lead_in_at alone is not "the cockpit saw the lead
    come in"."""

    def _taken_back_room(self, people):
        now = self.env.clock()
        m = self.env.zoom._make("zu-closer", {"topic": "Mahara call TBK001"})
        joined = now - 25 * 60
        self.env.add_room(1, code="TBK001", state="expired", end_reason="lead_no_show", result="no_join",
                          provider="zoom", host_email="closer@example.test", call_kind="demo",
                          provider_meeting_id=str(m["id"]), opened_at=rooms.iso(now - 30 * 60),
                          lead_in_at=rooms.iso(joined), taken_back_join_at=rooms.iso(joined),
                          count_undo_at=rooms.iso(joined + 90), ended_at=rooms.iso(now - 12 * 60))
        uuid_ = f"uuid{m['id']}=="
        self.env.pg.put(rooms.EVENTS, {"room_id": rid(1), "kind": "worker.closing", "source": "worker",
                                       "dedupe_key": f"worker.closing:{rid(1)}", "detail": {"meeting_uuid": uuid_},
                                       "handled_at": rooms.iso(now - 11 * 60)})
        self.env.zoom.past[uuid_] = people

    def _report_alerts(self):
        return [a for a in self.env.pg.rows(rooms.ALERTS) if str(a.get("dedupe_key", "")).startswith("room_report:")]

    def test_a_join_taken_back_and_nobody_outside_in_zoom_is_no_disagreement(self):
        # The closer pressed The lead is in by mistake, then That was not the
        # lead; nobody outside the team ever joined; the room expired with no join.
        self._taken_back_room([{"id": "zu-closer", "user_email": "closer@example.test", "name": "Sami Closer"}])
        ok, lines = self.env.worker().report_check(self.env.clock())
        self.assertEqual([a.get("message") for a in self._report_alerts()], [],
                         f"the cockpit took the join back and Zoom saw nobody outside: they agree, yet {lines!r}")
        self.assertIs(ok, True)

    def test_control_a_join_that_stands_and_nobody_outside_in_zoom_is_a_disagreement(self):
        now = self.env.clock()
        m = self.env.zoom._make("zu-closer", {"topic": "Mahara call STD002"})
        self.env.add_room(2, code="STD002", state="ended", end_reason="finished", result="joined", provider="zoom",
                          host_email="closer@example.test", provider_meeting_id=str(m["id"]),
                          opened_at=rooms.iso(now - 40 * 60), lead_in_at=rooms.iso(now - 35 * 60),
                          ended_at=rooms.iso(now - 12 * 60))
        uuid_ = f"uuid{m['id']}=="
        self.env.pg.put(rooms.EVENTS, {"room_id": rid(2), "kind": "worker.closing", "source": "worker",
                                       "dedupe_key": f"worker.closing:{rid(2)}", "detail": {"meeting_uuid": uuid_},
                                       "handled_at": rooms.iso(now - 11 * 60)})
        self.env.zoom.past[uuid_] = [{"id": "zu-closer", "user_email": "closer@example.test", "name": "Sami Closer"}]
        ok, _lines = self.env.worker().report_check(now)
        self.assertEqual(len(self._report_alerts()), 1)
        self.assertIs(ok, False)


if __name__ == "__main__":
    unittest.main()
