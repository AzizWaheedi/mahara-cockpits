"""CSM sync checks catch a stopped source and a new stall inside an open incident."""
import tempfile
import unittest
from pathlib import Path

from checks import by_id, csm_calls
from guard.model import FAIL, OK, WARN
from tests import fakes


def ctx(tables):
    return fakes.ctx(Path(tempfile.mkdtemp()), db=fakes.FakeDb(tables), host=fakes.FakeHost(fakes.snapshot()))


class CsmCalls(unittest.TestCase):
    def test_checks_are_report_only(self):
        for check in csm_calls.CHECKS:
            self.assertIs(check.fix, None)
            self.assertIs(by_id()[check.id], check)

    def test_missing_health_fails_and_names_every_source(self):
        r = csm_calls.run_freshness(ctx({}))
        self.assertEqual(r.status, FAIL)
        self.assertEqual(len(r.items), len(csm_calls.CSM_KEYS))

    def test_a_new_failure_is_a_distinct_incident_item(self):
        rows = [{"key": k, "ok": True, "last_ok_at": fakes.ago(2), "note": "ok"}
                for k in csm_calls.CSM_KEYS]
        rows[0].update(ok=False, note="GoHighLevel denied this read")
        r = csm_calls.run_freshness(ctx({"cockpit_sync_state": rows}))
        self.assertEqual(r.status, FAIL)
        self.assertIn("csm-ghl-calls-failing", r.items)
        rows[1].update(last_ok_at=fakes.ago(80))
        r = csm_calls.run_freshness(ctx({"cockpit_sync_state": rows}))
        self.assertIn("csm-checkin-form-stale", r.items)

    def test_all_recent_health_passes(self):
        rows = [{"key": k, "ok": True, "last_ok_at": fakes.ago(2), "note": "ok"}
                for k in csm_calls.CSM_KEYS]
        self.assertEqual(csm_calls.run_freshness(ctx({"cockpit_sync_state": rows})).status, OK)

    def test_missing_call_in_last_21_days_is_named(self):
        roster = [{"table_name": "clients", "data": {"name": "Client A", "taskId": "task-a", "bucket": "management"}},
                  {"table_name": "clients", "data": {"name": "Client B", "taskId": "task-b", "bucket": "onboarding"}}]
        r = csm_calls.run_coverage(ctx({"cockpit_csm_sources": roster,
                                        "cockpit_csm_calls": [{"task_id": "task-a", "starts_at": fakes.ago(30), "status": "held"}]}))
        self.assertEqual(r.status, WARN)
        self.assertIn("Client B", r.summary)

    def test_mismatched_calls_over_20_percent_warn(self):
        calls = [{"id": i, "task_id": None if i == 0 else "task-a", "source": "ghl_appointment",
                  "starts_at": fakes.ago(20), "status": "confirmed"} for i in range(4)]
        self.assertEqual(csm_calls.run_unmatched(ctx({"cockpit_csm_calls": calls})).status, WARN)
