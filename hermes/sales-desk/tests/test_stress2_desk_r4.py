"""Stress series 2, round 4, the desk: the follow-up agent, the waves and the
room worker on the VPS (2026-10-05). Each test asserts what must hold; a
failing test names a defect for the fix lane. Every lead, name and line is
invented.

    python3 -m unittest tests.test_stress2_desk_r4
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


def wago(**kw) -> str:
    return (WNOW - timedelta(**kw)).isoformat()


# ---------------------------------------------------------------------------
# 1. A sequence step a rep skipped is not a sequence that ended. pick() counts
#    a skipped step as done and carries on with the next one (step() reads
#    `decided`, which holds sent AND skipped), but the waves' in_sequence
#    reads only sent, draft and sending rows. A lead who missed their intro
#    yesterday, whose first no-show message a rep skipped (they called the
#    lead instead), is the newest no-show in the pool: the wave writes them
#    "How are you?" today, and the agent's no-show message 2 follows it as
#    soon as the 20-hour gap is over (stress2 round 3's
#    backlog-wave-overlaps-agent-sequences, through the skipped door).
# ---------------------------------------------------------------------------

class ASkippedStepStillLeavesTheSequenceRunning(unittest.TestCase):
    def test_a_no_show_whose_first_message_a_rep_skipped_gets_no_backlog_opener(self):
        pg = FakePostgrest()
        tw.routes(pg)
        c = "ns-skip"
        tw.seed(pg, c, "no_show_cancelled", days=1.25)  # missed 30 hours ago
        # The agent's message 1, drafted 15 minutes after the miss, skipped by a rep.
        pg.put("cockpit_sales_followups", {"id": f"no_show-{c}-1", "contact_id": c, "segment": "no_show",
                                           "channel": "whatsapp_template", "status": "skipped", "touch": 1,
                                           "created_at": wago(hours=29.75), "decided_at": wago(hours=29.5)})
        # The agent's own pick, before the wave runs: message 2 of the no-show
        # sequence is due for this lead (the skip counted as step 1).
        calendar = fu.with_kinds(pg.rows("cockpit_sales_calendar"))
        due = fu.pick(WNOW, inbox=[], calendar=calendar, leads=pg.rows("cockpit_sales_leads"),
                      followups=pg.rows("cockpit_sales_followups"), sends=[])
        self.assertTrue(any(d["contact_id"] == c and d["segment"] == "no_show" and d["touch"] == 2 for d in due),
                        f"held control: the agent's no-show sequence goes on to message 2 after a skip ({due})")
        tw.wave(pg, "w1", "no_show_cancelled", holdout_share=0.0)
        out, _api, _clock, _logs = tw.run(pg)
        openers = [d for d in pg.rows("cockpit_sales_followups") if d["segment"] == "reactivate"]
        self.assertEqual(
            openers, [],
            "a lead in the middle of the agent's no-show sequence (message 1 skipped by a rep, message 2 due now) "
            "was written the backlog opener: in_sequence reads only sent, draft and sending steps, while the "
            "agent's pick() counts a skipped step as done and sends the next one after the opener "
            f"({out.get('drafted')})")


# ---------------------------------------------------------------------------
# 2. The lead's live conversation is read before the send lease's wait, never
#    after it. send_due's kept_back (with live_conversation, stress2 round 3)
#    runs, then the run sleeps up to batch_gap_s (45 s) for the gap after the
#    last send, then still_kept_back re-checks only the meta, the draft and
#    the wave. A lead who writes during that wait ("Can you call me now?") is
#    not in the inbox copy yet (sales-mirror, every three minutes), so
#    sales-api's "conversation has moved on" passes too: "How are you?" lands
#    right behind the lead's own message.
# ---------------------------------------------------------------------------

class AReplyDuringTheGapWait(unittest.TestCase):
    def test_an_opener_never_goes_after_the_lead_wrote_during_the_gap_wait(self):
        from tests.test_waves_breakit import due_draft
        pg = FakePostgrest()
        tw.routes(pg)
        tw.wave(pg, "w1", "no_show_cancelled", enrolled_at=wago(days=1))
        for i in (0, 1):
            due_draft(pg, i, wid="w1", send_after=wago(minutes=5 - i))
            f = pg.one("cockpit_sales_followups", id=f"f{i:03d}")
            f.update({"context": {"wave_id": "w1", "language": "ar"}, "created_at": wago(hours=20),
                      "expires_at": (WNOW + timedelta(hours=40)).isoformat()})
            # The inbox copy as sales-mirror last left it: two days quiet.
            pg.put("cockpit_sales_inbox", {"conversation_id": f"cv-p{i:03d}", "contact_id": f"p{i:03d}",
                                           "last_direction": "outbound", "last_type": "TYPE_WHATSAPP",
                                           "last_message_at": wago(days=2)})
        ghl = tw.Ghl(pg, {"p000": {"thread": []}, "p001": {"thread": []}})
        clock = tw.Clock(WNOW)
        wrote: list[str] = []

        def sleep(s: float) -> None:
            # While the run waits out the gap after p000's send, p001 writes.
            clock.sleep(s)
            if not wrote:
                at = clock().isoformat()
                ghl.people["p001"] = {"thread": [{"id": "in-1", "direction": "inbound", "messageType": "TYPE_WHATSAPP",
                                                   "dateAdded": at, "body": "Can you call me now please?"}]}
                wrote.append(at)

        class SalesApi(tw.Api):
            """sales-api's send_due: refuses when the inbox copy moved on (it has not)."""

        api = SalesApi(pg, clock)
        logs: list[str] = []
        with mock.patch.object(http, "request", ghl):
            out = waves.send_due(tw.sb(), api, settings=tw.SETTINGS, w=waves.settings_of(tw.SETTINGS),
                                 waves=[{"id": "w1", "state": "running"}], guard=tw.GATE_OPEN, clock=clock,
                                 sleep=sleep, budget_s=270, log=logs.append, warn=logs.append, ghl_token="t")
        self.assertTrue(wrote, "held control: the run waited for the gap between the two sends")
        sent_to = [i for _, _, i in api.calls]
        self.assertIn("f000", sent_to, f"held control: the first opener went ({out})")
        self.assertNotIn(
            "f001", sent_to,
            "the backlog opener went 45 seconds after the lead wrote 'Can you call me now please?': the desk reads "
            "the lead's conversation before it waits out the batch gap and never after, and sales-api's moved-on "
            f"check reads an inbox copy up to three minutes old ({out})")



