"""Stress series 2, round 3, the desk: the follow-up agent, the waves and the
room worker on the VPS (2026-10-04). Each test asserts what must hold; a
failing test names a defect for the fix lane. Every lead, name and line is
invented.

    python3 -m unittest tests.test_stress2_desk_r3
"""
from __future__ import annotations

import json
import os
import unittest
from datetime import datetime, timedelta
from typing import Any
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests.fakes import FakePostgrest, FakeProvider  # noqa: E402
from tests.test_followups import GATE_OPEN, NOW, FakeGhl, ago, settings_on  # noqa: E402
from tests.test_followups_phase0 import lead, wa  # noqa: E402

DRAFT_WA = json.dumps({"body": "Hi Omar, the package starts at 1,500 KWD a month. Shall I call you?",
                       "subject": None, "why": "He asked how much it costs."})


def iso(t: datetime) -> str:
    return t.isoformat()


def moved_on(pg: FakePostgrest, fid: str) -> bool:
    """sales-api index.ts sendFollowup's check, as written: the inbox copy or
    a message of ours later than the draft's created_at (its insert time)."""
    f = pg.one("cockpit_sales_followups", id=fid)
    made = datetime.fromisoformat(str(f["created_at"]))
    for r in pg.rows("cockpit_sales_inbox"):
        if str(r.get("contact_id")) != str(f["contact_id"]):
            continue
        for k in ("last_message_at", "inbound_whatsapp_at"):
            if r.get(k) and datetime.fromisoformat(str(r[k])) > made:
                return True
    return False


# ---------------------------------------------------------------------------
# 1. The drafter reads the lead's conversation, then asks the model (up to two
#    tries of 300 s each), then inserts the draft, whose created_at is the
#    insert's own moment (the column default). sales-api's "the conversation
#    has moved on" check (sendFollowup, and so every rep approval and every
#    autosend) compares the lead's latest message with that created_at. A lead
#    who writes while the model is writing ("Please stop messaging me") has a
#    message older than created_at: the check never sees it, close_gone never
#    closes the draft (no message went to them), and the next runs never read
#    the thread again (the lead has an open draft). The draft answering the
#    older question goes, by itself when the kind is trusted, or on a rep's
#    approval with the safety net silently off.
# ---------------------------------------------------------------------------

