"""Google search through apify/google-search-scraper: the brand search (knowledge panel, directories, who
bids on the brand) and the local search for the service in the city, with its paid ads and People also ask.
"""
from __future__ import annotations

from typing import Any

from ..evidence import Draft
from . import first, https

SOURCE = "apify:apify/google-search-scraper"


def job_input(queries: list[str], *, country: str, language: str) -> dict[str, Any]:
    return {"queries": "\n".join(queries), "countryCode": country.lower(), "languageCode": language,
            "maxPagesPerQuery": 1, "resultsPerPage": 10, "mobileResults": False, "saveHtml": False,
            "saveHtmlToKeyValueStore": False, "includeUnfilteredResults": False}


def parse(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    pages = []
    for it in items:
        q = first(it, "searchQuery.term", "searchQuery", "query", default="")
        organic = []
        for r in first(it, "organicResults", default=[]) or []:
            if isinstance(r, dict) and https(r.get("url")):
                organic.append({"title": str(r.get("title") or "")[:200], "url": r.get("url"),
                                "description": str(r.get("description") or "")[:300], "position": r.get("position")})
        ads = []
        for r in first(it, "paidResults", "ads", default=[]) or []:
            if isinstance(r, dict):
                ads.append({"title": str(r.get("title") or "")[:200], "url": https(r.get("url")),
                            "displayedUrl": str(r.get("displayedUrl") or "")[:200],
                            "description": str(r.get("description") or "")[:300]})
        paa = [str(first(r, "question", default="") or "")[:200] for r in (first(it, "peopleAlsoAsk", default=[]) or [])
               if isinstance(r, dict) and first(r, "question")]
        pages.append({"query": str(q)[:200], "organic": organic[:10], "ads": ads[:8], "peopleAlsoAsk": paa[:8],
                      "url": https(first(it, "url", "searchQuery.url"))})
    return pages


def drafts(pages: list[dict[str, Any]], usd: float, subject: str = "market") -> list[Draft]:
    each = round(usd / len(pages), 6) if pages else 0.0
    return [Draft(kind="serp", subject=subject, source=SOURCE, url=p.get("url"), usd=each,
                  body={k: p[k] for k in ("query", "organic", "ads", "peopleAlsoAsk")}) for p in pages]
