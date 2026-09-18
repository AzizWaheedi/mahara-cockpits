import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

os.environ.setdefault("RADAR_HOME", "/tmp/radar-unit")
from radar import requests as rq
from radar.config import Config
from radar.sources import scrapecreators as sc_mod
from radar.state import State
from radar.supabase import Supabase

NOW = datetime(2026, 9, 18, 12, 0, tzinfo=timezone.utc)


def cfg_in(tmp: str) -> Config:
    os.environ["RADAR_HOME"] = tmp
    c = Config.from_env()
    c.home, c.state_path, c.out_dir, c.watchlist_path = Path(tmp), Path(tmp) / "state.json", Path(tmp) / "out", Path(tmp) / "watchlist.json"
    c.bridge_url = c.bridge_token = c.slack_channel = ""
    c.supabase_url, c.supabase_key = "https://x.supabase.co", "k"
    return c


def ig_reel(code: str, views: int, days_ago: int, likes: int = 50) -> dict[str, Any]:
    ts = int(NOW.timestamp()) - days_ago * 86400
    return {"code": code, "url": f"https://www.instagram.com/reel/{code}/", "taken_at": ts, "play_count": views, "like_count": likes, "comment_count": 3, "caption": {"text": f"caption {code}"}, "display_uri": f"https://cdn/{code}.jpg", "user": {"username": "brandx", "follower_count": 12000}}


