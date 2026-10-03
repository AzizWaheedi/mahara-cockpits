"""Scan, decide, fix: the guardian's one loop.

scan   run every check (a check that cannot read its source says "could not
       be checked", never ok), then open, update or resolve one incident per
       check, deduped by check id, and post what is due. A reading that could
       not be checked because Supabase or the VPS itself did not answer is
       folded into that one incident (supabase-health, vps-snapshot).
fix    for open incidents whose check has a safe fix: in --mode fix only, at
       most once per incident per hour with backoff (1 h, 2 h, 4 h ... up to
       24 h, then give up after the fix's max attempts), and at most 3 times a
       day per check across incidents (a cause that keeps coming back is a
       person's). Every attempt is recorded and saved before the fix runs. In
       report-only mode it only says what it would do.
"""
from __future__ import annotations

import fcntl
import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Iterable, Optional

from . import alerts as alerts_mod
from .context import PARENT_OF_SOURCE, Context, SourceError
from .model import (BAD, FAIL, LEVEL_RANK, NOT_DEPLOYED, OK, PAUSED, UNKNOWN, WARN, Check, FixOutcome, Result, iso,
                    kuwait, parse_time, unknown)
from .redact import clean, clean_obj
from .store import Store

UNKNOWN_CONFIRM = 3                    # scans "could not be checked" before it is an incident
BACKOFF_BASE = timedelta(hours=1)
BACKOFF_CAP = timedelta(hours=24)
OTHER_FIXER_QUIET = timedelta(minutes=15)
ON_RESOLVE_MIN_OPEN = timedelta(minutes=5)
FIX_DAY_CAP = 3                        # fixes per check per 24 h, across incidents
FIX_DAY = timedelta(hours=24)
HOOK_TRIES = 3                         # a follow-up that could not run (a lock held) is tried again, 3 times at most
CONVEX_ALERT_AFTER = 3                 # health.ts ALERT_AFTER: Convex posts once, when a job's streak reaches 3
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
            parent = PARENT_OF_SOURCE.get(getattr(e, "source", None) or "")
            res = unknown(f"Could not be checked: {clean(e, 240)}", coverage_gap=bool(getattr(e, "gap", False)),
                          caused_by=parent if parent and parent != check.id else None)
        except Exception as e:  # noqa: BLE001 - one check failing must never stop the scan
            res = unknown(f"Could not be checked: the check itself failed ({type(e).__name__}: {clean(e, 200)}).")
        ctx.results[check.id] = res
        out.append(Finding(check, res, round(time.monotonic() - started, 2)))
    return out


def _convex_sales_watch(check: Check, results: dict[str, Result], inc: Optional[dict[str, Any]],
                        now: Optional[datetime]) -> Optional[str]:
    """Convex's sales watch posts ONCE, when its failure streak reaches 3, and never
    again while it keeps failing. So it covers an incident only when the job is
    failing, its streak is at least 3, the incident was already there when that
    one message went out, the message named this job, and Slack itself is up."""
    sections = results.get("convex-ceo-sections")
    if sections is None or sections.status not in (OK, WARN) or inc is None or now is None:
        return None
    jobs = results.get("convex-jobs")
    data = (jobs.data if jobs is not None else None) or {}
    watch = data.get("sales_watch") or {}
    if watch.get("ok") is not False or data.get("slack_ok") is not True:
        return None
    streak, every = int(watch.get("streak") or 0), int(watch.get("everyMin") or 15)
    if streak < CONVEX_ALERT_AFTER:
        return None
    alerted = now - timedelta(minutes=(streak - CONVEX_ALERT_AFTER) * every)
    first = parse_time(inc.get("first_seen_at"))
    if first is None or first > alerted + timedelta(minutes=every):
        return None
    word = "mirror" if check.id == "sales-mirror" else check.id.replace("desk-", "", 1)
    if word and word not in str(watch.get("error") or ""):
        return None
    return (f"Convex's sales watch already posted this when it failed its third run in a row "
            f"(it has failed {streak} in a row and Slack is up)")


