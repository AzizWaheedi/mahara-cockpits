#!/usr/bin/env python3
"""Offline tests for responder.py, the fast Hermes chat responder.

Verifies:
  - find_client: the job's client wins, full names match in either case, the first
    word of a 4+ letter name matches as a whole word, older history prompts count,
    and no match returns None
  - guess_client: the model answer is mapped back to the list's exact casing, NONE
    and unknown names return None, a model error returns None, and haiku models go first
  - build_messages: system rules and data come first, history is replayed oldest
    first with replies, entries without a reply are skipped, and images attach to
    the current question
  - askai_reply: strings pass through, dicts use reply then answer then text
  - model_chain: the Ask AI cron job's model leads and config.yaml fallbacks follow
    without duplicates; a missing jobs.json keeps the fallbacks
  - ask_model: a failing provider falls through, an empty answer counts as a failure,
    and every provider failing raises one RuntimeError that names them
  - client_pack: campaign and per-ad numbers render with windows, a failed read and an
    untied account say so, and the ad query strips the act_ prefix
  - drive_pack: no links means nothing, a missing token says so, link forms are read,
    and the same file twice is read once

No network calls: get, ask_model, drive_token and fetch are patched.
All data is fictional.
"""
import io
import json
import os
import sys
import tempfile
import types
import unittest
import warnings
from contextlib import redirect_stdout
from datetime import datetime, timedelta
from unittest.mock import patch

import responder

