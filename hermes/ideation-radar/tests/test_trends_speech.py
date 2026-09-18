import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

os.environ.setdefault("RADAR_HOME", "/tmp/radar-unit")
from radar import speech, stills, trends
from radar.config import Config
from radar.sinks import SinkError, SlackSink
from radar.supabase import Supabase

NOW = datetime(2026, 9, 18, 9, 0, tzinfo=timezone.utc)


def cfg_in(tmp: str) -> Config:
    os.environ["RADAR_HOME"] = tmp
    c = Config.from_env()
    c.home, c.state_path, c.out_dir, c.watchlist_path = Path(tmp), Path(tmp) / "state.json", Path(tmp) / "out", Path(tmp) / "watchlist.json"
    c.bridge_url = c.bridge_token = c.supabase_url = c.supabase_key = c.slack_channel = ""
    return c


class FakeSupabase(Supabase):
    """Rows in memory; select returns them, patch records what changed."""

    def __init__(self, rows: list[dict[str, Any]]):
        super().__init__("https://x.supabase.co", "k")
        self.rows = rows
        self.patches: list[tuple[str, dict[str, Any]]] = []

    def select(self, table: str, params: str) -> list[dict[str, Any]]:
        return [dict(r) for r in self.rows]

    def patch(self, table: str, where: str, body: dict[str, Any]) -> None:
        self.patches.append((where, body))
        key = where.split("key=eq.", 1)[1]
        from urllib.parse import unquote
        key = unquote(key)
        for r in self.rows:
            if r["key"] == key:
                r.update(body)


def vec(*xs: float) -> list[float]:
    return [1.0, *xs]  # provider tag first (1 = Gemini), as embed() returns


