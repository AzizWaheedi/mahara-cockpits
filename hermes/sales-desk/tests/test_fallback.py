"""The model fallback: when the primary provider cannot answer at all (the
Claude sign-in on the VPS lapsed, the proxy is down, a refused key, no
credit), proposals draft through SALES_MODEL_FALLBACK instead of stopping.

The rules tested here, from the CEO's ask on 2026-10-04 ("fallbacks just in
case anything breaks"):

- one fallback per run, decided once, and never back to the primary in it;
- the same provider for the whole draft: triage, draft, tightening and
  repair; a primary that stops partway is never finished by another;
- the usage row names the provider and model that answered;
- the proposal says "Drafted through <provider> because <reason>";
- when nothing can answer, the request waits (its try not counted) with a
  sentence the closer can act on, and the next run tries again;
- the doctor shows both and is blocked only when neither answers;
- the other jobs keep today's behaviour unless SALES_FALLBACK_JOBS names them.

    python3 -m unittest tests.test_fallback
"""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from typing import Any, Optional
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"
for _name in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "SALES_MODEL_PROVIDER",
              "SALES_PROPOSAL_MODEL", "SALES_MODEL_FALLBACK", "SALES_FALLBACK_MODEL", "SALES_FALLBACK_JOBS"):
    os.environ.pop(_name, None)

from desk import engine, http, model, queue  # noqa: E402
from desk.config import Config  # noqa: E402
from desk.errors import NotNow  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests import fakes  # noqa: E402
from tests.fakes import FakeFathom, FakePostgrest, FakeProvider, FakeRenderer, TEST_OFFER, specific_deal, transcript, \
    triage_answer  # noqa: E402
from tests.test_desk import cfg_in, fakes_logger, load_cli, resolved  # noqa: E402

REQ = "cockpit_sales_requests"
PROP = "cockpit_sales_proposals"
CLAUDE = "anthropic/claude-opus-4.8"


def signed_out() -> model.ModelUnreachable:
    """What the VPS proxy's lapsed sign-in becomes, made the way the desk makes it."""
    body = b'{"error":{"message":"Failed to authenticate. API Error: 401 OAuth access token has expired."}}'
    return model._classify(http.HttpError(500, "proxy_error", body), "vps", "opus")


def no_credit() -> model.ModelUnreachable:
    return model._classify(http.HttpError(402, "payment required", b'{"error":{"message":"Insufficient credits"}}'),
                           "openrouter", CLAUDE)


class Named(FakeProvider):
    """A scripted provider with a provider's name and model, answering as that model."""

    def __init__(self, name: str, model_name: str, replies: list[Any]):
        super().__init__(replies)
        self.name, self.model = name, model_name

    def complete(self, system: str, user: str, *, temperature: Optional[float] = None, timeout: float = 900):
        r = super().complete(system, user, temperature=temperature, timeout=timeout)
        r.model = self.model
        return r


def failover(primary: Any, fallback: Any = None) -> model.Failover:
    return model.Failover(lambda: primary, None if fallback is None else (lambda: fallback), log=lambda _m: None)


# ---------------------------------------------------------------------------
class Settings(unittest.TestCase):
    def from_env(self, **env: str) -> Config:
        with mock.patch.dict(os.environ, env):
            return Config.from_env()

    def test_openrouter_is_the_fallback_when_its_key_is_set_and_none_turns_it_off(self):
        self.assertEqual(self.from_env(OPENROUTER_API_KEY="or-test").fallback, "openrouter")
        self.assertEqual(self.from_env().fallback, "none")
        self.assertEqual(self.from_env(OPENROUTER_API_KEY="or-test", SALES_MODEL_FALLBACK="none").fallback, "none")
        self.assertEqual(self.from_env(OPENROUTER_API_KEY="or-test", SALES_MODEL_FALLBACK="off").fallback, "none")
        self.assertEqual(self.from_env(SALES_MODEL_FALLBACK="OpenAI").fallback, "openai")

    def test_only_proposals_fall_back_unless_the_jobs_list_says_otherwise(self):
        c = self.from_env(OPENROUTER_API_KEY="or-test")
        self.assertEqual(c.fallback_jobs, ("proposal",))
        self.assertTrue(model.fallback_for(c, "proposal"))
        for job in ("notes", "digest", "reviews", "followups"):
            self.assertFalse(model.fallback_for(c, job), job)
        c = self.from_env(OPENROUTER_API_KEY="or-test", SALES_FALLBACK_JOBS="proposal, notes ,reviews")
        self.assertEqual(c.fallback_jobs, ("proposal", "notes", "reviews"))
        self.assertTrue(model.fallback_for(c, "notes"))
        self.assertFalse(model.fallback_for(c, "followups"))

    def test_a_fallback_that_is_the_primary_itself_is_no_fallback(self):
        c = self.from_env(OPENROUTER_API_KEY="or-test", SALES_MODEL_PROVIDER="openrouter")
        self.assertFalse(model.fallback_for(c, "proposal"))
        c = self.from_env(SALES_MODEL_FALLBACK="none")
        self.assertFalse(model.fallback_for(c, "proposal"))


