"""Second series, round 4, numbers and data integrity, desk side: the
backlog wave's holdout clock when the one write that starts it fails. Every
lead and figure is invented.

    python3 -m unittest tests.test_stress2_numbers_r4

holdout-stamp-lost-on-blip: the held-back leads level with a day's batch
start their 14 days in ONE write at the very end of _draft_wave (the PATCH
of held_out members with due_at null and event_at at or after the oldest
turn of the day). Their wave twins' due_at is stamped one by one as each
turn comes. When that last write fails (a database blip), the run fails
after the day's batch is written; every later run that day finds the day's
room used ("Today's 40 openers are written") and never reaches the write,
so the twins start their 14 days with the NEXT day's batch: a day later
than the wave members they are compared with (waves.py _t0, waves.ts
effectLine: intent to treat at the turn, both arms from the same moment).

A failing test is a finding, kept as a regression test for its fix.
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http, waves  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import NOW, SETTINGS, members, routes, run, seed, wave  # noqa: E402

EVEN = {**SETTINGS, "waves": {**SETTINGS["waves"], "per_day": 40, "holdout_share": 0.5}}
N = 160


class BlipOnHoldoutStamp:
    """The database, with one 503 on the first write that starts the held-back leads' 14 days."""

    def __init__(self, pg: FakePostgrest):
        self.pg, self.blipped = pg, 0

    def __getattr__(self, k):
        return getattr(self.pg, k)

    def __call__(self, method, url, **kw):
        if (method == "PATCH" and self.blipped == 0 and "cockpit_sales_followup_wave_members" in url
                and "arm=eq.holdout" in url and "due_at=is.null" in url):
            self.blipped += 1
            raise http.HttpError(503, "upstream connect error or disconnect/reset before headers", b"", url)
        return self.pg(method, url, **kw)


class HoldoutStampBlip(unittest.TestCase):
    def setUp(self):
        self.pg = FakePostgrest()
        routes(self.pg)
        self.ids = [f"stress-s2n4-{i:03d}" for i in range(N)]
        for i, c in enumerate(self.ids):
            seed(self.pg, c, "no_show_cancelled", days=i + 1)
        wave(self.pg, "w1", "no_show_cancelled", holdout_share=0.5, per_day=40)

    def _turned_level(self):
        """The oldest event_at among the wave members whose turn came today, and the
        held-back members at or newer than it (their twins level with the day's batch)."""
        turned = [m for m in members(self.pg, "w1", arm="wave") if m.get("due_at")]
        oldest = min(fu._ts(m["event_at"]) for m in turned)
        level = [m for m in members(self.pg, "w1", arm="holdout") if fu._ts(m.get("event_at")) >= oldest]
        return turned, level

    def test_control_without_a_blip_the_twins_start_with_the_batch(self):
        run(self.pg, settings=EVEN)
        turned, level = self._turned_level()
        self.assertGreaterEqual(len(turned), 40)
        self.assertTrue(level)
        self.assertEqual([m["contact_id"] for m in level if not m.get("due_at")], [])

    def test_holdout_stamp_lost_on_blip(self):
        db = BlipOnHoldoutStamp(self.pg)
        try:
            run(db, settings=EVEN)  # 10:00: enrol, draft the day's 40; the twins' stamp hits the blip
        except Exception:  # noqa: BLE001 - the run's own failure is not what is under test
            pass
        self.assertEqual(db.blipped, 1, "the blip did not land on the twins' stamp")
        # The waves job runs every five minutes for the rest of the day.
        for k in range(1, 12):
            run(self.pg, settings=EVEN, now=NOW + timedelta(minutes=5 * k))
        turned, level = self._turned_level()
        self.assertGreaterEqual(len(turned), 40, "the day's batch was not written")
        unstamped = [m["contact_id"] for m in level if not m.get("due_at")]
        self.assertEqual(unstamped, [],
                         f"{len(unstamped)} of {len(level)} held-back leads level with today's {len(turned)} turns "
                         "have no due_at after an hour of runs: their 14 days start with tomorrow's batch, a day "
                         "after their wave twins'")


if __name__ == "__main__":
    unittest.main()
