"""Tap payment links for "Pay online" invoices (5 Nov 2026), a backup to Ecom.

The worker holds no Tap key. It asks the Supabase Edge Function invoice-tap,
which holds the live key (TAP_SECRET_KEY, the one tap-charges-sync reads) and
builds the one request body the cockpit sends to Tap, with Tap's own messages
off. The rest is Ecom's discipline: KWD at the day's rate (refused when the
quote is over 48 hours old), a started mark saved before the create, a lookup
by the invoice's id after an unknown outcome, and the answer checked before
the link is printed on the invoice.
"""
from __future__ import annotations

import json
import re
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Optional

from . import ecom, http

ID = re.compile(r"^inv_[A-Za-z0-9]{6,80}$")
URL = re.compile(r"^https://([a-z0-9-]+\.)*tap\.company/[^\s<>\"']+$")
MIN_KWD = Decimal("0.100")


class TapRefused(Exception):
    """invoice-tap or Tap refused this link. The message says why."""


def kwd(amount: Any, rate: Decimal) -> Decimal:
    value = (Decimal(str(amount)) * rate).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    if value < MIN_KWD:
        raise TapRefused(f"Tap links start at KWD {MIN_KWD}; this invoice converts to less.")
    return value


def usd(amount: Any) -> str:
    return f"{Decimal(str(amount)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):f}"


def kept(found: dict[str, Any], amount_usd: Any, fresh: Decimal) -> Optional[tuple[Decimal, Decimal]]:
    """The Tap invoice an earlier try made, at that day's rate: its KWD amount
    and the rate it implies, when only the day's rate moved since (within 3%).
    None when it already matches today's amount, or is too far off to be a
    rate move (check then refuses it). The rule is ecom.rate_moved, shared."""
    return ecom.rate_moved(found.get("amount"), amount_usd, fresh)


class Tap:
    def __init__(self, supabase_url: str, service_key: str):
        self.url = supabase_url.rstrip("/") + "/functions/v1/invoice-tap"
        self.h = {"Authorization": f"Bearer {service_key}", "apikey": service_key, "Accept": "application/json"}

    def call(self, body: dict[str, Any]) -> dict[str, Any]:
        try:
            return http.send_json("POST", self.url, body, headers=self.h) or {}
        except http.HttpError as e:
            # 409: invoice-tap or Tap refused this request. Anything else may pass.
            if e.status == 409:
                try:
                    reason = (json.loads(e.body or b"{}") or {}).get("error")
                except ValueError:
                    reason = None
                raise TapRefused(http.scrub(reason or "Tap refused the link.")) from None
            raise

    def quote(self) -> tuple[Decimal, str]:
        return ecom.rate_from(http.get_json(ecom.RATE_URL))

    def find(self, invoice_id: str) -> Optional[dict[str, Any]]:
        return self.call({"op": "find", "invoiceId": invoice_id}).get("invoice")

    def get(self, tap_invoice_id: str, invoice_id: str) -> Optional[dict[str, Any]]:
        return self.call({"op": "get", "tapInvoiceId": tap_invoice_id, "invoiceId": invoice_id}).get("invoice")

    def create(self, inv: dict[str, Any], number: str, amount: Decimal) -> dict[str, Any]:
        return self.call({
            "op": "create",
            "invoiceId": inv["id"],
            "number": number,
            "clientName": inv["client_name"],
            "clientEmail": inv.get("client_email") or "",
            "description": inv["description"],
            "amountKwd": f"{amount:.3f}",
            "amountUsd": usd(inv["amount_usd"]),
            "dueDate": str(inv.get("due_date") or inv["issue_date"])[:10],
        }).get("invoice") or {}

    def doctor(self) -> dict[str, Any]:
        return self.call({"op": "doctor"})

    @staticmethod
    def check(found: dict[str, Any], invoice_id: str, amount: Decimal) -> str:
        tap_id = str(found.get("id") or "")
        url = str(found.get("url") or "")
        if not ID.fullmatch(tap_id) or not URL.fullmatch(url) or "sandbox" in url.lower() or found.get("live") is not True:
            raise TapRefused("Tap did not return a live invoice id and payment page.")
        if found.get("cockpitInvoice") != invoice_id:
            raise TapRefused(f"Tap invoice {tap_id} belongs to another cockpit invoice.")
        if found.get("currency") != "KWD" or Decimal(str(found.get("amount") or 0)).quantize(Decimal("0.001")) != amount:
            raise TapRefused(f"Tap invoice {tap_id} has a different amount or currency; do not make another link.")
        if found.get("status") not in ("UNPAID", "PAID"):
            raise TapRefused(f"Tap invoice {tap_id} is {str(found.get('status')).lower()}.")
        return url
