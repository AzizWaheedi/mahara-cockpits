"""ClickUp calls a minute for the one token the cockpit shares with the VPS workers
(docs/requests/CLICKUP-DOWNGRADE.md section 3.1).

On ClickUp Business a token may make 100 calls a minute; Business Plus allowed
1,000. One personal token serves the Supabase functions and every VPS worker, so
this check counts, per clock minute of the last hour, every ClickUp call the
four provider ledgers hold (one row per call, phase response or unknown):

- cockpit_media_provider_health: the cockpit's own jobs and presses, and the VPS
  native cycle (rows with native_run_id). The native cycle stamps every receipt
  of a run with one time, the moment it published (read 2026-10-29: run
  070ca214 made 48 calls between 19:00:05 and 19:07:45 Kuwait, all stamped
  19:07:40), so the minute each call was made is not known. Each run's calls
  are therefore counted in every minute of its run, from created_at to
  published_at in cockpit_native_media_runs: an upper bound for those minutes,
  never a count moved to the publish minute. A run that row cannot be found
  for is taken to have run for the 15 minutes before its receipts (the cycle
  is */15; the longest run on record took 805 s).
- cockpit_csm_provider_health: comment watch, onboarding and billing syncs,
  notices and the client success presses.
- cockpit_ceo_provider_health: the VPS CEO refresh (rows with refresh_id or
  run_id) and the CEO's own presses and extensions sync.
- cockpit_board_provider_health: the board levers (every row is ClickUp; the
  table has no provider column).

VPS workers outside these ledgers (task-assignment alerts, the editor desk, the
video review flow, review watch, the ad-billing guard) add more, so the count
is a floor, never the whole. Budget 80, fail above 95, ClickUp refuses above 100.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Optional

from guard.context import Context, SourceError, parent_of
from guard.model import KUWAIT, Check, Result, fail, iso, kuwait, ok, parse_time, unknown, warn

BUDGET = 80          # warn above this many calls in one minute
FAIL_ABOVE = 95      # fail above this many (ClickUp Business refuses above 100)
LIMIT = 100
HTTP_429_FAIL = 10   # 429s in the hour that fail the check; one is a warning
WINDOW_MIN = 60
READ_LIMIT = 5000
PAGE_CAP = 1000      # PostgREST answers at most this many rows on Creative Triage

PHASES = ["response", "unknown"]

# The split of a minute, in this order. Only the non-zero parts are named.
NATIVE = "native cycle"
COCKPIT = "cockpit jobs"
CSM = "CSM ledger"
CEO_REFRESH = "CEO refresh"
CEO = "CEO ledger"
BOARD = "board levers"
PARTS = (NATIVE, COCKPIT, CSM, CEO_REFRESH, CEO, BOARD)

# (table, columns, has a provider column)
LEDGERS = (
    ("cockpit_media_provider_health", "created_at,native_run_id,http_status", True),
    ("cockpit_csm_provider_health", "created_at,http_status", True),
    ("cockpit_ceo_provider_health", "created_at,refresh_id,run_id,http_status", True),
    ("cockpit_board_provider_health", "created_at,http_status", False),
)

TAIL = "VPS workers outside these ledgers add more"

# The native cycle's runs: when each one started and published.
RUNS = "cockpit_native_media_runs"
RUN_GUESS_MIN = 15   # a run not found: assumed to have run for the 15 minutes up to its receipts


def _part(table: str, row: dict[str, Any]) -> str:
    if table == "cockpit_media_provider_health":
        return NATIVE if row.get("native_run_id") not in (None, "") else COCKPIT
    if table == "cockpit_csm_provider_health":
        return CSM
    if table == "cockpit_ceo_provider_health":
        return CEO_REFRESH if row.get("refresh_id") not in (None, "") or row.get("run_id") not in (None, "") else CEO
    return BOARD


def _split_text(split: dict[str, int]) -> str:
    return ", ".join(f"{p} {split[p]}" for p in PARTS if split.get(p))


def _is_429(v: Any) -> bool:
    try:
        return int(v) == 429
    except (TypeError, ValueError):
        return False


def _floor(t: datetime) -> datetime:
    return t.replace(second=0, microsecond=0)


def _hm(t: datetime) -> str:
    return t.astimezone(KUWAIT).strftime("%H:%M")


def _native_windows(ctx: Context, native: dict[str, dict[str, Any]], since: datetime,
                    errors: list[SourceError]) -> tuple[list[dict[str, Any]], bool]:
    """Each native run's minutes, from cockpit_native_media_runs (created_at to
    published_at). Returns the runs with their window, and whether the runs table
    could be read. A run not found there gets the 15 minutes up to its receipts."""
    found: dict[str, dict[str, Any]] = {}
    readable = True
    try:
        rows = ctx.rows(RUNS, "run_id,created_at,published_at",
                        where=[("run_id", "in", sorted(native))], limit=len(native))
        found = {str(r.get("run_id")): r for r in rows}
    except SourceError as e:
        errors.append(e)
        readable = False
    first, last = _floor(since), _floor(ctx.now)
    out = []
    for run_id in sorted(native):
        info = native[run_id]
        stamp = _floor(info["stamp"])
        row = found.get(run_id) or {}
        began, published = parse_time(row.get("created_at")), parse_time(row.get("published_at"))
        if began is not None:
            # The receipts' own minute always counts, whatever the run row says.
            end = max(_floor(published), stamp) if published is not None else stamp
            start, how = min(_floor(began), end), "run"
        else:
            end = stamp
            start, how = end - timedelta(minutes=RUN_GUESS_MIN - 1), "assumed"
        lo, hi = max(start, first), min(end, last)
        if hi < lo:  # never drop a run's calls: keep them in the receipts' minute, inside the hour
            lo = hi = min(max(stamp, first), last)
        out.append({"run_id": run_id, "calls": info["n"], "from": lo, "to": hi, "window": how})
    return out, readable


def run_budget(ctx: Context) -> Result:
    since = ctx.now - timedelta(minutes=WINDOW_MIN)
    per_minute: Counter[datetime] = Counter()
    by_part: dict[datetime, Counter[str]] = {}
    native: dict[str, dict[str, Any]] = {}
    rows_read: dict[str, Optional[int]] = {}
    errors: list[SourceError] = []
    unread: list[str] = []
    truncated = False
    http_429 = 0
    for table, columns, has_provider in LEDGERS:
        where: list[tuple[str, str, Any]] = [("phase", "in", PHASES), ("created_at", "gte", iso(since))]
        if has_provider:
            where.insert(0, ("provider", "eq", "clickup"))
        try:
            rows = ctx.rows(table, columns, where=where, order="created_at.desc", limit=READ_LIMIT)
        except SourceError as e:
            errors.append(e)
            unread.append(table)
            rows_read[table] = None
            continue
        rows_read[table] = len(rows)
        if len(rows) >= PAGE_CAP:
            truncated = True
        for r in rows:
            at = parse_time(r.get("created_at"))
            if at is None or at < since or at > ctx.now + timedelta(minutes=1):
                continue
            if _is_429(r.get("http_status")):
                http_429 += 1
            part = _part(table, r)
            if part == NATIVE:
                # Stamped with the run's publish time: placed over its run below.
                run = native.setdefault(str(r.get("native_run_id")), {"n": 0, "stamp": at})
                run["n"] += 1
                run["stamp"] = max(run["stamp"], at)
                continue
            minute = _floor(at)
            per_minute[minute] += 1
            by_part.setdefault(minute, Counter())[part] += 1

    if len(unread) == len(LEDGERS):
        return unknown("None of the four ClickUp ledgers could be read, so the calls a minute are not known.",
                       caused_by=parent_of(*errors), evidence={"unread": unread})

    runs: list[dict[str, Any]] = []
    runs_readable = True
    if native:
        runs, runs_readable = _native_windows(ctx, native, since, errors)
        for run in runs:
            m = run["from"]
            while m <= run["to"]:
                per_minute[m] += run["calls"]
                by_part.setdefault(m, Counter())[NATIVE] += run["calls"]
                m += timedelta(minutes=1)

    peak, peak_at = 0, None
    for minute, n in per_minute.items():
        if n > peak or (n == peak and peak_at is not None and minute > peak_at):
            peak, peak_at = n, minute
    split = {p: by_part[peak_at][p] for p in PARTS if peak_at is not None and by_part[peak_at][p]}
    at_peak = [r for r in runs if peak_at is not None and r["from"] <= peak_at <= r["to"]]
    ev: dict[str, Any] = {
        "peak": peak, "peak_at": iso(peak_at), "split": split,
        "minutes_over_80": sum(1 for n in per_minute.values() if n > BUDGET),
        "http_429": http_429, "rows": rows_read, "truncated": truncated,
        "native_stamped_at_publish": True,
        # Each native run's calls sit in every minute of its run: the peak is an upper bound there.
        "native_counted_across_run": True,
        "native_runs": [{**r, "from": iso(r["from"]), "to": iso(r["to"])} for r in runs],
    }
    if not runs_readable:
        unread.append(RUNS)
    if unread:
        ev["unread"] = unread

    notes = []
    if truncated:
        notes.append("At least: one ledger hit its 1,000-row page.")
    ledgers_unread = [t for t in unread if t != RUNS]
    if ledgers_unread:
        notes.append(f"At least: {', '.join(ledgers_unread)} could not be read.")
    if not runs_readable:
        notes.append(f"{RUNS} could not be read, so each native run is taken to have run for the "
                     f"{RUN_GUESS_MIN} minutes before its receipts.")
    suffix = (" " + " ".join(notes)) if notes else ""

    if not per_minute:
        if unread:
            return unknown(f"No ClickUp call is recorded in the last hour in the ledgers that could be read, and "
                           f"{', '.join(unread)} could not be read. This is not zero.",
                           caused_by=parent_of(*errors), evidence=ev)
        return unknown("No ClickUp call is recorded in the last hour, though the task mirror reads ClickUp every 2 "
                       "minutes. The ledgers may have stopped; this is not zero.", evidence=ev)

    when, parts = kuwait(peak_at), _split_text(split)
    upto = "up to " if at_peak else ""
    native_note = ""
    if at_peak:
        spans = ", ".join(f"{_hm(r['from'])} to {_hm(r['to'])}"
                          + (", assumed: the run is not in " + RUNS if r["window"] == "assumed" else "")
                          for r in at_peak)
        native_note = (f" The native cycle's receipts carry only the time it published, so its "
                       f"{sum(r['calls'] for r in at_peak)} calls are counted in every minute of its run "
                       f"({spans}): an upper bound.")
    peak_level = 2 if peak > FAIL_ABOVE else 1 if peak > BUDGET else 0
    refused_level = 2 if http_429 >= HTTP_429_FAIL else 1 if http_429 else 0
    refused = f"ClickUp refused {http_429} calls with 429 in the last hour."
    level = max(peak_level, refused_level)

    if refused_level > peak_level:
        summary = f"{refused} Busiest minute: {upto}{peak} at {when} ({parts}).{native_note}"
    elif peak_level == 2:
        summary = (f"{upto.capitalize()}{peak} ClickUp calls in one minute at {when} ({parts}), at ClickUp's limit "
                   f"of {LIMIT}. Requests reach ClickUp late and presses in the cockpit can fail.{native_note}")
    elif peak_level == 1:
        summary = (f"{upto.capitalize()}{peak} ClickUp calls in one minute at {when} ({parts}), over the budget of "
                   f"{BUDGET}. {TAIL}, so ClickUp may already be refusing calls.{native_note}")
    else:
        summary = (f"Busiest minute in the last hour: {upto}{peak} ClickUp calls at {when} ({parts}).{native_note} "
                   f"Budget {BUDGET}; ClickUp allows {LIMIT}. {TAIL}.")
    if http_429 and refused_level <= peak_level:
        summary += " " + refused  # a 429 beside a minute already over the budget
    summary += suffix

    if level == 2:
        return fail(summary, since=peak_at if peak_level == 2 else None, evidence=ev)
    if level == 1:
        return warn(summary, evidence=ev)
    if unread:
        # Under budget in what could be read, but a ledger (or the native runs) is missing: never called ok.
        return unknown(summary, caused_by=parent_of(*errors), evidence=ev)
    return ok(summary, evidence=ev)


CHECKS = [
    Check(
        id="clickup-rate-budget", area="providers", name="ClickUp calls a minute",
        means="The cockpit's ClickUp calls stay under ClickUp Business's 100 a minute for the one token they share "
              "with the VPS workers.",
        severity="medium",
        reads="The last 60 minutes of ClickUp calls (phase response or unknown) in cockpit_media_provider_health, "
              "cockpit_csm_provider_health and cockpit_ceo_provider_health (provider clickup) and "
              "cockpit_board_provider_health, counted per clock minute. The native cycle stamps a run's receipts "
              "with its publish time, so each run's calls are counted in every minute from its created_at to its "
              "published_at in cockpit_native_media_runs (an upper bound for those minutes)",
        threshold="Any minute in the last hour over 80: warn; over 95: fail. Any 429 in the hour: warn; 10 or more: "
                  "fail.",
        run=run_budget, owner="the systems manager", confirm=2, clear=2,
        action="Read the busiest minute's split in the evidence. A cockpit job: lower its pacing secret "
               "(CLICKUP_REQUESTS_CALLS_PER_MINUTE, CLICKUP_CALLS_PER_MINUTE, CLICKUP_TASKS_CALLS_PER_MINUTE). "
               "The native cycle: ask Hermes to pace it. Plan: docs/requests/CLICKUP-DOWNGRADE.md.",
    ),
]
