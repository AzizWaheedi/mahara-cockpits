"""Milestone 1, video-link round 4 (again), NUMBERS AND RECORDS: the
guardian's room worker check (hermes/cockpit-guardian/checks/live_calls.py
run_worker) reads the truth about a worker that is making rooms.

The room worker's status row is ok false whenever a run rode out a fault
(desk/rooms.py sentence(): "Working. In the last 60 seconds: 3 rooms made
... The database did not answer 1 time; the worker kept trying."). The SQL
watchdog says such a row as "Some rooms or links may fail; read the detail"
(m1 round 3, watchdog-says-rooms-cannot-be-made-while-worker-makes-them), the
Team page as an owed line with "If a room fails, make it on the other
provider" (m1 round 4), and the health line as trouble, never down. The
guardian reads only ok: a fresh ok false row is a FAIL of its critical
check, made urgent while rooms are switched on (URGENT_WHEN_ON), so a
passing database blip pages someone at night as a failing room worker.

A test that fails here is a finding; tests named "control" pass.

    cd hermes/sales-desk && python3 -m unittest tests.test_m1_numbers_r4b_guardian
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
from guard.model import FAIL  # noqa: E402

_spec = importlib.util.spec_from_file_location("guardian_fakes_m1num4b", GUARDIAN / "tests" / "fakes.py")
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
# desk/rooms.py NOT_MAKING: the worker runs and makes no room.
NOT_MAKING = ("Not making rooms: The rooms setting could not be read, so no new room is made until it can be. "
              "Working. No rooms were asked for in the last 60 seconds.")


def pilot_rows(**over):
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


class WorkerMakingRooms(unittest.TestCase):
    def test_control_a_worker_that_makes_no_rooms_is_an_urgent_failure(self):
        r = scan(pilot(pilot_rows(**{"sales-desk__rooms": {"ok": False, "detail": NOT_MAKING, "at": fakes.ago(0.3)}})))["live-rooms-worker"]
        self.assertEqual((r.status, bool(r.urgent)), (FAIL, True), r.summary)

    def test_a_worker_that_made_3_rooms_and_rode_out_one_database_blip_is_no_urgent_failure(self):
        r = scan(pilot(pilot_rows(**{"sales-desk__rooms": {"ok": False, "detail": DB_BLIP, "at": fakes.ago(0.3)}})))["live-rooms-worker"]
        # The watchdog and the Team page say this worker runs with a problem;
        # the guardian must not page it at night as a failing room worker.
        self.assertFalse(r.status == FAIL and bool(r.urgent), f"{r.status} urgent={r.urgent}: {r.summary}")


if __name__ == "__main__":
    unittest.main()
