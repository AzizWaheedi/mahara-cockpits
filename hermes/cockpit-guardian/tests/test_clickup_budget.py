"""ClickUp calls a minute for the shared token (checks/clickup_budget.py,
docs/requests/CLICKUP-DOWNGRADE.md section 3.1). Every row is invented."""
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from tests import fakes
import checks as checks_mod
from checks import clickup_budget
from guard.model import FAIL, OK, UNKNOWN, WARN

MEDIA = "cockpit_media_provider_health"
CSM = "cockpit_csm_provider_health"
CEO = "cockpit_ceo_provider_health"
BOARD = "cockpit_board_provider_health"
RUNS = "cockpit_native_media_runs"

# fakes.NOW is 14:00 UTC, 17:00 Kuwait time. Minute 30 ago is 16:30 Kuwait.
AT_30 = "3 Oct 16:30 Kuwait time"


def calls(n, minutes_ago=30, *, provider="clickup", phase="response", status=200, **cols):
    """n ClickUp receipts inside one clock minute, minutes_ago before NOW."""
    start = fakes.NOW - timedelta(minutes=minutes_ago)
    out = []
    for i in range(n):
        r = {"created_at": (start + timedelta(seconds=(i % 59))).isoformat(), "phase": phase, "http_status": status}
        if provider is not None:
            r["provider"] = provider
        r.update(cols)
        out.append(r)
    return out


def board(n, minutes_ago=30, **kw):
    return calls(n, minutes_ago, provider=None, **kw)


def native_run(run_id, n=48, began_ago=35.5, published_ago=29.5):
    """A native run: its cockpit_native_media_runs row and its n receipts, every one
    stamped with one time just before it published, as the VPS writes them (read
    2026-10-29). By default it began at 16:24:30 and published at 16:30:30 Kuwait."""
    began = fakes.NOW - timedelta(minutes=began_ago)
    published = fakes.NOW - timedelta(minutes=published_ago)
    run = {"run_id": run_id, "status": "published", "created_at": began.isoformat(),
           "published_at": published.isoformat()}
    stamp = (published - timedelta(seconds=5)).isoformat()
    receipts = [{"created_at": stamp, "provider": "clickup", "phase": "response", "http_status": 200,
                 "native_run_id": run_id} for _ in range(n)]
    return run, receipts


NATIVE_NOTE = ("The native cycle's receipts carry only the time it published, so its {n} calls are counted in every "
               "minute of its run ({span}): an upper bound.")


def run(tables, **kw):
    db = kw.pop("db", None) or fakes.FakeDb(tables)
    ctx = fakes.ctx(Path(tempfile.mkdtemp()), db=db, host=fakes.FakeHost(fakes.snapshot()))
    return clickup_budget.run_budget(ctx), db


