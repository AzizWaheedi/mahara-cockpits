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
  - live_guide: a fresh GitHub read is cached and reported as github, a young cache
    skips the network, an expired cache is returned as stale cache when GitHub fails,
    an unknown app and a failed first read use the built-in guides, and a missing
    GITHUB_TOKEN means no request is opened
  - recent_changes: merge commits and two-parent commits are skipped, a trailing PR
    number is stripped, and the list is capped
  - build_messages: a supplied guide and changes reach the system message, and an
    empty changes value says None read.
  - build_messages: the sales cockpit speaks as Ace and the editor cockpit as Frame
  - sales_lead: a /lead/<id> page answers without a read, 8+ digits read phone8 with
    the last 8 digits, one model match returns its id, several matches give a note
    listing them, and no match says so
  - get_url: the or= filter keeps its commas and stars and escapes Arabic names
  - lead_pack: messages print oldest first, automated ones are marked, and a failed
    read says could not be read
  - sales_day: a rep's reads carry their person filters and a manager's carry none
  - sales_numbers: only non-voided deals naming the rep count, cash is summed, a
    setter counts setter deals, and dials use the one-minute conversation rule
  - prepare: the sales path skips clients and Drive and returns client None
  - editor_pack: a non-manager filters by their email, managers do not, and
    cancelled and live jobs are dropped
  - guides: both new cockpits are in GUIDE_DIRS and COCKPIT_GUIDE

