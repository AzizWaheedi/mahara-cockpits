"""Every check, one module per area. Order is the order of the report."""
from __future__ import annotations

from guard.model import Check

from . import (claude_proxy, convex, edge_functions, guardian_self, hermes_monitors, keys, live_calls, pg_cron, queues,
               sites, supabase, syncs, vps_cron, vps_resources, whatsapp, worker_status)

# supabase-health runs first: when Creative Triage does not answer it trips the
# breaker, so the rest of the scan does not wait 30 s per read. The live-calls
# readings come before pg_cron, whose missing-function rule reads them.
MODULES = (supabase, guardian_self, claude_proxy, convex, vps_resources, vps_cron, worker_status, syncs, live_calls,
           pg_cron, edge_functions, whatsapp, keys, queues, sites, hermes_monitors)


def all_checks() -> list[Check]:
    out: list[Check] = []
    seen: set[str] = set()
    for m in MODULES:
        for c in m.CHECKS:
            if c.id in seen:
                raise ValueError(f"two checks share the id {c.id}")
            seen.add(c.id)
            out.append(c)
    return out


def by_id() -> dict[str, Check]:
    return {c.id: c for c in all_checks()}
