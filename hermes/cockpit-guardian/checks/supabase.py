"""Creative Triage itself (catalogue S1). On recovery from an outage the
radar's last scan is sent again, once (fix 5)."""
from __future__ import annotations

from guard import fixes
from guard.context import Context, SourceError
from guard.model import Check, Result, fail, ok, warn
from guard.redact import clean

SLOW_S = 10.0


def run_health(ctx: Context) -> Result:
    db = ctx.need_db()
    try:
        seconds = db.ping_seconds()
    except Exception as e:  # noqa: BLE001 - no answer is the reading itself
        return fail(f"Creative Triage does not answer a one-row read ({clean(e, 160)}); the cockpits show their last "
                    "good numbers.", evidence={"error": clean(e, 200)})
    services = None
    try:
        services = ctx.supabase_health()
    except SourceError:
        services = None
    ev = {"read_seconds": round(seconds, 2), "services": [{"name": s.get("name"), "status": s.get("status")}
                                                          for s in services or []]}
    bad = [f"{s.get('name')} {s.get('status')}" for s in services or [] if s.get("status") != "ACTIVE_HEALTHY"]
    if bad:
        return fail(f"Creative Triage is unhealthy ({', '.join(bad)}); the cockpits show their last good numbers.",
                    evidence=ev)
    if seconds > SLOW_S:
        return warn(f"A one-row read from Creative Triage took {seconds:.1f} s.", evidence=ev)
    note = "" if services else " (service health needs SUPABASE_ACCESS_TOKEN; the read itself worked)"
    return ok(f"Creative Triage answers in {seconds:.2f} s{note}.", evidence=ev)


CHECKS = [
    Check(
        id="supabase-health", area="supabase", name="Creative Triage (Supabase)", catalogue="S1",
        means="The cockpit database answers and every Supabase service is healthy.", severity="critical",
        reads="A one-row PostgREST read, and the Management API health endpoint when its token is set",
        threshold="A service not ACTIVE_HEALTHY, or no answer, for 15 minutes (3 scans): fail; a read over 10 s: warn.",
        run=run_health, confirm=3, urgent=True, on_resolve=fixes.RADAR_RESEND, owner="the CEO",
        action="Check status.supabase.com; the cockpits show their last good numbers meanwhile.",
    ),
]
