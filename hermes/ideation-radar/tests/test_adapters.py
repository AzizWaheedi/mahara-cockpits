import os
import unittest

os.environ.setdefault("RADAR_HOME", "/tmp/radar-unit")
from radar.config import Config
from radar.platforms import adapter_for
from tests.fakes import ig_item, tt_item


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.cfg = Config.from_env()

    def test_instagram_parse_and_jobs(self):
        ad = adapter_for("instagram", self.cfg)
        actor, job = ad.profile_job("Mahara.Media", 30)
        self.assertEqual(actor, "apify~instagram-scraper")
        self.assertEqual(job["directUrls"], ["https://www.instagram.com/Mahara.Media/"])
        self.assertEqual(job["resultsType"], "posts")
        self.assertEqual(job["resultsLimit"], 30)
        actor, job = ad.post_job("https://www.instagram.com/reel/ABC123/")
        self.assertEqual(job["resultsLimit"], 1)
        posts = ad.parse_posts([ig_item("ABC123", 9000, 72, pinned=True), {"error": "not found"}, {"shortCode": None}], handle="acct")
        self.assertEqual(len(posts), 1)
        p = posts[0]
        self.assertEqual(p.key, "instagram:ABC123")
        self.assertEqual(p.views, 9000)  # videoPlayCount preferred over videoViewCount
        self.assertEqual(p.likes, 100)
        self.assertTrue(p.is_pinned)
        self.assertTrue(p.is_video)
        self.assertEqual(p.media_url, "https://cdn.example/ABC123.mp4")
        self.assertEqual(p.posted_at, "2026-09-14T12:00:00Z")
        self.assertEqual(p.author_handle, "acct")

    def test_instagram_falls_back_to_view_count_and_handles_photos(self):
        ad = adapter_for("instagram", self.cfg)
        item = ig_item("PHOTO1", 0, 100)
        item.pop("videoPlayCount"); item["videoViewCount"] = 555
        item["type"] = "Image"; item["productType"] = "feed"; item.pop("videoUrl")
        p = ad.parse_posts([item])[0]
        self.assertEqual(p.views, 555)
        self.assertFalse(p.is_video)

    def test_tiktok_parse_and_jobs(self):
        ad = adapter_for("tiktok", self.cfg)
        actor, job = ad.profile_job("@some.user", 30)
        self.assertEqual(actor, "clockworks~tiktok-scraper")
        self.assertEqual(job["profiles"], ["some.user"])
        self.assertFalse(job["shouldDownloadVideos"])
        actor, job = ad.hashtag_job("#interior", 30)
        self.assertEqual(job["hashtags"], ["interior"])
        actor, job = ad.post_job("https://www.tiktok.com/@some.user/video/1")
        self.assertEqual(job["postURLs"], ["https://www.tiktok.com/@some.user/video/1"])
        p = ad.parse_posts([tt_item("7300000000000000001", 120000, 60)])[0]
        self.assertEqual(p.key, "tiktok:7300000000000000001")
        self.assertEqual(p.views, 120000)
        self.assertEqual(p.saves, 40)
        self.assertEqual(p.author_followers, 50000)
        self.assertEqual(p.duration_sec, 18)
        self.assertEqual(p.media_url, "https://cdn.example/7300000000000000001.mp4")
        self.assertEqual(p.thumb_url, "https://cdn.example/7300000000000000001.jpg")

    def test_tiktok_epoch_create_time(self):
        ad = adapter_for("tiktok", self.cfg)
        item = tt_item("1", 10, 1)
        item.pop("createTimeISO"); item["createTime"] = 1789600000
        p = ad.parse_posts([item])[0]
        self.assertEqual(p.posted_at, "2026-09-16T23:06:40Z")

    def test_snapchat_without_actor_refuses_scan(self):
        from radar.platforms import PlatformError
        ad = adapter_for("snapchat", self.cfg)
        with self.assertRaises(PlatformError):
            ad.profile_job("someone", 30)
        posts = ad.parse_posts([{"id": "S1", "url": "https://www.snapchat.com/spotlight/S1", "viewCount": "1.2M", "username": "Someone"}])
        self.assertEqual(posts[0].views, 1200000)
        self.assertEqual(posts[0].author_handle, "someone")


if __name__ == "__main__":
    unittest.main()