def covered(check: Check, results: dict[str, Result], inc: Optional[dict[str, Any]] = None,
            now: Optional[datetime] = None) -> Optional[str]:
    """Whether someone else already alerts on this, so the guardian stays quiet.
    "Someone else" must be shown to be delivering, not only to exist."""
    q = check.quiet_because
    if not q:
        return None
    if q == "convex":
        r = results.get("convex-ceo-sections")
        if r is not None and r.status in (OK, WARN):
            return "Convex already alerts on this and Convex is running"
    elif q == "convex-sales-watch":
        return _convex_sales_watch(check, results, inc, now)
    elif q == "hermes":
        def delivering(r: Optional[Result]) -> bool:
            return r is not None and r.status in (OK, WARN) and (r.data or {}).get("delivering", True) is not False
        if check.id.startswith("hermes-monitor-"):
            mine = results.get(check.id)
            if mine is not None and mine.status == WARN and delivering(mine):
                return "the Hermes monitor alerts on its own incidents and is delivering them"
            return None
        if delivering(results.get("hermes-monitor-cockpits")) and delivering(results.get("hermes-monitor-sites")):
            return "the Hermes monitors already alert on this, and they tick and deliver"
    elif q == "sales-watchdog":
        r = results.get("live-alerts")
        if r is not None and (r.data or {}).get("posting") is True:
            return "the sales watchdog already alerts on this and its alerts reach Slack"
    return None


def _parent_covers(res: Result, results: dict[str, Result]) -> Optional[str]:
    """A bad reading folds into a bad parent; an unknown one into a bad or unknown parent
    (Supabase or the VPS not answering is one incident, not fifty)."""
    if not res.caused_by:
        return None
    parent = results.get(res.caused_by)
    if parent is None:
        return None
    if parent.status in BAD or (res.status == UNKNOWN and parent.status == UNKNOWN):
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


def _confirmed(check: Check, st: dict[str, Any], now: datetime) -> bool:
    if st["bad"] < check.confirm:
        return False
    if check.confirm_minutes:
        since = parse_time(st.get("bad_since"))
        return since is not None and now - since >= timedelta(minutes=check.confirm_minutes)
    return True


def apply_findings(store: Store, findings: list[Finding], now: datetime, mode: str, out: Outcome) -> None:
    results = {f.check.id: f.result for f in findings}
    streaks = store.state.setdefault("streaks", {})
    for f in findings:
        check, res = f.check, f.result
        st = streaks.setdefault(check.id, {"bad": 0, "unknown": 0})
        st.setdefault("ok", 0)
        inc = store.open.get(check.id)
        if res.status in BAD:
            st["bad"] += 1
            st["unknown"] = 0
            st["ok"] = 0
            st["bad_since"] = st.get("bad_since") or iso(now)
            parent = _parent_covers(res, results)
            if parent:
                if inc:
                    # Not a recovery: no "Resolved" message goes out for it.
                    out.resolved.append(store.resolve(check.id, now, f"now tracked under the {parent} incident, which "
                                                                     "has the same cause", folded_into=parent))
                continue
            if inc:
                store.touch(inc, check, res, now)
            elif _confirmed(check, st, now):
                out.opened.append(store.open_incident(check, res, now, mode))
        elif res.status == UNKNOWN:
            st["unknown"] += 1
            st["bad"] = 0
            st["ok"] = 0
            st["bad_since"] = None
            if res.coverage_gap or _parent_covers(res, results):
                continue
            if inc:
                # Unknown is not healthy: the incident stays open as it was.
                inc["last_seen_at"] = iso(now)
            elif st["unknown"] >= UNKNOWN_CONFIRM:
                out.opened.append(store.open_incident(check, res, now, mode))
        else:
            st["bad"] = 0
            st["unknown"] = 0
            st["bad_since"] = None
            st["ok"] += 1
            if inc:
                if res.status == OK and st["ok"] < check.clear:
                    inc["last_seen_at"] = iso(now)
                    continue          # one good reading is not a recovery for a check that flaps
                if res.status == OK:
                    by = _resolved_by(inc)
                elif res.status == PAUSED:
                    by = f"it is now paused on purpose: {res.summary}"
                else:
                    by = f"it now reads not deployed yet: {res.summary}"
                out.resolved.append(store.resolve(check.id, now, by))


# ---- alerts -------------------------------------------------------------------------

def _due(inc: dict[str, Any], check: Check, results: dict[str, Result], now: datetime,
         state: dict[str, Any], *, skip_throttle: bool = False) -> tuple[bool, str]:
    if not check.alert:
        return False, "the daily summary carries it"
    cov = covered(check, results, inc, now)
    if cov:
        return False, cov
    urgent = (check.urgent or bool(inc.get("urgent"))) and inc.get("level") == FAIL
    if not urgent and not alerts_mod.in_hours(now):
        return False, "held until 09:00 Kuwait time (Saturday to Thursday)"
    last = parse_time((state.get("last_alert") or {}).get(check.id))
    if not skip_throttle and last and now - last < alerts_mod.THROTTLE:
        return False, f"held: this check was alerted at {kuwait(last)} and flaps"
    return True, ""


