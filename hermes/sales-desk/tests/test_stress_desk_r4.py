"""Stress round 4, the follow-up agent and its waves, desk side (2026-10-03):
an approved opener that waits (the lead's hours, a paused wave, a shut gate)
while the lead has a call or is disqualified, a run that dies between an
opener and its member, a spent template budget, a finish that dies half way,
and a wave whose opener template exists in one language only. Each test
asserts what must hold; a failing test names a defect for the fix lane.
Every lead, name and line is invented.

    python3 -m unittest tests.test_stress_desk_r4
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, waves  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import GATE_OPEN, NOW, OPENER_AR, ago, members, routes, run, seed, wave  # noqa: E402
from tests.test_waves_breakit import due_draft, enrolled_wave, row_ok, send  # noqa: E402

META = waves.META
MEMBERS = waves.MEMBERS
WAVES = waves.WAVES
FOLLOWUPS = waves.FOLLOWUPS
MESSAGES = waves.MESSAGES
CAL = "cockpit_sales_calendar"


# ---------------------------------------------------------------------------
# 1. An approved opener can wait for hours or days before it goes: the lead's
#    09:00 to 18:00, their day off, a wave a manager paused, a WA Connector
#    gate that shut again, a spent budget. When it finally goes, the desk's
#    last look (_left_pool) and sales-api's (followup.send_due) ask only for
#    a call still to come, a deal or a client tag. A lead whose call was
#    held an hour ago, or whose call was marked invalid (disqualified), is no
#    longer in any backlog pool (pool_of: a held call counts only a day on;
#    a disqualified lead is in none), and still gets "How are you?".
# ---------------------------------------------------------------------------

class AnOpenerThatWaitedNeverGoesToALeadWhoLeftTheBacklog(unittest.TestCase):
    def _approved(self, call: dict) -> FakePostgrest:
        pg = FakePostgrest()
        due_draft(pg, 0, send_after=ago(hours=20))
        pg.one(FOLLOWUPS, id="f000")["created_at"] = ago(hours=21)
        # The no-show that put them in the pool, ten days ago.
        pg.put(CAL, {"appointment_id": "p000-old", "contact_id": "p000", "call_type": "intro", "status": "noshow",
                     "start_at": ago(days=10), "booked_at": ago(days=12)})
        pg.put(CAL, {"contact_id": "p000", "call_type": "intro", **call})
        return pg

    def test_an_intro_held_an_hour_ago_takes_the_waiting_opener_back(self):
        # Booked last night (after the batch was approved), held at 08:00 this morning.
        pg = self._approved({"appointment_id": "p000-new", "status": "showed", "start_at": ago(hours=1),
                             "booked_at": ago(hours=14)})
        out, api = send(pg)
        self.assertEqual(api.calls, [],
                         "the opener went to a lead whose intro was held an hour ago: 'How are you?' after their call "
                         f"({out})")

    def test_an_intro_still_running_on_the_b2b_rule_takes_it_back_too(self):
        # Confirmed and started 20 minutes ago: held, by the B2B rule (fu.shown).
        pg = self._approved({"appointment_id": "p000-new", "status": "confirmed", "start_at": ago(minutes=20),
                             "booked_at": ago(hours=14)})
        out, api = send(pg)
        self.assertEqual(api.calls, [], f"the opener went to a lead who is on their intro right now ({out})")

    def test_a_lead_disqualified_since_the_batch_was_approved_gets_no_opener(self):
        # The rebooked intro was marked invalid (the dialer's disqualified mark).
        pg = self._approved({"appointment_id": "p000-new", "status": "invalid", "start_at": ago(hours=3),
                             "booked_at": ago(hours=14)})
        out, api = send(pg)
        self.assertEqual(api.calls, [],
                         f"the opener went to a lead marked invalid (disqualified) after it was approved ({out})")


# ---------------------------------------------------------------------------
# 2. A run that dies between writing an opener and moving its member to
#    drafted (an outage on the member's PATCH raises out of _draft_wave):
#    the next run checks the pool before it adopts the opener, so a lead who
#    left the pool meanwhile is taken out of the wave while their opener
#    stays open. That opener is in Today's batch, Approve all approves it,
#    and send_due's narrower look sends it to a member the wave already let
#    go of; the wave cannot finish while it is open.
# ---------------------------------------------------------------------------

class ARunThatDiedBetweenAnOpenerAndItsMemberLeavesNoOrphan(unittest.TestCase):
    def _orphan(self) -> FakePostgrest:
        pg = FakePostgrest()
        enrolled_wave(pg, n=2)
        # The run that died: the opener and its meta row are written, the member still waits.
        pg.put(FOLLOWUPS, {"id": "orphan", "contact_id": "n00", "segment": "reactivate", "channel": "whatsapp_template",
                           "template_key": "opener_ar", "status": "draft", "touch": 1, "body": "Hi Omar",
                           "created_at": ago(minutes=10), "expires_at": (NOW + timedelta(hours=48)).isoformat(),
                           "context": {"wave_id": "w1", "language": "ar", "arm": "wave"}})
        pg.put(META, {"followup_id": "orphan", "wave_id": "w1", "kind_key": "reactivate.ar.whatsapp_template",
                      "held_by": None, "send_after": None})
        # Meanwhile the lead's rebooked intro was marked invalid (disqualified).
        pg.put(CAL, {"appointment_id": "n00-dq", "contact_id": "n00", "call_type": "intro", "status": "invalid",
                     "start_at": ago(minutes=5), "booked_at": ago(hours=3)})
        return pg

    def test_the_next_run_never_leaves_an_open_opener_for_a_member_it_takes_out(self):
        pg = self._orphan()
        run(pg)
        m = pg.one(MEMBERS, wave_id="w1", contact_id="n00")
        f = pg.one(FOLLOWUPS, id="orphan")
        self.assertFalse(m["state"] == "excluded" and f["status"] == "draft",
                         f"the member left the wave ({m['excluded_reason']!r}) and its opener is still an open draft")

    def test_and_approving_the_batch_never_sends_it(self):
        pg = self._orphan()
        run(pg)
        # The manager presses Approve all for what Today's batch shows (followup.batch).
        for f in pg.rows(FOLLOWUPS):
            if f["status"] == "draft":
                meta = pg.one(META, followup_id=f["id"]) or pg.put(META, {"followup_id": f["id"], "wave_id": "w1"})
                meta.update({"send_after": ago(minutes=1), "held_by": None, "approved_by": "boss@stress.invalid"})
        out, api, _, _ = run(pg, now=NOW + timedelta(minutes=5))
        self.assertNotIn("orphan", [i for _, _, i in api.calls],
                         "the opener of a lead the wave took out (disqualified) was sent")


# ---------------------------------------------------------------------------
# 3. The month's template budget is spent (whatsapp_guard): send_due stops at
#    the first opener, but draft_day still writes the day's batch, and
#    followup.batch approves it ("Approved. One goes every 45 seconds"). Each
#    opener holds its lead's one open draft (no reply draft can be written)
#    until it goes stale and is written again the next day: a manager is
#    asked to approve forty openers a day that cannot go, as with the gate
#    shut, which draft_day already respects.
# ---------------------------------------------------------------------------

class ASpentTemplateBudgetWritesNoBatch(unittest.TestCase):
    def test_no_opener_is_written_for_approval_once_the_month_is_spent(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=3)
        guard = {**GATE_OPEN, "template_budget_usd_month": 1, "template_rate_usd": 0.1}  # ten templates a month
        month = (NOW - timedelta(days=2)).isoformat()
        for i in range(10):
            pg.put(MESSAGES, {"id": f"spent-{i}", "contact_id": f"other-{i}", "via": "workflow", "state": "sent",
                              "sent_by": "rep@stress.invalid", "created_at": month})
        out, api, _, _ = run(pg, guard=guard)
        d = out["drafted"]
        self.assertEqual(d.get("drafted", 0), 0,
                         f"{d.get('drafted')} openers were written for approval with the month's budget spent ({d})")
        self.assertIn("budget", str(d.get("waiting", "")).lower())


# ---------------------------------------------------------------------------
# 4. finish() marks the wave done, then starts the 14 days of the held-back
#    members whose turn had not come. A run that dies between the two writes
#    (an outage on the second PATCH) leaves a done wave whose held-back
#    members have no due_at, and the next run's wind_down reads it as a
#    stopped wave: "The wave ended before their turn, so they are not
#    measured". They drop out of the comparison although every lead in the
#    wave had their opener.
# ---------------------------------------------------------------------------

class AFinishThatDiesHalfWayKeepsTheHoldoutMeasured(unittest.TestCase):
    def test_held_back_members_stay_in_the_comparison(self):
        class DiesOnTheHoldoutStamp(FakePostgrest):
            died = False

            def __call__(self, method, url, **kw):
                if (method == "PATCH" and MEMBERS in url and "arm=eq.holdout" in url and "due_at=is.null" in url
                        and not self.died):
                    self.died = True
                    raise http.HttpError(503, '{"message":"upstream connect error"}', b"", url)
                return super().__call__(method, url, **kw)

        pg = DiesOnTheHoldoutStamp()
        enrolled_wave(pg, n=4)
        ms = sorted(members(pg, "w1"), key=lambda m: m["contact_id"])
        for m in ms[:2]:
            m.update({"state": "sent", "sent_at": ago(hours=2), "due_at": ago(hours=3)})
        for m in ms[2:]:
            m.update({"arm": "holdout", "state": "held_out", "due_at": None})
        with self.assertRaises(http.HttpError):
            run(pg)
        self.assertEqual(pg.one(WAVES, id="w1")["state"], "done")
        run(pg, now=NOW + timedelta(minutes=5))
        held = [pg.one(MEMBERS, wave_id="w1", contact_id=m["contact_id"]) for m in ms[2:]]
        self.assertTrue(all(h["state"] == "held_out" and h.get("due_at") for h in held),
                        "held-back members of a wave that finished were let go as if it had been stopped: "
                        + "; ".join(f"{h['state']}: {h.get('excluded_reason')}" for h in held))


# ---------------------------------------------------------------------------
# 5. The opener templates ship inactive until the CEO approves them. With the
#    Arabic one live and the English one not, every lead the desk reads as
#    English is put off a day, every day, and the wave never finishes; the
#    waves row stays green and says only "N wait for another day". Missing
#    is never zero: the row names the template that holds them.
# ---------------------------------------------------------------------------

class AnOpenerTemplateMissingInOneLanguageIsSaid(unittest.TestCase):
    def test_the_waves_row_names_the_missing_template(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=3, country="GB")
        pg.tables["cockpit_sales_wa_templates"].clear()
        routes(pg, OPENER_AR)
        out, api, _, _ = run(pg)
        ok, line = waves.words(out)
        self.assertGreater(out["drafted"].get("later", 0), 0, out["drafted"])
        self.assertTrue((not ok) or "opener_en" in line or "english" in line.lower(),
                        f"English leads wait for a template that is not set up, and the row says only: {line!r} "
                        f"(ok={ok})")


# ---------------------------------------------------------------------------
# 6. One lead's error that is not a refusal: HighLevel answers 400 "Contact
#    not found" to sendTemplate's contact read (a contact merged or deleted in
#    HighLevel after its opener was written). index.ts ghl() throws a plain
#    Error, sendFollowup puts the draft back (nothing was written), and
#    followup.send_due answers 500 "That did not work". The desk reads every
#    500 as sales-api itself failing and stops the run, which is right for a
#    fault that would fail every send; but the same opener keeps the oldest
#    send_after, so it heads the queue on every run: no opener of any wave
#    goes for up to 72 hours, and the row never says which opener holds it.
# ---------------------------------------------------------------------------

class OneLeadsErrorNeverHoldsEveryRun(unittest.TestCase):
    def test_the_rest_of_the_batch_goes_within_a_few_runs(self):
        from tests.test_waves import Api, Clock

        pg = FakePostgrest()
        for i in range(4):
            due_draft(pg, i, send_after=ago(minutes=30 - i))
        gone = "That did not work: HighLevel said 400: Contact not found"

        class MergedContact(Api):
            def __call__(self, action, payload):
                if payload["id"] == "f000":
                    self.calls.append((self.clock(), action, payload["id"]))
                    # sendFollowup put the draft back (nothing was written before the read failed).
                    return 500, {"ok": False, "error": gone}
                return super().__call__(action, payload)

        sent: list[str] = []
        lines: list[str] = []
        for run_no in range(4):
            out, api = send(pg, MergedContact(pg, Clock(NOW)), now=NOW + timedelta(minutes=5 * run_no), budget=270)
            sent += [i for _, _, i in api.calls if i != "f000"]
            lines.append(row_ok(out)[1])
        self.assertTrue(sent, "four runs in a row stopped at the same opener (a contact HighLevel no longer has), and no "
                              f"other opener went: {lines[-1]!r}")


# ---------------------------------------------------------------------------
# 7. One switch, three readings. followups.enabled set to anything but true
#    by hand (null, 0: an emergency stop written in SQL, a script) stops the
#    follow-up drafter (followups.run: `not settings.get("enabled", True)`)
#    while the waves job (`is False`) and sales-api (`=== false`) read it as
#    on and keep sending the backlog openers.
# ---------------------------------------------------------------------------

class TheOffSwitchReadsTheSameEverywhere(unittest.TestCase):
    def test_a_switch_the_drafter_reads_as_off_stops_the_waves_too(self):
        from desk import followups as fu
        from tests.test_waves import SETTINGS

        for off in (None, 0):
            settings = {**SETTINGS, "enabled": off}
            pg = FakePostgrest()
            with mock.patch.object(http, "request", pg):
                drafter = fu.run(None, None, lambda _m: None, settings=settings, ghl_token="t", now=NOW)
            self.assertIn("switched off", str(drafter.get("skipped")), drafter)
            pg = FakePostgrest()
            wave(pg, "w1", "no_show_cancelled", enrolled_at=ago(days=1))
            due_draft(pg, 0)
            out, api, _, _ = run(pg, settings=settings)
            self.assertEqual(api.calls, [],
                             f"followups.enabled={off!r}: the drafter says the agent is switched off, and the waves "
                             f"job sent an opener ({out.get('sent')})")


# ---------------------------------------------------------------------------
# 8. A rep pauses the agent for a lead (followup.stop_task answer pause: a
#    manual stops row, 30 days) or answers the lead's stop word with Pause,
#    after the lead's opener was approved and while it waits for their
#    hours. The drafting honours the row (opener_for, hold_of), but neither
#    the desk's last look before sending nor sales-api's followup.send_due
#    reads the stops table: the opener goes to the lead the rep paused. The
#    batch list offers no Hold on an approved opener either.
# ---------------------------------------------------------------------------

class ARepsPauseHoldsAnApprovedOpener(unittest.TestCase):
    def test_a_manual_pause_made_after_the_approval_keeps_the_opener_back(self):
        pg = FakePostgrest()
        wave(pg, "w1", "no_show_cancelled", enrolled_at=ago(days=1))
        due_draft(pg, 0, send_after=ago(hours=15))
        pg.put("cockpit_sales_followup_stops", {
            "contact_id": "p000", "said_at": ago(hours=2), "kind": "manual", "state": "paused",
            "paused_until": (NOW + timedelta(days=30)).isoformat(), "created_by": "setter@stress.invalid",
            "decided_by": "setter@stress.invalid", "decided_at": ago(hours=2)})
        out, api = send(pg)
        self.assertEqual(api.calls, [], f"the opener went to a lead a rep paused the agent for two hours ago ({out})")


# ---------------------------------------------------------------------------
# 9. Stop always works (contract-v2 0b.12: pause, stop and hold work with the
#    agent switched off), and the card answers "Stopped. The desk takes back
#    its openers within 5 minutes." But waves.run returns before wind_down
#    while followups.enabled is false: a wave stopped with the agent off
#    keeps its openers open (each holds its lead's one open draft) and its
#    leads locked in it until someone switches the agent on again.
# ---------------------------------------------------------------------------

class AStopWithTheAgentOffIsWoundDown(unittest.TestCase):
    def test_the_stopped_waves_openers_are_taken_back_while_the_agent_is_off(self):
        from tests.test_waves import SETTINGS

        pg = FakePostgrest()
        routes(pg)
        for i in range(6):
            seed(pg, f"n{i:02d}", "no_show_cancelled", days=i + 1)
        wave(pg, "w1", "no_show_cancelled", per_day=3)
        run(pg)
        opened = [f for f in pg.rows(FOLLOWUPS) if f["status"] == "draft"]
        self.assertTrue(opened)
        pg.one(WAVES, id="w1").update({"state": "done", "done_reason": "Stopped by a manager."})
        run(pg, now=NOW + timedelta(minutes=10), settings={**SETTINGS, "enabled": False})
        still = [f["id"] for f in opened if pg.one(FOLLOWUPS, id=f["id"])["status"] == "draft"]
        self.assertEqual(still, [], f"{len(still)} openers of a stopped wave stay open while the agent is off; the card "
                                    "said the desk takes them back within 5 minutes")


# ---------------------------------------------------------------------------
# 10. An earlier day's openers nobody decided on block their wave's next
#     batch, and the waves row says "Approve, hold or skip them on the
#     Follow-ups page". The page offers no Skip on a backlog opener: the
#     batch list has Hold and Release only, and the one-by-one list leaves
#     reactivate drafts out. The row names an action nobody can take.
# ---------------------------------------------------------------------------

class TheBlockedBatchLineNamesOnlyActionsThePageHas(unittest.TestCase):
    def test_skip_is_named_only_if_the_page_offers_it(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=5)
        run(pg)
        out, _, _, _ = run(pg, now=NOW + timedelta(days=1))
        line = waves.words(out)[1]
        here = os.path.dirname(os.path.abspath(__file__))
        card = os.path.join(here, "..", "..", "..", "apps", "sales-cockpit", "src", "components", "WavesCard.tsx")
        page = open(card, encoding="utf-8").read()
        if "skip" in line.lower():
            self.assertTrue("followup.skip" in page,
                            f"the row says {line!r}, and the batch list offers no Skip on an opener")


if __name__ == "__main__":
    unittest.main()
