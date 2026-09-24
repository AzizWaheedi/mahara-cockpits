"""The follow-up agent: who needs a message now, on which channel, and a run
that writes a draft for a rep. Every lead and line is invented.

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

NOW = datetime(2026, 9, 24, 11, 0, tzinfo=timezone.utc)  # 14:00 Kuwait


def ago(**kw) -> str:
    return (NOW - timedelta(**kw)).isoformat()


class Pick(unittest.TestCase):
    def base(self, **over):
        kw = dict(inbox=[], calendar=[], leads=[], sends=[], open_drafts=set(), deals=set(), recent_dials=set())
        kw.update(over)
        return fu.pick(NOW, **kw)

    def test_an_unanswered_reply_comes_first(self):
        out = self.base(
            inbox=[{"contact_id": "a", "last_direction": "inbound", "last_message_at": ago(hours=2)}],
            leads=[{"contact_id": "a", "lead_created_at": ago(hours=5), "lead_class": "qualified"}])
        self.assertEqual(out, [("a", "reply")])

    def test_a_no_show_with_nothing_rebooked(self):
        cal = [{"contact_id": "b", "call_type": "intro", "status": "noshow", "start_at": ago(days=1)},
               {"contact_id": "c", "call_type": "intro", "status": "noshow", "start_at": ago(days=1)},
               {"contact_id": "c", "call_type": "intro", "status": "confirmed", "start_at": (NOW + timedelta(days=1)).isoformat()}]
        self.assertEqual(self.base(calendar=cal), [("b", "no_show")])

    def test_new_leads_only_while_unreached_and_under_three_touches(self):
        leads = [{"contact_id": "n1", "lead_created_at": ago(hours=3), "lead_class": "qualified"},
                 {"contact_id": "n2", "lead_created_at": ago(hours=3), "lead_class": "qualified"},
                 {"contact_id": "n3", "lead_created_at": ago(days=4), "lead_class": "qualified"},
                 {"contact_id": "n4", "lead_created_at": ago(hours=3), "lead_class": None}]
        sends = [{"contact_id": "n2", "created_at": ago(days=1, hours=2)}] * 3
        self.assertEqual(self.base(leads=leads, sends=sends, recent_dials=set()), [("n1", "new")])
        self.assertEqual(self.base(leads=leads[:1], recent_dials={"n1"}), [])

    def test_quiet_after_a_send_and_one_open_draft(self):
        leads = [{"contact_id": "x", "lead_created_at": ago(hours=3), "lead_class": "qualified"}]
        self.assertEqual(self.base(leads=leads, sends=[{"contact_id": "x", "created_at": ago(hours=5)}]), [])
        self.assertEqual(self.base(leads=leads, open_drafts={"x"}), [])

    def test_after_a_demo_with_no_deal_and_nurture_weekly(self):
        cal = [{"contact_id": "d", "call_type": "demo", "status": "showed", "start_at": ago(days=1)},
               {"contact_id": "e", "call_type": "demo", "status": "showed", "start_at": ago(days=1)}]
        leads = [{"contact_id": "f", "stage_name": "⏳Long Term Nurture", "last_touch_at": ago(days=9)},
                 {"contact_id": "g", "stage_name": "⏳Short Term Nurture", "last_touch_at": ago(days=2)}]
        self.assertEqual(self.base(calendar=cal, leads=leads, deals={"e"}), [("d", "after_call"), ("f", "nurture")])


class NurturePace(unittest.TestCase):
    def test_long_term_check_ins_wait_their_turn_qualified_and_newest_first(self):
        leads = [{"contact_id": f"l{i}", "stage_name": "Long Term Nurture", "lead_class": cls,
                  "lead_created_at": ago(days=d), "last_touch_at": None}
                 # all older than three days, so none of them is a new lead
                 for i, (cls, d) in enumerate([("unqualified", 6), ("qualified", 30), ("qualified", 5), (None, 4)])]
        out = fu.pick(NOW, inbox=[], calendar=[], leads=leads, sends=[], open_drafts=set(), deals=set(),
                      nurture_room=2)
        self.assertEqual(out, [("l2", "nurture"), ("l1", "nurture")])

    def test_urgent_kinds_are_never_capped_by_the_nurture_room(self):
        inbox = [{"contact_id": "r", "last_direction": "inbound", "last_message_at": ago(hours=1)}]
        leads = [{"contact_id": "n", "stage_name": "Nurture", "lead_class": "qualified", "last_touch_at": None}]
        out = fu.pick(NOW, inbox=inbox, calendar=[], leads=leads, sends=[], open_drafts=set(), deals=set(),
                      nurture_room=0)
        self.assertEqual(out, [("r", "reply")])


class Eligible(unittest.TestCase):
    def test_only_sales_leads_and_never_clients(self):
        lead = {"contact_id": "a", "pipeline_name": "Sales Pipeline (2-Call)", "stage_name": "Hot Leads",
                "opp_status": "open", "contact_type": "lead", "lead_class": "qualified"}
        self.assertIsNone(fu.eligible(lead, set()))
        self.assertEqual(fu.eligible({**lead, "contact_type": "customer"}, set()), "a client")
        self.assertEqual(fu.eligible({**lead, "stage_name": "🎉Closed"}, set()), "a client")
        self.assertEqual(fu.eligible(lead, {"a"}), "a client")
        self.assertEqual(fu.eligible({**lead, "opp_status": "lost"}, set()), "no longer in the pipeline")
        # A contact in no pipeline and with no lead tag is not a sales lead
        # (the client whose contract email reached the sales inbox).
        self.assertIn("not a sales lead",
                      fu.eligible({"contact_id": "w", "contact_type": "lead", "pipeline_name": None, "lead_class": None}, set()))
        self.assertEqual(fu.eligible(None, set()), "not in the cockpit's lead copy")


class Rules(unittest.TestCase):
    def test_quiet_hours_are_kuwait_time(self):
        self.assertFalse(fu.quiet(NOW, {"from": 21, "to": 9}))
        self.assertTrue(fu.quiet(datetime(2026, 9, 24, 19, 0, tzinfo=timezone.utc), {"from": 21, "to": 9}))  # 22:00
        self.assertTrue(fu.quiet(datetime(2026, 9, 24, 5, 0, tzinfo=timezone.utc), {"from": 21, "to": 9}))   # 08:00

    def test_whatsapp_only_inside_the_window_then_email_then_nothing(self):
        lead = {"email": "a@b.co"}
        self.assertEqual(fu.channel_for(lead, NOW - timedelta(hours=3), NOW), "whatsapp")
        self.assertEqual(fu.channel_for(lead, NOW - timedelta(hours=30), NOW), "email")
        self.assertIsNone(fu.channel_for({}, None, NOW))
        self.assertIsNone(fu.channel_for({"email": "a@b.co", "dnd": True}, None, NOW))

    def test_a_draft_needs_a_body_a_reason_and_for_email_a_subject(self):
        ok = fu.parse_draft(json.dumps({"body": "هلا عمر، نقدر نرتب موعد ثاني؟", "subject": None, "why": "Missed the intro."}), "whatsapp")
        self.assertEqual(ok["language"], "ar")
        self.assertIsNone(fu.parse_draft(json.dumps({"body": "Hi", "why": "x"}), "email"))
        self.assertIsNone(fu.parse_draft(json.dumps({"body": "السعر $500 فقط", "why": "x"}), "whatsapp"))
        self.assertIsNone(fu.parse_draft("no json", "whatsapp"))


class Run(unittest.TestCase):
    def test_a_reply_gets_a_whatsapp_draft_for_the_leads_rep(self):
        pg = FakePostgrest()
        pg.put("cockpit_sales_leads", {"contact_id": "a", "name": "Omar", "email": "o@x.co", "assigned_to": "u-rami",
                                       "lead_created_at": ago(days=10), "lead_class": "qualified", "dnd": False,
                                       "stage_name": "Intro Booked"})
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
        self.assertEqual((d["segment"], d["channel"], d["owner_email"], d["status"]),
                         ("reply", "whatsapp", "rami@maharamedia.com", "draft"))
        self.assertIn("Why this lead now", provider.calls[0]["system"])
        self.assertIn("Never propose a specific day or time", provider.calls[0]["system"])
        # With no rep on B2B's list for the lead's owner, the facts say so and nothing is signed.
        self.assertIn('"rep": null', provider.calls[0]["user"])

    def test_a_trusted_kind_is_sent_by_itself_and_others_wait(self):
        pg = FakePostgrest()
        pg.put("cockpit_sales_leads", {"contact_id": "a", "name": "Omar", "email": "o@x.co", "assigned_to": None,
                                       "lead_created_at": ago(days=10), "lead_class": "qualified", "dnd": False})
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
