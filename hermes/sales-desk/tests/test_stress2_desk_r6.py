"""Stress series 2, round 6, the desk: the follow-up agent, the waves and the
room worker on the VPS (2026-10-05). Each test asserts what must hold; a
failing test names a defect for the fix lane. Every lead, name and line is
invented.

    python3 -m unittest tests.test_stress2_desk_r6
"""
from __future__ import annotations

import json
import os
import unittest
from datetime import timedelta
from typing import Any, Optional
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http, waves  # noqa: E402
from desk import rooms as _rooms, slackpost as _slackpost  # noqa: E402
from tests import test_ops_contract as ops  # noqa: E402
from tests import test_waves as tw  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402

WNOW = tw.NOW  # 10:00 Kuwait, a Sunday
FOLLOWUPS = waves.FOLLOWUPS
META = waves.META
MEMBERS = waves.MEMBERS

# sales-api's AGENT_COPY, word for word (followupAgent.ts): the refusals its
# followup.send_due answers (409, code "paused") when a rep and the lead spoke
# on the phone in the last 20 hours, or when the dials could not be read
# (stress2 round 5, completed-dial-ignored-opener-lands-on-top-of-a-call).
SPOKE_LATELY = ("A rep spoke to this lead on the phone in the last 20 hours, so the opener waits until a day after "
                "the call.")
CALLS_UNREAD = "The lead's phone calls could not be read, so the opener waits for the next run."


def wago(**kw) -> str:
    return (WNOW - timedelta(**kw)).isoformat()


def wlater(**kw) -> str:
    return (WNOW + timedelta(**kw)).isoformat()


def approved_opener(pg: FakePostgrest, i: int, *, wid: str = "w1", send_after: str, created_at: str,
                    expires_at: str, country: str = "Kuwait", member: bool = False, fail_count: int = 0) -> str:
    c = f"p{i:03d}"
    pg.put("cockpit_sales_leads", {"contact_id": c, "country": country, "tags": ["roas-qualified"]})
    fid = f"f{i:03d}"
    pg.put(FOLLOWUPS, {"id": fid, "contact_id": c, "segment": "reactivate", "channel": "whatsapp_template",
                       "status": "draft", "touch": 1, "created_at": created_at, "expires_at": expires_at,
                       "context": {"wave_id": wid, "language": "ar"}})
    pg.put(META, {"followup_id": fid, "send_after": send_after, "held_by": None, "wave_id": wid,
                  "approved_by": "manager@example.invalid"})
    if member:
        pg.put(MEMBERS, {"wave_id": wid, "contact_id": c, "arm": "wave", "state": "drafted", "followup_id": fid,
                         "fail_count": fail_count, "due_at": wago(hours=20), "drafted_at": wago(hours=20),
                         "event_at": wago(days=10 + i), "added_at": wago(days=3)})
    return fid


def send_due(pg, api, clock, *, ghl=None, budget=270.0):
    logs: list[str] = []
    with mock.patch.object(http, "request", ghl or tw.Ghl(pg)):
        out = waves.send_due(tw.sb(), api, settings=tw.SETTINGS, w=waves.settings_of(tw.SETTINGS),
                             waves=[{"id": "w1", "state": "running"}], guard=tw.GATE_OPEN, clock=clock,
                             sleep=clock.sleep, budget_s=budget, log=logs.append, warn=logs.append, ghl_token="t")
    return out, logs


# ---------------------------------------------------------------------------
# 1. sales-api's own "a rep spoke to the lead on the phone" refusal sets an
#    approved opener aside for a person. Round 5 taught both halves to read
#    the dials: the desk's kept_back puts the opener off (it waits in the
#    queue), and sales-api's followup.send_due refuses it (409, code
#    "paused": AGENT_COPY.spoke_lately, or calls_unread when the dials read
#    failed). The desk reads that answer through judge(): no hold-all word,
#    no hours word, and STATE_RACE (the refusals that "only say the draft's
#    own state moved") was never taught either sentence. So it is a refusal
#    about the lead: the opener is set aside for a person (meta.held_by
#    sales-desk, its approval cleared), counted "refused by the cockpit", and
#    counts toward the three-in-a-row stop that turns the waves row red.
#    The desk checks the dials before the 45 s gap wait and never after it,
#    so a call the setter finishes during the wait reaches sales-api's check
#    first; and a database blip on sales-api's dials read (calls_unread)
#    does the same to every opener it touches.
# ---------------------------------------------------------------------------

