import json
import tempfile
import unittest
from pathlib import Path
from checks import task_assignments
from guard.context import Context
from tests import fakes


class TaskAlerts(unittest.TestCase):
    def result(self, age=1, apply=True, healthy=True):
        row = {'key': 'task-assignment-alerts', 'last_run_at': fakes.ago(age), 'ok': healthy, 'note': json.dumps({'apply': apply})}
        ctx = Context(fakes.config(Path(tempfile.gettempdir())/'guardian-task-test'),
                      fakes.FakeDb({'cockpit_sync_state': [row]}), None, now=fakes.NOW)
        return task_assignments.run(ctx)

    def test_current(self): self.assertEqual(self.result().status, 'ok')
    def test_stopped(self): self.assertEqual(self.result(age=11).status, 'fail')
    def test_failed_delivery(self): self.assertEqual(self.result(healthy=False).status, 'fail')
    def test_paused(self): self.assertEqual(self.result(apply=False).status, 'paused')
