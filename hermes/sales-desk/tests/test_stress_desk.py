"""Stress round 1, the follow-up agent and its waves (2026-10-03): two desk
runs at once, a crash in the middle of a send, refusals, a stopped or paused
wave, a reply or a booking that lands between the draft and the send, and the
database's own rules as production keeps them. Each test asserts what must
hold; a test that fails names a defect the fix lane closes. Every lead, name
and line is invented.

    python3 -m unittest tests.test_stress_desk
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http, waves  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import (GATE_OPEN, NOW, SETTINGS, Api, Clock, Ghl, ago, members, routes, run, sb, seed,  # noqa: E402
                              wave)
from tests.test_waves_breakit import due_draft, enrolled_wave, send  # noqa: E402

META = waves.META
MEMBERS = waves.MEMBERS
WAVES = waves.WAVES
FOLLOWUPS = waves.FOLLOWUPS
MESSAGES = waves.MESSAGES


class ProductionPostgrest(FakePostgrest):
    """The fake with one more rule production keeps (read from pg_constraint
    on 2026-10-03, and proved in a rolled-back block by
    supabase/migrations/tests/stress_desk.py):

        cockpit_sales_followup_wave_members_followup_id_fkey
        FOREIGN KEY (followup_id) REFERENCES cockpit_sales_followups(id)
        ON DELETE SET NULL, not deferrable

    PostgREST answers a foreign key violation (23503) with a 409."""

    def _violation(self, table, key, row, url):
        bad = super()._violation(table, key, row, url)
        if bad or not self.enforce:
            return bad
        fid = row.get("followup_id")
        if table == MEMBERS and fid is not None and (str(fid),) not in self.tables[FOLLOWUPS]:
            return http.HttpError(409, '{"code":"23503","message":"insert or update on table '
                                       '\\"cockpit_sales_followup_wave_members\\" violates foreign key constraint '
                                       '\\"cockpit_sales_followup_wave_members_followup_id_fkey\\""}', b"", url)
        return None


def trimmed(t) -> str:
    """A time as PostgREST returns it: Postgres trims trailing zeros from the
    fraction (to_json('…:00.120000+00') is '…:00.12+00:00', checked on
    Creative Triage 2026-10-03), so one stored time in ten comes back with
    fewer than six digits, which Python 3.9's fromisoformat refuses."""
    return t.strftime("%Y-%m-%dT%H:%M:%S") + ".12+00:00"


# ---------------------------------------------------------------------------
# 1. The member is marked first with a desk-made id; production's foreign key
#    refuses it, so no opener can ever be written.
# ---------------------------------------------------------------------------

class TheForeignKeyOnTheMembersFollowupId(unittest.TestCase):
    def test_the_days_openers_are_written_against_productions_foreign_key(self):
        pg = ProductionPostgrest()
        enrolled_wave(pg, n=3)
        try:
            out, _, _, _ = run(pg)
        except http.HttpError as e:  # what production does today: the whole waves job dies, every five minutes
            self.fail(f"the waves job died on the members' foreign key: {str(e)[:160]}")
        self.assertEqual(out["drafted"].get("drafted"), 3, out["drafted"])
        self.assertEqual(len([f for f in pg.rows(FOLLOWUPS) if f["segment"] == "reactivate"]), 3)
        for m in members(pg, "w1", state="drafted"):
            self.assertIsNotNone(pg.one(FOLLOWUPS, id=m["followup_id"]))

    def test_a_run_that_dies_after_the_draft_still_never_writes_a_second_opener(self):
        # Whatever order the fix picks, a run that stops between its two writes
        # must leave the next run adopting the opener, not writing another.
        class DiesAfterTheDraft(ProductionPostgrest):
            dead = False

            def __call__(self, method, url, **kw):
                out = super().__call__(method, url, **kw)
                if method == "POST" and url.split("?")[0].endswith(FOLLOWUPS) and not self.dead:
                    self.dead = True  # the draft landed; the run is killed before its next write
                    raise http.HttpError(500, '{"message":"the run was killed"}', b"", url)
                return out

        pg = DiesAfterTheDraft()
        enrolled_wave(pg, n=1)
        try:
            run(pg)
        except Exception:  # noqa: BLE001 - the first run dies, by design or on the foreign key
            pass
        try:
            run(pg, now=NOW + timedelta(minutes=5))
        except http.HttpError as e:
            self.fail(f"the second run died on the members' foreign key: {str(e)[:160]}")
        openers = [f for f in pg.rows(FOLLOWUPS) if f["segment"] == "reactivate"]
        self.assertLessEqual(len(openers), 1, openers)


