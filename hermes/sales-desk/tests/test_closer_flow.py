"""What the closer waiting on a proposal sees while the desk cannot draft it,
and what stops a draft. From the closer-flow review of 2026-10-04:

- a lapsed VPS sign-in is found by a one-token ping before any request is
  claimed or any call read from Fathom, and hands over to the fallback there;
- every proposal held by an outage carries one sentence for the closer (what
  is wrong, that it carries on by itself, when to tell the CEO), whether the
  outage was found before a request was claimed or while it ran; the fix
  stays on the request;
- a rebuild never waits behind drafts: it is read first whatever its age,
  and an outage holds only the requests of its own kind;
- an archived proposal is never drafted, never rebuilt and never brought
  back: its request is closed as cancelled.

    python3 -m unittest tests.test_closer_flow
"""
from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from typing import Any, Optional
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"
for _name in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "FATHOM_API_KEY", "SALES_MODEL_PROVIDER",
              "SALES_PROPOSAL_MODEL", "SALES_MODEL_FALLBACK", "SALES_FALLBACK_MODEL", "SALES_FALLBACK_JOBS"):
    os.environ.pop(_name, None)

from desk import fathom as fathom_mod, http, model, queue  # noqa: E402
from desk.errors import NotNow  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests import fakes  # noqa: E402
from tests.fakes import FakeFathom, FakePostgrest, FakeRenderer, TEST_OFFER, specific_deal, transcript, \
    triage_answer  # noqa: E402
from tests.test_desk import cfg_in  # noqa: E402
from tests.test_fallback import CLAUDE, Named, signed_out  # noqa: E402

REQ = "cockpit_sales_requests"
PROP = "cockpit_sales_proposals"
TELL = "if it is still waiting in an hour, tell the CEO"


class Pinged(Named):
    """A provider the desk can ping: each ping answers from its own script
    (an exception to raise, or anything else for an answer)."""

    def __init__(self, name: str, model_name: str, replies: list[Any], pings: Optional[list[Any]] = None):
        super().__init__(name, model_name, replies)
        self.pings = list(pings or [])
        self.pinged = 0

    def ping(self, timeout: float = 60) -> str:
        self.pinged += 1
        r = self.pings.pop(0) if self.pings else "ok"
        if isinstance(r, BaseException):
            raise r
        return f"{self.model} answered"


