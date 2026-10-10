#!/usr/bin/env python3
"""The team-hours lines of scripts/verify-preserved.py: green before the first deploy, strict after it.
Offline: a fake management API answers; no key, no network."""
from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import preserve_scenarios as ps  # noqa: E402

VP = ps.VP
SMAN = json.loads(VP.SB_MANIFEST.read_text(encoding="utf-8"))


class FakeMgmt:
    def __init__(self, rows, jobs, functions):
        self.rows, self.jobs, self.fns = rows, jobs, functions

    def sql(self, query, label):
        return self.jobs if label == "cron" else self.rows

    def functions(self):
        return self.fns


def deployed_rows(th, **override):
    rows = [{"kind": "table", "name": t, "rls": True, "browser": False, "service": t not in th["no_grant_tables"]} for t in th["tables"]]
    rows += [{"kind": "function", "name": f, "rls": None, "browser": f in th["ceo_functions"], "service": True} for f in th["functions"]]
    rows += [{"kind": "trigger", "name": t, "rls": None, "browser": None, "service": None} for t in th["triggers"]]
    for r in rows:
        r.update(override.get(r["name"], {}))
    return rows


def run(man, mg):
    rep = VP.Report()
    VP.check_team_hours(rep, mg, man)
    return rep


class TeamHours(unittest.TestCase):
    def test_pending_is_green_when_nothing_is_there(self):
        man = copy.deepcopy(SMAN)
        man["team_hours"]["state"] = "pending_deploy"
        rep = run(man, FakeMgmt([], [], []))
        self.assertTrue(rep.rows)
        self.assertEqual({r["status"] for r in rep.rows}, {VP.OK})
        self.assertTrue(all("not deployed yet" in r["detail"] for r in rep.rows))

    def test_deployed_and_right_is_green(self):
        man = copy.deepcopy(SMAN)
        th = man["team_hours"]
        th["state"] = "deployed"
        jobs = [{"jobname": j["jobname"], "schedule": j["schedule"], "active": True, "command_md5": "x"} for j in th["pg_cron"]]
        fns = [{"slug": e["slug"], "status": "ACTIVE", "version": 1, "verify_jwt": e["verify_jwt"]} for e in th["edge_functions"]]
        rep = run(man, FakeMgmt(deployed_rows(th), jobs, fns))
        self.assertEqual({r["status"] for r in rep.rows}, {VP.OK})

    def test_deployed_then_lost_or_drifted_fails(self):
        man = copy.deepcopy(SMAN)
        th = man["team_hours"]
        th["state"] = "deployed"
        rows = [r for r in deployed_rows(th, cockpit_hours_keys={"service": True}, cockpit_hours_sync_apply={"browser": True})
                if r["name"] != "cockpit_hours_pay_months"]
        fns = [{"slug": "cockpit-hours-sync", "status": "ACTIVE", "version": 2, "verify_jwt": True}]
        rep = run(man, FakeMgmt(rows, [], fns))
        bad = {r["check"]: r["status"] for r in rep.rows if r["status"] != VP.OK}
        self.assertEqual(bad["team-hours table cockpit_hours_pay_months"], VP.MISSING)
        self.assertEqual(bad["team-hours table cockpit_hours_keys"], VP.CHANGED)
        self.assertEqual(bad["team-hours function cockpit_hours_sync_apply"], VP.CHANGED)
        self.assertEqual(bad["team-hours Edge Function cockpit-hours-sync"], VP.CHANGED)
        self.assertEqual(bad["team-hours Edge Function cockpit-hours-api"], VP.MISSING)
        self.assertEqual(bad["team-hours pg_cron mahara-hours-sync"], VP.MISSING)
        verdict, code, _ = rep.verdict()
        self.assertEqual((verdict, code), ("FAIL", 1))

    def test_a_jwt_check_turned_on_before_the_state_flips_is_still_caught(self):
        fns = [{"slug": "cockpit-hours-sync", "status": "ACTIVE", "version": 1, "verify_jwt": True}]
        rep = run(SMAN, FakeMgmt([], [], fns))
        self.assertEqual([r["status"] for r in rep.rows if r["check"] == "team-hours Edge Function cockpit-hours-sync"], [VP.CHANGED])


if __name__ == "__main__":
    unittest.main()
