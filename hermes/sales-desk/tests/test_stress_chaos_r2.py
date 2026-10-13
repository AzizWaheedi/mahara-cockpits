"""Chaos round 2 (3 October 2026), the desk's side: the waves job's paced
send on a VPS whose clock is not the database's.

send_due keeps batch_gap_s (45 s) between the desk's sends. It reads the
desk's last message from cockpit_sales_messages, whose created_at is the
database's clock, and compares it with this VPS's clock. With the VPS behind
the database, the last send looks as if it happened in the future: the wait
before the next send becomes gap + skew, the run's budget check says "This
run's time is up; the next run carries on.", and every run sends one opener.
The doctor only warns past 10 s and the room worker stops only past 60 s, so
a VPS 1 to 5 minutes behind passes every check while a 40-opener batch the
manager approved for the next half hour takes hours.

    python3 -m unittest tests.test_stress_chaos_r2
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
# Sunday 4 October 2026, 10:00 Kuwait: a working morning, every lead in hours.
APPROVED = datetime(2026, 10, 4, 7, 0, tzinfo=UTC)


class DbClockApi(Api):
    """sales-api's send as the database records it: the message's created_at
    is the database's clock, `ahead` seconds past this VPS's."""

    def __init__(self, pg: FakePostgrest, clock: Clock, ahead: float):
        super().__init__(pg, clock)
        self.ahead = ahead

    def __call__(self, action, payload):
        self.calls.append((self.clock(), action, payload["id"]))
        f = self.pg.one("cockpit_sales_followups", id=payload["id"])
        f["status"] = "sent"
        db_now = self.clock() + timedelta(seconds=self.ahead)
        self.pg.put("cockpit_sales_messages", {"id": f"msg-{payload['id']}", "followup_id": payload["id"],
                                               "contact_id": f["contact_id"], "sent_by": "sales-desk",
                                               "created_at": db_now.isoformat(), "state": "sent",
                                               "channel": "whatsapp"})
        return 200, {"followup": {"id": payload["id"], "status": "sent"}}


class PacedSendOnASkewedClock(unittest.TestCase):
    def setUp(self):
        self.pg = FakePostgrest()
        for i in range(40):
            c = f"stress-chaos-k{i:02d}"
            self.pg.put("cockpit_sales_leads", {"contact_id": c, "country": "Kuwait", "tags": ["roas-qualified"]})
            self.pg.put("cockpit_sales_followups", {"id": f"f{i:02d}", "contact_id": c, "segment": "reactivate",
                                                    "channel": "whatsapp_template", "status": "draft", "touch": 1,
                                                    "created_at": (APPROVED - timedelta(hours=1)).isoformat()})
            self.pg.put("cockpit_sales_followup_meta", {"followup_id": f"f{i:02d}",
                                                        "send_after": (APPROVED + timedelta(seconds=45 * i)).isoformat(),
                                                        "held_by": None, "wave_id": "w1"})

    def run_for(self, ahead: float, minutes: int) -> list[datetime]:
        clock = Clock(APPROVED)
        api = DbClockApi(self.pg, clock, ahead)
        while clock() < APPROVED + timedelta(minutes=minutes):
            start = clock()
            with mock.patch.object(http, "request", self.pg):
                waves.send_due(sb(), api, settings=SETTINGS, w=waves.settings_of(SETTINGS),
                               waves=[{"id": "w1", "state": "running"}], guard=GATE_OPEN, clock=clock,
                               sleep=clock.sleep, budget_s=270, log=lambda _m: None, warn=lambda _m: None)
            clock.t = max(clock(), start + timedelta(minutes=5))
        return sorted(t for t, action, _ in api.calls if action == "followup.send_due")

    def test_held_the_same_clocks_send_the_batch_within_its_half_hour(self):
        """HELD: with the VPS on the database's clock, 40 openers 45 s apart go in about 35 minutes."""
        sent = self.run_for(0, 60)
        self.assertEqual(len(sent), 40)

    def test_a_vps_two_minutes_behind_the_database_still_sends_the_batch_within_the_hour(self):
        sent = self.run_for(120, 60)
        self.assertEqual(len(sent), 40, f"only {len(sent)} of 40 approved openers went in the hour")

    def test_a_vps_five_minutes_behind_the_database_still_sends_the_batch_within_the_hour(self):
        sent = self.run_for(300, 60)
        self.assertEqual(len(sent), 40, f"only {len(sent)} of 40 approved openers went in the hour")


if __name__ == "__main__":
    unittest.main()
