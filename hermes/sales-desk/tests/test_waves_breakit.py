"""The review pass on the desk lane (2026-10-03), turned round: each test
first pinned a defect the reviewer found, and now asserts the fix. The class
names keep the reviewer's finding numbers (FindingN); the findings the
reviewer did not pin have their own classes below. Every lead, name and line
is invented.

    python3 -m unittest tests.test_waves_breakit
"""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http, waves  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests.fakes import FakePostgrest, FakeProvider  # noqa: E402
from tests.test_waves import (DEMO_CAL, GATE_OPEN, NOW, OPENER_AR, SETTINGS, Api, Clock, Ghl, ago, members,  # noqa: E402
                              routes, run, sb, seed, wave)

META = waves.META
MEMBERS = waves.MEMBERS
WAVES = waves.WAVES
FOLLOWUPS = waves.FOLLOWUPS


def due_draft(pg, i, *, wid="w1", send_after=None, country="Kuwait", status="draft", channel="whatsapp_template"):
    c = f"p{i:03d}"
    pg.put("cockpit_sales_leads", {"contact_id": c, "country": country, "tags": ["roas-qualified"]})
    pg.put(FOLLOWUPS, {"id": f"f{i:03d}", "contact_id": c, "segment": "reactivate", "channel": channel,
                       "status": status, "touch": 1, "created_at": ago(hours=1)})
    pg.put(META, {"followup_id": f"f{i:03d}", "send_after": send_after or ago(minutes=5), "held_by": None,
                  "wave_id": wid})


def send(pg, api=None, *, waves_=None, budget=1000.0, now=NOW, settings=None, guard=GATE_OPEN, sleep=None):
    clock = Clock(now)
    api = api or Api(pg, clock)
    api.clock = clock
    logs: list = []
    with mock.patch.object(http, "request", pg):
        out = waves.send_due(sb(), api, settings=settings or SETTINGS, w=waves.settings_of(settings or SETTINGS),
                             waves=waves_ if waves_ is not None else [{"id": "w1", "state": "running"}],
                             guard=guard, clock=clock, sleep=sleep or clock.sleep, budget_s=budget,
                             log=logs.append, warn=logs.append)
    return out, api


def row_ok(out):
    return waves.words({"waves": [{"state": "running"}], "sent": out})


def enrolled_wave(pg, n=6, pool="no_show_cancelled", wid="w1", **kw):
    """A running wave with its pool enrolled, every member in the wave arm."""
    routes(pg)
    for i in range(n):
        seed(pg, f"n{i:02d}", pool, days=i + 1, **kw)
    wave(pg, wid, pool)
    run(pg, guard={})
    for m in members(pg, wid):
        m.update({"arm": "wave", "state": "waiting", "due_at": None})
    # Every member is in the wave arm for the test, so a wave whose only
    # leads were held back (and so finished at once) runs again.
    pg.one(WAVES, id=wid).update({"state": "running", "done_reason": None})


# ---------------------------------------------------------------------------
# The reviewer's findings, fixed
# ---------------------------------------------------------------------------

class Finding1MetaStarvation(unittest.TestCase):
    def test_old_meta_rows_of_finished_drafts_never_stand_in_front_of_todays_batch(self):
        pg = FakePostgrest()
        # Five working days of openers already sent: their meta rows keep send_after.
        for i in range(200):
            due_draft(pg, i, send_after=ago(days=5, seconds=-i), status="sent")
        for i in range(200, 205):
            due_draft(pg, i, send_after=ago(minutes=5 - (i - 200)))
        out, api = send(pg)
        self.assertEqual(out["due"], 5)
        self.assertEqual([i for _, _, i in api.calls], [f"f{i:03d}" for i in range(200, 205)])
        self.assertTrue(row_ok(out)[0])

    def test_more_than_a_thousand_finished_rows_still_leave_the_due_ones_found(self):
        pg = FakePostgrest()
        for i in range(1200):
            due_draft(pg, i, send_after=ago(days=9, seconds=-i), status="sent")
        due_draft(pg, 1300)
        out, api = send(pg)
        self.assertEqual(([i for _, _, i in api.calls], out["due"]), (["f1300"], 1))


class Finding2StoppedWaveStillSends(unittest.TestCase):
    def test_a_wave_a_manager_stopped_sends_none_of_its_approved_drafts(self):
        pg = FakePostgrest()
        wave(pg, "w1", "no_show_cancelled", state="done")  # followup.wave op=stop sets done
        for i in range(3):
            due_draft(pg, i)
        out, api, _, _ = run(pg)
        self.assertEqual(api.calls, [])
        self.assertEqual((out["sent"]["sent"], out["sent"]["wave_not_running"]), (0, 3))
        self.assertIn("paused or stopped, so not sent", waves.words(out)[1])

    def test_a_wave_stopped_while_the_desk_waits_between_sends_sends_nothing_more(self):
        pg = FakePostgrest()
        wave(pg, "w1", "no_show_cancelled")
        for i in range(4):
            due_draft(pg, i, send_after=ago(minutes=10 - i))
        clock = Clock(NOW)

        def sleep(s):
            clock.sleep(s)
            pg.one(WAVES, id="w1")["state"] = "done"

        out, api = send(pg, Api(pg, clock), sleep=sleep)
        self.assertEqual([i for _, _, i in api.calls], ["f000"])
        self.assertEqual(out["wave_not_running"], 3)

    def test_a_stopped_wave_takes_back_its_openers_and_lets_go_of_its_leads(self):
        pg = FakePostgrest()
        routes(pg)
        for i in range(30):
            seed(pg, f"n{i:02d}", "no_show_cancelled", days=i + 1)
        wave(pg, "w1", "no_show_cancelled", per_day=5)
        run(pg)  # enrol and draft five
        drafts = [f for f in pg.rows(FOLLOWUPS) if f["status"] == "draft"]
        self.assertEqual(len(drafts), 5)
        drafts[0]["status"] = "sent"
        drafts[0]["decided_at"] = NOW.isoformat()
        pg.one(WAVES, id="w1")["state"] = "done"
        out, api, _, _ = run(pg, now=NOW + timedelta(minutes=5))
        self.assertEqual(out["wound_down"]["taken_back"], 4)
        self.assertEqual({f["status"] for f in drafts[1:]}, {"expired"})
        self.assertTrue(all("taken back" in f["error"] for f in drafts[1:]))
        open_ = [m for m in members(pg, "w1") if m["state"] in waves.OPEN_STATES]
        # Only held-back members whose turn came stay; they are watched to their 14 days.
        self.assertTrue(all(m["arm"] == "holdout" and m.get("due_at") for m in open_), open_)
        self.assertEqual(len(members(pg, "w1", state="sent")), 1)
        self.assertEqual(api.calls, [])


