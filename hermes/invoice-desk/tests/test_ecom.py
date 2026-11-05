import unittest
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from unittest.mock import patch

from desk import ecom, http
from desk.worker import Desk, Passing, Problem

from test_worker import FakeGoogle, FakeSupa, desk as worker_desk, fresh

INV = "8f451d80-b3bd-4bd5-b912-b1dc37aa7a71"
FOUND = {"id": "INV_20261105Example", "paymentUrl": "https://invoice.ecom.io/E_LINKS/pending?paymentToken=INV_x",
         "status": "UNPAID", "amount": {"value": "0.620", "currency": "KWD"},
         "expiresAt": "2099-01-01T00:00:00.000Z", "neverExpire": False}


class Store:
    def __init__(self):
        self.patches = []

    def progress(self, _id, patch):
        self.patches.append(patch)


class API:
    """Ecom as the worker sees it, with Ecom.check for real. Never the network."""
    check = ecom.Ecom.check

    def __init__(self, found=None, created=None, live=None, read_error=None):
        self.found, self.created, self.read_error = found, created, read_error
        self.live = {**FOUND} if live is None else live
        self.calls = []

    def quote(self):
        self.calls.append(("quote",))
        return Decimal("0.310000"), "2026-11-05T00:00:00+00:00"

    def find(self, invoice_id, number):
        self.calls.append(("find", invoice_id))
        return self.found

    def get(self, ecom_invoice_id):
        self.calls.append(("get", ecom_invoice_id))
        if self.read_error:
            raise self.read_error
        return self.live or None

    def create(self, inv, number, amount):
        self.calls.append(("create", number, f"{amount:.3f}"))
        return self.created


def invoice(**over):
    return {"id": INV, "kind": "checkout", "checkout_source": "ecom", "amount_usd": "2", "client_name": "Example Clinic",
            "description": "Month 2", "due_date": "2026-11-20", "issue_date": "2026-11-05", **over}


def recorded(**over):
    return invoice(ecom_invoice_id=FOUND["id"], checkout_url=FOUND["paymentUrl"], **over)


