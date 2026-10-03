"""The workers' own status rows in Creative Triage (catalogue H5, W2, W9 to W14).

Age limits for the sales desk come from apps/media-buyer-cockpit/convex/salesWatch.ts. Convex's
salesWatch alerts on the desk rows, but only ONCE, when its failure streak
reaches 3 (health.ts), and never again while it keeps failing. So a desk
incident is quiet only when Convex's one message already covered it
(quiet_because="convex-sales-watch"; engine.covered says exactly when).
Rows that write only when there is work (research, status, doctor) are not
watched by age.
"""
from __future__ import annotations

import re
from datetime import timedelta
from typing import Callable

from guard import fixes
from guard.context import Context, SourceError
from guard.model import Check, Result, age_min, ago, fail, kuwait, ok, parse_time, paused, unknown, warn
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
    live-calls watchdog lands: that treats sales-desk/doctor as stale after 75 min.
    No automatic fix: running doctor each time the row went stale launched Chrome and
    read Maqsam and HighLevel about 18 times a day; the fix is a cron line or a
    watchdog exemption, which a person decides."""
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
    """The sign-in rule applies to the captions row only (the Claude sign-in). A
    Higgsfield sign-out is its own failure, and publishing switched off for every
    client (SOCIAL_PUBLISHING=off) is a decision, not a fault."""
    rows = ctx.rows("social_worker_status", "check_name,ok,detail,checked_at")
    if not rows:
        return unknown("social_worker_status has no rows, so Salma's state is unknown.")
    freshest = min((age_min(r.get("checked_at"), ctx.now) or 1e9) for r in rows)
    bad = [r for r in rows if r.get("ok") is False]
    ev = {"checks": len(rows), "freshest_min": round(freshest, 1), "failing": {r["check_name"]: clean(r.get("detail"), 160) for r in bad}}
    if freshest > 15:
        return fail(f"Salma has not reported for {ago(freshest)}; she checks in every minute.", evidence=ev)
    off = [r for r in bad if r.get("check_name") == "publishing"]
    signin = [r for r in bad if r.get("check_name") == "captions" and signed_out_text(r.get("detail"))]
    real = [r for r in bad if r not in off and r not in signin]
    if real:
        names = ", ".join(r["check_name"] for r in real)
        first = clean(real[0].get("detail"), 180)
        action = None
        higgs = next((r for r in real if r["check_name"] == "higgsfield"), None)
        if higgs is not None and signed_out_text(higgs.get("detail")):
            action = "Sign Higgsfield in again on the VPS (M4); pictures and covers wait until then."
        elif higgs is not None:
            action = "Top up the Higgsfield API wallet at open.higgsfield.ai/billing; waiting pictures go on by themselves."
        return fail(f"Salma reports {names} failing: {first}", evidence=ev, action=action,
                    items=sorted(r["check_name"] for r in real))
    if signin:
        return fail("Salma's captions are paused because the Claude sign-in on the server has lapsed.", evidence=ev,
                    caused_by="claude-signin")
    if off:
        return paused(f"Salma's automatic posting is stopped for every client on purpose: {clean(off[0].get('detail'), 160)}",
                      evidence=ev)
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


EMPTY_WINDOW = re.compile(r"\b1249\b|Charges not found")


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
        if EMPTY_WINDOW.search(str(r.get("note") or "")):
            # A window with no charges: Tap answers 1249 "Charges not found" and listPage() in
            # supabase/functions/tap-charges-sync throws on it instead of reading zero charges.
            return fail(f"Tap payments have not synced for {ago(ok_age)} because Tap answers 1249 'Charges not found' "
                        "for a window with no charges and tap-charges-sync throws on it. No payment is lost (there "
                        "were none in that window), but no new one is copied while it fails.",
                        since=parse_time(r.get("last_ok_at")), evidence=ev, items=["empty-window"],
                        action="A code fault in supabase/functions/tap-charges-sync (listPage must read 1249 as zero "
                               "charges): a candidate for guardian.py ai-fix, then a person deploys the function.")
        return fail(f"Tap payments have not synced for {ago(ok_age)}: {note}.", since=parse_time(r.get("last_ok_at")),
                    evidence=ev, items=[f"error: {clean(note, 60)}"])
    return ok(f"Tap payments synced {ago(ok_age)} ago.", evidence=ev)


def run_vault_lag(ctx: Context) -> Result:
    """W3: the vault copy (calls-vault) can read ok while the vault itself stopped
    getting new calls; the desk's own Fathom index (source null) shows what exists."""
    vault = ctx.rows("cockpit_sales_recordings", "started_at", where=[("source", "eq", "vault")],
                     order="started_at.desc", limit=1)
    fathom = ctx.rows("cockpit_sales_recordings", "started_at", where=[("source", "is", None)],
                      order="started_at.desc", limit=1)
    v = parse_time(vault[0].get("started_at")) if vault else None
    f = parse_time(fathom[0].get("started_at")) if fathom else None
    if v is None or f is None:
        return unknown("cockpit_sales_recordings has no vault or no Fathom recording to compare.")
    behind = (f - v).total_seconds() / 86400
    ev = {"vault_newest": v.isoformat(), "fathom_newest": f.isoformat(), "days_behind": round(behind, 1)}
    if behind >= 3:
        return warn(f"The Obsidian vault's newest call is {behind:.1f} days older than the newest Fathom recording, so "
                    "new calls are not reaching the vault (the desk's calls-vault job itself reads ok).", evidence=ev)
    return ok(f"The vault keeps up with Fathom ({max(behind, 0):.1f} days apart).", evidence=ev)


