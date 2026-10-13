"""Stress series 2, round 2, the desk: the follow-up agent, the waves and the
room worker on the VPS (2026-10-04). Each test asserts what must hold; a
failing test names a defect for the fix lane. Every lead, name and line is
invented.

    python3 -m unittest tests.test_stress2_desk_r2
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http, waves  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import GATE_OPEN, NOW, SETTINGS, Api, Clock, ago, sb  # noqa: E402
from tests.test_waves_breakit import due_draft, row_ok, send  # noqa: E402

META = waves.META
MEMBERS = waves.MEMBERS
WAVES = waves.WAVES
FOLLOWUPS = waves.FOLLOWUPS
MESSAGES = waves.MESSAGES
STOPS = fu.STOPS


def rep_pause(pg, contact: str, days: int = 30) -> None:
    """A rep's own pause from the lead page ("Pause the agent for this lead")."""
    pg.put(STOPS, {"contact_id": contact, "said_at": ago(minutes=20), "kind": "manual", "state": "paused",
                   "paused_until": (NOW + timedelta(days=days)).isoformat(), "said": "", "created_by": "rep@x.co"})


# ---------------------------------------------------------------------------
# 1. A batch of 12 approved openers, the first five for leads a rep paused
#    the agent for after the batch was approved (fix round 4: they wait in
#    the queue, never sent and never set aside). send_due takes the send
#    lease (stamping the gap's start) before it reads the stops, so each
#    paused opener spends a whole batch gap (45 s) without a send, and they
#    keep their place at the head of the queue (the oldest send_after). A
#    run of 270 s reaches six openers: the five paused ones and one more.
#    On a run that also drafted (half the budget), it reaches only the
#    paused ones, and nothing goes, run after run, until their 72 hours run
#    out and the whole approved batch behind them goes stale with them.
# ---------------------------------------------------------------------------

class PausedLeadsAtTheHeadDoNotStallTheBatch(unittest.TestCase):
    def test_paused_openers_spend_no_gap_and_the_batch_behind_them_goes(self):
        pg = FakePostgrest()
        for i in range(12):
            due_draft(pg, i, send_after=ago(minutes=60 - i))
        for i in range(5):
            rep_pause(pg, f"p{i:03d}")
        out, api = send(pg, budget=270)
        sent = [i for _, _, i in api.calls]
        self.assertEqual(out.get("paused"), 5, out)
        self.assertGreaterEqual(
            len(sent), 4,
            "five openers whose leads a rep paused each spent a 45-second batch gap without a send, and the run "
            f"sent only {len(sent)} of the seven ready openers behind them ({out}, slept {sum(api.clock.slept):.0f} s)")

    def test_a_drafting_run_still_sends_past_three_paused_openers(self):
        # The waves run gives send_due what is left after drafting (about half
        # of its 270 s on a morning with a batch to write).
        pg = FakePostgrest()
        for i in range(8):
            due_draft(pg, i, send_after=ago(minutes=60 - i))
        for i in range(3):
            rep_pause(pg, f"p{i:03d}")
        sends = 0
        for k in range(6):  # half an hour of five-minute runs
            out, api = send(pg, now=NOW + timedelta(minutes=5 * k), budget=135)
            sends += len(api.calls)
        self.assertGreater(sends, 0,
                           "for half an hour of runs no opener went: three paused leads at the head of the queue "
                           f"spent every run's time on the send lease ({out})")


# ---------------------------------------------------------------------------
# 2. The same "the workflow did not send it within half an hour" that round 1
#    took out for a person when the member was already counted as sent,
#    reaching a member still in "drafted": the agent was switched off a
#    minute after the waves run sent the opener (followups.enabled off: the
#    waves run syncs only stopped waves, the follow-ups job does nothing),
#    and switched on again at :06 forty minutes later. The follow-ups job at
#    :07 reads the conversation, does not find the template and fails the
#    message and the draft; the waves run at :10 then syncs the member from
#    "drafted". sync's failed path asks _maybe_went, which never reads the
#    message's error, so a workflow that may still run late is read as a
#    certain failure: the member waits for a second opener the next day.
# ---------------------------------------------------------------------------

