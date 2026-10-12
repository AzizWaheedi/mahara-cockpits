import json
import tempfile
import unittest
from pathlib import Path
from checks import task_assignments
from guard.context import Context
from tests import fakes


def context(age=1, apply=True, healthy=True, note=None, missing=False):
    rows=[] if missing else [dict(key=key,ok=healthy,last_run_at=fakes.ago(age),
        note=note if note is not None else json.dumps({'apply':apply}))
        for key in ('task-assignment-alerts','video-review-flow')]
    return Context(fakes.config(Path(tempfile.gettempdir())/'guardian-notification-test'),
        fakes.FakeDb({'cockpit_sync_state':rows}),None,now=fakes.NOW)


class TaskAlerts(unittest.TestCase):
    def result(self,expected,**kwargs):
        for check in (task_assignments.run,task_assignments.video):
            with self.subTest(check=check.__name__):
                self.assertEqual(check(context(**kwargs)).status,expected)

    def test_current_healthy_worker(self):self.result('ok')
    def test_heartbeat_can_arrive_during_full_scan(self):self.result('ok',age=-0.2)
    def test_excessive_future_skew_is_refused(self):self.result('fail',age=-6)
    def test_stale_worker_is_not_healthy(self):self.result('fail',age=11)
    def test_missing_worker_is_not_deployed(self):self.result('not_deployed',missing=True)
    def test_paused_worker_is_not_reported_healthy(self):self.result('paused',apply=False)
    def test_unresolved_delivery_needs_review(self):self.result('fail',healthy=False)
    def test_invalid_health_needs_review(self):self.result('fail',note='invalid')
