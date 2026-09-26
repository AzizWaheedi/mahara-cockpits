"""The lead researcher, without a network: invented leads, a scripted Google
result from Apify and a scripted OpenAI answer.

    python3 -m unittest tests.test_research
"""
from __future__ import annotations

import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, model as model_mod, research  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402

LEAD = {"contact_id": "c1", "name": "Omar Haddad", "company": "Haddad Interiors", "email": "omar@haddad-int.com",
        "country": "SA", "revenue": "$100K - $250k", "challenge": "Not enough projects", "ad_name": "Ad 7"}


class Searches(unittest.TestCase):
    def test_the_lead_as_the_search_sees_it(self):
        f = research.lead_facts(LEAD)
        self.assertEqual((f["email_domain"], f["country"]), ("haddad-int.com", "Saudi Arabia"))
        self.assertEqual(f["answers"]["challenge"], "Not enough projects")
        self.assertIsNone(research.lead_facts({**LEAD, "email": "omar@gmail.com"})["email_domain"])

    def test_queries_need_two_things_to_find_someone(self):
        qs = research.queries(research.lead_facts(LEAD))
        self.assertIn('"Haddad Interiors" Saudi Arabia', qs)
        self.assertIn('site:linkedin.com/in "Omar Haddad" "Haddad Interiors"', qs)
        # A first name and nothing else is not searched for at all.
        self.assertEqual(research.queries(research.lead_facts({"name": "نعمان", "country": "SA"})), [])

    def test_a_company_email_is_searched_when_there_is_no_company(self):
        qs = research.queries(research.lead_facts({"name": "Omar", "email": "omar@haddad-int.com"}))
        self.assertEqual(qs[0], '"haddad-int.com"')


class Answers(unittest.TestCase):
    def test_the_first_whole_json_object(self):
        self.assertEqual(research.first_json('Here: {"a": {"b": "}"}} trailing'), {"a": {"b": "}"}})
        self.assertIsNone(research.first_json("no brief here"))

    def test_facts_without_a_page_are_dropped_and_unopened_pages_marked(self):
        brief = {"person": {"facts": [{"text": "Founder", "source": "https://www.linkedin.com/in/omar/"},
                                      {"text": "No source"}]},
                 "company": {"facts": [{"text": "Fit-out firm", "source": "https://elsewhere.com/x"}]},
                 "signals": [], "talking_points": ["Ask about Riyadh"], "not_found": []}
        b, pages = research.check_sources(brief, ["https://linkedin.com/in/omar"])
        self.assertEqual(len(b["person"]["facts"]), 1)
        self.assertTrue(b["person"]["facts"][0]["verified"])
        self.assertFalse(b["company"]["facts"][0]["verified"])
        self.assertEqual(pages, [{"url": "https://linkedin.com/in/omar"}])


class Research(unittest.TestCase):
    def test_a_brief_from_google_and_the_models_search(self):
        apify = [{"searchQuery": {"term": "q"}, "organicResults": [
            {"title": "Omar Haddad - Founder", "url": "https://sa.linkedin.com/in/omar-haddad", "description": "Founder at Haddad Interiors"}]}]
        answer = {"model": "gpt-5", "usage": {"input_tokens": 9000, "output_tokens": 700}, "output": [
            {"type": "web_search_call", "action": {"sources": [{"type": "url", "url": "https://haddad-int.com/about"}]}},
            {"type": "message", "content": [{"type": "output_text", "text": json.dumps({
                "identified": True, "confidence": "high",
                "person": {"summary": "Founder", "role": "Founder", "linkedin": "https://sa.linkedin.com/in/omar-haddad",
                           "facts": [{"text": "Founder of Haddad Interiors", "source": "https://sa.linkedin.com/in/omar-haddad"}]},
                "company": {"name": "Haddad Interiors", "website": "https://haddad-int.com", "summary": "Fit-out",
                            "facts": [{"text": "Fit-out in Riyadh since 2015", "source": "https://haddad-int.com/about"}]},
                "signals": [], "talking_points": ["Their Riyadh fit-out work"], "cautions": [], "not_found": []}),
                "annotations": []}]}]}
        calls = []

        def fake(method, url, **kw):
            calls.append(url)
            if "apify" in url:
                self.assertIn("Bearer apify-test", kw["headers"]["Authorization"])
                return 201, {}, json.dumps(apify).encode()
            body = json.loads(kw["data"].decode())
            self.assertEqual(body["tools"][0]["user_location"]["country"], "SA")
            self.assertIn("Haddad Interiors", body["input"])
            return 200, {}, json.dumps(answer).encode()

        with mock.patch.object(http, "request", side_effect=fake):
            out = research.research(LEAD, openai_key="sk-test", apify_key="apify-test")
        self.assertEqual(len(calls), 2)
        facts = out["brief"]["person"]["facts"] + out["brief"]["company"]["facts"]
        self.assertTrue(all(f["verified"] for f in facts))
        self.assertEqual(out["usage"], {"input": 9000, "output": 700})

    def test_a_lead_with_nothing_to_search_for_is_refused(self):
        with self.assertRaises(ValueError):
            research.research({"contact_id": "x"}, openai_key="k", apify_key="a")


    def test_a_model_outside_the_allowlist_is_refused_before_anything_is_sent(self):
        for name in ("openrouter/auto", "deepseek-chat", "llama-3-70b"):
            with mock.patch.object(http, "request", side_effect=AssertionError("sent")), \
                    self.assertRaises(model_mod.ModelUnreachable) as e:
                research.research(LEAD, openai_key="k", apify_key="a", model=name)
            self.assertIn("SALES_RESEARCH_MODEL", str(e.exception))


