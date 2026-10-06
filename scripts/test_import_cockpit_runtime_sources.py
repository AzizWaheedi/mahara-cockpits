"""Behavioral coverage for the finite runtime importer (no live services)."""
import copy
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from datetime import datetime, timezone

SPEC = importlib.util.spec_from_file_location("runtime_import", Path(__file__).with_name("import-cockpit-runtime-sources.py"))
imp = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(imp)


class RuntimeImportTests(unittest.TestCase):
    def test_snapshot_requires_matching_archive_hash_and_table_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "snapshot.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("clients/documents.jsonl", json.dumps({"_id": "c", "name": "Acme"}) + "\n")
            item = {"cockpit": "media-buyer", "path": str(path), "sha256": imp.file_hash(path), "tables": {"clients": 1}, "deployment": "test"}
            self.assertEqual(imp.load_snapshot(item)["tables"]["clients"][0]["_id"], "c")
            item["tables"]["clients"] = 0
            with self.assertRaisesRegex(ValueError, "count"):
                imp.load_snapshot(item)
            item["sha256"] = "0" * 64
            with self.assertRaisesRegex(ValueError, "checksum"):
                imp.load_snapshot(item)

    def test_real_export_catalog_is_not_treated_as_business_documents(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "snapshot.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("_tables/documents.jsonl", json.dumps({"name": "clients", "id": 7}) + "\n")
                archive.writestr("clients/documents.jsonl", json.dumps({"_id": "c", "name": "Acme"}) + "\n")
                archive.writestr("_storage/documents.jsonl", "")
            item = {"cockpit": "media-buyer", "path": str(path), "sha256": imp.file_hash(path),
                    "tables": {"_tables": 1, "clients": 1, "_storage": 0}, "deployment": "test"}
            loaded = imp.load_snapshot(item)
            self.assertEqual(loaded["tables"]["clients"][0]["_id"], "c")
            self.assertEqual(loaded["tables"]["_tables"], [{"name": "clients", "id": 7}])

    def test_catalog_cannot_hide_an_unlisted_business_table(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "snapshot.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("_tables/documents.jsonl", "")
                archive.writestr("clients/documents.jsonl", "")
            item = {"cockpit": "media-buyer", "path": str(path), "sha256": imp.file_hash(path),
                    "tables": {"_tables": 0, "clients": 0}, "deployment": "test"}
            with self.assertRaisesRegex(ValueError, "catalog"):
                imp.load_snapshot(item)

    def test_unknown_durable_table_blocks_even_when_empty(self):
        self.assertEqual(imp.classify("creative-director", "futureUserSettings")[0], "unsupported")
        self.assertEqual(imp.classify("media-buyer", "authRefreshTokens")[0], "invalidate")
        self.assertEqual(imp.classify("media-buyer", "outbox")[0], "quarantine")

    def test_approved_old_chat_archive_retains_source_evidence_without_replaying_work(self):
        stamp = datetime.now(timezone.utc).isoformat()
        rows = [{"_id": "old-chat", "role": "user", "text": "An old request", "status": "queued"}]
        snapshot = {"app": "media-buyer", "path": "/protected/original.zip", "sha256": "a" * 64,
                    "deployment": "test", "captured_at": stamp,
                    "tables": {"hermesChat": rows}, "table_hashes": {"hermesChat": imp.content_hash(rows)}}
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": stamp,
                     "complete_tables": ["cockpit_runtime_imports"],
                     "tables": {"cockpit_runtime_imports": []}, "files": {}}
        plan = imp.build_plan([snapshot], inventory, ["media-buyer/hermesChat"])
        self.assertTrue(plan["scope_complete"], plan["blockers"])
        self.assertEqual(plan["operations"], [])
        self.assertEqual(plan["sources"][0]["sha256"], snapshot["sha256"])
        self.assertEqual(plan["sources"][0]["path"], snapshot["path"])
        self.assertEqual(plan["classifications"][0]["count"], 1)
        self.assertEqual(plan["classifications"][0]["sha256"], imp.content_hash(rows))
        self.assertFalse(plan["full_migration_complete"])

    def test_chat_archive_approval_does_not_exclude_unmapped_business_data(self):
        stamp = datetime.now(timezone.utc).isoformat()
        rows = {"hermesChat": [], "ceoManualPayments": [{"_id": "original-payment", "amount": 20}]}
        snapshot = {"app": "media-buyer", "sha256": "a" * 64, "deployment": "test",
                    "captured_at": stamp, "tables": rows,
                    "table_hashes": {name: imp.content_hash(value) for name, value in rows.items()}}
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": stamp,
                     "complete_tables": ["cockpit_runtime_imports"],
                     "tables": {"cockpit_runtime_imports": []}, "files": {}}
        plan = imp.build_plan([snapshot], inventory, ["media-buyer/hermesChat"])
        self.assertFalse(plan["scope_complete"])
        self.assertTrue(any("ceoManualPayments" in blocker for blocker in plan["blockers"]))
        self.assertEqual(plan["operations"], [])

    def test_staff_status_and_daily_plan_are_native_business_rows_not_source_caches(self):
        stamp = datetime.now(timezone.utc).isoformat()
        records = {
            "ceoTeamStatus": [{"_id": "staff-status", "personKey": "media_buyer:test", "status": "paused",
                               "since": "2026-09-16", "note": "Keep the original note",
                               "setBy": "founder@tests.invalid", "setAt": 1790208000000}],
            "planItems": [{"_id": "daily-plan", "role": "media_buyer", "day": "2026-10-04",
                           "text": "Finish the original plan", "listName": "Media Buyer",
                           "dueDate": "2026-10-05", "createdAt": 1790208000000, "confirmed": True}],
        }
        snapshot = {"app": "media-buyer", "deployment": "test", "sha256": "a" * 64,
                    "captured_at": stamp, "tables": records,
                    "table_hashes": {name: imp.content_hash(rows) for name, rows in records.items()}}
        target = {"cockpit_runtime_imports": [], "cockpit_team_status": [], "cockpit_plan_items": [],
                  "cockpit_team_status_state": [{"id": True, "history_ready": False}]}
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": stamp,
                     "complete_tables": list(target), "tables": target, "files": {}}
        plan = imp.build_plan([snapshot], inventory, ["media-buyer/ceoTeamStatus", "media-buyer/planItems"])
        self.assertTrue(plan["scope_complete"], plan["blockers"])
        by_table = {operation["table"]: operation for operation in plan["operations"]}
        status = by_table["ceoTeamStatus"]
        self.assertEqual(status["target"], "cockpit_team_status")
        self.assertEqual(status["rows"][0]["data"]["note"], "Keep the original note")
        self.assertEqual(status["rows"][0]["data"]["source_record"], records["ceoTeamStatus"][0])
        daily = by_table["planItems"]
        self.assertEqual(daily["target"], "cockpit_plan_items")
        self.assertEqual(daily["rows"][0]["data"]["confirmed"], True)
        self.assertEqual(daily["rows"][0]["data"]["due_date"], "2026-10-05")
        self.assertEqual(daily["rows"][0]["data"]["source_row"], records["planItems"][0])

    def test_original_tomorrow_plan_date_uses_historical_plan_day(self):
        original = {"_id": "old-plan", "role": "media_buyer", "day": "2025-12-31",
                    "text": "Original task", "dueDate": "tomorrow", "createdAt": 1790208000000}
        snapshot = {"app": "media-buyer", "deployment": "test"}
        data = imp.durable_data(snapshot, "planItems", original)
        self.assertEqual(data["due_date"], "2026-01-01")
        self.assertEqual(data["source_row"], original)

    def test_original_client_billing_preserves_zero_missing_and_ltv_baseline(self):
        original = {"_id": "billing-record", "taskId": "original-client", "name": "Client A",
                    "stage": "Stopped", "mrrUsd": 0, "ltvUsd": 123.5, "currency": "USD",
                    "paymentPlan": "Paid In Full", "churnDate": "2026-09-15",
                    "syncedAt": 1790298000000}
        snapshot = {"app": "media-buyer", "deployment": "test"}
        data = imp.durable_data(snapshot, "ceoClientBilling", original)
        self.assertEqual((data["day"], data["clickup_task_id"]), ("2026-09-25", "original-client"))
        self.assertEqual((data["mrr_usd"], data["ltv_usd"], data["next_payment_usd"]), (0, 123.5, None))
        self.assertEqual((data["stage"], data["payment_plan"], data["churn_date"]), ("Stopped", "Paid In Full", "2026-09-15"))
        self.assertEqual(data["source_record"], original)

    def test_original_daily_money_baseline_is_mapped_to_canonical_metric_history(self):
        stamp = datetime.now(timezone.utc).isoformat()
        original = {"_id": "ltv-baseline", "date": "2026-09-24", "metric": "money.ltv.card",
                    "scope": "client:original-card", "value": 123.5, "at": 1790208000000}
        snapshot = {"app": "media-buyer", "deployment": "test", "sha256": "a" * 64,
                    "captured_at": stamp, "tables": {"ceoDaily": [original]},
                    "table_hashes": {"ceoDaily": imp.content_hash([original])}}
        targets = {"cockpit_runtime_imports": [], "cockpit_metric_days": []}
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": stamp,
                     "complete_tables": list(targets), "tables": targets, "files": {}}
        plan = imp.build_plan([snapshot], inventory, ["media-buyer/ceoDaily"])
        self.assertTrue(plan["scope_complete"], plan["blockers"])
        operation = plan["operations"][0]
        self.assertEqual(operation["target"], "cockpit_metric_days")
        data = operation["rows"][0]["data"]
        self.assertEqual((data["day"], data["metric"], data["scope"], data["value"]),
                         ("2026-09-24", "money.ltv.card", "client:original-card", 123.5))
        self.assertEqual(data["source_record"], original)
        inventory["tables"]["cockpit_metric_days"] = [{**data, "value": 500, "source_id": None, "source_deployment": None}]
        blocked = imp.build_plan([snapshot], inventory, ["media-buyer/ceoDaily"])
        self.assertFalse(blocked["scope_complete"])
        self.assertTrue(any("Protected" in reason for reason in blocked["blockers"]))

    def test_original_human_audit_retains_author_before_after_and_entity_identity(self):
        stamp = datetime.now(timezone.utc).isoformat()
        original = {"_id": "original-audit", "action": "people.edit", "table": "cockpit_people",
                    "rowId": "20", "what": "Original recorded edit", "by": "founder@tests.invalid",
                    "at": 1790208000000, "before": {"name": "Original"}, "after": {"name": "Updated"}}
        snapshot = {"app": "media-buyer", "deployment": "test", "sha256": "a" * 64,
                    "captured_at": stamp, "tables": {"ceoAudit": [original]},
                    "table_hashes": {"ceoAudit": imp.content_hash([original])}}
        targets = {"cockpit_runtime_imports": [], "cockpit_audit_log": []}
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": stamp,
                     "complete_tables": list(targets), "tables": targets, "files": {}}
        plan = imp.build_plan([snapshot], inventory, ["media-buyer/ceoAudit"])
        self.assertTrue(plan["scope_complete"], plan["blockers"])
        operation = plan["operations"][0]
        self.assertEqual(operation["target"], "cockpit_audit_log")
        data = operation["rows"][0]["data"]
        self.assertEqual((data["action"], data["entity_type"], data["entity_id"], data["actor_email"]),
                         ("people.edit", "cockpit_people", "20", "founder@tests.invalid"))
        self.assertEqual((data["before"], data["after"]), ({"name": "Original"}, {"name": "Updated"}))
        self.assertEqual(data["metadata"]["source_record"], original)
        self.assertEqual(data["metadata"]["source_deployment"], "test")
        self.assertEqual(data["metadata"]["source_id"], "original-audit")

    def test_creative_multi_client_scope_never_drops_unknown_client(self):
        sets = {"clients": [{"_id": "c", "name": "Acme"}]}
        row = {"_id": "t", "clients": ["Acme", "Unresolved"]}
        with self.assertRaisesRegex(ValueError, "scope"):
            imp.client_names("creative-director", "creativeTasks", row, sets)
        row["clients"] = ["Acme"]
        self.assertEqual(imp.client_names("creative-director", "creativeTasks", row, sets), ["Acme"])

    def test_historical_campaign_subject_keeps_retired_client_history_without_guessing_aliases(self):
        tables = {"clients": [{"name": "Current Client"}],
                  "campaigns": [{"name": "Campaign display name", "clientName": "Recorded Former Client"}]}
        row = {"clientName": "Recorded Former Client"}
        self.assertEqual(imp.client_names("media-buyer", "callBriefs", row, tables), ["Recorded Former Client"])
        for unknown in ("Campaign display name", "Recorded Former", "Unrecorded Client"):
            with self.assertRaisesRegex(ValueError, "scope"):
                imp.client_names("media-buyer", "callBriefs", {"clientName": unknown}, tables)

    def test_campaign_scope_uses_exact_campaign_and_client_names(self):
        sets = {"clients": [{"name": "Acme"}], "campaigns": [{"campaignName": "Sales", "clientName": "Acme"}]}
        self.assertEqual(imp.client_names("media-buyer", "adChanges", {"_id": "a", "campaignName": "Sales"}, sets), ["Acme"])
        with self.assertRaisesRegex(ValueError, "scope"):
            imp.client_names("media-buyer", "adChanges", {"_id": "a", "campaignName": "Sale"}, sets)
    def test_churn_scope_resolves_only_by_exact_client_identity(self):
        clients = {"clients": [{"_id": "c1", "taskId": "cu1", "name": "Acme"}]}
        event = {"_id": "e1", "key": "cu1", "kind": "lost"}
        self.assertEqual(imp.client_names("client-success", "churnEvents", event, clients), ["Acme"])
        event["key"] = "not-a-client"
        with self.assertRaisesRegex(ValueError, "scope"):
            imp.client_names("client-success", "churnEvents", event, clients)


    def test_exact_compare_distinguishes_missing_null_and_numbers(self):
        self.assertNotEqual(imp.content_hash({"a": None}), imp.content_hash({}))
        self.assertNotEqual(imp.content_hash({"a": 1}), imp.content_hash({"a": "1"}))
        self.assertEqual(imp.content_hash({"b": 2, "a": 1}), imp.content_hash({"a": 1, "b": 2}))

    def test_protected_native_row_cannot_be_overwritten(self):
        current = {"source_id": "x", "data": {"_id": "x", "text": "new user edit"}, "client_names": ["Acme"], "source_snapshot_at": "2026-10-04T00:00:00+00:00"}
        desired = {**current, "data": {"_id": "x", "text": "old source"}}
        with self.assertRaisesRegex(ValueError, "protected"):
            imp.guard_existing(current, desired, None)
        previous = {"target_data": {"_id": "x", "text": "older import"}, "target_clients": ["Acme"]}
        with self.assertRaisesRegex(ValueError, "protected"):
            imp.guard_existing(current, desired, previous)
        previous["target_data"] = copy.deepcopy(current["data"])
        imp.guard_existing(current, desired, previous)
    def test_previously_imported_target_disappearance_is_not_recreated(self):
        desired = {"source_id": "x", "data": {"_id": "x", "text": "new"}, "client_names": ["Acme"]}
        previous = {"target_data": {"_id": "x", "text": "old"}, "target_clients": ["Acme"]}
        with self.assertRaisesRegex(ValueError, "disappeared"):
            imp.guard_existing(None, desired, previous)


    def test_missing_storage_mapping_never_keeps_legacy_file_url(self):
        source = {"_id": "s", "storageId": "file1", "url": "https://legacy.convex.cloud/api/storage/file1"}
        with self.assertRaisesRegex(ValueError, "file"):
            imp.rewrite_files(source, "media-buyer", {})
        mapped = {"media-buyer/file1": {"url": imp.PROJECT_URL + "/storage/v1/object/public/cockpit-ad-stills/" + "a" * 64, "sha256": "a" * 64, "verified": True}}
        rewritten = imp.rewrite_files(source, "media-buyer", mapped)
        self.assertEqual(rewritten["storageId"], "file1")
        self.assertEqual(rewritten["url"], mapped["media-buyer/file1"]["url"])
        self.assertEqual(source["url"], "https://legacy.convex.cloud/api/storage/file1")
    def test_verified_file_mapping_hash_must_match_content_addressed_path(self):
        mapped = {"media-buyer/file1": {
            "url": imp.PROJECT_URL + "/storage/v1/object/public/cockpit-ad-stills/" + "b" * 64,
            "sha256": "a" * 64, "verified": True,
        }}
        with self.assertRaisesRegex(ValueError, "hash"):
            imp.rewrite_files({"_id": "s", "storageId": "file1"}, "media-buyer", mapped)


    def test_plan_hash_binds_source_target_rows_scope_and_files(self):
        plan = {"source": "a", "target": "b", "scope": ["media-buyer/inbox"], "files": [], "operations": []}
        original = imp.content_hash(plan)
        for key in plan:
            changed = copy.deepcopy(plan)
            changed[key] = "changed"
            self.assertNotEqual(original, imp.content_hash(changed))

    def test_pending_queue_is_quarantined_without_replay(self):
        self.assertEqual(imp.classify("creative-director", "creativeOutbox")[0], "quarantine")
        self.assertEqual(imp.classify("client-success", "outbox")[0], "source")
        self.assertTrue(imp.queue_pending("client-success", "outbox", {"createdAt": 1}))
        self.assertFalse(imp.queue_pending("client-success", "outbox", {"sentAt": 2}))

    def test_source_empty_table_still_requires_inventory_proof(self):
        snapshot = {"app": "media-buyer", "sha256": "a" * 64, "deployment": "test", "tables": {"inbox": []}, "table_hashes": {"inbox": imp.content_hash([])}, "captured_at": "2026-10-04T00:00:00+00:00"}
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": snapshot["captured_at"], "complete_tables": [], "tables": {}, "files": {}}
        plan = imp.build_plan([snapshot], inventory, ["media-buyer/inbox"])
        self.assertFalse(plan["scope_complete"])
        self.assertTrue(any("inventory" in item for item in plan["blockers"]))


