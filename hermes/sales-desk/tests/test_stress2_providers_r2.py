"""Stress series 2, round 2, provider quirks on the desk side (2026-10-04):
HighLevel's 400 on a contact it still has, Meta's payment failure (131042)
on a paced opener, Zoom's daily cap on meeting creates, and Slack answering
5xx after it posted. Each test drives the real code through the fakes the
lane's own tests use, with the providers' real answer shapes, and asserts
what must hold; a failing test names a defect for the fix lane. Every room,
lead, seat and line is invented; nothing reaches the network.

    python3 -m unittest tests.test_stress2_providers_r2
"""
from __future__ import annotations

import json
import os
import unittest
from datetime import timedelta
from typing import Any

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import rooms, slackpost, waves  # noqa: E402
from desk.http import HttpError  # noqa: E402
from tests import test_ops_contract as ops  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_rooms import SETTER, RoomsCase  # noqa: E402
from tests.test_waves import NOW, members, routes, run, seed, wave  # noqa: E402
from tests.test_waves import Ghl as WavesGhl  # noqa: E402


# ---------------------------------------------------------------------------
# 1. HighLevel answers 400 on a contact it still has, once.
#
# waves.contact_gone reads ANY 400 (and 404, 422) on the contact read as
# "merged away or deleted" (stress2, round 1), and _draft_wave excludes the
# member at once with GONE_CONTACT: it never waits for the next hour's read.
# A 400 that is not about the contact (HighLevel's generic "Bad Request" from
# its gateway, a Version header it refuses for a minute during a deploy) on
# a lead the cockpit's copy has, and HighLevel answers a minute later, takes
# the lead out of the wave for good: no opener, and the wave's comparison
# counts them as excluded. The same 400 on every contact at once (a Version
# header refused for a minute) empties the whole wave.
# ---------------------------------------------------------------------------

class OnceBadRequest(WavesGhl):
    def __init__(self, pg: FakePostgrest, failing: set[str], message: str):
        super().__init__(pg)
        self.failing, self.message = set(failing), message

    def __call__(self, method, url, **kw):
        if "leadconnectorhq" in url and "/contacts/" in url:
            c = url.rsplit("/", 1)[-1].split("?", 1)[0]
            if c in self.failing:
                self.failing.discard(c)  # HighLevel answers it again on the next read
                body = json.dumps({"statusCode": 400, "message": self.message})
                raise HttpError(400, body, body.encode(), url)
        return super().__call__(method, url, **kw)


class AKnownContactAnswering400Once(unittest.TestCase):
    def test_one_400_does_not_take_the_lead_out_of_the_wave(self):
        for message in ("Bad Request", "Version header is not valid"):
            with self.subTest(message=message):
                pg = FakePostgrest()
                routes(pg)
                leads = [f"stress-p2r2-known-{i}" for i in range(6)]
                for c in leads:
                    seed(pg, c, "never_booked")
                wave(pg, "w1", "never_booked")
                ghl = OnceBadRequest(pg, set(leads), message)
                for hours in (0, 1, 2):
                    run(pg, ghl, now=NOW + timedelta(hours=hours, minutes=1))
                out = [m for m in members(pg, "w1") if m.get("arm") != "holdout"]
                gone = [m["contact_id"] for m in out if m.get("excluded_reason") == waves.GONE_CONTACT]
                self.assertEqual(gone, [],
                                 f"one HighLevel 400 {message!r} on contacts HighLevel answered a minute later took "
                                 f"{len(gone)} of {len(out)} leads out of the wave for good as merged or deleted")

    def test_held_control_contact_not_found_still_lets_the_member_go(self):
        self.assertTrue(waves.contact_gone(HttpError(404, '{"message":"Contact not found"}', b"",
                                                     "https://services.leadconnectorhq.com/contacts/x")))


# ---------------------------------------------------------------------------
# 2. Meta's payment failure on an opener: 131042, "Business eligibility
#    payment issue" (an empty prepaid balance, a refused card). sales-api
#    answers the send 200 with the follow-up and message failed. judge()
#    holds every send only for HighLevel's wallet words (wallet, funds,
#    insufficient) or a hold_all flag, so Meta's payment failure is read as
#    this one lead's failure: the batch's next opener goes into the same
#    failure, lead by lead, until the follow-up source's health share trips.
# ---------------------------------------------------------------------------

class MetaPaymentFailure(unittest.TestCase):
    ANSWERS = (
        "Business eligibility payment issue (131042)",
        "(#131042) Message failed to send because there were one or more errors related to your payment method.",
    )

    def test_a_payment_failure_holds_every_send(self):
        for error in self.ANSWERS:
            with self.subTest(error=error):
                res = {"followup": {"status": "failed", "error": error},
                       "message": {"state": "failed", "provider_status": "failed", "error": error}}
                kind, _why = waves.judge(200, res)
                self.assertEqual(kind, "hold_all",
                                 f"Meta's payment failure {error[:40]!r} was read as {kind!r}: the batch sends its next "
                                 "opener into the same failure")
                self.assertTrue(waves.global_refusal(200, res))

    def test_held_control_highlevel_wallet_words_hold(self):
        res = {"followup": {"status": "failed"}, "message": {"state": "failed", "error": "Insufficient funds in the wallet"}}
        self.assertEqual(waves.judge(200, res)[0], "hold_all")


