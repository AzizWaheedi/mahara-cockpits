"""A whole run with every provider faked: shadow writes only to Supabase and the run folder; a resume never pays
twice; the caps refuse before any pull; the validator and its one repair; a lost lease; a pick outside the list."""
import json
import tempfile
import unittest
from pathlib import Path

from mi import pipeline
from tests import fakes

ALLOWED_PROVIDERS = {"apify", "scrapecreators", "web", "claude"}


def folder_text(cfg) -> str:
    root = cfg.runs_dir / fakes.RUN
    return "\n".join(p.read_text(encoding="utf-8") for p in root.rglob("*") if p.is_file())


class FullShadowRun(unittest.TestCase):
    def setUp(self):
        self.cfg = fakes.cfg()
        self.w = fakes.World()
        self.out = pipeline.run_once(self.cfg, self.w.deps(), self.w.home.claim("worker-test"))

    def test_it_ends_done_in_shadow_with_its_counts(self):
        self.assertEqual(self.out.state, "done")
        self.assertRegex(self.out.sentence, r"^Research finished in shadow: 6 competitors, \d+ sources, USD \d+\.\d\d of scraping\. Nothing was published\.$")
        done = self.w.home.done_calls[-1]
        self.assertEqual(done["state"], "done")
        self.assertEqual(done["summary"]["fieldState"], "not_due")
        self.assertNotIn("docUrl", done["summary"])
        self.assertGreaterEqual(len(self.w.home.stored["evidence"]), 20)
        self.assertEqual({f["lang"] for f in self.w.home.stored["findings"]}, {"en", "ar"})
        comps = self.w.home.stored["competitors"]
        self.assertEqual((len(comps), sum(1 for c in comps if not c["reserve"])), (8, 6))
        self.assertEqual(self.w.engine.calls, ["pick", "write_en", "write_ar"])

    def test_nothing_goes_outward(self):
        providers = {r["provider"] for r in self.w.home.ledger_rows}
        self.assertTrue(providers <= ALLOWED_PROVIDERS, providers)
        hosts = {u.split("/")[2] for u in self.w.web_seen}
        self.assertTrue(all(h.endswith(".example") for h in hosts), hosts)
        self.assertTrue(all(u.startswith("https://api.scrapecreators.com/") for u in self.w.sc_calls))
        out = json.loads((self.cfg.runs_dir / fakes.RUN / "outputs.json").read_text())
        self.assertFalse(out["field"]["sent"])
        self.assertFalse(out["comment"]["sent"])
        self.assertIsNone(out["field"]["value"])
        self.assertTrue(out["comment"]["text"].endswith("Cockpit ref MI-11111111"))
        reqs = json.loads((self.cfg.runs_dir / fakes.RUN / "docs-requests.json").read_text())
        self.assertEqual(list(reqs), ["t.0", "t.en", "t.answers"])

    def test_every_ledger_row_has_an_intent_before_its_response(self):
        rows = self.w.home.ledger_rows
        self.assertTrue(rows)
        for i, r in enumerate(rows):
            if r["phase"] == "response":
                self.assertTrue(any(x["phase"] == "intent" and x["resource"] == r["resource"] for x in rows[:i]))
            self.assertNotIn("?", r["resource"])
            self.assertNotIn("key-test", json.dumps(r))

    def test_no_contact_value_no_listing_phone_no_reviewer_anywhere(self):
        stored = json.dumps(self.w.home.stored, ensure_ascii=False)
        prompts = "\n".join(self.w.engine.prompts)
        text = folder_text(self.cfg)
        for v in fakes.CONTACTS + ("Invented Reviewer A", "Invented Reviewer B", "reviewerId", "96522000123"):
            with self.subTest(v=v):
                self.assertNotIn(v, stored)
                self.assertNotIn(v, prompts)
                self.assertNotIn(v, text.replace(".example", ""))
        # The listing phone was asked about inside the database only.
        self.assertIn("+96522000123", self.w.home.nap_asked)
        nap = [e for e in self.w.home.stored["evidence"] if e["kind"] == "nap"]
        self.assertEqual(nap[0]["body"]["result"], "match")

    def test_the_report_fills_numbers_from_evidence_and_labels_the_client_claim(self):
        en = (self.cfg.runs_dir / fakes.RUN / "report.en.md").read_text()
        self.assertIn("The client is rated 4.6 [E", en)
        self.assertIn("(the client's answer in the onboarding form of 2026-10-20)", en)
        self.assertIn("(Recommendation, not an approved offer)", en)
        answers = (self.cfg.runs_dir / fakes.RUN / "report.answers.md").read_text()
        self.assertIn("Contact details are on the client card.", answers)

    def test_the_progress_mirror_holds_ids_and_states_only(self):
        for call in self.w.home.progress_calls:
            blob = json.dumps(call["progress"])
            self.assertNotIn("Cedar Invented", blob)
            self.assertLess(len(blob), 20000)
        self.assertTrue(all(v in ("done", "refused", "failed") for v in self.w.home.stage_progress["pulls"].values()))


