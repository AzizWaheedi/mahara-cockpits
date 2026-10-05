"""TIME stress, second series, round 6 (the desk): a week of confirmations on
the desk's own run clock.

    python3 -m unittest tests.test_stress2_time_r6

The desk's followups job runs at :07 and :37 (README, Cron) and writes
nothing in its quiet hours (followups.quiet: 21:00 to 09:00 Kuwait). A
"confirm" draft is due from confirm_from(start, country) and expires at
min(written + 48 h, start - 1 h) (followups.run). sales-api sends it only
from 09:00 to 21:00 on every clock of the lead's (sendrules.ts hoursRefusal,
a later message; the desk's mirror is in_hours(..., CONFIRM_HOURS,
first=False)). The first series' check (tests/test_stress_time_r3.py
AConfirmationOnTheLeadsClock) asks only that some moment between
confirm_from and the call is in the lead's hours: it leaves out the quiet
hours the draft waits through and the expiry an hour before the call.

The real calendar (read-only, 5 October 2026) holds an intro at 17:20 Kuwait
for a lead in Canada and one at 12:20 Kuwait for a lead in the US.

A test that fails here is a finding.
"""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timedelta, timezone

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu  # noqa: E402

KW = timezone(timedelta(hours=3))
UTC = timezone.utc


def kw(day: int, h: int, m: int = 0) -> datetime:
    return datetime(2026, 10, day, h, m, tzinfo=KW).astimezone(UTC)


def runs(frm: datetime, to: datetime):
    """The followups job's runs (:07 and :37 every hour) from `frm` to `to`."""
    t = frm.replace(minute=0, second=0, microsecond=0)
    while t <= to:
        for m in (7, 37):
            r = t.replace(minute=m)
            if frm <= r <= to:
                yield r
        t += timedelta(hours=1)


def first_draft(call: dict, country: str, start: datetime) -> datetime | None:
    """The first run that writes the confirmation: outside quiet hours, and
    pick() names the call (the desk's run(): quiet first, then pick)."""
    lead = {"contact_id": call["contact_id"], "country": country}
    for r in runs(start - timedelta(hours=40), start):
        if fu.quiet(r, {}):
            continue
        out = fu.pick(r, inbox=[], calendar=[call], leads=[lead])
        if any(d["segment"] == "confirm" for d in out):
            return r
    return None


def sendable(written: datetime, start: datetime, country: str) -> list[datetime]:
    """Every minute the draft is on the page (before its expiry) and sales-api would send it."""
    expires = min(written + timedelta(hours=48), start - timedelta(hours=1))
    out, t = [], written
    while t < expires:
        if fu.in_hours(t, country, fu.CONFIRM_HOURS, first=False):
            out.append(t)
        t += timedelta(minutes=1)
    return out


class AConfirmationTheDeskCanSend(unittest.TestCase):
    def check(self, country: str, start: datetime):
        call = {"appointment_id": f"stress-t2r6-{country}", "contact_id": f"stress-t2r6-lead-{country}", "call_type": "intro",
                "status": "confirmed", "start_at": start.isoformat(), "booked_at": (start - timedelta(days=4)).isoformat()}
        written = first_draft(call, country, start)
        self.assertIsNotNone(written, f"no confirmation is ever written for the {country} lead's call")
        ok = sendable(written, start, country)
        return written, ok

    def test_canada_intro_at_17_20_kuwait(self):
        # 11:20 Halifax, 10:20 Toronto, 07:20 Vancouver (Monday 12 October).
        start = kw(12, 17, 20)
        written, ok = self.check("CA", start)
        # Found: written at Monday 09:07 Kuwait (03:07 Halifax, 23:07 Sunday in
        # Vancouver: confirm_from is 18:00 Halifax on Sunday, Kuwait's 00:00,
        # inside the desk's quiet hours), expiring at 16:20 Kuwait; every
        # minute in between is night on one of the lead's clocks. Each Send is
        # refused "It is night where the lead is. Send it after 9 in the
        # morning, their time."; the lead gets no confirmation, and the dead
        # draft holds the lead's one open draft (no reply draft) for 7 hours.
        self.assertTrue(ok, f"written {(written + fu.KUWAIT):%a %H:%M} Kuwait, never sendable before it expires "
                            f"at {(start - timedelta(hours=1) + fu.KUWAIT):%H:%M} Kuwait")

    def test_us_intro_at_12_20_kuwait(self):
        start = kw(12, 12, 20)
        written, ok = self.check("US", start)
        # Found: written Monday 09:07 Kuwait (02:07 New York), expires 11:20
        # Kuwait (04:20 New York): never sendable.
        self.assertTrue(ok, f"written {(written + fu.KUWAIT):%a %H:%M} Kuwait, never sendable before it expires")

    def test_london_intro_the_sunday_the_clocks_go_back(self):
        # Sunday 25 October 2026: London leaves summer time at 01:00 UTC. The
        # intro is at 10:00 London (13:00 Kuwait); "18:00 the evening before"
        # is Saturday 18:00 BST (17:00 UTC, 20:00 Kuwait).
        from zoneinfo import ZoneInfo
        start = datetime(2026, 10, 25, 10, 0, tzinfo=ZoneInfo("Europe/London")).astimezone(UTC)
        due = fu.confirm_from(start, "GB")
        # Found: Saturday 19:00 BST (21:00 Kuwait): the offset is read at the
        # call (GMT), not at the evening before (BST), so the evening-before
        # rule lands an hour late, on the first minute of the desk's quiet hours.
        self.assertEqual(due.astimezone(ZoneInfo("Europe/London")).strftime("%a %H:%M"), "Sat 18:00")

    def test_london_intro_the_sunday_the_clocks_go_back_can_be_confirmed(self):
        from zoneinfo import ZoneInfo
        start = datetime(2026, 10, 25, 10, 0, tzinfo=ZoneInfo("Europe/London")).astimezone(UTC)
        written, ok = self.check("GB", start)
        # And so the draft waits to Sunday 09:07 Kuwait (06:07 London) and
        # expires at 12:00 Kuwait (09:00 London): never sendable.
        self.assertTrue(ok, f"written {(written + fu.KUWAIT):%a %H:%M} Kuwait, never sendable before it expires")

    def test_control_london_intro_at_11_00_kuwait(self):
        start = kw(12, 11, 0)
        written, ok = self.check("GB", start)
        self.assertTrue(ok)


class AConfirmationAfterThePhoneCall(unittest.TestCase):
    """Fix round 6 (confirm-draft-sent-after-phone-confirmation): the desk's
    close_gone reads the call's confirmations too, so a lead who confirmed on
    the setter's evening-before call is never asked again by message."""

    def test_a_phone_confirmation_after_the_draft_closes_it(self):
        start = kw(8, 10)
        made = kw(7, 18, 7)
        d = {"segment": "confirm", "appointment_id": "a1", "created_at": made.isoformat(),
             "context": {"start_at": start.isoformat()}}
        call = {"appointment_id": "a1", "status": "confirmed", "start_at": start.isoformat()}
        now = kw(7, 18, 37)
        self.assertIsNone(fu.gone_reason(d, [call], [], [], now, confirmations=[]))
        before = [{"result": "confirmed", "at": kw(7, 17, 0).isoformat()}]
        self.assertIsNone(fu.gone_reason(d, [call], [], [], now, confirmations=before))
        after = [{"result": "confirmed", "at": kw(7, 18, 20).isoformat()}]
        self.assertIn("confirmed on the phone", fu.gone_reason(d, [call], [], [], now, confirmations=after) or "")


if __name__ == "__main__":
    unittest.main()
