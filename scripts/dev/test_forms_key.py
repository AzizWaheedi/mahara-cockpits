#!/usr/bin/env python3
"""scripts/dev/forms_key.py offline (docs/forms/STAGE2-CONTRACT.md 4.5 and section 11): urllib is mocked, so
no request leaves this machine, and every key, id and person is invented. Python 3.9, as on this Mac."""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import re
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
import forms_key as fk  # noqa: E402

# Put together at run time, so this file holds nothing shaped like a key.
FATHOM_KEY = "fathom" + "-invented-key-" + "0123456789abcdef"
DEEPSEEK_KEY = "sk-" + "inventeddeepseekkey" + "0123456789"
SERVICE_KEY = "eyJ" + "hbGciOiJIUzI1NiJ9." + "eyJyb2xlIjoic2VydmljZSJ9." + "invented_signature_part"
WEBHOOK_SECRET = "whsec_" + base64.b64encode(b"an invented webhook key, 32 byte").decode()
OLD_SECRET = "whsec_" + base64.b64encode(b"an older invented webhook key...").decode()
TYPEFORM_TOKEN = "tfp_" + "InventedTypeformToken" + "0123456789abcdef"
KICKOFF_SECRET = "Invented" + "KickoffSigningKey" + "0123456789abcdefgh"
SECRETS = (FATHOM_KEY, DEEPSEEK_KEY, SERVICE_KEY, WEBHOOK_SECRET, OLD_SECRET, TYPEFORM_TOKEN, KICKOFF_SECRET)
DB = "https://db.test"
WEBHOOK_ID = "wh_invented_9876"
SAVED_AT = "2026-10-27T09:00:00.12345+00:00"
NO_ANSWER = object()


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


class Net:
    """urlopen's stand-in: the database, Fathom, DeepSeek and our two functions, from invented state."""

    def __init__(self):
        self.requests = []
        self.keys = {}                        # provider -> the cockpit_forms_key_get answer
        self.answers = {}                     # (method, url prefix) -> (status, body) or NO_ANSWER, set by a test
        self.receipt_fails = set()            # phases whose receipt the database refuses
        self.users = [{"email": f"user{i}@maharamedia.com", "status": "active"} for i in range(4)]
        self.meetings = [{"recording_id": 196100001, "recorded_by": {"team": "Customer Success"}}]
        self.deliveries = {}                  # webhook-id -> outcome, as fathom-webhook settles it
        # The kickoff form's Typeform webhooks: Make's, which nothing here may touch, and any cockpit one.
        self.registry = [{"provider": "typeform", "typeform_id": "tG7dnxBn"}]
        self.hooks = [{"id": "01HMAKEHOOK", "form_id": "tG7dnxBn", "tag": "WHTP3992232", "url": "https://hook.eu1.make.com/invented",
                       "enabled": True, "verify_ssl": True}]
        self.door_status = {}                 # forms-door's sync row detail
        self.wrote = False                    # a PUT or DELETE of the cockpit webhook has reached Typeform
        self.read_back = None                 # what the webhooks read answers once it has, set by a test
        self.read_back_no_receipt = False     # the database refuses every intent receipt once it has

    # what the tests read
    def made(self, prefix, method=None):
        return [r for r in self.requests if r["url"].startswith(prefix) and (method is None or r["method"] == method)]

    def receipts(self):
        return [r["json"] for r in self.made(f"{DB}/rest/v1/cockpit_csm_provider_health")]

    def rpcs(self, name):
        return [r["json"] for r in self.made(f"{DB}/rest/v1/rpc/{name}")]

    def provider_calls(self):
        return [r for r in self.requests if not r["url"].startswith(DB)]

    def __call__(self, req, timeout=None):
        url = req.full_url
        method = req.get_method()
        headers = {k.lower(): v for k, v in req.header_items()}
        data = req.data
        try:
            body = json.loads(data) if data else None
        except ValueError:
            body = None
        self.requests.append({"method": method, "url": url, "headers": headers, "json": body, "raw": data})
        for (m, prefix), answer in self.answers.items():
            if m == method and url.startswith(prefix):
                return self.reply(url, answer)
        return self.reply(url, self.route(method, url, headers, body, data))

    @staticmethod
    def reply(url, answer):
        if answer is NO_ANSWER:
            raise urllib.error.URLError("timed out")
        status, body = answer
        text = body if isinstance(body, str) else json.dumps(body)
        if status >= 400:
            raise urllib.error.HTTPError(url, status, "refused", None, io.BytesIO(text.encode()))
        return Answer(status, text)

    def route(self, method, url, headers, body, data):
        if url == f"{DB}/rest/v1/cockpit_csm_provider_health":
            assert headers["authorization"] == "Bearer " + SERVICE_KEY
            refused = body["phase"] in self.receipt_fails or (self.wrote and self.read_back_no_receipt and body["phase"] == "intent")
            return (400, {"message": "refused"}) if refused else (201, "")
        if url.startswith(f"{DB}/rest/v1/rpc/"):
            assert headers["apikey"] == SERVICE_KEY and headers["authorization"] == "Bearer " + SERVICE_KEY
            name = url.rsplit("/", 1)[1]
            if name == "cockpit_forms_key_get":
                return 200, self.keys.get(body["p_provider"])
            if name == "cockpit_forms_key_put":
                p = body["p"]
                if p["provider"] == "fathom_webhook" and not re.match(r"^whsec_[A-Za-z0-9+/=_-]{16,}$", p["secret"]):
                    return 400, {"code": "22023", "message": "That doesn't look like a Fathom webhook key. Nothing was changed."}
                return 200, {"ok": True, "provider": p["provider"], "last4": p["secret"][-4:], "state": p["state"]}
            if name == "cockpit_forms_key_mark":
                return 200, {"ok": True, "provider": body["p"]["provider"], "state": body["p"]["state"]}
        if url.startswith(f"{DB}/rest/v1/cockpit_forms?"):
            return 200, self.registry
        if url.startswith(f"{DB}/rest/v1/cockpit_sync_state?"):
            return 200, [{"detail": self.door_status}] if self.door_status else []
        if url.startswith("https://api.typeform.com/"):
            return self.typeform(method, url, headers, body)
        if url == f"{DB}/functions/v1/forms-door/typeform/kickoff":
            return self.door(headers, data)
        if url.startswith(f"{DB}/rest/v1/cockpit_fathom_webhook_deliveries?"):
            wid = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["webhook_id"][0][3:]
            return 200, [{"outcome": self.deliveries[wid], "reason": "Not a Customer Success recording."}] if wid in self.deliveries else []
        if url == f"{DB}/functions/v1/cockpit-forms-api":
            return 200, {"ok": True, "keys": {"fathom": {"state": "connected", "saved": True}}, "note": "Every check passed."}
        if url == f"{DB}/functions/v1/fathom-webhook":
            return self.webhook(headers, data)
        if url.startswith("https://api.fathom.ai/external/v1/users"):
            return 200, {"items": self.users, "next_cursor": None}
        if url.startswith("https://api.fathom.ai/external/v1/meetings"):
            return 200, {"items": self.meetings, "next_cursor": None, "limit": 10}
        if url == "https://api.fathom.ai/external/v1/webhooks" and method == "POST":
            return 201, {"id": WEBHOOK_ID, "url": body["destination_url"], "secret": WEBHOOK_SECRET,
                         "created_at": "2026-10-28T09:00:00Z", "triggered_for": body["triggered_for"],
                         "include_transcript": True, "include_summary": True, "include_action_items": True,
                         "include_crm_matches": False}
        if url.startswith("https://api.fathom.ai/external/v1/webhooks/") and method == "DELETE":
            return 204, ""
        if url == "https://api.deepseek.com/models":
            return 200, {"object": "list", "data": [{"id": "deepseek-chat"}, {"id": "deepseek-flash"}]}
        raise AssertionError(f"no fake for {method} {url}")

    def typeform(self, method, url, headers, body):
        """Typeform's webhooks API for one form, from invented state."""
        assert headers["authorization"] == "Bearer " + TYPEFORM_TOKEN
        path = urllib.parse.urlsplit(url).path
        if method == "GET" and path == "/forms/tG7dnxBn/webhooks":
            if self.wrote and self.read_back is not None:
                return self.read_back
            return 200, {"items": self.hooks}
        if path == "/forms/tG7dnxBn/webhooks/cockpit" and method in ("PUT", "DELETE"):
            self.wrote = True
        if path == "/forms/tG7dnxBn/webhooks/cockpit" and method == "PUT":
            hook = {"id": "01HCOCKPITHOOK", "form_id": "tG7dnxBn", "tag": "cockpit", "url": body["url"], "enabled": body["enabled"],
                    "verify_ssl": body["verify_ssl"], "event_types": body["event_types"]}
            self.hooks = [h for h in self.hooks if h["tag"] != "cockpit"] + [hook]
            self.secret_sent = body["secret"]
            return 200, hook
        if path == "/forms/tG7dnxBn/webhooks/cockpit" and method == "DELETE":
            had = any(h["tag"] == "cockpit" for h in self.hooks)
            self.hooks = [h for h in self.hooks if h["tag"] != "cockpit"]
            return (204, "") if had else (404, {"code": "NOT_FOUND"})
        raise AssertionError(f"no Typeform fake for {method} {url}")

    def door(self, headers, data):
        """forms-door's signature check, with this file's own signer."""
        secret = (self.keys.get("typeform_kickoff") or {}).get("secret") or ""
        good = "sha256=" + base64.b64encode(hmac.new(secret.encode(), data, hashlib.sha256).digest()).decode()
        if headers.get("typeform-signature") != good:
            return 401, {"ok": False}
        return (200, {"ok": True, "probe": True}) if headers.get("x-forms-door-probe") == "1" else (202, {"ignored": True})

    def webhook(self, headers, data):
        """fathom-webhook's door, checked here with this file's own signer."""
        secret = (self.keys.get("fathom_webhook") or {}).get("secret") or ""
        key = base64.b64decode(secret[len("whsec_"):])
        content = f"{headers['webhook-id']}.{headers['webhook-timestamp']}.{data.decode()}".encode()
        good = "v1," + base64.b64encode(hmac.new(key, content, hashlib.sha256).digest()).decode()
        if headers["webhook-signature"] != good:
            return 401, {"ok": False}
        self.deliveries[headers["webhook-id"]] = "ignored"
        return 200, {"ok": True}


