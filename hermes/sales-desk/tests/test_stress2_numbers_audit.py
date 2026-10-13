"""Second series, round 1, numbers and data integrity: every write the waves'
paced send makes leaves an audit row (the build brief: cockpit_audit_log).
Every lead, draft and key is invented.

    python3 -m unittest tests.test_stress2_numbers_audit

A test that fails here is a finding.
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, waves  # noqa: E402
from tests import fakes  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import GATE_OPEN, NOW, SETTINGS, Api, Clock, ago, sb  # noqa: E402

AUDIT = "cockpit_audit_log"
fakes.PK.setdefault(AUDIT, ("action", "entity_type", "entity_id"))


def audit_posts(calls) -> list:
    return [c for c in calls if c[0] == "POST" and AUDIT in c[1]]


class StaleApprovedOpenerClosedUnaudited(unittest.TestCase):
    def test_send_due_closes_a_stale_approved_opener_with_an_audit_row(self):
        """stale-approved-opener-closed-unaudited: a batch was approved on
        Wednesday; the follow-up agent was switched off over the long weekend
        (or the gate was shut), so on Sunday the approved openers are past
        their 72 hours. send_due closes each one (status expired, the stale
        error), an approved opener a manager decided on, and writes no audit
        row unless the same run also sent, set aside, took back or failed
        something."""
        pg = FakePostgrest()
        pg.tables.setdefault(AUDIT, {})
        pg.put(waves.WAVES, {"id": "w1", "pool": "no_show_cancelled", "state": "running", "per_day": 40,
                             "holdout_share": 0.1, "enrolled_at": ago(days=5)})
        for i in range(3):
            c = f"stress-s2a-{i:02d}"
            pg.put("cockpit_sales_leads", {"contact_id": c, "country": "Kuwait", "tags": ["roas-qualified"]})
            pg.put("cockpit_sales_followups", {"id": f"f{i:02d}", "contact_id": c, "segment": "reactivate",
                                               "channel": "whatsapp_template", "status": "draft", "touch": 1,
                                               "created_at": ago(days=5), "expires_at": ago(days=1, minutes=i)})
            pg.put("cockpit_sales_followup_meta", {"followup_id": f"f{i:02d}", "send_after": ago(days=4, minutes=i),
                                                   "held_by": None, "wave_id": "w1", "approved_by": "manager@stress.invalid"})
        clock = Clock(NOW)
        api = Api(pg, clock)
        logs: list[str] = []
        with mock.patch.object(http, "request", pg):
            out = waves.send_due(sb(), api, settings=SETTINGS, w=waves.settings_of(SETTINGS),
                                 waves=[{"id": "w1", "state": "running"}], guard=GATE_OPEN, clock=clock,
                                 sleep=clock.sleep, budget_s=270.0, log=logs.append, warn=logs.append)
        closed = [f for f in pg.rows("cockpit_sales_followups") if f.get("status") == "expired"]
        self.assertEqual(len(closed), 3, f"the stale openers were not closed: {out}")
        self.assertEqual(api.calls, [], "a stale opener was sent")
        self.assertGreaterEqual(len(audit_posts(pg.calls)), 1,
                                f"three approved openers were closed as stale with no audit row ({out})")


if __name__ == "__main__":
    unittest.main()
