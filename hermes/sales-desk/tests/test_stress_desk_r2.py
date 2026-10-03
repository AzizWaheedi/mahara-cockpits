"""Stress round 2, the follow-up agent and its waves, desk side (2026-10-03):
a run that dies between an opener and its meta row, a paused wave's old
openers, refusals that are about the template and not the lead, a reply that
lands between the approval and the send, and the per-kind Off switch. Each
test asserts what must hold; a failing test names a defect for the fix lane.
Every lead, name and line is invented.

    python3 -m unittest tests.test_stress_desk_r2
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, waves  # noqa: E402
from tests import fakes  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import NOW, Api, Clock, ago, routes, run, seed, wave  # noqa: E402
from tests.test_waves_breakit import due_draft, enrolled_wave, row_ok, send  # noqa: E402

META = waves.META
MEMBERS = waves.MEMBERS
WAVES = waves.WAVES
FOLLOWUPS = waves.FOLLOWUPS
LEVELS = "cockpit_sales_followup_levels"
# The levels table (20261003c) as production keeps it: one row per kind_key.
fakes.PK.setdefault(LEVELS, ("kind_key",))


def openers(pg, wid="w1"):
    return [f for f in pg.rows(FOLLOWUPS)
            if f.get("segment") == "reactivate" and str((f.get("context") or {}).get("wave_id")) == wid]


# ---------------------------------------------------------------------------
# 1. A run that dies between the opener and its meta row: the next run adopts
#    the opener but never writes the meta row, so the opener has no wave_id
#    on the row every gate reads (followup.batch {wave_id}, send_due's wave
#    check, sales-api's followup.send_due wave check).
# ---------------------------------------------------------------------------

class AnAdoptedOpenerKeepsItsWave(unittest.TestCase):
    def test_a_run_killed_after_the_draft_leaves_an_opener_whose_meta_names_its_wave(self):
        class DiesAfterTheDraft(FakePostgrest):
            dead = False

            def __call__(self, method, url, **kw):
                out = super().__call__(method, url, **kw)
                if method == "POST" and url.split("?")[0].endswith(FOLLOWUPS) and not self.dead:
                    self.dead = True  # the opener landed; the run is killed before its meta row
                    raise http.HttpError(500, '{"message":"the run was killed"}', b"", url)
                return out

        pg = DiesAfterTheDraft()
        enrolled_wave(pg, n=1)
        try:
            run(pg)
        except Exception:  # noqa: BLE001 - the first run dies, by design
            pass
        run(pg, now=NOW + timedelta(minutes=5))
        mine = openers(pg)
        self.assertEqual(len(mine), 1, mine)
        m = pg.one(META, followup_id=mine[0]["id"])
        self.assertIsNotNone(m, "the adopted opener has no meta row: Approve all makes one with no wave_id, so a "
                                "paused or stopped wave no longer holds it")
        self.assertEqual(str((m or {}).get("wave_id")), "w1")

    def test_a_meta_row_that_failed_once_is_written_by_the_next_run(self):
        class MetaDown(FakePostgrest):
            down = 1

            def __call__(self, method, url, **kw):
                if method == "POST" and url.split("?")[0].endswith(META) and self.down:
                    self.down -= 1
                    raise http.HttpError(503, '{"message":"upstream timeout"}', b"", url)
                return super().__call__(method, url, **kw)

        pg = MetaDown()
        enrolled_wave(pg, n=1)
        out, _, _, logs = run(pg)
        self.assertEqual(out["drafted"].get("drafted"), 1, out["drafted"])
        run(pg, now=NOW + timedelta(minutes=5))
        f = openers(pg)[0]
        m = pg.one(META, followup_id=f["id"])
        self.assertIsNotNone(m, "the opener stays without a meta row for good (the warning says 'approved on its "
                                "own', but followup.approve refuses every backlog opener)")
        self.assertEqual(str((m or {}).get("wave_id")), "w1")


# ---------------------------------------------------------------------------
# 2. A paused wave's openers from an earlier day hold every other wave's batch.
# ---------------------------------------------------------------------------

class APausedWaveHoldsNoOtherWave(unittest.TestCase):
    def test_a_running_wave_gets_its_batch_while_a_paused_waves_old_openers_wait(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=3)  # w1, running, three leads waiting
        wave(pg, "wP", "never_booked", state="paused", enrolled_at=ago(days=2))
        # Yesterday's opener for the paused wave: nobody approved it before the manager paused the wave.
        pg.put("cockpit_sales_leads", {"contact_id": "old1", "country": "Kuwait", "tags": ["roas-qualified"]})
        pg.put(FOLLOWUPS, {"id": "fP", "contact_id": "old1", "segment": "reactivate", "channel": "whatsapp_template",
                           "status": "draft", "touch": 1, "created_at": ago(days=1), "expires_at": ago(days=-1),
                           "context": {"wave_id": "wP"}})
        pg.put(META, {"followup_id": "fP", "wave_id": "wP", "send_after": None, "held_by": None})
        pg.put(MEMBERS, {"wave_id": "wP", "contact_id": "old1", "arm": "wave", "state": "drafted", "followup_id": "fP"})
        out, _, _, _ = run(pg)
        self.assertNotIn("blocked", out["drafted"], out["drafted"])
        self.assertEqual(out["drafted"].get("drafted"), 3,
                         f"the running wave wrote nothing: {out['drafted'].get('waiting')}")


# ---------------------------------------------------------------------------
# 3. A refusal about the template (not set up, its HighLevel fields missing)
#    holds every opener of that template: never "set aside for a person"
#    draft by draft, 40 Release presses later.
# ---------------------------------------------------------------------------

class ATemplateRefusalIsNoLeadsRefusal(unittest.TestCase):
    WORDS = (
        # index.ts templateRoute: a manager switched the opener off, or cleared its workflow.
        "The cockpit_opener_ar template is not set up yet. A manager picks the HighLevel workflow that sends it, "
        "under Follow-ups, WhatsApp library.",
        # index.ts sendTemplate: the wa_fields setting lost its rep field.
        "The cockpit's two HighLevel contact fields are not set (setting wa_fields).",
    )

    def test_the_batch_waits_in_the_queue_and_nothing_is_set_aside(self):
        for words in self.WORDS:
            with self.subTest(words=words[:40]):
                pg = FakePostgrest()
                for i in range(4):
                    due_draft(pg, i, send_after=ago(minutes=10 - i))
                script = [(409, {"ok": False, "error": words})] * 4
                out, api = send(pg, Api(pg, Clock(NOW), script=script))
                held = [m["followup_id"] for m in pg.rows(META) if m.get("held_by")]
                self.assertEqual(held, [], f"set aside one by one for a person: {held}")
                self.assertEqual(out["set_aside"], 0)


# ---------------------------------------------------------------------------
# 4. A reply that lands between the approval and the send: sales-api takes the
#    opener back ("The conversation has moved on"). That is the opener working
#    as meant, not a refusal a person must look at, and three of them in a
#    row are no fault that turns the waves row red.
# ---------------------------------------------------------------------------

class AReplyMidBatchIsNoRefusal(unittest.TestCase):
    MOVED = ("The conversation has moved on since this draft was made, so it was not sent. Read it first; the agent "
             "writes a fresh draft if one is still due.")

    def test_openers_taken_back_for_a_reply_are_not_set_aside_and_stop_nothing(self):
        pg = FakePostgrest()
        for i in range(5):
            due_draft(pg, i, send_after=ago(minutes=10 - i))

        class MovedOn(Api):
            def __call__(self, action, payload):
                self.calls.append((self.clock(), action, payload["id"]))
                f = self.pg.one(FOLLOWUPS, id=payload["id"])
                if len(self.calls) <= 3:  # sendFollowup expires the draft, then refuses
                    f.update({"status": "expired", "error": "The conversation moved on at ..."})
                    return 409, {"ok": False, "error": AReplyMidBatchIsNoRefusal.MOVED}
                f["status"] = "sent"
                self.pg.put("cockpit_sales_messages", {"id": f"msg-{payload['id']}", "followup_id": payload["id"],
                                                       "contact_id": f["contact_id"], "sent_by": "sales-desk",
                                                       "created_at": self.clock().isoformat(), "state": "sent",
                                                       "channel": "whatsapp"})
                return 200, {"followup": {"id": payload["id"], "status": "sent"}}

        out, api = send(pg, MovedOn(pg, Clock(NOW)))
        self.assertEqual(out["set_aside"], 0, "an expired opener is 'set aside for a person' who never sees it")
        self.assertNotEqual(out["stop_kind"], "refusals", out["stopped"])
        self.assertEqual(out["sent"], 2, "the openers behind three taken-back ones did not go")
        ok, line = row_ok(out)
        self.assertTrue(ok, line)


# ---------------------------------------------------------------------------
# 5. The per-kind Off switch: followup.level accepts Off for a backlog opener
#    ("their level stays at Approve or Off") and audits it, but nothing reads
#    it: openers of that kind are still written and sent.
# ---------------------------------------------------------------------------

class TheOpenersOffSwitchHolds(unittest.TestCase):
    def _off(self, pg):
        for key in ("reactivate.ar.whatsapp_template", "reactivate.en.whatsapp_template"):
            pg.put(LEVELS, {"kind_key": key, "level": "off", "set_by": "boss@stress.invalid"})

    def test_no_opener_is_written_while_its_kind_is_off(self):
        pg = FakePostgrest()
        enrolled_wave(pg, n=3)
        self._off(pg)
        out, _, _, _ = run(pg)
        self.assertEqual(openers(pg), [], "openers were written for a kind a manager switched off")

    def test_no_approved_opener_goes_while_its_kind_is_off(self):
        pg = FakePostgrest()
        for i in range(2):
            due_draft(pg, i)
            pg.one(META, followup_id=f"f{i:03d}")["kind_key"] = "reactivate.ar.whatsapp_template"
        self._off(pg)
        out, api = send(pg)
        self.assertEqual(api.calls, [], "an opener went while its kind was switched off")


# ---------------------------------------------------------------------------
# 6. A crash in one wave's enrolment (a statement timeout on the members'
#    insert, an outage reading the pool) kills the whole run before
#    send_due: every other wave's approved openers wait, run after run.
# ---------------------------------------------------------------------------

class OneWavesEnrolmentNeverStopsTheOthersSends(unittest.TestCase):
    def test_approved_openers_still_go_while_a_new_wave_cannot_enrol(self):
        class EnrolDown(FakePostgrest):
            def __call__(self, method, url, **kw):
                if method == "POST" and url.split("?")[0].endswith(MEMBERS):
                    raise http.HttpError(500, '{"message":"canceling statement due to statement timeout"}', b"", url)
                return super().__call__(method, url, **kw)

        pg = EnrolDown()
        routes(pg)
        wave(pg, "w1", "no_show_cancelled", enrolled_at=ago(days=1))
        for i in range(2):
            due_draft(pg, i)  # approved this morning, due now
        seed(pg, "x1", "never_booked", days=3)
        wave(pg, "w2", "never_booked")  # started a minute ago; its enrolment fails every run
        try:
            out, api, _, _ = run(pg)
        except http.HttpError as e:
            self.fail(f"the whole waves run died on one wave's enrolment, so no approved opener went: {e}")
        self.assertEqual(out["sent"]["sent"], 2, out["sent"])


if __name__ == "__main__":
    unittest.main()
