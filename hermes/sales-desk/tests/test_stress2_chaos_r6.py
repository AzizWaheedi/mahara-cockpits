"""Stress series 2, round 6, chaos on the desk (2026-10-05): a send killed
between its two writes, and the desk's readers of what it left.

20261004a (stress2 round 5) stamps a message row's ghl_asked_at right before
HighLevel is asked. A "sending" row without the stamp, past 30 s, is a send
HighLevel was never asked about: it never went (sales-api's slot, its
moved-on check and waves._maybe_went all read it that way). The row is left
behind when the function is killed between the slot (the row) and the stamp,
or when the stamp, its read-back and the give-up DELETE all fail on one
database blip. The follow-up stays "sending" when its own way back to draft
fails on the same blip.

The desk reads that row in three more places that were not taught the rule:
- followups.free_stuck: half an hour on, a follow-up still "sending" whose
  only message row is that one is failed with "The send stopped halfway and
  may not have gone out. Read the conversation in HighLevel before writing to
  the lead again." Nothing went, for certain.
- waves.sync: the failed opener's error matches MAY_HAVE_GONE (and
  _no_send_for_certain reads the unasked row as "not certain"): the member
  is taken out of the wave for good, "The opener may have gone; a person
  checks HighLevel before anyone writes to the lead again".
- followups.reply_answered / gone_reason: a never-sent row after the lead's
  message reads as a person's answer: no reply draft is written for the
  lead, and an open one is closed as answered.

Every lead, line and id is invented; nothing reaches the network.

    python3 -m unittest tests.test_stress2_chaos_r6
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http, waves  # noqa: E402
from tests import test_waves as tw  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402

NOW = tw.NOW
FOLLOWUPS = waves.FOLLOWUPS
META = waves.META
MEMBERS = "cockpit_sales_followup_wave_members"


def ago(**kw) -> str:
    return (NOW - timedelta(**kw)).isoformat()


def stuck_opener(pg: FakePostgrest, *, asked: bool) -> str:
    """A wave opener approved 40 minutes ago whose send was killed between the
    message slot and the stamp (asked=False), or after HighLevel was asked
    (asked=True, the control)."""
    c, fid = "stress-chaos2r6-lead-0001", "f-r6-0001"
    tw.wave(pg, "w1", "no_show_cancelled", enrolled_at=ago(days=2))
    pg.put("cockpit_sales_leads", {"contact_id": c, "country": "Kuwait", "tags": ["roas-qualified"]})
    pg.put(FOLLOWUPS, {"id": fid, "contact_id": c, "segment": "reactivate", "channel": "whatsapp_template",
                       "status": "sending", "touch": 1, "created_at": ago(hours=20), "decided_at": ago(minutes=40),
                       "decided_by": "manager@stress.invalid", "expires_at": ago(hours=-28),
                       "context": {"wave_id": "w1", "language": "ar"}})
    pg.put(MEMBERS, {"wave_id": "w1", "contact_id": c, "arm": "wave", "state": "drafted", "followup_id": fid,
                     "drafted_at": ago(hours=20), "due_at": ago(hours=20), "fail_count": 0})
    pg.put("cockpit_sales_messages", {
        "id": "m-r6-0001", "request_id": fid, "followup_id": fid, "contact_id": c, "channel": "whatsapp",
        "via": "workflow", "template_key": "opener_ar", "sent_by": "sales-desk", "source": "followup",
        "state": "sending", "created_at": ago(minutes=40),
        "ghl_asked_at": ago(minutes=40) if asked else None})
    return fid


def free_and_sync(pg: FakePostgrest) -> None:
    with mock.patch.object(http, "request", pg):
        fu.free_stuck(tw.sb(), NOW)
        waves.sync(tw.sb(), ["w1"], NOW)


class AnUnaskedRowLeftByAKilledSend(unittest.TestCase):
    def test_held_asked_row_is_read_as_may_have_gone(self):
        """Control: HighLevel was asked (the stamp is there) and never answered:
        it may have gone, so the follow-up fails with the doubt and the member
        is taken out for a person to check. Right."""
        pg = FakePostgrest()
        fid = stuck_opener(pg, asked=True)
        free_and_sync(pg)
        f = pg.one(FOLLOWUPS, id=fid)
        self.assertEqual(f["status"], "failed")
        self.assertIn("may not have gone", f["error"])
        m = pg.one(MEMBERS, wave_id="w1")
        self.assertEqual(m["state"], "excluded")

    def test_free_stuck_reads_a_never_asked_row_as_may_have_gone(self):
        """free-stuck-unasked-row-read-as-may-have-gone: the only message row
        is "sending" with no ghl_asked_at, 40 minutes old: HighLevel was never
        asked, so nothing went. free_stuck must give the follow-up back (a
        draft to approve again, as it does with no row at all), never fail it
        with "may not have gone out. Read the conversation in HighLevel"."""
        pg = FakePostgrest()
        fid = stuck_opener(pg, asked=False)
        with mock.patch.object(http, "request", pg):
            fu.free_stuck(tw.sb(), NOW)
        f = pg.one(FOLLOWUPS, id=fid)
        self.assertFalse(
            f["status"] == "failed" and "may not have gone" in str(f.get("error")),
            f"a send HighLevel was never asked about is failed as 'may not have gone out': {f}")

    def test_wave_member_dropped_for_good_on_a_send_that_never_went(self):
        """The same, through to the wave: the member must still get its opener
        (waiting again, or its draft back), never be taken out for good as
        "The opener may have gone; a person checks HighLevel"."""
        pg = FakePostgrest()
        stuck_opener(pg, asked=False)
        free_and_sync(pg)
        m = pg.one(MEMBERS, wave_id="w1")
        self.assertFalse(
            m["state"] == "excluded" and "may have gone" in str(m.get("excluded_reason")),
            f"a lead whose opener certainly never went is taken out of the wave for good: {m}")


class AnUnaskedRowReadAsAnAnswer(unittest.TestCase):
    """The lead wrote at 09:50; a rep's reply at 09:52 left only its slot row
    (HighLevel never asked: the function stopped between the slot and the
    stamp, and the give-up DELETE failed on the same blip). Eight minutes on,
    the agent decides whether the lead still needs an answer."""

    LEAD_AT = ago(minutes=10)

    def thread(self):
        return [{"from": "lead", "channel": "whatsapp", "at": self.LEAD_AT, "text": "Is there a slot tomorrow?"}]

    def orphan(self, **over):
        # The columns followups.run reads (select=contact_id,created_at,state,via,channel,ghl_message_id),
        # plus ghl_asked_at as the database holds it (empty).
        return {"contact_id": "stress-chaos2r6-lead-0002", "created_at": ago(minutes=8), "state": "sending",
                "via": "conversation", "channel": "whatsapp", "ghl_message_id": None, "ghl_asked_at": None, **over}

    def test_held_a_real_reply_counts_as_answered(self):
        self.assertTrue(fu.reply_answered(self.thread(), [], [self.orphan(state="sent", ghl_message_id="hl-1",
                                                                         ghl_asked_at=ago(minutes=8))], set()))

    def test_never_asked_row_reads_as_a_persons_answer(self):
        """unasked-orphan-row-read-as-answered: the agent must still write the
        lead a reply; a row HighLevel was never asked about is no answer."""
        self.assertFalse(
            fu.reply_answered(self.thread(), [], [self.orphan()], set()),
            "a send HighLevel was never asked about (no ghl_asked_at, 8 minutes old) reads as a person's answer: "
            "the agent writes the lead no reply")

    def test_never_asked_row_closes_an_open_reply_draft(self):
        """The same row closes the agent's open reply draft as answered."""
        d = {"id": "f-r6-reply", "contact_id": "stress-chaos2r6-lead-0002", "segment": "reply", "channel": "whatsapp",
             "created_at": ago(minutes=9), "status": "draft"}
        why = fu.gone_reason(d, [], [], [self.orphan()], NOW)
        self.assertIsNone(
            why, f"a send HighLevel was never asked about closes the lead's reply draft: {why!r}")


