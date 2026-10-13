"""Stress series 2, round 5, the desk: the follow-up agent, the waves and the
room worker on the VPS (2026-10-05). Each test asserts what must hold; a
failing test names a defect for the fix lane. Every lead, name and line is
invented.

    python3 -m unittest tests.test_stress2_desk_r5
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http, waves  # noqa: E402
from tests import test_waves as tw  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402

WNOW = tw.NOW  # 10:00 Kuwait, a Sunday
FOLLOWUPS = waves.FOLLOWUPS
META = waves.META


def wago(**kw) -> str:
    return (WNOW - timedelta(**kw)).isoformat()


def wlater(**kw) -> str:
    return (WNOW + timedelta(**kw)).isoformat()


def approved_opener(pg: FakePostgrest, i: int, *, wid: str = "w1", send_after: str, created_at: str,
                    expires_at: str, country: str = "Kuwait") -> str:
    c = f"p{i:03d}"
    pg.put("cockpit_sales_leads", {"contact_id": c, "country": country, "tags": ["roas-qualified"]})
    fid = f"f{i:03d}"
    pg.put(FOLLOWUPS, {"id": fid, "contact_id": c, "segment": "reactivate", "channel": "whatsapp_template",
                       "status": "draft", "touch": 1, "created_at": created_at, "expires_at": expires_at,
                       "context": {"wave_id": wid, "language": "ar"}})
    pg.put(META, {"followup_id": fid, "send_after": send_after, "held_by": None, "wave_id": wid,
                  "approved_by": "manager@example.invalid"})
    return fid


# ---------------------------------------------------------------------------
# 1. send_due moves an approved opener's expiry to 72 hours past its turn
#    (APPROVED_KEEP: "never long enough to go stale"), in the database, and
#    then kept_back judges the opener stale on the expiry it read BEFORE that
#    move (fups[fid]["expires_at"], never refreshed). An approved opener
#    whose own 48 hours ran out before its turn came (the batch's expiry
#    write was lost to a blip, or its turn was put off by an automation's
#    message, an hours answer or a sales-api failure) is closed as stale by
#    the same run that has just given it three more days: a manager's
#    approval undone, the lead written a fresh opener another day.
# ---------------------------------------------------------------------------

class TheExpiryTheRunJustMovedIsTheOneItReads(unittest.TestCase):
    def test_an_approved_opener_whose_expiry_the_run_moved_is_sent_not_closed_as_stale(self):
        pg = FakePostgrest()
        tw.routes(pg)
        tw.wave(pg, "w1", "no_show_cancelled", enrolled_at=wago(days=2))
        # Written 47 h 59 min ago (its 48 hours end a minute ago); approved just
        # now, its turn two minutes ago. sales-api's own expiry move at the
        # approval was lost (it is .catch(log) in followup.batch).
        fid = approved_opener(pg, 0, send_after=wago(minutes=2), created_at=wago(hours=47, minutes=59),
                              expires_at=wago(minutes=1))
        ghl = tw.Ghl(pg, {"p000": {"thread": []}})
        clock = tw.Clock(WNOW)
        api = tw.Api(pg, clock)
        logs: list[str] = []
        with mock.patch.object(http, "request", ghl):
            out = waves.send_due(tw.sb(), api, settings=tw.SETTINGS, w=waves.settings_of(tw.SETTINGS),
                                 waves=[{"id": "w1", "state": "running"}], guard=tw.GATE_OPEN, clock=clock,
                                 sleep=clock.sleep, budget_s=270, log=logs.append, warn=logs.append, ghl_token="t")
        f = pg.one(FOLLOWUPS, id=fid)
        self.assertGreater(waves.fu._ts(f.get("expires_at")) or WNOW, WNOW + timedelta(hours=70),
                           f"held control: the run moved the opener's expiry to 72 hours past its turn ({f})")
        self.assertNotEqual(
            f.get("error"), fu.STALE_DRAFT,
            "the run moved the approved opener's expiry three days on, then closed it as stale on the expiry it "
            f"had read before the move (kept_back reads fups[fid]['expires_at']): {out}")
        self.assertIn(fid, [i for _, _, i in api.calls], f"the approved opener never went ({out})")



# ---------------------------------------------------------------------------
# 2. Another kind's broken workflow holds the backlog openers, in the
#    openers' name. _silent_workflow reads the desk's last workflow sends
#    with a follow-up (sent_by sales-desk, via workflow, followup_id set),
#    whatever their template: the agent's own templates that send by
#    themselves (followup.autosend, a no-show or new-lead message signed by
#    the desk) are in it too. Their workflow broken in HighLevel (unpublished,
#    no re-entry) and three of them unseen: the approved opener batch holds
#    for two hours at a time, the waves row turns red saying "The opener's
#    HighLevel workflow took the last 3 openers and sent nothing", and a
#    manager checks a workflow that works.
# ---------------------------------------------------------------------------

class AnotherTemplatesSilenceIsNotTheOpeners(unittest.TestCase):
    def test_a_broken_no_show_workflow_does_not_hold_the_opener_batch(self):
        from tests.test_waves_breakit import due_draft
        pg = FakePostgrest()
        for i in range(3):
            due_draft(pg, i, wid="w1", send_after=wago(minutes=10 - i))
        # Three no-show messages the agent sent by itself (autosend, signed by
        # the desk) 10 to 30 minutes ago, through the no-show template's own
        # workflow, which HighLevel took and never sent.
        for j in range(3):
            pg.put("cockpit_sales_messages", {
                "id": f"ns-{j}", "contact_id": f"q{j:03d}", "followup_id": f"ns-f{j}", "sent_by": "sales-desk",
                "via": "workflow", "channel": "whatsapp", "template_key": "no_show_ar", "state": "sent",
                "provider_status": "enrolled", "body": "We missed you on the call today. Shall we find a new time?",
                "created_at": wago(minutes=10 + 10 * j)})
        clock = tw.Clock(WNOW)
        api = tw.Api(pg, clock)
        logs: list[str] = []
        with mock.patch.object(http, "request", tw.Ghl(pg)):
            out = waves.send_due(tw.sb(), api, settings=tw.SETTINGS, w=waves.settings_of(tw.SETTINGS),
                                 waves=[{"id": "w1", "state": "running"}], guard=tw.GATE_OPEN, clock=clock,
                                 sleep=clock.sleep, budget_s=600, log=logs.append, warn=logs.append, ghl_token="t")
        ok, line = waves.words({"waves": [{"id": "w1", "state": "running"}], "sent": out})
        self.assertEqual(
            [i for _, _, i in api.calls], ["f000", "f001", "f002"],
            "three unseen no-show templates (another workflow, sent by the agent itself) held every approved "
            f"backlog opener as the opener's own silent workflow; the row says: {line!r} (ok={ok})")



# ---------------------------------------------------------------------------
# 3. A phone call with the lead an hour ago is no conversation to the waves.
#    The drafter keeps a lead someone spoke to on a call out of its messages
#    (`reached`: a completed dial, spec P3 3.2: "someone spoke to them, so no
#    message lands on top of the call"), and the waves keep a lead someone
#    wrote to from HighLevel lately out for 20 hours (fu.GAP). A completed
#    dial (the dialer's call through Maqsam, in cockpit_sales_dials, never in
#    HighLevel's conversation) is read nowhere in the waves: not at the
#    drafting (opener_for), not at the send (kept_back, live_conversation,
#    _left_pool), not in sales-api's send_due. The no-show pool is the
#    dialer's own callback list: a rep talks a no-show through on the phone,
#    and an hour later "Hi Omar, it's Ahmed from Mahara Media. How are you?"
#    lands from the same rep's name, as if nobody had called.
# ---------------------------------------------------------------------------

def completed_dial(pg: FakePostgrest, c: str, *, minutes_ago: float, direction: str = "outbound") -> None:
    pg.put("cockpit_sales_dials", {"call_id": f"call-{c}-{minutes_ago}", "contact_id": c, "state": "completed",
                                   "direction": direction, "duration_s": 240, "agent_email": "setter@example.invalid",
                                   "occurred_at": wago(minutes=minutes_ago)})


class APhoneCallIsAConversation(unittest.TestCase):
    def test_no_opener_is_written_for_a_lead_a_rep_spoke_to_an_hour_ago(self):
        pg = FakePostgrest()
        tw.routes(pg)
        c = "ns-called"
        tw.seed(pg, c, "no_show_cancelled", days=8)  # missed their intro 8 days ago
        completed_dial(pg, c, minutes_ago=60)         # the setter talked them through it an hour ago
        tw.wave(pg, "w1", "no_show_cancelled", holdout_share=0.0)
        out, _api, _clock, _logs = tw.run(pg)
        held = [m for m in tw.members(pg, "w1") if m["contact_id"] == c]
        self.assertTrue(held, f"held control: the lead is in the wave ({out.get('enrolled')})")
        openers = [d for d in pg.rows("cockpit_sales_followups") if d["segment"] == "reactivate"]
        self.assertEqual(
            openers, [],
            "the backlog opener was written for a lead a rep spoke to on the phone an hour ago (a completed dial "
            f"in cockpit_sales_dials): the waves read no dial at all ({out.get('drafted')})")

    def test_an_approved_opener_does_not_go_half_an_hour_after_a_call_with_the_lead(self):
        pg = FakePostgrest()
        tw.routes(pg)
        tw.wave(pg, "w1", "no_show_cancelled", enrolled_at=wago(days=2))
        fid = approved_opener(pg, 0, send_after=wago(minutes=1), created_at=wago(hours=20),
                              expires_at=wlater(hours=60))
        completed_dial(pg, "p000", minutes_ago=30, direction="inbound")  # the lead called us back
        clock = tw.Clock(WNOW)
        api = tw.Api(pg, clock)
        logs: list[str] = []
        with mock.patch.object(http, "request", tw.Ghl(pg, {"p000": {"thread": []}})):
            out = waves.send_due(tw.sb(), api, settings=tw.SETTINGS, w=waves.settings_of(tw.SETTINGS),
                                 waves=[{"id": "w1", "state": "running"}], guard=tw.GATE_OPEN, clock=clock,
                                 sleep=clock.sleep, budget_s=270, log=logs.append, warn=logs.append, ghl_token="t")
        self.assertNotIn(
            fid, [i for _, _, i in api.calls],
            "an approved backlog opener went to a lead who called us and spoke to a rep half an hour ago: no "
            f"check at the send reads the dials ({out})")



# ---------------------------------------------------------------------------
# 4. The month's template budget is read as "spent or not", never as "how many
#    are left". draft_day's rule (fix round 4) is that no opener is written
#    for approval that could not go this month, since each one holds its
#    lead's one open draft until it goes stale; but with two templates left in
#    the budget it writes the whole day's batch, and followup.batch approves
#    all of it (spentSoFar < cap). Two go; the rest are refused at the send
#    (takeSlot's month cap) and sit approved, holding their leads, until they
#    go stale.
# ---------------------------------------------------------------------------

class TheBudgetLeftIsHowManyMayBeWritten(unittest.TestCase):
    def test_no_more_openers_are_written_than_the_month_has_templates_left(self):
        pg = FakePostgrest()
        tw.routes(pg)
        for i in range(6):
            tw.seed(pg, f"nb{i}", "no_show_cancelled", days=8 + i)
        tw.wave(pg, "w1", "no_show_cancelled", holdout_share=0.0)
        rate = waves.TEMPLATE_RATE_USD
        # A budget that pays for 5 templates this month, 3 already gone.
        guard = {**tw.GATE_OPEN, "template_budget_usd_month": round(5 * rate, 4), "template_rate_usd": rate}
        for j in range(3):
            pg.put("cockpit_sales_messages", {"id": f"tm{j}", "contact_id": f"x{j}", "via": "workflow", "state": "sent",
                                              "channel": "whatsapp", "created_at": wago(days=1, minutes=j)})
        with mock.patch.object(http, "request", pg):
            self.assertIsNone(waves.template_budget(tw.sb(), guard, WNOW), "held control: the budget is not spent")
        out, _api, _clock, _logs = tw.run(pg, guard=guard)
        openers = [d for d in pg.rows("cockpit_sales_followups") if d["segment"] == "reactivate"]
        self.assertLessEqual(
            len(openers), 2,
            f"{len(openers)} openers were written for approval with 2 templates left in the month's budget: the "
            f"rest cannot go this month and hold their leads' one open draft until they go stale ({out.get('drafted')})")



# ---------------------------------------------------------------------------
# 5. The run's time budget is checked only once an opener has passed its
#    checks. send_due's out_of_time test sits in the send lease's loop, after
#    kept_back; kept_back reads the lead's HighLevel conversation (fix round
#    3) with HighLevel's own 30 s timeout and one retry. HighLevel timing out
#    (a slow afternoon, an outage): every due opener costs a minute before it
#    is put back as unread, whatever the time left, so a run with ten approved
#    openers due takes ten minutes. The README's bound ("a run is bounded to
#    270 s, so flock -n never stacks runs") breaks: the next runs are skipped
#    by the lock, the waves row is not written for the whole run, and past
#    15 minutes the watchdog says the wave run has stopped.
# ---------------------------------------------------------------------------

class HighLevelTimingOut(tw.Ghl):
    """HighLevel that answers nothing: each call is its 30 s timeout, a 1 s
    back-off and the retry's 30 s (http.request with retries=1)."""

    def __init__(self, pg, clock):
        super().__init__(pg)
        self.clock = clock

    def __call__(self, method, url, **kw):
        if "leadconnectorhq" in url:
            self.clock.t += timedelta(seconds=61)
            raise http.HttpError(0, "TimeoutError: The read operation timed out", b"", url)
        return super().__call__(method, url, **kw)


