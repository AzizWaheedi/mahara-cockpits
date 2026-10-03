"""Each safe fix does only what the catalogue allows."""
import gzip
import os
import signal
import tempfile
import unittest
from pathlib import Path

from tests import fakes
from guard import fixes, jobs
from guard.host import HostError
from guard.model import FAIL, OK, Result, fail


def ok_result(inc):
    return Result(OK, "", data={"incident": inc})

NOW_S = int(fakes.NOW.timestamp())


def make(snap=None, *, remote=False, db=None, tmp=None):
    tmp = tmp or Path(tempfile.mkdtemp())
    host = fakes.FakeHost(snap or fakes.snapshot(), remote=remote, home=str(tmp))
    return fakes.ctx(tmp, db=db or fakes.FakeDb(), host=host, mode="fix", remote=remote)


STALE = Result(FAIL, "late", data={"stale": True})


class CatchUp(unittest.TestCase):
    def test_runs_the_exact_cron_command_under_its_flock(self):
        c = make()
        out = fixes.catch_up("desk-recordings").apply(c, STALE)
        self.assertTrue(out.ok, out.detail)
        cmd = c.host.spawned[0]
        self.assertTrue(cmd.startswith("flock -n $HOME/.sales-desk/recordings.lock"))
        self.assertIn("python3 desk.py --quiet recordings", cmd)
        self.assertIn(">> $HOME/.sales-desk.log", cmd)

    def test_a_failing_job_is_not_re_run(self):
        c = make()
        out = fixes.catch_up("desk-recordings").apply(c, fail("Fathom 401"))
        self.assertFalse(out.ok)
        self.assertEqual(c.host.spawned, [])

    def test_no_cron_line_no_run(self):
        lines = [l for l in fakes.snapshot()["crontab"]["lines"] if "recordings" not in l]
        c = make(fakes.snapshot(crontab={"lines": lines}))
        self.assertFalse(fixes.catch_up("desk-recordings").apply(c, STALE).ok)
        self.assertEqual(c.host.spawned, [])

    def test_never_for_jobs_that_send_call_a_model_or_spend(self):
        for name in ("desk-followups", "eod-out", "salma", "radar-scan", "hala", "desk-requests"):
            with self.assertRaises(ValueError, msg=name):
                fixes.catch_up(name)
        self.assertEqual(set(jobs.COPY_JOBS), {"editor-sync", "editor-meetings", "review-import", "team-sync", "webinar-pull",
                                               "desk-recordings", "desk-calls-vault", "desk-maqsam-calls"})

    def test_refuses_off_the_box(self):
        with self.assertRaises(RuntimeError):
            fixes.catch_up("team-sync").apply(make(remote=True), STALE)


class StopHung(unittest.TestCase):
    def setUp(self):
        self.grace = fixes.HUNG_GRACE_S
        fixes.HUNG_GRACE_S = 0

    def tearDown(self):
        fixes.HUNG_GRACE_S = self.grace

    def procs(self, *rows):
        return fakes.snapshot(procs={"jobs": list(rows), "top": [], "cloudflared": {"n": 0}})

    @staticmethod
    def run_(c, rows, *, stuck_for=20):
        """The check noted these runs' CPU time `stuck_for` minutes ago and it has not moved."""
        hung = fixes.hung_runs(rows)
        fixes.track_cpu(c.state, hung, fakes.NOW - fakes.timedelta(minutes=stuck_for))
        stuck = fixes.track_cpu(c.state, hung, fakes.NOW)
        return fixes.STOP_HUNG.apply(c, fail("hung", data={"stuck": stuck}))

    def test_term_then_kill_only_stuck_copy_cron_runs_of_our_own(self):
        rows = [{"pid": 11, "job": "desk-recordings", "etimes": 7300, "mine": True, "flock": True, "start": 500, "cpu": 40},
                {"pid": 12, "job": "desk-followups", "etimes": 99999, "mine": True, "flock": True, "start": 501, "cpu": 9},
                {"pid": 13, "job": "team-sync", "etimes": 99999, "mine": False, "flock": True, "start": 502, "cpu": 9}]
        c = make(self.procs(*rows))
        c.host.alive_pids = {11}
        c.host.stats = {11: (500, 40)}
        out = self.run_(c, rows)
        self.assertTrue(out.ok, out.detail)
        self.assertEqual(c.host.killed, [(11, signal.SIGTERM), (11, signal.SIGKILL)])

    def test_young_runs_are_left(self):
        rows = [{"pid": 11, "job": "desk-recordings", "etimes": 7100, "mine": True, "flock": True, "start": 5, "cpu": 1}]
        c = make(self.procs(*rows))
        self.assertFalse(self.run_(c, rows).ok)
        self.assertEqual(c.host.killed, [])


