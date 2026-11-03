"""The sale tie (migration 20261103g; docs/forms/WAVE56-CONTRACT.md 4.19): every New Client Form on its client card.
One report-only check, sale-ties, with each reading of the design's 2.11: a delivered sale with no tie row 15 minutes
on (the door did not open one), a sale waiting for its card over 2 hours, a sale waiting for a person over 3 days
(who closes it: the CEO), the door's own mark that a tie could not be opened, billing's disagreements (as
information), and the second source: the sales the cockpit stores against B2B's deals over 30 days. Nothing here
writes.

Every read is a table over REST with the service key (cockpit_sale_ties is SELECT for service_role only). It reads ids,
states, methods and times; never a digest, a phone or an email. Before the deploy it reads "not set up yet" as ok,
never as zero.
"""
from __future__ import annotations

import re
from datetime import timedelta
from typing import Any, Optional

from guard.context import Context, SourceError
from guard.model import Check, Result, age_min, ok, parse_time, warn
from guard.redact import clean

RUNBOOK = "RUNBOOK.md, Sale ties (the New Client Form on its card)"
NO_ROW_MIN = 15
WAITING_MIN = 120
PERSON_MIN = 3 * 24 * 60
SECOND_SOURCE_DAYS = 30
# B2B's mirror and the door both lag a little: a sale younger than this is not compared.
SECOND_SOURCE_GRACE_MIN = 60
PERSON_STATES = ("ambiguous", "conflict", "unmatched")
_NOT_THERE = re.compile(r"PGRST20[45]|42P01|42703|does not exist|Could not find|404", re.I)


def _maybe(ctx: Context, table: str, select: str = "*", where=(), order: Optional[str] = None,
           limit: Optional[int] = None) -> Optional[list[dict[str, Any]]]:
    """Rows, or None when the object is not there yet. Any other failure is the scan's 'could not be checked'."""
    try:
        return ctx.rows(table, select, where=where, order=order, limit=limit)
    except SourceError as e:
        if _NOT_THERE.search(str(e)):
            return None
        raise


def _setting(ctx: Context) -> Optional[dict[str, Any]]:
    rows = _maybe(ctx, "cockpit_settings", "key,value", where=[("key", "eq", "forms.sale_tie")], limit=1)
    if not rows:
        return None
    v = rows[0].get("value")
    return v if isinstance(v, dict) else None


