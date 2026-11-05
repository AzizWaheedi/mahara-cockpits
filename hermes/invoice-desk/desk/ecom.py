"""Ecom invoice links, with a fresh USD/KWD quote and find-before-create retries.

An Ecom invoice an earlier try made is kept when only the day's rate moved
(rate_moved, as for Tap), and a link recorded on an earlier try is read back
(GET /invoices/{id}) before it is printed again, so an expired, cancelled or
deleted link never goes out on a PDF.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

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


def rate_moved(made: Any, amount_usd: Any, fresh: Decimal) -> Optional[tuple[Decimal, Decimal]]:
    """The KWD amount of a link an earlier try made, and the rate it implies,
    when only the day's USD/KWD rate moved since (within 3% of today's amount).
    None when it already matches today's amount, or is too far off to be a rate
    move (the processor's check then refuses it). Ecom and Tap share this."""
    try:
        earlier = Decimal(str(made)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
        usd = Decimal(str(amount_usd))
    except (ArithmeticError, ValueError, TypeError):
        return None
    if not earlier.is_finite() or earlier == fresh or usd <= 0 or abs(earlier - fresh) > fresh * Decimal("0.03"):
        return None
    return earlier, (earlier / usd).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def kept(found: dict[str, Any], amount_usd: Any, fresh: Decimal) -> Optional[tuple[Decimal, Decimal]]:
    """The Ecom invoice an earlier try made, at that day's rate (see rate_moved)."""
    return rate_moved((found.get("amount") or {}).get("value"), amount_usd, fresh)


# What Ecom calls an invoice it will no longer take a payment on. Its list and
# its single read both carry the status; an invoice deleted in Ecom answers 404.
CLOSED = {"EXPIRED": "expired", "CANCELLED": "cancelled", "CANCELED": "cancelled", "DELETED": "deleted"}


def closed(invoice: Optional[dict[str, Any]], ecom_id: str, now: Optional[datetime] = None) -> Optional[str]:
    """Why a recorded Ecom link can no longer take the payment ("expired",
    "cancelled", "deleted"), or None while it can (unpaid and not past its
    expiry) or already did (paid). Raises EcomRefused for an answer that does
    not say which."""
    if invoice is None:
        return "deleted"
    if str(invoice.get("id") or "") != ecom_id:
        raise EcomRefused(f"Ecom answered with another invoice than {ecom_id}.")
    status = str(invoice.get("status") or "").upper()
    if status in CLOSED:
        return CLOSED[status]
    if status == "PAID":
        return None
    if status != "UNPAID":
        raise EcomRefused(f"Ecom says invoice {ecom_id} is {status.lower() or 'without a status'}.")
    if invoice.get("neverExpire") is not True and invoice.get("expiresAt"):
        try:
            expires = datetime.fromisoformat(str(invoice["expiresAt"]).replace("Z", "+00:00"))
        except ValueError:
            return None
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires <= (now or datetime.now(timezone.utc)):
            return "expired"
    return None


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

    def get(self, ecom_invoice_id: str) -> Optional[dict[str, Any]]:
        """One invoice as Ecom holds it now, or None when Ecom no longer has it (404)."""
        if not ID.fullmatch(ecom_invoice_id or ""):
            raise EcomRefused(f"{ecom_invoice_id!r} is not an Ecom invoice id.")
        try:
            data = http.get_json(f"{self.api}/{http.quote(ecom_invoice_id)}", headers=self.headers)
        except http.HttpError as exc:
            if exc.status == 404:
                return None
            raise
        found = (data or {}).get("data") if isinstance(data, dict) else None
        if not isinstance(found, dict) or not found:
            raise EcomRefused(f"Ecom's answer for invoice {ecom_invoice_id} holds no invoice.")
        return found

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
        try:
            value = Decimal(str(actual.get("value") or 0))
        except ArithmeticError:
            value = None
        status = str(invoice.get("status") or "")
        if actual.get("currency") != "KWD" or value != amount or status != "UNPAID":
            raise EcomRefused(f"Ecom invoice {invoice_id} is {status.lower() or 'without a status'} for "
                              f"{actual.get('currency') or '?'} {actual.get('value')}, not unpaid for KWD {amount:.3f}.")
        # Unpaid, but Ecom may not have marked a lapsed link expired yet.
        why = closed(invoice, invoice_id)
        if why:
            raise EcomRefused(f"Ecom invoice {invoice_id} is {why}.")
        return url