class Rotate(unittest.TestCase):
    def test_rotate_keeps_every_line_and_at_most_five_copies(self):
        tmp = Path(tempfile.mkdtemp())
        log = tmp / ".sales-desk.log"
        log.write_text("line one\nline two\n")
        self.assertIn("rotated", fixes.rotate_file(log, "20261003140000"))
        self.assertEqual(log.read_text(), "")
        with gzip.open(tmp / ".sales-desk.log.20261003140000.gz", "rt") as fh:
            self.assertEqual(fh.read(), "line one\nline two\n")
        for i in range(4):
            log.write_text("more\n")
            fixes.rotate_file(log, f"2026100314000{i + 1}")
        log.write_text("sixth\n")
        self.assertIn("left as it is", fixes.rotate_file(log, "20261003150000"))
        self.assertEqual(log.read_text(), "sixth\n")
        self.assertEqual(len(list(tmp.glob("*.gz"))), 5)

    def test_only_when_the_disk_is_over_80(self):
        c = make(fakes.snapshot(disk={"pct": 75.0}))
        self.assertFalse(fixes.ROTATE_LOGS.apply(c, fail("x")).ok)

    def test_rotates_big_hermes_logs(self):
        tmp = Path(tempfile.mkdtemp())
        (tmp / ".teamsync.log").write_text("x" * 100)
        snap = fakes.snapshot(disk={"pct": 91.0})
        snap["files"]["~/.teamsync.log"]["size"] = 60 * 1024 * 1024
        out = fixes.ROTATE_LOGS.apply(make(snap, tmp=tmp), fail("disk"))
        self.assertTrue(out.ok, out.detail)
        self.assertEqual(len(list(tmp.glob(".teamsync.log.*.gz"))), 1)


class Tighten(unittest.TestCase):
    def test_chmod_600_only_hermes_files(self):
        tmp = Path(tempfile.mkdtemp())
        (tmp / ".editor-desk").mkdir()
        env = tmp / ".editor-desk" / "env"
        env.write_text("A=1\n")
        os.chmod(env, 0o644)
        snap = fakes.snapshot()
        snap["files"]["~/.editor-desk/env"]["mode"] = "644"
        snap["files"]["/opt/data/.cockpit-worker/env"].update(mode="644", owner="muhammed")
        out = fixes.TIGHTEN_ENV.apply(make(snap, tmp=tmp), fail("loose"))
        self.assertTrue(out.ok, out.detail)
        self.assertEqual(oct(env.stat().st_mode & 0o777), "0o600")
        self.assertNotIn("cockpit-worker", out.detail)


class CrontabProposal(unittest.TestCase):
    def test_writes_the_proposal_and_never_installs(self):
        lines = [l for l in fakes.snapshot()["crontab"]["lines"] if "radar.py --quiet scan" not in l and "pending" not in l]
        tmp = Path(tempfile.mkdtemp())
        c = make(fakes.snapshot(crontab={"lines": lines}), tmp=tmp)
        out = fixes.CRONTAB_PROPOSAL.apply(c, fail("lost lines"))
        self.assertTrue(out.ok, out.detail)
        proposed = (tmp / "crontab.proposed").read_text()
        self.assertIn("radar.py --quiet scan", proposed)
        self.assertIn("radar.py --quiet pending", proposed)
        self.assertIn("+7 4 * * 6", (tmp / "crontab.diff").read_text())
        self.assertEqual(c.host.ran, [["crontab", "-l"]])     # read the live one, never `crontab <file>`
        self.assertIn("nothing was installed", out.detail)


class RadarResend(unittest.TestCase):
    def test_radar_resend_reuses_the_scan_line(self):
        tmp = Path(tempfile.mkdtemp())
        out_dir = tmp / ".ideation-radar" / "out"
        out_dir.mkdir(parents=True)
        (out_dir / "ideas.jsonl").write_text('{"key": "a", "status": "captured", "captured_at": "%s"}\n'
                                             % fakes.ago(10))
        c = make(tmp=tmp)
        inc = {"level": "fail", "first_seen_at": fakes.ago(30)}
        out = fixes.RADAR_RESEND.apply(c, ok_result(inc))
        self.assertTrue(out.done, out.detail)
        self.assertIn("radar.py --quiet resend --ideas", c.host.spawned[0])
        self.assertIn("scan.lock", c.host.spawned[0])


class EditorStills(unittest.TestCase):
    def test_creates_a_private_bucket_once(self):
        calls = []

        class Db(fakes.FakeDb):
            def storage(self, method, path, body=None):
                calls.append((method, path, body))
                return fakes.resp(404 if method == "GET" else 200, {})

        out = fixes.EDITOR_STILLS.apply(make(db=Db()), fail("Bucket not found"))
        self.assertTrue(out.done)
        self.assertEqual(calls[-1], ("POST", "bucket", {"id": "editor-stills", "name": "editor-stills", "public": False}))


class RemoteHostRefuses(unittest.TestCase):
    def test_ssh_host_cannot_spawn_or_kill(self):
        from guard.host import SshHost
        h = SshHost(["ssh", "x"])
        with self.assertRaises(HostError):
            h.spawn("true")
        with self.assertRaises(HostError):
            h.kill(1, 15)


if __name__ == "__main__":
    unittest.main()
