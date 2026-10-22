import unittest
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from unittest.mock import patch

from desk import ecom
from desk.worker import Desk, Passing, Problem


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

    def test_missing_key_sentence(self):
        desk = Desk(None, None, None, "")
        with self.assertRaisesRegex(Problem, "Ecom credentials are missing"):
            desk.ecom_link({}, "INV-2026-002")


if __name__ == "__main__": unittest.main()