def webhook_row(**meta):
    return {"provider": "fathom_webhook", "secret": WEBHOOK_SECRET, "last4": WEBHOOK_SECRET[-4:], "state": "unchecked",
            "savedAt": SAVED_AT, "meta": {"webhookId": WEBHOOK_ID, "triggeredFor": ["shared_team_recordings"], **meta}}


class FormsKey(unittest.TestCase):
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
        self.env = self.tmp / "api-keys.env"
        self.env.write_text(f'export FATHOM_API_KEY="{FATHOM_KEY}"\nDEEPSEEK_API_KEY={DEEPSEEK_KEY}\n# OTHER=1\n')
        self.net = Net()
        for patch in (mock.patch.object(fk, "ENV_FILE", str(self.env)),
                      mock.patch.object(fk, "NATIVE_CURRENT", str(self.tmp / "current")),
                      mock.patch.object(fk, "NATIVE_STATE", str(state)),
                      mock.patch.object(fk.urllib.request, "urlopen", lambda req, timeout=None: self.net(req, timeout))):
            patch.start()
            self.addCleanup(patch.stop)

    def run_cmd(self, *args):
        out = io.StringIO()
        with redirect_stdout(out):
            code = fk.main(list(args))
        text = out.getvalue()
        for secret in SECRETS:
            self.assertNotIn(secret, text)
        return code, text

    def assert_wrapped(self, provider, method, resource, status):
        """Every call of this kind sits between an intent receipt and its response receipt, in that order."""
        order = [("receipt", r["json"]["phase"]) if r["url"].startswith(f"{DB}/rest/v1/cockpit_csm_provider_health")
                 else ("call", r["method"]) for r in self.net.requests
                 if r["url"].startswith(f"{DB}/rest/v1/cockpit_csm_provider_health") or not r["url"].startswith(DB)]
        mine = [r for r in self.net.receipts() if r["resource"] == resource and r["method"] == method]
        self.assertEqual([r["phase"] for r in mine][:2], ["intent", "response"])
        self.assertEqual(mine[1]["http_status"], status)
        for r in mine:
            self.assertEqual(r["provider"], provider)
            self.assertIsNone(r["action_id"])
            self.assertRegex(r["run_key"], r"^forms-key:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
        # Strictly alternating: no provider call without an intent receipt just before it.
        for i, (kind, what) in enumerate(order):
            if kind == "call":
                self.assertEqual(order[i - 1], ("receipt", "intent"))
                self.assertIn(order[i + 1], (("receipt", "response"), ("receipt", "unknown")))

    # ------------------------------------------------------------- status and doctor

    def test_status_prints_state_last_4_and_saved_at_never_a_secret(self):
        self.net.keys = {"fathom": {"provider": "fathom", "secret": FATHOM_KEY, "last4": "cdef", "state": "connected",
                                    "savedAt": "2026-10-28T06:15:00.5+00:00", "meta": {}},
                         "fathom_webhook": webhook_row()}
        code, out = self.run_cmd("status")
        self.assertEqual(code, 0)
        self.assertEqual(out.splitlines(), [
            "fathom: connected, key ending ····cdef, saved 2026-10-28 09:15 Kuwait time",
            f"fathom_webhook: unchecked, key ending ····{WEBHOOK_SECRET[-4:]}, saved 2026-10-27 12:00 Kuwait time, registered",
            "deepseek: not saved",
            "anthropic: not saved",
            "typeform kickoff: not saved",
        ])
        self.assertEqual([r["p_provider"] for r in self.net.rpcs("cockpit_forms_key_get")], [*fk.PROVIDERS, "typeform_kickoff"])
        self.assertEqual(self.net.provider_calls(), [])
        self.assertEqual(self.net.receipts(), [])

    def test_status_reads_an_unregistered_webhook_as_not_registered(self):
        self.net.keys = {"fathom_webhook": webhook_row(unregisteredAt="2026-10-28T10:00:00Z")}
        code, out = self.run_cmd("status")
        self.assertEqual(code, 0)
        self.assertIn("fathom_webhook: unchecked, key ending", out)
        self.assertIn(", not registered", out)

    def test_status_stops_when_the_keys_cannot_be_read(self):
        self.net.answers[("POST", f"{DB}/rest/v1/rpc/cockpit_forms_key_get")] = (401, {"message": f"bad key {SERVICE_KEY}"})
        code, out = self.run_cmd("status")
        self.assertEqual(code, 1)
        self.assertIn("The keys could not be read (HTTP 401: bad key [key]).", out)

    def test_doctor_posts_the_op_with_the_service_key_and_writes_no_receipt(self):
        code, out = self.run_cmd("doctor")
        self.assertEqual(code, 0)
        call = self.net.made(f"{DB}/functions/v1/cockpit-forms-api")[0]
        self.assertEqual(call["json"], {"op": "doctor"})
        self.assertEqual(call["headers"]["authorization"], "Bearer " + SERVICE_KEY)
        self.assertEqual(json.loads(out)["note"], "Every check passed.")
        self.assertEqual(self.net.receipts(), [])
        self.net.answers[("POST", f"{DB}/functions/v1/cockpit-forms-api")] = (200, {"ok": False, "note": "Fathom refused."})
        self.assertEqual(self.run_cmd("doctor")[0], 1)

    # ------------------------------------------------------------- fathom and deepseek

    def test_fathom_tests_the_key_then_saves_it(self):
        code, out = self.run_cmd("fathom")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.strip(), "fathom: the key works (4 active users). Saved, key ending ····cdef")
        users, meetings = self.net.provider_calls()
        self.assertEqual(users["url"], "https://api.fathom.ai/external/v1/users?status=active")
        self.assertEqual(users["headers"]["x-api-key"], FATHOM_KEY)
        # The brackets stay literal; only values are encoded.
        self.assertTrue(meetings["url"].startswith(
            "https://api.fathom.ai/external/v1/meetings?teams[]=Customer%20Success&created_after=20"), meetings["url"])
        self.assertNotIn("%5B", meetings["url"])
        since = urllib.parse.unquote(meetings["url"].split("created_after=")[1])
        self.assertRegex(since, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        put = self.net.rpcs("cockpit_forms_key_put")
        self.assertEqual(put, [{"p": {"provider": "fathom", "secret": FATHOM_KEY, "savedBy": "server", "state": "connected",
                                      "stateNote": "Saved from the server's api-keys.env.",
                                      "meta": {"users": 4, "adminOk": True, "csFilterOk": True}}}])
        self.assert_wrapped("fathom", "GET", "api.fathom.ai/external/v1/users", 200)
        self.assert_wrapped("fathom", "GET", "api.fathom.ai/external/v1/meetings", 200)

    def test_fathom_refusals_save_nothing(self):
        cases = [
            (("GET", "https://api.fathom.ai/external/v1/users"), (401, {"error": f"invalid {FATHOM_KEY}"}), "fathom refused the key: HTTP 401. Nothing was saved."),
            (("GET", "https://api.fathom.ai/external/v1/users"), (403, {}), "fathom refused the key: HTTP 403. Nothing was saved."),
            (("GET", "https://api.fathom.ai/external/v1/users"), NO_ANSWER, "Fathom could not be reached. Nothing was saved."),
            (("GET", "https://api.fathom.ai/external/v1/meetings"), (500, {}), "fathom refused the Customer Success meetings read: HTTP 500."),
            (("GET", "https://api.fathom.ai/external/v1/meetings"), (200, {"items": [{"recorded_by": {"team": "Customer Success"}}, {"recorded_by": {"team": "Sales"}}]}),
             "Fathom's team filter answered with meetings outside Customer Success, so the key was not saved."),
            (("GET", "https://api.fathom.ai/external/v1/meetings"), (200, {"nothing": True}),
             "Fathom's team filter answered with meetings outside Customer Success, so the key was not saved."),
        ]
        for route, answer, sentence in cases:
            with self.subTest(sentence=sentence):
                self.net = Net()
                self.net.answers[route] = answer
                code, out = self.run_cmd("fathom")
                self.assertEqual(code, 1)
                self.assertIn(sentence, out)
                self.assertEqual(self.net.rpcs("cockpit_forms_key_put"), [])
        # A call that got no answer leaves an unknown receipt.
        self.net = Net()
        self.net.answers[("GET", "https://api.fathom.ai/external/v1/users")] = NO_ANSWER
        self.run_cmd("fathom")
        self.assertEqual([r["phase"] for r in self.net.receipts()], ["intent", "unknown"])

    def test_an_empty_key_on_the_server_makes_no_call(self):
        self.env.write_text("DEEPSEEK_API_KEY=\n")
        for command, name in (("fathom", "FATHOM_API_KEY"), ("deepseek", "DEEPSEEK_API_KEY"), ("register-webhook", "FATHOM_API_KEY")):
            code, out = self.run_cmd(command)
            self.assertEqual(code, 1)
            self.assertIn(f"{name} is empty on this server.", out)
        self.assertEqual(self.net.provider_calls(), [])

    def test_deepseek_saves_only_a_key_that_lists_deepseek_flash(self):
        code, out = self.run_cmd("deepseek")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.strip(), f"deepseek: the key works. Saved, key ending ····{DEEPSEEK_KEY[-4:]}")
        call = self.net.provider_calls()[0]
        self.assertEqual(call["headers"]["authorization"], "Bearer " + DEEPSEEK_KEY)
        self.assertEqual(self.net.rpcs("cockpit_forms_key_put")[0]["p"]["provider"], "deepseek")
        self.assert_wrapped("deepseek", "GET", "api.deepseek.com", 200)
        self.net = Net()
        self.net.answers[("GET", "https://api.deepseek.com/models")] = (200, {"data": [{"id": "deepseek-chat"}]})
        code, out = self.run_cmd("deepseek")
        self.assertEqual(code, 1)
        self.assertIn("DeepSeek does not list deepseek-flash for this key. Nothing was saved.", out)
        self.assertEqual(self.net.rpcs("cockpit_forms_key_put"), [])
        self.net.answers[("GET", "https://api.deepseek.com/models")] = (401, {"error": {"message": f"bad {DEEPSEEK_KEY}"}})
        self.assertIn("deepseek refused the key: HTTP 401. Nothing was saved.", self.run_cmd("deepseek")[1])

    def test_no_call_is_made_when_its_intent_receipt_cannot_be_saved(self):
        self.net.receipt_fails = {"intent"}
        for command in ("fathom", "deepseek", "register-webhook"):
            code, out = self.run_cmd(command)
            self.assertEqual(code, 1)
            self.assertIn("could not be saved, so the call was not made.", out)
        self.net.keys = {"fathom_webhook": webhook_row()}
        code, out = self.run_cmd("unregister-webhook")
        self.assertEqual(code, 1)
        self.assertIn("The receipt for DELETE api.fathom.ai/external/v1/webhooks/:id could not be saved", out)
        self.assertEqual(self.net.provider_calls(), [])
        self.assertEqual(self.net.rpcs("cockpit_forms_key_put") + self.net.rpcs("cockpit_forms_key_mark"), [])

    def test_a_response_receipt_that_cannot_be_saved_is_reported(self):
        self.net.receipt_fails = {"response"}
        code, out = self.run_cmd("deepseek")
        self.assertEqual(code, 1)
        self.assertIn("1 receipt after a provider call could not be saved", out)

    # ------------------------------------------------------------- register-webhook

    def test_register_saves_the_secret_and_prints_only_the_id_ending(self):
        code, out = self.run_cmd("register-webhook")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.strip(), "Webhook registered, id ending 9876.")
        post = self.net.made("https://api.fathom.ai/external/v1/webhooks", "POST")[0]
        self.assertEqual(post["json"], {"destination_url": f"{DB}/functions/v1/fathom-webhook",
                                        "triggered_for": ["shared_team_recordings"], "include_transcript": True,
                                        "include_summary": True, "include_action_items": True,
                                        "include_crm_matches": False})
        self.assertEqual(post["headers"]["x-api-key"], FATHOM_KEY)
        put = self.net.rpcs("cockpit_forms_key_put")[0]["p"]
        self.assertEqual({k: put[k] for k in ("provider", "secret", "savedBy", "state")},
                         {"provider": "fathom_webhook", "secret": WEBHOOK_SECRET, "savedBy": "server", "state": "unchecked"})
        self.assertEqual(put["meta"], {"webhookId": WEBHOOK_ID, "triggeredFor": ["shared_team_recordings"],
                                       "includes": {"transcript": True, "summary": True, "actionItems": True, "crmMatches": False},
                                       "destination": f"{DB}/functions/v1/fathom-webhook", "createdAt": "2026-10-28T09:00:00Z"})
        self.assertEqual(self.net.made("https://api.fathom.ai/external/v1/webhooks/"), [])
        self.assert_wrapped("fathom", "POST", "api.fathom.ai/external/v1/webhooks", 201)

    def test_register_refuses_while_a_webhook_is_registered_and_allows_one_after_unregister(self):
        self.net.keys = {"fathom_webhook": webhook_row()}
        code, out = self.run_cmd("register-webhook")
        self.assertEqual(code, 1)
        self.assertIn("A webhook is already registered (id ending 9876). Run unregister-webhook first.", out)
        self.assertEqual(self.net.provider_calls(), [])
        self.net.keys = {"fathom_webhook": webhook_row(unregisteredAt="2026-10-28T10:00:00Z")}
        self.assertEqual(self.run_cmd("register-webhook")[0], 0)

    def register_failing(self, answer=None, put=None):
        if answer is not None:
            self.net.answers[("POST", "https://api.fathom.ai/external/v1/webhooks")] = answer
        if put is not None:
            self.net.answers[("POST", f"{DB}/rest/v1/rpc/cockpit_forms_key_put")] = put
        return self.run_cmd("register-webhook")

    def test_a_missing_secret_deletes_the_webhook_at_once(self):
        code, out = self.register_failing(answer=(201, {"id": WEBHOOK_ID, "url": "x"}))
        self.assertEqual(code, 1)
        self.assertIn("Fathom answered without the webhook secret. Fathom's answer to deleting the webhook: HTTP 204.", out)
        self.assertNotIn("in Fathom's settings", out)
        delete = self.net.made("https://api.fathom.ai/external/v1/webhooks/", "DELETE")
        self.assertEqual([d["url"] for d in delete], [f"https://api.fathom.ai/external/v1/webhooks/{WEBHOOK_ID}"])
        self.assertEqual(self.net.rpcs("cockpit_forms_key_put"), [])
        self.assert_wrapped("fathom", "DELETE", "api.fathom.ai/external/v1/webhooks/:id", 204)

    def test_a_refused_secret_format_deletes_the_webhook_at_once(self):
        code, out = self.register_failing(answer=(201, {"id": WEBHOOK_ID, "secret": "not-a-webhook-secret"}))
        self.assertEqual(code, 1)
        self.assertIn("The webhook secret was not saved (HTTP 400: That doesn't look like a Fathom webhook key. "
                      "Nothing was changed.). Fathom's answer to deleting the webhook: HTTP 204.", out)
        self.assertNotIn("in Fathom's settings", out)
        self.assertEqual(len(self.net.made("https://api.fathom.ai/external/v1/webhooks/", "DELETE")), 1)

    def test_an_rpc_failure_deletes_the_webhook_at_once(self):
        for put, said in (((500, {"message": f"database fault near {WEBHOOK_SECRET}"}), "HTTP 500: database fault near [key]"),
                          (NO_ANSWER, "the database did not answer")):
            with self.subTest(said=said):
                self.net = Net()
                code, out = self.register_failing(put=put)
                self.assertEqual(code, 1)
                self.assertIn(f"The webhook secret was not saved ({said}). Fathom's answer to deleting the webhook: HTTP 204.", out)
                self.assertNotIn("in Fathom's settings", out)
                self.assertEqual(len(self.net.made("https://api.fathom.ai/external/v1/webhooks/", "DELETE")), 1)

    def test_the_ceo_sentence_only_when_the_delete_fails_too(self):
        sentence = "Delete the webhook ending 9876 in Fathom's settings, then run this again."
        for delete, said in (((500, {}), "HTTP 500"), (NO_ANSWER, "no answer"), ((404, {}), "HTTP 404")):
            with self.subTest(said=said):
                self.net = Net()
                self.net.answers[("DELETE", "https://api.fathom.ai/external/v1/webhooks/")] = delete
                code, out = self.register_failing(put=(500, {"message": "database fault"}))
                self.assertEqual(code, 1)
                self.assertIn(f"Fathom's answer to deleting the webhook: {said}.", out)
                if said == "HTTP 404":
                    self.assertNotIn(sentence, out)   # already gone: nothing is left to delete
                else:
                    self.assertIn(sentence, out)
        # The delete's own intent receipt cannot be saved: the delete is never sent, so the CEO deletes it.
        self.net = Net()
        real = self.net.route

        def no_second_intent(method, url, headers, body, data, seen={"intent": 0}):
            if url == f"{DB}/rest/v1/cockpit_csm_provider_health" and body["phase"] == "intent":
                seen["intent"] += 1
                if seen["intent"] == 2:
                    return 400, {"message": "refused"}
            return real(method, url, headers, body, data)

        self.net.route = no_second_intent
        code, out = self.register_failing(put=(500, {"message": "database fault"}))
        self.assertEqual(code, 1)
        self.assertIn("not sent, because its receipt could not be saved", out)
        self.assertIn(sentence, out)
        self.assertEqual(self.net.made("https://api.fathom.ai/external/v1/webhooks/", "DELETE"), [])

    def test_an_answer_without_an_id_has_nothing_to_delete(self):
        code, out = self.register_failing(answer=(201, {"secret": WEBHOOK_SECRET}))
        self.assertEqual(code, 1)
        self.assertIn("Fathom answered without the webhook id. Check Fathom's settings for a new webhook to this function.", out)
        self.assertEqual(self.net.made("https://api.fathom.ai/external/v1/webhooks/", "DELETE"), [])
        self.assertEqual(self.net.rpcs("cockpit_forms_key_put"), [])

    def test_a_refused_registration_saves_and_deletes_nothing(self):
        code, out = self.register_failing(answer=(400, {"error": "bad destination"}))
        self.assertEqual(code, 1)
        self.assertIn("Fathom refused the webhook: HTTP 400. Nothing was registered.", out)
        self.assertEqual(self.net.rpcs("cockpit_forms_key_put"), [])
        self.assertEqual(self.net.made("https://api.fathom.ai/external/v1/webhooks/", "DELETE"), [])

    # ------------------------------------------------------------- probe-webhook

    def test_probe_sends_a_wrong_and_a_signed_delivery_then_marks_connected(self):
        self.net.keys = {"fathom_webhook": webhook_row()}
        code, out = self.run_cmd("probe-webhook")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.splitlines(), [
            "Wrong signature: HTTP 401 (expected HTTP 401).",
            "Signed Probe delivery: HTTP 200 (expected HTTP 200), delivery ignored (expected ignored).",
            "The webhook key is marked connected.",
        ])
        wrong, signed = self.net.made(f"{DB}/functions/v1/fathom-webhook")
        for d in (wrong, signed):
            self.assertNotIn("authorization", d["headers"])
            self.assertNotIn("apikey", d["headers"])
            self.assertEqual(json.loads(d["raw"])["recorded_by"]["team"], "Probe")
            self.assertTrue(d["headers"]["webhook-id"].startswith("probe_"))
        self.assertEqual(self.net.rpcs("cockpit_forms_key_mark"), [{"p": {
            "provider": "fathom_webhook", "state": "connected", "savedAt": SAVED_AT,
            "note": "Probed from the server: a wrong signature is refused and a signed delivery is recorded."}}])
        self.assertEqual(self.net.receipts(), [])

    def test_a_failed_probe_marks_nothing(self):
        self.net.keys = {"fathom_webhook": webhook_row()}
        self.net.answers[("POST", f"{DB}/functions/v1/fathom-webhook")] = (503, {"ok": False})
        code, out = self.run_cmd("probe-webhook")
        self.assertEqual(code, 1)
        self.assertIn("Signed Probe delivery: HTTP 503 (expected HTTP 200), delivery not found (expected ignored).", out)
        self.assertIn("The webhook probe did not pass, so the webhook key was not marked connected.", out)
        self.assertEqual(self.net.rpcs("cockpit_forms_key_mark"), [])
        self.net.keys = {}
        code, out = self.run_cmd("probe-webhook")
        self.assertEqual(code, 1)
        self.assertIn("No webhook secret is saved. Run register-webhook first.", out)

    def test_the_signer_matches_the_standard_webhooks_example(self):
        secret = "_".join(["whsec", "MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"])
        self.assertEqual(fk.sign(secret, "msg_p5jXN8AQM9LWM0D4loKWxJek", "1614265330", '{"test": 2432232314}'),
                         "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=")

    # ------------------------------------------------------------- unregister-webhook

    def test_unregister_deletes_then_marks_with_unregistered_at(self):
        self.net.keys = {"fathom_webhook": webhook_row()}
        code, out = self.run_cmd("unregister-webhook")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.splitlines(), ["Fathom's answer to deleting the webhook: HTTP 204.", "Webhook ending 9876 unregistered."])
        delete = self.net.made("https://api.fathom.ai/external/v1/webhooks/", "DELETE")[0]
        self.assertEqual(delete["url"], f"https://api.fathom.ai/external/v1/webhooks/{WEBHOOK_ID}")
        self.assertEqual(delete["headers"]["x-api-key"], FATHOM_KEY)
        mark = self.net.rpcs("cockpit_forms_key_mark")[0]["p"]
        self.assertEqual({k: mark[k] for k in ("provider", "state", "note", "savedAt")},
                         {"provider": "fathom_webhook", "state": "refused", "note": "Unregistered by the build session.", "savedAt": SAVED_AT})
        self.assertRegex(mark["meta"]["unregisteredAt"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        self.assertEqual(list(mark["meta"]), ["unregisteredAt"])
        self.assert_wrapped("fathom", "DELETE", "api.fathom.ai/external/v1/webhooks/:id", 204)

    def test_a_404_counts_as_already_gone_and_is_still_marked(self):
        self.net.keys = {"fathom_webhook": webhook_row()}
        self.net.answers[("DELETE", "https://api.fathom.ai/external/v1/webhooks/")] = (404, {"error": "not found"})
        code, out = self.run_cmd("unregister-webhook")
        self.assertEqual(code, 0, out)
        self.assertIn("HTTP 404 (already gone).", out)
        self.assertEqual(len(self.net.rpcs("cockpit_forms_key_mark")), 1)

    def test_unregister_marks_nothing_while_fathom_keeps_the_webhook(self):
        self.net.keys = {"fathom_webhook": webhook_row()}
        for answer, said in (((500, {}), "HTTP 500"), (NO_ANSWER, "no answer")):
            self.net.answers[("DELETE", "https://api.fathom.ai/external/v1/webhooks/")] = answer
            code, out = self.run_cmd("unregister-webhook")
            self.assertEqual(code, 1)
            self.assertIn(f"Fathom's answer to deleting the webhook: {said}.", out)
            self.assertIn("Fathom did not delete the webhook, so the registration was not marked off.", out)
        self.assertEqual(self.net.rpcs("cockpit_forms_key_mark"), [])

    def test_a_mark_that_loses_its_race_says_so(self):
        self.net.keys = {"fathom_webhook": webhook_row()}
        self.net.answers[("POST", f"{DB}/rest/v1/rpc/cockpit_forms_key_mark")] = (200, {"ok": False, "note": "The key changed during the check"})
        code, out = self.run_cmd("unregister-webhook")
        self.assertEqual(code, 1)
        self.assertIn("Fathom deleted the webhook, but the registration was not marked off (The key changed during the check). "
                      "Run unregister-webhook again.", out)

    def test_unregister_with_nothing_registered_or_already_off(self):
        code, out = self.run_cmd("unregister-webhook")
        self.assertEqual(code, 1)
        self.assertIn("No webhook is registered, so there is nothing to delete.", out)
        self.net.keys = {"fathom_webhook": webhook_row(unregisteredAt="2026-10-28T10:00:00Z")}
        code, out = self.run_cmd("unregister-webhook")
        self.assertEqual(code, 0)
        self.assertIn("The webhook ending 9876 was already unregistered at 2026-10-28 13:00 Kuwait time.", out)
        self.assertEqual(self.net.provider_calls(), [])

    # ------------------------------------------------------------- the door itself

    def test_every_message_hides_the_keys(self):
        fk_run = fk.Run(DB, SERVICE_KEY)
        fk_run.hide(FATHOM_KEY, "short")
        text = fk_run.redact(f"{SERVICE_KEY} {FATHOM_KEY} {WEBHOOK_SECRET} sk-ant-{'x' * 24} sb_secret_{'y' * 20} short")
        self.assertEqual(text, "[key] [key] [key] [key] [key] short")
        self.net.answers[("POST", f"{DB}/rest/v1/rpc/cockpit_forms_key_put")] = (400, {"message": f"no: {FATHOM_KEY}"})
        code, out = self.run_cmd("fathom")
        self.assertEqual(code, 1)
        self.assertIn("The key was not saved (HTTP 400: no: [key]).", out)

    def test_an_unexpected_error_prints_one_hidden_line(self):
        with mock.patch.dict(fk.COMMANDS, {"status": mock.Mock(side_effect=RuntimeError(f"boom {SERVICE_KEY}"))}):
            code, out = self.run_cmd("status")
        self.assertEqual(code, 1)
        self.assertEqual(out.strip(), "status stopped: RuntimeError: boom [key]")

    def test_an_unknown_command_names_the_commands(self):
        code, out = self.run_cmd("rotate")
        self.assertEqual(code, 2)
        self.assertIn("status, doctor, fathom, deepseek, register-webhook, probe-webhook, unregister-webhook", out)
        self.assertEqual(self.net.requests, [])

    def test_the_runtime_file_must_hold_the_service_key(self):
        (self.tmp / "state" / "runtime-86eebpf1.json").write_text(json.dumps({"SUPABASE_URL": DB}))
        code, out = self.run_cmd("status")
        self.assertEqual(code, 1)
        self.assertIn("The native runtime file has no SUPABASE_SERVICE_ROLE_KEY.", out)
        self.assertEqual(self.net.requests, [])

    # ------------------------------------------------------------- the kickoff form's Typeform webhook (2b, 4.8)

    def kickoff_row(self, **meta):
        return {"provider": "typeform_kickoff", "secret": KICKOFF_SECRET, "last4": KICKOFF_SECRET[-4:], "state": "unchecked",
                "savedAt": SAVED_AT, "meta": {"form": "kickoff", "tag": "cockpit", **meta}}

    def test_a_form_other_than_kickoff_exits_2_before_anything_is_read(self):
        for args in (("typeform-secret", "checkin"), ("register-typeform", "blueprint"), ("probe-typeform", "KICKOFF"),
                     ("unregister-typeform", "onboarding"), ("register-typeform",)):
            code, out = self.run_cmd(*args)
            self.assertEqual(code, 2)
            self.assertEqual(out.strip(), "Only the kickoff form has a cockpit webhook in 2b.")
        self.assertEqual(self.net.requests, [])

    def test_typeform_secret_saves_32_random_bytes_and_never_prints_them(self):
        code, out = self.run_cmd("typeform-secret", "kickoff")
        self.assertEqual(code, 0, out)
        [put] = self.net.rpcs("cockpit_forms_key_put")
        p = put["p"]
        self.assertEqual((p["provider"], p["savedBy"], p["state"], p["meta"]), ("typeform_kickoff", "server", "unchecked",
                                                                              {"form": "kickoff", "tag": "cockpit"}))
        self.assertRegex(p["secret"], r"^[A-Za-z0-9_-]{43}$")
        self.assertEqual(len(base64.urlsafe_b64decode(p["secret"] + "=")), 32)
        self.assertNotIn(p["secret"], out)
        self.assertIn(f"a new signing key is saved, ending ····{p['secret'][-4:]}.", out)
        self.assertIn("Next: register-typeform kickoff.", out)
        self.assertEqual(self.net.provider_calls(), [])
        # A second key differs.
        self.run_cmd("typeform-secret", "kickoff")
        self.assertNotEqual(self.net.rpcs("cockpit_forms_key_put")[1]["p"]["secret"], p["secret"])

    def test_typeform_secret_refuses_while_the_webhook_is_registered(self):
        self.net.keys["typeform_kickoff"] = self.kickoff_row(webhookId="01HCOCKPITHOOK")
        code, out = self.run_cmd("typeform-secret", "kickoff")
        self.assertEqual(code, 1)
        self.assertIn("Run unregister-typeform kickoff first", out)
        self.assertEqual(self.net.rpcs("cockpit_forms_key_put"), [])

    def test_register_typeform_puts_the_cockpit_webhook_reads_it_back_and_marks_connected(self):
        self.net.keys["typeform_kickoff"] = self.kickoff_row()
        code, out = self.run_cmd("register-typeform", "kickoff")
        self.assertEqual(code, 0, out)
        [put] = self.net.made("https://api.typeform.com/forms/tG7dnxBn/webhooks/cockpit", "PUT")
        self.assertEqual(put["json"], {"url": f"{DB}/functions/v1/forms-door/typeform/kickoff", "enabled": True,
                                       "secret": KICKOFF_SECRET, "verify_ssl": True, "event_types": {"form_response": True}})
        self.assertEqual([r["method"] for r in self.net.provider_calls()], ["GET", "PUT", "GET"])
        self.assert_wrapped("typeform", "GET", "api.typeform.com/forms/:id/webhooks", 200)
        self.assert_wrapped("typeform", "PUT", "api.typeform.com/forms/:id/webhooks/:tag", 200)
        [mark] = self.net.rpcs("cockpit_forms_key_mark")
        self.assertEqual(mark["p"]["provider"], "typeform_kickoff")
        self.assertEqual(mark["p"]["state"], "connected")
        self.assertEqual(mark["p"]["savedAt"], SAVED_AT)
        self.assertEqual({k: mark["p"]["meta"][k] for k in ("webhookId", "tag", "formId", "unregisteredAt")},
                         {"webhookId": "01HCOCKPITHOOK", "tag": "cockpit", "formId": "tG7dnxBn", "unregisteredAt": None})
        # Make's webhook is untouched.
        self.assertIn({"id": "01HMAKEHOOK", "form_id": "tG7dnxBn", "tag": "WHTP3992232", "url": "https://hook.eu1.make.com/invented",
                       "enabled": True, "verify_ssl": True}, self.net.hooks)
        self.assertIn("Typeform webhook cockpit registered on tG7dnxBn, read back enabled; 1 other webhook of the form unchanged.", out)

    def test_register_typeform_needs_a_saved_key_and_a_typeform_form(self):
        code, out = self.run_cmd("register-typeform", "kickoff")
        self.assertEqual(code, 1)
        self.assertIn("No signing key is saved for the kickoff form. Run typeform-secret kickoff first.", out)
        self.net.keys["typeform_kickoff"] = self.kickoff_row()
        self.net.registry = [{"provider": "native", "typeform_id": None}]
        code, out = self.run_cmd("register-typeform", "kickoff")
        self.assertEqual(code, 1)
        self.assertIn("The kickoff form is no longer filled in Typeform", out)
        self.assertEqual(self.net.provider_calls(), [])

    def test_a_refused_put_marks_nothing_and_a_missing_read_back_marks_nothing(self):
        self.net.keys["typeform_kickoff"] = self.kickoff_row()
        self.net.answers[("PUT", "https://api.typeform.com/forms/tG7dnxBn/webhooks/cockpit")] = (403, {"code": "FORBIDDEN"})
        code, out = self.run_cmd("register-typeform", "kickoff")
        self.assertEqual(code, 1)
        self.assertIn("typeform refused the webhook: HTTP 403. Nothing was registered.", out)
        self.assertEqual(self.net.rpcs("cockpit_forms_key_mark"), [])
        del self.net.answers[("PUT", "https://api.typeform.com/forms/tG7dnxBn/webhooks/cockpit")]
        self.net.answers[("PUT", "https://api.typeform.com/forms/tG7dnxBn/webhooks/cockpit")] = (200, {"id": "x"})
        code, out = self.run_cmd("register-typeform", "kickoff")
        self.assertEqual(code, 1)
        self.assertIn("does not show the cockpit webhook enabled", out)
        self.assertEqual(self.net.rpcs("cockpit_forms_key_mark"), [])

    # A write that has gone stands whatever the read after it does, so the read's failure never says nothing changed.
    READ_BACK_FAILURES = (((500, {"code": "DOWN"}), "typeform refused the webhooks read: HTTP 500. "),
                          (NO_ANSWER, "Typeform did not answer the webhooks read. "),
                          ((200, {"unexpected": True}), "Typeform answered the webhooks read without a list. "))

    def assert_read_back_stop(self, command, write, wrote_sentence, want_reason):
        code, out = self.run_cmd(command, "kickoff")
        self.assertEqual(code, 1, out)
        self.assertIn(want_reason + wrote_sentence, out)
        self.assertNotIn("Nothing was changed", out)
        self.assertEqual(len(self.net.made("https://api.typeform.com/forms/tG7dnxBn/webhooks/cockpit", write)), 1)
        self.assertEqual(self.net.rpcs("cockpit_forms_key_mark"), [])

    PUT_NOT_READ = ("The webhook was put on Typeform but could not be read back, so the key was not marked connected. "
                    "Read the kickoff form's webhooks in Typeform, then run register-typeform kickoff again.")
    DELETE_NOT_READ = ("The webhook was deleted on Typeform but could not be read back, so the registration was not marked off. "
                       "Read the kickoff form's webhooks in Typeform, then run unregister-typeform kickoff again.")

    def cockpit_hook_on_typeform(self):
        self.net.keys["typeform_kickoff"] = self.kickoff_row(webhookId="01HCOCKPITHOOK", formId="tG7dnxBn")
        self.net.hooks.append({"id": "01HCOCKPITHOOK", "form_id": "tG7dnxBn", "tag": "cockpit",
                               "url": f"{DB}/functions/v1/forms-door/typeform/kickoff", "enabled": True})

    def test_a_failed_read_back_after_the_put_says_the_webhook_is_on_typeform(self):
        for answer, reason in self.READ_BACK_FAILURES:
            with self.subTest(reason):
                self.net = Net()
                self.net.keys["typeform_kickoff"] = self.kickoff_row()
                self.net.read_back = answer
                self.assert_read_back_stop("register-typeform", "PUT", self.PUT_NOT_READ, reason)
                self.assertEqual(self.net.hooks[-1]["tag"], "cockpit")

    def test_a_failed_read_back_after_the_delete_says_the_webhook_was_deleted(self):
        for answer, reason in self.READ_BACK_FAILURES:
            with self.subTest(reason):
                self.net = Net()
                self.cockpit_hook_on_typeform()
                self.net.read_back = answer
                self.assert_read_back_stop("unregister-typeform", "DELETE", self.DELETE_NOT_READ, reason)
                self.assertEqual([h["tag"] for h in self.net.hooks], ["WHTP3992232"])

    def test_a_read_back_refused_its_receipt_is_not_made_and_still_says_what_the_write_did(self):
        reason = "The receipt for GET api.typeform.com/forms/:id/webhooks could not be saved, so the call was not made. "
        self.net.keys["typeform_kickoff"] = self.kickoff_row()
        self.net.read_back_no_receipt = True
        self.assert_read_back_stop("register-typeform", "PUT", self.PUT_NOT_READ, reason)
        self.assertEqual([r["method"] for r in self.net.provider_calls()], ["GET", "PUT"])
        self.net = Net()
        self.cockpit_hook_on_typeform()
        self.net.read_back_no_receipt = True
        self.assert_read_back_stop("unregister-typeform", "DELETE", self.DELETE_NOT_READ, reason)
        self.assertEqual([r["method"] for r in self.net.provider_calls()], ["GET", "DELETE"])

    def test_a_failed_read_before_any_write_still_says_nothing_was_changed(self):
        read = ("GET", "https://api.typeform.com/forms/tG7dnxBn/webhooks")
        self.net.keys["typeform_kickoff"] = self.kickoff_row(webhookId="01HCOCKPITHOOK", formId="tG7dnxBn")
        for command in ("register-typeform", "unregister-typeform"):
            for answer, reason in self.READ_BACK_FAILURES:
                with self.subTest(command=command, reason=reason):
                    self.net.requests.clear()
                    self.net.answers[read] = answer
                    code, out = self.run_cmd(command, "kickoff")
                    self.assertEqual(code, 1, out)
                    self.assertIn(reason + "Nothing was changed.", out)
                    self.assertEqual([r["method"] for r in self.net.provider_calls()], ["GET"])

    def test_probe_typeform_sends_an_unsigned_and_a_signed_probe(self):
        self.net.keys["typeform_kickoff"] = self.kickoff_row()
        code, out = self.run_cmd("probe-typeform", "kickoff")
        self.assertEqual(code, 0, out)
        unsigned, signed = self.net.made(f"{DB}/functions/v1/forms-door/typeform/kickoff")
        self.assertNotIn("typeform-signature", unsigned["headers"])
        self.assertEqual(signed["headers"]["x-forms-door-probe"], "1")
        self.assertIn("Unsigned probe: HTTP 401 (expected HTTP 401).", out)
        self.assertIn("Signed probe: HTTP 200 with the probe answer (expected HTTP 200).", out)
        # Our own function: no receipt, and no provider call.
        self.assertEqual(self.net.receipts(), [])
        self.net.keys["typeform_kickoff"] = {**self.kickoff_row(), "secret": KICKOFF_SECRET[::-1]}
        self.net.answers[("POST", f"{DB}/functions/v1/forms-door/typeform/kickoff")] = (401, {"ok": False})
        code, out = self.run_cmd("probe-typeform", "kickoff")
        self.assertEqual(code, 1)
        self.assertIn("The forms-door probe did not pass.", out)

    def test_typeform_signer_matches_the_door(self):
        body = '{"event_type":"probe"}'
        want = "sha256=" + base64.b64encode(hmac.new(b"key-for-tests-0123456789", body.encode(), hashlib.sha256).digest()).decode()
        self.assertEqual(fk.typeform_sign("key-for-tests-0123456789", body), want)

    def test_unregister_typeform_deletes_reads_back_and_marks_off(self):
        self.net.keys["typeform_kickoff"] = self.kickoff_row(webhookId="01HCOCKPITHOOK")
        self.net.hooks.append({"id": "01HCOCKPITHOOK", "form_id": "tG7dnxBn", "tag": "cockpit",
                               "url": f"{DB}/functions/v1/forms-door/typeform/kickoff", "enabled": True})
        code, out = self.run_cmd("unregister-typeform", "kickoff")
        self.assertEqual(code, 0, out)
        self.assertEqual([r["method"] for r in self.net.provider_calls()], ["GET", "DELETE", "GET"])
        self.assert_wrapped("typeform", "DELETE", "api.typeform.com/forms/:id/webhooks/:tag", 204)
        self.assertEqual([h["tag"] for h in self.net.hooks], ["WHTP3992232"])
        [mark] = self.net.rpcs("cockpit_forms_key_mark")
        self.assertEqual((mark["p"]["provider"], mark["p"]["state"], mark["p"]["savedAt"]), ("typeform_kickoff", "refused", SAVED_AT))
        self.assertIn("unregisteredAt", mark["p"]["meta"])
        self.assertIn("The cockpit webhook of the kickoff form is unregistered.", out)

    def test_unregister_typeform_with_nothing_registered_changes_nothing(self):
        code, out = self.run_cmd("unregister-typeform", "kickoff")
        self.assertEqual(code, 0)
        self.assertIn("No cockpit webhook is registered on the kickoff form, so there is nothing to delete.", out)
        self.assertEqual([r["method"] for r in self.net.provider_calls()], ["GET"])
        self.assertEqual(self.net.rpcs("cockpit_forms_key_mark"), [])

    def test_unregister_typeform_removes_the_webhook_after_the_form_has_left_typeform(self):
        self.cockpit_hook_on_typeform()
        self.net.registry = [{"provider": "native", "typeform_id": None}]
        code, out = self.run_cmd("unregister-typeform", "kickoff")
        self.assertEqual(code, 0, out)
        self.assertNotIn("no longer filled in Typeform", out)
        self.assertEqual([r["method"] for r in self.net.provider_calls()], ["GET", "DELETE", "GET"])
        self.assertEqual([h["tag"] for h in self.net.hooks], ["WHTP3992232"])
        self.assertEqual(self.net.made(f"{DB}/rest/v1/cockpit_forms?"), [])
        [mark] = self.net.rpcs("cockpit_forms_key_mark")
        self.assertEqual(mark["p"]["state"], "refused")
        self.assertIn("The cockpit webhook of the kickoff form is unregistered.", out)

    def test_unregister_typeform_works_from_the_key_when_the_registry_cannot_be_read(self):
        self.cockpit_hook_on_typeform()
        self.net.answers[("GET", f"{DB}/rest/v1/cockpit_forms?")] = (500, {"message": "down"})
        code, out = self.run_cmd("unregister-typeform", "kickoff")
        self.assertEqual(code, 0, out)
        self.assertEqual(len(self.net.made("https://api.typeform.com/forms/tG7dnxBn/webhooks/cockpit", "DELETE")), 1)

    def test_unregister_typeform_prefers_the_form_the_key_saved_over_the_registry(self):
        # The fake Typeform knows only tG7dnxBn, so a request to the registry's newer id would fail this test.
        self.cockpit_hook_on_typeform()
        self.net.registry = [{"provider": "typeform", "typeform_id": "NewForm99"}]
        code, out = self.run_cmd("unregister-typeform", "kickoff")
        self.assertEqual(code, 0, out)
        self.assertEqual([h["tag"] for h in self.net.hooks], ["WHTP3992232"])

    def test_unregister_typeform_falls_back_to_the_registry_id_whatever_the_provider(self):
        # A failed read-back leaves a live webhook on a key that saved no form id; the row may have moved since.
        for meta in ({}, {"formId": "../../other"}):
            for provider in ("typeform", "native"):
                with self.subTest(meta=meta, provider=provider):
                    self.net = Net()
                    self.net.keys["typeform_kickoff"] = self.kickoff_row(webhookId="01HCOCKPITHOOK", **meta)
                    self.net.registry = [{"provider": provider, "typeform_id": "tG7dnxBn"}]
                    self.net.hooks.append({"id": "01HCOCKPITHOOK", "form_id": "tG7dnxBn", "tag": "cockpit",
                                           "url": f"{DB}/functions/v1/forms-door/typeform/kickoff", "enabled": True})
                    code, out = self.run_cmd("unregister-typeform", "kickoff")
                    self.assertEqual(code, 0, out)
                    self.assertEqual([h["tag"] for h in self.net.hooks], ["WHTP3992232"])

    def test_unregister_typeform_with_no_form_id_anywhere_says_where_to_go(self):
        self.net.keys["typeform_kickoff"] = self.kickoff_row(webhookId="01HCOCKPITHOOK")
        self.net.registry = [{"provider": "native", "typeform_id": None}]
        code, out = self.run_cmd("unregister-typeform", "kickoff")
        self.assertEqual(code, 1)
        self.assertIn("Neither the kickoff signing key nor the forms registry names a Typeform form. Nothing was changed.", out)
        self.assertEqual(self.net.provider_calls(), [])
        self.assertEqual(self.net.rpcs("cockpit_forms_key_mark"), [])

    def test_status_lists_the_typeform_key_last_4_only_with_its_last_delivery(self):
        self.net.keys["typeform_kickoff"] = {**self.kickoff_row(webhookId="01HCOCKPITHOOK"), "state": "connected"}
        self.net.door_status = {"registered": True, "lastDelivery": "2026-10-29T06:00:00Z", "outcome": "recorded"}
        code, out = self.run_cmd("status")
        self.assertEqual(code, 0)
        self.assertEqual(out.splitlines()[-1], f"typeform kickoff: connected, key ending ····{KICKOFF_SECRET[-4:]}, saved "
                                               "2026-10-27 12:00 Kuwait time, registered, last delivery 2026-10-29 09:00 "
                                               "Kuwait time (recorded)")

    def test_status_says_when_the_kickoff_sync_row_could_not_be_read_never_no_delivery_yet(self):
        self.net.keys["typeform_kickoff"] = {**self.kickoff_row(webhookId="01HCOCKPITHOOK"), "state": "connected"}
        self.net.door_status = {"registered": True, "lastDelivery": "2026-10-29T06:00:00Z", "outcome": "recorded"}
        for answer, why in (((500, {"message": "refused"}), "HTTP 500"), (NO_ANSWER, "no answer"),
                            ((200, "not json"), "an answer that was not JSON"), ((200, {"detail": {}}), "an answer without a list")):
            with self.subTest(why=why):
                self.net.answers = {("GET", f"{DB}/rest/v1/cockpit_sync_state?"): answer}
                code, out = self.run_cmd("status")
                self.assertEqual(code, 1)
                last = out.splitlines()[-1]
                self.assertTrue(last.endswith(f", registered, its last delivery could not be read ({why})"), last)
                self.assertNotIn("no delivery yet", out)
                self.assertNotIn(KICKOFF_SECRET, out)

    def test_status_reads_no_sync_row_as_no_delivery_yet(self):
        self.net.keys["typeform_kickoff"] = {**self.kickoff_row(), "state": "unchecked"}
        code, out = self.run_cmd("status")
        self.assertEqual(code, 0)
        self.assertTrue(out.splitlines()[-1].endswith(", not registered, no delivery yet"), out)

    def test_kuwait_time_reads_the_database_forms(self):
        for value, want in (("2026-10-27T21:30:00Z", "2026-10-28 00:30 Kuwait time"),
                            ("2026-10-27 21:30:00.1+00", "2026-10-28 00:30 Kuwait time"),
                            ("2026-10-28T00:30:00+03:00", "2026-10-28 00:30 Kuwait time"),
                            (None, "an unknown time"), ("yesterday", "an unknown time")):
            self.assertEqual(fk.kuwait(value), want)


if __name__ == "__main__":
    unittest.main()
