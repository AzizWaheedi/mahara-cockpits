"""Milestone 1, video-link round 6, NUMBERS AND RECORDS: the guardian's
"Live calls: status rows" check (hermes/cockpit-guardian/checks/live_calls.py
run_status_rows) reads the truth about the video-link path.

Milestone 1 is the video link when a call fails (m1-scope.md): the room
worker, the host check, sales-live's Zoom webhook and the sweep's door. The
follow-up agent's waves are fenced off (followups.agent off), and nothing on
the video-link path asks the drafting model. The guardian still counts the
desk's drafting model row (sales-desk/model, written by the follow-up
drafter's probe) and the waves row as live-calls parts, so a model that does
not answer (the VPS Claude sign-in lapsing, as it has) turns "Live calls:
status rows" into a FAIL ("Live-calls parts report failures") on the first
day of the pilot, while every part of the video-link path works.

The SQL watchdog says the model's row as its own desk alert ("The drafting
model ... Nothing that needs the model can be drafted"), which is true; the
live-calls check says the video-link machinery fails, which is not.

A test that fails here is a finding; tests named "control" pass.

    cd hermes/sales-desk && python3 -m unittest tests.test_m1_numbers_r6_guardian
"""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

GUARDIAN = Path(__file__).resolve().parents[2] / "cockpit-guardian"
if str(GUARDIAN) not in sys.path:
    sys.path.insert(0, str(GUARDIAN))

from checks import live_calls  # noqa: E402
from guard import engine  # noqa: E402
from guard.model import FAIL, OK  # noqa: E402

_spec = importlib.util.spec_from_file_location("guardian_fakes_m1num6", GUARDIAN / "tests" / "fakes.py")
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

# desk.py _model_status for a probe that found the Claude sign-in lapsed.
MODEL_DOWN = ("The model did not answer: the Claude sign-in on the VPS has lapsed (run claude, then /login). "
              "Not answering since 2026-10-06 07:07 UTC")


def pilot_rows(**over):
    rows = {
        ("sales-desk", "rooms"): {"ok": True, "detail": "Working.", "at": fakes.ago(0.2)},
        ("sales-desk", "room-hosts"): {"ok": True, "detail": "2 seats checked.", "at": fakes.ago(4)},
        ("sales-desk", "slack"): {"ok": True, "detail": "Slack is switched off.", "at": fakes.ago(0.5)},
        ("sales-desk", "waves"): {"ok": True, "detail": "The follow-up agent's own sends are switched off.", "at": fakes.ago(2)},
        ("sales-desk", "model"): {"ok": True, "detail": "", "at": fakes.ago(20)},
        ("sales-desk", "followups"): {"ok": True, "detail": "", "at": fakes.ago(20)},
        ("sales-desk", "doctor"): {"ok": True, "detail": "", "at": fakes.ago(30)},
        ("sales-live", "zoom"): {"ok": True, "detail": "Zoom validated this endpoint.", "at": fakes.ago(30)},
        ("sales-live", "cron"): {"ok": True, "detail": "", "at": fakes.ago(1)},
        ("sales-api", "sweep"): {"ok": True, "detail": "", "at": fakes.ago(0.5)},
        ("sales-api", "watchdog"): {"ok": True, "detail": "0 open alerts.", "at": fakes.ago(3)},
    }
    for k, v in over.items():
        rows[tuple(k.split("__"))].update(v)
    return [{"worker": w, "job": j, **v} for (w, j), v in rows.items()]


def pilot(rows):
    tmp = Path(tempfile.mkdtemp())
    settings = [{"key": "rooms", "value": PILOT_ROOMS}, {"key": "live", "value": PILOT_LIVE}]
    db = fakes.FakeDb({"cockpit_sales_worker_status": rows, "cockpit_sales_settings": settings, "cockpit_sales_alerts": []},
                      probe={"cron_jobs": [{"jobid": i, "jobname": n, "active": True} for i, n in enumerate(live_calls.CRON_JOBS)]})
    return fakes.ctx(tmp, db=db, host=fakes.FakeHost(fakes.snapshot(rooms={"file": True, "unit": ""})),
                     resolve=lambda h: True, web=fakes.FakeWeb({HEALTH: fakes.resp(200), "https://call.maharamedia.com/": fakes.resp(200)}))


def scan(ctx):
    return {f.check.id: f.result for f in engine.run_checks(ctx, live_calls.CHECKS)}


class StatusRowsOfTheVideoLinkPath(unittest.TestCase):
    def test_control_every_part_reports_ok_and_the_check_is_ok(self):
        r = scan(pilot(pilot_rows()))["live-status-rows"]
        self.assertEqual(r.status, OK, r.summary)

    def test_control_the_host_check_failing_is_a_live_calls_failure(self):
        r = scan(pilot(pilot_rows(**{"sales-desk__room-hosts": {"ok": False, "detail": "Google refused the sign-in.", "at": fakes.ago(3)}})))["live-status-rows"]
        self.assertEqual(r.status, FAIL, r.summary)

    def test_the_drafting_model_down_is_no_failure_of_the_video_link_path(self):
        r = scan(pilot(pilot_rows(**{"sales-desk__model": {"ok": False, "detail": MODEL_DOWN, "at": fakes.ago(20)}})))["live-status-rows"]
        # Found: "Live-calls parts report failures: sales-desk/model (...)":
        # the video link never asks the model, and every part it uses works.
        self.assertNotEqual(r.status, FAIL, r.summary)

    def test_the_fenced_wave_run_failing_is_no_failure_of_the_video_link_path(self):
        r = scan(pilot(pilot_rows(**{"sales-desk__waves": {"ok": False, "detail": "The waves job stopped: HighLevel did not answer.",
                                                           "at": fakes.ago(2)}})))["live-status-rows"]
        # Waves are fenced off in Milestone 1 (followups.agent off).
        self.assertNotEqual(r.status, FAIL, r.summary)


if __name__ == "__main__":
    unittest.main()
