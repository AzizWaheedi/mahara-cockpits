"""The coverage review of 2026-10-03, one class per finding (C1 to C18; C19 and
C20 are the same as the safety review's S1 and S9, tested in test_safety.py)."""
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import timedelta
from pathlib import Path
from unittest import mock

from tests import fakes
from tests.test_engine import Box, Harness, KUWAIT_NIGHT
import checks as checks_mod
import guardian
from checks import (convex, guardian_self, hermes_monitors, pg_cron, queues, syncs, vps_cron, vps_resources,
                    worker_status)
from guard import alerts, beat, engine, report, vps_snapshot
from guard.config import MONITOR_ENV, Keys, _default_key_files
from guard.db import DbError
from guard.host import write_monitor_state
from guard.model import FAIL, OK, PAUSED, UNKNOWN, WARN, Result, fail, iso, ok, warn
from guard.store import Store

NOW_S = int(fakes.NOW.timestamp())
CF = {"PORTAL_MONITOR_CF_TOKEN": "cf-token-for-tests-123456", "PORTAL_MONITOR_CF_ACCOUNT": "acct",
      "PORTAL_MONITOR_CF_KV_NAMESPACE": "ns"}


def make(tables=None, **kw):
    db = kw.pop("db", None) or fakes.FakeDb(tables or {})
    return fakes.ctx(Path(tempfile.mkdtemp()), db=db, host=kw.pop("host", fakes.FakeHost(fakes.snapshot())), **kw)


class C1WatcherIsWatched(unittest.TestCase):
    def test_the_beat_goes_to_the_dead_man_kv_in_its_shape(self):
        sent = []
        state = {"open": {"a": {}, "b": {}}, "due_since": {"x": iso(fakes.NOW - timedelta(minutes=20))},
                 "last_scan": {"at": iso(fakes.NOW)}}
        rec = beat.send(Keys(environ=CF, use_files=False), state, fakes.NOW,
                        put=lambda m, url, **kw: (sent.append((m, url, kw)), fakes.resp(200, {"success": True}))[1])
        method, url, kw = sent[0]
        self.assertEqual(method, "PUT")
        self.assertTrue(url.endswith("/accounts/acct/storage/kv/namespaces/ns/values/beat:cockpit-guardian"))
        self.assertEqual(kw["headers"]["Authorization"], "Bearer cf-token-for-tests-123456")
        body = kw["json_body"]
        self.assertEqual((body["ts"], body["project"], body["open"], body["outbox"]),
                         (NOW_S, "cockpit-guardian", 2, 1))
        self.assertEqual(body["outbox_oldest"], NOW_S - 1200)
        self.assertEqual(rec["ok_at"], iso(fakes.NOW))

    def test_keys_missing_or_a_failing_beat_is_its_own_failure(self):
        state = {}
        beat.send(Keys(environ={}, use_files=False), state, fakes.NOW)
        r = guardian_self.run_beat(fakes.ctx(Path(tempfile.mkdtemp()), state=state))
        self.assertEqual(r.status, FAIL)
        self.assertIn("PORTAL_MONITOR_CF_TOKEN", r.summary)
        state = {"beat": {"at": iso(fakes.NOW), "ok_at": iso(fakes.NOW - timedelta(minutes=30)),
                          "error": "Cloudflare answered 403"}}
        self.assertEqual(guardian_self.run_beat(fakes.ctx(Path(tempfile.mkdtemp()), state=state)).status, FAIL)

    def test_beat_off_sends_nothing_and_reads_paused(self):
        sent = []
        state = {"beat": {"error": "Cloudflare answered 429"}}
        rec = beat.send(Keys(environ=dict(CF, GUARDIAN_BEAT="off"), use_files=False), state, fakes.NOW,
                        put=lambda *a, **kw: (sent.append(a), fakes.resp(200, {"success": True}))[1])
        self.assertEqual(sent, [])
        self.assertTrue(rec["off"])
        self.assertIsNone(rec["error"])
        r = guardian_self.run_beat(fakes.ctx(Path(tempfile.mkdtemp()), state=state))
        self.assertEqual(r.status, PAUSED)
        self.assertIn("GUARDIAN_BEAT=off", r.summary)
        beat.send(Keys(environ=CF, use_files=False), state, fakes.NOW,
                  put=lambda *a, **kw: (sent.append(a), fakes.resp(200, {"success": True}))[1])
        self.assertEqual(len(sent), 1)
        self.assertNotIn("off", state["beat"])

    def test_a_full_scan_on_the_vps_beats_and_a_dry_run_never_does(self):
        b = Box(fixable=False)
        puts = []
        for extra, want in (([], 1), (["--dry-run"], 0)):
            tmp = Path(tempfile.mkdtemp())
            # GUARDIAN_KEY_FILES: never the host's real key files (on the VPS they hold GUARDIAN_BEAT=off).
            with mock.patch.dict(os.environ, dict(CF, GUARDIAN_KEY_FILES="/nonexistent")), \
                    mock.patch.object(guardian, "open_db", return_value=fakes.FakeDb({"cockpit_guardian_incidents": []})), \
                    mock.patch.object(guardian, "open_host", return_value=fakes.FakeHost(fakes.snapshot())), \
                    mock.patch.object(checks_mod, "all_checks", return_value=[b.check]), \
                    mock.patch.object(alerts.Slack, "send", return_value=None), \
                    mock.patch.object(beat.http, "request",
                                      side_effect=lambda *a, **k: (puts.append(a), fakes.resp(200))[1]):
                before = len(puts)
                guardian.main(["--quiet", "--state-dir", str(tmp)] + extra + ["scan"])
            self.assertEqual(len(puts) - before, want, extra)
        self.assertIn("beat:cockpit-guardian", puts[0][1])

    def test_the_summary_says_first_when_the_scan_is_old(self):
        state = {"last_scan": {"at": iso(fakes.NOW - timedelta(minutes=50)), "results": {"x": {"status": "ok", "summary": "y"}}}}
        text = report.build(state, {}, fakes.NOW)
        self.assertTrue(text.startswith("The guardian has not scanned for 50 min"))
        self.assertIn("cron.log", text.splitlines()[0])


