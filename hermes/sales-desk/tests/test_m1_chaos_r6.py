"""Milestone 1, video-link round 6 (chaos), the room worker on a VPS whose
clock is not the database's (2026-10-06).

The worker keeps working while its clock is up to CLOCK_STOP_S (60 s) off
the database's: past CLOCK_WARN_S (10 s) its status row warns, and every
time it writes is corrected to the database's clock (db_now). The SQL sweep
and sales-api judge every deadline on the database's clock.

Round 5 (m1-time-r5-final-refusal-ten-minutes-cut-by-host-wait) taught the
worker to keep the Zoom meeting of a room a timer closed while the lead's ten
minutes still run (lead_by ahead): the link the rep was told to send by hand
must still open a meeting until lead_by. That check compares lead_by (the
database's clock, stamped by sales-api) with this VPS's own clock.

The pilot settings (m1-scope.md section 3); every room, lead, seat and
meeting is invented; nothing reaches the network. A failing test is a
finding; tests named "control" pass.

    cd hermes/sales-desk && python3 -m unittest tests.test_m1_chaos_r6
"""
from __future__ import annotations

import os
import unittest
from typing import Any
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, rooms  # noqa: E402
from desk.http import HttpError  # noqa: E402
from tests.test_rooms import T0, RoomsCase, rid  # noqa: E402

FINAL = "HighLevel did not take the link in 10 minutes (HighLevel said 429: Too Many Requests)."


class LeadByOnTheVpsClock(RoomsCase):
    def closed(self, db_now: float, **over: Any) -> str:
        """The setter's lead-page Zoom room, its link left to the rep five
        minutes ago with the lead's ten minutes still running (lead_by 30 s
        ahead on the database's clock), closed by the sweep's R3 at host_by
        two seconds ago; its meeting never started and nobody is in it."""
        m = self.env.zoom._make("zu-setter", {"topic": "Mahara call SKEW06"})
        self.env.zoom.meetings[str(m["id"])]["status"] = "waiting"
        row = {"code": "SKEW06", "purpose": "manual", "state": "expired", "end_reason": "host_not_in",
               "result": "no_join", "provider_meeting_id": str(m["id"]), "opened_at": rooms.iso(db_now - 960),
               "link_claimed_at": rooms.iso(db_now - 960), "link_sent_at": None, "refusal": FINAL,
               "host_by": rooms.iso(db_now - 60), "lead_by": rooms.iso(db_now + 30), "ended_at": rooms.iso(db_now - 2),
               "requested_at": rooms.iso(db_now - 970)}
        row.update(over)
        self.env.add_room(1, **row)
        self.env.pg.put(rooms.SECRETS, {"room_id": rid(1), "start_url": m["start_url"], "expires_at": None})
        return str(m["id"])

    def run_with_skew(self, vps_ahead: float) -> str:
        """One worker run, the VPS clock `vps_ahead` seconds ahead of the
        database's (the Date header measures it: clock_offset negative)."""
        db_now = T0
        self.env.clock.t = T0 + vps_ahead
        mid = self.closed(db_now)
        w = self.env.worker()
        w.sb.clock_offset = -vps_ahead
        w.run(seconds=0)
        return mid

    def test_control_clocks_together_the_meeting_is_kept_until_lead_by(self):
        mid = self.run_with_skew(0.0)
        self.assertIn(mid, self.env.zoom.meetings)

    def test_control_vps_behind_the_meeting_is_kept(self):
        mid = self.run_with_skew(-40.0)
        self.assertIn(mid, self.env.zoom.meetings)

    def test_vps_40_s_ahead_deletes_the_meeting_while_the_leads_ten_minutes_still_run(self):
        # Inside the 60 s the worker keeps working with: its status row only
        # warns. The lead still has 30 s of the ten minutes sales-api
        # promised (lead_by, on the database's clock), and the link the rep
        # sent by hand, as the panel told them, is this meeting.
        mid = self.run_with_skew(40.0)
        self.assertIn(
            mid, self.env.zoom.meetings,
            "m1-chaos-r6-vps-clock-ahead-deletes-meeting-before-lead-by: _scan_finals compares lead_by (the "
            "database's clock) with self.clock() (the VPS's), so a VPS 40 s ahead deletes the meeting behind the "
            "link the rep sent by hand 30 s before the lead's ten minutes end",
        )



