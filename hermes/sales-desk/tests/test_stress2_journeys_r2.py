"""Stress series 2, round 2, JOURNEYS: the desk's half of a manager's wave
journey (start, pause before the next run, resume) on the fakes. The
cockpit's half is supabase/functions/sales-api/stress2_journeys_r2_waves.test.ts.
Every lead and line is invented.

    python3 -m unittest tests.test_stress2_journeys_r2
"""
from __future__ import annotations

import os
import unittest

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import waves  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import members, routes, run, seed, wave  # noqa: E402


class PausedBeforeEnrolment(unittest.TestCase):
    def test_a_wave_paused_before_the_next_run_gets_its_leads_as_the_card_says(self):
        """The manager presses Start at 10:00 and Pause at 10:01. The card
        (apps/sales-cockpit/src/lib/waves.ts waveLine) says of the paused,
        unenrolled wave: "The desk adds the pool's leads within 5 minutes;
        nothing is counted before then." The desk's run enrols only running
        waves, so a paused one has no leads however many runs go by, and the
        card says the same sentence all that time."""
        pg = FakePostgrest()
        routes(pg)
        for i in range(12):
            seed(pg, f"stress-r2j-n{i:02d}", "never_booked", days=i + 2)
        wave(pg, "w-paused", "never_booked", state="paused")
        out1, _, _, _ = run(pg)
        out2, _, _, _ = run(pg)
        ok, line = waves.words(out2)
        # What a manager reads on the Team page's waves row meanwhile.
        self.assertEqual(out1.get("enrolled"), {})
        self.assertIn("paused", line)
        # Fix round 2 keeps the desk's rule (only a running wave is enrolled)
        # and changes the card instead: a paused wave with no leads says
        # "paused before its leads were added. Resume it, and the desk adds
        # them at its next run." (waves.ts waveLine), never "within 5 minutes".
        self.assertEqual(len(members(pg, "w-paused")), 0)
        # Resumed: the next run adds the pool's leads, as the card then says.
        pg.one(waves.WAVES, id="w-paused")["state"] = "running"
        run(pg)
        self.assertGreater(len(members(pg, "w-paused")), 0,
                           "a resumed wave's leads are not added at the desk's next run, as the card says")


if __name__ == "__main__":
    unittest.main()
