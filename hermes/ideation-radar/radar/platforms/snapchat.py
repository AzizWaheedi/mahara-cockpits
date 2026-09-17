"""Snapchat: best effort until an Apify actor is verified.

No Snapchat recipe exists anywhere in Mahara's context (checked 2026-09-17).
Public profile pages on snapchat.com expose a JSON blob (__NEXT_DATA__) with
Spotlight and story entries; this adapter reads it for a single pasted link
and, when RADAR_ACTOR_SNAPCHAT is set to a verified actor, runs that actor
for profile scans with the same tolerant mapping. Everything here carries a
warning so nobody mistakes a partial signal for a measured one.
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


class Snapchat(Adapter):
    platform = "snapchat"

    def profile_job(self, handle: str, limit: int) -> tuple[str, dict[str, Any]]:
        if not self.cfg.actor_snapchat:
            raise PlatformError("snapchat: no actor configured (set RADAR_ACTOR_SNAPCHAT to a verified Apify actor)")
        return self.cfg.actor_snapchat, {"profiles": [handle.lstrip("@")], "urls": [profile_url("snapchat", handle)], "maxItems": int(limit), "resultsLimit": int(limit)}

    def post_job(self, canonical_url: str) -> tuple[str, dict[str, Any]]:
        if not self.cfg.actor_snapchat:
            raise PlatformError("snapchat: no actor configured; use fetch_public_page for a single link")
        return self.cfg.actor_snapchat, {"urls": [canonical_url], "maxItems": 1, "resultsLimit": 1}

    def parse_posts(self, items: list[dict[str, Any]], *, handle: str = "") -> list[Post]:
        out: list[Post] = []
        for it in items:
            if not isinstance(it, dict):
                continue
            pid = first(it, "id", "storyId", "spotlightId", "snapId", "videoId")
            url = first(it, "url", "shareUrl", "webUrl")
            if not pid and url:
                pid = str(url).rstrip("/").split("/")[-1].split("?")[0]
            if not pid:
                continue
            author = str(first(it, "username", "author.username", "profile.username", "creator", default=handle) or handle).lower()
            out.append(
                self._post(
                    post_id=str(pid),
                    url=str(url or f"https://www.snapchat.com/spotlight/{pid}"),
                    author_handle=author,
                    author_name=str(first(it, "displayName", "author.displayName", default="") or ""),
                    author_followers=to_int(first(it, "subscriberCount", "subscribers", "followers")),
                    posted_at=iso_from(first(it, "timestamp", "createdAt", "publishedAt", "uploadDate")),
                    views=to_int(first(it, "viewCount", "views", "playCount", "stats.viewCount")),
                    likes=to_int(first(it, "likeCount", "likes", "favoriteCount")),
                    comments=to_int(first(it, "commentCount", "comments")),
                    shares=to_int(first(it, "shareCount", "shares")),
                    caption=str(first(it, "description", "caption", "title", default="") or "")[:3000],
                    duration_sec=_float(first(it, "duration", "durationSec", "videoMeta.duration")),
                    media_url=first(it, "videoUrl", "contentUrl", "mediaUrl", "video.url"),
                    thumb_url=first(it, "thumbnailUrl", "posterUrl", "coverUrl"),
                    is_video=True,
                    raw={k: it[k] for k in list(it.keys())[:20]},
                )
            )
        return out

    # ---- single link without an actor --------------------------------
    def fetch_public_page(self, canonical_url: str) -> tuple[Optional[Post], list[str]]:
        """Read snapchat.com's embedded JSON for one Spotlight or story link."""
        warnings = ["Snapchat metadata read from the public page; view counts may be missing or rounded"]
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
        found: dict[str, Any] = {}
        _walk(data, found)
        if not found.get("media_url"):
            return None, warnings + ["no video URL in the Snapchat page data"]
        pid = canonical_url.rstrip("/").split("/")[-1].split("?")[0]
        post = self._post(
            post_id=pid,
            url=canonical_url,
            author_handle=str(found.get("username") or "").lower(),
            author_name=str(found.get("display_name") or ""),
            author_followers=to_int(found.get("subscribers")),
            posted_at=iso_from(found.get("posted_at")),
            views=to_int(found.get("views")),
            caption=str(found.get("caption") or "")[:3000],
            media_url=found.get("media_url"),
            thumb_url=found.get("thumb_url"),
            duration_sec=_float(found.get("duration")),
            fetched_at=now_iso(),
            raw={},
        )
        return post, warnings


_KEYS = {
    "media_url": ("contentUrl", "videoUrl", "mediaUrl", "playbackUrl"),
    "thumb_url": ("thumbnailUrl", "posterUrl", "previewUrl"),
    "views": ("viewCount", "views", "playCount"),
    "username": ("username", "userName", "handle"),
    "display_name": ("displayName", "title"),
    "subscribers": ("subscriberCount", "subscribers"),
    "posted_at": ("uploadDate", "publishedAt", "createdAt", "timestamp"),
    "caption": ("description", "caption"),
    "duration": ("duration", "durationMs"),
}


def _walk(node: Any, found: dict[str, Any], depth: int = 0) -> None:
    if depth > 12:
        return
    if isinstance(node, dict):
        for field, names in _KEYS.items():
            if field in found:
                continue
            for n in names:
                v = node.get(n)
                if v not in (None, "", [], {}):
                    if field in ("media_url", "thumb_url") and not str(v).startswith("http"):
                        continue
                    if field == "duration" and n == "durationMs":
                        v = float(v) / 1000.0
                    found[field] = v
                    break
        for v in node.values():
            _walk(v, found, depth + 1)
    elif isinstance(node, list):
        for v in node:
            _walk(v, found, depth + 1)


def _float(v: Any) -> Optional[float]:
    try:
        return None if v in (None, "") else float(v)
    except (TypeError, ValueError):
        return None
