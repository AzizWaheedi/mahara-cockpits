"""Milestone 1, video-link round 2, NUMBERS AND RECORDS: the guardian's
live-calls status-rows check (hermes/cockpit-guardian/checks/live_calls.py
run_status_rows) on the rows the Milestone 1 deploy really writes.

Round 1's pilot fixture seeded a ("sales-desk", "watch") row. Nothing in
this repo writes one: the desk's jobs are rooms, room-hosts (desk/rooms.py),
slack (desk/slackpost.py), waves, followups, model and doctor (desk.py);
"The reply watcher" (the watchdog's label for sales-desk/watch) belongs to
the reply alerts of a later project, whose actions (reply.seen,
thread.tick) answer "not built yet" in Milestone 1. The SQL watchdog
watches that row only once it exists (switch_on null), so it stays quiet;
the guardian expects it always.

What must hold: with every part Milestone 1 uses reporting, the guardian
reads quiet, and never names a part that does not exist as "not reported
yet".

A test that fails here is a finding; tests named "control" pass.

    cd hermes/sales-desk && python3 -m unittest tests.test_m1_numbers_r2_guardian
"""
from __future__ import annotations

import importlib.util
import re
import sys
import tempfile
import unittest
from pathlib import Path

GUARDIAN = Path(__file__).resolve().parents[2] / "cockpit-guardian"
DESK = Path(__file__).resolve().parents[1]
if str(GUARDIAN) not in sys.path:
    sys.path.insert(0, str(GUARDIAN))

from checks import live_calls  # noqa: E402
from guard import engine  # noqa: E402
from guard.model import OK  # noqa: E402

_spec = importlib.util.spec_from_file_location("guardian_fakes_m1num2", GUARDIAN / "tests" / "fakes.py")
fakes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fakes)  # type: ignore[union-attr]

HEALTH = "https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/health"

PILOT_ROOMS = {
    "enabled": True, "test_only": True, "test_contacts": ["VjPfR4Cc1Y0OFvaqeor5"],
    "providers": {"meet": True, "zoom": True},
    "send": {"whatsapp_text": True, "whatsapp_template": True, "email": True},
    "count_on_join": False, "settle": False, "wrap": False, "short_link": False,
    "fallback": {"auto_on_miss": False, "scope": "intro"},
}
PILOT_LIVE = {"enabled": False, "slack": False}


def desk_jobs() -> set[str]:
    """Every sales-desk status job the desk's code writes (desk.py _status and
    the modules' JOB constants), read from the source so the fixture cannot
    claim a row nothing writes."""
    jobs: set[str] = set()
    src = (DESK / "desk.py").read_text()
    jobs |= set(re.findall(r'_status\(cfg, log, "([a-z-]+)"', src))
    jobs |= set(re.findall(r'worker_status\(WORKER, "([a-z-]+)"', src))
    for mod in (DESK / "desk").glob("*.py"):
        jobs |= set(re.findall(r'^(?:[A-Z_]*JOB) = "([a-z-]+)"', mod.read_text(), flags=re.M))
    return jobs


def pilot_rows():
    """The pilot's first working hour: every part Milestone 1 runs has reported
    (the room worker, its host check and Slack poster, the waves run, the
    drafting model, Zoom's validation of the webhook, the sweep's posts, the
    watchdog); nothing else."""
    return [
        {"worker": "sales-desk", "job": "rooms", "ok": True, "detail": "Working.", "at": fakes.ago(0.2)},
        {"worker": "sales-desk", "job": "room-hosts", "ok": True, "detail": "2 seats checked.", "at": fakes.ago(4)},
        {"worker": "sales-desk", "job": "slack", "ok": True, "detail": "Slack is switched off.", "at": fakes.ago(0.5)},
        {"worker": "sales-desk", "job": "waves", "ok": True, "detail": "The follow-up agent is switched off.", "at": fakes.ago(2)},
        {"worker": "sales-desk", "job": "model", "ok": True, "detail": "", "at": fakes.ago(20)},
        {"worker": "sales-desk", "job": "followups", "ok": True, "detail": "", "at": fakes.ago(20)},
        {"worker": "sales-desk", "job": "doctor", "ok": True, "detail": "", "at": fakes.ago(30)},
        {"worker": "sales-live", "job": "zoom", "ok": True, "detail": "Zoom validated this endpoint.", "at": fakes.ago(30)},
        {"worker": "sales-live", "job": "cron", "ok": True, "detail": "", "at": fakes.ago(1)},
        {"worker": "sales-api", "job": "sweep", "ok": True, "detail": "", "at": fakes.ago(0.5)},
        {"worker": "sales-api", "job": "watchdog", "ok": True, "detail": "0 open alerts.", "at": fakes.ago(3)},
    ]


def pilot():
    tmp = Path(tempfile.mkdtemp())
    settings = [{"key": "rooms", "value": PILOT_ROOMS}, {"key": "live", "value": PILOT_LIVE}]
    db = fakes.FakeDb({"cockpit_sales_worker_status": pilot_rows(), "cockpit_sales_settings": settings, "cockpit_sales_alerts": []},
                      probe={"cron_jobs": [{"jobid": i, "jobname": n, "active": True} for i, n in enumerate(live_calls.CRON_JOBS)]})
    return fakes.ctx(tmp, db=db, host=fakes.FakeHost(fakes.snapshot(rooms={"file": True, "unit": ""})),
                     resolve=lambda h: True, web=fakes.FakeWeb({HEALTH: fakes.resp(200), "https://call.maharamedia.com/": fakes.resp(200)}))


def scan(ctx):
    return {f.check.id: f.result for f in engine.run_checks(ctx, live_calls.CHECKS)}


class StatusRowsReadTheParts(unittest.TestCase):
    def test_control_the_fixture_claims_only_rows_the_desk_writes(self):
        written = desk_jobs()
        claimed = {r["job"] for r in pilot_rows() if r["worker"] == "sales-desk"}
        self.assertEqual(claimed - written, set(), f"the desk writes {sorted(written)}")

    def test_the_guardian_expects_only_desk_rows_something_writes(self):
        written = desk_jobs()
        expected = set(live_calls.STATUS_ROWS["sales-desk"])
        self.assertEqual(expected - written, set(),
                         "the guardian waits for sales-desk rows no job writes, so it warns for good")

    def test_every_part_milestone_1_runs_reports_and_the_check_reads_quiet(self):
        out = scan(pilot())
        rows = out["live-status-rows"]
        self.assertEqual(rows.status, OK, rows.summary)


if __name__ == "__main__":
    unittest.main()
