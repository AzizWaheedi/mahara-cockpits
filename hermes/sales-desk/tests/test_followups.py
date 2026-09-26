"""The follow-up agent: who needs a message now and in what order, which
step of their sequence, on which channel, and a run that writes a draft for
a rep. Every lead and line is invented.

    python3 -m unittest tests.test_followups
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

NOW = datetime(2026, 9, 24, 11, 0, tzinfo=timezone.utc)  # 14:00 Kuwait, a Thursday


def ago(**kw) -> str:
    return (NOW - timedelta(**kw)).isoformat()


def ahead(**kw) -> str:
    return (NOW + timedelta(**kw)).isoformat()


def who(out):
    return [(d["contact_id"], d["segment"]) for d in out]


class Pick(unittest.TestCase):
    def base(self, **over):
        kw = dict(inbox=[], calendar=[], leads=[])
        kw.update(over)
        return fu.pick(NOW, **kw)

    def test_an_unanswered_reply_comes_first(self):
        out = self.base(
            inbox=[{"contact_id": "a", "last_direction": "inbound", "last_message_at": ago(hours=2)}],
            leads=[{"contact_id": "a", "lead_created_at": ago(hours=5), "lead_class": "qualified"}])
        self.assertEqual(who(out), [("a", "reply")])
        self.assertEqual((out[0]["tier"], out[0]["touch"]), (0, 1))

    def test_a_no_show_with_nothing_rebooked_gets_its_sequence(self):
        cal = [{"appointment_id": "p1", "contact_id": "b", "call_type": "intro", "status": "noshow", "start_at": ago(hours=2)},
               {"appointment_id": "p2", "contact_id": "c", "call_type": "intro", "status": "noshow", "start_at": ago(hours=2)},
               {"appointment_id": "p3", "contact_id": "c", "call_type": "intro", "status": "confirmed", "start_at": ahead(days=1)}]
        out = self.base(calendar=cal)
        self.assertEqual(who(out), [("b", "no_show")])
        self.assertEqual((out[0]["touch"], out[0]["tier"], out[0]["appointment_id"]), (1, 1, "p1"))
        # Ten minutes after the missed call is too soon; the first message is due at a quarter hour.
        fresh = [{**cal[0], "start_at": ago(minutes=10)}]
        self.assertEqual(self.base(calendar=fresh), [])
        # The first message went 20 hours ago: the second is due a day after it, not yet.
        first = [{"contact_id": "b", "segment": "no_show", "status": "sent", "decided_at": ago(hours=21)}]
        cal_b = [{**cal[0], "start_at": ago(hours=22)}]
        self.assertEqual(self.base(calendar=cal_b, followups=first), [])
        # A day and a bit after the first, the second one is due.
        first = [{"contact_id": "b", "segment": "no_show", "status": "sent", "decided_at": ago(hours=25)}]
        cal_b = [{**cal[0], "start_at": ago(hours=26)}]
        out = self.base(calendar=cal_b, followups=first)
        self.assertEqual((who(out), out[0]["touch"], out[0]["tier"]), ([("b", "no_show")], 2, 2))

    def test_a_skipped_step_counts_as_done_and_the_sequence_ends(self):
        cal = [{"appointment_id": "p1", "contact_id": "b", "call_type": "demo", "status": "noshow", "start_at": ago(days=6, hours=1)}]
        steps = [{"contact_id": "b", "segment": "no_show", "status": s, "decided_at": ago(days=6 - d)}
                 for s, d in (("sent", 0), ("skipped", 1), ("sent", 3), ("sent", 5.5))]
        self.assertEqual(self.base(calendar=cal, followups=steps), [])

    def test_a_cancellation_is_followed_up_at_once_unless_rebooked(self):
        cal = [{"appointment_id": "x1", "contact_id": "k", "call_type": "demo", "status": "cancelled",
                "start_at": ahead(days=2), "booked_at": ago(days=3)}]
        out = self.base(calendar=cal)
        self.assertEqual((who(out), out[0]["touch"]), ([("k", "cancelled")], 1))
        rebooked = cal + [{"appointment_id": "x2", "contact_id": "k", "call_type": "demo", "status": "confirmed",
                           "start_at": ahead(days=4)}]
        self.assertEqual(self.base(calendar=rebooked), [])

    def test_a_call_booked_more_than_a_day_ahead_is_confirmed_on_time(self):
        # A call at 11:00 Kuwait tomorrow, booked four days ago: due from 18:00 today.
        call = {"appointment_id": "c1", "contact_id": "q", "call_type": "demo", "status": "confirmed",
                "start_at": "2026-09-25T08:00:00+00:00", "booked_at": ago(days=4)}
        self.assertEqual(self.base(calendar=[call]), [])  # 14:00 now: not yet
        evening = NOW + timedelta(hours=4, minutes=5)  # 18:05 Kuwait
        out = fu.pick(evening, inbox=[], calendar=[call], leads=[])
        self.assertEqual((who(out), out[0]["tier"], out[0]["appointment_id"]), ([("q", "confirm")], 1, "c1"))
        # Within three hours of the call it is the most urgent kind.
        morning = datetime(2026, 9, 25, 6, 0, tzinfo=timezone.utc)
        self.assertEqual(fu.pick(morning, inbox=[], calendar=[call], leads=[])[0]["tier"], 0)
        # Booked the same day: HighLevel's reminders cover it.
        late = {**call, "booked_at": "2026-09-24T12:00:00+00:00"}
        self.assertEqual(fu.pick(evening, inbox=[], calendar=[late], leads=[]), [])
        # Already confirmed, or they wrote since booking, or a draft exists: nothing.
        done = [{"appointment_id": "c1", "result": "confirmed"}]
        self.assertEqual(fu.pick(evening, inbox=[], calendar=[call], leads=[], confirmations=done), [])
        wrote = [{"contact_id": "q", "last_direction": "outbound", "last_message_at": ago(hours=1),
                  "inbound_whatsapp_at": ago(days=1)}]
        self.assertEqual(fu.pick(evening, inbox=wrote, calendar=[call], leads=[]), [])
        drafted = [{"contact_id": "q", "segment": "confirm", "status": "skipped", "appointment_id": "c1",
                    "decided_at": ago(days=2)}]
        self.assertEqual(fu.pick(evening, inbox=[], calendar=[call], leads=[], followups=drafted), [])

    def test_new_leads_who_never_booked_and_nobody_reached(self):
        leads = [{"contact_id": "n1", "lead_created_at": ago(hours=3), "lead_class": "qualified"},
                 {"contact_id": "n2", "lead_created_at": ago(hours=3), "lead_class": "qualified"},
                 {"contact_id": "n3", "lead_created_at": ago(days=8), "lead_class": "qualified"},
                 {"contact_id": "n4", "lead_created_at": ago(hours=3), "lead_class": None},
                 {"contact_id": "n5", "lead_created_at": ago(hours=3), "lead_class": None, "pipeline_id": "p"},
                 {"contact_id": "n6", "lead_created_at": ago(minutes=10), "lead_class": "qualified"}]
        cal = [{"appointment_id": "b2", "contact_id": "n2", "call_type": "intro", "status": "confirmed", "start_at": ahead(days=2)}]
        out = self.base(leads=leads, calendar=cal)
        # n2 booked, n3 is older than a week, n4 is no lead, n6 came in ten minutes ago (due at half an hour).
        self.assertEqual(sorted(who(out)), [("n1", "new"), ("n5", "new")])
        self.assertEqual(self.base(leads=leads[:1], reached={"n1"}), [])

    def test_the_hottest_come_first_within_a_tier(self):
        leads = [{"contact_id": "cold", "lead_created_at": ago(hours=3), "lead_class": "unqualified"},
                 {"contact_id": "warm", "lead_created_at": ago(hours=3), "lead_class": "qualified"},
                 {"contact_id": "hot", "lead_created_at": ago(hours=3), "lead_class": "qualified",
                  "revenue": "$1M- $2.5M", "readiness": "$12K أكثر من"}]
        out = self.base(leads=leads, hot={"warm"})
        self.assertEqual([d["contact_id"] for d in out], ["hot", "warm", "cold"])
        self.assertEqual(out[0]["reasons"], ["Qualified", "$1M+ a year", "Ready to invest"])

    def test_quiet_after_a_send_and_one_open_draft(self):
        leads = [{"contact_id": "x", "lead_created_at": ago(hours=3), "lead_class": "qualified"}]
        self.assertEqual(self.base(leads=leads, sends=[{"contact_id": "x", "created_at": ago(hours=5)}]), [])
        self.assertEqual(self.base(leads=leads, open_drafts={"x"}), [])
        # A send that failed did not reach them.
        failed = [{"contact_id": "x", "created_at": ago(hours=5), "state": "failed"}]
        self.assertEqual(who(self.base(leads=leads, sends=failed)), [("x", "new")])

    def test_after_a_demo_with_no_deal_and_nurture_weekly(self):
        cal = [{"appointment_id": "d1", "contact_id": "d", "call_type": "demo", "status": "showed", "start_at": ago(days=1, hours=1)},
               {"appointment_id": "e1", "contact_id": "e", "call_type": "demo", "status": "showed", "start_at": ago(days=1, hours=1)}]
        leads = [{"contact_id": "f", "stage_name": "⏳Long Term Nurture", "last_touch_at": ago(days=9)},
                 {"contact_id": "g", "stage_name": "⏳Short Term Nurture", "last_touch_at": ago(days=2)}]
        self.assertEqual(who(self.base(calendar=cal, leads=leads, deals={"e"})), [("d", "after_call"), ("f", "nurture")])


class NurturePace(unittest.TestCase):
    def test_long_term_check_ins_wait_their_turn_qualified_and_newest_first(self):
        leads = [{"contact_id": f"l{i}", "stage_name": "Long Term Nurture", "lead_class": cls,
                  "lead_created_at": ago(days=d), "last_touch_at": None}
                 # all older than a week, so none of them is a new lead
                 for i, (cls, d) in enumerate([("unqualified", 16), ("qualified", 30), ("qualified", 15), (None, 14)])]
        out = fu.pick(NOW, inbox=[], calendar=[], leads=leads, nurture_room=2)
        self.assertEqual(who(out), [("l2", "nurture"), ("l1", "nurture")])

    def test_urgent_kinds_are_never_capped_by_the_nurture_room(self):
        inbox = [{"contact_id": "r", "last_direction": "inbound", "last_message_at": ago(hours=1)}]
        leads = [{"contact_id": "n", "stage_name": "Nurture", "lead_class": "qualified", "last_touch_at": None}]
        out = fu.pick(NOW, inbox=inbox, calendar=[], leads=leads, nurture_room=0)
        self.assertEqual(who(out), [("r", "reply")])


class Heat(unittest.TestCase):
    """The same answers as the dialer's tests (sales-api dialer.test.ts)."""

    def test_revenue_bands_in_english_and_arabic(self):
        self.assertEqual(fu.revenue_of("$500k-$1M"), 500_000)
        self.assertEqual(fu.revenue_of("$1M- $2.5M"), 1_000_000)
        self.assertEqual(fu.revenue_of("$2.5M+"), 2_500_000)
        self.assertEqual(fu.revenue_of("اكثر من $5M"), 5_000_000)
        self.assertEqual(fu.revenue_of("أقل من $100,000"), 40_000)
        self.assertIsNone(fu.revenue_of(""))

    def test_money_ready_to_invest(self):
        self.assertEqual(fu.ready_of("$4K - $8K"), (True, 4_000))
        self.assertEqual(fu.ready_of("$12K أكثر من"), (True, 12_000))
        self.assertEqual(fu.ready_of("عندي ما بين 2000$ إلى 5000$ جاهز للاستثمار"), (True, 2_000))
        self.assertEqual(fu.ready_of("مو مستعد للاستثمار حالياً"), (False, None))
        self.assertIsNone(fu.ready_of(None))

    def test_the_confirmation_time_follows_the_call(self):
        self.assertEqual(fu.confirm_from(datetime(2026, 9, 25, 8, 0, tzinfo=timezone.utc)),
                         datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc))  # 11:00 call: 18:00 the day before
        self.assertEqual(fu.confirm_from(datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)),
                         datetime(2026, 9, 25, 6, 0, tzinfo=timezone.utc))   # 15:00 call: 09:00 that day


