#!/usr/bin/env python3
"""scripts/dev/make_parity.py offline (docs/forms/WAVE56-CONTRACT.md 4.15.1): urllib is mocked, so no request leaves
this machine; every key, client, phone and answer is invented. Python 3.9, as on this Mac."""
from __future__ import annotations

import io
import json
import shutil
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_parity as mp  # noqa: E402

SERVICE_KEY = "eyJ" + "hbGciOiJIUzI1NiJ9." + "eyJyb2xlIjoic2VydmljZSJ9." + "invented_signature_part"
MAKE_KEY = "make-" + "invented-0000-key"
DB = "https://db.test"
CARD = "86exc1tyw"
PHONE = "+965 1234 5678"
EMAIL = "owner@cedar.example"
ANSWER = "Invented handoff detail nobody should see"
SECRETS = (SERVICE_KEY, MAKE_KEY, PHONE, EMAIL, ANSWER, CARD, "Cedar Homes")
STATUS = "9368ca9e-3549-4320-84ff-9abd0a2901cb"
CONTRACT = "ac976d4a-409b-441c-8c13-4b0e73a0c12f"
SERVICE = "bab9a58b-15af-4b0d-8e20-b8e5a4bee2cc"
BLUEPRINT = "1b7a4a74-d0e7-4a7f-9218-59c80a738186"
MAP = "51f49cb1-9f76-48be-b639-c42ca552d20a"
HANDOFF = f"KICKOFF HANDOFF for Cedar Homes\n\nKICKOFF ANSWERS\nContract status: Signed\nNotes: {ANSWER}"
MAP4 = f"https://mahara-onboarding-map.vercel.app/?phase=4&cid={CARD}"
PHASE4 = "هلا فريق Cedar Homes، المرحلة الرابعة: " + MAP4


class Answer:
    def __init__(self, status: int, text: str):
        self.status = status
        self._text = text.encode()

    def read(self):
        return self._text

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def trigger():
    return {"form_response": {
        "token": "tokKick00001", "submitted_at": "2026-10-20T11:55:11Z",
        "hidden": {"onboarding_client_id": CARD, "legal_name": "Cedar Homes", "phone": PHONE, "email": EMAIL},
        "definition": {"fields": [{"ref": "c0000001-0000-4000-8000-00000000000a", "title": "Contract status"}]},
        "answers": [{"type": "choice", "choice": {"label": "Signed"}, "field": {"ref": "c0000001-0000-4000-8000-00000000000a", "type": "dropdown"}},
                    {"type": "choices", "choices": {"labels": ["Fit out and renovation", "Design and build"]},
                     "field": {"ref": "c0000001-0000-4000-8000-000000000007", "type": "multiple_choice"}},
                    {"type": "text", "text": ANSWER, "field": {"ref": "notes-ref", "type": "long_text"}}]}}


def kickoff_detail(handoff=HANDOFF, contract="ac8a68fa-ba2e-41da-9fcc-2e9b7d03d2e2"):
    return {"modules": [
        {"id": 1, "module": "typeform:WatchEventsWithResponses", "output": [trigger()]},
        {"id": 11, "module": "clickup:postATaskComment", "input": [{"comment_text": handoff + "  "}]},
        {"id": 20, "module": "clickup:editATaskAdvanced", "input": [{"status": "IN PROGRESS"}]},
        {"id": 21, "module": "clickup:editATask", "input": [{"customFields": [
            {"id": STATUS, "value": "dbd21650-59ce-429c-882d-5afd7d8aaa8a"}, {"id": CONTRACT, "value": contract},
            {"id": SERVICE, "value": None}, {"id": BLUEPRINT, "value": "https://maharamedia.typeform.com/to/oYZKtogO#x=1"}]}]},
        {"id": 17, "module": "clickup:createATaskFromATemplate", "input": [{"list_id": "901816723190", "template_id": "t-86ex8x9xw"}]},
        {"id": 22, "module": "clickup:createATaskFromATemplate", "input": [{"list_id": "901818016338", "template_id": "t-86eyu1w3d"}]},
        {"id": 27, "module": "clickup:editATask", "input": [{"customFields": [{"id": MAP, "value": MAP4}]}]},
        {"id": 25, "module": "whapi-cloud:sendText", "input": [{"body": PHASE4}]},
    ]}


