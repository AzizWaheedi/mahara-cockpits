"""Thresholds of the VPS checks: Claude, memory, disk, tunnels, crontab, logs, hung runs."""
import tempfile
import unittest
from pathlib import Path

from tests import fakes  # noqa: F401  (sets the import path)
from checks import claude_proxy, vps_cron, vps_resources
from guard.context import SourceError
from guard.model import FAIL, OK, UNKNOWN, WARN

NOW_S = int(fakes.NOW.timestamp())


def make(snap=None, tables=None, **kw):
    tmp = Path(tempfile.mkdtemp())
    return fakes.ctx(tmp, db=fakes.FakeDb(tables or {}), host=fakes.FakeHost(snap or fakes.snapshot()), **kw)


SIGNED_OUT = "The Claude sign-in on the VPS has lapsed, so nothing can be drafted. Sign Claude Code in again (run claude, then /login);"


class ClaudeSignIn(unittest.TestCase):
    def test_rows_saying_lapsed_fail_even_when_the_proxy_says_ok(self):
        tables = {"cockpit_sales_worker_status": [
            {"worker": "sales-desk", "job": "followups", "ok": False, "detail": SIGNED_OUT, "at": fakes.ago(5)},
            {"worker": "sales-desk", "job": "doctor", "ok": False, "detail": "blocked: " + SIGNED_OUT, "at": fakes.ago(9000)},
        ], "social_worker_status": [{"check_name": "captions", "ok": False, "detail": SIGNED_OUT, "checked_at": fakes.ago(1)}]}
        r = claude_proxy.run_signin(make(fakes.snapshot(salma_vps={"state": "signed out"}), tables))
        self.assertEqual(r.status, FAIL)
        self.assertIn("followups", r.summary)
        self.assertIsNotNone(r.since)  # the doctor row dates it

    def test_quiet_rows_are_ok(self):
        tables = {"cockpit_sales_worker_status": [{"worker": "sales-desk", "job": "followups", "ok": True, "detail": "3 drafted", "at": fakes.ago(5)}],
                  "social_worker_status": [{"check_name": "captions", "ok": True, "detail": None, "checked_at": fakes.ago(1)}]}
        self.assertEqual(claude_proxy.run_signin(make(None, tables)).status, OK)

    def test_nothing_readable_is_unknown_not_ok(self):
        c = make(None, {})
        c.db.down = True
        c.host.snap = RuntimeError("ssh down")
        r = claude_proxy.run_signin(c)
        self.assertEqual(r.status, UNKNOWN)

    def test_proxy_down_and_up(self):
        self.assertEqual(claude_proxy.run_proxy(make(fakes.snapshot(proxy={"http": 0, "error": "refused"}))).status, FAIL)
        self.assertEqual(claude_proxy.run_proxy(make(fakes.snapshot(proxy={"http": 200, "status": "degraded"}))).status, FAIL)
        self.assertEqual(claude_proxy.run_proxy(make()).status, OK)

    def test_proxy_on_every_address_fails(self):
        r = claude_proxy.run_exposed(make(fakes.snapshot(listen=["0.0.0.0:3456"])))
        self.assertEqual(r.status, FAIL)
        self.assertEqual(claude_proxy.run_exposed(make()).status, OK)
        self.assertEqual(claude_proxy.run_exposed(make(fakes.snapshot(listen=["0.0.0.0:22"]))).status, WARN)


