"""The workers' own status rows in Creative Triage (catalogue H5, W2, W9 to W14).

Age limits for the sales desk come from apps/media-buyer-cockpit/convex/salesWatch.ts. Convex's
salesWatch already alerts on the desk rows, so those incidents are recorded
here but only posted while Convex itself is down (quiet_because="convex").
Rows that write only when there is work (research, status, doctor) are not
watched by age.
"""
from __future__ import annotations

import re
from typing import Callable

from guard import fixes
from guard.context import Context, SourceError
from guard.model import Check, Result, age_min, ago, fail, ok, parse_time, paused, unknown, warn
from guard.redact import brief_error, clean

from .claude_proxy import signed_out_text

DESK_LIMITS = {
    # job: (limit minutes, kind, label)
    "requests": (15, "ai", "proposal requests"),
    "followups": (75, "ai", "follow-up drafts"),
    "notes": (75, "ai", "call notes"),
    "reviews": (75, "ai", "call reviews"),
    "recordings": (75, "copy", "Fathom recordings index"),
    "calls-vault": (75, "copy", "Obsidian vault calls"),
    "maqsam-calls": (75, "copy", "Maqsam phone calls"),
    "digest": (26 * 60, "ai", "daily digest"),
}


def _desk_rows(ctx: Context) -> dict[str, dict]:
    rows = ctx.rows("cockpit_sales_worker_status", "worker,job,ok,detail,at", where=[("worker", "eq", "sales-desk")])
    return {r["job"]: r for r in rows}


def desk_check(job: str) -> Callable[[Context], Result]:
    limit, kind, label = DESK_LIMITS[job]

    def run(ctx: Context) -> Result:
        rows = _desk_rows(ctx)
        r = rows.get(job)
        if not r:
            return unknown(f"The sales desk has never written a status row for {job}, so it cannot be told apart from a stopped job.")
        age = age_min(r.get("at"), ctx.now)
        detail = clean(r.get("detail"), 220)
        ev = {"ok": r.get("ok"), "age_min": round(age or 0, 1), "limit_min": limit, "detail": detail}
        if r.get("ok") is False:
            caused = "claude-signin" if signed_out_text(r.get("detail")) else None
            return fail(f"The sales desk's {label} ({job}) failed its last run {ago(age)} ago: {detail}",
                        since=parse_time(r.get("at")), evidence=ev, caused_by=caused)
        if age is None or age > limit:
            return fail(f"The sales desk's {label} ({job}) has not finished a run for {ago(age)} (limit {ago(limit)}).",
                        since=parse_time(r.get("at")), evidence=ev, data={"stale": True})
        return ok(f"The sales desk's {label} ran {ago(age)} ago.", evidence=ev)

    return run


def run_desk_doctor(ctx: Context) -> Result:
    """Nothing schedules doctor, so its row is old by design. It matters once the
    live-calls watchdog lands: that treats sales-desk/doctor as stale after 75 min."""
    r = _desk_rows(ctx).get("doctor")
    try:
        watchdog = ctx.exists("cockpit_sales_alerts")
    except SourceError:
        watchdog = False
    age = age_min((r or {}).get("at"), ctx.now)
    ev = {"age_min": round(age or 0, 1), "ok": (r or {}).get("ok"), "live_calls_watchdog": watchdog}
    if not watchdog:
        return ok(f"The desk's doctor row is {ago(age)} old; nothing watches it by age until the live-calls watchdog "
                  "is deployed.", evidence=ev)
    if r is None or age is None or age > 75:
        return warn(f"The live-calls watchdog treats sales-desk/doctor as stale after 75 min and the row is {ago(age)} old.",
                    evidence=ev)
    return ok(f"The desk's doctor ran {ago(age)} ago.", evidence=ev)