class Killed(BaseException):
    """The process died (a deploy of the desk, the VPS rebooting, the OOM
    killer): nothing in the worker catches a BaseException."""


class KilledBetweenTheFailedLineAndTheFailedWrite(RoomsCase):
    """A Zoom room the worker cannot make this minute: Zoom's sign-in answers
    503 on every try, so no create leaves the VPS and the worker fails the
    room "Zoom did not answer. Try again in a minute, or use Meet.". fail()
    stores its worker.failed event first ("The room was not made. ..."), then
    writes the room's failed state; the run is killed between the two.

    The room stays `creating` on the dead run. The next run (Zoom answering
    again) adopts it, finds no create was ever sent, makes the meeting and
    opens the room: worker.ready goes and sales-api sends the lead the link.
    Round 4c's fix (fail-write-lost-room-made) closes the stored worker.failed
    only when the same run stored it (_failed_stored, in memory): a new run
    never knows, so the open room keeps "The room was not made" in its
    timeline (sales-api's replay finishes it as "the room was already open"
    and keeps its words), the line room.status returns to the rep's panel."""

    def setUp(self):
        super().setUp()
        from tests.test_m1_chaos_r1 import lease_rpc
        lease_rpc(self.env)
        self.zoom_signin_down = True
        real_token = self.env.zoom.token

        def token(method: str, url: str):
            if self.zoom_signin_down:
                self.env.zoom.tokens += 1
                raise HttpError(503, '{"reason":"Service Unavailable"}', b'{"reason":"Service Unavailable"}',
                                "https://zoom.us/oauth/token")
            return real_token(method, url)

        self.env.zoom.token = token  # type: ignore[method-assign]
        self.armed = True
        real_net = self.env.net

        def net(method: str, url: str, **kw: Any):
            data = kw.get("data") or b""
            if (self.armed and method == "PATCH" and "/rest/v1/cockpit_sales_rooms" in url
                    and b'"failed"' in data):
                self.armed = False
                raise Killed("killed before the failed state was written")
            return real_net(method, url, **kw)

        self.patch.stop()
        p = mock.patch.object(http, "request", net)
        p.start()
        self.addCleanup(p.stop)

    def test_killed_after_the_failed_line_the_next_run_opens_the_room_under_not_made(self):
        self.env.add_room(1, provider="zoom", purpose="manual")
        start = int(T0)
        try:
            self.env.worker(f"vps-1-{start}-e{start + 60}").run(seconds=57)
            self.fail("precondition: the run was killed at the failed write")
        except Killed:
            pass
        self.assertEqual(self.env.room(1)["state"], "creating", "precondition: the failed write never landed")
        # The next minute: Zoom answers again.
        self.zoom_signin_down = False
        self.env.clock.t = T0 + 62
        s = int(self.env.clock())
        self.env.worker(f"vps-2-{s}-e{s + 60}").run(seconds=57)
        row = self.env.room(1)
        events = {e["kind"]: e for e in self.env.pg.rows(rooms.EVENTS) if e.get("room_id") == rid(1)}
        failed = events.get("worker.failed") or {}
        self.assertEqual(row["state"], "open", f"precondition: the next run made the room ({row.get('error')!r})")
        self.assertIn("worker.ready", events)
        self.assertFalse(
            "not made" in str(failed.get("text") or "").lower() and not (failed.get("detail") or {}).get("closed_by"),
            f"m1-chaos-r6-killed-after-failed-line-room-made-timeline-says-not-made: the open room whose link "
            f"goes to the lead keeps the line {failed.get('text')!r} in its timeline",
        )