def run_maqsam(ctx: Context) -> Result:
    """W4: what Maqsam itself reports per day (cockpit_sales_dial_checks) against what
    was copied in."""
    since = (ctx.now - timedelta(days=8)).date().isoformat()
    rows = ctx.rows("cockpit_sales_dial_checks", "day,maqsam_calls,copied_calls,checked_at", where=[("day", "gte", since)],
                    order="day.desc", limit=500)
    if not rows:
        return unknown("cockpit_sales_dial_checks has no row for the last 8 days, so Maqsam cannot be compared.")
    days: dict[str, list[int]] = {}
    for r in rows:
        d = days.setdefault(str(r.get("day")), [0, 0])
        d[0] += int(r.get("maqsam_calls") or 0)
        d[1] += int(r.get("copied_calls") or 0)
    recent = sorted(days)[-3:]
    gaps = [f"{d} ({days[d][0] - days[d][1]} of {days[d][0]})" for d in recent if days[d][0] > days[d][1]]
    ev = {"days": {d: {"maqsam": v[0], "copied": v[1]} for d, v in sorted(days.items())}}
    if gaps:
        return fail(f"Maqsam reports calls that were not copied in: {', '.join(gaps)}.", evidence=ev, items=gaps)
    if len(days) >= 7 and all(v[0] == 0 for v in days.values()):
        last = ctx.rows("cockpit_sales_recordings", "started_at", where=[("source", "eq", "maqsam")],
                        order="started_at.desc", limit=1)
        when = f" since {kuwait(parse_time(last[0].get('started_at')))}" if last else ""
        return warn(f"Maqsam reports no calls at all for {len(days)} days{when}: either nobody dialled through Maqsam or "
                    "its read is broken.", evidence=ev,
                    action="Ask the sales team whether they still dial through Maqsam; if they do, check MAQSAM_ACCESS_KEY.")
    return ok(f"Maqsam's calls were all copied in for the last {len(recent)} days.", evidence=ev)