class ResumeNeverPaysTwice(unittest.TestCase):
    def test_an_engine_outage_waits_and_the_resume_pulls_nothing_again(self):
        cfg = fakes.cfg()
        w = fakes.World(engine=fakes.FakeEngine(unreachable_on="write_en"))
        first = pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        self.assertEqual(first.state, "released")
        self.assertEqual(w.home.released, ["The Claude sign-in on the VPS has lapsed, so research waits."])
        started, sc_calls, spend = list(w.started), list(w.sc_calls), dict(w.home.spend)
        self.assertGreater(len(started), 10)
        second = pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        self.assertEqual(second.state, "done")
        self.assertEqual(w.started, started, "no actor run was started again")
        self.assertEqual(w.sc_calls, sc_calls, "no ScrapeCreators credit was spent again")
        self.assertEqual(w.home.spend, spend)
        self.assertEqual(w.engine.calls, ["pick", "write_en", "write_en", "write_ar"])

    def test_four_engine_outages_in_a_row_are_not_tries_and_the_run_still_finishes(self):
        cfg = fakes.cfg()
        w = fakes.World(engine=fakes.FakeEngine(unreachable_on="write_en", unreachable_times=4))
        outcomes = [pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test")) for _ in range(4)]
        self.assertEqual([o.state for o in outcomes], ["released"] * 4)
        self.assertEqual([(r["kind"], r["minutes"]) for r in w.home.releases], [("outage", 60)] * 4)
        self.assertEqual(w.home.attempts, 0, "a release for an outage gives the try back")
        started, spend = list(w.started), dict(w.home.spend)
        last = pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        self.assertEqual(last.state, "done")
        self.assertEqual(w.started, started)
        self.assertEqual(w.home.spend, spend)

    def test_a_day_of_outages_asks_for_a_person(self):
        cfg = fakes.cfg()
        w = fakes.World(home=fakes.FakeHome(outage_limit=1), engine=fakes.FakeEngine(unreachable_on="write_en", unreachable_times=9))
        self.assertEqual(pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test")).state, "released")
        out = pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        self.assertEqual(out.state, "needs_person")
        self.assertTrue(out.sentence.startswith("Research waited 24 hours and stopped: The Claude sign-in"), out.sentence)
        self.assertGreater(out.summary["sourcesN"], 0)

    def test_an_unexpected_error_is_a_try_and_three_end_the_run(self):
        cfg = fakes.cfg()
        w = fakes.World()

        def broken(run_id):
            raise RuntimeError("an adapter bug")
        w.home.input = broken
        for _ in range(3):
            self.assertEqual(pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test")).state, "released")
        self.assertEqual({r["kind"] for r in w.home.releases}, {"error"})
        self.assertEqual(w.home.claim("worker-test"), {"idle": True})
        self.assertEqual(w.home.state, "failed")

    def test_a_worker_that_dies_mid_pull_reads_the_same_actor_run_on_resume(self):
        cfg = fakes.cfg()
        w = fakes.World(crash_after_start="B:maps:1")
        with self.assertRaises(KeyboardInterrupt):
            pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        self.assertIn("B:maps:1", w.home.stage_progress["apifyRuns"])
        w.home.state, w.home.claim_token = "queued", "33333333-0000-4000-8000-000000000000"
        w.apify_kw = {}
        out = pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        self.assertEqual(out.state, "done")
        self.assertIn("B:maps:1", w.apifies[-1].reread)
        self.assertNotIn("B:maps:1", w.apifies[-1].started)
        self.assertEqual(sum(1 for k in w.started if k == "B:maps:1"), 1)

    def test_a_lost_folder_with_stored_evidence_asks_for_a_person(self):
        cfg = fakes.cfg()
        w = fakes.World()
        claim = w.home.claim("worker-test")
        claim["stageProgress"] = {"stored": 12, "pulls": {"A:maps": "done"}}
        out = pipeline.run_once(cfg, w.deps(), claim)
        self.assertEqual(out.state, "needs_person")
        self.assertIn("local folder is gone", out.sentence)
        self.assertEqual(w.started, [])


class Caps(unittest.TestCase):
    def test_a_spent_month_refuses_every_paid_pull_before_it_starts(self):
        cfg = fakes.cfg()
        w = fakes.World(home=fakes.FakeHome(month_usd=25.0))
        out = pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        self.assertEqual(w.started, [])
        self.assertEqual(w.sc_calls, [])
        self.assertEqual(out.state, "needs_person")
        self.assertTrue(out.sentence.startswith("Research is too thin to write: 0 competitors were found"))
        self.assertIn("The month's research budget would pass USD 25.00", out.sentence)
        self.assertNotIn("write_en", w.engine.calls)
        nc = json.loads((cfg.runs_dir / fakes.RUN / "not_checked.json").read_text())
        self.assertTrue(all(s.startswith("Not checked: ") for s in nc))

    def test_the_lower_run_cap_wins_and_names_what_was_not_checked(self):
        cfg = fakes.cfg(usd_cap_run=0.1)
        w = fakes.World()
        pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        nc = json.loads((cfg.runs_dir / fakes.RUN / "not_checked.json").read_text())
        self.assertTrue(any("This run's scraping budget would pass USD 0.10" in s for s in nc), nc)
        self.assertLessEqual(w.home.spend.get("usdApify", 0) + w.home.spend.get("usdScrapeCreators", 0), 0.1 + 0.03)

    def test_an_unreadable_month_pulls_nothing_and_waits(self):
        cfg = fakes.cfg()
        w = fakes.World(home=fakes.FakeHome(month_usd=None))
        out = pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        self.assertEqual(out.state, "released")
        self.assertEqual(out.sentence, "This month's research spend could not be read, so nothing was pulled. The run waits.")
        self.assertEqual(w.started, [])
        self.assertEqual((w.home.releases[0]["kind"], w.home.attempts), ("outage", 0))

    def test_a_cap_lowered_mid_run_applies_to_the_next_pull(self):
        cfg = fakes.cfg()
        w = fakes.World()

        def lower(home, call):
            if call["progress"].get("stage") == "B":
                home.caps = {"run": 0.05, "month": 25}
        w.home.on_progress = lower
        pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        nc = json.loads((cfg.runs_dir / fakes.RUN / "not_checked.json").read_text())
        self.assertTrue(any("This run's scraping budget would pass USD 0.05" in x for x in nc), nc)


class Switch(unittest.TestCase):
    def test_research_turned_off_mid_run_stops_before_the_next_pull_and_resumes_when_on(self):
        cfg = fakes.cfg()
        w = fakes.World()

        def off_at_b(home, call):
            if call["progress"].get("stage") == "B":
                home.on = False
        w.home.on_progress = off_at_b
        out = pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        self.assertEqual(out.state, "released")
        self.assertTrue(out.sentence.startswith("Market research was turned off, so this run stopped before its next pull."))
        self.assertEqual((w.home.releases[-1]["kind"], w.home.attempts), ("paused", 0))
        self.assertFalse(any(k.startswith(("B:", "C:")) for k in w.started), w.started)
        self.assertEqual(w.engine.calls, [])
        self.assertEqual(w.home.claim("worker-test")["off"], True)
        w.home.on, w.home.on_progress = True, None
        started = list(w.started)
        done = pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        self.assertEqual(done.state, "done")
        self.assertEqual([k for k in w.started if k.startswith("A:")], [k for k in started if k.startswith("A:")],
                         "stage A was not pulled again")


class MapsOnResume(unittest.TestCase):
    def test_a_listing_matched_by_name_and_phone_survives_a_resume(self):
        cfg = fakes.cfg()
        inp = json.loads(json.dumps(fakes.INPUT))
        # No Maps link and no website of its own: only the name and the phone can find the listing.
        inp["answers"] = {k: v for k, v in inp["answers"].items() if k not in ("mapsLink", "website")}
        inp["answers"]["businessName"] = "Rival One Invented Studio"
        inp["card"]["website"] = None
        home = fakes.FakeHome(inp=inp)
        home.nap = lambda run_id, phone: ("not_checked" if not phone else
                                          "match" if phone.endswith("22001111") else "differs")
        w = fakes.World(home=home, engine=fakes.FakeEngine(unreachable_on="write_en"))
        first = pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        self.assertEqual(first.state, "released")
        presence = lambda: json.loads((cfg.runs_dir / fakes.RUN / "presence.json").read_text())["maps"]  # noqa: E731
        self.assertEqual(presence(), {"state": "found", "why": "name and phone match"})
        pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        self.assertEqual(presence(), {"state": "found", "why": "name and phone match"})
        nap = [e for e in w.home.stored["evidence"] if e["kind"] == "nap"]
        self.assertEqual([e["body"]["result"] for e in nap], ["match"])


class ModelAndChecks(unittest.TestCase):
    def test_a_pick_outside_the_shortlist_is_refused_and_filled_by_score(self):
        cfg = fakes.cfg()
        w = fakes.World(engine=fakes.FakeEngine(pick_outside=True))
        out = pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        self.assertEqual(out.state, "done")
        warns = json.loads((cfg.runs_dir / fakes.RUN / "warnings.json").read_text())
        self.assertIn("pick: K99 is not on the shortlist, so it was refused", warns)
        whys = [c["why"] for c in w.home.stored["competitors"] if not c["reserve"]]
        self.assertIn("Picked by score: the model named fewer than were needed.", whys)

    def test_one_repair_fixes_a_typed_number(self):
        cfg = fakes.cfg()
        w = fakes.World(engine=fakes.FakeEngine(digit_in_en=True))
        out = pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        self.assertEqual(out.state, "done")
        self.assertEqual(w.engine.calls, ["pick", "write_en", "repair", "write_ar"])

    def test_a_second_failure_asks_for_a_person_with_the_rule_sentence(self):
        cfg = fakes.cfg()
        w = fakes.World(engine=fakes.FakeEngine(digit_in_en=True, digit_stays=True))
        out = pipeline.run_once(cfg, w.deps(), w.home.claim("worker-test"))
        self.assertEqual(out.state, "needs_person")
        self.assertEqual(out.sentence, "Research finished, but 1 claim types a number the evidence does not fill. Run it again.")
        stored = w.home.stored["findings"]
        self.assertEqual(stored[0]["checks"]["r3_numbers"]["ok"], False)
        self.assertFalse((cfg.runs_dir / fakes.RUN / "report.en.md").exists())

    def test_a_lost_lease_stops_without_writing(self):
        cfg = fakes.cfg()
        w = fakes.World()
        claim = w.home.claim("worker-test")
        w.home.claim_token = "another-worker"
        out = pipeline.run_once(cfg, w.deps(), claim)
        self.assertEqual(out.state, "lost")
        self.assertEqual(w.home.done_calls, [])
        self.assertEqual(w.home.stored["evidence"], [])

    def test_a_live_mode_run_still_publishes_nothing_in_this_release(self):
        cfg = fakes.cfg()
        w = fakes.World()
        claim = w.home.claim("worker-test")
        claim["mode"] = "live"
        out = pipeline.run_once(cfg, w.deps(), claim)
        self.assertEqual(out.state, "done")
        self.assertIn("Publishing waits for MI-3, so nothing was sent.", out.sentence)
        o = json.loads((cfg.runs_dir / fakes.RUN / "outputs.json").read_text())
        self.assertIn("not built into this release", o["publish"])
        self.assertFalse(o["comment"]["sent"])


if __name__ == "__main__":
    unittest.main()
