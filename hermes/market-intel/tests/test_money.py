"""The spend meter and the Apify runner: the run and month caps are enforced before a pull starts, Apify gets its
own ceilings, a known run is read again instead of started, the ledger comes first, and no key leaks."""
import json
import unittest
from unittest import mock

from mi import apify as apify_mod
from mi import http
from mi.apify import Apify, Job
from mi.ledger import Ledger, LedgerDown, memory_ledger
from mi.meter import BudgetRefused, Meter, from_claim
from mi.scrapecreators import ScrapeCreators
from tests import fakes


class MeterRules(unittest.TestCase):
    def test_the_run_cap_and_the_month_cap_refuse_before_the_pull(self):
        m = Meter(cap_run=2.0, cap_month=25.0, month_before=24.9)
        with self.assertRaises(BudgetRefused) as e:
            m.reserve("the client's reviews", 0.2)
        self.assertTrue(e.exception.sentence.startswith("Not checked: the client's reviews. The month's research budget "
                                                        "would pass USD 25.00 (USD 24.90 spent). Raise usd_cap_month or wait for 1 "))
        m = Meter(cap_run=0.5, cap_month=25.0, month_before=0)
        m.add_apify(0.45)
        with self.assertRaises(BudgetRefused) as e:
            m.reserve("the rivals' Instagram", 0.1)
        self.assertEqual(e.exception.sentence, "Not checked: the rivals' Instagram. This run's scraping budget would pass "
                                               "USD 0.50 (USD 0.45 spent).")
        m.reserve("a cheap pull", 0.04)
        self.assertEqual(len(m.refused), 1)

    def test_an_unreadable_month_is_never_zero(self):
        m = Meter(cap_run=2, cap_month=25, month_before=None)
        with self.assertRaises(BudgetRefused) as e:
            m.reserve("anything", 0.0)
        self.assertIn("could not be read", e.exception.sentence)
        self.assertEqual(m.remaining(), 0.0)

    def test_from_a_claim_the_lower_cap_wins_and_the_runs_own_spend_is_carried(self):
        m = from_claim({"caps": {"run": 5, "month": 10}, "monthUsd": 3.0,
                        "spend": {"usdApify": 0.5, "usdScrapeCreators": 0.1, "creditsScrapeCreators": 53}},
                       cap_run_code=2.0, cap_month_code=25.0, sc_rate=0.0019)
        self.assertEqual((m.cap_run, m.cap_month), (2.0, 10))
        self.assertAlmostEqual(m.month_before, 2.4)
        self.assertEqual(m.credits_sc, 53)
        self.assertEqual(m.spend()["usdApify"], 0.5)
        self.assertIsNone(from_claim({"caps": {}, "monthUsd": None}, cap_run_code=2, cap_month_code=25, sc_rate=0.002).month_before)

    def test_a_hold_counts_until_the_pull_ends(self):
        m = Meter(cap_run=0.10, cap_month=25, month_before=0)
        held = m.reserve("one Maps search", 0.03, ceiling=0.09)
        self.assertAlmostEqual(held, 0.09)
        self.assertAlmostEqual(m.remaining(), 0.01)
        with self.assertRaises(BudgetRefused) as e:
            m.reserve("a second Maps search", 0.03)
        self.assertEqual(e.exception.sentence, "Not checked: a second Maps search. This run's scraping budget would pass "
                                               "USD 0.10 (USD 0.00 spent, USD 0.09 held by pulls still running).")
        m.settle(held, 0.031)
        self.assertEqual((m.held, round(m.run_usd, 3)), (0.0, 0.031))
        self.assertAlmostEqual(m.reserve("a second Maps search", 0.03), 0.03)
        m.set_caps({"run": 0.05, "month": "x"}, cap_run_code=2, cap_month_code=25)
        self.assertEqual((m.cap_run, m.cap_month), (0.05, 25))

    def test_scrapecreators_reserves_its_credits_first(self):
        calls = []
        led, rows = memory_ledger()
        m = Meter(cap_run=2, cap_month=25, month_before=25)
        sc = ScrapeCreators("sc-key-test", led, m, get=fakes.sc_get(calls))
        with self.assertRaises(BudgetRefused):
            sc.instagram_profile("cedar.invented", label="followers")
        self.assertEqual((calls, rows), ([], []))
        m = Meter(cap_run=2, cap_month=25, month_before=0)
        sc = ScrapeCreators("sc-key-test", led, m, get=fakes.sc_get(calls))
        sc.fb_company_ads("1", country="KW", pages=2, label="ads")
        self.assertEqual(m.credits_sc, 1)
        self.assertEqual(m.held, 0.0, "the hold goes back once the credits are counted")
        self.assertNotIn("sc-key-test", json.dumps(rows))


