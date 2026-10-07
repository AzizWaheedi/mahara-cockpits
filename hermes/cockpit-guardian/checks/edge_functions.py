"""Edge Functions in Creative Triage (catalogue S7).

The full list (status and verify_jwt) needs the Management API token
(SUPABASE_ACCESS_TOKEN). Without it only sales-api can be checked from
outside: with verify_jwt on, the gateway answers 401 without running any of
its code. The sync functions are never called: with verify_jwt off a GET
could start a sync.
"""
from __future__ import annotations

from guard import http
from guard.config import SUPABASE_URL
from guard.context import Context, SourceError
from guard.model import Check, Result, fail, ok, unknown

EXPECTED = {
    "sales-api": True,            # slug: verify_jwt
    # The door Zoom, Slack and pg_cron reach (live calls, deployed 2026-10-07): it
    # checks its own signatures, so verify_jwt is off on purpose.
    "sales-live": False,
    "sales-mirror": False,
    "webinar-events": False,
    "ghl-appointments-sync": False,
    "ghl-leads-sync": False,
    "ghl-pipelines-sync": False,
    "client-config-sync": False,
    "provision-client-panels": False,
    "appointment-outcomes-sync": False,
    "tap-charges-sync": False,
}


def run_functions(ctx: Context) -> Result:
    try:
        listed = ctx.functions()
    except SourceError as e:
        if not getattr(e, "gap", False):
            raise
        try:
            r = ctx.get(f"{SUPABASE_URL}/functions/v1/sales-api", timeout=15)
        except http.HttpError as e2:
            # Same host as the database: during a Supabase outage this folds into supabase-health.
            raise SourceError(f"neither the functions list (no SUPABASE_ACCESS_TOKEN) nor sales-api answered ({e2})",
                              source="db") from e2
        if r.status == 401:
            return unknown("sales-api is up (401 without sign-in); the other ten functions need SUPABASE_ACCESS_TOKEN "
                           "to be checked.", coverage_gap=True, evidence={"sales-api": r.status})
        return fail(f"sales-api answers {r.status} instead of 401, so the sales cockpit cannot reach its server.",
                    evidence={"sales-api": r.status})
    by = {f.get("slug"): f for f in listed}
    problems, names = [], []
    for slug, jwt in EXPECTED.items():
        f = by.get(slug)
        if not f:
            problems.append(f"{slug} is missing")
        elif f.get("status") != "ACTIVE":
            problems.append(f"{slug} is {f.get('status')}")
        elif bool(f.get("verify_jwt")) != jwt:
            problems.append(f"{slug} has verify_jwt {f.get('verify_jwt')} (should be {jwt})")
        else:
            continue
        names.append(slug)
    ev = {"listed": sorted(by), "problems": problems}
    if problems:
        return fail("Edge Functions: " + "; ".join(problems) + ".", evidence=ev, items=names)
    return ok(f"All {len(EXPECTED)} Edge Functions are ACTIVE with the right verify_jwt.", evidence=ev)


def run_sales_api(ctx: Context) -> Result:
    try:
        r = ctx.get(f"{SUPABASE_URL}/functions/v1/sales-api", timeout=15)
    except http.HttpError as e:
        return fail(f"sales-api does not answer: {e}", caused_by="supabase-health")
    if r.status == 401:
        return ok("sales-api answers 401 without sign-in, which means it is up.")
    return fail(f"sales-api answers {r.status} instead of 401.", evidence={"status": r.status},
                caused_by="supabase-health" if r.status >= 500 else None)


CHECKS = [
    Check(
        id="edge-functions", area="supabase", name="Edge Functions", catalogue="S7",
        means="The eleven Edge Functions are ACTIVE, sales-api with verify_jwt on and the rest off, sales-live included.",
        severity="high",
        reads="Management API GET /v1/projects/{ref}/functions (needs SUPABASE_ACCESS_TOKEN)",
        threshold="A function missing, not ACTIVE, or with the wrong verify_jwt: fail.", run=run_functions,
        action="Redeploy the function from supabase/functions with its documented flags (a person does this).",
    ),
    Check(
        id="sales-api-up", area="sites", name="sales-api answers",
        means="The sales cockpit's server function is up.", severity="high",
        reads="GET /functions/v1/sales-api without sign-in", threshold="Anything but 401: fail.",
        run=run_sales_api, confirm=2, action="Open the sales-api log in Supabase.",
    ),
]
