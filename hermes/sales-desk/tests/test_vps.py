"""The Claude proxy on the VPS as the desk's provider (SALES_MODEL_PROVIDER=vps)."""
from __future__ import annotations

import json
import os
import unittest
from unittest import mock

from desk import http, model
from desk.config import DEFAULT_MODELS, PROVIDERS, Config
from desk.errors import NotNow


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


def said(text: str) -> str:
    return json.dumps({"model": "opus", "choices": [{"delta": {"content": text}, "finish_reason": "stop"}]})


class VpsProvider(unittest.TestCase):
    def cfg(self, **kw) -> Config:
        with mock.patch.dict(os.environ, {"SALES_MODEL_PROVIDER": "vps", "SALES_PROPOSAL_MODEL": "",
                                          "OPENAI_API_KEY": "", "ANTHROPIC_API_KEY": ""}):
            c = Config.from_env()
        for k, v in kw.items():
            setattr(c, k, v)
        return c

    def test_no_key_and_the_local_proxy(self):
        self.assertIn("vps", PROVIDERS)
        self.assertEqual(DEFAULT_MODELS["vps"], "opus")
        c = self.cfg()
        c.provider, c.model = "vps", "opus"
        p = model._provider(c)
        self.assertEqual((p.name, p.base, p.model, p.json_mode), ("vps", model.VPS_URL, "opus", False))

    def test_a_lapsed_sign_in_is_one_sentence(self):
        body = b'{"error":{"message":"Failed to authenticate. API Error: 401 OAuth access token has expired."}}'
        e = http.HttpError(500, "proxy_error", body, "http://127.0.0.1:3456/v1/chat/completions")
        err = model._classify(e, "vps", "opus")
        self.assertIsInstance(err, NotNow)
        self.assertEqual(str(err), model.VPS_SIGN_IN)

    def test_an_error_in_the_answer_is_never_a_draft(self):
        # What the proxy streams, with a 200, when Claude Code's sign-in has lapsed (2026-09-27).
        p = model.OpenAIShaped("vps", model.VPS_URL, "vps", "opus", json_mode=False)
        lapsed = said("[Error: Failed to authenticate. API Error: 401 OAuth access token has expired. "
                      "Re-authenticate to continue.\n]")
        with mock.patch.object(http, "open_stream", return_value=Streamed(lapsed, "[DONE]")):
            with self.assertRaises(NotNow) as caught:
                p.complete("s", "u")
        self.assertEqual(str(caught.exception), model.VPS_SIGN_IN)
        with mock.patch.object(http, "open_stream",
                               return_value=Streamed(said("[Error: Claude AI usage limit reached|1790510000]"), "[DONE]")):
            with self.assertRaises(NotNow) as caught:
                p.complete("s", "u")
        self.assertIn("usage limit", str(caught.exception))
        with mock.patch.object(http, "open_stream", return_value=Streamed(said("[Error: spawn claude ENOENT]"), "[DONE]")):
            with self.assertRaises(model.ModelError):
                p.complete("s", "u")

    def test_an_answer_counts_against_the_ceiling(self):
        p = model.OpenAIShaped("vps", model.VPS_URL, "vps", "opus", json_mode=False)
        with mock.patch.object(http, "open_stream", return_value=Streamed(said('{"ok": 1}'), "[DONE]")):
            r = p.complete("system", "user words")
        self.assertEqual(r.text, '{"ok": 1}')
        self.assertEqual(r.usage["prompt_tokens"], 6)  # 16 characters asked, three a token, rounded up
        self.assertEqual(r.usage["completion_tokens"], 3)
        self.assertEqual(r.usage["total_tokens"], 9)

    def test_claude_code_names_pass_and_others_do_not(self):
        self.assertTrue(model.model_allowed("opus"))
        self.assertTrue(model.model_allowed("sonnet"))
        self.assertFalse(model.model_allowed("deepseek-chat"))
        self.assertFalse(model.model_allowed("qwen-max"))


if __name__ == "__main__":
    unittest.main()
