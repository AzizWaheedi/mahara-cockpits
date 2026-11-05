import json
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from desk import build, ecom, http, tap
from desk.worker import Desk, Ledger, Passing, Problem

INV = "8f451d80-b3bd-4bd5-b912-b1dc37aa7a71"
FOUND = {"id": "inv_Example123456", "url": "https://invoices.tap.company/invoice/inv_Example123456", "status": "UNPAID",
         "tapStatus": "CREATED", "amount": 0.62, "currency": "KWD", "live": True, "cockpitInvoice": INV, "paidAt": None}
TEMPLATE = (Path(__file__).resolve().parents[1] / "template.html").read_text(encoding="utf-8")


class Store:
    def __init__(self):
        self.patches = []

    def progress(self, _id, patch):
        self.patches.append(patch)


class API:
    """invoice-tap as the worker sees it, with Tap.check for real."""
    check = staticmethod(tap.Tap.check)

    def __init__(self, found=None, created=None, refuse=None, stale=False, live=None):
        self.found, self.created, self.refuse, self.stale = found, created, refuse, stale
        self.live = live if live is not None else {**FOUND}
        self.calls = []

    def get(self, tap_invoice_id, invoice_id):
        self.calls.append(("get", tap_invoice_id))
        return self.live

    def quote(self):
        if self.stale:
            raise ecom.EcomRefused("USD/KWD quote is stale or invalid; no Ecom link was created.")
        return Decimal("0.310000"), "2026-11-05T00:00:00+00:00"

    def find(self, invoice_id):
        self.calls.append(("find", invoice_id))
        return self.found

    def create(self, inv, number, amount):
        self.calls.append(("create", number, f"{amount:.3f}"))
        if self.refuse:
            raise tap.TapRefused(self.refuse)
        return self.created


def invoice(**over):
    return {"id": INV, "kind": "checkout", "checkout_source": "tap", "amount_usd": "2", "client_name": "Example Clinic",
            "client_email": "owner@example.com", "description": "Month 2", "due_date": "2026-11-20",
            "issue_date": "2026-11-05", **over}


