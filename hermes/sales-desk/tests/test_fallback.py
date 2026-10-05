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

import contextlib
import io
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

    def test_the_fallback_is_only_ever_the_one_named_and_none_turns_it_off(self):
        # Opt-in since 2026-10-05: a key on the box is not a choice. The VPS
        # reads OPENROUTER_API_KEY from /opt/data/.env, and lead data would have
        # gone to OpenRouter once its credit was topped up, without anyone
        # choosing it. The VPS names openai in ~/.sales-desk/env.
        self.assertEqual(self.from_env(OPENROUTER_API_KEY="or-test").fallback, "none")
        self.assertEqual(self.from_env().fallback, "none")
        self.assertEqual(self.from_env(OPENROUTER_API_KEY="or-test", SALES_MODEL_FALLBACK="openrouter").fallback,
                         "openrouter")
        self.assertEqual(self.from_env(OPENROUTER_API_KEY="or-test", SALES_MODEL_FALLBACK="none").fallback, "none")
        self.assertEqual(self.from_env(OPENROUTER_API_KEY="or-test", SALES_MODEL_FALLBACK="off").fallback, "none")
        self.assertEqual(self.from_env(SALES_MODEL_FALLBACK="OpenAI").fallback, "openai")

    def test_only_proposals_fall_back_unless_the_jobs_list_says_otherwise(self):
        c = self.from_env(OPENROUTER_API_KEY="or-test", SALES_MODEL_FALLBACK="openrouter")
        self.assertEqual(c.fallback_jobs, ("proposal",))
        self.assertTrue(model.fallback_for(c, "proposal"))
        for job in ("notes", "digest", "reviews", "followups"):
            self.assertFalse(model.fallback_for(c, job), job)
        c = self.from_env(OPENROUTER_API_KEY="or-test", SALES_MODEL_FALLBACK="openrouter",
                          SALES_FALLBACK_JOBS="proposal, notes ,reviews")
        self.assertEqual(c.fallback_jobs, ("proposal", "notes", "reviews"))
        self.assertTrue(model.fallback_for(c, "notes"))
        self.assertFalse(model.fallback_for(c, "followups"))

    def test_a_fallback_that_is_the_primary_itself_is_no_fallback(self):
        c = self.from_env(OPENROUTER_API_KEY="or-test", SALES_MODEL_PROVIDER="openrouter",
                          SALES_MODEL_FALLBACK="openrouter")
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
            # A variant of an allowed model sends the words elsewhere too (a web search for :online).
            with self.assertRaises(model.ModelUnreachable) as e:
                model.fallback_provider(self.cfg(fallback_model="openai/gpt-5:online"))
        self.assertIn("router variant", str(e.exception))
        self.assertIn("Set SALES_FALLBACK_MODEL to openai/gpt-5", str(e.exception))

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
        self.assertIn("20261004p_sales_ai_usage_provider.sql", warned[0])


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



# ---------------------------------------------------------------------------
# The adversarial review of 2026-10-04: each test is a way the fallback could
# have failed a closer, cost money unseen, or sent a draft somewhere wrong.
class Streamed:
    """An open streamed response, as http.open_stream hands back."""

    def __init__(self, *chunks: str):
        self.lines = [x for c in chunks for x in (f"data: {c}\n".encode(), b"\n")]

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def __iter__(self):
        return iter(self.lines)


def streamed_answer(text: str, model_name: str = CLAUDE) -> Streamed:
    import json
    return Streamed(json.dumps({"model": model_name, "choices": [{"delta": {"content": text},
                                                                  "finish_reason": "stop"}]}), "[DONE]")


def stream_error(code: Any, message: str) -> Streamed:
    import json
    return Streamed(json.dumps({"error": {"code": code, "message": message}, "choices": [
        {"index": 0, "delta": {"content": ""}, "finish_reason": "error"}]}))


def router(model_name: str = CLAUDE) -> model.OpenAIShaped:
    return model.OpenAIShaped("openrouter", model.OPENROUTER_URL, "or-test", model_name, json_mode=False)


