"""pg_cron in Creative Triage (catalogue S2, S3).

Trap: a run that "succeeded" only means pg_net queued the HTTP call. The
answer is in net._http_response (kept about 6 hours, without the URL), so
the guardian reads both. The probe never reads cron.job.command: three jobs
keep a literal Authorization value there.
"""
from __future__ import annotations

from guard.context import Context, SourceError
from guard.model import Check, Result, fail, ok, unknown, warn
from guard.redact import clean

EXPECTED_JOBS = (
    "mahara-sync-business", "mahara-sync-overnight", "mahara-ghl-appointments", "mahara-sync-activities",
    "mahara-ghl-leads", "mahara-ghl-pipelines", "mahara-sync-client-config", "mahara-provision-client-panels",
    "mahara-appointment-outcomes-sync", "mahara-ghl-leads-reconcile", "mahara-tap-charges-sync", "mahara-sales-mirror",
)


def _probe(ctx: Context) -> dict:
    try:
        return ctx.probe()
    except SourceError as e:
        if getattr(e, "missing", False):
            raise SourceError("public.cockpit_guardian_probe() is not installed yet; apply "
                              "supabase/migrations/20261003e_guardian_incidents.sql") from e
        raise


def run_jobs(ctx: Context) -> Result:
    p = _probe(ctx)
    jobs = {j["jobname"]: j for j in p.get("cron_jobs") or []}
    if not jobs:
        return unknown("cron.job came back empty, which pg_cron never is here.")
    missing = [n for n in EXPECTED_JOBS if n not in jobs]
    off = [n for n in EXPECTED_JOBS if n in jobs and not jobs[n].get("active")]
    ev = {"jobs": len(jobs), "missing": missing, "inactive": off}
    if missing or off:
        parts = []
        if missing:
            parts.append(f"missing: {', '.join(missing)}")
        if off:
            parts.append(f"switched off: {', '.join(off)}")
        return fail("Database jobs " + "; ".join(parts) + ", so what they sync stops updating.", evidence=ev)
    return ok(f"All {len(EXPECTED_JOBS)} expected pg_cron jobs exist and are active ({len(jobs)} in all).", evidence=ev)


def run_runs(ctx: Context) -> Result:
    p = _probe(ctx)
    names = {j["jobid"]: j["jobname"] for j in p.get("cron_jobs") or []}
    runs = p.get("cron_runs") or []
    failed = [f"{names.get(r['jobid'], r['jobid'])} ({r['failed_24h']} of {r['runs_24h']}: {clean(r.get('last_error'), 80)})"
              for r in runs if int(r.get("failed_24h") or 0) > 0]
    http_1h = p.get("http_1h") or {}
    bad_http = {k: v for k, v in http_1h.items() if k in ("timeout", "error") or (k.isdigit() and int(k) >= 400)}
    total = sum(int(v) for v in http_1h.values())
    missing_fn = int(http_1h.get("missing_function") or 0)
    ev = {"failed_runs_24h": failed, "http_1h": http_1h}
    # A call to a function that is not deployed yet (sales-live before its
    # deploy) is the live-function and edge-functions checks' to report.
    note = (f" {missing_fn} call(s) went to a function that is not deployed (the function checks cover it)."
            if missing_fn else "")
    if bad_http:
        what = ", ".join(f"{v} x {k}" for k, v in sorted(bad_http.items()))
        return fail(f"Database jobs called functions that failed in the last hour ({what} of {total} answers).{note}",
                    evidence=ev)
    if failed:
        return warn(f"pg_cron runs failed in the last 24 h: {', '.join(failed[:4])}.{note}", evidence=ev)
    return ok(f"No pg_cron run failed in 24 h and the last hour's function answers were all under 400.{note}", evidence=ev)


def run_auth_roles(ctx: Context) -> Result:
    p = _probe(ctx)
    roles = p.get("auth_roles")
    if not isinstance(roles, dict):
        return unknown("The probe gave no auth role counts.")
    if roles:
        what = ", ".join(f"{n} with {r}" for r, n in sorted(roles.items()))
        return warn(f"Accounts with a database role other than authenticated: {what}. If any is a staff seat, it cannot "
                    "open the editor cockpit.", evidence={"roles": roles})
    return ok("Every account carries the authenticated role.")


CHECKS = [
    Check(
        id="pg-cron-jobs", area="supabase", name="pg_cron jobs", catalogue="S2",
        means="The 12 mahara-* database jobs exist and are switched on.", severity="high",
        reads="cron.job through public.cockpit_guardian_probe() (names, schedules, active; never the command)",
        threshold="A job missing or inactive: fail.", run=run_jobs,
        action="Re-create the job from its migration; schedules change only through a migration a person applies.",
    ),
    Check(
        id="pg-cron-runs", area="supabase", name="pg_cron runs and their answers", catalogue="S3",
        means="Database jobs run and the functions they call answer under 400.", severity="medium",
        reads="cron.job_run_details (2 days) and net._http_response (last hour) through the probe",
        threshold="A 400+ answer or a timeout in the last hour: fail; a failed run in 24 h: warn.", run=run_runs,
        confirm=2, action="Open the failing function's log in Supabase; the status code says which step.",
    ),
    Check(
        id="auth-roles", area="supabase", name="Staff database roles", catalogue="S8",
        means="Every staff account has the authenticated database role.", severity="low",
        reads="auth.users.role through the probe (a count only)", threshold="Any other role: warn.",
        run=run_auth_roles, alert=False,
        action="The person signs in through the portal once, which sets the role.",
    ),
]