def kickoff_plan():
    return {"formKey": "kickoff", "effects": [
        {"key": "handoff_comment", "plan": {"comment_text": HANDOFF}},
        {"key": "native_status", "plan": {"status": "IN PROGRESS"}},
        {"key": "card_fields", "plan": {"fields": [
            {"fieldId": STATUS, "kind": "drop_down", "optionName": "Brand Blueprint Booked♠️"},
            {"fieldId": CONTRACT, "kind": "drop_down", "optionName": "Signed"},
            {"fieldId": SERVICE, "kind": "drop_down", "optionName": "Fit out and renovation"},
            {"fieldId": BLUEPRINT, "kind": "url", "value": "https://cockpit.maharamedia.com/x"}]}},
        {"key": "onboarding_tasks", "plan": {"typeKey": "client_onboarding"}},
        {"key": "map_phase4", "plan": {"value": MAP4}},
        {"key": "phase4_whatsapp", "plan": {"body": PHASE4}},
        {"key": "kickoff_notice", "plan": {}}, {"key": "new_mrr", "plan": {}}, {"key": "recap", "plan": {}}]}


BLUEPRINT_SEARCH = {"response": {"blueprint": {"flow": [
    {"id": 1, "module": "typeform:WatchEventsWithResponses"},
    {"id": 14, "module": "builtin:BasicRouter", "routes": [{"flow": [{"id": 24, "module": "google-sheets:filterRows", "mapper": {"filter": []}}]}]}]}}}
BLUEPRINT_WRITE = {"response": {"blueprint": {"flow": [
    {"id": 14, "module": "builtin:BasicRouter", "routes": [{"flow": [{"id": 24, "module": "google-sheets:updateRow", "mapper": {"values": {"5": "x", "2": "y"}}}]}]}]}}}


class Net:
    def __init__(self):
        self.requests = []
        self.detail = kickoff_detail()
        self.blueprint = BLUEPRINT_SEARCH
        self.plan = kickoff_plan()
        self.logs = {"scenarioLogs": [{"imtId": "exec-1", "status": 1}, {"imtId": "exec-x", "status": 3}]}
        self.receipt_fails = set()

    def __call__(self, req, timeout=None):
        url = req.full_url
        method = req.get_method()
        headers = {k.lower(): v for k, v in req.header_items()}
        body = json.loads(req.data) if req.data else None
        self.requests.append({"method": method, "url": url, "headers": headers, "json": body})
        status, out = self.route(method, url, headers, body)
        text = out if isinstance(out, str) else json.dumps(out)
        if status >= 400:
            raise urllib.error.HTTPError(url, status, "refused", None, io.BytesIO(text.encode()))
        return Answer(status, text)

    def route(self, method, url, headers, body):
        if url.startswith(DB):
            assert headers["apikey"] == SERVICE_KEY
        if url == f"{DB}/rest/v1/cockpit_csm_provider_health":
            return (400, "{}") if body["phase"] in self.receipt_fails else (201, "")
        if url.startswith(f"{DB}/rest/v1/cockpit_clickup_fields?"):
            return 200, [{"field_id": CONTRACT, "options": [{"id": "ac8a68fa-ba2e-41da-9fcc-2e9b7d03d2e2", "name": "Signed", "orderindex": 0},
                                                             {"id": "0667c501-3955-4443-829a-a4eb9a1d7176", "name": "Not sent yet", "orderindex": 3}]},
                         {"field_id": STATUS, "options": [{"id": "dbd21650-59ce-429c-882d-5afd7d8aaa8a", "name": "Brand Blueprint Booked♠️", "orderindex": 4}]}]
        if url.startswith(f"{DB}/rest/v1/cockpit_request_types?"):
            return 200, [{"key": "client_onboarding", "targets": [{"list_id": "901816723190", "template_id": "t-86ex8x9xw"},
                                                                  {"list_id": "901818016338", "template_id": "t-86eyu1w3d"}]}]
        if url == f"{DB}/rest/v1/rpc/cockpit_form_parity_plan":
            assert body["p_form_key"] == "kickoff"
            assert body["p_input"]["taskId"] == CARD
            return 200, self.plan
        if url.startswith("https://eu2.make.com/api/v2/"):
            assert headers["authorization"] == "Token " + MAKE_KEY and "Mozilla" in headers["user-agent"]
            path = urllib.parse.urlsplit(url).path
            if path == "/api/v2/scenarios/8925654/logs":
                return 200, self.logs
            if path == "/api/v2/scenarios/8925654/blueprint":
                return 200, self.blueprint
            if path == "/api/v2/scenarios/8925654/logs/exec-1":
                return 200, self.detail
        raise AssertionError(f"no fake for {method} {url}")


