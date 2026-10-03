"""The follow-up agent's phase 0: the three faults fixed (a reply hidden by
an outbound message, the brief cut from its end, after_call reading
"showed" only), the test path (--contact), the stop rule, the WhatsApp gate
on the desk's own sends, and honest counts when the model is down. Every
lead and line is invented.

    python3 -m unittest tests.test_followups_phase0
"""
from __future__ import annotations

import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests.fakes import FakePostgrest, FakeProvider  # noqa: E402
from tests.test_followups import GATE_OPEN, NOW, FakeGhl, ago, ahead, run_it, settings_on, who  # noqa: E402

TEST_ID = "VjPfR4Cc1Y0OFvaqeor5"
DRAFT_WA = json.dumps({"body": "Hi Omar, yes, here is how it works.", "subject": None, "why": "He asked how it works."})
DRAFT_EMAIL = json.dumps({"body": "Hi Omar, thanks for reaching out.", "subject": "Your enquiry", "why": "New lead."})


def lead(pg: FakePostgrest, contact: str = "a", **over) -> dict:
    return pg.put("cockpit_sales_leads", {
        "contact_id": contact, "name": "Omar", "email": "o@x.co", "phone": "+96550000000", "assigned_to": None,
        "lead_created_at": ago(days=10), "lead_class": "qualified", "dnd": False, "country": "Kuwait",
        "pipeline_name": "Sales Pipeline (2-Call)", "tags": ["roas-qualified"], **over})


def wa(direction: str, at: str, body: str, source=None, mid=None, kind="TYPE_WHATSAPP") -> dict:
    return {"id": mid or f"m-{at}", "direction": direction, "messageType": kind, "source": source,
            "dateAdded": at, "body": body}


