#!/usr/bin/env python3
"""scripts/dev/forms_legacy_backfill.py offline (docs/forms/WAVE12-CONTRACT.md 4.4): urllib is mocked, so no request
leaves this machine, and every key, token, client and answer is invented. Python 3.9, as on this Mac."""
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
import forms_legacy_backfill as fb  # noqa: E402

# Put together at run time, so this file holds nothing shaped like a key.
SERVICE_KEY = "eyJ" + "hbGciOiJIUzI1NiJ9." + "eyJyb2xlIjoic2VydmljZSJ9." + "invented_signature_part"
TYPEFORM_TOKEN = "tfp_" + "InventedTypeformToken" + "0123456789abcdef"
DB = "https://db.test"
EMAIL = "manager@atlantis.example"
PHONE = "+965 1111 2222"
COMMENT = "The leads were not the quality we hoped for"
SECRETS = (SERVICE_KEY, TYPEFORM_TOKEN, EMAIL, PHONE, COMMENT, "Atlantis", "86eyjkdc8")


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


def response(n: int, card: str = "86eyjkdc8", name: str = "Atlantis Interiors") -> dict:
    """One termination survey as Typeform's responses API returns it."""
    hidden = {"client_name": name, "utm_source": "x"}
    if card:
        hidden["onboarding_client_id"] = card
    return {
        "token": f"exit{n:012d}",
        "response_id": f"exit{n:012d}",
        "submitted_at": f"2026-09-{10 + n:02d}T08:00:00Z",
        "hidden": hidden,
        "answers": [
            {"type": "text", "text": "Dana", "field": {"id": "c1", "ref": "first-ref", "type": "short_text"}},
            {"type": "email", "email": EMAIL, "field": {"id": "c2", "ref": "email-ref", "type": "email"}},
            {"type": "phone_number", "phone_number": PHONE, "field": {"id": "c3", "ref": "phone-ref", "type": "phone_number"}},
            {"type": "choices", "choices": {"labels": ["Results"]}, "field": {"id": "r1", "ref": "reason-ref", "type": "multiple_choice"}},
            {"type": "number", "number": 4, "field": {"id": "r2", "ref": "ads-ref", "type": "opinion_scale"}},
            {"type": "text", "text": COMMENT, "field": {"id": "r4", "ref": "final-ref", "type": "long_text"}},
        ],
    }


DEFINITION = {"id": "knIe4eF3", "fields": [
    {"id": "g1", "ref": "contact-ref", "type": "contact_info", "title": "Contact", "properties": {"fields": [
        {"id": "c1", "ref": "first-ref", "type": "short_text", "title": "First name"},
        {"id": "c2", "ref": "email-ref", "type": "email", "title": "Email"},
        {"id": "c3", "ref": "phone-ref", "type": "phone_number", "title": "Phone"}]}},
    {"id": "r1", "ref": "reason-ref", "type": "multiple_choice", "title": "Reason"},
    {"id": "r2", "ref": "ads-ref", "type": "opinion_scale", "title": "Ad performance"},
    {"id": "r4", "ref": "final-ref", "type": "long_text", "title": "Final comments"},
]}