# ---------------------------------------------------------------------------
# 2. Postgres trims trailing zeros; the desk's _ts (Python 3.9 fromisoformat)
#    reads about one stored time in ten as no time at all.
# ---------------------------------------------------------------------------

class PostgresTrimsTheFraction(unittest.TestCase):
    def test_the_parser_reads_every_time_postgrest_returns(self):
        for s in ("2026-10-31T08:00:00.12+00:00", "2026-10-31T11:00:00.1+03:00", "2026-10-31T08:00:00.12345+00:00",
                  "2026-10-31T08:00:00.123456+00:00", "2026-10-31T08:00:00+00:00"):
            self.assertIsNotNone(fu._ts(s), s)

    def test_a_reps_pause_still_holds_when_its_time_comes_back_trimmed(self):
        rows = {"x1": [{"contact_id": "x1", "said_at": trimmed(NOW - timedelta(days=1)), "kind": "manual",
                        "state": "paused", "paused_until": trimmed(NOW + timedelta(days=29))}]}
        self.assertIsNotNone(fu.hold_of(rows, "x1", NOW), "a lead a rep paused would get the opener")
        rows = {"x1": [{"contact_id": "x1", "said_at": trimmed(NOW - timedelta(days=1)), "kind": "pause",
                        "state": "paused", "paused_until": trimmed(NOW + timedelta(days=29))}]}
        self.assertIsNotNone(fu.hold_of(rows, "x1", NOW), "a lead who wrote 'not interested' would get the opener")

    def test_a_paused_lead_gets_no_opener_end_to_end(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=2)
        pg.put("cockpit_sales_followup_stops", {"contact_id": "n00", "said_at": trimmed(NOW - timedelta(days=2)),
                                                "kind": "manual", "state": "paused",
                                                "paused_until": trimmed(NOW + timedelta(days=28))})
        run(pg)
        self.assertNotIn("n00", {f["contact_id"] for f in pg.rows(FOLLOWUPS)},
                         "the opener was written for a lead a rep had paused")

    def test_the_gap_holds_when_the_last_sends_time_comes_back_trimmed(self):
        pg = FakePostgrest()
        pg.put(MESSAGES, {"id": "before", "contact_id": "zz", "sent_by": "sales-desk", "state": "sent",
                          "channel": "whatsapp", "created_at": trimmed(NOW - timedelta(seconds=10))})
        due_draft(pg, 1)
        out, api = send(pg)
        self.assertEqual(len(api.calls), 1)
        waited = (api.calls[0][0] - NOW).total_seconds()
        self.assertGreaterEqual(waited, 34, "the first send of a run went 10 s after the last one")

    def test_an_opener_whose_send_time_comes_back_trimmed_is_still_measured(self):
        pg = FakePostgrest()
        wave(pg, "w1", "no_show_cancelled")
        pg.put(MEMBERS, {"wave_id": "w1", "contact_id": "m1", "arm": "wave", "state": "sent",
                         "sent_at": trimmed(NOW - timedelta(days=15))})
        with mock.patch.object(http, "request", pg):
            out = waves.outcomes(sb(), ["w1"], NOW)
        self.assertEqual(out["closed"], 1, "the member stays 'sent' for ever and the wave never settles")


# ---------------------------------------------------------------------------
# 3. A send that stopped halfway is drafted again: a second opener.
# ---------------------------------------------------------------------------