class ClosestModel(unittest.TestCase):
    def test_claude_codes_opus_is_the_same_opus_through_openrouter(self):
        # The VPS proxy lists "opus" beside claude-opus-4-8 (GET 127.0.0.1:3456/v1/models, 2026-10-04),
        # and OpenRouter names that model anthropic/claude-opus-4.8.
        self.assertEqual(model.closest_model("opus", "openrouter"), CLAUDE)
        self.assertEqual(model.closest_model("claude-opus-4-8", "openrouter"), CLAUDE)
        self.assertEqual(model.closest_model("opus-4.8", "openrouter"), CLAUDE)
        self.assertEqual(model.closest_model("sonnet", "openrouter"), "anthropic/claude-sonnet-4.6")
        self.assertEqual(model.closest_model("claude-haiku-4-5-20251001", "openrouter"), "anthropic/claude-haiku-4.5")
        self.assertEqual(model.closest_model("claude-opus-5", "openrouter"), "anthropic/claude-opus-5")
        self.assertEqual(model.closest_model("anthropic/claude-opus-5.5", "openrouter"), "anthropic/claude-opus-5.5")
        self.assertEqual(model.closest_model("gpt-5", "openrouter"), "openai/gpt-5")

    def test_each_provider_gets_a_name_it_takes_and_the_allowlist_allows(self):
        self.assertEqual(model.closest_model("opus", "anthropic"), "claude-opus-4-8")
        self.assertEqual(model.closest_model("anthropic/claude-opus-4.8", "vps"), "claude-opus-4-8")
        self.assertEqual(model.closest_model("opus", "openai"), "gpt-5")
        self.assertEqual(model.closest_model("openai/gpt-4.1", "openai"), "gpt-4.1")
        self.assertEqual(model.closest_model("mythos", "openrouter"), CLAUDE)  # not on OpenRouter: the default
        for provider in ("openrouter", "anthropic", "openai", "vps"):
            for name in ("opus", "sonnet", "claude-opus-5", "gpt-5", "o3", "something-else"):
                self.assertTrue(model.model_allowed(model.closest_model(name, provider)), (name, provider))


class FallbackProvider(unittest.TestCase):
    def cfg(self, **kw: Any) -> Config:
        c = cfg_in(tempfile.mkdtemp())
        c.provider, c.model, c.fallback = "vps", "opus", "openrouter"
        for k, v in kw.items():
            setattr(c, k, v)
        return c

    def test_openrouter_drafts_on_claude_with_room_for_a_whole_deal(self):
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "or-test"}):
            p = model.fallback_provider(self.cfg())
        self.assertEqual((p.name, p.model, p.json_mode), ("openrouter", CLAUDE, False))
        self.assertEqual(p.max_tokens, model.ANTHROPIC_MAX_TOKENS)
        body = p._body("s", "u", temperature=0.3, stream=True)
        self.assertEqual(body["max_tokens"], model.ANTHROPIC_MAX_TOKENS)

    def test_the_model_can_be_named_and_is_still_checked(self):
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "or-test"}):
            p = model.fallback_provider(self.cfg(fallback_model="anthropic/claude-opus-5.5"))
            self.assertEqual(p.model, "anthropic/claude-opus-5.5")
            with self.assertRaises(model.ModelUnreachable) as e:
                model.fallback_provider(self.cfg(fallback_model="deepseek/deepseek-r1"))
        self.assertIn("DeepSeek", str(e.exception))

    def test_a_missing_key_is_one_sentence_naming_it(self):
        with self.assertRaises(model.ModelUnreachable) as e:
            model.fallback_provider(self.cfg())
        self.assertIn("OPENROUTER_API_KEY is not set", str(e.exception))
        self.assertEqual(e.exception.cause, "OPENROUTER_API_KEY is not set")

    def test_openai_as_the_fallback_writes_json_for_proposals_and_plain_text_for_reviews(self):
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test-000000"}):
            p = model.fallback_provider(self.cfg(fallback="openai"))
            self.assertEqual((p.name, p.model, p.json_mode), ("openai", "gpt-5", True))
            p = model.fallback_provider(self.cfg(fallback="openai"), plain_text=True)
            self.assertFalse(p.json_mode)


