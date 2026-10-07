"""Milestone 1's fence on the desk (5 October 2026): the video link when a
call fails is the milestone; the follow-up agent's own sends (waves, openers,
the paced send, confirmation drafts, autosend) and live handover's rooms
(standby, handover) stay off while their switches are off, whatever the desk
is asked to do. Every lead, seat and meeting is invented; nothing reaches
the network.

    python3 -m unittest tests.test_m1_fence
"""
from __future__ import annotations

import json
import os
import re
import unittest
from pathlib import Path
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http, rooms, waves  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests.fakes import FakePostgrest, FakeProvider  # noqa: E402
from tests.test_followups import GATE_OPEN as FU_GATE_OPEN, NOW as FU_NOW, ago as fu_ago  # noqa: E402
from tests.test_followups_phase0 import TEST_ID, lead  # noqa: E402
from tests.test_rooms import CLOSER, SETTER, RoomsCase  # noqa: E402
from tests.test_waves import NOW, SETTINGS, Api, Clock, members, run, seed, wave  # noqa: E402

DESK = Path(__file__).resolve().parent.parent


class AgentSwitch(unittest.TestCase):
    def test_the_agents_own_sends_need_followups_agent_true(self):
        self.assertFalse(fu.agent_work_on({"enabled": True}))
        self.assertFalse(fu.agent_work_on({"enabled": True, "agent": "true"}))
        self.assertFalse(fu.agent_work_on({"enabled": False, "agent": True}))
        self.assertFalse(fu.agent_work_on(None))
        self.assertTrue(fu.agent_work_on({"enabled": True, "agent": True}))
        self.assertTrue(fu.agent_work_on({"agent": True}))


class WavesOff(unittest.TestCase):
    def test_a_running_wave_enrols_drafts_and_sends_nothing_while_the_agent_is_off(self):
        pg = FakePostgrest()
        seed(pg, "w1", "never_booked")
        wave(pg, "wave-1", "never_booked")
        api = Api(pg, Clock(NOW))
        off = {k: v for k, v in SETTINGS.items() if k != "agent"}
        out, *_ = run(pg, settings=off, api=api)
        self.assertIn("followups.agent", out["skipped"])
        self.assertEqual(members(pg), [])
        self.assertEqual(pg.rows("cockpit_sales_followups"), [])
        self.assertEqual(api.calls, [])
        # The same run with the switch on enrols the pool (the switch is the only thing that changed).
        out, *_ = run(pg, settings=SETTINGS, api=api)
        self.assertNotIn("skipped", out)
        self.assertTrue(members(pg))


class FollowupsOff(unittest.TestCase):
    def _due_confirm(self) -> dict:
        return {"contact_id": "q", "segment": "confirm", "touch": 1, "tier": 1, "heat": 0,
                "appointment_id": "c1", "start_at": FU_NOW}

    def test_no_confirmation_draft_is_written_while_the_agent_is_off(self):
        pg = FakePostgrest()
        for agent, picked in ((False, 0), (True, 1)):
            with mock.patch.object(http, "request", pg), mock.patch.object(fu, "pick", return_value=[self._due_confirm()]):
                out = fu.run(Supabase("https://example.supabase.co", "k"), FakeProvider([]), lambda _m: None,
                             settings={"enabled": True, "agent": agent}, ghl_token="", now=FU_NOW,
                             model_down="no model in this test")
            self.assertEqual(out["picked"], picked, agent)

    def test_the_test_path_writes_no_confirmation_either(self):
        pg = FakePostgrest()
        lead(pg, TEST_ID, name="Cockpit Test", tags=["cockpit-test", "unqualified"], phone=None, pipeline_name=None,
             lead_class=None)
        with mock.patch.object(http, "request", pg):
            out = fu.run(Supabase("https://example.supabase.co", "k"), FakeProvider([]), lambda _m: None,
                         settings={"enabled": True}, ghl_token="", now=FU_NOW, only_contact=TEST_ID,
                         force_segment="confirm")
        self.assertIn("Confirmation drafts are switched off", out["skipped"])
        self.assertEqual(pg.rows("cockpit_sales_followups"), [])

    def test_a_trusted_kind_is_never_sent_by_itself_while_the_agent_is_off(self):
        pg = FakePostgrest()
        pg.put("cockpit_sales_leads", {"contact_id": "a", "name": "Omar", "email": "o@x.co", "phone": "+96550000000",
                                       "assigned_to": None, "lead_created_at": fu_ago(days=10), "lead_class": "qualified",
                                       "dnd": False, "country": "Kuwait", "pipeline_name": "Sales Pipeline (2-Call)"})
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv1", "contact_id": "a", "last_direction": "inbound",
                                       "last_message_at": fu_ago(hours=1), "inbound_whatsapp_at": fu_ago(hours=1)})
        asked: list = []
        draft = json.dumps({"body": "Hi Omar, here is the link.", "subject": None, "why": "He asked."})
        with mock.patch.object(http, "request", pg):
            out = fu.run(Supabase("https://example.supabase.co", "k"), FakeProvider([draft]), lambda _m: None,
                         settings={"enabled": True, "per_run": 5, "per_day": 60, "autosend": {"reply": True}},
                         ghl_token="", now=FU_NOW, guard=FU_GATE_OPEN, autosend=lambda i: (asked.append(i) or {"ok": True}))
        # The draft the rep approves is still written (followups.enabled); nothing goes by itself.
        self.assertEqual((out["written"], out["sent_by_itself"], asked), (1, 0, []))