class Eligible(unittest.TestCase):
    def test_only_sales_leads_and_never_clients(self):
        lead = {"contact_id": "a", "pipeline_name": "Sales Pipeline (2-Call)", "stage_name": "Hot Leads",
                "opp_status": "open", "contact_type": "lead", "lead_class": "qualified"}
        self.assertIsNone(fu.eligible(lead, set()))
        self.assertEqual(fu.eligible({**lead, "contact_type": "customer"}, set()), "a client")
        self.assertEqual(fu.eligible({**lead, "stage_name": "🎉Closed"}, set()), "a client")
        self.assertEqual(fu.eligible(lead, {"a"}), "a client")
        self.assertEqual(fu.eligible({**lead, "opp_status": "lost"}, set()), "no longer in the pipeline")
        self.assertIn("not a sales lead",
                      fu.eligible({"contact_id": "w", "contact_type": "lead", "pipeline_name": None, "lead_class": None}, set()))
        self.assertEqual(fu.eligible(None, set()), "not in the cockpit's lead copy")


class Rules(unittest.TestCase):
    def test_quiet_hours_are_kuwait_time(self):
        self.assertFalse(fu.quiet(NOW, {"from": 21, "to": 9}))
        self.assertTrue(fu.quiet(datetime(2026, 9, 24, 19, 0, tzinfo=timezone.utc), {"from": 21, "to": 9}))  # 22:00
        self.assertTrue(fu.quiet(datetime(2026, 9, 24, 5, 0, tzinfo=timezone.utc), {"from": 21, "to": 9}))   # 08:00

    def test_whatsapp_first_then_a_template_then_email_then_nothing(self):
        lead = {"email": "a@b.co", "phone": "+96550000000"}
        self.assertEqual(fu.channel_for(lead, NOW - timedelta(hours=3), NOW, template=True), "whatsapp")
        self.assertEqual(fu.channel_for(lead, NOW - timedelta(hours=30), NOW, template=True), "whatsapp_template")
        self.assertEqual(fu.channel_for(lead, NOW - timedelta(hours=30), NOW), "email")
        self.assertIsNone(fu.channel_for(lead, None, NOW, email_ok=False))
        self.assertIsNone(fu.channel_for({}, None, NOW))
        self.assertIsNone(fu.channel_for({**lead, "dnd": True}, None, NOW, template=True))

    def test_the_language_is_theirs_first(self):
        self.assertEqual(fu.language_for({"name": "Omar"}, [{"from": "lead", "text": "مرحبا"}]), "ar")
        self.assertEqual(fu.language_for({"name": "عمر"}, [{"from": "lead", "text": "Hello there"}]), "en")
        self.assertEqual(fu.language_for({"name": "عمر"}, []), "ar")
        self.assertEqual(fu.language_for({"name": "Omar", "country": "Kuwait"}, []), "ar")
        self.assertEqual(fu.language_for({"name": "Omar", "country": "United Kingdom"}, []), "en")

    def test_a_draft_needs_a_body_a_reason_and_for_email_a_subject(self):
        ok = fu.parse_draft(json.dumps({"body": "هلا عمر، نقدر نرتب موعد ثاني؟", "subject": None, "why": "Missed the intro."}), "whatsapp")
        self.assertEqual(ok["language"], "ar")
        self.assertIsNone(fu.parse_draft(json.dumps({"body": "Hi", "why": "x"}), "email"))
        self.assertIsNone(fu.parse_draft(json.dumps({"body": "السعر $500 فقط", "why": "x"}), "whatsapp"))
        self.assertIsNone(fu.parse_draft("no json", "whatsapp"))

    def test_a_template_line_is_one_line_in_the_templates_language(self):
        d = fu.parse_draft(json.dumps({"body": "حبيت أتابع معاك\nبخصوص المكالمة", "why": "Missed call."}), "whatsapp_template", "ar")
        self.assertEqual(d["body"], "حبيت أتابع معاك بخصوص المكالمة")
        self.assertIsNone(fu.parse_draft(json.dumps({"body": "Just following up", "why": "x"}), "whatsapp_template", "ar"))
        self.assertIsNone(fu.parse_draft(json.dumps({"body": "حبيت أتابع", "why": "x"}), "whatsapp_template", "en"))

    def test_an_automations_message_is_told_apart_from_the_cockpits_own_template(self):
        thread = [{"id": "m1", "from": "us", "source": "workflow", "at": ago(hours=30)},
                  {"id": "m2", "from": "us", "source": "workflow", "at": ago(hours=2)},
                  {"id": "m3", "from": "lead", "source": None, "at": ago(hours=1)}]
        self.assertEqual(fu.automation_message(thread, set()), NOW - timedelta(hours=2))
        self.assertEqual(fu.automation_message(thread, {"m2"}), NOW - timedelta(hours=30))