NAMES = ["Acme Tiles", "Blue Marble Co", "Cedar Homes"]
DRIVE_ID = "1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
IMAGE = {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA"}}


class TestFindClient(unittest.TestCase):
    def test_job_client_wins_over_the_prompt(self):
        job = {"client_name": "Acme Tiles", "prompt": "how is blue marble co doing"}
        self.assertEqual(responder.find_client(job, NAMES), "Acme Tiles")

    def test_full_name_matches_in_any_case(self):
        job = {"prompt": "how is blue marble co doing"}
        self.assertEqual(responder.find_client(job, NAMES), "Blue Marble Co")

    def test_first_word_matches_as_a_whole_word(self):
        self.assertEqual(responder.find_client({"prompt": "the Cedar account"}, NAMES), "Cedar Homes")
        self.assertIsNone(responder.find_client({"prompt": "cedarwood is a tree"}, NAMES))

    def test_history_prompt_counts(self):
        job = {"prompt": "and the leads?", "context": {"history": [{"prompt": "tell me about Blue Marble Co"}]}}
        self.assertEqual(responder.find_client(job, NAMES), "Blue Marble Co")

    def test_no_match_returns_none(self):
        self.assertIsNone(responder.find_client({"prompt": "what is the weather"}, NAMES))


class TestGuessClient(unittest.TestCase):
    @patch("responder.ask_model")
    def test_answer_maps_to_the_list_casing(self, mock_ask):
        mock_ask.return_value = ("  blue marble co ", "p/m")
        self.assertEqual(responder.guess_client({"prompt": "leads?"}, NAMES, [("a", "sonnet-x")]), "Blue Marble Co")

    @patch("responder.ask_model")
    def test_none_and_unknown_names_return_none(self, mock_ask):
        mock_ask.return_value = ("NONE", "p/m")
        self.assertIsNone(responder.guess_client({"prompt": "leads?"}, NAMES, [("a", "sonnet-x")]))
        mock_ask.return_value = ("Delta Works", "p/m")
        self.assertIsNone(responder.guess_client({"prompt": "leads?"}, NAMES, [("a", "sonnet-x")]))

    @patch("responder.ask_model")
    def test_model_error_returns_none(self, mock_ask):
        mock_ask.side_effect = RuntimeError("both providers failed")
        self.assertIsNone(responder.guess_client({"prompt": "leads?"}, NAMES, [("a", "sonnet-x")]))

    @patch("responder.ask_model")
    def test_haiku_models_are_tried_first(self, mock_ask):
        mock_ask.return_value = ("NONE", "p/m")
        responder.guess_client({"prompt": "leads?"}, NAMES, [("a", "sonnet-x"), ("a", "haiku-y")])
        chain = mock_ask.call_args[0][1]
        self.assertEqual(chain[0], ("a", "haiku-y"))


class TestBuildMessages(unittest.TestCase):
    def job(self):
        return {
            "prompt": "current question",
            "app": "media-buyer",
            "role": "buyer",
            "context": {
                "history": [
                    {"prompt": "second", "result": {"reply": "answer two"}},
                    {"prompt": "first", "result": {"reply": "answer one"}},
                    {"prompt": "no reply here", "result": {}},
                ]
            },
        }

    def test_system_then_history_oldest_first_then_question(self):
        data = "DATA BODY FOR THE TEST"
        msgs = responder.build_messages(self.job(), data, [], "campaigns")
        self.assertEqual(msgs[0]["role"], "system")
        self.assertIn(responder.SYSTEM, msgs[0]["content"])
        self.assertIn("DATA (read", msgs[0]["content"])
        self.assertIn(data, msgs[0]["content"])
        self.assertEqual(
            [(m["role"], m["content"]) for m in msgs[1:]],
            [
                ("user", "first"),
                ("assistant", "answer one"),
                ("user", "second"),
                ("assistant", "answer two"),
                ("user", "current question"),
            ],
        )

    def test_images_attach_to_the_current_question(self):
        msgs = responder.build_messages(self.job(), "data", [IMAGE], None)
        self.assertEqual(msgs[-1]["role"], "user")
        self.assertEqual(msgs[-1]["content"][0], {"type": "text", "text": "current question"})
        self.assertEqual(msgs[-1]["content"][1], IMAGE)


class TestAskaiReply(unittest.TestCase):
    def test_string_passes_through(self):
        self.assertEqual(responder.askai_reply("plain"), "plain")

    def test_dict_priority_is_reply_answer_text(self):
        self.assertEqual(responder.askai_reply({"reply": "r", "answer": "a", "text": "t"}), "r")
        self.assertEqual(responder.askai_reply({"answer": "a", "text": "t"}), "a")
        self.assertEqual(responder.askai_reply({"text": "t"}), "t")

    def test_blank_or_missing_is_empty(self):
        for value in ({}, {"reply": "   "}, {"answer": "", "text": "  "}, None, 42):
            self.assertEqual(responder.askai_reply(value), "")


class TestModelChain(unittest.TestCase):
    def setUp(self):
        self.orig_env = dict(os.environ)
        self.tmp = tempfile.TemporaryDirectory()
        self.home = self.tmp.name

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.orig_env)
        self.tmp.cleanup()

    def write(self, name, text):
        os.makedirs(os.path.dirname(os.path.join(self.home, name)), exist_ok=True)
        with open(os.path.join(self.home, name), "w", encoding="utf-8") as f:
            f.write(text)

    def chain(self):
        with patch.object(responder, "HERMES_HOME", self.home), redirect_stdout(io.StringIO()), warnings.catch_warnings():
            warnings.simplefilter("ignore", ResourceWarning)
            return responder.model_chain()

    def test_cron_job_model_leads_then_fallbacks_without_duplicates(self):
        self.write(
            "cron/jobs.json",
            json.dumps(
                {
                    "jobs": [
                        {"name": responder.ASK_AI_CRON_NAME, "provider": "p1", "model": "m1"},
                        {"name": "Other", "provider": "x", "model": "y"},
                    ]
                }
            ),
        )
        self.write(
            "config.yaml",
            "fallback_providers:\n"
            "  - provider: p2\n    model: m2\n"
            "  - provider: p1\n    model: m1\n"
            "  - provider: p3\n    model: m3\n",
        )
        self.assertEqual(self.chain(), [("p1", "m1"), ("p2", "m2"), ("p3", "m3")])

    def test_missing_jobs_file_still_returns_the_fallbacks(self):
        self.write(
            "config.yaml",
            "fallback_providers:\n"
            "  - provider: p2\n    model: m2\n"
            "  - provider: p1\n    model: m1\n"
            "  - provider: p3\n    model: m3\n",
        )
        self.assertEqual(self.chain(), [("p2", "m2"), ("p1", "m1"), ("p3", "m3")])


