import contextlib
import importlib.util
import io
import json
import unittest
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("backfill-cockpit-checks.py")
SPEC = importlib.util.spec_from_file_location("backfill_cockpit_checks", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def check(role, key, done, **extra):
    return {
        "_id": f"{role}-{key}",
        "_creationTime": 1789395988000,
        "role": role,
        "day": "2026-09-14",
        "key": key,
        "label": "Daily check",
        "done": done,
        **extra,
    }


class BackfillChecksTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.media = base / "media.zip"
        self.child = base / "child.zip"
        self.creative = base / "creative.zip"
        self.child_row = check("csm", "sprint_1", True, doneAt=1789395988858)
        for path, rows in (
            (self.media, [check("media_buyer", "review", False), check("csm", "sprint_1", False)]),
            (self.child, [self.child_row]),
            (self.creative, []),
        ):
            with zipfile.ZipFile(path, "w") as output:
                output.writestr("checks/documents.jsonl", "".join(json.dumps(row) + "\n" for row in rows))
        self.args = [
            "--media-buyer", str(self.media), "--media-buyer-ts", "111",
            "--client-success", str(self.child), "--client-success-ts", "222",
            "--creative", str(self.creative), "--creative-ts", "333",
        ]

    def test_dry_run_is_offline_and_preserves_one_authoritative_csm_row(self):
        output = io.StringIO()
        with patch.object(MODULE, "request_json", side_effect=AssertionError("network used")):
            with contextlib.redirect_stdout(output):
                self.assertEqual(MODULE.main(self.args), 0)
        report = json.loads(output.getvalue())
        self.assertTrue(report["DRY_RUN"])
        self.assertEqual(report["ownership"]["authoritative_rows"]["total"], 2)
        self.assertEqual(report["max_batch_rows"], 25)

    def test_build_row_keeps_human_completion_and_source_identity(self):
        row = MODULE.build_row(self.child_row, "csm", "222")
        self.assertEqual(row["owner_app"], "client-success")
        self.assertEqual(row["source_deployment"], "impressive-dinosaur-375")
        self.assertEqual(row["source_snapshot_ts"], "222")
        self.assertTrue(row["done"])
        self.assertEqual(row["source_row"], self.child_row)
        self.assertIsNotNone(row["done_at"])

    def test_media_buyer_csm_copy_cannot_be_selected_as_owner(self):
        with self.assertRaisesRegex(ValueError, "wrong source role"):
            MODULE.build_row(check("csm", "sprint_1", False), "media_buyer", "111")

    def test_apply_one_requires_exact_canary(self):
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError, "requires --canary-role"):
                MODULE.main(self.args + ["--apply-one"])

    def test_apply_one_issues_one_post_and_verifies_audit(self):
        expected = MODULE.build_row(self.child_row, "csm", "222")
        actual = {**expected, "id": 42}
        calls = []

        def fake_request(url, key, *, method="GET", body=None):
            calls.append((url, method, body))
            if "cockpit_audit_log" in url:
                return [{"id": "audit"}]
            return [actual]

        with patch.object(MODULE, "read_env_value", side_effect=lambda path, name: {
            "SUPABASE_URL": MODULE.PROJECT_URL,
            "SUPABASE_SERVICE_ROLE_KEY": "fake-key",
        }[name]):
            with patch.object(MODULE, "remote_rows", side_effect=[[], [], [actual]]):
                with patch.object(MODULE, "request_json", side_effect=fake_request):
                    with contextlib.redirect_stdout(io.StringIO()):
                        self.assertEqual(MODULE.main(self.args + [
                            "--apply-one", "--canary-role", "csm",
                            "--canary-day", "2026-09-14", "--canary-key", "sprint_1",
                        ]), 0)
        posts = [call for call in calls if call[1] == "POST"]
        self.assertEqual(len(posts), 1)
        self.assertTrue(posts[0][2]["done"])
        self.assertEqual(posts[0][2]["owner_app"], "client-success")

    def test_batch_requires_bounded_limit_and_past_cutoff(self):
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError, "requires --limit"):
                MODULE.main(self.args + ["--apply-batch", "--through-day", "2026-09-14", "--limit", "26"])
            with self.assertRaisesRegex(ValueError, "strictly before"):
                MODULE.main(self.args + ["--apply-batch", "--through-day", "9999-01-01", "--limit", "1"])

    def test_batch_preflights_canary_and_writes_only_missing_owner_row(self):
        canary = {**MODULE.build_row(self.child_row, "csm", "222"), "id": 42}
        expected_media = MODULE.build_row(check("media_buyer", "review", False), "media_buyer", "111")
        actual_media = {**expected_media, "id": 43}
        calls = []

        def fake_request(url, key, *, method="GET", body=None):
            calls.append((url, method, body))
            if "cockpit_audit_log" in url:
                return [{"id": "audit"}]
            if method == "GET":
                return [canary]
            return [actual_media]

        with patch.object(MODULE, "read_env_value", side_effect=lambda path, name: {
            "SUPABASE_URL": MODULE.PROJECT_URL,
            "SUPABASE_SERVICE_ROLE_KEY": "fake-key",
        }[name]):
            with patch.object(MODULE, "request_json", side_effect=fake_request):
                with patch.object(MODULE, "remote_rows", return_value=[actual_media]):
                    with contextlib.redirect_stdout(io.StringIO()):
                        self.assertEqual(MODULE.main(self.args + [
                            "--apply-batch", "--through-day", "2026-09-14", "--limit", "1",
                        ]), 0)
        posts = [call for call in calls if call[1] == "POST"]
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0][2]["role"], "media_buyer")
        self.assertEqual(posts[0][2]["check_key"], "review")

    def test_batch_without_checked_child_canary_makes_no_post(self):
        calls = []

        def fake_request(url, key, *, method="GET", body=None):
            calls.append(method)
            return []

        with patch.object(MODULE, "read_env_value", side_effect=lambda path, name: {
            "SUPABASE_URL": MODULE.PROJECT_URL,
            "SUPABASE_SERVICE_ROLE_KEY": "fake-key",
        }[name]):
            with patch.object(MODULE, "request_json", side_effect=fake_request):
                with contextlib.redirect_stdout(io.StringIO()):
                    with self.assertRaisesRegex(RuntimeError, "canary is not present"):
                        MODULE.main(self.args + [
                            "--apply-batch", "--through-day", "2026-09-14", "--limit", "1",
                        ])
        self.assertEqual(calls, ["GET"])

    def test_plan_batch_reports_exact_first_write_without_post(self):
        canary = {**MODULE.build_row(self.child_row, "csm", "222"), "id": 42}
        calls = []

        def fake_request(url, key, *, method="GET", body=None):
            calls.append(method)
            return [canary]

        output = io.StringIO()
        with patch.object(MODULE, "read_env_value", side_effect=lambda path, name: {
            "SUPABASE_URL": MODULE.PROJECT_URL,
            "SUPABASE_SERVICE_ROLE_KEY": "fake-key",
        }[name]):
            with patch.object(MODULE, "request_json", side_effect=fake_request):
                with contextlib.redirect_stdout(output):
                    self.assertEqual(MODULE.main(self.args + [
                        "--plan-batch", "--through-day", "2026-09-14", "--limit", "1",
                    ]), 0)
        plan = json.loads(output.getvalue().splitlines()[-1])
        self.assertTrue(plan["DRY_RUN"])
        self.assertEqual(plan["this_run"], 1)
        self.assertEqual(plan["first_planned"], [
            {"role": "media_buyer", "day": "2026-09-14", "key": "review"},
        ])
        self.assertEqual(calls, ["GET"])


if __name__ == "__main__":
    unittest.main()
