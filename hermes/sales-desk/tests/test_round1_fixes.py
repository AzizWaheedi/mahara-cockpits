"""Regression tests for the first stress round's fixes on the desk side
(3 October 2026) that the attack lanes' own tests do not already pin: the
Live calendar gate in deploy-check (D25), one time-zone table for both doors,
a lead outside the Gulf never written to at night, and the room worker's
clock warning. Every lead and key is invented.

    python3 -m unittest tests.test_round1_fixes
"""
from __future__ import annotations

import os
import re
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, rooms  # noqa: E402
from tests.test_deploy_check import Catalog, line, run  # noqa: E402
from tests.test_rooms import RoomsCase  # noqa: E402

SENDRULES = Path(__file__).resolve().parents[3] / "supabase" / "functions" / "sales-api" / "sendrules.ts"
UTC = timezone.utc


class LiveCalendarGate(unittest.TestCase):
    """D25: a joined lead's live booking never goes on a calendar B2B's show rate counts."""

    def test_count_on_join_on_without_a_live_calendar_blocks(self):
        db = Catalog()
        db.setting("rooms")["count_on_join"] = True
        code, out, _ = run(["deploy-check"], db)
        self.assertEqual(code, 1)
        self.assertTrue(line(out, "rooms.live_calendar_id").startswith("-- "), out)
        self.assertIn("a joined lead is never booked as a live call", line(out, "rooms.live_calendar_id"))

    def test_a_live_calendar_that_is_an_intro_calendar_blocks(self):
        db = Catalog()
        db.setting("rooms")["live_calendar_id"] = "dsqmJ393Dwl9fDSbIVOI"
        code, out, _ = run(["deploy-check"], db)
        self.assertEqual(code, 1)
        self.assertIn("B2B's show rate counts", line(out, "rooms.live_calendar_id"))

    def test_a_test_calendar_that_is_a_demo_calendar_blocks(self):
        db = Catalog()
        db.setting("rooms")["test_calendar_id"] = "jQqXS1YuFnmGZKLkrE62"
        code, out, _ = run(["deploy-check"], db)
        self.assertEqual(code, 1)
        self.assertIn("an official number (C34)", line(out, "rooms.test_calendar_id"))

    def test_a_calendar_of_its_own_passes(self):
        db = Catalog()
        db.setting("rooms")["live_calendar_id"] = "LiveCallsOnlyCalendar"
        code, out, _ = run(["deploy-check"], db)
        self.assertEqual(code, 0, out)
        self.assertTrue(line(out, "rooms.live_calendar_id").startswith("OK "))


class OneZoneTable(unittest.TestCase):
    def test_the_desk_and_sales_api_read_the_same_zones(self):
        text = SENDRULES.read_text(encoding="utf-8")
        block = text[text.index("export const LEAD_ZONES"):text.index("});", text.index("export const LEAD_ZONES"))]
        ts = {code: tuple(re.findall(r'"([^"]+)"', zones))
              for code, zones in re.findall(r"\b([a-z]{2}): \[([^\]]*)\]", block)}
        self.assertEqual(ts, fu.LEAD_ZONES)

    def test_a_lead_outside_the_gulf_is_never_written_to_at_night_their_time(self):
        start = datetime(2027, 1, 13, 21, 0, tzinfo=UTC)  # winter: no summer time hides the gap
        for country, zone in (("US", "America/New_York"), ("GB", "Europe/London"), ("EG", "Africa/Cairo"),
                              ("SG", "Asia/Singapore")):
            night = []
            for i in range(8 * 24 * 60 // 5):
                t = start + timedelta(minutes=5 * i)
                h = t.astimezone(ZoneInfo(zone)).hour
                if fu.in_hours(t, country, (9, 18)) and not 9 <= h < 18:
                    night.append(t.isoformat())
            self.assertEqual(night[:3], [], country)

    def test_a_code_the_table_does_not_know_waits_for_a_person(self):
        noon_kuwait = datetime(2026, 10, 4, 9, 0, tzinfo=UTC)
        self.assertFalse(fu.in_hours(noon_kuwait, "ZZ", (9, 18)))
        self.assertTrue(fu.in_hours(noon_kuwait, "ZZ", (9, 21), first=False))
        self.assertTrue(fu.in_hours(noon_kuwait, "", (9, 18)))  # no country at all: Kuwait, as before


class WorkerClock(RoomsCase):
    def test_a_clock_half_a_minute_off_is_said_in_the_status_row_and_corrected(self):
        env = self.env
        env.add_room(1, requested_at=rooms.iso(env.clock() + 30))  # asked for "30 s from now" by this clock
        w = env.worker()
        self.tick(w)
        self.assertNotEqual(env.room(1)["state"], "requested")
        claimed = rooms.parse_ts(env.room(1).get("claimed_at"))
        self.assertGreaterEqual(claimed, rooms.parse_ts(env.room(1)["requested_at"]) - rooms.CLOCK_SLACK_S)
        ok, sentence = w.sentence()
        self.assertIn("seconds behind the database's", sentence)


class HardeningMigration(unittest.TestCase):
    def test_a_database_without_20261003d_is_not_ready(self):
        db = Catalog()
        db.schema["cockpit_sales_rooms"].discard("appointment_start_at")
        code, out, _ = run(["deploy-check"], db)
        self.assertEqual(code, 1)
        self.assertIn("apply 20261003d_live_calls_hardening.sql", line(out, "20261003d hardening"))

    def test_a_20261003d_from_before_round_3_is_not_ready(self):
        db = Catalog()
        db.schema["cockpit_sales_rooms"].discard("lead_in_seen_at")
        code, out, _ = run(["deploy-check"], db)
        self.assertEqual(code, 1)
        self.assertIn("apply 20261003d_live_calls_hardening.sql", line(out, "20261003d hardening"))


if __name__ == "__main__":
    unittest.main()
