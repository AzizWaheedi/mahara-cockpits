"""Competitor discovery, in code: the search plan (what they sell, where they sell it, in Arabic and English),
then a score for every candidate and a shortlist of 25. The model only picks from the shortlist.

The Arabic search words are an industry glossary (search terms, not interface copy). A candidate is never the
client itself, never a business a person marked "Not a competitor" on an earlier run, never permanently closed.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from .sources import domain, name_match, norm_name

COUNTRIES = {"KW": ("Kuwait", "kw"), "SA": ("Saudi Arabia", "sa"), "AE": ("United Arab Emirates", "ae"),
             "QA": ("Qatar", "qa"), "BH": ("Bahrain", "bh"), "OM": ("Oman", "om")}
# English service words -> the Arabic a Gulf customer searches with.
GLOSSARY = (
    ("design and build", "تصميم وتنفيذ"), ("interior design", "تصميم داخلي"), ("interior", "تصميم داخلي"),
    ("architectural design", "تصميم معماري"), ("architect", "مكتب هندسي"), ("fit out", "تشطيب"),
    ("fit-out", "تشطيب"), ("renovation", "ترميم"), ("construction", "مقاولات"), ("contracting", "مقاولات"),
    ("landscap", "تنسيق حدائق"), ("kitchen", "مطابخ"), ("villa", "فلل"), ("decor", "ديكور"), ("furniture", "اثاث"),
    ("engineering", "مكتب هندسي"), ("swimming pool", "مسابح"), ("pool", "مسابح"),
)
SPLIT = re.compile(r"\s*(?:,|،|\n|;|/|\band\b|\bو\b|-)\s*", re.I)


def service_words(answers: dict[str, Any], card: dict[str, Any]) -> list[str]:
    """What they sell, most specific first: the kickoff's advertised service, the #1 focus, the first service."""
    out: list[str] = []
    for v in (card.get("serviceAdvertised"), answers.get("serviceFocus"), answers.get("services")):
        if not v:
            continue
        first_part = SPLIT.split(str(v))[0].strip()
        if first_part and len(first_part) <= 60 and first_part.lower() not in (x.lower() for x in out):
            out.append(first_part)
    return out[:2]


def arabic_for(words: str) -> Optional[str]:
    if re.search(r"[؀-ۿ]", words):
        return words
    low = words.lower()
    for en, ar in GLOSSARY:
        if en in low:
            return ar
    return None


def areas(answers: dict[str, Any], city: Optional[str]) -> list[str]:
    parts = [p.strip() for p in SPLIT.split(str(answers.get("serviceAreas") or "")) if 1 < len(p.strip()) <= 40]
    out = list(dict.fromkeys(parts))[:2]
    if not out and city:
        out = [city]
    return out


def country_of(card: dict[str, Any]) -> tuple[Optional[str], str]:
    """(ISO country, where it came from)."""
    if card.get("country") in COUNTRIES:
        return card["country"], "the card"
    if card.get("phoneCountry") in COUNTRIES:
        return card["phoneCountry"], "the front desk phone's country code (assumed)"
    return None, "not on the card"


def search_plan(answers: dict[str, Any], card: dict[str, Any], city: Optional[str], max_queries: int) -> list[dict[str, str]]:
    """Maps searches: each service word, in English and Arabic, in each of the top areas, capped."""
    iso, _ = country_of(card)
    country = COUNTRIES[iso][0] if iso else ""
    plan: list[dict[str, str]] = []
    for word in service_words(answers, card):
        for area in areas(answers, city) or [""]:
            location = ", ".join(x for x in (area, country) if x)
            if not location:
                continue
            plan.append({"query": word, "location": location, "language": "en"})
            ar = arabic_for(word)
            if ar:
                plan.append({"query": ar, "location": location, "language": "ar"})
    seen, out = set(), []
    for p in plan:
        k = (p["query"].lower(), p["location"].lower())
        if k not in seen:
            seen.add(k)
            out.append(p)
    return out[:max_queries]


@dataclass
class Candidate:
    key: str                                   # stable before numbering: place id, domain or name
    name: str
    place: Optional[dict[str, Any]] = None     # maps facts
    place_url: Optional[str] = None
    website: Optional[str] = None
    seen_ads: int = 0
    seen_serp: int = 0
    named_by_client: bool = False
    score: float = 0.0
    why: list[str] = field(default_factory=list)
    kid: str = ""

    def facts(self) -> dict[str, Any]:
        p = self.place or {}
        return {"kid": self.kid, "name": self.name, "rating": p.get("rating"), "reviewsN": p.get("reviewsN"),
                "categories": p.get("categories"), "city": p.get("city"), "website": self.website,
                "seenAdvertising": self.seen_ads > 0, "inSearch": self.seen_serp > 0,
                "namedByClient": self.named_by_client, "score": round(self.score, 2), "scoreWhy": self.why}


