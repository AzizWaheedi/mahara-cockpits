import json
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


class KindsTest(unittest.TestCase):
    def test_kind_of(self):
        from radar.posting import write

        self.assertEqual(write.kind_of({"kind": "post"}), "post")
        self.assertEqual(write.kind_of({"kind": "reel"}, 400), "reel")
        self.assertEqual(write.kind_of({}, 400), "video")
        self.assertEqual(write.kind_of({}, 40), "reel")

    def test_reel_prompt_asks_for_the_cover_pair_and_no_chapters(self):
        from radar.posting import write

        p = write.prompt_for({"id": 1, "kind": "reel"}, {"language": "ar", "segments": []}, {"duration_sec": 40}, [])
        self.assertIn("cover_lines", p)
        self.assertIn("#Shorts", p)
        self.assertIn("A Short has no chapters", p)

    def test_reel_normalise_keeps_pairs_and_drops_chapters(self):
        from radar.posting import write

        raw = {
            "language": "ar",
            "cover_lines": ["الجمهور الغلط؟", "اقرأ إعلانك"],
            "thumb_text_options": ["الجمهور الغلط؟ | اقرأ إعلانك", "كم أرخص سعر | جوابك هنا", "خمسة أرقام تقولك وين مشكلتك بالضبط اليوم"],
            "chapters": [{"at_sec": 0, "title": "a"}, {"at_sec": 20, "title": "b"}, {"at_sec": 40, "title": "c"}],
            "yt_title_options": ["t"],
            "yt_description": "d",
        }
        out = write.normalise(raw, duration=150, kind="reel")
        self.assertEqual(out["chapters"], [])
        self.assertEqual(out["thumb_text"], "الجمهور الغلط؟ | اقرأ إعلانك")
        self.assertIn("كم أرخص سعر | جوابك هنا", out["thumb_text_options"])
        self.assertTrue(all("|" in t for t in out["thumb_text_options"]))

    def test_post_prompt_and_normalise(self):
        from radar.posting import write

        p = write.post_prompt({"id": 2, "kind": "post", "brief": "ثلاث أسئلة قبل ما تقول الإعلانات ما تشتغل", "images": ["a", "b"]})
        self.assertIn("2 images", p)
        self.assertIn("ثلاث أسئلة", p)
        out = write.normalise_post({"language": "ar", "ig_caption": " hook ", "ig_hashtags": ["#a", "a", "#b b"]})
        self.assertEqual(out["ig_caption"], "hook")
        self.assertEqual(out["ig_hashtags"], ["#a", "#bb"])

    def test_split_cover(self):
        from radar.posting import thumbs

        self.assertEqual(thumbs.split_cover("a b | c d"), ["a b", "c d"])
        self.assertEqual(thumbs.split_cover("one two three four"), ["one two", "three four"])
        self.assertEqual(thumbs.split_cover("one"), ["one"])


