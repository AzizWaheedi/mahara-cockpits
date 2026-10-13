"""Milestone 1, video-link round 1, provider quirks on the room worker's side
(2026-10-05): what the setter is told when Google Calendar's usage limit for
the day is spent while a Meet room is made. Each test drives the real worker
through the fakes the lane's own tests use (tests/test_rooms.py), with
Google's own error body; a failing test names a defect for the fix lane.
Every room, seat and meeting is invented; nothing reaches the network.

    python3 -m unittest tests.test_m1_providers_r1
"""
from __future__ import annotations

import os

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms  # noqa: E402
from tests.test_rooms import RoomsCase  # noqa: E402
from tests.test_stress2_providers import google_limit  # noqa: E402


# ---------------------------------------------------------------------------
# 1. Google Calendar answers the Meet room's event insert with its daily
#    usage limit: 403, reason quotaExceeded, "Calendar usage limits
#    exceeded." (developers.google.com/calendar/api/guides/errors: the
#    account made too many events; it passes after some hours, not seconds).
#    GOOGLE_RETRY rightly leaves quotaExceeded out (it does not pass in a
#    second), but _google_sentence reads every usage limit as
#    SAY["google_down"]: "Google did not answer. Try again in a minute, or
#    use Zoom." Google did answer, and a minute later the next room fails
#    the same way, for hours. The setter's default is Meet and the setters'
#    Zoom seats are Basic or pending, so they press again and again on the
#    sentence's word. Zoom's own daily cap has its own sentence
#    (SAY["zoom_daily_cap"]); Google's has none.
# ---------------------------------------------------------------------------

class GoogleDailyLimitWhileMakingAMeetRoom(RoomsCase):
    def _fail_once(self, n: int) -> dict:
        self.env.google.script = [{"method": "POST", "path": "/events", "status": 403,
                                   "body": google_limit("quotaExceeded", message="Calendar usage limits exceeded.")}]
        self.env.add_room(n, provider="meet")
        self.env.worker(f"run-{n}").run(seconds=10)
        return self.env.room(n)

    def test_the_daily_limit_is_not_said_as_google_not_answering(self):
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]
        first = self._fail_once(1)
        self.assertEqual(first["state"], "failed")
        # The setter does what the sentence says: a minute later, again.
        self.env.clock.advance(60)
        second = self._fail_once(2)
        self.assertEqual(second["state"], "failed")
        said = str(first.get("error") or "")
        self.assertFalse("did not answer" in said or "Try again in a minute" in said,
                         f"Google answered with its daily usage limit (quotaExceeded, passes after hours), and the "
                         f"setter was told {said!r}; the room a minute later failed again with "
                         f"{second.get('error')!r}")

    def test_held_control_a_rate_limit_that_passes_in_seconds_is_tried_again(self):
        self.env.google.calendars = [{"id": "rooms@group.example.test", "summary": "Sales rooms"}]
        self.env.google.script = [{"method": "POST", "path": "/events", "status": 403,
                                   "body": google_limit("rateLimitExceeded")}]
        self.env.add_room(1, provider="meet")
        self.env.worker().run(seconds=10)
        self.assertIn(self.env.room(1)["state"], ("open", "creating"))
        self.assertIn("quotaExceeded", rooms.GOOGLE_LIMITS)
        self.assertNotIn("quotaExceeded", rooms.GOOGLE_RETRY)


if __name__ == "__main__":
    import unittest
    unittest.main()
