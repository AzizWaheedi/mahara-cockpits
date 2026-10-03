"""Convex, read through its Supabase mirror and its public /version route
(catalogue C1, C3, C7, H12).

The fourteen CEO sections refresh every 15 minutes from Convex crons, so
their age is the honest test that Convex runs: a deployment switched off
for usage can still answer /version. Convex already alerts on its own jobs
and sources (3 failures in a row DM the CEO), so those incidents are posted
here only while Convex itself looks down.
"""
from __future__ import annotations

from guard import http
from guard.config import CONVEX_DEPLOYMENTS
from guard.context import Context, SourceError
from guard.model import Check, Result, age_min, ago, fail, ok, parse_time, unknown, warn
from guard.redact import brief_error, clean

from .claude_proxy import signed_out_text

SECTION_LIMIT_MIN = 45
EXPECTED_SECTIONS = 14


def run_deployments(ctx: Context) -> Result:
    bad, seen = [], {}
    for dep in CONVEX_DEPLOYMENTS:
        try:
            r = ctx.get(f"https://{dep}.convex.cloud/version", timeout=10)
            seen[dep] = r.status
            if r.status != 200:
                bad.append(f"{dep} answers {r.status}")
        except (http.HttpError, SourceError) as e:
            seen[dep] = 0
            bad.append(f"{dep} does not answer ({clean(e, 80)})")
    if bad:
        return fail("Convex: " + "; ".join(bad) + ".", evidence=seen)
    return ok("All three Convex deployments answer /version (this alone does not prove they run).", evidence=seen)


def run_sections(ctx: Context) -> Result:
    rows = ctx.rows("cockpit_sections", "key,ok,error,computed_at")
    if not rows:
        return unknown("cockpit_sections is empty.")
    ages = {r["key"]: age_min(r.get("computed_at"), ctx.now) for r in rows}
    stale = [k for k, a in ages.items() if a is None or a > SECTION_LIMIT_MIN]
    broken = [f"{r['key']} ({clean(r.get('error'), 80)})" for r in rows if r.get("ok") is False]
    newest = min((a for a in ages.values() if a is not None), default=None)
    ev = {"sections": len(rows), "stale": stale, "not_ok": broken, "newest_min": newest}
    if len(stale) == len(rows):
        return fail(f"None of the {len(rows)} CEO sections has refreshed for {ago(newest)}: Convex is switched off or "
                    "its jobs have stopped, and people may be stuck on 'One moment'.",
                    since=parse_time(max((r.get('computed_at') for r in rows if r.get('computed_at')), default=None)),
                    evidence=ev, action="Run `bunx convex logs` or open dashboard.convex.dev: if it says 'exceeded the free "
                                        "plan limits', move team aziz-00129 to Pro; the cockpits come back by themselves.")
    if stale or broken:
        parts = []
        if stale:
            parts.append(f"{len(stale)} section(s) older than {SECTION_LIMIT_MIN} min ({', '.join(stale[:5])})")
        if broken:
            parts.append(f"{len(broken)} failing ({', '.join(broken[:3])})")
        return warn("CEO sections: " + "; ".join(parts) + ".", evidence=ev)
    if len(rows) < EXPECTED_SECTIONS:
        return warn(f"Only {len(rows)} of {EXPECTED_SECTIONS} CEO sections exist.", evidence=ev)
    return ok(f"All {len(rows)} CEO sections refreshed within {ago(max(a for a in ages.values() if a is not None))}.",
              evidence=ev)


def _machine(ctx: Context) -> dict:
    sec = ctx.section("machine")
    age = age_min(sec.get("computed_at"), ctx.now)
    if age is None or age > SECTION_LIMIT_MIN:
        raise SourceError(f"the machine section is {ago(age)} old, so Convex's own job and source readings are stale")
    return sec.get("payload") or {}


def run_jobs(ctx: Context) -> Result:
    m = _machine(ctx)
    jobs = m.get("jobs") or []
    if not jobs:
        return unknown("The machine section lists no Convex jobs.")
    now_ms = ctx.now.timestamp() * 1000
    failing, stale, signin = [], [], []
    for j in jobs:
        every = int(j.get("everyMin") or 15)
        age = (now_ms - float(j.get("at") or 0)) / 60000.0
        if j.get("ok") is False:
            if signed_out_text(j.get("error")):
                signin.append(j["job"])
            else:
                failing.append(f"{j['job']} ({brief_error(j.get('error'), 90)})")
        elif age > max(3 * every, 45):
            stale.append(f"{j['job']} ({ago(age)})")
    ev = {"jobs": len(jobs), "failing": failing, "stale": stale, "signin": signin}
    if failing or stale:
        return fail("Convex jobs: " + "; ".join(filter(None, [
            f"failing {', '.join(failing)}" if failing else "", f"late {', '.join(stale)}" if stale else ""])) + ".",
            evidence=ev)
    if signin:
        return fail(f"Convex's {', '.join(signin)} fails because the Claude sign-in on the VPS has lapsed.", evidence=ev,
                    caused_by="claude-signin")
    return ok(f"All {len(jobs)} Convex jobs ran on time.", evidence=ev)