# ---------------------------------------------------------------------------
# 3. Zoom's daily cap on meeting creates (100 creates and updates a day for
#    one user, reset at 00:00 UTC, 03:00 in Kuwait): Zoom answers 429 with
#    "You have exceeded the daily rate limit (100) of Meeting Create/Update
#    API requests permitted for this particular user. You may resume these
#    requests at GMT 00:00:00." zoom_create reads every 429 as a passing
#    limit: three tries a second apart, then SAY["zoom_down"], "Zoom did not
#    answer. Try again in a minute, or use Meet." Zoom did answer, and a
#    minute later it answers the same; nothing remembers the cap, so every
#    Zoom room for that host until 03:00 Kuwait spends three more creates and
#    fails with the same sentence, and the seat's default stays Zoom.
# ---------------------------------------------------------------------------

DAILY_CAP = {"code": 429, "message": ("You have exceeded the daily rate limit (100) of Meeting Create/Update API "
                                      "requests permitted for this particular user. You may resume these requests "
                                      "at GMT 00:00:00.")}


class ZoomDailyCreateCap(RoomsCase):
    def test_the_daily_cap_is_not_said_as_zoom_not_answering(self):
        self.env.zoom.script = [{"method": "POST", "path": "/meetings", "status": 429, "body": DAILY_CAP}] * 6
        self.env.add_room(1)
        self.tick(self.env.worker())
        first = self.env.room(1)
        self.env.clock.advance(120)
        self.env.add_room(2, contact_id="contact-test-2", code="K7Q2MB")
        self.tick(self.env.worker("run-b"))
        second = self.env.room(2)
        creates = self.env.zoom.count("POST", "/meetings")
        self.assertEqual(first["state"], "failed")
        self.assertNotEqual(first.get("error"), rooms.SAY["zoom_down"],
                            "Zoom's daily cap was told to the rep as 'Zoom did not answer. Try again in a minute', and "
                            f"the next room two minutes later tried {creates - 3} more creates into the same cap "
                            f"(second room: {second.get('error')!r})")
        # Fix round 2: the cap is said as itself, and remembered, so the next
        # room spends no create into it.
        self.assertEqual((first.get("error"), second.get("error")), (rooms.SAY["zoom_daily_cap"], rooms.SAY["zoom_daily_cap"]))
        self.assertEqual(creates, 1)


# ---------------------------------------------------------------------------
# 4. Slack answers 5xx (or drops the connection) after it posted the DM.
#    slackpost reads every 5xx and every dropped connection that is not a
#    timeout as "Slack did not take it", releases the reply and posts it
#    again ten seconds later, up to three times: the rep gets the same DM two
#    or three times. Only a timeout is treated as "Slack may have posted it".
# ---------------------------------------------------------------------------

class PostedThenFailed(ops.FakeSlack):
    """chat.postMessage that posts, then answers as scripted (Slack's 500
    internal_error, a 503 from its edge, or a reset connection)."""

    def __init__(self, clock, after: list[dict[str, Any]]):
        super().__init__(clock)
        self.after = list(after)

    def __call__(self, method, url, headers, data, timeout):
        if self.after:
            s = self.after.pop(0)
            body = json.loads((data or b"{}").decode())
            self.calls.append(body)
            self.posts.append((body["channel"], body["text"]))
            if s.get("reset"):
                raise HttpError(0, "ConnectionResetError: [Errno 54] Connection reset by peer", b"", url)
            raise ops._err(s["status"], {"ok": False, "error": "internal_error"}, url)
        return super().__call__(method, url, headers, data, timeout)


class SlackFailedAfterPosting(ops.OpsCase):
    def setUp(self):
        super().setUp()
        self.env.pg.put("cockpit_sales_settings", {"key": "live", "value": {"enabled": True, "slack": True}})

    def worker(self) -> rooms.Worker:
        w = self.env.worker("run-a")
        w.slack = slackpost.SlackPoster(w.sb, ops.TOKEN, rooms.Sender(self.env.clock, self.env.clock.sleep, left=w.left),
                                        self.env.clock, self.env.log,
                                        lambda ok, detail: w._write_status(ok, detail, job=slackpost.JOB))
        return w

    def test_a_dm_slack_posted_is_not_posted_again(self):
        for after in ([{"status": 500}], [{"status": 503}], [{"reset": True}]):
            with self.subTest(after=after):
                self.slack = PostedThenFailed(self.env.clock, after)
                self.env.net.slack = self.slack
                for e in self.env.pg.rows(rooms.EVENTS):
                    e["handled_at"] = e.get("handled_at") or rooms.iso(self.env.clock())
                ops.reply(self.env, len(self.env.pg.rows(rooms.EVENTS)) + 1)
                self.worker().run(seconds=30)
                self.assertEqual(len(self.slack.posts), 1,
                                 f"Slack posted the DM and answered {after[0]}: the poster posted it "
                                 f"{len(self.slack.posts)} times")


if __name__ == "__main__":
    unittest.main()
