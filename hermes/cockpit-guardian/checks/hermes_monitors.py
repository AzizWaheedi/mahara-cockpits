"""The monitors that already run on the VPS: cockpits, public sites, the
portal and the dialer (the clients' call centre). The guardian reads them and
does not rebuild them: their findings are listed (they alert on their own),
and the guardian alerts when a monitor stops ticking or stops delivering: an
outbox item older than 30 minutes means its alerts are not reaching anyone,
so "Hermes already alerts" no longer holds.
"""
from __future__ import annotations

from guard.context import Context, SourceError
from guard.model import Check, Result, age_min, ago, fail, ok, parse_time, warn
from guard.redact import clean

TICK_LIMIT_MIN = 3
OUTBOX_STUCK_MIN = 30
# The dead-man switch (a Cloudflare worker) reads one KV heartbeat per monitor.
# Cloudflare's free plan takes 1,000 KV writes a day (error 10048 after that,
# until 00:00 UTC). Each monitor beats every 5 minutes (288 a day) and the
# worker writes its own `watcher` key every 5 minutes (288 more).
BEAT_LATE_MIN = 15
KV_FREE_WRITES_A_DAY = 1000
BEATS_A_DAY = 288


def monitor_check(name: str, label: str):
    def run(ctx: Context) -> Result:
        mons = ctx.snap_part("monitors")
        m = mons.get(name)
        if not m or "error" in m and len(m) == 1:
            raise SourceError(f"the {label} monitor's state could not be read: {clean((m or {}).get('error'), 120)}")
        age = age_min(m.get("at"), ctx.now)
        incidents = m.get("incidents") or {}
        oldest = m.get("outbox_oldest")
        stuck = age_min(oldest, ctx.now) if oldest else None
        delivering = not (stuck is not None and stuck > OUTBOX_STUCK_MIN)
        ev = {"tick_age_min": age, "not_ok": m.get("not_ok"), "incidents": {k: v.get("summary") for k, v in incidents.items()},
              "outbox": m.get("outbox"), "outbox_oldest_min": stuck, "delivery_last_ok": m.get("delivery_last_ok")}
        if age is None or age > TICK_LIMIT_MIN:
            return fail(f"The Hermes {label} monitor last ticked {ago(age)} ago (every minute), so its alerts have stopped.",
                        since=parse_time(m.get("at")), evidence=ev, data={"monitor_down": True, "delivering": False})
        if not delivering:
            text = "; ".join(f"{k}: {clean(v.get('summary'), 100)}" for k, v in list(incidents.items())[:4])
            return fail(f"The Hermes {label} monitor ticks but {m.get('outbox')} of its alert(s) have waited "
                        f"{ago(stuck)} undelivered, so nobody hears what it finds" + (f" ({text})" if text else "") + ".",
                        evidence=ev, data={"delivering": False}, items=sorted(incidents),
                        action="Check SLACK_BOT_TOKEN and the channel in the monitor's monitor.env; its outbox drains "
                               "by itself once Slack takes it.")
        if incidents:
            text = "; ".join(f"{k}: {clean(v.get('summary'), 100)}" for k, v in list(incidents.items())[:4])
            return warn(f"The Hermes {label} monitor has {len(incidents)} open incident(s): {text}.", evidence=ev,
                        data={"delivering": True}, items=sorted(incidents))
        return ok(f"The Hermes {label} monitor ticked {ago(age)} ago; all {m.get('checks')} checks ok.", evidence=ev,
                  data={"delivering": True})

    return run


