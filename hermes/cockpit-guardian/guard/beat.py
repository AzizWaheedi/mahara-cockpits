"""The guardian's dead-man heartbeat.

After every full scan on the VPS the guardian PUTs `beat:cockpit-guardian` into
the Cloudflare KV namespace that the Hermes dead-man worker
(/docker/hermes-agent-ff5p/data/portal-monitor/deadman-worker.mjs) reads every
5 minutes. That worker runs on Cloudflare, so it sees what the guardian cannot
see about itself: no beat for 10 minutes (a wiped crontab, a crash at import, a
full disk, the VPS down) or alerts stuck undelivered for 15 minutes (Slack
refusing the token). It posts to #health either way, and it watches a project
from its first beat; to retire the guardian, delete `beat:cockpit-guardian`
and `deadman:cockpit-guardian` from the namespace.

The payload has the shape the Hermes monitors send (monitor.py heartbeat()):
ts and outbox_oldest in epoch seconds, open and outbox as counts.
Keys by name: PORTAL_MONITOR_CF_TOKEN, PORTAL_MONITOR_CF_ACCOUNT,
PORTAL_MONITOR_CF_KV_NAMESPACE (in monitor.env, one of the key files).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Optional

from . import http
from .model import iso, parse_time
from .redact import clean

PROJECT = "cockpit-guardian"
LABEL = "Cockpit guardian"
KEYS = ("PORTAL_MONITOR_CF_TOKEN", "PORTAL_MONITOR_CF_ACCOUNT", "PORTAL_MONITOR_CF_KV_NAMESPACE")


def payload(state: dict[str, Any], now: datetime) -> dict[str, Any]:
    """Open incidents, and the alerts that were due and did not go (with the oldest's time)."""
    due = [parse_time(v) for v in (state.get("due_since") or {}).values()]
    due = [t for t in due if t is not None]
    return {"ts": int(now.timestamp()), "project": PROJECT, "label": LABEL, "open": len(state.get("open") or {}),
            "outbox": len(due), "outbox_oldest": int(min(due).timestamp()) if due else None,
            "last_scan": (state.get("last_scan") or {}).get("at")}


def send(keys: Any, state: dict[str, Any], now: datetime,
         put: Optional[Callable[..., http.Response]] = None) -> dict[str, Any]:
    """PUT the beat; records the result in state["beat"] and returns it. Never raises."""
    rec = dict(state.get("beat") or {})
    rec["at"] = iso(now)
    missing = [k for k in KEYS if not keys.has(k)]
    if missing:
        rec.update(missing=", ".join(missing), error="keys missing")
        state["beat"] = rec
        return rec
    rec.pop("missing", None)
    token, account, ns = (keys.get(k) for k in KEYS)
    url = (f"https://api.cloudflare.com/client/v4/accounts/{account}/storage/kv/namespaces/{ns}"
           f"/values/beat:{PROJECT}")
    try:
        r = (put or http.request)("PUT", url, headers={"Authorization": f"Bearer {token}",
                                                       "Content-Type": "application/json"},
                                  json_body=payload(state, now), timeout=15)
        if r.status == 200:
            rec.update(ok_at=iso(now), error=None)
        else:
            rec["error"] = f"Cloudflare answered {r.status}"
    except http.HttpError as e:
        rec["error"] = clean(e, 160)
    state["beat"] = rec
    return rec
