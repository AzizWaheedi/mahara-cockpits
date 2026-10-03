"""Adversarial tests for the desk lane (review pass, 2026-10-03). Each test
here demonstrates a defect: it asserts the BROKEN behaviour the code shows
today, so it passes now and should be flipped (or deleted) once the matching
finding is fixed. Every lead, name and line is invented.

    python3 -m unittest tests.test_waves_breakit
"""
from __future__ import annotations

import json
import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http, waves  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import (GATE_OPEN, NOW, SETTINGS, Api, Clock, Ghl, ago, members, routes, run, sb,  # noqa: E402
                              seed, wave)

META = waves.META
MEMBERS = waves.MEMBERS


def due_draft(pg, i, *, wid="w1", send_after=None, country="Kuwait", status="draft"):
    c = f"p{i:03d}"
    pg.put("cockpit_sales_leads", {"contact_id": c, "country": country, "tags": ["roas-qualified"]})
    pg.put("cockpit_sales_followups", {"id": f"f{i:03d}", "contact_id": c, "segment": "reactivate",
                                       "channel": "whatsapp_template", "status": status, "touch": 1,
                                       "created_at": ago(hours=1)})
    pg.put(META, {"followup_id": f"f{i:03d}", "send_after": send_after or ago(minutes=5), "held_by": None,
                  "wave_id": wid})


def send(pg, api=None, *, waves_=None, budget=1000.0, now=NOW, settings=None):
    clock = Clock(now)
    api = api or Api(pg, clock)
    api.clock = clock
    with mock.patch.object(http, "request", pg):
        out = waves.send_due(sb(), api, settings=settings or SETTINGS, w=waves.settings_of(settings or SETTINGS),
                             waves=waves_ if waves_ is not None else [{"id": "w1", "state": "running"}],
                             guard=GATE_OPEN, clock=clock, sleep=clock.sleep, budget_s=budget,
                             log=lambda _m: None, warn=lambda _m: None)
    return out, api


class OneRunningWavePerContact(FakePostgrest):
    """The NOTES' partial unique index: one member row per contact while its
    state is waiting, held_out or drafted, whatever the wave's own state."""

    member_posts = 0

    def __call__(self, method, url, **kw):
        if method == "POST" and MEMBERS in url:
            self.member_posts += 1
            body = json.loads(kw["data"].decode()) if kw.get("data") else kw.get("json_body")
            for r in body if isinstance(body, list) else [body]:
                if r.get("state") in ("waiting", "held_out", "drafted"):
                    for m in self.rows(MEMBERS):
                        if m["contact_id"] == r["contact_id"] and m["state"] in ("waiting", "held_out", "drafted") \
                                and m["wave_id"] != r["wave_id"]:
                            raise http.HttpError(409, '{"code":"23505","message":"one running wave per contact"}',
                                                 b"", url)
        return super().__call__(method, url, **kw)


class Finding1MetaStarvation(unittest.TestCase):
    def test_two_hundred_old_meta_rows_starve_every_new_approved_draft(self):
        pg = FakePostgrest()
        # Five working days of openers already sent: their meta rows keep send_after.
        for i in range(200):
            due_draft(pg, i, send_after=ago(days=5, seconds=-i), status="sent")
        # Today's approved batch.
        for i in range(200, 205):
            due_draft(pg, i, send_after=ago(minutes=5))
        out, api = send(pg)
        self.assertEqual(api.calls, [])            # nothing is sent ...
        self.assertEqual(out["due"], 0)            # ... and the run reports nothing due
        self.assertEqual(waves.words({"waves": [{"state": "running"}], "sent": out})[0], True)  # status row green


class Finding2StoppedWaveStillSends(unittest.TestCase):
    def test_a_wave_a_manager_stopped_keeps_sending_its_approved_drafts(self):
        pg = FakePostgrest()
        wave(pg, "w1", "no_show_cancelled", state="done")  # followup.wave op=stop sets done
        for i in range(3):
            due_draft(pg, i)
        out, api, _, _ = run(pg)
        self.assertEqual(out["waves"], [])        # _waves() does not return a done wave
        self.assertGreater(len(api.calls), 0)     # yet its approved openers go out
        self.assertGreater(out["sent"]["sent"], 0)


