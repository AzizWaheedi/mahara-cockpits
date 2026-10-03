"""The VPS crontab, the logs that prove a run, and runs that hang (H4, H5, H6).

Logs prove a run only for jobs that write on every run. webinar-pull, the
radar's hiring log and Salma run --quiet and write nothing when all is well;
their status rows are read instead (worker_status.py).
"""
from __future__ import annotations

from typing import Callable, Optional

from guard import fixes
from guard import jobs as jobs_mod
from guard.context import Context, SourceError
from guard.model import Check, Result, ago, fail, ok, parse_time, paused, warn
from guard.redact import clean

from .claude_proxy import signed_out_text


def run_crontab(ctx: Context) -> Result:
    """A manifest job missing from the crontab fails; one whose line is still there but
    commented out (#) was paused on purpose and is listed, never restored."""
    tab = ctx.snap_part("crontab")
    live = tab.get("lines")
    if live is None:
        raise SourceError("crontab -l gave nothing")
    manifest = jobs_mod.manifest_lines()
    if not manifest:
        raise SourceError("crontab.manifest is missing from the guardian's folder")
    live_jobs = {}
    for line in live:
        j = jobs_mod.job_for_line(line)
        if j:
            live_jobs[j.name] = jobs_mod.split_line(line)[0]
    commented = {j.name for j in (jobs_mod.job_for_line(l) for l in tab.get("commented") or []) if j}
    missing, moved, held = [], [], []
    for line in manifest:
        j = jobs_mod.job_for_line(line)
        if not j:
            continue
        if j.name not in live_jobs:
            (held if j.name in commented else missing).append(j.name)
        elif live_jobs[j.name] != jobs_mod.split_line(line)[0]:
            moved.append(f"{j.name} ({jobs_mod.split_line(line)[0]} -> {live_jobs[j.name]})")
    ev = {"live_lines": len(live), "manifest_lines": len(manifest), "missing": missing, "schedule_changed": moved,
          "commented_out": held}
    note = f" Commented out on purpose (paused): {', '.join(held)}." if held else ""
    if missing:
        # Losing job lines is how a wipe looks (2026-09-19): urgent at any hour.
        return fail(f"The VPS crontab lost {len(missing)} job line(s): {', '.join(missing)}.{note}", evidence=ev,
                    items=missing, urgent=True,
                    action=("Restore them: crontab -l > ~/.crontab.backup.$(date +%s) && crontab "
                            "~/.cockpit-guardian/crontab.proposed (the guardian writes that file in fix mode from the "
                            "live crontab, comments kept; check the diff in ~/.cockpit-guardian/crontab.diff first). If "
                            "a line is off on purpose, comment it out (#) or remove it from "
                            "hermes/cockpit-guardian/crontab.manifest."))
    if moved:
        return warn(f"{len(moved)} job(s) run on a different schedule than the manifest: {', '.join(moved)}.{note}",
                    evidence=ev, items=[m.split(" ")[0] for m in moved])
    if held:
        return paused(f"Every manifest job is in the crontab or commented out on purpose: {', '.join(held)} paused.",
                      evidence=ev)
    return ok(f"All {len(manifest)} manifest jobs are in the crontab ({len(live)} lines).", evidence=ev)


def log_check(job_name: str, limit_min: int, label: str, *, fix_job: Optional[str] = None) -> Callable[[Context], Result]:
    job = jobs_mod.BY_NAME[job_name]

    def run(ctx: Context) -> Result:
        files = ctx.snap_part("files")
        info = files.get(job.log)
        if info is None:
            if job.log not in files:
                raise SourceError(f"{job.log} was not looked at")
            return fail(f"{label}'s log {job.log} does not exist, so no run of it has been recorded.")
        age = (ctx.now.timestamp() - int(info["mtime"])) / 60.0
        tail = (ctx.snap_part("logs") or {}).get(job.log) or {}
        ev = {"log": job.log, "age_min": round(age, 1), "limit_min": limit_min, "tracebacks": tail.get("tracebacks"),
              "flagged": [clean(l, 200) for l in tail.get("flagged") or []]}
        if age > limit_min:
            return fail(f"{label} has not written to {job.log} for {ago(age)} (it runs every {job.every_min} min).",
                        since=parse_time(int(info["mtime"])), evidence=ev, data={"stale": True})
        flagged = tail.get("flagged") or []
        if tail.get("tracebacks"):
            last = clean(flagged[-1], 200) if flagged else "a Python traceback"
            if signed_out_text(last):
                return warn(f"{label}'s log ends in the Claude sign-in error.", evidence=ev, caused_by="claude-signin")
            return warn(f"{label}'s recent log has {tail['tracebacks']} Python traceback(s); the last error line: {last}",
                        evidence=ev)
        return ok(f"{label} wrote to its log {ago(age)} ago.", evidence=ev)

    return run