class C2WorseIsAlertedAgain(unittest.TestCase):
    def test_a_rise_to_fail_posts_again_and_an_urgent_one_skips_the_hold(self):
        b = Box(fixable=False, urgent=True)
        h = Harness([b.check])
        b.result = warn("some sections are old")
        h.scan()
        b.result = fail("every section is old: Convex is off")
        h.scan(KUWAIT_NIGHT)
        self.assertEqual(len(h.posted), 2)
        self.assertTrue(h.posted[1].startswith("[guardian] Worse: Demo job"))
        self.assertIn("from warning to broken", h.posted[1])

    def test_a_rise_on_a_plain_check_waits_for_the_hold(self):
        b = Box(fixable=False)
        h = Harness([b.check])
        b.result = warn("slow")
        h.scan()
        b.result = fail("down")
        h.scan(fakes.NOW + timedelta(hours=1))
        self.assertEqual(len(h.posted), 1)
        h.scan(fakes.NOW + timedelta(hours=18))          # the next day, 11:00 Kuwait
        self.assertEqual(len(h.posted), 2)

    def test_a_new_name_failing_posts_again(self):
        b = Box(fixable=False)
        h = Harness([b.check])
        b.result = fail("keys missing", items=["ZOOM_CLIENT_ID"])
        h.scan()
        h.scan(fakes.NOW + timedelta(hours=1))
        self.assertEqual(len(h.posted), 1)               # nothing new
        b.result = fail("keys missing", items=["ZOOM_CLIENT_ID", "GHL_B2B_API_KEY"])
        h.scan(fakes.NOW + timedelta(hours=2))           # new, but inside the 6-hour hold: waits
        self.assertEqual(len(h.posted), 1)
        h.scan(fakes.NOW + timedelta(hours=18))          # the next day, 11:00 Kuwait
        self.assertEqual(len(h.posted), 2)
        self.assertIn("newly failing: GHL_B2B_API_KEY", h.posted[1])