class Causes(unittest.TestCase):
    def test_every_outage_carries_a_short_cause(self):
        self.assertEqual(signed_out().cause, "the Claude sign-in on the VPS has lapsed")
        self.assertEqual(no_credit().cause, "the openrouter account is out of credit")
        down = model._classify(http.HttpError(0, "connection refused"), "vps", "opus")
        self.assertEqual(down.cause, "the Claude proxy on the VPS is not answering")
        refused = model._classify(http.HttpError(401, "bad key", b"{}"), "openrouter", CLAUDE)
        self.assertEqual(refused.cause, "openrouter refused its key")
        # A sentence made anywhere else still has one: its first clause.
        self.assertEqual(model.ModelUnreachable("Today's plan is spent, so nothing runs. Wait.").cause,
                         "today's plan is spent")


# ---------------------------------------------------------------------------
class FailoverTests(unittest.TestCase):
    def test_a_working_primary_answers_and_nothing_is_said(self):
        vps = Named("vps", "opus", ["one", "two"])
        f = failover(vps, Named("openrouter", CLAUDE, []))
        self.assertEqual(f.complete("s", "u").text, "one")
        f.begin()
        self.assertEqual(f.complete("s", "u").text, "two")
        self.assertEqual((f.name, f.model, f.on_fallback), ("vps", "opus", False))
        self.assertEqual(f.route()["fallback"], False)

    def test_a_lapsed_sign_in_hands_the_whole_run_to_the_fallback_once(self):
        vps = Named("vps", "opus", [signed_out()])
        router = Named("openrouter", CLAUDE, ["triage", "draft", "next draft"])
        f = failover(vps, router)
        self.assertEqual(f.complete("s", "u").text, "triage")
        self.assertEqual(f.complete("s", "u").text, "draft")
        f.begin()  # the run's next proposal: straight to the fallback, the primary is not asked again
        self.assertEqual(f.complete("s", "u").text, "next draft")
        self.assertEqual((len(vps.calls), len(router.calls)), (1, 3))
        self.assertEqual((f.name, f.model, f.on_fallback), ("openrouter", CLAUDE, True))
        route = f.route()
        self.assertEqual(route["primary"], "vps (opus)")
        self.assertEqual(route["reason"], "the Claude sign-in on the VPS has lapsed")
        self.assertEqual(model.route_of(f, CLAUDE)["note"],
                         f"Drafted through openrouter ({CLAUDE}) because the Claude sign-in on the VPS has lapsed.")

    def test_a_primary_that_cannot_even_be_made_hands_over_before_anything_is_asked(self):
        def no_key():
            raise model.ModelUnreachable("OPENAI_API_KEY is not set, so the openai provider cannot draft.")

        router = Named("openrouter", CLAUDE, ["ok"])
        f = model.Failover(no_key, lambda: router, log=lambda _m: None)
        self.assertIs(f.ready(), f)
        self.assertEqual((f.name, f.route()["reason"]), ("openrouter", "OPENAI_API_KEY is not set"))
        self.assertEqual(f.complete("s", "u").text, "ok")

    def test_a_primary_that_stops_partway_is_never_finished_by_another(self):
        vps = Named("vps", "opus", ["triage", signed_out()])
        router = Named("openrouter", CLAUDE, ["never"])
        f = failover(vps, router)
        f.complete("s", "u")
        with self.assertRaises(model.ModelUnreachable) as e:
            f.complete("s", "u")
        self.assertIsInstance(e.exception, NotNow)
        self.assertIn("partway", str(e.exception))
        self.assertIn("starts again from the beginning", str(e.exception))
        self.assertIn("no need to ask again", str(e.exception))
        self.assertEqual(router.calls, [])

    def test_a_try_that_failed_still_belongs_to_the_primary(self):
        vps = Named("vps", "opus", [model.ModelError("no answer for 900 seconds"), signed_out()])
        router = Named("openrouter", CLAUDE, ["never"])
        f = failover(vps, router)
        with self.assertRaises(model.ModelError):
            f.complete("s", "u")
        with self.assertRaises(model.ModelUnreachable) as e:
            f.complete("s", "u")
        self.assertIn("partway", str(e.exception))
        self.assertEqual(router.calls, [])

    def test_when_neither_answers_the_closer_is_told_to_wait_and_why(self):
        vps = Named("vps", "opus", [signed_out()])
        router = Named("openrouter", CLAUDE, [no_credit()])
        f = failover(vps, router)
        with self.assertRaises(model.ModelUnreachable) as e:
            f.complete("s", "u")
        text = str(e.exception)
        self.assertTrue(text.startswith("No model can answer right now: the Claude sign-in on the VPS has lapsed, "
                                        "and the openrouter account is out of credit."), text)
        self.assertIn("drafts by itself", text)
        self.assertIn("no need to ask again", text)
        self.assertIn("/login", text)  # the fix, for whoever reads the request row
        self.assertIn("Top it up", text)
        self.assertLessEqual(len(text), 600)
        # The closer's own sentence: what is happening and what to do, without the fix or anyone's name.
        self.assertEqual(e.exception.closer,
                         "No model can answer right now: the Claude sign-in on the VPS has lapsed, and the openrouter "
                         "account is out of credit. This proposal waits and drafts by itself once either is fixed, so "
                         "there is no need to ask again; if it is still waiting in an hour, tell the CEO.")

    def test_a_fallback_that_cannot_be_made_is_the_same_wait(self):
        def no_key():
            raise model.ModelUnreachable("OPENROUTER_API_KEY is not set, so the openrouter provider cannot draft.")

        f = model.Failover(lambda: Named("vps", "opus", [signed_out()]), no_key, log=lambda _m: None)
        with self.assertRaises(model.ModelUnreachable) as e:
            f.complete("s", "u")
        self.assertIn("and OPENROUTER_API_KEY is not set", str(e.exception))

    def test_without_a_fallback_the_primary_says_exactly_what_it_says_today(self):
        f = failover(Named("vps", "opus", [signed_out()]))
        with self.assertRaises(model.ModelUnreachable) as e:
            f.complete("s", "u")
        self.assertEqual(str(e.exception), model.VPS_SIGN_IN)

    def test_the_days_ceiling_is_never_a_reason_to_switch(self):
        vps = Named("vps", "opus", [model.BudgetSpent("today's AI ceiling is reached")])
        router = Named("openrouter", CLAUDE, ["never"])
        with self.assertRaises(model.BudgetSpent):
            failover(vps, router).complete("s", "u")
        self.assertEqual(router.calls, [])