class HighLevelAnswersTheThreadWithNothing:
    """HighLevel for one invented lead whose no-show template went at 09:20:
    the conversation search answers 200 with `search_body` (an empty body, or
    an empty object: a gateway's answer, or the search index behind), every
    other read the conversation as it is. The rest goes to the fake database."""

    TEMPLATE = "هلا عمر، فاتتنا مكالمتك اليوم. تبي نحجز لك وقت ثاني؟"

    def __init__(self, pg: FakePostgrest, search_body: bytes):
        self.pg, self.search_body, self.asked = pg, search_body, []

    def __call__(self, method, url, **kw):
        import json
        if "leadconnectorhq" not in url:
            return self.pg(method, url, **kw)
        self.asked.append(url)
        if "/conversations/search" in url:
            if self.search_body is not None:
                return 200, {}, self.search_body
            return 200, {}, json.dumps({"conversations": [{"id": "cv1"}]}).encode()
        if "/conversations/cv1/messages" in url:
            return 200, {}, json.dumps({"messages": {"messages": [
                {"id": "hl-tpl-1", "direction": "outbound", "messageType": "TYPE_WHATSAPP", "source": "workflow",
                 "status": "delivered", "dateAdded": ago(minutes=39), "body": self.TEMPLATE}]}}).encode()
        raise AssertionError(url)


