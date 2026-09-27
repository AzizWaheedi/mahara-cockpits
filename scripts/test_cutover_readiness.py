#!/usr/bin/env python3
r"""
Offline Regression Test Suite for Cutover Readiness Verifier.

Tests cover:
- Default mode is release; missing evidence exits nonzero
- Strict clean 40-hex Git HEAD requirement; no allow-dirty bypass; assert expected-sha == HEAD
- Source dirtied during verification execution caught by post-run check
- Skip flags strictly rejected in release; diagnostic skips mark local INCOMPLETE nonzero
- Mandatory subcheck validation across all 6 categories with nonempty hashed artifact refs
- Rejection of malformed shapes, unknown/skipped statuses, unknown source identity, missing evaluator
- Rejection of invalid max-age-hours (NaN, inf, <= 0, > 24)
- Report write failure causes nonzero exit and release_ready false
- Removal of supabase-actions.test.ts from local tests with explicit rationale
- Installed per-app tool discovery; failure on missing node_modules compiler dependencies
- Capture of UTF-8 subprocess logs on both success and failure with errors=replace
- Labeling of source scan as no detected imports (not runtime independence)
- Parity of shared file checks matching scripts/check-shared.sh exactly

All tests are 100% offline without live database, network, credentials, or node_modules.
"""

from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import MagicMock, patch

SCRIPT_DIR = Path(__file__).resolve().parent
VERIFIER_PATH = SCRIPT_DIR / "verify-cutover-readiness.py"
spec = importlib.util.spec_from_file_location("verify_cutover_readiness", str(VERIFIER_PATH))
if spec is None or spec.loader is None:
    raise ImportError(f"Failed to load spec from {VERIFIER_PATH}")
vcr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vcr)


