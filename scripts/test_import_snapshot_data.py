"""
Unit tests for hardened snapshot catch-up import tool.
All tests use offline zip fixtures and mock HTTP; no network or credentials used.
"""

import hashlib
import importlib.util
import json
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch

# Load module with hyphenated filename safely
SCRIPT_PATH = Path(__file__).parent / "import-snapshot-data.py"
spec = importlib.util.spec_from_file_location("import_snapshot_data", SCRIPT_PATH)
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)

FIXED_PROJECT_URL = importer.DEFAULT_PROJECT_URL


class StableMirrorTests(unittest.TestCase):
    def fixture(self):
        source = {"_id":"old-doc","syncedAt":1790000000000,"campaignName":"Campaign A","clientName":"Client A","accountName":"Account A","metaAccountId":"12345","metaCampaignId":"67890","spend7d":10}
        target = importer.mapped_mirror("cockpit_campaigns",source,"deployment")
        target.update(id=1,created_at="2026-01-01T00:00:00+00:00",updated_at="2026-01-01T00:00:00+00:00",human_notes="Keep this",client_id="existing-fk")
        incoming = {**source,"_id":"regenerated-doc","syncedAt":1790100000000,"spend7d":20}
        return source,target,incoming

    def test_regenerated_document_id_updates_same_meta_identity_and_keeps_manual_columns(self):
        _,target,source=self.fixture()
        entries,conflicts,_=importer.reconcile_mirrors("cockpit_campaigns",[source],[target],"deployment")
        self.assertEqual(conflicts,[]);self.assertEqual(entries[0]["operation"],"update")
        self.assertEqual(entries[0]["expected"]["id"],1)
        self.assertNotIn("id",entries[0]["after"]);self.assertNotIn("client_id",entries[0]["after"])
        self.assertNotIn("human_notes",entries[0]["after"])
        self.assertEqual(entries[0]["after"]["client_name"],"Client A")

    def test_legacy_client_name_bug_is_corrected_without_guessing(self):
        _,target,source=self.fixture();target["client_name"]="Campaign A"
        entries,conflicts,_=importer.reconcile_mirrors("cockpit_campaigns",[source],[target],"deployment")
        self.assertEqual(conflicts,[]);self.assertEqual(entries[0]["after"]["client_name"],"Client A")
        source.pop("clientName");self.assertEqual(importer.mapped_mirror("cockpit_campaigns",source,"deployment")["client_name"],"Account A")

    def test_new_and_updated_are_separate_and_source_json_is_preserved(self):
        _,target,source=self.fixture();new={**source,"_id":"brand-new","metaCampaignId":"99999","campaignName":"Campaign New"}
        target["raw_data"]={**target["raw_data"],"humanExtra":"retain"}
        entries,conflicts,_=importer.reconcile_mirrors("cockpit_campaigns",[source,new],[target],"deployment")
        self.assertEqual(conflicts,[]);self.assertEqual([e["operation"] for e in entries],["update","insert"])
        self.assertEqual(entries[0]["source_json"],source);self.assertEqual(entries[0]["after"]["raw_data"]["humanExtra"],"retain")

    def test_ambiguous_identity_manual_source_field_and_newer_target_are_refused(self):
        _,target,source=self.fixture()
        for targets in [[target,{**target,"id":2}],[{**target,"reason":"Human assessment"}],[{**target,"updated_at":"2029-01-01T00:00:00Z"}]]:
            entries,conflicts,_=importer.reconcile_mirrors("cockpit_campaigns",[source],targets,"deployment")
            self.assertFalse(entries);self.assertEqual(len(conflicts),1)

    def test_explicit_account_name_fallback_and_conflicting_meta_id(self):
        _,target,source=self.fixture();source.pop("metaCampaignId");target["meta_campaign_id"]=None;target["raw_data"].pop("metaCampaignId")
        entries,conflicts,_=importer.reconcile_mirrors("cockpit_campaigns",[source],[target],"deployment")
        self.assertEqual(conflicts,[]);self.assertEqual(entries[0]["identity"][0],"name")
        source["metaCampaignId"]="99999";target["meta_campaign_id"]="67890";target["raw_data"]["metaCampaignId"]="67890"
        self.assertIn("conflicts",importer.reconcile_mirrors("cockpit_campaigns",[source],[target],"deployment")[1][0]["reason"])

    def test_ads_use_stable_meta_id_and_absent_metrics_remain_missing(self):
        old={"_id":"old","syncedAt":1790000000000,"metaAdId":"11111","campaignName":"C","adName":"A"}
        target={**importer.mapped_mirror("cockpit_ads",old,"deployment"),"id":5}
        source={**old,"_id":"new","syncedAt":1790100000000}
        entries,conflicts,_=importer.reconcile_mirrors("cockpit_ads",[source],[target],"deployment")
        self.assertEqual(conflicts,[]);self.assertIsNone(entries[0]["after"]["spend"]);self.assertEqual(entries[0]["expected"]["id"],5)

    def test_complete_snapshot_explicitly_retires_absent_row_without_deleting(self):
        _,target,source=self.fixture();source={**source,"metaCampaignId":"99999","campaignName":"Other"}
        evidence={"complete":True,"exported_at":"2026-12-01T00:00:00Z","archive_sha256":"a"*64}
        entries,conflicts,_=importer.reconcile_mirrors("cockpit_campaigns",[source],[target],"deployment",snapshot_evidence=evidence)
        self.assertEqual(conflicts,[]);self.assertEqual([e["operation"] for e in entries],["insert","retire"])
        retired=entries[1];self.assertEqual(retired["expected"],target);self.assertEqual(retired["after"],{"source_deleted":True})
        self.assertEqual(retired["snapshot"]["records"],[source])

    def test_empty_partial_or_invalid_source_never_retires_and_reappearance_restores(self):
        _,target,source=self.fixture();evidence={"complete":True,"exported_at":"2026-12-01T00:00:00Z","archive_sha256":"a"*64}
        for rows,proof in [([],evidence),([{**source,"metaCampaignId":"99999","campaignName":"Other"}],None),([{"_id":"invalid"}],evidence)]:
            entries,conflicts,_=importer.reconcile_mirrors("cockpit_campaigns",rows,[target],"deployment",snapshot_evidence=proof)
            self.assertTrue(conflicts);self.assertFalse(any(e["operation"]=="retire" for e in entries))
        target.update(source_deleted=True,source_deleted_at="2026-01-01T00:00:00Z")
        entries,conflicts,_=importer.reconcile_mirrors("cockpit_campaigns",[source],[target],"deployment")
        self.assertEqual(conflicts,[]);self.assertFalse(entries[0]["after"]["source_deleted"]);self.assertIsNone(entries[0]["after"]["source_deleted_at"])

    def test_retirement_refuses_human_work_and_missing_source_fields_clear_only_owned_raw_keys(self):
        _,target,source=self.fixture();target["raw_data"].update(staleTaskName="Old name",humanExtra="Keep")
        entries,conflicts,_=importer.reconcile_mirrors("cockpit_campaigns",[source],[target],"deployment")
        self.assertEqual(conflicts,[]);self.assertNotIn("staleTaskName",entries[0]["after"]["raw_data"]);self.assertEqual(entries[0]["after"]["raw_data"]["humanExtra"],"Keep")
        source={**source,"metaCampaignId":"99999","campaignName":"Other"};target["reason"]="Human note"
        entries,conflicts,_=importer.reconcile_mirrors("cockpit_campaigns",[source],[target],"deployment",snapshot_evidence={"complete":True,"exported_at":"2026-12-01T00:00:00Z","archive_sha256":"a"*64})
        self.assertTrue(conflicts);self.assertFalse(any(e["operation"]=="retire" for e in entries))