def run_deadman(ctx: Context) -> Result:
    mons = ctx.snap_part("monitors")
    beats = {k: v for k, v in mons.items() if isinstance(v, dict) and "beat_last_ok" in v}
    if not beats:
        raise SourceError("no Hermes monitor's heartbeat could be read")
    ages = {k: age_min(v.get("beat_last_ok"), ctx.now) for k, v in sorted(beats.items())}
    blind = [k for k, a in ages.items() if a is None or a > BEAT_LATE_MIN]
    writes = (len(beats) + 1) * BEATS_A_DAY  # the monitors' beats and the worker's watcher key
    ev = {"beat_age_min": ages, "beat_failures": {k: beats[k].get("beat_failures") for k in ages},
          "kv_writes_a_day": writes, "kv_free_limit": KV_FREE_WRITES_A_DAY}
    action = ("Either move the Cloudflare account to Workers Paid ($5 a month, 1 million KV writes), or beat every 10 "
              "minutes with the dead-man limit at 20 (monitor.py heartbeat_every_min, deadman-worker.mjs STALE_S, and "
              "its watcher key written only when it changes).")
    budget = (f"Cloudflare's free plan takes {KV_FREE_WRITES_A_DAY:,} storage writes a day and the monitors and the "
              f"dead-man worker write about {writes:,}")
    if blind:
        worst = max((ages[k] for k in blind if ages[k] is not None), default=None)
        return warn(f"The dead-man switch is blind: {len(blind)} of {len(ages)} Hermes monitor heartbeats have not "
                    f"reached Cloudflare for {ago(worst)} ({', '.join(blind)}). {budget}, so every beat is refused "
                    "until 00:00 UTC, and a stopped monitor or a dead VPS would go unnoticed until then.",
                    items=blind, evidence=ev, action=action)
    if writes > KV_FREE_WRITES_A_DAY:
        return warn(f"The heartbeats reach Cloudflare now, but {budget}, so they will be refused later today (the "
                    "free count resets at 00:00 UTC) and the dead-man switch goes blind until then.",
                    evidence=ev, action=action)
    return ok(f"Every Hermes monitor heartbeat reached Cloudflare in the last {BEAT_LATE_MIN} min, within the free "
              "daily write limit.", evidence=ev)


def run_jobs(ctx: Context) -> Result:
    jobs = ctx.snap_part("hermes_jobs")
    if not isinstance(jobs, list) or not jobs:
        raise SourceError("Hermes's jobs file is empty")
    failing = [j for j in jobs if j.get("enabled") and j.get("last_status") not in ("ok", None)]
    off = [j["name"] for j in jobs if not j.get("enabled")]
    ev = {"jobs": len(jobs), "failing": [{"name": j["name"], "error": clean(j.get("last_error"), 120),
                                          "last_run_at": j.get("last_run_at")} for j in failing], "switched_off": off}
    if failing:
        text = "; ".join(f"{j['name']} ({clean(j.get('last_error'), 60)})" for j in failing[:4])
        return warn(f"{len(failing)} Hermes scheduled job(s) failed their last run: {text}.", evidence=ev)
    return ok(f"All {len(jobs) - len(off)} enabled Hermes jobs passed their last run ({len(off)} switched off).", evidence=ev)


def run_backup(ctx: Context) -> Result:
    mons = ctx.snap_part("monitors")
    sites = mons.get("public-sites") or {}
    inc = (sites.get("incidents") or {}).get("backup-vps")
    try:
        jobs = ctx.snap_part("hermes_jobs")
    except SourceError:
        jobs = []
    nightly = next((j for j in jobs if "backup" in str(j.get("name", "")).lower()), None)
    ev = {"monitor": (inc or {}).get("summary"), "nightly": nightly and {k: nightly.get(k) for k in ("last_status", "last_run_at")}}
    if inc or (nightly and nightly.get("last_status") == "error"):
        what = clean((inc or {}).get("summary") or "the last backup failed", 120)
        err = f" The Nightly Backup job's last run ended with: {clean(nightly.get('last_error'), 80)}." if nightly and nightly.get("last_status") == "error" else ""
        return fail(f"The VPS backup is old: {what}.{err}", since=parse_time((inc or {}).get("opened")), evidence=ev)
    return ok("The VPS backup is current.", evidence=ev)


