"""hiring-sync (2026-10-11): the Typeform applications reach HighLevel and the hiring board is copied in.

Convex stopped on 2026-10-07 and the Supabase jobs were never switched on, so nothing filed a single
application for days while every check read green. Missing is never healthy: no hiring-sync row fails.
"""
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from tests import fakes
import checks as checks_mod
from checks import edge_functions, pg_cron, worker_status
from guard import engine
from guard.model import FAIL, OK, UNKNOWN, WARN

BOARD_STOPPED = "2026-10-07T22:40:00+00:00"     # 2026-10-08 01:40 Kuwait time, the last Convex copy


def state(job, *, ok=True, ok_min=5, note=None):
    return {"key": f"hiring-sync:{job}", "ok": ok, "note": note or f"{job} ok",
            "last_run_at": fakes.ago(5 if ok_min is None else min(ok_min, 5)), "last_ok_at": None if ok_min is None else fakes.ago(ok_min)}


def healthy(**over):
    rows = {"mirror": state("mirror"), "intake": state("intake", ok_min=20, note="12 read, 3 added, 9 skipped"),
            "engine": state("engine")}
    rows.update(over)
    return [r for r in rows.values() if r is not None]


def run(sync_rows, board=None):
    board = [{"synced_at": fakes.ago(4)}] if board is None else board
    db = fakes.FakeDb({"cockpit_sync_state": sync_rows + [{"key": "tap-charges-sync", "ok": True}],
                       "cockpit_hiring_candidates": board})
    return worker_status.run_hiring_sync(fakes.ctx(Path(tempfile.mkdtemp()), db=db))


class NeverSwitchedOn(unittest.TestCase):
    def test_today_no_row_fails_and_says_where_the_board_stopped(self):
        r = run([], board=[{"synced_at": BOARD_STOPPED}])
        self.assertEqual(r.status, FAIL)
        self.assertIn("hiring-sync has never run on Supabase; the board copy stopped at 8 Oct 01:40 Kuwait time",
                      r.summary)
        self.assertEqual(r.items, ["never-run"])
        self.assertIn("GHL_HIRING_PIT, GHL_HIRING_LOCATION and HIRING_APPLY=true", r.action)
        self.assertIn("20261009c", r.action)

    def test_an_empty_board_with_no_row_still_fails(self):
        r = run([], board=[])
        self.assertEqual(r.status, FAIL)
        self.assertIn("the board copy is empty", r.summary)

    def test_a_table_that_cannot_be_read_is_unknown_not_ok(self):
        db = fakes.FakeDb({"cockpit_sync_state": []}, missing=("cockpit_hiring_candidates",))
        c = fakes.ctx(Path(tempfile.mkdtemp()), db=db)
        f = engine.run_checks(c, [checks_mod.by_id()["hiring-sync"]])[0]
        self.assertEqual(f.result.status, UNKNOWN)