def run_salma(ctx: Context) -> Result:
    rows = ctx.rows("social_worker_status", "check_name,ok,detail,checked_at")
    if not rows:
        return unknown("social_worker_status has no rows, so Salma's state is unknown.")
    freshest = min((age_min(r.get("checked_at"), ctx.now) or 1e9) for r in rows)
    bad = [r for r in rows if r.get("ok") is False]
    ev = {"checks": len(rows), "freshest_min": round(freshest, 1), "failing": {r["check_name"]: clean(r.get("detail"), 160) for r in bad}}
    if freshest > 15:
        return fail(f"Salma has not reported for {ago(freshest)}; she checks in every minute.", evidence=ev)
    real = [r for r in bad if not signed_out_text(r.get("detail"))]
    if real:
        names = ", ".join(r["check_name"] for r in real)
        first = clean(real[0].get("detail"), 180)
        action = None
        if any(r["check_name"] == "higgsfield" for r in real):
            action = "Top up the Higgsfield API wallet at open.higgsfield.ai/billing; waiting pictures go on by themselves."
        return fail(f"Salma reports {names} failing: {first}", evidence=ev, action=action)
    if bad:
        return fail("Salma's captions are paused because the Claude sign-in on the server has lapsed.", evidence=ev,
                    caused_by="claude-signin")
    return ok(f"Salma's {len(rows)} checks are ok, the newest {ago(freshest)} old.", evidence=ev)


def run_salma_publishing(ctx: Context) -> Result:
    rows = ctx.rows("social_clients", "client_task_id,publishing,publishing_since", where=[("publishing", "is", True)])
    if rows:
        return warn(f"Automatic publishing is switched on for {len(rows)} client(s); it was off for all.",
                    evidence={"clients": [r["client_task_id"] for r in rows]})
    return ok("Automatic publishing is off for every client.")


def _pulls(ctx: Context, source: str) -> list[dict]:
    return ctx.rows("cockpit_webinar_pulls", "source,ok,detail,started_at,finished_at",
                    where=[("source", "eq", source)], order="started_at.desc", limit=200)


PAUSE_WORDS = re.compile(r"(?i)\bpaused\b|approve a transcript provider")


def webinar_check(source: str, label: str, ok_within_min: int, run_within_min: int = 90) -> Callable[[Context], Result]:
    def run(ctx: Context) -> Result:
        rows = _pulls(ctx, source)
        if not rows:
            return unknown(f"No webinar pull for {source} has ever been recorded.")
        last = rows[0]
        detail = clean(last.get("detail"), 200)
        last_age = age_min(last.get("started_at"), ctx.now)
        if last_age is None or last_age > run_within_min:
            return fail(f"The webinar pull has not read {label} for {ago(last_age)} (it runs hourly at :23).",
                        evidence={"last_age_min": last_age}, data={"stale": True})
        if not last.get("ok") and PAUSE_WORDS.search(str(last.get("detail") or "")):
            return paused(f"The webinar pull's {label.replace('the ', '', 1)} step is paused on purpose: {detail}",
                          evidence={"detail": detail})
        good = [r for r in rows if r.get("ok")]
        good_age = age_min(good[0].get("started_at"), ctx.now) if good else None
        ev = {"last_ok": last.get("ok"), "last_age_min": round(last_age, 1), "last_good_age_min": good_age,
              "failed_in_last": sum(1 for r in rows if not r.get("ok")), "of": len(rows), "detail": detail}
        if good_age is None or good_age > ok_within_min:
            since = parse_time(good[0].get("started_at")) if good else None
            span = ago(good_age) if good_age is not None else f"the last {len(rows)} runs"
            return fail(f"The webinar pull has not read {label} for {span}: {detail}", since=since, evidence=ev)
        return ok(f"The webinar pull read {label} {ago(good_age)} ago.", evidence=ev)

    return run