class HostCheckKilledBeforeItsAuditRows(RoomsCase):
    """The host check (desk.py rooms --check-hosts, every ten minutes) finds
    the closer's Zoom licence gone (licensed to Basic: demos go on Meet from
    now on, and sales-api's default room for the closer follows it). It
    upserts the host rows, then writes one audit row per changed seat
    (stress2 round 3, host-check-writes-unaudited); the run is killed between
    the two (a deploy of the desk, the VPS rebooting). The next check reads
    the rows it wrote as the seat's last known state, finds nothing changed,
    and never writes the audit row: the change that moved the closer's demos
    to Meet has no row saying who changed it, from what, or when."""

    def setUp(self):
        super().setUp()
        # The audit table, which the rooms fake leaves out (every desk audit
        # row is otherwise a 404 the desk's audit() swallows).
        from tests import fakes
        p = mock.patch.dict(fakes.PK, {"cockpit_audit_log": ("id",)})
        p.start()
        self.addCleanup(p.stop)
        self.env.pg.tables.setdefault("cockpit_audit_log", {})

    def seat(self) -> str:
        from tests.test_rooms import CLOSER
        self.env.pg.put("cockpit_sales_people", {"email": CLOSER, "name": "Invented Name", "role": "closer",
                                                 "active": True, "via_portal": True})
        self.env.pg.put(rooms.HOSTS, {"email": CLOSER, "zoom_user_id": "zu-closer", "zoom_status": "licensed",
                                      "google_ok": True})
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]
        self.env.zoom.users[CLOSER]["type"] = 1  # the licence was taken back: Basic
        return CLOSER

    def test_control_nothing_killed_the_change_is_audited(self):
        closer = self.seat()
        self.env.worker("hosts-1").check_hosts()
        audits = [a for a in self.env.pg.tables.get("cockpit_audit_log", {}).values()
                  if a.get("action") == "room.hosts" and a.get("entity_id") == closer]
        self.assertTrue(any((a.get("after") or {}).get("zoom_status") == "basic" for a in audits), audits)

    def test_host_check_killed_after_the_host_rows_never_audits_the_change(self):
        from tests.test_rooms import CLOSER
        self.env.pg.put("cockpit_sales_people", {"email": CLOSER, "name": "Invented Name", "role": "closer",
                                                 "active": True, "via_portal": True})
        self.env.pg.put(rooms.HOSTS, {"email": CLOSER, "zoom_user_id": "zu-closer", "zoom_status": "licensed",
                                      "google_ok": True})
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]
        self.env.zoom.users[CLOSER]["type"] = 1  # the licence was taken back: Basic
        armed = {"on": True}
        real_net = self.env.net

        def net(method: str, url: str, **kw: Any):
            if armed["on"] and method == "POST" and "/rest/v1/cockpit_audit_log" in url:
                armed["on"] = False
                raise Killed("killed before the host check's audit row")
            return real_net(method, url, **kw)

        self.patch.stop()
        p = mock.patch.object(http, "request", net)
        p.start()
        self.addCleanup(p.stop)
        try:
            self.env.worker("hosts-1").check_hosts()
            self.fail("precondition: the check was killed at its audit row")
        except Killed:
            pass
        # Since round 6 the audit rows go first: the kill lands before the
        # host rows, so the change is still to make (and to audit) next time.
        self.assertEqual((self.env.pg.one(rooms.HOSTS, email=CLOSER) or {}).get("zoom_status"), "licensed",
                         "the host row waits for its audit row")
        self.env.clock.advance(600)
        self.env.worker("hosts-2").check_hosts()
        audits = [a for a in self.env.pg.tables.get("cockpit_audit_log", {}).values()
                  if a.get("action") == "room.hosts" and a.get("entity_id") == CLOSER]
        self.assertTrue(
            any((a.get("after") or {}).get("zoom_status") == "basic" for a in audits),
            "m1-chaos-r6-host-check-killed-before-audit-change-never-audited: the closer's Zoom licence change "
            f"(licensed to basic) is on the host row with no audit row: {audits}",
        )



