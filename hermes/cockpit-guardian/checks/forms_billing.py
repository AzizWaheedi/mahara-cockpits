"""The waves 1-2 forms and billing rails (docs/forms/WAVE12-CONTRACT.md 6.2): card writes for money, the field map,
the daily billing step, the termination and pause-request webhooks, unmatched surveys, the churn confirm against
the card, live extensions against the card, MRR against the money in, and hand-logged payments waiting on their
bank check. Report-only: each reading names the gap and the person who closes it; nothing here writes.

Before the deploy each check reads "not set up yet" as ok, never as zero: a table, a view, a column or a run state
that is not there yet is a sentence, not a count.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from guard.context import Context, SourceError
from guard.model import Check, Result, age_min, ago, fail, ok, parse_time, warn
from guard.redact import clean

RUNBOOK = "RUNBOOK.md, Forms and billing rails"
BILLING_KEY = "clickup-writeback:billing"
DOCTOR_KEY = "clickup-writeback:billing-doctor"
DAILY_KEY = "billing-daily"
DOOR_FORMS = {"exit_survey": "termination survey", "pause_request": "pause request"}
STUCK_MIN = 30
DAY_MIN = 26 * 60
QUIET_DAYS = 21
UNMATCHED_DAYS = 2
CARD_GRACE_MIN = 120
EXTENSION_GRACE_DAYS = 1
MONEY_STALE_H = 36
CHECK_DAYS = 7
MRR_TOLERANCE = 10.0

# A table, view or column a later migration adds: the read says so instead of failing the scan.
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


def _state(ctx: Context, key: str) -> Optional[dict[str, Any]]:
    rows = ctx.rows("cockpit_sync_state", "key,ok,note,detail,last_run_at,last_ok_at", where=[("key", "eq", key)], limit=1)
    return rows[0] if rows else None


def _detail(row: Optional[dict[str, Any]]) -> dict[str, Any]:
    d = (row or {}).get("detail")
    return d if isinstance(d, dict) else {}


def _setting(ctx: Context, key: str) -> Optional[dict[str, Any]]:
    rows = _maybe(ctx, "cockpit_settings", "key,value", where=[("key", "eq", key)], limit=1)
    if not rows:
        return None
    v = rows[0].get("value")
    return v if isinstance(v, dict) else None


def _num(v: Any) -> Optional[float]:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n == n else None


def _plural(n: int, one: str, many: Optional[str] = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


# ---- billing-writeback ---------------------------------------------------------------------------------------

def run_writeback(ctx: Context) -> Result:
    row = _state(ctx, BILLING_KEY)
    if row is None:
        return ok("Not set up yet: clickup-writeback has not reported its billing switch (20261101m and the "
                  "clickup-writeback deploy come first).")
    d = _detail(row)
    items = _maybe(ctx, "cockpit_clickup_writeback_queue", "id,state,task_id,updated_at,error,payload",
                   where=[("kind", "eq", "billing"), ("state", "in", ["retry", "unknown", "failed"])]) or []
    stuck = [i for i in items if (age_min(i.get("updated_at"), ctx.now) or 0) > STUCK_MIN]
    ev = {"mode": d.get("mode"), "kinds": d.get("kinds"), "heldOpenKind": d.get("heldOpenKind"), "stuck": len(stuck)}
    if stuck:
        kinds = sorted({str((i.get("payload") or {}).get("kind") or "billing") for i in stuck})
        first = clean(stuck[0].get("error"), 140) if stuck[0].get("error") else "no error saved"
        return fail(f"{_plural(len(stuck), 'billing card write')} ({', '.join(kinds)}) "
                    f"{'has' if len(stuck) == 1 else 'have'} been retrying, unknown or failed for over {STUCK_MIN} minutes. "
                    f"First: {first}.", evidence=ev, items=[str(i.get("id")) for i in stuck][:20])
    held = d.get("heldOpenKind")
    if isinstance(held, int) and not isinstance(held, bool) and held > 0:
        return warn(f"{_plural(held, 'held edit')} of an open kind wait for the review: release or close each one.",
                    evidence=ev)
    if held is None:
        return ok(f"Billing card writes: {d.get('mode') or 'mode not said'}; the held count could not be read on the "
                  "last run.", evidence=ev)
    return ok(f"Billing card writes: {d.get('mode') or 'mode not said'} "
              f"({', '.join(d.get('kinds') or []) or 'no kinds open'}); nothing stuck, no held edit of an open kind.",
              evidence=ev)


# ---- billing-doctor ------------------------------------------------------------------------------------------

def run_doctor(ctx: Context) -> Result:
    row = _state(ctx, DOCTOR_KEY)
    if row is None:
        return ok("Not set up yet: the daily ClickUp field read (billing_doctor, 03:41 UTC) has not run.")
    age = age_min(row.get("last_run_at"), ctx.now)
    gaps = [g for g in (_detail(row).get("gaps") or []) if isinstance(g, str)]
    ev = {"last_run_at": row.get("last_run_at"), "gaps": gaps}
    if age is None or age > DAY_MIN:
        return fail(f"The daily ClickUp field read has not run for {ago(age)} (limit {ago(DAY_MIN)}), so the card "
                    "fields the billing writes need are not checked.", evidence=ev,
                    since=parse_time(row.get("last_run_at")))
    if row.get("ok") is False:
        return warn(f"The daily ClickUp field read failed: {clean(row.get('note'), 200)}", evidence=ev)
    if gaps:
        return warn(f"{_plural(len(gaps), 'gap')} on Clients - Mahara: {' '.join(gaps)[:400]}", evidence=ev, items=gaps[:20])
    return ok("The ClickUp fields the billing writes need are all on Clients - Mahara.", evidence=ev)


# ---- billing-daily -------------------------------------------------------------------------------------------

def run_daily(ctx: Context) -> Result:
    setting = _setting(ctx, "billing.daily")
    on = bool(setting and setting.get("on") is True)
    row = _state(ctx, DAILY_KEY)
    if not on:
        return ok("The daily billing step is off (billing.daily); it turns on at D-P3."
                  if setting is not None else "Not set up yet: billing.daily is not seeded (20261101p).")
    if row is None:
        return fail("The daily billing step is on but has never reported a run.")
    age = age_min(row.get("last_run_at"), ctx.now)
    if age is None or age > DAY_MIN:
        return fail(f"The daily billing step is on and has not run for {ago(age)} (limit {ago(DAY_MIN)}): ended "
                    "extensions are not cleared and late payments are not opened.",
                    since=parse_time(row.get("last_run_at")), evidence={"last_run_at": row.get("last_run_at")})
    return ok(f"The daily billing step ran {ago(age)} ago: {clean(row.get('note'), 160)}")


# ---- forms-door-exit -----------------------------------------------------------------------------------------

def run_doors(ctx: Context) -> Result:
    problems, quiet, live, items = [], [], [], []
    for form, words in DOOR_FORMS.items():
        row = _state(ctx, f"forms-door:{form}")
        d = _detail(row)
        if row is None or d.get("registered") is not True:
            continue
        live.append(words)
        if d.get("outcome") == "failed" or row.get("ok") is False:
            problems.append(f"the {words} webhook's last delivery failed: {clean(d.get('reason') or row.get('note'), 140)}")
            items.append(f"{form}-failed")
            continue
        age = age_min(d.get("lastDelivery") or row.get("last_run_at"), ctx.now)
        if age is None or age > QUIET_DAYS * 1440:
            quiet.append(words)
    if problems:
        return fail("; ".join(problems).capitalize() + ". Probe it with forms_key.py probe-typeform.", items=items)
    if quiet:
        return warn(f"No {' or '.join(quiet)} has reached the cockpit in {QUIET_DAYS} days. A quiet form is normal "
                    "(clients rarely leave or pause); probe the webhook with forms_key.py probe-typeform to be sure.")
    if not live:
        return ok("Not set up yet: the termination and pause-request webhooks are not registered (D-F4, D-C2).")
    return ok(f"The {' and '.join(live)} {'webhook answers' if len(live) == 1 else 'webhooks answer'}.")


# ---- notice-unmatched ----------------------------------------------------------------------------------------

def run_unmatched(ctx: Context) -> Result:
    rows = _maybe(ctx, "cockpit_form_responses", "id,form_key,state,task_id,hidden,answer_meta,submitted_at",
                  where=[("form_key", "in", list(DOOR_FORMS)), ("state", "eq", "legacy"), ("task_id", "is", None)])
    if rows is None:
        return ok("Not set up yet: the forms tables have no termination or pause-request answers.")
    late = []
    for r in rows:
        meta = r.get("answer_meta") if isinstance(r.get("answer_meta"), dict) else {}
        if meta.get("answered"):
            continue
        age = age_min(r.get("submitted_at"), ctx.now)
        if age is not None and age > UNMATCHED_DAYS * 1440:
            late.append(r)
    if not late:
        return ok("Every termination survey and pause request is matched to a card or answered.")
    first = late[0]
    hidden = first.get("hidden") if isinstance(first.get("hidden"), dict) else {}
    name = str(hidden.get("client_name") or "a client who gave no name")[:80]
    words = DOOR_FORMS.get(str(first.get("form_key")), "form")
    more = f" ({len(late) - 1} more)" if len(late) > 1 else ""
    return warn(f"A {words} from {name} is not matched to a card: a CSM picks the card on the churn tracker.{more}",
                items=[str(r.get("id")) for r in late][:20], evidence={"unmatched": len(late)})


# ---- register-vs-card ----------------------------------------------------------------------------------------

def run_register(ctx: Context) -> Result:
    deps = _maybe(ctx, "cockpit_churn_departures", "id,client,clickup_task_id,left_on,confirmed_at,billing_event_id,removed_at",
                  where=[("removed_at", "is", None)])
    if deps is None:
        return ok("Not set up yet: the churn register has no confirm columns (20261101o).")
    confirmed = [d for d in deps if d.get("confirmed_at") and d.get("billing_event_id") is not None and d.get("clickup_task_id")]
    if not confirmed:
        return ok("No churn confirmed through the cockpit yet, so there is no card to compare.")
    queue = _maybe(ctx, "cockpit_clickup_writeback_queue", "source_id,state,delivered_at",
                   where=[("kind", "eq", "billing"), ("source_id", "in", [str(d["billing_event_id"]) for d in confirmed])]) or []
    delivered = {str(q.get("source_id")): q for q in queue if q.get("state") == "delivered" and q.get("delivered_at")}
    cards = {c.get("clickup_task_id"): c for c in (ctx.rows("cockpit_billing_accounts", "clickup_task_id,client_status,churn_date",
             where=[("clickup_task_id", "in", [d["clickup_task_id"] for d in confirmed])]))}
    off = []
    for d in confirmed:
        q = delivered.get(str(d["billing_event_id"]))
        if not q or (age_min(q.get("delivered_at"), ctx.now) or 0) < CARD_GRACE_MIN:
            continue
        card = cards.get(d["clickup_task_id"]) or {}
        why = []
        if card.get("client_status") != "Stopped":
            why.append(f"reads {card.get('client_status') or 'no status'}, not Stopped")
        if str(card.get("churn_date") or "")[:10] != str(d.get("left_on") or "")[:10]:
            why.append(f"its Churn Date reads {str(card.get('churn_date') or 'empty')[:10]}, the register {str(d.get('left_on'))[:10]}")
        if why:
            off.append(f"{d.get('client')}: the card {' and '.join(why)}")
    if off:
        return warn(f"{_plural(len(off), 'confirmed churn')} and {'its card disagree' if len(off) == 1 else 'their cards disagree'} "
                    f"two hours after the card write: {'; '.join(off)[:400]}. Read the card; a ClickUp automation may have "
                    "changed it after the read-back.", items=off[:20])
    return ok(f"Every confirmed churn's card reads Stopped with the register's Churn Date ({_plural(len(confirmed), 'departure')}).")


# ---- extension-vs-card ---------------------------------------------------------------------------------------

def run_extensions(ctx: Context) -> Result:
    grants = _maybe(ctx, "cockpit_extensions_v", "grant_id,clickup_task_id,client_name,granted_at,weeks,until,state",
                    where=[("state", "eq", "live")])
    if grants is None:
        return ok("Not set up yet: cockpit_extensions_v is not live (20261101p).")
    cards = {c.get("clickup_task_id"): c for c in ctx.rows("cockpit_billing_accounts", "clickup_task_id,client_name,extension_weeks")}
    daily = _setting(ctx, "billing.daily") or {}
    live_ids = set()
    off = []
    for g in grants:
        live_ids.add(g.get("clickup_task_id"))
        if (age_min(g.get("granted_at"), ctx.now) or 0) < EXTENSION_GRACE_DAYS * 1440:
            continue
        card = cards.get(g.get("clickup_task_id"))
        weeks = _num((card or {}).get("extension_weeks"))
        if card is not None and weeks != _num(g.get("weeks")):
            off.append(f"{g.get('client_name')}: the grant says {g.get('weeks')} weeks, the card {'nothing' if weeks is None else int(weeks)}")
    if daily.get("on") is True:
        for task, card in cards.items():
            w = _num(card.get("extension_weeks"))
            if w and w > 0 and task not in live_ids:
                off.append(f"{card.get('client_name')}: the card still reads {int(w)} weeks with no grant running")
    if off:
        return warn(f"{_plural(len(off), 'extension')} and the card disagree for over a day: {'; '.join(off)[:400]}. "
                    "Read the billing queue item for the grant before changing the card.", items=off[:20])
    return ok(f"Every live extension matches its card ({_plural(len(grants), 'grant')} running).")


# ---- mrr-differs ---------------------------------------------------------------------------------------------

def mrr_differences(cards: list[dict[str, Any]], check: dict[str, Any] | None, tolerance: float,
                    fresh: bool) -> tuple[list[str], int]:
    """(the cards whose MRR differs, the cards with no MRR): the rule of cockpit_mrr_read (3.1, 4.9) over the mirror.
    Active monthly cards only. Against the suggestion (Next Payment Amount) always, against the money in (the money
    refresh's mrrCheck) only while that refresh is under a day and a half old. A card with no MRR is missing, never 0."""
    rail = {}
    for r in (check or {}).get("rows") or []:
        if isinstance(r, dict) and r.get("taskId") and _num(r.get("railMonthlyUsd")) is not None:
            rail[r["taskId"]] = _num(r["railMonthlyUsd"])
    out, missing = [], 0
    differs = lambda a, b: max(a, b) > 0 and abs(a - b) / max(a, b) * 100 > tolerance  # noqa: E731
    for c in cards:
        if c.get("client_status") != "Active" or not re.search(r"monthly", str(c.get("payment_plan") or ""), re.I):
            continue
        mrr = _num(c.get("mrr_usd"))
        if mrr is None:
            missing += 1
            continue
        sugg = _num(c.get("next_payment_usd"))
        money_in = rail.get(c.get("clickup_task_id")) if fresh else None
        if sugg is not None and differs(mrr, sugg):
            out.append(f"{c.get('client_name')}: card ${mrr:,.0f}, suggested ${sugg:,.0f}")
        elif money_in is not None and differs(mrr, money_in):
            out.append(f"{c.get('client_name')}: card ${mrr:,.0f}, money in ${money_in:,.0f}")
    return out, missing


def run_mrr(ctx: Context) -> Result:
    tol_row = _setting(ctx, "billing.mrr_tolerance")
    if tol_row is None:
        return ok("Not set up yet: billing.mrr_tolerance is not seeded (20261101p).")
    tolerance = _num(tol_row.get("pct")) or MRR_TOLERANCE
    cards = ctx.rows("cockpit_billing_accounts", "clickup_task_id,client_name,client_status,payment_plan,mrr_usd,next_payment_usd")
    try:
        money = ctx.section("money")
    except SourceError:
        money = {}
    age = age_min(money.get("computed_at"), ctx.now)
    fresh = age is not None and age <= MONEY_STALE_H * 60
    check = (money.get("payload") or {}).get("mrrCheck") if isinstance(money.get("payload"), dict) else None
    off, missing = mrr_differences(cards, check, tolerance, fresh)
    tail = "" if fresh else " Rail cash was not compared: the money refresh is older than a day and a half."
    if off:
        return warn(f"{_plural(len(off), 'card')} on the books {'differs' if len(off) == 1 else 'differ'} by more than "
                    f"{tolerance:g}%: {'; '.join(off)[:400]}. Set MRR on the billing sheet, or leave it if the card is "
                    f"right.{tail}", items=off[:20], evidence={"differ": len(off), "missing": missing})
    return ok(f"Every active monthly card's MRR is within {tolerance:g}% of its suggestion"
              f"{' and its money in' if fresh else ''}{f'; {missing} card(s) hold no MRR' if missing else ''}.{tail}",
              evidence={"differ": 0, "missing": missing})


# ---- checks-waiting ------------------------------------------------------------------------------------------

def run_checks(ctx: Context) -> Result:
    rows = _maybe(ctx, "cockpit_manual_payments", "id,client_name,amount_usd,added_at,check_state,deleted_at",
                  where=[("check_state", "eq", "logged"), ("deleted_at", "is", None)])
    if rows is None:
        return ok("Not set up yet: hand-logged payments carry no check state (20261101n).")
    old = [r for r in rows if (age_min(r.get("added_at"), ctx.now) or 0) > CHECK_DAYS * 1440]
    if old:
        oldest = min(old, key=lambda r: str(r.get("added_at")))
        return warn(f"{_plural(len(old), 'hand-logged payment')} {'has' if len(old) == 1 else 'have'} waited over "
                    f"{CHECK_DAYS} days for the bank check, the oldest {oldest.get('client_name') or 'with no client'} "
                    f"since {str(oldest.get('added_at'))[:10]}. Finance or the CEO checks each one on the Money tab.",
                    items=[str(r.get("id")) for r in old][:20], evidence={"waiting": len(old)})
    return ok(f"No hand-logged payment has waited over {CHECK_DAYS} days ({_plural(len(rows), 'waiting')} in all).")


CHECKS = (
    Check("billing-writeback", "workers", "Billing card writes",
          "Money edits made in the cockpit reach the ClickUp card, kind by kind, once their kind is open.", "high",
          "cockpit_sync_state clickup-writeback:billing and the billing items of cockpit_clickup_writeback_queue.",
          f"Fail: a billing item retrying, unknown or failed for over {STUCK_MIN} minutes. Warn: a held edit of an open kind.",
          run_writeback, owner="the systems manager",
          action=f"Read the queue row's error and the card; re-queue only after reading back ({RUNBOOK}).", confirm=2, clear=2),
    Check("billing-doctor", "workers", "ClickUp fields for billing",
          "The card fields the billing writes need exist on Clients - Mahara with the right type and options.", "medium",
          "cockpit_sync_state clickup-writeback:billing-doctor, written daily by the billing_doctor job.",
          "Warn: any gap sentence. Fail: no read in 26 hours.", run_doctor, owner="the systems manager",
          action="Add or fix the named field on Clients - Mahara, then run billing_doctor once.", confirm=1, clear=1),
    Check("billing-daily", "workers", "Daily billing step",
          "Ended extensions are cleared on the card and late payments are opened and closed each day.", "medium",
          "cockpit_settings billing.daily and cockpit_sync_state billing-daily.",
          "Fail: no run in 26 hours while billing.daily is on.", run_daily, owner="the systems manager",
          action="Check pg_cron mahara-billing-daily; turn billing.daily off if it misbehaves.", confirm=1, clear=1),
    Check("forms-door-exit", "workers", "Termination and pause-request webhooks",
          "A client's termination survey or pause request reaches the cockpit and shows as a notice.", "high",
          "cockpit_sync_state forms-door:exit_survey and forms-door:pause_request.",
          f"Fail: the last delivery failed. Warn: registered and nothing in {QUIET_DAYS} days.", run_doors,
          owner="the systems manager", action="Run forms_key.py status and probe-typeform for the form.", confirm=1, clear=1),
    Check("notice-unmatched", "data", "Surveys not matched to a card",
          "Every termination survey and pause request is tied to its client's card.", "medium",
          "cockpit_form_responses exit_survey and pause_request, state legacy, no card, not answered.",
          f"Warn: one stays unmatched for {UNMATCHED_DAYS} days.", run_unmatched, owner="the CEO",
          action="A CSM picks the card on the churn tracker (Pick the card).", confirm=1, clear=1, alert=False),
    Check("register-vs-card", "data", "Churn register against the card",
          "A confirmed churn reads Stopped on the card, with the register's Churn Date.", "medium",
          "Confirmed departures, their delivered billing items and cockpit_billing_accounts.",
          "Warn: the card is not Stopped, or its Churn Date differs, two hours after the write was delivered.",
          run_register, owner="the systems manager",
          action="Read the card; if an automation changed it, the person who owns ClickUp automations turns it off.",
          confirm=1, clear=1),
    Check("extension-vs-card", "data", "Extensions against the card",
          "A live extension grant and the card's Current extension (weeks) agree.", "low",
          "cockpit_extensions_v live grants and cockpit_billing_accounts extension_weeks.",
          "Warn: a mismatch older than a day.", run_extensions, owner="the systems manager",
          action="Read the grant's billing queue item, then the card.", confirm=1, clear=1, alert=False),
    Check("mrr-differs", "data", "MRR on the books",
          "Each active monthly card's MRR is near its suggestion and the money that came in.", "low",
          "cockpit_billing_accounts, cockpit_settings billing.mrr_tolerance and the money section's mrrCheck.",
          "Warn: any card differs by more than the tolerance, two days running.", run_mrr, owner="the CEO",
          action="Set MRR on the billing sheet, or leave it if the card is right.", confirm=1,
          confirm_minutes=2 * 24 * 60, clear=1, alert=False),
    Check("checks-waiting", "data", "Payments waiting on their bank check",
          "Hand-logged payments are checked against the bank within a week.", "medium",
          "cockpit_manual_payments with check_state logged.",
          f"Warn: a row waits more than {CHECK_DAYS} days.", run_checks, owner="the CEO",
          action="Finance or the CEO checks each payment against the statement on the Money tab.", confirm=1, clear=1),
)