LOG_JOBS = (
    # id, job, limit, label, fix job
    ("log-eod-out", "eod-out", 15, "eod-out (end of day posts)", None),
    ("log-review-import", "review-import", 10, "review-import", None),
    ("log-review-watch", "review-watch", 25, "review-watch", None),
    ("log-hala", "hala", 35, "Hala (the WhatsApp desk)", None),
    ("log-team-sync", "team-sync", 15, "team-sync (meetings to Google Calendar)", "team-sync"),
    ("log-editor-desk", "editor-requests", 15, "The editor desk", None),
    ("log-ideation-radar", "radar-posts", 10, "The ideation radar", None),
    ("log-sales-desk", "desk-requests", 10, "The sales desk", None),
)


def run_hung(ctx: Context) -> Result:
    """A run past its hard age that still uses CPU is slow (a long backfill), not hung:
    warn. One whose CPU time has not moved for 15 minutes is stuck: fail. Only a stuck
    copy-only cron run (an ancestor is its own `flock -n`) is ever stopped."""
    procs = ctx.snap_part("procs").get("jobs")
    if procs is None:
        raise SourceError("the process list could not be read")
    hung = fixes.hung_runs(procs)
    stuck = set(fixes.track_cpu(ctx.state, hung, ctx.now))
    ev = {"hung": [{"job": h["job"], "pid": h["pid"], "minutes": int(h["etimes"]) // 60, "kind": h["kind"],
                    "user": h.get("user"), "cron_run": bool(h.get("flock")), "stuck": fixes.proc_key(h) in stuck}
                   for h in hung], "running": len(procs)}
    if not hung:
        return ok(f"No cron run is past its hard age ({len(procs)} running now).", evidence=ev)
    names = ", ".join(f"{h['job']} ({int(h['etimes']) // 60} min"
                      f"{', no CPU for 15 min' if fixes.proc_key(h) in stuck else ', still working'})" for h in hung)
    others = [h for h in hung if h["kind"] != "copy"]
    action = None
    if others:
        action = ("Read ~/.sales-desk.log (or the job's own log) before stopping " +
                  ", ".join(h["job"] for h in others) + ": it may be mid-send.")
    data = {"stuck": sorted(stuck)}
    items = sorted({h["job"] for h in hung})
    if stuck or others:
        return fail(f"{len(hung)} cron run(s) hold their lock past the hard age: {names}.", evidence=ev, action=action,
                    data=data, items=items)
    return warn(f"{len(hung)} copy run(s) are past their hard age but still working: {names}. Nothing is stopped while "
                "its CPU time moves.", evidence=ev, data=data, items=items)


CHECKS = [
    Check(
        id="vps-crontab", area="vps", name="VPS crontab", catalogue="H4",
        means="Every job line in the manifest taken on 2026-10-03 is still in hermes's crontab.",
        severity="high", reads="crontab -l compared with hermes/cockpit-guardian/crontab.manifest by the command each line runs",
        threshold="A manifest job missing: fail (urgent); a schedule changed: warn; commented out on purpose: paused.",
        run=run_crontab, fix=fixes.CRONTAB_PROPOSAL, owner="the CEO", urgent=True,
        action="Restore the missing lines from ~/.cockpit-guardian/crontab.proposed after reading crontab.diff.",
    ),
    Check(
        id="vps-hung-runs", area="vps", name="Hung cron runs", catalogue="H6",
        means="No cron run holds its flock far past its interval.",
        severity="medium", reads="Running processes matched to cron jobs, with their age",
        threshold="Older than 4 times the job's interval (at least 60 min) and no CPU time for 15 min: fail; past "
                  "that age but still working: warn.",
        run=run_hung, fix=fixes.STOP_HUNG, owner="Hermes",
        action="Read the job's log, then stop the run by hand if it is stuck.",
    ),
]

for _id, _job, _limit, _label, _fix in LOG_JOBS:
    CHECKS.append(Check(
        id=_id, area="vps", name=f"{_label} runs", catalogue="H5",
        means=f"{_label} runs on schedule; its log proves each run.",
        severity="medium", reads=f"Modification time and the last 80 lines of {jobs_mod.BY_NAME[_job].log}",
        threshold=f"No write for {_limit} min: fail; a Python traceback written since the last scan: warn.",
        run=log_check(_job, _limit, _label, fix_job=_fix), owner="Hermes",
        fix=fixes.catch_up(_fix) if _fix else None, confirm=2, clear=2,
        action=f"Read {jobs_mod.BY_NAME[_job].log} on the VPS; the last error says what stopped it.",
    ))