No network calls: get, ask_model, drive_token, fetch, github_get and urlopen are patched.
All data is fictional.
"""
import io
import json
import os
import sys
import tempfile
import time
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

    def test_each_cockpit_speaks_as_its_own_assistant(self):
        for app, name in (("media-buyer", "Signal"), ("client-success", "Anchor"), ("creative", "Lens")):
            job = {**self.job(), "app": app}
            system = responder.build_messages(job, "data", [], None)[0]["content"]
            self.assertTrue(system.startswith(f"You are {name}"), app)
            others = {"Signal", "Anchor", "Lens"} - {name}
            self.assertTrue(all(o in system for o in others), f"{app} names who covers the rest")
            self.assertNotIn("You are Hermes", system)
            self.assertNotIn("—", system)

    def test_unknown_cockpit_gets_a_neutral_assistant(self):
        system = responder.build_messages({**self.job(), "app": "webinar"}, "data", [], None)[0]["content"]
        self.assertTrue(system.startswith("You are the cockpit assistant."))

    def test_sales_and_editor_speak_as_ace_and_frame(self):
        for app, name in (("sales", "Ace"), ("editor", "Frame")):
            job = {**self.job(), "app": app}
            system = responder.build_messages(job, "data", [], None)[0]["content"]
            self.assertTrue(system.startswith(f"You are {name}"), app)
            self.assertNotIn("You are Hermes", system)
            self.assertNotIn("—", system)


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

    def chain(self, chat_model=None):
        with patch.object(responder, "HERMES_HOME", self.home), patch.object(responder, "CHAT_MODEL", chat_model), redirect_stdout(io.StringIO()), warnings.catch_warnings():
            warnings.simplefilter("ignore", ResourceWarning)
            return responder.model_chain()

    def test_chat_model_leads_and_is_not_repeated(self):
        self.write("cron/jobs.json", json.dumps({"jobs": [{"name": responder.ASK_AI_CRON_NAME, "provider": "p1", "model": "m1"}]}))
        self.write("config.yaml", "fallback_providers:\n  - provider: c0\n    model: chat\n  - provider: p2\n    model: m2\n")
        self.assertEqual(self.chain(("c0", "chat")), [("c0", "chat"), ("p1", "m1"), ("p2", "m2")])

    def test_shipped_chat_model_is_gpt_6_sol(self):
        self.assertEqual(responder.CHAT_MODEL, ("openai-codex", "gpt-6-sol"))

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


class TestLiveGuide(unittest.TestCase):
    """The guide comes from GitHub main, with a saved copy for a bad minute."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = patch.object(responder, "STATE_DIR", self.tmp.name)
        patcher.start()
        self.addCleanup(patcher.stop)

    def commit(self, subject, date="2026-11-01T10:00:00Z", parents=1):
        return {"commit": {"message": subject, "committer": {"date": date}}, "parents": [{}] * parents}

    def fake_github(self, guide, commits):
        def get(e, url, raw=False):
            return guide if raw else commits

        return get

    def cache_path(self, app):
        return os.path.join(self.tmp.name, "guides", f"{app}.json")

    def test_fresh_fetch_reports_github_and_writes_the_cache(self):
        commits = [self.commit("Add ads filter (#167)", "2026-11-02T09:00:00Z")]
        with patch.object(responder, "github_get", self.fake_github("GUIDE TEXT", commits)):
            guide, changes, source = responder.live_guide({"GITHUB_TOKEN": "t"}, "media-buyer")
        self.assertEqual((guide, source), ("GUIDE TEXT", "github"))
        self.assertEqual(changes, "- 2026-11-02: Add ads filter")
        with open(self.cache_path("media-buyer"), encoding="utf-8") as f:
            saved = json.load(f)
        self.assertEqual((saved["guide"], saved["changes"]), ("GUIDE TEXT", changes))

    def test_young_cache_makes_no_github_call(self):
        with patch.object(responder, "github_get", side_effect=self.fake_github("GUIDE TEXT", [])) as first:
            responder.live_guide({"GITHUB_TOKEN": "t"}, "media-buyer")
        self.assertTrue(first.called)
        with patch.object(responder, "github_get") as second:
            guide, _, source = responder.live_guide({"GITHUB_TOKEN": "t"}, "media-buyer")
        self.assertFalse(second.called)
        self.assertEqual((guide, source), ("GUIDE TEXT", "cache"))

    def test_expired_cache_is_returned_when_github_fails(self):
        os.makedirs(os.path.dirname(self.cache_path("creative")))
        with open(self.cache_path("creative"), "w", encoding="utf-8") as f:
            json.dump({"fetched_at": time.time() - responder.GUIDE_TTL_SECONDS - 60, "guide": "OLD GUIDE", "changes": "- 2026-10-01: Old"}, f)
        with patch.object(responder, "github_get", return_value=None), redirect_stdout(io.StringIO()):
            guide, changes, source = responder.live_guide({"GITHUB_TOKEN": "t"}, "creative")
        self.assertEqual((guide, changes, source), ("OLD GUIDE", "- 2026-10-01: Old", "stale cache"))

    def test_failed_first_read_uses_the_built_in_guide(self):
        with patch.object(responder, "github_get", return_value=None), redirect_stdout(io.StringIO()):
            guide, changes, source = responder.live_guide({"GITHUB_TOKEN": "t"}, "creative")
        self.assertEqual((guide, changes, source), (responder.COCKPIT_GUIDE["creative"], "", "built-in"))

    def test_unknown_app_uses_the_shared_guide_without_github(self):
        with patch.object(responder, "github_get") as mock_get:
            guide, changes, source = responder.live_guide({"GITHUB_TOKEN": "t"}, "webinar")
        self.assertEqual((guide, changes, source), (responder.SHARED_GUIDE, "", "built-in"))
        self.assertFalse(mock_get.called)

    def test_no_token_opens_no_request(self):
        with patch.object(responder.urllib.request, "urlopen") as urlopen:
            self.assertIsNone(responder.github_get({}, "https://api.github.com/x"))
            self.assertIsNone(responder.github_get({"GITHUB_TOKEN": "   "}, "https://api.github.com/x"))
        self.assertFalse(urlopen.called)

    def test_recent_changes_skips_merges_strips_pr_and_caps(self):
        commits = [
            self.commit("Fix ads grid (#167)", "2026-11-03T10:00:00Z"),
            self.commit("Merge branch main", "2026-11-02T10:00:00Z"),
            self.commit("Two parent commit", "2026-11-02T09:00:00Z", parents=2),
        ] + [self.commit(f"Change {n}", "2026-11-01T10:00:00Z") for n in range(70)]
        lines = responder.recent_changes(commits).splitlines()
        self.assertEqual(len(lines), responder.CHANGES_MAX)
        self.assertEqual(lines[0], "- 2026-11-03: Fix ads grid")
        self.assertFalse(any("Merge" in line for line in lines))
        self.assertFalse(any("Two parent" in line for line in lines))
        self.assertFalse(any("(#" in line for line in lines))

    def test_build_messages_uses_the_supplied_guide_and_changes(self):
        job = {"prompt": "where is the ads page", "app": "media-buyer", "role": "buyer"}
        system = responder.build_messages(job, "data", [], None, guide="GUIDE-X", changes="- 2026-11-01: Y")[0]["content"]
        self.assertIn("GUIDE-X", system)
        self.assertIn("- 2026-11-01: Y", system)
        self.assertNotIn("None read.", system)
        plain = responder.build_messages(job, "data", [], None, guide="GUIDE-X")[0]["content"]
        self.assertIn("None read.", plain)


