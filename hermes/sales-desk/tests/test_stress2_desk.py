"""Stress series 2, round 1, the desk: the follow-up agent, the waves and the
room worker on the VPS (2026-10-04). Each test asserts what must hold; a
failing test names a defect for the fix lane. Every lead, name and line is
invented.

    python3 -m unittest tests.test_stress2_desk
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http, waves  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import GATE_OPEN, NOW, SETTINGS, Api, Clock, Ghl, ago, members, run, sb  # noqa: E402
from tests.test_waves_breakit import due_draft, enrolled_wave, row_ok, send  # noqa: E402

META = waves.META
MEMBERS = waves.MEMBERS
WAVES = waves.WAVES
FOLLOWUPS = waves.FOLLOWUPS
MESSAGES = waves.MESSAGES


# ---------------------------------------------------------------------------
# 1. An opener that failed at Meta after the waves run had already counted
#    it as sent. sendTemplate's read-back waits 12 s: a template still
#    "pending" (or not seen yet, provider_status enrolled) is stored as sent,
#    and sendFollowup marks the draft sent. The next waves run (5 minutes)
#    moves the member to sent. Meta's answer comes later (131049, the
#    per-person marketing limit, or the workflow never sending it): the
#    follow-ups job's settle_sends / reconcile_templates mark the message
#    failed and followup.settle flips the draft to failed. sync() reads only
#    drafted members, so the member stays "sent": the lead never had the
#    opener, is never tried again the next day (FAIL_LIMIT), and is counted
#    as messaged in the wave arm.
# ---------------------------------------------------------------------------

class AnOpenerThatFailedAfterItWasCountedIsNotSent(unittest.TestCase):
    def test_a_late_meta_failure_puts_the_member_back(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=1)
        m = members(pg, "w1")[0]
        c = m["contact_id"]
        # The opener went through followup.send_due: HighLevel took it, the
        # read-back saw it pending, so the draft is sent.
        pg.put(FOLLOWUPS, {"id": "fy", "contact_id": c, "segment": "reactivate", "channel": "whatsapp_template",
                           "status": "sent", "message_id": "my", "touch": 1, "created_at": ago(hours=3),
                           "decided_at": ago(minutes=20), "context": {"wave_id": "w1", "language": "ar"}})
        pg.put(MESSAGES, {"id": "my", "followup_id": "fy", "contact_id": c, "sent_by": "sales-desk", "via": "workflow",
                          "state": "sent", "provider_status": "pending", "ghl_message_id": "ghl-msg-invented-2",
                          "channel": "whatsapp", "created_at": ago(minutes=20)})
        m.update({"state": "drafted", "followup_id": "fy", "drafted_at": ago(hours=3), "due_at": ago(hours=3)})
        with mock.patch.object(http, "request", pg):
            waves.sync(sb(), ["w1"], NOW)
        self.assertEqual(pg.one(MEMBERS, wave_id="w1", contact_id=c)["state"], "sent")  # as it was then

        # Half an hour later the follow-ups job reads Meta's answer: the
        # template failed (131049), and followup.settle fails the draft.
        pg.one(MESSAGES, id="my").update({"state": "failed", "provider_status": "failed",
                                          "error": "131049: not delivered to maintain healthy ecosystem engagement."})
        pg.one(FOLLOWUPS, id="fy").update({"status": "failed",
                                           "error": "131049: not delivered to maintain healthy ecosystem engagement."})
        later = NOW + timedelta(minutes=40)
        with mock.patch.object(http, "request", pg):
            waves.sync(sb(), ["w1"], later)
            waves.outcomes(sb(), ["w1"], later)
        after = pg.one(MEMBERS, wave_id="w1", contact_id=c)
        self.assertNotEqual(after["state"], "sent",
                            "the opener failed at Meta after the member was counted as sent: the lead never had it, "
                            "is never drafted again, and the wave counts them as messaged "
                            f"(member {after['state']}, sent_at {after.get('sent_at')})")
        # Fix round 1: Meta's failure is certain, so the failed rules hold:
        # waiting again for the one retry, its sent_at cleared.
        self.assertEqual((after["state"], after.get("sent_at"), after.get("fail_count")), ("waiting", None, 1))

    def test_a_template_the_workflow_did_not_send_in_half_an_hour_is_not_retried(self):
        # reconcile_templates' "did not send it within half an hour" is not
        # certain (the workflow may run late): the member is taken out for a
        # person, never drafted a second opener.
        pg = FakePostgrest()
        enrolled_wave(pg, n=1)
        m = members(pg, "w1")[0]
        c = m["contact_id"]
        pg.put(FOLLOWUPS, {"id": "fy", "contact_id": c, "segment": "reactivate", "channel": "whatsapp_template",
                           "status": "failed", "message_id": "my", "touch": 1, "created_at": ago(hours=3),
                           "decided_at": ago(minutes=50), "context": {"wave_id": "w1", "language": "ar"},
                           "error": "The workflow did not send it within half an hour."})
        pg.put(MESSAGES, {"id": "my", "followup_id": "fy", "contact_id": c, "sent_by": "sales-desk", "via": "workflow",
                          "state": "failed", "provider_status": "not sent", "channel": "whatsapp",
                          "error": ("The workflow did not send it within half an hour. In HighLevel, check the "
                                    "workflow is published and allows re-entry."), "created_at": ago(minutes=50)})
        m.update({"state": "sent", "followup_id": "fy", "drafted_at": ago(hours=3), "due_at": ago(hours=3),
                  "sent_at": ago(minutes=50)})
        with mock.patch.object(http, "request", pg):
            waves.sync(sb(), ["w1"], NOW)
        after = pg.one(MEMBERS, wave_id="w1", contact_id=c)
        self.assertEqual(after["state"], "excluded")
        self.assertIn("may have gone", after["excluded_reason"])


# ---------------------------------------------------------------------------
# 2. The waves row says an opener whose send had stopped half way "was asked
#    for again" when it was only found: send_due counts every stale sending
#    mark it selects (out["stalled"]) before any of the checks that keep an
#    opener back. A stalled opener of a wave a manager paused is not asked
#    for, and the row says both "approved for a wave that is paused or
#    stopped, so not sent" and "was asked for again".
# ---------------------------------------------------------------------------

class AStalledOpenerIsSaidAskedOnlyWhenItWasAsked(unittest.TestCase):
    def test_a_stalled_opener_of_a_paused_wave_is_not_said_to_be_asked_for(self):
        pg = FakePostgrest()
        due_draft(pg, 0, send_after=ago(minutes=30))
        # sales-api's send died half way: its sending mark is ten minutes old.
        pg.one(META, followup_id="f000").update({"held_by": waves.SENDING, "held_at": ago(minutes=10)})
        out, api = send(pg, waves_=[{"id": "w1", "state": "paused"}])
        self.assertEqual(api.calls, [])
        ok, line = waves.words({"waves": [{"id": "w1", "state": "paused"}], "sent": out})
        self.assertNotIn("asked for again", line,
                         f"the row says the stalled opener was asked for again, but nothing was asked: {line!r}")


# ---------------------------------------------------------------------------
# 3. A backlog lead who wrote STOP months ago, with WhatsApp do-not-disturb
#    never set in HighLevel (nobody kept stops before the stops table of
#    2026-10-03). Their conversation has gone on since: the old automations'
#    and the agent's own nurture emails. The waves read the lead's last 20
#    messages (ghl_thread's limit) and stop_of reads only the lead's latest
#    message in them: once twenty messages have gone to the lead after their
#    STOP, nothing the desk reads says stop, the opener ("How are you?") is
#    written, approved in the batch, and sales-api has nothing to refuse it on.
# ---------------------------------------------------------------------------

class ALeadWhoWroteStopNeverGetsTheOpener(unittest.TestCase):
    def test_a_stop_buried_under_twenty_later_messages_still_holds(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=1)
        c = members(pg, "w1")[0]["contact_id"]
        thread = [{"id": "stop", "direction": "inbound", "messageType": "TYPE_WHATSAPP", "dateAdded": ago(days=70),
                   "body": "STOP"}]
        # A weekly nurture email and the old automations' messages since.
        thread += [{"id": f"later-{i}", "direction": "outbound", "messageType": "TYPE_EMAIL", "source": "workflow",
                    "dateAdded": ago(days=66 - 3 * i), "body": f"Newsletter {i}"} for i in range(21)]
        out, _, _, _ = run(pg, Ghl(pg, {c: {"thread": thread}}))
        openers = [f for f in pg.rows(FOLLOWUPS) if f["contact_id"] == c and f["status"] == "draft"]
        self.assertEqual(openers, [],
                         "an opener was written for a lead whose last words to us were STOP, because twenty later "
                         f"messages pushed the STOP out of the thread the desk reads (member "
                         f"{pg.one(MEMBERS, wave_id='w1', contact_id=c)['state']})")


# ---------------------------------------------------------------------------
# 4. desk.py deploy-check reads the WhatsApp gate its own way: connector_off
#    true and any single_copy_ok_at. The desk (followups.wa_gate) and
#    sales-api (sendrules.ts gateOpen) both hold a single-copy test from
#    before the connector last went off (connector_off_at) as void, and a
#    value that is not a time as none. The check says "OK ... open: the WA
#    Connector is off and the single-copy test passed" while every desk
#    WhatsApp send stays shut.
# ---------------------------------------------------------------------------

class TheDeployCheckReadsTheGateAsTheSendersDo(unittest.TestCase):
    def _gate_line(self, guard):
        from desk import deploycheck

        class NoRows:
            def rest(self, method, path, **kw):
                return []

        report = deploycheck.Report()
        deploycheck.check_switches(report, NoRows(), {"whatsapp_guard": guard, "rooms": {}, "live": {}})
        return next(r for r in report.rows if r["check"] == "whatsapp_guard gate")

    def test_a_single_copy_test_from_before_the_connector_went_off_is_shut(self):
        guard = {"connector_off": True, "single_copy_ok_at": "2026-10-01T09:00:00+00:00",
                 "connector_off_at": "2026-10-02T09:00:00+00:00"}
        self.assertIsNotNone(fu.wa_gate(guard))  # the desk keeps WhatsApp shut
        row = self._gate_line(guard)
        self.assertIsNot(row["ok"], True, f"the deploy check calls the gate open while the desk holds it shut: {row}")

    def test_a_single_copy_mark_that_is_not_a_time_is_shut(self):
        guard = {"connector_off": True, "single_copy_ok_at": True}
        self.assertIsNotNone(fu.wa_gate(guard))
        row = self._gate_line(guard)
        self.assertIsNot(row["ok"], True, f"the deploy check calls the gate open while the desk holds it shut: {row}")


# ---------------------------------------------------------------------------
# 5. A lead the team disqualified in HighLevel. pool_of keeps a disqualified
#    lead out of every pool only when their latest call is marked invalid
#    (the cockpit dialer's mark). A rep who disqualifies in HighLevel moves
#    the opportunity to the "DISQUALIFIED" stage and leaves the call as it
#    was (a no-show, a cancellation, a showed intro, or no call at all):
#    the lead lands in a backlog pool and gets "How are you?". Production,
#    read 2026-10-04: 57 roas-tagged leads in the DISQUALIFIED stage with no
#    deal, no call ahead and a latest call that is not invalid (19 never
#    booked, 13 showed, 12 cancelled, 8 no-show, 5 confirmed).
# ---------------------------------------------------------------------------

class ALeadDisqualifiedInTheCrmIsInNoPool(unittest.TestCase):
    def _lead(self, **over):
        return {"contact_id": "dq1", "name": "Omar", "tags": ["roas-qualified"], "lead_created_at": ago(days=60),
                "stage_name": "\U0001f6d1DISQUALIFIED", "opp_status": "open", **over}

    def test_a_no_show_in_the_disqualified_stage_is_in_no_pool(self):
        calls = fu.with_kinds([{"appointment_id": "dq1-1", "contact_id": "dq1", "call_type": "intro", "status": "noshow",
                                "start_at": ago(days=12), "booked_at": ago(days=14)}])
        got = waves.pool_of(self._lead(), calls, False, NOW)
        self.assertIsNone(got, f"a lead the team disqualified in HighLevel is in the {got and got[0]} pool")

    def test_a_disqualified_lead_who_never_booked_is_in_no_pool(self):
        got = waves.pool_of(self._lead(), [], False, NOW)
        self.assertIsNone(got, f"a lead the team disqualified in HighLevel is in the {got and got[0]} pool")


if __name__ == "__main__":
    unittest.main()