class C3SupabaseByTheClock(unittest.TestCase):
    def test_opens_after_fifteen_minutes_however_few_scans_ran(self):
        db = fakes.FakeDb({"cockpit_guardian_incidents": []}, down=True)
        h = Harness([checks_mod.by_id()["supabase-health"]], db=db)
        h.scan()
        h.scan(fakes.NOW + timedelta(minutes=10))
        self.assertEqual(h.store.open, {})
        h.scan(fakes.NOW + timedelta(minutes=16))        # two slow scans were skipped in between
        self.assertIn("supabase-health", h.store.open)


class C4ConvexSalesWatch(unittest.TestCase):
    def results(self, *, streak=10, ok_=False, slack=True, error='sales desk "recordings" last ran 200 min ago'):
        jobs = Result(FAIL if not ok_ else OK, "x", data={"sales_watch": {"ok": ok_, "streak": streak, "everyMin": 15,
                                                                           "error": error}, "slack_ok": slack})
        return {"convex-ceo-sections": Result(OK, "fine"), "convex-jobs": jobs}

    def inc(self, minutes_ago):
        return {"first_seen_at": iso(fakes.NOW - timedelta(minutes=minutes_ago))}

    def check(self):
        return checks_mod.by_id()["desk-recordings"]

    def test_covered_only_when_its_one_message_covered_this(self):
        c = self.check()
        # streak 10 x 15 min: Convex posted 105 min ago, once.
        self.assertIsNotNone(engine.covered(c, self.results(), self.inc(200), fakes.NOW))
        self.assertIsNone(engine.covered(c, self.results(), self.inc(30), fakes.NOW))           # newer than that post
        self.assertIsNone(engine.covered(c, self.results(slack=False), self.inc(200), fakes.NOW))
        self.assertIsNone(engine.covered(c, self.results(streak=2), self.inc(200), fakes.NOW))
        self.assertIsNone(engine.covered(c, self.results(ok_=True), self.inc(200), fakes.NOW))
        self.assertIsNone(engine.covered(c, self.results(error='sales desk "reviews" failed'), self.inc(200), fakes.NOW))

    def test_the_sign_in_is_blamed_only_when_every_problem_is_the_sign_in(self):
        signin = 'sales desk "reviews" failed: The Claude sign-in on the VPS has lapsed (run claude, then /login); drafting resumes'
        self.assertTrue(convex.only_signin("Error: Uncaught Error: " + signin))
        mixed = ('sales desk "requests" last ran 47 min ago (the VPS or its cron is down); ' + signin +
                 '; the sales mirror failed three runs in a row: 503')
        self.assertFalse(convex.only_signin(mixed))
        now_ms = fakes.NOW.timestamp() * 1000
        t = {"cockpit_sections": [{"key": "machine", "ok": True, "computed_at": fakes.ago(3), "error": None,
                                   "payload": {"jobs": [{"job": "sales watch", "ok": False, "at": now_ms, "everyMin": 15,
                                                         "streak": 4, "error": mixed}],
                                               "sources": [{"source": "slack", "ok": True}]}}]}
        r = convex.run_jobs(make(t))
        self.assertEqual(r.status, FAIL)
        self.assertIsNone(r.caused_by)
        self.assertEqual(r.data["sales_watch"]["streak"], 4)
        self.assertTrue(r.data["slack_ok"])


