"""TikTok profiles through clockworks/tiktok-profile-scraper (USD 0.002 a result), only for a handle found on
the website or in the Instagram bio. No TikTok ad library: it is public for Europe only (radar note 2026-09-18).
"""
from __future__ import annotations

from typing import Any, Optional

from ..evidence import Draft
from . import first, iso, to_int

SOURCE = "apify:clockworks/tiktok-profile-scraper"


def job_input(handle: str, limit: int) -> dict[str, Any]:
    return {"profiles": [handle.lstrip("@")], "resultsPerPage": limit, "profileSorting": "latest",
            "profileScrapeSections": ["videos"], "excludePinnedPosts": True, "shouldDownloadVideos": False,
            "shouldDownloadCovers": False, "shouldDownloadSubtitles": False, "shouldDownloadSlideshowImages": False}


def parse(items: list[dict[str, Any]], handle: str) -> Optional[dict[str, Any]]:
    if not items:
        return None
    followers = None
    videos = []
    for it in items:
        followers = followers if followers is not None else to_int(first(it, "authorMeta.fans", "authorMeta.followers"))
        videos.append({"date": iso(first(it, "createTimeISO", "createTime")), "plays": to_int(first(it, "playCount")),
                       "likes": to_int(first(it, "diggCount", "likes")), "url": first(it, "webVideoUrl", "url")})
    h = handle.lstrip("@").lower()
    return {"handle": h, "url": f"https://www.tiktok.com/@{h}", "followers": followers, "videos": videos[:20]}


def draft(profile: dict[str, Any], subject: str, usd: float) -> Draft:
    return Draft(kind="tiktok", subject=subject, source=SOURCE, url=profile["url"], usd=usd, body=profile)
