"""Market research (hermes/market-intel, migration 20261103i; contract 4.23): a run stuck past its lease, an
onboarding answer with no finished research, and the month's scraping spend against its cap. Report-only: each
reading names the gap and who closes it; nothing here writes. The Claude proxy the worker uses is already watched
by claude_proxy.

Before the deploy each check reads "not set up yet" as ok, never as zero: a table or a setting that is not there
yet is a sentence, not a count.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional

from guard.context import Context, SourceError
from guard.model import Check, Result, age_min, ago, fail, ok, parse_time, warn
from guard.redact import clean

RUNBOOK = "RUNBOOK.md, Market research (hermes/market-intel)"
OPEN = ["claimed", "pulling", "picking", "writing", "checking", "publishing"]
LEASE_GRACE_MIN = 10
OPEN_MAX_MIN = 180
MISSING_AFTER_MIN = 180
SPEND_WARN = 0.8
_NOT_THERE = re.compile(r"PGRST20[45]|42P01|42703|does not exist|Could not find|404", re.I)


def _maybe(ctx: Context, table: str, select: str = "*", where=(), order: Optional[str] = None,
           limit: Optional[int] = None) -> Optional[list[dict[str, Any]]]:
    try:
        return ctx.rows(table, select, where=where, order=order, limit=limit)
    except SourceError as e:
        if _NOT_THERE.search(str(e)):
            return None
        raise


def _setting(ctx: Context) -> Optional[dict[str, Any]]:
    rows = _maybe(ctx, "cockpit_settings", "key,value", where=[("key", "eq", "market_intel")], limit=1)
    if not rows:
        return None
    v = rows[0].get("value")
    return v if isinstance(v, dict) else None


def _num(v: Any, default: float) -> float:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return default
    return n if n > 0 else default


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


# ---- mi-stuck ----------------------------------------------------------------------------------------------------

def run_stuck(ctx: Context) -> Result:
    rows = _maybe(ctx, "cockpit_market_intel_runs", "id,state,claim_until,started_at,attempts,sentence",
                  where=[("state", "in", OPEN)])
    if rows is None:
        return ok("Not set up yet: the market research tables are not there (20261103i).")
    stuck = []
    for r in rows:
        lapsed = age_min(r.get("claim_until"), ctx.now)
        open_for = age_min(r.get("started_at"), ctx.now)
        if (lapsed is not None and lapsed > LEASE_GRACE_MIN) or (open_for is not None and open_for > OPEN_MAX_MIN):
            stuck.append((r, open_for))
    if not stuck:
        return ok(f"No research run is stuck ({_plural(len(rows), 'run', 'runs')} in progress)." if rows
                  else "No research run is in progress.")
    r, open_for = stuck[0]
    more = f" ({len(stuck) - 1} more)" if len(stuck) > 1 else ""
    return fail(f"A research run has been {r.get('state')} for {ago(open_for)} and its lease has lapsed{more}. The worker "
                "may have stopped: read ~/.market-intel/cron.log on the VPS; the next pending tick resumes it without "
                "paying again.", items=[str(x.get("id")) for x, _ in stuck][:20],
                evidence={"stuck": len(stuck), "attempts": r.get("attempts")}, since=parse_time(r.get("started_at")))


# ---- mi-missing --------------------------------------------------------------------------------------------------

def run_missing(ctx: Context) -> Result:
    setting = _setting(ctx)
    if setting is None:
        return ok("Not set up yet: the market_intel setting is not seeded (20261103i).")
    if setting.get("on") is not True:
        return ok("Market research is off (market_intel.on is false), so no research is expected yet.")
    since = parse_time(setting.get("shadow_since"))
    if since is None:
        return warn("Market research is on but market_intel.shadow_since is not set, so no answer is scanned.")
    answers = _maybe(ctx, "cockpit_form_responses", "id,task_id,submitted_at,mode,state",
                     where=[("form_key", "eq", "onboarding"), ("mode", "eq", "live"),
                            ("state", "in", ["submitted", "confirmed"])]) or []
    runs = _maybe(ctx, "cockpit_market_intel_runs", "id,task_id,response_id,state,sentence,requested_at") or []
    done = {(r.get("task_id"), r.get("response_id")) for r in runs if r.get("state") == "done"}
    done_cards = {r.get("task_id") for r in runs if r.get("state") == "done"}
    late = []
    for a in answers:
        at = parse_time(a.get("submitted_at"))
        if at is None or at < since or not a.get("task_id"):
            continue
        if (age_min(a.get("submitted_at"), ctx.now) or 0) < MISSING_AFTER_MIN:
            continue
        if (a.get("task_id"), a.get("id")) in done:
            continue
        later = [r for r in runs if r.get("task_id") == a.get("task_id") and r.get("state") == "done"
                 and (parse_time(r.get("requested_at")) or at) >= at]
        if later and a.get("task_id") in done_cards:
            continue
        late.append(a)
    if not late:
        return ok("Every onboarding answer from over 3 hours ago has its research.")
    person = [r for r in runs if r.get("state") == "needs_person" and r.get("task_id") in {a.get("task_id") for a in late}]
    first = f" One needs a person: {clean(person[0].get('sentence'), 200)}" if person else ""
    return warn(f"{_plural(len(late), 'onboarding answer', 'onboarding answers')} from over 3 hours ago "
                f"{'has' if len(late) == 1 else 'have'} no finished research.{first}",
                items=[str(a.get("task_id")) for a in late][:20], evidence={"missing": len(late), "needsPerson": len(person)})


# ---- mi-spend ----------------------------------------------------------------------------------------------------

def run_spend(ctx: Context) -> Result:
    setting = _setting(ctx)
    if setting is None:
        return ok("Not set up yet: the market_intel setting is not seeded (20261103i).")
    cap = _num(setting.get("usd_cap_month"), 25.0)
    start = ctx.now.astimezone(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    runs = _maybe(ctx, "cockpit_market_intel_runs", "id,usd_apify,usd_scrapecreators,requested_at",
                  where=[("requested_at", "gte", start.isoformat())])
    if runs is None:
        return ok("Not set up yet: the market research tables are not there (20261103i).")
    spent = sum(_num(r.get("usd_apify"), 0.0) + _num(r.get("usd_scrapecreators"), 0.0) for r in runs)
    ev = {"spentUsd": round(spent, 2), "capUsd": cap, "runs": len(runs)}
    if spent >= cap:
        return fail(f"This month's research scraping is USD {spent:.2f} of USD {cap:.2f}: new research is refused until "
                    "the 1st. Raise usd_cap_month in the market_intel setting, or wait.", evidence=ev)
    if spent >= SPEND_WARN * cap:
        return warn(f"This month's research scraping is USD {spent:.2f} of USD {cap:.2f} (over 80 percent).", evidence=ev)
    return ok(f"This month's research scraping: USD {spent:.2f} of USD {cap:.2f}.", evidence=ev)


CHECKS = (
    Check("mi-stuck", "workers", "Market research stuck",
          "A research run that took its lease finishes or hands the lease back; one stuck run blocks the queue.", "high",
          "cockpit_market_intel_runs in an open state: claim_until and started_at.",
          f"Fail: a lease lapsed over {LEASE_GRACE_MIN} minutes ago, or a run open over {OPEN_MAX_MIN // 60} hours.",
          run_stuck, owner="the systems manager",
          action=f"Read ~/.market-intel/cron.log and run python3 mi.py doctor on the VPS ({RUNBOOK}).", confirm=2, clear=1),
    Check("mi-missing", "data", "Onboarding answers without research",
          "Every onboarding answer gets its market research within 3 hours while market research is on.", "medium",
          "cockpit_settings market_intel, cockpit_form_responses (onboarding, live) and cockpit_market_intel_runs.",
          "Warn: an answer stored since shadow_since, over 3 hours old, with no done run.", run_missing,
          owner="the systems manager", action=f"Read the run's sentence; run research again from the cockpit ({RUNBOOK}).",
          confirm=1, clear=1, alert=False),
    Check("mi-spend", "workers", "Market research spend",
          "Scraping for research stays inside the month's cap (Apify plus ScrapeCreators).", "medium",
          "cockpit_market_intel_runs this month and cockpit_settings market_intel.usd_cap_month.",
          "Warn: over 80 percent of the month's cap. Fail: the cap is reached.", run_spend, owner="the CEO",
          action=f"Raise usd_cap_month or wait for the 1st ({RUNBOOK}).", confirm=1, clear=1),
)
