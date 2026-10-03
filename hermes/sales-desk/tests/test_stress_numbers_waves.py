"""Stress round 1, numbers and data integrity, desk side: the backlog wave's
holdout comparison and its ceilings. Every lead and figure is invented.

    python3 -m unittest tests.test_stress_numbers_waves

The comparison (apps/sales-cockpit/src/lib/waves.ts effectLine) is the wave
arm's booking rate against the held-back arm's, each over the members whose
turn came (intent to treat at the turn). For that to be unbiased, a member's
booking has to be seen the same way in both arms. A test that fails here is a finding, kept as a regression
test for its fix.
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, waves  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import NOW, SETTINGS, members, routes, run, sb, seed, wave  # noqa: E402

MEMBERS = waves.MEMBERS
INTRO_CAL = "dsqmJ393Dwl9fDSbIVOI"


def measured(m: dict) -> bool:
    """waves.ts measured(): a member is in its arm's comparison once their turn
    came (intent to treat at the turn): the opener went, or due_at was set
    (the holdout's turn, or a wave member taken out at their turn). A member
    a stopped wave let go of before their turn is in neither arm."""
    if m["arm"] == "holdout":
        return bool(m.get("due_at")) or m["state"] in ("booked", "closed")
    return m["state"] in ("sent", "replied", "booked", "closed") or (m["state"] == "excluded" and bool(m.get("due_at")))


def effect(pg: FakePostgrest, wid: str) -> tuple[float, float]:
    """The screen's two rates (waves.ts countMembers and effectLine): booked over the measured members of each arm."""
    rows = members(pg, wid)
    wave_arm = [m for m in rows if m["arm"] == "wave" and measured(m)]
    hold_arm = [m for m in rows if m["arm"] == "holdout" and measured(m)]
    rate = lambda arm: sum(1 for m in arm if m["state"] == "booked") / len(arm)  # noqa: E731
    return rate(wave_arm), rate(hold_arm)


class HoldoutComparison(unittest.TestCase):
    def test_with_no_real_effect_the_comparison_reads_no_effect_whoever_leaves_the_wave_arm(self):
        """Two arms of 100 identical leads; one in five books an intro three days after their turn,
        whatever happens, so the opener does nothing. In the wave arm 30 leave at their turn the way
        the desk takes them out (a rep skips the opener, it fails twice, the lead is a client now,
        the conversation moved on); their twins in the holdout are not taken out of anything."""
        pg = FakePostgrest()
        wave(pg, "w1", "no_show_cancelled")
        t0 = NOW.isoformat()
        for i in range(100):
            c = f"stress-w-{i:03d}"
            gone = i < 30
            pg.put(MEMBERS, {"wave_id": "w1", "contact_id": c, "arm": "wave",
                             "state": "excluded" if gone else "sent",
                             "excluded_reason": "A rep skipped the opener." if gone else None,
                             "sent_at": None if gone else t0, "added_at": t0})
            h = f"stress-h-{i:03d}"
            pg.put(MEMBERS, {"wave_id": "w1", "contact_id": h, "arm": "holdout", "state": "held_out",
                             "due_at": t0, "added_at": t0})
            if i % 5 == 0:
                for who in (c, h):
                    pg.put("cockpit_sales_calendar", {"appointment_id": f"b-{who}", "contact_id": who,
                                                      "call_type": "intro", "calendar_id": INTRO_CAL,
                                                      "status": "confirmed",
                                                      "booked_at": (NOW + timedelta(days=3)).isoformat(),
                                                      "start_at": (NOW + timedelta(days=5)).isoformat()})
        with mock.patch.object(http, "request", pg):
            waves.outcomes(sb(), ["w1"], NOW + timedelta(days=15))
        p_wave, p_hold = effect(pg, "w1")
        # Both arms really booked at 20%. The screen must not read a difference that is not there.
        self.assertAlmostEqual(p_wave - p_hold, 0.0, delta=0.02,
                               msg=f"wave {p_wave:.0%} against holdout {p_hold:.0%} with no real effect")

    def test_a_wave_stopped_halfway_compares_like_with_like(self):
        """A manager stops a wave after half its leads had their opener. The leads whose turn never
        came leave both arms (wind_down); what is left must still compare equal leads."""
        pg = FakePostgrest()
        wave(pg, "w1", "no_show_cancelled", state="done", done_reason="Stopped by a manager.")
        t0 = NOW.isoformat()
        for i in range(100):
            c, h = f"stress-w-{i:03d}", f"stress-h-{i:03d}"
            turn = i < 50
            pg.put(MEMBERS, {"wave_id": "w1", "contact_id": c, "arm": "wave", "state": "sent" if turn else "waiting",
                             "sent_at": t0 if turn else None, "added_at": t0})
            pg.put(MEMBERS, {"wave_id": "w1", "contact_id": h, "arm": "holdout", "state": "held_out",
                             "due_at": t0 if turn else None, "added_at": t0})
            if i % 5 == 0:
                for who in (c, h):
                    pg.put("cockpit_sales_calendar", {"appointment_id": f"b-{who}", "contact_id": who,
                                                      "call_type": "intro", "calendar_id": INTRO_CAL, "status": "confirmed",
                                                      "booked_at": (NOW + timedelta(days=3)).isoformat(),
                                                      "start_at": (NOW + timedelta(days=5)).isoformat()})
        with mock.patch.object(http, "request", pg):
            waves.wind_down(sb(), [pg.one(waves.WAVES, id="w1")], NOW)
            waves.outcomes(sb(), ["w1"], NOW + timedelta(days=15))
        p_wave, p_hold = effect(pg, "w1")
        # Each arm really booked 20% of the leads whose turn came, and nobody else was written to.
        self.assertAlmostEqual(p_wave, 0.2, delta=0.02, msg=f"wave arm reads {p_wave:.0%}")
        self.assertAlmostEqual(p_hold, 0.2, delta=0.02, msg=f"holdout reads {p_hold:.0%}")

    def test_the_holdout_is_salted_stable_and_a_tenth_in_every_pool_and_order(self):
        ids = [f"stress-{i:06d}" for i in range(30_000)]
        held = [c for c in ids if waves.holdout(c, 0.1, "waves")]
        self.assertAlmostEqual(len(held) / len(ids), 0.1, delta=0.006)
        # Newest-first order and pool membership never bias it: every tenth of the list is held ~10%.
        for k in range(10):
            part = ids[k * 3000:(k + 1) * 3000]
            self.assertAlmostEqual(sum(waves.holdout(c, 0.1, "waves") for c in part) / 3000, 0.1, delta=0.02)
        # The demo chat's own holdout is independent (C36), not nested.
        threads = {c for c in ids if waves.holdout(c, 0.1, "threads")}
        self.assertAlmostEqual(len(set(held) & threads) / len(held), 0.1, delta=0.02)
        # The same lead lands the same way every run.
        self.assertEqual(held, [c for c in ids if waves.holdout(c, 0.1, "waves")])


class Ceilings(unittest.TestCase):
    def test_a_wave_started_at_zero_openers_a_day_drafts_none(self):
        """followup.wave accepts per_day 0 to 200 (followupAgent.ts). A wave a manager starts at 0 a
        day must write no opener; the desk reads `wave.per_day or 40`, so 0 becomes 40."""
        pg = FakePostgrest()
        routes(pg)
        for i in range(60):
            seed(pg, f"stress-z{i:02d}", "no_show_cancelled", days=i + 1)
        wave(pg, "w0", "no_show_cancelled", per_day=0)
        run(pg)
        drafted = [m for m in members(pg, "w0") if m["state"] == "drafted"]
        self.assertEqual(len(drafted), 0, f"{len(drafted)} openers drafted for a wave set to 0 a day")

    def test_the_desk_never_drafts_more_than_the_days_ceiling_across_waves(self):
        pg = FakePostgrest()
        routes(pg)
        for i in range(120):
            seed(pg, f"stress-a{i:03d}", "no_show_cancelled", days=i + 1)
            seed(pg, f"stress-b{i:03d}", "never_booked", days=i + 1)
        wave(pg, "wa", "no_show_cancelled", per_day=40)
        wave(pg, "wb", "never_booked", per_day=40)
        settings = {**SETTINGS, "waves": {**SETTINGS["waves"], "per_day": 25}}
        run(pg, settings=settings)
        run(pg, settings=settings, now=NOW + timedelta(minutes=5))
        drafted = [m for m in members(pg) if m["state"] == "drafted"]
        self.assertLessEqual(len(drafted), 25)

    def test_the_month_budget_refuses_before_the_send_that_would_pass_it(self):
        """$100 at $0.0792 a template is 1,262 templates ($99.95); the 1,263rd would pass $100."""
        pg = FakePostgrest()
        start = NOW.replace(day=1)
        for i in range(1262):
            pg.put("cockpit_sales_messages", {"id": f"m{i}", "via": "workflow", "state": "sent",
                                              "created_at": (start + timedelta(minutes=i)).isoformat()})
        with mock.patch.object(http, "request", pg):
            spent = waves.template_budget(sb(), {"template_budget_usd_month": 100}, NOW)
        self.assertIsNotNone(spent)
        pg.tables["cockpit_sales_messages"].pop(("m0",))
        with mock.patch.object(http, "request", pg):
            self.assertIsNone(waves.template_budget(sb(), {"template_budget_usd_month": 100}, NOW))


if __name__ == "__main__":
    unittest.main()