class Finding3HeadOfLineBlocking(unittest.TestCase):
    def test_three_per_lead_refusals_at_the_front_block_the_whole_batch_every_run(self):
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

        for run_no in range(4):  # twenty minutes of the five-minute cron
            out, api = send(pg, Refuses(pg, Clock(NOW)), now=NOW + timedelta(minutes=5 * run_no), budget=270)
            self.assertEqual([i for _, _, i in api.calls], ["f000", "f001", "f002"])
            self.assertIn("Three sends in a row were refused", out["stopped"])
        self.assertEqual({f["status"] for f in pg.rows("cockpit_sales_followups") if f["id"] not in refused}, {"draft"})
        # and the status row stays ok
        self.assertTrue(waves.words({"waves": [{"state": "running"}], "sent": out})[0])


class Finding4KillSwitchIgnored(unittest.TestCase):
    def test_followups_enabled_false_does_not_stop_waves_drafting_or_sending(self):
        pg = FakePostgrest()
        routes(pg)
        for i in range(5):
            seed(pg, f"n{i}", "no_show_cancelled", days=i + 1)
        wave(pg, "w1", "no_show_cancelled")
        off = {**SETTINGS, "enabled": False}
        run(pg, settings=off, guard={})  # enrol
        for m in members(pg, "w1"):
            m.update({"arm": "wave", "state": "waiting"})
        out, _, _, _ = run(pg, settings=off)
        self.assertEqual(out["drafted"]["drafted"], 5)  # drafted with the agent switched off
        for i, f in enumerate(pg.rows("cockpit_sales_followups")):
            pg.one(META, followup_id=f["id"])["send_after"] = ago(minutes=5 - i)
        out, api, _, _ = run(pg, settings=off, now=NOW + timedelta(minutes=5))
        self.assertGreater(out["sent"]["sent"], 0)    # and sent


class Finding5PartialEnrolment(unittest.TestCase):
    def test_a_run_killed_after_the_first_chunk_never_enrols_the_rest(self):
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
        out, _, _, _ = run(pg, guard={})
        self.assertEqual(out["enrolled"], {})          # never tried again
        self.assertEqual(len(members(pg, "w1")), 200)  # 250 leads of the pool are lost to the wave


class Finding6StoppedWaveMembersBlockForever(unittest.TestCase):
    def test_waiting_members_of_a_stopped_wave_keep_every_later_wave_from_them(self):
        pg = OneRunningWavePerContact()
        for i in range(6):
            seed(pg, f"n{i}", "no_show_cancelled", days=i + 1)
        wave(pg, "w0", "no_show_cancelled")
        run(pg, guard={})
        self.assertEqual(len(members(pg, "w0")), 6)
        pg.one("cockpit_sales_followup_waves", id="w0")["state"] = "done"  # a manager stopped it
        wave(pg, "w1", "no_show_cancelled")  # and started the pool again
        out, _, _, _ = run(pg, guard={})
        self.assertEqual(members(pg, "w1"), [])
        self.assertEqual(out["enrolled"]["w1"]["enrolled"], 0)
        # Nobody went in, so every five minutes the whole pool is tried again, one insert per lead.
        pg.member_posts = 0
        out, _, _, _ = run(pg, guard={})
        self.assertIn("w1", out["enrolled"])
        self.assertGreaterEqual(pg.member_posts, 7)  # one chunk, then one insert per lead
        self.assertEqual(pg.one("cockpit_sales_followup_waves", id="w1")["state"], "running")


class Finding7FailedOpenerNeverRetried(unittest.TestCase):
    def test_a_member_whose_opener_failed_once_never_gets_another(self):
        pg = FakePostgrest()
        routes(pg)
        seed(pg, "n0", "no_show_cancelled")
        wave(pg, "w1", "no_show_cancelled")
        run(pg, guard={})
        for m in members(pg, "w1"):
            m.update({"arm": "wave", "state": "waiting"})
        run(pg)
        f = pg.rows("cockpit_sales_followups")[0]
        f["status"] = "failed"  # e.g. HighLevel 5xx or an empty wallet for one send
        f["error"] = "HighLevel did not send it: insufficient funds"
        out, _, _, _ = run(pg, now=NOW + timedelta(days=1))
        self.assertEqual(members(pg, "w1")[0]["state"], "failed")
        self.assertEqual(out["drafted"].get("drafted", 0), 0)
        self.assertEqual(len(pg.rows("cockpit_sales_followups")), 1)


