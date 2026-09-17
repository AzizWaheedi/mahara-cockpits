import json
import os
import unittest

os.environ.setdefault("RADAR_HOME", "/tmp/radar-unit")
import radar.http as http
from radar.apify import Apify, first, to_int
from radar.sinks import BridgeSink, SinkError
from radar.supabase import Supabase
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
            n = Supabase("https://x.supabase.co", "key", table="ideation_posts").upsert("ideation_posts", [{"key": "a", "tags": ["t"]}])
            self.assertEqual(n, 1)
            call = fake.calls[0]
            self.assertIn("on_conflict=key", call["url"])
            self.assertIn("merge-duplicates", call["headers"]["Prefer"])
            self.assertEqual(call["headers"]["apikey"], "key")
        finally:
            http.request = orig


def body_of(call):
    """The JSON the Supabase client sent (it passes bytes, not json_body)."""
    raw = call.get("data")
    return json.loads(raw.decode("utf-8")) if raw else call.get("json_body")


class SupabaseFlowTests(unittest.TestCase):
    """The writer rules: decisions survive scans, pasted rows take the real key, claims lease."""

    def setUp(self):
        self.orig = http.request

    def tearDown(self):
        http.request = self.orig

    def test_store_candidates_splits_new_proposed_and_decided(self):
        existing = json.dumps([{"key": "instagram:A", "status": "proposed"}, {"key": "instagram:B", "status": "saved", "still_path": "instagram/B.jpg"}]).encode()
        fake = FakeHttp([(200, {}, existing), (204, {}, b""), (201, {}, b"")])
        http.request = fake
        sb = Supabase("https://x.supabase.co", "key")
        out = sb.store_candidates([
            {"key": "instagram:A", "platform": "instagram", "url": "u", "views": 10, "raw": {"x": 1}, "is_video": True},
            {"key": "instagram:B", "platform": "instagram", "url": "u", "views": 20, "multiplier": 4.0, "thumb_url": "https://t/b.jpg"},
            {"key": "instagram:C", "platform": "instagram", "url": "u", "views": 30},
        ])
        self.assertEqual(out, {"inserted": 1, "refreshed": 1, "patched": 1})
        methods = [(c["method"], c["url"].split("/rest/v1/")[1][:60]) for c in fake.calls]
        self.assertEqual(methods[0][0], "GET")
        self.assertEqual(methods[1][0], "PATCH")  # the saved row takes numbers only
        patched = body_of(fake.calls[1])
        self.assertNotIn("status", patched)
        self.assertNotIn("thumb_url", patched, "a row with its own still keeps it")
        self.assertEqual(patched["multiplier"], 4.0)
        self.assertEqual(methods[2][0], "POST")
        upserted = body_of(fake.calls[2])
        self.assertEqual({r["key"] for r in upserted}, {"instagram:A", "instagram:C"})
        self.assertTrue(all(r["status"] == "proposed" for r in upserted))
        self.assertNotIn("raw", upserted[0])
        self.assertNotIn("is_video", upserted[0])

    def test_store_idea_takes_over_the_pasted_row(self):
        existing = json.dumps([{"key": "pasted:abc", "status": "fetching", "saved_by": "sabry@x", "note": "nice", "industry": "ours", "tags": ["kw"], "attempts": 1}]).encode()
        fake = FakeHttp([(200, {}, existing), (204, {}, b"")])
        http.request = fake
        sb = Supabase("https://x.supabase.co", "key")
        key = sb.store_idea({"key": "tiktok:123", "platform": "tiktok", "url": "u", "status": "captured", "transcript": "hi", "hook": {"text": "hi"}, "captured_at": "2026-09-17T12:00:00Z"}, origin_key="pasted:abc")
        self.assertEqual(key, "tiktok:123")
        call = fake.calls[1]
        self.assertEqual(call["method"], "PATCH")
        self.assertIn("key=eq.pasted%3Aabc", call["url"])
        body = body_of(call)
        self.assertEqual(body["key"], "tiktok:123")
        self.assertEqual(body["status"], "saved")
        self.assertEqual(body["saved_by"], "sabry@x")
        self.assertEqual(body["note"], "nice")
        self.assertEqual(body["industry"], "ours")
        self.assertEqual(body["origin"], "manual")

    def test_store_idea_merges_into_existing_post_and_deletes_the_pasted_row(self):
        existing = json.dumps([{"key": "tiktok:123", "status": "proposed"}, {"key": "pasted:abc", "status": "fetching", "saved_by": "sabry@x"}]).encode()
        fake = FakeHttp([(200, {}, existing), (204, {}, b""), (204, {}, b"")])
        http.request = fake
        sb = Supabase("https://x.supabase.co", "key")
        sb.store_idea({"key": "tiktok:123", "platform": "tiktok", "url": "u", "status": "captured", "transcript": "hi"}, origin_key="pasted:abc")
        self.assertEqual([c["method"] for c in fake.calls], ["GET", "PATCH", "DELETE"])
        self.assertIn("key=eq.tiktok%3A123", fake.calls[1]["url"])
        self.assertIn("key=eq.pasted%3Aabc", fake.calls[2]["url"])

    def test_store_idea_failure_keeps_the_reason(self):
        fake = FakeHttp([(200, {}, b"[]"), (201, {}, b"")])
        http.request = fake
        sb = Supabase("https://x.supabase.co", "key")
        sb.store_idea({"key": "instagram:GONE", "platform": "instagram", "url": "u", "status": "failed", "error": "private or removed"})
        body = body_of(fake.calls[1])[0]
        self.assertEqual(body["status"], "failed")
        self.assertEqual(body["error"], "private or removed")
        self.assertEqual(body["attempts"], 1)

    def test_claim_pending_leases_and_gives_up_after_four(self):
        queued = json.dumps([{"key": "pasted:1", "url": "https://www.tiktok.com/@a/video/1", "attempts": 0, "saved_by": "s@x"}, {"key": "pasted:2", "url": "u2", "attempts": 4}]).encode()
        fake = FakeHttp([(200, {}, queued), (200, {}, b"[]"), (204, {}, b""), (204, {}, b"")])
        http.request = fake
        sb = Supabase("https://x.supabase.co", "key")
        rows = sb.claim_pending(5)
        self.assertEqual([r["key"] for r in rows], ["pasted:1"])
        self.assertEqual(rows[0]["saved_by"], "s@x")
        first = body_of(fake.calls[2])
        self.assertEqual(first["status"], "fetching")
        self.assertEqual(first["attempts"], 1)
        second = body_of(fake.calls[3])
        self.assertEqual(second["status"], "failed")
        self.assertEqual(second["attempts"], 5)

    def test_upload_still_path_and_headers(self):
        fake = FakeHttp([(200, {}, b'{"Key":"ideation-stills/instagram/A.jpg"}')])
        http.request = fake
        sb = Supabase("https://x.supabase.co", "key")
        path = sb.upload_still("instagram", "A", b"x" * 300, "image/jpeg")
        self.assertEqual(path, "instagram/A.jpg")
        self.assertIn("/storage/v1/object/ideation-stills/instagram/A.jpg", fake.calls[0]["url"])
        self.assertEqual(fake.calls[0]["headers"]["x-upsert"], "true")


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
