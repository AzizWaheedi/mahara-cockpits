"""Live calls (rooms worker, sales-live, call.maharamedia.com), coming soon.

Rule: while a piece is missing every check answers "not deployed yet",
never an error. A check becomes real only once its piece exists: the tables
gate the rows, the cron jobs and the settings; the function, the DNS name
and the VPS worker each gate themselves.

"Not deployed yet" stops being an excuse in two cases:
- the piece was seen working before (state["seen_deployed"], or DEPLOYED below
  for the pieces deployed by 2026-10-07): gone now is a failure (a deleted
  function, a lost DNS record);
- live calls are switched on: then a missing piece breaks a lead's call, so it
  fails, folded into live-settings, which fails urgent.

live-code reads which source modules sales-api and sales-live were deployed
with, once per deploy: a deploy from a branch without live calls keeps its
name and gets a higher version, and only its modules tell.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Callable, Optional

from guard import http
from guard.alerts import in_hours
from guard.config import SUPABASE_URL
from guard.context import Context, SourceError, parent_of
from guard.model import (FAIL, NOT_DEPLOYED, OK, Check, Result, age_min, ago, fail, kuwait, not_deployed, ok, parse_time,
                         paused, unknown, warn)
from guard.redact import clean

ROOM_TABLES = ("cockpit_sales_rooms", "cockpit_sales_room_events", "cockpit_sales_room_hosts",
               "cockpit_sales_room_secrets", "cockpit_sales_live", "cockpit_sales_alerts", "cockpit_sales_availability")
FOLLOWUP_TABLES = ("cockpit_sales_followup_waves", "cockpit_sales_followup_wave_members", "cockpit_sales_followup_levels",
                   "cockpit_sales_followup_meta", "cockpit_sales_followup_stops")
CRON_JOBS = ("mahara-sales-rooms-sweep", "mahara-sales-watchdog")
STATUS_ROWS = {
    "sales-desk": ("rooms", "room-hosts", "slack", "waves", "model"),
    "sales-live": ("zoom", "slack", "open", "go", "cron"),
}
# Parts not built yet in Milestone 1 (the reply watcher of a later project):
# watched only once their row exists, as the SQL watchdog does (switch_on
# null), so a part nothing writes is never "not reported yet" (m1 round 2,
# guardian-waits-for-unbuilt-reply-watcher). A row that says it fails still
# counts.
LATER_ROWS = {
    "sales-desk": ("watch",),
}
# How old each status row may be before its part has stopped, in minutes:
# the SQL watchdog's stale_min (20261004a cockpit_sales_watchdog, part 1).
# The room worker's own row is run_worker's; the door's rows (sales-live) are
# failure-only, written only when traffic comes, so they have no age limit
# (m1 round 4, guardian-stale-host-check-reads-ok).
STALE_MIN = {
    ("sales-desk", "room-hosts"): 20,
    ("sales-desk", "slack"): 10,
    ("sales-desk", "waves"): 15,
    ("sales-desk", "model"): 75,
    ("sales-desk", "watch"): 10,
}
CALL_HOST = "call.maharamedia.com"
ROOMS_RED_S = 90
ROOMS_ALERT_MIN = 10
WATCHDOG_LATE_MIN = 15
UNPOSTED_MIN = 15
PIECES = ("live-function", "live-dns", "live-rooms-worker", "live-status-rows")
URGENT_WHEN_ON = ("live-function", "live-rooms-worker")
# The pieces seen working in production, as state["seen_deployed"] on the VPS
# held them on 2026-10-07. Kept in the code too: a guardian whose state was lost
# (~/.cockpit-guardian removed, a reinstall) or that reads a new Supabase project
# says a missing piece is gone, never "not deployed yet".
DEPLOYED = {
    "live-tables": "2026-10-03T19:10:02+00:00",
    "live-cron": "2026-10-03T19:10:02+00:00",
    "live-alerts": "2026-10-04T15:45:02+00:00",
    "live-function": "2026-10-07T10:00:01+00:00",
    "live-rooms-worker": "2026-10-07T10:20:02+00:00",
}
# The live-calls modules in each deployed function (sales-api v65 and sales-live
# v2, 2026-10-07); a deploy from codex/supabase-completion-20261004 has none of them.
LIVE_MODULES = {
    "sales-api": ("rooms.ts", "roomlogic.ts", "liveio.ts", "followupAgent.ts", "sendrules.ts"),
    "sales-live": ("cron.ts", "door.ts", "handler.ts", "sign.ts", "slack.ts", "zoom.ts"),
}


def _switches(ctx: Context) -> Optional[dict[str, dict]]:
    """The rooms and live settings as stored, or None when they cannot be read."""
    try:
        rows = ctx.rows("cockpit_sales_settings", "key,value", where=[("key", "in", ["rooms", "live"])])
    except SourceError:
        return None
    return {r["key"]: r["value"] for r in rows if isinstance(r.get("value"), dict)}


def switched_on(ctx: Context) -> Optional[list[str]]:
    """Which live switches are on ([] when all off), or None when they cannot be read."""
    sw = _switches(ctx)
    if sw is None:
        return None
    return sorted(k for k, v in sw.items() if v.get("enabled"))


def short_link_on(sw: Optional[dict[str, dict]]) -> bool:
    """The messages carry call.maharamedia.com only with rooms on and rooms.short_link on (m1 round 1)."""
    rooms = (sw or {}).get("rooms") or {}
    return rooms.get("enabled") is True and rooms.get("short_link") is True


def slack_on(sw: Optional[dict[str, dict]]) -> bool:
    """Slack presses and posts run only with live.enabled and live.slack both on."""
    live = (sw or {}).get("live") or {}
    return live.get("enabled") is True and live.get("slack") is True


def agent_on(ctx: Context) -> bool:
    """Whether the follow-up agent's own work runs (followups.agent true):
    its waves and the drafting model are live-calls parts only then (m1
    round 6, m1-numbers-r6-guardian-live-status-rows-fail-on-model-and-waves;
    the desk's own checks and the SQL watchdog watch them otherwise). A
    setting that cannot be read counts as on, so nothing goes unwatched."""
    try:
        rows = ctx.rows("cockpit_sales_settings", "key,value", where=[("key", "in", ["followups"])])
    except SourceError:
        return True
    value = next((r.get("value") for r in rows if r.get("key") == "followups"), None)
    return isinstance(value, dict) and value.get("agent") is True


def needed(check_id: str, sw: Optional[dict[str, dict]]) -> bool:
    """Whether a lead's call needs this piece with the switches as they are:
    the call site only while the short link is on (m1 round 1,
    guardian-urgent-dns-fail-with-short-link-off: with it off the messages
    carry the room's own Meet or Zoom link, and nothing lands on the site)."""
    if check_id == "live-dns":
        return short_link_on(sw)
    return True


def deployable(check_id: str, label: str, run: Callable[[Context], Result]) -> Callable[[Context], Result]:
    def wrapped(ctx: Context) -> Result:
        res = run(ctx)
        seen = ctx.state.setdefault("seen_deployed", {})
        if res.status == OK:
            seen.setdefault(check_id, ctx.now.isoformat())
            return res
        first = seen.get(check_id) or DEPLOYED.get(check_id)
        on = switched_on(ctx) if check_id in PIECES else None
        if on and not needed(check_id, _switches(ctx)):
            on = []
        if res.status == NOT_DEPLOYED:
            if on:
                return fail(f"{res.summary.rstrip('.')}, although live calls are switched on ({', '.join(on)}): a lead's "
                            "call has nothing to land on.", caused_by="live-settings", urgent=True,
                            data={"missing": True}, evidence=res.evidence)
            if first:
                return fail(f"{label} was deployed (first seen working {kuwait(parse_time(first))}) and is "
                            f"missing now: {res.summary}", data={"missing": True}, evidence=res.evidence,
                            urgent=bool(on))
            return res
        if res.status == FAIL and on and check_id in URGENT_WHEN_ON:
            res.urgent = True
        return res

    return wrapped


def _tables(ctx: Context, names: tuple[str, ...]) -> dict[str, bool]:
    return {t: ctx.exists(t) for t in names}


def rooms_deployed(ctx: Context) -> bool:
    return ctx.exists("cockpit_sales_rooms")


def run_tables(ctx: Context) -> Result:
    have = _tables(ctx, ROOM_TABLES + FOLLOWUP_TABLES)
    present = [t for t, e in have.items() if e]
    if not present:
        return not_deployed(f"Live calls are not deployed yet: none of the {len(have)} tables exist.")
    rooms_missing = [t for t in ROOM_TABLES if not have[t]]
    follow_missing = [t for t in FOLLOWUP_TABLES if not have[t]]
    if rooms_missing and len(rooms_missing) < len(ROOM_TABLES):
        return fail(f"The rooms migration is half applied: {', '.join(rooms_missing)} missing.",
                    evidence={"missing": rooms_missing})
    if follow_missing and len(follow_missing) < len(FOLLOWUP_TABLES):
        return fail(f"The follow-up agent migration is half applied: {', '.join(follow_missing)} missing.",
                    evidence={"missing": follow_missing})
    if rooms_missing or follow_missing:
        part = "rooms" if rooms_missing else "follow-up agent"
        return not_deployed(f"The live-calls {part} tables are not deployed yet; the rest are.",
                            evidence={"present": present})
    return ok(f"All {len(have)} live-calls tables exist.")


def run_function(ctx: Context) -> Result:
    try:
        listed = ctx.functions()
        fn = next((f for f in listed if f.get("slug") == "sales-live"), None)
        if fn is None:
            return not_deployed("sales-live is not deployed yet (not in the functions list).")
        if fn.get("status") != "ACTIVE" or fn.get("verify_jwt"):
            return fail(f"sales-live is {fn.get('status')} with verify_jwt {fn.get('verify_jwt')}; it must be ACTIVE with "
                        "verify_jwt false.", evidence={"status": fn.get("status"), "verify_jwt": fn.get("verify_jwt")})
    except SourceError as e:
        if not getattr(e, "gap", False):
            raise
    try:
        r = ctx.get(f"{SUPABASE_URL}/functions/v1/sales-live/health", timeout=15)
    except http.HttpError as e:
        return unknown(f"sales-live/health could not be reached ({e}).", caused_by="supabase-health")
    if r.status == 404 and "not found" in r.text(400).lower():
        return not_deployed("sales-live is not deployed yet (its /health answers 'Requested function was not found').")
    if r.status == 200:
        return ok("sales-live answers its health check.")
    return fail(f"sales-live/health answers {r.status}.", evidence={"status": r.status})


def known_deployed(ctx: Context, check_id: str) -> bool:
    return check_id in (ctx.state.get("seen_deployed") or {}) or check_id in DEPLOYED


def run_code(ctx: Context) -> Result:
    """Each function's modules are read once per deploy (a new version or bundle hash) and kept in the state."""
    try:
        listed = ctx.functions()
    except SourceError as e:
        if not getattr(e, "gap", False):
            raise
        if not known_deployed(ctx, "live-function"):
            return not_deployed("The live-calls code is not deployed yet (sales-live has never been seen working).")
        return unknown("Which code sales-api and sales-live run needs SUPABASE_ACCESS_TOKEN.", coverage_gap=True)
    if not any(x.get("slug") == "sales-live" for x in listed) and not known_deployed(ctx, "live-function"):
        return not_deployed("The live-calls code is not deployed yet (sales-live is not in the functions list).")
    known = ctx.state.setdefault("live_code", {})
    problems, seen = [], []
    for slug, need in LIVE_MODULES.items():
        f = next((x for x in listed if x.get("slug") == slug), None)
        if f is None:
            problems.append(f"{slug} is not deployed")
            continue
        key = f"v{f.get('version')}:{f.get('ezbr_sha256') or ''}"
        rec = known.get(slug)
        if not isinstance(rec, dict) or rec.get("key") != key:
            names = ctx.function_files(slug)
            rec = {"key": key, "missing": [m for m in need if m not in names], "modules": len(names),
                   "read_at": ctx.now.isoformat()}
            known[slug] = rec
        if rec["missing"]:
            problems.append(f"{slug} {key.split(':')[0]} was deployed without {', '.join(rec['missing'])}")
        else:
            seen.append(f"{slug} {key.split(':')[0]}")
    ev = {k: {"key": v.get("key"), "missing": v.get("missing")} for k, v in known.items() if isinstance(v, dict)}
    if problems:
        return fail("The live-calls code is not what runs: " + "; ".join(problems) + " (deployed from a branch "
                    "without live calls?).", evidence=ev, items=sorted(LIVE_MODULES), urgent=True)
    return ok(f"sales-api and sales-live run the live-calls code ({', '.join(seen)}).", evidence=ev)


def run_cron(ctx: Context) -> Result:
    if not rooms_deployed(ctx):
        return not_deployed("The live-calls database jobs are not deployed yet (their tables do not exist).")
    try:
        p = ctx.probe()
    except SourceError as e:
        return unknown(f"The live-calls tables exist but pg_cron cannot be read: {e}", caused_by=parent_of(e))
    jobs = {j["jobname"]: j for j in p.get("cron_jobs") or []}
    missing = [n for n in CRON_JOBS if n not in jobs]
    off = [n for n in CRON_JOBS if n in jobs and not jobs[n].get("active")]
    if missing or off:
        return fail(f"The rooms tables exist but the database jobs are not running: {', '.join(missing + off)}.",
                    evidence={"missing": missing, "inactive": off})
    return ok("The rooms sweep and the sales watchdog are scheduled.")


def run_dns(ctx: Context) -> Result:
    if not ctx.resolves(CALL_HOST):
        return not_deployed(f"{CALL_HOST} is not deployed yet, waiting on the DNS step.")
    try:
        r = ctx.get(f"https://{CALL_HOST}/", timeout=15)
    except http.HttpError as e:
        return fail(f"{CALL_HOST} resolves but does not answer ({e}).")
    if r.status in (200, 301, 302, 307, 308):
        return ok(f"{CALL_HOST} answers {r.status}.")
    return fail(f"{CALL_HOST} answers {r.status}.", evidence={"status": r.status})


def run_worker(ctx: Context) -> Result:
    rooms = ctx.snap_part("rooms")
    procs = (ctx.snap_part("procs") or {}).get("jobs") or []
    running = [p for p in procs if p.get("job") == "rooms-worker"]
    unit = str(rooms.get("unit") or "")
    if not rooms.get("file") and not running and unit != "active":
        return not_deployed("The rooms worker is not deployed yet on the VPS (no desk/rooms.py, no sales-desk-rooms unit).")
    try:
        rows = ctx.rows("cockpit_sales_worker_status", "worker,job,ok,detail,at",
                        where=[("worker", "eq", "sales-desk"), ("job", "eq", "rooms")])
    except SourceError:
        rows = []
    ev = {"file": rooms.get("file"), "unit": unit, "processes": len(running)}
    if not rows:
        if rooms_deployed(ctx):
            return fail("The rooms worker is on the VPS but has never written its status row.", evidence=ev)
        return not_deployed("The rooms worker's code is on the VPS but the rooms tables are not deployed yet.", evidence=ev)
    age = age_min(rows[0].get("at"), ctx.now)
    ev["age_s"] = None if age is None else int(age * 60)
    # The row's age first (m1 round 4, guardian-dead-worker-read-as-reporting-
    # failure): an old row is a worker that stopped, whatever its last words
    # said; only a fresh row that says ok false reports a failure now, as the
    # SQL watchdog keeps is_failing to rows that are not stale.
    if age is None or age > ROOMS_ALERT_MIN:
        return fail(f"The rooms worker has not reported for {ago(age)}; new video rooms cannot be made.", evidence=ev)
    if rows[0].get("ok") is False:
        detail = str(rows[0].get("detail") or "")
        if detail.startswith("Not making rooms:"):
            return fail(f"The rooms worker reports a failure: {clean(detail, 160)}", evidence=ev)
        # A run that rode out a problem and kept making rooms (m1 round 4,
        # guardian-urgent-failure-for-worker-riding-out-blip): said as the
        # watchdog and the Team page say it, never an urgent failure.
        return warn(f"The rooms worker reported a problem while making rooms: {clean(detail, 160)}", evidence=ev)
    if age * 60 > ROOMS_RED_S:
        return warn(f"The rooms worker last reported {int(age * 60)} s ago (red after {ROOMS_RED_S} s).", evidence=ev)
    return ok(f"The rooms worker reported {int(age * 60)} s ago.", evidence=ev)


def run_status_rows(ctx: Context) -> Result:
    if not rooms_deployed(ctx):
        return not_deployed("The live-calls status rows are not deployed yet (sales-desk rooms, room-hosts, slack, "
                            "waves, model; sales-live zoom, slack, open, go, cron).")
    rows = ctx.rows("cockpit_sales_worker_status", "worker,job,ok,detail,at", where=[("worker", "in", list(STATUS_ROWS))])
    # LATER_ROWS' workers are all in STATUS_ROWS, so the one read covers them.
    have = {(r["worker"], r["job"]): r for r in rows}
    # Only the parts the switches use (m1 round 1): the short link's routes
    # while rooms.short_link is on, Slack's while live and live.slack are on.
    # A part switched off gets no traffic, so no row, and a stray request's
    # row is no failure of anything the pilot runs.
    sw = _switches(ctx)
    skip = set()
    if not short_link_on(sw):
        skip |= {("sales-live", "open"), ("sales-live", "go")}
    if not slack_on(sw):
        skip |= {("sales-live", "slack"), ("sales-desk", "slack")}
    if not agent_on(ctx):
        skip |= {("sales-desk", "waves"), ("sales-desk", "model")}
    watched = {w: tuple(j for j in jobs if (w, j) not in skip) for w, jobs in STATUS_ROWS.items()}
    missing = [f"{w}/{j}" for w, jobs in watched.items() for j in jobs if (w, j) not in have]
    bad = [f"{w}/{j} ({clean(have[(w, j)].get('detail'), 80)})" for w, jobs in watched.items() for j in jobs
           if (w, j) in have and have[(w, j)].get("ok") is False]
    bad += [f"{w}/{j} ({clean(have[(w, j)].get('detail'), 80)})" for w, jobs in LATER_ROWS.items() for j in jobs
            if (w, j) in have and have[(w, j)].get("ok") is False]
    # A row older than its part's limit is a part that stopped (m1 round 4):
    # the room host check's row three hours old is no "reports ok".
    stale = []
    for (w, j), limit in STALE_MIN.items():
        if (w, j) not in have or (j not in watched.get(w, ()) and j not in LATER_ROWS.get(w, ())):
            continue
        age = age_min(have[(w, j)].get("at"), ctx.now)
        if age is None or age > limit:
            stale.append(f"{w}/{j} has not reported for {ago(age)} (limit {limit} min)")
    if bad or stale:
        parts = ([f"Live-calls parts report failures: {', '.join(bad)}."] if bad else []) + \
                ([f"Live-calls parts have stopped reporting: {'; '.join(stale)}."] if stale else [])
        return fail(" ".join(parts), evidence={"failing": bad, "stale": stale, "missing": missing})
    if len(missing) == sum(len(v) for v in watched.values()):
        return not_deployed("The live-calls tables exist but no part has reported yet (not deployed yet).")
    if missing:
        return warn(f"Live-calls parts that have not reported yet: {', '.join(missing)}.", evidence={"missing": missing})
    return ok("Every live-calls part reports ok.")


def run_settings(ctx: Context) -> Result:
    rows = ctx.rows("cockpit_sales_settings", "key,value", where=[("key", "in", ["rooms", "live"])])
    have = {r["key"]: r.get("value") or {} for r in rows}
    if not have:
        return not_deployed("The rooms and live settings are not deployed yet.")
    on = [k for k, v in have.items() if isinstance(v, dict) and v.get("enabled")]
    if not on:
        return paused(f"Live calls are built and switched off ({', '.join(sorted(have))} enabled false).")
    missing = [cid for cid in PIECES if needed(cid, have) and ctx.results.get(cid) is not None and
               (ctx.results[cid].status == NOT_DEPLOYED or (ctx.results[cid].data or {}).get("missing"))]
    if missing:
        return fail(f"Live calls are switched on ({', '.join(sorted(on))}) but {', '.join(missing)} are not deployed: a "
                    "lead's call would break.", urgent=True, items=missing,
                    action="Switch rooms and live off in the sales settings, or deploy the missing pieces first.")
    return ok(f"Live calls are switched on: {', '.join(sorted(on))}.")


def _not_posted(r: dict, now) -> bool:
    """An open alert that should have reached Slack: it waited 15 minutes inside working
    hours unposted (from when it was raised, or from this morning's 09:00), or its posts
    failed 3 times. Outside working hours the watchdog holds alerts on purpose."""
    if int(r.get("post_tries") or 0) >= 3 and not (200 <= int(r.get("post_status") or 0) < 300):
        return True
    if r.get("posted_at") is not None:
        return False
    raised = parse_time(r.get("raised_at"))
    if raised is None:
        return False
    late = timedelta(minutes=UNPOSTED_MIN)
    if raised + late <= now and in_hours(raised) and in_hours(raised + late):
        return True
    return raised <= now - late and in_hours(now) and in_hours(now - late)


def run_alerts(ctx: Context) -> Result:
    """The SQL watchdog covers the desk and live-calls checks only while its alerts
    reach Slack: its job is scheduled, it ran in the last 15 minutes, the vault has
    its webhook (no "Recorded only"), and nothing has waited unposted for 15
    minutes inside working hours (it holds them outside those hours by design).
    Otherwise this check posts the open alerts itself (keys and kinds only)."""
    if not ctx.exists("cockpit_sales_alerts"):
        return not_deployed("The sales watchdog's alerts table is not deployed yet.")
    rows = ctx.rows("cockpit_sales_alerts", "dedupe_key,kind,raised_at,posted_at,post_tries,post_status,post_error",
                    where=[("resolved_at", "is", None)], order="raised_at.asc", limit=50)
    problems = []
    cron = ctx.results.get("live-cron")
    if cron is None:
        try:
            cron = run_cron(ctx)
        except SourceError:
            cron = None
    if cron is None or cron.status != OK:
        problems.append("its database job is not scheduled")
    wd = ctx.rows("cockpit_sales_worker_status", "worker,job,ok,detail,at",
                  where=[("worker", "eq", "sales-api"), ("job", "eq", "watchdog")])
    age = age_min(wd[0].get("at"), ctx.now) if wd else None
    if age is None or age > WATCHDOG_LATE_MIN:
        problems.append(f"it last ran {ago(age)} ago")
    elif wd[0].get("ok") is False:
        problems.append(f"it reports a failure: {clean(wd[0].get('detail'), 120)}")
    recorded_only = [r for r in rows if str(r.get("post_error") or "").startswith("Recorded only")]
    if recorded_only:
        problems.append("the vault has no sales_alerts_slack_webhook, so its alerts are recorded and never posted")
    unposted = [r for r in rows if _not_posted(r, ctx.now)]
    posting = not problems and not unposted
    data = {"posting": posting}
    keys = [clean(r.get("dedupe_key"), 60) for r in rows]
    ev = {"open": len(rows), "problems": problems, "unposted": len(unposted)}
    stuck = unposted or recorded_only
    if stuck:
        what = ", ".join(f"{clean(r.get('dedupe_key'), 60)} ({r.get('kind')})" for r in stuck[:5])
        why = f" ({'; '.join(problems)})" if problems else ""
        return fail(f"The sales watchdog has {len(stuck)} open alert(s) that did not reach Slack{why}: {what}.",
                    data=data, evidence=ev, items=sorted(clean(r.get("dedupe_key"), 60) for r in stuck),
                    action="Add sales_alerts_slack_webhook to the vault (a person does this); until then the guardian "
                           "posts these itself. Read them in cockpit_sales_alerts.")
    if problems:
        return warn(f"The sales watchdog is not working: {'; '.join(problems)}.", data=data, evidence=ev)
    if rows:
        return warn(f"The sales watchdog has {len(rows)} open alert(s) and posts them itself: {', '.join(keys[:5])}.",
                    data=data, evidence=ev, items=sorted(keys))
    return ok("The sales watchdog has no open alert, runs on time and posts.", data=data, evidence=ev)


CHECKS = [
    Check(id="live-tables", area="live-calls", name="Live calls: tables",
          means="The rooms and follow-up agent tables exist, all or none.", severity="high",
          reads="information_schema through PostgREST (a missing table answers PGRST205)",
          threshold="None: not deployed yet; some of a migration but not all: fail.", run=deployable("live-tables", "The live-calls tables", run_tables),
          action="Apply the rest of the live-calls migration (a person applies migrations)."),
    Check(id="live-function", area="live-calls", name="Live calls: sales-live",
          means="The sales-live Edge Function is ACTIVE with verify_jwt false.", severity="high",
          reads="The functions list, or GET /functions/v1/sales-live/health", threshold="Missing: not deployed yet; anything else wrong: fail.",
          run=deployable("live-function", "sales-live", run_function), action="Redeploy sales-live with verify_jwt false."),
    Check(id="live-code", area="live-calls", name="Live calls: deployed code",
          means="sales-api and sales-live were deployed with their live-calls modules.", severity="high",
          reads="The functions list, and once per deploy the function's source module names (management API)",
          threshold="A function deployed without its live-calls modules: fail (urgent).", run=run_code,
          action="Redeploy from main at e166a0b or later: python3 scripts/dev/deploy_fn.py sales-api "
                 "supabase/functions/sales-api, and sales-live with --no-verify-jwt (a person does this)."),
    Check(id="live-cron", area="live-calls", name="Live calls: database jobs",
          means="The rooms sweep and the sales watchdog are scheduled once the tables exist.", severity="high",
          reads="cron.job through the probe", threshold="Tables missing: not deployed yet; tables there and a job missing: fail.",
          run=deployable("live-cron", "The live-calls database jobs", run_cron), action="Re-run the cron.schedule lines from the rooms migration."),
    Check(id="live-dns", area="live-calls", name="Live calls: call.maharamedia.com",
          means="The short call page answers.", severity="medium", reads="DNS for call.maharamedia.com, then GET /",
          threshold="No DNS: not deployed yet (urgent only while rooms.short_link is on); resolves but no answer: fail.", run=deployable("live-dns", "call.maharamedia.com", run_dns), confirm=2,
          action="Check the Vercel project for call.maharamedia.com."),
    Check(id="live-rooms-worker", area="live-calls", name="Live calls: rooms worker",
          means="The rooms worker on the VPS reports every few seconds.", severity="critical",
          reads="desk/rooms.py and the sales-desk-rooms unit on the VPS, and its status row's age",
          threshold=f"Not there: not deployed yet; older than {ROOMS_RED_S} s: warn; {ROOMS_ALERT_MIN} min: fail.",
          run=deployable("live-rooms-worker", "The rooms worker", run_worker), owner="Hermes", quiet_because="sales-watchdog",
          action="Read the rooms worker's journal on the VPS (systemctl --user status sales-desk-rooms)."),
    Check(id="live-status-rows", area="live-calls", name="Live calls: status rows",
          means="Every live-calls part writes its status row.", severity="medium",
          reads="cockpit_sales_worker_status for sales-desk and sales-live", threshold="Tables missing: not deployed yet; a part failing: fail.",
          run=deployable("live-status-rows", "The live-calls status rows", run_status_rows), quiet_because="sales-watchdog", owner="Hermes", action="Read that part's detail."),
    Check(id="live-settings", area="live-calls", name="Live calls: switches",
          means="The rooms and live switches exist; switched off is a decision, not a failure.", severity="low",
          reads="cockpit_sales_settings keys rooms and live", threshold="Missing: not deployed yet; enabled false: paused.",
          run=run_settings, alert=False, action="Nothing: switching on is the CEO's decision."),
    Check(id="live-alerts", area="live-calls", name="Live calls: sales watchdog alerts",
          means="The SQL watchdog's alerts are read first once it exists.", severity="medium",
          reads="cockpit_sales_alerts where resolved_at is null, the (sales-api, watchdog) status row and live-cron",
          threshold="Missing: not deployed yet; an alert that did not reach Slack (no webhook, or unposted 15 min in "
                    "working hours): fail, posted by the guardian; the watchdog late or unscheduled: warn; open "
                    "alerts it posts itself: warn, quiet.",
          run=deployable("live-alerts", "The sales watchdog's alerts table", run_alerts), quiet_because="sales-watchdog", action="Read the alerts in #sales-alerts."),
]