# ---------------------------------------------------------------------------
# 3. A workflow slower than sales-api's read-back is read as one that sends
#    nothing. sendTemplate reads the conversation for 12 s after the
#    enrolment; a template HighLevel posts later than that is stored
#    provider_status "enrolled" (sent), and only the follow-ups job's
#    reconcile_templates (at :07 and :37) finds it in the conversation
#    afterwards. _silent_workflow counts every "enrolled" row as unseen, at
#    any age: three openers in a row that HighLevel posted 20 s after their
#    enrolment (a slow afternoon at HighLevel) stop the batch at the fourth,
#    the waves row turns red saying the workflow "sent nothing" and asks a
#    manager to check it is published, and the batch holds until the next
#    reconcile, again at every third opener.
# ---------------------------------------------------------------------------

class SlowWorkflowApi:
    """sales-api's followup.send_due over a workflow that sends every template,
    20 s after its enrolment: later than sendTemplate's 12 s read-back, so
    each message is stored sent, provider_status enrolled."""

    def __init__(self, pg, clock):
        self.pg, self.clock, self.calls = pg, clock, []

    def __call__(self, action, payload):
        self.calls.append((self.clock(), action, payload["id"]))
        f = self.pg.one("cockpit_sales_followups", id=payload["id"])
        f.update({"status": "sent", "decided_at": self.clock().isoformat(), "message_id": f"m-{payload['id']}"})
        m = {"id": f"m-{payload['id']}", "followup_id": payload["id"], "contact_id": f["contact_id"],
             "sent_by": "sales-desk", "via": "workflow", "channel": "whatsapp", "state": "sent",
             "provider_status": "enrolled", "body": "Hi Omar, it's the sales team from Mahara Media. How are you?",
             "created_at": self.clock().isoformat()}
        self.pg.put("cockpit_sales_messages", m)
        return 200, {"followup": {"id": payload["id"], "status": "sent"}, "message": m}


class SlowWorkflowGhl(tw.Ghl):
    """HighLevel's conversations as the slow workflow leaves them: each
    opener's message shows in its lead's conversation 20 s after the send's
    row (sales-api's read-back gave up at 12 s)."""

    def __init__(self, pg, clock):
        super().__init__(pg)
        self.clock = clock

    def person(self, c):
        thread = []
        for m in self.pg.rows("cockpit_sales_messages"):
            at = fu._ts(m.get("created_at"))
            if m.get("contact_id") == c and at and at + timedelta(seconds=20) <= self.clock():
                thread.append({"id": f"ghl-{m['id']}", "direction": "outbound", "messageType": "TYPE_WHATSAPP",
                               "source": "workflow", "status": "delivered", "body": m["body"],
                               "dateAdded": (at + timedelta(seconds=20)).isoformat()})
        return {"firstName": "Omar", "phone": "+96550000000", "thread": thread}


