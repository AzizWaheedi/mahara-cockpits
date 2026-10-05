"""Second series, round 6, numbers and data integrity, desk side. Every lead
and figure is invented.

    python3 -m unittest tests.test_stress2_numbers_r6

1. A day's batch whose turns are all put off (the lead's template is not
   set up yet, another draft is open, the agent's own sequence still runs)
   stamps due_at on every wave member whose turn came, and on their
   held-back twins at the end of _draft_wave: both arms' 14 days start
   there (waves.py _t0, waves.ts measured). The only audit row of the
   drafting, waves.draft, is written when an opener was drafted or a lead
   taken out, so a run that only put leads off moves the comparison with
   no audit row (the standing rule: every write leaves one). Round 5 fixed
   the same write in stamp_twins only.

A failing test is a finding.
"""
from __future__ import annotations

import os
import unittest
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, waves  # noqa: E402
from tests import fakes  # noqa: E402
from tests.test_waves import OPENER_AR, NOW, SETTINGS, members, routes, run, sb, seed, wave  # noqa: E402

AUDIT = "cockpit_audit_log"
fakes.PK.setdefault(AUDIT, ("action", "entity_type", "entity_id"))
EVEN = {**SETTINGS, "waves": {**SETTINGS["waves"], "per_day": 40, "holdout_share": 0.5}}


class PutOffTurnsAudited(unittest.TestCase):
    def setUp(self):
        self.pg = fakes.FakePostgrest()
        self.pg.tables.setdefault(AUDIT, {})
        routes(self.pg, OPENER_AR)  # only the Arabic opener is set up
        for i in range(30):
            # Leads in London: their opener is the English one, not set up yet.
            seed(self.pg, f"stress-s2n6-uk{i:02d}", "no_show_cancelled", days=i + 1, country="United Kingdom")
        wave(self.pg, "w6", "no_show_cancelled", holdout_share=0.5, per_day=40)

    def test_put_off_turns_start_both_arms_clocks_with_no_audit_row(self):
        """holdout-stamp-at-draft-unaudited: every turn today was put off ('The English template
        is not set up yet'), each stamped with its due_at, and the held-back twins level with
        them stamped too, so both arms' 14 days started; no audit row says so."""
        run(self.pg, settings=EVEN)
        turned = [m for m in members(self.pg, "w6", arm="wave") if m.get("due_at")]
        twins = [m for m in members(self.pg, "w6", arm="holdout") if m.get("due_at")]
        self.assertTrue(turned, "no wave member had its turn")
        self.assertTrue(twins, "no held-back twin was stamped")
        after_enrol = [r for r in self.pg.rows(AUDIT) if r.get("entity_id") == "w6" and r.get("action") != "waves.enroll"]
        self.assertTrue(after_enrol,
                        f"{len(turned)} wave members and {len(twins)} held-back leads started their 14 days with no "
                        f"audit row (audit rows: {[r.get('action') for r in self.pg.rows(AUDIT)]})")


if __name__ == "__main__":
    unittest.main()


class FinishCatchUpAudited(unittest.TestCase):
    def test_wind_down_starting_the_held_back_clock_leaves_no_audit_row(self):
        """holdout-stamp-at-draft-unaudited (wind_down): finish() set the wave done and stopped
        before stamping the held-back leads (fix round 4's case); the next run's wind_down starts
        their 14 days (due_at) and counts them as 'started', but writes its audit row only when
        it took back or let go of someone, so this write to the comparison leaves none."""
        pg = fakes.FakePostgrest()
        pg.tables.setdefault(AUDIT, {})
        routes(pg)
        wave(pg, "w7", "no_show_cancelled", state="done", done_reason=waves.FINISHED, enrolled_at=NOW.isoformat())
        for i in range(3):
            pg.put("cockpit_sales_followup_wave_members", {
                "wave_id": "w7", "contact_id": f"stress-s2n6-fin{i}", "arm": "holdout", "state": "held_out",
                "event_at": NOW.isoformat(), "due_at": None, "added_at": NOW.isoformat()})
        with mock.patch.object(http, "request", pg):
            out = waves.wind_down(sb(), [pg.one("cockpit_sales_followup_waves", id="w7")], NOW)
        stamped = [m for m in members(pg, "w7", arm="holdout") if m.get("due_at")]
        self.assertEqual(len(stamped), 3, out)
        self.assertTrue([r for r in pg.rows(AUDIT) if r.get("entity_id") == "w7"],
                        f"{len(stamped)} held-back leads started their 14 days with no audit row ({out})")
