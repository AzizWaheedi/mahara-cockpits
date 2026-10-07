"""Thresholds of the checks that read Creative Triage and Convex's mirror."""
import tempfile
import unittest
from pathlib import Path

from tests import fakes
from checks import convex, edge_functions, pg_cron, queues, supabase, syncs, whatsapp, worker_status
from guard.context import SourceError
from guard.model import FAIL, NOT_DEPLOYED, OK, PAUSED, UNKNOWN, WARN, Result

SIGNED_OUT = "The Claude sign-in on the VPS has lapsed, so nothing can be drafted. run claude, then /login"


def make(tables=None, **kw):
    tmp = Path(tempfile.mkdtemp())
    db = kw.pop("db", None) or fakes.FakeDb(tables or {})
    return fakes.ctx(tmp, db=db, host=fakes.FakeHost(fakes.snapshot()), **kw)


def desk(job, ok=True, minutes=1, detail="fine"):
    return {"worker": "sales-desk", "job": job, "ok": ok, "detail": detail, "at": fakes.ago(minutes)}


class SalesDesk(unittest.TestCase):
    def test_limits_per_job(self):
        cases = [("requests", 14, OK), ("requests", 16, FAIL), ("recordings", 74, OK), ("recordings", 76, FAIL),
                 ("digest", 25 * 60, OK), ("digest", 27 * 60, FAIL)]
        for job, minutes, want in cases:
            r = worker_status.desk_check(job)(make({"cockpit_sales_worker_status": [desk(job, minutes=minutes)]}))
            self.assertEqual(r.status, want, (job, minutes))

    def test_stale_copy_job_carries_the_stale_flag(self):
        r = worker_status.desk_check("recordings")(make({"cockpit_sales_worker_status": [desk("recordings", minutes=200)]}))
        self.assertTrue(r.data.get("stale"))

    def test_failed_for_the_signin_points_at_the_signin_incident(self):
        r = worker_status.desk_check("followups")(make({"cockpit_sales_worker_status": [desk("followups", False, 3, SIGNED_OUT)]}))
        self.assertEqual(r.status, FAIL)
        self.assertEqual(r.caused_by, "claude-signin")

    def test_missing_row_is_unknown_never_ok(self):
        self.assertEqual(worker_status.desk_check("notes")(make({"cockpit_sales_worker_status": []})).status, UNKNOWN)

    def test_desk_rows_are_quiet_only_when_convex_sales_watch_posted(self):
        ids = [c for c in worker_status.CHECKS if c.id.startswith("desk-") and c.id in
               {f"desk-{j}" for j in worker_status.DESK_LIMITS}]
        self.assertEqual(len(ids), len(worker_status.DESK_LIMITS))
        self.assertTrue(all(c.quiet_because == "convex-sales-watch" for c in ids))

    def test_only_copy_jobs_have_a_catch_up_fix(self):
        fixed = {c.id for c in worker_status.CHECKS if c.fix and c.id.startswith("desk-") and c.id != "desk-doctor"}
        self.assertEqual(fixed, {"desk-recordings", "desk-calls-vault", "desk-maqsam-calls"})

    def test_doctor_row_matters_only_once_the_watchdog_exists(self):
        rows = {"cockpit_sales_worker_status": [desk("doctor", False, 9000, "blocked")]}
        self.assertEqual(worker_status.run_desk_doctor(make(rows, db=fakes.FakeDb(rows, missing=("cockpit_sales_alerts",)))).status, OK)
        self.assertEqual(worker_status.run_desk_doctor(make(rows)).status, WARN)


class Salma(unittest.TestCase):
    def rows(self, **over):
        names = ["alerts", "captions", "higgsfield", "meta", "planning", "publishing", "video", "words"]
        rows = [{"check_name": n, "ok": True, "detail": None, "checked_at": fakes.ago(2)} for n in names]
        for r in rows:
            r.update(over.get(r["check_name"], {}))
        return {"social_worker_status": rows}

    def test_ok_stale_and_failing(self):
        self.assertEqual(worker_status.run_salma(make(self.rows())).status, OK)
        stale = self.rows()
        for r in stale["social_worker_status"]:
            r["checked_at"] = fakes.ago(20)
        self.assertEqual(worker_status.run_salma(make(stale)).status, FAIL)
        r = worker_status.run_salma(make(self.rows(higgsfield={"ok": False, "detail": "403 not_enough_credits"})))
        self.assertEqual(r.status, FAIL)
        self.assertIn("open.higgsfield.ai", r.action)

    def test_captions_paused_by_signin_is_folded(self):
        r = worker_status.run_salma(make(self.rows(captions={"ok": False, "detail": SIGNED_OUT})))
        self.assertEqual(r.caused_by, "claude-signin")


