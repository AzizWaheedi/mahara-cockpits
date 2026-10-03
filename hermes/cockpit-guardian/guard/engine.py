"""Scan, decide, fix: the guardian's one loop.

scan   run every check (a check that cannot read its source says "could not
       be checked", never ok), then open, update or resolve one incident per
       check, deduped by check id, and post what is due.
fix    for open incidents whose check has a safe fix: in --mode fix only, at
       most once per incident per hour with backoff (1 h, 2 h, 4 h ... up to
       24 h, then give up after the fix's max attempts), every attempt
       recorded on the incident and in the log. In report-only mode it only
       says what it would do.
"""
from __future__ import annotations

import fcntl
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Iterable, Optional

from . import alerts as alerts_mod
from .context import Context, SourceError
from .model import (BAD, FAIL, NOT_DEPLOYED, OK, PAUSED, UNKNOWN, WARN, Check, FixOutcome, Result, iso, kuwait,
                    parse_time, unknown)
from .redact import clean
from .store import Store

UNKNOWN_CONFIRM = 3                    # scans "could not be checked" before it is an incident
BACKOFF_BASE = timedelta(hours=1)
BACKOFF_CAP = timedelta(hours=24)
OTHER_FIXER_QUIET = timedelta(minutes=15)
ON_RESOLVE_MIN_OPEN = timedelta(minutes=5)
SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


@dataclass
class Finding:
    check: Check
    result: Result
    seconds: float


@dataclass
class Outcome:
    findings: list[Finding] = field(default_factory=list)
    opened: list[dict[str, Any]] = field(default_factory=list)
    resolved: list[dict[str, Any]] = field(default_factory=list)
    posted: list[str] = field(default_factory=list)
    would_post: list[str] = field(default_factory=list)
    fixes: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


# ---- running the checks ---------------------------------------------------------

def run_checks(ctx: Context, checks: Iterable[Check]) -> list[Finding]:
    out = []
    for check in checks:
        started = time.monotonic()
        try:
            res = check.run(ctx)
            if not isinstance(res, Result):
                res = unknown("The check returned nothing it could read.")
        except SourceError as e:
            res = unknown(f"Could not be checked: {clean(e, 240)}", coverage_gap=bool(getattr(e, "gap", False)))
        except Exception as e:  # noqa: BLE001 - one check failing must never stop the scan
            res = unknown(f"Could not be checked: the check itself failed ({type(e).__name__}: {clean(e, 200)}).")
        ctx.results[check.id] = res
        out.append(Finding(check, res, round(time.monotonic() - started, 2)))
    return out


def covered(check: Check, results: dict[str, Result]) -> Optional[str]:
    """Whether someone else already alerts on this, so the guardian stays quiet."""
    q = check.quiet_because
    if not q:
        return None
    if q == "convex":
        r = results.get("convex-ceo-sections")
        if r is not None and r.status in (OK, WARN):
            return "Convex already alerts on this and Convex is running"
    elif q == "hermes":
        a, b = results.get("hermes-monitor-cockpits"), results.get("hermes-monitor-sites")
        if check.id in ("hermes-monitor-cockpits", "hermes-monitor-sites"):
            mine = results.get(check.id)
            if mine is not None and mine.status == WARN:
                return "the Hermes monitor alerts on its own incidents"
            return None
        if a is not None and b is not None and a.status in (OK, WARN) and b.status in (OK, WARN):
            return "the Hermes monitors already alert on this and they are ticking"
    elif q == "sales-watchdog":
        r = results.get("live-alerts")
        if r is not None and r.status not in (NOT_DEPLOYED, UNKNOWN):
            return "the sales watchdog already alerts on this"
    return None


def _parent_covers(res: Result, results: dict[str, Result]) -> Optional[str]:
    if not res.caused_by:
        return None
    parent = results.get(res.caused_by)
    if parent is not None and parent.status in BAD:
        return res.caused_by
    return None


# ---- incidents -------------------------------------------------------------------

def _resolved_by(inc: dict[str, Any]) -> str:
    real = [a for a in inc.get("fix_attempts") or []
            if a.get("ok") and not a.get("planned") and a.get("fix") != "ai-fix"]
    if real:
        a = real[-1]
        return f"it cleared after the guardian's {a.get('fix')} at {kuwait(parse_time(a.get('at')))}"
    return "it cleared without the guardian (the job recovered or a person fixed it)"