class Recording(FakeGhl):
    """HighLevel as FakeGhl answers it, every call kept with its method: the
    agent never writes to HighLevel (never do-not-disturb)."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.methods = []

    def __call__(self, method, url, **kw):
        if "leadconnectorhq" in url:
            self.methods.append((method, url))
        return super().__call__(method, url, **kw)


# ---------------------------------------------------------------------------
# Fault 1: a reply missed when the conversation's last message is ours
# ---------------------------------------------------------------------------

class ReplyNotHidden(unittest.TestCase):
    def test_an_outbound_email_after_their_whatsapp_does_not_hide_the_reply(self):
        inbox = [{"contact_id": "a", "conversation_id": "cv1", "last_direction": "outbound", "last_type": "TYPE_EMAIL",
                  "last_message_at": ago(minutes=30), "inbound_whatsapp_at": ago(hours=2)}]
        self.assertEqual(who(fu.pick(NOW, inbox=inbox, calendar=[], leads=[])), [("a", "reply")])

    def test_a_cockpit_answer_hides_it_and_a_cockpit_email_does_not(self):
        inbox = [{"contact_id": "a", "last_direction": "inbound", "last_type": "TYPE_WHATSAPP",
                  "last_message_at": ago(hours=2), "inbound_whatsapp_at": ago(hours=2)}]
        answered = [{"contact_id": "a", "created_at": ago(hours=1), "state": "sent", "channel": "whatsapp"}]
        self.assertEqual(fu.pick(NOW, inbox=inbox, calendar=[], leads=[], sends=answered), [])
        emailed = [{**answered[0], "channel": "email"}]
        self.assertEqual(who(fu.pick(NOW, inbox=inbox, calendar=[], leads=[], sends=emailed)), [("a", "reply")])
        failed = [{**answered[0], "state": "failed"}]
        self.assertEqual(who(fu.pick(NOW, inbox=inbox, calendar=[], leads=[], sends=failed)), [("a", "reply")])
        # Two days on, it is no longer a reply to write.
        old = [{**inbox[0], "last_message_at": ago(hours=49), "inbound_whatsapp_at": ago(hours=49)}]
        self.assertEqual(fu.pick(NOW, inbox=old, calendar=[], leads=[]), [])

    def test_only_a_persons_answer_on_a_channel_that_answers_counts(self):
        theirs = {"id": "t", "from": "lead", "channel": "whatsapp", "at": ago(hours=2), "text": "How much is it?"}
        auto_email = {"id": "x", "from": "us", "channel": "email", "source": "workflow", "at": ago(hours=1)}
        auto_wa = {**auto_email, "channel": "whatsapp"}
        rep_wa = {"id": "r", "from": "us", "channel": "whatsapp", "source": "app", "at": ago(hours=1)}
        rep_email = {**rep_wa, "channel": "email"}
        ours_template = {**auto_wa, "id": "ours"}
        self.assertFalse(fu.reply_answered([theirs, auto_email], [], [], set()))
        self.assertFalse(fu.reply_answered([theirs, auto_wa], [], [], set()))
        self.assertFalse(fu.reply_answered([theirs, rep_email], [], [], set()))
        self.assertTrue(fu.reply_answered([theirs, rep_wa], [], [], set()))
        self.assertTrue(fu.reply_answered([theirs, ours_template], [], [], {"ours"}))
        # A lead who wrote by email is answered by an email.
        by_mail = {**theirs, "channel": "email"}
        self.assertTrue(fu.reply_answered([by_mail, rep_email], [], [], set()))
        # Their message after ours: not answered.
        self.assertFalse(fu.reply_answered([rep_wa, {**theirs, "at": ago(minutes=5)}], [], [], set()))

    def test_the_run_drafts_a_reply_behind_an_automations_email_and_not_behind_a_reps_answer(self):
        pg = FakePostgrest()
        lead(pg)
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv1", "contact_id": "a", "last_direction": "outbound",
                                       "last_type": "TYPE_EMAIL", "last_message_at": ago(minutes=30),
                                       "inbound_whatsapp_at": ago(hours=2)})
        thread = [wa("inbound", ago(hours=2), "How much does it cost?"),
                  wa("outbound", ago(minutes=30), "Our September newsletter", source="workflow", kind="TYPE_EMAIL")]
        out, _ = run_it(pg, FakeGhl(pg, thread=thread), FakeProvider([DRAFT_WA]))
        self.assertEqual((out["picked"], out["written"], out["by_channel"]), (1, 1, {"whatsapp": 1}))
        self.assertEqual(pg.rows("cockpit_sales_followups")[0]["segment"], "reply")
        pg.tables["cockpit_sales_followups"].clear()
        answered = thread + [wa("outbound", ago(minutes=10), "Hi Omar, I'll call you now.", source="app")]
        out, _ = run_it(pg, FakeGhl(pg, thread=answered))
        self.assertEqual((out["written"], out["already_answered"]), (0, 1))

    def test_an_email_after_a_whatsapp_reply_draft_does_not_close_it(self):
        pg = FakePostgrest()
        for c, kind in (("e", "TYPE_EMAIL"), ("w", "TYPE_WHATSAPP")):
            pg.put("cockpit_sales_followups", {"id": f"d-{c}", "contact_id": c, "segment": "reply", "status": "draft",
                                               "channel": "whatsapp", "created_at": ago(hours=3)})
            pg.put("cockpit_sales_inbox", {"conversation_id": f"cv-{c}", "contact_id": c, "last_direction": "outbound",
                                           "last_type": kind, "last_message_at": ago(hours=1)})
        pg.put("cockpit_sales_followups", {"id": "d-m", "contact_id": "m", "segment": "reply", "status": "draft",
                                           "channel": "email", "created_at": ago(hours=3)})
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv-m", "contact_id": "m", "last_direction": "outbound",
                                       "last_type": "TYPE_EMAIL", "last_message_at": ago(hours=1)})
        with mock.patch.object(http, "request", pg):
            self.assertEqual(fu.close_gone(Supabase("https://example.supabase.co", "k"), NOW), 2)
        status = {r["id"]: r["status"] for r in pg.rows("cockpit_sales_followups")}
        self.assertEqual(status, {"d-e": "draft", "d-w": "expired", "d-m": "expired"})


# ---------------------------------------------------------------------------
# Fault 2: the brief cut from its end dropped the newest messages
# ---------------------------------------------------------------------------

def big_context(n_messages: int = 20) -> dict:
    conv = [{"at": ago(hours=n_messages - i), "from": "lead" if i % 2 else "us", "channel": "whatsapp",
             "text": f"message {i:02d} " + "words " * 98} for i in range(n_messages)]
    conv[-1]["text"] = "THE NEWEST: can we talk tomorrow at noon? " + "x" * 500
    return {
        "lead": {"name": "Omar", "challenge": "c" * 900, "services": "s" * 900},
        "calls_on_the_calendar": [{"call_type": "intro", "start_at": ago(days=d), "status": "showed"} for d in range(6)],
        "phone_calls": [{"occurred_at": ago(days=d), "summary_en": "p" * 800} for d in range(5)],
        "rep_notes": [{"text": "n" * 600, "at": ago(days=d)} for d in range(5)],
        "recorded_calls": [{"title": "Demo", "summary": "r" * 2500, "action_items": "a" * 800} for _ in range(2)],
        "what_the_calls_told_us": [{"call": "demo", "summary": "w" * 1500, "real_problem": "q" * 900,
                                    "objections": "o" * 900, "expectations": "e" * 900, "next_steps": "z" * 900}
                                   for _ in range(2)],
        "research": {"company": "k" * 3000, "talking_points": ["t" * 800 for _ in range(8)]},
        "conversation": conv,
    }


class BriefKeepsTheNewest(unittest.TestCase):
    def test_the_old_cut_lost_the_newest_message_and_the_brief_keeps_all_twenty(self):
        ctx = big_context()
        old = json.dumps(ctx, ensure_ascii=False, indent=1, default=str)[:24000]
        self.assertNotIn("THE NEWEST", old)  # the fault, as it was
        text = fu.brief(ctx)
        self.assertLessEqual(len(text), fu.BRIEF_LIMIT)
        back = json.loads(text)  # whole JSON, never cut mid-way
        self.assertEqual(len(back["conversation"]), 20)
        self.assertEqual(back["conversation"][-1]["text"], ctx["conversation"][-1]["text"])
        self.assertEqual([m["at"] for m in back["conversation"]], [m["at"] for m in ctx["conversation"]])
        # The caller's context is not changed (it is also the draft's record).
        self.assertEqual(len(ctx["recorded_calls"][0]["summary"]), 2500)

    def test_only_the_newest_twenty_of_a_longer_thread_are_kept(self):
        ctx = big_context(30)
        back = json.loads(fu.brief(ctx))
        self.assertEqual([m["text"][:10] for m in back["conversation"]][:2], ["message 10", "message 11"])
        self.assertTrue(back["conversation"][-1]["text"].startswith("THE NEWEST"))

    def test_a_small_brief_is_left_alone_and_an_enormous_one_still_fits(self):
        small = {"lead": {"name": "Omar"}, "conversation": [{"text": "hi"}]}
        self.assertEqual(json.loads(fu.brief(small)), small)
        huge = big_context()
        huge["lead"] = {f"k{i}": "v" * 5000 for i in range(20)}
        text = fu.brief(huge)
        self.assertLessEqual(len(text), fu.BRIEF_LIMIT)
        self.assertEqual(len(json.loads(text)["conversation"]), 20)

    def test_in_a_run_the_newest_message_reaches_the_model(self):
        pg = FakePostgrest()
        lead(pg, lead_created_at=ago(days=10))
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv1", "contact_id": "a", "last_direction": "inbound",
                                       "last_message_at": ago(minutes=20), "inbound_whatsapp_at": ago(minutes=20)})
        for i in range(2):
            pg.put("cockpit_sales_recordings", {"recording_id": f"r{i}", "contact_id": "a", "title": "Demo",
                                                "started_at": ago(days=i + 1), "summary": "r" * 2500,
                                                "action_items": "a" * 800})
        for i in range(5):
            pg.put("cockpit_sales_notes", {"id": f"n{i}", "contact_id": "a", "body": "n" * 600, "author": "rep",
                                           "created_at": ago(days=i + 1), "deleted_at": None})
        thread = [wa("outbound" if i % 2 else "inbound", ago(minutes=20 + (19 - i) * 30), f"older message {i} " + "w " * 280,
                     source="app") for i in range(19)]
        thread.append(wa("inbound", ago(minutes=20), "NEWEST: what time tomorrow?"))
        provider = FakeProvider([DRAFT_WA])
        out, _ = run_it(pg, FakeGhl(pg, thread=thread), provider)
        self.assertEqual(out["written"], 1)
        user = provider.calls[0]["user"]
        self.assertIn("NEWEST: what time tomorrow?", user)
        brief = json.loads(user.split("What we know about this lead:\n", 1)[1])
        self.assertEqual(len(brief["conversation"]), 20)


# ---------------------------------------------------------------------------
# Fault 3: after_call read "showed" only; the B2B rule counts confirmed
# ---------------------------------------------------------------------------

class AfterCallByTheB2BRule(unittest.TestCase):
    def demo(self, **over):
        return {"appointment_id": "d1", "contact_id": "d", "call_type": "demo", "status": "confirmed",
                "start_at": ago(days=1, hours=1), "calendar_id": "jQqXS1YuFnmGZKLkrE62", **over}

    def test_an_unmarked_demo_that_started_counts_as_held(self):
        self.assertEqual(who(fu.pick(NOW, inbox=[], calendar=[self.demo()], leads=[])), [("d", "after_call")])
        self.assertEqual(who(fu.pick(NOW, inbox=[], calendar=[self.demo(status="showed")], leads=[])),
                         [("d", "after_call")])

    def test_invalid_noshow_new_and_future_demos_never_feed_it(self):
        for status in ("invalid", "noshow", "cancelled", "new", None):
            out = fu.pick(NOW, inbox=[], calendar=[self.demo(status=status)], leads=[])
            self.assertNotIn(("d", "after_call"), who(out), status)
        self.assertEqual(fu.pick(NOW, inbox=[], calendar=[self.demo(start_at=ahead(hours=2))], leads=[]), [])

    def test_a_demo_2_call_feeds_it_even_with_no_call_type(self):
        demo2 = self.demo(call_type=None, calendar_id="NDBNz6Og4yfpdpWmHrue")
        self.assertEqual(who(fu.pick(NOW, inbox=[], calendar=[demo2], leads=[])), [("d", "after_call")])
        # The cockpit's calendars setting can name another demo calendar.
        other = self.demo(call_type=None, calendar_id="NEWDEMO")
        cal = fu.with_kinds([other], {"NEWDEMO": {"type": "demo", "label": "Demo 3"}})
        self.assertEqual(who(fu.pick(NOW, inbox=[], calendar=cal, leads=[])), [("d", "after_call")])
        # A follow-up calendar is no demo.
        self.assertEqual(fu.with_kinds([self.demo(call_type=None, calendar_id="JTNg1Wd62qxuT8W8sroh")],
                                       {"JTNg1Wd62qxuT8W8sroh": {"type": "follow_up"}})[0]["call_type"], None)

    def test_a_deal_ends_it_and_a_noshow_mark_in_the_first_day_moves_the_lead(self):
        self.assertEqual(fu.pick(NOW, inbox=[], calendar=[self.demo()], leads=[], deals={"d"}), [])
        marked = self.demo(status="noshow", start_at=ago(hours=20))
        self.assertEqual(who(fu.pick(NOW, inbox=[], calendar=[marked], leads=[])), [("d", "no_show")])

    def test_a_longer_cadence_in_the_settings_widens_the_window(self):
        demo = self.demo(start_at=ago(days=7, hours=2))
        done = [{"contact_id": "d", "segment": "after_call", "status": "sent", "decided_at": ago(days=7, hours=1, minutes=-h * 60)}
                for h in (24, 72)]
        self.assertEqual(fu.pick(NOW, inbox=[], calendar=[demo], leads=[], followups=done), [])
        out = fu.pick(NOW, inbox=[], calendar=[demo], leads=[], followups=done,
                      cadence={"after_call": [24, 72, 168, 336, 504, 720]})
        self.assertEqual((who(out), out[0]["touch"], out[0]["of"]), ([("d", "after_call")], 3, 6))
        self.assertEqual(fu.window_days("after_call", [24, 72, 168, 336, 504, 720]), 31)
        self.assertEqual(fu.window_days("after_call", None), 4)

    def test_the_rule_itself(self):
        self.assertTrue(fu.shown({"status": "confirmed", "start_at": ago(minutes=1)}, NOW))
        self.assertTrue(fu.shown({"status": "SHOWED", "start_at": ago(days=3)}, NOW))
        self.assertFalse(fu.shown({"status": "confirmed", "start_at": ahead(minutes=1)}, NOW))
        self.assertFalse(fu.shown({"status": "invalid", "start_at": ago(days=1)}, NOW))
        self.assertFalse(fu.shown({"status": "showed"}, NOW))


# ---------------------------------------------------------------------------
# --contact: the test path
# ---------------------------------------------------------------------------

class TestContactOnly(unittest.TestCase):
    def seed(self, pg, **over):
        return lead(pg, TEST_ID, **{"name": "Cockpit Test", "tags": ["cockpit-test", "unqualified"], "phone": None,
                                    "pipeline_name": None, "lead_class": None, "lead_created_at": ago(days=40), **over})

    def test_a_contact_not_tagged_cockpit_test_is_refused_and_nothing_is_read_or_written(self):
        pg = FakePostgrest()
        lead(pg, "real")
        ghl = Recording(pg)
        out, _ = run_it(pg, ghl, FakeProvider([]), only_contact="real", force_segment="no_show")
        self.assertIn("is not tagged cockpit-test", out["skipped"])
        self.assertEqual((pg.writes(), ghl.methods), ([], []))
        out, _ = run_it(pg, ghl, FakeProvider([]), only_contact="nobody")
        self.assertIn("not in the cockpit's lead copy", out["skipped"])
        out, _ = run_it(pg, ghl, FakeProvider([]), only_contact="real", force_segment="bogus")
        self.assertIn("not a kind of follow-up", out["skipped"])

    def test_it_drafts_for_the_test_contact_only_and_touches_no_one_else(self):
        pg = FakePostgrest()
        self.seed(pg, dnd=False)
        lead(pg, "real", lead_created_at=ago(hours=3))  # a new lead due now
        pg.put("cockpit_sales_followups", {"id": "stale", "contact_id": "other", "segment": "new", "status": "draft",
                                           "channel": "email", "created_at": ago(days=3), "expires_at": ago(hours=2)})
        provider = FakeProvider([DRAFT_EMAIL])
        out, _ = run_it(pg, FakeGhl(pg), provider, only_contact=TEST_ID, force_segment="no_show",
                        settings=settings_on(autosend={"no_show": True}), autosend=lambda _i: self.fail("sent by itself"))
        self.assertEqual((out["written"], out["test"]), (1, True))
        rows = [r for r in pg.rows("cockpit_sales_followups") if r["id"] != "stale"]
        self.assertEqual([(r["contact_id"], r["segment"], r["channel"], r["touch"]) for r in rows],
                         [(TEST_ID, "no_show", "email", 1)])
        self.assertTrue(rows[0]["context"]["test"])
        # Another lead's stale draft is left as it was: a test keeps no one else's books.
        self.assertEqual(pg.one("cockpit_sales_followups", id="stale")["status"], "draft")
        self.assertNotIn("real", {r["contact_id"] for r in pg.rows("cockpit_sales_followups")})

    def test_a_test_contact_on_do_not_disturb_gets_its_draft_for_the_refusal_test(self):
        pg = FakePostgrest()
        self.seed(pg, dnd=True)
        out, _ = run_it(pg, FakeGhl(pg, contact={"dnd": True}), FakeProvider([DRAFT_EMAIL]),
                        only_contact=TEST_ID, force_segment="no_show")
        self.assertEqual(out["written"], 1)
        d = pg.rows("cockpit_sales_followups")[0]
        self.assertTrue(d["why"].startswith("Test contact: do-not-disturb is on, so the cockpit should refuse"))
        self.assertEqual(d["channel"], "email")

    def test_a_confirmation_needs_a_call_to_come_and_a_draft_already_open_is_said(self):
        pg = FakePostgrest()
        self.seed(pg)
        out, _ = run_it(pg, FakeGhl(pg), FakeProvider([]), only_contact=TEST_ID, force_segment="confirm")
        self.assertIn("no call still to come", out["skipped"])
        pg.put("cockpit_sales_followups", {"id": "open", "contact_id": TEST_ID, "segment": "new", "status": "draft",
                                           "channel": "email", "created_at": ago(hours=1), "expires_at": ahead(hours=40)})
        out, _ = run_it(pg, FakeGhl(pg), FakeProvider([]), only_contact=TEST_ID, force_segment="no_show")
        self.assertIn("already has an open draft", out["skipped"])

    def test_without_a_kind_only_what_is_due_for_it(self):
        pg = FakePostgrest()
        self.seed(pg)
        out, _ = run_it(pg, FakeGhl(pg), FakeProvider([]), only_contact=TEST_ID)
        self.assertIn("Nothing is due for this contact", out["skipped"])

    def test_a_test_contact_tagged_client_is_refused(self):
        pg = FakePostgrest()
        self.seed(pg, tags=["cockpit-test", "client"])
        out, _ = run_it(pg, FakeGhl(pg), FakeProvider([]), only_contact=TEST_ID, force_segment="new")
        self.assertIn("tagged client", out["skipped"])


# ---------------------------------------------------------------------------
# The stop rule: a pause for stop words, a rep's yes for do-not-disturb
# ---------------------------------------------------------------------------

class StopRule(unittest.TestCase):
    def test_the_words_are_sorted_into_unsubscribe_and_pause(self):
        for text in ("STOP", "stop.", "Please stop", "unsubscribe", "Remove me from your list", "please don't message me again",
                     "stop messaging me", "احذف رقمي لو سمحت", "وقفوا الرسايل", "لا تراسلني", "ستوب"):
            self.assertEqual(fu.stop_kind(text), "unsubscribe", text)
        for text in ("Not interested, thanks", "no longer interested", "مو مهتم", "لا تتصل الحين، أنا في اجتماع",
                     "don't call me", "we stop work at 5, call before", "leave me alone"):
            self.assertEqual(fu.stop_kind(text), "pause", text)
        for text in ("Interested, when can we talk?", "send me the details", "شكراً", "", None):
            self.assertIsNone(fu.stop_kind(text), text)

    def run_with(self, pg, said, at, now=NOW, provider=None):
        thread = [wa("outbound", (datetime.fromisoformat(at) - timedelta(hours=30)).isoformat(), "هلا عمر", source="app"),
                  wa("inbound", at, said)]
        ghl = Recording(pg, thread=thread)
        warned = []
        with mock.patch.object(http, "request", ghl):
            out = fu.run(Supabase("https://example.supabase.co", "k"), provider or FakeProvider([]), lambda _m: None,
                         settings=settings_on(), ghl_token="t", now=now, warn=warned.append)
        return out, ghl, warned

    def test_not_interested_pauses_the_agent_for_30_days_and_never_sets_do_not_disturb(self):
        pg = FakePostgrest()
        lead(pg, lead_created_at=ago(hours=3))
        said_at = ago(hours=2)
        out, ghl, _ = self.run_with(pg, "Not interested, thanks", said_at)
        self.assertEqual((out["written"], out["paused"], out["asked_to_stop"]), (0, 1, 0))
        row = pg.rows("cockpit_sales_followup_stops")[0]
        self.assertEqual((row["kind"], row["state"], row["said"]), ("pause", "paused", "Not interested, thanks"))
        self.assertEqual(fu._ts(row["paused_until"]), fu._ts(said_at) + timedelta(days=30))
        self.assertEqual([m for m, _ in ghl.methods if m != "GET"], [])  # never a write to HighLevel
        # The next run keeps the same row (one per lead message).
        self.run_with(pg, "Not interested, thanks", said_at)
        self.assertEqual(len(pg.rows("cockpit_sales_followup_stops")), 1)
        # Thirty days on, the agent may write again.
        later = NOW + timedelta(days=30, hours=1)
        lead(pg, lead_created_at=(later - timedelta(hours=3)).isoformat())
        out, _, _ = self.run_with(pg, "Not interested, thanks", said_at, now=later, provider=FakeProvider([DRAFT_EMAIL]))
        self.assertEqual((out["written"], out["paused"]), (1, 0))

    def test_an_unsubscribe_asks_a_rep_and_the_agent_waits_for_the_answer(self):
        pg = FakePostgrest()
        lead(pg, lead_created_at=ago(hours=3))
        said_at = ago(hours=2)
        out, ghl, _ = self.run_with(pg, "STOP", said_at)
        self.assertEqual((out["written"], out["asked_to_stop"]), (0, 1))
        row = pg.rows("cockpit_sales_followup_stops")[0]
        self.assertEqual((row["kind"], row["state"], row["paused_until"]), ("unsubscribe", "asked", None))
        self.assertEqual([m for m, _ in ghl.methods if m != "GET"], [])
        # Months later, still waiting for a rep: nothing goes.
        later = NOW + timedelta(days=90)
        lead(pg, lead_created_at=(later - timedelta(hours=3)).isoformat())
        out, _, _ = self.run_with(pg, "STOP", said_at, now=later)
        self.assertEqual((out["written"], out["asked_to_stop"]), (0, 1))
        # A rep said yes (WhatsApp do-not-disturb, through sales-api): still nothing.
        row.update({"state": "dnd", "decided_by": "setter@x.co", "decided_at": ago(hours=1)})
        out, _, _ = self.run_with(pg, "STOP", said_at, now=later)
        self.assertEqual(out["written"], 0)
        # A rep said no: a 30-day pause from the answer, then the agent goes on.
        row.update({"state": "paused", "paused_until": (later - timedelta(days=1)).isoformat()})
        out, _, _ = self.run_with(pg, "STOP", said_at, now=later, provider=FakeProvider([DRAFT_EMAIL]))
        self.assertEqual((out["written"], out["paused"], out["asked_to_stop"]), (1, 0, 0))

    def test_only_a_rep_resuming_opens_them_up(self):
        pg = FakePostgrest()
        lead(pg, lead_created_at=ago(hours=3))
        said_at = ago(hours=2)
        self.run_with(pg, "مو مهتم", said_at)
        pg.rows("cockpit_sales_followup_stops")[0].update({"state": "resumed", "decided_by": "closer@x.co"})
        out, _, _ = self.run_with(pg, "مو مهتم", said_at, provider=FakeProvider([DRAFT_EMAIL]))
        self.assertEqual((out["written"], out["paused"]), (1, 0))
        # The thread alone reads only the latest message ...
        self.assertIsNone(fu.stop_of([{"from": "lead", "text": "not interested", "at": ago(hours=3)},
                                      {"from": "lead", "text": "actually, tell me more", "at": ago(hours=1)}]))

    def test_a_later_message_from_the_lead_never_lifts_a_kept_stop(self):
        # ... but a stop the cockpit keeps holds whatever the lead writes after it (spec P3 §4, D21).
        for said, state in (("STOP", "asked"), ("Not interested, thanks", "paused")):
            pg = FakePostgrest()
            lead(pg, lead_created_at=ago(hours=5))
            self.run_with(pg, said, ago(hours=4))
            self.assertEqual(pg.rows("cockpit_sales_followup_stops")[0]["state"], state)
            out, _, _ = self.run_with(pg, "ok", ago(hours=2), provider=FakeProvider([DRAFT_EMAIL]))
            self.assertEqual(out["written"], 0, said)
            self.assertEqual(out["asked_to_stop" if state == "asked" else "paused"], 1, said)
        # A rep's do-not-disturb answer holds the same way.
        pg.rows("cockpit_sales_followup_stops")[0].update({"state": "dnd", "decided_at": ago(hours=1)})
        out, _, _ = self.run_with(pg, "hello?", ago(minutes=30), provider=FakeProvider([DRAFT_EMAIL]))
        self.assertEqual((out["written"], out["asked_to_stop"]), (0, 1))

    def test_a_reps_own_pause_holds_every_kind_until_its_day(self):
        pg = FakePostgrest()
        lead(pg, lead_created_at=ago(hours=3))
        pg.put("cockpit_sales_followup_stops", {"contact_id": "a", "said_at": ago(days=1), "kind": "manual",
                                                "state": "paused", "paused_until": ahead(days=6), "said": None})
        out, _, _ = self.run_with(pg, "Hello", ago(hours=30))
        self.assertEqual((out["written"], out["paused"]), (0, 1))
        pg.one("cockpit_sales_followup_stops", contact_id="a")["paused_until"] = ago(minutes=1)
        out, _, _ = self.run_with(pg, "Hello", ago(hours=30), provider=FakeProvider([DRAFT_EMAIL]))
        self.assertEqual((out["written"], out["paused"]), (1, 0))

    def test_an_unreadable_stops_table_still_leaves_the_lead_alone_and_says_so(self):
        pg = FakePostgrest()
        del pg.tables["cockpit_sales_followup_stops"]
        lead(pg, lead_created_at=ago(hours=3))
        out, _, warned = self.run_with(pg, "remove me", ago(hours=2))
        self.assertEqual((out["written"], out["asked_to_stop"], out["stops_unread"]), (0, 1, True))
        self.assertEqual(sum("stops table could not be read" in w for w in warned), 1)
        # Stateless, a pause still ends 30 days after the lead's message.
        hold = fu.stop_hold({"kind": "pause", "at": NOW - timedelta(days=31), "text": "no"}, None, NOW)
        self.assertIsNone(hold)


# ---------------------------------------------------------------------------
# The desk's own sends: the WhatsApp gate and the first-message hours
# ---------------------------------------------------------------------------

class DeskSends(unittest.TestCase):
    def test_the_gate_opens_only_on_both_marks(self):
        self.assertIsNone(fu.wa_gate(GATE_OPEN))
        for g in ({}, None, "junk", {"connector_off": True}, {"connector_off": "true", "single_copy_ok_at": NOW.isoformat()},
                  {"connector_off": False, "single_copy_ok_at": NOW.isoformat()},
                  {"connector_off": True, "single_copy_ok_at": "not a time"}):
            self.assertEqual(fu.wa_gate(g), fu.GATE_CLOSED, g)

    def reply_lead(self, pg):
        lead(pg)
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv1", "contact_id": "a", "last_direction": "inbound",
                                       "last_message_at": ago(hours=1), "inbound_whatsapp_at": ago(hours=1)})

    def test_a_trusted_whatsapp_draft_is_kept_for_a_person_while_the_gate_is_shut(self):
        for guard, expect in (({}, 0), ({"connector_off": True, "single_copy_ok_at": None}, 0), (GATE_OPEN, 1)):
            pg = FakePostgrest()
            self.reply_lead(pg)
            asked = []
            out, warned = run_it(pg, provider=FakeProvider([DRAFT_WA]), settings=settings_on(autosend={"reply": True}),
                                 guard=guard, autosend=lambda i: asked.append(i) or {"ok": True})
            self.assertEqual((out["written"], out["sent_by_itself"], len(asked)), (1, expect, expect), guard)
            if not expect:
                self.assertEqual(out["kept_for_a_person"], 1)
                self.assertIn(fu.GATE_CLOSED, warned[-1])

    def test_the_gate_is_read_from_the_settings_when_not_given_and_email_is_not_held(self):
        pg = FakePostgrest()
        lead(pg, lead_created_at=ago(hours=3))
        pg.put("cockpit_sales_settings", {"key": "whatsapp_guard", "value": {"connector_off": False}})
        asked = []
        out, _ = run_it(pg, provider=FakeProvider([DRAFT_EMAIL]), settings=settings_on(autosend={"new": True}),
                        autosend=lambda i: asked.append(i) or {"ok": True})
        self.assertEqual((out["by_channel"], out["sent_by_itself"]), ({"email": 1}, 1))

    def test_a_first_message_is_not_sent_by_itself_after_six_on_the_leads_clock(self):
        evening = datetime(2026, 9, 24, 15, 30, tzinfo=timezone.utc)  # 18:30 Kuwait, 19:30 Dubai
        for country, expect in (("Kuwait", 0), ("Egypt", 0)):
            pg = FakePostgrest()
            lead(pg, lead_created_at=(evening - timedelta(hours=3)).isoformat(), country=country)
            asked = []
            with mock.patch.object(http, "request", pg):
                out = fu.run(Supabase("https://example.supabase.co", "k"), FakeProvider([DRAFT_EMAIL]), lambda _m: None,
                             settings=settings_on(autosend={"new": True}), ghl_token="", now=evening, guard=GATE_OPEN,
                             autosend=lambda i: asked.append(i) or {"ok": True})
            self.assertEqual((out["written"], out["sent_by_itself"], out["kept_for_a_person"]), (1, expect, 1), country)
        self.assertTrue(fu.in_hours(NOW, "Kuwait"))  # 14:00
        self.assertFalse(fu.in_hours(datetime(2026, 9, 24, 14, 30, tzinfo=timezone.utc), "UAE"))  # 18:30 Dubai
        self.assertTrue(fu.in_hours(datetime(2026, 9, 24, 14, 30, tzinfo=timezone.utc), "Kuwait"))  # 17:30


# ---------------------------------------------------------------------------
# Honest counts, and two runs at once
# ---------------------------------------------------------------------------

class Honest(unittest.TestCase):
    def test_with_the_model_down_who_is_due_is_counted_and_no_model_is_asked(self):
        pg = FakePostgrest()
        lead(pg, lead_created_at=ago(hours=3))
        out, _ = run_it(pg, provider=FakeProvider([]), model_down="The Claude sign-in on the VPS has lapsed.")
        self.assertEqual((out["model_down"], out["picked"], out["written"]),
                         ("The Claude sign-in on the VPS has lapsed.", 1, 0))
        self.assertEqual(pg.rows("cockpit_sales_followups"), [])

    def test_reactivate_is_a_kind_and_its_openers_never_take_the_agents_room(self):
        self.assertIn("reactivate", fu.SEGMENTS)
        self.assertIn("reactivate", fu.GOAL)
        pg = FakePostgrest()
        lead(pg, lead_created_at=ago(hours=3))
        for i in range(60):
            pg.put("cockpit_sales_followups", {"id": f"w{i}", "contact_id": f"w{i}", "segment": "reactivate",
                                               "status": "draft", "channel": "whatsapp_template", "created_at": ago(hours=1)})
        out, _ = run_it(pg, provider=FakeProvider([DRAFT_EMAIL]))
        self.assertEqual(out["written"], 1)


class Racing(FakePostgrest):
    """A database where another run writes the lead's draft a moment before
    this one does: the one-open-draft index refuses the second."""

    def __call__(self, method, url, **kw):
        if method == "POST" and url.endswith("/rest/v1/cockpit_sales_followups"):
            body = json.loads(kw["data"].decode()) if kw.get("data") else kw.get("json_body")
            row = body[0]
            if row.get("status") == "draft":
                if any(r["contact_id"] == row["contact_id"] and r["status"] in ("draft", "sending")
                       for r in self.rows("cockpit_sales_followups")):
                    raise http.HttpError(409, '{"code":"23505","message":"duplicate key value violates unique '
                                              'constraint cockpit_sales_followups_one_open"}', b"", url)
        return super().__call__(method, url, **kw)


class TwoRunsAtOnce(unittest.TestCase):
    def test_the_second_run_counts_a_race_not_a_failure_and_one_draft_stands(self):
        pg = Racing()
        lead(pg, lead_created_at=ago(hours=3))
        provider = FakeProvider([DRAFT_EMAIL, DRAFT_EMAIL])
        with mock.patch.object(http, "request", pg):
            sb = Supabase("https://example.supabase.co", "k")
            # Both runs read before either writes: the second sees no open draft.
            real = fu.pick
            with mock.patch.object(fu, "pick", side_effect=lambda *a, **kw: real(*a, **{**kw, "open_drafts": set()})):
                first = fu.run(sb, provider, lambda _m: None, settings=settings_on(), ghl_token="", now=NOW)
                second = fu.run(sb, provider, lambda _m: None, settings=settings_on(), ghl_token="", now=NOW)
        self.assertEqual((first["written"], second["written"], second["raced"], second["failed"]), (1, 0, 1, 0))
        self.assertEqual(len([r for r in pg.rows("cockpit_sales_followups") if r["status"] == "draft"]), 1)


if __name__ == "__main__":
    unittest.main()