def _worse(inc: dict[str, Any]) -> tuple[list[str], bool]:
    """What got worse since the last message about this incident: (changes, level rose)."""
    if "alerted_level" not in inc:
        # Alerted before the guardian kept these: start from what it reads now.
        inc["alerted_level"] = inc.get("level")
        inc["alerted_keys"] = list(inc.get("items") or [])
        return [], False
    changes, rose = [], False
    was, now_level = inc.get("alerted_level") or UNKNOWN, inc.get("level") or UNKNOWN
    if LEVEL_RANK.get(now_level, 0) > LEVEL_RANK.get(was, 0):
        words = alerts_mod.LEVEL_WORDS
        changes.append(f"it went from {words.get(was, was).lower()} to {words.get(now_level, now_level).lower()}")
        rose = True
    new = sorted(set(inc.get("items") or []) - set(inc.get("alerted_keys") or []))
    if new:
        changes.append("newly failing: " + ", ".join(new[:8]))
    if inc.get("fix_capped") and not inc.get("alerted_cap"):
        changes.append(clean(inc.get("fix_note"), 200))
    return changes, rose


def _mark(inc: dict[str, Any], check: Check, state: dict[str, Any], now: datetime, *, opening: bool) -> dict[str, Any]:
    """Record a message as sent before it is sent; returns what to put back if it does not go."""
    keys = ("alerted_at", "realerted_at", "alerted_level", "alerted_keys", "alerted_cap", "alerted_via")
    before = {k: inc.get(k) for k in keys}
    before["_last"] = (state.get("last_alert") or {}).get(check.id)
    if opening:
        inc["alerted_at"] = iso(now)
    else:
        inc["realerted_at"] = iso(now)
    inc["alerted_level"] = inc.get("level")
    inc["alerted_keys"] = list(inc.get("items") or [])
    inc["alerted_cap"] = bool(inc.get("fix_capped"))
    state.setdefault("last_alert", {})[check.id] = iso(now)
    return before


def _unmark(inc: dict[str, Any], check: Check, state: dict[str, Any], before: dict[str, Any]) -> None:
    last = before.pop("_last")
    for k, v in before.items():
        if v is None:
            inc.pop(k, None)
        else:
            inc[k] = v
    if last is None:
        (state.get("last_alert") or {}).pop(check.id, None)
    else:
        state.setdefault("last_alert", {})[check.id] = last


