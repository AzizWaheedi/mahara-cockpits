"""Second series, round 3, numbers and data integrity, desk side. Every lead,
wave and figure is invented.

    python3 -m unittest tests.test_stress2_numbers_r3

1. A wave's outcome reads bookings from the calendar copy dated from the
   earliest turn it watches (booked_at >= since), and the live calls the
   count made from the rooms. A call the count MOVED to the join (the lead's
   own intro, booked before their turn) is kept once only when the calendar
   copy read holds it; the copy was cut at `since`, so the moved call comes
   back from the rooms as a booking made at the join, inside the 14 days.
2. The desk's waves audit rows (waves.sync, waves.outcomes, waves.wind_down)
   are written per wave, each carrying the run's counts across every wave.

A failure here is a finding.
"""
from __future__ import annotations

import json
import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, waves  # noqa: E402
from tests import fakes  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import NOW, sb  # noqa: E402

fakes.PK.setdefault("cockpit_sales_rooms", ("id",))
MEMBERS = waves.MEMBERS
AUDIT = "/rest/v1/cockpit_audit_log"
INTRO_CAL = "dsqmJ393Dwl9fDSbIVOI"


class Recorder:
    """The fake database, with every audit row the desk posts kept in order."""

    def __init__(self, pg: FakePostgrest):
        self.pg = pg
        self.audits: list[dict] = []

    def __call__(self, method, url, **kw):
        if method == "POST" and AUDIT in url:
            body = kw.get("json_body")
            if body is None and kw.get("data"):
                body = json.loads(kw["data"].decode("utf-8"))
            self.audits.extend(body if isinstance(body, list) else [body])
            return 201, {}, b""
        return self.pg(method, url, **kw)


def pg_with_rooms() -> FakePostgrest:
    pg = FakePostgrest()
    pg.tables.setdefault("cockpit_sales_rooms", {})
    return pg


def member(pg, wid, c, arm, state, **over):
    pg.put(MEMBERS, {"wave_id": wid, "contact_id": c, "arm": arm, "state": state,
                     "added_at": (NOW - timedelta(days=10)).isoformat(), **over})


class MovedCallCountedAsNewBooking(unittest.TestCase):
    """The lead booked their intro for Thursday on Sunday morning, an hour
    before the wave's turn came to them (both arms alike: a wave lead is taken
    out at the turn as "no longer in a backlog pool" and watched like their
    holdout twin). On Tuesday the setter's confirmation call goes to a video
    room, the lead joins, and the count moves Thursday's intro to the join
    and marks it shown. Nothing was booked after the turn: the intro was."""

    T0 = NOW - timedelta(days=5)

    def seed(self, pg, c, arm, moved: bool):
        state = "held_out" if arm == "holdout" else "excluded"
        member(pg, "w1", c, arm, state, due_at=self.T0.isoformat(),
               **({} if arm == "holdout" else
                  {"excluded_reason": "No longer in a backlog pool (booked, signed, a client, or out of the lead copy)."}))
        booked = self.T0 - timedelta(hours=1)
        joined = self.T0 + timedelta(days=2)
        # The calendar copy after the move: the same appointment, its start now the join, booked_at unchanged.
        pg.put("cockpit_sales_calendar", {"appointment_id": f"{c}-intro", "contact_id": c, "call_type": "intro",
                                          "calendar_id": INTRO_CAL, "status": "showed" if moved else "confirmed",
                                          "booked_at": booked.isoformat(),
                                          "start_at": (joined if moved else self.T0 + timedelta(days=3)).isoformat()})
        if moved:
            pg.put("cockpit_sales_rooms", {
                "id": f"room-{c}", "contact_id": c, "purpose": "fallback", "call_kind": "intro", "provider": "zoom",
                "host_email": "setter@stress.invalid", "appointment_id": f"{c}-intro", "state": "ended",
                "result": "joined", "lead_in_at": joined.isoformat(), "count_claimed_at": joined.isoformat(),
                "count_result": "moved", "count_appointment_id": f"{c}-intro", "count_undo_at": None})

    def outcome(self, pg, c):
        with mock.patch.object(http, "request", pg):
            waves.outcomes(sb(), ["w1"], self.T0 + timedelta(days=3))
        return pg.one(MEMBERS, wave_id="w1", contact_id=c)

    def test_moved_call_booked_before_turn_counted_booked_wave_arm(self):
        """moved-call-counted-as-booking-after-turn (wave arm): the intro was booked before the turn,
        so the wave's booked count must not take it."""
        pg = pg_with_rooms()
        self.seed(pg, "stress-s2n3-moved-w", "wave", moved=True)
        m = self.outcome(pg, "stress-s2n3-moved-w")
        self.assertNotEqual(m["state"], "booked",
                            f"an intro booked before the turn is counted as the wave's booking at the join ({m})")

    def test_moved_call_booked_before_turn_counted_booked_holdout(self):
        """The same for a held-back lead: their intro was booked before their 14 days started."""
        pg = pg_with_rooms()
        self.seed(pg, "stress-s2n3-moved-h", "holdout", moved=True)
        m = self.outcome(pg, "stress-s2n3-moved-h")
        self.assertNotEqual(m["state"], "booked",
                            f"an intro booked before the turn is counted as the holdout's booking at the join ({m})")

    def test_control_same_intro_held_on_its_own_time_is_not_booked(self):
        """Control: the same intro, held at its own time (no video room): not counted."""
        pg = pg_with_rooms()
        self.seed(pg, "stress-s2n3-plain", "wave", moved=False)
        m = self.outcome(pg, "stress-s2n3-plain")
        self.assertNotEqual(m["state"], "booked")


