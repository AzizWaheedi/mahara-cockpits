"""The Whop payment link for a "Pay online" invoice (15 Oct 2026).

One hidden one-time plan per invoice, for exactly the invoice amount, under
the product every client link uses. The plan's internal notes carry the
invoice id (MARK + id), so the worker can always find the plan it made: after
a crash, a timeout or a retry it searches first and creates only when Whop has
no plan for that invoice. An unused hidden plan charges nobody, so the worst
case of a lost answer is one spare plan, never a second link on an invoice.
"""
from __future__ import annotations

import re
from decimal import Decimal
from typing import Any, Optional

from . import http

API = "https://api.whop.com/api/v2"
MARK = "cockpit-invoice:"
PLAN_ID = re.compile(r"^plan_[A-Za-z0-9]{6,40}$")


class WhopRefused(Exception):
    """Whop answered, and the plan is not usable. The message says why."""


def checkout_url(plan_id: str) -> str:
    return f"https://whop.com/checkout/{plan_id}"


def notes_for(inv: dict[str, Any], invoice_no: str) -> str:
    return (f"{inv['client_name']} {str(inv['issue_date'])[:10]} {invoice_no} "
            f"(ClickUp {inv['clickup_task_id']}, {MARK}{inv['id']})")[:500]


class Whop:
    def __init__(self, api_key: str, product: str):
        self.h = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
        self.product = product

    def find(self, invoice_id: str, max_pages: int = 30) -> Optional[dict[str, Any]]:
        """The plan this invoice made earlier, if Whop has one."""
        mark = MARK + invoice_id
        found: list[dict[str, Any]] = []
        for page in range(1, max_pages + 1):
            data = http.get_json(f"{API}/plans?per=50&page={page}", headers=self.h)
            rows = (data or {}).get("data") or []
            found += [p for p in rows if mark in str(p.get("internal_notes") or "")]
            pag = (data or {}).get("pagination") or {}
            pages = int(pag.get("total_page") or pag.get("total_pages") or 0)
            if not rows or (pages and page >= pages):
                break
        if len(found) > 1:
            # Two plans for one invoice can only come from a lost answer; the
            # oldest is kept so the link on a re-issued PDF never changes.
            found.sort(key=lambda p: p.get("created_at") or 0)
        return found[0] if found else None

    def create(self, amount: Any, notes: str) -> dict[str, Any]:
        """Sent once. A lost answer is resolved by find(), never by resending."""
        body = {
            "plan_type": "one_time",
            "initial_price": float(Decimal(str(amount))),
            "base_currency": "usd",
            "product": self.product,
            "release_method": "buy_now",
            "visibility": "hidden",
            "internal_notes": notes,
        }
        return http.send_json("POST", f"{API}/plans", body, headers=self.h) or {}

    def check(self, plan: dict[str, Any], amount: Any) -> str:
        """The plan's checkout link, after checking it is the plan we asked for."""
        plan_id = str(plan.get("id") or "")
        if not PLAN_ID.match(plan_id):
            raise WhopRefused("Whop did not return a plan id for the payment link.")
        problems = []
        if plan.get("plan_type") != "one_time":
            problems.append(f"it is {plan.get('plan_type')}, not one-time")
        if Decimal(str(plan.get("initial_price") or 0)) != Decimal(str(amount)):
            problems.append(f"its price is {plan.get('initial_price')}, not {amount}")
        if Decimal(str(plan.get("renewal_price") or 0)) != 0:
            problems.append("it renews")
        if plan.get("product") and plan.get("product") != self.product:
            problems.append("it sits under another product")
        if plan.get("visibility") not in (None, "hidden"):
            problems.append(f"it is {plan.get('visibility')}, not hidden")
        if problems:
            raise WhopRefused(f"The Whop plan {plan_id} does not match this invoice: " + "; ".join(problems) + ".")
        # Built from the id, not Whop's direct_link, whose form may carry extras;
        # whop.com/checkout/<plan id> is the form proven on INV-2026-025.
        return checkout_url(plan_id)