class SalesApiSaysSpokeLately(tw.Api):
    """followup.send_due as sales-api answers it: the dials read first (a
    completed one in the last 20 hours refuses, code "paused"), else sent."""

    def __init__(self, pg, clock, *, unread: bool = False):
        super().__init__(pg, clock)
        self.unread = unread

    def __call__(self, action, payload):
        f = self.pg.one("cockpit_sales_followups", id=payload["id"])
        if self.unread:
            self.calls.append((self.clock(), action, payload["id"]))
            return 409, {"ok": False, "code": "paused", "error": CALLS_UNREAD}
        since = self.clock() - timedelta(hours=20)
        if any(d["contact_id"] == f["contact_id"] and d.get("state") == "completed"
               and (fu._ts(d.get("occurred_at")) or since) > since for d in self.pg.rows("cockpit_sales_dials")):
            self.calls.append((self.clock(), action, payload["id"]))
            return 409, {"ok": False, "code": "paused", "error": SPOKE_LATELY}
        return super().__call__(action, payload)


class DialDuringTheGap:
    """The setter's call with the second lead completes while the desk waits
    out the 45 s gap after the first opener."""

    def __init__(self, pg, clock):
        self.pg, self.clock, self.done = pg, clock, False

    def __call__(self, s: float) -> None:
        self.clock.sleep(s)
        if not self.done:
            self.done = True
            self.pg.put("cockpit_sales_dials", {"call_id": "call-p001", "contact_id": "p001", "state": "completed",
                                               "direction": "outbound", "duration_s": 180,
                                               "agent_email": "setter@example.invalid",
                                               "occurred_at": (self.clock() - timedelta(seconds=5)).isoformat()})


