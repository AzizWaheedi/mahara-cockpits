"""WhatsApp signals the cockpit already records (catalogue W6, W7, M5).

Read from cockpit_sales_settings and the state and error of
cockpit_sales_messages, never a message's text, a contact or a phone. The
guardian never sends, re-sends or retries a message.
"""
from __future__ import annotations

import re
from collections import Counter
from datetime import timedelta

from guard.context import Context
from guard.model import Check, Result, fail, ok, unknown, warn

WALLET = re.compile(r"(?i)insufficient (funds|balance)|wallet")
CODES = re.compile(r"\b(131049|132018|131026|131047|131051|132000|132001|132005|132007|132012|131056)\b")


def _failed(ctx: Context) -> list[dict]:
    since = (ctx.now - timedelta(hours=24)).isoformat()
    return ctx.rows("cockpit_sales_messages", "id,channel,state,error,created_at",
                    where=[("state", "eq", "failed"), ("created_at", "gt", since)], order="created_at.desc", limit=500)


def run_doubles(ctx: Context) -> Result:
    guard = ctx.setting("whatsapp_guard")
    if not isinstance(guard, dict):
        return unknown("cockpit_sales_settings has no whatsapp_guard, so the WhatsApp guard cannot be read.")
    if "connector_off" not in guard:
        return unknown("The cockpit does not record whether HighLevel's WA Connector is off (whatsapp_guard.connector_off "
                       "is not set), so double sends cannot be ruled out from here.", coverage_gap=True,
                       evidence={"keys": sorted(guard)})
    tested = guard.get("single_copy_ok_at")
    ev = {"connector_off": guard.get("connector_off"), "single_copy_ok_at": tested}
    if guard.get("connector_off") is True and tested:
        return ok(f"The cockpit records the WA Connector as off and the single-copy test passed at {tested}.", evidence=ev)
    if guard.get("connector_off") is True:
        return warn("The WA Connector is marked off but no single-copy test is recorded, so WhatsApp follow-ups stay on "
                    "Approve.", evidence=ev,
                    action="Send one test WhatsApp from the CRM, check it arrives once, then record single_copy_ok_at.")
    return warn("The cockpit does not record the WA Connector as off (connector_off false, no single-copy test), so a "
                "WhatsApp the CRM sends may go out twice (5,168 doubles were counted before) and WhatsApp follow-ups stay "
                "on Approve.", evidence=ev,
                action="Switch the WA Connector off in HighLevel, send one test WhatsApp, then set connector_off true and "
                       "single_copy_ok_at in the sales settings.")


def run_wallet(ctx: Context) -> Result:
    rows = _failed(ctx)
    wallet = [r for r in rows if WALLET.search(str(r.get("error") or ""))]
    if wallet:
        return fail(f"{len(wallet)} WhatsApp send(s) failed in 24 h because the HighLevel wallet is empty.",
                    evidence={"failed": len(wallet)}, action="Add funds to the HighLevel wallet.")
    return ok(f"No send failed for the HighLevel wallet in 24 h ({len(rows)} failed for other reasons).")


def run_refusals(ctx: Context) -> Result:
    rows = _failed(ctx)
    codes = Counter()
    for r in rows:
        for c in CODES.findall(str(r.get("error") or "")):
            codes[c] += 1
    if not codes:
        return ok(f"No WhatsApp send was refused by Meta in 24 h ({len(rows)} failed sends in all).")
    what = ", ".join(f"{n} x {c}" for c, n in codes.most_common(4))
    hint = []
    if "131049" in codes:
        hint.append("131049 is Meta's per-person marketing cap; wait and change the template's category")
    if "132018" in codes:
        hint.append("132018 is a template parameter format; fix the template's variables")
    return warn(f"Meta refused WhatsApp sends in 24 h: {what}." + (" " + "; ".join(hint) + "." if hint else ""),
                evidence={"codes": dict(codes)})


CHECKS = [
    Check(id="whatsapp-doubles", area="whatsapp", name="WhatsApp double sends", catalogue="W6",
          means="Each WhatsApp the CRM sends goes out once: the WA Connector is recorded off and a single-copy test passed.",
          severity="high", reads="cockpit_sales_settings whatsapp_guard (connector_off, single_copy_ok_at)",
          threshold="Not recorded off, or no single-copy test: warn. Counting real double pairs needs HighLevel's "
                    "conversations, which the guardian does not read.", run=run_doubles,
          action="Switch the WA Connector off in HighLevel."),
    Check(id="whatsapp-wallet", area="whatsapp", name="HighLevel wallet", catalogue="M5",
          means="The HighLevel wallet can pay for WhatsApp templates.", severity="high",
          reads="cockpit_sales_messages failed in 24 h with 'insufficient funds' (state and error only)",
          threshold="Any: fail.", run=run_wallet, action="Add funds in HighLevel."),
    Check(id="whatsapp-refusals", area="whatsapp", name="WhatsApp sends refused by Meta", catalogue="W7",
          means="Meta accepts the templates the cockpit sends.", severity="medium",
          reads="cockpit_sales_messages failed in 24 h, by Meta error code", threshold="Any refusal code: warn.",
          run=run_refusals, action="As in RUNBOOK.md, WhatsApp rows: the code says what to change."),
]