class C6HermesOwnedReachTheFixer(unittest.TestCase):
    def test_open_hermes_incidents_are_written_in_the_monitors_shape(self):
        tmp = Path(tempfile.mkdtemp())
        s = Store(tmp / "s.json")
        by = checks_mod.by_id()
        s.open_incident(by["vps-hung-runs"], fail("a run hangs"), fakes.NOW, "report-only")
        s.open_incident(by["claude-signin"], fail("signed out"), fakes.NOW, "report-only")   # the CEO's
        incs = engine.hermes_incidents(s, by)
        self.assertEqual(list(incs), ["vps-hung-runs"])
        self.assertEqual(incs["vps-hung-runs"]["severity"], "warn")       # medium severity
        self.assertEqual(incs["vps-hung-runs"]["opened"], NOW_S)
        path = tmp / "state" / "cockpit-guardian" / "state.json"
        write_monitor_state(str(path), incs, NOW_S)
        body = json.loads(path.read_text())
        self.assertEqual(body["incidents"]["vps-hung-runs"]["kind"], "outage")
        self.assertEqual(oct(path.stat().st_mode & 0o777), "0o640")


class C7Urgency(unittest.TestCase):
    def test_business_stopping_failures_go_at_any_hour(self):
        self.assertTrue(checks_mod.by_id()["vps-crontab"].urgent)
        lines = [l for l in fakes.snapshot()["crontab"]["lines"] if "out.py" not in l]
        self.assertEqual(vps_cron.run_crontab(make(host=fakes.FakeHost(fakes.snapshot(crontab={"lines": lines})))).status, FAIL)
        mem = fakes.snapshot(mem={"MemTotal": 16_000_000, "MemAvailable": 600 * 1024, "SwapTotal": 0})
        self.assertTrue(vps_resources.run_memory(make(host=fakes.FakeHost(mem))).urgent)
        disk = fakes.snapshot(disk={"pct": 95.0, "avail_gb": 3})
        self.assertTrue(vps_resources.run_disk(make(host=fakes.FakeHost(disk))).urgent)
        runs = {"cockpit_sales_mirror_runs": [{"id": 1, "started_at": fakes.ago(40), "ok": True, "error": None}]}
        self.assertTrue(syncs.run_mirror(make(runs)).urgent)

    def test_an_urgent_reading_posts_at_night(self):
        b = Box(fixable=False)
        h = Harness([b.check])
        b.result = fail("the crontab lost every line", urgent=True)
        h.scan(KUWAIT_NIGHT)
        self.assertEqual(len(h.posted), 1)


class C8FailedQueueRows(unittest.TestCase):
    def q(self, qid):
        return next(x for x in queues.QUEUES if x.id == qid)

    def test_failed_rows_in_24_hours_warn_with_the_first_error(self):
        rows = {"eod_outbox": [{"id": 1, "status": "failed", "error": "not_in_channel", "created_at": fakes.ago(40)}]}
        r = queues.queue_check(self.q("queue-eod-outbox"))(make(rows))
        self.assertEqual(r.status, WARN)
        self.assertIn("not_in_channel", r.summary)
        posts = {"cockpit_post_jobs": [{"id": 9, "status": "failed", "error": "Session expired", "updated_at": fakes.ago(60)}]}
        self.assertIn("Session expired", queues.queue_check(self.q("queue-post-jobs"))(make(posts)).summary)
        for qid in ("queue-editor-requests", "queue-ideation-requests", "queue-social-jobs"):
            self.assertTrue(self.q(qid).failed_col, qid)

    def test_end_of_day_waits_15_minutes_and_waiting_sales_requests_are_read(self):
        self.assertEqual(self.q("queue-eod-outbox").limit_min, 15)
        sr = self.q("queue-sales-requests-waiting")
        self.assertEqual((sr.states, sr.time_col), (("queued",), "requested_at"))
        rows = {"cockpit_sales_requests": [{"id": "a", "status": "queued", "requested_at": fakes.ago(20)}]}
        self.assertEqual(queues.queue_check(sr)(make(rows)).status, WARN)


