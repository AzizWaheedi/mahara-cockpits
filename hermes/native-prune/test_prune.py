import io
import json
import os
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import prune

NOW = 1_800_000_000.0
HOUR = 3600
OK = {"ok": True, "jobs": [{"job": "sync", "exit_code": 0, "status": "media-core-published"}]}
CEO_FAILED = {"ok": False, "jobs": [{"job": "sync", "exit_code": 0, "status": "media-core-published"},
                                    {"job": "ceo", "exit_code": 1, "status": "failed"}]}
SYNC_FAILED = {"ok": False, "jobs": [{"job": "sync", "exit_code": 1, "status": "failed"}]}
SYNC_UNPUBLISHED = {"ok": False, "jobs": [{"job": "sync", "exit_code": 0, "status": "dry-run"}]}


class PruneTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.state = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def cycle(self, name, *, age_hours, receipt=OK, failure=False, plan=True):
        d = self.state / f"cycle-{name}"
        d.mkdir()
        if receipt is not None:
            (d / "receipt.json").write_text(receipt if isinstance(receipt, str) else json.dumps(receipt))
        (d / "sync.log").write_text("log")
        (d / "ceo.log").write_text("log")
        if failure:
            (d / "sync-plan.json.failure.json").write_text("{}")
        if plan:
            (d / "sync-plan.json").write_text("x" * 2048)
        t = NOW - age_hours * HOUR
        for f in d.iterdir():
            os.utime(f, (t, t))
        return d

    def run_prune(self, apply=True, keep_hours=48, keep_newest=1):
        out = io.StringIO()
        with redirect_stdout(out):
            code = prune.run(self.state, apply=apply, keep_hours=keep_hours, keep_newest=keep_newest, now=NOW)
        return code, out.getvalue().strip()

    def has_plan(self, d):
        return (d / "sync-plan.json").exists()

    def test_old_plan_of_a_good_cycle_goes_and_the_rest_of_the_folder_stays(self):
        self.cycle("new", age_hours=1)
        old = self.cycle("old", age_hours=60)
        code, line = self.run_prune()
        self.assertEqual(code, 0)
        self.assertFalse(self.has_plan(old))
        for name in ("receipt.json", "sync.log", "ceo.log"):
            self.assertTrue((old / name).exists(), name)
        self.assertIn("native-prune ok: deleted 1 plans", line)

    def test_plans_younger_than_the_window_stay(self):
        dirs = [self.cycle(f"c{i}", age_hours=h) for i, h in enumerate((1, 20, 47))]
        code, line = self.run_prune()
        self.assertEqual(code, 0)
        self.assertTrue(all(self.has_plan(d) for d in dirs))
        self.assertIn("deleted 0 plans", line)
        self.assertIn("3 recent", line)

    def test_failed_cycles_keep_their_plans(self):
        self.cycle("new", age_hours=1)
        kept = [
            self.cycle("failfile", age_hours=60, failure=True),
            self.cycle("syncfail", age_hours=60, receipt=SYNC_FAILED),
            self.cycle("unpublished", age_hours=60, receipt=SYNC_UNPUBLISHED),
            self.cycle("noreceipt", age_hours=60, receipt=None),
            self.cycle("broken", age_hours=60, receipt="{not json"),
            self.cycle("unfinished", age_hours=60, receipt={"cycle": "x", "jobs": []}),
        ]
        code, line = self.run_prune()
        self.assertEqual(code, 0)
        for d in kept:
            self.assertTrue(self.has_plan(d), d.name)
        self.assertTrue((kept[0] / "sync-plan.json.failure.json").exists())
        self.assertIn("kept 6 failed", line)

    def test_a_ceo_failure_after_a_published_sync_is_not_a_failed_sync(self):
        self.cycle("new", age_hours=1)
        ceo = self.cycle("ceo", age_hours=60, receipt=CEO_FAILED)
        self.run_prune()
        self.assertFalse(self.has_plan(ceo))
        self.assertTrue((ceo / "ceo.log").exists())

    def test_the_newest_plans_stay_whatever_their_age(self):
        newest = self.cycle("a", age_hours=100)
        second = self.cycle("b", age_hours=200)
        oldest = self.cycle("c", age_hours=300)
        code, line = self.run_prune(keep_newest=2)
        self.assertEqual(code, 0)
        self.assertTrue(self.has_plan(newest))
        self.assertTrue(self.has_plan(second))
        self.assertFalse(self.has_plan(oldest))
        self.assertIn("2 newest", line)

    def test_dry_run_deletes_nothing_and_records_nothing(self):
        self.cycle("new", age_hours=1)
        old = self.cycle("old", age_hours=60)
        code, line = self.run_prune(apply=False)
        self.assertEqual(code, 0)
        self.assertTrue(self.has_plan(old))
        self.assertFalse((self.state / prune.LAST).exists())
        self.assertIn("native-prune dry run: would delete 1 plans", line)

    def test_only_plans_in_cycle_folders_are_touched(self):
        self.cycle("new", age_hours=1)
        legacy = self.state / "legacy-before-native"
        legacy.mkdir()
        (legacy / "sync-plan.json").write_text("x")
        latest = self.state / "latest-native-cycle.json"
        latest.write_text("{}")
        other = self.cycle("old", age_hours=60)
        (other / "notes.json").write_text("{}")
        for f in (legacy / "sync-plan.json", latest, other / "notes.json"):
            os.utime(f, (NOW - 90 * HOUR, NOW - 90 * HOUR))
        self.run_prune()
        self.assertTrue((legacy / "sync-plan.json").exists())
        self.assertTrue(latest.exists())
        self.assertTrue((other / "notes.json").exists())
        self.assertFalse(self.has_plan(other))

    def test_a_linked_plan_is_never_followed_or_deleted(self):
        self.cycle("new", age_hours=1)
        target = self.state / "elsewhere.json"
        target.write_text("keep")
        d = self.cycle("link", age_hours=60, plan=False)
        try:
            os.symlink(target, d / "sync-plan.json")
        except (OSError, NotImplementedError):
            self.skipTest("this system cannot make links")
        self.run_prune()
        self.assertTrue((d / "sync-plan.json").is_symlink())
        self.assertTrue(target.exists())

    def test_apply_records_its_last_success(self):
        self.cycle("new", age_hours=1)
        self.cycle("old", age_hours=60)
        self.run_prune()
        last = json.loads((self.state / prune.LAST).read_text())
        self.assertTrue(last["ok"])
        self.assertEqual(last["deleted"], 1)
        self.assertEqual(last["failed_runs_in_a_row"], 0)
        self.assertEqual(last["last_success_at"], last["at"])

    def test_a_delete_error_fails_loudly_and_keeps_the_last_success(self):
        self.cycle("new", age_hours=1)
        self.cycle("old", age_hours=60)
        (self.state / prune.LAST).write_text(json.dumps({"last_success_at": "2026-10-22T10:40:00Z",
                                                         "failed_runs_in_a_row": 2}))
        with mock.patch.object(Path, "unlink", side_effect=PermissionError(13, "Permission denied")):
            code, line = self.run_prune()
        self.assertEqual(code, 1)
        self.assertIn("native-prune FAILED: 1 errors", line)
        last = json.loads((self.state / prune.LAST).read_text())
        self.assertFalse(last["ok"])
        self.assertEqual(last["last_success_at"], "2026-10-22T10:40:00Z")
        self.assertEqual(last["failed_runs_in_a_row"], 3)

    def test_an_unreadable_folder_is_counted_not_fatal(self):
        self.cycle("new", age_hours=1)
        old = self.cycle("old", age_hours=60)
        bad = self.cycle("bad", age_hours=60)
        real_is_dir = Path.is_dir

        def is_dir(p):
            if p == bad:
                raise PermissionError(13, "Permission denied")
            return real_is_dir(p)

        with mock.patch.object(Path, "is_dir", is_dir):
            code, line = self.run_prune()
        self.assertEqual(code, 0)
        self.assertFalse(self.has_plan(old))
        self.assertIn("unreadable folders 1", line)

    def test_a_missing_state_folder_fails(self):
        self.state = self.state / "missing"
        code, line = self.run_prune()
        self.assertEqual(code, 1)
        self.assertIn("native-prune FAILED", line)

    def test_a_short_window_is_refused(self):
        old = self.cycle("old", age_hours=60)
        code, line = self.run_prune(keep_hours=1)
        self.assertEqual(code, 1)
        self.assertIn("keep at least 24 hours", line)
        self.assertTrue(self.has_plan(old))


if __name__ == "__main__":
    unittest.main()
