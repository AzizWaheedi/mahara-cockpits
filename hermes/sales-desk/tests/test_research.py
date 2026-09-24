"""The lead researcher, without a network: invented leads, a scripted Google
result from Apify and a scripted OpenAI answer.

    python3 -m unittest tests.test_research
"""
from __future__ import annotations

import json
import os
import unittest
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, research  # noqa: E402

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


if __name__ == "__main__":
    unittest.main()