class TestPlainNumbers(unittest.TestCase):
    """The data block already says verdicts in plain words and gives today's own cost per lead."""

    def test_verdicts_are_plain_words(self):
        self.assertEqual([responder.plain_verdict(v) for v in ("scale", "HOLD", "kill", None, "pending")], ["doing well", "watch", "should stop", "no verdict", "pending"])

    def test_today_cost_per_lead_uses_today_only(self):
        self.assertEqual(responder.today_cpl({"spend_today": 34.15, "leads_today": 2}), responder.money(17.075))
        self.assertEqual(responder.today_cpl({"spend_today": 9.62, "leads_today": 0}), "n/a (no leads today)")

    def test_overview_has_no_raw_verdicts(self):
        rows = [{"client_name": "Cedar Homes", "name": "Leads_1", "verdict": "kill", "spend_today": 10, "leads_today": 2, "spend_7d": 70, "leads_7d": 5, "cpl": 14, "synced_at": "2026-11-03T14:51:00Z"}]
        with patch.object(responder, "get", lambda *a, **k: rows):
            text, _ = responder.overview_pack("r", "k", ["Cedar Homes"])
        self.assertIn("should stop", text)
        self.assertIn("cost per lead " + responder.money(5), text)
        self.assertNotIn("kill", text)
        self.assertNotIn("scale", text)

    def test_overview_groups_campaigns_by_verdict(self):
        rows = [
            {"client_name": "Acme Tiles", "name": "A", "verdict": "kill", "spend_today": 1, "leads_today": 0},
            {"client_name": "Blue Marble Co", "name": "B", "verdict": "hold", "spend_today": 1, "leads_today": 0},
            {"client_name": "Cedar Homes", "name": "C", "verdict": "scale", "spend_today": 1, "leads_today": 0},
        ]
        with patch.object(responder, "get", lambda *a, **k: rows):
            text, _ = responder.overview_pack("r", "k", ["Acme Tiles", "Blue Marble Co", "Cedar Homes"])
        order = [text.index(s) for s in ("Verdict doing well (1", "Cedar Homes", "Verdict watch (1", "Blue Marble Co", "Verdict should stop (1", "Acme Tiles")]
        self.assertEqual(order, sorted(order))


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