def apply_findings(store: Store, findings: list[Finding], now: datetime, mode: str, out: Outcome) -> None:
    results = {f.check.id: f.result for f in findings}
    streaks = store.state.setdefault("streaks", {})
    for f in findings:
        check, res = f.check, f.result
        st = streaks.setdefault(check.id, {"bad": 0, "unknown": 0})
        inc = store.open.get(check.id)
        if res.status in BAD:
            st["bad"] += 1
            st["unknown"] = 0
            parent = _parent_covers(res, results)
            if parent:
                if inc:
                    out.resolved.append(store.resolve(check.id, now, f"folded into the {parent} incident, which has the same cause"))
                continue
            if inc:
                store.touch(inc, check, res, now)
            elif st["bad"] >= check.confirm:
                out.opened.append(store.open_incident(check, res, now, mode))
        elif res.status == UNKNOWN:
            st["unknown"] += 1
            st["bad"] = 0
            if res.coverage_gap:
                continue
            if inc:
                # Unknown is not healthy: the incident stays open as it was.
                inc["last_seen_at"] = iso(now)
            elif st["unknown"] >= UNKNOWN_CONFIRM:
                out.opened.append(store.open_incident(check, res, now, mode))
        else:
            st["bad"] = 0
            st["unknown"] = 0
            if inc:
                if res.status == OK:
                    by = _resolved_by(inc)
                elif res.status == PAUSED:
                    by = f"it is now paused on purpose: {res.summary}"
                else:
                    by = f"it now reads not deployed yet: {res.summary}"
                out.resolved.append(store.resolve(check.id, now, by))


# ---- alerts -------------------------------------------------------------------------

def _due(inc: dict[str, Any], check: Check, results: dict[str, Result], now: datetime,
         state: dict[str, Any]) -> tuple[bool, str]:
    if not check.alert:
        return False, "the daily summary carries it"
    cov = covered(check, results)
    if cov:
        return False, cov
    urgent = check.urgent and inc.get("level") == FAIL
    if not urgent and not alerts_mod.in_hours(now):
        return False, "held until 09:00 Kuwait time (Saturday to Thursday)"
    last = parse_time((state.get("last_alert") or {}).get(check.id))
    if last and now - last < alerts_mod.THROTTLE:
        return False, f"held: this check was alerted at {kuwait(last)} and flaps"
    return True, ""


def post_alerts(store: Store, checks: dict[str, Check], results: dict[str, Result], now: datetime, mode: str,
                outbox: alerts_mod.Outbox, out: Outcome) -> None:
    state = store.state
    for inc in sorted(store.open.values(), key=lambda i: SEVERITY_ORDER.get(i.get("severity"), 9)):
        if inc.get("alerted_at"):
            continue
        check = checks.get(inc["check_id"])
        if check is None:
            continue
        send, why = _due(inc, check, results, now, state)
        inc["alert_note"] = why or None
        if not send:
            continue
        text = alerts_mod.opened_text(inc, check, now, mode)
        if outbox.dry_run:
            out.would_post.append(text)
            continue
        if outbox.post(text):
            inc["alerted_at"] = iso(now)
            state.setdefault("last_alert", {})[check.id] = iso(now)
            store.write(inc)
            out.posted.append(text)
    # All clears: only for incidents whose opening was posted.
    queue = state.setdefault("outbox", [])
    for inc in out.resolved:
        if inc and inc.get("alerted_at") and not inc.get("resolve_alerted_at"):
            check = checks.get(inc["check_id"])
            queue.append({"id": inc["id"], "text": alerts_mod.resolved_text(inc, now), "urgent": bool(check and check.urgent)})
    keep = []
    for item in queue:
        if not item.get("urgent") and not alerts_mod.in_hours(now):
            keep.append(item)
            continue
        if outbox.dry_run:
            out.would_post.append(item["text"])
            keep.append(item)
            continue
        if outbox.post(item["text"]):
            out.posted.append(item["text"])
            for inc in state.get("resolved") or []:
                if inc.get("id") == item["id"]:
                    inc["resolve_alerted_at"] = iso(now)
                    store.write(inc)
        else:
            keep.append(item)
    state["outbox"] = [] if outbox.dry_run else keep[-50:]
    if outbox.errors:
        out.notes.append(f"Slack did not take a message: {outbox.errors[-1]}")


# ---- fixes ----------------------------------------------------------------------------

def fix_allowed(inc: dict[str, Any], fix_name: str, max_attempts: int, now: datetime) -> tuple[bool, str]:
    """Once per incident per hour, then 2 h, 4 h ... up to 24 h, then never."""
    attempts = [a for a in inc.get("fix_attempts") or [] if a.get("fix") == fix_name and not a.get("planned")]
    n = len(attempts)
    if n >= max_attempts:
        return False, f"gave up after {n} attempts; a person must look"
    if n == 0:
        return True, ""
    last = parse_time(attempts[-1].get("at"))
    wait = min(BACKOFF_BASE * (2 ** (n - 1)), BACKOFF_CAP)
    if last and now - last < wait:
        return False, f"next attempt after {kuwait(last + wait)}"
    return True, ""