class Usage(unittest.TestCase):
    def test_the_usage_row_names_the_provider_that_answered(self):
        rows: list[dict[str, Any]] = []
        m = model.Meter(job="requests", cap=0, used_today=lambda: 0, record=rows.append)
        vps = model.Metered(Named("vps", "opus", [signed_out()]), m)
        router = model.Metered(Named("openrouter", CLAUDE, [model.Reply(text="{}", usage={
            "prompt_tokens": 900, "completion_tokens": 100, "total_tokens": 1000})]), m)
        f = model.Failover(lambda: vps, lambda: router, log=lambda _m: None)
        f.complete("s", "u")
        self.assertEqual(rows, [{"job": "requests", "provider": "openrouter", "model": CLAUDE, "input_tokens": 900,
                                 "output_tokens": 100, "reasoning_tokens": 0, "total_tokens": 1000}])

    def test_an_answer_without_usage_is_estimated_never_counted_as_nothing(self):
        rows: list[dict[str, Any]] = []
        m = model.Meter(job="requests", cap=0, used_today=lambda: 0, record=rows.append)
        p = model.Metered(Named("openrouter", CLAUDE, [model.Reply(text="x" * 30)]), m)
        p.complete("a" * 60, "b" * 30)
        self.assertEqual((rows[0]["input_tokens"], rows[0]["output_tokens"], rows[0]["total_tokens"]), (30, 10, 40))
        self.assertEqual(m.spent, 40)

    def test_a_table_without_the_provider_column_still_gets_every_row(self):
        cli = load_cli()
        sent: list[Any] = []

        class Sb:
            def rest(self, method, path, *, json_body=None, prefer=None, retries=2):
                sent.append(json_body[0])
                if "provider" in json_body[0]:
                    raise http.HttpError(400, "bad request", b'{"code":"PGRST204","message":"Could not find the '
                                                             b'\'provider\' column of \'cockpit_sales_ai_usage\' in '
                                                             b'the schema cache"}')

        warned: list[str] = []
        record = cli.usage_recorder(Sb(), warned.append)
        record({"job": "requests", "provider": "openrouter", "model": CLAUDE, "total_tokens": 5})
        record({"job": "requests", "provider": "openrouter", "model": CLAUDE, "total_tokens": 6})
        self.assertEqual(sent[1], {"job": "requests", "model": f"openrouter:{CLAUDE}", "total_tokens": 5})
        self.assertEqual(sent[2], {"job": "requests", "model": f"openrouter:{CLAUDE}", "total_tokens": 6})
        self.assertEqual(len(sent), 3)  # the column is asked for once, not on every row
        self.assertEqual(len(warned), 1)
        self.assertIn("20261004a_sales_ai_usage_provider.sql", warned[0])


