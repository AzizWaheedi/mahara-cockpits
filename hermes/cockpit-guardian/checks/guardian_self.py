"""The guardian's own machinery: can it read the VPS, do its incident rows reach
Supabase, and does its dead-man heartbeat go out.

Who watches the watcher: after every full scan on the VPS the guardian puts
`beat:cockpit-guardian` in the Cloudflare KV namespace the Hermes dead-man
worker reads (deadman-worker.mjs). That worker runs on Cloudflare, not on the
VPS, and posts to #health when the beat is more than 10 minutes old or when
the guardian's undelivered alerts are older than 15 minutes. So a wiped
crontab, a crash at import, a full disk or the VPS going down all reach a
person without the guardian. `guardian-beat` says when the beat itself fails.
"""
from __future__ import annotations

from datetime import timedelta

from guard.context import SourceError
from guard.model import Check, Result, ago, fail, not_deployed, ok, parse_time, unknown, warn
from guard.redact import clean

BEAT_LATE = timedelta(minutes=15)
DB_WAIT = timedelta(hours=1)


def run_snapshot(ctx) -> Result:
    if ctx.host is None:
        return unknown("The VPS cannot be read from here (no host).", coverage_gap=True)
    try:
        snap = ctx.snapshot()
    except SourceError as e:
        where = "over ssh" if ctx.cfg.remote else "on the VPS itself"
        return fail(f"The guardian could not read the VPS {where} ({clean(e, 200)}). Every VPS check waits on this one "
                    "instead of opening its own incident.", urgent=True)
    broken = sorted(k for k, v in snap.items() if isinstance(v, dict) and set(v) == {"error"})
    if broken:
        return warn(f"The VPS snapshot could not read {', '.join(broken)}; the checks that need them say so.",
                    items=broken, evidence={"parts": broken})
    return ok(f"The VPS answers its read-only snapshot (as {snap.get('user')}).")


def run_db_copy(ctx) -> Result:
    if ctx.cfg.dry_run or ctx.cfg.remote:
        return unknown("A dry run or a run off the VPS never writes the incident rows.", coverage_gap=True)
    st = ctx.state
    if st.get("db_table_missing"):
        return not_deployed("The incidents table is not deployed yet (migration 20261003e); incidents live in the state "
                            "file until then.")
    pending = len(st.get("pending_db") or [])
    since = parse_time(st.get("pending_db_since"))
    day_ago = ctx.now - timedelta(hours=24)
    rejected = [r for r in st.get("db_rejected") or [] if (parse_time(r.get("at")) or day_ago) > day_ago]
    if pending and since and ctx.now - since > DB_WAIT:
        return fail(f"{pending} incident row(s) have waited {ago((ctx.now - since).total_seconds() / 60)} to reach "
                    "Supabase; the CEO cockpit's copy is behind the guardian's own.", caused_by="supabase-health",
                    evidence={"pending": pending})
    if rejected:
        names = sorted({r.get("check_id") for r in rejected if r.get("check_id")})
        return warn(f"Supabase refused {len(rejected)} incident row(s) in 24 h ({', '.join(names[:6])}): "
                    f"{clean(rejected[-1].get('error'), 160)}. They were set aside so the rest still go.",
                    items=names, evidence={"rejected": len(rejected)})
    return ok("Every incident row reached Supabase." if not pending else f"{pending} incident row(s) wait for the next scan.")


def run_beat(ctx) -> Result:
    if ctx.cfg.dry_run or ctx.cfg.remote:
        return unknown("Only the guardian's own run on the VPS sends its heartbeat.", coverage_gap=True)
    b = ctx.state.get("beat") or {}
    if b.get("missing"):
        return fail(f"The guardian's dead-man heartbeat is not sent: {b['missing']} cannot be read, so nobody would "
                    "notice if the guardian stopped.",
                    action="Make /docker/hermes-agent-ff5p/data/portal-monitor/monitor.env readable by hermes, or put "
                           "PORTAL_MONITOR_CF_TOKEN, PORTAL_MONITOR_CF_ACCOUNT and PORTAL_MONITOR_CF_KV_NAMESPACE in "
                           "~/.cockpit-guardian/env.")
    if not b.get("at"):
        return unknown("No heartbeat has been sent yet; the first full run sends it.", coverage_gap=True)
    good = parse_time(b.get("ok_at"))
    if b.get("error") and (good is None or ctx.now - good > BEAT_LATE):
        return fail(f"The guardian's heartbeat to Cloudflare fails ({clean(b.get('error'), 160)}); the dead-man switch "
                    f"will soon say the guardian is dead. Last good beat: {ago((ctx.now - good).total_seconds() / 60) + ' ago' if good else 'never'}.",
                    action="Check PORTAL_MONITOR_CF_TOKEN (KV write) in monitor.env.")
    return ok(f"The dead-man heartbeat went out {ago((ctx.now - (good or ctx.now)).total_seconds() / 60)} ago.")


CHECKS = [
    Check(id="vps-snapshot", area="vps", name="The VPS answers", catalogue="H9",
          means="The guardian can read the VPS (its read-only snapshot); every VPS check depends on it.", severity="high",
          reads="vps_snapshot.py run locally, or over ssh off the box", confirm=2,
          threshold="No snapshot two scans running: fail (urgent); a part unreadable: warn.", run=run_snapshot,
          owner="the CEO", urgent=True,
          action="Check the VPS is up (ssh hermes@187.77.156.166), then its memory (free -m) and disk (df -h)."),
    Check(id="guardian-db-copy", area="guardian", name="Guardian incident rows",
          means="The guardian's incidents reach public.cockpit_guardian_incidents.", severity="medium",
          reads="The guardian's state file (rows waiting, rows Supabase refused)",
          threshold="Rows waiting over 1 h: fail (folded into supabase-health while that is down); a row refused: warn.",
          run=run_db_copy, owner="Hermes", action="Read ~/.cockpit-guardian/guardian.log for the refused rows' error."),
    Check(id="guardian-beat", area="guardian", name="Guardian heartbeat",
          means="The guardian's dead-man heartbeat reaches Cloudflare, so its own silence would be noticed.",
          severity="high", reads="The result of the last PUT of beat:cockpit-guardian to Cloudflare KV",
          threshold="Keys unreadable, or no good beat for 15 min: fail.", run=run_beat, owner="the CEO",
          action="Check the PORTAL_MONITOR_CF_* keys in monitor.env."),
]
