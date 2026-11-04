import contextlib
import importlib.util
import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock
from urllib.error import URLError

FOLDER = os.path.dirname(os.path.abspath(__file__))
if FOLDER not in sys.path:
    sys.path.insert(0, FOLDER)

import worker

URL = worker.PROJECT + '/rest/v1/cockpit_team_calendar_worker?select=*&limit=1'
HEADERS = {'apikey': 'test', 'Authorization': 'Bearer test'}
ROWS = [{'ready': True, 'checked_at': '2026-11-01T10:00:00+00:00'}]


def fake_opener(outcomes):
    """Return an opener that replays each queued outcome in order."""
    calls = []

    def opener(request, timeout=None):
        calls.append(request)
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return contextlib.nullcontext(io.BytesIO(json.dumps(outcome).encode()))

    opener.calls = calls
    return opener


def recorder():
    """Return a sleep replacement that records each wait it is given."""
    sleeps = []

    def sleep(seconds):
        sleeps.append(seconds)

    sleep.sleeps = sleeps
    return sleep


class ReadReceiptTest(unittest.TestCase):
    def test_first_try_succeeds_without_sleeping(self):
        opener = fake_opener([ROWS])
        sleep = recorder()
        self.assertEqual(worker.read_receipt(URL, HEADERS, opener=opener, sleep=sleep), ROWS)
        self.assertEqual(sleep.sleeps, [])
        self.assertEqual(len(opener.calls), 1)

    def test_retries_twice_then_succeeds(self):
        opener = fake_opener([URLError('dropped'), TimeoutError('slow'), ROWS])
        sleep = recorder()
        self.assertEqual(worker.read_receipt(URL, HEADERS, opener=opener, sleep=sleep), ROWS)
        self.assertEqual(sleep.sleeps, [3, 8])
        self.assertEqual(len(opener.calls), 3)

    def test_all_tries_fail_returns_none(self):
        opener = fake_opener([URLError('one'), URLError('two'), URLError('three')])
        sleep = recorder()
        self.assertIsNone(worker.read_receipt(URL, HEADERS, opener=opener, sleep=sleep))
        self.assertEqual(len(opener.calls), 3)
        self.assertEqual(sleep.sleeps, [3, 8])


class ImportTest(unittest.TestCase):
    def test_import_does_not_run_main(self):
        path = Path(FOLDER) / 'worker.py'
        spec = importlib.util.spec_from_file_location('worker_import_check', path)
        module = importlib.util.module_from_spec(spec)
        with mock.patch.object(Path, 'read_text', side_effect=AssertionError('read at import time')):
            spec.loader.exec_module(module)
        self.assertTrue(callable(module.main))
        self.assertNotEqual(module.__name__, '__main__')


if __name__ == '__main__':
    unittest.main()