class AWorkflowSlowerThanTheReadBack(unittest.TestCase):
    def test_three_openers_not_yet_seen_do_not_stop_the_batch_as_a_silent_workflow(self):
        from tests.test_waves_breakit import due_draft
        pg = FakePostgrest()
        for i in range(6):
            due_draft(pg, i, wid="w1", send_after=wago(minutes=10 - i))
        clock = tw.Clock(WNOW)
        api = SlowWorkflowApi(pg, clock)
        # Fixed (stress2 round 4): the batch looks for the openers HighLevel has
        # not shown yet in their leads' conversations (HighLevel's key given).
        with mock.patch.object(http, "request", SlowWorkflowGhl(pg, clock)):
            out = waves.send_due(tw.sb(), api, settings=tw.SETTINGS, w=waves.settings_of(tw.SETTINGS),
                                 waves=[{"id": "w1", "state": "running"}], guard=tw.GATE_OPEN, clock=clock,
                                 sleep=clock.sleep, budget_s=600, log=lambda _m: None, warn=lambda _m: None,
                                 ghl_token="t")
        ok, line = waves.words({"waves": [{"id": "w1", "state": "running"}], "sent": out})
        self.assertEqual(
            len(api.calls), 6,
            "three openers HighLevel had not shown within sales-api's 12 s read-back (stored 'enrolled', minutes "
            "old, the reconcile not due yet) stopped the batch as a workflow that sends nothing: "
            f"{len(api.calls)} of 6 went; the row says: {line!r} (ok={ok})")
        self.assertTrue(ok, f"the waves row turned red over openers that are only not reconciled yet: {line!r}")



# ---------------------------------------------------------------------------
# 4. Without the HighLevel key the send's conversation check is skipped, not
#    waited on. send_due asks live_conversation only `if ghl_token`: the key
#    gone from api-keys.env (rotated, a typo after an edit) and every opener
#    a manager approved goes without anyone reading the lead's conversation,
#    on the inbox copy alone, which is the hole stress2 round 3 closed
#    (approved-opener-sent-inside-inbox-mirror-lag). live_conversation's own
#    rule is "Not read: it waits"; a key that is not there is not read either.
# ---------------------------------------------------------------------------

class NoKeyIsNotRead(unittest.TestCase):
    def test_an_approved_opener_waits_when_the_conversation_cannot_be_read_for_want_of_a_key(self):
        from tests.test_waves_breakit import due_draft
        pg = FakePostgrest()
        tw.routes(pg)
        tw.wave(pg, "w1", "no_show_cancelled", enrolled_at=wago(days=1))
        due_draft(pg, 0, wid="w1", send_after=wago(minutes=1))
        pg.one("cockpit_sales_followups", id="f000").update(
            {"context": {"wave_id": "w1", "language": "ar"}, "created_at": wago(hours=20),
             "expires_at": (WNOW + timedelta(hours=40)).isoformat()})
        clock = tw.Clock(WNOW)
        api = tw.Api(pg, clock)
        with mock.patch.object(http, "request", pg):
            out, _a, _c, _l = tw.run(pg, api=api, token="")
        self.assertEqual(
            [i for _, _, i in api.calls], [],
            "with GHL_B2B_API_KEY unset the waves run still sent an approved opener: the send-time read of the "
            "lead's conversation (an automation a minute ago, the lead's own message) is skipped instead of "
            f"waited on ({out.get('sent')})")



# ---------------------------------------------------------------------------
# 5. An enrolment finished by a second run says it enrolled nobody. enroll()
#    counts only the rows its own POSTs added; when the first run posted
#    every member and then failed on the wave's enrolled_at write (a
#    statement timeout, an outage: "the next run tries again"), the second
#    run's inserts are all ignore-duplicates, so the waves row and the
#    waves.enroll audit row say "0 leads enrolled, 3 held back", for a wave
#    of 30. The first run wrote no audit row at all (it raised first).
# ---------------------------------------------------------------------------