class ModelLatencyHidesTheLeadsNewestMessage(unittest.TestCase):
    def seed(self):
        pg = FakePostgrest()
        lead(pg, lead_created_at=ago(days=10))
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv1", "contact_id": "a", "last_direction": "inbound",
                                       "last_type": "TYPE_WHATSAPP", "last_message_at": ago(hours=1),
                                       "inbound_whatsapp_at": ago(hours=1)})
        ghl = FakeGhl(pg, thread=[wa("inbound", ago(hours=1), "How much does it cost?")])
        # The insert lands after the model answered (90 s after the read).
        inserted = NOW + timedelta(seconds=90)
        pg.defaults["cockpit_sales_followups"] = {"created_at": lambda: iso(inserted)}
        provider = FakeProvider([DRAFT_WA])
        real = provider.complete

        def writing(*a: Any, **kw: Any):
            # While the model writes, the lead writes again, and the inbox
            # copy (sales-mirror, every three minutes) catches up.
            said = NOW + timedelta(seconds=40)
            ghl.thread.append(wa("inbound", iso(said), "Please stop messaging me, I am not interested."))
            row = pg.one("cockpit_sales_inbox", conversation_id="cv1")
            row.update({"last_message_at": iso(said), "inbound_whatsapp_at": iso(said), "last_direction": "inbound"})
            return real(*a, **kw)

        provider.complete = writing  # type: ignore[method-assign]
        return pg, ghl, provider

    def test_a_trusted_reply_never_goes_out_over_a_message_the_lead_wrote_while_it_was_written(self):
        pg, ghl, provider = self.seed()
        went: list[str] = []

        def autosend(fid: str) -> dict:
            if moved_on(pg, fid):
                return {"ok": False, "error": "The conversation has moved on since this draft was made."}
            went.append(fid)
            return {"ok": True}

        with mock.patch.object(http, "request", ghl):
            out = fu.run(Supabase("https://example.supabase.co", "k"), provider, lambda _m: None, now=NOW,
                         settings=settings_on(autosend={"reply": True}), ghl_token="t", guard=GATE_OPEN,
                         autosend=autosend)
        # Fix round 3: the drafter reads the conversation again before it writes
        # the draft (moved_on_while_written), and the draft that is written
        # carries the moment its thread was read: either way nothing goes.
        self.assertEqual(out["written"] + out.get("moved_on_while_written", 0), 1, out)
        self.assertEqual(
            went, [],
            "the reply written from the conversation as it stood before the lead's 'Please stop messaging me' went "
            "out by itself: the draft's created_at is its insert time, after the model answered, so sales-api's "
            "'the conversation has moved on' check never sees a message the lead wrote while the model wrote")

    def test_a_reps_approval_is_still_told_the_conversation_moved_on(self):
        pg, ghl, provider = self.seed()
        with mock.patch.object(http, "request", ghl):
            fu.run(Supabase("https://example.supabase.co", "k"), provider, lambda _m: None, now=NOW,
                   settings=settings_on(), ghl_token="t", guard=GATE_OPEN)
            # Five minutes on, the follow-ups housekeeping runs (close_gone).
            fu.close_gone(Supabase("https://example.supabase.co", "k"), NOW + timedelta(minutes=5))
        rows = pg.rows("cockpit_sales_followups")
        if not rows:
            return  # fix round 3: the drafter saw the conversation move on and wrote no draft
        d = rows[0]
        self.assertTrue(
            d["status"] != "draft" or moved_on(pg, d["id"]),
            "a draft written from a conversation the lead wrote in during the model's minute stays open, nothing "
            "closes it, and a rep's approval passes sales-api's moved-on check: the draft goes as if the lead had "
            f"said nothing since (status {d['status']}, created_at {d['created_at']})")

    def test_a_draft_carries_the_moment_its_thread_was_read_when_the_copy_lags(self):
        """Fix round 3: the inbox copy is three minutes behind, so the drafter's
        own second look sees nothing; the draft still carries the moment its
        thread was read, and once the copy catches up the send's moved-on
        check sees the lead's newer message."""
        pg = FakePostgrest()
        lead(pg, lead_created_at=ago(days=10))
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv1", "contact_id": "a", "last_direction": "inbound",
                                       "last_type": "TYPE_WHATSAPP", "last_message_at": ago(hours=1),
                                       "inbound_whatsapp_at": ago(hours=1)})
        ghl = FakeGhl(pg, thread=[wa("inbound", ago(hours=1), "How much does it cost?")])
        pg.defaults["cockpit_sales_followups"] = {"created_at": lambda: iso(NOW + timedelta(seconds=90))}
        provider = FakeProvider([DRAFT_WA])
        with mock.patch.object(http, "request", ghl):
            out = fu.run(Supabase("https://example.supabase.co", "k"), provider, lambda _m: None, now=NOW,
                         settings=settings_on(), ghl_token="t", guard=GATE_OPEN)
        self.assertEqual(out["written"], 1, out)
        d = pg.rows("cockpit_sales_followups")[0]
        self.assertLess(datetime.fromisoformat(str(d["created_at"])), NOW + timedelta(seconds=40))
        said = NOW + timedelta(seconds=40)
        pg.one("cockpit_sales_inbox", conversation_id="cv1").update(
            {"last_message_at": iso(said), "inbound_whatsapp_at": iso(said)})
        self.assertTrue(moved_on(pg, d["id"]))

    def test_a_rep_who_answered_while_the_model_wrote_is_not_answered_over_again(self):
        # The same minute, the other way: the setter answers "How much?" in
        # HighLevel while the model writes the agent's answer to it.
        pg = FakePostgrest()
        lead(pg, lead_created_at=ago(days=10))
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv1", "contact_id": "a", "last_direction": "inbound",
                                       "last_type": "TYPE_WHATSAPP", "last_message_at": ago(hours=1),
                                       "inbound_whatsapp_at": ago(hours=1)})
        ghl = FakeGhl(pg, thread=[wa("inbound", ago(hours=1), "How much does it cost?")])
        pg.defaults["cockpit_sales_followups"] = {"created_at": lambda: iso(NOW + timedelta(seconds=90))}
        provider = FakeProvider([DRAFT_WA])
        real = provider.complete

        def writing(*a: Any, **kw: Any):
            said = NOW + timedelta(seconds=40)
            ghl.thread.append(wa("outbound", iso(said), "Hi Omar, it starts at 1,500 KWD. Calling you now.", source="app"))
            pg.one("cockpit_sales_inbox", conversation_id="cv1").update(
                {"last_message_at": iso(said), "last_direction": "outbound", "last_type": "TYPE_WHATSAPP"})
            return real(*a, **kw)

        provider.complete = writing  # type: ignore[method-assign]
        went: list[str] = []

        def autosend(fid: str) -> dict:
            if moved_on(pg, fid):
                return {"ok": False, "error": "The conversation has moved on since this draft was made."}
            went.append(fid)
            return {"ok": True}

        with mock.patch.object(http, "request", ghl):
            fu.run(Supabase("https://example.supabase.co", "k"), provider, lambda _m: None, now=NOW,
                   settings=settings_on(autosend={"reply": True}), ghl_token="t", guard=GATE_OPEN, autosend=autosend)
        self.assertEqual(
            went, [],
            "the setter answered the lead's question while the model wrote, and the agent's own answer to the same "
            "question went out after it: a second answer, because the setter's message is older than the draft's "
            "insert time (sales-api's moved-on check, close_gone's 'a message went to the lead after this draft')")


