"""Queues that should drain (catalogue W1, W8, W9, W11, W12, W14, M4, M6, X3).

Two readings per queue: rows still waiting past their limit, and rows that
ended failed in the last 24 hours (a worker gives up after its tries, so a
queue can look empty while every item in it failed: eod-out marks a row
failed after 5 tries, about 20 minutes in, before any "waiting" limit).

The end of day outbox has its own reading (run_eod_outbox): an EOD that is
not in Slack is broken, at any hour, for as long as it stays unposted (up to
7 days), and the action names its channel and what Slack said. On 2026-10-12
the old reading warned about the media buyer's EOD at 09:00, told a person to
invite the bot to #eods-salesreps for a not_in_channel error it did not have,
and closed itself 24 hours after the row was created while the EOD was
still not posted.

The guardian never edits a queue row: each worker's own reaper owns its
rows, and a retry can spend a picture or reach a lead. It only says how long
something has waited, what failed and what a person can do.

Some tables name their state column `state`, not `status` (the Slack notices
and the creative outbox, docs/forms/STAGE1-CONTRACT.md section 7), and the
creative outbox holds more than Blueprint presses, so a queue can name its
state column and keep only some kinds. The reading still calls it `status`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Callable, Optional

from guard.context import Context, SourceError
from guard.model import Check, Result, age_min, ago, fail, kuwait, ok, parse_time, warn
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
    status_col: str = "status"         # the column that holds the state (reported as status)
    kind_col: Optional[str] = None     # set with kinds: only rows whose kind_col is one of kinds count
    kinds: tuple[str, ...] = ()
    # Set: a queued row is held on purpose, not stuck, unless the cockpit_sync_state row named here says the worker
    # takes queued rows now: (key, its detail field, the value that means it does).
    held_unless: Optional[tuple[str, str, str]] = None

    def scope(self) -> list[tuple[str, str, Any]]:
        """The kind filter, as a where clause (empty when the queue reads every row)."""
        return [(self.kind_col, "in", list(self.kinds))] if self.kind_col and self.kinds else []


# The creative outbox's Brand Blueprint presses (20261024a, 20261025o); its other kinds are not drained.
BLUEPRINT_KINDS = ("blueprintLaunch", "blueprintClose", "blueprintOffer")
# The Slack notices other than a late kickoff's "Kickoff card updated" reply, which has its own row.
NOTICE_KINDS = ("kickoff", "blueprint.close", "blueprint.updated", "blueprint.media", "blueprint.offer", "rehearsal")
REPLY_KINDS = ("kickoff.updated",)
# The writeback queue's requests and focus view presses (20261026r); the log job's kinds are its own.
REQUEST_KINDS = ("request", "task_action")


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
    Queue("queue-team-calendar", "team_calendar_ops", "meeting change bound for Google Calendar", ("pending", "failed"),
          "at", 30, "the CEO", "Set the calendar sign-in (GOOGLE_CAL_* in ~/.team-sync/env) or fix the refused series.", "W12"),
    Queue("queue-feedback", "cockpit_feedback", "cockpit change request", ("queued",), "created_at", 1440, "the CEO",
          "Open the Claude desktop app: the feedback scan runs only while it is open.", "X3"),
    # The Slack notices (20261025n): 30 minutes, not 15, because a kickoff waits up to 20 minutes for Make by design
    # (docs/forms/STAGE1-CONTRACT.md section 11, X7).
    Queue("queue-slack-notices", "cockpit_slack_notices", "Slack notice", ("queued", "sending", "unknown"), "created_at", 30,
          "the tech lead", "Run the cockpit-notices doctor; an unknown needs a person to look in Slack for its Ref "
          "(RUNBOOK, Slack notices).", "", status_col="state", failed_col="finished_at", kind_col="kind",
          kinds=NOTICE_KINDS),
    # A late kickoff's reply waits on purpose: the sender posts it only once the card's Kickoff Handoff comment is
    # there, checking every 10 minutes for up to 48 hours (20261025n's claim ends it then). It is read by when it is
    # next due, so a reply waiting its turn is fine and one the sender stopped picking up shows within 30 minutes.
    Queue("queue-slack-notice-replies", "cockpit_slack_notices", "Kickoff card updated reply", ("queued", "sending", "unknown"),
          "next_attempt_at", 30, "the tech lead", "Run the cockpit-notices doctor; a reply waiting past its turn means the "
          "sender is not running (RUNBOOK, Slack notices).", "", status_col="state", failed_col="finished_at",
          kind_col="kind", kinds=REPLY_KINDS),
    # The Brand Blueprint presses and their server drain (20261025o): the drain runs every 2 minutes and fails a
    # press at 30 minutes or after 3 refusals, so one still pending after 10 minutes is stuck. A press is
    # `sending` for the seconds its run takes; one still sending after 10 minutes lost its run part way (a
    # worker stopped by the wall clock or a deploy), and nothing moves it on or posts its notice.
    Queue("queue-creative-blueprint", "cockpit_creative_outbox", "Brand Blueprint press", ("pending", "sending"), "created_at", 10,
          "the tech lead", "Read the press's error on the Blueprint card; the drain runs every 2 minutes. A press stuck "
          "sending: check the card against its journal, then settle it by hand (RUNBOOK, Brand Blueprint press drain).", "",
          status_col="state", kind_col="kind", kinds=BLUEPRINT_KINDS, failed_col="settled_at"),
    # A press in reconcile reached ClickUp but its read-back did not match: nothing retries it, so any one is a look.
    Queue("queue-creative-reconcile", "cockpit_creative_outbox", "Brand Blueprint press needing a look", ("reconcile",),
          "created_at", 0, "the tech lead", "Check the card in ClickUp against the press, then settle the row by hand "
          "(RUNBOOK, Brand Blueprint press drain).", "", status_col="state", kind_col="kind", kinds=BLUEPRINT_KINDS),
    # Requests and focus view presses on the ClickUp writeback queue (20261026r, 20261026t): clickup-writeback job
    # requests claims them every minute, and a delivered request's 2-minute check waits 2 minutes on purpose, so one
    # still waiting after 15 minutes is stuck. The log job's own kinds are not read here. Until requests are open
    # (the writer reports mode apply), a request filed by an editor, an admin or the CEO is held queued on purpose
    # (CONTRACT 2.8) and goes on its own once they open, so a queued row counts only in mode apply.
    Queue("queue-clickup-requests", "cockpit_clickup_writeback_queue", "request or task change bound for ClickUp",
          ("queued", "sending", "retry", "unknown"), "created_at", 15, "the tech lead",
          "Run the requests doctor (clickup-writeback job requests_doctor); an unknown needs a person to look in ClickUp "
          "for its Cockpit ref (RUNBOOK, Requests writer).", "", status_col="state", kind_col="kind", kinds=REQUEST_KINDS,
          failed_col="updated_at", held_unless=("clickup-writeback:requests", "mode", "apply")),
)


WITH_ERROR = ("eod_outbox", "team_calendar_ops", "cockpit_post_jobs", "editor_requests", "ideation_requests", "social_jobs",
              "cockpit_sales_requests", "cockpit_slack_notices", "cockpit_creative_outbox", "cockpit_clickup_writeback_queue")


def _as_status(r: dict[str, Any], col: str) -> dict[str, Any]:
    """A row read by its own state column, reported as status."""
    return r if col == "status" else {**{k: v for k, v in r.items() if k != col}, "status": r.get(col)}


def queue_check(q: Queue) -> Callable[[Context], Result]:
    def run(ctx: Context) -> Result:
        err_col = ",error" if q.table in WITH_ERROR else ""
        st = q.status_col
        rows = ctx.rows(q.table, f"{q.id_col},{st},{q.time_col}{err_col}",
                        where=[(st, "in", list(q.states))] + q.scope(), order=f"{q.time_col}.asc", limit=50)
        rows = [_as_status(r, st) for r in rows]
        held = 0
        if q.held_unless and any(r.get("status") == "queued" for r in rows):
            key, field, value = q.held_unless
            state = ctx.rows("cockpit_sync_state", "key,detail", where=[("key", "eq", key)], limit=1)
            detail = state[0].get("detail") if state else None
            if not (isinstance(detail, dict) and detail.get(field) == value):
                held = sum(1 for r in rows if r.get("status") == "queued")
                rows = [r for r in rows if r.get("status") != "queued"]
        old = []
        for r in rows:
            age = age_min(r.get(q.time_col), ctx.now)
            if age is not None and age > q.limit_min:
                old.append((r, age))
        failed = []
        if q.failed_col:
            since = (ctx.now - timedelta(hours=24)).isoformat()
            failed = ctx.rows(q.table, f"{q.id_col},{st},{q.failed_col}{err_col}",
                              where=[(st, "eq", "failed"), (q.failed_col, "gt", since)] + q.scope(),
                              order=f"{q.failed_col}.desc", limit=50)
            failed = [_as_status(r, st) for r in failed]
        ev = {"waiting": len(rows), "over_limit": len(old), "failed_24h": len(failed)}
        if q.held_unless:
            ev["held"] = held
        held_note = f" {held} held until requests open." if held else ""
        if not old and not failed:
            if not q.limit_min:
                return ok(f"No {q.label} is open" + (" and none failed in 24 h." if q.failed_col else ".") + held_note,
                          evidence=ev)
            return ok(f"No {q.label} has waited over {ago(q.limit_min)} ({len(rows)} open)"
                      + (" and none failed in 24 h." if q.failed_col else ".") + held_note, evidence=ev)
        parts, items, since_t = [], [], None
        if old:
            r, age = old[0]
            ev["oldest"] = {"id": clean(r.get(q.id_col), 80), "status": r.get("status"), "minutes": int(age)}
            errors = [clean(x.get("error"), 120) for x, _ in old if x.get("error")]
            tail = f" Last error: {errors[0]}" if errors else ""
            waited = "are open" if not q.limit_min else f"waited past {ago(q.limit_min)}"
            parts.append(f"{len(old)} {q.label}(s) {waited}; the oldest is {r.get('status')} "
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


# ---- the end of day outbox (W8) ----------------------------------------------

EOD_WAIT_MIN = 15          # the worker runs every 5 minutes
EOD_LOOKBACK_DAYS = 7      # an unposted EOD older than this is history, not an incident
EOD_RETRY_HOURS = 48       # 20261015190100: mahara-eod-retry queues a fixable refusal hourly for 48 hours
EOD_RETRY_JOB = "mahara-eod-retry"
# The bot eod-out posted as when it worked (2026-10-14 12:36 onwards): a member of every EOD channel.
EOD_BOT = "mahara-club-bot (U0C0MJZNS2Y)"
EOD_CHANNELS = {"C0AQ2LD0PL1": "#media-eods", "C0AF5PJEAUX": "#eods-salesreps", "C09RQS2TFST": "#eods-csms"}
EOD_ROLES = {"media_buyer": "media buyer", "csm": "CSM", "creative": "creative director",
             "sales_setter": "setter", "sales_closer": "closer", "csm-win": "client success win"}
_EOD_CHANNEL_ERR = re.compile(r"channel_not_found|not_in_channel|is_archived|restricted_action|missing_scope|no_permission")
_EOD_AUTH_ERR = re.compile(r"invalid_auth|not_authed|token_revoked|token_expired|account_inactive|SLACK_BOT_TOKEN is not set")
_EOD_RATE_ERR = re.compile(r"ratelimited|rate_limited|HTTP( Error)? 429")
# The same list as public.cockpit_eod_retryable (20261015190100).
_EOD_RETRYABLE = re.compile(_EOD_CHANNEL_ERR.pattern + "|" + _EOD_AUTH_ERR.pattern + "|" + _EOD_RATE_ERR.pattern, re.I)
# Never a name column: who filed it is told by role and day only.
EOD_COLUMNS = ("id,role,day,status,channel,tab,error,sheet_error,slack_ts,sheet_at,sheet_started_at,"
               "reconciliation_needed,reconcile_reason,created_at")
# A person's own report: while it is missing from Slack, EOD Radar counts them MISSED.
EOD_PERSON_ROLES = ("media_buyer", "csm", "creative", "sales_setter", "sales_closer", "editor")


def _eod_unposted(r: dict[str, Any], now) -> bool:
    """Not delivered and not simply waiting its turn: failed, cut off, or refused and still being tried
    past the first 15 minutes (a first refusal the worker's next run clears is not an incident)."""
    if r.get("status") == "failed" or r.get("reconciliation_needed"):
        return True
    return bool(r.get("error")) and (age_min(r.get("created_at"), now) or 0) > EOD_WAIT_MIN


def eod_action(r: dict[str, Any], retry_job: Optional[bool] = True) -> str:
    """What a person does for this row, from its own channel and Slack's answer."""
    err = str(r.get("error") or "")
    chan = EOD_CHANNELS.get(str(r.get("channel") or ""), str(r.get("channel") or "its channel"))
    rid = r.get("id")
    requeue = f"select public.cockpit_requeue_eod_outbox({rid}); as the service role"
    tab = f"'{r.get('tab')}' tab" if r.get("tab") else "EOD sheet tab"
    if r.get("reconciliation_needed") or (r.get("slack_ts") and not r.get("sheet_at") and r.get("sheet_started_at")):
        where = f"the {tab}" if r.get("slack_ts") else chan
        return (f"A send was cut off: look in {where} for it first, then follow the reconciliation steps in "
                "hermes/eod-out/RUNBOOK.md. Never send it again without looking.")
    if r.get("slack_ts") and not r.get("sheet_at"):
        # 20261015190100: the requeue takes a row Slack has; both workers skip Slack when slack_ts is set.
        return (f"Slack has it; the EOD sheet did not take the row. Look for it in the {tab} first: eod-out cannot "
                "tell a timed-out append from a refused one. If it is missing, check that the sheet is shared with "
                f"the Google account eod-out files through, then run {requeue} (only the sheet row goes again).")
    if _EOD_CHANNEL_ERR.search(err):
        what = (f"Invite {EOD_BOT} to {chan}, or point eod-out's SLACK_BOT_TOKEN at that bot (Slack answers "
                "channel_not_found to a bot that is not in a private channel)")
    elif _EOD_AUTH_ERR.search(err):
        what = f"Set eod-out's SLACK_BOT_TOKEN on the VPS to the token of {EOD_BOT}; Slack refused the one it has"
    elif _EOD_RATE_ERR.search(err):
        return "Slack asked eod-out to slow down; the hourly retry posts it. Nothing to do unless it is still here in 2 hours."
    else:
        return f"Read ~/.eodout.log on the VPS for row {rid}; once the cause is fixed, run {requeue}."
    if retry_job is False:
        return f"{what}. The hourly retry ({EOD_RETRY_JOB}) is not scheduled: apply 20261015190100, or run {requeue}."
    return f"{what}. The hourly retry posts it within the hour after that, or run {requeue}."


def run_eod_outbox(ctx: Context) -> Result:
    since = (ctx.now - timedelta(days=EOD_LOOKBACK_DAYS)).isoformat()
    rows = ctx.rows("eod_outbox", EOD_COLUMNS, where=[("status", "in", ["queued", "processing", "failed"]),
                                                      ("created_at", "gt", since)],
                    order="created_at.asc", limit=100)
    bad = [r for r in rows if _eod_unposted(r, ctx.now)]
    waiting = [r for r in rows if not _eod_unposted(r, ctx.now)
               and (age_min(r.get("created_at"), ctx.now) or 0) > EOD_WAIT_MIN]
    ev: dict[str, Any] = {"open": len(rows), "not_posted": len(bad), "waiting_over_limit": len(waiting)}
    if not bad and not waiting:
        return ok(f"Every end of day post went out: none failed in {EOD_LOOKBACK_DAYS} days and none has waited over "
                  f"{ago(EOD_WAIT_MIN)} ({len(rows)} open).", evidence=ev)
    if not bad:
        r = waiting[0]
        age = age_min(r.get("created_at"), ctx.now)
        ev["oldest"] = {"id": r.get("id"), "minutes": int(age or 0)}
        return warn(f"{len(waiting)} end of day post(s) waited past {ago(EOD_WAIT_MIN)} with no answer from the worker; "
                    f"the oldest for {ago(age)}. eod-out runs every 5 minutes on the VPS.",
                    since=parse_time(r.get("created_at")), evidence=ev,
                    action="Read ~/.eodout.log on the VPS: the cron line or its env files may have stopped it.",
                    items=["waiting"])
    retry_job: Optional[bool] = None
    if any(_EOD_RETRYABLE.search(str(r.get("error") or "")) for r in bad):
        try:
            jobs = {j.get("jobname"): j for j in ctx.probe().get("cron_jobs") or []}
            retry_job = bool(jobs.get(EOD_RETRY_JOB, {}).get("active"))
        except SourceError:
            retry_job = None
    parts, items = [], []
    for r in bad[:5]:
        who = EOD_ROLES.get(str(r.get("role") or ""), str(r.get("role") or "an"))
        chan = EOD_CHANNELS.get(str(r.get("channel") or ""), str(r.get("channel") or "its channel"))
        where = "the EOD sheet" if r.get("slack_ts") else chan
        why = clean(r.get("error") or r.get("sheet_error") or r.get("reconcile_reason") or "no error recorded", 120)
        made = parse_time(r.get("created_at"))
        state = str(r.get("status"))
        if (state == "failed" and not r.get("reconciliation_needed") and not r.get("slack_ts")
                and _EOD_RETRYABLE.search(str(r.get("error") or "")) and made
                and ctx.now < made + timedelta(hours=EOD_RETRY_HOURS) and retry_job is not False):
            state = f"failed, tried again hourly until {kuwait(made + timedelta(hours=EOD_RETRY_HOURS))}"
        parts.append(f"the {who} EOD for {r.get('day')} is not in {where} ({why}; row {r.get('id')}, {state})")
        items.append(f"{r.get('role')} {r.get('day')} (row {r.get('id')})")
    more = f" and {len(bad) - 5} more" if len(bad) > 5 else ""
    first = bad[0]
    ev["rows"] = [{"id": r.get("id"), "role": r.get("role"), "day": r.get("day"), "status": r.get("status"),
                   "error": clean(r.get("error"), 120)} for r in bad[:10]]
    # A person's EOD missing from Slack goes at any hour: the radar marks them MISSED meanwhile.
    urgent = any(not r.get("slack_ts") and r.get("role") in EOD_PERSON_ROLES for r in bad)
    return fail(f"{len(bad)} end of day post(s) not delivered: " + "; ".join(parts) + more + ".",
                since=parse_time(first.get("created_at")), evidence=ev, action=eod_action(first, retry_job),
                urgent=urgent, items=items)


def run_issue_reports(ctx: Context) -> Result:
    rows = ctx.rows("cockpit_issue_reports", "id,status,created_at,app", where=[("status", "eq", "open")], limit=50)
    if rows:
        apps = sorted({str(r.get("app") or "?") for r in rows})
        return warn(f"{len(rows)} issue report(s) are open ({', '.join(apps)}).", evidence={"open": len(rows)})
    return ok("No issue report is open.")


def _means(q: Queue) -> str:
    if not q.limit_min:
        return f"No {q.label} is left open: a person looks at each one."
    return f"Every {q.label} is picked up within {ago(q.limit_min)}."


def _threshold(q: Queue) -> str:
    first = "Any open row" if not q.limit_min else f"Any row waiting over {ago(q.limit_min)}"
    return first + (", or any row failed in 24 h" if q.failed_col else "") + ": warn."


CHECKS = [
    Check(id=q.id, area="queues", name=f"{q.label[0].upper() + q.label[1:]} queue", catalogue=q.catalogue,
          means=_means(q), severity="low",
          reads=f"{q.table} where {q.status_col} in ({', '.join(q.states)})"
                + (f" and {q.kind_col} in ({', '.join(q.kinds)})" if q.scope() else "") + f", by {q.time_col}"
                + (f"; and {q.status_col} failed by {q.failed_col} in 24 h" if q.failed_col else "")
                + (f"; queued rows count only while cockpit_sync_state {q.held_unless[0]} has {q.held_unless[1]} "
                   f"{q.held_unless[2]}" if q.held_unless else ""),
          threshold=_threshold(q), run=queue_check(q), owner=q.owner, action=q.action)
    for q in QUEUES
] + [
    Check(id="queue-eod-outbox", area="queues", name="End of day posts", catalogue="W8",
          means="Every end of day report filed in a cockpit or a sales desk is in its Slack channel and the EOD sheet.",
          severity="medium",
          reads=f"eod_outbox rows of the last {EOD_LOOKBACK_DAYS} days that are queued, processing or failed "
                "(never the person column); the pg_cron job list when a refusal is one the hourly retry handles",
          threshold=f"An EOD failed, cut off or refused and not yet posted: fail, at any hour while Slack lacks it. "
                    f"A row waiting over {EOD_WAIT_MIN} min with no answer from the worker: warn.",
          run=run_eod_outbox, owner="the CEO",
          action=f"Invite {EOD_BOT} to the EOD channel, or point eod-out's SLACK_BOT_TOKEN at that bot."),
    Check(id="issue-reports", area="queues", name="Open issue reports", means="Issue reports from the cockpits get an answer.",
          severity="low", reads="cockpit_issue_reports where status is open", threshold="Any open: warn (summary only).",
          run=run_issue_reports, alert=False, action="Read them on the Machine tab."),
]
