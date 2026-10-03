"""TIME stress, round 3 (the desk): what a running clock does to the host
check's "in a Zoom meeting now" and to a booked call's time as the agent's
brief names it, for leads in and outside the Gulf. Every seat, lead and
meeting is invented; nothing leaves the process.

    python3 -m unittest tests.test_stress_time_r3

A failing test is a finding: its name says what should hold.
"""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, rooms  # noqa: E402
from tests.test_rooms import CLOSER, T0, RoomsCase  # noqa: E402

UTC = timezone.utc


def zulu(t: float) -> str:
    return datetime.fromtimestamp(t, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class AZoomDemoThatRunsPastItsSlot(RoomsCase):
    """The closer's demo was scheduled 12:00 to 13:00 Kuwait (60 minutes) and
    is still running at 13:10 (T0 is Saturday 13:00 Kuwait; the check runs
    at T0 + 10 min). Zoom's live list names it: the meeting is live now. The
    presence view reads `zoom_live_until > now()` (cockpit_sales_presence),
    so the closer is on a call only while that time is ahead."""

    def seat(self, start: float, minutes: int) -> dict:
        self.env.pg.put("cockpit_sales_people", {"email": CLOSER, "name": "Invented Closer", "role": "closer",
                                                 "active": True, "via_portal": True})
        self.env.zoom.live["zu-closer"] = [{"id": 81000000777, "start_time": zulu(start), "duration": minutes}]
        self.env.clock.t = T0 + 10 * 60
        self.env.worker().check_hosts()
        return self.env.pg.one(rooms.HOSTS, email=CLOSER)

    def test_a_meeting_zoom_lists_as_live_keeps_the_closer_on_a_call_until_the_next_check(self):
        row = self.seat(T0 - 60 * 60, 60)
        until = fu._ts(row.get("zoom_live_until"))
        now = datetime.fromtimestamp(self.env.clock(), UTC)
        self.assertIsNotNone(until, "the host check wrote no live-until for a meeting Zoom lists as live")
        self.assertGreater(until, now + timedelta(seconds=rooms.HOSTS_EVERY),
                           f"zoom_live_until {row.get('zoom_live_until')} is not past the next host check "
                           f"({now.isoformat()} + {int(rooms.HOSTS_EVERY)} s): the presence view reads the closer "
                           "as off the call while Zoom says the meeting is live")

    def test_a_meeting_started_late_on_its_schedule_reads_live_too(self):
        # Scheduled 12:30 for 30 minutes, started at 12:50 (the lead was late): live at 13:10.
        row = self.seat(T0 - 30 * 60, 30)
        until = fu._ts(row.get("zoom_live_until"))
        now = datetime.fromtimestamp(self.env.clock(), UTC)
        self.assertTrue(until is not None and until > now,
                        f"zoom_live_until {row.get('zoom_live_until')} is already past at {now.isoformat()}")

    def test_control_a_meeting_inside_its_slot_reads_live(self):
        row = self.seat(T0, 60)
        until = fu._ts(row.get("zoom_live_until"))
        self.assertGreater(until, datetime.fromtimestamp(self.env.clock(), UTC))


class TheCallsTimeInTheBrief(unittest.TestCase):
    """followups.call_words fills the brief's the_call ({day, relative,
    time_24h, zone}), and the confirmation and no-show prompts tell the model
    to name the day and time "exactly as given". Since round 1, the time is
    on the lead's own zone (lead_offset reads zoneinfo for about 250 leads
    outside the Gulf); the zone words must say which clock that is."""

    START = datetime(2026, 10, 8, 8, 0, tzinfo=UTC)   # 11:00 Kuwait
    NOW = datetime(2026, 10, 7, 15, 0, tzinfo=UTC)    # the day before, 18:00 Kuwait

    def words(self, country: str) -> dict:
        return fu.call_words(self.START, self.NOW, country)

    def test_gulf_leads_control(self):
        self.assertEqual(self.words("KW")["time_24h"], "11:00")
        self.assertIn("UTC+3", self.words("KW")["zone"])
        self.assertEqual(self.words("AE")["time_24h"], "12:00")
        self.assertIn("UTC+4", self.words("AE")["zone"])

    def test_a_london_lead_s_time_is_not_labelled_kuwait_time(self):
        w = self.words("GB")
        local = self.START.astimezone(ZoneInfo("Europe/London"))
        self.assertEqual(w["time_24h"], local.strftime("%H:%M"))  # 09:00, their own clock
        self.assertNotIn("Kuwait", w["zone"], f"London's 09:00 is labelled {w['zone']!r}")
        self.assertNotIn("UTC+3", w["zone"], f"London's 09:00 is labelled {w['zone']!r}")

    def test_an_egypt_lead_after_the_october_clock_change_is_not_labelled_kuwait_time(self):
        # Egypt leaves summer time on the last Thursday of October (UTC+3 to UTC+2).
        start = datetime(2026, 11, 5, 8, 0, tzinfo=UTC)
        w = fu.call_words(start, start - timedelta(hours=17), "EG")
        self.assertEqual(w["time_24h"], start.astimezone(ZoneInfo("Africa/Cairo")).strftime("%H:%M"))
        self.assertNotIn("as Kuwait", w["zone"], f"Cairo's {w['time_24h']} is labelled {w['zone']!r}")

    def test_a_us_lead_s_time_names_which_us_clock_it_is(self):
        # The US spans zones; the desk picks New York's. Saying "their own
        # time" to a lead in Los Angeles names a time 3 hours off.
        w = self.words("US")
        self.assertNotEqual(w["zone"], "their own time (UTC+3, as Kuwait)",
                            f"New York's {w['time_24h']} is labelled as Kuwait time")
        self.assertIn("New York", w["zone"], f"a US lead's {w['time_24h']} does not say whose clock: {w['zone']!r}")


class AConfirmationOnTheLeadsClock(unittest.TestCase):
    """A call booked more than a day ahead is confirmed from confirm_from(start)
    (18:00 Kuwait the evening before a call that starts before noon Kuwait,
    else 09:00 Kuwait that day), and sales-api lets a confirmation go only
    from 9 to 21 on the lead's clock, in every zone of their country
    (sendrules.ts hoursRefusal, segment confirm; the desk's in_hours with
    first=False is its mirror, tests/test_stress_time_day.py). Between the
    two there must be a moment before the call starts."""

    def test_every_morning_call_of_a_lead_outside_the_gulf_can_be_confirmed_before_it_starts(self):
        none: list[str] = []
        for country, zone in (("US", "America/New_York"), ("CA", "America/Toronto"), ("AU", "Australia/Sydney"),
                              ("BR", "America/Sao_Paulo"), ("SG", "Asia/Singapore"), ("GB", "Europe/London")):
            for h in range(9, 18):
                start = datetime(2026, 10, 8, h, 0, tzinfo=ZoneInfo(zone)).astimezone(UTC)
                # On the lead's own clock (fix round 3: confirm_from takes the lead's country).
                t, ok = fu.confirm_from(start, country), False
                while t < start:
                    if fu.in_hours(t, country, (9, 21), first=False):
                        ok = True
                        break
                    t += timedelta(minutes=15)
                if not ok:
                    none.append(f"{country} {h:02d}:00")
        self.assertEqual(none, [], "calls whose confirmation can only go after the call has started")


class NoTimeZoneDatabaseOnTheBox(unittest.TestCase):
    """_zone_offset falls back to the Gulf's fixed offsets when zoneinfo has
    no data (a VPS without tzdata): every zone outside the UAE and Oman then
    reads as Kuwait's, silently. Missing is never zero: a lead whose clock the
    box cannot read is a lead whose zone is not known."""

    def test_a_london_lead_at_07_30_their_time_is_not_in_first_message_hours_without_tzdata(self):
        t = datetime(2026, 10, 8, 6, 30, tzinfo=UTC)  # 07:30 London, 09:30 Kuwait
        with mock.patch("zoneinfo.ZoneInfo", side_effect=ZoneInfoNotFoundError("no time zone found")):
            in_hours = fu.in_hours(t, "GB", (9, 18))
        self.assertFalse(in_hours, "without tzdata a London lead's 07:30 reads as Kuwait's 09:30, in hours")


if __name__ == "__main__":
    unittest.main()
