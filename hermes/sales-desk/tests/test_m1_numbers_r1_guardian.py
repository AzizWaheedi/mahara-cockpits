"""Milestone 1, video-link round 1, NUMBERS AND RECORDS: the guardian's
live-calls checks (hermes/cockpit-guardian/checks/live_calls.py) read with
the pilot switched on as m1-scope.md section 3 sets it.

The pilot: rooms.enabled true, test_only true, Meet and Zoom on, every send
channel on, rooms.short_link FALSE "until the call site is deployed" (the
CNAME for call.maharamedia.com waits for the CEO, so the messages carry the
room link itself), live.enabled and live.slack false (Slack fenced off, so
SLACK_SIGNING_SECRET is not set on sales-live and /slack answers 503).

What must hold: the guardian reads the truth. A part Milestone 1 does not
use (the short link page, Slack) is never the reason for an urgent alert,
and never the reason the guardian tells a person to switch rooms off.

A test that fails here is a finding; tests named "control" pass.

    cd hermes/sales-desk && python3 -m unittest tests.test_m1_numbers_r1_guardian
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

# The guardian's own fakes, loaded under another name (this desk has a tests package too).
_spec = importlib.util.spec_from_file_location("guardian_fakes_m1num", GUARDIAN / "tests" / "fakes.py")
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


def pilot(*, dns: bool = False, extra_rows=(), rooms=None):
    """The pilot's first morning: everything deployed but the call site's DNS (unless dns)."""
    tmp = Path(tempfile.mkdtemp())
    rows = [
        {"worker": "sales-desk", "job": "rooms", "ok": True, "detail": "Working.", "at": fakes.ago(0.2)},
        {"worker": "sales-desk", "job": "room-hosts", "ok": True, "detail": "2 seats checked.", "at": fakes.ago(4)},
        {"worker": "sales-desk", "job": "slack", "ok": True, "detail": "Slack is switched off.", "at": fakes.ago(0.5)},
        {"worker": "sales-desk", "job": "watch", "ok": True, "detail": "", "at": fakes.ago(2)},
        {"worker": "sales-desk", "job": "waves", "ok": True, "detail": "", "at": fakes.ago(2)},
        {"worker": "sales-desk", "job": "model", "ok": True, "detail": "", "at": fakes.ago(20)},
        {"worker": "sales-live", "job": "zoom", "ok": True, "detail": "", "at": fakes.ago(30)},
        {"worker": "sales-live", "job": "cron", "ok": True, "detail": "", "at": fakes.ago(1)},
        {"worker": "sales-api", "job": "watchdog", "ok": True, "detail": "0 open alerts.", "at": fakes.ago(3)},
        *extra_rows,
    ]
    settings = [{"key": "rooms", "value": {**PILOT_ROOMS, **(rooms or {})}}, {"key": "live", "value": PILOT_LIVE}]
    db = fakes.FakeDb({"cockpit_sales_worker_status": rows, "cockpit_sales_settings": settings, "cockpit_sales_alerts": []},
                      probe={"cron_jobs": [{"jobid": i, "jobname": n, "active": True} for i, n in enumerate(live_calls.CRON_JOBS)]})
    pages = {HEALTH: fakes.resp(200)}
    if dns:
        pages["https://call.maharamedia.com/"] = fakes.resp(200)
    return fakes.ctx(tmp, db=db, host=fakes.FakeHost(fakes.snapshot(rooms={"file": True, "unit": ""})),
                     resolve=lambda h: dns, web=fakes.FakeWeb(pages))


def scan(ctx):
    return {f.check.id: f.result for f in engine.run_checks(ctx, live_calls.CHECKS)}


class PilotReadsTheTruth(unittest.TestCase):
    def test_control_with_the_call_site_deployed_every_live_calls_check_is_quiet(self):
        out = scan(pilot(dns=True))
        loud = {k: (r.status, r.summary) for k, r in out.items() if r.status == FAIL or r.urgent}
        self.assertEqual(loud, {})

    def test_short_link_off_the_missing_call_site_is_no_urgent_alert(self):
        # The messages carry the room link itself while rooms.short_link is off:
        # no lead's call lands on call.maharamedia.com in Milestone 1.
        out = scan(pilot(dns=False))
        dns = out["live-dns"]
        self.assertFalse(dns.status == FAIL and dns.urgent, dns.summary)

    def test_short_link_off_the_guardian_never_tells_a_person_to_switch_rooms_off(self):
        out = scan(pilot(dns=False))
        settings = out["live-settings"]
        self.assertNotEqual(settings.status, FAIL, f"{settings.summary} | {settings.action}")
        self.assertNotIn("Switch rooms", settings.action or "")

    def test_control_with_short_link_on_and_no_call_site_the_guardian_is_right_to_fail(self):
        out = scan(pilot(dns=False, rooms={"short_link": True}))
        self.assertEqual(out["live-settings"].status, FAIL)

    def test_slack_fenced_off_a_stray_post_to_slack_is_no_failing_part(self):
        # Anyone can POST /slack (verify_jwt off). With SLACK_SIGNING_SECRET not
        # set (Slack fenced off in Milestone 1) the door writes this row.
        stray = {"worker": "sales-live", "job": "slack", "ok": False,
                 "detail": "Slack requests cannot be checked yet: SLACK_SIGNING_SECRET is missing on sales-live. "
                           "Add it to the function's secrets.", "at": fakes.ago(1)}
        out = scan(pilot(dns=True, extra_rows=[stray]))
        rows = out["live-status-rows"]
        self.assertNotEqual(rows.status, FAIL, rows.summary)

    def test_short_link_off_the_unused_short_link_routes_are_not_a_standing_warning(self):
        # With rooms.short_link off nobody is sent call.maharamedia.com, so the
        # door's open and go routes never get traffic and never write a row.
        # Every part Milestone 1 uses reports; the check should read quiet.
        out = scan(pilot(dns=True))
        rows = out["live-status-rows"]
        self.assertEqual(rows.status, OK, rows.summary)


if __name__ == "__main__":
    unittest.main()