class Thresholds(unittest.TestCase):
    def test_all_three_jobs_on_time_and_a_fresh_board_is_ok(self):
        r = run(healthy())
        self.assertEqual(r.status, OK, r.summary)

    def test_mirror_without_a_good_run_for_more_than_30_minutes_fails(self):
        self.assertEqual(run(healthy(mirror=state("mirror", ok_min=29))).status, OK)
        r = run(healthy(mirror=state("mirror", ok_min=31)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("mirror-stale", r.items)
        self.assertIn("mirror (the board copy from HighLevel) has had no good run for", r.summary)

    def test_intake_gets_90_minutes(self):
        self.assertEqual(run(healthy(intake=state("intake", ok_min=85))).status, OK)
        r = run(healthy(intake=state("intake", ok_min=95)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("intake-stale", r.items)

    def test_engine_without_a_good_run_for_more_than_30_minutes_fails(self):
        r = run(healthy(engine=state("engine", ok_min=45)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("engine-stale", r.items)

    def test_a_job_that_never_ran_fails(self):
        r = run(healthy(engine=None))
        self.assertEqual(r.status, FAIL)
        self.assertIn("engine-never-run", r.items)

    def test_ok_false_fails_with_its_note(self):
        note = "The hiring sub-account is not connected: set GHL_HIRING_PIT and GHL_HIRING_LOCATION as Edge Function secrets."
        r = run(healthy(intake=state("intake", ok=False, ok_min=None, note=note)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("intake-failing", r.items)
        self.assertIn("not connected", r.summary)

    def test_a_stale_board_fails_even_when_the_rows_say_ok(self):
        r = run(healthy(), board=[{"synced_at": fakes.ago(31)}])
        self.assertEqual(r.status, FAIL)
        self.assertEqual(r.items, ["board-stale"])

    def test_an_intake_dry_run_without_hiring_apply_warns(self):
        note = "Dry run: 14 unseen applications, nothing written (HIRING_APPLY is not true)"
        r = run(healthy(intake=state("intake", ok_min=20, note=note)))
        self.assertEqual(r.status, WARN)
        self.assertIn("HIRING_APPLY is not true: applications are read but not filed", r.summary)

    def test_the_first_intake_run_is_dry_on_purpose_and_only_a_lasting_one_warns(self):
        note = ("Dry run on purpose, the first intake run: 40 unseen applications listed, nothing written. "
                "The next run files them")
        st = {}
        rows = healthy(intake=state("intake", ok_min=5, note=note))
        db = fakes.FakeDb({"cockpit_sync_state": rows, "cockpit_hiring_candidates": [{"synced_at": fakes.ago(4)}]})
        r = worker_status.run_hiring_sync(fakes.ctx(Path(tempfile.mkdtemp()), db=db, state=st))
        self.assertEqual(r.status, OK, r.summary)
        self.assertIn("dry run on purpose", r.summary)
        later = fakes.ctx(Path(tempfile.mkdtemp()), db=db, state=st)
        later.now = fakes.NOW + timedelta(minutes=80)
        db.tables["cockpit_hiring_candidates"] = [{"synced_at": later.now.isoformat()}]
        for r_ in db.tables["cockpit_sync_state"]:
            r_["last_ok_at"] = later.now.isoformat()
        r = worker_status.run_hiring_sync(later)
        self.assertEqual(r.status, WARN)
        self.assertIn("has filed nothing for", r.summary)
        db.tables["cockpit_sync_state"] = [dict(x, note="40 read, 40 added, 0 skipped") if x["key"].endswith("intake")
                                           else x for x in db.tables["cockpit_sync_state"]]
        filed = fakes.ctx(Path(tempfile.mkdtemp()), db=db, state=st)
        filed.now = later.now
        self.assertEqual(worker_status.run_hiring_sync(filed).status, OK)
        self.assertNotIn("hiring_intake_dry_since", st["history"])

    def test_a_failure_outranks_the_dry_run_warning(self):
        note = "Dry run: 14 unseen applications, nothing written (HIRING_APPLY is not true)"
        r = run(healthy(intake=state("intake", ok_min=20, note=note), mirror=state("mirror", ok_min=60)))
        self.assertEqual(r.status, FAIL)


class Registered(unittest.TestCase):
    def test_the_check_is_in_the_scan_with_no_automatic_fix(self):
        c = checks_mod.by_id()["hiring-sync"]
        self.assertEqual((c.area, c.severity, c.fix), ("workers", "high", None))

    def test_the_hiring_jobs_and_functions_are_expected(self):
        for job in ("mahara-hiring-mirror", "mahara-hiring-intake", "mahara-hiring-engine"):
            self.assertIn(job, pg_cron.EXPECTED_JOBS)
        # 21 + mahara-eod-retry (20261015190100) + mahara-slack-notices (20261025n) + mahara-creative-drain (20261025o)
        # + mahara-clickup-writeback-requests (20261026r) + mahara-task-mirror and mahara-task-mirror-seats (20261026t)
        self.assertEqual(len(pg_cron.EXPECTED_JOBS), 27)
        self.assertIs(edge_functions.EXPECTED["hiring-sync"], False)
        self.assertIs(edge_functions.EXPECTED["hiring-api"], True)

    def test_a_missing_hiring_job_fails_pg_cron_jobs(self):
        jobs = [{"jobid": i, "jobname": n, "schedule": "* * * * *", "active": True}
                for i, n in enumerate(pg_cron.EXPECTED_JOBS) if not n.startswith("mahara-hiring-")]
        c = fakes.ctx(Path(tempfile.mkdtemp()), db=fakes.FakeDb(probe={"cron_jobs": jobs, "cron_runs": [], "http_1h": {}}))
        r = pg_cron.run_jobs(c)
        self.assertEqual(r.status, FAIL)
        self.assertEqual(r.items, ["mahara-hiring-engine", "mahara-hiring-intake", "mahara-hiring-mirror"])


if __name__ == "__main__":
    unittest.main()