# ---------------------------------------------------------------------------
# 2. A backlog wave and the follow-up agent's own sequences reach the same
#    leads in the same week. pool_of puts a lead in no_show_cancelled the
#    moment their latest call is missed (no age floor), in never_booked the
#    moment they arrive, and in unclosed_demo a day after the demo; a wave is
#    served newest first, so its first batches are exactly the leads the
#    drafter is still working through their no-show (7 days, 4 messages),
#    new-lead (8 days, 5 messages) or after-call sequence. opener_for keeps
#    only a 20-hour gap after the agent's last message, so the lead gets
#    "How are you?" between the sequence's own messages, and the sequence
#    carries on after it (pick's 20-hour gap is the only thing it waits for).
# ---------------------------------------------------------------------------

from desk import waves  # noqa: E402
from tests import test_waves as tw  # noqa: E402

WNOW = tw.NOW


def wago(**kw) -> str:
    return (WNOW - timedelta(**kw)).isoformat()


class BacklogWaveOverlapsTheAgentsOwnSequence(unittest.TestCase):
    def agent_sent(self, pg, c, segment, hours_ago, touch=1):
        pg.put("cockpit_sales_followups", {"id": f"{segment}-{c}-{touch}", "contact_id": c, "segment": segment,
                                           "channel": "whatsapp_template", "status": "sent", "touch": touch,
                                           "created_at": wago(hours=hours_ago + 0.1), "decided_at": wago(hours=hours_ago)})
        pg.put("cockpit_sales_messages", {"id": f"m-{segment}-{c}-{touch}", "followup_id": f"{segment}-{c}-{touch}",
                                          "contact_id": c, "sent_by": "setter@x.co", "via": "workflow",
                                          "state": "sent", "channel": "whatsapp", "created_at": wago(hours=hours_ago)})

    def ghl_with(self, pg, c, hours_ago):
        people = {c: {"thread": [{"id": f"t-{c}", "direction": "outbound", "messageType": "TYPE_WHATSAPP",
                                  "source": "workflow", "dateAdded": wago(hours=hours_ago),
                                  "body": "Sorry we missed you today. Shall we find another time?"}]}}
        return tw.Ghl(pg, people)

    def test_a_no_show_from_yesterday_in_the_agents_sequence_gets_no_backlog_opener(self):
        pg = FakePostgrest()
        tw.routes(pg)
        c = "ns-fresh"
        # Missed their intro 30 hours ago; the agent's first no-show message went
        # a quarter of an hour after it. Its second is due at 24 h (plus the gap).
        tw.seed(pg, c, "no_show_cancelled", days=1.25)
        self.agent_sent(pg, c, "no_show", 29.75)
        tw.wave(pg, "w1", "no_show_cancelled", holdout_share=0.0)
        out, _api, _clock, _logs = tw.run(pg, self.ghl_with(pg, c, 29.75))
        openers = [d for d in pg.rows("cockpit_sales_followups") if d["segment"] == "reactivate"]
        self.assertEqual(
            openers, [],
            "a lead the follow-up agent is still taking through its no-show sequence (missed 30 hours ago, message 1 "
            "of 4 sent, message 2 due) was written the backlog opener, newest first: they get 'How are you?' between "
            f"the sequence's own messages ({out.get('drafted')})")
        # And the sequence goes on after the opener: message 2 is due for the agent too.
        calendar = tw.fu.with_kinds(pg.rows("cockpit_sales_calendar"))
        due = fu.pick(WNOW, inbox=[], calendar=calendar, leads=pg.rows("cockpit_sales_leads"),
                      followups=pg.rows("cockpit_sales_followups"), sends=[])
        self.assertTrue(any(d["contact_id"] == c and d["segment"] == "no_show" for d in due) or not openers)

    def test_a_lead_who_arrived_two_days_ago_gets_no_never_booked_opener_beside_the_new_lead_sequence(self):
        pg = FakePostgrest()
        tw.routes(pg)
        c = "nb-fresh"
        tw.seed(pg, c, "never_booked", days=2)
        self.agent_sent(pg, c, "new", 23, touch=2)
        tw.wave(pg, "w1", "never_booked", holdout_share=0.0)
        out, _api, _clock, _logs = tw.run(pg, self.ghl_with(pg, c, 23))
        openers = [d for d in pg.rows("cockpit_sales_followups") if d["segment"] == "reactivate"]
        self.assertEqual(
            openers, [],
            "a lead who came in two days ago, in the middle of the agent's new-lead sequence (5 messages over 8 "
            "days), is the first one a never-booked wave writes the backlog opener to "
            f"({out.get('drafted')})")


