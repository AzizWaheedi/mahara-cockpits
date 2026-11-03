"""ScrapeCreators: one REST key (SCRAPECREATORS_API_KEY, by name), credits per request.

Used for the Meta Ad Library (a page's active ads with their start dates, and who advertises a service now)
and as the second source for follower counts. Every call reserves its credits on the spend meter first
(USD 47 buys 25,000 credits, about USD 0.0019 a credit) and goes through the ledger. Shapes were checked live
by the radar on 2026-09-18; every parser reads defensively. Google ad details (25 credits each) are never
requested.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

from . import http
from .ledger import Ledger
from .meter import Meter

BASE = "https://api.scrapecreators.com"


class ScrapeCreators:
    def __init__(self, key: str, ledger: Ledger, meter: Meter, *, timeout: float = 90,
                 get: Optional[Callable[..., Any]] = None):
        if not key:
            raise http.HttpError(0, "SCRAPECREATORS_API_KEY is not set")
        self.key = key
        self.ledger = ledger
        self.meter = meter
        self.timeout = timeout
        self._get = get or http.get_json

    def get(self, path: str, *, label: str, credits: int = 1, **params: Any) -> dict[str, Any]:
        held = self.meter.reserve(label, credits * self.meter.sc_usd_per_credit)
        query = http.encode_query({k: v for k, v in params.items() if v not in (None, "")})
        url = f"{BASE}{path}" + (f"?{query}" if query else "")
        try:
            out = self.ledger.call("scrapecreators", "GET", f"{BASE}{path}",
                                   lambda: self._get(url, headers={"x-api-key": self.key}, timeout=self.timeout, retries=2))
        finally:
            self.meter.release(held)       # the credits charged are counted below
        if not isinstance(out, dict):
            raise http.HttpError(0, f"scrapecreators {path}: no JSON object")
        charged = out.get("credits_charged")
        self.meter.add_sc(int(charged) if isinstance(charged, (int, float)) else credits)
        if out.get("success") is False or out.get("error"):
            raise http.HttpError(int(out.get("errorStatus") or 0), f"scrapecreators {path}: {out.get('message') or out.get('error')}")
        return out

    def credit_balance(self) -> Optional[int]:
        url = f"{BASE}/v1/credit-balance"
        out = self.ledger.call("scrapecreators", "GET", url,
                               lambda: self._get(url, headers={"x-api-key": self.key}, timeout=30, retries=1))
        try:
            return int(out.get("creditCount"))
        except (AttributeError, TypeError, ValueError):
            return None

    # ---- Meta Ad Library ------------------------------------------------------------------------------------
    def _pages(self, path: str, list_key: str, pages: int, *, label: str, **params: Any) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        cursor: Any = None
        for _ in range(max(1, pages)):
            out = self.get(path, label=label, **params, **({"cursor": cursor} if cursor else {}))
            batch = [x for x in (out.get(list_key) or []) if isinstance(x, dict)]
            items.extend(batch)
            cursor = out.get("cursor")
            if not cursor or not batch:
                break
        return items

    def fb_search_companies(self, query: str, *, label: str) -> list[dict[str, Any]]:
        out = self.get("/v1/facebook/adLibrary/search/companies", label=label, query=query)
        return [x for x in (out.get("searchResults") or []) if isinstance(x, dict)]

    def fb_company_ads(self, page_id: str, *, country: str, pages: int, label: str) -> list[dict[str, Any]]:
        return self._pages("/v1/facebook/adLibrary/company/ads", "results", pages, label=label, pageId=page_id,
                           country=country, status="ACTIVE", trim="true")

    def fb_search_ads(self, query: str, *, country: str, pages: int, label: str) -> list[dict[str, Any]]:
        return self._pages("/v1/facebook/adLibrary/search/ads", "searchResults", pages, label=label, query=query,
                           country=country, status="ACTIVE", trim="true")

    # ---- second source for followers ------------------------------------------------------------------------
    def instagram_profile(self, handle: str, *, label: str) -> dict[str, Any]:
        return self.get("/v1/instagram/profile", label=label, handle=handle, trim="true")

    def tiktok_profile(self, handle: str, *, label: str) -> dict[str, Any]:
        return self.get("/v1/tiktok/profile", label=label, handle=handle)