class OnTheWire(unittest.TestCase):
    def test_claude_through_openrouter_is_never_sent_a_temperature(self):
        # Opus 4.7 and later refuse one (the AnthropicProvider never sends it);
        # through OpenRouter the refusal could arrive inside an opened stream,
        # where it would cost the try rather than be retried without it.
        for name in (CLAUDE, "anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5"):
            self.assertNotIn("temperature", router(name)._body("s", "u", temperature=0.3, stream=True), name)
        # Models that take one still get it, and the primary's request is unchanged.
        self.assertEqual(router("anthropic/claude-sonnet-4.6")._body("s", "u", temperature=0.3, stream=True)
                         ["temperature"], 0.3)
        vps = model.OpenAIShaped("vps", model.VPS_URL, "vps", "opus", json_mode=False)
        self.assertEqual(vps._body("s", "u", temperature=0.3, stream=True)["temperature"], 0.3)

    def test_an_account_out_of_credit_inside_an_opened_stream_is_an_outage_not_a_failed_try(self):
        with mock.patch.object(http, "open_stream", return_value=stream_error(402, "Insufficient credits")):
            with self.assertRaises(model.ModelUnreachable) as e:
                router().complete("s", "u", temperature=0.3)
        self.assertEqual(e.exception.cause, "the openrouter account is out of credit")
        # Through the Failover, that is the wait with both reasons, never a counted try.
        f = failover(Named("vps", "opus", [signed_out()]), router())
        with mock.patch.object(http, "open_stream", return_value=stream_error("402", "Insufficient credits")):
            with self.assertRaises(model.ModelUnreachable) as e:
                f.complete("s", "u")
        self.assertTrue(e.exception.every)
        self.assertIn("out of credit", e.exception.closer)

    def test_a_dropped_stream_is_still_a_failed_try(self):
        with mock.patch.object(http, "open_stream",
                               return_value=stream_error("server_error", "Provider disconnected unexpectedly")):
            with self.assertRaises(model.ModelError) as e:
                router().complete("s", "u")
        self.assertNotIsInstance(e.exception, NotNow)

    def test_a_temperature_refused_inside_a_stream_is_asked_again_without_it(self):
        p = router("anthropic/claude-sonnet-4.6")
        answers = [stream_error(400, "temperature is not supported for this model"), streamed_answer("{}")]
        with mock.patch.object(http, "open_stream", side_effect=answers) as opened:
            self.assertEqual(p.complete("s", "u", temperature=0.3).text, "{}")
        self.assertIn("temperature", opened.call_args_list[0].kwargs["json_body"])
        self.assertNotIn("temperature", opened.call_args_list[1].kwargs["json_body"])


class FallbackModelFits(unittest.TestCase):
    def cfg(self, fallback: str, fallback_model: str = "") -> Config:
        c = cfg_in(tempfile.mkdtemp())
        c.provider, c.model, c.fallback, c.fallback_model = "vps", "opus", fallback, fallback_model
        return c

    def test_an_openrouter_model_left_behind_for_openai_is_one_sentence_not_a_404(self):
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}), \
                mock.patch.object(http, "open_stream", side_effect=AssertionError("asked")):
            with self.assertRaises(model.ModelUnreachable) as e:
                model.fallback_provider(self.cfg("openai", CLAUDE))
        self.assertIn("SALES_FALLBACK_MODEL is anthropic/claude-opus-4.8", str(e.exception))
        self.assertIn("Leave SALES_FALLBACK_MODEL empty to use gpt-5", str(e.exception))

    def test_the_model_each_provider_is_given_by_default_is_one_it_serves(self):
        keys = {"OPENAI_API_KEY": "sk-test", "ANTHROPIC_API_KEY": "ak-test", "OPENROUTER_API_KEY": "or-test"}
        with mock.patch.dict(os.environ, keys):
            for name, expect in (("openrouter", CLAUDE), ("openai", "gpt-5"), ("anthropic", "claude-opus-4-8")):
                self.assertEqual(model.fallback_provider(self.cfg(name)).model, expect)
            c = self.cfg("vps")
            c.provider, c.model = "openai", "gpt-5"
            self.assertEqual(model.fallback_provider(c).model, "opus")

    def test_a_model_the_fallback_does_not_have_names_the_fallbacks_setting(self):
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "or-test"}):
            p = model.fallback_provider(self.cfg("openrouter", "anthropic/claude-opus-9"))
        gone = http.HttpError(404, "not found", b'{"error":{"message":"model_not_found"}}')
        with mock.patch.object(http, "open_stream", side_effect=gone):
            with self.assertRaises(model.ModelUnreachable) as e:
                p.complete("s", "u")
        self.assertIn("Set SALES_FALLBACK_MODEL to one", str(e.exception))
        self.assertNotIn("SALES_PROPOSAL_MODEL", str(e.exception))