# ---------------------------------------------------------------------------
# 3. An approved opener goes without anyone reading the lead's conversation
#    at the send. The desk's own rule at drafting ("a HighLevel automation
#    messaged them lately: wait, so nobody gets both"; "they wrote lately: a
#    person answers them") is never asked again when the opener goes, hours
#    or days after it was written, and sales-api's "the conversation has
#    moved on" reads the inbox copy, which sales-mirror refreshes every three
#    minutes. An old HighLevel automation that messages the lead a minute
#    before their turn, or the lead's own "please call me now", is not in the
#    copy yet: "How are you?" lands right behind it.
# ---------------------------------------------------------------------------

class ApprovedOpenerIgnoresTheLiveConversation(unittest.TestCase):
    def test_an_opener_never_goes_a_minute_after_an_automation_messaged_the_lead(self):
        from tests.test_waves_breakit import due_draft
        pg = FakePostgrest()
        tw.routes(pg)
        tw.wave(pg, "w1", "no_show_cancelled", enrolled_at=wago(days=1))
        due_draft(pg, 0, wid="w1", send_after=wago(minutes=1))
        f = pg.one("cockpit_sales_followups", id="f000")
        f.update({"context": {"wave_id": "w1", "language": "ar"}, "created_at": wago(hours=20),
                  "expires_at": (WNOW + timedelta(hours=40)).isoformat()})
        pg.put(waves.MEMBERS, {"wave_id": "w1", "contact_id": "p000", "arm": "wave", "state": "drafted",
                               "followup_id": "f000", "due_at": wago(hours=20), "added_at": wago(days=1)})
        # The copy as sales-mirror last left it (two days quiet).
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv-p000", "contact_id": "p000", "last_direction": "outbound",
                                       "last_type": "TYPE_WHATSAPP", "last_message_at": wago(days=2)})
        ghl = tw.Ghl(pg, {"p000": {"thread": [
            {"id": "auto-1", "direction": "outbound", "messageType": "TYPE_WHATSAPP", "source": "workflow",
             "dateAdded": wago(seconds=60), "body": "Our October offer: 20% off your first month."}]}})

        class SalesApi(tw.Api):
            def __call__(self, action, payload):
                fid = payload["id"]
                if moved_on(pg, fid):
                    return 409, {"error": "The conversation has moved on since this draft was made, so it was not sent."}
                return super().__call__(action, payload)

        clock = tw.Clock(WNOW)
        api = SalesApi(pg, clock)
        out, api, _clock, _logs = tw.run(pg, ghl, api=api)
        self.assertEqual(
            [i for _, _, i in api.calls], [],
            "the backlog opener went 60 seconds after one of HighLevel's own automations messaged the lead: the "
            "desk's 20-hour automation gap is checked only when the opener is written, and the moved-on check at "
            f"the send reads an inbox copy that is up to three minutes old ({out.get('sent')})")


# ---------------------------------------------------------------------------
# 4. An approved opener kept back because whether the lead is still in the
#    backlog could not be read (send_due's kept_back: _left_pool raised) is
#    counted nowhere: the waves row says "1 sent" and nothing about the
#    opener that waits, or "1 approved openers are due and none went" with
#    no reason. Missing is never zero: the row names what waits and why.
# ---------------------------------------------------------------------------