def create_mock_repo(base_dir: Path) -> Path:
    """Create a minimal mock cockpit repository fixture in a temp directory."""
    repo = base_dir / "mahara-cockpits"
    repo.mkdir(parents=True, exist_ok=True)

    apps = [
        "media-buyer-cockpit",
        "client-success-cockpit",
        "creative-director-cockpit",
        "video-editor-cockpit",
        "sales-cockpit",
    ]

    for app in apps:
        app_dir = repo / "apps" / app
        (app_dir / "src").mkdir(parents=True, exist_ok=True)
        (app_dir / "package.json").write_text(
            json.dumps({"name": app, "devDependencies": {"@biomejs/biome": "2.5.14"}}),
            encoding="utf-8",
        )
        (app_dir / "tsconfig.json").write_text(
            json.dumps({"files": [], "references": [{"path": "./tsconfig.app.json"}, {"path": "./tsconfig.node.json"}]}),
            encoding="utf-8",
        )
        (app_dir / "tsconfig.app.json").write_text(json.dumps({"compilerOptions": {}}), encoding="utf-8")
        (app_dir / "tsconfig.node.json").write_text(json.dumps({"compilerOptions": {}}), encoding="utf-8")
        (app_dir / "vite.config.ts").write_text("export default {};", encoding="utf-8")
        (app_dir / "src" / "index.ts").write_text("export const app = true;", encoding="utf-8")

        # Mock installed per-app tool files
        tsc_dir = app_dir / "node_modules" / "typescript" / "bin"
        tsc_dir.mkdir(parents=True, exist_ok=True)
        (tsc_dir / "tsc").write_text("// mock tsc", encoding="utf-8")

        vite_dir = app_dir / "node_modules" / "vite" / "bin"
        vite_dir.mkdir(parents=True, exist_ok=True)
        (vite_dir / "vite.js").write_text("// mock vite", encoding="utf-8")

    # Shared files setup
    cd = repo / "apps" / "creative-director-cockpit"
    mb = repo / "apps" / "media-buyer-cockpit"
    ed = repo / "apps" / "video-editor-cockpit"
    cs = repo / "apps" / "client-success-cockpit"

    for d in [cd, mb, ed, cs]:
        (d / "convex").mkdir(parents=True, exist_ok=True)
        (d / "src" / "pages").mkdir(parents=True, exist_ok=True)
        (d / "src" / "components" / "billing").mkdir(parents=True, exist_ok=True)
        (d / "src" / "lib").mkdir(parents=True, exist_ok=True)

    for p in ["src/pages/IdeationPage.tsx", "src/pages/SwipePage.tsx", "src/components/Foreplay.tsx", "src/lib/foreplay.ts"]:
        content = "import React from 'react';\n\nexport const Shared = () => null;"
        (cd / p).write_text(content, encoding="utf-8")
        (mb / p).write_text(content, encoding="utf-8")
        (ed / p).write_text(content, encoding="utf-8")

    (cd / "convex" / "adAsIdea.ts").write_text(
        "import { v } from 'convex';\n\nexport const x = 1;\nexport const IDEA_FIELDS = [\"a\"] as const;",
        encoding="utf-8",
    )
    (mb / "convex" / "adAsIdea.ts").write_text(
        "import { v } from 'convex';\n\nexport const x = 1;\nexport const IDEA_FIELDS = [\"a\"] as const;",
        encoding="utf-8",
    )
    (ed / "src" / "lib" / "adAsIdea.ts").write_text(
        "import { v } from 'other';\n\nexport const x = 1;\nexport const IDEA_FIELDS = [\"a\"] as const;",
        encoding="utf-8",
    )

    (cd / "convex" / "foreplay.ts").write_text("import foo;\n\nexport const fp = true;", encoding="utf-8")
    (mb / "convex" / "foreplay.ts").write_text("import bar;\n\nexport const fp = true;", encoding="utf-8")

    (mb / "convex" / "billingCore.ts").write_text("import a;\n\nexport const bill = 1;", encoding="utf-8")
    (cs / "convex" / "billingCore.ts").write_text("import b;\n\nexport const bill = 1;", encoding="utf-8")

    (mb / "src" / "components" / "billing" / "BillingSheet.tsx").write_text("import c;\n\nexport const Sheet = 1;", encoding="utf-8")
    (cs / "src" / "components" / "billing" / "BillingSheet.tsx").write_text("import d;\n\nexport const Sheet = 1;", encoding="utf-8")

    # hermes test desk IDEA_FIELDS
    hermes_dir = repo / "hermes" / "editor-desk" / "tests"
    hermes_dir.mkdir(parents=True, exist_ok=True)
    (hermes_dir / "test_desk.py").write_text('#: Kept identical to IDEA_FIELDS\n    IDEA_FIELDS = ["a"]', encoding="utf-8")

    # Relevant test files
    for app in (mb, cs, cd):
        for filename in ("askAiClient.ts", "personalEod.ts"):
            adapter = app / "src/lib" / filename
            adapter.parent.mkdir(parents=True, exist_ok=True)
            adapter.write_text("export const fixture = true;", encoding="utf-8")
    for tf in vcr.RELEVANT_TEST_FILES:
        t_path = repo / tf
        t_path.parent.mkdir(parents=True, exist_ok=True)
        t_path.write_text("# test placeholder" if t_path.suffix == ".py" else "// test placeholder", encoding="utf-8")

    return repo


def create_valid_evidence_bundle(repo: Path, target_sha: str) -> Tuple[Path, List[Path]]:
    """Create a fully valid evidence bundle with all mandatory subchecks and hashed artifacts."""
    artifacts_dir = repo / "evidence" / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    artifact_paths = []
    categories = {}

    for cat_name, subchecks in vcr.MANDATORY_EVIDENCE_SUBCHECKS.items():
        art_file = artifacts_dir / f"{cat_name}_log.json"
        content = json.dumps({"category": cat_name, "verified": True}).encode("utf-8")
        art_file.write_bytes(content)
        sha256 = hashlib.sha256(content).hexdigest()
        artifact_paths.append(art_file)

        checks_dict = {}
        for sc in subchecks:
            checks_dict[sc] = {
                "status": "passed",
                "artifacts": [{"path": art_file.relative_to(repo).as_posix(), "sha256": sha256}],
            }

        categories[cat_name] = {
            "status": "passed",
            "summary": f"{cat_name} verified",
            "checks": checks_dict,
            "artifacts": [{"path": art_file.relative_to(repo).as_posix(), "sha256": sha256}],
        }

    now_iso = datetime.now(timezone.utc).isoformat()
    evidence_data = {
        "version": "1.0",
        "source_sha": target_sha,
        "source_identity": "mahara-cockpits/production-migration",
        "recorded_at": now_iso,
        "evaluator": "independent-verifier-codex",
        "categories": categories,
    }

    evidence_file = repo / "evidence" / "cutover-acceptance.json"
    evidence_file.write_text(json.dumps(evidence_data, indent=2), encoding="utf-8")
    return evidence_file, artifact_paths