class TestSalesLead(unittest.TestCase):
    """The lead comes from the page, the phone number, or the fastest model."""

    CHAIN = [("p", "sonnet-x"), ("p", "haiku-y")]

    @patch("responder.ask_model")
    @patch("responder.get")
    def test_lead_page_id_answers_without_a_read(self, mock_get, mock_ask):
        mock_get.side_effect = AssertionError("no read expected")
        found = responder.sales_lead("r", "k", {"prompt": "this lead?"}, "/lead/abc123", self.CHAIN)
        self.assertEqual(found, ("abc123", ""))
        self.assertFalse(mock_ask.called)

    @patch("responder.ask_model")
    @patch("responder.get")
    def test_eight_digits_read_phone8_with_the_last_eight(self, mock_get, mock_ask):
        calls = []

        def fake(rest, key, table, query):
            calls.append((table, query))
            return [{"contact_id": "c9", "name": "Phone Lead", "company": ""}]

        mock_get.side_effect = fake
        found = responder.sales_lead("r", "k", {"prompt": "please call 991234567 now"}, "/calendar", self.CHAIN)
        self.assertEqual(found, ("c9", ""))
        self.assertEqual(calls[0][0], "cockpit_sales_leads")
        self.assertEqual(calls[0][1]["phone8"], "eq.91234567")
        self.assertFalse(mock_ask.called)

    @patch("responder.ask_model")
    @patch("responder.get")
    def test_one_model_match_returns_its_id_and_filters_by_name(self, mock_get, mock_ask):
        mock_ask.return_value = ("Gulf Builders", "p/haiku-y")
        calls = []
        mock_get.side_effect = lambda rest, key, table, query: calls.append((table, query)) or [
            {"contact_id": "c1", "name": "Gulf Builders", "company": "Gulf"}
        ]
        found = responder.sales_lead("r", "k", {"prompt": "what about gulf builders"}, "/calendar", self.CHAIN)
        self.assertEqual(found, ("c1", ""))
        self.assertEqual(calls[0][0], "cockpit_sales_leads")
        self.assertIn("name.ilike.*Gulf Builders*", calls[0][1]["or"])
        self.assertIn("company.ilike.*Gulf Builders*", calls[0][1]["or"])
        self.assertEqual(mock_ask.call_args[0][1][0], ("p", "haiku-y"))

    @patch("responder.ask_model")
    @patch("responder.get")
    def test_several_matches_return_a_note_listing_them(self, mock_get, mock_ask):
        mock_ask.return_value = ("Gulf", "p/haiku-y")
        mock_get.return_value = [
            {"contact_id": "c1", "name": "Gulf Builders", "company": "Gulf"},
            {"contact_id": "c2", "name": "Gulf Interiors", "company": "Gulf"},
            {"contact_id": "c3", "name": "Gulf Homes", "company": ""},
        ]
        found, note = responder.sales_lead("r", "k", {"prompt": "gulf?"}, "/calendar", self.CHAIN)
        self.assertIsNone(found)
        self.assertTrue(note.startswith('Several leads match "Gulf":'))
        self.assertIn("Gulf Builders (Gulf)", note)
        self.assertIn("Gulf Homes", note)

    @patch("responder.ask_model")
    @patch("responder.get")
    def test_no_match_says_so(self, mock_get, mock_ask):
        mock_ask.return_value = ("Gulf", "p/haiku-y")
        mock_get.return_value = []
        found, note = responder.sales_lead("r", "k", {"prompt": "gulf?"}, "/calendar", self.CHAIN)
        self.assertIsNone(found)
        self.assertEqual(note, 'No lead matches "Gulf".')

    @patch("responder.ask_model")
    @patch("responder.get")
    def test_model_none_or_error_names_no_lead(self, mock_get, mock_ask):
        mock_ask.return_value = ("NONE", "p/haiku-y")
        self.assertEqual(responder.sales_lead("r", "k", {"prompt": "who?"}, "/calendar", self.CHAIN), (None, ""))
        mock_ask.side_effect = RuntimeError("down")
        self.assertEqual(responder.sales_lead("r", "k", {"prompt": "who?"}, "/calendar", self.CHAIN), (None, ""))
        self.assertFalse(mock_get.called)

    def test_or_filter_url_keeps_syntax_and_escapes_arabic(self):
        url = responder.get_url("https://r/rest/v1", "cockpit_sales_leads", {
            "or": "(name.ilike.*مؤسسة البناء*,company.ilike.*مؤسسة البناء*)",
        })
        self.assertIn("or=(name.ilike.*", url)
        self.assertIn(",company.ilike.*", url)
        self.assertIn("*", url)
        self.assertNotIn("%2A", url)
        self.assertIn("%D9%85", url)


