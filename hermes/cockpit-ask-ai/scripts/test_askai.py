#!/usr/bin/env python3
"""Offline unit and integration tests for hermes/cockpit-ask-ai/scripts/askai.py.

Verifies:
  - Default DRY_RUN = True with zero network mutation side-effects
  - Explicit apply opt-in via --apply or ASKAI_APPLY=1
  - Doctor configuration checks without secret exposure (configured booleans only)
  - Fail-closed behavior with NO Convex fallback
  - Dedicated cockpit_ask_ai_jobs queue and lease token contracts
  - Rejection of stale completions, empty results, and missing lease tokens
"""
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import MagicMock, patch

import askai


class TestAskAiWorker(unittest.TestCase):
    def setUp(self):
        self.orig_env = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.orig_env)

    def test_doctor_checks_config_without_exposing_secrets(self):
        secret_key = "super-secret-service-role-key-998877"
        os.environ["COCKPIT_SUPABASE_URL"] = "https://bldgtotkfmhoxmlzowdx.supabase.co"
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = secret_key

        out = io.StringIO()
        with redirect_stdout(out):
            code = askai.main(["doctor"])

        self.assertEqual(code, 0)
        output = out.getvalue()
        # Ensure secret is NEVER exposed in stdout (not even prefix or suffix)
        self.assertNotIn(secret_key, output)
        self.assertNotIn("998877", output)
        parsed = json.loads(output)
        self.assertEqual(parsed["status"], "healthy")
        self.assertEqual(parsed["queue_table"], "public.cockpit_ask_ai_jobs")
        self.assertEqual(parsed["convex_fallback"], "disabled (fail-closed)")
        self.assertEqual(parsed["supabase_service_key"], {"configured": True})
        self.assertEqual(parsed["supabase_url"]["configured"], True)

    def test_doctor_reports_misconfigured_when_keys_missing(self):
        for k in list(os.environ.keys()):
            if "SUPABASE" in k:
                del os.environ[k]

        out = io.StringIO()
        with redirect_stdout(out):
            code = askai.main(["doctor"])

        self.assertEqual(code, 1)
        parsed = json.loads(out.getvalue())
        self.assertEqual(parsed["status"], "misconfigured")
        self.assertEqual(parsed["supabase_service_key"], {"configured": False})

    def test_fail_closed_no_convex_fallback(self):
        # Clear all Supabase credentials
        for k in list(os.environ.keys()):
            if "SUPABASE" in k:
                del os.environ[k]

        out = io.StringIO()
        err = io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = askai.main(["pending"])

        self.assertEqual(code, 1)
        err_output = err.getvalue()
        self.assertIn("Convex fallback is disabled", err_output)
        self.assertNotIn("adorable-seahorse-418", err_output)
        self.assertNotIn("impressive-dinosaur-375", err_output)

    @patch("askai.call")
    def test_dry_run_default_no_mutation_side_effects(self, mock_call):
        os.environ["COCKPIT_SUPABASE_URL"] = "https://bldgtotkfmhoxmlzowdx.supabase.co"
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "mock-secret-key-1234567890"

        # Mock query return for dry-run inspection
        mock_call.return_value = [
            {"id": "job-1", "prompt": "Ad copy prompt", "status": "queued"}
        ]

        out = io.StringIO()
        with redirect_stdout(out):
            code = askai.main(["pending"])

        self.assertEqual(code, 0)
        parsed = json.loads(out.getvalue())
        self.assertEqual(parsed["mode"], "dry-run")
        self.assertIn("candidate_jobs", parsed)

        # In dry run, call was GET for inspection, NEVER a POST/PATCH mutating claim
        mock_call.assert_called_once()
        args, _ = mock_call.call_args
        self.assertIn("cockpit_ask_ai_jobs", args[0])
        self.assertNotIn("rpc/cockpit_claim_ask_ai_jobs", args[0])

    @patch("askai.call")
    def test_apply_opt_in_calls_atomic_claim_rpc(self, mock_call):
        os.environ["COCKPIT_SUPABASE_URL"] = "https://bldgtotkfmhoxmlzowdx.supabase.co"
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "mock-secret-key-1234567890"

        mock_call.return_value = [
            {"id": "job-1", "lease_token": "token-xyz", "attempts": 1}
        ]

        out = io.StringIO()
        with redirect_stdout(out):
            code = askai.main(["pending", "--apply", "--worker-id", "worker-test-1"])

        self.assertEqual(code, 0)
        mock_call.assert_called_once()
        url, key, body = mock_call.call_args[0][:3]
        self.assertIn("rpc/cockpit_claim_ask_ai_jobs", url)
        self.assertEqual(body["p_worker_id"], "worker-test-1")

    def test_dry_run_result_does_not_mutate_db(self):
        os.environ["COCKPIT_SUPABASE_URL"] = "https://bldgtotkfmhoxmlzowdx.supabase.co"
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "mock-secret-key-1234567890"

        with tempfile.NamedTemporaryFile("w+", suffix=".json", delete=False) as f:
            json.dump({"variants": [{"headline": "Test headline"}]}, f)
            temp_path = f.name

        try:
            out = io.StringIO()
            with redirect_stdout(out):
                code = askai.main(["result", "job-123", temp_path])

            self.assertEqual(code, 0)
            parsed = json.loads(out.getvalue())
            self.assertEqual(parsed["mode"], "dry-run")
            self.assertEqual(parsed["job_id"], "job-123")
            self.assertIn("variants", parsed["result_preview"])
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    @patch("askai.call")
    def test_apply_result_requires_lease_token_and_calls_complete_rpc(self, mock_call):
        os.environ["COCKPIT_SUPABASE_URL"] = "https://bldgtotkfmhoxmlzowdx.supabase.co"
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "mock-secret-key-1234567890"
        mock_call.return_value = True

        with tempfile.NamedTemporaryFile("w+", suffix=".json", delete=False) as f:
            json.dump({"answer": "Good copy"}, f)
            temp_path = f.name

        try:
            out = io.StringIO()
            with redirect_stdout(out):
                code = askai.main([
                    "result", "job-123", temp_path,
                    "--lease", "lease-token-abc",
                    "--apply",
                ])

            self.assertEqual(code, 0)
            mock_call.assert_called_once()
            url, _, body = mock_call.call_args[0][:3]
            self.assertIn("rpc/cockpit_complete_ask_ai_job", url)
            self.assertEqual(body["p_job_id"], "job-123")
            self.assertEqual(body["p_lease_token"], "lease-token-abc")
            self.assertEqual(body["p_result"], {"answer": "Good copy"})
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    def test_apply_result_rejects_missing_lease(self):
        os.environ["COCKPIT_SUPABASE_URL"] = "https://bldgtotkfmhoxmlzowdx.supabase.co"
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "mock-secret-key-1234567890"

        with tempfile.NamedTemporaryFile("w+", suffix=".json", delete=False) as f:
            json.dump({"answer": "Good copy"}, f)
            temp_path = f.name

        try:
            err = io.StringIO()
            with redirect_stderr(err):
                code = askai.main([
                    "result", "job-123", temp_path,
                    "--apply",
                ])

            self.assertEqual(code, 2)
            self.assertIn("Missing required --lease flag", err.getvalue())
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    def test_apply_result_rejects_empty_data(self):
        os.environ["COCKPIT_SUPABASE_URL"] = "https://bldgtotkfmhoxmlzowdx.supabase.co"
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "mock-secret-key-1234567890"

        with tempfile.NamedTemporaryFile("w+", suffix=".json", delete=False) as f:
            json.dump({}, f)
            temp_path = f.name

        try:
            err = io.StringIO()
            with redirect_stderr(err):
                code = askai.main([
                    "result", "job-123", temp_path,
                    "--lease", "token-123",
                    "--apply",
                ])

            self.assertEqual(code, 2)
            self.assertIn("Result data cannot be empty", err.getvalue())
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    @patch("askai.call")
    def test_apply_result_rpc_failure_returns_nonzero(self, mock_call):
        os.environ["COCKPIT_SUPABASE_URL"] = "https://bldgtotkfmhoxmlzowdx.supabase.co"
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "mock-secret-key-1234567890"
        mock_call.return_value = {"ok": False, "error": "Stale lease or token mismatch"}

        with tempfile.NamedTemporaryFile("w+", suffix=".json", delete=False) as f:
            json.dump({"answer": "Sample"}, f)
            temp_path = f.name

        try:
            err = io.StringIO()
            with redirect_stderr(err):
                code = askai.main([
                    "result", "job-123", temp_path,
                    "--lease", "stale-lease-token",
                    "--apply",
                ])

            self.assertEqual(code, 1)
            self.assertIn("Completion rejected", err.getvalue())
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    @patch("askai.call")
    def test_apply_fail_requires_lease_and_calls_fail_rpc(self, mock_call):
        os.environ["COCKPIT_SUPABASE_URL"] = "https://bldgtotkfmhoxmlzowdx.supabase.co"
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "mock-secret-key-1234567890"
        mock_call.return_value = True

        out = io.StringIO()
        with redirect_stdout(out):
            code = askai.main([
                "fail", "job-123", "Model rate limit exceeded",
                "--lease", "token-fail-1",
                "--apply",
            ])

        self.assertEqual(code, 0)
        mock_call.assert_called_once()
        url, _, body = mock_call.call_args[0][:3]
        self.assertIn("rpc/cockpit_fail_ask_ai_job", url)
        self.assertEqual(body["p_job_id"], "job-123")
        self.assertEqual(body["p_lease_token"], "token-fail-1")
        self.assertEqual(body["p_error"], "Model rate limit exceeded")

    def test_apply_fail_rejects_missing_lease(self):
        os.environ["COCKPIT_SUPABASE_URL"] = "https://bldgtotkfmhoxmlzowdx.supabase.co"
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "mock-secret-key-1234567890"

        err = io.StringIO()
        with redirect_stderr(err):
            code = askai.main([
                "fail", "job-123", "Some reason",
                "--apply",
            ])

        self.assertEqual(code, 2)
        self.assertIn("Missing required --lease flag", err.getvalue())


    @patch("askai.call")
    def test_environment_cannot_enable_writes_and_explicit_dry_run_wins(self, mock_call):
        os.environ.update(COCKPIT_SUPABASE_URL="https://example.invalid", SUPABASE_SERVICE_ROLE_KEY="fixture", ASKAI_APPLY="1")
        mock_call.return_value = []
        for args in (["claim"], ["claim", "--apply", "--dry-run"]):
            with redirect_stdout(io.StringIO()):
                self.assertEqual(askai.main(args), 0)
            self.assertNotIn("rpc/", mock_call.call_args.args[0])

    @patch("askai.call")
    def test_failed_reads_and_health_are_not_empty_success(self, mock_call):
        os.environ.update(COCKPIT_SUPABASE_URL="https://example.invalid", SUPABASE_SERVICE_ROLE_KEY="fixture")
        mock_call.return_value = {"ok": False, "error": "Unavailable"}
        for args in (["pending"], ["claim", "--apply"], ["health"]):
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(askai.main(args), 1)
        mock_call.reset_mock()
        with redirect_stderr(io.StringIO()):
            self.assertEqual(askai.main(["profile", "other-client"]), 2)
        mock_call.assert_not_called()

    @patch("askai.call")
    def test_success_shaped_object_is_not_a_completion_receipt(self, mock_call):
        os.environ.update(COCKPIT_SUPABASE_URL="https://example.invalid", SUPABASE_SERVICE_ROLE_KEY="fixture")
        for result in ({"ok": True}, {}, False):
            mock_call.return_value = result
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(askai.main(["fail", "fixture-job", "Temporary", "--lease", "original-token", "--apply"]), 1)


if __name__ == "__main__":
    unittest.main()