class C9EdgeFunctionsOnTheVps(unittest.TestCase):
    def test_the_monitor_env_is_read_by_name(self):
        self.assertIn(MONITOR_ENV, _default_key_files())

    def test_doctor_requires_the_token_on_the_vps(self):
        tmp = tempfile.mkdtemp()
        env = {k: v for k, v in os.environ.items() if not k.startswith(("GUARDIAN_", "SUPABASE_", "SLACK_"))}
        env["GUARDIAN_KEY_FILES"] = "/nonexistent"
        buf = io.StringIO()
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(guardian, "open_db", side_effect=DbError("no door")), \
                mock.patch.object(guardian, "open_host", return_value=fakes.FakeHost(fakes.snapshot())), \
                redirect_stdout(buf):
            rc = guardian.main(["--state-dir", tmp, "doctor"])
        self.assertEqual(rc, 1)
        line = next(l for l in buf.getvalue().splitlines() if "SUPABASE_ACCESS_TOKEN" in l)
        self.assertTrue(line.startswith("--"), line)
        self.assertTrue(any(l.startswith("--") and "PORTAL_MONITOR_CF_TOKEN" in l for l in buf.getvalue().splitlines()))


class C11Salma(unittest.TestCase):
    def rows(self, **over):
        names = ["alerts", "captions", "higgsfield", "meta", "planning", "publishing", "video", "words"]
        rows = [{"check_name": n, "ok": True, "detail": None, "checked_at": fakes.ago(2)} for n in names]
        for r in rows:
            r.update(over.get(r["check_name"], {}))
        return {"social_worker_status": rows}

    def test_a_higgsfield_sign_out_is_not_the_claude_sign_in(self):
        r = worker_status.run_salma(make(self.rows(higgsfield={"ok": False, "detail": "Paused: Higgsfield is signed out on the server. Sign it in again."})))
        self.assertEqual(r.status, FAIL)
        self.assertIsNone(r.caused_by)
        self.assertIn("M4", r.action)

    def test_publishing_switched_off_is_a_decision(self):
        r = worker_status.run_salma(make(self.rows(publishing={"ok": False, "detail": "Posting is stopped for every client (SOCIAL_PUBLISHING=off on the server)."})))
        self.assertEqual(r.status, PAUSED)


class C12AllHermesMonitors(unittest.TestCase):
    def test_portal_and_dialer_are_read_and_a_stuck_outbox_is_not_covering(self):
        by = checks_mod.by_id()
        self.assertIn("hermes-monitor-portal", by)
        self.assertIn("hermes-monitor-dialer", by)
        snap = fakes.snapshot()
        snap["monitors"]["mahara-cockpits"].update(outbox=2, outbox_oldest=NOW_S - 3600)
        c = make(host=fakes.FakeHost(snap))
        r = hermes_monitors.monitor_check("mahara-cockpits", "cockpits")(c)
        self.assertEqual(r.status, FAIL)
        self.assertFalse(r.data["delivering"])
        results = {"hermes-monitor-cockpits": r, "hermes-monitor-sites": Result(OK, "x", data={"delivering": True})}
        self.assertIsNone(engine.covered(by["hermes-jobs"], results))
        results["hermes-monitor-cockpits"] = Result(WARN, "x", data={"delivering": True})
        self.assertIsNotNone(engine.covered(by["hermes-jobs"], results))


