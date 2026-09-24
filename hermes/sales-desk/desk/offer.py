"""The offer a proposal prints: offer.json, with the closer's choice applied.

Aziz, 2026-09-24: the offer is "USD 6,000 for three months, ads separate,
USD 500 deposit, 30 qualified meetings", but "could change, should be
flexible and depends if we're giving a guarantee or not or payment plans".
So offer.json holds the program and named options, the proposal request
carries the closer's choice, and this module turns the two into one set of
figures. The drafter is told exactly those figures, the validator checks the
document against exactly those figures, and the deal file carries a stamp of
them so it can be checked again later without the request.
"""
from __future__ import annotations

import json
from fractions import Fraction
from pathlib import Path
from typing import Any, Optional

from .config import ROOT
from .errors import Refused

OFFER_FILE = ROOT / "offer.json"

WORDS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven",
         8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve"}


class OfferError(Refused):
    """offer.json or the closer's choice cannot produce an offer. Said in one sentence."""


def money(amount: Any, currency: str = "USD") -> str:
    return f"{currency} {int(amount):,}"


def months_words(n: int) -> str:
    word = WORDS.get(int(n), str(int(n)))
    return f"{word} month" if int(n) == 1 else f"{word} months"


def load(path: Optional[Path] = None) -> dict[str, Any]:
    p = Path(path or OFFER_FILE)
    try:
        offer = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise OfferError(f"offer.json could not be read ({e}). Fix the file; nothing is drafted until it reads.")
    program = offer.get("program") or {}
    for field in ("name", "price", "months", "meetings", "ads_monthly_min", "ads_monthly_max", "deposit"):
        if program.get(field) in (None, ""):
            raise OfferError(f"offer.json has no program.{field}. Put it back; nothing is drafted until it is there.")
    options = ((offer.get("payment") or {}).get("options") or {})
    if not options:
        raise OfferError("offer.json lists no payment options. Paid in full ('pif') at least has to be there.")
    default = (offer.get("payment") or {}).get("default") or "pif"
    if default not in options:
        raise OfferError(f"offer.json's default payment '{default}' is not one of its options.")
    return offer


def _bool(value: Any, what: str) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in ("true", "yes", "1", "on"):
        return True
    if text in ("false", "no", "0", "off"):
        return False
    raise OfferError(f"The {what} choice was {value!r}; it has to be yes or no.")


def _number(value: Any, what: str, low: float, high: float) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise OfferError(f"The {what} given was {value!r}, which is not a number.")
    if not (low <= n <= high):
        raise OfferError(f"The {what} given was {value!r}; it has to be between {low:,.0f} and {high:,.0f}.")
    return n


def schedule(key: str, option: dict[str, Any], price: int, months: int) -> list[dict[str, Any]]:
    """The instalments of one payment option, in whole dollars, adding up to the price."""
    if option.get("per_month"):
        parts = [{"share": 1, "due_days": 30 * i,
                  "due": "at the start" if i == 0 else f"{30 * i} days after the start"}
                 for i in range(int(months))]
    else:
        parts = [p for p in (option.get("instalments") or []) if isinstance(p, dict)]
    if not parts:
        raise OfferError(f"The payment option '{key}' in offer.json has no instalments.")
    fixed = ["amount" in p for p in parts]
    if all(fixed):
        amounts = [int(p["amount"]) for p in parts]
        if sum(amounts) != price:
            raise OfferError(
                f"The payment option '{key}' in offer.json adds up to {money(sum(amounts))}, not the "
                f"price of {money(price)}. Fix the option in offer.json, or choose another.")
    elif any(fixed):
        raise OfferError(f"The payment option '{key}' in offer.json mixes amounts and shares; use one or the other.")
    else:
        try:
            weights = [Fraction(str(p.get("share"))) for p in parts]
        except (ValueError, ZeroDivisionError):
            raise OfferError(f"The payment option '{key}' in offer.json has a share that is not a number.")
        if any(w <= 0 for w in weights):
            raise OfferError(f"The payment option '{key}' in offer.json has a share of zero or less.")
        total = sum(weights)
        amounts = [int(price * w / total) for w in weights]
        amounts[0] += price - sum(amounts)
    return [{"amount": a, "due_days": int(p.get("due_days") or 0),
             "due": str(p.get("due") or ("at the start" if i == 0 else f"{int(p.get('due_days') or 0)} days after the start"))}
            for i, (a, p) in enumerate(zip(amounts, parts))]


