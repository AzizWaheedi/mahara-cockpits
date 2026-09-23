import importlib.util
import contextlib
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("backfill-cockpit-issue-reports.py")
SPEC = importlib.util.spec_from_file_location("backfill_cockpit_issue_reports", SCRIPT)
assert SPEC and SPEC.loader
backfill = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backfill)


class BackfillIssueReportsTest(unittest.TestCase):
    def setUp(self):
        self.document = {
            "_id": "test-convex-id",
            "role": "media_buyer",
            "page": "/campaigns",
            "text": "The spend looks wrong",
            "email": "  NADa@MaharaMedia.com ",
            "at": 1780000000000,
            "day": "2026-05-28",
            "delivered": True,
            "reply": "Checked",
        }

    def test_maps_historical_row_without_losing_status_details(self):
        row = backfill.build_row(self.document)
        self.assertEqual(row["source_system"], "convex")
        self.assertEqual(row["source_id"], "test-convex-id")
        self.assertEqual(row["status"], "historical")
        self.assertEqual(row["actor_email"], "nada@maharamedia.com")
        self.assertEqual(row["metadata"]["delivered"], True)
        self.assertEqual(row["metadata"]["reply"], "Checked")
        self.assertEqual(row["created_at"], "2026-05-28T20:26:40+00:00")

    def test_skips_other_roles_and_rejects_truncation(self):
        self.assertIsNone(backfill.build_row({**self.document, "role": "csm"}))
        with self.assertRaisesRegex(ValueError, "exceeds the mirror contract"):
            backfill.build_row({**self.document, "text": "x" * 10001})

    def test_reads_convex_snapshot_member_only(self):
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "snapshot.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("feedback/documents.jsonl", json.dumps(self.document) + "\n")
                archive.writestr("other/documents.jsonl", '{"secret":"ignored"}\n')
            self.assertEqual(backfill.read_documents(archive_path), [self.document])

    def test_read_back_checks_content_and_timestamp(self):
        row = backfill.build_row(self.document)
        backfill.verify_row(row, {**row, "id": 9, "created_at": "2026-05-28T20:26:40+00:00"})
        with self.assertRaisesRegex(RuntimeError, "differs in text"):
            backfill.verify_row(row, {**row, "text": "changed"})

    def test_default_cli_is_offline_dry_run(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "feedback.jsonl"
            source.write_text(json.dumps(self.document) + "\n", encoding="utf-8")
            output = io.StringIO()
            with patch.object(sys, "argv", [str(SCRIPT), "--source", str(source)]), \
                 patch.object(backfill, "request_json", side_effect=AssertionError("network call")), \
                 contextlib.redirect_stdout(output):
                self.assertEqual(backfill.main(), 0)
            report = json.loads(output.getvalue())
            self.assertTrue(report["DRY_RUN"])
            self.assertEqual(report["media_buyer_reports"], 1)

    def test_apply_one_posts_exactly_one_row_and_checks_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "feedback.jsonl"
            source.write_text(json.dumps(self.document) + "\n", encoding="utf-8")
            env = Path(directory) / ".env.local"
            env.write_text(
                f"SUPABASE_URL={backfill.PROJECT_URL}\nSUPABASE_SERVICE_ROLE_KEY=test-only\n",
                encoding="utf-8",
            )
            expected = backfill.build_row(self.document)
            calls = []

            def fake_request(url, key, *, method="GET", body=None):
                calls.append((url, method, body))
                if len(calls) == 1:
                    return []
                if len(calls) == 2:
                    return [{**expected, "id": 7}]
                if len(calls) == 3:
                    return [{**expected, "id": 7}]
                return [{"id": "audit-id"}]

            output = io.StringIO()
            with patch.object(sys, "argv", [str(SCRIPT), "--source", str(source), "--apply-one", "--env-path", str(env)]), \
                 patch.object(backfill, "request_json", side_effect=fake_request), \
                 contextlib.redirect_stdout(output):
                self.assertEqual(backfill.main(), 0)
            self.assertEqual(sum(method == "POST" for _, method, _ in calls), 1)
            self.assertEqual(calls[1][2], expected)
            self.assertIn("audit row verified", output.getvalue())


if __name__ == "__main__":
    unittest.main()