class APhoneCallRefusalIsNoRefusalAboutTheLead(unittest.TestCase):
    def test_a_call_finished_during_the_gap_leaves_the_approved_opener_in_the_queue(self):
        pg = FakePostgrest()
        tw.routes(pg)
        tw.wave(pg, "w1", "no_show_cancelled", enrolled_at=wago(days=2))
        approved_opener(pg, 0, send_after=wago(minutes=3), created_at=wago(hours=20), expires_at=wlater(hours=60))
        f1 = approved_opener(pg, 1, send_after=wago(minutes=2), created_at=wago(hours=20), expires_at=wlater(hours=60))
        clock = tw.Clock(WNOW)
        api = SalesApiSaysSpokeLately(pg, clock)
        logs: list[str] = []
        with mock.patch.object(http, "request", tw.Ghl(pg)):
            out = waves.send_due(tw.sb(), api, settings=tw.SETTINGS, w=waves.settings_of(tw.SETTINGS),
                                 waves=[{"id": "w1", "state": "running"}], guard=tw.GATE_OPEN, clock=clock,
                                 sleep=DialDuringTheGap(pg, clock), budget_s=270, log=logs.append,
                                 warn=logs.append, ghl_token="t")
        # Fix round 6: the desk reads the dials again after the gap, so it may
        # put the second opener off itself before sales-api is asked.
        self.assertIn([i for _, _, i in api.calls], (["f000"], ["f000", "f001"]),
                      f"held control: the first opener went, the second was not sent ({out})")
        meta = pg.one(META, followup_id=f1)
        self.assertIsNone(
            meta.get("held_by"),
            "sales-api answered 'A rep spoke to this lead on the phone in the last 20 hours, so the opener waits' "
            f"(409, code paused) and the desk set the manager's approved opener aside for a person: {meta}; "
            f"counted as {out.get('refused')} refused, {out.get('set_aside')} set aside")
        self.assertFalse(out.get("refused"), f"a phone call with the lead was counted a refusal by the cockpit ({out})")

    def test_a_blip_on_sales_api_s_dials_read_sets_nothing_aside_and_turns_nothing_red(self):
        pg = FakePostgrest()
        tw.routes(pg)
        tw.wave(pg, "w1", "no_show_cancelled", enrolled_at=wago(days=2))
        fids = [approved_opener(pg, i, send_after=wago(minutes=10 - i), created_at=wago(hours=20),
                                expires_at=wlater(hours=60)) for i in range(3)]
        clock = tw.Clock(WNOW)
        api = SalesApiSaysSpokeLately(pg, clock, unread=True)
        out, _logs = send_due(pg, api, clock)
        ok, line = waves.words({"waves": [{"id": "w1", "state": "running"}], "sent": out})
        held = [pg.one(META, followup_id=f).get("held_by") for f in fids]
        self.assertEqual(
            held, [None, None, None],
            "sales-api could not read the lead's calls ('The lead's phone calls could not be read, so the opener "
            f"waits for the next run.') and the desk set every approved opener aside for a person: {held}; the "
            f"waves row says {line!r} (ok={ok})")
        # Fix round 6: no refusal and no stop on "refusals". The row is not ok
        # while every due opener waits on a check nobody could read (the
        # desk's own rule since round 3: missing is never zero), and it says so.
        self.assertNotEqual(out.get("stop_kind"), "refusals", f"a database blip on the dials read stopped the batch as three refusals: {line!r}")
        self.assertNotIn("refused", line, f"a database blip on the dials read was counted as refusals: {line!r}")
        self.assertIn("calls could not be read", line, f"the row says why the openers wait: {line!r} (ok={ok})")


# ---------------------------------------------------------------------------
# 2. Meta's refusal of the opener template itself is read as each lead's own
#    failure. Meta pauses a marketing template whose quality falls (132015
#    "Template is paused", the likeliest fate of a cold reactivation opener
#    that people block), disables it (132016), or refuses its parameters
#    (132000, 132012): every send of that template fails the same way, and
#    no lead is at fault. The desk knows only Meta's account failures
#    (ACCOUNT_FAILED: 131042, the wallet) as "not the lead". So each opener
#    of the approved batch is sent and fails (three a run, then the
#    three-in-a-row stop, again five minutes later), every member gets
#    fail_count 1 and a retry in 20 hours, and the second failure takes the
#    lead out of the wave for good ("The opener failed twice: (#132015)
#    Template is paused"). A paused template empties the wave's arm of leads
#    who never received a thing, and the comparison with the holdout loses
#    them.
# ---------------------------------------------------------------------------

PAUSED = "(#132015) Template is paused due to low quality, so it cannot be sent in a template message."


class MetaFailsTheTemplate(tw.Api):
    """followup.send_due's answer for a template Meta has paused: HighLevel's
    workflow ran, the read-back saw Meta's failure, the follow-up failed."""

    def __call__(self, action, payload):
        self.calls.append((self.clock(), action, payload["id"]))
        f = self.pg.one("cockpit_sales_followups", id=payload["id"])
        f.update({"status": "failed", "error": PAUSED, "decided_at": self.clock().isoformat()})
        self.pg.put("cockpit_sales_messages", {
            "id": f"msg-{payload['id']}", "followup_id": payload["id"], "contact_id": f["contact_id"],
            "sent_by": "sales-desk", "via": "workflow", "channel": "whatsapp", "template_key": "opener_ar",
            "state": "failed", "provider_status": "failed", "error": PAUSED, "ghl_message_id": f"gm-{payload['id']}",
            "created_at": self.clock().isoformat()})
        return 200, {"ok": True, "followup": {"id": payload["id"], "status": "failed", "error": PAUSED},
                     "message": {"state": "failed", "error": PAUSED}}