class Finding3HeadOfLineBlocking(unittest.TestCase):
    def test_a_refused_draft_is_set_aside_for_a_person_and_the_batch_behind_it_goes(self):
        pg = FakePostgrest()
        for i in range(10):
            due_draft(pg, i, send_after=ago(minutes=30 - i))
        refused = {"f000", "f001", "f002"}

        class Refuses(Api):
            def __call__(self, action, payload):
                if payload["id"] in refused:  # sendFollowup's fixable refusal: the draft stays a draft
                    self.calls.append((self.clock(), action, payload["id"]))
                    return 409, {"ok": False, "error": "This lead asked not to be contacted on WhatsApp "
                                                      "(do not disturb is on in HighLevel)."}
                return super().__call__(action, payload)

        out, api = send(pg, Refuses(pg, Clock(NOW)), budget=270)
        self.assertEqual([i for _, _, i in api.calls], ["f000", "f001", "f002"])
        self.assertIn("Three sends in a row were refused", out["stopped"])
        self.assertFalse(row_ok(out)[0])  # three different leads refused in a row is a fault, said in red
        for fid in refused:
            m = pg.one(META, followup_id=fid)
            self.assertEqual((m["held_by"], m["send_after"]), ("sales-desk", None))
            self.assertIn("do not disturb", m["hold_reason"])
        # Five minutes on, the batch behind them goes; they are not tried again.
        out, api = send(pg, now=NOW + timedelta(minutes=5), budget=270)
        self.assertEqual([i for _, _, i in api.calls][:2], ["f003", "f004"])
        self.assertFalse(refused & {i for _, _, i in api.calls})
        self.assertTrue(row_ok(out)[0])

    def test_one_refusal_between_sends_is_set_aside_and_never_counts_toward_three(self):
        pg = FakePostgrest()
        for i in range(6):
            due_draft(pg, i, send_after=ago(minutes=30 - i))
        lead = (409, {"error": "The conversation has moved on."})
        out, api = send(pg, Api(pg, Clock(NOW), script=[lead, None, lead, None, lead, None]))
        self.assertEqual((out["sent"], out["refused"], out["set_aside"], out["stopped"]), (3, 3, 3, None))
        ok, line = row_ok(out)
        self.assertTrue(ok)
        self.assertIn("3 set aside for a person on the Follow-ups page", line)

    def test_a_draft_sales_api_already_set_aside_is_still_counted_as_set_aside(self):
        # The real followup.send_due sets a refused draft aside itself (held_by
        # sales-desk, with the reason and an audit row) before it answers, so
        # the desk's own write finds it held; the run must still count it.
        pg = FakePostgrest()
        for i in range(3):
            due_draft(pg, i, send_after=ago(minutes=30 - i))
        words = "This lead asked not to be contacted on WhatsApp (do not disturb is on in HighLevel)."

        class SetsAside(Api):
            def __call__(self, action, payload):
                if payload["id"] == "f001":
                    self.calls.append((self.clock(), action, payload["id"]))
                    m = self.pg.one(META, followup_id="f001")
                    m.update({"held_by": "sales-desk", "send_after": None, "hold_reason": words})
                    return 409, {"ok": False, "error": words}
                return super().__call__(action, payload)

        out, api = send(pg, SetsAside(pg, Clock(NOW)))
        self.assertEqual((out["sent"], out["refused"], out["set_aside"], out["stopped"]), (2, 1, 1, None))
        m = pg.one(META, followup_id="f001")
        self.assertEqual((m["held_by"], m["hold_reason"]), ("sales-desk", words))
        self.assertIn("1 set aside for a person on the Follow-ups page", row_ok(out)[1])

    def test_a_refusal_for_the_leads_hours_keeps_the_draft_in_the_queue_an_hour_on(self):
        pg = FakePostgrest()
        for i in range(4):
            due_draft(pg, i, send_after=ago(minutes=30 - i))
        hours = (409, {"error": "A first message goes between 9 and 6, their time."})
        out, api = send(pg, Api(pg, Clock(NOW), script=[hours, hours, hours]))
        self.assertEqual((out["outside_hours"], out["sent"], out["stopped"]), (3, 1, None))
        m = pg.one(META, followup_id="f000")
        self.assertEqual((m["held_by"], fu._ts(m["send_after"])), (None, NOW + timedelta(hours=1)))


class Finding4KillSwitchIgnored(unittest.TestCase):
    def test_with_the_agent_switched_off_waves_enrol_draft_and_send_nothing_and_say_so(self):
        pg = FakePostgrest()
        routes(pg)
        for i in range(5):
            seed(pg, f"n{i}", "no_show_cancelled", days=i + 1)
        wave(pg, "w1", "no_show_cancelled")
        due_draft(pg, 900)
        off = {**SETTINGS, "enabled": False}
        out, api, _, _ = run(pg, settings=off)
        self.assertEqual((members(pg, "w1"), api.calls), ([], []))
        self.assertEqual([f["id"] for f in pg.rows(FOLLOWUPS)], ["f900"])
        ok, line = waves.words(out)
        self.assertFalse(ok)
        self.assertIn("switched off (followups.enabled)", line)
        self.assertIn("1 wave waits", line)
        # With no wave running, a switched-off agent is no fault.
        pg.one(WAVES, id="w1")["state"] = "paused"
        self.assertTrue(waves.words(run(pg, settings=off)[0])[0])


class Finding5PartialEnrolment(unittest.TestCase):
    def test_a_run_killed_after_the_first_chunk_is_finished_by_the_next(self):
        class DiesOnSecondChunk(FakePostgrest):
            chunks = 0

            def __call__(self, method, url, **kw):
                if method == "POST" and MEMBERS in url:
                    self.chunks += 1
                    if self.chunks == 2:
                        raise KeyboardInterrupt("the VPS rebooted")
                return super().__call__(method, url, **kw)

        pg = DiesOnSecondChunk()
        for i in range(450):
            seed(pg, f"n{i:03d}", "no_show_cancelled", days=i + 1)
        wave(pg, "w1", "no_show_cancelled")
        with self.assertRaises(KeyboardInterrupt):
            run(pg, guard={})
        self.assertEqual(len(members(pg, "w1")), 200)
        self.assertIsNone(pg.one(WAVES, id="w1").get("enrolled_at"))
        out, _, _, _ = run(pg, guard={})
        self.assertEqual(out["enrolled"]["w1"]["enrolled"], 250)
        self.assertEqual(len(members(pg, "w1")), 450)
        self.assertEqual(pg.one(WAVES, id="w1")["enrolled_at"], NOW.isoformat())
        out, _, _, _ = run(pg, guard={})
        self.assertEqual(out["enrolled"], {})


