import importlib.util
import json
import unittest
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory


SCRIPT = Path(__file__).with_name("reconcile-cockpit-checks.py")
SPEC = importlib.util.spec_from_file_location("reconcile_cockpit_checks", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def check(role, day, key, done, **more):
    return {"_id": f"{role}-{day}-{key}", "role": role, "day": day, "key": key, "done": done, **more}


class ReconcileChecksTests(unittest.TestCase):
    def test_client_success_owns_human_completion_not_media_buyer_mirror(self):
        media = [
            check("media_buyer", "2026-09-14", "review", False),
            check("csm", "2026-09-14", "sprint_1", False),
        ]
        child = [check("csm", "2026-09-14", "sprint_1", True, doneAt=123)]
        result = MODULE.reconcile(media, child, [])
        self.assertEqual(result["authoritative_rows"]["total"], 2)
        self.assertEqual(result["media_buyer_csm_mirror"]["matching_day_keys"], 1)
        self.assertEqual(
            result["media_buyer_csm_mirror"]["completion_conflicts"],
            [{"day": "2026-09-14", "key": "sprint_1", "media_buyer_done": False, "client_success_done": True}],
        )
        self.assertTrue(result["safe_to_backfill_selected_rows"])
        self.assertEqual(result["writes_performed"], 0)

    def test_missing_child_copy_blocks_silent_drop(self):
        result = MODULE.reconcile([check("csm", "2026-09-14", "sprint_1", True)], [], [])
        self.assertFalse(result["safe_to_backfill_selected_rows"])
        self.assertEqual(
            result["media_buyer_csm_mirror"]["missing_in_child"],
            [{"day": "2026-09-14", "key": "sprint_1"}],
        )

    def test_duplicate_authoritative_day_key_is_rejected(self):
        row = check("csm", "2026-09-14", "sprint_1", True)
        with self.assertRaisesRegex(ValueError, "duplicate day/key"):
            MODULE.reconcile([], [row, {**row, "_id": "different"}], [])

    def test_unexpected_role_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unexpected role"):
            MODULE.reconcile([], [check("media_buyer", "2026-09-14", "review", True)], [])

    def test_official_zip_reader_validates_fields_without_writing(self):
        row = check("csm", "2026-09-14", "sprint_1", True)
        with TemporaryDirectory() as temp:
            archive = Path(temp) / "snapshot.zip"
            with zipfile.ZipFile(archive, "w") as output:
                output.writestr("checks/documents.jsonl", json.dumps(row) + "\n")
            self.assertEqual(MODULE.read_checks(archive), [row])

    def test_non_boolean_completion_is_rejected(self):
        row = check("csm", "2026-09-14", "sprint_1", "yes")
        with TemporaryDirectory() as temp:
            archive = Path(temp) / "snapshot.zip"
            with zipfile.ZipFile(archive, "w") as output:
                output.writestr("checks/documents.jsonl", json.dumps(row) + "\n")
            with self.assertRaisesRegex(ValueError, "non-boolean done"):
                MODULE.read_checks(archive)


if __name__ == "__main__":
    unittest.main()