class LiveRoomsOff(RoomsCase):
    def _zoom_creates(self) -> int:
        return sum(1 for c in self.env.zoom.calls if c[0] == "POST" and "/meetings" in c[1])

    def test_standby_and_handover_rooms_are_refused_while_live_is_off_and_a_lead_s_room_is_made(self):
        self.env.add_room(1, purpose="standby", contact_id=None, host_email=CLOSER, call_kind="demo")
        self.env.add_room(2, purpose="handover", contact_id="contact-test-2", host_email=CLOSER, call_kind="demo",
                          code="K7Q2HO")
        self.env.add_room(3, purpose="fallback", contact_id="contact-test-3", host_email=SETTER, provider="meet",
                          code="K7Q2FB")
        self.tick(self.env.worker())
        for n in (1, 2):
            r = self.env.room(n)
            self.assertEqual(r["state"], "failed", r)
            self.assertEqual(r["error"], rooms.SAY["live_off"])
        self.assertEqual(self._zoom_creates(), 0)
        self.assertNotEqual(self.env.room(3)["state"], "failed", self.env.room(3).get("error"))

    def test_a_live_setting_that_cannot_be_read_is_off(self):
        self.env.pg.put("cockpit_sales_settings", {"key": "live", "value": "not a setting"})
        self.env.add_room(1, purpose="standby", contact_id=None, host_email=CLOSER, call_kind="demo")
        self.tick(self.env.worker())
        self.assertEqual(self.env.room(1)["error"], rooms.SAY["live_off"])

    def test_with_live_on_a_standby_room_is_made(self):
        self.env.pg.put("cockpit_sales_settings", {"key": "live", "value": {"enabled": True}})
        self.env.add_room(1, purpose="standby", contact_id=None, host_email=CLOSER, call_kind="demo")
        self.env.worker().run(seconds=10)
        self.assertEqual(self.env.room(1)["state"], "open", self.env.room(1).get("error"))


class NoSwitchFromTheDesk(unittest.TestCase):
    def test_the_desk_writes_no_switch_setting(self):
        """Every settings write on the desk (store_setting) names a key that is
        not a switch: the switches are a manager's (sales-api followup.settings,
        and the database's settings guard for everything else)."""
        keys = set()
        for path in [DESK / "desk.py", *sorted((DESK / "desk").glob("*.py"))]:
            text = path.read_text(encoding="utf-8")
            for m in re.finditer(r"(?<!def )store_setting\(\s*([A-Za-z_.\"']+)", text):
                keys.add((path.name, m.group(1)))
            # Nothing writes the settings table any other way.
            self.assertIsNone(re.search(r"\.(?:upsert|update|insert|rest)\(\s*[\"'](?:POST|PATCH)?[\"']?,?\s*[\"']?cockpit_sales_settings", text),
                              path.name)
        self.assertEqual({k for _f, k in keys} - {"key"},
                         {"SETTING_KEY", "SETTING", "offer_mod.SETTING_KEY"})
        from desk import clientform, maqsam_calls, offer
        self.assertNotIn(clientform.SETTING_KEY, ("rooms", "live", "threads", "followups"))
        self.assertNotIn(maqsam_calls.SETTING, ("rooms", "live", "threads", "followups"))
        self.assertNotIn(offer.SETTING_KEY, ("rooms", "live", "threads", "followups"))


if __name__ == "__main__":
    unittest.main()