class Finding6StoppedWaveMembersBlockForever(unittest.TestCase):
    def test_a_pool_started_again_after_a_stop_gets_every_lead_back(self):
        pg = FakePostgrest()  # enforces the one-open-membership index
        for i in range(6):
            seed(pg, f"n{i}", "no_show_cancelled", days=i + 1)
        wave(pg, "w0", "no_show_cancelled")
        run(pg, guard={})
        self.assertEqual(len(members(pg, "w0")), 6)
        pg.one(WAVES, id="w0")["state"] = "done"  # a manager stopped it
        wave(pg, "w1", "no_show_cancelled")  # and started the pool again
        out, _, _, _ = run(pg, guard={})
        self.assertEqual(len(members(pg, "w1")), 6)
        self.assertEqual({m["state"] for m in members(pg, "w0")}, {"excluded"})
        self.assertTrue(all("stopped" in m["excluded_reason"] or "before their turn" in m["excluded_reason"]
                            for m in members(pg, "w0")))
        # Nobody is left in w0: it is settled and read no more.
        self.assertEqual(pg.one(WAVES, id="w0")["settled_at"], NOW.isoformat())

    def test_a_wave_whose_leads_are_all_in_another_wave_ends_once_and_says_why(self):
        pg = FakePostgrest()
        for i in range(6):
            seed(pg, f"n{i}", "no_show_cancelled", days=i + 1)
        wave(pg, "w0", "no_show_cancelled")
        run(pg, guard={})
        wave(pg, "w1", "no_show_cancelled", started_at=ago(hours=1))
        out, _, _, _ = run(pg, guard={})
        w1 = pg.one(WAVES, id="w1")
        self.assertEqual((w1["state"], members(pg, "w1")), ("done", []))
        self.assertIn("already in another wave", w1["done_reason"])
        self.assertIn("already in another wave", waves.words(out)[1])
        out, _, _, _ = run(pg, guard={})
        self.assertNotIn("w1", out.get("enrolled") or {})

    def test_a_wave_with_nobody_left_to_write_to_is_done_and_its_holdout_starts_its_14_days(self):
        pg = FakePostgrest()
        routes(pg)
        for i in range(30):
            seed(pg, f"n{i:02d}", "no_show_cancelled", days=i + 1)
        wave(pg, "w1", "no_show_cancelled")
        run(pg)
        for f in pg.rows(FOLLOWUPS):
            f.update({"status": "sent", "decided_at": NOW.isoformat()})
        out, _, _, _ = run(pg, now=NOW + timedelta(minutes=5))
        self.assertEqual(out["finished"], ["w1"])
        self.assertEqual(pg.one(WAVES, id="w1")["state"], "done")
        held = members(pg, "w1", arm="holdout")
        self.assertTrue(held and all(m["due_at"] for m in held))
        self.assertIn("1 wave finished", waves.words(out)[1])


class Finding7FailedOpenerNeverRetried(unittest.TestCase):
    def setUp(self):
        self.pg = FakePostgrest()
        routes(self.pg)
        seed(self.pg, "n0", "no_show_cancelled")
        wave(self.pg, "w1", "no_show_cancelled")
        run(self.pg, guard={})
        for m in members(self.pg, "w1"):
            m.update({"arm": "wave", "state": "waiting"})
        run(self.pg)

    def fail_it(self, error):
        f = [f for f in self.pg.rows(FOLLOWUPS) if f["status"] == "draft"][0]
        f.update({"status": "failed", "error": error, "decided_at": NOW.isoformat()})

    def test_a_failed_opener_is_drafted_again_the_next_day_once_then_the_lead_leaves(self):
        self.fail_it("HighLevel did not send it: 503 Service Unavailable")
        run(self.pg, now=NOW + timedelta(minutes=5))
        m = members(self.pg, "w1")[0]
        self.assertEqual((m["state"], m["fail_count"]), ("waiting", 1))
        out, _, _, _ = run(self.pg, now=NOW + timedelta(days=1))
        self.assertEqual(out["drafted"]["drafted"], 1)
        self.assertEqual(len(self.pg.rows(FOLLOWUPS)), 2)
        self.fail_it("HighLevel did not send it: 503 Service Unavailable")
        run(self.pg, now=NOW + timedelta(days=1, minutes=5))
        m = members(self.pg, "w1")[0]
        self.assertEqual((m["state"], m["fail_count"]), ("excluded", 2))
        self.assertIn("The opener failed twice", m["excluded_reason"])

    def test_a_reason_that_will_not_change_takes_the_lead_out_at_once(self):
        self.fail_it("The number is not on WhatsApp.")
        run(self.pg, now=NOW + timedelta(minutes=5))
        m = members(self.pg, "w1")[0]
        self.assertEqual(m["state"], "excluded")
        self.assertIn("not on WhatsApp", m["excluded_reason"])


class Finding8SecondOpenerAfterACrash(unittest.TestCase):
    def test_an_opener_sent_by_hand_before_its_member_was_marked_is_adopted_not_written_again(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=1)
        pg.put(FOLLOWUPS, {"id": "orphan", "contact_id": "n00", "segment": "reactivate", "status": "sent",
                           "channel": "whatsapp_template", "created_at": NOW.isoformat(), "decided_at": NOW.isoformat(),
                           "context": {"wave_id": "w1"}})
        run(pg, now=NOW + timedelta(days=1, hours=1))
        self.assertEqual([f["id"] for f in pg.rows(FOLLOWUPS) if f["contact_id"] == "n00"], ["orphan"])
        run(pg, now=NOW + timedelta(days=1, hours=1, minutes=5))
        self.assertEqual(members(pg, "w1")[0]["state"], "sent")

    def test_a_run_that_dies_between_the_member_and_the_draft_leaves_one_opener_in_the_end(self):
        class DiesOnce(FakePostgrest):
            died = False

            def __call__(self, method, url, **kw):
                if method == "POST" and url.endswith("/rest/v1/cockpit_sales_followups") and not self.died:
                    self.died = True
                    raise KeyboardInterrupt("the VPS rebooted")
                return super().__call__(method, url, **kw)

        pg = DiesOnce()
        enrolled_wave(pg, n=1)
        with self.assertRaises(KeyboardInterrupt):
            run(pg)
        m = members(pg, "w1")[0]
        # The draft is written first (the member's followup_id is a foreign key
        # to it, 20261003c): a run that dies before the draft leaves the member waiting.
        self.assertEqual((m["state"], pg.rows(FOLLOWUPS)), ("waiting", []))
        run(pg, now=NOW + timedelta(minutes=5))  # drafted again, once
        drafts = [f for f in pg.rows(FOLLOWUPS) if f["contact_id"] == "n00"]
        self.assertEqual(len(drafts), 1)
        self.assertEqual(members(pg, "w1")[0]["followup_id"], drafts[0]["id"])