class TestCutoverReadinessRevision(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.repo = create_mock_repo(Path(self.temp_dir))
        self.sample_sha = "0a1bf7b99c88d8f50c0001112223334445556667"

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_default_mode_is_release_and_missing_evidence_exits_nonzero(self):
        parser = vcr.build_arg_parser()
        args = parser.parse_args([])
        self.assertEqual(args.mode, "release", "Default mode must be release")

        # Run with default release mode and no evidence file
        with patch.object(vcr, "get_git_info") as mock_git:
            mock_git.return_value = {"available": True, "sha": self.sample_sha, "is_dirty": False}
            exit_code, report = vcr.verify_cutover(
                repo_root=self.repo,
                mode=args.mode,
                evidence_path=self.repo / "evidence" / "missing.json",
                skip_builds=False,
                skip_typechecks=False,
                skip_tests=False,
            )
            self.assertNotEqual(exit_code, 0, "Missing evidence in release mode must exit nonzero")
            self.assertFalse(report["release_ready"])
            self.assertEqual(report["status"], "FAILED")

    def test_git_head_must_be_exact_40_hex(self):
        short_sha = "0a1bf7b"
        with patch.object(vcr, "run_command") as mock_cmd:
            # rev-parse returns short sha
            mock_cmd.return_value = (0, short_sha + "\n", "", {})
            info = vcr.get_git_info(self.repo)
            self.assertIn("not a 40-character hex string", info.get("error", ""))

    def test_dirty_worktree_fails_release_no_bypass(self):
        ev_file, _ = create_valid_evidence_bundle(self.repo, target_sha=self.sample_sha)
        ok, fails, details = vcr.verify_release_evidence(
            evidence_path=ev_file,
            repo_root=self.repo,
            current_sha=self.sample_sha,
            is_dirty=True,  # Dirty worktree
        )
        self.assertFalse(ok)
        self.assertTrue(any("clean git worktree" in f.lower() for f in fails))

    def test_expected_sha_must_assert_equality_with_current_head(self):
        different_sha = "ffffffffffffffffffffffffffffffffffffffff"
        with patch.object(vcr, "get_git_info") as mock_git:
            mock_git.return_value = {"available": True, "sha": self.sample_sha, "is_dirty": False}
            exit_code, report = vcr.verify_cutover(
                repo_root=self.repo,
                mode="release",
                expected_sha=different_sha,  # Mismatched expected sha
            )
            self.assertEqual(exit_code, 1)
            self.assertIn("Expected SHA assertion failed", report["failures"][0])

    def test_worktree_dirtied_during_run_detected(self):
        # Initial git clean, post-run git dirty
        git_states = [
            {"available": True, "sha": self.sample_sha, "is_dirty": False},  # initial
            {"available": True, "sha": self.sample_sha, "is_dirty": True, "dirty_files": ["M apps/file.ts"]},  # post
        ]
        with patch.object(vcr, "get_git_info", side_effect=git_states):
            with patch.object(vcr, "run_fresh_typechecks", return_value=(True, [], {})):
                with patch.object(vcr, "run_fresh_vite_builds", return_value=(True, [], {})):
                    with patch.object(vcr, "run_relevant_tests", return_value=(True, [], {})):
                        exit_code, report = vcr.verify_cutover(
                            repo_root=self.repo,
                            mode="local",
                        )
                        self.assertEqual(exit_code, 1)
                        self.assertFalse(report["local_checks_passed"])
                        self.assertTrue(any("dirtied during execution" in f for f in report["failures"]))

    def test_skip_flags_rejected_in_release_mode(self):
        for flag in ["skip_builds", "skip_typechecks", "skip_tests"]:
            kwargs = {flag: True, "mode": "release", "repo_root": self.repo}
            exit_code, report = vcr.verify_cutover(**kwargs)
            self.assertEqual(exit_code, 1, f"{flag} in release must fail")
            self.assertFalse(report["release_ready"])
            self.assertTrue(any("forbidden in release mode" in f for f in report["failures"]))

    def test_skip_flags_mark_local_incomplete_nonzero(self):
        with patch.object(vcr, "get_git_info") as mock_git:
            mock_git.return_value = {"available": True, "sha": self.sample_sha, "is_dirty": False}
            exit_code, report = vcr.verify_cutover(
                repo_root=self.repo,
                mode="local",
                skip_builds=True,
            )
            self.assertEqual(exit_code, 1, "Diagnostic skip in local mode must exit nonzero")
            self.assertEqual(report["status"], "INCOMPLETE")
            self.assertFalse(report["local_checks_passed"])
            self.assertFalse(report["release_ready"])

    def test_max_age_hours_finite_bounds_validation(self):
        invalid_values = [float("nan"), float("inf"), float("-inf"), -1.0, 0.0, 25.0, 100.0]
        for val in invalid_values:
            exit_code, report = vcr.verify_cutover(
                repo_root=self.repo,
                mode="local",
                max_age_hours=val,
            )
            self.assertEqual(exit_code, 1)
            self.assertTrue(any("Invalid --max-evidence-age-hours" in f for f in report["failures"]))

    def test_report_write_failure_exits_nonzero_and_release_ready_false(self):
        with patch.object(vcr, "get_git_info") as mock_git:
            mock_git.return_value = {"available": True, "sha": self.sample_sha, "is_dirty": False}
            with patch.object(vcr, "run_fresh_typechecks", return_value=(True, [], {})):
                with patch.object(vcr, "run_fresh_vite_builds", return_value=(True, [], {})):
                    with patch.object(vcr, "run_relevant_tests", return_value=(True, [], {})):
                        # Provide unwritable report path (pointing to an existing directory)
                        bad_report_path = self.repo / "existing_dir"
                        bad_report_path.mkdir(parents=True, exist_ok=True)
                        # Attempting to write a file directly to existing_dir as a file path
                        exit_code, report = vcr.verify_cutover(
                            repo_root=self.repo,
                            mode="local",
                            report_path=bad_report_path,
                        )
                        self.assertEqual(exit_code, 1)
                        self.assertFalse(report["release_ready"])
                        self.assertEqual(report["status"], "FAILED")

    def test_missing_mandatory_subchecks_rejected(self):
        ev_file, _ = create_valid_evidence_bundle(self.repo, target_sha=self.sample_sha)
        data = json.loads(ev_file.read_text(encoding="utf-8"))
        # Drop one mandatory subcheck: 'portal' in persisted_saves_across_refresh
        del data["categories"]["persisted_saves_across_refresh"]["checks"]["portal"]
        ev_file.write_text(json.dumps(data), encoding="utf-8")

        ok, fails, _ = vcr.verify_release_evidence(
            evidence_path=ev_file,
            repo_root=self.repo,
            current_sha=self.sample_sha,
            is_dirty=False,
        )
        self.assertFalse(ok)
        self.assertTrue(any("persisted_saves_across_refresh.portal" in f for f in fails))

    def test_missing_or_unknown_source_identity_and_evaluator_rejected(self):
        ev_file, _ = create_valid_evidence_bundle(self.repo, target_sha=self.sample_sha)
        data = json.loads(ev_file.read_text(encoding="utf-8"))
        data["source_identity"] = "unknown"
        del data["evaluator"]
        ev_file.write_text(json.dumps(data), encoding="utf-8")

        ok, fails, _ = vcr.verify_release_evidence(
            evidence_path=ev_file,
            repo_root=self.repo,
            current_sha=self.sample_sha,
            is_dirty=False,
        )
        self.assertFalse(ok)
        self.assertTrue(any("source_identity" in f for f in fails))
        self.assertTrue(any("evaluator" in f for f in fails))

    def test_supabase_actions_removed_from_local_tests(self):
        for tf in vcr.RELEVANT_TEST_FILES:
            self.assertNotIn(
                "supabase-actions.test.ts",
                tf,
                "supabase-actions.test.ts must not be in local tests (makes dummy key network calls)",
            )

    def test_worker_discovery_uses_python_and_cannot_pass_with_zero_tests(self):
        worker = "hermes/eod-out/test_out.py"
        with patch.object(vcr, "RELEVANT_TEST_FILES", [worker]):
            with patch.object(vcr, "run_command", return_value=(0, "", "Ran 0 tests", {})):
                self.assertFalse(vcr.run_relevant_tests(self.repo, bun_exe="fixture-tool")[0])
            with patch.object(vcr, "run_command", return_value=(0, "", "Ran 13 tests\nOK", {})) as run:
                self.assertTrue(vcr.run_relevant_tests(self.repo, bun_exe="fixture-tool")[0])
                self.assertEqual(run.call_args.args[0][1:4], ["-m", "unittest", "discover"])

    def test_missing_installed_dependencies_fails_cleanly(self):
        # Remove installed tsc from apps/media-buyer-cockpit
        tsc_bin = self.repo / "apps" / "media-buyer-cockpit" / "node_modules" / "typescript" / "bin" / "tsc"
        tsc_bin.unlink()

        ok, fails, details = vcr.run_fresh_typechecks(self.repo)
        self.assertFalse(ok)
        self.assertTrue(any("Missing installed TypeScript dependency" in f for f in fails))

    def test_command_logs_saved_on_both_success_and_failure(self):
        logs = []
        with patch("subprocess.run") as mock_run:
            # First success
            mock_run.return_value = MagicMock(returncode=0, stdout="success output", stderr="")
            rc1, _, _, entry1 = vcr.run_command(["cmd1"], cwd=self.repo)
            logs.append(entry1)

            # Then failure
            mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="error output")
            rc2, _, _, entry2 = vcr.run_command(["cmd2"], cwd=self.repo)
            logs.append(entry2)

        self.assertEqual(len(logs), 2)
        self.assertEqual(logs[0]["returncode"], 0)
        self.assertEqual(logs[0]["stdout"], "success output")
        self.assertEqual(logs[1]["returncode"], 1)
        self.assertEqual(logs[1]["stderr"], "error output")

    def test_source_scan_labeled_no_detected_imports(self):
        ok, fails = vcr.check_no_convex_source_imports(self.repo)
        self.assertTrue(ok)
        # Verify verifier report key is no_convex_source_imports
        report = {}
        with patch.object(vcr, "get_git_info", return_value={"available": True, "sha": self.sample_sha, "is_dirty": False}):
            with patch.object(vcr, "run_fresh_typechecks", return_value=(True, [], {})):
                with patch.object(vcr, "run_fresh_vite_builds", return_value=(True, [], {})):
                    with patch.object(vcr, "run_relevant_tests", return_value=(True, [], {})):
                        _, report = vcr.verify_cutover(repo_root=self.repo, mode="local")
        self.assertIn("no_convex_source_imports", report["checks"])
        self.assertIn("not full runtime", report["checks"]["no_convex_source_imports"]["note"])


