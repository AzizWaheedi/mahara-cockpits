"""Memory, leftover tunnels, disk and the VPS code copy (catalogue H7, H8, H11)."""
from __future__ import annotations

from guard import fixes
from guard.context import Context, SourceError
from guard.jobs import HERMES_LOGS
from guard.model import Check, Result, fail, ok, parse_time, warn

MEM_FAIL_MB = 700
MEM_WARN_MB = 1024
DISK_WARN = 85.0
DISK_FAIL = 90.0
LOG_BIG = 50 * 1024 * 1024
TUNNELS_WARN = 50


def _top(procs: dict) -> str:
    top = (procs or {}).get("top") or []
    return ", ".join(f"{t['name']} ({t['user']}, {t['rss_mb']} MB)" for t in top[:3])


def run_memory(ctx: Context) -> Result:
    mem = ctx.snap_part("mem")
    if "MemAvailable" not in mem:
        raise SourceError("MemAvailable is missing from /proc/meminfo")
    avail = mem["MemAvailable"] // 1024
    total = mem.get("MemTotal", 0) // 1024
    swap = mem.get("SwapTotal", 0) // 1024
    try:
        procs = ctx.snap_part("procs")
    except SourceError:
        procs = {}
    tunnels = (procs.get("cloudflared") or {}) if isinstance(procs, dict) else {}
    ev = {"available_mb": avail, "total_mb": total, "swap_mb": swap, "top": (procs or {}).get("top"),
          "cloudflared": tunnels.get("n")}
    swap_note = "no swap" if not swap else f"{swap} MB swap"
    largest = _top(procs)
    extra = f" {tunnels['n']} cloudflared processes hold about {tunnels['rss_kb'] // 1024} MB." if tunnels.get("n", 0) > TUNNELS_WARN else ""
    text = (f"The VPS has {avail} MB of memory available out of {total} MB ({swap_note}); jobs may be killed."
            f" Largest: {largest}.{extra}")
    if avail < MEM_FAIL_MB:
        return fail(text, evidence=ev)
    if avail < MEM_WARN_MB:
        return warn(text, evidence=ev)
    return ok(f"The VPS has {avail} MB of memory available out of {total} MB.", evidence=ev)


def run_tunnels(ctx: Context) -> Result:
    procs = ctx.snap_part("procs")
    t = procs.get("cloudflared") or {}
    n = int(t.get("n") or 0)
    hist = ctx.state.setdefault("history", {}).setdefault("cloudflared", [])
    prev = hist[-1][1] if hist else None
    hist.append([ctx.now.isoformat(), n])
    del hist[:-12]
    ev = {"count": n, "rss_mb": int(t.get("rss_kb") or 0) // 1024, "by_user": t.get("users"), "previous": prev}
    if n > TUNNELS_WARN:
        rising = f", up from {prev} at the last scan" if prev is not None and n > prev else ""
        return warn(f"{n} cloudflared processes run on the VPS{rising}, holding about {ev['rss_mb']} MB. Hermes's gateway "
                    "tunnel watchdog starts a new tunnel whenever its kill -0 check cannot see the old one.", evidence=ev)
    return ok(f"{n} cloudflared process(es) run on the VPS.", evidence=ev)


def run_disk(ctx: Context) -> Result:
    d = ctx.snap_part("disk")
    pct = float(d.get("pct") or 0)
    files = ctx.snap_part("files") or {}
    big = {p: round((i or {}).get("size", 0) / 1e6) for p, i in files.items()
           if p in HERMES_LOGS and i and int(i.get("size") or 0) > LOG_BIG}
    ev = {"pct": pct, "avail_gb": d.get("avail_gb"), "big_logs_mb": big}
    if pct > DISK_FAIL:
        return fail(f"The VPS disk is {pct}% full ({d.get('avail_gb')} GB free).", evidence=ev,
                    data={"rotate": bool(big)})
    if pct > DISK_WARN:
        return warn(f"The VPS disk is {pct}% full ({d.get('avail_gb')} GB free).", evidence=ev, data={"rotate": bool(big)})
    if big and pct > fixes.ROTATE_DISK_PCT:
        return warn(f"The disk is {pct}% full and {len(big)} hermes log(s) are over 50 MB.", evidence=ev, data={"rotate": True})
    return ok(f"The VPS disk is {pct}% full ({d.get('avail_gb')} GB free).", evidence=ev)


def run_code_copy(ctx: Context) -> Result:
    g = ctx.snap_part("git")
    t = parse_time(g.get("date"))
    days = (ctx.now - t).days if t else None
    ev = {"head": g.get("head"), "date": g.get("date"), "dirty": g.get("dirty")}
    if (days is not None and days > 7) or int(g.get("dirty") or 0) > 0:
        return warn(f"The VPS copy of the code is on {g.get('head')} ({days if days is not None else '?'} days old) with "
                    f"{g.get('dirty')} local change(s); workers there were copied by scp, not pulled.", evidence=ev)
    return ok(f"The VPS copy of the code is on {g.get('head')} with no local changes.", evidence=ev)


CHECKS = [
    Check(
        id="vps-memory", area="vps", name="VPS memory", catalogue="H7",
        means="The VPS has enough free memory that no job is killed for the lack of it.",
        severity="high", reads="/proc/meminfo MemAvailable and the largest processes by user",
        threshold=f"Under {MEM_WARN_MB} MB available: warn; under {MEM_FAIL_MB} MB: fail; 3 scans in a row.",
        run=run_memory, confirm=3,
        action="Add swap, or stop the leftover cloudflared tunnels and restart the largest process.",
    ),
    Check(
        id="vps-tunnels", area="vps", name="Leftover cloudflared tunnels",
        means="Hermes's gateway keeps one tunnel, not hundreds of leftovers.",
        severity="medium", reads="Count and memory of cloudflared processes, compared with the last scan",
        threshold=f"More than {TUNNELS_WARN}: warn.", run=run_tunnels, owner="Hermes",
        action="Stop the leftover cloudflared processes and fix the gateway tunnel watchdog's kill -0 check (it cannot see a tunnel another user started).",
    ),
    Check(
        id="vps-disk", area="vps", name="VPS disk", catalogue="H8",
        means="The VPS disk has room; a full disk once wiped the Mac's Vercel login.",
        severity="high", reads="statvfs('/') and the size of hermes's cron logs",
        threshold=f"Over {DISK_WARN:.0f}%: warn; over {DISK_FAIL:.0f}%: fail.",
        run=run_disk, fix=fixes.ROTATE_LOGS,
        action="Free space on the VPS; the largest folders are the place to start (du -xh / | sort -h | tail).",
    ),
    Check(
        id="vps-code-copy", area="vps", name="VPS code copy", catalogue="H11",
        means="The repo copy on the VPS is current and clean.",
        severity="low", reads="git log -1 and git status --porcelain in ~/mahara-cockpits",
        threshold="Older than 7 days or any local change: warn (daily summary only).", run=run_code_copy,
        alert=False, action="Copy the worker changes into git from the VPS, then bring the copy up to date by hand. Never reset it.",
    ),
]