class Net:
    """urlopen's stand-in: the database and Typeform, from invented state."""

    def __init__(self):
        self.requests = []
        self.registry = [{"provider": "typeform", "typeform_id": "knIe4eF3"}]
        self.items = [response(1), response(2), response(3, card="")]
        self.stored = set()
        self.cards = [{"clickup_task_id": "86eyjkdc8"}]
        self.receipt_fails = set()
        self.refuse = None  # (status, body) the record RPC answers when set
        self.forms = {}  # other Typeform forms: form id -> (definition, items)
        self.onboarding_rows = []  # cockpit_client_onboarding cards
        self.responses = []  # cockpit_form_responses rows (kickoff --count)
        self.tie_refuse = None  # (status, body) cockpit_sale_tie_open answers when set

    def made(self, prefix, method=None):
        return [r for r in self.requests if r["url"].startswith(prefix) and (method is None or r["method"] == method)]

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
            assert headers["apikey"] == SERVICE_KEY and headers["authorization"] == "Bearer " + SERVICE_KEY
        if url == f"{DB}/rest/v1/cockpit_csm_provider_health":
            return (400, {"message": "refused"}) if body["phase"] in self.receipt_fails else (201, "")
        if url.startswith(f"{DB}/rest/v1/cockpit_forms?"):
            return 200, self.registry
        if url.startswith(f"{DB}/rest/v1/cockpit_billing_accounts?"):
            return 200, self.cards
        if url.startswith(f"{DB}/rest/v1/cockpit_client_onboarding?"):
            return 200, self.onboarding_rows
        if url.startswith(f"{DB}/rest/v1/cockpit_form_responses?"):
            return 200, self.responses
        if url == f"{DB}/rest/v1/rpc/cockpit_form_record_make":
            p = body["p"]
            inserted = p["externalId"] not in self.stored
            self.stored.add(p["externalId"])
            known = {c["clickup_task_id"] for c in self.cards + self.onboarding_rows}
            card = p["taskId"] if p["taskId"] in known else None
            return 200, {"inserted": inserted, "responseId": "33333333-3333-4333-8333-333333333333", "taskId": card,
                         "readModel": "written" if card and inserted else ("no_card" if not card else "newer_kept")}
        if url == f"{DB}/rest/v1/rpc/cockpit_sale_tie_open":
            if self.tie_refuse:
                return self.tie_refuse
            return 200, {"ok": True, "state": "waiting", "tieId": 1, "repeat": False}
        if url == f"{DB}/rest/v1/rpc/cockpit_form_record_legacy":
            if self.refuse:
                return self.refuse
            p = body["p"]
            inserted = p["externalId"] not in self.stored
            self.stored.add(p["externalId"])
            card = p["taskId"] if p["taskId"] in {c["clickup_task_id"] for c in self.cards} else None
            return 200, {"inserted": inserted, "responseId": "11111111-1111-4111-8111-111111111111", "matched": False,
                         "noticeQueued": False, "taskId": card}
        if url.startswith("https://api.typeform.com/"):
            assert headers["authorization"] == "Bearer " + TYPEFORM_TOKEN
            path = urllib.parse.urlsplit(url).path
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            for fid, (definition, items) in self.forms.items():
                if path == f"/forms/{fid}":
                    return 200, definition
                if path == f"/forms/{fid}/responses":
                    return 200, {"items": items, "total_items": len(items)}
            if path == "/forms/knIe4eF3":
                return 200, DEFINITION
            if path == "/forms/knIe4eF3/responses":
                assert query["completed"] == ["true"]
                size = int(query["page_size"][0])
                items = self.items
                if "before" in query:
                    at = next(i for i, x in enumerate(items) if x["token"] == query["before"][0])
                    items = items[at + 1:]
                return 200, {"items": items[:size], "total_items": len(self.items)}
        raise AssertionError(f"no fake for {method} {url}")