class TheBudgetHoldsWhileHighLevelIsSlow(unittest.TestCase):
    def test_a_send_run_stops_near_its_budget_when_highlevel_times_out(self):
        pg = FakePostgrest()
        tw.routes(pg)
        tw.wave(pg, "w1", "no_show_cancelled", enrolled_at=wago(days=2))
        for i in range(10):
            approved_opener(pg, i, send_after=wago(minutes=20 - i), created_at=wago(hours=20),
                            expires_at=wlater(hours=60))
        clock = tw.Clock(WNOW)
        api = tw.Api(pg, clock)
        logs: list[str] = []
        with mock.patch.object(http, "request", HighLevelTimingOut(pg, clock)):
            out = waves.send_due(tw.sb(), api, settings=tw.SETTINGS, w=waves.settings_of(tw.SETTINGS),
                                 waves=[{"id": "w1", "state": "running"}], guard=tw.GATE_OPEN, clock=clock,
                                 sleep=clock.sleep, budget_s=270, log=logs.append, warn=logs.append, ghl_token="t")
        took = (clock() - WNOW).total_seconds()
        self.assertEqual(api.calls, [], f"held control: nothing went while HighLevel could not be read ({out})")
        self.assertLessEqual(
            took, 270 + 61,
            f"a send run with a 270 s budget took {took:.0f} s: every due opener's HighLevel read ran to its timeout "
            f"whatever the time left, so the next runs are skipped by flock -n and the waves row is not written "
            f"({out.get('unread')} unread)")