class C13CatalogueChecks(unittest.TestCase):
    def test_vault_behind_fathom(self):
        rows = {"cockpit_sales_recordings": [{"source": "vault", "started_at": fakes.ago(9 * 1440)},
                                             {"source": None, "started_at": fakes.ago(2 * 1440)}]}
        self.assertEqual(worker_status.run_vault_lag(make(rows)).status, WARN)
        rows["cockpit_sales_recordings"][0]["started_at"] = fakes.ago(2.5 * 1440)
        self.assertEqual(worker_status.run_vault_lag(make(rows)).status, OK)

    def test_maqsam_copy_gap_and_silence(self):
        day = lambda d, m, c: {"day": (fakes.NOW - timedelta(days=d)).date().isoformat(), "maqsam_calls": m,
                               "copied_calls": c, "checked_at": fakes.ago(5)}
        gap = {"cockpit_sales_dial_checks": [day(0, 12, 9), day(1, 4, 4)]}
        self.assertEqual(worker_status.run_maqsam(make(gap)).status, FAIL)
        quiet = {"cockpit_sales_dial_checks": [day(d, 0, 0) for d in range(8)], "cockpit_sales_recordings": []}
        self.assertEqual(worker_status.run_maqsam(make(quiet)).status, WARN)

    def test_hiring_engine_armed(self):
        sec = lambda armed: {"cockpit_sections": [{"key": "hiring", "computed_at": fakes.ago(3), "ok": True, "error": None,
                                                   "payload": {"engine": {"armed": armed}}}]}
        self.assertEqual(worker_status.run_hiring_engine(make(sec(True))).status, WARN)
        self.assertEqual(worker_status.run_hiring_engine(make(sec(False))).status, OK)

    def test_literal_keys_in_pg_cron_by_boolean_only(self):
        jobs = [{"jobid": 1, "jobname": "mahara-sync-business", "active": True, "has_literal_auth": True},
                {"jobid": 3, "jobname": "mahara-ghl-appointments", "active": True, "has_literal_auth": False}]
        r = pg_cron.run_literal_auth(make(db=fakes.FakeDb(probe={"cron_jobs": jobs})))
        self.assertEqual(r.status, WARN)
        self.assertEqual(r.items, ["mahara-sync-business"])
        old = [{"jobid": 1, "jobname": "x", "active": True}]
        self.assertEqual(pg_cron.run_literal_auth(make(db=fakes.FakeDb(probe={"cron_jobs": old}))).status, UNKNOWN)


class C14ProxyExposedCanClear(unittest.TestCase):
    def test_the_action_is_the_bind_that_clears_it(self):
        action = checks_mod.by_id()["claude-proxy-exposed"].action
        self.assertIn("127.0.0.1", action)
        self.assertNotIn("run sudo ufw deny", action)


class C15NoFlapping(unittest.TestCase):
    def test_clear_needs_good_readings_in_a_row(self):
        b = Box(fixable=False)
        b.check.clear = 2
        h = Harness([b.check])
        b.result = fail("low")
        h.scan()
        b.result = ok("fine")
        h.scan(fakes.NOW + timedelta(minutes=5))
        self.assertIn("demo-check", h.store.open)
        h.scan(fakes.NOW + timedelta(minutes=10))
        self.assertNotIn("demo-check", h.store.open)

    def test_memory_clears_only_above_1536_mb(self):
        state = {}

        def read(mb):
            snap = fakes.snapshot(mem={"MemTotal": 16_000_000, "MemAvailable": mb * 1024, "SwapTotal": 0})
            return vps_resources.run_memory(make(host=fakes.FakeHost(snap), state=state)).status
        self.assertEqual([read(900), read(1200), read(1600), read(1200)], [WARN, WARN, OK, OK])

    def test_a_429_counts_only_after_two_hours(self):
        state = {}
        t = {"appointment_sync_state": [{"location_id": "L1", "last_synced_at": fakes.ago(5), "last_status": "error 429"}],
             "lead_sync_state": [], "pipeline_sync_state": []}
        self.assertEqual(syncs.run_crm(make(t, state=state)).status, OK)
        self.assertEqual(syncs.run_crm(make(t, state=state, now=fakes.NOW + timedelta(hours=3))).status, WARN)

    def test_a_traceback_is_read_once(self):
        tmp = Path(tempfile.mkdtemp())
        log = tmp / "x.log"
        log.write_text("start\nTraceback (most recent call last):\nSSLError: EOF\nok line\n")
        first = vps_snapshot.tails([str(log)], 80, {})[str(log)]
        self.assertEqual(first["tracebacks"], 1)
        again = vps_snapshot.tails([str(log)], 80, {str(log): first["size"]})[str(log)]
        self.assertEqual(again["tracebacks"], 0)
        with open(log, "a") as fh:
            fh.write("Traceback (most recent call last):\nKeyError: 'x'\n")
        new = vps_snapshot.tails([str(log)], 80, {str(log): first["size"]})[str(log)]
        self.assertEqual((new["tracebacks"], new["flagged"][-1]), (1, "KeyError: 'x'"))

    def test_the_scan_remembers_each_logs_size(self):
        h = Harness([checks_mod.by_id()["log-hala"]])
        h.snap["logs"]["~/.hala.log"]["size"] = 4242
        h.scan()
        self.assertEqual(h.store.state["log_offsets"]["~/.hala.log"], 4242)

    def test_log_checks_and_memory_need_two_good_readings(self):
        by = checks_mod.by_id()
        self.assertEqual(by["vps-memory"].clear, 2)
        self.assertEqual(by["log-hala"].clear, 2)


