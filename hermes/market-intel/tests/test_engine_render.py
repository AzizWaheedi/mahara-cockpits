"""The engine (no tools, Claude only, the two doors behind a switch) and the renderer (numbers from evidence,
"[ ]" when missing, a range when two sources differ, Docs requests that a fake Docs API applies exactly)."""
import io
import json
import subprocess
import unittest

from mi import config as config_mod
from mi import model, render
from mi.evidence import Draft, Pack
from mi.facts import Facts, display
from mi.ledger import memory_ledger
from tests import fakes


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Engines(unittest.TestCase):
    def test_only_claude_models_and_never_a_router_variant(self):
        for bad in ("deepseek-chat", "gpt-5", "opus:online", ""):
            with self.assertRaises(model.ModelUnreachable):
                model.check_model(bad)
        for good in ("opus", "sonnet", "claude-opus-5"):
            model.check_model(good)

    def test_the_cli_door_turns_every_tool_off_and_never_falls_back_to_api_billing(self):
        seen = {}

        def run(argv, **kw):
            seen.update(argv=argv, **kw)
            return subprocess.CompletedProcess(argv, 0, stdout=json.dumps({"type": "result", "is_error": False,
                                                                           "result": "{\"ok\": true}", "total_cost_usd": 0.4}), stderr="")
        led, rows = memory_ledger()
        import os
        os.environ["ANTHROPIC_API_KEY"] = "should-be-removed"
        try:
            eng = model.CliEngine("claude", "setup-token-test", led, run=run)
            reply = eng.complete("sys", "user words", model="opus", timeout=60)
        finally:
            del os.environ["ANTHROPIC_API_KEY"]
        self.assertEqual(model.as_json(reply.text), {"ok": True})
        argv = seen["argv"]
        self.assertEqual(argv[argv.index("--tools") + 1], "")
        self.assertIn("--strict-mcp-config", argv)
        self.assertEqual(seen["input"], "user words")
        self.assertNotIn("ANTHROPIC_API_KEY", seen["env"])
        self.assertEqual(seen["env"]["CLAUDE_CODE_OAUTH_TOKEN"], "setup-token-test")
        self.assertEqual(reply.usage["planUsdEquivalent"], 0.4)
        self.assertEqual([r["provider"] for r in rows], ["claude", "claude"])

    def test_the_cli_door_says_what_a_lapsed_sign_in_means(self):
        def run(argv, **kw):
            return subprocess.CompletedProcess(argv, 1, stdout=json.dumps({"is_error": True, "result": "Invalid API key · Please run /login"}), stderr="")
        with self.assertRaises(model.ModelUnreachable) as e:
            model.CliEngine("claude", "t", memory_ledger()[0], run=run).complete("s", "u", model="opus", timeout=5)
        self.assertIn("sign-in", e.exception.sentence)
        with self.assertRaises(model.ModelUnreachable):
            model.CliEngine("claude", "", memory_ledger()[0], run=run).complete("s", "u", model="opus", timeout=5)

    def test_the_vps_door_reads_the_stream_and_its_errors(self):
        body = b'data: {"choices":[{"delta":{"content":"{\\"a\\":"}}]}\n\ndata: {"choices":[{"delta":{"content":" 1}"}}]}\n\ndata: [DONE]\n'
        eng = model.VpsEngine("http://127.0.0.1:3456/v1", memory_ledger()[0], open_stream=lambda *a, **k: FakeResp(body))
        self.assertEqual(model.as_json(eng.complete("s", "u", model="opus", timeout=5).text), {"a": 1})
        err = b'data: {"choices":[{"delta":{"content":"[Error: You have hit your limit]"}}]}\n'
        eng = model.VpsEngine("http://x/v1", memory_ledger()[0], open_stream=lambda *a, **k: FakeResp(err))
        with self.assertRaises(model.ModelUnreachable) as e:
            eng.complete("s", "u", model="opus", timeout=5)
        self.assertIn("usage limit", e.exception.sentence)

    def test_the_switch(self):
        cfg = fakes.cfg(env={"MARKET_INTEL_MODEL_PROVIDER": "cli", "CLAUDE_CODE_OAUTH_TOKEN": "t"})
        self.assertIsInstance(model.engine(cfg, memory_ledger()[0]), model.CliEngine)
        self.assertIsInstance(model.engine(fakes.cfg(), memory_ledger()[0]), model.VpsEngine)
        with self.assertRaises(model.ModelUnreachable):
            model.engine(fakes.cfg(env={"MARKET_INTEL_MODEL_PROVIDER": "anthropic"}), memory_ledger()[0])

    def test_json_is_found_in_a_fenced_or_chatty_answer(self):
        self.assertEqual(model.as_json("```json\n{\"x\": [1]}\n```"), {"x": [1]})
        self.assertEqual(model.as_json("Sure. {\"x\": \"a } b\"} done"), {"x": "a } b"})
        with self.assertRaises(model.ModelError):
            model.as_json("no json here")

    def test_json_after_prose_keeps_escaped_quotes_inside_strings(self):
        whole = {"schema": "x", "sections": [{"text": 'a 12" panel'}, {"text": "b"}]}
        self.assertEqual(model.as_json("Here is the JSON:\n" + json.dumps(whole)), whole)
        three = {"competitors": [{"kid": "K1", "why": 'the "best" 3" tiles, "\\" too'}], "reserves": []}
        self.assertEqual(model.as_json("Sure {not json}. " + json.dumps(three) + "\nHope that helps {x}."), three)