class AnEnrolmentFinishedByTheNextRun(unittest.TestCase):
    def test_the_second_run_says_how_many_leads_the_wave_holds(self):
        pg = FakePostgrest()
        tw.routes(pg)
        for i in range(30):
            tw.seed(pg, f"n{i:02d}", "no_show_cancelled", days=i + 2)
        tw.wave(pg, "w1", "no_show_cancelled")
        failed = []

        def flaky(method, url, **kw):
            if method == "PATCH" and "cockpit_sales_followup_waves" in url and "enrolled_at=is.null" in url and not failed:
                failed.append(url)
                raise http.HttpError(500, '{"message":"canceling statement due to statement timeout"}', b"", url)
            return pg(method, url, **kw)

        ghl = tw.Ghl(pg)
        with mock.patch.object(http, "request", flaky):
            first = waves.run(tw.sb(), tw.Api(pg, tw.Clock(WNOW)), settings=tw.SETTINGS, guard={}, ghl_token="t",
                              log=lambda _m: None, clock=tw.Clock(WNOW), sleep=lambda _s: None, budget_s=270)
        self.assertTrue(failed and first["enrolled"]["w1"].get("error"), f"held control: the first run failed ({first})")
        enrolled = [m for m in pg.rows(waves.MEMBERS) if m["wave_id"] == "w1"]
        self.assertEqual(len(enrolled), 30, "held control: the first run had posted every member")
        later = WNOW + timedelta(minutes=5)
        with mock.patch.object(http, "request", ghl):
            second = waves.run(tw.sb(), tw.Api(pg, tw.Clock(later)), settings=tw.SETTINGS, guard={}, ghl_token="t",
                               log=lambda _m: None, clock=tw.Clock(later), sleep=lambda _s: None, budget_s=270)
        _ok, line = waves.words(second)
        wave_arm = sum(1 for m in enrolled if m["arm"] == "wave")
        held = len(enrolled) - wave_arm
        # The line's own words: the leads in the wave (both arms), and how many
        # are held back to measure the effect (corrected in fix round 4: the
        # line counts both arms, as the first run's line does).
        self.assertIn(
            f"{len(enrolled)} leads enrolled, {held} held back", line,
            f"the wave holds {len(enrolled)} leads ({wave_arm} to message), but the run that finished its enrolment "
            f"says: {line!r}; the enrol counts it audits: {second['enrolled']['w1']}")



# ---------------------------------------------------------------------------
# 6. The deploy check says "every switch is off" when it never read them.
#    check_database reads the settings once (a GET, no retry); a blip on that
#    one read leaves `settings` empty: the switches line is "?? not checked",
#    the Arabic line and the Zoom, Google and Slack key lines all read the
#    switches as off, nothing is "--", and the summary prints "Ready: every
#    table, column, function and setting the desk needs is there, and every
#    switch is off." with exit code 0, here while rooms.enabled is true.
#    Missing is never zero: switches not read are not switches off.
# ---------------------------------------------------------------------------

class TheDeployCheckNeverSaysOffForSwitchesItDidNotRead(unittest.TestCase):
    def test_a_settings_read_that_fails_is_no_ready(self):
        from tests import test_deploy_check as tdc
        db = tdc.Catalog()
        db.setting("rooms")["enabled"] = True        # live for every rep
        db.setting("rooms")["test_only"] = False     # and for real leads
        real = db.__call__

        def blip(method, url, **kw):
            if "cockpit_sales_settings" in url and "key=in." in url:
                raise http.HttpError(503, "upstream connect error", b"", url)
            return real(method, url, **kw)

        code, out, _ = tdc.run(["deploy-check"], blip)  # type: ignore[arg-type]
        self.assertNotIn(
            "every switch is off", out,
            "the deploy check could not read the settings (one 503) and still printed that every switch is off, "
            f"exit {code}, while rooms.enabled is on and test_only is off:\n{out[-900:]}")
        self.assertNotEqual(code, 0, "a deploy check that never read the switches passed")



# ---------------------------------------------------------------------------
# 7. The follow-up agent's kill switch is read once a run. followups.run
#    takes `settings` from desk.py at the start and never reads
#    followups.enabled again, while one run drafts up to per_run (12) leads,
#    each with a model call of up to two tries of 300 s. A manager who
#    switches the agent off because its drafts are wrong (the wrong
#    language, a prompt gone bad) watches it write the rest of the run's
#    drafts into the reps' queue for minutes after the switch, each one a
#    press away from a lead (a rep's approval does not ask the switch).
# ---------------------------------------------------------------------------