class Parity(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        release = self.tmp / "releases" / "86eebpf1"
        release.mkdir(parents=True)
        (self.tmp / "current").symlink_to(release)
        state = self.tmp / "state"
        state.mkdir()
        (state / "runtime-86eebpf1.json").write_text(json.dumps({"SUPABASE_URL": DB, "SUPABASE_SERVICE_ROLE_KEY": SERVICE_KEY,
                                                               "MAKE_API_KEY": MAKE_KEY, "MAKE_ZONE": "eu2.make.com"}))
        self.net = Net()
        for patch in (mock.patch.object(mp, "NATIVE_CURRENT", str(self.tmp / "current")),
                      mock.patch.object(mp, "NATIVE_STATE", str(state)),
                      mock.patch.object(mp, "RELAY_CONFIG", str(self.tmp / "relay.env")),
                      mock.patch.object(mp.urllib.request, "urlopen", lambda req, timeout=None: self.net(req, timeout))):
            patch.start()
            self.addCleanup(patch.stop)

    def run_cmd(self, *args):
        out = io.StringIO()
        with redirect_stdout(out):
            code = mp.main(list(args))
        text = out.getvalue()
        for secret in SECRETS:
            self.assertNotIn(secret, text)
        return code, text

    def test_equal_runs_pass_with_the_24_line_and_every_effect_named(self):
        code, out = self.run_cmd("kickoff", "--last", "1")
        self.assertEqual(code, 0, out)
        lines = out.strip().splitlines()
        self.assertEqual(lines[0], "kickoff [24] search")
        self.assertIn("kickoff run 1: handoff_comment equal", lines)
        self.assertIn("kickoff run 1: native_status equal", lines)
        self.assertIn("kickoff run 1: card_fields equal", lines)
        self.assertIn("kickoff run 1: card_fields intended: the Blueprint link points at the cockpit Blueprint", lines)
        self.assertIn(f"kickoff run 1: card_fields intended: {mp.INTENDED['service']}", lines)
        self.assertIn("kickoff run 1: onboarding_tasks equal", lines)
        self.assertIn("kickoff run 1: map_phase4 equal", lines)
        self.assertIn("kickoff run 1: phase4_whatsapp intended: waits for the CSM's approval (2b rule)", lines)
        self.assertEqual(lines[-1], "PASS: 1 run of 8925654, 0 differences.")

    def test_a_different_text_or_field_fails_naming_the_field_id_only(self):
        self.net.detail = kickoff_detail(handoff="KICKOFF HANDOFF something else", contract="0667c501-3955-4443-829a-a4eb9a1d7176")
        code, out = self.run_cmd("kickoff")
        self.assertEqual(code, 1)
        self.assertIn("kickoff run 1: handoff_comment differs: text", out)
        self.assertIn("kickoff run 1: card_fields differs: ac976d4a", out)
        self.assertIn("FAIL: 1 run of 8925654, 2 differences.", out)

    def test_a_writing_24_is_printed_with_its_columns(self):
        self.net.blueprint = BLUEPRINT_WRITE
        code, out = self.run_cmd("kickoff", "--last", "1")
        self.assertEqual(out.splitlines()[0], "kickoff [24] writes: 2, 5")

    def test_every_make_call_sits_between_its_receipts_and_none_is_made_without_one(self):
        self.run_cmd("kickoff", "--last", "1")
        made = [r for r in self.net.requests if "make.com" in r["url"]]
        self.assertEqual(len(made), 3)
        receipts = [r["json"]["phase"] for r in self.net.requests if r["url"].endswith("cockpit_csm_provider_health")]
        self.assertEqual(receipts, ["intent", "response"] * 3)
        self.net = Net()
        self.net.receipt_fails = {"intent"}
        with mock.patch.object(mp.urllib.request, "urlopen", lambda req, timeout=None: self.net(req, timeout)):
            code, out = self.run_cmd("kickoff")
        self.assertEqual(code, 1)
        self.assertEqual([r for r in self.net.requests if "make.com" in r["url"]], [])

    def test_usage_and_the_typeform_input(self):
        for args in ((), ("checkin",), ("kickoff", "--last"), ("kickoff", "--last", "99")):
            code, out = self.run_cmd(*args)
            self.assertEqual(code, 2)
        self.assertEqual(self.net.requests, [])
        inp = mp.typeform_input(trigger())
        self.assertEqual(inp["taskId"], CARD)
        self.assertEqual(inp["answers"][1]["value"], "Fit out and renovation, Design and build")
        self.assertEqual(mp.line_24({}), "[24] not found in the blueprint")
        self.assertEqual(mp.fold(" a \n\n b "), "a b")

    def test_onboarding_compares_the_dispatch_and_the_client_data_columns_with_the_relay_settings(self):
        relay = {"DISPATCH_EVENT": "market_intel", "DISPATCH_NAME_KEY": "client_name", "DISPATCH_ID_KEY": "clickup_id",
                 "CLIENT_DATA_COLUMNS": json.dumps({"A": "client", "C": "task"})}
        plan = [{"key": "github_dispatch", "plan": {"payload": {"taskId": CARD, "client": "Cedar Homes"}}},
                {"key": "client_data_row", "plan": {"payload": {"taskId": CARD, "client": "Cedar Homes", "answers": {}}}},
                {"key": "raw_answers_comment", "plan": {"comment_text": "Raw Onboarding Form Answers\n\nA: b"}},
                {"key": "profile_fields", "plan": {"fields": [{"fieldId": mp.FIELD["profile"], "value": "Revenue last year: 1"}]}}]
        mods = {25: {"input": {"data": json.dumps({"event_type": "market_intel", "client_payload": {"client_name": "Cedar Homes", "clickup_id": CARD}})}},
                31: {"input": {"values": {"0": "Cedar Homes", "2": CARD}}},
                47: {"input": {"comment_text": "Raw Onboarding Form Answers\nA: b"}},
                29: {"input": {"customFields": [{"id": mp.FIELD["profile"], "value": "Revenue last year: 1"}]}}}
        lines = dict((k, v) for k, v in mp.compare_onboarding(plan, mods, {"relay": relay, "targets": {}}) if not v.startswith("intended"))
        self.assertEqual(lines["github_dispatch"], "equal")
        self.assertEqual(lines["client_data_row"], "equal")
        self.assertEqual(lines["raw_answers_comment"], "equal")
        self.assertEqual(lines["profile_fields"], "equal")
        self.assertEqual(lines["brand_dna_task"], "differs: module [46] not in the run")
        mods[31] = {"input": {"values": {"0": "Cedar Homes", "2": CARD, "4": "extra"}}}
        lines = dict(mp.compare_onboarding(plan, mods, {"relay": relay, "targets": {}}))
        self.assertEqual(lines["client_data_row"], "differs: columns E")


if __name__ == "__main__":
    unittest.main()
