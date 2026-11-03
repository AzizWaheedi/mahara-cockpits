"""The pull plan and its estimated cost, before anything is pulled (`mi.py run --task <id> --dry-run`).

The estimate uses the Apify Store prices in config.PRICE and ScrapeCreators' credit rate; the actual run counts
Apify's usageTotalUsd. Pulls that depend on what a page says (a TikTok or Snapchat handle on the site) are
listed as "if found" at their capped cost, so the total is an upper bound.
"""
from __future__ import annotations

from typing import Any

from . import discover
from .config import PRICE, Config
from .sources import handle, is_social


def estimate(cfg: Config, inp: dict[str, Any]) -> dict[str, Any]:
    a, card = inp.get("answers") or {}, inp.get("card") or {}
    caps, rate = cfg.caps, cfg.sc_usd_per_credit
    rows: list[dict[str, Any]] = []

    def add(stage: str, what: str, usd: float, note: str = "") -> None:
        rows.append({"stage": stage, "pull": what, "usd": round(usd, 4), "note": note})

    link = str(a.get("mapsLink") or "")
    add("A", "Maps listing of the client", PRICE["maps_place"] * (1 if "google" in link or "goo.gl" in link else 3),
        "from the client's Maps link" if link else "a search for the name, matched by two identifiers")
    add("A", f"Google reviews of the client (up to {caps.client_reviews})", PRICE["review"] * caps.client_reviews)
    add("A", f"Brand search ({caps.brand_queries} queries, ads read)", PRICE["serp_page"] * caps.brand_queries + PRICE["serp_ads"])
    site = a.get("website") if a.get("website") and not is_social(a.get("website")) else card.get("website")
    add("A", f"Website (up to {caps.client_web_pages} pages)", 0.0,
        "direct fetch, free" if site else "no website in the answers or on the card")
    ig = handle("instagram", a.get("instagram"))
    add("A", "Instagram profile", PRICE["ig_profile"] if ig else 0.0, "" if ig else "no handle in the answers yet")
    add("A", "Instagram followers, second source", rate if ig else 0.0, "ScrapeCreators")
    add("A", "Facebook page", PRICE["fb_page"] if a.get("facebook") else 0.0, "" if a.get("facebook") else "no page in the answers")
    add("A", f"Meta Ad Library, the client's page (up to {caps.client_ads} ads)", 3 * rate, "ScrapeCreators")
    add("A", "TikTok and Snapchat, if a handle is found", PRICE["tiktok_result"] * caps.client_tiktok + PRICE["snap_profile"])
    queries = discover.search_plan(a, card, None, caps.maps_queries)
    add("B", f"Maps search for rivals ({len(queries)} queries x {caps.maps_places_per_query} places)",
        PRICE["maps_search_place"] * caps.maps_places_per_query * len(queries),
        "; ".join(f"{q['query']} in {q['location']}" for q in queries) or "no service or area to search with")
    add("B", f"Local Google search with its ads ({caps.local_queries} queries)",
        PRICE["serp_page"] * caps.local_queries + PRICE["serp_ads"])
    add("B", f"Who advertises the service on Meta now ({caps.ad_keyword_queries} searches)", 2 * caps.ad_keyword_queries * rate)
    n = caps.competitors
    add("C", f"Reviews of {n} rivals (up to {caps.competitor_reviews} each)", PRICE["review"] * caps.competitor_reviews * n)
    add("C", f"Instagram and Facebook of {n} rivals", (PRICE["ig_profile"] + PRICE["fb_page"]) * n)
    add("C", f"Meta Ad Library of {n} rivals", 2 * rate * n)
    add("C", f"Websites of {n} rivals (up to {caps.competitor_web_pages} pages each)", 0.0, "direct fetch, free")
    add("C", f"TikTok of rivals, if a handle is found", PRICE["tiktok_result"] * caps.competitor_tiktok * n)
    total = round(sum(r["usd"] for r in rows), 2)
    iso, where = discover.country_of(card)
    return {"rows": rows, "totalUsd": total, "country": iso, "countryFrom": where, "queries": queries}


def lines(est: dict[str, Any], cap_run: float, cap_month: float, month_usd: Any) -> list[str]:
    out = [f"Country: {est['country'] or 'not known'} ({est['countryFrom']})."]
    for r in est["rows"]:
        out.append(f"  {r['stage']}  {r['pull']}: USD {r['usd']:.3f}" + (f"  ({r['note']})" if r["note"] else ""))
    out.append(f"Estimated at most USD {est['totalUsd']:.2f} for this run; the run cap is USD {cap_run:.2f}.")
    if month_usd is None:
        out.append("This month's research spend could not be read, so a real run would pull nothing.")
    else:
        out.append(f"This month so far: USD {float(month_usd):.2f} of USD {cap_month:.2f}.")
    out.append("Dry run: nothing was pulled, stored or sent.")
    return out