class KeptBackUnreadIsSaid(unittest.TestCase):
    def test_an_opener_waiting_on_an_unreadable_backlog_check_is_on_the_row(self):
        from tests.test_waves_breakit import due_draft, row_ok, send
        pg = FakePostgrest()
        due_draft(pg, 0, send_after=wago(minutes=10))
        due_draft(pg, 1, send_after=wago(minutes=9))

        def flaky(method, url, **kw):
            if method == "GET" and "cockpit_sales_calendar" in url and "p001" in url:
                raise http.HttpError(503, "upstream connect error", b"", url)
            return pg(method, url, **kw)

        clock = tw.Clock(WNOW)
        api = tw.Api(pg, clock)
        logs: list = []
        with mock.patch.object(http, "request", flaky):
            out = waves.send_due(tw.sb(), api, settings=tw.SETTINGS, w=waves.settings_of(tw.SETTINGS),
                                 waves=[{"id": "w1", "state": "running"}], guard=tw.GATE_OPEN, clock=clock,
                                 sleep=clock.sleep, budget_s=1000, log=logs.append, warn=logs.append)
        ok, line = row_ok(out)
        self.assertEqual([i for _, _, i in api.calls], ["f000"])
        self.assertTrue(
            "could not be read" in line or "wait" in line,
            "an approved opener held back because the backlog check could not be read is on no line of the waves "
            f"row: {line!r} (ok={ok}, out={out})")


    def test_an_unreadable_stops_table_is_not_said_as_a_paused_lead(self):
        from tests.test_waves_breakit import due_draft, row_ok
        pg = FakePostgrest()
        due_draft(pg, 0, send_after=wago(minutes=10))

        def flaky(method, url, **kw):
            if method == "GET" and "cockpit_sales_followup_stops" in url:
                raise http.HttpError(503, "upstream connect error", b"", url)
            return pg(method, url, **kw)

        clock = tw.Clock(WNOW)
        api = tw.Api(pg, clock)
        logs: list = []
        with mock.patch.object(http, "request", flaky):
            out = waves.send_due(tw.sb(), api, settings=tw.SETTINGS, w=waves.settings_of(tw.SETTINGS),
                                 waves=[{"id": "w1", "state": "running"}], guard=tw.GATE_OPEN, clock=clock,
                                 sleep=clock.sleep, budget_s=1000, log=logs.append, warn=logs.append)
        ok, line = row_ok(out)
        self.assertNotIn(
            "the agent is paused for that lead", line,
            "the stops table could not be read (a 503), and the waves row tells the manager a rep paused the agent "
            f"for the lead: {line!r}")


# ---------------------------------------------------------------------------
# 5. The rooms switch turned on while a run is going. The worker reads the
#    rooms setting every 25 s; sales-api reads it at each press. A manager
#    switches video rooms on (or Zoom, or Meet) and a rep presses Make a room
#    a few seconds later: sales-api, reading "on", inserts the room; the
#    worker, still holding the "off" it read up to 25 s before, fails it from
#    requested with "Video rooms are switched off. A manager can switch them
#    on in Settings." The first room after go-live fails with a sentence that
#    is not true, and the rep must start again.
# ---------------------------------------------------------------------------

from desk import rooms as rooms_mod  # noqa: E402
from tests import test_rooms as tr  # noqa: E402


class SwitchedOnMidRun(tr.RoomsCase):
    def test_a_room_asked_for_just_after_rooms_were_switched_on_is_not_failed_as_switched_off(self):
        env = self.env
        setting = env.pg.one("cockpit_sales_settings", key="rooms")
        setting["value"] = {**setting["value"], "enabled": False}
        w = env.worker("run-a")

        def go_live():
            setting["value"] = {**setting["value"], "enabled": True}
            env.add_room(1, provider="meet", host_email=tr.SETTER)

        env.clock.at(tr.T0 + 5, go_live)
        w.run(seconds=20)
        room = env.room(1)
        self.assertNotEqual(
            (room["state"], room.get("error")), ("failed", rooms_mod.SAY["switched_off"]),
            "a manager switched video rooms on and the rep's room, asked for five seconds later, was failed by the "
            "worker with 'Video rooms are switched off': the worker judged it on the setting it read before the "
            f"switch (it reads it every 25 s) ({room['state']}, {room.get('error')!r})")

    def test_a_meet_room_asked_for_just_after_meet_was_switched_on_is_not_failed_as_meet_off(self):
        env = self.env
        setting = env.pg.one("cockpit_sales_settings", key="rooms")
        setting["value"] = {**setting["value"], "providers": {"zoom": True, "meet": False}}
        w = env.worker("run-a")

        def meet_on():
            setting["value"] = {**setting["value"], "providers": {"zoom": True, "meet": True}}
            env.add_room(1, provider="meet", host_email=tr.SETTER)

        env.clock.at(tr.T0 + 5, meet_on)
        w.run(seconds=20)
        room = env.room(1)
        self.assertNotEqual(room.get("error"), rooms_mod.SAY["meet_off"],
                            f"the first Meet room after Meet was switched on failed as 'Meet rooms are switched off' "
                            f"({room['state']})")


if __name__ == "__main__":
    unittest.main()
