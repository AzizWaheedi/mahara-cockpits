"""Instagram profiles through apify/instagram-profile-scraper (Apify for Instagram: direct scraping is blocked
from cloud IPs, Aziz 2026-05-15), and the follower count a second time through ScrapeCreators.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from ..evidence import Draft
from . import first, iso, to_int

SOURCE = "apify:apify/instagram-profile-scraper"
SOURCE_SC = "scrapecreators:/v1/instagram/profile"


def job_input(handles: list[str]) -> dict[str, Any]:
    return {"usernames": [h.lstrip("@") for h in handles], "resultsLimit": 12}


def parse(items: list[dict[str, Any]], now: Optional[datetime] = None) -> dict[str, dict[str, Any]]:
    """Per handle (lower case): the profile and its latest posts."""
    now = now or datetime.now(timezone.utc)
    out: dict[str, dict[str, Any]] = {}
    for it in items:
        user = str(first(it, "username", "ownerUsername", default="") or "").lower()
        if not user:
            continue
        posts = []
        for p in (first(it, "latestPosts", default=[]) or [])[:12]:
            if not isinstance(p, dict):
                continue
            posts.append({"date": iso(first(p, "timestamp", "takenAt")), "type": first(p, "type", "productType"),
                          "likes": to_int(first(p, "likesCount", "likes")),
                          "comments": to_int(first(p, "commentsCount", "comments")),
                          "views": to_int(first(p, "videoViewCount", "videoPlayCount")),
                          "url": first(p, "url"), "caption": str(first(p, "caption", default="") or "")[:280]})
        recent = [p for p in posts if p["date"] and datetime.fromisoformat(p["date"].replace("Z", "+00:00")) >= now - timedelta(days=30)]
        out[user] = {"handle": user, "url": f"https://www.instagram.com/{user}/",
                     "followers": to_int(first(it, "followersCount", "followers", "edge_followed_by.count")),
                     "postsCount": to_int(first(it, "postsCount", "mediaCount")),
                     "bio": str(first(it, "biography", "bio", default="") or "")[:400],
                     "externalUrl": first(it, "externalUrl", "external_url"),
                     "isBusiness": first(it, "isBusinessAccount", default=None),
                     "category": first(it, "businessCategoryName", "category"),
                     "posts30d": len(recent) if posts else None, "latestPosts": posts}
    return out


def sc_followers(out: dict[str, Any]) -> Optional[int]:
    return to_int(first(out, "data.user.edge_followed_by.count", "data.user.follower_count", "user.follower_count",
                        "follower_count", "followers"))


def draft(profile: dict[str, Any], subject: str, usd: float) -> Draft:
    return Draft(kind="ig_profile", subject=subject, source=SOURCE, url=profile["url"], usd=usd, body=profile)
