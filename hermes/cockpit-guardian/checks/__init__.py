"""Every check, one module per area. Order is the order of the report."""
from __future__ import annotations
import os

from guard.model import Check

from . import (claude_proxy, edge_functions, guardian_self, hermes_monitors, keys, live_calls, pg_cron, queues,
               sections, sites, supabase, syncs, vps_cron, vps_resources, whatsapp, worker_status, native)

# supabase-health runs first: when Creative Triage does not answer it trips the
# breaker, so the rest of the scan does not wait 30 s per read. The live-calls
# readings come before pg_cron, whose missing-function rule reads them.
MODULES = (supabase, guardian_self, claude_proxy, sections, vps_resources, vps_cron, worker_status, syncs, live_calls,
           pg_cron, edge_functions, whatsapp, keys, queues, sites, hermes_monitors)


def all_checks(backend: str | None = None) -> list[Check]:
    # Convex is paused and no longer probed, so hybrid and native run the same checks;
    # the setting is still validated so a typo in the env file is caught.
    if backend is None:
        backend=os.environ.get('COCKPIT_MONITOR_BACKEND','hybrid')
    if backend not in ('hybrid','native'):
        raise ValueError('COCKPIT_MONITOR_BACKEND must be hybrid or native')
    out: list[Check] = []
    seen: set[str] = set()
    for m in MODULES+(native,):
        for c in m.CHECKS:
            if c.id in seen:
                raise ValueError(f"two checks share the id {c.id}")
            seen.add(c.id)
            out.append(c)
    return out


def by_id() -> dict[str, Check]:
    return {c.id: c for c in all_checks()}