class C16SummaryFromTheScan(unittest.TestCase):
    def test_the_first_scan_after_09_00_kuwait_posts_it_once(self):
        tmp = Path(tempfile.mkdtemp())
        cfg = fakes.config(tmp)
        store = Store(tmp / "state.json")
        store.state["last_scan"] = {"at": iso(fakes.NOW), "results": {"x": {"status": "ok", "summary": "y"}}}
        sent = []
        args = guardian.main.__globals__["argparse"].Namespace(only=None)
        morning = fakes.NOW.replace(hour=5, minute=55)       # 08:55 Kuwait
        with mock.patch.object(alerts.Slack, "send", side_effect=lambda text: sent.append(text)), \
                mock.patch.object(guardian.beat_mod, "send", return_value={}):
            guardian._after_scan(cfg, None, store, [], args, guardian.Log(None, True), morning, False)
            self.assertEqual(sent, [])
            guardian._after_scan(cfg, None, store, [], args, guardian.Log(None, True), morning + timedelta(minutes=10), False)
            guardian._after_scan(cfg, None, store, [], args, guardian.Log(None, True), morning + timedelta(minutes=15), False)
        self.assertEqual(len(sent), 1)
        self.assertTrue(sent[0].startswith("Cockpit guardian"))


class C17OtherConvexDeployments(unittest.TestCase):
    def test_a_deployment_that_answers_but_runs_no_code_fails(self):
        pages = {}
        for dep in ("adorable-seahorse-418", "impressive-dinosaur-375", "colorful-wombat-644"):
            pages[f"https://{dep}.convex.cloud/version"] = fakes.resp(200, "1.2")
            pages[f"https://{dep}.convex.site/.well-known/openid-configuration"] = fakes.resp(200, {"issuer": "x"})
        self.assertEqual(convex.run_deployments(make(web=fakes.FakeWeb(dict(pages)))).status, OK)
        pages["https://impressive-dinosaur-375.convex.site/.well-known/openid-configuration"] = fakes.resp(503, "disabled")
        r = convex.run_deployments(make(web=fakes.FakeWeb(pages)))
        self.assertEqual(r.status, FAIL)
        self.assertEqual(r.items, ["impressive-dinosaur-375"])


class C18Wording(unittest.TestCase):
    def test_tunnels_say_whose_they_are_and_who_can_stop_them(self):
        procs = {"jobs": [], "top": [], "cloudflared": {"n": 774, "rss_kb": 1, "users": {"hermes": 388, "root": 386},
                                                         "started": {"hermes": [NOW_S - 600000, NOW_S - 300000],
                                                                     "root": [NOW_S - 500000, NOW_S - 300000]}}}
        r = vps_resources.run_tunnels(make(host=fakes.FakeHost(fakes.snapshot(procs=procs))))
        self.assertIn("388 run as hermes", r.summary)
        self.assertIn("hermes can stop only its own 388", r.summary)
        self.assertIn("root needs sudo", r.summary)


if __name__ == "__main__":
    unittest.main()