class Finding9StopRowsShadowEachOther(unittest.TestCase):
    def stops(self, pg, contact="a"):
        with mock.patch.object(http, "request", pg):
            return fu.stops_for(sb(), [contact])

    def test_a_reps_pause_is_never_lost_behind_a_newer_stop_word(self):
        pg = FakePostgrest()
        pg.put(fu.STOPS, {"contact_id": "a", "said_at": ago(days=2), "kind": "manual", "state": "paused",
                          "paused_until": (NOW + timedelta(days=40)).isoformat()})
        pg.put(fu.STOPS, {"contact_id": "a", "said_at": ago(days=1), "kind": "pause", "state": "paused",
                          "paused_until": (NOW + timedelta(days=29)).isoformat(), "said": "not interested"})
        rows = self.stops(pg)
        self.assertEqual(len(rows["a"]), 2)
        self.assertEqual(fu.hold_of(rows, "a", NOW)[0], "paused")
        # The lead then writes normally: still held. After the stop word's 30 days, the rep's own pause holds.
        self.assertIsNotNone(fu.hold_of(rows, "a", NOW + timedelta(days=1)))
        self.assertEqual(fu.hold_of(rows, "a", NOW + timedelta(days=35))[0], "manual")
        self.assertIsNone(fu.hold_of(rows, "a", NOW + timedelta(days=41)))

    def test_a_reps_resume_is_never_forgotten_behind_a_later_pause(self):
        pg = FakePostgrest()
        said = ago(days=10)
        pg.put(fu.STOPS, {"contact_id": "a", "said_at": said, "kind": "unsubscribe", "state": "resumed",
                          "said": "stop", "decided_at": ago(days=9)})
        pg.put(fu.STOPS, {"contact_id": "a", "said_at": ago(days=8), "kind": "manual", "state": "paused",
                          "paused_until": ago(days=1)})
        rows = self.stops(pg)
        stop = {"kind": "unsubscribe", "at": fu._ts(said), "text": "stop"}
        self.assertEqual(fu.stop_row_for(rows, "a", stop)["state"], "resumed")
        self.assertIsNone(fu.hold_of(rows, "a", NOW))
        self.assertEqual(fu.new_stop_hold(rows, "a", stop, NOW), (None, False))


class Finding10OpenerMidConversation(unittest.TestCase):
    def test_a_lead_in_a_live_conversation_two_days_old_gets_no_opener(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=1)
        thread = [{"id": "i1", "direction": "inbound", "messageType": "TYPE_WHATSAPP", "dateAdded": ago(days=2),
                   "body": "Can you send me the price for the second package?"},
                  {"id": "o1", "direction": "outbound", "messageType": "TYPE_WHATSAPP", "source": "app",
                   "dateAdded": ago(days=1, hours=2), "body": "Sure, I will call you tomorrow."}]
        out, _, _, _ = run(pg, Ghl(pg, {"n00": {"thread": thread}}))
        self.assertEqual((out["drafted"]["drafted"], pg.rows(FOLLOWUPS)), (0, []))
        self.assertIn("wrote to us lately", members(pg, "w1")[0]["excluded_reason"])

    def test_a_lead_who_wrote_three_weeks_ago_and_not_since_the_wave_began_gets_it(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=1)
        thread = [{"id": "i1", "direction": "inbound", "messageType": "TYPE_WHATSAPP", "dateAdded": ago(days=21),
                   "body": "ok"}]
        out, _, _, _ = run(pg, Ghl(pg, {"n00": {"thread": thread}}))
        self.assertEqual(out["drafted"]["drafted"], 1)


class Finding11GreenRowWhileNothingGoes(unittest.TestCase):
    def test_a_sales_api_fault_stops_the_run_at_once_and_turns_the_row_red(self):
        pg = FakePostgrest()
        for i in range(5):
            due_draft(pg, i, send_after=ago(minutes=10 - i))
        boom = (500, {"ok": False, "error": "That did not work: TypeError: cannot read properties of undefined"})
        out, api = send(pg, Api(pg, Clock(NOW), script=[boom] * 5))
        self.assertEqual((len(api.calls), out["stop_kind"]), (1, "error"))
        ok, line = row_ok(out)
        self.assertFalse(ok)
        self.assertIn("sales-api answered 500", line)
        for script in ([http.HttpError(0, "timed out")], [(404, {"error": "Unknown action followup.send_due"})]):
            out, _ = send(pg, Api(pg, Clock(NOW), script=script))
            self.assertFalse(row_ok(out)[0], script)

    def test_an_earlier_batch_nobody_decided_on_turns_the_row_red_and_says_what_to_do(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=50)
        run(pg)
        out, _, _, _ = run(pg, now=NOW + timedelta(days=1))
        ok, line = waves.words(out)
        self.assertFalse(ok)
        self.assertIn("Approve, hold or skip them on the Follow-ups page", line)

    def test_time_up_or_the_ceiling_reserve_is_no_fault(self):
        for kind in ("time", "ceiling"):
            self.assertTrue(row_ok({"due": 3, "sent": 0, "stopped": "x", "stop_kind": kind})[0])
        self.assertFalse(row_ok({"due": 3, "sent": 0, "stopped": None, "stop_kind": None})[0])


class Finding12FailedAtMetaCountsAsSent(unittest.TestCase):
    class Failing(Api):
        error = "Insufficient funds in the WhatsApp wallet"

        def __call__(self, action, payload):
            self.calls.append((self.clock(), action, payload["id"]))
            f = self.pg.one(FOLLOWUPS, id=payload["id"])
            f.update({"status": "failed", "error": self.error})
            self.pg.put("cockpit_sales_messages", {"id": f"m-{payload['id']}", "sent_by": "sales-desk",
                                                   "created_at": self.clock().isoformat(), "state": "failed"})
            return 200, {"ok": True, "followup": {"id": payload["id"], "status": "failed", "error": self.error},
                         "message": {"state": "failed", "error": self.error}}

    def test_an_empty_wallet_behind_a_200_stops_the_batch_after_one(self):
        pg = FakePostgrest()
        for i in range(6):
            due_draft(pg, i, send_after=ago(minutes=10 - i))
        out, api = send(pg, self.Failing(pg, Clock(NOW)))
        self.assertEqual((len(api.calls), out["sent"], out["stop_kind"]), (1, 0, "hold_all"))
        ok, line = row_ok(out)
        self.assertFalse(ok)
        self.assertNotIn(" sent", line.split("sending stopped")[0])
        self.assertIn("Insufficient funds", line)

    def test_a_lead_meta_fails_counts_as_failed_not_sent_and_three_in_a_row_stop(self):
        pg = FakePostgrest()
        for i in range(6):
            due_draft(pg, i, send_after=ago(minutes=10 - i))
        failing = self.Failing(pg, Clock(NOW))
        failing.error = "Message failed: the recipient is not on WhatsApp"
        out, api = send(pg, failing)
        self.assertEqual((len(api.calls), out["sent"], out["failed"], out["stop_kind"]), (3, 0, 3, "refusals"))
        self.assertIn("3 failed at HighLevel or Meta", row_ok(out)[1])


