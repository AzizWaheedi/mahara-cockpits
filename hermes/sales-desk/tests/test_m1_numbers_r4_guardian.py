"""Milestone 1, video-link round 4, NUMBERS AND RECORDS: the guardian's
live-calls checks (hermes/cockpit-guardian/checks/live_calls.py) read the
truth about the parts the video link needs, with the pilot's switches.

The guardian is the voice when the SQL watchdog's alerts do not reach Slack
(engine.covered: live-status-rows and live-rooms-worker are quiet only while
live-alerts says the watchdog is posting). So its sentences must hold on
their own:

  A. the room host check (sales-desk/room-hosts, every 10 minutes on the VPS:
     each seat's Zoom status and the Google sign-in, read by room.create's
     provider check) that stopped hours ago is not "Every live-calls part
     reports ok": the watchdog calls it stale after 20 minutes ("Zoom seats
     and Google sign-ins are not being checked, so a room may fail without
     warning"), the Team page after 20 minutes; the guardian reads only
     whether the row exists and says ok;
  B. a room worker that stopped hours ago, whose last row said ok false
     (a fault it rode out), is said as a worker that stopped ("has not
     reported for ...; new video rooms cannot be made"), never as one that
     "reports a failure" now.

A test that fails here is a finding; tests named "control" pass.

    cd hermes/sales-desk && python3 -m unittest tests.test_m1_numbers_r4_guardian
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
from guard.model import OK  # noqa: E402

_spec = importlib.util.spec_from_file_location("guardian_fakes_m1num4", GUARDIAN / "tests" / "fakes.py")
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

# desk/rooms.py sentence() for a run that rode out one database blip (ok false).
DB_BLIP = ("Working. In the last 60 seconds: 3 rooms made (0 Zoom, 3 Meet), 0 failed, 0 closed. "
           "The database did not answer 1 time; the worker kept trying.")


def pilot_rows(**over):
    """Every part Milestone 1 runs has reported, fresh (round 2's fixture)."""
    rows = {
        ("sales-desk", "rooms"): {"ok": True, "detail": "Working.", "at": fakes.ago(0.2)},
        ("sales-desk", "room-hosts"): {"ok": True, "detail": "2 seats checked.", "at": fakes.ago(4)},
        ("sales-desk", "slack"): {"ok": True, "detail": "Slack is switched off.", "at": fakes.ago(0.5)},
        ("sales-desk", "waves"): {"ok": True, "detail": "The follow-up agent is switched off.", "at": fakes.ago(2)},
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


class HostCheckThatStopped(unittest.TestCase):
    def test_control_every_part_fresh_reads_ok(self):
        out = scan(pilot(pilot_rows()))
        self.assertEqual(out["live-status-rows"].status, OK, out["live-status-rows"].summary)

    def test_a_host_check_that_stopped_three_hours_ago_is_not_every_part_reports_ok(self):
        out = scan(pilot(pilot_rows(**{"sales-desk__room-hosts": {"at": fakes.ago(180)}})))
        said = {cid: (r.status, r.summary) for cid, r in out.items() if cid.startswith("live-")}
        # Some live-calls check says the host check is late; none says every part is ok while it is.
        late = [cid for cid, (st, s) in said.items() if st != OK and ("room-hosts" in s or "host check" in s.lower())]
        self.assertTrue(late, f"no live-calls check reads the host check's 3-hour-old row: {said['live-status-rows']}")


class WorkerThatStopped(unittest.TestCase):
    def test_control_a_worker_that_stopped_hours_ago_on_an_ok_row_has_not_reported(self):
        out = scan(pilot(pilot_rows(**{"sales-desk__rooms": {"at": fakes.ago(180)}})))
        self.assertIn("has not reported for", out["live-rooms-worker"].summary)

    def test_a_worker_that_stopped_hours_ago_after_a_fault_it_rode_out_is_said_as_stopped(self):
        out = scan(pilot(pilot_rows(**{"sales-desk__rooms": {"ok": False, "detail": DB_BLIP, "at": fakes.ago(180)}})))
        s = out["live-rooms-worker"].summary
        self.assertIn("has not reported for", s, f"the guardian says: {s}")


if __name__ == "__main__":
    unittest.main()