def _km(a: Optional[dict[str, Any]], b: Optional[dict[str, Any]]) -> Optional[float]:
    try:
        lat1, lon1, lat2, lon2 = (math.radians(float(x)) for x in (a["lat"], a["lng"], b["lat"], b["lng"]))
    except (TypeError, KeyError, ValueError):
        return None
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def max_km(answer: Any) -> Optional[float]:
    m = re.search(r"(\d+(?:\.\d+)?)\s*(km|كم|kilo|mile|mi\b)?", str(answer or ""), re.I)
    if not m:
        return None
    n = float(m.group(1))
    return n * 1.609 if (m.group(2) or "").lower().startswith("mi") else n


def build(places: list[dict[str, Any]], serp_pages: list[dict[str, Any]], ads: list[dict[str, Any]], *,
          client_name: str, client_site: Optional[str], client_place: Optional[dict[str, Any]],
          client_categories: list[str], service: list[str], blueprint_text: Optional[str],
          not_competitors: list[dict[str, Any]], max_distance: Any, limit: int) -> list[Candidate]:
    cands: dict[str, Candidate] = {}

    def key_for(name: str, site: Optional[str], pid: Optional[str]) -> str:
        for k, c in cands.items():
            if (pid and c.place and c.place.get("placeId") == pid) or (site and c.website and domain(c.website) == domain(site)) \
                    or name_match(c.name, name):
                return k
        return pid or (domain(site) if site else None) or norm_name(name)

    for p in places:
        if p.get("closed"):
            continue
        k = key_for(p["name"], p.get("website"), p.get("placeId"))
        c = cands.setdefault(k, Candidate(key=k, name=p["name"]))
        c.place = c.place or p
        c.place_url = c.place_url or p.get("url")
        c.website = c.website or p.get("website")
    for page in serp_pages:
        for r in page.get("ads", []):
            if r.get("url") and domain(r["url"]):
                k = key_for(r.get("title") or domain(r["url"]) or "", r["url"], None)
                c = cands.setdefault(k, Candidate(key=k, name=(r.get("title") or domain(r["url"]) or "")[:200], website=r["url"]))
                c.seen_ads += 1
                c.seen_serp += 1
        for r in page.get("organic", []):
            for c in cands.values():
                if c.website and domain(c.website) == domain(r.get("url")):
                    c.seen_serp += 1
    for a in ads:
        for c in cands.values():
            if a.get("page") and name_match(a["page"], c.name):
                c.seen_ads += 1
    blocked = [(n.get("name"), n.get("placeUrl"), n.get("website")) for n in not_competitors]
    limit_km = max_km(max_distance)
    words = " ".join(service + client_categories).lower()
    out = []
    for c in cands.values():
        if name_match(c.name, client_name) or (client_site and c.website and domain(c.website) == domain(client_site)):
            continue
        if any((n and name_match(n, c.name)) or (u and u == c.place_url) or (w and c.website and domain(w) == domain(c.website))
               for n, u, w in blocked):
            continue
        p = c.place or {}
        cats = " ".join(p.get("categories") or []).lower()
        if cats and any(w in cats for w in re.findall(r"[a-z؀-ۿ]{4,}", words)):
            c.score += 3
            c.why.append("same category")
        km = _km((client_place or {}).get("location"), p.get("location"))
        if km is not None and limit_km is not None:
            c.score += 2 if km <= limit_km else -2
            c.why.append(f"{km:.0f} km away")
        n = p.get("reviewsN")
        if isinstance(n, int) and n > 0:
            c.score += min(2.0, math.log10(n + 1))
        if isinstance(p.get("rating"), (int, float)) and p["rating"] >= 4:
            c.score += 1
        if c.website:
            c.score += 1
        if c.seen_ads:
            c.score += 2
            c.why.append("advertising now")
        if blueprint_text and name_match(c.name, blueprint_text) or (blueprint_text and norm_name(c.name) and norm_name(c.name) in norm_name(blueprint_text)):
            c.named_by_client = True
            c.score += 3
            c.why.append("named by the client")
        out.append(c)
    out.sort(key=lambda c: (-c.score, c.name))
    out = out[:limit]
    for i, c in enumerate(out, 1):
        c.kid = f"K{i}"
    return out