# ---------------------------------------------------------------------------
class EngineOnTheFallback(unittest.TestCase):
    def run_engine(self, f: model.Failover, over: list[list[int]]) -> engine.Outcome:
        tmp = tempfile.mkdtemp()
        call = engine.Call(transcript_text=transcript(), client_company="Mirage Test Contracting")
        return engine.run(call, lang="en", resolved=resolved(), offer=TEST_OFFER, p=f, cfg=cfg_in(tmp),
                          log=lambda _m: None, workdir=Path(tmp) / "work", renderer=FakeRenderer(over=over))

    def test_triage_draft_and_tightening_all_on_the_fallback(self):
        vps = Named("vps", "opus", [signed_out()])
        router = Named("openrouter", CLAUDE, [triage_answer(), specific_deal(), specific_deal(subhead="Shorter.")])
        out = self.run_engine(failover(vps, router), over=[[4], []])
        self.assertEqual((out.rounds, out.overflow_last), (1, []))
        self.assertEqual((len(vps.calls), len(router.calls)), (1, 3))
        self.assertEqual(out.model, f"openrouter:{CLAUDE}")
        self.assertEqual(out.route["provider"], "openrouter")
        self.assertTrue(out.route["fallback"])
        self.assertIn(f"Drafted through openrouter ({CLAUDE}) because the Claude sign-in on the VPS has lapsed.",
                      out.notes)

    def test_tightening_never_moves_to_another_provider(self):
        vps = Named("vps", "opus", [triage_answer(), specific_deal(), signed_out()])
        router = Named("openrouter", CLAUDE, ["never"])
        with self.assertRaises(NotNow):
            self.run_engine(failover(vps, router), over=[[4], []])
        self.assertEqual(router.calls, [])

    def test_a_plain_provider_says_where_it_drafted_and_adds_no_note(self):
        tmp = tempfile.mkdtemp()
        call = engine.Call(transcript_text=transcript())
        out = engine.run(call, lang="en", resolved=resolved(), offer=TEST_OFFER,
                         p=Named("vps", "opus", [triage_answer(), specific_deal()]), cfg=cfg_in(tmp),
                         log=lambda _m: None, workdir=Path(tmp) / "work", renderer=FakeRenderer())
        self.assertEqual(out.route, {"provider": "vps", "model": "opus", "fallback": False})
        self.assertFalse(any(n.startswith("Drafted through") for n in out.notes))


