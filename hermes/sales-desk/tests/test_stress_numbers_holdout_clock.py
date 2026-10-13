"""Stress round 2, numbers and data integrity, desk side: the backlog wave's
holdout comparison when the two arms' 14 days do not start together. Every
lead and figure is invented.

    python3 -m unittest tests.test_stress_numbers_holdout_clock

The screen (apps/sales-cockpit/src/lib/waves.ts effectLine) reads the wave's
effect as the wave arm's booking rate minus the held-back arm's, each over
the members whose turn came, "intent to treat at the turn" (waves.py _t0).
For that to read no effect when the opener does nothing, a member's booking
must be seen the same way in both arms, from the same moment.

What the desk does: a held-back lead's 14 days start when the wave DRAFTS
the batch level with them (_draft_wave sets due_at = now). A wave lead's 14
days start when their opener is SENT (sent_at), which is later: a manager
approves the batch hours or a day after it is written, and a lead whose
turn is put off ("someone wrote to them from HighLevel lately", "another
draft is open", a rep's pause) waits a day or more. A wave lead who books
in that gap is taken out at their next turn (no longer in a pool), with
due_at then, so their booking falls before their own clock starts and is
never counted; their twin in the holdout books at the same moment and is
counted. The comparison then shows the wave doing worse than nothing.

Each test runs the real pipeline (waves.run: enrolment, drafting, the
holdout's due_at, sync, the next turn) with an opener that changes nothing,
and asks the comparison to read no effect. A failure is a finding, kept as
a regression test for its fix.
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, waves  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import NOW, SETTINGS, Ghl, members, routes, run, sb, seed, wave  # noqa: E402

MEMBERS = waves.MEMBERS
FOLLOWUPS = waves.FOLLOWUPS
INTRO_CAL = "dsqmJ393Dwl9fDSbIVOI"
# Both arms the same size, so a small difference is visible.
EVEN = {**SETTINGS, "waves": {**SETTINGS["waves"], "per_day": 200, "holdout_share": 0.5}}
N = 160


def measured(m: dict) -> bool:
    """waves.ts measured(), word for word."""
    if m["arm"] == "holdout":
        return bool(m.get("due_at")) or m["state"] in ("booked", "closed")
    return (m["state"] in ("sent", "replied", "booked", "closed", "done")
            or (m["state"] == "excluded" and bool(m.get("due_at"))))


def effect(pg: FakePostgrest, wid: str) -> tuple[float, float, int, int]:
    """waves.ts countMembers and effectLine: booked over the measured members of each arm."""
    rows = members(pg, wid)
    w = [m for m in rows if m["arm"] == "wave" and measured(m)]
    h = [m for m in rows if m["arm"] == "holdout" and measured(m)]
    rate = lambda arm: sum(1 for m in arm if m["state"] == "booked") / max(1, len(arm))  # noqa: E731
    return rate(w), rate(h), len(w), len(h)


def book(pg: FakePostgrest, c: str, at, start) -> None:
    """The lead books an intro by themselves (a setter's call, the booking page): the same in both arms."""
    pg.put("cockpit_sales_calendar", {"appointment_id": f"b-{c}", "contact_id": c, "call_type": "intro",
                                      "calendar_id": INTRO_CAL, "status": "confirmed",
                                      "booked_at": at.isoformat(), "start_at": start.isoformat()})


def leads(pg: FakePostgrest) -> list[str]:
    ids = [f"stress-hc-{i:03d}" for i in range(N)]
    for i, c in enumerate(ids):
        seed(pg, c, "no_show_cancelled", days=i + 1)
    return ids


class HoldoutClock(unittest.TestCase):
    def test_holdout_clock_starts_at_draft_wave_at_send_approval_lag(self):
        """The batch is written at 10:00; a manager approves it the next morning. One lead in four
        books an intro that evening by themselves, in both arms alike; one in ten books on day 6.
        The opener does nothing, so the two arms must read the same booking rate."""
        pg = FakePostgrest()
        routes(pg)
        ids = leads(pg)
        wave(pg, "w1", "no_show_cancelled", holdout_share=0.5, per_day=200)
        run(pg, settings=EVEN)  # day 0, 10:00 Kuwait: enrol, draft, the holdout's 14 days start
        drafted = [m for m in members(pg, "w1") if m["state"] == "drafted"]
        self.assertGreater(len(drafted), 40, "the day's batch was not written")
        held = members(pg, "w1", arm="holdout")
        self.assertGreater(sum(1 for m in held if m.get("due_at")), 0.8 * len(held),
                           "the held-back leads level with the batch start their 14 days at the draft")
        evening, next_day = NOW + timedelta(hours=10), NOW + timedelta(days=1)
        for i, c in enumerate(ids):
            if i % 4 == 0:
                book(pg, c, evening, NOW + timedelta(days=3))
            elif i % 10 == 1:
                book(pg, c, NOW + timedelta(days=6), NOW + timedelta(days=8))
        # The next morning the manager approves the batch and the desk sends it. sales-api's
        # followup.send_due takes back the opener of a lead who has booked since (opener_booked).
        for m in drafted:
            f = pg.one(FOLLOWUPS, id=m["followup_id"])
            if pg.one("cockpit_sales_calendar", appointment_id=f"b-{m['contact_id']}") and \
                    m["contact_id"] in {c for i, c in enumerate(ids) if i % 4 == 0}:
                f.update({"status": "expired", "decided_at": next_day.isoformat(),
                          "error": "The lead has booked a call since, so the backlog opener was taken back."})
            else:
                f.update({"status": "sent", "decided_at": next_day.isoformat()})
        # The next run: sync records the sends; a taken-back lead's next turn takes them out
        # (no longer in a pool), due_at at that turn.
        run(pg, settings=EVEN, now=next_day + timedelta(hours=1))
        with mock.patch.object(http, "request", pg):
            waves.outcomes(sb(), ["w1"], NOW + timedelta(days=20))
        p_wave, p_hold, n_wave, n_hold = effect(pg, "w1")
        self.assertGreater(min(n_wave, n_hold), 40)
        # Both arms really booked at the same rate (35% within 14 days of the batch).
        self.assertAlmostEqual(p_wave - p_hold, 0.0, delta=0.08,
                               msg=f"wave {p_wave:.0%} against holdout {p_hold:.0%} with no real effect "
                                   f"({n_wave} and {n_hold} measured)")

    def test_holdout_clock_starts_at_draft_wave_at_send_postponed_turn(self):
        """A third of the pool is mid-conversation with a rep (a rep wrote from HighLevel two hours
        ago), in both arms alike. The wave puts those leads' turn off by 20 hours; half of them book
        an intro that evening because of the rep's conversation, not the opener. The holdout twins'
        14 days started at the batch. The opener does nothing, so the arms must read the same."""
        pg = FakePostgrest()
        routes(pg)
        ids = leads(pg)
        talking = {c for i, c in enumerate(ids) if i % 3 == 0}
        two_hours_ago = (NOW - timedelta(hours=2)).isoformat()
        people = {c: {"thread": [{"id": f"m-{c}", "dateAdded": two_hours_ago, "direction": "outbound",
                                  "body": "Hi, following up on our call.", "source": "app",
                                  "messageType": "TYPE_WHATSAPP"}]} for c in talking}
        wave(pg, "w1", "no_show_cancelled", holdout_share=0.5, per_day=200)
        run(pg, Ghl(pg, people), settings=EVEN)
        waiting = members(pg, "w1", arm="wave", state="waiting")
        self.assertTrue(waiting and all(m["contact_id"] in talking and m.get("next_try_at") for m in waiting),
                        "the leads mid-conversation wait for another day")
        # The batch is approved and sent within the hour.
        for m in members(pg, "w1", arm="wave", state="drafted"):
            pg.one(FOLLOWUPS, id=m["followup_id"]).update({"status": "sent",
                                                          "decided_at": (NOW + timedelta(hours=1)).isoformat()})
        for i, c in enumerate(sorted(talking)):
            if i % 2 == 0:
                book(pg, c, NOW + timedelta(hours=8), NOW + timedelta(days=2))
        # The next morning their turn comes again: booked, so out of the pool (due_at now).
        run(pg, Ghl(pg, {}), settings=EVEN, now=NOW + timedelta(days=1))
        with mock.patch.object(http, "request", pg):
            waves.outcomes(sb(), ["w1"], NOW + timedelta(days=20))
        p_wave, p_hold, n_wave, n_hold = effect(pg, "w1")
        self.assertGreater(min(n_wave, n_hold), 40)
        self.assertAlmostEqual(p_wave - p_hold, 0.0, delta=0.08,
                               msg=f"wave {p_wave:.0%} against holdout {p_hold:.0%} with no real effect "
                                   f"({n_wave} and {n_hold} measured)")


if __name__ == "__main__":
    unittest.main()
