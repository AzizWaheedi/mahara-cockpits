"""Google Maps places through compass/crawler-google-places: the client's own listing (by its Maps link, else
a search for its name in its city) and the competitor search (what they sell, where they sell it).

The listing's phone is read only to ask the database whether it equals the front desk phone (NAP); it never
goes into the evidence. A place found by search is the client only with two identifiers: the name and either
the website or the phone (the sales research rule); else the client's listing is "not found".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from ..evidence import Draft
from . import domain, first, https, name_match, to_float, to_int

SOURCE = "apify:compass/crawler-google-places"


@dataclass
class Place:
    name: str
    url: Optional[str]
    place_id: Optional[str]
    rating: Optional[float]
    reviews_n: Optional[int]
    categories: list[str]
    website: Optional[str]
    phone: Optional[str]                   # for the NAP check only; never stored
    address: Optional[str]
    city: Optional[str]
    lat: Optional[float]
    lng: Optional[float]
    closed: bool
    hours: list[str] = field(default_factory=list)
    query: Optional[str] = None
    warnings: list[str] = field(default_factory=list)

    def facts(self) -> dict[str, Any]:
        return {"name": self.name, "placeId": self.place_id, "rating": self.rating, "reviewsN": self.reviews_n,
                "categories": self.categories, "website": self.website, "address": self.address, "city": self.city,
                "location": {"lat": self.lat, "lng": self.lng} if self.lat is not None and self.lng is not None else None,
                "closed": self.closed, "hours": self.hours[:7], "query": self.query}


def place_input(maps_link: str, language: str = "en") -> dict[str, Any]:
    return {"startUrls": [{"url": maps_link}], "maxCrawledPlacesPerSearch": 1, "language": language,
            "maxReviews": 0, "maxImages": 0, "scrapePlaceDetailPage": True, "skipClosedPlaces": False}


def search_input(query: str, location: str, *, language: str, max_places: int) -> dict[str, Any]:
    return {"searchStringsArray": [query], "locationQuery": location, "maxCrawledPlacesPerSearch": max_places,
            "language": language, "maxReviews": 0, "maxImages": 0, "scrapePlaceDetailPage": False,
            "skipClosedPlaces": True}


def parse(items: list[dict[str, Any]], query: Optional[str] = None) -> list[Place]:
    out: list[Place] = []
    for it in items:
        name = str(first(it, "title", "name", default="") or "").strip()
        if not name:
            continue
        warnings = []
        rating = to_float(first(it, "totalScore", "rating", "stars"))
        reviews = to_int(first(it, "reviewsCount", "reviewCount", "userRatingsTotal"))
        if rating is None:
            warnings.append(f"Maps place {name[:40]}: no rating field")
        if reviews is None:
            warnings.append(f"Maps place {name[:40]}: no review count field")
        cats = first(it, "categories", default=None)
        categories = [str(c) for c in cats] if isinstance(cats, list) else []
        main = first(it, "categoryName", "category")
        if main and str(main) not in categories:
            categories.insert(0, str(main))
        hours = []
        for h in first(it, "openingHours", default=[]) or []:
            if isinstance(h, dict) and h.get("day"):
                hours.append(f"{h.get('day')}: {h.get('hours')}")
        url = https(first(it, "url", "placeUrl", "googleMapsUrl"))
        out.append(Place(
            name=name[:200], url=url, place_id=str(first(it, "placeId", "place_id", default="") or "") or None,
            rating=rating, reviews_n=reviews, categories=categories[:8],
            website=https(first(it, "website", "webSite", "domain")),
            phone=str(first(it, "phoneUnformatted", "phone", default="") or "") or None,
            address=str(first(it, "address", "street", default="") or "")[:300] or None,
            city=str(first(it, "city", default="") or "") or None,
            lat=to_float(first(it, "location.lat", "latitude")), lng=to_float(first(it, "location.lng", "longitude")),
            closed=bool(first(it, "permanentlyClosed", "isPermanentlyClosed", default=False)),
            hours=hours, query=query, warnings=warnings))
    return out


def draft(place: Place, subject: str, usd: float = 0.0) -> Draft:
    return Draft(kind="maps_place", subject=subject, source=SOURCE, url=place.url, usd=usd, body=place.facts())


def identify(places: list[Place], *, business_name: Optional[str], website: Optional[str], from_link: bool,
             phone_matches: Any) -> tuple[Optional[Place], str]:
    """The client's own listing, with the rule it passed, or (None, why not)."""
    if from_link:
        if len(places) == 1:
            return places[0], "the client's own Maps link"
        return None, "the client's Maps link did not open exactly one place"
    site = domain(website) if website else None
    for p in places:
        if not name_match(p.name, business_name):
            continue
        if site and p.website and domain(p.website) == site:
            return p, "name and website match"
        if p.phone and phone_matches(p.phone) == "match":
            return p, "name and phone match"
    return None, "no place matched the name and the website or phone (two identifiers are needed)"