class TestLeadPack(unittest.TestCase):
    """Messages read oldest first, and a failed read is never zero."""

    @patch("responder.get")
    def test_messages_oldest_first_automated_marked_and_none_says_so(self, mock_get):
        now = datetime.now(responder.KUWAIT).isoformat()

        def fake(rest, key, table, query):
            if table == "cockpit_sales_conversation_messages":
                return [
                    {"at": now, "direction": "inbound", "channel": "whatsapp", "body": "newest words", "automated": False},
                    {"at": now, "direction": "outbound", "channel": "whatsapp", "body": "oldest words", "automated": True},
                ]
            if table == "cockpit_sales_call_notes":
                return None
            return []

        mock_get.side_effect = fake
        text, sources = responder.lead_pack("r", "k", "c1")
        self.assertLess(text.index("oldest words"), text.index("newest words"))
        self.assertIn("(automated)", text)
        self.assertIn("Call notes: could not be read.", text)
        self.assertIn("messages", sources)
        self.assertNotIn("call notes", sources)


class TestSalesDay(unittest.TestCase):
    """A rep sees their own day; a manager sees the team's."""

    def rows(self, table):
        if table == "cockpit_sales_calendar":
            return [{"start_at": "2026-11-04T07:00:00Z", "call_type": "intro", "contact_name": "Lead One", "status": "confirmed", "assigned_user_name": "Rep One"}]
        return []

    def rep(self):
        return {"email": "rep@tests.invalid", "roles": ["sales"], "name": "Rep One", "role": "closer", "ghl": "g1", "b2b": "b1", "maqsam": "", "manager": False}

    def manager(self):
        return {**self.rep(), "roles": ["admin"], "role": "manager", "manager": True}

    @patch("responder.get")
    def test_rep_reads_carry_their_person_filter(self, mock_get):
        calls = []
        mock_get.side_effect = lambda rest, key, table, query: calls.append((table, query)) or self.rows(table)
        text, _ = responder.sales_day("r", "k", self.rep())
        query = next(q for t, q in calls if t == "cockpit_sales_calendar")
        self.assertEqual(query["assigned_user_id"], "eq.g1")
        self.assertEqual(next(q for t, q in calls if t == "cockpit_sales_followups")["owner_email"], "eq.rep@tests.invalid")
        self.assertEqual(next(q for t, q in calls if t == "cockpit_sales_hot")["owner_email"], "eq.rep@tests.invalid")
        self.assertEqual(next(q for t, q in calls if t == "cockpit_sales_conversations")["assigned_to"], "eq.g1")
        leads = [q for t, q in calls if t == "cockpit_sales_leads"]
        self.assertTrue(leads and all(q.get("assigned_to") == "eq.g1" for q in leads))
        self.assertIn("10:00", text)

    @patch("responder.get")
    def test_manager_reads_have_no_person_filter(self, mock_get):
        calls = []
        mock_get.side_effect = lambda rest, key, table, query: calls.append((table, query)) or self.rows(table)
        responder.sales_day("r", "k", self.manager())
        for table, query in calls:
            self.assertNotIn("assigned_user_id", query, table)
            self.assertNotIn("owner_email", query, table)
            self.assertNotIn("assigned_to", query, table)

    @patch("responder.get")
    def test_rep_without_a_highlevel_user_says_so(self, mock_get):
        who = {**self.rep(), "ghl": ""}
        text, _ = responder.sales_day("r", "k", who)
        self.assertIn("Your seat has no HighLevel user", text)