class SaidOutLoud(unittest.TestCase):
    def test_the_handover_is_a_warning_so_the_quiet_cron_log_keeps_it(self):
        info: list[str] = []
        warned: list[str] = []
        f = model.Failover(lambda: Named("vps", "opus", [signed_out()]), lambda: Named("openrouter", CLAUDE, ["ok"]),
                           log=info.append, warn=warned.append, primary_label="vps (opus)")
        f.complete("s", "u")
        self.assertEqual(warned, [f"vps (opus) cannot answer (the Claude sign-in on the VPS has lapsed); this run "
                                  f"uses openrouter ({CLAUDE}) instead"])
        self.assertEqual(info, [])

    def test_the_requests_health_line_says_drafts_went_through_the_fallback(self):
        cli = load_cli()
        note = f"Drafted through openrouter ({CLAUDE}) because the Claude sign-in on the VPS has lapsed."
        out = {"seen": 1, "done": 1, "failed": 0, "retry": 0, "waiting": 0, "skipped": 0, "reaped": 0,
               "statuses": {"needs_input": 1}, "fallback": {"drafts": 1, "note": note}}
        args = mock.Mock(limit=None, json=False)
        err = io.StringIO()
        with mock.patch.object(cli.queue_mod, "run_requests", return_value=out), \
                mock.patch.object(cli, "_resync_stuck", return_value=""), \
                mock.patch.object(cli, "_sb", return_value=None), \
                mock.patch.object(cli, "_status") as status, contextlib.redirect_stderr(err), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.cmd_requests(cfg_in(tempfile.mkdtemp()), args, fakes_logger()), 0)
        ok, detail = status.call_args.args[3], status.call_args.args[4]
        self.assertTrue(ok)
        self.assertTrue(detail.startswith(f"1 drafted through the fallback: {note[:-1]}; 1 done (1 needs input)"),
                        detail)
        self.assertIn("WARN  requests: 1 drafted through the fallback", err.getvalue())


class QueueBesideAnOutage(unittest.TestCase):
    """The run's other requests while a draft waits for a model."""

    setUp = QueueOnTheFallback.setUp
    queue = QueueOnTheFallback.queue
    worker = QueueOnTheFallback.worker

    def rebuild_ready(self, rid: str, pid: str) -> None:
        deal = specific_deal()
        deal["cost"]["close"] = "USD 4,000"
        self.pg.put(PROP, {"id": pid, "request_id": rid, "contact_id": "c-1", "lang": "en", "status": "drafting",
                           "deal": deal, "validation": {}, "html_path": f"proposals/{pid}/v1.html", "pdf_path": None,
                           "model": f"openrouter:{CLAUDE}", "created_by": "rep.one@maharamedia.com",
                           "created_at": "2099-01-01T10:00:00Z", "updated_at": "2099-01-01T10:00:00Z"})
        self.pg.put(REQ, {"id": rid, "kind": "proposal", "contact_id": "c-1",
                          "params": {"proposal_id": pid, "rebuild": True, "lang": "en"}, "status": "queued",
                          "requested_by": "rep.one@maharamedia.com", "requested_at": "2099-01-01T11:09:00Z",
                          "claimed_at": None, "claimed_by": None, "attempts": 0, "finished_at": None,
                          "error": None, "result": None})

    def test_a_rebuild_behind_a_waiting_draft_still_goes_ahead(self):
        self.queue("req-1", "p-1")
        self.rebuild_ready("req-9", "p-9")
        vps = Named("vps", "opus", [signed_out()])
        out = self.worker(lambda c, l: vps, lambda c, l: Named("openrouter", CLAUDE, [no_credit()])).run()
        self.assertEqual((out["waiting"], out["done"]), (1, 1))
        self.assertEqual(self.pg.one(REQ, id="req-9")["status"], "done")
        self.assertEqual((self.pg.one(REQ, id="req-1")["status"], self.pg.one(REQ, id="req-1")["attempts"]),
                         ("queued", 0))
        self.assertIn("No model can answer right now", out["blocked"])

    def test_every_draft_waiting_on_no_model_is_told_and_the_fallback_is_asked_once(self):
        self.queue("req-1", "p-1")
        self.queue("req-2", "p-2")
        vps = Named("vps", "opus", [signed_out()])
        broke = Named("openrouter", CLAUDE, [no_credit()])
        out = self.worker(lambda c, l: vps, lambda c, l: broke).run()
        self.assertEqual(out["waiting"], 2)
        self.assertEqual((len(vps.calls), len(broke.calls)), (1, 1))
        second = self.pg.one(REQ, id="req-2")
        self.assertEqual((second["status"], second["attempts"], second["claimed_by"]), ("queued", 0, None))
        self.assertTrue(second["error"].startswith("No model can answer right now"), second["error"])
        self.assertEqual(self.pg.one(PROP, id="p-2")["error"], self.pg.one(PROP, id="p-1")["error"])
        self.assertIn("tell the CEO", self.pg.one(PROP, id="p-2")["error"])

    def test_a_draft_cut_off_partway_does_not_put_its_sentence_on_the_others(self):
        self.queue("req-1", "p-1")
        self.queue("req-2", "p-2")
        vps = Named("vps", "opus", [triage_answer(), signed_out()])
        out = self.worker(lambda c, l: vps, lambda c, l: Named("openrouter", CLAUDE, ["never"])).run()
        self.assertEqual(out["waiting"], 2)
        self.assertIn("partway", self.pg.one(PROP, id="p-1")["error"])
        self.assertIsNone(self.pg.one(PROP, id="p-2").get("error"))  # it never started: nothing stopped partway
        second = self.pg.one(REQ, id="req-2")
        self.assertEqual((second["status"], second["attempts"]), ("queued", 0))
        self.assertTrue(second["error"].startswith("Not started this run: vps (opus) stopped answering partway "
                                                   "through another proposal"), second["error"])

    def test_a_run_on_the_fallback_reports_its_drafts(self):
        self.queue("req-1", "p-1")
        router_ = Named("openrouter", CLAUDE, [triage_answer(), specific_deal()])
        out = self.worker(lambda c, l: Named("vps", "opus", [signed_out()]), lambda c, l: router_).run()
        self.assertEqual(out["fallback"], {"drafts": 1, "note": f"Drafted through openrouter ({CLAUDE}) because the "
                                                                "Claude sign-in on the VPS has lapsed."})
        out = self.worker(lambda c, l: Named("vps", "opus", []), fakes.never).run()
        self.assertNotIn("fallback", out)