class AThreadReadAsEmptyFailsATemplateThatWent(unittest.TestCase):
    """reconcile_templates (the follow-ups job at :07 and :37) reads the
    conversation of a template HighLevel took and had not shown yet; after
    half an hour with no hit it marks it never sent and settles its
    follow-up as failed. followups._conversations reads an empty 200 body as
    "{}" and "{}" as no conversations: one such answer reads a template that
    went as one that never did."""

    def seed(self, pg: FakePostgrest) -> None:
        c = "stress-chaos2r6-lead-0003"
        pg.put("cockpit_sales_followups", {"id": "f-r6-ns", "contact_id": c, "segment": "no_show", "status": "sent",
                                           "touch": 1, "channel": "whatsapp_template", "message_id": "m-r6-ns",
                                           "created_at": ago(minutes=45), "decided_at": ago(minutes=40)})
        pg.put("cockpit_sales_messages", {
            "id": "m-r6-ns", "contact_id": c, "via": "workflow", "channel": "whatsapp", "state": "sent",
            "provider_status": "enrolled", "followup_id": "f-r6-ns", "created_at": ago(minutes=40),
            "ghl_asked_at": ago(minutes=40), "body": HighLevelAnswersTheThreadWithNothing.TEMPLATE})

    def reconcile(self, body):
        pg = FakePostgrest()
        self.seed(pg)
        settled: list[str] = []
        with mock.patch.object(http, "request", HighLevelAnswersTheThreadWithNothing(pg, body)):
            out = fu.reconcile_templates(tw.sb(), "t", NOW, settle=lambda i: settled.append(i) or {})
        return out, pg.one("cockpit_sales_messages", id="m-r6-ns"), settled

    def test_held_the_conversation_read_finds_the_template(self):
        out, m, _ = self.reconcile(None)
        self.assertEqual(out, {"found": 1, "never_sent": 0})
        self.assertEqual(m["state"], "delivered")

    def test_held_a_page_that_is_not_json_waits_for_the_next_run(self):
        out, m, settled = self.reconcile(b"<html>502 Bad Gateway</html>")
        self.assertEqual((out, m["state"], settled), ({"found": 0, "never_sent": 0}, "sent", []))

    def test_empty_200_marks_a_sent_template_never_sent(self):
        """garbage-thread-marks-sent-template-failed (empty body): the template
        went (it is in the conversation); one empty 200 to the search must
        leave it for the next run, never mark it "The workflow did not send it
        within half an hour" and settle its follow-up as failed."""
        out, m, settled = self.reconcile(b"")
        self.assertNotEqual(
            m["state"], "failed",
            f"a template that went is marked never sent on one empty answer from HighLevel ({out}, settled {settled}): "
            f"{m.get('error')}")

    def test_empty_object_marks_a_sent_template_never_sent(self):
        out, m, settled = self.reconcile(b"{}")
        self.assertNotEqual(
            m["state"], "failed",
            f"a template that went is marked never sent on one '{{}}' answer from HighLevel ({out}, settled {settled})")

    # Fix round 6: the former test_the_agent_then_writes_the_same_step_again
    # is removed. It called pick() with the follow-up already failed, and a
    # template that really failed is written again by design; the defect was
    # the empty answer marking it failed, which the two tests above now hold.