class Readings(unittest.TestCase):
    def test_ok_at_49_names_the_split_and_the_unledgered_vps_workers(self):
        n1, receipts = native_run("n-1", 47)
        r, _ = run({MEDIA: receipts + calls(2), CSM: calls(3, 10), RUNS: [n1]})
        self.assertEqual(r.status, OK)
        self.assertEqual(r.summary, f"Busiest minute in the last hour: up to 49 ClickUp calls at {AT_30} (native cycle "
                                    "47, cockpit jobs 2). " + NATIVE_NOTE.format(n=47, span="16:24 to 16:30") +
                                    " Budget 80; ClickUp allows 100. VPS workers outside these ledgers add more.")
        self.assertEqual(r.evidence["peak"], 49)
        self.assertEqual(r.evidence["peak_at"], "2026-10-03T13:30:00Z")
        self.assertEqual(r.evidence["split"], {"native cycle": 47, "cockpit jobs": 2})
        self.assertEqual(r.evidence["minutes_over_80"], 0)
        self.assertEqual(r.evidence["http_429"], 0)
        self.assertEqual(r.evidence["rows"], {MEDIA: 49, CSM: 3, CEO: 0, BOARD: 0})
        self.assertFalse(r.evidence["truncated"])
        self.assertTrue(r.evidence["native_stamped_at_publish"])
        self.assertTrue(r.evidence["native_counted_across_run"])
        self.assertEqual(r.evidence["native_runs"], [{"run_id": "n-1", "calls": 47, "from": "2026-10-03T13:24:00Z",
                                                      "to": "2026-10-03T13:30:00Z", "window": "run"}])

    def test_80_is_inside_the_budget_and_81_warns(self):
        self.assertEqual(run({MEDIA: calls(80)})[0].status, OK)
        n2, receipts = native_run("n-2", 46)
        r, _ = run({MEDIA: receipts + calls(20), CSM: calls(15), RUNS: [n2]})
        self.assertEqual(r.status, WARN)
        self.assertEqual(r.summary, f"Up to 81 ClickUp calls in one minute at {AT_30} (native cycle 46, cockpit jobs "
                                    "20, CSM ledger 15), over the budget of 80. VPS workers outside these ledgers add "
                                    "more, so ClickUp may already be refusing calls. " +
                                    NATIVE_NOTE.format(n=46, span="16:24 to 16:30"))
        self.assertEqual(r.evidence["minutes_over_80"], 1)

    def test_95_warns_and_96_fails(self):
        self.assertEqual(run({MEDIA: calls(95)})[0].status, WARN)
        n3, receipts = native_run("n-3", 48)
        r, _ = run({MEDIA: receipts + calls(30), CSM: calls(18), RUNS: [n3]})
        self.assertEqual(r.status, FAIL)
        self.assertEqual(r.summary, f"Up to 96 ClickUp calls in one minute at {AT_30} (native cycle 48, cockpit jobs "
                                    "30, CSM ledger 18), at ClickUp's limit of 100. Requests reach ClickUp late and "
                                    "presses in the cockpit can fail. " + NATIVE_NOTE.format(n=48, span="16:24 to 16:30"))
        self.assertIsNotNone(r.since)

    def test_one_429_warns_and_ten_fail_even_in_a_quiet_hour(self):
        r, _ = run({MEDIA: calls(5) + calls(1, 20, status=429)})
        self.assertEqual(r.status, WARN)
        self.assertEqual(r.summary, f"ClickUp refused 1 calls with 429 in the last hour. Busiest minute: 5 at {AT_30} "
                                    "(cockpit jobs 5).")
        self.assertEqual(r.evidence["http_429"], 1)
        r, _ = run({MEDIA: calls(4, status=429), CSM: calls(6, 12, status="429")})
        self.assertEqual(r.status, FAIL)
        self.assertTrue(r.summary.startswith("ClickUp refused 10 calls with 429 in the last hour. Busiest minute: 6 at"))
        self.assertEqual(r.evidence["http_429"], 10)

    def test_a_429_beside_a_minute_over_the_budget_is_said_too(self):
        r, _ = run({MEDIA: calls(84) + calls(1, 5, status=429)})
        self.assertEqual(r.status, WARN)
        self.assertTrue(r.summary.startswith("84 ClickUp calls in one minute"))
        self.assertTrue(r.summary.endswith("ClickUp refused 1 calls with 429 in the last hour."))

    def test_no_row_at_all_is_unknown_never_ok(self):
        r, _ = run({})
        self.assertEqual(r.status, UNKNOWN)
        self.assertEqual(r.summary, "No ClickUp call is recorded in the last hour, though the task mirror reads ClickUp "
                                    "every 2 minutes. The ledgers may have stopped; this is not zero.")


class WhatCounts(unittest.TestCase):
    def test_rows_older_than_an_hour_intent_rows_and_other_providers_are_not_counted(self):
        tables = {
            MEDIA: calls(10) + calls(90, 61) + calls(90, phase="intent") + calls(90, provider="meta"),
            CSM: calls(90, 75) + calls(90, provider="ghl"),
            CEO: calls(90, phase="intent"),
            BOARD: board(90, 65) + board(90, phase="intent"),
        }
        r, _ = run(tables)
        self.assertEqual(r.status, OK)
        self.assertEqual(r.evidence["peak"], 10)
        self.assertEqual(r.evidence["rows"], {MEDIA: 10, CSM: 0, CEO: 0, BOARD: 0})

    def test_unknown_phase_rows_count_as_calls(self):
        r, _ = run({MEDIA: calls(40) + calls(41, phase="unknown")})
        self.assertEqual((r.status, r.evidence["peak"]), (WARN, 81))

    def test_the_board_ledger_counts_though_it_has_no_provider_column(self):
        r, db = run({MEDIA: calls(60), BOARD: board(25)})
        self.assertEqual(r.status, WARN)
        self.assertEqual(r.evidence["split"], {"cockpit jobs": 60, "board levers": 25})
        self.assertIn(BOARD, db.reads)

    def test_the_split_names_the_native_cycle_and_the_ceo_refresh(self):
        r, _ = run({MEDIA: calls(47, native_run_id="n-4"), CEO: calls(2, run_id="r-1") + calls(1, refresh_id="f-1") +
                    calls(3)})
        self.assertEqual(r.evidence["split"], {"native cycle": 47, "CEO refresh": 3, "CEO ledger": 3})
        self.assertIn("(native cycle 47, CEO refresh 3, CEO ledger 3)", r.summary)

    def test_calls_in_different_minutes_are_not_added_together(self):
        r, _ = run({MEDIA: calls(50, 30), CSM: calls(50, 31)})
        self.assertEqual((r.status, r.evidence["peak"], r.evidence["minutes_over_80"]), (OK, 50, 0))

    def test_a_ledger_at_the_1000_row_page_is_marked_at_least(self):
        rows = []
        for m in range(1, 59):
            rows += calls(18, m)
        r, _ = run({MEDIA: rows})
        self.assertGreaterEqual(len(rows), 1000)
        self.assertTrue(r.evidence["truncated"])
        self.assertTrue(r.summary.endswith("At least: one ledger hit its 1,000-row page."))
        self.assertEqual(r.status, OK)