class FakeApifyHttp:
    """Apify's REST shapes. `polls`: how many reads a run answers RUNNING before it ends. `charge_ceiling`: a run
    spends its whole maxTotalChargeUsd (the worst case the caps must hold against)."""

    def __init__(self, polls=0, charge_ceiling=False, post_error=None):
        self.posts, self.gets, self.post_kw, self.aborts = [], [], [], []
        self.polls, self.charge_ceiling, self.post_error = polls, charge_ceiling, post_error
        self.seen: dict[str, int] = {}
        self.ceiling: dict[str, float] = {}

    def post_json(self, url, payload, **kw):
        if self.post_error:
            raise self.post_error
        self.posts.append(url)
        self.post_kw.append(kw)
        run = f"run{len(self.posts)}"
        q = dict(x.split("=", 1) for x in url.split("?", 1)[1].split("&"))
        self.ceiling[run] = float(q["maxTotalChargeUsd"])
        return {"data": {"id": run}}

    def get_json(self, url, **kw):
        self.gets.append(url)
        if "/actor-runs/" in url:
            run = url.split("/actor-runs/")[1].split("?")[0]
            self.seen[run] = self.seen.get(run, 0) + 1
            usd = self.ceiling.get(run, 0.031) if self.charge_ceiling else 0.031
            if run in self.aborts:
                return {"data": {"status": "ABORTED", "usageTotalUsd": 0.04}}
            if self.seen[run] <= self.polls:
                return {"data": {"status": "RUNNING", "usageTotalUsd": 0.0}}
            return {"data": {"status": "SUCCEEDED", "usageTotalUsd": usd, "defaultDatasetId": "ds1"}}
        if "/datasets/" in url:
            return [{"title": "Invented"}]
        raise AssertionError(url)

    def request(self, method, url, **kw):
        if url.split("?")[0].endswith("/abort"):
            self.aborts.append(url.split("/actor-runs/")[1].split("/")[0])
        return 200, {}, b""