class SearchAnswersNothing(tw.Ghl):
    """tw.Ghl, with HighLevel's conversation search answering 200 with `body`
    (an empty body, or an empty object) for every lead."""

    def __init__(self, pg, people, body: bytes):
        super().__init__(pg, people)
        self.body = body

    def __call__(self, method, url, **kw):
        if "leadconnectorhq" in url and "/conversations/search" in url:
            self.asked.append((method, url))
            return 200, {}, self.body
        return super().__call__(method, url, **kw)


class AStopMissedOnAnEmptyConversationAnswer(unittest.TestCase):
    """A backlog lead who wrote "stop sending me messages" three days ago
    (in HighLevel only: no run had read them before, so no stop row). The
    wave's drafting reads their whole conversation (ghl_history) for a stop
    before writing the opener; the send never reads it again (sales-api's
    send_due reads the stops table, the desk's live_conversation looks only
    for a message after the opener). followups._conversations reads an empty
    200 (or "{}") from the conversation search as "no conversations", so
    ghl_history answers ([], whole=True): no stop seen."""

    STOP = [{"id": "s1", "direction": "inbound", "messageType": "TYPE_WHATSAPP", "dateAdded": ago(days=3),
             "body": "لا تراسلوني مرة ثانية، وقفوا الرسائل"}]

    def draft(self, search_body):
        pg = FakePostgrest()
        tw.routes(pg)
        pg.put("cockpit_sales_people", {"email": "setter@stress.invalid", "ghl_user_id": "u-set", "name": "Sara Haddad",
                                        "name_ar": "سارة", "active": True})
        c = "stress-chaos2r6-lead-0004"
        tw.seed(pg, c, "no_show_cancelled", days=5, owner="u-set")
        tw.wave(pg, "w1", "no_show_cancelled")
        people = {c: {"thread": self.STOP}}
        ghl = tw.Ghl(pg, people) if search_body is None else SearchAnswersNothing(pg, people, search_body)
        tw.run(pg, ghl, guard={})  # enrol only (the gate shut: nothing written)
        for m in tw.members(pg, "w1"):
            m.update({"arm": "wave", "state": "waiting"})
        out, api, _, _ = tw.run(pg, ghl)
        drafts = [d for d in pg.rows(FOLLOWUPS) if d["contact_id"] == c and d["status"] == "draft"]
        return out, drafts, tw.members(pg, "w1")[0]

    def test_held_the_conversation_answers_and_the_stop_keeps_the_opener_back(self):
        out, drafts, m = self.draft(None)
        self.assertEqual(drafts, [], f"held control: the stop is read and no opener is written ({m})")

    def test_empty_200_from_the_search_writes_an_opener_to_a_lead_who_said_stop(self):
        """garbage-search-hides-stop-word-writes-opener: one empty answer to the
        conversation search must leave the lead for a later run (unread), never
        read as "no conversation, no stop" and write the opener."""
        out, drafts, m = self.draft(b"")
        self.assertEqual(
            drafts, [],
            f"an empty 200 from HighLevel's conversation search hides the lead's stop: an opener is written for them "
            f"(member {m.get('state')}, {m.get('later_reason') or m.get('excluded_reason')})")

    def test_empty_object_from_the_search_writes_an_opener_to_a_lead_who_said_stop(self):
        out, drafts, m = self.draft(b"{}")
        self.assertEqual(drafts, [], f"a '{{}}' from HighLevel's conversation search hides the lead's stop ({m})")

    def test_and_the_approved_opener_goes_with_highlevel_answering_again(self):
        """The rest of the chain: a manager approves the day's batch (no one
        reads each thread), HighLevel answers normally again, and the paced
        send asks sales-api to send it: nothing on the way reads the stop."""
        pg = FakePostgrest()
        tw.routes(pg)
        pg.put("cockpit_sales_people", {"email": "setter@stress.invalid", "ghl_user_id": "u-set", "name": "Sara Haddad",
                                        "name_ar": "سارة", "active": True})
        c = "stress-chaos2r6-lead-0004"
        tw.seed(pg, c, "no_show_cancelled", days=5, owner="u-set")
        tw.wave(pg, "w1", "no_show_cancelled")
        people = {c: {"thread": self.STOP}}
        blank = SearchAnswersNothing(pg, people, b"")
        tw.run(pg, blank, guard={})
        for m in tw.members(pg, "w1"):
            m.update({"arm": "wave", "state": "waiting"})
        tw.run(pg, blank, guard=tw.GATE_OPEN, api=tw.Api(pg, tw.Clock(NOW), script=[(409, {"error": "not yet"})]))
        drafts = [d for d in pg.rows(FOLLOWUPS) if d["contact_id"] == c and d["status"] == "draft"]
        # Fix round 6: no opener is written on the empty answer any more, so
        # the chain below has nothing to approve; it still runs, and nothing goes.
        self.assertEqual(drafts, [], "no opener is written on an empty answer from the conversation search")
        for d in drafts:
            meta = pg.one(META, followup_id=d["id"]) or {}
            pg.put(META, {**meta, "followup_id": d["id"], "wave_id": "w1", "send_after": ago(minutes=1),
                          "held_by": None, "approved_by": "manager@stress.invalid"})
        clock = tw.Clock(NOW + timedelta(minutes=5))
        api = tw.Api(pg, clock)
        logs: list[str] = []
        with mock.patch.object(http, "request", tw.Ghl(pg, people)):
            waves.send_due(tw.sb(), api, settings=tw.SETTINGS, w=waves.settings_of(tw.SETTINGS),
                           waves=[{"id": "w1", "state": "running"}], guard=tw.GATE_OPEN, clock=clock,
                           sleep=clock.sleep, budget_s=270, log=logs.append, warn=logs.append, ghl_token="t")
        self.assertEqual(
            [i for _, _, i in api.calls], [],
            f"the opener written on an empty answer goes to a lead who said stop three days ago: {logs[-3:]}")


