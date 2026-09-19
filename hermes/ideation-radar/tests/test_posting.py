import os
import unittest
from pathlib import Path

os.environ.setdefault("RADAR_HOME", "/tmp/radar-unit")

from radar.posting import fetch, prepare, store, thumbs, write, youtube


class FakeSb:
    """Enough of the Supabase client for the queue: select, patch, insert."""

    url = "https://example.supabase.co"

    def __init__(self, jobs):
        self.jobs = {j["id"]: dict(j) for j in jobs}
        self.patches = []

    def select(self, table, params):
        assert table == "cockpit_post_jobs"
        if "status=eq.queued" in params:
            return sorted([j for j in self.jobs.values() if j["status"] == "queued"], key=lambda j: j["created_at"])
        return [j for j in self.jobs.values() if j["status"] == "running" and j.get("started_at", "9") < "2000"]

    def patch(self, table, where, body):
        jid = int(where.split("eq.")[1])
        self.jobs[jid].update(body)
        self.patches.append((jid, body))

    def _headers(self, extra=None):
        return {}


class QueueTests(unittest.TestCase):
    def test_claim_marks_running_and_retires_after_three(self):
        sb = FakeSb([
            {"id": 1, "status": "queued", "attempts": 0, "created_at": "2026-09-19T10:00:00Z", "kind": "prepare"},
            {"id": 2, "status": "queued", "attempts": 3, "created_at": "2026-09-19T10:01:00Z", "kind": "prepare"},
            {"id": 3, "status": "running", "attempts": 1, "created_at": "2026-09-19T09:00:00Z", "started_at": "1999-01-01T00:00:00Z", "kind": "render"},
        ])
        st = store.PostStore(sb)
        got = st.claim_jobs(limit=5)
        self.assertEqual([j["id"] for j in got], [1, 3])
        self.assertEqual(sb.jobs[1]["status"], "running")
        self.assertEqual(sb.jobs[1]["attempts"], 1)
        self.assertEqual(sb.jobs[2]["status"], "failed")
        self.assertEqual(sb.jobs[3]["attempts"], 2)
        st.finish_job(got[0], result={"ok": 1})
        self.assertEqual(sb.jobs[1]["status"], "done")
        st.finish_job(got[1], error="x" * 900)
        self.assertEqual(sb.jobs[3]["status"], "failed")
        self.assertEqual(len(sb.jobs[3]["error"]), 600)


class PrepareTests(unittest.TestCase):
    def test_frame_times(self):
        self.assertEqual(prepare.frame_times(0), [0.0])
        t = prepare.frame_times(95)
        self.assertEqual(len(t), 8)
        self.assertEqual(t[0], 1.0)
        self.assertTrue(all(0 <= x <= 94.8 for x in t))
        self.assertEqual(t, sorted(t))
        short = prepare.frame_times(4)
        self.assertTrue(all(x <= 3.8 for x in short))

    def test_pick_frame_skips_the_cut_in(self):
        frames = [{"ms": 0, "sharpness": 99}, {"ms": 1000, "sharpness": 10}, {"ms": 5000, "sharpness": 30}]
        self.assertEqual(prepare.pick_frame(frames)["ms"], 5000)
        self.assertIsNone(prepare.pick_frame([]))