class ACrashMidSendIsNeverASecondOpener(unittest.TestCase):
    def _drafted(self, pg, *, status, error, message_state, provider_status=None, ghl_id=None):
        enrolled_wave(pg, n=1)
        m = members(pg, "w1")[0]
        c = m["contact_id"]
        pg.put(FOLLOWUPS, {"id": "fx", "contact_id": c, "segment": "reactivate", "channel": "whatsapp_template",
                           "status": status, "error": error, "touch": 1, "created_at": ago(hours=3),
                           "decided_at": ago(hours=2), "context": {"wave_id": "w1"}})
        m.update({"state": "drafted", "followup_id": "fx", "drafted_at": ago(hours=3)})
        pg.put(MESSAGES, {"id": "mx", "followup_id": "fx", "contact_id": c, "sent_by": "sales-desk", "via": "workflow",
                          "state": message_state, "provider_status": provider_status, "ghl_message_id": ghl_id,
                          "channel": "whatsapp", "created_at": ago(hours=2)})
        return c

    def test_free_stucks_may_not_have_gone_is_not_retried(self):
        pg = FakePostgrest()
        c = self._drafted(pg, status="failed", message_state="sending",
                          error=("The send stopped halfway and may not have gone out. Read the conversation in "
                                 "HighLevel before writing to the lead again."))
        with mock.patch.object(http, "request", pg):
            waves.sync(sb(), ["w1"], NOW)
        m = pg.one(MEMBERS, wave_id="w1", contact_id=c)
        self.assertNotEqual(m["state"], "waiting", "a send that may have gone is drafted again tomorrow")

    def test_a_template_that_went_but_was_marked_failed_counts_as_sent(self):
        # sendFollowup marks the draft failed for any error that is not a
        # Refusal, even one thrown after HighLevel's workflow fired (a database
        # timeout on the message's last write): the message row says it went.
        pg = FakePostgrest()
        c = self._drafted(pg, status="failed", message_state="sending", provider_status="enrolled",
                          error="That did not work: canceling statement due to statement timeout")
        with mock.patch.object(http, "request", pg):
            waves.sync(sb(), ["w1"], NOW)
        m = pg.one(MEMBERS, wave_id="w1", contact_id=c)
        self.assertNotEqual(m["state"], "waiting")

    def test_the_lead_never_gets_a_second_opener_the_next_day(self):
        pg = FakePostgrest()
        c = self._drafted(pg, status="failed", message_state="sending",
                          error=("The send stopped halfway and may not have gone out. Read the conversation in "
                                 "HighLevel before writing to the lead again."))
        run(pg, now=NOW + timedelta(minutes=5))
        # Monday 12:00 Kuwait: past the 20 hours sync waits, inside the drafting hours.
        run(pg, now=NOW + timedelta(hours=26))
        openers = [f for f in pg.rows(FOLLOWUPS) if f["contact_id"] == c and f["segment"] == "reactivate"]
        self.assertEqual(len(openers), 1, [(f["id"], f["status"]) for f in openers])


# ---------------------------------------------------------------------------
# 4. Two waves runs at once (a manual run outside flock): the day's room and
#    the gap between sends must still hold.
# ---------------------------------------------------------------------------

class TwoRunsAtOnce(unittest.TestCase):
    def test_two_send_runs_that_both_pass_the_gap_check_never_send_together(self):
        pg = FakePostgrest()
        for i in range(4):
            due_draft(pg, i, send_after=ago(minutes=10 - i))
        clock = Clock(NOW)
        inner: list = []

        class Racing(Api):
            def __call__(self, action, payload):
                if not inner:
                    inner.append("B")
                    # Run B gets its turn after run A passed its gap check and
                    # before A's message row lands (sales-api writes it a few
                    # seconds into the call, after its checks and a HighLevel read).
                    waves.send_due(sb(), self, settings=SETTINGS, w=waves.settings_of(SETTINGS),
                                   waves=[{"id": "w1", "state": "running"}], guard=GATE_OPEN,
                                   clock=clock, sleep=clock.sleep, budget_s=60, log=lambda _m: None,
                                   warn=lambda _m: None)
                return super().__call__(action, payload)

        api = Racing(pg, clock)
        with mock.patch.object(http, "request", pg):
            waves.send_due(sb(), api, settings=SETTINGS, w=waves.settings_of(SETTINGS),
                           waves=[{"id": "w1", "state": "running"}], guard=GATE_OPEN, clock=clock, sleep=clock.sleep,
                           budget_s=200, log=lambda _m: None, warn=lambda _m: None)
        times = sorted(t for t, _, _ in api.calls)
        gaps = [(b - a).total_seconds() for a, b in zip(times, times[1:])]
        self.assertTrue(all(g >= 45 for g in gaps), f"sends {gaps} seconds apart")

    def test_two_drafting_runs_never_write_more_than_the_days_room(self):
        pg = FakePostgrest()
        routes(pg)
        for i in range(90):
            seed(pg, f"n{i:02d}", "no_show_cancelled", days=i + 1)
        wave(pg, "w1", "no_show_cancelled")
        run(pg, guard={})  # enrol only (the gate shut)
        for m in members(pg, "w1"):
            m.update({"arm": "wave", "state": "waiting", "due_at": None})
        pg.one(WAVES, id="w1").update({"state": "running", "done_reason": None})
        started: list = []

        class SecondRun(Ghl):
            def __call__(self, method, url, **kw):
                if "leadconnectorhq" in url and not started:
                    started.append(True)
                    run(pg, Ghl(pg))  # a manual run while the cron's run reads HighLevel
                return super().__call__(method, url, **kw)

        run(pg, SecondRun(pg))
        openers = [f for f in pg.rows(FOLLOWUPS) if f["segment"] == "reactivate"]
        self.assertLessEqual(len(openers), SETTINGS["waves"]["per_day"], f"{len(openers)} openers written in one day")