class NativeRuns(unittest.TestCase):
    """The native cycle stamps every receipt of a run with its publish time, so a run's
    calls are counted in every minute of the run, not in the minute it published."""

    def test_a_run_counts_in_every_minute_it_ran_not_only_where_it_published(self):
        # 48 native calls made some time between 16:24:30 and 16:30:30, all stamped 16:30:25.
        # The task mirror's 35 at 16:27 may have met them: up to 83. Counted at the
        # publish minute alone, the busiest minute would read 58 (16:30) and pass.
        n5, receipts = native_run("n-5", 48)
        r, db = run({MEDIA: receipts + calls(35, 33) + calls(10, 30), RUNS: [n5]})
        self.assertEqual(r.status, WARN)
        self.assertEqual((r.evidence["peak"], r.evidence["peak_at"]), (83, "2026-10-03T13:27:00Z"))
        self.assertEqual(r.evidence["split"], {"native cycle": 48, "cockpit jobs": 35})
        self.assertEqual(r.evidence["minutes_over_80"], 1)
        self.assertTrue(r.summary.startswith("Up to 83 ClickUp calls in one minute at 3 Oct 16:27 Kuwait time (native "
                                             "cycle 48, cockpit jobs 35), over the budget of 80."))
        self.assertTrue(r.summary.endswith(NATIVE_NOTE.format(n=48, span="16:24 to 16:30")))
        self.assertIn(RUNS, db.reads)

    def test_minutes_outside_the_run_get_none_of_its_calls(self):
        n6, receipts = native_run("n-6", 48)
        r, _ = run({MEDIA: receipts + calls(40, 40) + calls(40, 25), RUNS: [n6]})
        self.assertEqual(r.status, OK)
        self.assertEqual((r.evidence["peak"], r.evidence["peak_at"]), (48, "2026-10-03T13:30:00Z"))
        self.assertEqual(r.evidence["split"], {"native cycle": 48})

    def test_a_run_not_in_the_runs_table_is_taken_as_the_15_minutes_before_its_receipts(self):
        _, receipts = native_run("n-7", 48)
        r, _ = run({MEDIA: receipts + calls(35, 44) + calls(35, 45)})
        self.assertEqual(r.status, WARN)
        self.assertEqual((r.evidence["peak"], r.evidence["peak_at"]), (83, "2026-10-03T13:16:00Z"))
        self.assertEqual(r.evidence["native_runs"], [{"run_id": "n-7", "calls": 48, "from": "2026-10-03T13:16:00Z",
                                                      "to": "2026-10-03T13:30:00Z", "window": "assumed"}])
        self.assertTrue(r.summary.endswith(NATIVE_NOTE.format(
            n=48, span="16:16 to 16:30, assumed: the run is not in cockpit_native_media_runs")))

    def test_a_run_that_began_before_the_hour_is_counted_from_the_hour(self):
        n8, receipts = native_run("n-8", 20, began_ago=63, published_ago=57.5)
        r, _ = run({MEDIA: receipts, RUNS: [n8]})
        self.assertEqual(r.evidence["native_runs"][0]["from"], "2026-10-03T13:00:00Z")
        self.assertEqual(r.evidence["native_runs"][0]["to"], "2026-10-03T13:02:00Z")
        self.assertEqual((r.status, r.evidence["peak"], r.evidence["peak_at"]), (OK, 20, "2026-10-03T13:02:00Z"))

    def test_two_runs_in_the_hour_each_keep_to_their_own_minutes(self):
        a, ra = native_run("n-9", 47, began_ago=35.5, published_ago=29.5)
        b, rb = native_run("n-10", 46, began_ago=20.5, published_ago=14.5)
        r, _ = run({MEDIA: ra + rb + calls(30, 17), RUNS: [a, b]})
        self.assertEqual((r.evidence["peak"], r.evidence["peak_at"]), (76, "2026-10-03T13:43:00Z"))
        self.assertEqual(r.evidence["split"], {"native cycle": 46, "cockpit jobs": 30})
        self.assertEqual([x["run_id"] for x in r.evidence["native_runs"]], ["n-10", "n-9"])

    def test_a_run_row_that_disagrees_with_its_receipts_never_drops_their_calls(self):
        # The row says it published at 16:08, the receipts say 16:30: both minutes count.
        n12, receipts = native_run("n-12", 30)
        n12.update(created_at=(fakes.NOW - timedelta(minutes=55)).isoformat(),
                   published_at=(fakes.NOW - timedelta(minutes=52)).isoformat())
        r, _ = run({MEDIA: receipts, RUNS: [n12]})
        self.assertEqual((r.evidence["native_runs"][0]["from"], r.evidence["native_runs"][0]["to"]),
                         ("2026-10-03T13:05:00Z", "2026-10-03T13:30:00Z"))
        # A row stamped after the scan (a clock ahead): the calls stay in the receipts' minute.
        n13, receipts = native_run("n-13", 30, began_ago=-5, published_ago=-2)
        for x in receipts:
            x["created_at"] = (fakes.NOW + timedelta(seconds=50)).isoformat()
        r, _ = run({MEDIA: receipts, RUNS: [n13]})
        self.assertEqual((r.evidence["native_runs"][0]["from"], r.evidence["native_runs"][0]["to"]),
                         ("2026-10-03T14:00:00Z", "2026-10-03T14:00:00Z"))
        self.assertEqual((r.evidence["peak"], r.evidence["peak_at"]), (30, "2026-10-03T14:00:00Z"))

    def test_no_native_receipt_reads_no_runs(self):
        r, db = run({MEDIA: calls(10)})
        self.assertNotIn(RUNS, db.reads)
        self.assertEqual(r.evidence["native_runs"], [])
        self.assertNotIn("native cycle", r.summary)

    def test_an_unreadable_runs_table_never_reads_ok(self):
        _, receipts = native_run("n-11", 48)
        r, _ = run({}, db=fakes.FakeDb({MEDIA: receipts}, missing=(RUNS,)))
        self.assertEqual(r.status, UNKNOWN)
        self.assertEqual(r.evidence["unread"], [RUNS])
        self.assertTrue(r.summary.endswith("cockpit_native_media_runs could not be read, so each native run is taken "
                                           "to have run for the 15 minutes before its receipts."))
        r, _ = run({}, db=fakes.FakeDb({MEDIA: receipts + calls(35, 40)}, missing=(RUNS,)))
        self.assertEqual(r.status, WARN)


