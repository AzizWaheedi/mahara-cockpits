"""ScrapeCreators: one REST key, 110 endpoints, credits per request.

Aziz, 2026-09-18: "use the Scrape Creators skill, I gave it the API key".
This is the source behind the on-demand scrapes the cockpit requests:
a creator or brand page on Instagram, TikTok, YouTube, Facebook or
Snapchat (their recent videos with view counts), and the public ad
libraries (Meta's for Facebook and Instagram, Google's Ads Transparency
Center). Every call costs one credit, media downloads and Google ad details
cost more and are never requested here.

Shapes were checked live on 2026-09-18 (see README, "Sources"); every parser
reads defensively because the vendor trims and renames fields between
versions. The key is read by name (SCRAPECREATORS_API_KEY) and never logged.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Optional

from .. import http
from ..models import Post
from ..platforms.base import first, iso_from, to_int

BASE = "https://api.scrapecreators.com"


def _iso(ts: Any) -> Optional[str]:
    if ts in (None, "", 0):
        return None
    if isinstance(ts, (int, float)) and ts > 10_000_000:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return iso_from(ts)


class ScrapeCreators:
    def __init__(self, key: str, *, timeout: float = 90, log: Optional[Callable[[str], None]] = None):
        if not key:
            raise http.HttpError(0, "SCRAPECREATORS_API_KEY is not set")
        self.key = key
        self.timeout = timeout
        self.log = log or (lambda m: None)
        self.calls = 0
        self.credits_charged = 0
        self.credits_remaining: Optional[int] = None

    # ---- plumbing ------------------------------------------------------------
    def get(self, path: str, **params: Any) -> dict[str, Any]:
        query = http.encode_query({k: v for k, v in params.items() if v not in (None, "")})
        url = f"{BASE}{path}" + (f"?{query}" if query else "")
        out = http.get_json(url, headers={"x-api-key": self.key}, timeout=self.timeout, retries=2)
        self.calls += 1
        if not isinstance(out, dict):
            raise http.HttpError(0, f"scrapecreators {path}: no JSON object")
        charged = out.get("credits_charged")
        if isinstance(charged, (int, float)):
            self.credits_charged += int(charged)
        remaining = out.get("credits_remaining")
        if isinstance(remaining, (int, float)):
            self.credits_remaining = int(remaining)
        if out.get("success") is False or out.get("error"):
            raise http.HttpError(int(out.get("errorStatus") or 0), f"scrapecreators {path}: {out.get('message') or out.get('error')}")
        return out

    def credit_balance(self) -> int:
        out = self.get("/v1/credit-balance")
        return int(out.get("creditCount") or 0)

    def _pages(self, path: str, list_key: str, cursor_in: str, cursor_out: str, pages: int, **params: Any) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        cursor: Any = None
        for _ in range(max(1, pages)):
            out = self.get(path, **params, **({cursor_in: cursor} if cursor else {}))
            batch = out.get(list_key) or []
            items.extend(x for x in batch if isinstance(x, dict))
            cursor = out.get(cursor_out)
            if not cursor or not batch or out.get("has_more") is False:
                break
        return items

    # ---- profiles ------------------------------------------------------------
    def instagram_reels(self, handle: str, *, pages: int = 3) -> list[dict[str, Any]]:
        return self._pages("/v1/instagram/user/reels", "items", "max_id", "max_id", pages, handle=handle, trim="true")

    def instagram_profile(self, handle: str) -> dict[str, Any]:
        return self.get("/v1/instagram/profile", handle=handle, trim="true")

    def tiktok_videos(self, handle: str, *, pages: int = 3) -> list[dict[str, Any]]:
        return self._pages("/v3/tiktok/profile/videos", "aweme_list", "max_cursor", "max_cursor", pages, handle=handle, trim="true")

    def tiktok_profile(self, handle: str) -> dict[str, Any]:
        return self.get("/v1/tiktok/profile", handle=handle)

    def youtube_shorts(self, handle: str, *, pages: int = 1) -> list[dict[str, Any]]:
        return self._pages("/v1/youtube/channel/shorts", "shorts", "continuationToken", "continuationToken", pages, handle=handle, sort="popular")

    def youtube_videos(self, handle: str, *, pages: int = 1) -> list[dict[str, Any]]:
        return self._pages("/v1/youtube/channel-videos", "videos", "continuationToken", "continuationToken", pages, handle=handle, sort="popular")

    def facebook_reels(self, url: str, *, pages: int = 2) -> list[dict[str, Any]]:
        out = self.get("/v1/facebook/profile/reels", url=url)
        items = [x for x in (out.get("reels") or out.get("results") or out.get("items") or []) if isinstance(x, dict)]
        cursor = out.get("cursor") or out.get("next_page_id")
        for _ in range(pages - 1):
            if not cursor:
                break
            out = self.get("/v1/facebook/profile/reels", url=url, cursor=cursor)
            more = [x for x in (out.get("reels") or out.get("results") or out.get("items") or []) if isinstance(x, dict)]
            items.extend(more)
            cursor = out.get("cursor") or out.get("next_page_id")
            if not more:
                break
        return items

    def snapchat_profile(self, handle: str) -> dict[str, Any]:
        return self.get("/v1/snapchat/profile", handle=handle)

    # ---- ad libraries ----------------------------------------------------------
    def fb_search_companies(self, query: str) -> list[dict[str, Any]]:
        out = self.get("/v1/facebook/adLibrary/search/companies", query=query)
        return [x for x in (out.get("searchResults") or []) if isinstance(x, dict)]

    def fb_company_ads(self, page_id: str, *, country: str = "", pages: int = 2, status: str = "ACTIVE") -> list[dict[str, Any]]:
        return self._pages("/v1/facebook/adLibrary/company/ads", "results", "cursor", "cursor", pages, pageId=page_id, country=country or None, status=status, trim="true")

    def fb_search_ads(self, query: str, *, country: str = "", pages: int = 2, status: str = "ACTIVE") -> list[dict[str, Any]]:
        return self._pages("/v1/facebook/adLibrary/search/ads", "searchResults", "cursor", "cursor", pages, query=query, country=country or None, status=status, trim="true")

    def fb_ad(self, ad_id: str) -> Optional[dict[str, Any]]:
        try:
            out = self.get("/v1/facebook/adLibrary/ad", id=ad_id, trim="true")
        except http.HttpError:
            try:
                out = self.get("/v1/facebook/adLibrary/ad", url=f"https://www.facebook.com/ads/library/?id={ad_id}", trim="true")
            except http.HttpError:
                return None
        ad = out.get("ad") or out.get("result") or out
        return ad if isinstance(ad, dict) and (ad.get("ad_archive_id") or ad.get("snapshot")) else None

    def google_advertisers(self, query: str, *, region: str = "") -> list[dict[str, Any]]:
        out = self.get("/v1/google/adLibrary/advertisers/search", query=query, region=region or None)
        return [x for x in (out.get("advertisers") or []) if isinstance(x, dict)]

    def google_company_ads(self, advertiser_id: str, *, region: str = "", pages: int = 1) -> list[dict[str, Any]]:
        return self._pages("/v1/google/company/ads", "ads", "cursor", "cursor", pages, advertiser_id=advertiser_id, region=region or None)


# ---------------------------------------------------------------------------
# Parsers: vendor items -> the radar's Post, or an ad row for ideation_posts


def parse_instagram_reels(items: list[dict[str, Any]], handle: str) -> list[Post]:
    out: list[Post] = []
    for it in items:
        code = first(it, "code", "shortcode")
        if not code:
            continue
        cap = it.get("caption")
        caption = cap.get("text") if isinstance(cap, dict) else (cap or "")
        user = it.get("user") if isinstance(it.get("user"), dict) else {}
        out.append(Post(
            platform="instagram", post_id=str(code), url=str(first(it, "url") or f"https://www.instagram.com/reel/{code}/"),
            author_handle=str(user.get("username") or handle).lower(), author_name=str(user.get("full_name") or ""),
            author_followers=to_int(first(user, "follower_count", "followers")),
            posted_at=_iso(first(it, "taken_at", "created_at")),
            views=to_int(first(it, "play_count", "ig_play_count", "view_count")), likes=to_int(first(it, "like_count")),
            comments=to_int(first(it, "comment_count")), caption=str(caption or "")[:3000],
            duration_sec=_num(first(it, "video_duration")), media_url=first(it, "video_url", "video_dash_manifest"),
            thumb_url=first(it, "display_uri", "thumbnail_url"), is_video=True, raw={"source": "scrapecreators"},
        ))
    return out


def parse_tiktok_videos(items: list[dict[str, Any]], handle: str) -> list[Post]:
    out: list[Post] = []
    for it in items:
        vid = first(it, "aweme_id", "id")
        if not vid:
            continue
        st = it.get("statistics") if isinstance(it.get("statistics"), dict) else {}
        video = it.get("video") if isinstance(it.get("video"), dict) else {}
        author = it.get("author") if isinstance(it.get("author"), dict) else {}
        h = str(author.get("unique_id") or handle).lower()
        cover = video.get("cover") if isinstance(video.get("cover"), dict) else {}
        play = video.get("play_addr") if isinstance(video.get("play_addr"), dict) else {}
        out.append(Post(
            platform="tiktok", post_id=str(vid), url=str(first(it, "url") or f"https://www.tiktok.com/@{h}/video/{vid}"),
            author_handle=h, author_name=str(author.get("nickname") or ""), author_followers=to_int(first(author, "follower_count")),
            posted_at=_iso(first(it, "create_time", "create_time_utc")),
            views=to_int(first(st, "play_count")), likes=to_int(first(st, "digg_count")), comments=to_int(first(st, "comment_count")),
            shares=to_int(first(st, "share_count")), saves=to_int(first(st, "collect_count")), caption=str(it.get("desc") or "")[:3000],
            duration_sec=(_num(video.get("duration")) or 0) / 1000.0 if _num(video.get("duration")) and _num(video.get("duration")) > 1000 else _num(video.get("duration")),
            media_url=(play.get("url_list") or [None])[0] if isinstance(play.get("url_list"), list) else None,
            thumb_url=(cover.get("url_list") or [None])[0] if isinstance(cover.get("url_list"), list) else None,
            is_video=True, raw={"source": "scrapecreators", "is_ad": it.get("is_ad")},
        ))
    return out


def parse_youtube(items: list[dict[str, Any]], handle: str) -> list[Post]:
    out: list[Post] = []
    for it in items:
        vid = first(it, "id", "videoId")
        if not vid:
            continue
        ch = it.get("channel") if isinstance(it.get("channel"), dict) else {}
        out.append(Post(
            platform="youtube", post_id=str(vid), url=str(first(it, "url") or f"https://www.youtube.com/watch?v={vid}"),
            author_handle=str(ch.get("handle") or handle).lstrip("@").lower(), author_name=str(ch.get("title") or ""),
            posted_at=_iso(first(it, "publishedTime", "publishDate")),
            views=to_int(first(it, "viewCountInt")), likes=to_int(first(it, "likeCountInt")), comments=to_int(first(it, "commentCountInt")),
            caption=str(first(it, "title") or "")[:300] + ("\n" + str(it.get("description") or "")[:1500] if it.get("description") else ""),
            duration_sec=_num(first(it, "lengthSeconds")), thumb_url=first(it, "thumbnail"), is_video=True, raw={"source": "scrapecreators"},
        ))
    return out


def parse_facebook_reels(items: list[dict[str, Any]], handle: str) -> list[Post]:
    out: list[Post] = []
    for it in items:
        vid = first(it, "id", "reel_id", "video_id")
        if not vid:
            continue
        out.append(Post(
            platform="facebook", post_id=str(vid), url=str(first(it, "url", "permalink") or f"https://www.facebook.com/reel/{vid}"),
            author_handle=handle.lower(), posted_at=_iso(first(it, "publish_time", "created_time", "timestamp")),
            views=to_int(first(it, "play_count", "view_count", "views")), likes=to_int(first(it, "like_count", "likes", "reactions")),
            comments=to_int(first(it, "comment_count", "comments")), caption=str(first(it, "text", "caption", "message") or "")[:3000],
            media_url=first(it, "video_url", "playable_url"), thumb_url=first(it, "thumbnail_url", "thumbnail", "image"), is_video=True,
            raw={"source": "scrapecreators"},
        ))
    return out


def profile_followers(profile: dict[str, Any]) -> Optional[int]:
    data = profile.get("data") if isinstance(profile.get("data"), dict) else profile
    user = data.get("user") if isinstance(data.get("user"), dict) else data
    for k in ("follower_count", "followers", "followers_count", "followerCount", "subscriberCount"):
        v = to_int(user.get(k)) if isinstance(user, dict) else None
        if v is not None:
            return v
    edge = user.get("edge_followed_by") if isinstance(user, dict) and isinstance(user.get("edge_followed_by"), dict) else None
    return to_int(edge.get("count")) if edge else None


def running_days(start: Optional[str], end: Optional[str], now: datetime) -> Optional[int]:
    if not start:
        return None
    try:
        s = datetime.fromisoformat(start.replace("Z", "+00:00"))
        e = datetime.fromisoformat(end.replace("Z", "+00:00")) if end else now
    except ValueError:
        return None
    if e < s:
        e = now
    return max(0, int((min(e, now) - s).total_seconds() // 86400))


def meta_ad_row(ad: dict[str, Any], *, now: datetime) -> Optional[dict[str, Any]]:
    """One Meta Ad Library result as an ideation_posts row (platform meta_ads)."""
    ad_id = str(first(ad, "ad_archive_id", "id") or "")
    if not ad_id:
        return None
    snap = ad.get("snapshot") if isinstance(ad.get("snapshot"), dict) else {}
    body = snap.get("body") if isinstance(snap.get("body"), dict) else {}
    videos = [v for v in (snap.get("videos") or []) if isinstance(v, dict)]
    images = [i for i in (snap.get("images") or []) if isinstance(i, dict)]
    cards = [c for c in (snap.get("cards") or []) if isinstance(c, dict)]
    if not videos and cards:
        videos = [c for c in cards if c.get("video_hd_url") or c.get("video_sd_url")]
        images = images or [c for c in cards if c.get("original_image_url") or c.get("resized_image_url")]
    text_parts = [str(snap.get("title") or ""), str(body.get("text") or ""), str(snap.get("link_description") or "")]
    if not any(text_parts) and cards:
        text_parts = [str(cards[0].get("title") or ""), str(cards[0].get("body") or "")]
    caption = "\n".join(p for p in text_parts if p).strip()[:3000]
    page = str(first(ad, "page_name") or snap.get("page_name") or "")
    started = _iso(first(ad, "start_date_string")) or _iso(first(ad, "start_date"))
    last = _iso(first(ad, "end_date_string")) or _iso(first(ad, "end_date"))
    v0 = videos[0] if videos else {}
    i0 = images[0] if images else {}
    fmt = str(snap.get("display_format") or ("VIDEO" if videos else "IMAGE" if images else "")).lower()
    return {
        "key": f"meta_ads:{ad_id}", "platform": "meta_ads", "post_id": ad_id,
        "url": str(first(ad, "url") or f"https://www.facebook.com/ads/library/?id={ad_id}"),
        "origin": "ads", "status": "proposed",
        "author_handle": page.lower().replace(" ", "_")[:80] if page else "", "author_name": page, "advertiser": page,
        "author_followers": to_int(snap.get("page_like_count")),
        "posted_at": started, "caption": caption,
        "media_url": v0.get("video_hd_url") or v0.get("video_sd_url"), "thumb_url": v0.get("video_preview_image_url") or i0.get("original_image_url") or i0.get("resized_image_url"),
        "is_video": bool(videos),
        "ad_id": ad_id, "ad_page_id": str(first(ad, "page_id") or snap.get("page_id") or ""), "ad_started_at": started, "ad_last_seen_at": last,
        "running_days": running_days(started, last, now), "ad_platforms": [str(p) for p in (ad.get("publisher_platform") or [])],
        "ad_format": fmt, "ad_active": bool(ad.get("is_active", True)),
        "cta": str(snap.get("cta_text") or "") or None,
    }


def google_ad_row(ad: dict[str, Any], *, now: datetime) -> Optional[dict[str, Any]]:
    cid = str(first(ad, "creativeId", "creative_id", "id") or "")
    if not cid:
        return None
    started = _iso(first(ad, "firstShown", "first_shown"))
    last = _iso(first(ad, "lastShown", "last_shown"))
    name = str(first(ad, "advertiserName", "advertiser_name") or "")
    return {
        "key": f"google_ads:{cid}", "platform": "google_ads", "post_id": cid,
        "url": str(first(ad, "adUrl", "url") or f"https://adstransparency.google.com/advertiser/{ad.get('advertiserId')}/creative/{cid}"),
        "origin": "ads", "status": "proposed",
        "author_handle": name.lower().replace(" ", "_")[:80], "author_name": name, "advertiser": name,
        "posted_at": started, "caption": "", "thumb_url": first(ad, "imageUrl", "image_url"), "is_video": str(ad.get("format") or "").lower() == "video",
        "ad_id": cid, "ad_page_id": str(first(ad, "advertiserId", "advertiser_id") or ""), "ad_started_at": started, "ad_last_seen_at": last,
        "running_days": running_days(started, last, now), "ad_platforms": ["GOOGLE"], "ad_format": str(ad.get("format") or "").lower(), "ad_active": True,
    }


def _num(v: Any) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None
