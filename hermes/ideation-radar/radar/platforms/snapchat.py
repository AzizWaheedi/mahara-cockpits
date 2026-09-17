"""Snapchat: Spotlight clips only, through Apify.

What the public page really exposes (checked logged out from a Kuwait IP on
2026-09-17): a profile shows its subscriber count and its latest 18 or 19
Spotlight clips with a view count, a share count, an upload time and a plain
MP4 link; public Story snaps carry no view count anywhere. On most Gulf
business profiles the view count is hidden (-1) and the subscriber count is
"0", so a Snapchat baseline is often thin: hidden and zero counts are
ignored, and a clip whose count is visible at all is already a signal.

Actors (the most run ones): tri_angle/snapchat-scraper for profiles
(`profilesInput`, USD 0.002 a profile; spotlights nested in the profile row)
and tri_angle/snapchat-spotlight-scraper for a pasted Spotlight link
(`spotlightUrls`, USD 0.0015 a clip). Hashtags need another actor
(crawlerbros/snapchat-hashtag-scraper) and are not wired here. Other actors
(parseforge, piotrv1001, memo23, crawlerbros) return flat rows; the tolerant
mapping below reads those too.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from .. import http
from ..models import Post
from ..urls import profile_url
from .base import Adapter, PlatformError, first, iso_from, now_iso, to_int

_NEXT = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)


def _views(v: Any) -> Optional[int]:
    n = to_int(v)
    # -1 is Snapchat's "hidden"; 0 is a clip too fresh to have a count.
    return None if n is None or n <= 0 else n


class Snapchat(Adapter):
    platform = "snapchat"

    def profile_job(self, handle: str, limit: int) -> tuple[str, dict[str, Any]]:
        if not self.cfg.actor_snapchat:
            raise PlatformError("snapchat: no actor configured (RADAR_ACTOR_SNAPCHAT)")
        # tri_angle takes usernames or profile URLs; other actors use `usernames`
        # or `profileUrls`. A bare username is what all of them accept.
        return self.cfg.actor_snapchat, {"profilesInput": [handle.lstrip("@")]}

    def hashtag_job(self, tag: str, limit: int) -> tuple[str, dict[str, Any]]:
        raise PlatformError("snapchat: hashtag scans are not wired (needs crawlerbros/snapchat-hashtag-scraper)")

    def post_job(self, canonical_url: str) -> tuple[str, dict[str, Any]]:
        if "/spotlight/" not in canonical_url:
            raise PlatformError("snapchat: only Spotlight links can be fetched; stories have no public counts")
        if not self.cfg.actor_snapchat_post:
            raise PlatformError("snapchat: no spotlight actor configured (RADAR_ACTOR_SNAPCHAT_POST)")
        return self.cfg.actor_snapchat_post, {"spotlightUrls": [canonical_url]}

    def parse_posts(self, items: list[dict[str, Any]], *, handle: str = "") -> list[Post]:
        out: list[Post] = []
        for it in items:
            if not isinstance(it, dict) or it.get("error"):
                continue
            nested = first(it, "spotlights", "spotlightHighlights", "spotlight_1", "videos")
            if isinstance(nested, list):
                owner = str(first(it, "username1", "username", "profile.username", default=handle) or handle).lower()
                if not owner and it.get("profileUrl"):
                    owner = str(it["profileUrl"]).rstrip("/").split("/")[-1].lstrip("@").lower()
                followers = to_int(first(it, "subscribers", "subscriberCount", "subscriber_count"))
                if followers == 0:
                    followers = None  # "0" means hidden on Snapchat
                for sp in nested:
                    p = self._spotlight(sp, owner, followers)
                    if p:
                        out.append(p)
                continue
            p = self._spotlight(it, handle, None)
            if p:
                out.append(p)
        return out

    def _spotlight(self, sp: Any, owner: str, followers: Optional[int]) -> Optional[Post]:
        if not isinstance(sp, dict):
            return None
        pid = first(sp, "id", "storyId", "snapId", "spotlightId", "snap_id", "videoId")
        url = first(sp, "url", "deeplink", "shareUrl", "snap_url", "webUrl")
        if not pid and url:
            pid = str(url).rstrip("/").split("/")[-1].split("?")[0]
        if not pid:
            return None
        snaps = sp.get("snaps") if isinstance(sp.get("snaps"), list) else []
        snap0 = snaps[0] if snaps and isinstance(snaps[0], dict) else {}
        creator = sp.get("creator") if isinstance(sp.get("creator"), dict) else {}
        author = str(first(creator, "username", default="") or first(sp, "creator_username", "username", default=owner) or owner).lower()
        author_followers = to_int(first(creator, "followerCount", "subscriberCount")) or followers
        if author_followers == 0:
            author_followers = None
        posted = first(sp, "dateUploaded", "uploadDateMs", "uploadedAt", "upload_date", "timestamp", "createdAt") or snap0.get("timestamp")
        media = first(sp, "contentUrl", "mediaUrl", "videoUrl", "video_url_unwatermarked", "video_url") or snap0.get("mediaUrl")
        thumb = first(sp, "thumbnailUrl", "previewUrl", "thumbnail_url") or snap0.get("previewUrl")
        duration_ms = to_int(first(sp, "durationMs"))
        return self._post(
            post_id=str(pid),
            url=str(url or f"https://www.snapchat.com/spotlight/{pid}"),
            author_handle=author,
            author_name=str(first(creator, "name", default="") or first(sp, "creator_display_name", "displayName", default="") or ""),
            author_followers=author_followers,
            posted_at=iso_from(posted),
            views=_views(first(sp, "views", "viewCount", "view_count", "playCount", "engagementStats.viewCount")),
            likes=to_int(first(sp, "likeCount", "like_count", "boostCount")),
            comments=to_int(first(sp, "commentCount", "comment_count", "engagementStats.commentCount")),
            shares=to_int(first(sp, "shareCount", "share_count", "engagementStats.shareCount")),
            caption=str(first(sp, "description", "videoDescription", "title", "caption", "embeddedTextCaption", default="") or "")[:3000],
            duration_sec=(duration_ms / 1000.0) if duration_ms else _float(first(sp, "duration", "durationSec")),
            media_url=media,
            thumb_url=thumb,
            is_video=True,
            raw={"hashtags": sp.get("hashtags"), "embeddedTextCaption": sp.get("embeddedTextCaption"), "llmDescription": sp.get("llmDescription")},
        )

    def parse_details(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        for it in items:
            if isinstance(it, dict):
                subs = to_int(first(it, "subscribers", "subscriberCount"))
                if subs:
                    return {"followers": subs}
        return {}

    # ---- single link without an actor ---------------------------------------
    def fetch_public_page(self, canonical_url: str) -> tuple[Optional[Post], list[str]]:
        """Read snapchat.com's embedded JSON for one Spotlight link (no actor)."""
        warnings = ["Snapchat metadata read from the public page; a hidden view count (-1) cannot be recovered"]
        try:
            _, _, body = http.request("GET", canonical_url, timeout=30, retries=1, headers={"Accept-Language": "en"})
        except http.HttpError as e:
            return None, warnings + [f"Snapchat page fetch failed: {e}"]
        html = body.decode("utf-8", "replace")
        m = _NEXT.search(html)
        if not m:
            return None, warnings + ["Snapchat page had no __NEXT_DATA__ block (blocked or layout changed)"]
        try:
            data = json.loads(m.group(1))
        except json.JSONDecodeError:
            return None, warnings + ["Snapchat page JSON unreadable"]
        props = (data.get("props") or {}).get("pageProps") or {}
        vm = props.get("videoMetadata") if isinstance(props.get("videoMetadata"), dict) else None
        if not vm:
            return None, warnings + ["no videoMetadata in the Snapchat page (not a Spotlight page?)"]
        creator = vm.get("creator") if isinstance(vm.get("creator"), dict) else {}
        pid = canonical_url.rstrip("/").split("/")[-1].split("?")[0]
        duration_ms = to_int(vm.get("durationMs"))
        post = self._post(
            post_id=pid,
            url=canonical_url,
            author_handle=str(creator.get("username") or "").lower(),
            author_name=str(creator.get("name") or ""),
            author_followers=(to_int(creator.get("followerCount")) or None),
            posted_at=iso_from(vm.get("uploadDateMs")),
            views=_views(vm.get("viewCount")),
            shares=to_int(vm.get("shareCount")),
            caption=str(vm.get("description") or vm.get("name") or "")[:3000],
            media_url=vm.get("contentUrl"),
            thumb_url=vm.get("thumbnailUrl"),
            duration_sec=(duration_ms / 1000.0) if duration_ms else None,
            fetched_at=now_iso(),
            raw={"embeddedTextCaption": vm.get("embeddedTextCaption"), "keywords": vm.get("keywords")},
        )
        return post, warnings


def _float(v: Any) -> Optional[float]:
    try:
        return None if v in (None, "") else float(v)
    except (TypeError, ValueError):
        return None