def freshness(table: str, column: str, limit_min: int, label: str, where=()) -> Callable[[Context], Result]:
    def run(ctx: Context) -> Result:
        rows = ctx.rows(table, column, where=list(where), order=f"{column}.desc", limit=1)
        if not rows or rows[0].get(column) is None:
            return unknown(f"{table} has no {column}, so {label} cannot be dated.")
        age = age_min(rows[0][column], ctx.now)
        ev = {"newest": rows[0][column], "age_min": round(age or 0, 1), "limit_min": limit_min}
        if age is None or age > limit_min:
            return fail(f"{label} was last written {ago(age)} ago (limit {ago(limit_min)}).",
                        since=parse_time(rows[0][column]), evidence=ev, data={"stale": True})
        return ok(f"{label} was last written {ago(age)} ago.", evidence=ev)

    return run


def run_tap(ctx: Context) -> Result:
    rows = ctx.rows("cockpit_sync_state", "key,ok,note,last_run_at,last_ok_at", where=[("key", "eq", "tap-charges-sync")])
    if not rows:
        return unknown("cockpit_sync_state has no tap-charges-sync row.")
    r = rows[0]
    ok_age = age_min(r.get("last_ok_at"), ctx.now)
    run_age = age_min(r.get("last_run_at"), ctx.now)
    note = brief_error(r.get("note"), 200)
    ev = {"ok": r.get("ok"), "last_ok_age_min": ok_age, "last_run_age_min": run_age, "note": note}
    if r.get("ok") is False or ok_age is None or ok_age > 60:
        hint = ""
        if "not found" in note.lower():
            hint = " This may be an empty window counted as an error; the function needs checking."
        return fail(f"Tap payments have not synced for {ago(ok_age)}: {note}.{hint}",
                    since=parse_time(r.get("last_ok_at")), evidence=ev)
    return ok(f"Tap payments synced {ago(ok_age)} ago.", evidence=ev)


def run_radar_scan(ctx: Context) -> Result:
    return freshness("ideation_scans", "at", 8 * 1440, "The ideation radar's weekly scan")(ctx)


