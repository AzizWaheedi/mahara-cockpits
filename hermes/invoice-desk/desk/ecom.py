"""Ecom invoice links, with a fresh USD/KWD quote and find-before-create retries."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from . import http

API = "https://api-live.ecom.io/elinks/v1/api/invoices"
RATE_URL = "https://open.er-api.com/v6/latest/USD"
ID = re.compile(r"^INV_[A-Za-z0-9]+$")


class EcomRefused(Exception):
    pass


def rate_from(data: dict[str, Any], now: datetime | None = None) -> tuple[Decimal, str]:
    now = now or datetime.now(timezone.utc)
    try:
        updated = datetime.fromtimestamp(int(data["time_last_update_unix"]), timezone.utc)
        rate = Decimal(str(data["rates"]["KWD"]))
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        raise EcomRefused("USD/KWD quote is incomplete; no Ecom link was created.") from exc
    if data.get("result") != "success" or not rate.is_finite() or rate <= 0 or not (timedelta(0) <= now - updated <= timedelta(hours=48)):
        raise EcomRefused("USD/KWD quote is stale or invalid; no Ecom link was created.")
    return rate.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP), updated.isoformat()


def kwd(amount: Any, rate: Decimal) -> Decimal:
    value = (Decimal(str(amount)) * rate).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    if value < Decimal("0.500"):
        raise EcomRefused("Ecom requires at least KWD 0.500; this converted invoice is below its minimum.")
    return value


class Ecom:
    def __init__(self, token: str, mid: str, api: str = API):
        self.api = api
        self.headers = {"X-Ecom-Api-Token": token, "X-Ecom-Mid": mid, "Accept": "application/json"}

    def quote(self) -> tuple[Decimal, str]:
        return rate_from(http.get_json(RATE_URL))

    def find(self, invoice_id: str, number: str) -> dict[str, Any] | None:
        for page in range(1, 101):
            data = http.get_json(f"{self.api}?page={page}&take=50&order=DESC", headers=self.headers)
            rows = data.get("data") or []
            matches = [r for r in rows if (r.get("metadata") or {}).get("key1") == invoice_id or r.get("merchantReference") == number]
            if matches:
                return matches[0]
            if not rows or (data.get("meta") or {}).get("hasNextPage") is not True:
                return None
        raise EcomRefused("Ecom invoice lookup exceeded 100 pages; cannot safely create another link.")

    def create(self, inv: dict[str, Any], number: str, amount: Decimal) -> dict[str, Any]:
        # Ecom requires an 8-12 digit phone even with both notifications disabled.
        # Sandbox accepted this explicit non-routable placeholder; it is never used to notify.
        body = {"amount": {"value": float(amount), "currency": "KWD"},
                "customer": {"fullName": inv["client_name"], "phoneCode": "+965", "phoneNumber": "00000000"},
                "notification": {"sms": False, "email": False}, "language": "en",
                "merchantReference": number, "description": inv["description"],
                "purposeEn": inv["description"],
                "metadata": {"key1": inv["id"], "key2": number, "key3": "cockpit-invoice"}}
        if inv.get("due_date"):
            due = datetime.fromisoformat(str(inv["due_date"])[:10]).replace(tzinfo=timezone.utc)
            body["expiresAt"] = (due + timedelta(days=15)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        else:
            body["neverExpire"] = True
        return (http.send_json("POST", self.api, body, headers=self.headers) or {}).get("data") or {}

    def check(self, invoice: dict[str, Any], amount: Decimal) -> str:
        invoice_id = str(invoice.get("id") or "")
        url = str(invoice.get("paymentUrl") or "")
        actual = invoice.get("amount") or {}
        if not ID.fullmatch(invoice_id) or not url.startswith("https://invoice.ecom.io/") or not re.fullmatch(r"https://invoice\.ecom\.io/[^\s<>\"']+", url):
            raise EcomRefused("Ecom did not return a valid invoice id and payment URL.")
        if (actual.get("currency") != "KWD" or Decimal(str(actual.get("value") or 0)) != amount
                or invoice.get("status") != "UNPAID"):
            raise EcomRefused(f"Ecom invoice {invoice_id} has a different amount, currency or status; do not create another link.")
        return url
