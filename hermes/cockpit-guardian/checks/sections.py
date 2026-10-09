"""The CEO sections and the machine section in Creative Triage (catalogue C1, C3, C7, H12).

The native CEO refresh worker (hermes/ceo-refresh) writes the fourteen CEO
sections to cockpit_sections every 15 minutes, so their age is the honest test
that it runs. Its machine section carries the cockpit's scheduled jobs
(cockpit_sync_state), the native source readiness and the Ask AI queue; the
checks below read those. Convex is paused and nothing here asks it anything,
so no reading is muted on the belief that Convex alerts on it.
"""
from __future__ import annotations

import re

from guard.context import Context, SourceError
from guard.model import Check, Result, age_min, ago, fail, ok, parse_time, unknown, warn
from guard.redact import brief_error, clean

from .claude_proxy import signed_out_text

SECTION_LIMIT_MIN = 45
EXPECTED_SECTIONS = 14


def run_sections(ctx: Context) -> Result:
    rows = ctx.rows("cockpit_sections", "key,ok,error,computed_at")
    if not rows:
        return unknown("cockpit_sections is empty.")
    ages = {r["key"]: age_min(r.get("computed_at"), ctx.now) for r in rows}
    stale = [k for k, a in ages.items() if a is None or a > SECTION_LIMIT_MIN]
    broken = [f"{r['key']} ({clean(r.get('error'), 80)})" for r in rows if r.get("ok") is False]
    newest = min((a for a in ages.values() if a is not None), default=None)
    ev = {"sections": len(rows), "stale": stale, "not_ok": broken, "newest_min": newest}
    names = sorted(set(stale) | {str(r["key"]) for r in rows if r.get("ok") is False})
    if len(stale) == len(rows):
        return fail(f"None of the {len(rows)} CEO sections has refreshed for {ago(newest)}: the CEO refresh worker "
                    "has stopped or every run fails, and people may be stuck on 'One moment'.",
                    since=parse_time(max((r.get('computed_at') for r in rows if r.get('computed_at')), default=None)),
                    evidence=ev, items=names,
                    action="On the VPS, run `bun run doctor` in hermes/ceo-refresh and read the newest row of "
                           "cockpit_ceo_refresh_runs; RUNBOOK.md (Native CEO refresh) has the cron line.")
    if stale or broken:
        parts = []
        if stale:
            parts.append(f"{len(stale)} section(s) older than {SECTION_LIMIT_MIN} min ({', '.join(stale[:5])})")
        if broken:
            parts.append(f"{len(broken)} failing ({', '.join(broken[:3])})")
        return warn("CEO sections: " + "; ".join(parts) + ".", evidence=ev, items=names)
    if len(rows) < EXPECTED_SECTIONS:
        return warn(f"Only {len(rows)} of {EXPECTED_SECTIONS} CEO sections exist.", evidence=ev)
    return ok(f"All {len(rows)} CEO sections refreshed within {ago(max(a for a in ages.values() if a is not None))}.",
              evidence=ev)


def _machine(ctx: Context) -> dict:
    sec = ctx.section("machine")
    age = age_min(sec.get("computed_at"), ctx.now)
    if age is None or age > SECTION_LIMIT_MIN:
        raise SourceError(f"the machine section is {ago(age)} old, so its job and source readings are stale")
    return sec.get("payload") or {}


# A job error can join several problems with "; " and each starts with one of these (the
# sign-in sentence itself holds a "; ", so a plain split would cut it in two).
_PROBLEM_START = re.compile(r";\s+(?=sales desk \"|the sales mirror\b)")


def only_signin(error: object) -> bool:
    """It is the sign-in's alone only when every problem in the error says so:
    "requests last ran 47 min ago; reviews failed: the Claude sign-in has lapsed"
    is two problems, not one."""
    parts = [p for p in _PROBLEM_START.split(str(error or "")) if p.strip()]
    return bool(parts) and all(signed_out_text(p) for p in parts)