class HardeningTest(unittest.TestCase):
    def test_normalise_survives_garbage(self):
        from radar.posting import write

        for raw in (None, [], "text", {"yt_title_options": "not a list", "chapters": {"a": 1}, "ig_hashtags": 42, "thumb_text_options": [None, 3, {"x": 1}]}):
            out = write.normalise(raw, duration=500, kind="video")
            self.assertEqual(out["chapters"], [])
            self.assertIsNone(out["yt_title"])
            self.assertEqual(out["ig_hashtags"], [])
        huge = {"yt_title_options": ["x" * 5000], "yt_description": "y" * 20000, "ig_caption": "z" * 9000, "ig_hashtags": ["#" + "h" * 200] * 50, "thumb_text_options": ["one two three four five six seven eight"], "cover_lines": ["a" * 100, "b"]}
        out = write.normalise(huge, duration=500, kind="video")
        self.assertLessEqual(len(out["yt_title"]), 100)
        self.assertLessEqual(len(out["yt_description"]), 4800)
        self.assertLessEqual(len(out["ig_caption"]), 2200)
        self.assertLessEqual(len(out["ig_hashtags"]), 12)
        self.assertEqual(out["thumb_text_options"], [])
        reel = write.normalise(huge, duration=40, kind="reel")
        # An eight-word line without a bar is split into a pair; the hundred-letter cover line is refused.
        self.assertEqual(reel["thumb_text_options"], ["one two three four | five six seven eight"])
        self.assertEqual(reel["thumb_text"], "one two three four | five six seven eight")

    def test_chapters_are_cleaned_and_anchored(self):
        from radar.posting import write

        raw = {"chapters": [{"at_sec": "12", "title": "  two  "}, {"at_sec": 900, "title": "past the end"}, {"at_sec": -5, "title": "neg"}, {"at_sec": 40, "title": "three"}, {"at_sec": 12, "title": "dup"}, {"at_sec": 80, "title": "four"}], "yt_description": "d"}
        out = write.normalise(raw, duration=300, kind="video")
        # 12 s is kept and a 00:00 anchor is added before it; the out-of-range, negative and duplicate ones go.
        self.assertEqual([c["at_sec"] for c in out["chapters"]], [0, 12, 40, 80])
        self.assertIn("00:00", out["yt_description"])

    def test_post_normalise_hashtags_and_limits(self):
        from radar.posting import write

        out = write.normalise_post({"ig_caption": "x" * 3000, "ig_hashtags": ["#مقاولات", "#", "##a", "b c"]})
        self.assertEqual(len(out["ig_caption"]), 2200)
        self.assertEqual(out["ig_hashtags"], ["#مقاولات", "#a", "#bc"])

    def test_instagram_image_shapes_and_formats(self):
        import io

        from PIL import Image

        from radar.posting import thumbs

        def img(w, h, mode="RGB", fmt="PNG"):
            buf = io.BytesIO()
            Image.new(mode, (w, h), (10, 20, 30) if mode == "RGB" else (10, 20, 30, 128)).save(buf, fmt)
            return buf.getvalue()

        tall = Image.open(io.BytesIO(thumbs.instagram_image(img(600, 1200))))
        self.assertEqual(tall.format, "JPEG")
        self.assertGreaterEqual(tall.width / tall.height, 0.8 - 0.01)
        wide = Image.open(io.BytesIO(thumbs.instagram_image(img(4000, 800))))
        self.assertLessEqual(wide.width, 1440)
        self.assertLessEqual(wide.width / wide.height, 1.91 + 0.01)
        alpha = Image.open(io.BytesIO(thumbs.instagram_image(img(800, 800, "RGBA"))))
        self.assertEqual(alpha.mode, "RGB")
        with self.assertRaises(Exception):
            thumbs.instagram_image(b"not an image at all")

    def test_run_post_makes_images_ready_and_names_a_bad_one(self):
        import io

        from PIL import Image

        from radar.posting import prepare, write

        class Store:
            def __init__(self):
                self.blobs = {}
                self.patched = {}

            def download(self, path):
                if path == "bad.bin":
                    return b"nope"
                buf = io.BytesIO()
                Image.new("RGB", (900, 1500), (1, 2, 3)).save(buf, "PNG")
                return buf.getvalue()

            def upload(self, path, data, content_type):
                self.blobs[path] = (len(data), content_type)
                return path

            def patch_post(self, pid, patch):
                self.patched = patch

        store = Store()
        original = write.compose_post
        write.compose_post = lambda cfg, log, post: ({"language": "ar", "ig_caption": "hook", "ig_hashtags": ["#a"], "notes": None}, "stub")
        try:
            out = prepare.run_post(None, lambda m: None, store, {"id": 7, "kind": "post", "images": ["a.png", "b.png"], "brief": "x"})
            self.assertEqual(out["images"], 2)
            self.assertEqual(store.patched["images"], ["posts/7/images/0.jpg", "posts/7/images/1.jpg"])
            self.assertEqual(store.patched["status"], "ready")
            self.assertEqual(store.blobs["posts/7/images/0.jpg"][1], "image/jpeg")
            with self.assertRaises(ValueError) as caught:
                prepare.run_post(None, lambda m: None, store, {"id": 8, "kind": "post", "images": ["a.png", "bad.bin"], "brief": "x"})
            self.assertIn("image 2", str(caught.exception))
            with self.assertRaises(ValueError):
                prepare.run_post(None, lambda m: None, store, {"id": 9, "kind": "post", "images": ["a.png"] * 11, "brief": "x"})
        finally:
            write.compose_post = original

    def test_render_cover_edge_cases(self):
        import io

        from PIL import Image

        from radar.posting import thumbs

        fonts = thumbs.ensure_fonts()
        frame = Path(__file__).with_name("_frame.jpg")
        Image.new("RGB", (64, 36), (90, 90, 90)).save(frame, "JPEG")
        try:
            for text in ("x", "a very long english headline that should still fit on the cover somehow | and a punch", "|", "  "):
                out = thumbs.render_cover(frame, text, fonts=fonts)
                img = Image.open(io.BytesIO(out))
                self.assertEqual(img.size, (1080, 1920))
        finally:
            frame.unlink(missing_ok=True)