class Finding8SecondOpenerAfterACrash(unittest.TestCase):
    def test_a_draft_written_but_not_marked_then_sent_by_hand_is_drafted_again(self):
        pg = FakePostgrest()
        routes(pg)
        seed(pg, "n0", "no_show_cancelled")
        wave(pg, "w1", "no_show_cancelled")
        run(pg, guard={})
        for m in members(pg, "w1"):
            m.update({"arm": "wave", "state": "waiting"})
        # A run wrote the opener and died before it marked the member drafted.
        pg.put("cockpit_sales_followups", {"id": "orphan", "contact_id": "n0", "segment": "reactivate",
                                           "status": "sent", "channel": "whatsapp_template",
                                           "created_at": NOW.isoformat(), "context": {"wave_id": "w1"}})
        # A rep approved it from the Follow-ups page before the next run; HighLevel's
        # workflow sent the template.
        sent_at = NOW + timedelta(minutes=2)
        ghl = Ghl(pg, {"n0": {"thread": [{"id": "t1", "direction": "outbound", "messageType": "TYPE_WHATSAPP",
                                          "source": "workflow", "dateAdded": sent_at.isoformat(),
                                          "body": "السلام عليكم Omar، معاك سارة. كيف حالك؟"}]}})
        run(pg, ghl, now=NOW + timedelta(days=1, hours=1))
        openers = [f for f in pg.rows("cockpit_sales_followups") if f["contact_id"] == "n0"]
        self.assertEqual(len(openers), 2)  # the lead is lined up for the same opener twice


class Finding9StopRowsShadowEachOther(unittest.TestCase):
    def stops(self, pg, contact="a"):
        with mock.patch.object(http, "request", pg):
            return fu.stops_for(sb(), [contact])

    def test_a_reps_manual_pause_is_lost_behind_a_newer_lead_stop_row(self):
        pg = FakePostgrest()
        pg.put(fu.STOPS, {"contact_id": "a", "said_at": ago(days=2), "kind": "manual", "state": "paused",
                          "paused_until": (NOW + timedelta(days=20)).isoformat()})
        pg.put(fu.STOPS, {"contact_id": "a", "said_at": ago(days=1), "kind": "pause", "state": "paused",
                          "paused_until": (NOW + timedelta(days=29)).isoformat(), "said": "not interested"})
        rows = self.stops(pg)
        self.assertIsNone(fu.manual_hold(rows, "a", NOW))  # the rep's pause until day 20 is not seen
        # The lead then writes normally: their pause lifts, and so (wrongly) does the rep's.
        later = [{"from": "lead", "at": ago(hours=1), "text": "ok tell me more"}]
        self.assertIsNone(fu.stop_of(later))

    def test_a_reps_resume_is_forgotten_once_a_later_manual_pause_ends(self):
        pg = FakePostgrest()
        said = ago(days=10)
        pg.put(fu.STOPS, {"contact_id": "a", "said_at": said, "kind": "unsubscribe", "state": "resumed",
                          "said": "stop"})
        pg.put(fu.STOPS, {"contact_id": "a", "said_at": ago(days=8), "kind": "manual", "state": "paused",
                          "paused_until": ago(days=1)})
        rows = self.stops(pg)
        stop = {"kind": "unsubscribe", "at": fu._ts(said), "text": "stop"}
        row = fu.stop_row_for(rows, "a", stop)
        self.assertIsNone(row)  # the resumed row is shadowed by the newer manual one
        self.assertEqual(fu.stop_hold(stop, row, NOW), "asked to stop; a rep confirms it before anything else goes")


class Finding10OpenerMidConversation(unittest.TestCase):
    def test_a_lead_in_a_live_conversation_two_days_old_gets_how_are_you(self):
        pg = FakePostgrest()
        routes(pg)
        seed(pg, "n0", "no_show_cancelled")
        wave(pg, "w1", "no_show_cancelled")
        run(pg, guard={})
        for m in members(pg, "w1"):
            m.update({"arm": "wave", "state": "waiting"})
        thread = [{"id": "i1", "direction": "inbound", "messageType": "TYPE_WHATSAPP", "dateAdded": ago(days=2),
                   "body": "Can you send me the price for the second package?"},
                  {"id": "o1", "direction": "outbound", "messageType": "TYPE_WHATSAPP", "source": "app",
                   "dateAdded": ago(days=1, hours=2), "body": "Sure, I will call you tomorrow."}]
        out, _, _, _ = run(pg, Ghl(pg, {"n0": {"thread": thread}}))
        self.assertEqual(out["drafted"]["drafted"], 1)
        self.assertEqual(pg.rows("cockpit_sales_followups")[0]["body"],
                         "Hi Omar, it's the sales team from Mahara Media. How are you?")


