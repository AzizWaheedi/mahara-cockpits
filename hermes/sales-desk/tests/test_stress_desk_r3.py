"""Stress round 3, the follow-up agent and its waves, desk side (2026-10-03):
a send that died holding the opener's sending mark, an opener Meta failed
that HighLevel still shows, a run that never won the send lease, approved
openers that went stale while nothing could go, a wave whose enrolment broke
half way, and a lead whose time zone the cockpit does not know. Each test
asserts what must hold; a failing test names a defect for the fix lane.
Every lead, name and line is invented.

    python3 -m unittest tests.test_stress_desk_r3
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
from tests.test_waves import (GATE_OPEN, NOW, SETTINGS, Api, Clock, ago, members, routes, run, sb, seed,  # noqa: E402
                              wave)
from tests.test_waves_breakit import due_draft, enrolled_wave, row_ok, send  # noqa: E402

META = waves.META
MEMBERS = waves.MEMBERS
WAVES = waves.WAVES
FOLLOWUPS = waves.FOLLOWUPS
MESSAGES = waves.MESSAGES
# sales-api followupAgent.ts SENDING: followup.send_due's mark on an opener it is sending.
SENDING = "sales-desk:sending"


# ---------------------------------------------------------------------------
# 1. followup.send_due marks the opener it sends (held_by sales-desk:sending)
#    and clears the mark when the send ends. A send that dies in between (the
#    Edge Function stopped at its wall clock, the clear itself failed in a
#    database stall, or the set-aside write failed) leaves the mark. sales-api
#    takes a mark older than five minutes again (staleMark), but the desk
#    only ever asks for openers with held_by null, so the approved opener is
#    never sent, the waves row never names it, and Approve all calls it
#    "held by a rep".
# ---------------------------------------------------------------------------

class AStaleSendingMarkNeverStrandsAnApprovedOpener(unittest.TestCase):
    def test_an_opener_left_with_a_stale_sending_mark_is_offered_to_sales_api_again(self):
        pg = FakePostgrest()
        due_draft(pg, 0, send_after=ago(minutes=40))
        # The send of 30 minutes ago died after the mark; the draft is still a draft.
        pg.one(META, followup_id="f000").update({"held_by": SENDING, "held_at": ago(minutes=30)})
        out, api = send(pg)
        self.assertEqual(len(api.calls), 1,
                         "an approved opener whose send died holding the sending mark is never asked for again "
                         f"(the desk reads only held_by null): {out}")

    def test_after_free_stuck_puts_the_draft_back_the_opener_still_goes(self):
        # The Edge Function died after sendFollowup's claim (draft -> sending)
        # and before the message row: free_stuck puts the draft back to draft
        # half an hour later ("Approve it again"), and its meta keeps the mark.
        pg = FakePostgrest()
        due_draft(pg, 0, send_after=ago(minutes=50), status="sending")
        pg.one(FOLLOWUPS, id="f000")["decided_at"] = ago(minutes=45)
        pg.one(META, followup_id="f000").update({"held_by": SENDING, "held_at": ago(minutes=45)})
        with mock.patch.object(http, "request", pg):
            self.assertEqual(fu.free_stuck(sb(), NOW), 1)
        self.assertEqual(pg.one(FOLLOWUPS, id="f000")["status"], "draft")
        out, api = send(pg)
        line = row_ok(out)[1]
        self.assertTrue(api.calls or "f000" in line or "sending" in line.lower(),
                        "the opener sits approved with a dead sending mark: never sent, and the waves row says "
                        f"nothing about it ({line!r})")


# ---------------------------------------------------------------------------
# 2. An opener Meta failed (an empty wallet, the per-person marketing limit,
#    a number not on WhatsApp): sendTemplate's read-back stores HighLevel's
#    message id with state failed, sendFollowup marks the draft failed, and
#    sync's _maybe_went reads any HighLevel id as "it went". The member is
#    counted as sent: never tried again the next day, never taken out for a
#    reason that will not change, and measured in the wave arm as a lead who
#    had the opener.
# ---------------------------------------------------------------------------

class AnOpenerMetaFailedIsNotCountedAsSent(unittest.TestCase):
    def _failed(self, error: str):
        pg = FakePostgrest()
        enrolled_wave(pg, n=1)
        m = members(pg, "w1")[0]
        c = m["contact_id"]
        pg.put(FOLLOWUPS, {"id": "fx", "contact_id": c, "segment": "reactivate", "channel": "whatsapp_template",
                           "status": "failed", "error": error, "touch": 1, "created_at": ago(hours=3),
                           "decided_at": ago(hours=2), "context": {"wave_id": "w1"}})
        m.update({"state": "drafted", "followup_id": "fx", "drafted_at": ago(hours=3), "due_at": ago(hours=3)})
        # index.ts sendTemplate after its read-back saw the template fail at Meta.
        pg.put(MESSAGES, {"id": "mx", "followup_id": "fx", "contact_id": c, "sent_by": "sales-desk",
                          "via": "workflow", "state": "failed", "provider_status": "failed",
                          "ghl_message_id": "ghl-msg-invented-1", "error": error, "channel": "whatsapp",
                          "created_at": ago(hours=2)})
        with mock.patch.object(http, "request", pg):
            waves.sync(sb(), ["w1"], NOW)
        return pg.one(MEMBERS, wave_id="w1", contact_id=c)

    def test_a_meta_failure_for_the_moment_is_tried_again_not_counted_as_sent(self):
        m = self._failed("131049: This message was not delivered to maintain healthy ecosystem engagement.")
        self.assertNotEqual(m["state"], "sent",
                            "a template Meta refused is counted as an opener the lead had: never tried again, "
                            "and measured in the wave arm")
        self.assertEqual((m["state"], m.get("fail_count")), ("waiting", 1))

    def test_a_number_not_on_whatsapp_takes_the_lead_out_not_counted_as_sent(self):
        m = self._failed("Message failed: the recipient is not on WhatsApp")
        self.assertEqual(m["state"], "excluded",
                         f"a lead whose number is not on WhatsApp is counted as sent ({m['state']})")


# ---------------------------------------------------------------------------
# 3. Two waves runs at once (a manual run beside the cron's): a run that
#    tried for the send lease six times and lost every time falls out of
#    the loop and sends anyway, in the same moment as the run that holds it.
# ---------------------------------------------------------------------------

class ARunThatNeverHeldTheSendLeaseNeverSends(unittest.TestCase):
    def test_six_lost_tries_for_the_lease_are_no_licence_to_send(self):
        clock = Clock(NOW)

        class OtherRunHoldsTheLease(FakePostgrest):
            """The other run took the lease a second ago, every time this run looks."""

            def __call__(self, method, url, **kw):
                if "cockpit_sales_worker_status" in url and "waves-send-lease" in url:
                    if method == "GET":
                        return 200, {}, json.dumps([{"at": (clock() - timedelta(seconds=1)).isoformat()}]).encode()
                    if method == "PATCH":
                        return 200, {}, b"[]"
                return super().__call__(method, url, **kw)

        pg = OtherRunHoldsTheLease()
        due_draft(pg, 0)
        api = Api(pg, clock)
        with mock.patch.object(http, "request", pg):
            out = waves.send_due(sb(), api, settings=SETTINGS, w=waves.settings_of(SETTINGS),
                                 waves=[{"id": "w1", "state": "running"}], guard=GATE_OPEN, clock=clock,
                                 sleep=clock.sleep, budget_s=1000, log=lambda _m: None, warn=lambda _m: None)
        self.assertEqual(api.calls, [],
                         f"the run sent without ever holding the send lease, beside the run that held it: {out}")


# ---------------------------------------------------------------------------
# 4. Approved openers that went stale while nothing could go (the agent
#    switched off for a long weekend, so neither waves nor the follow-ups
#    job's expire_stale ran): the desk asks sales-api for each, sendFollowup
#    closes it as stale and refuses, and that refusal is read as the lead's.
#    Each is "set aside for a person" (on a draft already closed, which no
#    page shows) and three in a row stop the run, so the openers approved
#    this morning wait behind them, run after run, with the row red.
# ---------------------------------------------------------------------------

class AStaleApprovedOpenerIsNoRefusal(unittest.TestCase):
    STALE = "This draft went stale. The agent writes a new one if it is still due."

    def test_openers_past_their_72_hours_do_not_stop_this_mornings(self):
        pg = FakePostgrest()
        for i in range(4):
            due_draft(pg, i, send_after=ago(hours=80, minutes=10 - i))
            # followup.batch kept it until 72 hours past its turn.
            pg.one(FOLLOWUPS, id=f"f{i:03d}")["expires_at"] = ago(hours=8, minutes=10 - i)
        for i in range(4, 6):
            due_draft(pg, i, send_after=ago(minutes=10 - i))

        class SalesApi(Api):
            """index.ts sendFollowup: a draft past expires_at is closed as stale and refused;
            followupAgent.ts sendDue then sets it aside (it is no STATE_RACE)."""

            def __call__(self, action, payload):
                f = self.pg.one(FOLLOWUPS, id=payload["id"])
                if f.get("expires_at") and fu._ts(f["expires_at"]) < self.clock():
                    self.calls.append((self.clock(), action, payload["id"]))
                    f.update({"status": "expired"})
                    self.pg.one(META, followup_id=payload["id"]).update(
                        {"held_by": "sales-desk", "send_after": None, "hold_reason": AStaleApprovedOpenerIsNoRefusal.STALE})
                    return 409, {"ok": False, "error": AStaleApprovedOpenerIsNoRefusal.STALE}
                return super().__call__(action, payload)

        out, api = send(pg, SalesApi(pg, Clock(NOW)))
        self.assertEqual(out["sent"], 2, f"this morning's openers wait behind stale ones: {out}")
        self.assertEqual(out["set_aside"], 0, "a draft already closed as stale is 'set aside for a person' nobody sees")
        ok, line = row_ok(out)
        self.assertTrue(ok, line)


# ---------------------------------------------------------------------------
# 5. A wave whose enrolment breaks half way (a statement timeout on the
#    second chunk of members): the run goes on to write today's batch from
#    the chunk that got in, which is the first 200 leads by contact id, not
#    the newest in the pool, so "newest first" and the holdout's turns
#    follow the id order until enrolment finishes.
# ---------------------------------------------------------------------------

class APartlyEnrolledWaveWritesNoBatchOutOfOrder(unittest.TestCase):
    def test_no_opener_goes_to_an_older_lead_while_the_newest_are_not_in_the_wave_yet(self):
        class SecondChunkTimesOut(FakePostgrest):
            chunks = 0

            def __call__(self, method, url, **kw):
                if method == "POST" and url.split("?")[0].endswith(MEMBERS):
                    self.chunks += 1
                    if self.chunks >= 2:
                        raise http.HttpError(500, '{"message":"canceling statement due to statement timeout"}', b"",
                                             url)
                return super().__call__(method, url, **kw)

        pg = SecondChunkTimesOut()
        routes(pg)
        for i in range(250):
            seed(pg, f"n{i:03d}", "no_show_cancelled", days=250 - i)  # n249 is the newest
        wave(pg, "w1", "no_show_cancelled")
        out, _, _, _ = run(pg)
        self.assertIn("error", out["enrolled"]["w1"])
        written = sorted(f["contact_id"] for f in pg.rows(FOLLOWUPS) if f.get("segment") == "reactivate")
        older = [c for c in written if c < "n200"]
        self.assertEqual(older, [],
                         f"{len(older)} openers written to older leads while the 50 newest are not enrolled yet "
                         f"(enrolled_at is still null): {older[:5]}...")


# ---------------------------------------------------------------------------
# 6. A lead whose country code the cockpit has no time zone for: sales-api
#    says "a person sends this first message"; the desk's in_hours never
#    lets it go, yet the wave drafts it, a manager approves it, it waits as
#    "09:00 to 18:00 on the lead's clock" for 72 hours, expires, goes back to
#    waiting and is drafted again: the wave never finishes, no person is
#    told.
# ---------------------------------------------------------------------------

class ALeadWithNoKnownZoneIsHandedToAPerson(unittest.TestCase):
    def test_no_opener_is_written_for_a_lead_no_clock_is_known_for(self):
        pg = FakePostgrest()
        routes(pg)
        seed(pg, "kz1", "no_show_cancelled", country="KZ")
        wave(pg, "w1", "no_show_cancelled")
        run(pg, guard={})  # enrol only
        for m in members(pg, "w1"):
            m.update({"arm": "wave", "state": "waiting", "due_at": None})
        pg.one(WAVES, id="w1").update({"state": "running", "done_reason": None})
        self.assertIsNone(fu.lead_zones("KZ"))
        run(pg)
        written = [f for f in pg.rows(FOLLOWUPS) if f.get("segment") == "reactivate"]
        self.assertEqual(written, [], "an opener is written for a lead it can never go to by itself")


if __name__ == "__main__":
    unittest.main()