# ---------------------------------------------------------------------------
class OpenAIGpt5Fallback(unittest.TestCase):
    """The VPS's fallback since 2026-10-04: SALES_MODEL_FALLBACK=openai,
    SALES_FALLBACK_MODEL=gpt-5, SALES_FALLBACK_JOBS=proposal (the OpenRouter
    account is out of credit). gpt-5 is a reasoning model, so the request
    carries nothing it refuses."""

    ENV = {"SALES_MODEL_PROVIDER": "vps", "SALES_PROPOSAL_MODEL": "opus", "SALES_MODEL_FALLBACK": "openai",
           "SALES_FALLBACK_MODEL": "gpt-5", "SALES_FALLBACK_JOBS": "proposal", "OPENAI_API_KEY": "sk-test-000000",
           "OPENROUTER_API_KEY": "or-test"}

    def gpt5(self, **env: str) -> model.OpenAIShaped:
        with mock.patch.dict(os.environ, {**self.ENV, **env}):
            cfg = Config.from_env()
            self.assertTrue(model.fallback_for(cfg, "proposal"))
            p = model.fallback_provider(cfg, primary_model=cfg.model)
        return getattr(p, "inner", p)

    def test_the_vps_settings_reach_openai_with_gpt5_even_with_an_openrouter_key_on_the_box(self):
        p = self.gpt5()
        self.assertEqual((p.name, p.base, p.model, p.json_mode), ("openai", model.OPENAI_URL, "gpt-5", True))
        self.assertEqual(p._headers()["Authorization"], "Bearer sk-test-000000")
        self.assertEqual(p.model_setting, "SALES_FALLBACK_MODEL")

    def test_a_draft_request_carries_nothing_gpt5_refuses(self):
        body = self.gpt5(SALES_MAX_TOKENS="32000")._body("s", "u", temperature=0.3, stream=True)
        for refused in ("temperature", "max_tokens", "top_p", "presence_penalty", "frequency_penalty", "logprobs",
                        "stop", "reasoning_effort"):
            self.assertNotIn(refused, body, refused)
        self.assertEqual(body["max_completion_tokens"], 32000)
        self.assertEqual(body["response_format"], {"type": "json_object"})
        self.assertEqual(body["stream_options"], {"include_usage": True})

    def test_a_reasoning_effort_gpt5_takes_is_sent_and_one_it_refuses_is_left_out(self):
        for effort, sent in (("minimal", "minimal"), ("high", "high"), ("none", None), ("xhigh", None)):
            body = self.gpt5(SALES_REASONING_EFFORT=effort)._body("s", "u", temperature=None, stream=False)
            self.assertEqual(body.get("reasoning_effort"), sent, effort)
        self.assertEqual(model.effort_for("gpt-5.2", "xhigh"), "xhigh")
        self.assertEqual(model.effort_for("o3", "minimal"), "")
        self.assertEqual(model.effort_for("gpt-4.1", "high"), "")

    def test_a_reasoning_effort_refused_anyway_is_asked_again_without_it(self):
        p = self.gpt5(SALES_REASONING_EFFORT="high")
        refused = http.HttpError(400, "bad request", b'{"error":{"message":"Unsupported value: \'reasoning_effort\' '
                                                     b'does not support \'high\' with this model.","param":'
                                                     b'"reasoning_effort"}}')
        with mock.patch.object(http, "open_stream", side_effect=[refused, streamed_answer("{}", "gpt-5")]) as opened:
            self.assertEqual(p.complete("s", "u").text, "{}")
        self.assertEqual(opened.call_args_list[0].kwargs["json_body"]["reasoning_effort"], "high")
        self.assertNotIn("reasoning_effort", opened.call_args_list[1].kwargs["json_body"])

    def test_an_unverified_organisation_still_gets_its_draft_without_streaming(self):
        p = self.gpt5()
        unverified = http.HttpError(400, "bad request", b'{"error":{"message":"Your organization must be verified '
                                                        b'to stream this model.","param":"stream"}}')
        body = b'{"model":"gpt-5","choices":[{"message":{"content":"{}"},"finish_reason":"stop"}]}'
        with mock.patch.object(http, "open_stream", side_effect=unverified), \
                mock.patch.object(http, "request", return_value=(200, {}, body)) as asked:
            self.assertEqual(p.complete("s", "u").text, "{}")
        sent = asked.call_args.kwargs["json_body"]
        self.assertFalse(sent["stream"])
        self.assertNotIn("stream_options", sent)
        self.assertNotIn("temperature", sent)

    def test_the_ping_asks_for_one_token_the_way_gpt5_takes_it(self):
        p = self.gpt5()
        with mock.patch.object(http, "request", return_value=(200, {}, b'{"model":"gpt-5-2025-08-07","choices":[]}')) \
                as asked:
            self.assertEqual(p.ping(), "gpt-5-2025-08-07 answered")
        sent = asked.call_args.kwargs["json_body"]
        self.assertEqual(sent["max_completion_tokens"], 1)
        self.assertNotIn("max_tokens", sent)
        self.assertNotIn("temperature", sent)