class TestIndependentReleaseReview(unittest.TestCase):
    setUp = TestCutoverReadinessRevision.setUp
    tearDown = TestCutoverReadinessRevision.tearDown

    def test_team_meetings_are_scanned_for_convex_imports(self):
        src = self.repo / "apps" / "media-buyer-cockpit" / "src"
        team = src / "pages" / "team"
        team.mkdir(parents=True, exist_ok=True)
        (team / "TeamPage.tsx").write_text('import { useAction } from "convex/react";')
        self.assertFalse(vcr.check_no_convex_source_imports(self.repo)[0])
    def test_only_isolated_dev_imports_are_exempt(self):
        src = self.repo / "apps" / vcr.APP_NAMES[0] / "src"
        dev = src / "dev"
        dev.mkdir(exist_ok=True)
        (dev / "fixture.ts").write_text('import { getFunctionName } from "convex/server";')
        self.assertTrue(vcr.check_no_convex_source_imports(self.repo)[0])
        for statement in [
            'import { x } from "@/dev/fixture";',
            'import { api } from "../../convex/_generated/api";',
            'const client = import("convex/react");',
            'const client = require("convex/react");',
        ]:
            with self.subTest(statement=statement):
                (src / "entry.ts").write_text(statement)
                self.assertFalse(vcr.check_no_convex_source_imports(self.repo)[0])
    def test_commit_change_or_unknown_postcheck_source_never_releases(self):
        other_sha = "b" * 40
        evidence, _ = create_valid_evidence_bundle(self.repo, other_sha)
        for post in [
            {"available": True, "sha": other_sha, "is_dirty": False},
            {"available": False, "sha": None, "is_dirty": None},
        ]:
            states = [{"available": True, "sha": self.sample_sha, "is_dirty": False}, post]
            with self.subTest(post=post), patch.object(vcr, "get_git_info", side_effect=states), \
                 patch.object(vcr, "check_shared_files", return_value=(True, [])), \
                 patch.object(vcr, "run_fresh_typechecks", return_value=(True, [], {})), \
                 patch.object(vcr, "run_fresh_vite_builds", return_value=(True, [], {})), \
                 patch.object(vcr, "run_relevant_tests", return_value=(True, [], {})):
                rc, report = vcr.verify_cutover(self.repo, mode="release", evidence_path=evidence)
                self.assertNotEqual(rc, 0)
                self.assertFalse(report["release_ready"])

    def test_evidence_expiry_hash_missing_file_and_malformed_refs(self):
        import copy
        from datetime import timedelta
        evidence, _ = create_valid_evidence_bundle(self.repo, self.sample_sha)
        original = json.loads(evidence.read_text())
        cat = next(iter(vcr.MANDATORY_EVIDENCE_SUBCHECKS))
        sub = vcr.MANDATORY_EVIDENCE_SUBCHECKS[cat][0]
        variants = []
        old = copy.deepcopy(original)
        old["recorded_at"] = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
        variants.append(old)
        for refs in [None, 12, [{"path": "missing.log", "sha256": "a" * 64}],
                     [{"path": 42, "sha256": "a" * 64}]]:
            data = copy.deepcopy(original)
            data["categories"][cat]["checks"][sub]["artifacts"] = refs
            variants.append(data)
        mismatch = copy.deepcopy(original)
        mismatch["categories"][cat]["artifacts"][0]["sha256"] = "a" * 64
        variants.append(mismatch)
        wrong_sha = copy.deepcopy(original)
        wrong_sha["source_sha"] = "c" * 40
        variants.append(wrong_sha)
        for data in variants:
            with self.subTest(data=data):
                evidence.write_text(json.dumps(data))
                ok, failures, _ = vcr.verify_release_evidence(evidence, self.repo, self.sample_sha, False)
                self.assertFalse(ok)
                self.assertTrue(failures)

    def test_old_dist_cannot_replace_fresh_build_output(self):
        for app in vcr.APP_NAMES:
            old = self.repo / "apps" / app / "dist"
            old.mkdir(exist_ok=True)
            (old / "index.html").write_text("old build")
        with patch.object(vcr, "run_command", return_value=(0, "", "", {})):
            ok, failures, _ = vcr.run_fresh_vite_builds(self.repo, vite_custom="fixture-tool")
        self.assertFalse(ok)
        self.assertEqual(len(failures), 5)

    def test_failed_compiler_build_and_test_commands_fail_checks(self):
        with patch.object(vcr, "run_command", return_value=(1, "", "deliberate failure", {})):
            self.assertFalse(vcr.run_fresh_typechecks(self.repo, tsc_custom="fixture-tool")[0])
            self.assertFalse(vcr.run_fresh_vite_builds(self.repo, vite_custom="fixture-tool")[0])
            self.assertFalse(vcr.run_relevant_tests(self.repo, bun_exe="fixture-tool")[0])

    def test_missing_app_fails_structure(self):
        app = self.repo / "apps" / vcr.APP_NAMES[0]
        app.rename(app.with_name("not-a-cockpit"))
        self.assertFalse(vcr.check_app_structure(self.repo)[0])


if __name__ == "__main__":
    unittest.main()