# ---------------------------------------------------------------------------
# 6. A Slack DM whose "handled" mark never landed is posted again by the next
#    run. slackpost keeps a reply Slack took, whose handled mark the database
#    refused, in the run's memory (_unmarked) and tries the mark again, and
#    once more at the end (flush): "so the next run, which has no memory of
#    them, does not send them again". A database that refuses the mark for
#    the rest of the minute (a Supabase blip of half a minute) leaves the
#    reply unhandled with a lease that runs out in 30 s; the next minute's run
#    takes it with the lease and posts the same DM to the rep again.
# ---------------------------------------------------------------------------

from desk import rooms as _rooms, slackpost as _slackpost  # noqa: E402
from tests import test_ops_contract as ops  # noqa: E402


class ASlackMarkLostForAMinute(ops.OpsCase):
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

    def test_a_dm_slack_took_is_not_posted_again_by_the_next_run(self):
        env = self.env
        ops.reply(env, 1)
        real = env.net.pg
        blip = {"on": True}

        def pg(method, url, **kw):
            import urllib.parse as up
            if blip["on"] and method == "PATCH" and _rooms.EVENTS in up.unquote(url) and b"handled_at" in (kw.get("data") or b""):
                raise http.HttpError(503, "upstream connect error", b"", url)
            return real(method, url, **kw)

        env.net.pg = pg
        self.worker("run-a").run(seconds=30)
        self.assertEqual(len(self.slack.posts), 1, "held control: the first run posted the DM once")
        env.clock.advance(35)          # the next minute; the 30 s lease has run out
        blip["on"] = False             # the database answers again
        self.worker("run-b").run(seconds=30)
        self.assertEqual(
            len(self.slack.posts), 1,
            f"the rep got the same Slack DM {len(self.slack.posts)} times: the run that posted it could not mark it "
            "handled, and the next run took it with the lease and posted it again")


if __name__ == "__main__":
    unittest.main()