class ContactAnswersNothing(tw.Ghl):
    """tw.Ghl, with HighLevel's contact read answering 200 with `body`."""

    def __init__(self, pg, people, body: bytes):
        super().__init__(pg, people)
        self.body = body

    def __call__(self, method, url, **kw):
        if "leadconnectorhq" in url and "/contacts/" in url and "/conversations" not in url:
            self.asked.append((method, url))
            return 200, {}, self.body
        return super().__call__(method, url, **kw)


class AWaveLeadDroppedOnAnEmptyContactAnswer(unittest.TestCase):
    """followups.ghl_contact reads an empty 200 (or "{}") as a contact with no
    phone and no name: opener_for then takes the lead out of the wave for
    good, "No phone number in HighLevel.", on one answer nobody could read."""

    def draft(self, body):
        pg = FakePostgrest()
        tw.routes(pg)
        pg.put("cockpit_sales_people", {"email": "setter@stress.invalid", "ghl_user_id": "u-set", "name": "Sara Haddad",
                                        "name_ar": "سارة", "active": True})
        c = "stress-chaos2r6-lead-0005"
        tw.seed(pg, c, "no_show_cancelled", days=5, owner="u-set")
        tw.wave(pg, "w1", "no_show_cancelled")
        ghl = tw.Ghl(pg, {}) if body is None else ContactAnswersNothing(pg, {}, body)
        tw.run(pg, ghl, guard={})
        for m in tw.members(pg, "w1"):
            m.update({"arm": "wave", "state": "waiting"})
        tw.run(pg, ghl)
        return tw.members(pg, "w1")[0]

    def test_held_the_contact_answers_and_the_opener_is_written(self):
        self.assertEqual(self.draft(None)["state"], "drafted")

    def test_empty_200_takes_the_lead_out_of_the_wave_for_good(self):
        """garbage-contact-drops-wave-lead: an unread contact must leave the
        member waiting (next_try_at, "HighLevel could not be read"), never
        excluded for good."""
        m = self.draft(b"")
        self.assertNotEqual(m["state"], "excluded",
                            f"one empty answer to the contact read takes the lead out of the wave for good: {m}")

    def test_empty_object_takes_the_lead_out_of_the_wave_for_good(self):
        m = self.draft(b"{}")
        self.assertNotEqual(m["state"], "excluded",
                            f"one '{{}}' answer to the contact read takes the lead out of the wave for good: {m}")