class MockHTTPResponse:
    def __init__(self, data: bytes, code: int = 200):
        self._data = data
        self.code = code

    def read(self) -> bytes:
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass


def make_zip_fixture(entries: dict) -> Path:
    temp_dir = Path(tempfile.mkdtemp())
    zip_path = temp_dir / "fixture.zip"
    with importer.zipfile.ZipFile(zip_path, "w") as zf:
        for filename, content in entries.items():
            zf.writestr(filename, content)
    return zip_path


class MockSupabaseTarget:
    """Stateful offline Supabase target mock for testing insert and readback."""

    def __init__(self):
        self.tables = {
            "cockpit_members": [],
            "cockpit_daily_checks": [],
            "cockpit_issue_reports": [],
            "cockpit_eod_reports": [],
            "cockpit_campaigns": [],
            "cockpit_ads": [],
            "cockpit_decisions": [],
            "cockpit_client_profiles": [],
            "clients": [],
        }
        self.call_log = []
        self.corrupt_readback = False

    def handle_request(self, req):
        method = req.get_method()
        url = req.full_url
        self.call_log.append((method, url))
        parsed = urllib.parse.urlparse(url)
        table = parsed.path.split("/")[-1]
        qs = urllib.parse.parse_qs(parsed.query)

        if method == "POST":
            body = req.data.decode("utf-8")
            rows = json.loads(body)
            self.tables.setdefault(table, []).extend(rows)
            return MockHTTPResponse(json.dumps(rows).encode("utf-8"))

        if method == "GET":
            table_rows = list(self.tables.get(table, []))
            filtered = []
            for r in table_rows:
                match = True
                for k, vals in qs.items():
                    if k in ("select", "limit", "offset"):
                        continue
                    val = vals[0]
                    if val.startswith("eq."):
                        expected = val[3:]
                        if str(r.get(k, "")) != expected:
                            match = False
                            break
                if match:
                    if self.corrupt_readback:
                        corrupted_row = dict(r)
                        corrupted_row["name"] = "CORRUPTED_VALUE"
                        corrupted_row["roles"] = ["corrupted"]
                        filtered.append(corrupted_row)
                    else:
                        filtered.append(r)

            limit = int(qs.get("limit", [len(filtered) or 1000])[0])
            offset = int(qs.get("offset", [0])[0])
            page = filtered[offset : offset + limit]
            return MockHTTPResponse(json.dumps(page).encode("utf-8"))


