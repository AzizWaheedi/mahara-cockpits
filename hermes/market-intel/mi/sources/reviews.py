"""Google reviews through compass/Google-Maps-Reviews-Scraper, newest first, all languages, owner replies.

Only the text, the stars, the date, the language and whether the owner replied are copied; the reviewer is
never read (personalData off in the input, and the adapter copies no other key). The place header the actor
repeats on each item (rating, review count) is the second source for those two numbers.
"""
from __future__ import annotations

from typing import Any, Optional

from ..evidence import Draft
from . import first, iso, to_float, to_int

SOURCE = "apify:compass/Google-Maps-Reviews-Scraper"


def job_input(place_url: str, max_reviews: int, language: str = "en") -> dict[str, Any]:
    return {"startUrls": [{"url": place_url}], "maxReviews": max_reviews, "reviewsSort": "newest",
            "language": language, "personalData": False, "reviewsOrigin": "google"}


def parse(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    reviews: list[dict[str, Any]] = []
    header: dict[str, Any] = {}
    for it in items:
        if not header:
            header = {"rating": to_float(first(it, "totalScore", "placeRating")),
                      "reviewsN": to_int(first(it, "reviewsCount", "placeReviewsCount")),
                      "placeUrl": first(it, "url", "placeUrl")}
        text = str(first(it, "text", "reviewText", "textTranslated", default="") or "").strip()
        stars = to_int(first(it, "stars", "rating"))
        if not text and stars is None:
            continue
        reviews.append({
            "text": text[:1000], "stars": stars, "date": iso(first(it, "publishedAtDate", "publishAt", "date")),
            "lang": str(first(it, "originalLanguage", "language", default="") or "") or None,
            "ownerReplied": bool(first(it, "responseFromOwnerText", "ownerResponse", default=None)),
        })
    return reviews, header


def drafts(reviews: list[dict[str, Any]], subject: str, place_url: Optional[str], usd: float) -> list[Draft]:
    """One evidence item per review (the cost is spread), so a claim can cite the review it rests on."""
    each = round(usd / len(reviews), 6) if reviews else 0.0
    return [Draft(kind="review", subject=subject, source=SOURCE, url=place_url, usd=each, body=r) for r in reviews]