def stuck_request(pg: FakePostgrest, rid: str, attempts: int, minutes: int = 45) -> None:
    at = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    pg.put("cockpit_sales_requests", {"id": rid, "kind": "research", "contact_id": "c1", "status": "running",
                                      "attempts": attempts, "claimed_at": at, "claimed_by": "sales-desk"})
    pg.put("cockpit_sales_research", {"id": f"r-{rid}", "request_id": rid, "contact_id": "c1", "status": "running"})


class Queue(unittest.TestCase):
    CFG = SimpleNamespace(openai_key="sk-test", model_timeout=5)

    def run_it(self, pg):
        with mock.patch.object(http, "request", pg):
            return research.run(Supabase("https://example.supabase.co", "k"), self.CFG, lambda _m: None,
                                host="sales-desk", warn=lambda _m: None)

    def test_a_request_a_stopped_run_left_running_is_freed(self):
        pg = FakePostgrest()
        stuck_request(pg, "q-once", attempts=1)
        stuck_request(pg, "q-twice", attempts=2)
        stuck_request(pg, "q-live", attempts=1, minutes=5)
        pg.tables["cockpit_sales_leads"].clear()
        out = self.run_it(pg)
        self.assertEqual(out["reaped"], 2)
        # Back in the queue, it is taken again in the same run (and fails: the lead has gone).
        self.assertEqual(pg.one("cockpit_sales_requests", id="q-once")["attempts"], 2)
        self.assertEqual((pg.one("cockpit_sales_requests", id="q-twice")["status"],
                          pg.one("cockpit_sales_research", id="r-q-twice")["status"]), ("failed", "failed"))
        self.assertIn("stopped before finishing", pg.one("cockpit_sales_research", id="r-q-twice")["error"])
        self.assertEqual(pg.one("cockpit_sales_requests", id="q-live")["status"], "running")

    def test_a_model_that_cannot_be_asked_now_leaves_the_request_untouched(self):
        pg = FakePostgrest()
        pg.put("cockpit_sales_leads", LEAD)
        pg.put("cockpit_sales_requests", {"id": "q1", "kind": "research", "contact_id": "c1", "status": "queued",
                                          "attempts": 0, "requested_at": "2026-09-26T08:00:00+00:00"})
        pg.put("cockpit_sales_research", {"id": "r1", "request_id": "q1", "contact_id": "c1", "status": "queued"})

        def unread():
            raise RuntimeError("database down")

        model_mod.meter(model_mod.Meter(job="research", cap=1000, used_today=unread, record=lambda _r: None))
        try:
            with self.assertRaises(model_mod.SpendUnknown):
                self.run_it(pg)
        finally:
            model_mod.meter(None)
        req = pg.one("cockpit_sales_requests", id="q1")
        self.assertEqual((req["status"], req["attempts"]), ("queued", 0))
        self.assertEqual(pg.one("cockpit_sales_research", id="r1")["status"], "queued")


if __name__ == "__main__":
    unittest.main()
