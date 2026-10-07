"""Second series, round 5, numbers and data integrity, desk side. Every lead
and figure is invented.

    python3 -m unittest tests.test_stress2_numbers_r5

1. A video join whose count did not book (count_result failed or unclear)
   is a call the lead had, but followups.live_calls reads only booked and
   moved counts, a hand-pressed join (self_reported), a mark, and a join
   with nothing claimed (count_result null). A failed or unclear count is
   none of those, so the desk reads the lead as nobody reached: a "we
   missed you" no-show message, or a never-booked backlog opener, to a lead
   who just talked to a rep on video.
2. stamp_twins (fix round 4) starts held-back leads' 14 days with a write
   that leaves no audit row (the standing rule: every write leaves one).

A failing test is a finding.
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu  # noqa: E402
from desk import http, waves  # noqa: E402
from tests import fakes  # noqa: E402
from tests.test_waves import NOW, members, routes, sb, seed, wave  # noqa: E402

fakes.PK.setdefault("cockpit_sales_rooms", ("id",))
AUDIT = "cockpit_audit_log"
fakes.PK.setdefault(AUDIT, ("action", "entity_type", "entity_id"))


def pg_with_rooms() -> fakes.FakePostgrest:
    pg = fakes.FakePostgrest()
    pg.tables.setdefault("cockpit_sales_rooms", {})
    return pg


def zoom_join(pg: fakes.FakePostgrest, c: str, joined, result: str, appointment_id=None) -> None:
    """A lead-page Zoom room the lead joined (Zoom saw them) and talked in for
    twenty-five minutes, whose count ran and did not book: rooms.ts runCount
    writes count_result failed (the booking refused, the move refused, the
    host with no HighLevel user, another rep's call) or unclear (the
    booking's answer was lost and it could not be found)."""
    pg.put("cockpit_sales_rooms", {
        "id": f"room-{c}", "contact_id": c, "purpose": "manual", "trigger": "manual", "call_kind": "intro",
        "provider": "zoom", "host_email": "setter@stress.invalid", "appointment_id": appointment_id,
        "state": "ended", "result": "joined", "end_reason": "finished",
        "lead_in_at": joined.isoformat(), "ended_at": (joined + timedelta(minutes=25)).isoformat(),
        "count_claimed_at": joined.isoformat(), "count_result": result, "count_appointment_id": None,
    })


def lead_row(c: str) -> dict:
    return {"contact_id": c, "name": "Omar", "country": "Kuwait", "tags": ["roas-qualified"],
            "lead_created_at": (NOW - timedelta(days=3)).isoformat(), "lead_class": "qualified",
            "phone": "+96550000000", "dnd": False}


class FailedCountJoinSeen(unittest.TestCase):
    def test_control_self_reported_join_is_seen(self):
        """Control (fixed in round 2): a hand-pressed join is a call the desk sees."""
        pg = pg_with_rooms()
        c = "stress-s2n5-desk-0"
        zoom_join(pg, c, NOW - timedelta(minutes=50), "self_reported")
        with mock.patch.object(http, "request", pg):
            live = fu.live_calls(sb(), [c])
        self.assertEqual(len(live), 1)

    def _no_show_after_join(self, result: str) -> list:
        pg = pg_with_rooms()
        c = f"stress-s2n5-desk-{result}"
        start = NOW - timedelta(hours=1)
        lead = lead_row(c)
        pg.put("cockpit_sales_leads", lead)
        # The setter marked the 09:00 intro a no-show at 09:10 (no answer); at 09:40,
        # past the intro's slot, the lead asked for a link and joined the lead page's room.
        intro = {"appointment_id": f"{c}-intro", "contact_id": c, "call_type": "intro", "status": "noshow",
                 "start_at": start.isoformat(), "booked_at": (start - timedelta(days=2)).isoformat()}
        zoom_join(pg, c, start + timedelta(minutes=40), result)
        with mock.patch.object(http, "request", pg):
            calendar = fu.with_live([intro], fu.live_calls(sb(), [c]))
        picked = fu.pick(NOW, inbox=[], calendar=calendar, leads=[lead])
        return [(p["segment"], p["contact_id"]) for p in picked if p["contact_id"] == c]

    def test_failed_count_join_gets_no_show_sequence(self):
        """failed-count-join-invisible-to-desk (failed): the count's Live booking was refused by
        HighLevel (a person is told to book it by hand); meanwhile the desk drafts the no-show
        message ("we missed you, let's find another time") to the lead who just had the call."""
        self.assertNotIn("no_show", [s for s, _ in self._no_show_after_join("failed")],
                         "the no-show sequence is drafted for a lead who joined the video call and talked")

    def test_unclear_count_join_gets_no_show_sequence(self):
        """failed-count-join-invisible-to-desk (unclear): the count's booking answer was lost and it
        could not be found: the same no-show message goes to the lead who had the call."""
        self.assertNotIn("no_show", [s for s, _ in self._no_show_after_join("unclear")],
                         "the no-show sequence is drafted for a lead who joined the video call and talked")

    def test_failed_count_join_left_in_never_booked_pool(self):
        """failed-count-join-invisible-to-desk (pools): a tagged lead never booked joins the setter's
        Zoom room and talks; the count's booking fails. The never-booked pool, and so a backlog
        opener ("How are you?"), must not take a lead who just had that call."""
        pg = pg_with_rooms()
        c = "stress-s2n5-desk-pool"
        seed(pg, c, "never_booked", days=2)
        zoom_join(pg, c, NOW - timedelta(hours=3), "failed")
        with mock.patch.object(http, "request", pg):
            out = waves.pools(sb(), NOW)
        self.assertNotIn(c, [x for x, _ in out["never_booked"]],
                         "a lead who talked to the setter on video three hours ago is still 'never booked'")


class LiveDemoNotClosedPool(unittest.TestCase):
    """Since fix round 4 a closer's video call is a demo (rooms.ts roomCreate),
    booked on rooms.live_calendar_id and copied into the calendar copy there
    (copyLiveBooking), or read from the room (followups.live_calls, calendar
    "live"). pool_of's unclosed-demo rule wants the latest held call to be a
    demo on a demo calendar: a demo held live is on neither, so the lead
    falls out of every pool."""

    def _pool(self, with_copy: bool):
        pg = pg_with_rooms()
        c = "stress-s2n5-desk-demo" + ("-copy" if with_copy else "-room")
        seed(pg, c, "unclosed_demo", days=4)
        # The B2B demo (seeded confirmed four days ago, a show by the B2B rule)
        # was not closed; two days ago the closer sent a video link from the
        # lead page, the lead joined, and the count booked a live demo.
        joined = NOW - timedelta(days=2)
        pg.put("cockpit_sales_rooms", {
            "id": f"room-{c}", "contact_id": c, "purpose": "manual", "trigger": "manual", "call_kind": "demo",
            "provider": "zoom", "host_email": "closer@stress.invalid", "state": "ended", "result": "joined",
            "lead_in_at": joined.isoformat(), "ended_at": (joined + timedelta(minutes=50)).isoformat(),
            "count_claimed_at": joined.isoformat(), "count_result": "booked", "count_appointment_id": f"live-{c}",
        })
        if with_copy:
            pg.put("cockpit_sales_calendar", {"appointment_id": f"live-{c}", "contact_id": c, "call_type": "demo",
                                              "calendar_id": "LIVECAL", "status": "showed",
                                              "start_at": joined.isoformat(), "booked_at": joined.isoformat()})
        with mock.patch.object(http, "request", pg):
            out = waves.pools(sb(), NOW)
        return c, {p: [x for x, _ in v] for p, v in out.items()}

    def test_control_without_the_live_demo_the_lead_is_an_unclosed_demo(self):
        pg = pg_with_rooms()
        c = "stress-s2n5-desk-demo-ctl"
        seed(pg, c, "unclosed_demo", days=4)
        with mock.patch.object(http, "request", pg):
            out = waves.pools(sb(), NOW)
        self.assertIn(c, [x for x, _ in out["unclosed_demo"]])

    def test_live_demo_drops_lead_from_unclosed_demo_pool_copy(self):
        """live-demo-not-closed-in-no-pool (the copy row): the lead's latest held call is the
        closer's live demo; no deal. They must stay in 'Demos not closed', never in no pool."""
        c, pools = self._pool(with_copy=True)
        self.assertIn(c, pools["unclosed_demo"], f"the lead is in {[p for p, v in pools.items() if c in v] or 'no pool'}")

    def test_live_demo_drops_lead_from_unclosed_demo_pool_room(self):
        """live-demo-not-closed-in-no-pool (the room only, its copy not written yet)."""
        c, pools = self._pool(with_copy=False)
        self.assertIn(c, pools["unclosed_demo"], f"the lead is in {[p for p, v in pools.items() if c in v] or 'no pool'}")


class StampTwinsAudited(unittest.TestCase):
    def test_stamp_twins_leaves_an_audit_row(self):
        """stamp-twins-writes-unaudited: two wave members had their turn (due_at stamped) and their
        held-back twins' stamp was lost; stamp_twins starts the twins' 14 days. That write moves the
        holdout arm's comparison and must leave a cockpit_audit_log row."""
        pg = fakes.FakePostgrest()
        pg.tables.setdefault(AUDIT, {})
        routes(pg)
        wave(pg, "w5", "no_show_cancelled", enrolled_at=NOW.isoformat())
        due = (NOW - timedelta(hours=2)).isoformat()
        for i, arm in enumerate(["wave", "holdout", "wave", "holdout"]):
            pg.put("cockpit_sales_followup_wave_members", {
                "wave_id": "w5", "contact_id": f"stress-s2n5-tw{i}", "arm": arm,
                "state": "drafted" if arm == "wave" else "held_out",
                "event_at": (NOW - timedelta(days=10 + i)).isoformat(),
                "due_at": due if arm == "wave" else None, "added_at": (NOW - timedelta(days=1)).isoformat()})
        with mock.patch.object(http, "request", pg):
            n = waves.stamp_twins(sb(), "w5")
        self.assertGreaterEqual(n, 1)
        self.assertTrue(all(m.get("due_at") for m in members(pg, "w5", arm="holdout") if fu._ts(m.get("event_at"))
                            >= NOW - timedelta(days=12)))
        self.assertTrue(pg.rows(AUDIT), "the held-back leads' 14 days were started with no audit row")


if __name__ == "__main__":
    unittest.main()