class DescribeFallbackTests(unittest.TestCase):
    def test_openai_reads_the_row_when_gemini_is_out_of_quota(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            from radar import understand
            calls: list[str] = []

            def gemini_out(*a, **kw):
                calls.append("gemini")
                raise trends.http.HttpError(429, "quota")

            def openai_ok(url, payload, **kw):
                calls.append("openai")
                return {"choices": [{"message": {"content": '{"format_label": "talking head listing three mistakes", "hook_kind": "list", "topic": "bathroom tiling"}'}}]}

            orig_gen, orig_post = understand.gemini_generate, trends.http.post_json
            understand.gemini_generate = gemini_out  # type: ignore[assignment]
            trends.http.post_json = openai_ok  # type: ignore[assignment]
            try:
                os.environ["GOOGLE_AI_API_KEY"] = "g"
                os.environ["OPENAI_API_KEY"] = "o"
                d = trends.describe(cfg, {"key": "tiktok:1", "caption": "x"}, b"jpegbytes", lambda m: None)
                self.assertEqual(d["format_label"], "talking head listing three mistakes")
                self.assertEqual(d["hook_kind"], "list")
                self.assertEqual(calls, ["gemini", "openai"])
            finally:
                understand.gemini_generate = orig_gen  # type: ignore[assignment]
                trends.http.post_json = orig_post  # type: ignore[assignment]
                os.environ.pop("GOOGLE_AI_API_KEY", None)
                os.environ.pop("OPENAI_API_KEY", None)

    def test_vectors_from_different_providers_never_match(self):
        self.assertAlmostEqual(trends.cosine([1.0, 1.0, 0.0], [1.0, 1.0, 0.0]), 1.0)
        self.assertEqual(trends.cosine([1.0, 1.0, 0.0], [2.0, 1.0, 0.0]), 0.0)


class TrendTests(unittest.TestCase):
    def test_same_format_on_three_accounts_becomes_a_trend(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            rows = [
                {"key": "tiktok:1", "author_handle": "a", "status": "proposed", "caption": "before and after villa", "format_label": None, "format_vec": None, "trend_id": None},
                {"key": "tiktok:2", "author_handle": "b", "status": "proposed", "caption": "before after kitchen", "format_label": None, "format_vec": None, "trend_id": None},
                {"key": "instagram:3", "author_handle": "c", "status": "saved", "caption": "reveal", "format_label": "before after reveal with text overlay", "format_vec": None, "trend_id": None},
                {"key": "tiktok:4", "author_handle": "a", "status": "proposed", "caption": "another by the same author", "format_label": "before after reveal with text overlay", "format_vec": None, "trend_id": None},
                {"key": "tiktok:5", "author_handle": "d", "status": "proposed", "caption": "talking head", "format_label": "talking head listing mistakes", "format_vec": None, "trend_id": None},
            ]
            sb = FakeSupabase(rows)
            described: list[str] = []

            def fake_describe(cfg_, row, image, log):
                described.append(row["key"])
                return {"format_label": "before after reveal with text overlay", "hook_kind": "before after", "topic": "renovation"}

            def fake_embed(cfg_, texts):
                return [vec(1.0, 0.0) if "before after" in t else vec(0.0, 1.0) for t in texts]

            summary = trends.detect(cfg, sb, lambda m: None, now=NOW, describe_fn=fake_describe, embed_fn=fake_embed, image_fn=lambda p: None)
            self.assertEqual(sorted(described), ["tiktok:1", "tiktok:2"], "only rows without a label are described")
            self.assertEqual(summary["embedded"], 5)
            self.assertEqual(len(summary["trends"]), 1)
            t = summary["trends"][0]
            self.assertEqual(t["authors"], 3, "author a counts once, d is another format")
            self.assertEqual(sorted(t["keys"]), ["instagram:3", "tiktok:1", "tiktok:2", "tiktok:4"])
            ids = {r["trend_id"] for r in rows if r["key"] in t["keys"]}
            self.assertEqual(len(ids), 1)
            self.assertIsNone(rows[4]["trend_id"])
            # Second run: nothing new to describe, the trend id is stable.
            described.clear()
            again = trends.detect(cfg, sb, lambda m: None, now=NOW, describe_fn=fake_describe, embed_fn=fake_embed, image_fn=lambda p: None)
            self.assertEqual(described, [])
            self.assertEqual(again["trends"][0]["id"], t["id"])

    def test_two_accounts_is_not_a_trend_and_an_old_chip_is_cleared(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            rows = [
                {"key": "tiktok:1", "author_handle": "a", "status": "proposed", "format_label": "x", "format_vec": vec(1, 0), "trend_id": "t-old", "trend_label": "x", "trend_n": 3},
                {"key": "tiktok:2", "author_handle": "b", "status": "proposed", "format_label": "x", "format_vec": vec(1, 0), "trend_id": "t-old", "trend_label": "x", "trend_n": 3},
            ]
            sb = FakeSupabase(rows)
            summary = trends.detect(cfg, sb, lambda m: None, now=NOW, describe_fn=lambda *a: {}, embed_fn=lambda *a: [], image_fn=lambda p: None)
            self.assertEqual(summary["trends"], [])
            self.assertTrue(all(r["trend_id"] is None for r in rows))

    def test_digest_lines(self):
        self.assertEqual(trends.digest_lines(None), [])
        lines = trends.digest_lines({"trends": [{"label": "before after reveal", "authors": 4, "handles": ["a", "b"]}]})
        self.assertIn("before after reveal: 4 accounts (@a, @b)", lines[1])


class SpeechTests(unittest.TestCase):
    def test_elevenlabs_first_then_groq(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            video = Path(tmp) / "v.mp4"
            video.write_bytes(b"\x00" * 1000)
            calls: list[str] = []

            def fake_multipart(url, fields, files, **kw):
                calls.append(url)
                if "elevenlabs" in url:
                    return {"text": "يا جماعة شوفوا", "language_code": "ara", "language_probability": 0.97, "words": [{"text": "يا", "start": 0.1, "end": 0.3, "type": "word"}, {"text": "جماعة", "start": 0.35, "end": 0.8, "type": "word"}, {"text": "شوفوا", "start": 2.0, "end": 2.4, "type": "word"}]}
                return {"text": "whisper text", "language": "ar", "segments": []}

            orig = speech.http.post_multipart
            speech.http.post_multipart = fake_multipart  # type: ignore[assignment]
            speech.media.extract_audio = lambda p, d: None  # type: ignore[assignment]
            try:
                os.environ["ELEVENLABS_API_KEY"] = "x"
                os.environ["GROQ_API_KEY"] = "y"
                out = speech.transcribe(cfg, video, Path(tmp), lambda m: None, has_audio=True)
                self.assertEqual(out["method"], "elevenlabs:scribe_v1")
                self.assertEqual(out["text"], "يا جماعة شوفوا")
                self.assertEqual(out["confidence"], "high")
                self.assertEqual(len(out["segments"]), 2, "a pause over 0.8 s starts a new line")
                self.assertEqual(len(calls), 1)

                def failing(url, fields, files, **kw):
                    calls.append(url)
                    if "elevenlabs" in url:
                        raise speech.http.HttpError(402, "quota")
                    return {"text": "whisper text", "language": "ar", "segments": []}

                speech.http.post_multipart = failing  # type: ignore[assignment]
                out = speech.transcribe(cfg, video, Path(tmp), lambda m: None, has_audio=True)
                self.assertEqual(out["method"], "groq:whisper-large-v3")
                self.assertTrue(any("elevenlabs transcription failed" in w for w in out["warnings"]))
                silent = speech.transcribe(cfg, video, Path(tmp), lambda m: None, has_audio=False)
                self.assertEqual(silent["method"], "none")
            finally:
                speech.http.post_multipart = orig  # type: ignore[assignment]
                os.environ.pop("ELEVENLABS_API_KEY", None)
                os.environ.pop("GROQ_API_KEY", None)

    def test_merge_speech_prefers_the_speech_model(self):
        from radar.understand import merge_speech

        r = merge_speech({"has_speech": True, "transcript": "video model words", "method": {}, "confidence": {}}, {"text": "speech words", "method": "elevenlabs:scribe_v1", "confidence": "high", "segments": []})
        self.assertEqual(r["transcript"], "speech words")
        self.assertEqual(r["method"]["transcribe"], "elevenlabs:scribe_v1")
        silent = merge_speech({"has_speech": False, "transcript": "", "warnings": []}, {"text": "la la la", "method": "elevenlabs:scribe_v1"})
        self.assertEqual(silent["transcript"], "")
        self.assertTrue(any("lyrics" in w for w in silent["warnings"]))


class StoryboardTests(unittest.TestCase):
    def test_story_times(self):
        self.assertEqual(stills.story_times(None), [1.0, 6.0, 12.0])
        self.assertEqual(stills.story_times(30), [1.0, 15.0, 28.5])
        self.assertEqual(stills.story_times(3), [0.3, 1.5, 2.55])

    def test_attach_prefers_the_capture_storyboard_then_the_thumbnail(self):
        class SB(Supabase):
            def __init__(self):
                super().__init__("https://x.supabase.co", "k")
                self.uploads: list[tuple[str, str]] = []

            def upload_still(self, platform, post_id, blob, content_type="image/jpeg"):
                self.uploads.append((platform, post_id))
                return f"{platform}/{post_id}.jpg"

        sb = SB()
        rows = [
            {"key": "tiktok:1", "platform": "tiktok", "post_id": "1", "media_url": "https://cdn/x.mp4", "duration_sec": 20, "_storyboard": b"x" * 1000},
            {"key": "tiktok:2", "platform": "tiktok", "post_id": "2", "media_url": "https://cdn/y.mp4", "thumb_url": "https://cdn/y.jpg"},
            {"key": "tiktok:3", "platform": "tiktok", "post_id": "3", "still_path": "tiktok/3.jpg"},
        ]
        orig = stills.fetch_image
        stills.fetch_image = lambda url: (b"y" * 500, "image/jpeg")  # type: ignore[assignment]
        try:
            out = stills.attach_stills(sb, rows, lambda m: None, story_fn=lambda url, d: b"s" * 2000 if "y.mp4" in url else None)
        finally:
            stills.fetch_image = orig  # type: ignore[assignment]
        self.assertEqual(out["storyboards"], 2)
        self.assertEqual(rows[0]["still_path"], "tiktok/1.story.jpg")
        self.assertEqual(rows[1]["still_path"], "tiktok/2.story.jpg")
        self.assertEqual(rows[2]["still_path"], "tiktok/3.jpg", "an existing still is kept")
        self.assertNotIn("_storyboard", rows[0])


class SlackTests(unittest.TestCase):
    def test_posts_to_every_recipient_and_reports_each_failure(self):
        from radar import sinks

        sent: list[str] = []

        def fake_post_json(url, payload, **kw):
            sent.append(payload["channel"])
            return {"ok": payload["channel"] != "U2", "error": "channel_not_found"}

        orig = sinks.http.post_json
        sinks.http.post_json = fake_post_json  # type: ignore[assignment]
        try:
            with self.assertRaises(SinkError) as ctx:
                SlackSink("t", "U1, U2,U3").post("hello")
            self.assertEqual(sent, ["U1", "U2", "U3"])
            self.assertIn("U2: channel_not_found", str(ctx.exception))
        finally:
            sinks.http.post_json = orig  # type: ignore[assignment]


if __name__ == "__main__":
    unittest.main()