class Finding13HighLevelOutageBurnsThreePerRun(unittest.TestCase):
    def test_a_highlevel_outage_stops_the_run_after_one_and_the_row_is_red(self):
        pg = FakePostgrest()
        for i in range(12):
            due_draft(pg, i, send_after=ago(minutes=30 - i))

        class Down(Api):
            def __call__(self, action, payload):
                self.calls.append((self.clock(), action, payload["id"]))
                self.pg.one(FOLLOWUPS, id=payload["id"])["status"] = "failed"  # non-fixable 502
                return 502, {"ok": False, "error": "HighLevel did not send it: 503 Service Unavailable"}

        burned = 0
        for run_no in range(3):
            out, api = send(pg, Down(pg, Clock(NOW)), now=NOW + timedelta(minutes=5 * run_no), budget=270)
            burned += len(api.calls)
            self.assertEqual(out["stop_kind"], "outage")
            self.assertFalse(row_ok(out)[0])
        self.assertEqual(burned, 3)  # one a run, and sync drafts each again the next day (Finding7)


class Finding14OneHeldOpenerBlocksEveryWave(unittest.TestCase):
    def test_a_held_opener_from_yesterday_does_not_stop_the_next_batch(self):
        pg = FakePostgrest()
        routes(pg)
        for i in range(60):
            seed(pg, f"n{i:02d}", "no_show_cancelled", days=i + 1)
        wave(pg, "w1", "no_show_cancelled")
        run(pg)
        drafts = pg.rows(FOLLOWUPS)
        for f in drafts[1:]:
            f.update({"status": "sent", "decided_at": NOW.isoformat()})
        pg.one(META, followup_id=drafts[0]["id"])["held_by"] = "setter@x.co"  # the rep held one
        out, _, _, _ = run(pg, now=NOW + timedelta(days=1))
        self.assertGreater(out["drafted"]["drafted"], 0)
        self.assertTrue(waves.words(out)[0])

    def test_an_opener_approved_and_waiting_for_the_leads_hours_does_not_either(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=50)
        run(pg)
        for i, f in enumerate(pg.rows(FOLLOWUPS)):
            if i == 0:
                pg.one(META, followup_id=f["id"])["send_after"] = NOW.isoformat()
            else:
                f.update({"status": "sent", "decided_at": NOW.isoformat()})
        out, _, _, _ = run(pg, now=NOW + timedelta(days=1), guard={**GATE_OPEN, "connector_off": True})
        self.assertGreater(out["drafted"]["drafted"], 0)


class Finding15LaterLeadsStarveTheWave(unittest.TestCase):
    def test_leads_waiting_for_their_template_never_hide_older_ready_ones_nor_are_read_every_run(self):
        pg = FakePostgrest()
        routes(pg, OPENER_AR)  # only the Arabic opener is set up
        for i in range(25):  # the newest 25 write English
            seed(pg, f"e{i:02d}", "no_show_cancelled", days=i + 1, country="United Kingdom")
        for i in range(5):   # five older Arabic leads are ready
            seed(pg, f"a{i}", "no_show_cancelled", days=40 + i)
        wave(pg, "w1", "no_show_cancelled", per_day=5)
        run(pg, guard={})
        for m in members(pg, "w1"):
            m.update({"arm": "wave", "state": "waiting"})
        ghl = Ghl(pg)
        out, _, _, _ = run(pg, ghl)
        self.assertEqual(out["drafted"]["drafted"], 5)
        self.assertEqual({f["contact_id"] for f in pg.rows(FOLLOWUPS)}, {f"a{i}" for i in range(5)})
        self.assertFalse([u for _, u in ghl.asked if "/e" in u.split("contacts/")[-1] or "contactId=e" in u])
        english = [m for m in members(pg, "w1") if m["contact_id"].startswith("e")]
        self.assertTrue(all(fu._ts(m["next_try_at"]) == NOW + timedelta(days=1) for m in english))
        self.assertTrue(all("opener_en template is not set up" in m["later_reason"] for m in english))
        first = len(ghl.asked)
        run(pg, ghl, now=NOW + timedelta(minutes=5))
        self.assertEqual(len(ghl.asked), first)  # nobody is read again five minutes later


class Finding16ModelRowStaleWhenNoProvider(unittest.TestCase):
    def test_the_model_row_turns_false_when_the_provider_cannot_be_made(self):
        from tests import test_doctor as td
        pg = FakePostgrest()
        pg.put("cockpit_sales_worker_status", {"worker": "sales-desk", "job": "model", "ok": True,
                                               "detail": "opus answered"})
        orig = td.env

        def env_openai_no_key(tmp):
            return {**orig(tmp), "SALES_MODEL_PROVIDER": "openai"}

        with mock.patch.object(td, "env", env_openai_no_key), tempfile.TemporaryDirectory() as tmp:
            code, out, _ = td.run_cli(["doctor", "--cron"], td.World(pg), tmp)
        self.assertEqual(code, 1)
        self.assertIn("OPENAI_API_KEY is not set", out)
        model = td.row(pg, "model")
        self.assertFalse(model["ok"])
        self.assertIn("OPENAI_API_KEY is not set", model["detail"])


class Finding17DoctorProbeIsNotGuarded(unittest.TestCase):
    def test_a_proxy_answering_200_with_html_is_one_miss_and_both_rows_are_written(self):
        from tests import test_doctor as td

        class HtmlProxy(td.World):
            def __call__(self, method, url, **kw):
                if "127.0.0.1:3456" in url and url.endswith("/chat/completions"):
                    self.asked.append((method, url))
                    return 200, {}, b"<html><body>502 Bad Gateway</body></html>"
                return super().__call__(method, url, **kw)

        pg = FakePostgrest()
        with tempfile.TemporaryDirectory() as tmp:
            code, _, _ = td.run_cli(["--quiet", "doctor", "--cron"], HtmlProxy(pg), tmp)
        self.assertEqual(code, 0)
        doctor, model = td.row(pg, "doctor"), td.row(pg, "model")
        self.assertTrue(doctor["ok"])
        self.assertIn("not known: model answers", doctor["detail"])
        self.assertTrue(model["ok"])
        self.assertIn("one miss is not an outage", model["detail"])