class TheKillSwitchFlippedMidRun(unittest.TestCase):
    def test_no_draft_is_written_after_the_agent_is_switched_off(self):
        import json as _json
        from desk.supabase import Supabase
        from tests.fakes import FakeProvider
        from tests.test_followups import NOW as FNOW

        pg = FakePostgrest()
        settings = {"enabled": True, "per_run": 5, "per_day": 60, "quiet": {"from": 21, "to": 9}}
        pg.put("cockpit_sales_settings", {"key": "followups", "value": dict(settings)})
        for c in ("a", "b", "c"):
            pg.put("cockpit_sales_leads", {"contact_id": c, "name": "Omar", "email": f"{c}@x.co", "phone": "+96550000000",
                                           "assigned_to": None, "lead_created_at": (FNOW - timedelta(days=10)).isoformat(),
                                           "lead_class": "qualified", "dnd": False, "country": "Kuwait",
                                           "pipeline_name": "Sales Pipeline (2-Call)", "stage_name": "Intro Booked"})
            pg.put("cockpit_sales_inbox", {"conversation_id": f"cv-{c}", "contact_id": c, "last_direction": "inbound",
                                           "last_message_at": (FNOW - timedelta(hours=1)).isoformat(),
                                           "inbound_whatsapp_at": (FNOW - timedelta(hours=1)).isoformat()})
        draft = _json.dumps({"body": "Hi Omar, thanks for writing. Shall I call you today?", "subject": None,
                             "why": "He asked to be called.", "language": "en"})
        provider = FakeProvider([draft, draft, draft])
        real = provider.complete

        def writing(*a, **kw):
            out = real(*a, **kw)
            if len(provider.calls) == 1:
                # While the first draft is written, a manager switches the agent off.
                pg.one("cockpit_sales_settings", key="followups")["value"]["enabled"] = False
            return out

        provider.complete = writing  # type: ignore[method-assign]
        with mock.patch.object(http, "request", pg):
            out = fu.run(Supabase("https://example.supabase.co", "k"), provider, lambda _m: None,
                         settings=settings, ghl_token="", now=FNOW)
        written = [d for d in pg.rows("cockpit_sales_followups") if d.get("status") == "draft"]
        self.assertLessEqual(
            len(written), 1,
            f"the follow-up agent was switched off while it wrote its first draft, and the same run wrote "
            f"{len(written)} drafts for the reps to approve ({out.get('written')} written): followups.enabled is "
            "read once, when the run starts")



# ---------------------------------------------------------------------------
# 8. One opener HighLevel keeps refusing holds the whole batch behind it.
#    sales-api answers a HighLevel 400 or 422 whose words do not say the
#    contact is gone as a blip (followupAgent.ts highlevelBlip: 503,
#    hold_all, "HighLevel refused the send for a moment ... the openers wait
#    in the queue"). The desk stops the run and leaves that opener where it
#    is: first by send_after, so every run after asks it first, is refused
#    the same way, and stops. Only a sales-api 500 is moved behind the batch
#    (ERROR_WAIT). When the 422 is about this one contact (HighLevel will not
#    take a field of it), the other approved openers never go: they sit
#    until their 72 hours run out, red row and all, and the wave's next
#    batch, with the same lead in it, stalls the same way.
# ---------------------------------------------------------------------------

class OneRefusedOpenerHoldsTheBatch(unittest.TestCase):
    def test_the_rest_of_the_batch_goes_past_an_opener_highlevel_keeps_refusing(self):
        from tests.test_waves_breakit import due_draft
        pg = FakePostgrest()
        for i in range(4):
            due_draft(pg, i, wid="w1", send_after=wago(minutes=10 - i))
        blip = ("HighLevel refused the send for a moment (HighLevel said 422: customFields.0.field_value is not "
                "valid for this contact), so the openers wait in the queue. The next run tries again.")

        class OneBadContact(tw.Api):
            def __call__(self, action, payload):
                if payload["id"] == "f000":
                    self.calls.append((self.clock(), action, payload["id"]))
                    return 503, {"error": blip, "hold_all": True, "code": "outage"}
                return super().__call__(action, payload)

        clock = tw.Clock(WNOW)
        api = OneBadContact(pg, clock)
        lines = []
        for k in range(6):  # half an hour of the waves job, every five minutes
            clock.t = WNOW + timedelta(minutes=5 * k)
            with mock.patch.object(http, "request", pg):
                out = waves.send_due(tw.sb(), api, settings=tw.SETTINGS, w=waves.settings_of(tw.SETTINGS),
                                     waves=[{"id": "w1", "state": "running"}], guard=tw.GATE_OPEN, clock=clock,
                                     sleep=clock.sleep, budget_s=270, log=lambda _m: None, warn=lambda _m: None)
            lines.append(waves.words({"waves": [{"id": "w1", "state": "running"}], "sent": out})[1])
        sent = sorted({i for _, _, i in api.calls if i != "f000"})
        self.assertEqual(
            sent, ["f001", "f002", "f003"],
            f"one opener HighLevel refuses for its own contact was asked first by all six runs and stopped each: "
            f"the 3 approved openers behind it never went ({sent}); the row said {lines[-1]!r}")


if __name__ == "__main__":
    unittest.main()