def post_alerts(store: Store, checks: dict[str, Check], results: dict[str, Result], now: datetime, mode: str,
                outbox: alerts_mod.Outbox, out: Outcome) -> None:
    state = store.state
    due_since = state.setdefault("due_since", {})
    failed_ids: set[str] = set()

    def send(text: str, marks: list[tuple[dict[str, Any], Check, dict[str, Any]]], ids: list[str]) -> bool:
        """Records first (already done by the caller), saves, posts, and puts the records back if it did not go."""
        store.checkpoint()
        if outbox.post(text):
            out.posted.append(text)
            for inc, _, _ in marks:
                store.write(inc)
            return True
        for inc, check, before in marks:
            _unmark(inc, check, state, before)
        failed_ids.update(ids)
        store.checkpoint()
        return False

    openings: list[tuple[dict[str, Any], Check]] = []
    worse: list[tuple[dict[str, Any], Check, list[str]]] = []
    for inc in sorted(store.open.values(), key=lambda i: SEVERITY_ORDER.get(i.get("severity"), 9)):
        check = checks.get(inc["check_id"])
        if check is None:
            continue
        if not inc.get("alerted_at"):
            ok_, why = _due(inc, check, results, now, state)
            inc["alert_note"] = why or None
            if ok_:
                openings.append((inc, check))
            continue
        changes, rose = _worse(inc)
        if not changes:
            continue
        urgent = (check.urgent or bool(inc.get("urgent"))) and inc.get("level") == FAIL
        ok_, why = _due(inc, check, results, now, state, skip_throttle=rose and urgent)
        inc["alert_note"] = why or None
        if ok_:
            worse.append((inc, check, changes))

    singles, rest = openings[:alerts_mod.MAX_OPENINGS], openings[alerts_mod.MAX_OPENINGS:]
    for inc, check in singles:
        text = alerts_mod.opened_text(inc, check, now, mode)
        if outbox.dry_run:
            out.would_post.append(text)
            continue
        if outbox.broken:
            failed_ids.add(inc["id"])
            continue
        send(text, [(inc, check, _mark(inc, check, state, now, opening=True))], [inc["id"]])
    if rest:
        text = alerts_mod.digest_text([i for i, _ in rest])
        if outbox.dry_run:
            out.would_post.append(text)
        elif outbox.broken:
            failed_ids.update(i["id"] for i, _ in rest)
        else:
            marks = []
            for inc, check in rest:
                before = _mark(inc, check, state, now, opening=True)
                inc["alerted_via"] = "digest"
                marks.append((inc, check, before))
            send(text, marks, [i["id"] for i, _ in rest])
    for inc, check, changes in worse:
        text = alerts_mod.worse_text(inc, check, now, mode, changes)
        if outbox.dry_run:
            out.would_post.append(text)
            continue
        if outbox.broken:
            failed_ids.add(inc["id"])
            continue
        send(text, [(inc, check, _mark(inc, check, state, now, opening=False))], [inc["id"]])

    # All clears: only for incidents whose opening was posted, never for one folded into another.
    queue = state.setdefault("outbox", [])
    for inc in out.resolved:
        if inc and inc.get("alerted_at") and not inc.get("resolve_alerted_at") and not inc.get("folded_into"):
            check = checks.get(inc["check_id"])
            queue.append({"id": inc["id"], "text": alerts_mod.resolved_text(inc, now), "urgent": bool(check and check.urgent)})
    keep, ready = [], []
    for item in queue:
        if not item.get("urgent") and not alerts_mod.in_hours(now):
            keep.append(item)
        else:
            ready.append(item)
    if outbox.dry_run:
        out.would_post += [i["text"] for i in ready]
        state["outbox"] = keep + ready
    else:
        by_id = {i.get("id"): i for i in state.get("resolved") or []}
        batches = [[i] for i in ready[:alerts_mod.MAX_RESOLVED]]
        if ready[alerts_mod.MAX_RESOLVED:]:
            batches.append(ready[alerts_mod.MAX_RESOLVED:])
        unsent: list[dict[str, Any]] = []
        for batch in batches:
            if outbox.broken:
                unsent += batch
                continue
            text = batch[0]["text"] if len(batch) == 1 else alerts_mod.resolved_digest_text([i["text"] for i in batch])
            # Record first: the items leave the queue and their incidents are marked.
            state["outbox"] = [i for i in keep + ready if i not in batch and i not in unsent] + unsent
            for item in batch:
                if item["id"] in by_id:
                    by_id[item["id"]]["resolve_alerted_at"] = iso(now)
            store.checkpoint()
            if outbox.post(text):
                out.posted.append(text)
                for item in batch:
                    if item["id"] in by_id:
                        store.write(by_id[item["id"]])
            else:
                for item in batch:
                    if item["id"] in by_id:
                        by_id[item["id"]].pop("resolve_alerted_at", None)
                unsent += batch
                failed_ids.update(f"{i['id']}:resolved" for i in batch)
        state["outbox"] = (keep + unsent)[-50:]
        store.checkpoint()
    # What was due and did not go: the heartbeat reports the oldest, so the dead-man
    # switch on Cloudflare says so when Slack keeps refusing.
    # Only what was due in this run and failed counts; a message held for the night is not stuck.
    if not outbox.dry_run:
        for i in failed_ids:
            due_since.setdefault(i, iso(now))
        for k in list(due_since):
            if k not in failed_ids:
                due_since.pop(k, None)
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


def day_cap(state: dict[str, Any], check_id: str, now: datetime) -> Optional[str]:
    """At most FIX_DAY_CAP fixes per check per 24 h, whichever incident they were for:
    a job whose row goes stale every hour opens a new incident every hour."""
    hist = state.setdefault("fix_history", {}).setdefault(check_id, [])
    hist[:] = [t for t in hist if (parse_time(t) or now) > now - FIX_DAY]
    if len(hist) >= FIX_DAY_CAP:
        return (f"its safe fix ran {len(hist)} times in 24 hours and the cause is still there, so the guardian stopped; "
                "a person must find the cause")
    return None


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
    """The Reliability fixer logs every run in fixer-attempts.json, most of them no-ops;
    the guardian waits 15 minutes after it really acted so two fixers never act at once."""
    try:
        f = ctx.snap_part("fixer")
    except SourceError:
        return None
    t = parse_time(f.get("last_action_at") if "last_action_at" in f else f.get("mtime"))
    if t and ctx.now - t < OTHER_FIXER_QUIET:
        return f"the Hermes reliability fixer acted at {kuwait(t)}; the guardian waits 15 minutes after it"
    return None