def run_sources(ctx: Context) -> Result:
    m = _machine(ctx)
    sources = m.get("sources") or []
    if not sources:
        return unknown("The machine section lists no sources.")
    bad = [f"{s['source']} ({brief_error(s.get('lastError'), 90)})" for s in sources if s.get("ok") is False]
    if bad:
        return fail(f"{len(bad)} cockpit data source(s) failing in Convex's ledger: {', '.join(bad)}.",
                    evidence={"failing": bad, "of": len(sources)})
    return ok(f"All {len(sources)} sources in Convex's health ledger are ok.")


def run_hermes_queue(ctx: Context) -> Result:
    m = _machine(ctx)
    h = m.get("hermes")
    if not isinstance(h, dict):
        return unknown("The machine section has no Hermes queue reading.")
    queued = int(h.get("queued") or 0)
    failed = int(h.get("failed") or 0)
    done_age = age_min(h.get("lastDoneAt"), ctx.now)
    hist = ctx.state.setdefault("history", {}).setdefault("hermes_failed", [])
    hour_ago = [v for t, v in hist if (age_min(t, ctx.now) or 0) >= 55]
    base = hour_ago[-1] if hour_ago else (hist[0][1] if hist else None)
    hist.append([ctx.now.isoformat(), failed])
    del hist[:-24]
    rise = failed - base if base is not None else 0
    ev = {"queued": queued, "failed_total": failed, "rise_last_hour": rise, "last_done_min": done_age}
    if queued and (done_age is None or done_age > 20):
        return fail(f"Hermes's Ask AI queue holds {queued} job(s) and the last one finished {ago(done_age)} ago.", evidence=ev)
    if rise >= 10:
        return warn(f"{rise} Hermes Ask AI jobs failed in the last hour ({failed} in total); a green heartbeat does not "
                    "prove these work.", evidence=ev)
    return ok(f"Hermes's Ask AI queue holds {queued} job(s); {failed} have failed in total, {rise} in the last hour.",
              evidence=ev)


CHECKS = [
    Check(
        id="convex-ceo-sections", area="convex", name="Convex runs (CEO sections)", catalogue="C1, C3",
        means="Convex's crons refresh the 14 CEO sections every 15 minutes, which shows Convex is on and running.",
        severity="critical", reads="cockpit_sections.computed_at and ok (14 rows)",
        threshold=f"All older than {SECTION_LIMIT_MIN} min: fail (urgent); some old or failing: warn.",
        run=run_sections, urgent=True, confirm=2,
        action="Open dashboard.convex.dev; if Convex switched the team off for usage, move it to Pro.",
    ),
    Check(
        id="convex-deployments", area="convex", name="Convex deployments answer",
        means="The three Convex deployments answer on the internet.", severity="high",
        reads="GET https://<deployment>.convex.cloud/version for all three", threshold="Any answer other than 200: fail.",
        run=run_deployments, confirm=2, action="Open dashboard.convex.dev for that deployment.",
    ),
    Check(
        id="convex-jobs", area="convex", name="Convex jobs", catalogue="C3",
        means="Every Convex job in the health ledger ran on time and worked.", severity="medium",
        reads="cockpit_sections machine.jobs", threshold="ok false, or older than 3 times its interval (45 min at least): fail.",
        run=run_jobs, quiet_because="convex", action="Convex already sends a DM; read the job's error on the Machine tab.",
    ),
    Check(
        id="convex-sources", area="convex", name="Convex data sources", catalogue="C7",
        means="Every outside system in Convex's health ledger answers.", severity="medium",
        reads="cockpit_sections machine.sources (16 systems)", threshold="Any ok false: fail.",
        run=run_sources, quiet_because="convex",
        action="Convex already alerts after 3 failures in a row; the owner is in RUNBOOK.md.",
    ),
    Check(
        id="hermes-ask-ai", area="convex", name="Hermes Ask AI queue", catalogue="H12",
        means="Hermes drains the Ask AI queue and its jobs work, not only its heartbeat.", severity="medium",
        reads="cockpit_sections machine.hermes (queued, failed, lastDoneAt), compared with an hour ago",
        threshold="Jobs waiting while nothing finished for 20 min: fail; 10 or more new failures in an hour: warn.",
        run=run_hermes_queue, owner="Hermes",
        action="Read the failed Ask AI jobs' error; 'quota exhausted' means the provider needs credit.",
    ),
]