class TestSalesNumbers(unittest.TestCase):
    """The month-to-date count follows the sales cockpit's end of day rule."""

    def fake(self, deals, reps, dials=None):
        def get(rest, key, table, query):
            if table == "cockpit_sales_reps":
                return reps
            if table == "cockpit_sales_deals":
                return deals
            if table == "cockpit_sales_dials":
                return dials or []
            return []
        return get

    @patch("responder.get")
    def test_closer_counts_non_voided_deals_and_sums_cash(self, mock_get):
        mock_get.side_effect = self.fake(
            [
                {"closer": "Rep One", "setter": "Setter X", "cash_collected": 100, "contracted_revenue": 1000, "voided": False},
                {"closer": " rep one ", "setter": "", "cash_collected": 200, "contracted_revenue": 2000, "voided": False},
                {"closer": "Other Person", "setter": "Rep One", "cash_collected": 999, "contracted_revenue": 9999, "voided": False},
                {"closer": "Rep One", "setter": "", "cash_collected": 500, "contracted_revenue": 5000, "voided": True},
            ],
            [{"display_name": "Rep One", "closer_aliases": ["R1"]}],
        )
        who = {"email": "rep@tests.invalid", "name": "Rep One", "role": "closer", "b2b": "b1", "maqsam": "", "manager": False}
        text, _ = responder.sales_numbers("r", "k", who)
        self.assertIn("Deals: 2", text)
        self.assertIn(responder.money(300), text)
        self.assertIn(responder.money(3000), text)
        self.assertNotIn("999", text)

    @patch("responder.get")
    def test_setter_counts_setter_deals_and_dials(self, mock_get):
        mock_get.side_effect = self.fake(
            [
                {"closer": "Closer X", "setter": "Setter One", "cash_collected": 50, "contracted_revenue": 500, "voided": False},
                {"closer": "Setter One", "setter": "Closer X", "cash_collected": 70, "contracted_revenue": 700, "voided": False},
            ],
            [{"display_name": "Setter One", "closer_aliases": []}],
            [
                {"state": "completed", "duration_s": 90},
                {"state": "completed", "duration_s": 10},
                {"state": "no_answer", "duration_s": 0},
            ],
        )
        who = {"email": "setter@tests.invalid", "name": "Setter One", "role": "setter", "b2b": "b2", "maqsam": "line@tests.invalid", "manager": False}
        text, _ = responder.sales_numbers("r", "k", who)
        self.assertIn("Deals: 1", text)
        self.assertIn(responder.money(50), text)
        self.assertIn("Dials: 3", text)
        self.assertIn("Answered: 2", text)
        self.assertIn("Conversations: 1", text)

    @patch("responder.get")
    def test_a_seat_without_a_rep_id_says_it_cannot_count(self, mock_get):
        who = {"email": "rep@tests.invalid", "name": "Rep One", "role": "closer", "b2b": "", "maqsam": "", "manager": False}
        text, _ = responder.sales_numbers("r", "k", who)
        self.assertIn("not linked to a sales rep", text)
        self.assertFalse(mock_get.called)


class TestPrepareSales(unittest.TestCase):
    """The sales path never touches client visibility or Drive."""

    @patch("responder.live_guide", return_value=("GUIDE", "", "built-in"))
    @patch("responder.drive_pack")
    @patch("responder.visible_clients")
    @patch("responder.get")
    def test_sales_prepare_skips_clients_and_drive(self, mock_get, mock_visible, mock_drive, mock_guide):
        def fake(rest, key, table, query):
            if table == "cockpit_ask_ai_jobs":
                return [{"auth_user_id": "u1", "page": "/lead/c1"}]
            if table == "cockpit_members":
                return [{"email": "rep@tests.invalid", "roles": ["sales"]}]
            if table == "cockpit_sales_people":
                return [{"name": "Rep One", "role": "closer", "ghl_user_id": "g1", "b2b_rep_id": "b1", "maqsam_email": "", "active": True}]
            return []

        mock_get.side_effect = fake
        job = {"id": "j1", "app": "sales", "prompt": "prep this lead", "context": {}}
        messages, sources, client = responder.prepare(job, {}, "r", "k", [("p", "haiku-y")])
        self.assertIsNone(client)
        mock_visible.assert_not_called()
        mock_drive.assert_not_called()
        self.assertTrue(any(s.startswith("cockpit guide (") for s in sources))
        self.assertIn("You are Ace", messages[0]["content"])
        self.assertIn("Person: Rep One (closer), manager: no.", messages[0]["content"])