def meta_ad(ad_id: str, days: int, page: str = "Brand X", video: bool = True, active: bool = True) -> dict[str, Any]:
    start = datetime.fromtimestamp(NOW.timestamp() - days * 86400, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    snap: dict[str, Any] = {"body": {"text": f"ad copy {ad_id}"}, "title": "Offer", "page_name": page, "page_id": "999", "cta_text": "Book now", "display_format": "VIDEO" if video else "IMAGE",
                            "videos": [{"video_hd_url": f"https://cdn/{ad_id}.mp4", "video_preview_image_url": f"https://cdn/{ad_id}.jpg"}] if video else [],
                            "images": [] if video else [{"original_image_url": f"https://cdn/{ad_id}.png"}]}
    return {"ad_archive_id": ad_id, "page_name": page, "page_id": "999", "is_active": active, "start_date_string": start, "end_date_string": NOW.isoformat().replace("+00:00", "Z"), "publisher_platform": ["FACEBOOK", "INSTAGRAM"], "url": f"https://www.facebook.com/ads/library?id={ad_id}", "snapshot": snap}


class FakeSC:
    """Answers like ScrapeCreators from fixtures; counts calls."""

    def __init__(self, fx: dict[str, Any]):
        self.fx = fx
        self.calls: list[str] = []
        self.credits_charged = 0
        self.credits_remaining = 80

    def _c(self, name: str) -> Any:
        self.calls.append(name)
        self.credits_charged += 1
        return self.fx.get(name, [])

    def instagram_reels(self, handle, *, pages=3): return self._c(f"ig_reels:{handle}")
    def instagram_profile(self, handle): return self._c(f"ig_profile:{handle}")
    def tiktok_videos(self, handle, *, pages=3): return self._c(f"tt_videos:{handle}")
    def tiktok_profile(self, handle): return self._c(f"tt_profile:{handle}")
    def youtube_shorts(self, handle, *, pages=1): return self._c(f"yt_shorts:{handle}")
    def youtube_videos(self, handle, *, pages=1): return self._c(f"yt_videos:{handle}")
    def facebook_reels(self, url, *, pages=2): return self._c(f"fb_reels:{url}")
    def snapchat_profile(self, handle): return self._c(f"snap:{handle}")
    def fb_search_companies(self, query): return self._c(f"fb_companies:{query}")
    def fb_company_ads(self, page_id, *, country="", pages=2, status="ACTIVE"): return self._c(f"fb_page_ads:{page_id}")
    def fb_search_ads(self, query, *, country="", pages=2, status="ACTIVE"): return self._c(f"fb_search_ads:{query}")
    def google_advertisers(self, query, *, region=""): return self._c(f"g_adv:{query}")
    def google_company_ads(self, advertiser_id, *, region="", pages=1): return self._c(f"g_ads:{advertiser_id}")


class FakeSB(Supabase):
    def __init__(self, requests: list[dict[str, Any]]):
        super().__init__("https://x.supabase.co", "k")
        self.requests = requests
        self.posts: dict[str, dict[str, Any]] = {}
        self.watch: list[Any] = []
        self.patches: list[tuple[str, dict[str, Any]]] = []

    def select(self, table, params):
        if table == "ideation_requests":
            if "status=eq.queued" in params:
                return [dict(r) for r in self.requests if r["status"] == "queued"]
            return []
        return []

    def patch(self, table, where, body):
        self.patches.append((where, body))
        if table == "ideation_requests":
            for r in self.requests:
                if where.endswith(r["id"]):
                    r.update(body)

    def existing(self, keys):
        return {k: self.posts[k] for k in keys if k in self.posts}

    def upsert(self, table, rows, on_conflict="key"):
        if table == "ideation_posts" or table == self.table:
            for r in rows:
                self.posts[r["key"]] = r
        return len(rows)

    def upsert_watchlist(self, targets, *, source="manual", added_by=""):
        self.watch.extend(targets)
        return len(targets)

    def mark_target(self, key, **fields): pass
    def upload_still(self, platform, post_id, blob, content_type="image/jpeg"): return f"{platform}/{post_id}.jpg"


class ParseTests(unittest.TestCase):
    def test_profile_links_and_handles(self):
        self.assertEqual(rq.parse_profile("https://www.instagram.com/mahara_media/"), ("instagram", "mahara_media"))
        self.assertEqual(rq.parse_profile("https://www.tiktok.com/@eng.ramy.mohamed?lang=en"), ("tiktok", "eng.ramy.mohamed"))
        self.assertEqual(rq.parse_profile("https://www.youtube.com/@maharamedia/shorts"), ("youtube", "maharamedia"))
        self.assertEqual(rq.parse_profile("https://www.snapchat.com/add/someone"), ("snapchat", "someone"))
        self.assertEqual(rq.parse_profile("https://www.facebook.com/ikeakuwait"), ("facebook", "ikeakuwait"))
        self.assertEqual(rq.parse_profile("@brand", "instagram"), ("instagram", "brand"))
        self.assertEqual(rq.parse_profile("tiktok:brand"), ("tiktok", "brand"))
        with self.assertRaises(ValueError):
            rq.parse_profile("https://www.instagram.com/reel/abc123/")
        with self.assertRaises(ValueError):
            rq.parse_profile("brand")

    def test_company_match_prefers_the_instagram_handle(self):
        companies = [{"page_id": "1", "name": "IKEA Kuwait fans", "ig_username": "ikeafans"}, {"page_id": "2", "name": "Brand X", "ig_username": "brandx", "likes": 5000}, {"page_id": "3", "name": "brand x", "ig_username": None, "likes": 12}]
        self.assertEqual(rq.match_company(companies, handle="brandx")["page_id"], "2")
        self.assertEqual(rq.match_company(companies, name="Brand X", min_likes=1000)["page_id"], "2")
        self.assertIsNone(rq.match_company(companies, handle="nobody"))
        self.assertIsNone(rq.match_company([{"page_id": "9", "name": "تصميم داخلي", "likes": 3}], name="تصميم داخلي", min_likes=1000), "an empty page named like the keyword does not swallow the search")

    def test_keyword_pull_falls_back_to_search_when_the_page_has_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            fx = {"fb_companies:تصميم داخلي": [{"page_id": "9", "name": "تصميم داخلي", "likes": 3}], "fb_page_ads:9": [], "fb_search_ads:تصميم داخلي": [meta_ad("k1", 30, page="Studio A")]}
            sc = FakeSC(fx)
            sb = FakeSB([{"id": "a3", "kind": "ads", "platform": "meta", "input": "تصميم داخلي", "params": {"country": "KW"}, "status": "queued", "attempts": 0}])
            done = rq.run_requests(cfg, lambda m: None, sc=sc, sb=sb, state=State(Path(tmp) / "s.json"), now=NOW)
            r = done[0]["result"]
            self.assertNotIn("fb_page_ads:9", sc.calls, "a tiny same-name page is not a match")
            self.assertEqual(r["matched"]["keyword"], "تصميم داخلي")
            self.assertEqual(r["proposals"], 1)

    def test_ad_rows_and_tiers(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            row = sc_mod.meta_ad_row(meta_ad("11", 70), now=NOW)
            self.assertEqual(row["key"], "meta_ads:11")
            self.assertEqual(row["running_days"], 70)
            self.assertEqual(row["media_url"], "https://cdn/11.mp4")
            self.assertIn("ad copy 11", row["caption"])
            g = sc_mod.google_ad_row({"creativeId": "CR1", "advertiserId": "AR1", "advertiserName": "IKEA", "format": "image", "adUrl": "https://adstransparency.google.com/advertiser/AR1/creative/CR1", "imageUrl": "https://i/x", "firstShown": "2026-08-01T00:00:00.000Z", "lastShown": "2026-09-18T00:00:00.000Z"}, now=NOW)
            self.assertEqual(g["key"], "google_ads:CR1")
            self.assertEqual(g["running_days"], 48)
            rows = rq.build_ad_rows(cfg, [meta_ad("a", 70), meta_ad("b", 25), meta_ad("c", 3), meta_ad("d", 40, active=False)], "meta", NOW, tags=["via:ads:x"], industry="other", request_id="r1")
            self.assertEqual([r["ad_id"] for r in rows], ["a", "b"], "3 days is under the floor, inactive is dropped, longest first")
            self.assertEqual(rows[0]["tier"], "reverse_engineer")
            self.assertEqual(rows[1]["tier"], "study")


class RunTests(unittest.TestCase):
    def test_profile_request_proposes_outliers_watches_and_pulls_ads(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            reels = [ig_reel(f"r{i}", 2000, 20 + i) for i in range(10)] + [ig_reel("hit", 14000, 9)]
            fx = {"ig_reels:brandx": reels, "fb_companies:brandx": [{"page_id": "999", "name": "Brand X", "ig_username": "brandx"}], "fb_page_ads:999": [meta_ad("ad1", 30), meta_ad("ad2", 2)]}
            sc = FakeSC(fx)
            sb = FakeSB([{"id": "req1", "kind": "profile", "platform": None, "input": "https://www.instagram.com/brandx/", "params": {"industry": "ours", "client": "Brand X"}, "status": "queued", "requested_by": "sabry@x", "requested_by_name": "Sabry", "attempts": 0, "created_at": "2026-09-18T11:00:00Z"}])
            state = State(Path(tmp) / "state.json")
            done = rq.run_requests(cfg, lambda m: None, sc=sc, sb=sb, state=state, now=NOW)
            self.assertEqual(done[0]["status"], "done", done[0])
            r = done[0]["result"]
            self.assertEqual((r["platform"], r["handle"]), ("instagram", "brandx"))
            self.assertEqual(r["proposals"], 1, "one reel beat the page's normal")
            self.assertIn("instagram:hit", sb.posts)
            self.assertEqual(sb.posts["instagram:hit"]["origin"], "scrape")
            self.assertEqual(sb.posts["instagram:hit"]["client"], "Brand X")
            self.assertTrue(r["watched"])
            self.assertEqual(sb.watch[0].key, "instagram:account:brandx")
            self.assertEqual(r["ads"], 2, "a brand's own ads are all shown, however young")
            self.assertEqual(sb.posts["meta_ads:ad1"]["origin"], "ads")

    def test_profile_ads_floor_is_zero_for_the_brand_itself(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            fx = {"ig_reels:brandx": [ig_reel(f"r{i}", 2000, 20 + i) for i in range(3)], "fb_companies:brandx": [{"page_id": "999", "name": "Brand X", "ig_username": "brandx"}], "fb_page_ads:999": [meta_ad("ad1", 30), meta_ad("ad2", 2)]}
            sb = FakeSB([{"id": "req2", "kind": "profile", "input": "instagram:brandx", "params": {}, "status": "queued", "attempts": 0}])
            done = rq.run_requests(cfg, lambda m: None, sc=FakeSC(fx), sb=sb, state=State(Path(tmp) / "s.json"), now=NOW)
            r = done[0]["result"]
            self.assertEqual(r["ads"], 2, "a brand's own ads are all shown, however young")
            self.assertEqual(r["proposals"], 3, "too few posts for a baseline: the best by views are proposed")
            self.assertTrue(any("fewer than" in w for w in r["warnings"]))

    def test_ads_request_by_keyword_and_google(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            fx = {"fb_companies:تصميم داخلي": [], "fb_search_ads:تصميم داخلي": [meta_ad("k1", 90, page="Studio A"), meta_ad("k2", 10, page="Studio B"), meta_ad("k3", 1, page="Studio C")],
                  "g_adv:IKEA": [{"advertiser_id": "AR1", "name": "IKEA", "region": "KW"}], "g_ads:AR1": [{"creativeId": "CR1", "advertiserId": "AR1", "advertiserName": "IKEA", "format": "video", "adUrl": "https://adstransparency.google.com/advertiser/AR1/creative/CR1", "imageUrl": "https://i/x", "firstShown": "2026-06-01T00:00:00.000Z", "lastShown": "2026-09-18T00:00:00.000Z"}]}
            sb = FakeSB([
                {"id": "a1", "kind": "ads", "platform": "meta", "input": "تصميم داخلي", "params": {"country": "KW"}, "status": "queued", "attempts": 0},
                {"id": "a2", "kind": "ads", "platform": "google", "input": "IKEA", "params": {}, "status": "queued", "attempts": 0},
            ])
            done = rq.run_requests(cfg, lambda m: None, sc=FakeSC(fx), sb=sb, state=State(Path(tmp) / "s.json"), now=NOW)
            self.assertEqual([d["status"] for d in done], ["done", "done"])
            meta = done[0]["result"]
            self.assertEqual(meta["matched"], {"keyword": "تصميم داخلي", "country": "KW"})
            self.assertEqual(meta["ads_seen"], 3)
            self.assertEqual(meta["proposals"], 2, "the one-day ad is noise")
            self.assertEqual(meta["longest_days"], 90)
            self.assertEqual(sb.posts["meta_ads:k1"]["tier"], "reverse_engineer")
            self.assertEqual(done[1]["result"]["proposals"], 1)
            self.assertEqual(sb.posts["google_ads:CR1"]["platform"], "google_ads")
            self.assertTrue(all(r["status"] == "done" for r in sb.requests))

    def test_a_failing_request_records_its_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            sb = FakeSB([{"id": "bad", "kind": "profile", "input": "https://www.instagram.com/reel/abc/", "params": {}, "status": "queued", "attempts": 0}])
            done = rq.run_requests(cfg, lambda m: None, sc=FakeSC({}), sb=sb, state=State(Path(tmp) / "s.json"), now=NOW)
            self.assertEqual(done[0]["status"], "failed")
            self.assertIn("not a page", done[0]["error"])
            self.assertEqual(sb.requests[0]["status"], "failed")


if __name__ == "__main__":
    unittest.main()