# ---------------------------------------------------------------------------
class QueueOnTheFallback(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cfg = cfg_in(self.tmp)
        self.cfg.provider, self.cfg.model, self.cfg.fallback = "vps", "opus", "openrouter"
        self.pg = FakePostgrest()
        self.sb = Supabase(self.cfg.supabase_url, self.cfg.supabase_key)
        patch = mock.patch.object(http, "request", self.pg)
        patch.start()
        self.addCleanup(patch.stop)
        self.pg.put("cockpit_sales_leads", {"contact_id": "c-1", "name": "Fahad Sample", "company": "Mirage Test Contracting"})
        self.pg.put("cockpit_sales_recordings", {"recording_id": "100", "contact_id": "c-1", "matched_by": "email",
                                                 "recorded_by": "rep.one@maharamedia.com",
                                                 "started_at": "2099-01-01T10:00:00Z"})
        self.fathom = FakeFathom(transcripts={"100": fakes.fathom_turns(transcript())})

    def queue(self, rid: str, pid: str) -> None:
        self.pg.put(REQ, {"id": rid, "kind": "proposal", "contact_id": "c-1",
                          "params": {"lang": "en", "proposal_id": pid, "offer": {"payment": "pif", "guarantee": False}},
                          "status": "queued", "requested_by": "rep.one@maharamedia.com",
                          "requested_at": f"2099-01-01T11:0{rid[-1]}:00Z", "claimed_at": None, "claimed_by": None,
                          "attempts": 0, "finished_at": None, "error": None, "result": None})
        self.pg.put(PROP, {"id": pid, "request_id": rid, "contact_id": "c-1", "lang": "en", "status": "drafting",
                           "deal": None, "validation": None, "html_path": None, "pdf_path": None,
                           "created_by": "rep.one@maharamedia.com", "created_at": "2099-01-01T11:00:00Z",
                           "updated_at": "2099-01-01T11:00:00Z"})

    def worker(self, primary: Any, fallback: Any) -> queue.Worker:
        return queue.Worker(self.cfg, lambda _m: None, self.sb, host="test-box", provider=primary, fallback=fallback,
                            fathom=lambda cfg, log: self.fathom, renderer=FakeRenderer(), offer=TEST_OFFER)

    def test_a_lapsed_sign_in_still_gives_the_closer_a_proposal_and_says_how(self):
        self.queue("req-1", "p-1")
        vps = Named("vps", "opus", [signed_out()])
        router = Named("openrouter", CLAUDE, [triage_answer(), specific_deal()])
        out = self.worker(lambda c, l: vps, lambda c, l: router).run()
        self.assertEqual((out["done"], out["statuses"]), (1, {"ready": 1}))
        p = self.pg.one(PROP, id="p-1")
        self.assertEqual((p["status"], p["model"]), ("ready", f"openrouter:{CLAUDE}"))
        self.assertEqual(p["validation"]["model_route"], {
            "provider": "openrouter", "model": CLAUDE, "fallback": True, "primary": "vps (opus)",
            "reason": "the Claude sign-in on the VPS has lapsed", "detail": model.VPS_SIGN_IN,
            "note": f"Drafted through openrouter ({CLAUDE}) because the Claude sign-in on the VPS has lapsed."})
        self.assertEqual(p["validation"]["notes"][0],
                         f"Drafted through openrouter ({CLAUDE}) because the Claude sign-in on the VPS has lapsed.")
        self.assertIsNone(p["error"])

    def test_the_run_decides_once_and_the_next_draft_goes_straight_to_the_fallback(self):
        self.queue("req-1", "p-1")
        self.queue("req-2", "p-2")
        vps = Named("vps", "opus", [signed_out()])
        router = Named("openrouter", CLAUDE, [triage_answer(), specific_deal(), triage_answer(), specific_deal()])
        made = {"primary": 0, "fallback": 0}

        def primary(c, l):
            made["primary"] += 1
            return vps

        def fallback(c, l):
            made["fallback"] += 1
            return router

        out = self.worker(primary, fallback).run()
        self.assertEqual(out["done"], 2)
        self.assertEqual((len(vps.calls), len(router.calls)), (1, 4))
        self.assertEqual(made, {"primary": 1, "fallback": 1})

    def test_when_nothing_answers_the_request_waits_untouched_with_a_sentence(self):
        self.queue("req-1", "p-1")
        vps = Named("vps", "opus", [signed_out()])
        router = Named("openrouter", CLAUDE, [no_credit()])
        out = self.worker(lambda c, l: vps, lambda c, l: router).run()
        self.assertEqual((out["waiting"], out["failed"], out["retry"]), (1, 0, 0))
        req = self.pg.one(REQ, id="req-1")
        self.assertEqual((req["status"], req["attempts"], req["claimed_by"]), ("queued", 0, None))
        self.assertTrue(req["error"].startswith("No model can answer right now"), req["error"])
        self.assertIn("To fix it:", req["error"])
        p = self.pg.one(PROP, id="p-1")
        self.assertEqual(p["status"], "drafting")
        # The proposal, which the closer sees, carries the closer's sentence only.
        self.assertTrue(req["error"].startswith(p["error"]), (p["error"], req["error"]))
        self.assertIn("tell the CEO", p["error"])
        self.assertNotIn("aziz", p["error"])
        self.assertIn("no need to ask again", out["blocked"])

        # The next run tries again, and drafts once something answers.
        vps2 = Named("vps", "opus", [triage_answer(), specific_deal()])
        out = self.worker(lambda c, l: vps2, lambda c, l: Named("openrouter", CLAUDE, [])).run()
        self.assertEqual(out["done"], 1)
        p = self.pg.one(PROP, id="p-1")
        self.assertEqual((p["status"], p["model"], p["error"]), ("ready", "vps:opus", None))
        self.assertFalse(p["validation"]["model_route"]["fallback"])

    def test_a_missing_primary_key_is_no_longer_a_block_when_the_fallback_can_draft(self):
        self.queue("req-1", "p-1")

        def no_key(c, l):
            raise model.ModelUnreachable("OPENAI_API_KEY is not set, so the openai provider cannot draft.")

        router = Named("openrouter", CLAUDE, [triage_answer(), specific_deal()])
        out = self.worker(no_key, lambda c, l: router).run()
        self.assertNotIn("blocked", out)
        self.assertEqual(out["done"], 1)
        self.assertIn("because OPENAI_API_KEY is not set.", self.pg.one(PROP, id="p-1")["validation"]["notes"][0])

    def test_neither_key_blocks_before_any_row_is_claimed(self):
        self.queue("req-1", "p-1")

        def no_key(c, l):
            raise model.ModelUnreachable("OPENAI_API_KEY is not set, so the openai provider cannot draft.")

        def no_router(c, l):
            raise model.ModelUnreachable("OPENROUTER_API_KEY is not set, so the openrouter provider cannot draft.")

        out = self.worker(no_key, no_router).run()
        req = self.pg.one(REQ, id="req-1")
        self.assertEqual((req["status"], req["attempts"]), ("queued", 0))
        self.assertIn("OPENAI_API_KEY is not set, and OPENROUTER_API_KEY is not set", req["error"])
        self.assertIn("OPENROUTER_API_KEY", out["blocked"])
        # The closer is told too, though no row was claimed.
        self.assertIn("This proposal waits and drafts by itself", self.pg.one(PROP, id="p-1")["error"])

    def test_a_draft_cut_off_partway_waits_and_its_try_is_not_counted(self):
        self.queue("req-1", "p-1")
        vps = Named("vps", "opus", [triage_answer(), signed_out()])
        router = Named("openrouter", CLAUDE, ["never"])
        out = self.worker(lambda c, l: vps, lambda c, l: router).run()
        self.assertEqual(out["waiting"], 1)
        req = self.pg.one(REQ, id="req-1")
        self.assertEqual((req["status"], req["attempts"]), ("queued", 0))
        self.assertIn("starts again from the beginning", req["error"])
        self.assertEqual(self.pg.one(PROP, id="p-1")["error"],
                         "The model stopped answering partway through this draft (the Claude sign-in on the VPS has "
                         "lapsed), so it starts again from the beginning on the next run; there is no need to ask again.")
        self.assertEqual(router.calls, [])

    def test_a_rebuild_after_the_closer_fills_the_gaps_still_says_how_it_was_drafted(self):
        self.queue("req-1", "p-1")
        deal = specific_deal()
        deal["cost"]["close"] = "FILL"
        router = Named("openrouter", CLAUDE, [triage_answer(), deal])
        self.worker(lambda c, l: Named("vps", "opus", [signed_out()]), lambda c, l: router).run()
        drafted = self.pg.one(PROP, id="p-1")
        self.assertEqual(drafted["status"], "needs_input")
        filled = dict(drafted["deal"])
        filled["cost"] = dict(filled["cost"], close="USD 4,000")
        self.pg.put(PROP, dict(drafted, deal=filled))
        self.pg.put(REQ, {"id": "req-9", "kind": "proposal", "contact_id": "c-1",
                          "params": {"proposal_id": "p-1", "rebuild": True, "lang": "en"}, "status": "queued",
                          "requested_by": "rep.one@maharamedia.com", "requested_at": "2099-01-01T12:00:00Z",
                          "claimed_at": None, "claimed_by": None, "attempts": 0, "finished_at": None, "error": None,
                          "result": None})
        self.worker(fakes.never, fakes.never).run()
        p = self.pg.one(PROP, id="p-1")
        self.assertTrue(p["validation"]["rebuild"])
        self.assertEqual(p["validation"]["model_route"], drafted["validation"]["model_route"])
        self.assertIn(drafted["validation"]["model_route"]["note"], p["validation"]["notes"])

    def test_a_job_the_fallback_is_not_for_keeps_todays_behaviour(self):
        self.cfg.fallback_jobs = ("notes",)
        self.queue("req-1", "p-1")
        router = Named("openrouter", CLAUDE, ["never"])
        out = self.worker(lambda c, l: Named("vps", "opus", [signed_out()]), lambda c, l: router).run()
        self.assertEqual(self.pg.one(REQ, id="req-1")["error"], model.VPS_SIGN_IN)
        self.assertEqual(out["blocked"], model.VPS_SIGN_IN)
        self.assertEqual(router.calls, [])


# ---------------------------------------------------------------------------
class Probe:
    """A provider as the doctor sees it: a one-token ping, its model list, its credit."""

    def __init__(self, name: str, model_name: str, *, ping: Any = None, models: Optional[list[str]] = None,
                 credit: Optional[float] = None):
        self.name, self.model = name, model_name
        self._ping, self._models, self._credit = ping, models, credit

    def ping(self, timeout: float = 60) -> str:
        if isinstance(self._ping, BaseException):
            raise self._ping
        return f"{self.model} answered"

    def models(self, timeout: float = 60) -> list[str]:
        return list(self._models or [self.model])

    def credit(self, timeout: float = 60) -> Optional[float]:
        return self._credit


class Doctor(unittest.TestCase):
    def cfg(self, fallback: str = "openrouter") -> Config:
        c = cfg_in(tempfile.mkdtemp())
        c.provider, c.model, c.fallback = "vps", "opus", fallback
        return c

    def rows(self, cfg: Config, primary: Any, fallback: Any) -> tuple[dict[str, dict[str, Any]], list[str]]:
        cli = load_cli()
        out = cli.model_rows(cfg, fakes_logger(), online=True, primary=lambda c, l: primary,
                             fallback=lambda c, l, **kw: fallback)
        blockers = [r["detail"] for r in out if r["required"] and r["ok"] is False]
        return {r["check"]: r for r in out}, blockers

    def test_a_lapsed_primary_with_a_working_fallback_is_not_a_block(self):
        rows, blockers = self.rows(self.cfg(), Probe("vps", "opus", ping=signed_out()),
                                   Probe("openrouter", CLAUDE, credit=9.5))
        self.assertEqual(blockers, [])
        self.assertEqual((rows["model answers"]["ok"], rows["model answers"]["required"]), (False, False))
        self.assertTrue(rows["fallback answers"]["ok"])
        self.assertTrue(rows["fallback listed"]["ok"])
        self.assertTrue(rows["fallback credit"]["ok"])
        self.assertIsNone(rows["drafting"]["ok"])
        self.assertIn(f"proposals draft through openrouter ({CLAUDE})", rows["drafting"]["detail"])
        self.assertIn("SALES_MODEL_FALLBACK=openrouter", rows["fallback"]["detail"])

    def test_both_down_is_one_blocker_naming_both(self):
        rows, blockers = self.rows(self.cfg(), Probe("vps", "opus", ping=signed_out()),
                                   Probe("openrouter", CLAUDE, ping=no_credit(), credit=-0.13))
        self.assertEqual(len(blockers), 1)
        self.assertIn("the Claude sign-in on the VPS has lapsed", blockers[0])
        self.assertIn("the openrouter account is out of credit", blockers[0])
        self.assertFalse(rows["fallback credit"]["ok"])
        self.assertIn("-0.13", rows["fallback credit"]["detail"])

    def test_a_fallback_with_no_credit_left_does_not_count_as_answering(self):
        rows, blockers = self.rows(self.cfg(), Probe("vps", "opus", ping=signed_out()),
                                   Probe("openrouter", CLAUDE, credit=0.0))
        self.assertEqual(len(blockers), 1)
        self.assertFalse(rows["drafting"]["ok"])

    def test_a_working_primary_names_its_fallback_and_is_ready(self):
        rows, blockers = self.rows(self.cfg(), Probe("vps", "opus"), Probe("openrouter", CLAUDE, credit=9.5))
        self.assertEqual(blockers, [])
        self.assertTrue(rows["drafting"]["ok"])
        self.assertIn(f"openrouter ({CLAUDE}) takes over", rows["drafting"]["detail"])

    def test_without_a_fallback_the_primary_blocks_as_it_does_today(self):
        rows, blockers = self.rows(self.cfg("none"), Probe("vps", "opus", ping=signed_out()), None)
        self.assertEqual(blockers, [model.VPS_SIGN_IN])
        self.assertIsNone(rows["fallback"]["ok"])
        self.assertNotIn("fallback answers", rows)


# ---------------------------------------------------------------------------
class OtherJobs(unittest.TestCase):
    def cfg(self, jobs: tuple[str, ...] = ("proposal",)) -> Config:
        c = cfg_in(tempfile.mkdtemp())
        c.provider, c.model, c.fallback, c.fallback_jobs = "openai", "gpt-5", "openrouter", jobs
        return c

    def test_notes_reviews_and_followups_stay_as_they_are_by_default(self):
        cli = load_cli()
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "", "OPENROUTER_API_KEY": "or-test"}):
            for make in (lambda: cli.notes_provider(self.cfg(), fakes_logger()),
                         lambda: cli.review_provider(self.cfg(), fakes_logger())):
                with self.assertRaises(model.ModelUnreachable) as e:
                    make()
                self.assertIn("OPENAI_API_KEY is not set", str(e.exception))

    def test_a_job_the_list_names_falls_back_and_reviews_stay_plain_text(self):
        cli = load_cli()
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "", "OPENROUTER_API_KEY": "or-test"}):
            notes = cli.notes_provider(self.cfg(("proposal", "notes", "digest")), fakes_logger())
            reviews = cli.review_provider(self.cfg(("reviews",)), fakes_logger())
        self.assertIsInstance(notes, model.Failover)
        self.assertEqual((notes.name, notes.model), ("openrouter", "openai/gpt-5"))
        self.assertEqual((reviews.name, reviews.json_mode), ("openrouter", False))


if __name__ == "__main__":
    unittest.main()