class Finding11GreenRowWhileNothingGoes(unittest.TestCase):
    def test_every_send_failing_at_sales_api_leaves_the_waves_row_ok(self):
        pg = FakePostgrest()
        for i in range(5):
            due_draft(pg, i, send_after=ago(minutes=10 - i))
        boom = (500, {"ok": False, "error": "That did not work: TypeError: cannot read properties of undefined"})
        out, api = send(pg, Api(pg, Clock(NOW), script=[boom] * 5))
        self.assertIn("Three sends in a row were refused", out["stopped"])
        ok, words = waves.words({"waves": [{"state": "running"}], "sent": out})
        self.assertTrue(ok)
        out, api = send(pg, Api(pg, Clock(NOW), script=[http.HttpError(0, "timed out")]))
        self.assertTrue(waves.words({"waves": [{"state": "running"}], "sent": out})[0])


class Finding12FailedAtMetaCountsAsSent(unittest.TestCase):
    def test_a_200_whose_followup_failed_at_meta_is_counted_sent_and_the_batch_runs_on(self):
        pg = FakePostgrest()
        for i in range(6):
            due_draft(pg, i, send_after=ago(minutes=10 - i))

        class WalletEmpty(Api):
            def __call__(self, action, payload):
                self.calls.append((self.clock(), action, payload["id"]))
                f = self.pg.one("cockpit_sales_followups", id=payload["id"])
                f["status"] = "failed"  # sendFollowup: m.state failed -> followup failed, HTTP 200
                f["error"] = "Insufficient funds in the WhatsApp wallet"
                self.pg.put("cockpit_sales_messages", {"id": f"m-{payload['id']}", "sent_by": "sales-desk",
                                                       "created_at": self.clock().isoformat(), "state": "failed"})
                return 200, {"ok": True, "followup": {"id": payload["id"], "status": "failed",
                                                      "error": "Insufficient funds in the WhatsApp wallet"},
                             "message": {"state": "failed", "error": "Insufficient funds in the WhatsApp wallet"}}

        out, api = send(pg, WalletEmpty(pg, Clock(NOW)), budget=1000)
        self.assertEqual(len(api.calls), 6)      # every opener in the batch burned
        self.assertEqual(out["sent"], 6)         # and each one counted as sent
        self.assertIsNone(out["stopped"])
        self.assertIn("6 sent", waves.words({"waves": [{"state": "running"}], "sent": out})[1])


class Finding13HighLevelOutageBurnsThreePerRun(unittest.TestCase):
    def test_a_502_is_a_per_lead_refusal_so_each_run_fails_three_more_drafts_for_good(self):
        pg = FakePostgrest()
        for i in range(12):
            due_draft(pg, i, send_after=ago(minutes=30 - i))

        class Down(Api):
            def __call__(self, action, payload):
                self.calls.append((self.clock(), action, payload["id"]))
                self.pg.one("cockpit_sales_followups", id=payload["id"])["status"] = "failed"  # non-fixable 502
                return 502, {"ok": False, "error": "HighLevel did not send it: 503 Service Unavailable"}

        burned = 0
        for run_no in range(3):
            out, api = send(pg, Down(pg, Clock(NOW)), now=NOW + timedelta(minutes=5 * run_no), budget=270)
            burned += len(api.calls)
            self.assertIn("Three sends in a row were refused", out["stopped"])
        self.assertEqual(burned, 9)
        self.assertEqual(sum(1 for f in pg.rows("cockpit_sales_followups") if f["status"] == "failed"), 9)


class Finding14OneHeldOpenerBlocksEveryWave(unittest.TestCase):
    def test_a_single_held_opener_from_yesterday_stops_every_new_batch(self):
        pg = FakePostgrest()
        routes(pg)
        for i in range(60):
            seed(pg, f"n{i:02d}", "no_show_cancelled", days=i + 1)
        wave(pg, "w1", "no_show_cancelled")
        run(pg)
        drafts = pg.rows("cockpit_sales_followups")
        for f in drafts[1:]:
            f["status"] = "sent"
        pg.one(META, followup_id=drafts[0]["id"])["held_by"] = "setter@x.co"  # the rep held one
        out, _, _, _ = run(pg, now=NOW + timedelta(days=1))
        self.assertIn("still wait for approval", out["drafted"]["waiting"])
        self.assertEqual(out["drafted"]["drafted"], 0)
        self.assertTrue(waves.words(out)[0])  # and the row stays green


