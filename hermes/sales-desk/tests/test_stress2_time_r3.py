"""TIME stress, second series, round 3 (the desk): a UAE lead's week.

followups.quiet_days (Friday as shipped) is the lead's day off: the desk's
send_due never sends an opener then (followups.lead_days_off). Since fix
round 4 a lead whose weekend is not Friday gets their own Saturday and
Sunday off, for every zone outside FRIDAY_WEEKEND_ZONES. Asia/Dubai is in
that list, while the UAE's weekend has been Saturday and Sunday (Friday a
working half day) since 1 January 2022.

    python3 -m unittest tests.test_stress2_time_r3
"""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timedelta, timezone

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu  # noqa: E402

UAE = timezone(timedelta(hours=4))
KW = timezone(timedelta(hours=3))


def at(day: int, hour: int, tz=UAE) -> datetime:
    return datetime(2026, 10, day, hour, 0, tzinfo=tz).astimezone(timezone.utc)


class UaeWeekend(unittest.TestCase):
    def test_saturday_is_a_day_off_for_a_dubai_lead(self):
        # Found: set() (no day off): the opener goes on the lead's Saturday.
        self.assertTrue(fu.lead_days_off(at(10, 11), "AE", ["friday"]))

    def test_sunday_is_a_day_off_for_a_dubai_lead(self):
        # Found: set(): the opener goes on the lead's Sunday.
        self.assertTrue(fu.lead_days_off(at(11, 11), "AE", ["friday"]))

    def test_friday_morning_is_a_working_morning_in_the_uae(self):
        # Found: {'friday'}: the lead's working Friday morning is skipped.
        self.assertFalse(fu.lead_days_off(at(9, 11), "AE", ["friday"]))

    def test_control_kuwait_keeps_friday(self):
        self.assertEqual(fu.lead_days_off(at(9, 11, KW), "KW", ["friday"]), {"friday"})
        self.assertFalse(fu.lead_days_off(at(10, 11, KW), "KW", ["friday"]))


if __name__ == "__main__":
    unittest.main()
