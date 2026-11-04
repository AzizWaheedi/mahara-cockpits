"""Market research checks (20261103i, contract 4.23): each reads "not set up yet" as ok, never as zero, and turns
warn or fail by its own rule."""
import tempfile
import unittest
from pathlib import Path

import checks as checks_mod
from checks import market_intel as mi
from guard.context import Context
from tests import fakes

NOT_THERE = ("cockpit_market_intel_runs", "cockpit_settings", "cockpit_form_responses")
SETTING = {"key": "market_intel", "value": {"on": True, "mode": "shadow", "usd_cap_month": 25,
                                             "shadow_since": fakes.ago(60 * 24 * 7)}}


def ctx(tables=None, missing=()):
    return Context(fakes.config(Path(tempfile.gettempdir()) / "guardian-market-intel-test"),
                   fakes.FakeDb(tables or {}, missing=missing), None, now=fakes.NOW)


class Registered(unittest.TestCase):
    def test_the_three_checks_are_registered(self):
        ids = [c.id for c in checks_mod.all_checks("native")]
        for i in ("mi-stuck", "mi-missing", "mi-spend"):
            self.assertIn(i, ids)


class NotSetUpYet(unittest.TestCase):
    def test_before_the_deploy_every_check_reads_ok_and_says_why(self):
        c = ctx({}, missing=NOT_THERE)
        for run in (mi.run_stuck, mi.run_missing, mi.run_spend):
            r = run(c)
            self.assertEqual(r.status, "ok", r.summary)
            self.assertIn("Not set up yet", r.summary)
            self.assertNotIn(" 0 ", f" {r.summary} ")

    def test_off_means_nothing_is_expected(self):
        r = mi.run_missing(ctx({"cockpit_settings": [{"key": "market_intel", "value": {"on": False}}]}))
        self.assertEqual(r.status, "ok")
        self.assertIn("Market research is off", r.summary)


class Stuck(unittest.TestCase):
    def run_(self, **row):
        base = dict(id="r1", state="pulling", claim_until=fakes.ago(-30), started_at=fakes.ago(30), attempts=1, sentence=None)
        return mi.run_stuck(ctx({"cockpit_market_intel_runs": [dict(base, **row)]}))

    def test_a_live_lease_is_fine(self):
        self.assertEqual(self.run_().status, "ok")

    def test_a_lapsed_lease_or_a_long_run_fails(self):
        r = self.run_(claim_until=fakes.ago(15))
        self.assertEqual(r.status, "fail")
        self.assertIn("its lease has lapsed", r.summary)
        self.assertEqual(r.items, ["r1"])
        self.assertEqual(self.run_(started_at=fakes.ago(200)).status, "fail")


class Missing(unittest.TestCase):
    def tables(self, runs, answered_min=240):
        return {"cockpit_settings": [SETTING],
                "cockpit_form_responses": [dict(id="a1", task_id="taskMiCedar1", submitted_at=fakes.ago(answered_min),
                                                mode="live", state="submitted", form_key="onboarding")],
                "cockpit_market_intel_runs": runs}

    def test_an_answer_without_a_done_run_warns_with_the_runs_sentence(self):
        r = mi.run_missing(ctx(self.tables([dict(id="r1", task_id="taskMiCedar1", response_id="a1", state="needs_person",
                                                 sentence="Research is too thin to write.", requested_at=fakes.ago(200))])))
        self.assertEqual(r.status, "warn")
        self.assertIn("1 onboarding answer from over 3 hours ago has no finished research. One needs a person: "
                      "Research is too thin to write.", r.summary)

    def test_done_or_young_is_fine(self):
        done = [dict(id="r1", task_id="taskMiCedar1", response_id="a1", state="done", requested_at=fakes.ago(200))]
        self.assertEqual(mi.run_missing(ctx(self.tables(done))).status, "ok")
        self.assertEqual(mi.run_missing(ctx(self.tables([], answered_min=60))).status, "ok")


class Spend(unittest.TestCase):
    def tables(self, *amounts):
        return {"cockpit_settings": [SETTING],
                "cockpit_market_intel_runs": [dict(id=f"r{i}", usd_apify=a, usd_scrapecreators=0.0, requested_at=fakes.ago(60))
                                              for i, a in enumerate(amounts)]}

    def test_under_eighty_percent_warn_and_the_cap(self):
        self.assertEqual(mi.run_spend(ctx(self.tables(1.0, 2.5))).status, "ok")
        self.assertEqual(mi.run_spend(ctx(self.tables(10, 11))).status, "warn")
        r = mi.run_spend(ctx(self.tables(20, 5.4)))
        self.assertEqual(r.status, "fail")
        self.assertIn("USD 25.40 of USD 25.00: new research is refused until the 1st", r.summary)
        self.assertEqual(mi.run_spend(ctx(self.tables())).summary, "This month's research scraping: USD 0.00 of USD 25.00.")


if __name__ == "__main__":
    unittest.main()
