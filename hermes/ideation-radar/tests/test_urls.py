import unittest

from radar.urls import UnsupportedLink, canonicalize, profile_url


class UrlTests(unittest.TestCase):
    def test_instagram_reel_variants(self):
        cases = [
            "https://www.instagram.com/reel/C8abcDEfGh1/?igsh=xyz",
            "instagram.com/reels/C8abcDEfGh1",
            "https://www.instagram.com/someuser/reel/C8abcDEfGh1/",
            "https://m.instagram.com/tv/C8abcDEfGh1/?utm_source=ig",
        ]
        for c in cases:
            link = canonicalize(c)
            self.assertEqual(link.platform, "instagram")
            self.assertEqual(link.kind, "post")
            self.assertEqual(link.post_id, "C8abcDEfGh1")
            self.assertEqual(link.canonical_url, "https://www.instagram.com/reel/C8abcDEfGh1/")
            self.assertEqual(link.key, "instagram:C8abcDEfGh1")

    def test_instagram_photo_post_keeps_p(self):
        link = canonicalize("https://www.instagram.com/p/DAbc123xyz/")
        self.assertEqual(link.canonical_url, "https://www.instagram.com/p/DAbc123xyz/")

    def test_instagram_profile_and_hashtag_and_share(self):
        self.assertEqual(canonicalize("https://instagram.com/mahara.media/").handle, "mahara.media")
        self.assertEqual(canonicalize("https://instagram.com/mahara.media/").kind, "profile")
        tag = canonicalize("https://www.instagram.com/explore/tags/تصميم_داخلي/")
        self.assertEqual(tag.kind, "hashtag")
        share = canonicalize("https://www.instagram.com/share/reel/_abc123")
        self.assertTrue(share.needs_resolve)

    def test_tiktok_video_and_short_links(self):
        link = canonicalize("https://www.tiktok.com/@Some.User/video/7301234567890123456?is_from_webapp=1")
        self.assertEqual(link.platform, "tiktok")
        self.assertEqual(link.post_id, "7301234567890123456")
        self.assertEqual(link.handle, "some.user")
        self.assertEqual(link.canonical_url, "https://www.tiktok.com/@some.user/video/7301234567890123456")
        short = canonicalize("https://vm.tiktok.com/ZMabc123/")
        self.assertTrue(short.needs_resolve)
        short2 = canonicalize("https://www.tiktok.com/t/ZTabc123/")
        self.assertTrue(short2.needs_resolve)
        prof = canonicalize("https://www.tiktok.com/@some.user")
        self.assertEqual(prof.kind, "profile")
        tag = canonicalize("https://www.tiktok.com/tag/interiordesign")
        self.assertEqual(tag.handle, "interiordesign")

    def test_snapchat(self):
        sp = canonicalize("https://www.snapchat.com/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYaXVhbHl1cmZzAZd5G3SMAZd5GxIHAAAAAA?share_id=abc")
        self.assertEqual(sp.platform, "snapchat")
        self.assertEqual(sp.kind, "spotlight")
        self.assertTrue(sp.post_id.startswith("W7_EDlXW"))
        prof = canonicalize("https://www.snapchat.com/@mahara.media")
        self.assertEqual(prof.kind, "profile")
        self.assertEqual(prof.handle, "mahara.media")
        add = canonicalize("https://snapchat.com/add/mahara.media")
        self.assertEqual(add.handle, "mahara.media")
        short = canonicalize("https://t.snapchat.com/AbC12345")
        self.assertTrue(short.needs_resolve)

    def test_rejects_other_hosts(self):
        with self.assertRaises(UnsupportedLink):
            canonicalize("https://www.youtube.com/shorts/abc")
        with self.assertRaises(UnsupportedLink):
            canonicalize("")

    def test_profile_url(self):
        self.assertEqual(profile_url("instagram", "@abc"), "https://www.instagram.com/abc/")
        self.assertEqual(profile_url("tiktok", "abc"), "https://www.tiktok.com/@abc")


if __name__ == "__main__":
    unittest.main()
