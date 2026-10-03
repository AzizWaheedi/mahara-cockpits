"""Live calls: every check says "not deployed yet" while its piece is missing."""
import tempfile
import unittest
from pathlib import Path

from tests import fakes
from checks import live_calls
from guard import engine
from guard.model import FAIL, NOT_DEPLOYED, OK, PAUSED, WARN
from guard.store import Store

ALL_TABLES = live_calls.ROOM_TABLES + live_calls.FOLLOWUP_TABLES
NOT_FOUND = fakes.resp(404, '{"code":"NOT_FOUND","message":"Requested function was not found"}')


def today():
    """Production on 2026-10-03: nothing of live calls exists."""
    tmp = Path(tempfile.mkdtemp())
    db = fakes.FakeDb({"cockpit_sales_worker_status": [], "cockpit_sales_settings": []}, missing=ALL_TABLES,
                      probe={"cron_jobs": [], "cron_runs": [], "http_1h": {}})
    web = fakes.FakeWeb({"https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/health": NOT_FOUND})
    return fakes.ctx(tmp, db=db, host=fakes.FakeHost(fakes.snapshot()), web=web, resolve=lambda h: False)


class NotDeployedYet(unittest.TestCase):
    def test_every_live_calls_check_reads_not_deployed_today(self):
        c = today()
        for check in live_calls.CHECKS:
            r = check.run(c)
            self.assertEqual(r.status, NOT_DEPLOYED, (check.id, r.summary))
            self.assertIn("not deployed yet", r.summary)

    def test_dns_names_the_dns_step(self):
        self.assertIn("waiting on the DNS step", live_calls.run_dns(today()).summary)

    def test_missing_table_never_opens_an_incident(self):
        c = today()
        store = Store(Path(tempfile.mkdtemp()) / "s.json")
        for _ in range(4):
            out = engine.Outcome()
            out.findings = engine.run_checks(c, live_calls.CHECKS)
            engine.apply_findings(store, out.findings, c.now, "report-only", out)
            self.assertEqual(out.opened, [])
        self.assertEqual(store.open, {})

    def test_missing_function_list_without_token_uses_health(self):
        r = live_calls.run_function(today())
        self.assertEqual(r.status, NOT_DEPLOYED)


class OnceDeployed(unittest.TestCase):
    def deployed(self, *, rows=(), settings=(), cron=("mahara-sales-rooms-sweep", "mahara-sales-watchdog"), alerts=(), missing=()):
        tmp = Path(tempfile.mkdtemp())
        tables = {"cockpit_sales_worker_status": list(rows), "cockpit_sales_settings": list(settings),
                  "cockpit_sales_alerts": list(alerts)}
        db = fakes.FakeDb(tables, missing=missing,
                          probe={"cron_jobs": [{"jobid": i, "jobname": n, "active": True} for i, n in enumerate(cron)]})
        snap = fakes.snapshot(rooms={"file": True, "unit": "active"})
        return fakes.ctx(tmp, db=db, host=fakes.FakeHost(snap), resolve=lambda h: True,
                         web=fakes.FakeWeb({"https://call.maharamedia.com/": fakes.resp(200),
                                            "https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/health": fakes.resp(200)}))

    def test_half_applied_migration_fails(self):
        c = self.deployed(missing=("cockpit_sales_alerts", "cockpit_sales_live"))
        self.assertEqual(live_calls.run_tables(c).status, FAIL)

    def test_all_tables(self):
        self.assertEqual(live_calls.run_tables(self.deployed()).status, OK)

    def test_cron_jobs_needed_once_tables_exist(self):
        self.assertEqual(live_calls.run_cron(self.deployed()).status, OK)
        self.assertEqual(live_calls.run_cron(self.deployed(cron=("mahara-sales-watchdog",))).status, FAIL)

    def test_switched_off_is_paused(self):
        c = self.deployed(settings=[{"key": "rooms", "value": {"enabled": False}}, {"key": "live", "value": {"enabled": False}}])
        r = live_calls.run_settings(c)
        self.assertEqual(r.status, PAUSED)
        self.assertIn("built and switched off", r.summary)

    def test_rooms_worker_age(self):
        def row(seconds):
            return [{"worker": "sales-desk", "job": "rooms", "ok": True, "detail": "", "at": fakes.ago(seconds / 60)}]
        self.assertEqual(live_calls.run_worker(self.deployed(rows=row(30))).status, OK)
        self.assertEqual(live_calls.run_worker(self.deployed(rows=row(120))).status, WARN)
        self.assertEqual(live_calls.run_worker(self.deployed(rows=row(11 * 60))).status, FAIL)

    def test_open_watchdog_alerts_are_listed(self):
        c = self.deployed(alerts=[{"dedupe_key": "stale:sales-desk/rooms", "kind": "stale", "raised_at": fakes.ago(5), "resolved_at": None}])
        self.assertEqual(live_calls.run_alerts(c).status, WARN)

    def test_dns_and_function_up(self):
        c = self.deployed()
        self.assertEqual(live_calls.run_dns(c).status, OK)
        self.assertEqual(live_calls.run_function(c).status, OK)


if __name__ == "__main__":
    unittest.main()
