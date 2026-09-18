"""Instagram through Apify.

Default actor apify~instagram-scraper (profile posts, single post by URL,
hashtags). Proven on this box for a single reel on 2026-09-06 (skill
media/social-video-transcription): directUrls + resultsType "posts" returns
caption, ownerUsername, videoDuration and a direct CDN videoUrl.
"""
from __future__ import annotations

from typing import Any, Optional

from ..models import Post
from ..urls import profile_url
from .base import Adapter, first, iso_from, to_int


class Instagram(Adapter):
    platform = "instagram"

    def profile_job(self, handle: str, limit: int) -> tuple[str, dict[str, Any]]:
        return self.cfg.actor_instagram, {
            "directUrls": [profile_url("instagram", handle)],
            "resultsType": "posts",
            "resultsLimit": int(limit),
            "addParentData": False,
            # Pinned posts are old favourites and cost a paid row each.
            "skipPinnedPosts": True,
        }

    def details_job(self, handle: str) -> Optional[tuple[str, dict[str, Any]]]:
        return self.cfg.actor_instagram, {
            "directUrls": [profile_url("instagram", handle)],
            "resultsType": "details",
            "resultsLimit": 1,
            "addParentData": False,
        }

    def hashtag_job(self, tag: str, limit: int) -> tuple[str, dict[str, Any]]:
        actor = self.cfg.actor_instagram_hashtag or self.cfg.actor_instagram
        if actor == self.cfg.actor_instagram:
            return actor, {
                "directUrls": [f"https://www.instagram.com/explore/tags/{tag}/"],
                "resultsType": "posts",
                "resultsLimit": int(limit),
            }
        return actor, {"hashtags": [tag], "resultsLimit": int(limit)}

    def search_job(self, query: str, limit: int) -> tuple[str, dict[str, Any]]:
        """Accounts matching a keyword (checked 2026-09-18: returns username, followersCount, private, latestPosts)."""
        return self.cfg.actor_instagram_search, {"search": query, "searchType": "user", "searchLimit": int(limit)}

    def parse_search(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for it in items:
            if not isinstance(it, dict) or it.get("error"):
                continue
            username = str(first(it, "username", default="") or "").strip().lstrip("@").lower()
            if not username:
                continue
            latest = self.parse_posts([p for p in (it.get("latestPosts") or []) if isinstance(p, dict)], handle=username)
            out.append({
                "username": username,
                "name": str(first(it, "fullName", "full_name", default="") or ""),
                "followers": to_int(first(it, "followersCount", "followers")),
                "posts_count": to_int(first(it, "postsCount", "posts")),
                "private": bool(first(it, "private", "isPrivate", default=False)),
                "verified": bool(first(it, "verified", "isVerified", default=False)),
                "category": str(first(it, "businessCategoryName", default="") or ""),
                "latest": latest,
            })
        return out

    def post_job(self, canonical_url: str) -> tuple[str, dict[str, Any]]:
        return self.cfg.actor_instagram, {
            "directUrls": [canonical_url],
            "resultsType": "posts",
            "resultsLimit": 1,
            "addParentData": False,
        }

    def parse_posts(self, items: list[dict[str, Any]], *, handle: str = "") -> list[Post]:
        out: list[Post] = []
        for it in items:
            if not isinstance(it, dict) or it.get("error"):
                continue
            code = first(it, "shortCode", "shortcode", "code")
            if not code:
                continue
            ptype = str(first(it, "type", default="")).lower()
            product = str(first(it, "productType", default="")).lower()
            is_video = ptype == "video" or product in ("clips", "igtv", "reel") or bool(first(it, "videoUrl"))
            seg = "reel" if is_video else "p"
            url = first(it, "url") or f"https://www.instagram.com/{seg}/{code}/"
            views = to_int(first(it, "videoPlayCount", "videoViewCount", "playCount", "viewCount", "views"))
            owner = first(it, "ownerUsername", "owner.username", "username", default=handle) or handle
            out.append(
                self._post(
                    post_id=str(code),
                    url=str(url),
                    author_handle=str(owner).lower(),
                    author_name=str(first(it, "ownerFullName", "owner.fullName", default="") or ""),
                    author_followers=to_int(first(it, "ownerFollowersCount", "owner.followersCount", "followersCount")),
                    posted_at=iso_from(first(it, "timestamp", "takenAtTimestamp", "taken_at")),
                    views=views,
                    likes=to_int(first(it, "likesCount", "likes")),
                    comments=to_int(first(it, "commentsCount", "comments")),
                    shares=to_int(first(it, "sharesCount", "reshareCount")),
                    saves=to_int(first(it, "savesCount")),
                    caption=str(first(it, "caption", default="") or "")[:3000],
                    duration_sec=_float(first(it, "videoDuration", "duration")),
                    media_url=first(it, "videoUrl", "video_url"),
                    thumb_url=first(it, "displayUrl", "thumbnailUrl", "images.0"),
                    is_pinned=bool(first(it, "isPinned", "pinned", default=False)),
                    is_video=is_video,
                    raw=_trim_raw(it),
                )
            )
        return out

    def parse_details(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        for it in items:
            if isinstance(it, dict) and (it.get("followersCount") is not None or it.get("username")):
                return {
                    "followers": to_int(first(it, "followersCount", "followers")),
                    "name": str(first(it, "fullName", "name", default="") or ""),
                    "posts_count": to_int(first(it, "postsCount")),
                    "verified": bool(first(it, "verified", default=False)),
                }
        return {}


def _float(v: Any) -> Optional[float]:
    try:
        return None if v in (None, "") else float(v)
    except (TypeError, ValueError):
        return None


def _trim_raw(it: dict[str, Any]) -> dict[str, Any]:
    keep = ("id", "type", "productType", "shortCode", "timestamp", "likesCount", "commentsCount", "videoPlayCount", "videoViewCount", "videoDuration", "isPinned", "isSponsored", "musicInfo", "hashtags")
    return {k: it[k] for k in keep if k in it}