class ADraftStampedOnAFastVpsClock(unittest.TestCase):
    """The VPS clock runs five minutes fast (the doctor says so; the waves'
    paced sends and the room worker correct for it with sb.clock_offset, the
    Date header's reading). The follow-up agent stamps each draft's
    created_at with the VPS clock (followups.run moment(); waves _draft_row
    `now`), and every "did the conversation move on after this draft" check
    compares that stamp with times the database or HighLevel wrote (sales-api
    sendFollowup's moved-on check, the desk's close_gone / gone_reason): what
    anyone wrote in the five minutes after the drafter read the thread is
    "before" the draft, so the old draft goes on top of it."""

    def test_reply_draft_created_at_on_the_database_clock(self):
        from tests.fakes import FakeProvider
        import json as _json
        pg = FakePostgrest()
        c = "stress-chaos2r6-lead-0006"
        pg.put("cockpit_sales_leads", {"contact_id": c, "name": "Omar", "email": "o@stress.invalid",
                                       "phone": "+96550000000", "assigned_to": "u-rami", "lead_created_at": ago(days=10),
                                       "lead_class": "qualified", "dnd": False, "country": "Kuwait",
                                       "stage_name": "Intro Booked", "pipeline_name": "Sales Pipeline (2-Call)"})
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv1", "contact_id": c, "last_direction": "inbound",
                                       "last_message_at": ago(hours=1), "inbound_whatsapp_at": ago(hours=1)})
        pg.put("cockpit_sales_people", {"email": "rami@stress.invalid", "ghl_user_id": "u-rami", "active": True})
        provider = FakeProvider([_json.dumps({"body": "هلا عمر، نرسل لك الرابط الحين؟", "subject": None,
                                              "why": "He asked for the meeting link.", "language": "ar"})])
        sb = tw.sb()
        sb.clock_offset = -300.0  # the database's clock is five minutes behind this VPS's (Date header)
        with mock.patch.object(http, "request", pg):
            fu.run(sb, provider, lambda _m: None, settings={"enabled": True, "per_run": 5, "per_day": 60,
                                                             "quiet": {"from": 21, "to": 9}},
                   ghl_token="", now=NOW)
        d = next(r for r in pg.rows(FOLLOWUPS) if r["contact_id"] == c)
        made = fu._ts(d["created_at"])
        # A rep answered the lead in HighLevel two minutes after the drafter read
        # the thread (the database's and HighLevel's clock: NOW - 5 min + 2 min).
        rep_answer = {"contact_id": c, "created_at": (NOW - timedelta(minutes=3)).isoformat(), "state": "sent",
                      "channel": "whatsapp"}
        why = fu.gone_reason(d, [], [], [rep_answer], NOW)
        self.assertTrue(
            made <= NOW - timedelta(minutes=4) or why,
            f"clock-skew-draft-stamped-on-vps-clock: the draft is stamped {d['created_at']} on the VPS clock (five "
            "minutes ahead of the database's, which the run knew), so a rep's answer two minutes after the read "
            "is older than the draft: it is not closed, and sales-api's moved-on check passes it")


if __name__ == "__main__":
    unittest.main()