class FixLock:
    """One fixer at a time on this box (the guardian's own runs)."""

    def __init__(self, path: str):
        self.path = path
        self.fh = None

    def __enter__(self) -> bool:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self.fh = open(self.path, "a")
        try:
            fcntl.flock(self.fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            return False

    def __exit__(self, *exc: Any) -> None:
        if self.fh:
            try:
                fcntl.flock(self.fh, fcntl.LOCK_UN)
            finally:
                self.fh.close()


def other_fixer_busy(ctx: Context) -> Optional[str]:
    """The Reliability fixer records each attempt in fixer-attempts.json; the
    guardian waits 15 minutes after it acts so two fixers never act at once."""
    try:
        f = ctx.snap_part("fixer")
    except SourceError:
        return None
    t = parse_time(f.get("mtime"))
    if t and ctx.now - t < OTHER_FIXER_QUIET:
        return f"the Hermes reliability fixer acted at {kuwait(t)}; the guardian waits 15 minutes after it"
    return None


def _attempt(store: Store, inc: dict[str, Any], name: str, outcome: FixOutcome, now: datetime, log: Any) -> None:
    store.record_attempt(inc, {"at": iso(now), "fix": name, "ok": outcome.ok, "detail": outcome.detail})
    if log:
        log(f"fix {name} on {inc['check_id']} ({inc['id'][:8]}): {'ok' if outcome.ok else 'not done'}: {outcome.detail}")


def run_fixes(ctx: Context, store: Store, checks: dict[str, Check], now: datetime, out: Outcome, log: Any = None) -> None:
    candidates = []
    for inc in sorted(store.open.values(), key=lambda i: SEVERITY_ORDER.get(i.get("severity"), 9)):
        check = checks.get(inc["check_id"])
        res = ctx.results.get(inc["check_id"])
        if check and check.fix and res is not None and res.status in BAD:
            candidates.append((inc, check, res))
    hooks = [(inc, checks[inc["check_id"]]) for inc in out.resolved
             if inc and checks.get(inc["check_id"]) and checks[inc["check_id"]].on_resolve]
    if not ctx.cfg.can_fix:
        why = ("report-only mode" if ctx.cfg.mode != "fix" else "a dry run" if ctx.cfg.dry_run else "a run off the VPS")
        for inc, check, _ in candidates:
            out.fixes.append(f"would {check.fix.describe} for {check.id} ({why})")
        for inc, check in hooks:
            out.fixes.append(f"would {check.on_resolve.describe} ({why})")
        return
    busy = other_fixer_busy(ctx)
    if busy and (candidates or hooks):
        out.notes.append(busy)
        return
    with FixLock(str(ctx.cfg.home / "fix.lock")) as got:
        if not got:
            out.notes.append("another guardian run holds the fix lock; fixes wait for the next run")
            return
        for inc, check, res in candidates:
            allowed, why = fix_allowed(inc, check.fix.name, check.fix.max_attempts, now)
            if not allowed:
                inc["fix_note"] = why
                continue
            try:
                outcome = check.fix.apply(ctx, res)
            except Exception as e:  # noqa: BLE001 - a failed fix is recorded, never raised
                outcome = FixOutcome(False, f"the fix failed: {type(e).__name__}: {clean(e, 200)}")
            _attempt(store, inc, check.fix.name, outcome, now, log)
            out.fixes.append(f"{check.fix.name} on {check.id}: {outcome.detail}")
            if outcome.done:
                out.resolved.append(store.resolve(check.id, now, f"the guardian's {check.fix.name}: {outcome.detail}"))
        for inc, check in hooks:
            opened = parse_time(inc.get("first_seen_at"))
            if opened and now - opened < ON_RESOLVE_MIN_OPEN:
                continue
            if any(a.get("fix") == check.on_resolve.name for a in inc.get("fix_attempts") or []):
                continue
            try:
                outcome = check.on_resolve.apply(ctx, ctx.results.get(check.id) or Result(OK, ""))
            except Exception as e:  # noqa: BLE001
                outcome = FixOutcome(False, f"the follow-up failed: {type(e).__name__}: {clean(e, 200)}")
            _attempt(store, inc, check.on_resolve.name, outcome, now, log)
            out.fixes.append(f"{check.on_resolve.name} after {check.id} cleared: {outcome.detail}")


# ---- the whole run ----------------------------------------------------------------------

def scan(ctx: Context, store: Store, checks: list[Check], outbox: alerts_mod.Outbox, *, fix: bool,
         log: Any = None) -> Outcome:
    out = Outcome()
    now = ctx.now
    by_id = {c.id: c for c in checks}
    out.findings = run_checks(ctx, checks)
    apply_findings(store, out.findings, now, ctx.cfg.mode, out)
    if fix:
        run_fixes(ctx, store, by_id, now, out, log)
    post_alerts(store, by_id, ctx.results, now, ctx.cfg.mode, outbox, out)
    note = store.flush()
    if note:
        out.notes.append(note)
    store.state["last_scan"] = {
        "at": iso(now),
        "mode": ctx.cfg.mode,
        "dry_run": ctx.cfg.dry_run,
        "remote": ctx.cfg.remote,
        "results": {f.check.id: {"status": f.result.status, "summary": clean(f.result.summary, 400),
                                 "coverage_gap": f.result.coverage_gap, "caused_by": f.result.caused_by,
                                 "seconds": f.seconds} for f in out.findings},
        "fixes": out.fixes,
        "notes": out.notes,
    }
    return out
