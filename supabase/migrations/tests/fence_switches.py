"""Turning a fenced switch on inside a stress run that ends in rollback.

Milestone 1 ships rooms.settle, rooms.count_on_join, live.enabled and
followups.agent off, and the database holds them off too: the sweep's S1
settles nothing while rooms.settle is off, the handover claim claims nothing
while live.enabled is off (20261004a). A stress script that tests the logic
behind one of those switches turns it on first, the way the pilot is switched
on (m1-scope.md section 3): a sales manager named in the write's own
transaction (mahara.actor) and as its updated_by, so 20261004a's settings
guard takes it and leaves its settings.switch audit row.

Only ever inside a transaction that rolls back: the manager row, the switch
and the audit row all go with it. Never in a script that commits.
"""
from __future__ import annotations

import json

MANAGER = "stress-switch-manager@stress.invalid"


def lit(v: str) -> str:
    return "'" + str(v).replace("'", "''") + "'"


def switches_on(patches: dict[str, dict], schema: str = "public", manager: str = MANAGER) -> str:
    """SQL that merges each patch into its setting as a named manager, then
    names nobody again for the rest of the run. A nested object in a patch
    replaces the setting's own (jsonb ||), so give it whole."""
    writes = "\n".join(
        f"update {schema}.cockpit_sales_settings\n"
        f"   set value = value || {lit(json.dumps(patch))}::jsonb, updated_by = {lit(manager)}, updated_at = clock_timestamp()\n"
        f" where key = {lit(key)};"
        for key, patch in patches.items())
    return f"""
-- A sales manager turns the switch on, as the pilot is switched on (m1-scope.md section 3).
insert into {schema}.cockpit_sales_people (email, name, role, active, updated_by)
values ({lit(manager)}, 'Stress Manager', 'manager', true, 'stress')
on conflict (email) do update set role = 'manager', active = true;
select set_config('mahara.actor', {lit(manager)}, true);
{writes}
select set_config('mahara.actor', '', true);
"""


LIVE_ON = {"live": {"enabled": True}}
SETTLE_ON = {"rooms": {"settle": True}}