class ClaimAnswerLost(RoomsCase):
    """The worker's claim of a new room (requested to creating, its
    worker_run) lands and its answer is lost (a timeout, a dropped
    connection). The worker reads nothing back: the room is this run's,
    `creating`, and the orphan path adopts it a couple of seconds later and
    makes it. The open has its audit row (room.worker.open); the claim never
    gets one, since claim() writes it only from the answer, and the orphan
    path writes none (m1 round 1 fixed the same for the open and the fail:
    worker-open-or-fail-lost-answer-no-audit-row)."""

    def setUp(self):
        super().setUp()
        from tests import fakes
        p = mock.patch.dict(fakes.PK, {"cockpit_audit_log": ("id",)})
        p.start()
        self.addCleanup(p.stop)
        self.env.pg.tables.setdefault("cockpit_audit_log", {})
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]

    def lose_claim_answer(self) -> None:
        real_net = self.env.net
        armed = {"on": True}

        def net(method: str, url: str, **kw: Any):
            data = kw.get("data") or b""
            if (armed["on"] and method == "PATCH" and "/rest/v1/cockpit_sales_rooms" in url
                    and "state=eq.requested" in url and b'"creating"' in data):
                armed["on"] = False
                real_net(method, url, **kw)  # it lands
                raise HttpError(0, "TimeoutError: timed out", b"", url)
            return real_net(method, url, **kw)

        self.patch.stop()
        p = mock.patch.object(http, "request", net)
        p.start()
        self.addCleanup(p.stop)

    def audits(self, action: str) -> list:
        return [a for a in self.env.pg.tables.get("cockpit_audit_log", {}).values()
                if a.get("action") == action and a.get("entity_id") == rid(1)]

    def test_control_the_claim_has_its_audit_row(self):
        self.env.add_room(1, provider="meet")
        self.env.worker().run(seconds=8)
        self.assertEqual(self.env.room(1)["state"], "open")
        self.assertEqual(len(self.audits("room.worker.claim")), 1)

    def test_a_claim_whose_answer_was_lost_has_no_audit_row(self):
        self.env.add_room(1, provider="meet")
        self.lose_claim_answer()
        self.env.worker().run(seconds=8)
        self.assertEqual(self.env.room(1)["state"], "open", "precondition: the room was made after all")
        self.assertEqual(len(self.audits("room.worker.open")), 1, "precondition: the open has its row")
        self.assertEqual(
            len(self.audits("room.worker.claim")), 1,
            "m1-chaos-r6-claim-lost-answer-no-audit-row: the room went requested to creating on this run's claim "
            "and no audit row says so",
        )



class LinkLeftToTheRepLeadWaitLost(RoomsCase):
    """The worker's side of sales-api's m1-chaos-r6-final-refusal-lead-wait-
    blip-room-closed-under-hand-sent-link: HighLevel took no send for the
    link's ten minutes, sales-api said it final 40 s ago ("Copy the link and
    send it another way"), and its lead_by write met one 503, so lead_by is
    empty; the sweep's R4 closed the room at its next minute as
    link_not_sent (migrations/tests/m1_chaos_r6.py, F). The rep is sending the
    Zoom link from their own WhatsApp, as the panel told them."""

    def test_the_meeting_behind_the_link_the_rep_was_just_told_to_send_is_deleted(self):
        m = self.env.zoom._make("zu-setter", {"topic": "Mahara call LOST06"})
        self.env.zoom.meetings[str(m["id"])]["status"] = "waiting"
        self.env.add_room(1, code="LOST06", purpose="manual", state="expired", end_reason="link_not_sent", result=None,
                          provider_meeting_id=str(m["id"]), opened_at=rooms.iso(T0 - 650),
                          link_claimed_at=rooms.iso(T0 - 650), link_sent_at=None, refusal=FINAL,
                          host_by=rooms.iso(T0 + 250), lead_by=None, ended_at=rooms.iso(T0 - 5))
        self.env.pg.put(rooms.SECRETS, {"room_id": rid(1), "start_url": m["start_url"], "expires_at": None})
        self.env.worker().run(seconds=0)
        self.assertIn(
            str(m["id"]), self.env.zoom.meetings,
            "m1-chaos-r6-final-refusal-lead-wait-blip-room-closed-under-hand-sent-link: the Zoom meeting behind the "
            "link the rep was told 40 s ago to send by hand is deleted",
        )


if __name__ == "__main__":
    unittest.main()