class Resources(unittest.TestCase):
    def mem(self, mb):
        return fakes.snapshot(mem={"MemTotal": 16_000_000, "MemAvailable": mb * 1024, "SwapTotal": 0})

    def test_memory_thresholds(self):
        self.assertEqual(vps_resources.run_memory(make(self.mem(4000))).status, OK)
        self.assertEqual(vps_resources.run_memory(make(self.mem(1023))).status, WARN)
        r = vps_resources.run_memory(make(self.mem(699)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("no swap", r.summary)
        self.assertIn("openclaw-gateway", r.summary)

    def test_memory_check_needs_three_scans(self):
        self.assertEqual(next(c for c in vps_resources.CHECKS if c.id == "vps-memory").confirm, 3)

    def test_disk_thresholds(self):
        for pct, want in ((72.0, OK), (86.0, WARN), (91.0, FAIL)):
            self.assertEqual(vps_resources.run_disk(make(fakes.snapshot(disk={"pct": pct, "avail_gb": 5}))).status, want, pct)

    def test_big_log_on_a_fullish_disk_warns_and_asks_for_rotation(self):
        snap = fakes.snapshot(disk={"pct": 82.0, "avail_gb": 30})
        snap["files"]["~/.sales-desk.log"]["size"] = 80 * 1024 * 1024
        r = vps_resources.run_disk(make(snap))
        self.assertEqual(r.status, WARN)
        self.assertTrue(r.data["rotate"])

    def test_tunnels_rising(self):
        state = {}
        c = make(fakes.snapshot(procs={"jobs": [], "top": [], "cloudflared": {"n": 40, "rss_kb": 1, "users": {}}}), state=state)
        self.assertEqual(vps_resources.run_tunnels(c).status, OK)
        c2 = make(fakes.snapshot(procs={"jobs": [], "top": [], "cloudflared": {"n": 774, "rss_kb": 14_600_000, "users": {}}}), state=state)
        r = vps_resources.run_tunnels(c2)
        self.assertEqual(r.status, WARN)
        self.assertIn("up from 40", r.summary)

    def test_code_copy_dirty_is_a_summary_line(self):
        r = vps_resources.run_code_copy(make(fakes.snapshot(git={"head": "7545850", "date": "2026-09-19T10:00:00+00:00", "dirty": 82})))
        self.assertEqual(r.status, WARN)
        self.assertFalse(next(c for c in vps_resources.CHECKS if c.id == "vps-code-copy").alert)


class Crontab(unittest.TestCase):
    def test_all_present(self):
        self.assertEqual(vps_cron.run_crontab(make()).status, OK)

    def test_missing_line_fails_and_names_the_job(self):
        lines = [l for l in fakes.snapshot()["crontab"]["lines"] if "radar.py --quiet scan" not in l]
        r = vps_cron.run_crontab(make(fakes.snapshot(crontab={"lines": lines})))
        self.assertEqual(r.status, FAIL)
        self.assertIn("radar-scan", r.summary)
        self.assertIn("crontab.proposed", r.action)

    def test_schedule_change_warns(self):
        lines = [l.replace("7 4 * * 6", "7 5 * * 6", 1) for l in fakes.snapshot()["crontab"]["lines"]]
        self.assertEqual(vps_cron.run_crontab(make(fakes.snapshot(crontab={"lines": lines}))).status, WARN)

    def test_desk_lines_are_told_apart(self):
        from guard import jobs
        live = fakes.snapshot()["crontab"]["lines"]
        names = [jobs.job_for_line(l).name for l in live if jobs.job_for_line(l)]
        self.assertIn("editor-requests", names)
        self.assertIn("desk-requests", names)
        self.assertIn("editor-notes", names)
        self.assertIn("desk-notes", names)
        self.assertEqual(len(names), len(set(names)), names)


class Logs(unittest.TestCase):
    def test_old_log_fails_with_stale_flag(self):
        snap = fakes.snapshot()
        snap["files"]["~/.teamsync.log"]["mtime"] = NOW_S - 20 * 60
        r = vps_cron.log_check("team-sync", 15, "team-sync")(make(snap))
        self.assertEqual(r.status, FAIL)
        self.assertTrue(r.data["stale"])

    def test_fresh_log_ok_and_traceback_warns(self):
        self.assertEqual(vps_cron.log_check("eod-out", 15, "eod-out")(make()).status, OK)
        snap = fakes.snapshot()
        snap["logs"]["~/.eodout.log"] = {"tracebacks": 2, "flagged": ["KeyError: 'channel'"], "last": "x", "rotated": 0}
        self.assertEqual(vps_cron.log_check("eod-out", 15, "eod-out")(make(snap)).status, WARN)

    def test_signin_error_in_the_desk_log_is_folded(self):
        snap = fakes.snapshot()
        snap["logs"]["~/.sales-desk.log"] = {"tracebacks": 1, "flagged": [SIGNED_OUT], "last": "x", "rotated": 0}
        r = vps_cron.log_check("desk-requests", 10, "The sales desk")(make(snap))
        self.assertEqual(r.caused_by, "claude-signin")

    def test_unread_log_is_a_source_error(self):
        snap = fakes.snapshot(files={})
        with self.assertRaises(SourceError):
            vps_cron.log_check("eod-out", 15, "eod-out")(make(snap))


class Hung(unittest.TestCase):
    def test_hard_age(self):
        procs = {"jobs": [{"pid": 7, "job": "desk-recordings", "etimes": 119 * 60, "user": "hermes", "mine": True}],
                 "top": [], "cloudflared": {"n": 0}}
        self.assertEqual(vps_cron.run_hung(make(fakes.snapshot(procs=procs))).status, OK)
        procs["jobs"][0]["etimes"] = 121 * 60    # 4 x 30 min = 120 min
        self.assertEqual(vps_cron.run_hung(make(fakes.snapshot(procs=procs))).status, FAIL)

    def test_sending_job_asks_a_person_to_read_the_log(self):
        procs = {"jobs": [{"pid": 8, "job": "desk-followups", "etimes": 200 * 60, "user": "hermes", "mine": True}],
                 "top": [], "cloudflared": {"n": 0}}
        r = vps_cron.run_hung(make(fakes.snapshot(procs=procs)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("desk-followups", r.action)


if __name__ == "__main__":
    unittest.main()
