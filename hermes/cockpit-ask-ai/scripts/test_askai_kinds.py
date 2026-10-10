#!/usr/bin/env python3
"""Offline tests for the two background kinds in askai.py: comment_digest and call_brief.

Verifies:
  - claims ask for every supported kind and attach each background job's answer contract
  - a database without the kind-aware claim still answers chat (no other fallback)
  - result --kind checks the answer strictly before any network call, and posts the trimmed answer
  - an unknown --kind, a wrong shape or an extra key fails closed with exit code 2
  - chat results without --kind behave exactly as before
"""
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

import askai

DIGEST = {
    "summary": "  They agreed to a new villa offer.  ",
    "nextSteps": ["Mahara: send the script", "   "],
    "clientRequests": ["A villa video"],
    "risks": [],
    "forAds": ["Target villa owners in Kuwait City"],
    "forCreative": ["Film the showroom"],
    "dos": ["Show finished villas"],
    "donts": ["Don't promise prices"],
}
BRIEF = {
    "overall": "Acme is happy with the leads and wants a villa video.",
    "perCall": [{"url": "https://fathom.video/share/a1", "brief": " They asked for a villa video. "}],
}


class TestBackgroundKinds(unittest.TestCase):
    def setUp(self):
        self.orig_env = dict(os.environ)
        os.environ.update(COCKPIT_SUPABASE_URL="https://example.invalid", SUPABASE_SERVICE_ROLE_KEY="fixture-service-key-123456")
        self.paths = []

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.orig_env)
        for path in self.paths:
            if os.path.exists(path):
                os.remove(path)

    def answer_file(self, data):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump(data, f)
            self.paths.append(f.name)
            return f.name

    def run_main(self, args):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = askai.main(args)
        return code, out.getvalue(), err.getvalue()

    # --- contracts -------------------------------------------------------------

    def test_digest_contract_trims_and_drops_blank_lines(self):
        clean = askai.validate_result("comment_digest", DIGEST)
        self.assertEqual(clean["summary"], "They agreed to a new villa offer.")
        self.assertEqual(clean["nextSteps"], ["Mahara: send the script"])
        self.assertEqual(set(clean), set(DIGEST))

    def test_digest_contract_rejects_missing_extra_and_wrong_types(self):
        bad = [
            {k: v for k, v in DIGEST.items() if k != "donts"},
            {**DIGEST, "reply": "extra"},
            {**DIGEST, "risks": "late payment"},
            {**DIGEST, "forAds": [42]},
            {**DIGEST, "summary": None},
            {**DIGEST, "summary": "x" * 2001},
            {**DIGEST, "dos": ["rule"] * 21},
            ["not", "an", "object"],
        ]
        for data in bad:
            with self.assertRaises(ValueError, msg=json.dumps(data)[:80]):
                askai.validate_result("comment_digest", data)

    def test_brief_contract_requires_overall_and_exact_per_call_items(self):
        clean = askai.validate_result("call_brief", BRIEF)
        self.assertEqual(clean["perCall"][0]["brief"], "They asked for a villa video.")
        bad = [
            {**BRIEF, "overall": "   "},
            {"overall": "Fine"},
            {**BRIEF, "perCall": [{"url": "https://fathom.video/share/a1"}]},
            {**BRIEF, "perCall": [{"url": "u", "brief": "b", "note": "extra"}]},
            {**BRIEF, "perCall": [{"url": "u", "brief": "one"}, {"url": "u", "brief": "two"}]},
            {**BRIEF, "perCall": {"url": "u", "brief": "b"}},
        ]
        for data in bad:
            with self.assertRaises(ValueError, msg=json.dumps(data)[:80]):
                askai.validate_result("call_brief", data)
        with self.assertRaises(ValueError):
            askai.validate_result("chat", {"reply": "Hi"})

    # --- claim -----------------------------------------------------------------

    @patch("askai.call")
    def test_claim_asks_for_every_kind_and_attaches_contracts(self, mock_call):
        mock_call.return_value = [
            {"id": "job-chat", "kind": "chat", "lease_token": "t1"},
            {"id": "job-digest", "kind": "comment_digest", "lease_token": "t2", "prompt": "Digest this"},
            {"id": "job-brief", "kind": "call_brief", "lease_token": "t3", "prompt": "Brief these"},
        ]
        code, out, _ = self.run_main(["claim", "--apply", "--worker-id", "w1"])
        self.assertEqual(code, 0)
        mock_call.assert_called_once()
        url, _, body = mock_call.call_args[0][:3]
        self.assertIn("rpc/cockpit_claim_ask_ai_jobs", url)
        self.assertEqual(body["p_kinds"], ["chat", "comment_digest", "call_brief"])
        jobs = {j["id"]: j for j in json.loads(out)}
        self.assertNotIn("answer_with", jobs["job-chat"])
        digest = jobs["job-digest"]["answer_with"]
        self.assertEqual(digest["kind"], "comment_digest")
        self.assertEqual(digest["schema"]["required"], ["summary", *askai.DIGEST_LISTS])
        self.assertIn("result job-digest <answer.json> --kind comment_digest", digest["command"])
        self.assertIn("--lease <lease_token> --apply", digest["command"])
        self.assertEqual(jobs["job-brief"]["answer_with"]["schema"]["required"], ["overall", "perCall"])

    @patch("askai.call")
    def test_claim_without_the_kind_aware_function_still_answers_chat(self, mock_call):
        mock_call.side_effect = [
            {"ok": False, "http": 404, "error": {"code": "PGRST202"}},
            [{"id": "job-chat", "kind": "chat", "lease_token": "t1"}],
        ]
        code, out, _ = self.run_main(["claim", "--apply"])
        self.assertEqual(code, 0)
        self.assertEqual(mock_call.call_count, 2)
        self.assertNotIn("p_kinds", mock_call.call_args_list[1][0][2])
        self.assertIn("rpc/cockpit_claim_ask_ai_jobs", mock_call.call_args_list[1][0][0])
        self.assertEqual(json.loads(out)[0]["id"], "job-chat")

    @patch("askai.call")
    def test_claim_other_errors_do_not_retry(self, mock_call):
        mock_call.return_value = {"ok": False, "http": 500, "error": "boom"}
        code, _, err = self.run_main(["claim", "--apply"])
        self.assertEqual(code, 1)
        mock_call.assert_called_once()
        self.assertIn("Claim not confirmed", err)

    @patch("askai.call")
    def test_dry_run_pending_shows_contracts_without_claiming(self, mock_call):
        mock_call.return_value = [{"id": "job-digest", "kind": "comment_digest", "status": "queued"}]
        code, out, _ = self.run_main(["pending"])
        self.assertEqual(code, 0)
        self.assertNotIn("rpc/", mock_call.call_args[0][0])
        self.assertEqual(json.loads(out)["candidate_jobs"][0]["answer_with"]["kind"], "comment_digest")

    # --- result ----------------------------------------------------------------

    @patch("askai.call")
    def test_result_with_kind_posts_the_trimmed_answer(self, mock_call):
        mock_call.return_value = True
        path = self.answer_file(DIGEST)
        code, out, _ = self.run_main(["result", "job-digest", path, "--kind", "comment_digest", "--lease", "lease-1", "--worker-id", "w1", "--apply"])
        self.assertEqual(code, 0)
        url, _, body = mock_call.call_args[0][:3]
        self.assertIn("rpc/cockpit_complete_ask_ai_job", url)
        self.assertEqual(body["p_job_id"], "job-digest")
        self.assertEqual(body["p_lease_token"], "lease-1")
        self.assertEqual(body["p_worker_id"], "w1")
        self.assertEqual(body["p_result"], askai.validate_result("comment_digest", DIGEST))
        self.assertEqual(json.loads(out)["status"], "completed")

    @patch("askai.call")
    def test_result_with_kind_rejects_a_bad_answer_before_any_call(self, mock_call):
        for kind, data in (("comment_digest", {"reply": "Not a digest"}), ("call_brief", {**BRIEF, "overall": ""})):
            path = self.answer_file(data)
            code, _, err = self.run_main(["result", "job-1", path, f"--kind={kind}", "--lease", "lease-1", "--apply"])
            self.assertEqual(code, 2)
            self.assertIn(f"The {kind} answer does not match its contract", err)
        mock_call.assert_not_called()

    @patch("askai.call")
    def test_unknown_kind_fails_closed(self, mock_call):
        path = self.answer_file(BRIEF)
        code, _, err = self.run_main(["result", "job-1", path, "--kind", "draft_copy", "--lease", "lease-1", "--apply"])
        self.assertEqual(code, 2)
        self.assertIn("Unknown --kind draft_copy", err)
        mock_call.assert_not_called()

    @patch("askai.call")
    def test_dry_run_result_with_kind_previews_the_checked_answer(self, mock_call):
        path = self.answer_file(BRIEF)
        code, out, _ = self.run_main(["result", "job-brief", path, "--kind", "call_brief"])
        self.assertEqual(code, 0)
        preview = json.loads(out)
        self.assertEqual(preview["mode"], "dry-run")
        self.assertEqual(preview["result_preview"]["perCall"][0]["brief"], "They asked for a villa video.")
        mock_call.assert_not_called()

    @patch("askai.call")
    def test_chat_result_without_kind_is_unchanged(self, mock_call):
        mock_call.return_value = True
        path = self.answer_file({"reply": "  Acme is on track.  "})
        code, _, _ = self.run_main(["result", "job-chat", path, "--lease", "lease-1", "--apply"])
        self.assertEqual(code, 0)
        self.assertEqual(mock_call.call_args[0][2]["p_result"], {"reply": "  Acme is on track.  "})

    @patch("askai.call")
    def test_server_rejection_of_a_background_answer_is_not_success(self, mock_call):
        mock_call.return_value = {"ok": False, "http": 400, "error": {"message": "Invalid call_brief answer: perCall names a call that is not in this job."}}
        path = self.answer_file(BRIEF)
        code, _, err = self.run_main(["result", "job-brief", path, "--kind", "call_brief", "--lease", "lease-1", "--apply"])
        self.assertEqual(code, 1)
        self.assertIn("not in this job", err)

    def test_doctor_names_the_supported_kinds_without_secrets(self):
        code, out, _ = self.run_main(["doctor"])
        self.assertEqual(code, 0)
        report = json.loads(out)
        self.assertEqual(report["supported_kinds"], ["chat", "comment_digest", "call_brief"])
        self.assertNotIn("fixture-service-key", out)


if __name__ == "__main__":
    unittest.main()