class ApifyRunner(unittest.TestCase):
    def setUp(self):
        self.fake = FakeApifyHttp()
        self.patch = mock.patch.multiple(apify_mod.http, post_json=self.fake.post_json, get_json=self.fake.get_json,
                                         request=self.fake.request)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.ledger, self.rows = memory_ledger()
        self.started = []

    def runner(self, meter, **kw):
        return Apify("apify-key-test", self.ledger, meter, poll_sec=0, sleep=lambda s: None,
                     on_started=lambda k, r: self.started.append((k, r)), **kw)

    def job(self, key="A:maps", est=0.01):
        return Job(key, "compass~crawler-google-places", {"startUrls": []}, "the client's Maps listing", est, 3)

    def test_a_run_starts_with_its_ceilings_and_counts_its_cost(self):
        m = Meter(cap_run=2, cap_month=25, month_before=0)
        res = self.runner(m).run_batch([self.job()])["A:maps"]
        self.assertTrue(res.ok)
        self.assertEqual(res.items, [{"title": "Invented"}])
        self.assertAlmostEqual(m.usd_apify, 0.031)
        self.assertIn("maxItems=3", self.fake.posts[0])
        self.assertIn("maxTotalChargeUsd=0.05", self.fake.posts[0])
        self.assertEqual(self.started, [("A:maps", "run1")])
        self.assertTrue(all("apify-key-test" not in r["resource"] for r in self.rows))
        self.assertEqual(self.rows[0]["phase"], "intent")

    def test_a_refused_reserve_starts_nothing(self):
        m = Meter(cap_run=0.005, cap_month=25, month_before=0)
        res = self.runner(m).run_batch([self.job(est=0.01)])["A:maps"]
        self.assertIn("This run's scraping budget would pass USD 0.01", res.refused)
        self.assertEqual(self.fake.posts, [])

    def test_a_known_run_is_read_again_never_started_twice(self):
        m = Meter(cap_run=2, cap_month=25, month_before=0)
        res = self.runner(m, known_runs={"A:maps": "runEarlier"}).run_batch([self.job()])["A:maps"]
        self.assertTrue(res.ok)
        self.assertEqual(self.fake.posts, [])
        self.assertTrue(any("actor-runs/runEarlier" in g for g in self.fake.gets))

    def test_the_run_cap(self):
        m = Meter(cap_run=2, cap_month=25, month_before=0)
        res = self.runner(m, max_runs=1, runs_started=1).run_batch([self.job()])["A:maps"]
        self.assertEqual(res.refused, "Not checked: the client's Maps listing. This report reached its 1 actor runs.")

    def test_runs_side_by_side_never_pass_the_run_cap(self):
        # Four Maps searches of USD 0.09 against a USD 0.10 run cap, four at a time, each charging its whole ceiling.
        self.fake.polls, self.fake.charge_ceiling = 2, True
        m = Meter(cap_run=0.10, cap_month=25, month_before=0)
        jobs = [self.job(key=f"B:maps:{i}", est=0.09) for i in range(4)]
        out = self.runner(m, concurrency=4).run_batch(jobs)
        self.assertEqual(len(self.fake.posts), 1, "the first run holds what is left; the others are not started")
        self.assertLessEqual(m.run_usd, 0.10 + 1e-9)
        self.assertEqual(m.held, 0.0)
        self.assertTrue(out["B:maps:0"].ok)
        for k in ("B:maps:1", "B:maps:2", "B:maps:3"):
            self.assertIn("This run's scraping budget would pass USD 0.10", out[k].refused)

    def test_runs_side_by_side_share_the_month_cap_and_wait_for_a_hold_to_come_back(self):
        # Worst case: every run spends its whole ceiling. The month (USD 0.15 left) is never passed.
        self.fake.polls, self.fake.charge_ceiling = 1, True
        m = Meter(cap_run=2, cap_month=25, month_before=24.85)
        jobs = [self.job(key=f"B:maps:{i}", est=0.03) for i in range(4)]
        out = self.runner(m, concurrency=4).run_batch(jobs)
        self.assertLessEqual(m.month_before + m.run_usd, 25 + 1e-9)
        self.assertLessEqual(sum(self.fake.ceiling.values()), 0.15 + 1e-9, self.fake.ceiling)
        self.assertEqual(m.held, 0.0)
        self.assertEqual(sum(1 for r in out.values() if r.refused), 2)
        # Usual case: runs cost less than their ceiling, so a pull that waited for a hold to come back starts.
        self.fake.charge_ceiling = False
        for seen in (self.fake.posts, self.fake.post_kw, self.fake.seen, self.fake.ceiling):
            seen.clear()
        m = Meter(cap_run=2, cap_month=25, month_before=24.85)
        out = self.runner(m, concurrency=4).run_batch(jobs)
        self.assertEqual(len(self.fake.posts), 4, "a pull that fits once a hold comes back waits; it is not refused")
        self.assertTrue(all(r.ok for r in out.values()))
        self.assertLessEqual(m.month_before + m.run_usd, 25 + 1e-9)
        self.assertEqual(m.held, 0.0)

    def test_a_run_aborted_at_the_deadline_still_counts_what_it_spent(self):
        self.fake.polls = 99
        times = iter([0.0] + [10_000.0] * 50)
        m = Meter(cap_run=2, cap_month=25, month_before=0)
        a = self.runner(m, clock=lambda: next(times))
        res = a.run_batch([self.job()])["A:maps"]
        self.assertIn("did not finish in 15 minutes", res.error)
        self.assertEqual(self.fake.aborts, ["run1"])
        self.assertAlmostEqual(m.usd_apify, 0.04)
        self.assertEqual((m.held, a.settled), (0.0, {"A:maps": 0.04}))

    def test_a_pull_left_waiting_at_the_deadline_is_an_error_not_an_empty_result(self):
        self.fake.polls = 99
        times = iter([0.0] + [10_000.0] * 50)
        m = Meter(cap_run=2, cap_month=25, month_before=0)
        out = self.runner(m, clock=lambda: next(times), concurrency=1).run_batch([self.job(), self.job(key="A:serp")])
        self.assertIn("did not start", out["A:serp"].error)
        self.assertEqual(len(self.fake.posts), 1)

    def test_a_resume_never_counts_a_settled_run_twice(self):
        m = Meter(cap_run=2, cap_month=25, month_before=0)
        m.usd_apify = 0.031                       # carried in from the claim: the run's own spend so far
        a = self.runner(m, known_runs={"A:maps": "runEarlier"})
        a.settled = {"A:maps": 0.031}
        res = a.run_batch([self.job()])["A:maps"]
        self.assertTrue(res.ok)
        self.assertEqual((res.usd, round(m.usd_apify, 3), m.held), (0.031, 0.031, 0.0))
        self.assertEqual(self.fake.posts, [])

    def test_a_started_run_stays_in_flight_when_its_id_cannot_be_saved(self):
        def broken_save(key, run_id):
            raise RuntimeError("Supabase answered 503")
        m = Meter(cap_run=2, cap_month=25, month_before=0)
        a = Apify("apify-key-test", self.ledger, m, poll_sec=0, sleep=lambda s: None, on_started=broken_save)
        res = a.run_batch([self.job()])["A:maps"]
        self.assertTrue(res.ok, res.error)
        self.assertEqual(res.items, [{"title": "Invented"}])
        self.assertAlmostEqual(m.usd_apify, 0.031)
        self.assertEqual(a.known_runs, {"A:maps": "run1"})

    def test_the_start_is_one_try_and_a_network_error_keeps_its_hold(self):
        m = Meter(cap_run=2, cap_month=25, month_before=0)
        self.runner(m).run_batch([self.job()])
        self.assertEqual(self.fake.post_kw[0]["retries"], 0)
        self.fake.post_error = http.HttpError(0, "network error: timed out")
        m = Meter(cap_run=2, cap_month=25, month_before=0)
        res = self.runner(m).run_batch([self.job()])["A:maps"]
        self.assertIn("could not start", res.error)
        self.assertAlmostEqual(m.held, 0.05, msg="it may have started, so its ceiling stays held")
        self.fake.post_error = http.HttpError(503, "busy")
        m = Meter(cap_run=2, cap_month=25, month_before=0)
        self.runner(m).run_batch([self.job()])
        self.assertEqual(m.held, 0.0)

    def test_a_ledger_that_cannot_write_stops_the_call(self):
        def broken(row):
            raise OSError("db down")
        led = Ledger(broken, "market-intel:x")
        m = Meter(cap_run=2, cap_month=25, month_before=0)
        res = Apify("apify-key-test", led, m, poll_sec=0, sleep=lambda s: None).run_batch([self.job()])["A:maps"]
        self.assertIn("was not started", res.error)
        self.assertEqual(self.fake.posts, [])
        self.assertEqual(m.held, 0.0)
        with self.assertRaises(LedgerDown):
            led.call("web", "GET", "https://x.example/", lambda: 1)


class Http(unittest.TestCase):
    def test_scrub_and_resource(self):
        self.assertEqual(http.scrub("https://api.apify.com/v2/x?token=abc123&y=1"), "https://api.apify.com/v2/x?token=<hidden>&y=1")
        self.assertEqual(http.resource_of("https://a.example/p/q?token=1"), "https://a.example/p/q")
        self.assertEqual(http.resource_of("https://a.example/p/q?x=1", host_only=True), "https://a.example/")


if __name__ == "__main__":
    unittest.main()