class Safety(unittest.TestCase):
    def test_a_lead_who_said_stop_is_left_alone(self):
        said = lambda text: [{"from": "us", "text": "هلا"}, {"from": "lead", "text": text}]
        for text in ("STOP", "please don't message me again", "Not interested, thanks", "لا تراسلني", "مو مهتم",
                     "احذف رقمي لو سمحت", "وقفوا الرسايل"):
            self.assertTrue(fu.asked_to_stop(said(text)), text)
        for text in ("متى الاجتماع؟", "Interested, when can we talk?", "send me the details", "شكراً"):
            self.assertFalse(fu.asked_to_stop(said(text)), text)
        # A later message opens them up again.
        self.assertFalse(fu.asked_to_stop([{"from": "lead", "text": "not interested"},
                                           {"from": "lead", "text": "actually, tell me more"}]))

    def test_a_call_time_goes_on_the_leads_own_clock(self):
        start = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)  # 15:00 in Kuwait
        self.assertEqual(fu.call_words(start, NOW, "Kuwait")["time_24h"], "15:00")
        self.assertEqual(fu.call_words(start, NOW, "United Arab Emirates")["time_24h"], "16:00")
        self.assertEqual(fu.call_words(start, NOW, "Oman")["time_24h"], "16:00")
        self.assertEqual(fu.call_words(start, NOW, None)["time_24h"], "15:00")