class TestEditorPack(unittest.TestCase):
    """The editor's own jobs, without cancelled or live work."""

    def jobs(self):
        return [
            {"task_id": "t1", "name": "Keep me", "client": "Acme", "status": "In progress", "due_at": "2026-11-05T09:00:00Z", "state": "ready", "missing": [], "url": "https://x"},
            {"task_id": "t2", "name": "Cancelled job", "client": "Acme", "status": "cancelled", "due_at": None, "state": "ready", "missing": [], "url": ""},
            {"task_id": "t3", "name": "Live job", "client": "Acme", "status": "live 3 days", "due_at": None, "state": "ready", "missing": [], "url": ""},
        ]

    @patch("responder.get")
    def test_non_manager_filters_by_email_and_drops_finished_jobs(self, mock_get):
        calls = []

        def fake(rest, key, table, query):
            calls.append((table, query))
            return self.jobs() if table == "editor_jobs" else []

        mock_get.side_effect = fake
        who = {"email": "editor@tests.invalid", "name": "Editor One", "role": "editor", "manager": False}
        text, _ = responder.editor_pack("r", "k", who, None)
        query = next(q for t, q in calls if t == "editor_jobs")
        self.assertEqual(query["editors"], 'cs.[{"email":"editor@tests.invalid"}]')
        self.assertIn("Keep me", text)
        self.assertNotIn("Cancelled job", text)
        self.assertNotIn("Live job", text)

    @patch("responder.get")
    def test_manager_has_no_email_filter_and_sees_every_job(self, mock_get):
        calls = []

        def fake(rest, key, table, query):
            calls.append((table, query))
            return self.jobs() if table == "editor_jobs" else []

        mock_get.side_effect = fake
        who = {"email": "boss@tests.invalid", "name": "Boss", "role": "admin", "manager": True}
        text, _ = responder.editor_pack("r", "k", who, None)
        query = next(q for t, q in calls if t == "editor_jobs")
        self.assertNotIn("editors", query)
        self.assertIn("Keep me", text)
        self.assertNotIn("Cancelled job", text)
        self.assertNotIn("Live job", text)


class TestGuideCoverage(unittest.TestCase):
    def test_both_new_cockpits_have_a_directory_and_a_fallback_guide(self):
        self.assertEqual(responder.GUIDE_DIRS["sales"], "apps/sales-cockpit")
        self.assertEqual(responder.GUIDE_DIRS["editor"], "apps/video-editor-cockpit")
        sales = responder.COCKPIT_GUIDE["sales"]
        editor = responder.COCKPIT_GUIDE["editor"]
        self.assertTrue(sales.startswith("Sales cockpit menu:"))
        self.assertTrue(editor.startswith("Video editor cockpit menu:"))
        for label in ("Today", "Calendar", "Leads", "Dialer", "Pipeline", "Intelligence", "Proposals", "Contracts", "Invoices", "Numbers", "Goals", "End of day", "Follow-ups", "Recordings", "Links", "Pitch deck"):
            self.assertIn(f"- {label}", sales)
        for label in ("Jobs", "Footage", "Send for review", "Library", "Meetings", "End of day", "How to use this desk"):
            self.assertIn(f"- {label}", editor)
        self.assertIn(responder.SHARED_GUIDE, sales)
        self.assertIn(responder.SHARED_GUIDE, editor)


if __name__ == "__main__":
    unittest.main()