class EcomTests(unittest.TestCase):
    def test_rounding_and_freshness(self):
        now = datetime(2026, 10, 22, tzinfo=timezone.utc)
        payload = {"result": "success", "rates": {"KWD": 0.309625},
                   "time_last_update_unix": int((now - timedelta(hours=47)).timestamp())}
        rate, _ = ecom.rate_from(payload, now)
        self.assertEqual(ecom.kwd("6000", rate), Decimal("1857.750"))
        payload["time_last_update_unix"] = int((now - timedelta(hours=49)).timestamp())
        with self.assertRaisesRegex(ecom.EcomRefused, "stale"):
            ecom.rate_from(payload, now)
        payload["result"] = "error"
        with self.assertRaises(ecom.EcomRefused):
            ecom.rate_from(payload, now)

    def test_find_before_create(self):
        api = ecom.Ecom("test", "test")
        row = {"id": "INV_123456", "merchantReference": "INV-2026-002", "metadata": {"key1": "uuid"}}
        with patch.object(ecom.http, "get_json", return_value={"data": [row], "meta": {"hasNextPage": False}}) as get:
            self.assertEqual(api.find("uuid", "INV-2026-002"), row)
            self.assertEqual(get.call_count, 1)

    def test_refuses_wrong_amount_currency_and_url(self):
        api = ecom.Ecom("test", "test")
        row = {"id": "INV_123456", "paymentUrl": "https://invoice.ecom.io/pending", "status": "UNPAID",
               "amount": {"value": "0.500", "currency": "KWD"}}
        self.assertEqual(api.check(row, Decimal("0.500")), row["paymentUrl"])
        for patch in ({"status": "PAID"}, {"amount": {"value": "0.600", "currency": "KWD"}},
                      {"paymentUrl": "https://bad.ecom.io/pending"}):
            with self.assertRaises(ecom.EcomRefused):
                api.check({**row, **patch}, Decimal("0.500"))

    def test_worker_persists_start_and_reuses_found(self):
        class Store:
            def __init__(self): self.patches = []
            def progress(self, _id, patch): self.patches.append(patch)
        class API:
            def quote(self): return Decimal("0.310000"), "2026-10-22T00:00:00+00:00"
            def find(self, *_): return {"id": "INV_123456", "paymentUrl": "https://invoice.ecom.io/pending", "status": "UNPAID", "amount": {"currency": "KWD", "value": "0.620"}}
            def create(self, *_): raise AssertionError("must not create twice")
            check = ecom.Ecom.check
        store = Store()
        desk = Desk(store, None, None, "", ecom_api=API())
        inv = {"id": "uuid", "kind": "checkout", "checkout_source": "ecom", "amount_usd": "2", "ecom_started_at": "yesterday"}
        desk.ecom_link(inv, "INV-2026-002")
        self.assertEqual(store.patches[0]["ecomInvoiceId"], "INV_123456")

    # An earlier Ecom invoice when only the day's rate moved --------------------
    def test_an_earlier_ecom_invoice_is_kept_when_only_the_days_rate_moved(self):
        # Made yesterday at 0.307 (KWD 0.614 for USD 2); today's quote is 0.310 (KWD 0.620).
        store, api = Store(), API(found={**FOUND, "amount": {"value": "0.614", "currency": "KWD"}})
        inv = invoice(ecom_started_at="2026-11-04T10:00:00Z")
        Desk(store, None, None, "", ecom_api=api).link(inv, "INV-2026-031")
        self.assertEqual(api.calls, [("quote",), ("find", INV)])
        self.assertEqual(store.patches, [{"ecomInvoiceId": FOUND["id"], "checkoutUrl": FOUND["paymentUrl"],
                                          "amountKwd": "0.614", "kwdRate": "0.307000",
                                          "kwdRateAt": "2026-11-05T00:00:00+00:00"}])
        self.assertEqual((inv["amount_kwd"], inv["kwd_rate"]), ("0.614", "0.307000"))

    def test_the_rate_move_rule_is_within_three_percent_and_shared_with_tap(self):
        self.assertEqual(ecom.kept({"amount": {"value": "0.614"}}, "2", Decimal("0.620")),
                         (Decimal("0.614"), Decimal("0.307000")))
        self.assertEqual(ecom.kept({"amount": {"value": "1500.000"}}, "4850", Decimal("1501.075")),
                         (Decimal("1500.000"), Decimal("0.309278")))
        self.assertIsNone(ecom.kept({"amount": {"value": "0.620"}}, "2", Decimal("0.620")))  # nothing moved
        self.assertIsNone(ecom.kept({"amount": {"value": "0.639"}}, "2", Decimal("0.620")))  # over 3%
        for bad in ({}, {"amount": None}, {"amount": {"value": "abc"}}, {"amount": {"value": "NaN"}}):
            self.assertIsNone(ecom.kept(bad, "2", Decimal("0.620")), msg=str(bad))
        self.assertIsNone(ecom.kept({"amount": {"value": "0.614"}}, "0", Decimal("0.620")))
        self.assertEqual(ecom.rate_moved(0.614, "2", Decimal("0.620")), (Decimal("0.614"), Decimal("0.307000")))

    def test_an_earlier_ecom_invoice_far_off_is_refused_without_advising_a_switch(self):
        for far in ({"amount": {"value": "0.900", "currency": "KWD"}}, {"status": "PAID"}, {"status": "EXPIRED"},
                    {"amount": {"value": "0.614", "currency": "USD"}}, {"expiresAt": "2026-11-01T00:00:00.000Z"}):
            store, api = Store(), API(found={**FOUND, **far})
            with self.assertRaisesRegex(Problem, "^Ecom already holds a link for this invoice that the cockpit cannot use "
                                                 r"\(Ecom invoice INV_20261105Example .*\) Tell Muhammed before trying "
                                                 "again or switching.$") as caught:
                Desk(store, None, None, "", ecom_api=api).link(invoice(ecom_started_at="2026-11-04T10:00:00Z"), "INV-2026-031")
            for advice in ("Use a Tap link", "Use a Whop link", "instead"):
                self.assertNotIn(advice, str(caught.exception), msg=str(far))
            self.assertEqual(store.patches, [], msg=str(far))
            self.assertNotIn("create", [c[0] for c in api.calls], msg=str(far))

    def test_a_first_try_still_marks_started_then_creates_once(self):
        store, api = Store(), API(created={**FOUND})
        Desk(store, None, None, "", ecom_api=api).link(invoice(), "INV-2026-031")
        self.assertEqual(api.calls, [("quote",), ("create", "INV-2026-031", "0.620")])
        self.assertEqual(store.patches[0], {"ecomStarted": True})
        self.assertEqual(store.patches[1]["amountKwd"], "0.620")
        self.assertEqual(store.patches[1]["kwdRate"], "0.310000")

    # A link recorded on an earlier try --------------------------------------
    def test_a_recorded_link_is_read_back_and_reused_while_ecom_can_take_the_payment(self):
        for live in ({**FOUND}, {**FOUND, "status": "PAID"}, {**FOUND, "neverExpire": True, "expiresAt": "2020-01-01T00:00:00Z"},
                     {**FOUND, "expiresAt": None}):
            store, api = Store(), API(live=live)
            inv = recorded()
            Desk(store, None, None, "", ecom_api=api).link(inv, "INV-2026-031")
            self.assertEqual(api.calls, [("get", FOUND["id"])], msg=str(live))
            self.assertEqual(store.patches, [])
            self.assertEqual(inv["checkout_url"], FOUND["paymentUrl"])

    def test_a_dead_recorded_link_is_never_printed(self):
        cases = {"expired": {**FOUND, "status": "EXPIRED"}, "cancelled": {**FOUND, "status": "CANCELLED"},
                 "deleted": {}}  # Ecom answers 404 for a deleted invoice; the fake returns None
        cases["expired "] = {**FOUND, "expiresAt": "2026-11-01T00:00:00.000Z"}  # past its date, not yet marked
        for word, live in cases.items():
            api = API(live=live)
            with self.assertRaisesRegex(Problem, f"^This invoice's Ecom link is {word.strip()}, so the invoice cannot go out "
                                                 "with it. Cancel this invoice and make a new one.$"):
                Desk(Store(), None, None, "", ecom_api=api).link(recorded(), "INV-2026-031")
            self.assertEqual(api.calls, [("get", FOUND["id"])])

    def test_an_unclear_read_back_stops_the_invoice_or_waits(self):
        for live in ({**FOUND, "status": "PROCESSING"}, {**FOUND, "id": "INV_another"}):
            with self.assertRaisesRegex(Problem, "^Ecom did not confirm this invoice's link .* Tell Muhammed.$"):
                Desk(Store(), None, None, "", ecom_api=API(live=live)).link(recorded(), "INV-2026-031")
        with self.assertRaisesRegex(Problem, "cannot read payment links"):
            Desk(Store(), None, None, "", ecom_api=API(read_error=http.HttpError(401, "no"))).link(recorded(), "INV-2026-031")
        with self.assertRaisesRegex(Problem, "Ecom did not confirm this invoice's link"):
            Desk(Store(), None, None, "", ecom_api=API(read_error=http.HttpError(400, "bad"))).link(recorded(), "INV-2026-031")
        with self.assertRaises(http.HttpError):  # Ecom down: the next run tries again
            Desk(Store(), None, None, "", ecom_api=API(read_error=http.HttpError(502, "bad gateway"))).link(recorded(), "INV-2026-031")
        with self.assertRaisesRegex(Problem, "Ecom credentials are missing"):
            Desk(Store(), None, None, "").link(recorded(), "INV-2026-031")

    def test_get_reads_one_invoice_and_reads_404_as_deleted(self):
        api = ecom.Ecom("test", "test")
        with patch.object(ecom.http, "get_json", return_value={"data": FOUND}) as get:
            self.assertEqual(api.get(FOUND["id"]), FOUND)
            self.assertEqual(get.call_args.args[0], f"{ecom.API}/{FOUND['id']}")
            self.assertEqual(get.call_args.kwargs["headers"]["X-Ecom-Mid"], "test")
        missing = http.HttpError(404, '{"error":{"statusCode":404,"message":[" can\'t be found with the filter."]}}')
        with patch.object(ecom.http, "get_json", side_effect=missing):
            self.assertIsNone(api.get(FOUND["id"]))
        with patch.object(ecom.http, "get_json", side_effect=http.HttpError(503, "down")):
            with self.assertRaises(http.HttpError):
                api.get(FOUND["id"])
        for empty in ({"data": None}, {}, None, {"data": {}}):
            with patch.object(ecom.http, "get_json", return_value=empty):
                with self.assertRaisesRegex(ecom.EcomRefused, "holds no invoice", msg=str(empty)):
                    api.get(FOUND["id"])
        with patch.object(ecom.http, "get_json") as get:
            with self.assertRaises(ecom.EcomRefused):
                api.get("INV_x/../../other")
            get.assert_not_called()

    def test_closed_reads_the_status_and_the_expiry(self):
        now = datetime(2026, 11, 5, 12, tzinfo=timezone.utc)
        self.assertIsNone(ecom.closed({**FOUND, "expiresAt": "2026-11-12T00:00:00.000Z"}, FOUND["id"], now))
        self.assertEqual(ecom.closed({**FOUND, "expiresAt": "2026-11-05T11:59:59.000Z"}, FOUND["id"], now), "expired")
        self.assertIsNone(ecom.closed({**FOUND, "expiresAt": "not a date"}, FOUND["id"], now))
        self.assertEqual(ecom.closed({**FOUND, "status": "DELETED"}, FOUND["id"], now), "deleted")
        self.assertEqual(ecom.closed(None, FOUND["id"], now), "deleted")

    def test_a_recorded_dead_link_fails_the_invoice_before_anything_is_printed(self):
        supa, google = FakeSupa(folder={"folder_id": "folderShades123"}), FakeGoogle()
        printed = []
        d = worker_desk(supa, google)
        d.render = lambda html: printed.append(html) or b""
        d.ecom_api = API(live={**FOUND, "status": "EXPIRED"})
        row = fresh(id=INV, invoice_no="INV-2026-031", kind="checkout", checkout_source="ecom", amount_usd="2",
                    ecom_invoice_id=FOUND["id"], checkout_url=FOUND["paymentUrl"], amount_kwd="0.620", kwd_rate="0.310000")
        self.assertEqual(d.process(row), "failed")
        self.assertEqual(supa.finished, (False, "This invoice's Ecom link is expired, so the invoice cannot go out with it. "
                                               "Cancel this invoice and make a new one."))
        self.assertEqual((printed, google.calls), ([], []))

    def test_missing_key_sentence(self):
        desk = Desk(None, None, None, "")
        with self.assertRaisesRegex(Problem, "Ecom credentials are missing"):
            desk.ecom_link({}, "INV-2026-002")


if __name__ == "__main__": unittest.main()