def resolve(offer: dict[str, Any], choice: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """offer.json with the closer's choice applied: every figure the proposal prints."""
    choice = choice if isinstance(choice, dict) else {}
    program = offer["program"]
    payment = offer.get("payment") or {}
    options = payment.get("options") or {}

    price_given = _number(choice.get("price"), "price", 1, 1_000_000)
    months_given = _number(choice.get("months"), "number of months", 1, 36)
    price = int(round(price_given)) if price_given is not None else int(program["price"])
    months = int(round(months_given)) if months_given is not None else int(program["months"])

    key = str(choice.get("payment") or payment.get("default") or "pif").strip()
    if key not in options:
        raise OfferError(f"The payment option '{key}' is not in offer.json. Choose one of: {', '.join(options)}.")
    option = options[key]

    g = offer.get("guarantee") or {}
    guarantee = _bool(choice["guarantee"], "guarantee") if choice.get("guarantee") is not None \
        else bool(g.get("default", False))
    text = None
    if guarantee:
        text = str(g.get("text") or "").strip()
        if not text:
            raise OfferError("The guarantee was chosen but offer.json has no guarantee text to print.")
        text = (text.replace("{meetings}", str(int(program["meetings"])))
                    .replace("{days}", str(months * 30))
                    .replace("{months}", WORDS.get(months, str(months))))

    currency = str(offer.get("currency") or "USD")
    return {
        "currency": currency,
        "program": str(program["name"]),
        "price": price,
        "months": months,
        "meetings": int(program["meetings"]),
        "ads_min": int(program["ads_monthly_min"]),
        "ads_max": int(program["ads_monthly_max"]),
        "ads_daily_min": int(program.get("ads_daily_min") or 0) or None,
        "ads_daily_max": int(program.get("ads_daily_max") or 0) or None,
        "deposit": int(program["deposit"]),
        "guarantee": guarantee,
        "guarantee_text": text,
        "payment": key,
        "payment_label": str(option.get("label") or key),
        "instalments": schedule(key, option, price, months),
        "price_given": price_given is not None,
        "months_given": months_given is not None,
    }


def stamp(resolved: dict[str, Any]) -> dict[str, Any]:
    """What goes into the deal file, so the document can be checked against
    the offer it was written for, later and without the request."""
    return {
        "program": resolved["program"],
        "price_usd": resolved["price"],
        "months": resolved["months"],
        "deposit_usd": resolved["deposit"],
        "ads_monthly_usd": [resolved["ads_min"], resolved["ads_max"]],
        "meetings": resolved["meetings"],
        "guarantee": resolved["guarantee"],
        "payment": resolved["payment"],
        "instalments_usd": [i["amount"] for i in resolved["instalments"]],
        "due": [i["due"] for i in resolved["instalments"]],
    }


def from_deal(deal: dict[str, Any], offer: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """The offer a deal file was written for: its stamp over offer.json.
    A file with no stamp is checked against offer.json's defaults."""
    offer = offer or load()
    s = deal.get("offer") if isinstance(deal.get("offer"), dict) else {}
    options = ((offer.get("payment") or {}).get("options") or {})
    key = s.get("payment") if s.get("payment") in options else None
    resolved = resolve(offer, {"guarantee": s.get("guarantee"), "payment": key,
                               "price": s.get("price_usd"), "months": s.get("months")})
    if s.get("payment") and not key:
        resolved["payment"] = str(s["payment"])
        resolved["payment_label"] = str(s["payment"])
    amounts = s.get("instalments_usd")
    if isinstance(amounts, list) and amounts and all(isinstance(a, (int, float)) for a in amounts):
        due = s.get("due") if isinstance(s.get("due"), list) else []
        resolved["instalments"] = [{"amount": int(a), "due_days": 0,
                                    "due": str(due[i]) if i < len(due) else ""} for i, a in enumerate(amounts)]
    if isinstance(s.get("deposit_usd"), (int, float)):
        resolved["deposit"] = int(s["deposit_usd"])
    ads = s.get("ads_monthly_usd")
    if isinstance(ads, list) and len(ads) == 2 and all(isinstance(a, (int, float)) for a in ads):
        resolved["ads_min"], resolved["ads_max"] = int(ads[0]), int(ads[1])
    return resolved


def is_split(resolved: dict[str, Any]) -> bool:
    return len(resolved.get("instalments") or []) > 1


def prompt_block(resolved: dict[str, Any]) -> str:
    """The offer, as the bullets the drafter is given for this one proposal."""
    cur = resolved["currency"]
    price = money(resolved["price"], cur)
    term = months_words(resolved["months"])
    ads = f"{cur} {resolved['ads_min']:,} to {resolved['ads_max']:,}"
    daily = ""
    if resolved.get("ads_daily_min") and resolved.get("ads_daily_max"):
        daily = f" (we recommend starting at {cur} {resolved['ads_daily_min']:,} to {resolved['ads_daily_max']:,} a day)"
    deposit = money(resolved["deposit"], cur)
    lines = [
        f"- **{resolved['program']}, {term}, {price}.**",
        f"- **Advertising {ads} a month**{daily}, paid by the client directly to the platforms, "
        "always its own line.",
        f"- **{deposit} deposit** reserves the start date and comes off the first payment.",
        f"- **{resolved['meetings']} qualified meetings across the term** is what the program is built to deliver.",
    ]
    parts = resolved["instalments"]
    if len(parts) == 1:
        lines.append(f"- **Payment: paid in full.** {price} {parts[0]['due']}. Print no split, no "
                     "instalments and no monthly schedule.")
        start = price
        structure = f"paid in full, {price} {parts[0]['due']}"
    else:
        each = "; ".join(f"{money(p['amount'], cur)} {p['due']}" for p in parts)
        lines.append(f"- **Payment: {resolved['payment_label'].lower()}, {len(parts)} instalments.** {each}. "
                     f"They add up to {price}. Print every one, with its amount and when it falls due; "
                     f"the {deposit} deposit comes off the first.")
        start = money(parts[0]["amount"], cur)
        structure = each
    if resolved["guarantee"]:
        lines.append(f"- **Guarantee: yes.** \"{resolved['guarantee_text']}\" Print it once, as one line in "
                     "`terms`, in the document's language.")
    else:
        lines.append(f"- **Guarantee: none on this proposal.** Promise no free work, no refund and no "
                     f"guarantee anywhere in the document. {resolved['meetings']} qualified meetings is "
                     "the target, not a promise.")
    lines.append(
        f"- **Where each figure goes.** `investment.rows`: the program at {price}; the payment structure "
        f"({structure}); the advertising budget at {ads} a month, paid to the platforms; the term, {term}. "
        f"`investment.total_amount`: {start}, what is paid to us at the start. `deposit_amount`: {deposit}. "
        f"`roi.fee_usd`: {resolved['price']}. `roi.months`: {resolved['months']}. `roi.ad_monthly_usd`: "
        f"between {resolved['ads_min']} and {resolved['ads_max']}."
    )
    return "\n".join(lines)


SETTING_KEY = "offer"
SETTING_SOURCE = "hermes/sales-desk/offer.json"


def cockpit_setting(offer: dict[str, Any]) -> dict[str, Any]:
    """What the cockpit's proposal form offers the closer, written from
    offer.json so the file stays the one place the offer is edited: the
    payment options by key and label, and the guarantee in the words it
    will be printed in."""
    options = (offer.get("payment") or {}).get("options") or {}
    text = resolve(offer, {"guarantee": True})["guarantee_text"] or ""
    return {
        "payments": [{"key": k, "label": str(v.get("label") or k)} for k, v in options.items()],
        "guarantee": {"label": f"Include the guarantee ({text.rstrip('.')})"},
        "source": SETTING_SOURCE,
    }


def pitch_values(offer: dict[str, Any]) -> dict[str, str]:
    """The tokens PATTERNS.md is written with, from offer.json's pitch block."""
    pitch = offer.get("pitch") or {}
    return {f"pitch.{k}": str(v) for k, v in pitch.items() if not k.startswith("_")}


def figures(resolved: dict[str, Any], offer: Optional[dict[str, Any]] = None) -> set[int]:
    """Every figure of ours this offer can put on a page, in dollars."""
    out = {resolved["price"], resolved["deposit"], resolved["ads_min"], resolved["ads_max"],
           resolved["meetings"], resolved["months"], 100}
    for k in ("ads_daily_min", "ads_daily_max"):
        if resolved.get(k):
            out.add(int(resolved[k]))
    if resolved["months"] and resolved["price"] % resolved["months"] == 0:
        out.add(resolved["price"] // resolved["months"])
    out.update(int(p["amount"]) for p in resolved["instalments"])
    for v in ((offer or {}).get("pitch") or {}).values():
        for part in str(v).replace(",", "").split():
            if part.isdigit():
                out.add(int(part))
    return {n for n in out if n}