class RuntimePlanTests(unittest.TestCase):
    def inputs(self, rows):
        from datetime import datetime, timezone
        stamp = datetime.now(timezone.utc).isoformat()
        tables = {"clients": [{"_id": "client", "name": "Acme"}], "inbox": rows}
        snapshot = {"app": "media-buyer", "deployment": "legacy", "sha256": "a" * 64,
                    "captured_at": stamp, "tables": tables,
                    "table_hashes": {key: imp.content_hash(value) for key, value in tables.items()}}
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": stamp, "files": {},
                     "complete_tables": ["cockpit_media_sources", "cockpit_media_source_state", "cockpit_runtime_imports"],
                     "tables": {"cockpit_media_sources": [], "cockpit_runtime_imports": [],
                                "cockpit_media_source_state": [{"table_name": "inbox", "ready": False, "row_count": None, "source_snapshot_at": None}]}}
        return snapshot, inventory
    def test_pending_csm_delivery_is_marked_quarantined_and_never_queued(self):
        from datetime import datetime, timezone
        stamp = datetime.now(timezone.utc).isoformat()
        tables = {
            "clients": [{"_id": "client", "name": "Acme"}],
            "outbox": [{"_id": "job", "clientName": "Acme", "state": "pending", "action": "Send report"}],
        }
        snapshot = {"app": "client-success", "deployment": "legacy-cs", "sha256": "a" * 64,
                    "captured_at": stamp, "tables": tables,
                    "table_hashes": {key: imp.content_hash(value) for key, value in tables.items()}}
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": stamp, "files": {},
                     "complete_tables": ["cockpit_csm_sources", "cockpit_csm_source_state", "cockpit_runtime_imports"],
                     "tables": {"cockpit_csm_sources": [], "cockpit_runtime_imports": [],
                                "cockpit_csm_source_state": [{"table_name": "outbox", "ready": False, "row_count": None, "source_snapshot_at": None}]}}
        plan = imp.build_plan([snapshot], inventory, ["client-success/outbox"])
        classification = next(item for item in plan["classifications"] if item["table"] == "outbox")
        self.assertEqual(classification["pending_quarantined"], 1)
        self.assertTrue(plan["scope_complete"])
        self.assertEqual([op["kind"] for op in plan["operations"]], ["source"])
        self.assertEqual(plan["operations"][0]["rows"][0]["data"]["state"], "pending")


    def test_verified_complete_empty_is_a_real_bootstrap_operation(self):
        source, inventory = self.inputs([])
        plan = imp.build_plan([source], inventory, ["media-buyer/inbox"])
        self.assertEqual(plan["blockers"], [])
        self.assertTrue(plan["scope_complete"])
        self.assertFalse(plan["full_migration_complete"])
        self.assertEqual(plan["operations"][0]["source_count"], 0)
        self.assertEqual(plan["operations"][0]["rows"], [])
        self.assertEqual(plan["expected_tables"], inventory["tables"])

    def test_native_edit_and_missing_owned_row_cannot_be_replaced(self):
        source, inventory = self.inputs([{"_id": "task", "clientName": "Acme", "title": "Archive"}])
        native = {"table_name": "inbox", "source_id": "task", "client_names": ["Acme"],
                  "data": {"_id": "task", "clientName": "Acme", "title": "Human edit"},
                  "source_snapshot_at": source["captured_at"]}
        inventory["tables"]["cockpit_media_sources"] = [native]
        inventory["tables"]["cockpit_media_source_state"][0].update(
            ready=True, row_count=1, source_snapshot_at=source["captured_at"])
        plan = imp.build_plan([source], inventory, ["media-buyer/inbox"])
        self.assertFalse(plan["scope_complete"])
        self.assertEqual(plan["operations"], [])
        source["tables"]["inbox"] = []
        source["table_hashes"]["inbox"] = imp.content_hash([])
        plan = imp.build_plan([source], inventory, ["media-buyer/inbox"])
        self.assertFalse(plan["scope_complete"])
        self.assertEqual(plan["operations"], [])

    def test_hash_tampering_and_unsupported_empty_history_block_readiness(self):
        source, inventory = self.inputs([])
        source["tables"]["futureFinancialHistory"] = []
        source["table_hashes"]["futureFinancialHistory"] = imp.content_hash([])
        source["table_hashes"]["inbox"] = "0" * 64
        plan = imp.build_plan([source], inventory, ["media-buyer/inbox"])
        self.assertFalse(plan["scope_complete"])
        self.assertTrue(any("checksum" in item for item in plan["blockers"]))
        self.assertTrue(any("Unsupported durable" in item for item in plan["blockers"]))
    def test_ready_source_state_requires_exact_count_and_snapshot_rows(self):
        source, inventory = self.inputs([])
        stamp = source["captured_at"]
        state = inventory["tables"]["cockpit_media_source_state"][0]
        state.update(ready=True, row_count=1, source_snapshot_at=stamp)
        plan = imp.build_plan([source], inventory, ["media-buyer/inbox"])
        self.assertFalse(plan["scope_complete"])
        self.assertTrue(any("count" in item for item in plan["blockers"]))

    def test_uninitialized_source_state_cannot_hide_existing_rows(self):
        source, inventory = self.inputs([])
        inventory["tables"]["cockpit_media_sources"] = [
            {"table_name": "inbox", "source_id": "untracked", "data": {"_id": "untracked"}, "client_names": [], "source_snapshot_at": source["captured_at"]}
        ]
        plan = imp.build_plan([source], inventory, ["media-buyer/inbox"])
        self.assertFalse(plan["scope_complete"])
        self.assertEqual(plan["operations"], [])

    def test_durable_history_plans_to_its_canonical_tables(self):
        source, inventory = self.inputs([])
        source["tables"].update({
            "members": [{"_id": "member-source", "email": "New@Example.com", "name": "New Member", "roles": ["media_buyer"], "clients": ["Acme"], "addedAt": 1790985600000, "salesRole": "setter", "note": "Keep note"}],
            "eodReports": [{"_id": "eod-source", "role": "media_buyer", "day": "2026-10-03", "answers": {"work": "done"}, "computed": {}}],
            "checks": [{"_id": "check-source", "role": "media_buyer", "day": "2026-10-04", "key": "review", "label": "Review", "done": False}],
            "decisions": [{"_id": "decision-source", "role": "media_buyer", "day": "2026-10-03", "subject": "Acme", "action": "Keep running"}],
        })
        source["table_hashes"] = {key: imp.content_hash(rows) for key, rows in source["tables"].items()}
        targets = ["cockpit_members", "cockpit_eod_reports", "cockpit_daily_checks", "cockpit_decisions"]
        inventory["complete_tables"].extend(targets)
        inventory["tables"].update({target: [] for target in targets})
        plan = imp.build_plan([source], inventory, [
            "media-buyer/members", "media-buyer/eodReports", "media-buyer/checks", "media-buyer/decisions",
        ])
        self.assertTrue(plan["scope_complete"], plan["blockers"])
        operations = {op["table"]: op for op in plan["operations"]}
        self.assertEqual(operations["members"]["target"], "cockpit_members")
        self.assertEqual(operations["eodReports"]["target"], "cockpit_eod_reports")
        self.assertEqual(operations["checks"]["target"], "cockpit_daily_checks")
        self.assertEqual(operations["decisions"]["target"], "cockpit_decisions")
        self.assertTrue(all(op["kind"] == "durable" for op in operations.values()))
        self.assertEqual(operations["members"]["rows"][0]["data"]["email"], "new@example.com")
        self.assertEqual(operations["members"]["rows"][0]["data"]["source_id"], "member-source")
        self.assertEqual(operations["members"]["rows"][0]["data"]["source_deployment"], "legacy")
        self.assertEqual(operations["members"]["rows"][0]["data"]["sales_role"], "setter")
        self.assertEqual(operations["decisions"]["rows"][0]["client_names"], ["Acme"])


    def test_csm_durable_client_preferences_optional_language_and_protection(self):
        stamp = datetime.now(timezone.utc).isoformat()
        records = [
            {"_id": "pref-1", "_creationTime": 1790208000000, "clientName": "Acme", "language": "ar"},
            {"_id": "pref-2", "_creationTime": 1790208000000, "clientName": "Beta", "language": None},
        ]
        snapshot = {"app": "client-success", "deployment": "test-cs", "sha256": "b" * 64,
                    "captured_at": stamp, "tables": {"clients": [{"_id": "c1", "name": "Acme"}, {"_id": "c2", "name": "Beta"}], "clientPrefs": records},
                    "table_hashes": {"clients": imp.content_hash([{"_id": "c1", "name": "Acme"}, {"_id": "c2", "name": "Beta"}]),
                                    "clientPrefs": imp.content_hash(records)}}
        targets = {
            "cockpit_runtime_imports": [],
            "cockpit_client_profiles": [{"id": 1, "client_name": "Acme"}, {"id": 2, "client_name": "Beta"}],
            "cockpit_csm_client_preferences": [],
        }
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": stamp,
                     "complete_tables": list(targets), "tables": targets, "files": {}}
        plan = imp.build_plan([snapshot], inventory, ["client-success/clientPrefs"])
        self.assertTrue(plan["scope_complete"], plan["blockers"])
        op = plan["operations"][0]
        self.assertEqual(op["target"], "cockpit_csm_client_preferences")
        self.assertEqual(len(op["rows"]), 2)
        self.assertEqual(op["rows"][0]["data"]["language"], "ar")
        self.assertIsNone(op["rows"][1]["data"]["language"])
        self.assertEqual(op["rows"][0]["client_names"], ["Acme"])
        self.assertEqual(op["rows"][1]["client_names"], ["Beta"])

        # Natural key collision with different source_id
        targets["cockpit_csm_client_preferences"] = [{"id": 10, "client_profile_id": 1, "language": "ar", "source_id": "other-pref", "source_deployment": "test-cs"}]
        blocked = imp.build_plan([snapshot], inventory, ["client-success/clientPrefs"])
        self.assertFalse(blocked["scope_complete"])
        self.assertTrue(any("different source identity" in str(b) for b in blocked["blockers"]))

    def test_csm_durable_hot_list_preserves_attributes_unknown_author_and_private_ownership(self):
        stamp = datetime.now(timezone.utc).isoformat()
        records = [
            {"_id": "hot-1", "key": "task-1:csm", "clientName": "Acme", "type": "upsell", "leadType": "Hot",
             "status": "in_progress", "lastObjection": "budget", "amount": "$5,000", "manual": True,
             "hidden": False, "notes": "Follow up next week", "celebratedAt": 1790208000000, "at": 1790208000000},
            {"_id": "hot-2", "key": "task-2:private", "clientName": "", "type": "private_note", "byEmail": "csm@maharamedia.com",
             "notes": "Private plan", "at": 1790208000000},
        ]
        snapshot = {"app": "client-success", "deployment": "test-cs", "sha256": "c" * 64,
                    "captured_at": stamp, "tables": {"clients": [{"_id": "c1", "name": "Acme"}], "hotList": records},
                    "table_hashes": {"clients": imp.content_hash([{"_id": "c1", "name": "Acme"}]),
                                    "hotList": imp.content_hash(records)}}
        targets = {"cockpit_runtime_imports": [], "cockpit_csm_hot_rows": []}
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": stamp,
                     "complete_tables": list(targets), "tables": targets, "files": {}}
        plan = imp.build_plan([snapshot], inventory, ["client-success/hotList"])
        self.assertTrue(plan["scope_complete"], plan["blockers"])
        op = plan["operations"][0]
        self.assertEqual(op["target"], "cockpit_csm_hot_rows")
        # Client-scoped row retains genuinely unknown author without fabricating founder email
        self.assertIsNone(op["rows"][0]["data"]["owner_email"])
        self.assertEqual(op["rows"][0]["data"]["data"]["celebratedAt"], 1790208000000)
        self.assertEqual(op["rows"][0]["data"]["data"]["manual"], True)
        self.assertEqual(op["rows"][0]["client_names"], ["Acme"])
        # Private row has recorded author and empty client_names
        self.assertEqual(op["rows"][1]["data"]["owner_email"], "csm@maharamedia.com")
        self.assertEqual(op["rows"][1]["client_names"], [])

        # Truly private row without an author must fail clearly rather than inventing an owner
        unowned_private = {"_id": "hot-bad", "key": "task-3:bad", "clientName": "", "type": "note", "at": 1790208000000}
        with self.assertRaisesRegex(ValueError, "Private hot list row lacks recorded author"):
            imp.durable_data(snapshot, "hotList", unowned_private)

    def test_csm_durable_loose_dismissals_preserves_timestamp_and_natural_key(self):
        stamp = datetime.now(timezone.utc).isoformat()
        records = [
            {"_id": "loose-1", "key": "Acme|old invoice check", "clientName": "Acme",
             "text": "old invoice check", "at": 1790208000000},
        ]
        snapshot = {"app": "client-success", "deployment": "test-cs", "sha256": "d" * 64,
                    "captured_at": stamp, "tables": {"clients": [{"_id": "c1", "name": "Acme"}], "looseDismissed": records},
                    "table_hashes": {"clients": imp.content_hash([{"_id": "c1", "name": "Acme"}]),
                                    "looseDismissed": imp.content_hash(records)}}
        targets = {
            "cockpit_runtime_imports": [],
            "cockpit_client_profiles": [{"id": 1, "client_name": "Acme"}],
            "cockpit_csm_loose_dismissals": [],
        }
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": stamp,
                     "complete_tables": list(targets), "tables": targets, "files": {}}
        plan = imp.build_plan([snapshot], inventory, ["client-success/looseDismissed"])
        self.assertTrue(plan["scope_complete"], plan["blockers"])
        op = plan["operations"][0]
        self.assertEqual(op["target"], "cockpit_csm_loose_dismissals")
        self.assertEqual(op["rows"][0]["data"]["loose_text"], "old invoice check")
        self.assertEqual(op["rows"][0]["client_names"], ["Acme"])

        # Natural key collision
        targets["cockpit_csm_loose_dismissals"] = [{"id": 5, "client_profile_id": 1, "loose_text": "old invoice check", "source_id": "other-loose", "source_deployment": "test-cs"}]
        blocked = imp.build_plan([snapshot], inventory, ["client-success/looseDismissed"])
        self.assertFalse(blocked["scope_complete"])
        self.assertTrue(any("different source identity" in str(b) for b in blocked["blockers"]))

    def test_csm_durable_money_goals_preserves_target_clients_counts(self):
        stamp = datetime.now(timezone.utc).isoformat()
        records = [
            {"_id": "goal-1", "month": "2026-09", "byEmail": "csm@maharamedia.com",
             "target": 50000, "clients": 15, "counts": {"closed": 12}, "at": 1790208000000},
        ]
        snapshot = {"app": "client-success", "deployment": "test-cs", "sha256": "e" * 64,
                    "captured_at": stamp, "tables": {"moneyGoals": records},
                    "table_hashes": {"moneyGoals": imp.content_hash(records)}}
        targets = {"cockpit_runtime_imports": [], "cockpit_csm_money_goals": []}
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": stamp,
                     "complete_tables": list(targets), "tables": targets, "files": {}}
        plan = imp.build_plan([snapshot], inventory, ["client-success/moneyGoals"])
        self.assertTrue(plan["scope_complete"], plan["blockers"])
        op = plan["operations"][0]
        self.assertEqual(op["target"], "cockpit_csm_money_goals")
        data = op["rows"][0]["data"]
        self.assertEqual((data["month"], data["owner_email"], data["target"], data["clients"]),
                         ("2026-09", "csm@maharamedia.com", 50000.0, 15))
        self.assertEqual(data["counts"], {"closed": 12})

        # Natural key collision
        targets["cockpit_csm_money_goals"] = [{"id": 3, "month": "2026-09", "owner_email": "csm@maharamedia.com", "source_id": "other-goal", "source_deployment": "test-cs"}]
        blocked = imp.build_plan([snapshot], inventory, ["client-success/moneyGoals"])
        self.assertFalse(blocked["scope_complete"])
        self.assertTrue(any("different source identity" in str(b) for b in blocked["blockers"]))

    def test_csm_durable_projections_requires_sunday_and_preserves_actual_zero_vs_missing(self):
        stamp = datetime.now(timezone.utc).isoformat()
        # 2026-09-20 is a Sunday
        records = [
            {"_id": "proj-1", "weekStart": "2026-09-20", "byEmail": "csm@maharamedia.com",
             "metric": "renewal", "blood": 2, "stretch": 5, "actual": 0.0, "missReason": "Slow cycle", "at": 1790208000000},
            {"_id": "proj-2", "weekStart": "2026-09-20", "byEmail": "csm@maharamedia.com",
             "metric": "resell", "blood": 1, "stretch": 3, "at": 1790208000000},
        ]
        snapshot = {"app": "client-success", "deployment": "test-cs", "sha256": "f" * 64,
                    "captured_at": stamp, "tables": {"projections": records},
                    "table_hashes": {"projections": imp.content_hash(records)}}
        targets = {"cockpit_runtime_imports": [], "cockpit_csm_projections": []}
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": stamp,
                     "complete_tables": list(targets), "tables": targets, "files": {}}
        plan = imp.build_plan([snapshot], inventory, ["client-success/projections"])
        self.assertTrue(plan["scope_complete"], plan["blockers"])
        op = plan["operations"][0]
        self.assertEqual(op["target"], "cockpit_csm_projections")
        # Row 1 preserves real 0.0 actual and missReason
        self.assertEqual(op["rows"][0]["data"]["data"]["actual"], 0.0)
        self.assertEqual(op["rows"][0]["data"]["data"]["missReason"], "Slow cycle")
        # Row 2 preserves missing actual (not fabricated to 0)
        self.assertNotIn("actual", op["rows"][1]["data"]["data"])

        # Non-Sunday rejection (2026-09-21 is Monday)
        bad_proj = {"_id": "bad-proj", "weekStart": "2026-09-21", "byEmail": "csm@maharamedia.com",
                    "metric": "cash", "blood": 100, "stretch": 200, "at": 1790208000000}
        with self.assertRaisesRegex(ValueError, "Sunday"):
            imp.durable_data(snapshot, "projections", bad_proj)

    def test_csm_durable_renewal_plans_preserves_cycles_offers_recordings_and_celebrated(self):
        stamp = datetime.now(timezone.utc).isoformat()
        records = [
            {"_id": "renew-1", "taskId": "cu-task-99", "clientName": "Acme", "renewalDate": "2026-10-15",
             "status": "renewed", "likelihood": "high", "angle": "expansion", "objection": "timing",
             "objectionAnswer": "early lock discount", "paidAmount": 15000.0,
             "offer": {"price": 15000, "durationMonths": 6, "deliverables": "Full package"},
             "callRecordingUrl": "https://fathom.video/recording/abc", "goldStandard": True,
             "celebratedAt": 1790208000000, "updatedBy": "csm@maharamedia.com", "updatedAt": 1790208000000},
        ]
        snapshot = {"app": "client-success", "deployment": "test-cs", "sha256": "1" * 64,
                    "captured_at": stamp, "tables": {"clients": [{"_id": "c1", "name": "Acme"}], "renewalPlans": records},
                    "table_hashes": {"clients": imp.content_hash([{"_id": "c1", "name": "Acme"}]),
                                    "renewalPlans": imp.content_hash(records)}}
        targets = {"cockpit_runtime_imports": [], "cockpit_csm_renewal_plans": []}
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": stamp,
                     "complete_tables": list(targets), "tables": targets, "files": {}}
        plan = imp.build_plan([snapshot], inventory, ["client-success/renewalPlans"])
        self.assertTrue(plan["scope_complete"], plan["blockers"])
        op = plan["operations"][0]
        self.assertEqual(op["target"], "cockpit_csm_renewal_plans")
        data = op["rows"][0]["data"]
        self.assertEqual((data["task_id"], data["client_name"], data["renewal_date"]),
                         ("cu-task-99", "Acme", "2026-10-15"))
        self.assertEqual(data["data"]["status"], "renewed")
        self.assertEqual(data["data"]["goldStandard"], True)
        self.assertEqual(data["data"]["celebratedAt"], 1790208000000)
        self.assertEqual(data["data"]["callRecordingUrl"], "https://fathom.video/recording/abc")
        self.assertEqual(data["data"]["offer"]["price"], 15000.0)

    def test_media_buyer_call_briefs_preserves_overall_and_per_call_annotations(self):
        stamp = datetime.now(timezone.utc).isoformat()
        records = [
            {"_id": "brief-1", "clientName": "Acme", "key": "call:123", "status": "done",
             "overall": "Client expressed satisfaction with ROAS improvements across Meta campaigns.",
             "perCall": [
                 {"url": "https://fathom.video/calls/1", "brief": "Discussed budget pacing and new angles."},
                 {"url": "https://fathom.video/calls/2", "brief": "Reviewed creative iteration results."}
             ],
             "at": 1790208000000},
        ]
        snapshot = {"app": "media-buyer", "deployment": "test-mb", "sha256": "2" * 64,
                    "captured_at": stamp, "tables": {"clients": [{"_id": "c1", "name": "Acme"}], "callBriefs": records},
                    "table_hashes": {"clients": imp.content_hash([{"_id": "c1", "name": "Acme"}]),
                                    "callBriefs": imp.content_hash(records)}}
        targets = {"cockpit_runtime_imports": [], "cockpit_media_call_briefs": []}
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": stamp,
                     "complete_tables": list(targets), "tables": targets, "files": {}}
        plan = imp.build_plan([snapshot], inventory, ["media-buyer/callBriefs"])
        self.assertTrue(plan["scope_complete"], plan["blockers"])
        op = plan["operations"][0]
        self.assertEqual(op["target"], "cockpit_media_call_briefs")
        data = op["rows"][0]["data"]
        self.assertEqual(data["client_name"], "Acme")
        self.assertEqual(data["key"], "call:123")
        self.assertEqual(data["status"], "done")
        self.assertIn("ROAS improvements", data["overall"])
        self.assertEqual(len(data["per_call"]), 2)
        self.assertEqual(data["per_call"][0]["url"], "https://fathom.video/calls/1")
        self.assertEqual(op["rows"][0]["client_names"], ["Acme"])

        # Natural key collision
        targets["cockpit_media_call_briefs"] = [{"id": 7, "client_name": "Acme", "key": "call:123", "source_id": "other-brief", "source_deployment": "test-mb"}]
        blocked = imp.build_plan([snapshot], inventory, ["media-buyer/callBriefs"])
        self.assertFalse(blocked["scope_complete"])
        self.assertTrue(any("different source identity" in str(b) for b in blocked["blockers"]))

    def test_whatsapp_history_preserves_captures_ordered_fragments_and_draft_versions(self):
        stamp = datetime.now(timezone.utc).isoformat()
        thread_rows = [
            {
                "_id": "wat-csm-1",
                "_creationTime": 1790208000000,
                "channel": "whatsapp",
                "chatId": "chat-99",
                "clientName": "Acme",
                "contactId": "ghl-contact-1",
                "draft": "Original captured draft text",
                "draftAt": 1790208001000,
                "isGroup": False,
                "lastAt": 1790208002000,
                "lastFromUs": False,
                "name": "John Doe",
                "recent": [
                    {"at": 1790207999000, "fromMe": False, "text": "Hello there", "who": "John"},
                    {"at": 1790208002000, "fromMe": True, "text": "Hi John!", "who": "Agent"}
                ],
                "silentDays": 0,
                "source": "ghl",
                "syncedAt": 1790208003000,
                "unread": 1,
                "waitingSince": 1790208000000,
            }
        ]
        draft_rows = [
            {
                "_id": "rd-mb-1",
                "_creationTime": 1790208005000,
                "at": 1790208005000,
                "chatId": "chat-99",
                "draft": "Generated draft response",
                "jobId": "job-101",
                "lastAt": 1790208002000,
                "status": "done"
            },
            {
                "_id": "rd-mb-2",
                "_creationTime": 1790208006000,
                "at": 1790208006000,
                "chatId": "chat-unmatched",
                "draft": "Unmatched draft response",
                "jobId": "job-102",
                "lastAt": None,
                "status": "queued"
            }
        ]
        snapshot_csm = {
            "app": "client-success", "deployment": "test-csm", "sha256": "3" * 64,
            "captured_at": stamp, "tables": {"clients": [{"_id": "c1", "name": "Acme"}], "waThreads": thread_rows},
            "table_hashes": {"clients": imp.content_hash([{"_id": "c1", "name": "Acme"}]),
                            "waThreads": imp.content_hash(thread_rows)}
        }
        snapshot_mb = {
            "app": "media-buyer", "deployment": "test-mb", "sha256": "4" * 64,
            "captured_at": stamp, "tables": {"replyDrafts": draft_rows},
            "table_hashes": {"replyDrafts": imp.content_hash(draft_rows)}
        }
        targets = {
            "cockpit_runtime_imports": [],
            "cockpit_wa_thread_captures": [],
            "cockpit_wa_draft_history": [],
        }
        inventory = {"project_ref": imp.PROJECT_REF, "captured_at": stamp,
                     "complete_tables": list(targets), "tables": targets, "files": {}}
        plan = imp.build_plan([snapshot_csm, snapshot_mb], inventory, ["client-success/waThreads", "media-buyer/replyDrafts"])
        self.assertTrue(plan["scope_complete"], plan["blockers"])
        self.assertEqual(len(plan["operations"]), 2)

        op_threads = next(o for o in plan["operations"] if o["table"] == "waThreads")
        self.assertEqual(op_threads["target"], "cockpit_wa_thread_captures")
        t_data = op_threads["rows"][0]["data"]
        self.assertEqual(t_data["chat_id"], "chat-99")
        self.assertEqual(t_data["channel"], "whatsapp")
        self.assertEqual(t_data["client_name"], "Acme")
        self.assertEqual(t_data["contact_id"], "ghl-contact-1")
        self.assertEqual(t_data["source"], "ghl")
        self.assertEqual(t_data["is_group"], False)
        self.assertEqual(t_data["unread"], 1)
        self.assertEqual(t_data["last_from_us"], False)
        self.assertEqual(len(t_data["recent"]), 2)
        self.assertEqual(t_data["recent"][0]["text"], "Hello there")
        self.assertEqual(op_threads["rows"][0]["client_names"], ["Acme"])

        op_drafts = next(o for o in plan["operations"] if o["table"] == "replyDrafts")
        self.assertEqual(op_drafts["target"], "cockpit_wa_draft_history")
        d1 = op_drafts["rows"][0]["data"]
        self.assertEqual(d1["chat_id"], "chat-99")
        self.assertEqual(d1["status"], "done")
        self.assertEqual(d1["job_id"], "job-101")
        self.assertEqual(d1["draft"], "Generated draft response")
        d2 = op_drafts["rows"][1]["data"]
        self.assertEqual(d2["chat_id"], "chat-unmatched")
        self.assertEqual(d2["status"], "queued")
        self.assertEqual(d2["job_id"], "job-102")

        # Collision detection
        targets["cockpit_wa_thread_captures"] = [{"id": 10, "chat_id": "chat-99", "source_app": "client-success", "source_id": "other-t", "source_deployment": "test-csm"}]
        targets["cockpit_wa_draft_history"] = [{"id": 20, "chat_id": "chat-99", "source_app": "media-buyer", "at": d1["at"], "source_id": "other-d", "source_deployment": "test-mb"}]
        blocked = imp.build_plan([snapshot_csm, snapshot_mb], inventory, ["client-success/waThreads", "media-buyer/replyDrafts"])
        self.assertFalse(blocked["scope_complete"])
        self.assertTrue(any("thread capture has a different source identity" in str(b) for b in blocked["blockers"]))
        self.assertTrue(any("draft version has a different source identity" in str(b) for b in blocked["blockers"]))


if __name__ == "__main__":
    unittest.main()

