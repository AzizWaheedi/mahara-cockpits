"""The Whop payment link: the client against a fake Whop, and the worker's
link step against fakes. No network.
Run: cd hermes/invoice-desk && python3 -m unittest discover -s tests
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from typing import Any, Optional

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from desk import build, http, whop  # noqa: E402
from desk.worker import Desk  # noqa: E402
from test_worker import CFG, GOOD_PDF, FakeGoogle, FakeSupa  # noqa: E402

CHECKOUT = json.loads((HERE / "golden" / "cases.json").read_text(encoding="utf-8"))[1]["invoice"]
PRODUCT = "prod_UxHKRiFd5kCjI"


def plan(**over: Any) -> dict:
    return {"id": "plan_Abc123XYZ", "plan_type": "one_time", "initial_price": "1500.5", "renewal_price": "0.0",
            "product": PRODUCT, "visibility": "hidden", "direct_link": "https://whop.com/checkout/plan_Abc123XYZ",
            "internal_notes": f"x ({whop.MARK}{CHECKOUT['id']})", "created_at": 1, **over}


def whop_invoice(**over: Any) -> dict:
    return {**CHECKOUT, "checkout_source": "whop", "checkout_url": None, "whop_plan_id": None, "whop_started_at": None,
            "invoice_no": None, "drive_file_id": None, "register_row": None, **over}


class FakeWhop:
    def __init__(self, created: Optional[dict] = None, found: Optional[dict] = None, fail: Optional[Exception] = None):
        self.created = created if created is not None else plan()
        self.found = found
        self.fail = fail
        self.calls: list[str] = []
        self.product = PRODUCT

    def find(self, invoice_id: str) -> Optional[dict]:
        self.calls.append("find")
        return self.found

    def create(self, amount: Any, notes: str) -> dict:
        self.calls.append(f"create:{amount}")
        self.notes = notes
        if self.fail:
            raise self.fail
        return self.created

    def check(self, p: dict, amount: Any) -> str:
        return whop.Whop.check(self, p, amount)  # the real check, on our fake's product


def run(inv: dict, fake: Optional[FakeWhop], supa: Optional[FakeSupa] = None):
    supa = supa or FakeSupa(folder={"folder_id": "folderMadana12"})
    google = FakeGoogle()
    printed: list[str] = []

    def render(html: str) -> bytes:
        printed.append(html)
        return GOOD_PDF

    result = Desk(supa=supa, google=google, cfg=CFG, template=build.TEMPLATE.read_text(encoding="utf-8"),
                  render=render, log=lambda s: None, whop_api=fake).process(inv)
    return result, supa, google, printed


class LinkStep(unittest.TestCase):
    def test_the_link_is_made_once_saved_and_printed_as_a_button(self):
        fake = FakeWhop()
        result, supa, google, printed = run(whop_invoice(), fake)
        self.assertEqual(result, "issued")
        self.assertEqual(fake.calls, ["create:1500.5"])
        self.assertIn(f"{whop.MARK}{CHECKOUT['id']}", fake.notes)
        self.assertIn("INV-2026-025", fake.notes)
        # Intent before the call, plan and link the moment Whop answers.
        self.assertEqual([c for c in supa.calls if "whop" in c.lower()],
                         ["progress:whopStarted", "progress:checkoutUrl,whopPlanId"])
        self.assertEqual(supa.row["checkoutUrl"], "https://whop.com/checkout/plan_Abc123XYZ")
        self.assertIn('class="pay-btn" href="https://whop.com/checkout/plan_Abc123XYZ"', printed[0])
        self.assertNotIn(">https://whop.com/checkout/", printed[0])  # never the raw link as text
        self.assertIn("Whop plan plan_Abc123XYZ, made by the invoice desk", google.rows[4][9])

    def test_after_an_unknown_outcome_the_plan_is_found_not_made_again(self):
        fake = FakeWhop(found=plan())
        result, supa, _, _ = run(whop_invoice(whop_started_at="2026-10-15T10:00:00Z"), fake)
        self.assertEqual(result, "issued")
        self.assertEqual(fake.calls, ["find"])
        self.assertNotIn("progress:whopStarted", supa.calls)

    def test_an_unknown_outcome_with_no_plan_on_whop_makes_one(self):
        fake = FakeWhop(found=None)
        self.assertEqual(run(whop_invoice(whop_started_at="2026-10-15T10:00:00Z"), fake)[0], "issued")
        self.assertEqual(fake.calls, ["find", "create:1500.5"])

    def test_a_saved_plan_is_reused_without_asking_whop(self):
        fake = FakeWhop()
        inv = whop_invoice(whop_plan_id="plan_Abc123XYZ", checkout_url="https://whop.com/checkout/plan_Abc123XYZ")
        self.assertEqual(run(inv, fake)[0], "issued")
        self.assertEqual(fake.calls, [])

    def test_a_pasted_link_never_touches_whop(self):
        fake = FakeWhop()
        self.assertEqual(run({**CHECKOUT, "checkout_source": "pasted"}, fake)[0], "issued")
        self.assertEqual(fake.calls, [])

    def test_no_key_fails_with_a_sentence(self):
        result, supa, _, _ = run(whop_invoice(), None)
        self.assertEqual(result, "failed")
        self.assertIn("Whop key is not set", supa.finished[1])

    def test_a_key_that_may_not_create_fails_with_a_sentence(self):
        fake = FakeWhop(fail=http.HttpError(401, '{"error":{"message":"no permission"}}'))
        result, supa, _, _ = run(whop_invoice(), fake)
        self.assertEqual(result, "failed")
        self.assertIn("may not create payment links", supa.finished[1])

    def test_whop_down_waits_for_the_next_run_and_searches_first_then(self):
        fake = FakeWhop(fail=http.HttpError(503, "unavailable"))
        result, supa, _, _ = run(whop_invoice(), fake)
        self.assertEqual(result, "later")
        self.assertIsNone(supa.finished)
        self.assertIn("progress:whopStarted", supa.calls)

    def test_a_plan_that_does_not_match_is_refused(self):
        fake = FakeWhop(created=plan(initial_price="15.0"))
        result, supa, _, _ = run(whop_invoice(), fake)
        self.assertEqual(result, "failed")
        self.assertIn("does not match this invoice", supa.finished[1])
        self.assertIn("its price is 15.0", supa.finished[1])


class Client(unittest.TestCase):
    def setUp(self):
        self.get, self.send = http.get_json, http.send_json
        self.sent: list[tuple] = []

    def tearDown(self):
        http.get_json, http.send_json = self.get, self.send

    def test_create_asks_for_a_hidden_one_time_plan_once(self):
        http.send_json = lambda method, url, body, **kw: self.sent.append((method, url, body, kw)) or plan()
        whop.Whop("k", PRODUCT).create("5500.00", "notes")
        (method, url, body, kw), = self.sent
        self.assertEqual((method, url), ("POST", "https://api.whop.com/api/v2/plans"))
        self.assertEqual(body, {"plan_type": "one_time", "initial_price": 5500.0, "base_currency": "usd",
                                "product": PRODUCT, "release_method": "buy_now", "visibility": "hidden",
                                "internal_notes": "notes"})
        self.assertNotIn("retries", kw)  # a POST is never resent

    def test_find_reads_every_page_and_matches_the_invoice_id(self):
        pages = {1: [plan(id="plan_Other0001", internal_notes="someone else")],
                 2: [plan(internal_notes=f"Madana ({whop.MARK}{CHECKOUT['id']})")], 3: []}
        seen: list[int] = []

        def get(url, **kw):
            page = int(url.rsplit("page=", 1)[1])
            seen.append(page)
            return {"data": pages[page], "pagination": {}}

        http.get_json = get
        self.assertEqual(whop.Whop("k", PRODUCT).find(CHECKOUT["id"])["id"], "plan_Abc123XYZ")
        self.assertEqual(seen, [1, 2, 3])

    def test_check_refuses_a_visible_or_renewing_plan(self):
        w = whop.Whop("k", PRODUCT)
        self.assertEqual(w.check(plan(), "1500.50"), "https://whop.com/checkout/plan_Abc123XYZ")
        with self.assertRaises(whop.WhopRefused) as e:
            w.check(plan(visibility="visible", renewal_price="1500.5"), "1500.50")
        self.assertIn("it renews", str(e.exception))
        self.assertIn("visible, not hidden", str(e.exception))


if __name__ == "__main__":
    unittest.main()