class Finding18ReplyCandidateSwallowsTheLeadsOtherKinds(unittest.TestCase):
    def test_a_reply_candidate_carries_the_leads_next_kind(self):
        noshow = {"appointment_id": "c1", "contact_id": "q", "call_type": "intro", "status": "noshow",
                  "start_at": ago(hours=1), "booked_at": ago(days=3)}
        inbox = [{"contact_id": "q", "last_direction": "outbound", "last_type": "TYPE_WHATSAPP",
                  "last_message_at": ago(hours=1, minutes=10), "inbound_whatsapp_at": ago(hours=1, minutes=20)}]
        picked = fu.pick(NOW, inbox=inbox, calendar=[noshow], leads=[])
        self.assertEqual([(d["contact_id"], d["segment"]) for d in picked], [("q", "reply")])
        self.assertEqual((picked[0]["then"]["segment"], picked[0]["then"]["appointment_id"]), ("no_show", "c1"))

    def test_a_lead_answered_in_highlevel_a_day_ago_gets_their_new_lead_message(self):
        from tests.test_followups import FakeGhl, NOW as FNOW, settings_on
        at = lambda **kw: (FNOW - timedelta(**kw)).isoformat()  # noqa: E731
        pg = FakePostgrest()
        pg.put("cockpit_sales_leads", {"contact_id": "a", "name": "Omar", "email": "o@x.co", "phone": "+96550000000",
                                       "lead_created_at": at(hours=49), "lead_class": "qualified", "dnd": False,
                                       "country": "Kuwait", "pipeline_name": "Sales Pipeline (2-Call)"})
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv1", "contact_id": "a", "last_direction": "outbound",
                                       "last_type": "TYPE_WHATSAPP", "last_message_at": at(hours=25),
                                       "inbound_whatsapp_at": at(hours=30)})
        thread = [{"id": "i", "direction": "inbound", "messageType": "TYPE_WHATSAPP", "dateAdded": at(hours=30),
                   "body": "Is this still available?"},
                  {"id": "o", "direction": "outbound", "messageType": "TYPE_WHATSAPP", "source": "app",
                   "dateAdded": at(hours=25), "body": "Yes, I will call you."}]
        draft = json.dumps({"body": "Hi Omar, did you get a moment to look?", "subject": "Your enquiry",
                            "why": "New lead."})
        with mock.patch.object(http, "request", FakeGhl(pg, thread=thread)):
            out = fu.run(Supabase("https://example.supabase.co", "k"), FakeProvider([draft]), lambda _m: None,
                         settings=settings_on(), ghl_token="t", now=FNOW)
        self.assertEqual((out["written"], out["already_answered"]), (1, 1))
        self.assertEqual(pg.rows(FOLLOWUPS)[0]["segment"], "new")


# ---------------------------------------------------------------------------
# The findings the reviewer did not pin with a test
# ---------------------------------------------------------------------------

class MembersFollowWhatTheOpenerDid(unittest.TestCase):
    """Finding 12: replied, booked and closed at 14 days, for both arms."""

    def setUp(self):
        self.pg = FakePostgrest()
        routes(self.pg)
        for i in range(40):
            seed(self.pg, f"n{i:02d}", "no_show_cancelled", days=i + 1)
        wave(self.pg, "w1", "no_show_cancelled", per_day=10)
        run(self.pg)
        for f in self.pg.rows(FOLLOWUPS):
            f.update({"status": "sent", "decided_at": NOW.isoformat()})
        run(self.pg, now=NOW + timedelta(minutes=5))

    def test_each_sent_member_ends_replied_booked_or_closed_and_holdout_alike(self):
        pg = self.pg
        sent = members(pg, "w1", state="sent")
        self.assertEqual(len(sent), 10)
        self.assertTrue(all(m["sent_at"] == NOW.isoformat() for m in sent))
        held = [m for m in members(pg, "w1", arm="holdout") if m.get("due_at")]
        self.assertTrue(held, "the holdout level with the first batch starts its 14 days with it")
        a, b = sent[0]["contact_id"], sent[1]["contact_id"]
        h = held[0]["contact_id"]
        pg.put("cockpit_sales_inbox", {"conversation_id": "c-a", "contact_id": a, "last_direction": "inbound",
                                       "last_message_at": (NOW + timedelta(hours=2)).isoformat()})
        pg.put("cockpit_sales_calendar", {"appointment_id": "rb", "contact_id": b, "call_type": "intro",
                                          "status": "confirmed", "start_at": (NOW + timedelta(days=5)).isoformat(),
                                          "booked_at": (NOW + timedelta(days=1)).isoformat()})
        pg.put("cockpit_sales_calendar", {"appointment_id": "rh", "contact_id": h, "call_type": "intro",
                                          "status": "confirmed", "start_at": (NOW + timedelta(days=6)).isoformat(),
                                          "booked_at": (NOW + timedelta(days=2)).isoformat()})
        out, _, _, _ = run(pg, now=NOW + timedelta(days=3))
        state = {m["contact_id"]: m for m in members(pg, "w1")}
        self.assertEqual((state[a]["state"], state[b]["state"], state[h]["state"]), ("replied", "booked", "booked"))
        self.assertEqual(out["outcomes"], {"replied": 1, "booked": 2, "closed": 0})
        run(pg, now=NOW + timedelta(days=14, minutes=1))
        state = {m["contact_id"]: m for m in members(pg, "w1")}
        self.assertEqual((state[a]["state"], state[b]["state"]), ("closed", "booked"))
        self.assertTrue(all(m["state"] != "sent" for m in members(pg, "w1")))

    def test_a_lead_sent_an_opener_is_kept_from_another_wave_for_30_days(self):
        pg = self.pg
        wave(pg, "w2", "no_show_cancelled", started_at=ago(hours=1))
        pg.one(WAVES, id="w1")["state"] = "done"
        run(pg, now=NOW + timedelta(days=2), guard={})
        sent = {m["contact_id"] for m in members(pg, "w1") if m.get("sent_at")}
        self.assertFalse(sent & {m["contact_id"] for m in members(pg, "w2")})


