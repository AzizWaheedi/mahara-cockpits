"""YouTube through Apify. Default actor streamers~youtube-channel-scraper
(channel pages and single video links; pay per video, about USD 0.001 each,
so a channel's last thirty videos cost a few cents a week).

Long-form only. Shorts and streams are switched off in the job: the point of
watching a competitor on YouTube is the titles, thumbnails and topics of the
videos they put real work into, and their shorts are the same clips that the
Instagram and TikTok adapters already read on the same accounts.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from ..models import Post
from .base import Adapter, first, iso_from, to_int

_CHANNEL_ID = re.compile(r"^UC[A-Za-z0-9_-]{22}$")
_VIDEO_ID = re.compile(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/)|youtu\.be/)([A-Za-z0-9_-]{6,20})", re.I)
_HANDLE_IN_URL = re.compile(r"youtube\.com/@([A-Za-z0-9._-]+)", re.I)


def channel_url(value: str) -> str:
    """A watchlist value as the channel's Videos page.

    Accepts what people paste: `@handle`, `handle`, a `UC…` channel id, or any
    link to the channel (with or without /videos, /shorts, /about on the end).
    """
    v = (value or "").strip()
    if v.lower().startswith("http"):
        v = v.split("?")[0].split("#")[0].rstrip("/")
        for tail in ("/videos", "/shorts", "/streams", "/featured", "/about", "/community"):
            if v.lower().endswith(tail):
                v = v[: -len(tail)]
                break
        return f"{v}/videos"
    if _CHANNEL_ID.match(v):
        return f"https://www.youtube.com/channel/{v}/videos"
    return f"https://www.youtube.com/@{v.lstrip('@')}/videos"


def duration_seconds(value: Any) -> Optional[float]:
    """Seconds from a number, a numeric string or the actor's `HH:MM:SS`."""
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if s.replace(".", "", 1).isdigit():
        return float(s)
    parts = s.split(":")
    if 1 <= len(parts) <= 3 and all(p.strip().isdigit() for p in parts):
        total = 0.0
        for p in parts:
            total = total * 60 + float(p)
        return total
    return None


def _handle_from(it: dict[str, Any], fallback: str) -> str:
    url = str(first(it, "channelUrl", "channel.url", default="") or "")
    m = _HANDLE_IN_URL.search(url)
    if m:
        return m.group(1).lower()
    fb = (fallback or "").strip()
    m = _HANDLE_IN_URL.search(fb)
    if m:
        return m.group(1).lower()
    return fb.lstrip("@").lower()


class YouTube(Adapter):
    platform = "youtube"

    def _job(self, url: str, limit: int) -> dict[str, Any]:
        return {
            "startUrls": [{"url": url}],
            "maxResults": int(limit),
            "maxResultsShorts": 0,
            "maxResultStreams": 0,
            "sortVideosBy": "NEWEST",
        }

    def profile_job(self, handle: str, limit: int) -> tuple[str, dict[str, Any]]:
        return self.cfg.actor_youtube, self._job(channel_url(handle), limit)

    def post_job(self, canonical_url: str) -> tuple[str, dict[str, Any]]:
        return self.cfg.actor_youtube, self._job(canonical_url, 1)

    def parse_posts(self, items: list[dict[str, Any]], *, handle: str = "") -> list[Post]:
        out: list[Post] = []
        for it in items:
            if not isinstance(it, dict) or it.get("error"):
                continue
            vid = first(it, "id", "videoId")
            if not vid:
                m = _VIDEO_ID.search(str(first(it, "url", default="") or ""))
                vid = m.group(1) if m else None
            if not vid:
                continue
            kind = str(first(it, "type", default="") or "").lower()
            if kind in ("short", "shorts", "stream", "live"):
                continue
            title = str(first(it, "title", default="") or "")
            desc = str(first(it, "text", "description", default="") or "")
            caption = title if not desc else f"{title}\n\n{desc[:1500]}"
            out.append(
                self._post(
                    post_id=str(vid),
                    url=str(first(it, "url", default="") or f"https://www.youtube.com/watch?v={vid}"),
                    author_handle=_handle_from(it, handle),
                    author_name=str(first(it, "channelName", "channel.name", default="") or ""),
                    author_followers=to_int(first(it, "numberOfSubscribers", "subscriberCount", "channel.subscribers")),
                    posted_at=iso_from(first(it, "date", "publishedAt", "uploadDate", "publishedTime")),
                    views=to_int(first(it, "viewCount", "views", "viewCountInt")),
                    likes=to_int(first(it, "likes", "likeCount", "likeCountInt")),
                    comments=to_int(first(it, "commentsCount", "commentCount", "commentCountInt")),
                    caption=caption[:3000],
                    duration_sec=duration_seconds(first(it, "duration", "lengthSeconds")),
                    thumb_url=first(it, "thumbnailUrl", "thumbnail"),
                    is_video=True,
                    raw={"title": title[:200], "type": kind or "video"},
                )
            )
        return out

    def parse_details(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        for it in items:
            if isinstance(it, dict):
                subs = to_int(first(it, "numberOfSubscribers", "subscriberCount"))
                if subs is not None:
                    return {"followers": subs}
        return {}