class Streams(Probe):
    def __init__(self, *a: Any, streams: Optional[bool] = True, **kw: Any):
        super().__init__(*a, **kw)
        self._streams = streams

    def stream_check(self, timeout: float = 60) -> Optional[bool]:
        return self._streams


class DoctorOnOpenAI(unittest.TestCase):
    cfg = Doctor.cfg
    rows = Doctor.rows

    def test_the_openai_fallback_reads_as_one_story(self):
        rows, blockers = self.rows(self.cfg("openai"), Probe("vps", "opus", ping=signed_out()),
                                   Streams("openai", "gpt-5", models=["gpt-4.1", "gpt-5"], streams=False))
        self.assertEqual(blockers, [])
        self.assertIn("SALES_MODEL_FALLBACK=openai, model gpt-5", rows["fallback"]["detail"])
        self.assertTrue(rows["fallback listed"]["ok"])
        self.assertIsNone(rows["fallback streams"]["ok"])
        self.assertIn("without streaming", rows["fallback streams"]["detail"])
        self.assertNotIn("fallback credit", rows)
        self.assertIn("proposals draft through openai (gpt-5)", rows["drafting"]["detail"])

    def test_no_fallback_points_at_openai_and_where_to_set_it(self):
        rows, _ = self.rows(self.cfg("none"), Probe("vps", "opus"), None)
        self.assertIn("SALES_MODEL_FALLBACK=openai in ~/.sales-desk/env", rows["fallback"]["detail"])

    def test_an_openrouter_account_out_of_credit_says_both_ways_out(self):
        rows, _ = self.rows(self.cfg(), Probe("vps", "opus", ping=signed_out()),
                            Probe("openrouter", CLAUDE, credit=-0.13))
        self.assertIn("SALES_MODEL_FALLBACK=openai", rows["fallback credit"]["detail"])
        self.assertIn("openrouter.ai/settings/credits", rows["fallback credit"]["detail"])


if __name__ == "__main__":
    unittest.main()