class WaveAuditRowsCarryEveryWavesCounts(unittest.TestCase):
    def test_wind_down_audit_rows_name_only_their_own_wave(self):
        """waves-audit-rows-carry-all-waves-counts (wind_down): two stopped waves still being watched.
        w1 lets go of three waiting leads and two held back whose turn never came; w2 has nothing left
        to let go of (its leads all had their opener). w2 must get no wind_down row, and w1's row must
        say five."""
        pg = FakePostgrest()
        for wid in ("w1", "w2"):
            pg.put(waves.WAVES, {"id": wid, "pool": "no_show_cancelled", "state": "done",
                                 "done_reason": "Stopped by a manager.", "enrolled_at": (NOW - timedelta(days=3)).isoformat()})
        for i in range(3):
            member(pg, "w1", f"stress-s2n3-a{i}", "wave", "waiting")
        for i in range(2):
            member(pg, "w1", f"stress-s2n3-h{i}", "holdout", "held_out")
        for i in range(4):
            member(pg, "w2", f"stress-s2n3-s{i}", "wave", "sent", due_at=(NOW - timedelta(days=2)).isoformat(),
                   sent_at=(NOW - timedelta(days=2)).isoformat())
        rec = Recorder(pg)
        with mock.patch.object(http, "request", rec):
            out = waves.wind_down(sb(), [pg.one(waves.WAVES, id="w1"), pg.one(waves.WAVES, id="w2")], NOW)
        self.assertEqual(out.get("excluded"), 5)
        rows = [a for a in rec.audits if a.get("action") == "waves.wind_down"]
        by_wave = {a["entity_id"]: a for a in rows}
        self.assertNotIn("w2", by_wave, f"w2 let go of nobody, yet has a wind_down audit row: {by_wave.get('w2')}")
        self.assertEqual((by_wave.get("w1") or {}).get("after", {}).get("excluded"), 5)

    def test_outcomes_audit_rows_count_their_own_wave(self):
        """waves-audit-rows-carry-all-waves-counts (outcomes): w1 has two leads who booked, w2 one who
        wrote back. Each wave's waves.outcomes row must count its own members, never the other wave's."""
        pg = pg_with_rooms()
        t0 = NOW - timedelta(days=3)
        for i in range(2):
            c = f"stress-s2n3-b{i}"
            member(pg, "w1", c, "wave", "sent", due_at=t0.isoformat(), sent_at=t0.isoformat())
            pg.put("cockpit_sales_calendar", {"appointment_id": f"{c}-x", "contact_id": c, "call_type": "intro",
                                              "calendar_id": INTRO_CAL, "status": "confirmed",
                                              "booked_at": (t0 + timedelta(days=1)).isoformat(),
                                              "start_at": (NOW + timedelta(days=1)).isoformat()})
        c = "stress-s2n3-r0"
        member(pg, "w2", c, "wave", "sent", due_at=t0.isoformat(), sent_at=t0.isoformat())
        pg.put("cockpit_sales_inbox", {"conversation_id": f"conv-{c}", "contact_id": c, "last_direction": "inbound",
                                       "last_message_at": (t0 + timedelta(hours=5)).isoformat(),
                                       "inbound_whatsapp_at": (t0 + timedelta(hours=5)).isoformat()})
        rec = Recorder(pg)
        with mock.patch.object(http, "request", rec):
            out = waves.outcomes(sb(), ["w1", "w2"], NOW)
        self.assertEqual((out["booked"], out["replied"]), (2, 1))
        rows = {a["entity_id"]: a for a in rec.audits if a.get("action") == "waves.outcomes"}
        self.assertEqual(rows["w1"]["after"], {"booked": 2}, f"w1's row counts another wave's members: {rows['w1']}")
        self.assertEqual(rows["w2"]["after"], {"replied": 1}, f"w2's row counts another wave's members: {rows['w2']}")


class HostCheckWritesUnaudited(unittest.TestCase):
    """The ten-minute host check (rooms.py check_hosts) writes each seat's
    host row: the Zoom user that hosts every room the rep makes (linked by
    the check itself when the Team page set none), the seat's Zoom licence
    (which turns the seat's default room and the Basic refusal), and whether
    Google works. The standing rule: every write leaves an audit row."""

    def test_host_check_links_a_zoom_user_with_an_audit_row(self):
        """host-check-writes-unaudited: the setter's seat has no Zoom user linked; the check finds the
        account's user by the seat's email and links it, so every room the setter makes from now on is
        hosted by that Zoom user. That write must leave a cockpit_audit_log row."""
        from desk import rooms
        from tests.test_rooms import Env, SETTER

        env = Env()
        with mock.patch.object(http, "request", env.net):
            env.pg.put("cockpit_sales_people", {"email": SETTER, "name": "Invented Name", "role": "setter",
                                                "active": True, "via_portal": True})
            env.pg.put(rooms.HOSTS, {"email": SETTER, "google_ok": True})
            env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]
            env.worker().check_hosts()
        row = env.pg.one(rooms.HOSTS, email=SETTER) or {}
        self.assertEqual(row.get("zoom_user_id"), "zu-setter", f"sanity: the check linked the seat's Zoom user ({row})")
        audits = [c for c in env.pg.calls if c[0] == "POST" and "cockpit_audit_log" in c[1]]
        self.assertTrue(audits, "the host check linked the setter's seat to a Zoom user (and wrote its licence and "
                                "Google state) with no audit row")


if __name__ == "__main__":
    unittest.main()