class APausedTemplateIsNotTheLeadsFailure(unittest.TestCase):
    def setUp(self):
        self.pg = FakePostgrest()
        tw.routes(self.pg)
        tw.wave(self.pg, "w1", "no_show_cancelled", enrolled_at=wago(days=2))

    def test_the_first_template_failure_holds_the_batch(self):
        for i in range(6):
            approved_opener(self.pg, i, send_after=wago(minutes=10 - i), created_at=wago(hours=20),
                            expires_at=wlater(hours=60), member=True)
        clock = tw.Clock(WNOW)
        api = MetaFailsTheTemplate(self.pg, clock)
        out, _logs = send_due(self.pg, api, clock)
        self.assertEqual(
            len(api.calls), 1,
            f"Meta answered that the opener template is paused, and the desk sent {len(api.calls)} more openers of "
            f"the same template into it ({out.get('failed')} failed, stopped as {out.get('stop_kind')!r}: "
            f"{out.get('stopped')!r})")

    def test_meta_s_spam_limit_on_the_number_never_takes_the_lead_out(self):
        # 131048: Meta restricts how many messages the number may send (a
        # cold campaign's likeliest limit): the number's, never the lead's.
        global PAUSED
        was = PAUSED
        PAUSED = ("(#131048) Spam rate limit hit: Failed to send message because there are restrictions on how many "
                  "messages can be sent from this phone number.")
        try:
            self.test_a_paused_template_never_counts_against_the_lead_or_takes_them_out()
        finally:
            PAUSED = was

    def test_a_paused_template_never_counts_against_the_lead_or_takes_them_out(self):
        # Day two: the lead's opener failed once already for the paused
        # template (fail_count 1), was written again and approved.
        fid = approved_opener(self.pg, 0, send_after=wago(minutes=5), created_at=wago(hours=20),
                              expires_at=wlater(hours=60), member=True, fail_count=1)
        clock = tw.Clock(WNOW)
        api = MetaFailsTheTemplate(self.pg, clock)
        send_due(self.pg, api, clock)
        self.assertEqual(self.pg.one(FOLLOWUPS, id=fid)["status"], "failed", "held control: the opener failed")
        with mock.patch.object(http, "request", self.pg):
            waves.sync(tw.sb(), ["w1"], WNOW + timedelta(minutes=5))
        m = self.pg.one(MEMBERS, wave_id="w1", contact_id="p000")
        self.assertNotEqual(
            m["state"], "excluded",
            f"the lead was taken out of the wave for good for Meta pausing the template: {m.get('excluded_reason')!r}")
        self.assertLessEqual(int(m.get("fail_count") or 0), 1,
                             f"a template Meta paused was counted against the lead: fail_count {m.get('fail_count')}")


# ---------------------------------------------------------------------------
# 3. The Slack poster starts a post it has no time to hear the answer to.
#    chat.postMessage is no safe repeat, so a post that times out is closed
#    "unclear" and never sent again (stress2 round 2). The poster shares the
#    room worker's Sender, which squeezes every call's timeout into the time
#    the run has left before its hard stop (down to 0.25 s), and nothing
#    keeps the poster from starting a post in the run's last two seconds,
#    as ZOOM_CLAIM_MARGIN keeps a Zoom create out of them. A reply first
#    tried in the run's last step gets a fraction of a second where Slack
#    takes most of one: the post times out (often before Slack ever read it),
#    the reply is closed "Slack did not answer in time", and the rep who
#    pressed in Slack never gets the sentence. The next run, which would
#    have had its whole 4 s, is never asked.
# ---------------------------------------------------------------------------

class SlowSlack(ops.FakeSlack):
    """Slack that takes 0.6 s to answer chat.postMessage (well inside the
    poster's own 4 s): a call given less never reaches Slack's answer, and
    here never posts at all (the connection was still being made)."""

    def __call__(self, method, url, headers, data, timeout):
        if timeout < 0.6:
            body = json.loads((data or b"{}").decode())
            self.calls.append(body)
            self.clock.advance(timeout)
            raise http.HttpError(0, "TimeoutError: timed out", b"", url)
        self.clock.advance(0.6)
        return super().__call__(method, url, headers, data, timeout)