class Finding15LaterLeadsStarveTheWave(unittest.TestCase):
    def test_newest_leads_that_wait_for_another_day_hide_older_ones_and_are_read_again_every_run(self):
        pg = FakePostgrest()
        routes(pg, __import__("tests.test_waves", fromlist=["OPENER_AR"]).OPENER_AR)  # only the Arabic opener is set up
        for i in range(25):  # the newest 25 write English: no route, "later"
            seed(pg, f"e{i:02d}", "no_show_cancelled", days=i + 1, country="United Kingdom")
        for i in range(5):   # five older Arabic leads are ready
            seed(pg, f"a{i}", "no_show_cancelled", days=40 + i)
        wave(pg, "w1", "no_show_cancelled", per_day=5)
        run(pg, guard={})
        for m in members(pg, "w1"):
            m.update({"arm": "wave", "state": "waiting"})
        ghl = Ghl(pg)
        out, _, _, _ = run(pg, ghl)
        self.assertEqual(out["drafted"]["drafted"], 0)
        self.assertEqual(out["drafted"]["later"], 20)  # limit = per_day x 4
        first = len(ghl.asked)
        run(pg, ghl, now=NOW + timedelta(minutes=5))
        self.assertEqual(len(ghl.asked) - first, first)  # the same 20 leads read again five minutes later
        self.assertEqual([f for f in pg.rows("cockpit_sales_followups")], [])


class Finding16ModelRowStaleWhenNoProvider(unittest.TestCase):
    def test_the_model_row_stays_green_when_the_provider_cannot_even_be_made(self):
        import tempfile
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
        self.assertEqual((td.row(pg, "model")["ok"], td.row(pg, "model")["detail"]), (True, "opus answered"))


class Finding17DoctorProbeIsNotGuarded(unittest.TestCase):
    def test_a_proxy_answering_200_with_html_kills_the_hourly_doctor_and_no_row_is_written(self):
        import tempfile
        from tests import test_doctor as td

        class HtmlProxy(td.World):
            def __call__(self, method, url, **kw):
                if "127.0.0.1:3456" in url and url.endswith("/chat/completions"):
                    self.asked.append((method, url))
                    return 200, {}, b"<html><body>502 Bad Gateway</body></html>"
                return super().__call__(method, url, **kw)

        pg = FakePostgrest()
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                td.run_cli(["--quiet", "doctor", "--cron"], HtmlProxy(pg), tmp)
        self.assertIsNone(td.row(pg, "doctor"))
        self.assertIsNone(td.row(pg, "model"))


class Finding18ReplyCandidateSwallowsTheLeadsOtherKinds(unittest.TestCase):
    def test_a_no_show_who_wrote_and_was_answered_in_highlevel_gets_no_no_show_message_for_two_days(self):
        noshow = {"appointment_id": "c1", "contact_id": "q", "call_type": "intro", "status": "noshow",
                  "start_at": ago(hours=1), "booked_at": ago(days=3)}
        # They wrote "stuck in traffic" before the call; a rep answered from the HighLevel app.
        inbox = [{"contact_id": "q", "last_direction": "outbound", "last_type": "TYPE_WHATSAPP",
                  "last_message_at": ago(hours=1, minutes=10), "inbound_whatsapp_at": ago(hours=1, minutes=20)}]
        picked = fu.pick(NOW, inbox=inbox, calendar=[noshow], leads=[])
        self.assertEqual([(d["contact_id"], d["segment"]) for d in picked], [("q", "reply")])
        # The run then reads the thread, finds the rep's answer, writes nothing; the no-show step is lost
        # until 48 hours after their message.
        thread = [{"id": "i", "from": "lead", "channel": "whatsapp", "at": ago(hours=1, minutes=20),
                   "text": "Sorry, stuck in traffic"},
                  {"id": "o", "from": "us", "channel": "whatsapp", "source": "app", "at": ago(hours=1, minutes=10),
                   "text": "No worries"}]
        self.assertTrue(fu.reply_answered(thread, inbox, [], set()))
        # Before this branch, the same inbox picked the no-show message.
        no_reply = [{**inbox[0], "inbound_whatsapp_at": None}]
        self.assertEqual([d["segment"] for d in fu.pick(NOW, inbox=no_reply, calendar=[noshow], leads=[])],
                         ["no_show"])


if __name__ == "__main__":
    unittest.main()