class Unreadable(unittest.TestCase):
    def test_a_ledger_that_cannot_be_read_never_reads_ok(self):
        db = fakes.FakeDb({MEDIA: calls(30)}, missing=(BOARD,))
        r, _ = run({}, db=db)
        self.assertEqual(r.status, UNKNOWN)
        self.assertTrue(r.summary.endswith(f"At least: {BOARD} could not be read."))
        self.assertEqual(r.evidence["unread"], [BOARD])
        self.assertIsNone(r.evidence["rows"][BOARD])

    def test_over_the_budget_in_what_could_be_read_still_warns(self):
        db = fakes.FakeDb({MEDIA: calls(85)}, missing=(CSM,))
        r, _ = run({}, db=db)
        self.assertEqual(r.status, WARN)
        self.assertIn(f"At least: {CSM} could not be read.", r.summary)

    def test_no_ledger_read_at_all_is_unknown_and_folds_into_the_database(self):
        r, _ = run({}, db=fakes.FakeDb({}, down=True))
        self.assertEqual(r.status, UNKNOWN)
        self.assertEqual(r.caused_by, "supabase-health")
        self.assertIn("None of the four ClickUp ledgers could be read", r.summary)


class Registered(unittest.TestCase):
    def test_the_check_is_in_the_scan_after_the_syncs_with_its_fields(self):
        ids = [c.id for c in checks_mod.all_checks()]
        self.assertIn("clickup-rate-budget", ids)
        self.assertEqual(ids.index("clickup-rate-budget"), ids.index("b2b-sources") + 1)
        c = checks_mod.by_id()["clickup-rate-budget"]
        self.assertEqual((c.area, c.name, c.severity, c.owner, c.confirm, c.clear),
                         ("providers", "ClickUp calls a minute", "medium", "the systems manager", 2, 2))
        self.assertEqual(c.threshold, "Any minute in the last hour over 80: warn; over 95: fail. Any 429 in the hour: "
                                      "warn; 10 or more: fail.")
        for name in ("CLICKUP_REQUESTS_CALLS_PER_MINUTE", "CLICKUP_CALLS_PER_MINUTE",
                     "CLICKUP_TASKS_CALLS_PER_MINUTE", "CLICKUP_FORMS_CALLS_PER_MINUTE",
                     "docs/requests/CLICKUP-DOWNGRADE.md"):
            self.assertIn(name, c.action)
        for table in (MEDIA, CSM, CEO, BOARD, RUNS):
            self.assertIn(table, c.reads)


if __name__ == "__main__":
    unittest.main()
