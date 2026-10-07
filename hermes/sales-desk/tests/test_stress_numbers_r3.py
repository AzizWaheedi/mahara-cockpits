"""Stress round 3, numbers and data integrity, desk side: the backlog wave's
holdout across waves. Every lead and figure is invented.

    python3 -m unittest tests.test_stress_numbers_r3

The comparison a wave shows (apps/sales-cockpit/src/lib/waves.ts effectLine)
is "what one opener does" only while both arms are drawn from the same
leads by chance. A pool is worked again once its leads' 30 days are over
(waves._busy): the 1,281 backlog leads at 40 a day take about 32 days, so a
second wave on the same pool is the normal next step. A test that fails
here is a finding, kept as a regression test for its fix.
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, waves  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import NOW, SETTINGS, members, sb, seed, wave  # noqa: E402

MEMBERS = waves.MEMBERS


class HoldoutAcrossWaves(unittest.TestCase):
    def test_holdout_arm_fixed_across_waves(self):
        """Wave 1 on the no-shows ran 40 days ago: its wave arm had an opener,
        its holdout had none, and nobody booked. Wave 2 starts on the same
        pool. sha256('waves:'||contact_id) puts every lead in the same arm as
        before, so wave 2 compares "a second opener to leads who ignored the
        first" with "no opener ever": the leads the first opener moved have
        left the wave arm (they booked) but are still in the holdout, so the
        second wave's effect reads low, and the same tenth of the backlog is
        never written to by any wave. Drawn per wave, about a tenth of wave
        2's holdout would be wave 1's."""
        pg = FakePostgrest()
        contacts = [f"stress-r3-{i:04d}" for i in range(600)]
        for i, c in enumerate(contacts):
            seed(pg, c, "no_show_cancelled", days=50 + i % 30)
        old = NOW - timedelta(days=40)
        wave(pg, "w1", "no_show_cancelled", state="done", enrolled_at=old.isoformat(),
             settled_at=(old + timedelta(days=15)).isoformat())
        for c in contacts:
            held = waves.holdout(c, 0.1, "waves")
            pg.put(MEMBERS, {"wave_id": "w1", "contact_id": c, "arm": "holdout" if held else "wave",
                             "state": "closed", "added_at": old.isoformat(), "due_at": old.isoformat(),
                             "sent_at": None if held else old.isoformat(),
                             "closed_at": (old + timedelta(days=14)).isoformat()})
        w2 = wave(pg, "w2", "no_show_cancelled")
        logs: list[str] = []
        with mock.patch.object(http, "request", pg):
            waves.enroll(sb(), w2, NOW, waves.settings_of(SETTINGS), logs.append)
        first = {m["contact_id"] for m in members(pg, "w1", arm="holdout")}
        second = {m["contact_id"] for m in members(pg, "w2", arm="holdout")}
        self.assertGreater(len(second), 30, f"wave 2 held back {len(second)} leads: {logs}")
        overlap = len(first & second) / len(second)
        self.assertLess(overlap, 0.5, f"{overlap:.0%} of wave 2's held-back leads were wave 1's held-back leads")


if __name__ == "__main__":
    unittest.main()
