"""Tests for cockpit_agent.py (docs/forms/WAVE56-CONTRACT.md 3.4). Run:
    python3 -m unittest viktor-side-scripts/billing-agent/test_cockpit_agent.py
No network: the door is a stand-in opener. Every key here is invented."""
import contextlib
import io
import json
import os
import sys
import unittest
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cockpit_agent as ca  # noqa: E402

KEY = "mak_" + "K" * 20 + "-_" + "x" * 21
ENV = {"MAHARA_AGENT_KEY": KEY, "COCKPIT_URL": "https://abc.supabase.test"}


class FakeResponse:
    def __init__(self, status, body):
        self.status = status
        self._body = body.encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeDoor:
    """Records each request; answers with the queued (status, body) pairs."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.requests = []

    def __call__(self, req, timeout=None):
        self.requests.append({"url": req.full_url, "method": req.get_method(), "headers": dict(req.header_items()),
                              "body": json.loads(req.data.decode("utf-8")), "timeout": timeout})
        status, body = self.answers.pop(0)
        if isinstance(status, Exception):
            raise status
        text = json.dumps(body)
        if status != 200:
            raise urllib.error.HTTPError(req.full_url, status, "refused", {}, io.BytesIO(text.encode("utf-8")))
        return FakeResponse(status, text)


class DoorTest(unittest.TestCase):
    def test_a_redirect_is_refused_and_never_followed_with_the_key(self):
        fake = FakeDoor((302, {"ok": False}))
        with self.assertRaises(ca.Refused) as ctx:
            ca.read("ladder", environ=ENV, opener=fake)
        self.assertEqual(str(ctx.exception), "The cockpit's door answered with a redirect; check COCKPIT_URL.")
        self.assertEqual(len(fake.requests), 1)
        # The default opener follows no redirect at all.
        handler = next(h for h in ca._OPENER.handlers if isinstance(h, ca.urllib.request.HTTPRedirectHandler))
        self.assertIsNone(handler.redirect_request(None, None, 302, "Found", {}, "https://elsewhere.test/"))

    def test_a_write_posts_the_op_with_the_key_a_request_id_and_a_15_second_timeout(self):
        fake = FakeDoor((200, {"ok": True, "outcome": "ok", "result": {"eventId": 7}}))
        out = ca.door("chase", {"taskId": "86ab", "step": "D+3"}, environ=ENV, opener=fake)
        self.assertEqual(out["result"], {"eventId": 7})
        r = fake.requests[0]
        self.assertEqual(r["url"], "https://abc.supabase.test/functions/v1/billing-agent")
        self.assertEqual(r["method"], "POST")
        self.assertEqual(r["headers"]["Authorization"], f"Bearer {KEY}")
        self.assertEqual(r["timeout"], 15)
        self.assertEqual(r["body"]["op"], "chase")
        self.assertEqual(r["body"]["body"], {"taskId": "86ab", "step": "D+3"})
        self.assertRegex(r["body"]["requestId"], r"^[0-9a-f-]{36}$")
        # The key travels only in the header, never in the body.
        self.assertNotIn(KEY, json.dumps(r["body"]))

    def test_each_call_gets_its_own_request_id_and_a_retry_can_reuse_one(self):
        fake = FakeDoor(*[(200, {"ok": True, "outcome": "ok", "result": {}})] * 3)
        ca.door("note", {"taskId": "t", "text": "hi"}, environ=ENV, opener=fake)
        ca.door("note", {"taskId": "t", "text": "hi"}, environ=ENV, opener=fake)
        ca.door("note", {"taskId": "t", "text": "hi"}, request_id="11111111-2222-4333-8444-555555555555", environ=ENV, opener=fake)
        ids = [r["body"]["requestId"] for r in fake.requests]
        self.assertNotEqual(ids[0], ids[1])
        self.assertEqual(ids[2], "11111111-2222-4333-8444-555555555555")

    def test_a_refusal_raises_the_cockpits_sentence_unchanged(self):
        sentence = "A bank transfer needs its receipt link and the bank reference. Without them it counts as unpaid."
        fake = FakeDoor((422, {"ok": False, "outcome": "refused", "error": sentence}))
        with self.assertRaises(ca.Refused) as e:
            ca.door("payment", {"taskId": "t"}, environ=ENV, opener=fake)
        self.assertEqual(str(e.exception), sentence)
        self.assertEqual((e.exception.status, e.exception.outcome), (422, "refused"))
        fake = FakeDoor((429, {"ok": False, "outcome": "limited", "error": "That is 60 calls in a minute. Wait a minute and try again."}))
        with self.assertRaises(ca.Refused) as e:
            ca.read("inbox", environ=ENV, opener=fake)
        self.assertEqual(e.exception.status, 429)

    def test_a_read_returns_its_result_and_only_known_ops_and_reads_go_out(self):
        fake = FakeDoor((200, {"ok": True, "outcome": "ok", "result": [{"taskId": "t", "kind": "chase", "step": "D+3"}]}))
        self.assertEqual(ca.read("chases", environ=ENV, opener=fake), [{"taskId": "t", "kind": "chase", "step": "D+3"}])
        self.assertEqual(fake.requests[0]["body"]["what"], "chases")
        with self.assertRaises(ValueError):
            ca.door("ltv", {"taskId": "t"}, environ=ENV, opener=fake)
        with self.assertRaises(ValueError):
            ca.read("secrets", environ=ENV, opener=fake)
        self.assertEqual(len(fake.requests), 1)

    def test_no_answer_is_a_plain_sentence_never_the_key(self):
        fake = FakeDoor((urllib.error.URLError("timed out"), None))
        with self.assertRaises(ca.Refused) as e:
            ca.read("ladder", environ=ENV, opener=fake)
        self.assertIn("did not answer", str(e.exception))
        self.assertNotIn(KEY, str(e.exception))


class SetUpTest(unittest.TestCase):
    def test_a_missing_or_malformed_key_or_address_is_refused_before_any_call(self):
        fake = FakeDoor()
        for env in ({"COCKPIT_URL": ENV["COCKPIT_URL"]}, {**ENV, "MAHARA_AGENT_KEY": "sk_live_not_an_agent_key"},
                    {"MAHARA_AGENT_KEY": KEY}, {**ENV, "COCKPIT_URL": "http://abc.supabase.test"}):
            with self.assertRaises(ca.NotSetUp) as e:
                ca.read("ladder", environ=env, opener=fake)
            self.assertNotIn("sk_live", str(e.exception))
        self.assertEqual(fake.requests, [])


class DoctorTest(unittest.TestCase):
    def run_doctor(self, env, fake):
        out = io.StringIO()
        err = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = ca.doctor(environ=env, opener=fake, out=out)
        return code, out.getvalue() + err.getvalue()

    def test_ready_key_door_and_ladder_and_never_the_key(self):
        code, text = self.run_doctor(ENV, FakeDoor((200, {"ok": True, "outcome": "ok", "result": {"pauseReviewDay": 4, "cancelReviewDay": 15}})))
        self.assertEqual(code, 0)
        self.assertIn("Key: set.", text)
        self.assertIn("Door: ok. Ladder: pause review on day 4, cancel review on day 15.", text)
        self.assertNotIn(KEY, text)
        self.assertNotIn(KEY[4:20], text)

    def test_it_fails_without_the_key_and_makes_no_call(self):
        fake = FakeDoor()
        code, text = self.run_doctor({"COCKPIT_URL": ENV["COCKPIT_URL"]}, fake)
        self.assertEqual(code, 1)
        self.assertIn("MAHARA_AGENT_KEY is not set.", text)
        self.assertEqual(fake.requests, [])

    def test_it_fails_on_a_refused_key_with_the_cockpits_sentence(self):
        code, text = self.run_doctor(ENV, FakeDoor((401, {"ok": False, "outcome": "refused", "error": "This key is not known."})))
        self.assertEqual(code, 1)
        self.assertIn("Door: This key is not known.", text)
        self.assertNotIn(KEY, text)

    def test_the_source_prints_no_key_and_imports_only_the_standard_library(self):
        src = open(ca.__file__, encoding="utf-8").read()
        self.assertNotRegex(src, r"print\([^)]*\bkey\b")
        imports = {line.split()[1].split(".")[0] for line in src.splitlines() if line.startswith(("import ", "from "))}
        self.assertTrue(imports <= {"__future__", "json", "os", "re", "sys", "urllib", "uuid", "typing"}, imports)


if __name__ == "__main__":
    unittest.main()