class AWorkflowThatMayRunLateIsNeverRetriedFromDrafted(unittest.TestCase):
    def test_a_drafted_member_whose_workflow_did_not_send_in_half_an_hour_is_not_retried(self):
        from tests.test_waves_breakit import enrolled_wave
        from tests.test_waves import members
        pg = FakePostgrest()
        enrolled_wave(pg, n=1)
        m = members(pg, "w1")[0]
        c = m["contact_id"]
        late = ("The workflow did not send it within half an hour. In HighLevel, check the workflow is "
                "published and allows re-entry.")
        pg.put(FOLLOWUPS, {"id": "fy", "contact_id": c, "segment": "reactivate", "channel": "whatsapp_template",
                           "status": "failed", "message_id": "my", "touch": 1, "created_at": ago(hours=3),
                           "decided_at": ago(minutes=45), "context": {"wave_id": "w1", "language": "ar"},
                           "error": late})
        pg.put(MESSAGES, {"id": "my", "followup_id": "fy", "contact_id": c, "sent_by": "sales-desk", "via": "workflow",
                          "state": "failed", "provider_status": "not sent", "channel": "whatsapp", "error": late,
                          "created_at": ago(minutes=45)})
        m.update({"state": "drafted", "followup_id": "fy", "drafted_at": ago(hours=3), "due_at": ago(hours=3)})
        with mock.patch.object(http, "request", pg):
            waves.sync(sb(), ["w1"], NOW)
        after = pg.one(MEMBERS, wave_id="w1", contact_id=c)
        self.assertEqual(after["state"], "excluded",
                         "an opener whose workflow may still run late is drafted again the next day: the lead may get "
                         f"two openers (member {after['state']}, next_try_at {after.get('next_try_at')})")


# ---------------------------------------------------------------------------
# 3. A rep holds one opener of today's batch ("Held. It stays out of the
#    batch until you release it."). Nobody releases it. Two days on, the
#    follow-ups job's expire_stale closes it (a held opener is not an
#    approved one, so it is kept only to its 48 hours), sync reads the
#    expired draft as "nobody decided" and puts the member back to waiting,
#    and the next morning's batch has a fresh opener for the same lead with
#    no hold on it: Approve all sends the message the rep held.
# ---------------------------------------------------------------------------

class ARepsHoldOutlivesTheDraftItWasOn(unittest.TestCase):
    def test_a_held_opener_that_expires_is_not_written_again_without_its_hold(self):
        from tests.test_waves import members, run
        from tests.test_waves_breakit import enrolled_wave
        pg = FakePostgrest()
        enrolled_wave(pg, n=3)
        run(pg)
        drafts = [f for f in pg.rows(FOLLOWUPS) if f["status"] == "draft"]
        self.assertEqual(len(drafts), 3)
        held = drafts[0]
        c = held["contact_id"]
        # The rep's Hold (sales-api followup.hold): held_by the rep, no approval.
        pg.one(META, followup_id=held["id"]).update({"held_by": "setter@x.co", "held_at": NOW.isoformat(),
                                                     "hold_reason": "Talking to him on the phone.",
                                                     "send_after": None, "approved_by": None})
        for f in drafts[1:]:
            f.update({"status": "sent", "decided_at": NOW.isoformat()})
        # Two days and a bit later: the follow-ups job's housekeeping, then the waves runs.
        later = NOW + timedelta(hours=49)
        with mock.patch.object(http, "request", pg):
            fu.expire_stale(sb(), later)
        self.assertEqual(pg.one(FOLLOWUPS, id=held["id"])["status"], "expired")
        run(pg, now=later + timedelta(minutes=3))
        run(pg, now=NOW + timedelta(days=3))
        fresh = [f for f in pg.rows(FOLLOWUPS) if f["contact_id"] == c and f["status"] == "draft"]
        unheld = [f for f in fresh if not (pg.one(META, followup_id=f["id"]) or {}).get("held_by")]
        self.assertEqual(unheld, [],
                         "the opener a rep held expired after 48 hours and the wave wrote the lead a fresh one with "
                         "no hold, ready for Approve all (member "
                         f"{pg.one(MEMBERS, wave_id='w1', contact_id=c)['state']})")


# ---------------------------------------------------------------------------
# 4. A no-show who answered by WhatsApp voice note two days ago ("sorry, I
#    missed it, call me back"), which nobody has answered yet. HighLevel
#    keeps a voice note (an image, a document) as a message with an empty
#    body and its attachments. followups._as_message drops every inbound
#    message with no body, so the desk's thread has no word from the lead:
#    opener_for's "they wrote to us lately" never fires, and the wave writes
#    "How are you?" into the middle of a conversation the lead opened. The
#    follow-ups job's close_gone and sales-api's "moved on" only look at
#    what came after the opener was written, so nothing takes it back.
# ---------------------------------------------------------------------------

