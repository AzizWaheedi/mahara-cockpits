"""Facebook pages through apify/facebook-pages-scraper: the page id (for the Ad Library), its category, likes
and followers, its website, and whether Facebook says it is running ads. The page's phone, email and address
are never copied.
"""
from __future__ import annotations

from typing import Any

from ..evidence import Draft
from . import first, https, to_float, to_int

SOURCE = "apify:apify/facebook-pages-scraper"


def job_input(urls: list[str]) -> dict[str, Any]:
    return {"startUrls": [{"url": u} for u in urls]}


def parse(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for it in items:
        url = https(first(it, "facebookUrl", "pageUrl", "url"))
        if not url:
            continue
        status = str(first(it, "ad_status", "adStatus", default="") or "")
        running = None
        if status:
            running = "currently running ads" in status.lower() or "is running ads" in status.lower()
        cats = first(it, "categories", default=[])
        out.append({"url": url, "name": str(first(it, "title", "pageName", "name", default="") or "")[:200],
                    "pageId": str(first(it, "pageAdLibrary.id", "pageId", "facebookId", "id", default="") or "") or None,
                    "categories": [str(c) for c in cats][:6] if isinstance(cats, list) else [],
                    "likes": to_int(first(it, "likes", "likesCount")),
                    "followers": to_int(first(it, "followers", "followersCount")),
                    "website": https(first(it, "website", "websites.0")),
                    "rating": to_float(first(it, "rating", "ratingOverall")),
                    "runningAds": running, "intro": str(first(it, "intro", "about", default="") or "")[:300]})
    return out


def draft(page: dict[str, Any], subject: str, usd: float) -> Draft:
    return Draft(kind="fb_page", subject=subject, source=SOURCE, url=page["url"], usd=usd, body=page)