CHECKS = [
    Check(id="hermes-monitor-cockpits", area="monitors", name="Hermes cockpit monitor",
          means="The per-minute Hermes reliability monitor for the cockpits keeps ticking.", severity="high",
          reads="/docker/hermes-agent-ff5p/data/portal-monitor/state/mahara-cockpits/state.json (last_tick, incidents)",
          threshold=f"No tick for {TICK_LIMIT_MIN} min, or an alert undelivered for {OUTBOX_STUCK_MIN} min: fail; open "
                    "incidents: listed (it alerts on its own).",
          run=monitor_check("mahara-cockpits", "cockpits"), quiet_because="hermes", owner="Hermes",
          action="Check Hermes job f0bb4f23a170 (Reliability monitor: Mahara cockpits)."),
    Check(id="hermes-monitor-sites", area="monitors", name="Hermes public sites monitor",
          means="The per-minute monitor for public sites, TLS and backups keeps ticking.", severity="high",
          reads=".../state/public-sites/state.json",
          threshold=f"No tick for {TICK_LIMIT_MIN} min, or an alert undelivered for {OUTBOX_STUCK_MIN} min: fail; open "
                    "incidents: listed.",
          run=monitor_check("public-sites", "public sites"), quiet_because="hermes", owner="Hermes",
          action="Check Hermes job cd922bc5e4d6 (Public sites, TLS and backups)."),
    Check(id="hermes-monitor-portal", area="monitors", name="Hermes portal monitor",
          means="The per-minute Hermes monitor for the client portal keeps ticking and delivering.", severity="high",
          reads=".../state/state.json (last_tick, incidents, outbox)",
          threshold=f"No tick for {TICK_LIMIT_MIN} min, or an alert undelivered for {OUTBOX_STUCK_MIN} min: fail; open "
                    "incidents: listed.",
          run=monitor_check("portal", "portal"), quiet_because="hermes", owner="Hermes",
          action="Check the Hermes reliability monitor job for the portal."),
    Check(id="hermes-monitor-dialer", area="monitors", name="Hermes dialer monitor",
          means="The per-minute Hermes monitor for the dialer (the clients' call centre) keeps ticking and delivering.",
          severity="high", reads=".../state/dialer/state.json (last_tick, incidents, outbox)",
          threshold=f"No tick for {TICK_LIMIT_MIN} min, or an alert undelivered for {OUTBOX_STUCK_MIN} min: fail; open "
                    "incidents: listed.",
          run=monitor_check("dialer", "dialer"), quiet_because="hermes", owner="Hermes",
          action="Check the Hermes reliability monitor job for the dialer."),
    Check(id="deadman-beats", area="monitors", name="Dead-man heartbeats",
          means="The Hermes monitors' heartbeats reach the Cloudflare dead-man switch, so a stopped monitor or a dead "
                "VPS would be noticed.",
          severity="medium", reads=".../state/*/state.json (heartbeat.last_ok, failures) for every monitor",
          threshold=f"A beat older than {BEAT_LATE_MIN} min, or more KV writes a day than the free plan allows: warn.",
          run=run_deadman, owner="the CEO", clear=2,
          action="Workers Paid on the Cloudflare account, or fewer beats (see the warning)."),
    Check(id="hermes-jobs", area="monitors", name="Hermes scheduled jobs",
          means="Hermes's own scheduled jobs pass.", severity="low", reads="/opt/data/cron/jobs.json (last_status, last_error)",
          threshold="An enabled job whose last run failed: warn (the Cron guardian job already watches these).",
          run=run_jobs, quiet_because="hermes", owner="Hermes", action="Read the job's last_error in Hermes."),
    Check(id="vps-backup", area="monitors", name="VPS backup", means="The VPS is backed up to GitHub nightly.",
          severity="medium", reads="The public-sites monitor's backup-vps incident and the Nightly Backup job",
          threshold="Either says the backup failed or is old: fail.", run=run_backup, quiet_because="hermes",
          owner="Hermes", action="Run the Nightly Backup job by hand in Hermes and read why it exits with 1."),
]