class AVoiceNoteIsTheLeadWriting(unittest.TestCase):
    def test_a_lead_who_sent_a_voice_note_two_days_ago_gets_no_opener(self):
        from tests.test_waves import Ghl, members, run
        from tests.test_waves_breakit import enrolled_wave
        pg = FakePostgrest()
        enrolled_wave(pg, n=1)
        thread = [{"id": "o0", "direction": "outbound", "messageType": "TYPE_WHATSAPP", "source": "app",
                   "dateAdded": ago(days=20), "body": "Hi Omar, we missed you on the call today."},
                  {"id": "v1", "direction": "inbound", "messageType": "TYPE_WHATSAPP", "dateAdded": ago(days=2),
                   "body": "", "contentType": "audio/ogg",
                   "attachments": ["https://storage.example.invalid/voice-note-invented.ogg"]}]
        out, _, _, _ = run(pg, Ghl(pg, {"n00": {"thread": thread}}))
        m = members(pg, "w1")[0]
        self.assertEqual(out["drafted"]["drafted"], 0,
                         "the lead sent a voice note two days ago and the wave wrote them the opener as if they had "
                         f"never answered (member {m['state']}, {m.get('excluded_reason')})")


# ---------------------------------------------------------------------------
# 5. Three openers of an approved batch taken back at the send because their
#    leads booked a call since (fix round 4's _left_pool): the draft is
#    expired with the reason and out["left_pool"] counts it, but words()
#    never says it. The waves row reads "1 wave running" and green, and the
#    manager who approved 3 sees none go with no sentence anywhere on the
#    status row (missing is never zero).
# ---------------------------------------------------------------------------

class OpenersTakenBackAtTheSendAreSaid(unittest.TestCase):
    def test_the_row_says_approved_openers_were_taken_back(self):
        pg = FakePostgrest()
        for i in range(3):
            due_draft(pg, i, send_after=ago(minutes=30 - i))
            pg.put("cockpit_sales_calendar", {"appointment_id": f"a{i}", "contact_id": f"p{i:03d}", "call_type": "intro",
                                              "status": "confirmed", "start_at": (NOW + timedelta(days=1)).isoformat(),
                                              "booked_at": ago(minutes=10)})
        out, api = send(pg, budget=270)
        self.assertEqual((api.calls, out["left_pool"]), ([], 3))
        ok, line = row_ok(out)
        self.assertIn("taken back", line,
                      f"three approved openers were taken back at the send and the waves row says only {line!r}")


# ---------------------------------------------------------------------------
# Fix round 2 (unclear-template-not-waiting): a template whose workflow
# enrolment answer was lost (state unclear) holds the lead's next template in
# sales-api until reconcile_templates settles it, the way it settles one
# HighLevel took and nobody saw: found in the conversation, or after half an
# hour, never left blocking the lead for six hours.
# ---------------------------------------------------------------------------

class AnUnclearTemplateIsSettled(unittest.TestCase):
    def test_an_unclear_enrolment_is_settled_like_an_enrolled_one(self):
        from tests.test_followups import NOW as FU_NOW, FakeGhl, ago as fu_ago
        from desk.supabase import Supabase
        pg = FakePostgrest()
        body = "Hi Omar, it's Sara from Mahara."
        pg.put(MESSAGES, {"id": "m-found", "contact_id": "a", "via": "workflow", "channel": "whatsapp",
                          "state": "unclear", "provider_status": None, "followup_id": None,
                          "created_at": fu_ago(minutes=10), "body": body})
        pg.put(MESSAGES, {"id": "m-late", "contact_id": "b", "via": "workflow", "channel": "whatsapp",
                          "state": "unclear", "provider_status": None, "followup_id": None,
                          "created_at": fu_ago(minutes=40), "body": "Hi Huda, it's Sara from Mahara."})
        thread = [{"id": "ghl-1", "direction": "outbound", "messageType": "TYPE_WHATSAPP", "source": "workflow",
                   "status": "delivered", "dateAdded": fu_ago(minutes=9), "body": body}]
        with mock.patch.object(http, "request", FakeGhl(pg, thread=thread)):
            out = fu.reconcile_templates(Supabase("https://example.supabase.co", "k"), "t", FU_NOW)
        self.assertEqual(out, {"found": 1, "never_sent": 1})
        self.assertEqual(pg.one(MESSAGES, id="m-found")["state"], "delivered")
        self.assertEqual(pg.one(MESSAGES, id="m-late")["state"], "failed")


if __name__ == "__main__":
    unittest.main()