class TheSlackPosterNeverStartsAPostItCannotHear(ops.OpsCase):
    def setUp(self):
        super().setUp()
        self.slack = SlowSlack(self.env.clock)
        self.env.net.slack = self.slack
        self.env.pg.put("cockpit_sales_settings", {"key": "live", "value": {"enabled": True, "slack": True}})

    def worker(self, run: str) -> _rooms.Worker:
        w = self.env.worker(run)
        w.slack = _slackpost.SlackPoster(w.sb, ops.TOKEN,
                                         _rooms.Sender(self.env.clock, self.env.clock.sleep, left=w.left),
                                         self.env.clock, self.env.log,
                                         lambda ok, detail: w._write_status(ok, detail, job=_slackpost.JOB))
        return w

    def test_a_reply_that_arrives_in_the_runs_last_seconds_still_reaches_the_rep(self):
        env = self.env
        a = self.worker("run-a")
        a.run(seconds=0)  # the settings and the live switch read
        # The run is 2.3 s from its hard stop when the reply arrives.
        a.hard_stop = env.clock() + 2.3
        a.deadline = a.hard_stop - _rooms.HARD_SLACK
        e = ops.reply(env, 1, age=0.2)
        a.slack._due = 0.0
        a.slack.step()
        env.clock.advance(60)  # the next minute's run, with all the time it needs
        b = self.worker("run-b")
        b.run(seconds=5)
        self.assertEqual(
            self.slack.posts, [("U0TESTREP", "Someone else took this lead.")],
            f"the rep never got the Slack reply: the poster started the post with "
            f"{len(self.slack.calls) and 'a fraction of a second'} left, Slack's answer never came, and it was closed "
            f"as {e['detail'].get('unclear') or e['detail']!r}, never sent again")


if __name__ == "__main__":
    unittest.main()


# ---------------------------------------------------------------------------
# 4. A send that died before HighLevel was asked is read as one that "may
#    have gone". Since 20261004a every message row is a slot written
#    "sending" before HighLevel is asked, and stamped ghl_asked_at just
#    before it is (markAsked): an unstamped row past 30 s is a send that
#    certainly never left (sales-api's unaskedOrphan; the waves' _maybe_went
#    since round 5). sales-api's Edge Function dying between the two (its
#    wall clock, a crash) leaves the follow-up "sending" with such a row.
#    The drafter's free_stuck, half an hour on, reads the row without its
#    stamp (select=id,followup_id,state,ghl_message_id,error), finds a row
#    neither gone nor failed, and fails the follow-up "The send stopped
#    halfway and may not have gone out. Read the conversation in HighLevel
#    before writing to the lead again." The waves' sync then reads those
#    words (MAY_HAVE_GONE) and takes the lead out of the wave for good:
#    "The opener may have gone; a person checks HighLevel before anyone
#    writes to the lead again", for an opener nobody ever sent. Round 5
#    taught _maybe_went the stamp and left free_stuck, which writes the
#    words _maybe_went then obeys, without it.
# ---------------------------------------------------------------------------

