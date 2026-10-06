"""Native monitor boundaries. No network or provider writes."""
import unittest
from checks import native
from guard.context import Context
from guard.model import FAIL, OK
from tests import fakes


def snapshot():
    return {"version": 1, "checked_at": fakes.ago(0), "checks": [
        {"key": key, "name": key, "ok": True, "error": None, "at": fakes.ago(0), "max_age_min": 45}
        for key in native.REQUIRED_CHECKS]}


def context(value):
    return Context(fakes.config(), fakes.FakeDb({"cockpit_native_monitor_state": [{"snapshot": value}]}), None, now=fakes.NOW)


class Native(unittest.TestCase):
    def test_missing_producer_fails_even_with_fresh_sections(self):
        value = snapshot()
        value["checks"] = [c for c in value["checks"] if c["key"] != "worker:media-core"]
        self.assertEqual(native.run_native(context(value)).status, FAIL)

    def test_boundary_and_future_timestamp(self):
        value = snapshot()
        value["checks"][0]["at"] = fakes.ago(45)
        self.assertEqual(native.run_native(context(value)).status, OK)
        value["checks"][0]["at"] = fakes.ago(45.001)
        self.assertEqual(native.run_native(context(value)).status, FAIL)
        value["checks"][0]["at"] = fakes.ago(-2)
        self.assertEqual(native.run_native(context(value)).status, FAIL)

    def test_failed_doctor_is_not_a_fresh_success(self):
        value = snapshot()
        value["checks"][0]["ok"] = False
        self.assertEqual(native.run_native(context(value)).status, FAIL)

    def test_absent_migration_and_empty_summary_fail(self):
        ctx = Context(fakes.config(), fakes.FakeDb(missing=("cockpit_native_monitor_state",)), None, now=fakes.NOW)
        self.assertEqual(native.run_native(ctx).status, FAIL)
        value = snapshot(); value["checks"] = []
        self.assertEqual(native.run_native(context(value)).status, FAIL)

    def test_native_outage_is_urgent_without_legacy_alert_suppression(self):
        check = native.CHECKS[0]
        self.assertTrue(check.urgent)
        self.assertIsNone(check.quiet_because)
        self.assertEqual(check.confirm, 2)

if __name__ == '__main__':
    unittest.main()