class Backfill(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        release = self.tmp / "releases" / "86eebpf1"
        release.mkdir(parents=True)
        (self.tmp / "current").symlink_to(release)
        state = self.tmp / "state"
        state.mkdir()
        (state / "runtime-86eebpf1.json").write_text(json.dumps({"SUPABASE_URL": DB + "/", "SUPABASE_SERVICE_ROLE_KEY": SERVICE_KEY,
                                                               "TYPEFORM_TOKEN": TYPEFORM_TOKEN}))
        self.state = state
        self.net = Net()
        for patch in (mock.patch.object(fb, "NATIVE_CURRENT", str(self.tmp / "current")),
                      mock.patch.object(fb, "NATIVE_STATE", str(state)),
                      mock.patch.object(fb.urllib.request, "urlopen", lambda req, timeout=None: self.net(req, timeout))):
            patch.start()
            self.addCleanup(patch.stop)

    def run_cmd(self, *args):
        out = io.StringIO()
        with redirect_stdout(out):
            code = fb.main(list(args))
        text = out.getvalue()
        for secret in SECRETS:
            self.assertNotIn(secret, text)
        return code, text

    def records(self):
        return [r["json"]["p"] for r in self.net.made(f"{DB}/rest/v1/rpc/cockpit_form_record_legacy")]

    def test_a_form_or_flag_it_does_not_know_exits_2_before_anything_is_read(self):
        for args in ((), ("kickoff",), ("checkin", "--dry"), ("exit_survey", "--apply"), ("EXIT_SURVEY",)):
            code, out = self.run_cmd(*args)
            self.assertEqual(code, 2)
            self.assertEqual(out.strip(), fb.USAGE)
        self.assertEqual(self.net.requests, [])

    def test_dry_reads_and_counts_and_writes_nothing(self):
        code, out = self.run_cmd("exit_survey", "--dry")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.strip(), "read 3, would store up to 3, unmatched 1 (dry run: nothing written)")
        self.assertEqual(self.records(), [])
        self.assertEqual([r["method"] for r in self.net.made(DB) if "provider_health" not in r["url"]], ["GET", "GET"])

    def test_each_response_is_posted_as_forms_door_builds_it_with_backfill_true(self):
        code, out = self.run_cmd("exit_survey")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.strip(), "read 3, stored 3, already there 0, unmatched 1")
        first = self.records()[0]
        self.assertEqual(first, {
            "formKey": "exit_survey", "externalId": "exit000000000001", "submittedAt": "2026-09-11T08:00:00Z",
            "answers": {"fields": [
                {"ref": "first-ref", "type": "short_text", "title": "First name", "value": "Dana"},
                {"ref": "reason-ref", "type": "multiple_choice", "title": "Reason", "value": ["Results"]},
                {"ref": "ads-ref", "type": "opinion_scale", "title": "Ad performance", "value": 4},
                {"ref": "final-ref", "type": "long_text", "title": "Final comments", "value": COMMENT},
            ]},
            "hidden": {"client_name": "Atlantis Interiors", "onboarding_client_id": "86eyjkdc8"},
            "taskId": "86eyjkdc8", "clientName": "Atlantis Interiors", "backfill": True,
        })
        sent = json.dumps(self.records())
        self.assertNotIn(EMAIL, sent)
        self.assertNotIn(PHONE, sent)
        self.assertNotIn("utm_source", sent)
        self.assertIsNone(self.records()[2]["taskId"])
        # A second run stores nothing new.
        code, out = self.run_cmd("exit_survey")
        self.assertEqual(out.strip(), "read 3, stored 0, already there 3, unmatched 1")

    def test_every_typeform_call_sits_between_its_receipts_and_none_is_made_without_one(self):
        self.run_cmd("exit_survey", "--dry")
        receipts = [r["json"] for r in self.net.made(f"{DB}/rest/v1/cockpit_csm_provider_health")]
        self.assertEqual([(r["provider"], r["resource"], r["phase"]) for r in receipts], [
            ("typeform", "api.typeform.com/forms/:id", "intent"), ("typeform", "api.typeform.com/forms/:id", "response"),
            ("typeform", "api.typeform.com/forms/:id/responses", "intent"),
            ("typeform", "api.typeform.com/forms/:id/responses", "response"),
        ])
        self.assertTrue(all(r["run_key"].startswith("forms-backfill:") for r in receipts))
        self.net = Net()
        self.net.receipt_fails = {"intent"}
        with mock.patch.object(fb.urllib.request, "urlopen", lambda req, timeout=None: self.net(req, timeout)):
            code, out = self.run_cmd("exit_survey")
        self.assertEqual(code, 1)
        self.assertIn("could not be saved, so the call was not made", out)
        self.assertEqual([r for r in self.net.requests if r["url"].startswith("https://api.typeform.com/")], [])

    def test_more_than_a_page_reads_on_with_the_last_token(self):
        self.net.items = [response(i) for i in range(1, 1003)]
        with mock.patch.object(fb, "PAGE", 1000):
            code, out = self.run_cmd("exit_survey", "--dry")
        self.assertEqual(code, 0, out)
        self.assertTrue(out.startswith("read 1002, "), out)
        reads = self.net.made("https://api.typeform.com/forms/knIe4eF3/responses")
        self.assertEqual(len(reads), 2)
        self.assertIn("before=exit000000001000", reads[1]["url"])

    def test_a_refused_record_prints_the_code_only_and_exits_1(self):
        self.net.refuse = (400, {"code": "22023", "message": f"bad {COMMENT}"})
        code, out = self.run_cmd("exit_survey")
        self.assertEqual(code, 1)
        self.assertEqual(out.strip(), "read 3, stored 0, already there 0, unmatched 0, not stored 3 (22023)")

    def test_a_form_no_longer_on_typeform_stops_before_any_typeform_call(self):
        self.net.registry = [{"provider": "native", "typeform_id": "knIe4eF3"}]
        code, out = self.run_cmd("pause_request", "--dry")
        self.assertEqual(code, 1)
        self.assertEqual(out.strip(), "The pause_request form is no longer filled in Typeform, so there is nothing to read from it.")
        self.assertEqual([r for r in self.net.requests if r["url"].startswith("https://api.typeform.com/")], [])

    def test_the_runtime_file_must_hold_the_keys(self):
        (self.state / "runtime-86eebpf1.json").write_text(json.dumps({"SUPABASE_URL": DB, "SUPABASE_SERVICE_ROLE_KEY": SERVICE_KEY}))
        code, out = self.run_cmd("exit_survey", "--dry")
        self.assertEqual(code, 1)
        self.assertEqual(out.strip(), "The native runtime file has no TYPEFORM_TOKEN.")
        self.assertEqual(self.net.requests, [])

    def test_legacy_input_matches_forms_door_on_the_hidden_fields_and_the_card(self):
        p = fb.legacy_input("pause_request", {"token": "t", "submitted_at": "s", "answers": [],
                                              "hidden": {"onboarding_client_id": " bad id! ", "client_name": "  ", "email": EMAIL}}, {})
        self.assertEqual(p, {"formKey": "pause_request", "externalId": "t", "submittedAt": "s", "answers": {"fields": []},
                             "hidden": {"onboarding_client_id": "bad id!"}, "taskId": None, "clientName": None, "backfill": True})


    # ---------------------------------------------------------------- waves 3-4: NPS, CSAT and the two Make forms

    def fixture(self, name):
        path = Path(__file__).resolve().parents[2] / "supabase" / "functions" / "forms-door" / "fixtures" / name
        return json.loads(path.read_text())

    def made_make(self):
        return [r["json"]["p"] for r in self.net.made(f"{DB}/rest/v1/rpc/cockpit_form_record_make")]

    def test_the_backfill_builds_onboarding_and_the_new_client_form_exactly_as_forms_door_does(self):
        # The same golden files forms-door's handler.test.ts holds makeInput to.
        for payload, form, golden in (("onboarding-response.json", "onboarding", "onboarding-expected.json"),
                                      ("new-client-response.json", "new_client", "new-client-expected.json")):
            item = self.fixture(payload)["form_response"]
            definition = item["definition"]
            built = fb.make_input(form, item, fb.field_titles(definition), definition)
            self.assertEqual(fb.record_of(built), self.fixture(golden)["p"])
            # The sale tie's keys ride beside the record, never in it (4.19).
            self.assertEqual(built.get("tieKeys"), self.fixture(golden).get("tieKeys"))

    def test_onboarding_is_recorded_through_record_make_and_says_how_many_read_model_rows_it_filled(self):
        item = self.fixture("onboarding-response.json")["form_response"]
        definition = item.pop("definition")
        self.net.registry = [{"provider": "typeform", "typeform_id": "KFRCXPFx"}]
        self.net.forms = {"KFRCXPFx": (definition, [item, {**item, "token": "onb0000token0002", "hidden": {}}])}
        self.net.onboarding_rows = [{"clickup_task_id": "86exc1tyw"}]
        code, out = self.run_cmd("onboarding", "--dry")
        self.assertEqual(out.strip(), "read 2, would store up to 2, unmatched 1 (dry run: nothing written)")
        self.assertEqual(self.made_make(), [])
        code, out = self.run_cmd("onboarding")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.strip(), "read 2, stored 2, already there 0, unmatched 1, read model filled 1")
        self.assertEqual([p["taskId"] for p in self.made_make()], ["86exc1tyw", None])
        self.assertTrue(all(p["backfill"] is True for p in self.made_make()))
        self.assertNotIn("owner@citywood.example", out)
        self.assertNotIn("City Wood", out)

    def test_the_new_client_form_is_recorded_only_with_no_card_and_no_contact_details(self):
        item = self.fixture("new-client-response.json")["form_response"]
        definition = item.pop("definition")
        self.net.registry = [{"provider": "typeform", "typeform_id": "BTzMwXiw"}]
        self.net.forms = {"BTzMwXiw": (definition, [item])}
        code, out = self.run_cmd("new_client")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.strip(), "read 1, stored 1, already there 0, unmatched 1")
        [p] = self.made_make()
        self.assertEqual(p["hidden"], {"contact_id": "ghlContact0001", "closer": "Closer Test", "setter": "Setter Test"})
        self.assertIsNone(p["taskId"])
        for value in ("owner@harbour.example", "+965 0000 0002", "96500000002", "tieKeys", fb.NEW_CLIENT_DROP_REFS[0]):
            self.assertNotIn(value, json.dumps(p))
        self.assertEqual(self.records(), [])
        # As the door does: the two typed keys go to the sale tie alone, after the record.
        ties = [r["json"] for r in self.net.made(f"{DB}/rest/v1/rpc/cockpit_sale_tie_open")]
        self.assertEqual(ties, [{"p": {"externalId": "ncf0000token0001", "submittedAt": "2026-10-30T11:00:00Z",
                                       "tieKeys": {"phone": "+965 0000 0002", "email": "owner@harbour.example"}}}])
        for value in ("owner@harbour.example", "+965 0000 0002"):
            self.assertNotIn(value, out)
        # Read only: nothing here posts to Typeform.
        self.assertEqual([r for r in self.net.requests if r["url"].startswith("https://api.typeform.com/") and r["method"] != "GET"], [])

    def test_a_sale_tie_that_cannot_be_opened_is_counted_never_printed_and_a_dry_run_opens_none(self):
        item = self.fixture("new-client-response.json")["form_response"]
        definition = item.pop("definition")
        self.net.registry = [{"provider": "typeform", "typeform_id": "BTzMwXiw"}]
        self.net.forms = {"BTzMwXiw": (definition, [item])}
        code, out = self.run_cmd("new_client", "--dry")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.net.made(f"{DB}/rest/v1/rpc/cockpit_sale_tie_open"), [])
        self.net.tie_refuse = (500, {"message": "owner@harbour.example +965 0000 0002", "code": "XX000"})
        code, out = self.run_cmd("new_client")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.strip(), "read 1, stored 1, already there 0, unmatched 1, "
                                      "sale ties not opened 1 (the onboarding sync's sweep opens them)")
        for value in ("owner@harbour.example", "+965 0000 0002"):
            self.assertNotIn(value, out)

    def test_the_sale_tie_keys_come_from_the_typed_answers_only(self):
        item = self.fixture("new-client-response.json")["form_response"]
        self.assertEqual(fb.tie_keys_of(item), {"phone": "+965 0000 0002", "email": "owner@harbour.example"})
        raw_only = {**item, "answers": [a for a in item["answers"] if a["field"]["ref"] in fb.NEW_CLIENT_DROP_REFS],
                    "hidden": {"phone": "+96500000003"}}
        self.assertEqual(fb.tie_keys_of(raw_only), {"phone": None, "email": None})
        other = {**item, "answers": [{"type": "phone_number", "phone_number": "+96500000005",
                                      "field": {"ref": "other-phone", "type": "phone_number"}}]}
        self.assertEqual(fb.tie_keys_of(other), {"phone": None, "email": None})

    def test_the_old_nps_and_csat_answers_are_read_from_their_native_rows_and_never_get_a_card(self):
        for form, fid in (("nps", "fuPgs85S"), ("csat", "KbcbPA73")):
            self.net.registry = [{"provider": "native", "typeform_id": fid}]
            self.net.forms = {fid: ({"id": fid, "fields": [{"id": "s1", "ref": "score-ref", "type": "opinion_scale", "title": "Score"}]},
                                    [{"token": f"{form}Old00000001", "submitted_at": "2026-10-28T08:00:00Z",
                                      "hidden": {"onboarding_client_id": "86eyjkdc8"},
                                      "answers": [{"type": "number", "number": 8, "field": {"id": "s1", "ref": "score-ref", "type": "opinion_scale"}}]}])}
            code, out = self.run_cmd(form, "--dry")
            self.assertEqual(out.strip(), "read 1, would store up to 1, unmatched 1 (dry run: nothing written)")
            code, out = self.run_cmd(form)
            self.assertEqual(code, 0, out)
            self.assertEqual(out.strip(), "read 1, stored 1, already there 0, unmatched 1")
        self.assertEqual([(p["formKey"], p["taskId"], p["backfill"]) for p in self.records()],
                         [("nps", None, True), ("csat", None, True)])

    def test_onboarding_values_and_titles_follow_the_sync(self):
        self.assertEqual(fb.question_title("**Name** | الاسم This question is required.", {}), "Name")
        self.assertEqual(fb.question_title("For {{hidden:client_name}} and {{hidden:missing}}", {"client_name": "Acme"}),
                         "For Acme and \u2026")
        self.assertEqual(fb.question_title("x" * 200, {}), "x" * 157 + "\u2026")
        self.assertEqual(fb.onboarding_value({"type": "boolean", "boolean": False}), "No")
        self.assertEqual(fb.onboarding_value({"type": "number", "number": 9.5}), "9.5")
        self.assertEqual(fb.onboarding_value({"type": "payment", "payment": {"amount": "0"}}), "0")
        self.assertEqual(fb.onboarding_value({"type": "dropdown"}), "")