def _begin(store: Store, inc: dict[str, Any], name: str, now: datetime) -> dict[str, Any]:
    """Record the attempt and save BEFORE the fix runs: a run that cannot save never acts."""
    store.record_attempt(inc, {"at": iso(now), "fix": name, "ok": False, "pending": True,
                               "detail": "started; the run stopped before its outcome was recorded"})
    store.checkpoint()
    return inc["fix_attempts"][-1]


def _end(store: Store, inc: dict[str, Any], attempt: dict[str, Any], name: str, outcome: FixOutcome, log: Any) -> None:
    attempt.update({"ok": outcome.ok, "detail": clean(outcome.detail, 400)})
    attempt.pop("pending", None)
    store.write(inc)
    store.checkpoint()
    if log:
        log(f"fix {name} on {inc['check_id']} ({inc['id'][:8]}): {'ok' if outcome.ok else 'not done'}: {outcome.detail}")


def _keep_hooks(state: dict[str, Any], hooks: list[tuple[dict[str, Any], Check]]) -> None:
    pending = state.setdefault("pending_hooks", [])
    have = {p.get("id") for p in pending}
    for inc, check in hooks:
        if inc.get("id") not in have:
            pending.append({"id": inc["id"], "check_id": check.id})
    del pending[:-20]


def run_fixes(ctx: Context, store: Store, checks: dict[str, Check], now: datetime, out: Outcome, log: Any = None) -> None:
    state = store.state
    candidates = []
    for inc in sorted(store.open.values(), key=lambda i: SEVERITY_ORDER.get(i.get("severity"), 9)):
        check = checks.get(inc["check_id"])
        res = ctx.results.get(inc["check_id"])
        if check and check.fix and res is not None and res.status in BAD:
            candidates.append((inc, check, res))
    hooks = [(inc, checks[inc["check_id"]]) for inc in out.resolved
             if inc and checks.get(inc["check_id"]) and checks[inc["check_id"]].on_resolve and not inc.get("folded_into")]
    # Follow-ups a blocked run could not do are kept and tried again.
    resolved_by_id = {i.get("id"): i for i in state.get("resolved") or []}
    have = {inc["id"] for inc, _ in hooks}
    for p in state.get("pending_hooks") or []:
        inc, check = resolved_by_id.get(p.get("id")), checks.get(p.get("check_id"))
        if inc and check and check.on_resolve and inc["id"] not in have:
            hooks.append((inc, check))
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
        _keep_hooks(state, hooks)
        return
    with FixLock(str(ctx.cfg.home / "fix.lock")) as got:
        if not got:
            out.notes.append("another guardian run holds the fix lock; fixes wait for the next run")
            _keep_hooks(state, hooks)
            return
        if candidates or hooks:
            ctx.refresh_snapshot()     # act on a fresh look, not the one the scan started with
        for inc, check, res in candidates:
            allowed, why = fix_allowed(inc, check.fix.name, check.fix.max_attempts, now)
            capped = day_cap(state, check.id, now) if allowed else None
            if not allowed or capped:
                inc["fix_note"] = capped or why
                if capped:
                    inc["fix_capped"] = True
                continue
            attempt = _begin(store, inc, check.fix.name, now)
            state["fix_history"][check.id].append(iso(now))
            store.checkpoint()
            try:
                outcome = check.fix.apply(ctx, res)
            except Exception as e:  # noqa: BLE001 - a failed fix is recorded, never raised
                outcome = FixOutcome(False, f"the fix failed: {type(e).__name__}: {clean(e, 200)}")
            _end(store, inc, attempt, check.fix.name, outcome, log)
            out.fixes.append(f"{check.fix.name} on {check.id}: {outcome.detail}")
            if outcome.done:
                out.resolved.append(store.resolve(check.id, now, f"the guardian's {check.fix.name}: {outcome.detail}"))
        retry: list[tuple[dict[str, Any], Check]] = []
        for inc, check in hooks:
            opened = parse_time(inc.get("first_seen_at"))
            if opened and parse_time(inc.get("resolved_at")) and \
                    parse_time(inc.get("resolved_at")) - opened < ON_RESOLVE_MIN_OPEN:
                continue
            tried = [a for a in inc.get("fix_attempts") or [] if a.get("fix") == check.on_resolve.name]
            if any(a.get("ok") or a.get("final") for a in tried) or len(tried) >= HOOK_TRIES:
                continue
            attempt = _begin(store, inc, check.on_resolve.name, now)
            try:
                outcome = check.on_resolve.apply(ctx, Result(OK, "", data={"incident": inc}))
            except Exception as e:  # noqa: BLE001
                outcome = FixOutcome(False, f"the follow-up failed: {type(e).__name__}: {clean(e, 200)}")
            if outcome.done:
                attempt["final"] = True
            _end(store, inc, attempt, check.on_resolve.name, outcome, log)
            out.fixes.append(f"{check.on_resolve.name} after {check.id} cleared: {outcome.detail}")
            if not outcome.ok and not outcome.done:
                retry.append((inc, check))
        state["pending_hooks"] = []
        _keep_hooks(state, retry)


