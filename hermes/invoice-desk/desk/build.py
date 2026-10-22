"""Fill the invoice template for one cockpit_invoices row, and check the PDF.

The same fill runs in the browser for the cockpit's live preview
(apps/client-success-cockpit/src/lib/invoiceTemplate.ts). Both are checked
against tests/golden/, so the preview and the issued PDF cannot drift apart.
Every value a person typed is HTML-escaped; only the payment lines, which this
module builds from escaped parts, go in as markup.
"""
from __future__ import annotations

import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

TEMPLATE = Path(__file__).resolve().parent.parent / "template.html"
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
PAID_BADGE = "Paid in full"
PAYEE = "BassamCo For Product Promotion"
LOCK_REASON = "Issued invoice. Locked so it matches the invoice register."
_PLACEHOLDER = re.compile(r"\{\{([A-Z_]+)\}\}")


class BuildError(Exception):
    """A problem with the invoice itself, said so the person can fix it."""


def esc(value: Any) -> str:
    return (str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&#x27;"))


def money(value: Any) -> str:
    """6000 -> '6,000.00'."""
    amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{amount:,.2f}"


def day(iso: Any) -> str:
    """'2026-10-06' -> '6 Oct 2026'."""
    d = date.fromisoformat(str(iso)[:10])
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def strip_block(html: str, tag: str, keep: bool) -> str:
    """Keep or drop every <!--IF_TAG--> ... <!--/IF_TAG--> region."""
    pattern = re.compile(rf"<!--IF_{tag}-->.*?<!--/IF_{tag}-->", re.S)
    if not pattern.search(html):
        raise BuildError(f"The invoice template is missing its IF_{tag} block.")
    return pattern.sub(lambda m: m.group(0) if keep else "", html)


def paid_lines(payments: list[dict[str, Any]]) -> str:
    out = []
    for p in payments:
        parts = [esc(day(p["date"])), esc(p["method"]), f"USD <b>{esc(money(p['amount']))}</b>"]
        if p.get("ref"):
            parts.append(f"REF {esc(p['ref'])}")
        out.append('<div class="receipt-line">' + " &nbsp;·&nbsp; ".join(parts) + "</div>")
    return "\n".join(out)


def pay_note(inv: dict[str, Any]) -> str:
    if inv.get("pay_note"):
        return str(inv["pay_note"])
    if inv["kind"] == "paid":
        return f"This invoice confirms that {PAYEE} received USD {money(inv['amount_usd'])} in full. Nothing further is due."
    if inv["kind"] == "autocharge":
        return "No action is needed on your side. This invoice is issued for your records."
    return ""


def paid_on(inv: dict[str, Any]) -> str:
    """The day the last payment arrived, as an ISO date. Empty unless paid."""
    if inv["kind"] != "paid" or not inv.get("payments"):
        return ""
    return max(str(p["date"])[:10] for p in inv["payments"])


def fill(inv: dict[str, Any], invoice_no: str, template: str) -> str:
    kind = inv["kind"]
    if kind not in ("checkout", "autocharge", "paid"):
        raise BuildError(f"Unknown invoice type {kind!r}.")
    period = (inv.get("period") or "").strip()
    tax_id = (inv.get("client_tax_id") or "").strip()
    html = template
    html = strip_block(html, "CHECKOUT", kind == "checkout")
    html = strip_block(html, "AUTOCHARGE", kind == "autocharge")
    html = strip_block(html, "PAID", kind == "paid")
    html = strip_block(html, "PERIOD", bool(period))
    html = strip_block(html, "TAX_ID", bool(tax_id))
    amount = money(inv["amount_usd"])
    due = inv.get("due_date")
    values: dict[str, str] = {
        "INVOICE_NO": esc(invoice_no),
        "ISSUE_DATE": esc(day(inv["issue_date"])),
        "DUE_DATE": esc(day(due)) if due else "",
        "PAID_DATE": esc(day(paid_on(inv))) if kind == "paid" else "",
        "PAID_BADGE": esc(PAID_BADGE),
        "PAID_LINES": paid_lines(inv.get("payments") or []) if kind == "paid" else "",
        "CLIENT_NAME": esc(inv["client_name"]),
        "CLIENT_DETAIL": esc(inv.get("client_detail") or ""),
        "CLIENT_TAX_ID": esc(tax_id),
        "DESCRIPTION": esc(inv["description"]),
        "LINE_NOTE": esc(inv.get("line_note") or ""),
        "PERIOD": esc(period),
        "AMOUNT": esc(amount),
        "AMOUNT_FULL": esc(amount),
        "CHECKOUT_URL": esc(inv.get("checkout_url") or ""),
        "PAY_NOTE": esc(pay_note(inv)),
    }

    def put(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in values:
            raise BuildError(f"The invoice template asks for {{{{{name}}}}}, which the invoice desk does not fill.")
        return values[name]

    # One pass: text a person typed is never read again as a placeholder.
    return _PLACEHOLDER.sub(put, html)


def file_name(invoice_no: str, client: str) -> str:
    clean = re.sub(r"[\x00-\x1f]", " ", client).strip()
    return f"{invoice_no} - {clean}.pdf"


def pdf_problems(pdf: bytes) -> list[str]:
    """Plain sentences for anything that keeps a PDF from being issued."""
    problems = []
    pages = len(re.findall(rb"/Type\s*/Page[^s]", pdf))
    if pages != 1:
        problems.append(f"The invoice came out at {pages} pages and must fit on one. "
                        "Shorten the description, the line under it or the note, then press Try again.")
    if b"/FontFamily (Geist)" not in pdf or b"/FontFamily (Geist Mono)" not in pdf:
        problems.append("The invoice fonts did not load on the worker. Press Try again in a few minutes; "
                        "if it happens again, tell Muhammed.")
    return problems


def register_row(inv: dict[str, Any], invoice_no: str, link: str) -> list[Any]:
    """One row for 07: Invoice Register, in make_invoice.py's column order."""
    kind = inv["kind"]
    due = str(inv.get("due_date") or paid_on(inv) or inv["issue_date"])[:10]
    who = inv.get("requested_by") or "the cockpit"
    if kind == "paid":
        lines = "; ".join(
            f"{str(p['date'])[:10]} {p['method']} ${money(p['amount'])}" + (f" ref {p['ref']}" if p.get("ref") else "")
            for p in inv.get("payments") or [])
        summary = f"Paid in full: {lines}."
    elif kind == "checkout":
        made = f" (Whop plan {inv['whop_plan_id']}, made by the invoice desk)" if inv.get("whop_plan_id") else ""
        summary = f"Pay online link{made}: {inv.get('checkout_url')}."
    else:
        summary = "Card on file, charged automatically on the due date."
    notes = f"{inv['description']}. {summary} Issued from the client success cockpit by {who}."
    return [invoice_no, inv["client_name"], inv["clickup_task_id"], float(Decimal(str(inv["amount_usd"]))),
            str(inv["issue_date"])[:10], due, link, "Paid" if kind == "paid" else "Pending", "", notes]


def next_number(year: int, *taken: list[str]) -> str:
    """INV-<year>-### one above the highest number used this year anywhere."""
    top = 0
    pattern = re.compile(rf"INV-{year}-(\d+)")
    for numbers in taken:
        for value in numbers:
            m = pattern.fullmatch(str(value).strip())
            if m:
                top = max(top, int(m.group(1)))
    return f"INV-{year}-{top + 1:03d}"
