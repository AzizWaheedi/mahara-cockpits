"""TikTok through Apify. Default actor clockworks~tiktok-scraper (profiles,
hashtags, single post URLs). Named as the TikTok source by the Radar scanner
of May 2026; field names below are the actor's documented output with
fallbacks for older spellings.
"""
from __future__ import annotations

from typing import Any, Optional

from ..models import Post
from .base import Adapter, first, iso_from, to_int


def _common(cfg_limit: int) -> dict[str, Any]:
    return {
        "resultsPerPage": int(cfg_limit),
        "shouldDownloadVideos": False,
        "shouldDownloadCovers": False,
        "shouldDownloadSubtitles": False,
        "shouldDownloadSlideshowImages": False,
    }


class TikTok(Adapter):
    platform = "tiktok"

    def profile_job(self, handle: str, limit: int) -> tuple[str, dict[str, Any]]:
        job = _common(limit)
        job.update({"profiles": [handle.lstrip("@")], "profileSorting": "latest", "profileScrapeSections": ["videos"], "excludePinnedPosts": False})
        return self.cfg.actor_tiktok, job

    def hashtag_job(self, tag: str, limit: int) -> tuple[str, dict[str, Any]]:
        job = _common(limit)
        job.update({"hashtags": [tag.lstrip("#")]})
        return self.cfg.actor_tiktok, job

    def post_job(self, canonical_url: str) -> tuple[str, dict[str, Any]]:
        job = _common(1)
        job.update({"postURLs": [canonical_url]})
        return self.cfg.actor_tiktok, job

    def parse_posts(self, items: list[dict[str, Any]], *, handle: str = "") -> list[Post]:
        out: list[Post] = []
        for it in items:
            if not isinstance(it, dict) or it.get("error"):
                continue
            vid = first(it, "id", "videoId", "itemId")
            if not vid:
                continue
            author = str(first(it, "authorMeta.name", "author.uniqueId", "author.name", "authorName", default=handle) or handle).lower()
            url = first(it, "webVideoUrl", "url") or f"https://www.tiktok.com/@{author}/video/{vid}"
            media_url = first(it, "mediaUrls.0", "videoMeta.downloadAddr", "video.downloadAddr", "video.playAddr", "videoUrl")
            out.append(
                self._post(
                    post_id=str(vid),
                    url=str(url),
                    author_handle=author,
                    author_name=str(first(it, "authorMeta.nickName", "author.nickname", default="") or ""),
                    author_followers=to_int(first(it, "authorMeta.fans", "authorStats.followerCount", "author.followerCount")),
                    posted_at=iso_from(first(it, "createTimeISO", "createTime", "createdAt")),
                    views=to_int(first(it, "playCount", "stats.playCount", "views")),
                    likes=to_int(first(it, "diggCount", "stats.diggCount", "likes")),
                    comments=to_int(first(it, "commentCount", "stats.commentCount")),
                    shares=to_int(first(it, "shareCount", "stats.shareCount")),
                    saves=to_int(first(it, "collectCount", "stats.collectCount")),
                    caption=str(first(it, "text", "desc", "description", default="") or "")[:3000],
                    duration_sec=_float(first(it, "videoMeta.duration", "video.duration")),
                    media_url=media_url,
                    thumb_url=first(it, "videoMeta.coverUrl", "videoMeta.originalCoverUrl", "video.cover", "coverUrl"),
                    is_pinned=bool(first(it, "isPinned", "pinned", default=False)),
                    is_video=not bool(first(it, "isSlideshow", "imagePost", default=False)),
                    raw=_trim_raw(it),
                )
            )
        return out

    def parse_details(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        for it in items:
            fans = to_int(first(it, "authorMeta.fans", "authorStats.followerCount"))
            if fans is not None:
                return {"followers": fans, "name": str(first(it, "authorMeta.nickName", default="") or "")}
        return {}


def _float(v: Any) -> Optional[float]:
    try:
        return None if v in (None, "") else float(v)
    except (TypeError, ValueError):
        return None


def _trim_raw(it: dict[str, Any]) -> dict[str, Any]:
    keep = ("id", "createTimeISO", "playCount", "diggCount", "shareCount", "commentCount", "collectCount", "isPinned", "isAd", "hashtags", "musicMeta")
    out = {k: it[k] for k in keep if k in it}
    if isinstance(it.get("videoMeta"), dict):
        out["videoMeta"] = {k: it["videoMeta"].get(k) for k in ("duration", "height", "width")}
    return out