def run_jobs(ctx: Context) -> Result:
    m = _machine(ctx)
    jobs = m.get("jobs") or []
    if not jobs:
        return unknown("The machine section lists no cockpit jobs.")
    now_ms = ctx.now.timestamp() * 1000
    failing, stale, signin, names = [], [], [], []
    for j in jobs:
        every = int(j.get("everyMin") or 15)
        age = (now_ms - float(j.get("at") or 0)) / 60000.0
        if j.get("ok") is False:
            if only_signin(j.get("error")):
                signin.append(j["job"])
            else:
                failing.append(f"{j['job']} ({brief_error(j.get('error'), 90)})")
                names.append(str(j["job"]))
        elif age > max(3 * every, 45):
            stale.append(f"{j['job']} ({ago(age)})")
            names.append(str(j["job"]))
    ev = {"jobs": len(jobs), "failing": failing, "stale": stale, "signin": signin}
    if failing or stale:
        return fail("Cockpit jobs: " + "; ".join(filter(None, [
            f"failing {', '.join(failing)}" if failing else "", f"late {', '.join(stale)}" if stale else ""])) + ".",
            evidence=ev, items=sorted(names))
    if signin:
        return fail(f"The cockpit's {', '.join(signin)} fails because the Claude sign-in on the VPS has lapsed.",
                    evidence=ev, caused_by="claude-signin")
    return ok(f"All {len(jobs)} cockpit jobs ran on time.", evidence=ev)


def run_sources(ctx: Context) -> Result:
    m = _machine(ctx)
    sources = m.get("sources") or []
    if not sources:
        return unknown("The machine section lists no sources.")
    bad = [f"{s['source']} ({brief_error(s.get('lastError'), 90)})" for s in sources if s.get("ok") is False]
    if bad:
        return fail(f"{len(bad)} cockpit data source(s) failing in the machine section: {', '.join(bad)}.",
                    evidence={"failing": bad, "of": len(sources)},
                    items=sorted(str(s["source"]) for s in sources if s.get("ok") is False))
    return ok(f"All {len(sources)} sources in the machine section are ok.")


def run_ask_ai_queue(ctx: Context) -> Result:
    m = _machine(ctx)
    h = m.get("hermes")
    if not isinstance(h, dict):
        return unknown("The machine section has no Ask AI queue reading.")
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
        return fail(f"The Ask AI queue holds {queued} job(s) and the last one finished {ago(done_age)} ago.", evidence=ev)
    if rise >= 10:
        return warn(f"{rise} Ask AI jobs failed in the last hour ({failed} in total); a green heartbeat does not "
                    "prove these work.", evidence=ev)
    return ok(f"The Ask AI queue holds {queued} job(s); {failed} have failed in total, {rise} in the last hour.",
              evidence=ev)


CHECKS = [
    Check(
        id="ceo-sections", area="workers", name="CEO sections refresh", catalogue="C1, C3",
        means="The native CEO refresh worker refreshes the 14 CEO sections every 15 minutes.",
        severity="critical", reads="cockpit_sections.computed_at and ok (14 rows)",
        threshold=f"All older than {SECTION_LIMIT_MIN} min: fail (urgent); some old or failing: warn.",
        run=run_sections, urgent=True, confirm=2, owner="Hermes",
        action="Run `bun run doctor` in hermes/ceo-refresh on the VPS and read the newest cockpit_ceo_refresh_runs row.",
    ),
    Check(
        id="native-jobs", area="workers", name="Cockpit jobs", catalogue="C3",
        means="Every cockpit job in the machine section ran on time and worked.", severity="medium",
        reads="cockpit_sections machine.jobs (from cockpit_sync_state)",
        threshold="ok false, or older than 3 times its interval (45 min at least): fail.",
        run=run_jobs, owner="Hermes",
        action="Read the job's note in cockpit_sync_state (the Machine tab shows it) and that worker's log on the VPS.",
    ),
    Check(
        id="native-sources", area="supabase", name="Cockpit data sources", catalogue="C7",
        means="Every cockpit data source in the machine section is ready.", severity="medium",
        reads="cockpit_sections machine.sources (the media, CSM and creative source states)",
        threshold="Any ok false: fail.",
        run=run_sources, owner="the systems manager",
        action="Read the failing source's row in its cockpit_*_source_state table; reconcile only after approval.",
    ),
    Check(
        id="ask-ai-queue", area="queues", name="Ask AI queue", catalogue="H12",
        means="Hermes drains the Ask AI queue and its jobs work, not only its heartbeat.", severity="medium",
        reads="cockpit_sections machine.hermes (queued, failed, lastDoneAt), compared with an hour ago",
        threshold="Jobs waiting while nothing finished for 20 min: fail; 10 or more new failures in an hour: warn.",
        run=run_ask_ai_queue, owner="Hermes",
        action="Read the failed Ask AI jobs' error; 'quota exhausted' means the provider needs credit.",
    ),
]
