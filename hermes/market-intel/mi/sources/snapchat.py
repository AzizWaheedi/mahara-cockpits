"""Snapchat profiles through tri_angle/snapchat-scraper (USD 0.002 a profile), only for a handle found on the
website or in the Instagram bio. On most Gulf business profiles the subscriber count is hidden and reads "0":
that is "not shown", never zero (the radar's rule).
"""
from __future__ import annotations

from typing import Any, Optional

from ..evidence import Draft
from . import first, to_int

SOURCE = "apify:tri_angle/snapchat-scraper"


def job_input(handle: str) -> dict[str, Any]:
    return {"profilesInput": [handle.lstrip("@")]}


def parse(items: list[dict[str, Any]], handle: str) -> Optional[dict[str, Any]]:
    if not items:
        return None
    it = items[0]
    subs = to_int(first(it, "subscribers", "subscriberCount", "subscriber_count"))
    h = handle.lstrip("@").lower()
    return {"handle": h, "url": f"https://www.snapchat.com/add/{h}", "subscribers": subs if subs else None,
            "subscribersHidden": not subs,
            "spotlights": len(first(it, "spotlights", "spotlightHighlights", default=[]) or [])}


def draft(profile: dict[str, Any], subject: str, usd: float) -> Draft:
    return Draft(kind="snap", subject=subject, source=SOURCE, url=profile["url"], usd=usd, body=profile)