class Webinar(unittest.TestCase):
    def pulls(self, source, rows):
        return {"cockpit_webinar_pulls": [{"source": source, "ok": ok, "detail": d, "started_at": fakes.ago(m),
                                           "finished_at": fakes.ago(m)} for ok, d, m in rows]}

    def test_zoom(self):
        self.assertEqual(worker_status.webinar_check("zoom", "Zoom", 180)(make(self.pulls("zoom", [(True, None, 30)]))).status, OK)
        r = worker_status.webinar_check("zoom", "Zoom", 180)(make(self.pulls("zoom", [(True, None, 100)])))
        self.assertEqual(r.status, FAIL)
        self.assertTrue(r.data.get("stale"))

    def test_survey_failing_for_days(self):
        rows = [(False, "Composio gave no MCP session (HTTP 200)", 37 + 60 * i) for i in range(30)]
        r = worker_status.webinar_check("typeform", "survey", 1440)(make(self.pulls("typeform", rows)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("Composio", r.summary)
        self.assertFalse(r.data.get("stale"))

    def test_objections_paused_is_paused(self):
        rows = [(False, "Objection tagging paused: approve a transcript provider before sending lead data.", 37)]
        r = worker_status.webinar_check("objections", "objections", 1440)(make(self.pulls("objections", rows)))
        self.assertEqual(r.status, PAUSED)


class Tap(unittest.TestCase):
    def test_tap(self):
        row = {"key": "tap-charges-sync", "ok": False, "note": "Charges not found 1249", "last_run_at": fakes.ago(5),
               "last_ok_at": fakes.ago(8500)}
        r = worker_status.run_tap(make({"cockpit_sync_state": [row]}))
        self.assertEqual(r.status, FAIL)
        self.assertIn("window with no charges", r.summary)
        self.assertIn("No payment is lost", r.summary)
        self.assertIn("ai-fix", r.action)
        self.assertNotIn("may be", r.summary)
        row.update(ok=True, last_ok_at=fakes.ago(10))
        self.assertEqual(worker_status.run_tap(make({"cockpit_sync_state": [row]})).status, OK)


class Mirror(unittest.TestCase):
    def runs(self, specs):
        return {"cockpit_sales_mirror_runs": [{"id": 100 - i, "started_at": fakes.ago(m), "finished_at": fakes.ago(m),
                                               "ok": ok, "error": e} for i, (ok, e, m) in enumerate(specs)]}

    def test_mirror(self):
        self.assertEqual(syncs.run_mirror(make(self.runs([(True, None, 2)]))).status, OK)
        self.assertEqual(syncs.run_mirror(make(self.runs([(True, None, 16)]))).status, FAIL)
        three = self.runs([(False, "contracts: 503", 1), (False, "contracts: 503", 4), (False, "contracts: 503", 7), (True, None, 10)])
        self.assertEqual(syncs.run_mirror(make(three)).status, FAIL)
        two = self.runs([(False, "contracts: 503", 1), (False, "x", 4), (True, None, 7)])
        self.assertEqual(syncs.run_mirror(make(two)).status, OK)

    def test_drop_refusal(self):
        r = syncs.run_mirror_drop(make(self.runs([(False, "cockpit_sales_leads: B2B's read had 2 rows and 40 of the copy's were missing from it; nothing was dropped", 1)])))
        self.assertEqual(r.status, FAIL)

    def test_locks(self):
        t = {"cockpit_sales_locks": [{"name": "mirror", "holder": "x", "held_until": fakes.ago(-3)}]}
        self.assertEqual(syncs.run_locks(make(t)).status, OK)
        t["cockpit_sales_locks"][0]["held_until"] = fakes.ago(-40)
        self.assertEqual(syncs.run_locks(make(t)).status, WARN)


class Meta(unittest.TestCase):
    def test_blocked_from_two_signals_is_one_reading(self):
        section = {"key": "machine", "ok": True, "computed_at": fakes.ago(5), "error": None,
                   "payload": {"feeds": [{"name": "Meta ads", "ok": False, "lastSuccessAt": 1790957718411,
                                          "error": 'Meta 400: {"error":{"message":"API access blocked.","type":"OAuthException","code":200}}'}]}}
        jobs = [{"client_id": str(i), "last_sync_status": "error", "last_error": "meta: API access blocked."} for i in range(52)]
        r = syncs.run_meta(make({"cockpit_sections": [section], "sync_jobs": jobs}))
        self.assertEqual(r.status, FAIL)
        self.assertIn("52 of 52", r.summary)
        self.assertIn("API access blocked. (code 200)", r.summary)
        self.assertNotIn("{", r.summary)

    def test_clear(self):
        section = {"key": "machine", "ok": True, "computed_at": fakes.ago(5), "payload": {"feeds": [{"name": "Meta ads", "ok": True}]}}
        self.assertEqual(syncs.run_meta(make({"cockpit_sections": [section], "sync_jobs": []})).status, OK)


class B2B(unittest.TestCase):
    def test_sources(self):
        v = {"read_at": fakes.ago(2), "sources": [
            {"source": "fathom_calls", "last_sync_status": "success", "last_synced_at": fakes.ago(30)},
            {"source": "assets_web", "last_sync_status": "success", "last_synced_at": fakes.ago(6.5 * 1440)},
            {"source": "old", "last_sync_status": "running", "last_synced_at": None}]}
        self.assertEqual(syncs.run_b2b(make({"cockpit_sales_settings": [{"key": "b2b_sources", "value": v}]})).status, OK)
        v["sources"].append({"source": "maqsam_log", "last_sync_status": "error", "last_error": "403"})
        self.assertEqual(syncs.run_b2b(make({"cockpit_sales_settings": [{"key": "b2b_sources", "value": v}]})).status, WARN)


class Convex(unittest.TestCase):
    def sections(self, minutes, n=14, broken=()):
        return {"cockpit_sections": [{"key": f"s{i}", "ok": f"s{i}" not in broken, "error": "x" if f"s{i}" in broken else None,
                                      "computed_at": fakes.ago(minutes)} for i in range(n)]}

    def test_sections(self):
        self.assertEqual(convex.run_sections(make(self.sections(3))).status, OK)
        self.assertEqual(convex.run_sections(make(self.sections(50))).status, FAIL)
        self.assertEqual(convex.run_sections(make(self.sections(3, broken=("s2",)))).status, WARN)
        self.assertEqual(convex.run_sections(make(self.sections(3, n=12))).status, WARN)

    def test_convex_down_is_urgent(self):
        self.assertTrue(next(c for c in convex.CHECKS if c.id == "convex-ceo-sections").urgent)

    def machine(self, **payload):
        return {"cockpit_sections": [{"key": "machine", "ok": True, "error": None, "computed_at": fakes.ago(3), "payload": payload}]}

    def test_jobs(self):
        now_ms = fakes.NOW.timestamp() * 1000
        ok_job = {"job": "sync", "ok": True, "at": now_ms - 60_000, "everyMin": 10}
        self.assertEqual(convex.run_jobs(make(self.machine(jobs=[ok_job]))).status, OK)
        late = dict(ok_job, at=now_ms - 50 * 60_000)
        self.assertEqual(convex.run_jobs(make(self.machine(jobs=[late]))).status, FAIL)
        watch = {"job": "sales watch", "ok": False, "at": now_ms, "everyMin": 15, "error": SIGNED_OUT}
        r = convex.run_jobs(make(self.machine(jobs=[ok_job, watch])))
        self.assertEqual(r.caused_by, "claude-signin")

    def test_old_machine_section_cannot_vouch(self):
        t = {"cockpit_sections": [{"key": "machine", "computed_at": fakes.ago(90), "payload": {"jobs": []}}]}
        with self.assertRaises(SourceError):
            convex.run_jobs(make(t))

    def test_sources(self):
        p = self.machine(sources=[{"source": "sheets", "ok": False, "lastError": "HTTP 404"}, {"source": "meta", "ok": True}])
        r = convex.run_sources(make(p))
        self.assertEqual(r.status, FAIL)
        self.assertIn("sheets", r.summary)

    def test_hermes_failures_rising(self):
        state = {"history": {"hermes_failed": [[fakes.ago(65), 2300]]}}
        r = convex.run_hermes_queue(make(self.machine(hermes={"queued": 0, "failed": 2312, "lastDoneAt": fakes.NOW.timestamp() * 1000}), state=state))
        self.assertEqual(r.status, WARN)
        stuck = self.machine(hermes={"queued": 3, "failed": 1, "lastDoneAt": fakes.NOW.timestamp() * 1000 - 30 * 60_000})
        self.assertEqual(convex.run_hermes_queue(make(stuck, state={})).status, FAIL)

    def test_deployments(self):
        web = fakes.FakeWeb({"https://adorable": fakes.resp(200), "https://impressive": fakes.resp(200), "https://colorful": fakes.resp(503)})
        self.assertEqual(convex.run_deployments(make(web=web)).status, FAIL)


class PgCron(unittest.TestCase):
    def probe(self, **over):
        jobs = [{"jobid": i, "jobname": n, "schedule": "* * * * *", "active": True} for i, n in enumerate(pg_cron.EXPECTED_JOBS)]
        p = {"cron_jobs": jobs, "cron_runs": [], "http_1h": {"200": 30}, "auth_roles": {}}
        p.update(over)
        return p

    def test_jobs(self):
        self.assertEqual(pg_cron.run_jobs(make(db=fakes.FakeDb(probe=self.probe()))).status, OK)
        p = self.probe()
        p["cron_jobs"] = p["cron_jobs"][1:]
        p["cron_jobs"][0]["active"] = False
        r = pg_cron.run_jobs(make(db=fakes.FakeDb(probe=p)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("missing", r.summary)
        self.assertIn("switched off", r.summary)

    def test_runs_read_the_answers_not_just_succeeded(self):
        self.assertEqual(pg_cron.run_runs(make(db=fakes.FakeDb(probe=self.probe()))).status, OK)
        self.assertEqual(pg_cron.run_runs(make(db=fakes.FakeDb(probe=self.probe(http_1h={"200": 9, "500": 1})))).status, FAIL)
        self.assertEqual(pg_cron.run_runs(make(db=fakes.FakeDb(probe=self.probe(http_1h={"timeout": 2})))).status, FAIL)
        c = make(db=fakes.FakeDb(probe=self.probe(http_1h={"200": 29, "missing_function": 2})))
        c.results["live-function"] = Result(NOT_DEPLOYED, "sales-live is not deployed yet")
        c.results["live-settings"] = Result(PAUSED, "switched off")
        r = pg_cron.run_runs(c)
        self.assertEqual(r.status, OK)          # sales-live not deployed yet is the function checks' to say
        self.assertIn("not deployed", r.summary)
        runs = [{"jobid": 0, "runs_24h": 48, "failed_24h": 2, "last_error": "job startup timeout"}]
        self.assertEqual(pg_cron.run_runs(make(db=fakes.FakeDb(probe=self.probe(cron_runs=runs)))).status, WARN)

    def test_probe_missing_names_the_migration(self):
        with self.assertRaises(SourceError) as e:
            pg_cron.run_jobs(make(db=fakes.FakeDb(probe=None)))
        self.assertIn("20261003e", str(e.exception))


    def test_auth_roles(self):
        r = pg_cron.run_auth_roles(make(db=fakes.FakeDb(probe=self.probe(auth_roles={"mahara_dialer_identity": 2}))))
        self.assertEqual(r.status, WARN)
        self.assertIn("2 with mahara_dialer_identity", r.summary)
        self.assertEqual(pg_cron.run_auth_roles(make(db=fakes.FakeDb(probe=self.probe()))).status, OK)


class EdgeFunctions(unittest.TestCase):
    def listed(self):
        return [{"slug": s, "status": "ACTIVE", "verify_jwt": j} for s, j in edge_functions.EXPECTED.items()]

    def test_list(self):
        self.assertEqual(edge_functions.run_functions(make(db=fakes.FakeDb(functions=self.listed()))).status, OK)
        bad = self.listed()
        bad[0]["verify_jwt"] = False
        bad[1]["status"] = "THROTTLED"
        r = edge_functions.run_functions(make(db=fakes.FakeDb(functions=bad[:-1])))
        self.assertEqual(r.status, FAIL)
        self.assertIn("verify_jwt", r.summary)
        self.assertIn("missing", r.summary)

    def test_sales_live_is_expected_with_verify_jwt_off(self):
        self.assertIs(edge_functions.EXPECTED.get("sales-live"), False)
        signed = [dict(f, verify_jwt=True) if f["slug"] == "sales-live" else f for f in self.listed()]
        r = edge_functions.run_functions(make(db=fakes.FakeDb(functions=signed)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("sales-live has verify_jwt True", r.summary)
        gone = [f for f in self.listed() if f["slug"] != "sales-live"]
        r = edge_functions.run_functions(make(db=fakes.FakeDb(functions=gone)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("sales-live is missing", r.summary)

    def test_without_token_only_sales_api_is_checked(self):
        web = fakes.FakeWeb({"https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-api": fakes.resp(401)})
        r = edge_functions.run_functions(make(web=web))
        self.assertEqual(r.status, UNKNOWN)
        self.assertTrue(r.coverage_gap)
        self.assertEqual(web.calls, ["https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-api"])


class SupabaseHealth(unittest.TestCase):
    def test_down_is_fail_not_unknown(self):
        r = supabase.run_health(make(db=fakes.FakeDb(down=True)))
        self.assertEqual(r.status, FAIL)

    def test_service_unhealthy(self):
        db = fakes.FakeDb(health=[{"name": "db", "status": "ACTIVE_HEALTHY"}, {"name": "rest", "status": "UNHEALTHY"}])
        self.assertEqual(supabase.run_health(make(db=db)).status, FAIL)
        self.assertEqual(supabase.run_health(make()).status, OK)

    def test_needs_fifteen_minutes_and_resends_the_radar_after(self):
        c = supabase.CHECKS[0]
        self.assertEqual(c.confirm_minutes, 15)
        self.assertEqual(c.on_resolve.name, "radar-resend")


class WhatsApp(unittest.TestCase):
    def test_connector(self):
        def t(v):
            return make({"cockpit_sales_settings": [{"key": "whatsapp_guard", "value": v}]})
        r = whatsapp.run_doubles(t({"templates_per_day": 250}))
        self.assertEqual(r.status, UNKNOWN)
        self.assertTrue(r.coverage_gap)
        r = whatsapp.run_doubles(t({"connector_off": False, "single_copy_ok_at": None}))
        self.assertEqual(r.status, WARN)
        self.assertIn("may go out twice", r.summary)
        self.assertEqual(whatsapp.run_doubles(t({"connector_off": True})).status, WARN)
        self.assertEqual(whatsapp.run_doubles(t({"connector_off": True, "single_copy_ok_at": "2026-10-04T09:00:00Z"})).status, OK)

    def test_wallet_and_refusals(self):
        msgs = [{"id": "1", "channel": "whatsapp", "state": "failed", "error": "Insufficient funds in wallet", "created_at": fakes.ago(30)},
                {"id": "2", "channel": "whatsapp", "state": "failed", "error": "(#131049) marketing cap", "created_at": fakes.ago(40)},
                {"id": "3", "channel": "whatsapp", "state": "failed", "error": "old", "created_at": fakes.ago(3000)}]
        c = make({"cockpit_sales_messages": msgs})
        self.assertEqual(whatsapp.run_wallet(c).status, FAIL)
        r = whatsapp.run_refusals(c)
        self.assertEqual(r.status, WARN)
        self.assertIn("131049", r.summary)


class Queues(unittest.TestCase):
    def test_stuck_social_job(self):
        q = next(x for x in queues.QUEUES if x.id == "queue-social-jobs")
        rows = {"social_jobs": [{"id": "generate:86eywazcu:2026-09:1", "status": "running", "updated_at": fakes.ago(7.2 * 1440)},
                                {"id": "b", "status": "done", "updated_at": fakes.ago(9000)}]}
        r = queues.queue_check(q)(make(rows))
        self.assertEqual(r.status, WARN)
        self.assertIn("1 Salma job(s)", r.summary)
        rows["social_jobs"][0]["updated_at"] = fakes.ago(30)
        self.assertEqual(queues.queue_check(q)(make(rows)).status, OK)


if __name__ == "__main__":
    unittest.main()