class TestAskModel(unittest.TestCase):
    def setUp(self):
        self.orig_env = dict(os.environ)
        self.saved = {k: sys.modules.get(k) for k in ("agent", "agent.auxiliary_client")}
        self.aux = types.ModuleType("agent.auxiliary_client")
        self.pkg = types.ModuleType("agent")
        self.pkg.__path__ = []
        self.pkg.auxiliary_client = self.aux
        sys.modules["agent"] = self.pkg
        sys.modules["agent.auxiliary_client"] = self.aux

    def tearDown(self):
        for name, mod in self.saved.items():
            if mod is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = mod
        os.environ.clear()
        os.environ.update(self.orig_env)

    def fake_call(self, fail=(), empty=(), content=" hello "):
        def call_llm(provider, model, messages, max_tokens, timeout):
            if provider in fail:
                raise RuntimeError("provider is down")
            body = "   " if provider in empty else content
            return types.SimpleNamespace(
                choices=[types.SimpleNamespace(message=types.SimpleNamespace(content=body))]
            )

        return call_llm

    def test_failing_provider_falls_through(self):
        self.aux.call_llm = self.fake_call(fail=("p1",))
        self.assertEqual(
            responder.ask_model([{"role": "user", "content": "hi"}], [("p1", "m1"), ("p2", "m2")]),
            ("hello", "p2/m2"),
        )

    def test_empty_answer_counts_as_a_failure(self):
        self.aux.call_llm = self.fake_call(empty=("p1",))
        self.assertEqual(
            responder.ask_model([{"role": "user", "content": "hi"}], [("p1", "m1"), ("p2", "m2")]),
            ("hello", "p2/m2"),
        )

    def test_all_providers_failing_names_them_all(self):
        self.aux.call_llm = self.fake_call(fail=("p1", "p2"))
        with self.assertRaises(RuntimeError) as ctx:
            responder.ask_model([{"role": "user", "content": "hi"}], [("p1", "m1"), ("p2", "m2")])
        self.assertIn("p1", str(ctx.exception))
        self.assertIn("p2", str(ctx.exception))


class TestClientPack(unittest.TestCase):
    def setUp(self):
        today = datetime.now(responder.KUWAIT).date()
        self.day1 = (today - timedelta(days=1)).isoformat()
        self.day10 = (today - timedelta(days=10)).isoformat()
        self.calls = []

    def rows(self, table):
        data = {
            "cockpit_campaigns": [
                {
                    "client_name": "Acme Tiles",
                    "meta_account_id": "act_111",
                    "verdict": "scale",
                    "reason": "Cheap leads",
                    "spend_7d": 100,
                    "spend_today": 10,
                    "leads_7d": 10,
                    "leads_today": 1,
                    "cpl": 10,
                    "frequency": 1.2,
                    "link_ctr": 1.5,
                    "synced_at": "2026-11-03T10:00:00Z",
                    "name": "Acme Leads",
                    "bookings": "3",
                    "cpb": "33.3",
                }
            ],
            "clients": [],
            "cockpit_media_daily_stats": [
                {"day": self.day1, "data": {"metaAdId": "a1", "adName": "Ad One", "campaignName": "Camp", "adSetName": "Set", "spend": 60, "leads": 5, "linkClicks": 10, "impressions": 1000}},
                {"day": self.day10, "data": {"metaAdId": "a1", "adName": "Ad One", "campaignName": "Camp", "adSetName": "Set", "spend": 40, "leads": 2, "linkClicks": 4, "impressions": 500}},
                {"day": self.day1, "data": {"metaAdId": "a2", "adName": "Ad Two", "campaignName": "Camp", "adSetName": "Set", "spend": 50, "leads": 0, "linkClicks": 5, "impressions": 900}},
                {"day": self.day10, "data": {"metaAdId": "a2", "adName": "Ad Two", "campaignName": "Camp", "adSetName": "Set", "spend": 20, "leads": 3, "linkClicks": 3, "impressions": 400}},
            ],
        }
        return data.get(table, [])

    def fake_get(self, rest, key, table, query):
        self.calls.append((table, query))
        return self.rows(table)

    @patch("responder.get")
    def test_campaign_and_ad_numbers_render(self, mock_get):
        mock_get.side_effect = self.fake_get
        text, sources = responder.client_pack("rest", "key", "Acme Tiles")
        self.assertIn("Acme Leads", text)
        self.assertIn("$100.00", text)
        self.assertIn("cost per lead $10.00", text)
        self.assertIn("no leads", text)
        self.assertIn("14d spend $100.00", text)
        self.assertIn("14d spend $70.00", text)
        self.assertIn("media buyer campaign board", sources)
        self.assertIn("Meta ad results by day (cockpit_media_daily_stats, USD)", sources)
        stats = [q for t, q in self.calls if t == "cockpit_media_daily_stats"]
        self.assertEqual(stats[0]["data->>accountId"], "in.(111)")

    @patch("responder.get")
    def test_unreadable_board_says_so(self, mock_get):
        def fake(rest, key, table, query):
            if table == "cockpit_campaigns":
                return None
            return [] if table in ("clients", "cockpit_media_daily_stats") else self.rows(table)

        mock_get.side_effect = fake
        text, _ = responder.client_pack("rest", "key", "Acme Tiles")
        self.assertIn("could not be read right now", text)

    @patch("responder.get")
    def test_no_tied_account_says_so(self, mock_get):
        mock_get.return_value = []
        text, _ = responder.client_pack("rest", "key", "Acme Tiles")
        self.assertIn("no Meta ad account is tied to this client", text)


