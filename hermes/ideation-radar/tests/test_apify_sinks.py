import json
import os
import unittest

os.environ.setdefault("RADAR_HOME", "/tmp/radar-unit")
import radar.http as http
from radar.apify import Apify, first, to_int
from radar.sinks import BridgeSink, SinkError, SupabaseSink
from radar.understand import normalise_result, parse_json
from tests.fakes import FakeHttp


class ApifyRunnerTests(unittest.TestCase):
    def test_run_many_polls_reads_datasets_and_counts_cost(self):
        seq = {"n": 0}

        def fake_request(method, url, **kw):
            seq["n"] += 1
            if "/runs?" in url and method == "POST":
                rid = f"r{seq['n']}"
                return 201, {}, json.dumps({"data": {"id": rid, "status": "RUNNING", "defaultDatasetId": f"ds-{rid}"}}).encode()
            if "/actor-runs/" in url:
                rid = url.split("/actor-runs/")[1].split("?")[0]
                status = "FAILED" if rid == "r2" else "SUCCEEDED"
                return 200, {}, json.dumps({"data": {"id": rid, "status": status, "defaultDatasetId": f"ds-{rid}", "usageTotalUsd": 0.02}}).encode()
            if "/datasets/" in url:
                return 200, {}, json.dumps([{"id": 1}, {"id": 2}]).encode()
            raise AssertionError(url)

        orig = http.request
        http.request = fake_request
        try:
            ap = Apify("tok", max_runs=10, sleep=lambda s: None, clock=lambda: 0.0)
            res = ap.run_many("actor~x", [("a", {"x": 1}), ("b", {"x": 2}), ("c", {"x": 3})], concurrency=2, poll_sec=0)
            self.assertEqual([r.label for r in res], ["a", "b", "c"])
            self.assertTrue(res[0].ok and len(res[0].items) == 2)
            self.assertFalse(res[1].ok)
            self.assertEqual(res[1].error, "run FAILED")
            self.assertEqual(ap.runs_started, 3)
            self.assertAlmostEqual(ap.usage_usd, 0.06)
        finally:
            http.request = orig

    def test_run_cap_stops_new_runs(self):
        orig = http.request
        run = json.dumps({"data": {"id": "r", "status": "SUCCEEDED", "defaultDatasetId": "d", "usageTotalUsd": 0}}).encode()
        http.request = lambda m, u, **k: (200, {}, b"[]") if "/datasets/" in u else (200, {}, run)
        try:
            ap = Apify("tok", max_runs=1, sleep=lambda s: None, clock=lambda: 0.0)
            res = ap.run_many("actor~x", [("a", {}), ("b", {})], concurrency=1, poll_sec=0)
            self.assertIsNone(res[0].error)
            self.assertIn("run cap", res[1].error)
        finally:
            http.request = orig

    def test_first_and_to_int(self):
        self.assertEqual(first({"a": {"b": 3}}, "x", "a.b"), 3)
        self.assertEqual(first({"a": None, "b": 0}, "a", "b"), 0)
        self.assertEqual(to_int("1.2M"), 1200000)
        self.assertEqual(to_int("12,345"), 12345)
        self.assertIsNone(to_int(True))
        self.assertEqual(to_int(3.9), 3)


class SinkTests(unittest.TestCase):
    def test_bridge_batches_and_checks_ok(self):
        fake = FakeHttp()
        orig = http.request
        http.request = fake
        try:
            b = BridgeSink("https://colorful-wombat-644.convex.site", "tok")
            b.store_candidates([{"key": str(i)} for i in range(95)])
            self.assertEqual(len(fake.calls), 3)
            body = fake.calls[0]["json_body"]
            self.assertEqual(body["fn"], "storeIdeationCandidates")
            self.assertEqual(len(body["args"]["rows"]), 40)
            self.assertEqual(fake.calls[0]["headers"]["Authorization"], "Bearer tok")
            self.assertTrue(fake.calls[0]["url"].endswith("/ideation"))
            http.request = FakeHttp([(200, {}, b'{"ok": false, "error": "unknown bridge function"}')])
            with self.assertRaises(SinkError):
                b.store_ideas([{"key": "x"}])
        finally:
            http.request = orig

    def test_supabase_upsert_headers(self):
        fake = FakeHttp([(201, {}, b"")])
        orig = http.request
        http.request = fake
        try:
            n = SupabaseSink("https://x.supabase.co", "key", "ideation_posts").upsert([{"key": "a", "raw": {"drop": 1}, "tags": ["t"]}])
            self.assertEqual(n, 1)
            call = fake.calls[0]
            self.assertIn("on_conflict=key", call["url"])
            self.assertIn("merge-duplicates", call["headers"]["Prefer"])
            self.assertNotIn("raw", call["json_body"][0])
        finally:
            http.request = orig


class UnderstandParsingTests(unittest.TestCase):
    def test_parse_json_tolerates_fences_and_prose(self):
        self.assertEqual(parse_json('```json\n{"a": 1}\n```'), {"a": 1})
        self.assertEqual(parse_json('Here you go: {"a": {"b": 2}} thanks'), {"a": {"b": 2}})
        with self.assertRaises(ValueError):
            parse_json("no json here")

    def test_normalise_fills_and_bounds(self):
        r = normalise_result({"transcript": "x" * 20000, "on_screen_text": [{"at_sec": "3", "text": "hi"}, {"text": ""}], "format": "weird", "hook": "not a dict", "beats": [{"beat": "nope", "summary": "s"}], "adaptations": ["a", None, "b"], "confidence": {}})
        self.assertEqual(len(r["transcript"]), 12000)
        self.assertEqual(r["on_screen_text"], [{"at_sec": 3.0, "text": "hi"}])
        self.assertEqual(r["format"], "other")
        self.assertEqual(r["hook"]["text"], "")
        self.assertEqual(r["beats"][0]["beat"], "other")
        self.assertEqual(r["adaptations"], ["a", "b"])
        self.assertEqual(r["voice"], "both")
        self.assertEqual(r["language"], "mixed")
        self.assertEqual(r["confidence"]["transcript"], "low")


if __name__ == "__main__":
    unittest.main()
