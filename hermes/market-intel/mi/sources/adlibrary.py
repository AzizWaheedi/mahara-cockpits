"""The Meta Ad Library: a page's active ads with how long each has run, and who advertises a service in the
country now. ScrapeCreators first (the radar's door), apify/facebook-ads-scraper second. Meta's own Ad Library
API returns commercial ads only for EU delivery, so Gulf ads come from the scrapers. Running days follow the
radar's locked rule: 7 days proposed, 21 study, 60 reverse engineer.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from ..evidence import Draft
from . import days_between, first, iso

SOURCE_SC = "scrapecreators:/v1/facebook/adLibrary"
SOURCE_APIFY = "apify:apify/facebook-ads-scraper"
TICKS = (7, 21, 60)


def ad(item: dict[str, Any], now: Optional[datetime] = None) -> Optional[dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    ad_id = str(first(item, "ad_archive_id", "adArchiveID", "adArchiveId", "id", default="") or "")
    if not ad_id:
        return None
    snap = item.get("snapshot") if isinstance(item.get("snapshot"), dict) else {}
    body = snap.get("body") if isinstance(snap.get("body"), dict) else {}
    cards = [c for c in (snap.get("cards") or []) if isinstance(c, dict)]
    text = " ".join(x for x in (str(snap.get("title") or ""), str(body.get("text") or ""),
                                str(cards[0].get("body") or "") if cards else "") if x).strip()
    started = iso(first(item, "start_date_string", "start_date", "startDate", "startDateFormatted"))
    last = iso(first(item, "end_date_string", "end_date", "endDate"))
    videos = snap.get("videos") or [c for c in cards if c.get("video_hd_url") or c.get("video_sd_url")]
    return {"adId": ad_id, "url": f"https://www.facebook.com/ads/library/?id={ad_id}",
            "page": str(first(item, "page_name", "pageName", default="") or snap.get("page_name") or "")[:200],
            "pageId": str(first(item, "page_id", "pageId", default="") or snap.get("page_id") or "") or None,
            "startedAt": started, "runningDays": days_between(started, last, now),
            "platforms": [str(p) for p in (first(item, "publisher_platform", "publisherPlatform", default=[]) or [])][:6],
            "format": "video" if videos else str(snap.get("display_format") or "image").lower()[:20],
            "cta": str(snap.get("cta_text") or "")[:60] or None, "text": text[:400],
            "active": bool(first(item, "is_active", "isActive", default=True))}


def parse(items: list[dict[str, Any]], now: Optional[datetime] = None) -> list[dict[str, Any]]:
    out, seen = [], set()
    for it in items:
        a = ad(it, now)
        if a and a["adId"] not in seen and a["active"]:
            seen.add(a["adId"])
            out.append(a)
    return out


def summary(ads: list[dict[str, Any]]) -> dict[str, Any]:
    days = [a["runningDays"] for a in ads if isinstance(a.get("runningDays"), int)]
    return {"activeN": len(ads), "longestDays": max(days) if days else None,
            "over": {str(t): sum(1 for d in days if d >= t) for t in TICKS}}


def apify_input(page_id: Optional[str], query: Optional[str], country: str, limit: int) -> dict[str, Any]:
    q = f"view_all_page_id={page_id}" if page_id else f"q={query}&search_type=keyword_unordered"
    url = f"https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country={country.upper()}&{q}"
    return {"startUrls": [{"url": url}], "resultsLimit": limit, "activeStatus": "active"}


def drafts(ads: list[dict[str, Any]], subject: str, source: str, usd: float) -> list[Draft]:
    each = round(usd / len(ads), 6) if ads else 0.0
    return [Draft(kind="ad", subject=subject, source=source, url=a["url"], usd=each, body=a) for a in ads]


def pick_page(companies: list[dict[str, Any]], name: str, matcher: Any) -> Optional[str]:
    """The Ad Library page id of a business, from a company search, only when the name matches."""
    for c in companies:
        pid = str(first(c, "page_id", "pageId", "id", default="") or "")
        if pid.isdigit() and matcher(first(c, "name", "page_name", default=""), name):
            return pid
    return None