CHECKS = [
    Check(
        id="desk-doctor", area="workers", name="Sales desk doctor row", catalogue="W2",
        means="The sales desk's doctor row is current once the live-calls watchdog watches it.",
        severity="low", reads="cockpit_sales_worker_status (sales-desk, doctor) and whether cockpit_sales_alerts exists",
        threshold="Older than 75 min while the live-calls watchdog exists: warn.",
        run=run_desk_doctor, fix=fixes.SALES_DOCTOR, owner="Hermes", quiet_because="sales-watchdog",
        action="Run desk.py doctor hourly (a cron line), or tell the watchdog to skip the doctor row.",
    ),
    Check(
        id="salma-status", area="workers", name="Salma", catalogue="W10, M3",
        means="Salma, the social producer, reports in every minute and every one of her checks is ok.",
        severity="medium", reads="social_worker_status (8 checks)",
        threshold="Newest row older than 15 min, or a check failing: fail.", run=run_salma,
        owner="the CEO", action="Read ~/.salma.log on the VPS; the failing check's detail says what is needed.",
    ),
    Check(
        id="salma-publishing", area="workers", name="Salma publishing switch", catalogue="W10",
        means="Automatic posting stays off for every client, as decided.",
        severity="low", reads="social_clients.publishing", threshold="Any client switched on: warn (report only).",
        run=run_salma_publishing, alert=False, action="Nothing, if it was switched on on purpose.",
    ),
    Check(
        id="webinar-zoom", area="workers", name="Webinar pull: Zoom", catalogue="W13",
        means="The live training's Zoom sessions are read into Creative Triage.",
        severity="medium", reads="cockpit_webinar_pulls, source zoom", threshold="No ok read in 3 h, or no run in 90 min: fail.",
        run=webinar_check("zoom", "the Zoom sessions", 180), fix=fixes.catch_up("webinar-pull"),
        action="Read ~/.webinar-pull.log on the VPS; check the Zoom app keys or the Composio Zoom connection.",
    ),
    Check(
        id="webinar-survey", area="workers", name="Webinar pull: survey", catalogue="W13",
        means="The webinar gift survey (Typeform) is read every hour.",
        severity="medium", reads="cockpit_webinar_pulls, source typeform", threshold="No ok read in 24 h: fail.",
        run=webinar_check("typeform", "the gift survey", 24 * 60),
        action="Reconnect Typeform in Composio, or check COMPOSIO_API_KEY.",
    ),
    Check(
        id="webinar-reminders", area="workers", name="Webinar pull: reminders", catalogue="W13",
        means="The reminders HighLevel sent registrants are read.",
        severity="low", reads="cockpit_webinar_pulls, source reminders", threshold="No ok read in 14 h, or no run in 7 h: fail.",
        run=webinar_check("reminders", "the reminders", 14 * 60, 7 * 60),
        action="Check GHL_B2B_API_KEY (401) or the browser user agent (Cloudflare 1010).",
    ),
    Check(
        id="webinar-objections", area="workers", name="Webinar pull: objections", catalogue="W13",
        means="Sales call objections are tagged, unless paused by policy.",
        severity="low", reads="cockpit_webinar_pulls, source objections", threshold="Paused on purpose is a decision, not a failure; otherwise no ok read in 24 h: fail.",
        run=webinar_check("objections", "the objections", 24 * 60),
        action="Approve a transcript provider (the CEO's decision), then the pull goes on.",
    ),
    Check(
        id="editor-sync", area="workers", name="Editor desk sync", catalogue="W11",
        means="The editor board is copied in every 30 minutes.",
        severity="medium", reads="max(editor_jobs.synced_at)", threshold="Older than 90 min: fail.",
        run=freshness("editor_jobs", "synced_at", 90, "The editor board copy"), fix=fixes.catch_up("editor-sync"),
        owner="the CEO", action="Read ~/.editor-desk/out/cron.log; a revoked Google token or a ClickUp 401 is the usual cause.",
    ),
    Check(
        id="team-recordings", area="workers", name="Team meeting recordings", catalogue="W11",
        means="Team meeting recordings are copied in hourly.",
        severity="low", reads="max(team_recordings.synced_at)", threshold="Older than 3 h: fail.",
        run=freshness("team_recordings", "synced_at", 180, "The team recordings copy"),
        action="Read ~/.editor-desk/out/cron.log for the meetings job.",
    ),
    Check(
        id="radar-scan", area="workers", name="Ideation radar weekly scan", catalogue="W14",
        means="The outlier scan runs every Saturday.", severity="low", reads="max(ideation_scans.at)",
        threshold="Older than 8 days: fail.", run=run_radar_scan, owner="the CEO",
        action="Read ~/.ideation-radar/out/cron.log; Apify or ScrapeCreators credit is the usual cause.",
    ),
    Check(
        id="tap-charges", area="workers", name="Tap payments sync",
        means="Tap card charges are copied in every 15 minutes.",
        severity="medium", reads="cockpit_sync_state key tap-charges-sync", threshold="ok false, or no ok run in 1 h: fail.",
        run=run_tap, owner="Hermes",
        action="Open the tap-charges-sync function's log in Supabase; 'Charges not found' may be an empty window counted as an error.",
    ),
]

for _job, (_limit, _kind, _label) in DESK_LIMITS.items():
    CHECKS.append(Check(
        id=f"desk-{_job}", area="workers", name=f"Sales desk: {_job}", catalogue="H5, W2",
        means=f"The sales desk's {_label} job finishes a run within {ago(_limit)}.",
        severity="medium" if _kind == "copy" else "high",
        reads=f"cockpit_sales_worker_status (sales-desk, {_job})",
        threshold=f"ok false, or older than {ago(_limit)}: fail. A missing row: unknown.",
        run=desk_check(_job), quiet_because="convex", owner="Hermes",
        fix=fixes.catch_up(f"desk-{_job}") if _kind == "copy" else None,
        action="Read ~/.sales-desk.log on the VPS; the row's detail names the blocker.",
    ))
