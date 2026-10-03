"""The summary, the AI brief, the Claude sign-in test and the CLI's catalogue."""
import io
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import timedelta
from pathlib import Path
from unittest import mock

from tests import fakes
import checks as checks_mod
import guardian
from guard import ai, report
from guard.model import fail
from guard.store import Store


def incident(tmp: Path, cid="desk-recordings"):
    check = checks_mod.by_id()[cid]
    s = Store(tmp / "state.json")
    inc = s.open_incident(check, fail("The sales desk's recordings have not run for 3 h. Call +965 5555 1234.",
                                      evidence={"detail": "token=abc123 for ali@example.com"}), fakes.NOW, "report-only")
    return s, inc, check


class Report(unittest.TestCase):
    def test_sections(self):
        tmp = Path(tempfile.mkdtemp())
        s, inc, check = incident(tmp)
        s.state["last_scan"] = {"at": fakes.NOW.isoformat(), "mode": "report-only", "results": {
            "desk-recordings": {"status": "fail", "summary": inc["detail"]},
            "live-dns": {"status": "not_deployed", "summary": "call.maharamedia.com is not deployed yet, waiting on the DNS step."},
            "webinar-objections": {"status": "paused", "summary": "Webinar objections is paused on purpose."},
            "edge-functions": {"status": "unknown", "summary": "needs SUPABASE_ACCESS_TOKEN", "coverage_gap": True},
            "site-sales": {"status": "ok", "summary": "fine"}}, "fixes": ["would start one catch-up run"]}
        text = report.build(s.state, checks_mod.by_id(), fakes.NOW + timedelta(minutes=2))
        for part in ("Broken now (1):", "Not deployed yet (not errors):", "waiting on the DNS step", "Paused on purpose:",
                     "Could not be checked (1):", "Healthy: 1 of 5 checks.", "Fixes it would make in fix mode:"):
            self.assertIn(part, text)
        self.assertNotIn("5555", text)
        self.assertNotIn("—", text)

    def test_daily_once_a_kuwait_day(self):
        st = {}
        self.assertTrue(report.daily_due(st, fakes.NOW))
        report.mark_daily(st, fakes.NOW)
        self.assertFalse(report.daily_due(st, fakes.NOW + timedelta(hours=5)))
        self.assertTrue(report.daily_due(st, fakes.NOW + timedelta(hours=12)))


class Brief(unittest.TestCase):
    def test_brief_is_self_contained_and_clean(self):
        tmp = Path(tempfile.mkdtemp())
        _, inc, check = incident(tmp)
        text = ai.brief(inc, check)
        for part in ("desk-recordings", "First classify it", "Hard limits", "Never deploy", "hermes/sales-desk/desk.py",
                     "## RUNBOOK.md", "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"):
            self.assertIn(part, text)
        for bad in ("5555", "abc123", "ali@example.com"):
            self.assertNotIn(bad, text)
        path = ai.write_brief(tmp, inc, text)
        self.assertEqual(oct(path.stat().st_mode & 0o777), "0o600")

    def test_claude_ready_reads_the_answer(self):
        def runner(answer, rc=0):
            return lambda argv, **kw: subprocess.CompletedProcess(argv, rc, answer.encode(), b"")
        self.assertTrue(ai.claude_ready(runner("ok"), binary="/usr/bin/claude")[0])
        no, why = ai.claude_ready(runner("Invalid API key. Please run /login", 1), binary="/usr/bin/claude")
        self.assertFalse(no)
        self.assertIn("not signed in", why)

    def test_ai_fix_dry_run_starts_nothing(self):
        tmp = Path(tempfile.mkdtemp())
        _, inc, check = incident(tmp)
        calls = []
        ok_, detail = ai.ai_fix(fakes.config(tmp), inc, check, dry_run=True, runner=lambda *a, **k: calls.append(a))
        self.assertTrue(ok_)
        self.assertEqual(calls, [])
        self.assertIn(f"guardian/fix-desk-recordings-{inc['id'][:8]}", detail)

    def test_ai_fix_stops_plainly_when_signed_out(self):
        tmp = Path(tempfile.mkdtemp())
        _, inc, check = incident(tmp)
        calls = []

        def runner(argv, **kw):
            calls.append(argv)
            return subprocess.CompletedProcess(argv, 1, b"Please run /login", b"")

        with mock.patch.object(ai.shutil, "which", return_value="/usr/bin/claude"):
            ok_, detail = ai.ai_fix(fakes.config(tmp, mode="fix"), inc, check, runner=runner, github_token="x")
        self.assertFalse(ok_)
        self.assertIn("not signed in", detail)
        self.assertEqual(len(calls), 1)          # the one-word question, and no clone

    def test_claude_is_never_given_deploy_or_push(self):
        for word in ("ship.sh", "vercel", "supabase", "convex", "git push", "curl", "ssh", "crontab"):
            self.assertIn(word, ai.DENIED_TOOLS)
        self.assertNotIn("push", ai.ALLOWED_TOOLS)


class Catalogue(unittest.TestCase):
    def test_every_check_is_described(self):
        for c in checks_mod.all_checks():
            for field in ("name", "means", "reads", "threshold"):
                self.assertTrue(getattr(c, field).strip(), (c.id, field))
            for text in (c.name, c.means, c.reads, c.threshold, c.action):
                self.assertNotIn("—", text, c.id)
            if c.fix:
                self.assertTrue(c.fix.describe)

    def test_cli_lists_checks(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            guardian.main(["checks"])
        self.assertIn("claude-signin [vps, high, H1]", buf.getvalue())

    def test_default_mode_is_report_only(self):
        from guard import config
        cfg = config.load(keys=config.Keys(environ={}, use_files=False), state_dir=tempfile.mkdtemp())
        self.assertEqual(cfg.mode, "report-only")
        self.assertFalse(cfg.can_fix)


if __name__ == "__main__":
    unittest.main()
