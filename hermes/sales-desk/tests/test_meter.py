"""The AI meter: every model call counted and logged, and refused past the
day's ceiling, with the job stopping cleanly instead of failing every item.

    python3 -m unittest tests.test_meter
"""
from __future__ import annotations

import json
import os
import unittest
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http, model as model_mod, research  # noqa: E402
from desk.errors import NotNow  # noqa: E402
from desk.model import Reply  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_followups import NOW, ago  # noqa: E402


class Counting:
    name, model = "fake", "fake-model"

    def __init__(self, tokens: int = 1000):
        self.tokens, self.calls = tokens, 0

    def complete(self, system, user, *, temperature=None, timeout=900):
        self.calls += 1
        return Reply(text=json.dumps({"body": "Hi Omar, here is the link.", "subject": None, "why": "He asked."}),
                     model="fake-model-1",
                     usage={"prompt_tokens": self.tokens - 100, "completion_tokens": 100, "total_tokens": self.tokens,
                            "completion_tokens_details": {"reasoning_tokens": 40}})


class Meter(unittest.TestCase):
    def test_every_call_is_counted_and_logged(self):
        rows = []
        m = model_mod.Meter(job="notes", cap=10_000, used_today=lambda: 0, record=rows.append)
        p = model_mod.Metered(Counting(), m)
        p.complete("s", "u")
        p.complete("s", "u")
        self.assertEqual(m.spent, 2000)
        self.assertEqual(rows[0], {"job": "notes", "model": "fake-model-1", "input_tokens": 900, "output_tokens": 100,
                                   "reasoning_tokens": 40, "total_tokens": 1000})
        self.assertEqual(p.model, "fake-model")  # the provider's own attributes still read through

    def test_past_the_ceiling_the_call_is_refused_before_it_is_made(self):
        inner = Counting()
        m = model_mod.Meter(job="reviews", cap=5_000, used_today=lambda: 4_500, record=lambda _r: None)
        p = model_mod.Metered(inner, m)
        p.complete("s", "u")  # 4,500 spent before it: allowed, and it takes the day to 5,500
        with self.assertRaises(model_mod.BudgetSpent):
            p.complete("s", "u")
        self.assertEqual(inner.calls, 1)
        self.assertTrue(issubclass(model_mod.BudgetSpent, NotNow))

    def test_an_unreadable_day_asks_no_model_and_a_failed_log_is_warned_about(self):
        state = {"down": True}

        def today():
            if state["down"]:
                raise RuntimeError("database down")
            return 0

        def refuse(_row):
            raise RuntimeError("insert refused")

        warned = []
        inner = Counting()
        m = model_mod.Meter(job="followups", cap=10_000, used_today=today, record=refuse, warn=warned.append)
        p = model_mod.Metered(inner, m)
        with self.assertRaises(model_mod.SpendUnknown) as e:
            p.complete("s", "u")
        self.assertEqual(inner.calls, 0)
        self.assertIn("an unknown spend is not zero", str(e.exception))
        self.assertTrue(issubclass(model_mod.SpendUnknown, NotNow))
        # Once the day can be read, the call goes; a usage row that is refused costs nothing but a warning.
        state["down"] = False
        self.assertEqual(p.complete("s", "u").model, "fake-model-1")
        self.assertEqual((inner.calls, m.spent), (1, 1000))
        self.assertIn("was not written", warned[0])

    def test_the_researcher_is_metered_too(self):
        rows = []
        answer = {"model": "gpt-5", "usage": {"input_tokens": 9000, "output_tokens": 700, "total_tokens": 9700,
                                              "output_tokens_details": {"reasoning_tokens": 300}},
                  "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps({
                      "identified": False, "person": {}, "company": {}, "not_found": ["nothing"]})}]}]}
        model_mod.meter(model_mod.Meter(job="research", cap=10_000, used_today=lambda: 0, record=rows.append))
        try:
            with mock.patch.object(http, "request", return_value=(200, {}, json.dumps(answer).encode())):
                research.research({"name": "Omar Haddad", "company": "Haddad Interiors"}, openai_key="k", apify_key="")
            self.assertEqual(rows, [{"job": "research", "model": "gpt-5", "input_tokens": 9000, "output_tokens": 700,
                                     "reasoning_tokens": 300, "total_tokens": 9700}])
            model_mod.current_meter().base = 10_000
            with mock.patch.object(http, "request", side_effect=AssertionError("asked past the ceiling")), \
                    self.assertRaises(model_mod.BudgetSpent):
                research.research({"name": "Omar Haddad", "company": "Haddad Interiors"}, openai_key="k", apify_key="")
        finally:
            model_mod.meter(None)

    def test_the_follow_up_run_stops_instead_of_failing_every_lead(self):
        pg = FakePostgrest()
        for i in range(3):
            pg.put("cockpit_sales_leads", {"contact_id": f"a{i}", "name": "Omar", "email": "o@x.co", "phone": "+96550000000",
                                           "lead_created_at": ago(days=10), "lead_class": "qualified", "dnd": False,
                                           "pipeline_name": "Sales Pipeline (2-Call)"})
            pg.put("cockpit_sales_inbox", {"conversation_id": f"cv{i}", "contact_id": f"a{i}", "last_direction": "inbound",
                                           "last_message_at": ago(hours=1), "inbound_whatsapp_at": ago(hours=1)})
        m = model_mod.Meter(job="followups", cap=1_000, used_today=lambda: 1_000, record=lambda _r: None)
        with mock.patch.object(http, "request", pg), self.assertRaises(model_mod.BudgetSpent):
            fu.run(Supabase("https://example.supabase.co", "k"), model_mod.Metered(Counting(), m), lambda _m: None,
                   settings={"enabled": True}, ghl_token="", now=NOW)
        self.assertEqual(pg.rows("cockpit_sales_followups"), [])


if __name__ == "__main__":
    unittest.main()
