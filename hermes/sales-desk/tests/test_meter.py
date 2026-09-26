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

from desk import followups as fu, http, model as model_mod  # noqa: E402
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

    def test_an_unreadable_day_counts_only_this_process_and_a_failed_log_costs_nothing(self):
        def broken():
            raise RuntimeError("database down")

        def refuse(_row):
            raise RuntimeError("insert refused")

        m = model_mod.Meter(job="followups", cap=1_000, used_today=broken, record=refuse)
        p = model_mod.Metered(Counting(), m)
        p.complete("s", "u")
        with self.assertRaises(model_mod.BudgetSpent):
            p.complete("s", "u")

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
