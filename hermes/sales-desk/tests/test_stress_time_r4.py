"""TIME stress, round 4 (the desk): an approved backlog opener waits over
Thursday night and Friday (the lead's hours, their day off) and goes on
Saturday morning. Meanwhile the lead booked an intro and had it. The opener
("How are you?" to a lead from the backlog) must not land the morning after
their intro: the desk's last check before the send (waves._left_pool) and
sales-api's (followupAgent.ts followup.send_due) look only for a call still
to come.

    python3 -m unittest tests.test_stress_time_r4
"""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, waves  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import GATE_OPEN, SETTINGS, Api, Clock, sb  # noqa: E402

UTC = timezone.utc
APPROVED = datetime(2026, 10, 8, 14, 50, tzinfo=UTC)   # Thursday 17:50 Kuwait: the batch is approved
SATURDAY = datetime(2026, 10, 10, 6, 0, tzinfo=UTC)    # Saturday 09:00 Kuwait: the first hour it may go


def opener(pg: FakePostgrest, i: int, *, send_after: datetime) -> str:
    c = f"r4-{i:02d}"
    pg.put("cockpit_sales_leads", {"contact_id": c, "country": "Kuwait", "tags": ["roas-qualified"]})
    pg.put("cockpit_sales_followups", {"id": f"f{i:02d}", "contact_id": c, "segment": "reactivate",
                                       "channel": "whatsapp_template", "status": "draft", "touch": 1,
                                       "created_at": (APPROVED - timedelta(hours=2)).isoformat(),
                                       "expires_at": (send_after + timedelta(hours=72)).isoformat(),
                                       "context": {"wave_id": "w1"}})
    pg.put("cockpit_sales_followup_meta", {"followup_id": f"f{i:02d}", "send_after": send_after.isoformat(),
                                           "held_by": None, "wave_id": "w1"})
    return c


def call(pg: FakePostgrest, c: str, *, start: datetime, status: str, booked: datetime) -> None:
    pg.put("cockpit_sales_calendar", {"appointment_id": f"{c}-intro", "contact_id": c, "call_type": "intro",
                                      "calendar_id": "dsqmJ393Dwl9fDSbIVOI", "status": status,
                                      "start_at": start.isoformat(), "booked_at": booked.isoformat()})


def send(pg: FakePostgrest, now: datetime):
    clock = Clock(now)
    api = Api(pg, clock)
    logs: list[str] = []
    with mock.patch.object(http, "request", pg):
        out = waves.send_due(sb(), api, settings=SETTINGS, w=waves.settings_of(SETTINGS),
                             waves=[{"id": "w1", "state": "running"}], guard=GATE_OPEN, clock=clock,
                             sleep=clock.sleep, budget_s=1000, log=logs.append, warn=logs.append)
    return out, api


class OpenerOverTheWeekend(unittest.TestCase):
    def setUp(self):
        self.pg = FakePostgrest()
        # Approved at 17:50 Thursday, 45 s apart: the first went before 18:00;
        # these three wait for Saturday 09:00 (after 18:00, then Friday).
        self.held = opener(self.pg, 1, send_after=APPROVED + timedelta(minutes=11))
        self.ahead = opener(self.pg, 2, send_after=APPROVED + timedelta(minutes=11, seconds=45))
        self.plain = opener(self.pg, 3, send_after=APPROVED + timedelta(minutes=12, seconds=30))
        booked = datetime(2026, 10, 8, 16, 0, tzinfo=UTC)  # Thursday 19:00 Kuwait: the lead books
        # r4-01: an intro on Friday 11:00 Kuwait, held (the B2B rule: confirmed once started, or showed).
        call(self.pg, self.held, start=datetime(2026, 10, 9, 8, 0, tzinfo=UTC), status="showed", booked=booked)
        # r4-02 (control): an intro on Saturday 12:00 Kuwait, still to come.
        call(self.pg, self.ahead, start=datetime(2026, 10, 10, 9, 0, tzinfo=UTC), status="confirmed", booked=booked)

    def test_setup_nothing_goes_on_thursday_night_or_friday(self):
        for t in (datetime(2026, 10, 8, 15, 5, tzinfo=UTC), datetime(2026, 10, 9, 9, 0, tzinfo=UTC)):
            out, api = send(self.pg, t)
            self.assertEqual(api.calls, [], t)
            self.assertEqual(out["outside_hours"], 3, t)

    def test_control_a_lead_with_a_call_still_to_come_is_taken_back(self):
        out, api = send(self.pg, SATURDAY)
        self.assertNotIn("f02", [i for _, _, i in api.calls])
        self.assertEqual(self.pg.one("cockpit_sales_followups", id="f02")["status"], "expired")

    def test_control_a_lead_with_nothing_booked_gets_the_opener_on_saturday(self):
        out, api = send(self.pg, SATURDAY)
        self.assertIn("f03", [i for _, _, i in api.calls])

    def test_a_lead_who_had_their_intro_on_friday_is_not_sent_the_backlog_opener_on_saturday(self):
        out, api = send(self.pg, SATURDAY)
        sent = [i for _, _, i in api.calls]
        self.assertNotIn("f01", sent, "the backlog opener went the morning after the lead's intro")
        self.assertEqual(self.pg.one("cockpit_sales_followups", id="f01")["status"], "expired")


if __name__ == "__main__":
    unittest.main()