class Renderer(unittest.TestCase):
    def setUp(self):
        self.pack = Pack()
        self.place = self.pack.items and None
        e1 = self.pack.add(Draft(kind="maps_place", subject="client", source="maps", url="https://maps.example/c",
                                 retrieved_at="2026-11-02T10:00:00Z", body={"rating": 4.6}))
        e2 = self.pack.add(Draft(kind="maps_place", subject="client", source="reviews", url="https://maps.example/c",
                                 retrieved_at="2026-11-02T10:05:00Z", body={"rating": 4.3, "secondSource": True}))
        self.facts = Facts()
        self.facts.put("client", "maps.rating", 4.6, self.pack.get(e1))
        self.facts.second("client", "maps.rating", 4.3, self.pack.get(e2))

    def test_numbers_come_from_evidence_and_missing_is_never_zero(self):
        text = render.fill("Rated {m1}; reviews {m2}.", [{"ref": "m1", "metric": "maps.rating", "of": "client"},
                                                         {"ref": "m2", "metric": "maps.reviews", "of": "client"}], self.facts, "en")
        self.assertEqual(text, "Rated 4.3 to 4.6 [E1, E2, 2026-11-02; two sources differ]; reviews [ ].")
        self.assertEqual(display("web.meta_pixel", {"value": False}), "not found")
        self.assertEqual(display("ig.followers", None), "[ ]")
        self.assertEqual(display("ig.followers", {"value": 0}), "0")

    def test_docs_requests_rebuild_the_tab_exactly_under_a_fake_docs_api(self):
        bl = [("TITLE", "Report"), ("HEADING_2", "01 Summary"), ("NORMAL", "Line with an emoji 😀 and عربي"), ("NORMAL", "End")]
        reqs = render.docs_requests("t.0", bl, rtl=True)
        doc = {"t.0": "\n"}            # a fresh tab: one newline at index 1's end
        styles = []
        for r in reqs:
            if "insertText" in r:
                loc = r["insertText"]["location"]
                units = doc[loc["tabId"]].encode("utf-16-le")
                at = (loc["index"] - 1) * 2
                doc[loc["tabId"]] = (units[:at] + r["insertText"]["text"].encode("utf-16-le") + units[at:]).decode("utf-16-le")
            else:
                rng = r["updateParagraphStyle"]["range"]
                units = doc[rng["tabId"]].encode("utf-16-le")
                styles.append((units[(rng["startIndex"] - 1) * 2:(rng["endIndex"] - 1) * 2].decode("utf-16-le"),
                               r["updateParagraphStyle"]["paragraphStyle"]["namedStyleType"],
                               r["updateParagraphStyle"]["paragraphStyle"]["direction"]))
        self.assertEqual(doc["t.0"], "Report\n01 Summary\nLine with an emoji 😀 and عربي\nEnd\n\n")
        self.assertEqual(styles, [("Report\n", "TITLE", "RIGHT_TO_LEFT"), ("01 Summary\n", "HEADING_2", "RIGHT_TO_LEFT"),
                                  ("Line with an emoji 😀 and عربي\n", "NORMAL", "RIGHT_TO_LEFT"), ("End\n", "NORMAL", "RIGHT_TO_LEFT")])

    def test_the_answers_tab_and_the_outputs(self):
        bl = render.answers_blocks([{"ref": "r1", "title": "Business Name", "value": "Cedar"}], "2026-10-20T09:00:00Z", "Cedar")
        self.assertEqual(render.text_of(bl).splitlines()[2], "Submitted 2026-10-20. Contact details are on the client card.")
        out = render.outputs(task_id="t1", run_id="11111111-2222-4333-8444-555555555555", mode="shadow", competitors_n=6, sources_n=31)
        self.assertEqual(out["field"]["id"], config_mod.MARKET_RESEARCH_FIELD)
        self.assertEqual((out["field"]["sent"], out["comment"]["sent"], out["comment"]["notifyAll"]), (False, False, False))
        self.assertIn("6 competitors, 31 sources", out["comment"]["text"])


class Config(unittest.TestCase):
    def test_keys_by_name_from_the_env_file_and_the_environment_first(self):
        import tempfile, os
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".env") as fh:
            fh.write("export MARKET_INTEL_APIFY_KEY='from-file'\nAPIFY_API_KEY=radar\n# comment\n")
        try:
            k = config_mod.Keys(environ={"SCRAPECREATORS_API_KEY": "env"}, files=(fh.name,))
            self.assertEqual(k.first(config_mod.APIFY_KEYS), ("MARKET_INTEL_APIFY_KEY", "from-file"))
            self.assertEqual(k.get("SCRAPECREATORS_API_KEY"), "env")
            self.assertFalse(k.has("MARKET_INTEL_SUPABASE_KEY"))
            c = config_mod.load(config_mod.Keys(environ={"MARKET_INTEL_USD_CAP_RUN": "1.5", "MARKET_INTEL_ACTOR_MAPS": "x~y"}, files=()))
            self.assertEqual((c.usd_cap_run, c.actor("maps"), c.actor("reviews"), c.provider, c.apply),
                             (1.5, "x~y", "compass~Google-Maps-Reviews-Scraper", "vps", False))
        finally:
            os.unlink(fh.name)


if __name__ == "__main__":
    unittest.main()