class FakeGhl:
    """HighLevel's contact and conversations for one invented lead, the rest to the fake database."""

    def __init__(self, pg: FakePostgrest, first: str = "Omar", thread: list[dict] | None = None):
        self.pg, self.first, self.thread = pg, first, thread or []

    def __call__(self, method, url, **kw):
        if "leadconnectorhq" not in url:
            return self.pg(method, url, **kw)
        if "/conversations/search" in url:
            return 200, {}, json.dumps({"conversations": [{"id": "cv1"}] if self.thread else []}).encode()
        if "/conversations/cv1/messages" in url:
            return 200, {}, json.dumps({"messages": {"messages": self.thread}}).encode()
        if "/contacts/" in url:
            return 200, {}, json.dumps({"contact": {"firstName": self.first}}).encode()
        raise AssertionError(url)


LINE_AR = {"key": "line_ar", "name": "cockpit_line_ar", "language": "ar", "purpose": "Any",
           "preview": "هلا {{1}}، معاك {{2}} من مهارة ميديا.\n{{3}}\nإذا حاب نكمل، رد علي هني.",
           "variables": ["first_name", "rep_name", "line"], "workflow_id": "wf-1", "active": True, "segments": [], "sort": 10}


class Run(unittest.TestCase):
    def seed_new_lead(self, pg: FakePostgrest, **over):
        pg.put("cockpit_sales_leads", {"contact_id": "a", "name": "Omar", "email": "o@x.co", "phone": "+96550000000",
                                       "assigned_to": None, "lead_created_at": ago(hours=3), "lead_class": "qualified",
                                       "dnd": False, "country": "Kuwait", "pipeline_name": "Sales Pipeline (2-Call)", **over})

    def test_a_reply_gets_a_whatsapp_draft_for_the_leads_rep(self):
        pg = FakePostgrest()
        self.seed_new_lead(pg, assigned_to="u-rami", lead_created_at=ago(days=10), stage_name="Intro Booked")
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv1", "contact_id": "a", "last_direction": "inbound",
                                       "last_message_at": ago(hours=1), "inbound_whatsapp_at": ago(hours=1)})
        pg.put("cockpit_sales_people", {"email": "rami@maharamedia.com", "ghl_user_id": "u-rami", "active": True})
        provider = FakeProvider([json.dumps({"body": "هلا عمر، الرابط الجديد: نرسله لك الحين؟",
                                             "subject": None, "why": "He asked for the meeting link.", "language": "ar"})])
        settings = {"enabled": True, "per_run": 5, "per_day": 60, "quiet": {"from": 21, "to": 9}}
        with mock.patch.object(http, "request", pg):
            out = fu.run(Supabase("https://example.supabase.co", "k"), provider, lambda _m: None,
                         settings=settings, ghl_token="", now=NOW)
        self.assertEqual((out["picked"], out["written"]), (1, 1))
        d = pg.rows("cockpit_sales_followups")[0]
        self.assertEqual((d["segment"], d["channel"], d["owner_email"], d["status"], d["touch"]),
                         ("reply", "whatsapp", "rami@maharamedia.com", "draft", 1))
        self.assertIn("Why this lead now", provider.calls[0]["system"])
        self.assertIn("Never propose a specific day or time", provider.calls[0]["system"])
        self.assertIn('"rep": null', provider.calls[0]["user"])

    def test_outside_the_window_a_new_lead_gets_a_template_line(self):
        pg = FakePostgrest()
        self.seed_new_lead(pg)
        pg.put("cockpit_sales_wa_templates", LINE_AR)
        provider = FakeProvider([json.dumps({"body": "شفت إنك تبي مشاريع أكثر لشركتك، متى يناسبك نتكلم ١٠ دقايق؟",
                                             "subject": None, "why": "New qualified lead, not reached yet."})])
        with mock.patch.object(http, "request", FakeGhl(pg)):
            out = fu.run(Supabase("https://example.supabase.co", "k"), provider, lambda _m: None,
                         settings={"enabled": True}, ghl_token="t", now=NOW)
        self.assertEqual((out["written"], out["by_channel"]), (1, {"whatsapp_template": 1}))
        d = pg.rows("cockpit_sales_followups")[0]
        self.assertEqual((d["segment"], d["channel"], d["template_key"], d["touch"]), ("new", "whatsapp_template", "line_ar", 1))
        self.assertIn("Write ONE line only", provider.calls[0]["system"])
        self.assertIn("{{3}}", provider.calls[0]["system"])
        self.assertIn("Introduce the rep in one line", provider.calls[0]["system"])

    def test_no_first_name_in_highlevel_means_no_template(self):
        pg = FakePostgrest()
        self.seed_new_lead(pg)
        pg.put("cockpit_sales_wa_templates", LINE_AR)
        provider = FakeProvider([json.dumps({"body": "Hi Omar, thanks for reaching out.", "subject": "Your enquiry",
                                             "why": "New lead."})])
        with mock.patch.object(http, "request", FakeGhl(pg, first="")):
            out = fu.run(Supabase("https://example.supabase.co", "k"), provider, lambda _m: None,
                         settings={"enabled": True}, ghl_token="t", now=NOW)
        self.assertEqual(out["by_channel"], {"email": 1})

    def test_it_waits_while_an_automation_is_messaging_the_lead(self):
        pg = FakePostgrest()
        self.seed_new_lead(pg)
        pg.put("cockpit_sales_wa_templates", LINE_AR)
        thread = [{"id": "w1", "direction": "outbound", "messageType": "TYPE_WHATSAPP", "source": "workflow",
                   "dateAdded": ago(hours=2), "body": "اهلا عمر، تواصلت معنا قبل كم يوم"}]
        with mock.patch.object(http, "request", FakeGhl(pg, thread=thread)):
            out = fu.run(Supabase("https://example.supabase.co", "k"), FakeProvider([]), lambda _m: None,
                         settings={"enabled": True}, ghl_token="t", now=NOW)
        self.assertEqual((out["written"], out["held_for_automation"]), (0, 1))
        # A rep writing to them from HighLevel holds it too.
        by_hand = [{**thread[0], "source": "app"}]
        with mock.patch.object(http, "request", FakeGhl(pg, thread=by_hand)):
            out = fu.run(Supabase("https://example.supabase.co", "k"), FakeProvider([]), lambda _m: None,
                         settings={"enabled": True}, ghl_token="t", now=NOW)
        self.assertEqual((out["written"], out["in_a_conversation"]), (0, 1))

    def test_an_unreadable_conversation_waits_and_a_stop_is_respected(self):
        pg = FakePostgrest()
        self.seed_new_lead(pg)

        class Broken(FakeGhl):
            def __call__(self, method, url, **kw):
                if "/conversations/" in url:
                    raise http.HttpError(502, "bad gateway", b"", url)
                return super().__call__(method, url, **kw)

        with mock.patch.object(http, "request", Broken(pg)):
            out = fu.run(Supabase("https://example.supabase.co", "k"), FakeProvider([]), lambda _m: None,
                         settings={"enabled": True}, ghl_token="t", now=NOW)
        self.assertEqual((out["written"], out["conversation_unreadable"]), (0, 1))
        thread = [{"id": "m1", "direction": "inbound", "messageType": "TYPE_WHATSAPP", "source": None,
                   "dateAdded": ago(hours=30), "body": "لا تراسلني"}]
        with mock.patch.object(http, "request", FakeGhl(pg, thread=thread)):
            out = fu.run(Supabase("https://example.supabase.co", "k"), FakeProvider([]), lambda _m: None,
                         settings={"enabled": True}, ghl_token="t", now=NOW)
        self.assertEqual((out["written"], out["asked_to_stop"]), (0, 1))

    def test_no_email_when_the_kind_does_not_allow_it(self):
        pg = FakePostgrest()
        self.seed_new_lead(pg)
        with mock.patch.object(http, "request", pg):
            out = fu.run(Supabase("https://example.supabase.co", "k"), FakeProvider([]), lambda _m: None,
                         settings={"enabled": True, "email_fallback": {"new": False}}, ghl_token="", now=NOW)
        self.assertEqual((out["written"], out["no_open_channel"]), (0, 1))

    def test_a_trusted_kind_is_sent_by_itself_and_others_wait(self):
        pg = FakePostgrest()
        self.seed_new_lead(pg, lead_created_at=ago(days=10))
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv1", "contact_id": "a", "last_direction": "inbound",
                                       "last_message_at": ago(hours=1), "inbound_whatsapp_at": ago(hours=1)})
        asked = []
        draft = json.dumps({"body": "Hi Omar, here is the link.", "subject": None, "why": "He asked."})
        for trusted, expect in ((True, 1), (False, 0)):
            pg.tables["cockpit_sales_followups"].clear()
            asked.clear()
            settings = {"enabled": True, "per_run": 5, "per_day": 60, "autosend": {"reply": trusted}}
            with mock.patch.object(http, "request", pg):
                out = fu.run(Supabase("https://example.supabase.co", "k"), FakeProvider([draft]), lambda _m: None,
                             settings=settings, ghl_token="", now=NOW,
                             autosend=lambda i: (asked.append(i) or {"ok": True}))
            self.assertEqual((out["written"], out["sent_by_itself"], len(asked)), (1, expect, expect))

    def test_a_reply_after_a_send_is_marked(self):
        pg = FakePostgrest()
        pg.put("cockpit_sales_followups", {"id": "f1", "contact_id": "a", "segment": "no_show", "status": "sent",
                                           "decided_at": ago(hours=6), "replied_at": None})
        pg.put("cockpit_sales_followups", {"id": "f2", "contact_id": "b", "segment": "new", "status": "sent",
                                           "decided_at": ago(hours=6), "replied_at": None})
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv1", "contact_id": "a", "last_direction": "outbound",
                                       "last_message_at": ago(hours=1), "inbound_whatsapp_at": ago(hours=2)})
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv2", "contact_id": "b", "last_direction": "inbound",
                                       "last_message_at": ago(hours=8), "inbound_whatsapp_at": ago(hours=8)})
        with mock.patch.object(http, "request", pg):
            self.assertEqual(fu.track_replies(Supabase("https://example.supabase.co", "k"), NOW), 1)
        self.assertEqual(pg.one("cockpit_sales_followups", id="f1")["replied_at"], ago(hours=2))
        self.assertIsNone(pg.one("cockpit_sales_followups", id="f2")["replied_at"])

    def test_a_stale_draft_frees_the_lead_for_a_fresh_one(self):
        pg = FakePostgrest()
        self.seed_new_lead(pg, lead_created_at=ago(days=10))
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv1", "contact_id": "a", "last_direction": "inbound",
                                       "last_message_at": ago(hours=1), "inbound_whatsapp_at": ago(hours=1)})
        pg.put("cockpit_sales_followups", {"id": "old", "contact_id": "a", "segment": "reply", "status": "draft",
                                           "channel": "whatsapp", "created_at": ago(days=2), "expires_at": ago(hours=20)})
        draft = json.dumps({"body": "Hi Omar, here is the link.", "subject": None, "why": "He asked."})
        with mock.patch.object(http, "request", pg):
            out = fu.run(Supabase("https://example.supabase.co", "k"), FakeProvider([draft]), lambda _m: None,
                         settings={"enabled": True}, ghl_token="", now=NOW)
        self.assertEqual((out["went_stale"], out["written"]), (1, 1))
        self.assertEqual(pg.one("cockpit_sales_followups", id="old")["status"], "expired")

    def test_quiet_hours_and_the_switch_write_nothing(self):
        pg = FakePostgrest()
        with mock.patch.object(http, "request", pg):
            sb = Supabase("https://example.supabase.co", "k")
            night = datetime(2026, 9, 24, 20, 0, tzinfo=timezone.utc)
            self.assertEqual(fu.run(sb, FakeProvider([]), lambda _m: None, settings={}, ghl_token="", now=night),
                             {"skipped": "quiet hours"})
            self.assertEqual(fu.run(sb, FakeProvider([]), lambda _m: None, settings={"enabled": False}, ghl_token="", now=NOW),
                             {"skipped": "the follow-up agent is switched off"})


if __name__ == "__main__":
    unittest.main()