class ADialKeepsANewLeadOutForADay(unittest.TestCase):
    """Finding 19: spec P3 §3.2, "a completed dial excludes a lead for 24 h only"."""

    def run_with_dial(self, hours_ago):
        from tests.test_followups import NOW as FNOW, run_it
        pg = FakePostgrest()
        pg.put("cockpit_sales_leads", {"contact_id": "a", "name": "Omar", "email": "o@x.co", "phone": "+96550000000",
                                       "lead_created_at": (FNOW - timedelta(days=3)).isoformat(), "lead_class": "qualified",
                                       "dnd": False, "country": "Kuwait", "pipeline_name": "Sales Pipeline (2-Call)"})
        pg.put("cockpit_sales_dials", {"call_id": "d1", "contact_id": "a", "state": "completed",
                                       "occurred_at": (FNOW - timedelta(hours=hours_ago)).isoformat()})
        draft = json.dumps({"body": "Hi Omar, a quick follow-up.", "subject": "Your enquiry", "why": "New lead."})
        out, _ = run_it(pg, provider=FakeProvider([draft]))
        return out

    def test_a_dial_two_hours_ago_holds_the_lead_and_one_two_days_ago_does_not(self):
        self.assertEqual(self.run_with_dial(2)["picked"], 0)
        self.assertEqual(self.run_with_dial(48)["written"], 1)


class PoolsAsTheSpecCountsThem(unittest.TestCase):
    """Finding 22: a held call waits a day; unclosed demos are on the demo calendars."""

    L = {"contact_id": "x", "tags": ["roas-qualified"], "lead_created_at": ago(days=50)}

    def pool(self, *calls):
        p = waves.pool_of(self.L, fu.with_kinds(list(calls)), False, NOW)
        return p[0] if p else None

    def call(self, kind, status, hours, cal=None):
        return {"appointment_id": f"{kind}{hours}", "contact_id": "x", "call_type": kind, "status": status,
                "calendar_id": cal, "start_at": ago(hours=hours)}

    def test_a_held_intro_counts_a_day_on_and_a_demo_only_on_a_demo_calendar(self):
        self.assertIsNone(self.pool(self.call("intro", "confirmed", 5, "dsqmJ393Dwl9fDSbIVOI")))
        self.assertEqual(self.pool(self.call("intro", "confirmed", 25, "dsqmJ393Dwl9fDSbIVOI")), "good_intro")
        self.assertIsNone(self.pool(self.call("demo", "showed", 48, "some-other-calendar")))
        self.assertEqual(self.pool(self.call("demo", "showed", 48, DEMO_CAL)), "unclosed_demo")
        self.assertEqual(self.pool(self.call(None, "showed", 48, "NDBNz6Og4yfpdpWmHrue")), "unclosed_demo")
        self.assertIsNone(self.pool(self.call("demo", "confirmed", 3, DEMO_CAL)))
        # A demo calendar the cockpit's setting names counts too.
        cals = waves.demo_calendars({"cal-x": {"type": "demo"}})
        p = waves.pool_of(self.L, [self.call("demo", "showed", 48, "cal-x")], False, NOW, cals)
        self.assertEqual(p[0], "unclosed_demo")


class TheNameTheLeadReceives(unittest.TestCase):
    """Finding 23: the draft greets with the first word of HighLevel's first name, as sendTemplate fills it."""

    def test_a_hyphenated_name_stays_whole(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=1)
        run(pg, Ghl(pg, {"n00": {"firstName": "Abdul-Rahman Saleh"}}))
        self.assertEqual(pg.rows(FOLLOWUPS)[0]["body"], "السلام عليكم Abdul-Rahman، معاك فريق المبيعات. كيف حالك؟")
        self.assertIsNone(waves.first_name({"name": "Al Noor Trading Est"}, {"firstName": "Noor"}))
        self.assertIsNone(waves.first_name({"name": "Omar"}, {"firstName": "Omar123"}))


class TheFakeKeepsTheDatabasesRules(unittest.TestCase):
    """Finding 24: the indexes and the check the desk leans on, kept by the fake; two runs truly at once."""

    def test_one_open_draft_the_segment_check_and_one_open_membership(self):
        pg = FakePostgrest()
        with mock.patch.object(http, "request", pg):
            s = sb()
            s.rest("POST", FOLLOWUPS, json_body=[{"id": "d1", "contact_id": "a", "segment": "new", "status": "draft"}])
            with self.assertRaises(http.HttpError) as e:
                s.rest("POST", FOLLOWUPS, json_body=[{"id": "d2", "contact_id": "a", "segment": "new", "status": "draft"}])
            self.assertEqual(e.exception.status, 409)
            with self.assertRaises(http.HttpError) as e:
                s.rest("POST", FOLLOWUPS, json_body=[{"id": "d3", "contact_id": "b", "segment": "bogus", "status": "draft"}])
            self.assertIn("23514", str(e.exception))
            s.rest("POST", MEMBERS, json_body=[{"wave_id": "w0", "contact_id": "a", "state": "held_out"}])
            with self.assertRaises(http.HttpError):
                s.rest("POST", MEMBERS, json_body=[{"wave_id": "w1", "contact_id": "a", "state": "waiting"}])
            s.rest("POST", MEMBERS, json_body=[{"wave_id": "w1", "contact_id": "a", "state": "excluded"}])

    def test_two_send_runs_interleaved_never_send_a_draft_twice_and_keep_the_gap(self):
        pg = FakePostgrest()
        for i in range(6):
            due_draft(pg, i, send_after=ago(minutes=10 - i))
        clock = Clock(NOW)
        api = Api(pg, clock)
        inner: list = []

        def sleep(s):
            clock.sleep(s)
            if not inner:  # a second run (a manual one, outside flock) starts while the first waits
                inner.append(waves.send_due(sb(), api, settings=SETTINGS, w=waves.settings_of(SETTINGS),
                                            waves=[{"id": "w1", "state": "running"}], guard=GATE_OPEN, clock=clock,
                                            sleep=clock.sleep, budget_s=100, log=lambda _m: None,
                                            warn=lambda _m: None))

        with mock.patch.object(http, "request", pg):
            outer = waves.send_due(sb(), api, settings=SETTINGS, w=waves.settings_of(SETTINGS),
                                   waves=[{"id": "w1", "state": "running"}], guard=GATE_OPEN, clock=clock, sleep=sleep,
                                   budget_s=1000, log=lambda _m: None, warn=lambda _m: None)
        ids = [i for _, _, i in api.calls]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(sorted(ids), [f"f{i:03d}" for i in range(6)])
        times = sorted(t for t, _, _ in api.calls)
        self.assertTrue(all((b - a).total_seconds() >= 45 for a, b in zip(times, times[1:])), times)
        self.assertGreater(outer["sent"], 0)
        self.assertGreater(inner[0]["sent"], 0)