class TestSnapshotImportTool(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.output_dir = Path(folder.name)

    def test_read_jsonl_from_zip_success(self):
        lines = [
            json.dumps({"_id": "row1", "name": "Alpha"}),
            json.dumps({"_id": "row2", "name": "Beta"}),
        ]
        content = "\n".join(lines).encode("utf-8")
        zpath = make_zip_fixture({"test_table/documents.jsonl": content})
        docs = importer.read_jsonl_from_zip(zpath, "test_table")
        self.assertEqual(len(docs), 2)
        self.assertEqual(docs[0]["_id"], "row1")
        self.assertEqual(docs[1]["name"], "Beta")

    def test_read_jsonl_from_zip_missing_table_raises(self):
        zpath = make_zip_fixture({"other_table/documents.jsonl": b""})
        with self.assertRaises(KeyError) as ctx:
            importer.read_jsonl_from_zip(zpath, "expected_table")
        self.assertIn("not found in archive", str(ctx.exception))

    def test_read_jsonl_from_zip_malformed_json_raises(self):
        bad_content = b'{"_id": "ok"}\n{bad json}\n'
        zpath = make_zip_fixture({"test_table/documents.jsonl": bad_content})
        with self.assertRaises(ValueError) as ctx:
            importer.read_jsonl_from_zip(zpath, "test_table")
        self.assertIn("Malformed JSON row", str(ctx.exception))

    def test_read_jsonl_from_zip_missing_id_raises(self):
        bad_content = json.dumps({"name": "No ID"}).encode("utf-8")
        zpath = make_zip_fixture({"test_table/documents.jsonl": bad_content})
        with self.assertRaises(ValueError) as ctx:
            importer.read_jsonl_from_zip(zpath, "test_table")
        self.assertIn("missing '_id'", str(ctx.exception))

    def test_ensure_outside_repo_enforcement_and_legitimate_paths(self):
        repo_root = Path(__file__).resolve().parent.parent
        inside_path = repo_root / "scripts" / "forbidden_plan.json"
        with self.assertRaises(ValueError) as ctx:
            importer.ensure_outside_repo(inside_path)
        self.assertIn("OUTSIDE the repository", str(ctx.exception))

        # Legitimate external path must resolve without ValueError
        outside_path = self.output_dir / "allowed_plan.json"
        res = importer.ensure_outside_repo(outside_path)
        self.assertEqual(res, outside_path.resolve())

    def test_project_url_binding_and_rejection(self):
        # Bound URL must pass
        valid_url = importer.validate_project_url(FIXED_PROJECT_URL)
        self.assertEqual(valid_url, FIXED_PROJECT_URL)

        # Wrong project URL must be rejected
        with self.assertRaises(ValueError) as ctx:
            importer.validate_project_url("https://otherproject.supabase.co")
        self.assertIn("strictly bound to Creative Triage fixed", str(ctx.exception))

        # Apply must reject mismatch between plan project URL and apply project URL
        plan_path = self.output_dir / "plan_proj_mismatch.json"
        dummy_zip = make_zip_fixture({"members/documents.jsonl": b""})
        dummy_zip_sha = importer.compute_sha256(dummy_zip)
        plan_data = {
            "format_version": "1.0",
            "project_url": "https://mismatched-stored.supabase.co",
            "source_hashes": {"media_buyer": {"path": str(dummy_zip), "sha256": dummy_zip_sha}},
            "planned_inserts": {},
        }
        plan_bytes = json.dumps(plan_data, indent=2, sort_keys=True).encode("utf-8")
        plan_path.write_bytes(plan_bytes)
        plan_sha = hashlib.sha256(plan_bytes).hexdigest()

        with self.assertRaises(ValueError) as ctx:
            importer.apply_snapshot_catchup(
                plan_path=plan_path,
                expected_plan_sha=plan_sha,
                project_url=FIXED_PROJECT_URL,
                service_key="test-key",
            )
        self.assertIn("Project URL mismatch", str(ctx.exception))

    def test_paginated_fetch_beyond_5000(self):
        page1 = [{"id": i} for i in range(1000)]
        page2 = [{"id": i} for i in range(1000, 2000)]
        page3 = [{"id": 2000}]

        responses = [
            MockHTTPResponse(json.dumps(page1).encode("utf-8")),
            MockHTTPResponse(json.dumps(page2).encode("utf-8")),
            MockHTTPResponse(json.dumps(page3).encode("utf-8")),
        ]

        with patch("urllib.request.urlopen", side_effect=responses) as mock_urlopen:
            records = importer.fetch_rest_paginated(
                project_url=FIXED_PROJECT_URL,
                headers={"apikey": "test"},
                table="cockpit_daily_checks",
                page_size=1000,
            )
            self.assertEqual(len(records), 2001)
            self.assertEqual(mock_urlopen.call_count, 3)

    def test_post_rest_insert_headers_no_merge_duplicates(self):
        captured_requests = []

        def capture_urlopen(req):
            captured_requests.append(req)
            return MockHTTPResponse(b"[]")

        with patch("urllib.request.urlopen", side_effect=capture_urlopen):
            importer.post_rest_insert(
                project_url=FIXED_PROJECT_URL,
                headers={"apikey": "k", "Authorization": "Bearer k"},
                table="cockpit_members",
                rows=[{"email": "test@example.com"}],
                return_representation=False,
            )

        self.assertEqual(len(captured_requests), 1)
        req = captured_requests[0]
        self.assertNotIn("on_conflict", req.full_url)
        self.assertNotIn("resolution=merge-duplicates", req.headers.get("Prefer", ""))
        self.assertEqual(req.headers.get("Prefer"), "return=minimal")

    def test_plan_reports_unmapped_and_refuses_full_migration(self):
        mb_entries = {
            "members/documents.jsonl": json.dumps({"_id": "m1", "email": "a@x.com"}).encode("utf-8"),
            "checks/documents.jsonl": json.dumps({"_id": "c1", "checkKey": "chk"}).encode("utf-8"),
            "feedback/documents.jsonl": json.dumps({"_id": "f1"}).encode("utf-8"),
            "eodReports/documents.jsonl": json.dumps({"_id": "e1"}).encode("utf-8"),
            "campaigns/documents.jsonl": json.dumps({"_id": "cp1"}).encode("utf-8"),
            "ads/documents.jsonl": json.dumps({"_id": "ad1"}).encode("utf-8"),
            "decisions/documents.jsonl": json.dumps({"_id": "d1"}).encode("utf-8"),
            "unmapped_extra/documents.jsonl": json.dumps({"_id": "u1"}).encode("utf-8"),
        }
        cs_entries = {
            "checks/documents.jsonl": json.dumps({"_id": "c2"}).encode("utf-8"),
            "feedback/documents.jsonl": json.dumps({"_id": "f2"}).encode("utf-8"),
            "decisions/documents.jsonl": json.dumps({"_id": "d2"}).encode("utf-8"),
            "clientProfiles/documents.jsonl": json.dumps({"_id": "cp1", "clientName": "Acme"}).encode("utf-8"),
        }
        cd_entries = {
            "creativeRequests/documents.jsonl": json.dumps({"_id": "cr1"}).encode("utf-8"),
        }

        mb_zip = make_zip_fixture(mb_entries)
        cs_zip = make_zip_fixture(cs_entries)
        cd_zip = make_zip_fixture(cd_entries)
        plan_out = self.output_dir / "test_plan_output.json"

        with patch("urllib.request.urlopen", return_value=MockHTTPResponse(b"[]")):
            plan_data, plan_sha, saved_path = importer.plan_snapshot_catchup(
                mb_zip=mb_zip,
                cs_zip=cs_zip,
                cd_zip=cd_zip,
                snapshot_ts="2026-09-23T00:00:00Z",
                mb_dep="adorable-seahorse-418",
                cs_dep="impressive-dinosaur-375",
                cd_dep="colorful-wombat-644",
                project_url=FIXED_PROJECT_URL,
                service_key="test-key",
                plan_path=plan_out,
            )

        cov = plan_data["coverage"]
        self.assertFalse(cov["full_migration_supported"])
        self.assertIn("Refuse unsupported partial coverage", cov["refusal_reason"])
        self.assertIn("unmapped_extra", cov["archives"]["media_buyer"]["unmapped_tables"])
        self.assertIn("creativeRequests", cov["archives"]["creative_director"]["unmapped_tables"])
        self.assertTrue(plan_out.is_file())
        self.assertEqual(hashlib.sha256(plan_out.read_bytes()).hexdigest(), plan_sha)

    def test_add_only_preserves_human_checkboxes(self):
        existing_check = {
            "source_deployment": "adorable-seahorse-418",
            "source_id": "chk1",
            "role": "media_buyer",
            "day": "2026-09-23",
            "check_key": "ad_spend_review",
            "done": True,
            "done_at": "2026-09-23T10:00:00Z",
        }
        mb_entries = {
            "members/documents.jsonl": b"",
            "checks/documents.jsonl": json.dumps(
                {
                    "_id": "chk1",
                    "role": "media_buyer",
                    "day": "2026-09-23",
                    "checkKey": "ad_spend_review",
                    "done": False,  # Snapshot has False, but human checked True in Supabase
                }
            ).encode("utf-8"),
            "feedback/documents.jsonl": b"",
            "eodReports/documents.jsonl": b"",
            "campaigns/documents.jsonl": b"",
            "ads/documents.jsonl": b"",
            "decisions/documents.jsonl": b"",
        }
        cs_entries = {
            "checks/documents.jsonl": b"",
            "feedback/documents.jsonl": b"",
            "decisions/documents.jsonl": b"",
            "clientProfiles/documents.jsonl": b"",
        }
        cd_entries = {}

        mb_zip = make_zip_fixture(mb_entries)
        cs_zip = make_zip_fixture(cs_entries)
        cd_zip = make_zip_fixture(cd_entries)
        plan_out = self.output_dir / "test_checks_plan.json"

        def mock_fetch(url, **kwargs):
            if "cockpit_daily_checks" in url.full_url:
                return MockHTTPResponse(json.dumps([existing_check]).encode("utf-8"))
            return MockHTTPResponse(b"[]")

        with patch("urllib.request.urlopen", side_effect=mock_fetch):
            plan_data, _, _ = importer.plan_snapshot_catchup(
                mb_zip=mb_zip,
                cs_zip=cs_zip,
                cd_zip=cd_zip,
                snapshot_ts="2026-09-23T00:00:00Z",
                mb_dep="adorable-seahorse-418",
                cs_dep="impressive-dinosaur-375",
                cd_dep="colorful-wombat-644",
                project_url=FIXED_PROJECT_URL,
                service_key="test-key",
                plan_path=plan_out,
            )

        # Existing human checkbox record must NOT be scheduled for insert
        self.assertEqual(len(plan_data["planned_inserts"]["cockpit_daily_checks"]), 0)

    def test_apply_validates_plan_sha_and_source_hashes(self):
        plan_path = self.output_dir / "valid_plan.json"
        dummy_zip = make_zip_fixture({"members/documents.jsonl": b""})
        dummy_zip_sha = importer.compute_sha256(dummy_zip)

        plan_data = {
            "format_version": "1.0",
            "project_url": FIXED_PROJECT_URL,
            "source_hashes": {"media_buyer": {"path": str(dummy_zip), "sha256": dummy_zip_sha}},
            "planned_inserts": {
                "cockpit_members": [{"email": "test@domain.com", "name": "Test", "roles": [], "clients": [], "active": True}],
                "cockpit_daily_checks": [],
                "cockpit_issue_reports": [],
                "cockpit_eod_reports": [],
                "cockpit_campaigns": [],
                "cockpit_ads": [],
                "cockpit_decisions": [],
                "cockpit_client_profiles": [],
            },
        }
        plan_bytes = json.dumps(plan_data, indent=2, sort_keys=True).encode("utf-8")
        correct_sha = hashlib.sha256(plan_bytes).hexdigest()
        plan_path.write_bytes(plan_bytes)

        # Test plan SHA mismatch
        with self.assertRaises(ValueError) as ctx:
            importer.apply_snapshot_catchup(
                plan_path=plan_path,
                expected_plan_sha="wrong-sha",
                project_url=FIXED_PROJECT_URL,
                service_key="key",
            )
        self.assertIn("Plan SHA mismatch", str(ctx.exception))

        # Test source hash mismatch
        plan_data_bad_src = dict(plan_data)
        plan_data_bad_src["source_hashes"] = {
            "media_buyer": {"path": str(dummy_zip), "sha256": "wrong-source-sha"}
        }
        bad_src_bytes = json.dumps(plan_data_bad_src, indent=2, sort_keys=True).encode("utf-8")
        bad_src_sha = hashlib.sha256(bad_src_bytes).hexdigest()
        plan_path.write_bytes(bad_src_bytes)

        with self.assertRaises(ValueError) as ctx:
            importer.apply_snapshot_catchup(
                plan_path=plan_path,
                expected_plan_sha=bad_src_sha,
                project_url=FIXED_PROJECT_URL,
                service_key="key",
            )
        self.assertIn("Source archive hash mismatch", str(ctx.exception))

    def test_apply_rejects_pre_apply_target_conflict(self):
        plan_path = self.output_dir / "conflict_plan.json"
        dummy_zip = make_zip_fixture({"members/documents.jsonl": b""})
        dummy_zip_sha = importer.compute_sha256(dummy_zip)

        plan_data = {
            "format_version": "1.0",
            "project_url": FIXED_PROJECT_URL,
            "source_hashes": {"media_buyer": {"path": str(dummy_zip), "sha256": dummy_zip_sha}},
            "planned_inserts": {
                "cockpit_members": [{"email": "existing@test.com", "name": "Existing", "roles": [], "clients": [], "active": True}],
                "cockpit_daily_checks": [],
                "cockpit_issue_reports": [],
                "cockpit_eod_reports": [],
                "cockpit_campaigns": [],
                "cockpit_ads": [],
                "cockpit_decisions": [],
                "cockpit_client_profiles": [],
            },
        }
        plan_bytes = json.dumps(plan_data, indent=2, sort_keys=True).encode("utf-8")
        correct_sha = hashlib.sha256(plan_bytes).hexdigest()
        plan_path.write_bytes(plan_bytes)

        # Target already has the member during pre-apply check
        mock_target = MockSupabaseTarget()
        mock_target.tables["cockpit_members"] = [{"email": "existing@test.com"}]

        with patch("urllib.request.urlopen", side_effect=mock_target.handle_request):
            with self.assertRaises(RuntimeError) as ctx:
                importer.apply_snapshot_catchup(
                    plan_path=plan_path,
                    expected_plan_sha=correct_sha,
                    project_url=FIXED_PROJECT_URL,
                    service_key="key",
                )
        self.assertIn("Conflict detected during pre-apply target recheck", str(ctx.exception))

    def test_apply_canary_and_full_readback_verification(self):
        plan_path = self.output_dir / "full_apply_plan.json"
        dummy_zip = make_zip_fixture({"members/documents.jsonl": b""})
        dummy_zip_sha = importer.compute_sha256(dummy_zip)

        planned_row_1 = {
            "email": "canary@test.com",
            "name": "Canary User",
            "roles": ["media_buyer"],
            "clients": [],
            "active": True,
        }
        planned_row_2 = {
            "email": "second@test.com",
            "name": "Second User",
            "roles": ["csm"],
            "clients": [],
            "active": True,
        }

        plan_data = {
            "format_version": "1.0",
            "project_url": FIXED_PROJECT_URL,
            "source_hashes": {"media_buyer": {"path": str(dummy_zip), "sha256": dummy_zip_sha}},
            "planned_inserts": {
                "cockpit_members": [planned_row_1, planned_row_2],
                "cockpit_daily_checks": [],
                "cockpit_issue_reports": [],
                "cockpit_eod_reports": [],
                "cockpit_campaigns": [],
                "cockpit_ads": [],
                "cockpit_decisions": [],
                "cockpit_client_profiles": [],
            },
        }
        plan_bytes = json.dumps(plan_data, indent=2, sort_keys=True).encode("utf-8")
        correct_sha = hashlib.sha256(plan_bytes).hexdigest()
        plan_path.write_bytes(plan_bytes)

        # Stateful mock ensures target is empty before POST, and contains row on readback
        mock_target = MockSupabaseTarget()

        with patch("urllib.request.urlopen", side_effect=mock_target.handle_request):
            res = importer.apply_snapshot_catchup(
                plan_path=plan_path,
                expected_plan_sha=correct_sha,
                project_url=FIXED_PROJECT_URL,
                service_key="key",
            )

        self.assertEqual(res["status"], "APPLY_COMPLETED")
        self.assertEqual(res["inserted_summary"]["cockpit_members"], 2)
        # Ensure all rows were added to the target table and read back
        self.assertEqual(len(mock_target.tables["cockpit_members"]), 2)

    def test_apply_corrupted_readback_reports_partial_apply(self):
        plan_path = self.output_dir / "corrupted_readback_plan.json"
        dummy_zip = make_zip_fixture({"members/documents.jsonl": b""})
        dummy_zip_sha = importer.compute_sha256(dummy_zip)

        planned_row = {
            "email": "canary@test.com",
            "name": "Original Name",
            "roles": ["media_buyer"],
            "clients": [],
            "active": True,
        }

        plan_data = {
            "format_version": "1.0",
            "project_url": FIXED_PROJECT_URL,
            "source_hashes": {"media_buyer": {"path": str(dummy_zip), "sha256": dummy_zip_sha}},
            "planned_inserts": {
                "cockpit_members": [planned_row],
                "cockpit_daily_checks": [],
                "cockpit_issue_reports": [],
                "cockpit_eod_reports": [],
                "cockpit_campaigns": [],
                "cockpit_ads": [],
                "cockpit_decisions": [],
                "cockpit_client_profiles": [],
            },
        }
        plan_bytes = json.dumps(plan_data, indent=2, sort_keys=True).encode("utf-8")
        correct_sha = hashlib.sha256(plan_bytes).hexdigest()
        plan_path.write_bytes(plan_bytes)

        # Mock that returns corrupted data upon GET readback
        mock_target = MockSupabaseTarget()
        mock_target.corrupt_readback = True

        with patch("urllib.request.urlopen", side_effect=mock_target.handle_request):
            with self.assertRaises(RuntimeError) as ctx:
                importer.apply_snapshot_catchup(
                    plan_path=plan_path,
                    expected_plan_sha=correct_sha,
                    project_url=FIXED_PROJECT_URL,
                    service_key="key",
                )
        self.assertIn("PARTIAL APPLY FAILURE", str(ctx.exception))
        self.assertIn("Value mismatch for 'name'", str(ctx.exception))

    def test_normalization_helpers(self):
        # Timestamp normalization: ISO with Z vs +00:00
        self.assertTrue(importer.values_match("2026-09-23T00:00:00Z", "2026-09-23T00:00:00+00:00"))
        # Numeric normalization: float vs int
        self.assertTrue(importer.values_match(100, 100.0))
        self.assertTrue(importer.values_match(0, "0.0"))
        # Dict equivalence
        self.assertTrue(importer.values_match({"a": 1, "b": 2}, {"b": 2, "a": 1}))


if __name__ == "__main__":
    unittest.main()
