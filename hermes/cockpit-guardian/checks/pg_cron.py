"""pg_cron in Creative Triage (catalogue S2, S3).

Trap: a run that "succeeded" only means pg_net queued the HTTP call. The
answer is in net._http_response (kept about 6 hours, without the URL), so
the guardian reads both. The probe never reads cron.job.command: three jobs
keep a literal Authorization value there.
"""
from __future__ import annotations

from guard.context import Context, SourceError
from guard.model import NOT_DEPLOYED, PAUSED, Check, Result, fail, ok, unknown, warn
from guard.redact import clean

MISSING_FN_PER_HOUR = 60     # the rooms sweep calls sales-live once a minute

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
        return fail("Database jobs " + "; ".join(parts) + ", so what they sync stops updating.", evidence=ev,
                    items=sorted(missing + off))
    return ok(f"All {len(EXPECTED_JOBS)} expected pg_cron jobs exist and are active ({len(jobs)} in all).", evidence=ev)


def _live(ctx: Context, check_id: str) -> Result | None:
    r = ctx.results.get(check_id)
    if r is not None:
        return r
    from checks import live_calls       # a run with --only: read it here
    fn = {"live-function": live_calls.run_function, "live-settings": live_calls.run_settings}[check_id]
    try:
        return fn(ctx)
    except Exception:  # noqa: BLE001 - unknown: nothing is excused
        return None


def missing_function_excused(ctx: Context, n: int) -> tuple[bool, str]:
    """A 404 'Requested function was not found' is excused only while it can be
    sales-live before its deploy: live-function reads not deployed, live calls are
    switched off (or not deployed), and there are no more than the sweep's once a
    minute. A deleted sync function (tap, the mirror, a GHL sync) answers the same 404."""
    fn, sw = _live(ctx, "live-function"), _live(ctx, "live-settings")
    if fn is None or fn.status != NOT_DEPLOYED:
        return False, "sales-live is deployed (or could not be read), so a missing function is a real one"
    if sw is None or sw.status not in (PAUSED, NOT_DEPLOYED):
        return False, "live calls are switched on, so sales-live must exist"
    if n > MISSING_FN_PER_HOUR:
        return False, f"{n} in an hour is more than the rooms sweep's once a minute, so another function is missing too"
    return True, ""


def run_runs(ctx: Context) -> Result:
    p = _probe(ctx)
    names = {j["jobid"]: j["jobname"] for j in p.get("cron_jobs") or []}
    runs = p.get("cron_runs") or []
    # One failed run in 24 h ("job startup timeout") is noise; two of the same job is a pattern.
    failing = [r for r in runs if int(r.get("failed_24h") or 0) >= 2]
    failed = [f"{names.get(r['jobid'], r['jobid'])} ({r['failed_24h']} of {r['runs_24h']}: {clean(r.get('last_error'), 80)})"
              for r in failing]
    http_1h = p.get("http_1h") or {}
    bad_http = {k: v for k, v in http_1h.items() if k in ("timeout", "error") or (k.isdigit() and int(k) >= 400)}
    total = sum(int(v) for v in http_1h.values())
    missing_fn = int(http_1h.get("missing_function") or 0)
    ev = {"failed_runs_24h": failed, "http_1h": http_1h}
    note = ""
    if missing_fn:
        excused, why = missing_function_excused(ctx, missing_fn)
        if excused:
            note = f" {missing_fn} call(s) went to sales-live, which is not deployed yet (the function checks cover it)."
        else:
            bad_http["missing_function"] = missing_fn
            ev["missing_function"] = why
    if bad_http:
        what = ", ".join(f"{v} x {k.replace('missing_function', 'a function that does not exist')}"
                         for k, v in sorted(bad_http.items()))
        why = f" ({ev['missing_function']})" if "missing_function" in bad_http else ""
        return fail(f"Database jobs called functions that failed in the last hour ({what} of {total} answers){why}.{note}",
                    evidence=ev, items=sorted(bad_http))
    if failed:
        return warn(f"pg_cron jobs failed 2 or more runs in the last 24 h: {', '.join(failed[:4])}.{note}", evidence=ev,
                    items=sorted(str(names.get(r["jobid"], r["jobid"])) for r in failing))
    return ok(f"No pg_cron job failed twice in 24 h and the last hour's function answers were all under 400.{note}",
              evidence=ev)


def run_literal_auth(ctx: Context) -> Result:
    p = _probe(ctx)
    jobs = p.get("cron_jobs") or []
    if jobs and not any("has_literal_auth" in j for j in jobs):
        return unknown("The installed probe is older than this check (no has_literal_auth); re-apply migration 20261003e.")
    named = sorted(str(j.get("jobname")) for j in jobs if j.get("has_literal_auth"))
    if named:
        return warn(f"{len(named)} pg_cron job(s) keep a literal Authorization value in their command: {', '.join(named)}. "
                    "Anyone who can read cron.job can read that key.", items=named, evidence={"jobs": named})
    return ok("No pg_cron job keeps a literal Authorization value; they read their keys from the vault.")


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
        threshold="A 400+ answer or a timeout in the last hour: fail (a missing function only while it cannot be "
                  "sales-live before its deploy); 2 or more failed runs of one job in 24 h: warn.", run=run_runs,
        confirm=2, action="Open the failing function's log in Supabase; the status code says which step.",
    ),
    Check(
        id="pg-cron-secrets", area="supabase", name="pg_cron keys in plain text",
        means="No pg_cron job keeps a literal key in its command; each reads it from the vault.", severity="low",
        reads="cron.job through the probe: a has_literal_auth boolean per job (never the command)",
        threshold="Any job with a literal Authorization value: warn (summary only).", run=run_literal_auth, alert=False,
        action="Re-create those jobs with the key read from the vault, in a migration a person applies, then rotate the key.",
    ),
    Check(
        id="auth-roles", area="supabase", name="Staff database roles", catalogue="S8",
        means="Every staff account has the authenticated database role.", severity="low",
        reads="auth.users.role through the probe (a count only)", threshold="Any other role: warn.",
        run=run_auth_roles, alert=False,
        action="The person signs in through the portal once, which sets the role.",
    ),
]