def run_hiring_engine(ctx: Context) -> Result:
    """W15: the hiring message engine was left disarmed on purpose; arming it starts
    messaging applicants."""
    sec = ctx.section("hiring")
    engine = (sec.get("payload") or {}).get("engine")
    if not isinstance(engine, dict) or "armed" not in engine:
        return unknown("The hiring section has no engine.armed reading.")
    if engine.get("armed"):
        return warn("The hiring message engine is armed: it now messages applicants. It was left disarmed on purpose.",
                    evidence={"armed": True}, action="If that was not a decision, disarm it on the Recruiting tab.")
    return ok("The hiring message engine is disarmed, as decided.", evidence={"armed": False})


def run_radar_scan(ctx: Context) -> Result:
    return freshness("ideation_scans", "at", 8 * 1440, "The ideation radar's weekly scan")(ctx)


CHECKS = [
    Check(
        id="desk-doctor", area="workers", name="Sales desk doctor row", catalogue="W2",
        means="The sales desk's doctor row is current once the live-calls watchdog watches it.",
        severity="low", reads="cockpit_sales_worker_status (sales-desk, doctor) and whether cockpit_sales_alerts exists",
        threshold="Older than 75 min while the live-calls watchdog exists: warn.",
        run=run_desk_doctor, owner="Hermes", quiet_because="sales-watchdog",
        action="Run desk.py doctor hourly (a cron line), or tell the watchdog to skip the doctor row.",
    ),
    Check(
        id="salma-status", area="workers", name="Salma", catalogue="W10, M3",
        means="Salma, the social producer, reports in every minute and every one of her checks is ok.",
        severity="medium", reads="social_worker_status (8 checks)",
        threshold="Newest row older than 15 min, or a check failing: fail; captions paused by the Claude sign-in: "
                  "folded into claude-signin; publishing switched off for every client: paused.", run=run_salma,
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
        action="Open the tap-charges-sync function's log in Supabase.",
    ),
    Check(
        id="desk-vault-lag", area="workers", name="Sales calls reach the vault", catalogue="W3",
        means="New sales calls reach the Obsidian vault, not only the desk's Fathom index.", severity="medium",
        reads="max(started_at) in cockpit_sales_recordings for source vault against source null (the Fathom index)",
        threshold="The vault 3 or more days behind: warn.", run=run_vault_lag, owner="the CEO",
        action="Check the vault sync on the machine that writes the Obsidian vault; the desk only copies what is there.",
    ),
    Check(
        id="desk-maqsam", area="workers", name="Maqsam calls copied in", catalogue="W4",
        means="Every call Maqsam reports is copied in, and Maqsam is still being read.", severity="medium",
        reads="cockpit_sales_dial_checks for the last 8 days (Maqsam's own count against the copied count)",
        threshold="Fewer copied than Maqsam reports on any of the last 3 days: fail; no call at all for 7 days: warn.",
        run=run_maqsam, owner="the CEO", action="Read ~/.sales-desk.log for the maqsam-calls job.",
    ),
    Check(
        id="hiring-engine", area="workers", name="Hiring message engine", catalogue="W15",
        means="The hiring message engine stays disarmed until the CEO arms it.", severity="medium",
        reads="cockpit_sections hiring, payload.engine.armed", threshold="Armed: warn.", run=run_hiring_engine,
        action="Disarm it on the Recruiting tab if arming it was not a decision.",
    ),
]

for _job, (_limit, _kind, _label) in DESK_LIMITS.items():
    CHECKS.append(Check(
        id=f"desk-{_job}", area="workers", name=f"Sales desk: {_job}", catalogue="H5, W2",
        means=f"The sales desk's {_label} job finishes a run within {ago(_limit)}.",
        severity="medium" if _kind == "copy" else "high",
        reads=f"cockpit_sales_worker_status (sales-desk, {_job})",
        threshold=f"ok false, or older than {ago(_limit)}: fail. A missing row: unknown.",
        run=desk_check(_job), quiet_because="convex-sales-watch", owner="Hermes",
        fix=fixes.catch_up(f"desk-{_job}") if _kind == "copy" else None,
        action="Read ~/.sales-desk.log on the VPS; the row's detail names the blocker.",
    ))
