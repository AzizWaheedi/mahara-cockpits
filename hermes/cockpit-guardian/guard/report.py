"""The plain-English summary: what is broken, what is only watched, what could
not be checked, what is not deployed yet or paused on purpose, and what
cleared. `report --post` sends it to Slack as the 09:00 Kuwait summary."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional

from .model import FAIL, NOT_DEPLOYED, OK, PAUSED, UNKNOWN, WARN, ago, kuwait, parse_time
from .redact import clean

ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def build(state: dict[str, Any], checks: dict[str, Any], now: datetime, *, for_slack: bool = False) -> str:
    scan = state.get("last_scan") or {}
    results: dict[str, Any] = scan.get("results") or {}
    at = parse_time(scan.get("at"))
    lines: list[str] = []
    mode = scan.get("mode", "report-only")
    head = f"Cockpit guardian, {kuwait(now)}"
    if at:
        head += f". Last scan {ago((now - at).total_seconds() / 60)} ago in {mode} mode"
        if scan.get("dry_run"):
            head += " (a dry run: nothing written, nothing posted)"
    lines.append(head + ".")
    if not results:
        lines.append("No scan has run yet, so nothing is known. Run: python3 guardian.py scan")
        return "\n".join(lines)

    open_incs = sorted(state.get("open", {}).values(), key=lambda i: (ORDER.get(i.get("severity"), 9), i.get("first_seen_at") or ""))
    broken = [i for i in open_incs if i.get("level") == FAIL]
    watching = [i for i in open_incs if i.get("level") == WARN]
    unknown_incs = [i for i in open_incs if i.get("level") == UNKNOWN]

    def inc_line(i: dict[str, Any]) -> str:
        since = parse_time(i.get("first_seen_at"))
        if for_slack:
            return clean(f"- {i.get('title')} (since {kuwait(since)}): {i.get('action')} ({i.get('owner')})", 300)
        s = f"- {i.get('title')}: {i.get('detail')} Since {kuwait(since)}."
        attempts = [a for a in i.get("fix_attempts") or [] if not a.get("planned")]
        if attempts:
            s += f" Tried: {attempts[-1].get('fix')} ({'ok' if attempts[-1].get('ok') else 'not done'})."
        s += f" To do ({i.get('owner')}): {i.get('action')}"
        if i.get("alert_note"):
            s += f" [not posted: {i['alert_note']}]"
        return clean(s, 900)

    lines.append("")
    lines.append(f"Broken now ({len(broken)}):" if broken else "Broken now: nothing.")
    lines += [inc_line(i) for i in broken]
    if watching:
        lines.append("")
        lines.append(f"Watching ({len(watching)}):")
        lines += [inc_line(i) for i in watching]

    # Readings that are bad but not (yet) incidents: confirming, or folded into a parent.
    pending = [(cid, r) for cid, r in results.items() if r["status"] in (FAIL, WARN) and cid not in state.get("open", {})]
    if pending and not for_slack:
        lines.append("")
        lines.append("Also reading bad (folded into another incident, or not confirmed yet):")
        for cid, r in pending:
            why = f"part of {r['caused_by']}" if r.get("caused_by") else "waiting for the next scan to confirm"
            lines.append(clean(f"- {checks[cid].name if cid in checks else cid}: {r['summary']} ({why})", 500))

    gaps = [(cid, r) for cid, r in results.items() if r["status"] == UNKNOWN]
    if gaps and for_slack:
        lines.append("")
        lines.append(clean(f"Could not be checked ({len(gaps)}): " + ", ".join(checks[c].name if c in checks else c for c, _ in gaps) + ".", 600))
    elif gaps or unknown_incs:
        lines.append("")
        lines.append(f"Could not be checked ({len(gaps)}):")
        for cid, r in gaps:
            lines.append(clean(f"- {checks[cid].name if cid in checks else cid}: {r['summary']}", 400))

    nd = [(cid, r) for cid, r in results.items() if r["status"] == NOT_DEPLOYED]
    if nd and for_slack:
        lines.append("")
        lines.append(clean("Not deployed yet (not errors): " + ", ".join(checks[c].name if c in checks else c for c, _ in nd) + ".", 600))
    elif nd:
        lines.append("")
        lines.append("Not deployed yet (not errors):")
        for cid, r in nd:
            lines.append(clean(f"- {r['summary']}", 300))

    pz = [(cid, r) for cid, r in results.items() if r["status"] == PAUSED]
    if pz:
        lines.append("")
        lines.append("Paused on purpose:")
        for cid, r in pz:
            lines.append(clean(f"- {r['summary']}", 300))

    day_ago = now - timedelta(hours=24)
    cleared = [i for i in state.get("resolved") or [] if (parse_time(i.get("resolved_at")) or day_ago) > day_ago]
    if cleared:
        lines.append("")
        lines.append(f"Resolved in the last 24 hours ({len(cleared)}):")
        for i in cleared[-10:]:
            lines.append(clean(f"- {i.get('title')}: {i.get('resolved_by')} ({kuwait(parse_time(i.get('resolved_at')))}).", 400))

    fixes = scan.get("fixes") or []
    if fixes:
        lines.append("")
        lines.append("Fixes this scan:" if mode == "fix" and not scan.get("dry_run") else "Fixes it would make in fix mode:")
        lines += [clean(f"- {f}", 300) for f in fixes]

    healthy = sum(1 for r in results.values() if r["status"] == OK)
    lines.append("")
    lines.append(f"Healthy: {healthy} of {len(results)} checks.")
    for n in scan.get("notes") or []:
        lines.append(clean(f"Note: {n}", 300))
    text = "\n".join(lines)
    return text[:3800] + ("\n(cut short; run guardian.py report on the VPS for the rest)" if for_slack and len(text) > 3800 else "")


def daily_due(state: dict[str, Any], now: datetime) -> bool:
    from .model import KUWAIT
    today = now.astimezone(KUWAIT).date().isoformat()
    return state.get("daily_sent") != today


def mark_daily(state: dict[str, Any], now: datetime) -> None:
    from .model import KUWAIT
    state["daily_sent"] = now.astimezone(KUWAIT).date().isoformat()


def as_json(state: dict[str, Any]) -> dict[str, Any]:
    return {"last_scan": state.get("last_scan"), "open": list((state.get("open") or {}).values()),
            "resolved_24h": [i for i in state.get("resolved") or []][-20:]}


__all__ = ["build", "daily_due", "mark_daily", "as_json", "Optional"]