class WriteTests(unittest.TestCase):
    def test_voice_rules_drop_the_script_only_sections(self):
        rules = write.voice_rules()
        self.assertIn("## 1.", rules)
        self.assertIn("## 9.", rules)
        self.assertNotIn("## 8.", rules)
        self.assertNotIn("## 12.", rules)
        self.assertNotIn("Update log", rules)

    def test_mmss(self):
        self.assertEqual(write.mmss(0), "00:00")
        self.assertEqual(write.mmss(65), "01:05")
        self.assertEqual(write.mmss(3725), "1:02:05")

    def test_normalise(self):
        raw = {
            "language": "ar",
            "yt_title_options": ["أول عنوان", "  أول عنوان ", "ثاني", "ثالث", "رابع"],
            "yt_description": "hook line\nsecond line\n\nbody",
            "chapters": [{"at_sec": 30, "title": "المشكلة"}, {"at_sec": 5, "title": "المقدمة"}, {"at_sec": 900, "title": "بعيد"}, {"at_sec": 60, "title": "الحل"}, {"at_sec": 60, "title": "مكرر"}],
            "yt_tags": ["#مهارة", "marketing", "marketing", ""],
            "ig_caption": "hook\nbody",
            "ig_hashtags": ["مقاولات", "#Kuwait", "#Kuwait", "#a b"],
            "thumb_text_options": ["كلمتين بس", "one two three four five six seven", "x"],
            "notes": "why",
        }
        out = write.normalise(raw, duration=180)
        self.assertEqual(out["yt_title_options"], ["أول عنوان", "ثاني", "ثالث"])
        self.assertEqual(out["yt_title"], "أول عنوان")
        self.assertEqual([c["at_sec"] for c in out["chapters"]], [0, 30, 60])
        self.assertIn("00:00 المقدمة", out["yt_description"])
        self.assertEqual(out["yt_tags"], ["مهارة", "marketing"])
        self.assertEqual(out["ig_hashtags"], ["#مقاولات", "#Kuwait", "#ab"])
        self.assertEqual(out["thumb_text_options"], ["كلمتين بس", "x"])
        self.assertEqual(out["thumb_text"], "كلمتين بس")
        short = write.normalise(raw, duration=45)
        self.assertEqual(short["chapters"], [])
        self.assertNotIn("00:00", short["yt_description"])

    def test_prompt_mentions_the_essentials(self):
        p = write.prompt_for({"id": 1, "kind": "video", "title_working": "الوقت"}, {"language": "ar", "segments": [{"start": 0, "end": 2, "text": "هلا"}]}, {"duration_sec": 200}, [{"caption": "How I built it", "multiplier": 4.2, "author_handle": "x"}])
        self.assertIn("[00:00] هلا", p)
        self.assertIn("4.2x @x How I built it", p)
        self.assertIn("Kuwaiti Arabic", p)
        self.assertIn("## 9.", p)


class HelpersTests(unittest.TestCase):
    def test_parse_code_and_drive_id(self):
        self.assertEqual(youtube.parse_code("http://localhost/?code=4%2F0Aabc-def&scope=x"), "4/0Aabc-def")
        self.assertEqual(youtube.parse_code("4/0Araw"), "4/0Araw")
        self.assertEqual(fetch.drive_id("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view?usp=sharing"), "1AbCdEfGhIjKlMnOpQrStUv")
        self.assertEqual(fetch.drive_id("1AbCdEfGhIjKlMnOpQrStUvWx"), "1AbCdEfGhIjKlMnOpQrStUvWx")
        self.assertIsNone(fetch.drive_id("https://example.com/x"))
        self.assertTrue(thumbs.is_arabic("مرحبا"))
        self.assertFalse(thumbs.is_arabic("hello"))

    def test_render_with_a_system_font(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Pillow not installed here")
        candidates = ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/System/Library/Fonts/Helvetica.ttc"]
        font = next((c for c in candidates if Path(c).exists()), None)
        if not font:
            self.skipTest("no system font to render with")
        fonts = {"latin": Path(font), "arabic": Path(font)}
        frame = Path("/tmp/radar-unit/frame.jpg")
        frame.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (1920, 1080), (90, 120, 160)).save(frame, "JPEG")
        yt = thumbs.render_youtube(frame, "Stop generating leads, start generating sales", fonts=fonts)
        cv = thumbs.render_cover(frame, "Referrals are not a system", fonts=fonts)
        self.assertGreater(len(yt), 20_000)
        self.assertLess(len(yt), 1_900_001)
        self.assertEqual(Image.open(__import__("io").BytesIO(yt)).size, (1280, 720))
        self.assertEqual(Image.open(__import__("io").BytesIO(cv)).size, (1080, 1920))
