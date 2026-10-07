import contextlib
import copy
import importlib.util
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("manual_plan", Path(__file__).with_name("plan-manual-payments-import.py"))
planner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(planner)


class ManualImportPlanTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.row = {"_id": "original-payment-id", "_creationTime": 1790208000000.125,
            "day": "2026-09-23", "amount": 10, "currency": "KWD", "amountUsd": 32.4,
            "usdPerUnit": 3.24, "clientName": "Client", "rail": "cash", "note": "Human text",
            "addedBy": "writer@tests.invalid", "addedAt": 1790208000000}
        self.audit = {"_id": "original-audit-id", "table": "ceoManualPayments", "rowId": self.row["_id"],
            "action": "manualPayment.add", "what": "Original description", "by": "writer@tests.invalid",
            "at": self.row["addedAt"], "after": copy.deepcopy(self.row)}

    def archive(self, rows=None, audits=None, omit=None):
        path = self.root / "snapshot.zip"
        with zipfile.ZipFile(path, "w") as archive:
            for name, records in {"ceoManualPayments": rows if rows is not None else [self.row],
                    "ceoAudit": audits if audits is not None else [self.audit]}.items():
                if name != omit:
                    archive.writestr(f"{name}/documents.jsonl", "\n".join(json.dumps(r) for r in records))
            # Must never parse this unrelated credential-bearing table.
            archive.writestr("authSessions/documents.jsonl", "this is deliberately not JSON")
        return path

    def test_keeps_source_id_fx_authorship_and_full_original_audit(self):
        result = planner.plan(self.archive(), "source-deployment")
        payment = result["payments"][0]
        self.assertEqual(payment["id"], self.row["_id"])
        self.assertEqual(payment["usd_per_unit"], "3.24")
        self.assertEqual(payment["amount_usd"], "32.4")
        self.assertEqual(payment["added_by"], self.row["addedBy"])
        self.assertEqual(result["audits"][0]["metadata"]["source_record"], self.audit)
        self.assertEqual(result["audits"][0]["metadata"]["source_payment"], self.row)
        self.assertFalse(result["report"]["target_compared"])
        self.assertFalse(result["report"]["apply_ready"])
        self.assertEqual(result["report"]["live_writes"], 0)

    def test_missing_tables_are_not_empty_history(self):
        with self.assertRaisesRegex(ValueError, "absence is not an empty"):
            planner.plan(self.archive(omit="ceoAudit"), "source")
        result = planner.plan(self.archive(rows=[], audits=[]), "source")
        self.assertEqual(result["report"]["source_payments"], 0)
        self.assertEqual(result["report"]["errors"], [])

    def test_never_guesses_missing_rates_or_rounds_invalid_source_money(self):
        for field, value in [("usdPerUnit", None), ("amountUsd", None), ("amount", 0),
                ("amount", 10.0001), ("currency", "EUR"), ("day", "2026-02-30")]:
            row = copy.deepcopy(self.row)
            row[field] = value
            result = planner.plan(self.archive(rows=[row]), "source")
            self.assertEqual(len(result["report"]["errors"]), 1)
            self.assertEqual(result["payments"], [])

    def test_removed_entries_preserve_removal_and_existing_target_edits_are_conflicts(self):
        self.row.update(deletedAt=1790209000000, deletedBy="other@tests.invalid")
        path = self.archive()
        target = planner.plan(path, "source")["payments"]
        target[0]["note"] = "New human edit in Supabase"
        original = copy.deepcopy(target)
        result = planner.plan(path, "source", target)
        self.assertEqual(result["report"]["conflicts"][0]["fields"], ["note"])
        self.assertEqual(target, original)
        self.assertIsNotNone(result["payments"][0]["deleted_at"])

    def test_rerun_compares_numbers_and_instants_without_inserting_duplicates(self):
        path = self.archive()
        target = planner.plan(path, "source")["payments"]
        target[0]["amount"] = 10.0
        target[0]["added_at"] = target[0]["added_at"].replace("+00:00", "Z")
        result = planner.plan(path, "source", target)
        self.assertEqual(result["report"]["unchanged"], [self.row["_id"]])
        self.assertEqual(result["report"]["candidate_creates"], [])
        self.assertFalse(result["report"]["apply_ready"])

    def test_mapping_collision_and_orphan_history_remain_visible(self):
        path = self.archive(audits=[dict(self.audit, rowId="missing-payment")])
        target = planner.plan(path, "source")["payments"]
        target[0]["id"] = "different-target-id"
        result = planner.plan(path, "source", target)
        self.assertEqual(result["report"]["conflicts"][0]["fields"], ["id/source mapping"])
        self.assertEqual(result["report"]["orphan_audits"], [self.audit["_id"]])
        self.assertEqual(result["report"]["payments_without_source_audit"], [self.row["_id"]])
        self.assertEqual(len(result["audits"]), 1)

    def test_output_is_private_new_directory_only_and_console_has_no_financial_details(self):
        path = self.archive()
        out = self.root / "plan"
        args = ["--snapshot", str(path), "--deployment", "source", "--out", str(out)]
        console = io.StringIO()
        with contextlib.redirect_stdout(console):
            self.assertEqual(planner.main(args), 0)
        self.assertNotIn("writer@", console.getvalue())
        self.assertNotIn("Human text", console.getvalue())
        before = (out / "payments.json").read_bytes()
        with self.assertRaises(FileExistsError):
            planner.main(args)
        self.assertEqual((out / "payments.json").read_bytes(), before)
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            planner.main(args + ["--apply"])


if __name__ == "__main__":
    unittest.main()
