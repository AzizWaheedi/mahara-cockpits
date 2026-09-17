import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from radar.models import Baseline, Candidate, Post
from radar.state import State


def mkpost(views=5000):
    return Post(platform="tiktok", post_id="1", url="https://www.tiktok.com/@a/video/1", author_handle="a", views=views, posted_at="2026-09-10T10:00:00Z")


class StateTests(unittest.TestCase):
    def test_roundtrip_and_atomic_save(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "state.json"
            st = State.load(path)
            base = Baseline(median=1000, n=10, computed_at="2026-09-17T12:00:00Z")
            cand = Candidate(post=mkpost(), baseline=base, multiplier=5.0, tier="reverse_engineer", engagement_rate=0.1, packaging_only=False, target_key="tiktok:account:a", industry="ours", scanned_at="2026-09-17T12:00:00Z")
            self.assertTrue(st.propose(cand))
            self.assertFalse(st.propose(cand), "a second scan must not re-propose")
            st.set_baseline("tiktok:account:a", base, followers=1200, posts_seen=30)
            st.add_scan({"at": "2026-09-17T12:00:00Z", "targets": 1})
            st.save()
            self.assertFalse(any(p.name.startswith(".state-") for p in Path(d).iterdir()), "temp file cleaned")
            again = State.load(path)
            self.assertEqual(again.status("tiktok:1"), "proposed")
            self.assertEqual(again.baseline("tiktok:account:a").median, 1000)
            self.assertEqual(again.expected_posts("tiktok:account:a"), 30)
            self.assertEqual(again.last_scan()["targets"], 1)

    def test_view_history_capped_and_deduped(self):
        with tempfile.TemporaryDirectory() as d:
            st = State.load(Path(d) / "s.json")
            for i in range(20):
                st.remember_post(mkpost(views=1000 + i), f"2026-09-{i+1:02d}T00:00:00Z")
            st.remember_post(mkpost(views=1019), "2026-09-30T00:00:00Z")
            hist = st.post("tiktok:1")["views_history"]
            self.assertEqual(len(hist), 12)
            self.assertEqual(hist[-1][1], 1019)

    def test_corrupt_file_is_set_aside(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "s.json"
            path.write_text("{not json", encoding="utf-8")
            st = State.load(path)
            self.assertEqual(st.data["posts"], {})
            self.assertTrue((Path(d) / "s.json.corrupt").exists())

    def test_prune_keeps_captured(self):
        with tempfile.TemporaryDirectory() as d:
            st = State.load(Path(d) / "s.json")
            st.remember_post(mkpost(), "2025-01-01T00:00:00Z")
            st.mark("tiktok:2", "captured", "2025-01-01T00:00:00Z")
            removed = st.prune(keep_days=30, now=datetime(2026, 9, 17, tzinfo=timezone.utc))
            self.assertEqual(removed, 1)
            self.assertIsNotNone(st.post("tiktok:2"))


if __name__ == "__main__":
    unittest.main()
