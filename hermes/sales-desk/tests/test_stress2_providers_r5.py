"""Stress series 2, round 5, provider quirks on the desk side (2026-10-05).

Each test drives the real code through the fakes the lane's own tests use,
with the providers' real answer shapes, and asserts what must hold; a
failing test names a defect for the fix lane. Every room, lead, seat and
line is invented; nothing reaches the network.

    python3 -m unittest tests.test_stress2_providers_r5
"""
from __future__ import annotations

import os
import unittest

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms  # noqa: E402
from tests.test_rooms import SETTER, RoomsCase, rid  # noqa: E402


# ---------------------------------------------------------------------------
# 1. Zoom's participant report is not there yet.
#
# The host check (rooms --check-hosts, every 10 minutes) compares Zoom's
# participant report with the cockpit for every Zoom room that ended in the
# last day, ONCE per room (a `report.checked` event is stored either way and
# the room is never looked at again). Zoom keeps a meeting's report only once
# the meeting is over, and builds it some minutes after: until then GET
# /past_meetings/{uuid}/participants answers 404, code 3001 ("Meeting does
# not exist"). report_check reads any `gone` answer as "never held, so nobody
# joined" and stamps the room checked.
#
# The case it exists for: the lead's Zoom join never reached the cockpit
# (the door was down, the webhook given up), the room closed as a no-show at
# lead_by while the lead and the rep were talking in Zoom, and the worker
# left the meeting open because someone outside the team is in it (H7). The
# next host check, minutes later, finds no report (the meeting is still
# running), records "Zoom's participant report matches the cockpit" and never
# checks that room again. When the meeting ends and Zoom's report shows the
# lead, nothing compares it: the alert that tells a person "someone outside
# the team joined, but the cockpit never saw the lead come in" is never
# raised, and the room's timeline says the report matched.
# ---------------------------------------------------------------------------

class ParticipantReportNotReadyYet(RoomsCase):
    def _ended_room(self) -> dict:
        now = self.env.clock()
        return self.env.add_room(1, state="expired", end_reason="lead_no_show", result="no_join",
                                 provider_meeting_id="81000000099", join_url="https://zoom.example.test/j/81000000099",
                                 opened_at=rooms.iso(now - 20 * 60), ended_at=rooms.iso(now - 3 * 60),
                                 lead_in_at=None, host_email=SETTER)

    def test_a_report_not_built_yet_is_not_read_as_nobody_joined(self):
        self._ended_room()
        w = self.env.worker()
        # 10:20 the host check: the meeting is still running (the lead and the
        # rep are in it), so Zoom has no participant report yet (404, 3001).
        w.report_check(self.env.clock())
        first = [e for e in self.env.pg.rows("cockpit_sales_room_events")
                 if e.get("room_id") == rid(1) and e.get("kind") == "report.checked"]
        # 10:45 the call is over; Zoom's report now shows the lead.
        self.env.clock.advance(25 * 60)
        self.env.zoom.past["81000000099"] = [
            {"id": "zu-setter", "user_email": SETTER, "name": "Tara Setter"},
            {"id": "", "user_email": "", "name": "Huda Ali"},
        ]
        w2 = self.env.worker("run-b")
        ok, lines = w2.report_check(self.env.clock())
        alerts = [a for a in self.env.pg.rows("cockpit_sales_alerts") if str(a.get("dedupe_key", "")).startswith("room_report:")]
        self.assertTrue(
            alerts,
            "Zoom had no participant report while the meeting still ran (404, 3001); the host check read that as "
            f"'nobody joined', stored {[(e.get('detail') or {}) for e in first]} as checked, and never compared the "
            f"room again: once Zoom's report showed the lead, the second check said {lines!r} and no person was "
            "told that the lead joined a room the cockpit closed as a no-show")

    def test_a_call_that_just_ended_is_not_said_to_disagree_with_zoom(self):
        # The lead was seen in (Zoom's own join), the call ended two minutes
        # ago; Zoom builds its report some minutes after a meeting ends.
        now = self.env.clock()
        self.env.add_room(1, state="ended", end_reason="meeting_ended", result="joined",
                          provider_meeting_id="81000000098", join_url="https://zoom.example.test/j/81000000098",
                          opened_at=rooms.iso(now - 30 * 60), lead_in_at=rooms.iso(now - 25 * 60),
                          ended_at=rooms.iso(now - 2 * 60), host_email=SETTER)
        ok, lines = self.env.worker().report_check(now)
        alerts = [a for a in self.env.pg.rows("cockpit_sales_alerts") if str(a.get("dedupe_key", "")).startswith("room_report:")]
        self.assertEqual(
            alerts, [],
            "Zoom's report for a meeting that ended two minutes ago is not built yet (404, 3001); the host check read "
            f"it as nobody outside the team and raised {[a.get('message') for a in alerts]!r}, health {ok}, {lines!r}")

    def test_held_control_a_report_that_is_there_raises_the_alert(self):
        self._ended_room()
        self.env.zoom.past["81000000099"] = [
            {"id": "zu-setter", "user_email": SETTER, "name": "Tara Setter"},
            {"id": "", "user_email": "", "name": "Huda Ali"},
        ]
        self.env.worker().report_check(self.env.clock())
        alerts = [a for a in self.env.pg.rows("cockpit_sales_alerts") if str(a.get("dedupe_key", "")).startswith("room_report:")]
        self.assertEqual(len(alerts), 1)


if __name__ == "__main__":
    unittest.main()