class TheDatabaseRefusesTheKind(unittest.TestCase):
    """Finding 25: before migration 20261003b, the segment check refuses every opener: said plainly, in red."""

    def test_the_refusal_is_said_and_the_member_waits(self):
        pg = FakePostgrest()
        pg.segments = tuple(s for s in pg.segments if s != "reactivate")
        enrolled_wave(pg, n=3)
        out, _, _, _ = run(pg)
        self.assertIn("migration 20261003b", out["drafted"]["waiting"])
        self.assertFalse(waves.words(out)[0])
        self.assertEqual({m["state"] for m in members(pg, "w1")}, {"waiting"})
        self.assertEqual(pg.rows(FOLLOWUPS), [])

    def test_the_doctor_says_whether_the_kind_is_known(self):
        from tests import test_doctor as td
        pg = FakePostgrest()
        with tempfile.TemporaryDirectory() as tmp:
            _, out, _ = td.run_cli(["doctor", "--cron"], td.World(pg), tmp)
        self.assertIn("reactivate kind    not known yet: no opener has been written", out)


class AnOutageIsNeverBusy(unittest.TestCase):
    """Finding 26: only a 409 falls back to single inserts; anything else stops the job and is said."""

    def test_a_database_error_on_enrolment_is_raised_not_counted_as_busy(self):
        class Down(FakePostgrest):
            def __call__(self, method, url, **kw):
                if method == "POST" and MEMBERS in url:
                    raise http.HttpError(500, '{"message":"canceling statement due to statement timeout"}', b"", url)
                return super().__call__(method, url, **kw)

        pg = Down()
        for i in range(3):
            seed(pg, f"n{i}", "no_show_cancelled")
        wave(pg, "w1", "no_show_cancelled")
        with self.assertRaises(http.HttpError):
            run(pg, guard={})
        self.assertIsNone(pg.one(WAVES, id="w1").get("enrolled_at"))


class TheMonthsTemplateBudget(unittest.TestCase):
    """Finding 27: whatsapp_guard.template_budget_usd_month holds every template once spent."""

    def spend(self, pg, n):
        for i in range(n):
            pg.put("cockpit_sales_messages", {"id": f"t{i:05d}", "via": "workflow", "sent_by": "someone",
                                              "created_at": ago(days=1, seconds=i)})

    def test_a_spent_budget_stops_templates_and_email_still_goes(self):
        pg = FakePostgrest()
        self.spend(pg, 1262)  # $100 at $0.0792 a template: the next one would pass it
        due_draft(pg, 0)
        due_draft(pg, 1, channel="email")
        out, api = send(pg, guard={**GATE_OPEN, "template_budget_usd_month": 100})
        self.assertEqual(([i for _, _, i in api.calls], out["stop_kind"]), ([], "budget"))
        self.assertIn("template budget is spent", out["stopped"])
        self.assertFalse(row_ok(out)[0])
        pg2 = FakePostgrest()
        self.spend(pg2, 1261)
        due_draft(pg2, 0)
        out, api = send(pg2)
        self.assertEqual(out["sent"], 1)

    def test_the_spend_counts_this_month_only_and_a_rate_can_be_given(self):
        pg = FakePostgrest()
        self.spend(pg, 30)
        self.assertIsNone(waves.template_budget(sb_with(pg), {"template_budget_usd_month": 3}, NOW))
        self.assertIn("about $3 of $3", waves.template_budget(sb_with(pg), {"template_budget_usd_month": 3,
                                                                             "template_rate_usd": 0.1}, NOW))
        old = FakePostgrest()
        for i in range(50):
            old.put("cockpit_sales_messages", {"id": f"o{i}", "via": "workflow", "created_at": ago(days=10)})
        self.assertIsNone(waves.template_budget(sb_with(old), {"template_budget_usd_month": 1}, NOW))


def sb_with(pg):
    class Bound:
        def __init__(self):
            self.s = sb()

        def select(self, table, params):
            with mock.patch.object(http, "request", pg):
                return self.s.select(table, params)
    return Bound()


class TheVerdicts(unittest.TestCase):
    def test_each_answer_is_read_one_way(self):
        cases = [
            ((200, {"followup": {"status": "sent"}}), "sent"),
            ((409, {"error": "Today's 250 WhatsApp templates have gone out."}), "hold_all"),
            ((409, {"error": "x", "hold_all": True}), "hold_all"),
            ((429, {"error": "That is 30 messages in ten minutes from you."}), "hold_all"),
            ((409, {"error": "The follow-up agent is switched off."}), "hold_all"),
            ((502, {"error": "HighLevel did not send it: 503"}), "outage"),
            ((500, {"error": "TypeError"}), "error"),
            ((404, {"error": "Unknown action"}), "error"),
            ((409, {"error": "A first message goes between 9 and 6, their time."}), "hours"),
            ((200, {"followup": {"status": "failed"}, "message": {"state": "failed", "error": "not on WhatsApp"}}),
             "failed"),
            ((200, {"followup": {"status": "failed"}, "message": {"state": "failed", "error": "Insufficient funds"}}),
             "hold_all"),
            ((409, {"error": "Someone else has just dealt with this draft."}), "lead"),
        ]
        for (status, res), want in cases:
            self.assertEqual(waves.judge(status, res)[0], want, res)


class LaterStepsKeepTheirOwnHours(unittest.TestCase):
    def test_at_seven_in_the_evening_an_opener_waits_and_a_second_step_goes(self):
        pg = FakePostgrest()
        due_draft(pg, 0)
        pg.put(FOLLOWUPS, {"id": "s2", "contact_id": "p000x", "segment": "no_show", "channel": "whatsapp_template",
                           "status": "draft", "touch": 2, "created_at": ago(hours=1)})
        pg.put("cockpit_sales_leads", {"contact_id": "p000x", "country": "Kuwait"})
        pg.put(META, {"followup_id": "s2", "send_after": ago(minutes=1), "held_by": None, "wave_id": None})
        evening = datetime(2026, 10, 4, 16, 0, tzinfo=timezone.utc)  # 19:00 Kuwait
        out, api = send(pg, now=evening)
        self.assertEqual(([i for _, _, i in api.calls], out["outside_hours"]), (["s2"], 1))


class EveryRowLeadsSomewhere(unittest.TestCase):
    def test_the_waves_row_is_red_with_the_switch_off_and_green_with_nothing_running(self):
        self.assertEqual(waves.words({"waves": [], "sent": {}}), (True, "No wave is running"))
        ok, line = waves.words({"waves": [{"state": "running"}, {"state": "running"}],
                                "skipped": "The follow-up agent is switched off (followups.enabled), so no wave drafts "
                                           "or sends"})
        self.assertEqual((ok, line.endswith("2 waves wait")), (False, True))


if __name__ == "__main__":
    unittest.main()