def _plural(n: int, one: str, many: Optional[str] = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _sentence(parts: list[str]) -> str:
    text = "; ".join(parts)
    return text[:1].upper() + text[1:] + "."


def run_sale_ties(ctx: Context) -> Result:
    setting = _setting(ctx)
    ties = _maybe(ctx, "cockpit_sale_ties",
                  "id,response_id,state,clickup_task_id,matched_by,billing_task_id,set_by,set_at",
                  where=[("cleared_at", "is", None)])
    if setting is None or ties is None:
        return ok("Not set up yet: sales are not tied to their cards (20261103g is not applied).")
    on = setting.get("on") is True
    sales = _maybe(ctx, "cockpit_form_responses", "external_id,source,state,mode,submitted_at,created_at",
                   where=[("form_key", "eq", "new_client")]) or []
    live = [s for s in sales if s.get("mode") == "live" and s.get("state") in ("submitted", "confirmed")]
    by_sale = {t.get("response_id"): t for t in ties}
    when = {s.get("external_id"): s.get("submitted_at") for s in live}
    findings: list[str] = []
    items: list[str] = []

    # The door: a delivered sale with no row, and the door's own mark.
    no_row = [s for s in live if s.get("source") == "typeform_webhook" and s.get("external_id") not in by_sale
              and (age_min(s.get("created_at"), ctx.now) or 0) > NO_ROW_MIN]
    if no_row:
        findings.append(f"{_plural(len(no_row), 'sale')} delivered over {NO_ROW_MIN} minutes ago "
                        f"{'has' if len(no_row) == 1 else 'have'} no tie row: the door did not open "
                        f"{'it' if len(no_row) == 1 else 'them'}, and the sweep opens them only while ties are on")
        items += [f"no-row:{s.get('external_id')}" for s in no_row][:10]
    door = _maybe(ctx, "cockpit_sync_state", "key,detail", where=[("key", "eq", "forms-door:new_client")], limit=1) or []
    detail = door[0].get("detail") if door and isinstance(door[0].get("detail"), dict) else {}
    # The mark stays until the next delivery opens a row, so it counts only while a delivered sale still has none
    # (any age: the no-row reading above waits 15 minutes). Once the sweep opened the row, the failure is fixed.
    rowless = any(s.get("source") == "typeform_webhook" and s.get("external_id") not in by_sale for s in live)
    if detail.get("tie") == "failed" and rowless:
        at = parse_time(detail.get("tieAt"))
        findings.append("the door could not open a sale's tie" + (f" at {at.strftime('%Y-%m-%d %H:%M')} UTC" if at else "")
                        + "; the next sweep opens it from what the cockpit stores")
        items.append("door-failed")

    # While on: waiting for the card, and waiting for a person.
    waiting = [t for t in ties if t.get("state") == "waiting"
               and (age_min(when.get(t.get("response_id")) or t.get("set_at"), ctx.now) or 0) > WAITING_MIN]
    person = [t for t in ties if t.get("state") in PERSON_STATES and (age_min(t.get("set_at"), ctx.now) or 0) > PERSON_MIN]
    if on and waiting:
        findings.append(f"{_plural(len(waiting), 'sale')} {'has' if len(waiting) == 1 else 'have'} waited over "
                        f"{WAITING_MIN // 60} hours for {'its' if len(waiting) == 1 else 'their'} card: the onboarding "
                        "sync has not seen it, or Make 10 made no card")
        items += [f"waiting:{t.get('response_id')}" for t in waiting][:10]
    if on and person:
        findings.append(f"{_plural(len(person), 'sale')} {'has' if len(person) == 1 else 'have'} waited over 3 days "
                        "for a person under Sales not on a card")
        items += [f"person:{t.get('response_id')}" for t in person][:10]

    # The second source: what the cockpit stores against B2B's deals, over 30 days.
    since = ctx.now - timedelta(days=SECOND_SOURCE_DAYS)
    deals = _maybe(ctx, "cockpit_sales_deals", "response_id,submitted_at", where=[("submitted_at", "gte", since.isoformat())])
    stored_ids = {s.get("external_id") for s in live
                  if (parse_time(s.get("submitted_at")) or ctx.now) >= since
                  and (age_min(s.get("submitted_at"), ctx.now) or 0) > SECOND_SOURCE_GRACE_MIN}
    deal_ids = {d.get("response_id") for d in (deals or [])
                if (age_min(d.get("submitted_at"), ctx.now) or 0) > SECOND_SOURCE_GRACE_MIN}
    missing = sorted(i for i in deal_ids - stored_ids if i)
    if deals is not None and missing:
        findings.append(f"B2B has {_plural(len(deal_ids), 'sale')} in the last {SECOND_SOURCE_DAYS} days and the cockpit "
                        f"stores {len(stored_ids)}: {_plural(len(missing), 'sale is', 'sales are')} missing, so "
                        f"{'it has' if len(missing) == 1 else 'they have'} no tie")
        items += [f"missing:{i}" for i in missing][:10]

    tied = [t for t in ties if t.get("state") == "tied"]
    method = {m: sum(1 for t in tied if t.get("matched_by") == m) for m in ("phone", "email", "phone_email", "person")}
    disagree = sum(1 for t in tied if t.get("billing_task_id") and t.get("billing_task_id") != t.get("clickup_task_id"))
    open_person = sum(1 for t in ties if t.get("state") in PERSON_STATES)
    ev = {"sales": len(live), "tied": len(tied), "byPhone": method["phone"] + method["phone_email"],
          "byEmail": method["email"], "byPerson": method["person"], "forPerson": open_person,
          "waiting": sum(1 for t in ties if t.get("state") == "waiting"), "billingDisagrees": disagree,
          "on": on, "secondSource": None if deals is None else {"b2b": len(deal_ids), "stored": len(stored_ids)}}
    if findings:
        return warn(clean(_sentence(findings), 600), items=items[:20], evidence=ev)
    if not on:
        return ok(f"Sale ties are off: {_plural(len(live), 'sale')} stored, {_plural(sum(1 for t in ties if t.get('state') == 'waiting'), 'row')} "
                  "waiting with digests only, nothing tied.", evidence=ev)
    info = f" Billing ties {_plural(disagree, 'of them', 'of them')} to another card (information)." if disagree else ""
    return ok(f"{_plural(len(live), 'sale')}: {len(tied)} on their card ({ev['byPhone']} by phone, {ev['byEmail']} by email, "
              f"{ev['byPerson']} by a person), {open_person} waiting for a person.{info}", evidence=ev)


CHECKS = (
    Check("sale-ties", "data", "Sales on their cards",
          "Every New Client Form is tied to its client card by an exact phone or email, or by a person, never a name.",
          "medium",
          "cockpit_settings forms.sale_tie, cockpit_sale_ties (live rows), cockpit_form_responses (new_client), "
          "cockpit_sync_state forms-door:new_client detail.tie, and cockpit_sales_deals over 30 days (the second source).",
          f"Warn: a delivered sale with no tie row after {NO_ROW_MIN} minutes; the door's tie mark failed while a delivered "
          f"sale still has no row; while on, a sale "
          f"waiting for its card over {WAITING_MIN // 60} hours or for a person over 3 days; a B2B sale of the last "
          f"{SECOND_SOURCE_DAYS} days the cockpit does not store. Billing's disagreements are information.",
          run_sale_ties, owner="the CEO",
          action=f"Work Sales not on a card; for a sale with no row, check forms-door and the onboarding sync ({RUNBOOK}).",
          confirm=1, clear=1, alert=False),
)