class TestDrivePack(unittest.TestCase):
    def test_no_link_means_nothing(self):
        self.assertEqual(responder.drive_pack({}, ["no links here"]), ("", [], []))

    def test_missing_token_says_so(self):
        with patch("responder.drive_token", return_value=None):
            notes, images, sources = responder.drive_pack(
                {}, [f"https://drive.google.com/file/d/{DRIVE_ID}/view?usp=drive_link"]
            )
        self.assertIn("no Drive access", notes)
        self.assertEqual(images, [])
        self.assertEqual(sources, [])

    def test_link_forms_are_read(self):
        text = (
            f"https://drive.google.com/file/d/{DRIVE_ID}/view?usp=drive_link "
            f"https://drive.google.com/open?id={DRIVE_ID} "
            f"https://docs.google.com/document/d/{DRIVE_ID}/edit"
        )
        self.assertEqual(responder.DRIVE_ID.findall(text), [DRIVE_ID, DRIVE_ID, DRIVE_ID])

    def test_same_file_twice_is_read_once(self):
        text = (
            f"https://drive.google.com/file/d/{DRIVE_ID}/view "
            f"https://docs.google.com/document/d/{DRIVE_ID}/edit"
        )
        with patch("responder.drive_token", return_value="t"), patch("responder.fetch", return_value=None):
            notes, images, sources = responder.drive_pack({}, [text])
        self.assertEqual(notes.count("File 1"), 1)
        self.assertNotIn("File 2", notes)
        self.assertEqual(images, [])
        self.assertEqual(sources, ["Google Drive files"])


class TestVisibleClients(unittest.TestCase):
    """Access follows the database rule, so board clients without a profile row are never dropped."""

    def fake(self, member):
        def get(rest, key, table, query):
            if table == "cockpit_members":
                return member
            if table == "cockpit_campaigns":
                return [{"client_name": "Acme Tiles"}, {"client_name": "Cedar Homes"}, {"client_name": "acme tiles"}]
            return []
        return get

    def test_member_without_client_list_sees_every_board_client(self):
        with patch.object(responder, "get", self.fake([{"email": "buyer@tests.invalid", "roles": ["media_buyer"], "clients": []}])):
            names = responder.visible_clients("r", "k", "u1", ["Blue Marble Co"])
        self.assertEqual(sorted(names), ["Acme Tiles", "Blue Marble Co", "Cedar Homes"])

    def test_restricted_member_sees_only_own_clients(self):
        with patch.object(responder, "get", self.fake([{"email": "buyer@tests.invalid", "roles": ["media_buyer"], "clients": ["Cedar Homes"]}])):
            names = responder.visible_clients("r", "k", "u1", ["Cedar Homes"])
        self.assertEqual(names, ["Cedar Homes"])

    def test_admin_sees_every_board_client(self):
        with patch.object(responder, "get", self.fake([{"email": "boss@tests.invalid", "roles": ["admin"], "clients": ["Cedar Homes"]}])):
            names = responder.visible_clients("r", "k", "u1", [])
        self.assertEqual(sorted(names), ["Acme Tiles", "Cedar Homes"])

    def test_unreadable_member_falls_back_to_scoped_profiles(self):
        with patch.object(responder, "get", self.fake(None)):
            self.assertEqual(responder.visible_clients("r", "k", "u1", ["Cedar Homes"]), ["Cedar Homes"])
        self.assertEqual(responder.visible_clients("r", "k", None, ["Cedar Homes"]), ["Cedar Homes"])


if __name__ == "__main__":
    unittest.main()