class TapTests(unittest.TestCase):
    def test_kwd_rounding_and_minimum(self):
        self.assertEqual(tap.kwd("1500", Decimal("0.307123")), Decimal("460.685"))
        with self.assertRaisesRegex(tap.TapRefused, "start at KWD 0.100"):
            tap.kwd("0.30", Decimal("0.307"))

    def test_check_takes_only_a_live_page_for_this_invoice_and_amount(self):
        self.assertEqual(tap.Tap.check(FOUND, INV, Decimal("0.620")), FOUND["url"])
        for bad in ({"live": False}, {"url": "https://invoices.sandbox.tap.company/invoice/inv_Example123456"},
                    {"url": "https://example.test/tap.company/x"}, {"amount": 0.61}, {"currency": "USD"},
                    {"cockpitInvoice": "other"}, {"status": "CANCELLED"}, {"id": "chg_1"}):
            with self.assertRaises(tap.TapRefused, msg=str(bad)):
                tap.Tap.check({**FOUND, **bad}, INV, Decimal("0.620"))

    def test_first_try_marks_started_then_creates_once(self):
        store, api = Store(), API(created=FOUND)
        inv = invoice()
        Desk(store, None, None, "", tap_api=api).link(inv, "INV-2026-031")
        self.assertEqual(api.calls, [("create", "INV-2026-031", "0.620")])
        self.assertEqual(store.patches[0], {"tapStarted": True})
        self.assertEqual(store.patches[1], {"tapInvoiceId": "inv_Example123456", "checkoutUrl": FOUND["url"],
                                            "amountKwd": "0.620", "kwdRate": "0.310000", "kwdRateAt": "2026-11-05T00:00:00+00:00"})
        self.assertEqual(inv["checkout_url"], FOUND["url"])

    def test_retry_after_unknown_outcome_finds_instead_of_creating(self):
        store, api = Store(), API(found=FOUND)
        Desk(store, None, None, "", tap_api=api).link(invoice(tap_started_at="2026-11-05T10:00:00Z"), "INV-2026-031")
        self.assertEqual(api.calls, [("find", INV)])
        self.assertEqual(store.patches[0]["tapInvoiceId"], "inv_Example123456")

    def test_a_recorded_link_is_reused_only_while_tap_can_take_the_payment(self):
        store, api = Store(), API()
        recorded = invoice(tap_invoice_id="inv_Example123456", checkout_url=FOUND["url"])
        Desk(store, None, None, "", tap_api=api).link(recorded, "INV-2026-031")
        self.assertEqual(api.calls, [("get", "inv_Example123456")])
        self.assertEqual(store.patches, [])
        for status in ("EXPIRED", "CANCELLED"):
            with self.assertRaisesRegex(Problem, f"Tap link is {status.lower()}, so the invoice cannot go out with it. Cancel this invoice"):
                Desk(Store(), None, None, "", tap_api=API(live={**FOUND, "status": status})).link(recorded, "INV-2026-031")

    def test_an_earlier_tap_invoice_is_kept_when_only_the_days_rate_moved(self):
        # Made yesterday at 0.307 (KWD 0.614 for USD 2); today's quote is 0.310 (KWD 0.620).
        store, api = Store(), API(found={**FOUND, "amount": 0.614})
        Desk(store, None, None, "", tap_api=api).link(invoice(tap_started_at="2026-11-04T10:00:00Z"), "INV-2026-031")
        self.assertEqual(api.calls, [("find", INV)])
        self.assertEqual(store.patches[0]["amountKwd"], "0.614")
        self.assertEqual(store.patches[0]["kwdRate"], "0.307000")

    def test_an_earlier_tap_invoice_far_off_is_refused_without_advising_a_switch(self):
        api = API(found={**FOUND, "amount": 0.9})
        with self.assertRaisesRegex(Problem, "Tap already holds a link for this invoice that the cockpit cannot use") as caught:
            Desk(Store(), None, None, "", tap_api=api).link(invoice(tap_started_at="2026-11-04T10:00:00Z"), "INV-2026-031")
        self.assertNotIn("Use an Ecom link instead", str(caught.exception))
        self.assertEqual(tap.kept({"amount": 0.62}, "2", Decimal("0.620")), None)

    def test_plain_sentences_for_what_a_person_can_fix(self):
        with self.assertRaisesRegex(Problem, "Tap needs the client's email. On the invoices page press Use an Ecom link instead"):
            Desk(Store(), None, None, "", tap_api=API()).link(invoice(client_email=None), "INV-2026-031")
        with self.assertRaisesRegex(Problem, "Tap did not make the link: Tap HTTP 400: 1108 Invalid item name. On the invoices page"):
            Desk(Store(), None, None, "", tap_api=API(refuse="Tap HTTP 400: 1108 Invalid item name.")).link(invoice(), "INV-2026-031")
        with self.assertRaisesRegex(Problem, "cannot reach the Tap link maker"):
            Desk(Store(), None, None, "").link(invoice(), "INV-2026-031")
        with self.assertRaisesRegex(Passing, "no Tap link was made"):
            Desk(Store(), None, None, "", tap_api=API(stale=True)).link(invoice(), "INV-2026-031")

    def test_a_409_from_invoice_tap_is_a_refusal_with_its_reason(self):
        api = tap.Tap("https://db.example.supabase.co", "service-key")
        err = http.HttpError(409, "conflict", json.dumps({"error": "TAP_SECRET_KEY is not a live Tap key", "refused": True}).encode())
        with patch.object(tap.http, "send_json", side_effect=err):
            with self.assertRaisesRegex(tap.TapRefused, "not a live Tap key"):
                api.find(INV)
        with patch.object(tap.http, "send_json", side_effect=http.HttpError(502, "bad gateway")):
            with self.assertRaises(http.HttpError):
                api.find(INV)
        with patch.object(tap.http, "send_json", return_value={"invoice": None}) as send:
            self.assertIsNone(api.find(INV))
            self.assertEqual(send.call_args.args[1], "https://db.example.supabase.co/functions/v1/invoice-tap")
            self.assertEqual(send.call_args.args[2], {"op": "find", "invoiceId": INV})

    def test_create_sends_what_invoice_tap_checks(self):
        api = tap.Tap("https://db.example.supabase.co", "service-key")
        with patch.object(tap.http, "send_json", return_value={"invoice": FOUND}) as send:
            api.create(invoice(amount_usd=1500), "INV-2026-031", Decimal("460.500"))
        body = send.call_args.args[2]
        self.assertEqual(body, {"op": "create", "invoiceId": INV, "number": "INV-2026-031", "clientName": "Example Clinic",
                                "clientEmail": "owner@example.com", "description": "Month 2", "amountKwd": "460.500",
                                "amountUsd": "1500.00", "dueDate": "2026-11-20"})

    def test_ledger_names_the_link_maker(self):
        ledger = Ledger()
        ledger("POST", "https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/invoice-tap", 200, True, "")
        ledger("POST", "https://bldgtotkfmhoxmlzowdx.supabase.co/rest/v1/rpc/cockpit_invoice_progress", 200, True, "")
        self.assertEqual([r["provider"] for r in ledger.rows], ["invoice-tap"])

    def test_the_invoice_shows_the_kwd_amount_and_no_card_fee_note(self):
        inv = {**invoice(), "amount_usd": "1500", "amount_kwd": "460.500", "kwd_rate": "0.307000",
               "checkout_url": FOUND["url"], "tap_invoice_id": "inv_Example123456", "clickup_task_id": "ex2"}
        html = build.fill(inv, "INV-2026-031", TEMPLATE)
        self.assertIn("Pay KWD 460.500 (USD 1,500.00 at 0.307000)", html)
        self.assertNotIn("Card processing fees", html)
        self.assertIn(FOUND["url"], html)
        whop = build.fill({**inv, "checkout_source": "whop", "amount_kwd": None, "kwd_rate": None}, "INV-2026-031", TEMPLATE)
        self.assertIn("Card processing fees", whop)
        self.assertIn("(Tap invoice inv_Example123456, KWD 460.500, rate 0.307000)", build.register_row(inv, "INV-2026-031", "x")[9])


if __name__ == "__main__":
    unittest.main()