class HandoverRules(unittest.TestCase):
    """Drive links both ways, and the banner and caption rules from the 2026-09-13 handover."""

    def test_drive_ref_reads_file_and_folder_links(self):
        from radar.posting.fetch import drive_id, drive_ref

        assert drive_ref("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=drive_link") == ("file", "1AbCdEfGhIjKlMnOpQrStUvWxYz012345")
        assert drive_ref("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345") == ("file", "1AbCdEfGhIjKlMnOpQrStUvWxYz012345")
        assert drive_ref("1AbCdEfGhIjKlMnOpQrStUvWxYz012345") == ("file", "1AbCdEfGhIjKlMnOpQrStUvWxYz012345")
        assert drive_ref("https://drive.google.com/drive/folders/1FoLdErIdAbCdEfGhIjKlMnOp?usp=sharing") == ("folder", "1FoLdErIdAbCdEfGhIjKlMnOp")
        assert drive_ref("https://drive.google.com/drive/u/0/folders/1FoLdErIdAbCdEfGhIjKlMnOp") == ("folder", "1FoLdErIdAbCdEfGhIjKlMnOp")
        assert drive_ref("https://example.com/video.mp4") is None
        assert drive_id("https://drive.google.com/drive/folders/1FoLdErIdAbCdEfGhIjKlMnOp") is None

    def test_higgsfield_prompt_and_caption_rules(self):
        from radar.posting.higgsfield import _result_urls, clean_line, compose_prompt
        from radar.posting.write import tidy_caption

        p = compose_prompt(["أحسن من الإعلانات", "«العروض» → المشاريع"], graphic="one small teal spark", side="right")
        assert "Line one in solid white: أحسن من الإعلانات." in p
        assert "«" not in p and "→" not in p
        assert "GRAPHIC ELEMENT: one small teal spark." in p
        assert "PHOTO COMPOSITING task" in p
        assert clean_line("«كلمة»") == "كلمة"
        assert _result_urls('{"results":[{"url":"https://d1.cloudfront.net/a/b.png"}]}') == ["https://d1.cloudfront.net/a/b.png"]
        assert _result_urls("done: https://x.higgsfield.ai/out/1.jpg") == ["https://x.higgsfield.ai/out/1.jpg"]
        assert tidy_caption("جرّب — «الطريقة» بـ $500") == "جرّب .. الطريقة بـ دولار 500"


class ResultLinks(unittest.TestCase):
    def test_result_url_wins_over_the_uploaded_reference(self):
        from radar.posting import higgsfield
        raw = json.dumps([{
            "id": "job",
            "params": {"input_images": [{"url": "https://in.cloudfront.net/frame.jpg"}], "prompt": "x"},
            "min_result_url": "https://out.cloudfront.net/min.png",
            "result_url": "https://out.cloudfront.net/full.png",
            "status": "completed",
        }])
        urls = higgsfield._result_urls(raw)
        self.assertEqual(urls[0], "https://out.cloudfront.net/full.png")
        self.assertNotIn("https://in.cloudfront.net/frame.jpg", urls)

    def test_plain_text_output_still_yields_a_link(self):
        from radar.posting import higgsfield
        urls = higgsfield._result_urls("done: https://out.cloudfront.net/x.png")
        self.assertEqual(urls, ["https://out.cloudfront.net/x.png"])


class CoverLayout(unittest.TestCase):
    def test_cover_layout_defaults_to_the_middle(self):
        from radar.posting.higgsfield import compose_prompt
        self.assertIn("the man centred, occupying the lower middle", compose_prompt(["عشرين ضعف العائد"]))
        self.assertIn("lower right portion", compose_prompt(["عشرين ضعف العائد"], side="right"))
        self.assertIn("lower left portion", compose_prompt(["عشرين ضعف العائد"], side="left"))

