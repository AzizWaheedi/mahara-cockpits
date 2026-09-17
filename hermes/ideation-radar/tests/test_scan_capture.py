import json
import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("RADAR_HOME", "/tmp/radar-unit")
from radar.capture import capture_url
from radar.config import Config
from radar.models import Target
from radar.scan import digest_text, run_scan
from radar.state import State
from tests.fakes import NOW, FakeApify, ig_item, tt_item


def cfg_in(tmp: str) -> Config:
    os.environ["RADAR_HOME"] = tmp
    c = Config.from_env()
    c.home, c.state_path, c.out_dir, c.watchlist_path = Path(tmp), Path(tmp) / "state.json", Path(tmp) / "out", Path(tmp) / "watchlist.json"
    c.bridge_url = c.bridge_token = c.supabase_url = c.supabase_key = c.slack_channel = ""
    return c


def logs():
    lines = []
    return lines, lines.append


class ScanTests(unittest.TestCase):
    def test_full_scan_flags_outliers_once_and_keeps_baseline_on_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            targets = [
                Target("instagram", "account", "acct", industry="ours", tags=["kuwait"]),
                Target("tiktok", "account", "tk", industry="other"),
                Target("tiktok", "account", "broken", industry="other"),
            ]
            ig = [ig_item(f"p{i}", 1000 + i, 100 + i) for i in range(10)] + [ig_item("BIG", 12000, 72), ig_item("YOUNG", 90000, 6), ig_item("MID", 3300, 80)]
            tt = [tt_item(f"t{i}", 5000, 200 + i) for i in range(8)] + [tt_item("tbig", 30000, 60)]
            fx = {"instagram:account:acct#posts": ig, "instagram:account:acct#details": [{"username": "acct", "followersCount": 12000, "fullName": "Acct"}], "tiktok:account:tk#posts": tt}
            fake = FakeApify(fx, fail={"tiktok:account:broken#posts"})
            lines, log = logs()
            rep = run_scan(cfg, log, now=NOW, apify=fake, targets=targets)
            self.assertEqual(rep.targets, 3)
            self.assertEqual(rep.scanned, 2)
            self.assertEqual(rep.failed, 1)
            keys = sorted(c["key"] for c in rep.new_candidates)
            self.assertEqual(keys, ["instagram:BIG", "instagram:MID", "tiktok:tbig"])
            big = next(c for c in rep.new_candidates if c["key"] == "instagram:BIG")
            self.assertEqual(big["tier"], "reverse_engineer")
            self.assertEqual(big["industry"], "ours")
            self.assertIn("kuwait", big["tags"])
            self.assertEqual(big["author_followers"], 12000)
            self.assertEqual(big["origin"], "scan")
            self.assertEqual(big["status"], "proposed")
            self.assertIn("jsonl", rep.sinks)
            self.assertEqual(rep.sinks["jsonl"], "ok")
            # Files written
            files = sorted(p.name for p in (Path(tmp) / "out").iterdir())
            self.assertIn("latest.json", files)
            self.assertTrue(any(f.startswith("candidates-") for f in files))
            # State persisted and a second scan proposes nothing new
            st = State.load(cfg.state_path)
            self.assertEqual(st.status("instagram:BIG"), "proposed")
            # 13 posts, YOUNG (6h) excluded by the age gate: 12 in the baseline pool,
            # and the trim drops BIG from the median so it stays near 1000.
            self.assertEqual(st.baseline("instagram:account:acct").n, 12)
            self.assertLess(st.baseline("instagram:account:acct").median, 1100)
            self.assertEqual(st.last_scan()["candidates_new"], 3)
            rep2 = run_scan(cfg, log, now=NOW, apify=FakeApify(fx, fail={"tiktok:account:broken#posts", "instagram:account:acct#posts"}), targets=targets)
            self.assertEqual(rep2.candidates_new, 0)
            self.assertIsNotNone(State.load(cfg.state_path).baseline("instagram:account:acct"), "a failed fetch keeps the baseline")
            self.assertTrue(any("run FAILED" in w for w in rep2.warnings))
            text = digest_text(rep)
            self.assertIn("3 new outliers", text)
            self.assertIn("@acct", text)

    def test_dry_run_leaves_state_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            targets = [Target("instagram", "account", "acct")]
            fx = {"instagram:account:acct#posts": [ig_item(f"p{i}", 1000, 100 + i) for i in range(6)] + [ig_item("BIG", 9000, 72)]}
            lines, log = logs()
            rep = run_scan(cfg, log, now=NOW, apify=FakeApify(fx), targets=targets, dry_run=True)
            self.assertEqual(rep.candidates_new, 1)
            self.assertFalse(cfg.state_path.exists())
            self.assertTrue((Path(tmp) / "out" / "dry" / "latest.json").exists())

    def test_hashtag_scan_baselines_only_top_authors(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            targets = [Target("tiktok", "hashtag", "interior", industry="other")]
            tag_posts = [tt_item(f"h{i}", 100 * (i + 1), 80, author=f"a{i}", fans=1000 * (i + 1)) for i in range(9)]
            fx = {"tiktok:hashtag:interior#posts": tag_posts}
            for i in range(9):
                fx[f"tiktok:account:a{i}#viatag"] = [tt_item(f"a{i}v{j}", 50, 300 + j, author=f"a{i}") for j in range(6)]
            fake = FakeApify(fx)
            lines, log = logs()
            rep = run_scan(cfg, log, now=NOW, apify=fake, targets=targets)
            via = [c for c in rep.new_candidates if any(t == "via:#interior" for t in c["tags"])]
            self.assertTrue(via)
            self.assertLessEqual(len([c for c in fake.calls if c[1].endswith("#viatag")]), 5)  # HASHTAG_TOP_K
            self.assertTrue(all(c["target_key"] == "tiktok:hashtag:interior" for c in via))


class CaptureTests(unittest.TestCase):
    def test_capture_uses_fake_understanding_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            fx = {"C8abcDEfGh1": [ig_item("C8abcDEfGh1", 44000, 90, owner="designer")]}
            fake = FakeApify(fx)
            lines, log = logs()
            calls = []

            def fake_understand(cfg_, video_path, meta, workdir, log_):
                calls.append(meta)
                return {"language": "ar", "dialect": "Kuwaiti", "has_speech": False, "voice": "text on screen", "transcript": "", "on_screen_text": [{"at_sec": 0.5, "text": "قبل وبعد"}], "format": "before_after", "hook": {"text": "قبل وبعد", "type": "before after"}, "beats": [{"beat": "hook", "summary": "opens on the before"}], "cta": None, "music": "trending audio", "why_it_works": "Contrast.", "transferable": "Any renovation firm.", "adaptations": ["Show a kitchen before and after in 7 seconds"], "confidence": {"transcript": "high", "on_screen_text": "high"}, "warnings": [], "method": {"transcribe": "fake"}}

            import radar.media as media

            def fake_download(url, dest, *, max_bytes, timeout=240):
                Path(dest).write_bytes(b"0" * 2000)
                return 2000

            orig = media.download_video
            media.download_video = fake_download
            try:
                idea = capture_url(cfg, log, "https://www.instagram.com/reel/C8abcDEfGh1/?igsh=1", saved_by="sabry@maharamedia.com", note="great contrast", industry="ours", apify=fake, now=NOW, understand_fn=fake_understand)
                self.assertEqual(idea.status, "captured")
                self.assertEqual(idea.key, "instagram:C8abcDEfGh1")
                self.assertEqual(idea.author_handle, "designer")
                self.assertEqual(idea.views, 44000)
                self.assertEqual(idea.voice, "text on screen")
                self.assertEqual(idea.on_screen_text[0]["text"], "قبل وبعد")
                self.assertEqual(idea.saved_by, "sabry@maharamedia.com")
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0]["author_handle"], "designer")
                again = capture_url(cfg, log, "https://www.instagram.com/reel/C8abcDEfGh1/", apify=fake, now=NOW, understand_fn=fake_understand)
                self.assertEqual(again.status, "captured")
                self.assertEqual(len(calls), 1, "second capture served from state")
                rows = [json.loads(l) for l in (Path(tmp) / "out" / "ideas.jsonl").read_text().splitlines()]
                self.assertEqual(rows[0]["hook"]["text"], "قبل وبعد")
            finally:
                media.download_video = orig

    def test_capture_reports_failures_instead_of_raising(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            lines, log = logs()
            bad = capture_url(cfg, log, "https://www.youtube.com/shorts/x", apify=FakeApify({}), now=NOW)
            self.assertEqual(bad.status, "failed")
            self.assertIn("not an Instagram", bad.error)
            prof = capture_url(cfg, log, "https://www.instagram.com/mahara.media/", apify=FakeApify({}), now=NOW)
            self.assertEqual(prof.status, "failed")
            self.assertIn("profile link", prof.error)
            gone = capture_url(cfg, log, "https://www.instagram.com/reel/GONE123/", apify=FakeApify({}), now=NOW)
            self.assertEqual(gone.status, "failed")
            self.assertIn("returned nothing", gone.error)
            rows = [json.loads(l) for l in (Path(tmp) / "out" / "ideas.jsonl").read_text().splitlines()]
            self.assertEqual(len(rows), 3)


if __name__ == "__main__":
    unittest.main()