class Base(unittest.TestCase):
    fallback = "none"

    def setUp(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        self.cfg = cfg_in(tmp)
        self.cfg.provider, self.cfg.model, self.cfg.fallback = "vps", "opus", self.fallback
        self.pg = FakePostgrest()
        self.sb = Supabase(self.cfg.supabase_url, self.cfg.supabase_key)
        patch = mock.patch.object(http, "request", self.pg)
        patch.start()
        self.addCleanup(patch.stop)
        self.pg.put("cockpit_sales_leads", {"contact_id": "c-1", "name": "Fahad Sample",
                                            "company": "Mirage Test Contracting"})
        self.pg.put("cockpit_sales_recordings", {"recording_id": "100", "contact_id": "c-1", "matched_by": "email",
                                                 "recorded_by": "rep.one@maharamedia.com",
                                                 "started_at": "2099-01-01T10:00:00Z"})
        self.fathom = FakeFathom(transcripts={"100": fakes.fathom_turns(transcript())})

    def draft(self, rid: str, pid: str, at: str = "2099-01-01T11:00:00Z", status: str = "drafting") -> None:
        self.pg.put(REQ, {"id": rid, "kind": "proposal", "contact_id": "c-1",
                          "params": {"lang": "en", "proposal_id": pid, "offer": {"payment": "pif", "guarantee": False}},
                          "status": "queued", "requested_by": "rep.one@maharamedia.com", "requested_at": at,
                          "claimed_at": None, "claimed_by": None, "attempts": 0, "finished_at": None, "error": None,
                          "result": None})
        self.pg.put(PROP, {"id": pid, "request_id": rid, "contact_id": "c-1", "lang": "en", "status": status,
                           "deal": None, "validation": None, "html_path": None, "pdf_path": None, "error": None,
                           "created_by": "rep.one@maharamedia.com", "created_at": at, "updated_at": at})

    def rebuild(self, rid: str, pid: str, at: str = "2099-01-01T12:00:00Z", status: str = "drafting") -> None:
        deal = specific_deal()
        deal["cost"]["close"] = "USD 4,000"
        self.pg.put(PROP, {"id": pid, "request_id": rid, "contact_id": "c-1", "lang": "en", "status": status,
                           "deal": deal, "validation": {}, "html_path": f"proposals/{pid}/v1.html", "pdf_path": None,
                           "model": "vps:opus", "error": None, "created_by": "rep.one@maharamedia.com",
                           "created_at": "2099-01-01T10:00:00Z", "updated_at": "2099-01-01T10:00:00Z"})
        self.pg.put(REQ, {"id": rid, "kind": "proposal", "contact_id": "c-1",
                          "params": {"proposal_id": pid, "rebuild": True, "lang": "en"}, "status": "queued",
                          "requested_by": "rep.one@maharamedia.com", "requested_at": at, "claimed_at": None,
                          "claimed_by": None, "attempts": 0, "finished_at": None, "error": None, "result": None})

    def worker(self, primary: Any, fallback: Any = None, fathom: Any = None) -> queue.Worker:
        return queue.Worker(self.cfg, lambda _m: None, self.sb, host="test-box", provider=primary,
                            fallback=fallback, fathom=fathom or (lambda cfg, log: self.fathom),
                            renderer=FakeRenderer(), offer=TEST_OFFER)

    def req(self, rid: str) -> dict[str, Any]:
        return self.pg.one(REQ, id=rid)

    def prop(self, pid: str) -> dict[str, Any]:
        return self.pg.one(PROP, id=pid)


# ---------------------------------------------------------------------------
class ThePing(Base):
    """A lapsed VPS sign-in, found before anything is claimed."""

    def test_without_a_fallback_every_draft_waits_unclaimed_and_its_closer_is_told(self):
        self.draft("req-1", "p-1", "2099-01-01T11:01:00Z")
        self.draft("req-2", "p-2", "2099-01-01T11:02:00Z")
        vps = Pinged("vps", "opus", [], pings=[signed_out()])
        out = self.worker(lambda c, l: vps).run()
        self.assertEqual((out["waiting"], out["done"], vps.pinged, vps.calls), (2, 0, 1, []))
        self.assertEqual(self.fathom.read, [])
        for rid, pid in (("req-1", "p-1"), ("req-2", "p-2")):
            r, p = self.req(rid), self.prop(pid)
            self.assertEqual((r["status"], r["attempts"], r["claimed_by"]), ("queued", 0, None))
            self.assertEqual(r["error"], model.VPS_SIGN_IN)  # the fix, for whoever fixes it
            self.assertEqual(p["status"], "drafting")
            self.assertEqual(p["error"], "The proposal writer cannot work right now: the Claude sign-in on the VPS "
                                         "has lapsed. This proposal waits and drafts by itself once that is fixed, "
                                         f"so there is no need to ask again; {TELL}.")
            self.assertNotIn("/login", p["error"])
        self.assertEqual(out["blocked"], model.VPS_SIGN_IN)

    def test_with_a_fallback_the_lapse_hands_over_before_the_first_draft(self):
        self.cfg.fallback = "openrouter"
        self.draft("req-1", "p-1")
        vps = Pinged("vps", "opus", [], pings=[signed_out()])
        router = Named("openrouter", CLAUDE, [triage_answer(), specific_deal()])
        out = self.worker(lambda c, l: vps, lambda c, l: router).run()
        self.assertEqual((out["done"], vps.calls, len(router.calls)), (1, [], 2))
        p = self.prop("p-1")
        self.assertEqual((p["status"], p["model"], p["error"]), ("ready", f"openrouter:{CLAUDE}", None))
        self.assertIn("because the Claude sign-in on the VPS has lapsed", p["validation"]["notes"][0])

    def test_a_ping_that_merely_fails_holds_nothing_and_the_draft_asks_anyway(self):
        self.draft("req-1", "p-1")
        vps = Pinged("vps", "opus", [triage_answer(), specific_deal()], pings=[model.ModelError("timed out")])
        out = self.worker(lambda c, l: vps).run()
        self.assertEqual((out["done"], out["waiting"], vps.pinged), (1, 0, 1))
        self.assertEqual(self.prop("p-1")["status"], "ready")

    def test_one_ping_a_run_and_none_without_a_draft_to_claim(self):
        self.draft("req-1", "p-1", "2099-01-01T11:01:00Z")
        self.draft("req-2", "p-2", "2099-01-01T11:02:00Z")
        vps = Pinged("vps", "opus", [triage_answer(), specific_deal(), triage_answer(), specific_deal()])
        self.assertEqual(self.worker(lambda c, l: vps).run()["done"], 2)
        self.assertEqual(vps.pinged, 1)

        self.rebuild("req-9", "p-9")
        idle = Pinged("vps", "opus", [])
        self.assertEqual(self.worker(lambda c, l: idle).run()["done"], 1)
        self.assertEqual(idle.pinged, 0)

    def test_an_empty_queue_makes_no_provider_and_spends_no_call(self):
        # The cron runs every two minutes: with nothing queued, nothing is asked.
        def never_made(cfg: Any, log: Any) -> Any:
            raise AssertionError("a provider was made with nothing queued")

        out = self.worker(never_made, fallback=never_made).run()
        self.assertEqual((out["seen"], out["done"], out["waiting"]), (0, 0, 0))
        self.assertNotIn("blocked", out)

    def test_a_keyed_provider_is_never_pinged(self):
        self.cfg.provider, self.cfg.model = "openai", "gpt-5"
        self.draft("req-1", "p-1")
        openai = Pinged("openai", "gpt-5", [triage_answer(), specific_deal()], pings=[AssertionError("pinged")])
        self.assertEqual(self.worker(lambda c, l: openai).run()["done"], 1)
        self.assertEqual(openai.pinged, 0)


# ---------------------------------------------------------------------------
class TheCloserIsTold(Base):
    """One sentence on the proposal for every wait, the fix on the request."""

    def test_a_lapse_met_mid_draft_without_a_fallback_is_the_closers_sentence_not_the_fix(self):
        self.draft("req-1", "p-1", "2099-01-01T11:01:00Z")
        self.draft("req-2", "p-2", "2099-01-01T11:02:00Z")
        vps = Named("vps", "opus", [signed_out()])  # no ping: met at the first call
        out = self.worker(lambda c, l: vps).run()
        self.assertEqual(out["waiting"], 2)
        first, second = self.prop("p-1"), self.prop("p-2")
        self.assertTrue(first["error"].startswith("The proposal writer cannot work right now: the Claude sign-in"))
        self.assertEqual(second["error"], first["error"])
        self.assertEqual((self.req("req-1")["attempts"], self.req("req-2")["attempts"]), (0, 0))
        self.assertEqual(self.req("req-2")["claimed_by"], None)
        self.assertEqual(self.req("req-1")["error"], model.VPS_SIGN_IN)

    def test_a_missing_bucket_tells_the_closer_of_a_draft_and_of_a_rebuild(self):
        self.draft("req-1", "p-1")
        self.rebuild("req-9", "p-9")
        self.pg.buckets.clear()
        out = self.worker(fakes.never).run()
        self.assertEqual(out["waiting"], 2)
        self.assertIn("bucket is missing", self.req("req-1")["error"])
        self.assertIn("20260924b_sales_proposal_files.sql", self.req("req-9")["error"])
        self.assertEqual(self.prop("p-1")["error"],
                         "The proposal writer cannot work right now: the sales-proposals bucket is missing. This "
                         f"proposal waits and drafts by itself once that is fixed, so there is no need to ask again; "
                         f"{TELL}.")
        self.assertIn("waits and is rebuilt with your figures by itself", self.prop("p-9")["error"])
        self.assertNotIn(".sql", self.prop("p-9")["error"])

    def test_a_missing_fathom_key_tells_the_closer(self):
        self.draft("req-1", "p-1")
        out = self.worker(lambda c, l: Named("vps", "opus", []), fathom=queue.fathom_client).run()
        self.assertEqual(out["waiting"], 1)
        self.assertIn("FATHOM_API_KEY is not set", self.req("req-1")["error"])
        self.assertTrue(self.prop("p-1")["error"].startswith(
            "The proposal writer cannot work right now: FATHOM_API_KEY is not set. This proposal waits"))

    def test_a_note_never_lands_on_a_proposal_that_is_no_longer_drafting(self):
        self.draft("req-1", "p-1", status="needs_input")
        self.pg.buckets.clear()
        self.worker(fakes.never).run()
        self.assertIsNone(self.prop("p-1")["error"])

    def test_closer_wait_keeps_a_sentence_the_outage_brought(self):
        e = model.ModelUnreachable("whole fix", closer="The closer's own sentence.")
        self.assertEqual(queue.closer_wait(e), "The closer's own sentence.")
        plain = NotNow("Fathom refused the key (401). Set FATHOM_API_KEY again; drafting waits until then.")
        self.assertTrue(queue.closer_wait(plain).startswith(
            "The proposal writer cannot work right now: Fathom refused the key. "))


# ---------------------------------------------------------------------------
class FathomDown(Base):
    """Fathom down is an outage to wait out, not four tries to fail."""

    def fathom_failing(self, status: int, message: str) -> FakeFathom:
        class Down(FakeFathom):
            def transcript(self, recording_id: Any) -> list[dict[str, Any]]:
                self.read.append(str(recording_id))
                raise fathom_mod.FathomError(status, message)

        return Down()

    def test_fathom_unavailable_waits_untried_and_the_closer_is_told(self):
        self.draft("req-1", "p-1", "2099-01-01T11:01:00Z")
        self.draft("req-2", "p-2", "2099-01-01T11:02:00Z")
        down = self.fathom_failing(503, "Fathom answered 503 on /recordings/100/transcript: unavailable")
        vps = Pinged("vps", "opus", [])
        out = self.worker(lambda c, l: vps, fathom=lambda c, l: down).run()
        self.assertEqual((out["waiting"], out["failed"], out["retry"], vps.calls), (2, 0, 0, []))
        self.assertEqual(down.read, ["100"])  # the second draft was not tried against a Fathom that is down
        for rid, pid in (("req-1", "p-1"), ("req-2", "p-2")):
            self.assertEqual((self.req(rid)["status"], self.req(rid)["attempts"]), ("queued", 0))
            self.assertIn("Fathom is not answering (503)", self.req(rid)["error"])
            self.assertEqual(self.prop(pid)["status"], "drafting")
            self.assertTrue(self.prop(pid)["error"].startswith(
                "The proposal writer cannot work right now: Fathom is not answering. "), self.prop(pid)["error"])
            self.assertIn(TELL, self.prop(pid)["error"])

    def test_unreachable_and_rate_limited_wait_too_but_a_404_is_a_try(self):
        for status, message in ((0, "Fathom did not answer on /recordings/100/transcript"),
                                (429, "Fathom answered 429 on /recordings/100/transcript: slow down")):
            self.assertTrue(queue.fathom_down(fathom_mod.FathomError(status, message)), status)
        for status, message in ((404, "Fathom answered 404 on /recordings/100/transcript: not found"),
                                (500, "Fathom answered 500 on /recordings/100/transcript"),
                                (0, "Fathom sent something that is not JSON on /recordings/100/transcript")):
            self.assertFalse(queue.fathom_down(fathom_mod.FathomError(status, message)), status)
        self.draft("req-1", "p-1")
        gone = self.fathom_failing(404, "Fathom answered 404 on /recordings/100/transcript: not found")
        out = self.worker(lambda c, l: Pinged("vps", "opus", []), fathom=lambda c, l: gone).run()
        self.assertEqual((out["retry"], self.req("req-1")["attempts"]), (1, 1))


# ---------------------------------------------------------------------------
class RebuildsGoFirst(Base):
    def test_a_rebuild_newer_than_a_full_runs_worth_of_waiting_drafts_is_still_done(self):
        for i in range(1, 4):
            self.draft(f"req-{i}", f"p-{i}", f"2099-01-01T11:0{i}:00Z")
        self.rebuild("req-9", "p-9", "2099-01-01T12:00:00Z")
        self.assertEqual(self.cfg.requests_per_run, 3)
        vps = Pinged("vps", "opus", [], pings=[signed_out()])
        out = self.worker(lambda c, l: vps).run()
        self.assertEqual(self.req("req-9")["status"], "done")
        self.assertEqual(self.prop("p-9")["status"], "ready")
        self.assertEqual((out["seen"], out["done"], out["waiting"]), (3, 1, 2))
        # The oldest drafts were read beside it, and wait; the newest waits unread.
        self.assertEqual([self.req(f"req-{i}")["status"] for i in range(1, 4)], ["queued"] * 3)
        self.assertIsNone(self.req("req-3")["error"])

    def test_queued_reads_the_first_rows_ahead_and_keeps_the_limit(self):
        for i in range(1, 4):
            self.draft(f"req-{i}", f"p-{i}", f"2099-01-01T11:0{i}:00Z")
        self.rebuild("req-8", "p-8", "2099-01-01T12:00:00Z")
        self.rebuild("req-9", "p-9", "2099-01-01T12:05:00Z")
        ids = [r["id"] for r in self.sb.queued("proposal", max_attempts=4, limit=3, first=queue.REBUILDS_FIRST)]
        self.assertEqual(ids, ["req-8", "req-9", "req-1"])
        ids = [r["id"] for r in self.sb.queued("proposal", max_attempts=4, limit=2, first=queue.REBUILDS_FIRST)]
        self.assertEqual(ids, ["req-8", "req-9"])
        self.pg.calls.clear()
        ids = [r["id"] for r in self.sb.queued("proposal", max_attempts=4, limit=3)]
        self.assertEqual((ids, len(self.pg.calls)), (["req-1", "req-2", "req-3"], 1))

    def test_a_rebuilds_outage_holds_only_rebuilds_and_the_drafts_go_on(self):
        self.rebuild("req-8", "p-8", "2099-01-01T12:00:00Z")
        self.rebuild("req-9", "p-9", "2099-01-01T12:05:00Z")
        self.draft("req-1", "p-1")
        w = self.worker(lambda c, l: Named("vps", "opus", [triage_answer(), specific_deal()]))

        def broken(req: dict[str, Any]) -> dict[str, Any]:
            raise NotNow("The browser on the VPS cannot start, so nothing can be rebuilt. Install it again.")

        w.rebuild = broken  # type: ignore[method-assign]
        out = w.run()
        self.assertEqual((out["waiting"], out["done"]), (2, 1))
        self.assertEqual(self.req("req-1")["status"], "done")
        self.assertEqual((self.req("req-8")["status"], self.req("req-8")["attempts"]), ("queued", 0))
        self.assertEqual((self.req("req-9")["status"], self.req("req-9")["claimed_by"]), ("queued", None))
        for pid in ("p-8", "p-9"):
            self.assertTrue(self.prop(pid)["error"].startswith(
                "The proposal writer cannot work right now: the browser on the VPS cannot start"), pid)

    def test_a_rebuild_asked_while_the_run_drafts_goes_before_its_next_draft(self):
        self.draft("req-1", "p-1", "2099-01-01T11:01:00Z")
        self.draft("req-2", "p-2", "2099-01-01T11:02:00Z")
        test = self

        class AsksMeanwhile(Named):
            def complete(self, system, user, *, temperature=None, timeout=900):
                if not self.calls:  # the closer fills the gaps while the first draft is written
                    test.rebuild("req-9", "p-9", "2099-01-01T12:00:00Z")
                return super().complete(system, user, temperature=temperature, timeout=timeout)

        vps = AsksMeanwhile("vps", "opus", [triage_answer(), specific_deal(), triage_answer(), specific_deal()])
        w = self.worker(lambda c, l: vps)
        order: list[str] = []
        claim = self.sb.claim

        def claimed(req: dict[str, Any], host: str) -> Optional[dict[str, Any]]:
            order.append(str(req["id"]))
            return claim(req, host)

        w.sb.claim = claimed  # type: ignore[method-assign]
        out = w.run()
        self.assertEqual(order, ["req-1", "req-9", "req-2"])
        self.assertEqual((out["seen"], out["done"]), (3, 3))
        self.assertEqual(self.prop("p-9")["status"], "ready")

    def test_no_rebuild_is_looked_for_after_the_runs_last_draft(self):
        self.draft("req-1", "p-1")
        w = self.worker(lambda c, l: Named("vps", "opus", [triage_answer(), specific_deal()]))
        self.pg.calls.clear()
        w.run()
        reads = [c for c in self.pg.calls if c[0] == "GET" and REQ in c[1] and "rebuild" in c[1]]
        self.assertEqual(len(reads), 1)  # the run's first read only

    def test_a_draft_stuck_on_an_outage_never_holds_up_a_rebuild(self):
        self.draft("req-1", "p-1", "2099-01-01T11:01:00Z")
        self.draft("req-2", "p-2", "2099-01-01T11:02:00Z")
        self.rebuild("req-9", "p-9", "2099-01-01T12:00:00Z")
        out = self.worker(lambda c, l: Named("vps", "opus", [signed_out()])).run()
        self.assertEqual((out["done"], out["waiting"]), (1, 2))
        self.assertEqual(self.req("req-9")["status"], "done")


# ---------------------------------------------------------------------------
class ArchivedStops(Base):
    def test_a_draft_for_an_archived_proposal_is_cancelled_not_drafted(self):
        self.draft("req-1", "p-1", status="archived")
        vps = Pinged("vps", "opus", [])
        out = self.worker(lambda c, l: vps).run()
        self.assertEqual((out["cancelled"], out["done"], out["failed"], vps.calls), (1, 0, 0, []))
        r = self.req("req-1")
        self.assertEqual(r["status"], "cancelled")
        self.assertIn("archived before this request ran", r["error"])
        self.assertIsNotNone(r["finished_at"])
        self.assertEqual((self.prop("p-1")["status"], self.prop("p-1")["error"]), ("archived", None))
        self.assertEqual(self.fathom.read, [])

    def test_a_rebuild_for_an_archived_proposal_is_cancelled_too(self):
        self.rebuild("req-9", "p-9", status="archived")
        out = self.worker(fakes.never).run()
        self.assertEqual((out["cancelled"], self.req("req-9")["status"]), (1, "cancelled"))
        self.assertEqual(self.prop("p-9")["status"], "archived")
        self.assertNotIn("proposals/p-9/v2.html", {k.split("/", 1)[1] for k in self.pg.objects})

    def test_a_worker_that_gave_up_never_brings_an_archived_proposal_back(self):
        self.draft("req-1", "p-1", status="archived")
        self.pg.put(REQ, dict(self.req("req-1"), status="running", attempts=4, claimed_by="dead-box",
                              claimed_at="2000-01-01T00:00:00Z"))
        self.assertEqual(self.worker(fakes.never).reap(), 1)
        self.assertEqual(self.req("req-1")["status"], "failed")
        self.assertEqual(self.prop("p-1")["status"], "archived")


if __name__ == "__main__":
    unittest.main()