# ---- the whole run ----------------------------------------------------------------------

def _json_data(data: dict[str, Any]) -> dict[str, Any]:
    try:
        return json.loads(json.dumps(clean_obj({k: v for k, v in (data or {}).items() if k != "incident"}), default=str))
    except (TypeError, ValueError):
        return {}


def remember_log_offsets(ctx: Context) -> None:
    """The size of each log at this scan: the next scan counts only the tracebacks written after it."""
    cached = ctx._cache.get("snapshot")  # noqa: SLF001 - the scan's own snapshot, if it was read
    if not cached or cached[0] != "ok":
        return
    logs = (cached[1] or {}).get("logs")
    if not isinstance(logs, dict) or set(logs) == {"error"}:
        return
    offsets = ctx.state.setdefault("log_offsets", {})
    for path, info in logs.items():
        if isinstance(info, dict) and isinstance(info.get("size"), int):
            offsets[path] = info["size"]


def hermes_incidents(store: Store, checks: dict[str, Check]) -> dict[str, Any]:
    """Open Hermes-owned incidents in the Hermes monitor's own shape (fixer_trigger.py reads it)."""
    out: dict[str, Any] = {}
    for inc in store.open.values():
        check = checks.get(inc["check_id"])
        if inc.get("owner") != "Hermes" or inc.get("level") not in BAD:
            continue
        crit = inc.get("level") == FAIL and inc.get("severity") in ("critical", "high")
        stale = bool(((inc.get("evidence") or {}).get("age_min") is not None) or "not run" in str(inc.get("detail")))
        opened = parse_time(inc.get("first_seen_at")) or parse_time(inc.get("opened_at"))
        if opened is None:
            continue
        out[inc["check_id"]] = {
            "severity": "crit" if crit else "warn",
            "kind": "freshness" if stale else "outage",
            "opened": int(opened.timestamp()),
            "component": check.area if check else inc.get("area"),
            "summary": clean(f"{inc.get('title')}: {inc.get('detail')}", 300),
        }
    return out


def scan(ctx: Context, store: Store, checks: list[Check], outbox: alerts_mod.Outbox, *, fix: bool,
         log: Any = None) -> Outcome:
    out = Outcome()
    now = ctx.now
    by_id = {c.id: c for c in checks}
    out.findings = run_checks(ctx, checks)
    remember_log_offsets(ctx)
    apply_findings(store, out.findings, now, ctx.cfg.mode, out)
    if fix:
        run_fixes(ctx, store, by_id, now, out, log)
    post_alerts(store, by_id, ctx.results, now, ctx.cfg.mode, outbox, out)
    note = store.flush(now)
    if note:
        out.notes.append(note)
    store.state["last_scan"] = {
        "at": iso(now),
        "mode": ctx.cfg.mode,
        "dry_run": ctx.cfg.dry_run,
        "remote": ctx.cfg.remote,
        "full": len(checks) > 1,
        "results": {f.check.id: {"status": f.result.status, "summary": clean(f.result.summary, 400),
                                 "coverage_gap": f.result.coverage_gap, "caused_by": f.result.caused_by,
                                 "seconds": f.seconds, "data": _json_data(f.result.data)} for f in out.findings},
        "fixes": out.fixes,
        "notes": out.notes,
    }
    return out


__all__ = ["scan", "run_checks", "apply_findings", "post_alerts", "run_fixes", "covered", "fix_allowed", "day_cap",
           "FixLock", "Outcome", "Finding", "hermes_incidents", "NOT_DEPLOYED", "UNKNOWN", "WARN"]