class ASendThatNeverLeftIsNotAMaybe(unittest.TestCase):
    def test_free_stuck_puts_an_unasked_send_back_and_the_wave_keeps_the_lead(self):
        pg = FakePostgrest()
        tw.routes(pg)
        tw.wave(pg, "w1", "no_show_cancelled", enrolled_at=wago(days=2))
        fid = approved_opener(pg, 0, send_after=wago(minutes=50), created_at=wago(hours=20),
                              expires_at=wlater(hours=60), member=True)
        f = pg.one(FOLLOWUPS, id=fid)
        # sendFollowup claimed it 40 minutes ago; the slot's row is written,
        # never stamped: the function died before HighLevel was asked.
        f.update({"status": "sending", "decided_by": "manager@example.invalid", "decided_at": wago(minutes=40)})
        pg.one(META, followup_id=fid).update({"held_by": "sales-desk:sending", "held_at": wago(minutes=40)})
        pg.put("cockpit_sales_messages", {
            "id": "m-orphan", "request_id": fid, "followup_id": fid, "contact_id": "p000", "sent_by": "sales-desk",
            "via": "workflow", "channel": "whatsapp", "template_key": "opener_ar", "state": "sending",
            "provider_status": None, "ghl_message_id": None, "ghl_asked_at": None, "error": None,
            "created_at": wago(minutes=40)})
        with mock.patch.object(http, "request", pg):
            freed = fu.free_stuck(tw.sb(), WNOW)
            waves.sync(tw.sb(), ["w1"], WNOW + timedelta(minutes=1))
        f = pg.one(FOLLOWUPS, id=fid)
        m = pg.one(MEMBERS, wave_id="w1", contact_id="p000")
        self.assertEqual(freed, 1, "held control: free_stuck took the stuck send")
        self.assertNotIn(
            "may not have gone", str(f.get("error") or ""),
            f"a send HighLevel was never asked about (its row unstamped for 40 minutes) was failed as one that may "
            f"have gone: {f.get('status')!r}, {f.get('error')!r}")
        self.assertNotEqual(
            m["state"], "excluded",
            f"the lead left the wave for an opener that never went: {m.get('excluded_reason')!r}")


# ---------------------------------------------------------------------------
# 5. A stamp whose answer was lost closes a reply nobody posted. Since round
#    5 the poster stamps detail.slack_asked_at on the reply before it asks
#    Slack, so a run that cannot record Slack's answer never has the next
#    run post the DM again. The stamp is a database write like any other: it
#    can land and lose its answer (a timeout, a dropped connection). The
#    poster then says "a reply could not be stamped before its post, so it
#    waits" and asks nothing, which is right; but the stamp is there, so when
#    the lease runs out the next try reads slack_asked_at and closes the
#    reply as "an earlier run asked Slack and its answer was not recorded".
#    Slack was never asked: the rep who pressed never gets the sentence, and
#    the status row counts a DM Slack "did not confirm".
# ---------------------------------------------------------------------------

class AStampThatLandedSilentlyIsNotAPost(ops.OpsCase):
    def setUp(self):
        super().setUp()
        self.env.pg.put("cockpit_sales_settings", {"key": "live", "value": {"enabled": True, "slack": True}})

    def worker(self, run: str) -> _rooms.Worker:
        w = self.env.worker(run)
        w.slack = _slackpost.SlackPoster(w.sb, ops.TOKEN,
                                         _rooms.Sender(self.env.clock, self.env.clock.sleep, left=w.left),
                                         self.env.clock, self.env.log,
                                         lambda ok, detail: w._write_status(ok, detail, job=_slackpost.JOB))
        return w

    def test_a_reply_whose_stamp_answer_was_lost_is_still_posted(self):
        env = self.env
        e = ops.reply(env, 1)
        real = env.net.pg
        lost = {"left": 1}

        def pg(method, url, **kw):
            import urllib.parse as up
            data = kw.get("data") or b""
            if (lost["left"] and method == "PATCH" and _rooms.EVENTS in up.unquote(url)
                    and b"slack_asked_at" in data and b"handled_at" not in data):
                lost["left"] -= 1
                real(method, url, **kw)  # the write lands ...
                raise http.HttpError(0, "TimeoutError: The read operation timed out", b"", url)  # ... its answer is lost
            return real(method, url, **kw)

        env.net.pg = pg
        self.worker("run-a").run(seconds=50)
        env.clock.advance(15)
        self.worker("run-b").run(seconds=30)
        self.assertEqual(
            self.slack.posts, [("U0TESTREP", "Someone else took this lead.")],
            f"Slack was never asked, and the reply was closed as {e['detail'].get('unclear') or e['detail']!r}: "
            "the stamp's lost answer left a stamp the next try read as a post")
