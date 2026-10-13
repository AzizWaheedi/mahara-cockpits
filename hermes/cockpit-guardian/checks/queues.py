"""Queues that should drain (catalogue W1, W8, W9, W11, W12, W14, M4, M6, X3).

Two readings per queue: rows still waiting past their limit, and rows that
ended failed in the last 24 hours (a worker gives up after its tries, so a
queue can look empty while every item in it failed: eod-out marks a row
failed after 5 tries, about 20 minutes in, before any "waiting" limit).

The guardian never edits a queue row: each worker's own reaper owns its
rows, and a retry can spend a picture or reach a lead. It only says how long
something has waited, what failed and what a person can do.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Callable, Optional

from guard.context import Context
from guard.model import Check, Result, age_min, ago, ok, parse_time, warn
from guard.redact import clean


@dataclass(frozen=True)
class Queue:
    id: str
    table: str
    label: str
    states: tuple[str, ...]    # the states that mean "waiting or working"
    time_col: str               # when it entered that state
    limit_min: int
    owner: str
    action: str
    catalogue: str = ""
    id_col: str = "id"
    error_hint: Optional[str] = None
    failed_col: Optional[str] = None   # set: also warn on rows that ended failed in 24 h, dated by this column


QUEUES = (
    Queue("queue-social-jobs", "social_jobs", "Salma job", ("queued", "running"), "updated_at", 60, "the creative director",
          "Press Draw again on that post in the cockpit (it costs one picture).", "W9", failed_col="updated_at"),
    Queue("queue-sales-requests", "cockpit_sales_requests", "sales proposal request", ("running",), "claimed_at", 60,
          "Hermes", "Read ~/.sales-desk.log; the desk requeues a request and parks it after 4 tries.", "W1"),
    Queue("queue-sales-requests-waiting", "cockpit_sales_requests", "sales proposal request not picked up", ("queued",),
          "requested_at", 15, "Hermes", "The desk's requests job runs every 2 minutes; read ~/.sales-desk.log.", "W1"),
    Queue("queue-editor-requests", "editor_requests", "editor desk request", ("queued", "running"), "created_at", 60,
          "the CEO", "Read ~/.editor-desk/out/cron.log for the requests job.", "W11", failed_col="updated_at"),
    Queue("queue-ideation-requests", "ideation_requests", "pasted link for the radar", ("queued", "running"),
          "created_at", 60, "the creative director", "Read ~/.ideation-radar/out/cron.log for the pending job.", "W14",
          failed_col="updated_at"),
    Queue("queue-post-jobs", "cockpit_post_jobs", "posting desk job", ("queued", "running"), "created_at", 60,
          "the creative director", "Read the job's error in the posting desk; 'Session expired' means Higgsfield must be "
          "signed in again on the VPS.", "M4", failed_col="updated_at"),
    Queue("queue-ask-ai", "cockpit_ask_ai_jobs", "Hermes Ask AI job", ("queued", "claimed", "running"), "created_at", 30, "Hermes",
          "Check Hermes's Ask AI job and its provider's credit.", "H12"),
    Queue("queue-eod-outbox", "eod_outbox", "end of day post", ("queued",), "created_at", 15, "the CEO",
          "If the error is not_in_channel, invite the cockpit's Slack bot to #eods-salesreps.", "W8", failed_col="created_at"),
    Queue("queue-team-calendar", "team_calendar_ops", "meeting change bound for Google Calendar", ("pending", "failed"),
          "at", 30, "the CEO", "Set the calendar sign-in (GOOGLE_CAL_* in ~/.team-sync/env) or fix the refused series.", "W12"),
    Queue("queue-feedback", "cockpit_feedback", "cockpit change request", ("queued",), "created_at", 1440, "the CEO",
          "Open the Claude desktop app: the feedback scan runs only while it is open.", "X3"),
)


WITH_ERROR = ("eod_outbox", "team_calendar_ops", "cockpit_post_jobs", "editor_requests", "ideation_requests", "social_jobs",
              "cockpit_sales_requests")


def queue_check(q: Queue) -> Callable[[Context], Result]:
    def run(ctx: Context) -> Result:
        err_col = ",error" if q.table in WITH_ERROR else ""
        rows = ctx.rows(q.table, f"{q.id_col},status,{q.time_col}{err_col}",
                        where=[("status", "in", list(q.states))], order=f"{q.time_col}.asc", limit=50)
        old = []
        for r in rows:
            age = age_min(r.get(q.time_col), ctx.now)
            if age is not None and age > q.limit_min:
                old.append((r, age))
        failed = []
        if q.failed_col:
            since = (ctx.now - timedelta(hours=24)).isoformat()
            failed = ctx.rows(q.table, f"{q.id_col},status,{q.failed_col}{err_col}",
                              where=[("status", "eq", "failed"), (q.failed_col, "gt", since)],
                              order=f"{q.failed_col}.desc", limit=50)
        ev = {"waiting": len(rows), "over_limit": len(old), "failed_24h": len(failed)}
        if not old and not failed:
            return ok(f"No {q.label} has waited over {ago(q.limit_min)} ({len(rows)} open)"
                      + (" and none failed in 24 h." if q.failed_col else "."), evidence=ev)
        parts, items, since_t = [], [], None
        if old:
            r, age = old[0]
            ev["oldest"] = {"id": clean(r.get(q.id_col), 80), "status": r.get("status"), "minutes": int(age)}
            errors = [clean(x.get("error"), 120) for x, _ in old if x.get("error")]
            tail = f" Last error: {errors[0]}" if errors else ""
            parts.append(f"{len(old)} {q.label}(s) waited past {ago(q.limit_min)}; the oldest is {r.get('status')} "
                         f"for {ago(age)} (since {r.get(q.time_col)}).{tail}")
            items.append("waiting")
            since_t = parse_time(r.get(q.time_col))
        if failed:
            first = next((clean(x.get("error"), 160) for x in failed if x.get("error")), "no error recorded")
            parts.append(f"{len(failed)} {q.label}(s) failed in the last 24 h; the newest error: {first}")
            items.append("failed")
            ev["failed_error"] = first
        return warn(" ".join(parts), since=since_t, evidence=ev, items=items)

    return run


def run_issue_reports(ctx: Context) -> Result:
    rows = ctx.rows("cockpit_issue_reports", "id,status,created_at,app", where=[("status", "eq", "open")], limit=50)
    if rows:
        apps = sorted({str(r.get("app") or "?") for r in rows})
        return warn(f"{len(rows)} issue report(s) are open ({', '.join(apps)}).", evidence={"open": len(rows)})
    return ok("No issue report is open.")


CHECKS = [
    Check(id=q.id, area="queues", name=f"{q.label[0].upper() + q.label[1:]} queue", catalogue=q.catalogue,
          means=f"Every {q.label} is picked up within {ago(q.limit_min)}.", severity="low",
          reads=f"{q.table} where status in ({', '.join(q.states)}), by {q.time_col}"
                + (f"; and status failed by {q.failed_col} in 24 h" if q.failed_col else ""),
          threshold=f"Any row waiting over {ago(q.limit_min)}" + (", or any row failed in 24 h" if q.failed_col else "")
                    + ": warn.", run=queue_check(q), owner=q.owner, action=q.action)
    for q in QUEUES
] + [
    Check(id="issue-reports", area="queues", name="Open issue reports", means="Issue reports from the cockpits get an answer.",
          severity="low", reads="cockpit_issue_reports where status is open", threshold="Any open: warn (summary only).",
          run=run_issue_reports, alert=False, action="Read them on the Machine tab."),
]