# ---------------------------------------------------------------------------
# 5. A reply that lands between the draft and the send.
# ---------------------------------------------------------------------------

class AReplyMidBatch(unittest.TestCase):
    def test_an_open_opener_never_holds_back_the_reply_to_a_lead_who_wrote_in(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=1)
        c = members(pg, "w1")[0]["contact_id"]
        pg.put(FOLLOWUPS, {"id": "fo", "contact_id": c, "segment": "reactivate", "channel": "whatsapp_template",
                           "status": "draft", "touch": 1, "created_at": ago(hours=2), "expires_at": ago(hours=-46),
                           "context": {"wave_id": "w1"}, "body": "Hi Omar"})
        pg.put(META, {"followup_id": "fo", "wave_id": "w1", "send_after": None, "held_by": None})
        pg.one(MEMBERS, wave_id="w1", contact_id=c).update({"state": "drafted", "followup_id": "fo"})
        # The lead writes in an hour after the opener was drafted, before anyone approved the batch.
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv1", "contact_id": c, "last_message_at": ago(hours=1),
                                       "last_direction": "inbound", "last_type": "TYPE_WHATSAPP",
                                       "inbound_whatsapp_at": ago(hours=1)})
        run(pg, now=NOW + timedelta(minutes=5))
        with mock.patch.object(http, "request", pg):
            fu.close_gone(sb(), NOW + timedelta(minutes=7))
            fu.expire_stale(sb(), NOW + timedelta(minutes=7))
        self.assertNotEqual(pg.one(FOLLOWUPS, id="fo")["status"], "draft",
                            "the opener stays open, so the follow-up agent writes no reply for up to 48 hours")


# ---------------------------------------------------------------------------
# 6. A booking that lands between the approval and the send.
# ---------------------------------------------------------------------------

class ABookingMidBatch(unittest.TestCase):
    def test_an_approved_opener_never_goes_to_a_lead_who_has_since_booked(self):
        pg = FakePostgrest()
        wave(pg, "w1", "no_show_cancelled")
        due_draft(pg, 1)
        f = pg.one(FOLLOWUPS, id="f001")
        f.update({"created_at": ago(hours=3), "context": {"wave_id": "w1"}})
        pg.put(MEMBERS, {"wave_id": "w1", "contact_id": "p001", "arm": "wave", "state": "drafted",
                         "followup_id": "f001"})
        # A rep booked the lead an intro for tomorrow after the opener was approved.
        pg.put("cockpit_sales_calendar", {"appointment_id": "p001-new", "contact_id": "p001", "call_type": "intro",
                                          "status": "confirmed", "start_at": (NOW + timedelta(days=1)).isoformat(),
                                          "booked_at": ago(minutes=30)})
        with mock.patch.object(http, "request", pg):
            fu.close_gone(sb(), NOW)
        out, api = send(pg)
        self.assertEqual([i for _, _, i in api.calls], [], "'How are you?' went to a lead with a call booked tomorrow")


# ---------------------------------------------------------------------------
# 7. A refusal about the draft's own state is no refusal of the lead.
# ---------------------------------------------------------------------------

class StateRefusalsAreNotSetAside(unittest.TestCase):
    WORDS = (
        # sales-api's clock a second behind the VPS's: send_after not reached there yet.
        "This draft is not approved to go yet.",
        # a manager paused the wave between the desk's read and sales-api's.
        "This opener was approved for a wave that is paused or stopped, so it was not sent.",
        # a second run (or a rep) is sending it right now.
        "Someone else has just dealt with this draft.",
        "This draft was already sending.",
    )

    def test_the_draft_stays_in_the_queue_and_is_not_put_in_front_of_a_person(self):
        for words in self.WORDS:
            with self.subTest(words=words):
                pg = FakePostgrest()
                due_draft(pg, 1)
                out, api = send(pg, Api(pg, Clock(NOW), script=[(409, {"ok": False, "error": words})]))
                m = pg.one(META, followup_id="f001")
                self.assertIsNone(m.get("held_by"), f"set aside for a person: {words}")
                self.assertEqual(out["refused"], 0)


if __name__ == "__main__":
    unittest.main()