if __name__ == "__main__":
    unittest.main()


class KickoffCount(unittest.TestCase):
    """kickoff --count (docs/forms/WAVE56-CONTRACT.md 4.15.4): Stage 4's recorded inputs, counts only."""

    setUp = Backfill.setUp
    run_cmd = Backfill.run_cmd

    def test_counts_both_sources_with_no_typeform_call_and_no_write(self):
        self.net.onboarding_rows = ([{"kickoff": "BbJy6xg4", "onboarding": "KFRCXPFx"}] * 3
                                    + [{"kickoff": "tG7dnxBn", "onboarding": None}] * 2 + [{"kickoff": None, "onboarding": None}])
        self.net.responses = ([{"form_key": "kickoff", "form_version": 1, "state": "submitted"}] * 2
                              + [{"form_key": "kickoff", "form_version": 2, "state": "submitted"}]
                              + [{"form_key": "onboarding", "form_version": 1, "state": "submitted"}] * 4
                              + [{"form_key": "onboarding", "form_version": 1, "state": "legacy"}])
        code, out = self.run_cmd("kickoff", "--count")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.strip(), "kickoff read model 5 (BbJy6xg4 3, tG7dnxBn 2), kickoff responses 3 (pointer 2, native 1), "
                                      "onboarding answers 5 (legacy 1), onboarding read model 3 (counts only: nothing written)")
        self.assertEqual(self.net.made("https://api.typeform.com/"), [])
        self.assertEqual([r["method"] for r in self.net.requests], ["GET", "GET"])

    def test_no_typeform_token_is_needed_and_an_unreadable_source_is_said_not_zero(self):
        (self.state / "runtime-86eebpf1.json").write_text(json.dumps({"SUPABASE_URL": DB, "SUPABASE_SERVICE_ROLE_KEY": SERVICE_KEY}))
        self.net.responses = "not a list"
        code, out = self.run_cmd("kickoff", "--count")
        self.assertEqual(code, 1)
        self.assertEqual(out.strip(), "The stored answers could not be read, so it is not counted. Nothing was written.")

    def test_kickoff_takes_only_count(self):
        for args in (("kickoff", "--dry"), ("kickoff", "--count", "--dry")):
            code, out = self.run_cmd(*args)
            self.assertEqual(code, 2)
        self.assertEqual(self.net.requests, [])
