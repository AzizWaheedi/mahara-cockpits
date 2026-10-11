"""Live calls: every check says "not deployed yet" while its piece is missing."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

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
    """Production on 2026-10-03, before anything was deployed: nothing remembered as deployed either."""

    def setUp(self):
        patcher = mock.patch.dict(live_calls.DEPLOYED, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

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


class StateLost(unittest.TestCase):
    """2026-10-07 and later: the pieces deployed by then are remembered in the code, so a guardian whose state
    was lost (~/.cockpit-guardian removed) or that reads a new, empty project says they are gone."""

    def test_remembered_pieces_are_the_ones_seen_on_the_vps(self):
        self.assertEqual(set(live_calls.DEPLOYED),
                         {"live-tables", "live-cron", "live-alerts", "live-function", "live-rooms-worker"})

    def test_missing_tables_and_function_fail_with_no_state(self):
        c = today()
        self.assertEqual(c.state, {})
        for check in live_calls.CHECKS:
            if check.id not in ("live-tables", "live-function", "live-cron", "live-alerts"):
                continue
            r = check.run(c)
            self.assertEqual(r.status, FAIL, (check.id, r.summary))
            self.assertIn("was deployed", r.summary)
            self.assertTrue((r.data or {}).get("missing"), check.id)

    def test_the_call_page_never_deployed_still_reads_not_deployed(self):
        r = next(c for c in live_calls.CHECKS if c.id == "live-dns").run(today())
        self.assertEqual(r.status, NOT_DEPLOYED)


LIVE_FILES = {"sales-api": ["clientforms.ts", "clients.ts", "contracts.ts", "dialer.ts", "followupAgent.ts", "hot.ts",
                            "index.ts", "lib.ts", "liveio.ts", "proposals.ts", "roomlogic.ts", "rooms.ts", "sendrules.ts"],
              "sales-live": ["cron.ts", "door.ts", "handler.ts", "index.ts", "sign.ts", "slack.ts", "util.ts", "zoom.ts"]}
OLD_BRANCH_FILES = {"sales-api": ["clientforms.ts", "clients.ts", "contracts.ts", "dialer.ts", "hot.ts", "index.ts",
                                  "lib.ts", "proposals.ts"], "sales-live": LIVE_FILES["sales-live"]}


def listed(api=65, live=2):
    return [{"slug": "sales-api", "status": "ACTIVE", "version": api, "verify_jwt": True, "ezbr_sha256": f"a{api}"},
            {"slug": "sales-live", "status": "ACTIVE", "version": live, "verify_jwt": False, "ezbr_sha256": f"l{live}"}]


class DeployedCode(unittest.TestCase):
    def run_code(self, files, state, functions=None):
        db = fakes.FakeDb({}, functions=functions or listed(), files=files)
        return live_calls.run_code(fakes.ctx(Path(tempfile.mkdtemp()), db=db, state=state)), db

    def test_the_live_calls_code_is_ok_and_read_once_per_deploy(self):
        state = {}
        r, db = self.run_code(LIVE_FILES, state)
        self.assertEqual(r.status, OK, r.summary)
        self.assertEqual(sorted(db.file_reads), ["sales-api", "sales-live"])
        r, db = self.run_code(LIVE_FILES, state)
        self.assertEqual((r.status, db.file_reads), (OK, []))

    def test_a_deploy_from_the_old_branch_fails_urgent(self):
        state = {}
        self.run_code(LIVE_FILES, state)
        r, db = self.run_code(OLD_BRANCH_FILES, state, functions=listed(api=66))
        self.assertEqual(r.status, FAIL)
        self.assertTrue(r.urgent)
        self.assertEqual(db.file_reads, ["sales-api"])
        self.assertIn("sales-api v66 was deployed without rooms.ts, roomlogic.ts, liveio.ts, followupAgent.ts, "
                      "sendrules.ts", r.summary)

    def test_sales_live_gone_from_the_list_fails(self):
        r, _ = self.run_code(LIVE_FILES, {}, functions=listed()[:1])
        self.assertEqual(r.status, FAIL)
        self.assertIn("sales-live is not deployed", r.summary)

    # Composio deploys a function as one bun bundle: the API gives back a single index.ts (2026-10-11,
    # sales-api v71), so the module names are gone and the code has to be read for its strings.
    @staticmethod
    def bundle(*skip: str) -> bytes:
        marks = [m for mod, ms in live_calls.LIVE_MARKERS["sales-api"].items() if mod not in skip for m in ms]
        code = "\n".join(f"// {m}\nconst x{i} = 1;" for i, m in enumerate(marks))
        return (b'--b\r\nContent-Disposition: form-data; name="file"; filename="source/index.ts"\r\n\r\n'
                + code.encode() + b"\r\n--b--\r\n")

    def run_bundle(self, body, state, api=71):
        db = fakes.FakeDb({}, functions=listed(api=api), files=LIVE_FILES, bodies={"sales-api": body})
        return live_calls.run_code(fakes.ctx(Path(tempfile.mkdtemp()), db=db, state=state)), db

    def test_a_bundled_deploy_with_the_live_calls_code_is_ok(self):
        state = {}
        r, db = self.run_bundle(self.bundle(), state)
        self.assertEqual(r.status, OK, r.summary)
        self.assertIn("sales-api v71 (one bundle: found by its code)", r.summary)
        self.assertEqual(state["live_code"]["sales-api"]["by"], "strings")
        self.assertEqual(state["live_code"]["sales-live"]["by"], "files")
        r, db = self.run_bundle(self.bundle(), state)
        self.assertEqual((r.status, db.file_reads), (OK, []))

    def test_a_bundle_from_the_old_branch_still_fails_urgent(self):
        r, _ = self.run_bundle(b'--b\r\nfilename="source/index.ts"\r\n\r\nexport const clients = 1;\r\n--b--', {})
        self.assertEqual(r.status, FAIL)
        self.assertTrue(r.urgent)
        self.assertIn("sales-api v71 was deployed without rooms.ts, roomlogic.ts, liveio.ts, followupAgent.ts, "
                      "sendrules.ts", r.summary)

    def test_a_bundle_without_one_module_names_that_module(self):
        r, _ = self.run_bundle(self.bundle("sendrules.ts"), {})
        self.assertEqual(r.status, FAIL)
        self.assertIn("sales-api v71 was deployed without sendrules.ts", r.summary)

    def test_a_record_read_by_file_names_only_is_read_again_once(self):
        """The VPS state of 2026-10-10 holds sales-api v71 as missing all five (read by names only)."""
        state = {"live_code": {"sales-api": {"key": "v71:a71", "missing": list(live_calls.LIVE_MODULES["sales-api"]),
                                             "modules": 1, "read_at": fakes.ago(60)}}}
        r, db = self.run_bundle(self.bundle(), state)
        self.assertEqual(r.status, OK, r.summary)
        self.assertIn("sales-api", db.file_reads)

    def test_every_marker_comes_from_its_module(self):
        """At least one string per module is in that module's source on main, so a rename shows up here."""
        root = Path(__file__).resolve().parents[3] / "supabase" / "functions"
        if not root.is_dir():
            self.skipTest("no supabase/functions next to this copy (the VPS copy)")
        for slug, mods in live_calls.LIVE_MARKERS.items():
            self.assertEqual(sorted(mods), sorted(live_calls.LIVE_MODULES[slug]))
            for mod, marks in mods.items():
                text = (root / slug / mod).read_text(encoding="utf-8")
                self.assertTrue(any(m in text for m in marks), (slug, mod))

    def test_without_the_token_it_is_a_coverage_gap(self):
        r = live_calls.run_code(fakes.ctx(Path(tempfile.mkdtemp()), db=fakes.FakeDb({}), state={}))
        self.assertTrue(r.coverage_gap)


if __name__ == "__main__":
    unittest.main()
