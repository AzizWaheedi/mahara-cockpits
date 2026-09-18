"""On-demand scrapes the cockpit asks for (Aziz, 2026-09-18).

The board has a "Scrape" box: paste a creator or brand page on Instagram,
TikTok, YouTube, Facebook or Snapchat and the radar fetches its recent
videos, finds the ones that beat the page's own normal (the same rule as
the weekly scan), proposes them, watches the account from now on, and
pulls the brand's current Meta ads. Or name a page, an advertiser or a
keyword and the radar pulls the Meta Ad Library or Google Ads Transparency
Center: every active ad, ranked by how long it has been running, because a
paid ad still running after weeks is a proven ad.

Requests live in `ideation_requests` (queued -> running -> done | failed,
with the result or the reason on the row). The pending cron picks them up
every two minutes; `radar.py requests` runs them by hand. Every request is
bounded: pages per source, ads per pull, credits per request, and a
request that fails three times stays failed with its error.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from . import http
from .config import Config
from .models import Post, Target
from .outliers import compute_baseline, find_candidates, iso, utcnow
from .sources.scrapecreators import (
    ScrapeCreators,
    google_ad_row,
    meta_ad_row,
    parse_facebook_reels,
    parse_instagram_reels,
    parse_tiktok_videos,
    parse_youtube,
    profile_followers,
)
from .state import State
from .stills import attach_stills
from .supabase import Supabase, SupabaseError, now_iso

KINDS = ("profile", "ads")
RUNNING_TTL_MIN = 30
MAX_ATTEMPTS = 3
REQUEST_SELECT = "id,kind,platform,input,params,status,requested_by,requested_by_name,attempts,created_at"

PROFILE_PATTERNS = [
    ("instagram", re.compile(r"instagram\.com/(?!reel/|p/|explore/|stories/|reels/)([A-Za-z0-9_.]+)", re.I)),
    ("tiktok", re.compile(r"tiktok\.com/@([A-Za-z0-9_.]+)", re.I)),
    ("youtube", re.compile(r"youtube\.com/(?:@|c/|user/)([A-Za-z0-9_.-]+)", re.I)),
    ("snapchat", re.compile(r"snapchat\.com/(?:add/|@)([A-Za-z0-9_.-]+)", re.I)),
    ("facebook", re.compile(r"facebook\.com/(?!ads/|reel/|watch|share/|groups/|events/)([A-Za-z0-9_.-]+)", re.I)),
]
NOT_HANDLES = {"www", "explore", "reels", "reel", "p", "share", "watch", "profile.php"}


def parse_profile(text: str, platform_hint: str = "") -> tuple[str, str]:
    """A page link, "platform:handle" or "@handle" (with a platform hint) -> (platform, handle)."""
    t = (text or "").strip()
    if not t:
        raise ValueError("no page given")
    m = re.match(r"^(instagram|tiktok|youtube|facebook|snapchat):@?([A-Za-z0-9_.-]{1,80})$", t, re.I)
    if m:
        return m.group(1).lower(), m.group(2).lower()
    if "://" in t or "." in t.split("/")[0]:
        for platform, pat in PROFILE_PATTERNS:
            mm = pat.search(t)
            if mm and mm.group(1).lower() not in NOT_HANDLES:
                return platform, mm.group(1).lower().rstrip("/")
        raise ValueError("this link is not a page on Instagram, TikTok, YouTube, Facebook or Snapchat")
    handle = t.lstrip("@").lower()
    if not re.match(r"^[A-Za-z0-9_.-]{1,80}$", handle):
        raise ValueError("that does not look like a handle")
    if platform_hint.lower() not in ("instagram", "tiktok", "youtube", "facebook", "snapchat"):
        raise ValueError("a bare handle needs a platform (instagram, tiktok, youtube, facebook, snapchat)")
    return platform_hint.lower(), handle


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9؀-ۿ]+", "", (s or "").lower())


def match_company(companies: list[dict[str, Any]], *, handle: str = "", name: str = "", min_likes: int = 0) -> Optional[dict[str, Any]]:
    """The Ad Library page that is this brand: same Instagram handle first, then the same name.

    A name match can accept a page only when it has `min_likes` likes or
    more: a keyword such as "interior design" is also the name of a dozen
    empty pages (seen 2026-09-18), and those must not swallow the search.
    """
    h = _norm(handle)
    n = _norm(name)
    for c in companies:
        if h and _norm(str(c.get("ig_username") or "")) == h:
            return c
    for c in companies:
        if h and _norm(str(c.get("page_alias") or "")) == h:
            return c
    for c in companies:
        if n and _norm(str(c.get("name") or "")) == n and int(c.get("likes") or 0) >= min_likes:
            return c
    return None


def ad_tier(days: Optional[int], cfg: Config) -> Optional[str]:
    if days is None:
        return None
    if days >= cfg.ads_reverse_days:
        return "reverse_engineer"
    if days >= cfg.ads_study_days:
        return "study"
    return None


# ---------------------------------------------------------------------------
# The queue


def claim(sb: Supabase, limit: int = 3) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    stale = (now - timedelta(minutes=RUNNING_TTL_MIN)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    queued = sb.select("ideation_requests", f"select={REQUEST_SELECT}&status=eq.queued&order=created_at.asc&limit={int(limit)}")
    hung = sb.select("ideation_requests", f"select={REQUEST_SELECT}&status=eq.running&started_at=lt.{stale}&order=created_at.asc&limit=10")
    out: list[dict[str, Any]] = []
    stamp = now_iso()
    for r in (queued + hung)[: int(limit)]:
        attempts = int(r.get("attempts") or 0) + 1
        where = f"id=eq.{http.quote_key(r['id'])}"
        if attempts > MAX_ATTEMPTS:
            sb.patch("ideation_requests", where, {"status": "failed", "error": "The radar tried this three times and never finished.", "attempts": attempts, "finished_at": stamp, "updated_at": stamp})
            continue
        sb.patch("ideation_requests", where, {"status": "running", "started_at": stamp, "attempts": attempts, "updated_at": stamp})
        r["attempts"] = attempts
        out.append(r)
    return out


def finish(sb: Supabase, req: dict[str, Any], *, result: Optional[dict[str, Any]] = None, error: Optional[str] = None) -> None:
    stamp = now_iso()
    body: dict[str, Any] = {"status": "failed" if error else "done", "finished_at": stamp, "updated_at": stamp, "error": (error or "")[:400] or None}
    if result is not None:
        body["result"] = result
    sb.patch("ideation_requests", f"id=eq.{http.quote_key(req['id'])}", body)


# ---------------------------------------------------------------------------
# Kinds


def _store(sb: Supabase, log: Callable[[str], None], rows: list[dict[str, Any]], *, max_stills: int) -> dict[str, int]:
    if not rows:
        return {"inserted": 0, "refreshed": 0, "patched": 0}
    try:
        attach_stills(sb, rows, log, max_items=max_stills)
    except Exception as e:  # noqa: BLE001 - pictures are a bonus
        log(f"stills failed: {e}")
    return sb.store_candidates(rows)


def fetch_profile_posts(sc: ScrapeCreators, platform: str, handle: str, cfg: Config, log: Callable[[str], None]) -> tuple[list[Post], Optional[int], list[str]]:
    warnings: list[str] = []
    followers: Optional[int] = None
    if platform == "instagram":
        posts = parse_instagram_reels(sc.instagram_reels(handle, pages=cfg.profile_pages), handle)
        if not any(p.author_followers for p in posts):
            try:
                followers = profile_followers(sc.instagram_profile(handle))
            except http.HttpError as e:
                warnings.append(f"followers unknown: {http.scrub(str(e))[:100]}")
    elif platform == "tiktok":
        posts = parse_tiktok_videos(sc.tiktok_videos(handle, pages=cfg.profile_pages), handle)
        if not any(p.author_followers for p in posts):
            try:
                followers = profile_followers(sc.tiktok_profile(handle))
            except http.HttpError as e:
                warnings.append(f"followers unknown: {http.scrub(str(e))[:100]}")
    elif platform == "youtube":
        posts = parse_youtube(sc.youtube_shorts(handle), handle)
        try:
            posts += parse_youtube(sc.youtube_videos(handle), handle)
        except http.HttpError as e:
            warnings.append(f"long videos skipped: {http.scrub(str(e))[:100]}")
    elif platform == "facebook":
        posts = parse_facebook_reels(sc.facebook_reels(f"https://www.facebook.com/{handle}", pages=2), handle)
    elif platform == "snapchat":
        prof = sc.snapchat_profile(handle)
        items = [x for x in (prof.get("spotlights") or prof.get("spotlightHighlights") or prof.get("stories") or []) if isinstance(x, dict)]
        posts = []
        for it in items:
            vid = str(it.get("id") or it.get("snapId") or "")
            if not vid:
                continue
            posts.append(Post(platform="snapchat", post_id=vid, url=str(it.get("url") or it.get("shareUrl") or f"https://www.snapchat.com/spotlight/{vid}"), author_handle=handle, views=_int(it.get("viewCount") or it.get("views")), posted_at=None, caption=str(it.get("description") or it.get("title") or "")[:1000], media_url=it.get("videoUrl") or it.get("mediaUrl"), thumb_url=it.get("thumbnailUrl") or it.get("thumbnail"), raw={"source": "scrapecreators"}))
        if not posts:
            warnings.append("Snapchat returned no Spotlight clips for this profile")
    else:
        raise ValueError(f"unsupported platform {platform}")
    seen: set[str] = set()
    unique: list[Post] = []
    for p in posts:
        if p.key in seen:
            continue
        seen.add(p.key)
        unique.append(p)
    if followers is None:
        followers = next((p.author_followers for p in unique if p.author_followers), None)
    return unique, followers, warnings


def run_profile(cfg: Config, log: Callable[[str], None], sb: Supabase, sc: ScrapeCreators, state: State, req: dict[str, Any], now: datetime) -> dict[str, Any]:
    params = req.get("params") if isinstance(req.get("params"), dict) else {}
    platform, handle = parse_profile(str(req.get("input") or ""), str(params.get("platform") or req.get("platform") or ""))
    industry = "ours" if params.get("industry") == "ours" else "other"
    stamp = iso(now)
    posts, followers, warnings = fetch_profile_posts(sc, platform, handle, cfg, log)
    log(f"profile {platform}:{handle}: {len(posts)} posts, followers {followers}")
    for p in posts:
        if p.author_followers is None and followers is not None:
            p.author_followers = followers
        state.remember_post(p, stamp)
    floor = cfg.floor_for(platform) or cfg.floor_instagram
    target_key = f"{platform}:account:{handle}"
    base = compute_baseline(posts, now=now, sample_size=cfg.sample_size, trim=cfg.trim, min_n=cfg.min_baseline_n, min_age_hours=cfg.baseline_min_age_hours, floor=floor, is_video=True) if posts else None
    tags = [f"via:profile:{handle}"] + ([str(params["client"])] if params.get("client") else [])
    rows: list[dict[str, Any]] = []
    if base is not None:
        state.set_baseline(target_key, base, followers, len(posts))
        cands = find_candidates(
            posts, now=now, target_key=target_key, industry=industry, tags=tags,
            threshold=cfg.threshold, reverse_threshold=cfg.reverse_threshold, window_days=cfg.profile_window_days,
            min_age_hours=cfg.min_age_hours, mature_hours=cfg.mature_hours, baseline_min_age_hours=cfg.baseline_min_age_hours,
            sample_size=cfg.sample_size, trim=cfg.trim, min_n=cfg.min_baseline_n, floor=floor,
            min_followers=cfg.min_followers_for_audience, min_engagement=cfg.min_engagement,
        )
        for c in cands:
            state.propose(c)
            d = c.to_dict()
            d["origin"] = "scrape"
            rows.append(d)
    if not rows:
        # Too few settled posts for a baseline (or nothing broke out): the page's best by views.
        top = sorted((p for p in posts if p.views), key=lambda p: p.views or 0, reverse=True)[: cfg.profile_top_n]
        for p in top:
            d = p.to_dict()
            d.update({"key": p.key, "origin": "scrape", "status": "proposed", "target_key": target_key, "industry": industry, "tags": tags + ["top-by-views"], "tier": "study", "provisional": True, "checkpoint": "undated", "scanned_at": stamp})
            rows.append(d)
        if posts and base is None:
            warnings.append(f"fewer than {cfg.min_baseline_n} settled posts for a baseline: the {len(top)} best by views are proposed instead")
    for d in rows:
        d["source_request"] = req["id"]
        if params.get("client"):
            d["client"] = str(params["client"])[:120]
    stored = _store(sb, log, rows, max_stills=cfg.profile_top_n + 10)
    result: dict[str, Any] = {"platform": platform, "handle": handle, "posts": len(posts), "followers": followers, "baseline": round(base.median) if base else None, "proposals": len(rows), "stored": stored, "warnings": warnings}
    if params.get("watch", True) and platform in ("instagram", "tiktok", "snapchat"):
        target = Target(platform=platform, kind="account", value=handle, industry=industry, tags=["via:cockpit"] + ([str(params["client"])] if params.get("client") else []), note=f"added from the cockpit by {req.get('requested_by_name') or req.get('requested_by') or 'the team'} on {stamp[:10]}")
        try:
            sb.upsert_watchlist([target], source="cockpit", added_by=str(req.get("requested_by") or "cockpit"))
            if base is not None:
                sb.mark_target(target.key, last_scanned_at=stamp, last_status="ok", baseline_views=round(base.median), baseline_n=base.n, followers=followers)
            result["watched"] = True
        except (SupabaseError, http.HttpError) as e:
            warnings.append(f"could not add to the watchlist: {http.scrub(str(e))[:120]}")
    elif params.get("watch", True):
        warnings.append(f"{platform} pages are not on the weekly scan yet; scrape it again when you want fresh numbers")
    if params.get("ads", True):
        try:
            companies = sc.fb_search_companies(handle)
            page = match_company(companies, handle=handle, name=str(params.get("name") or ""))
            if page is None and params.get("name"):
                page = match_company(sc.fb_search_companies(str(params["name"])), handle=handle, name=str(params["name"]))
            if page is None:
                result["ads"] = 0
                warnings.append("no Meta Ad Library page matched this handle; run an ads scrape with the page name to pull its ads")
            else:
                ads = sc.fb_company_ads(str(page.get("page_id")), country=str(params.get("country") or ""), pages=cfg.ads_pages)
                ad_rows = build_ad_rows(cfg, ads, "meta", now, tags=[f"via:profile:{handle}"] + ([str(params["client"])] if params.get("client") else []), industry=industry, request_id=req["id"], client=params.get("client"), min_days=0)
                stored_ads = _store(sb, log, ad_rows, max_stills=cfg.ads_max)
                result["ads"] = len(ad_rows)
                result["ads_page"] = {"page_id": page.get("page_id"), "name": page.get("name")}
                result["ads_stored"] = stored_ads
        except http.HttpError as e:
            warnings.append(f"ads not pulled: {http.scrub(str(e))[:140]}")
    result["credits"] = sc.credits_charged
    result["credits_remaining"] = sc.credits_remaining
    return result


def build_ad_rows(cfg: Config, ads: list[dict[str, Any]], platform: str, now: datetime, *, tags: list[str], industry: str, request_id: str, client: Any = None, min_days: Optional[int] = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    floor_days = cfg.ads_min_days if min_days is None else min_days
    for ad in ads:
        row = meta_ad_row(ad, now=now) if platform == "meta" else google_ad_row(ad, now=now)
        if row is None or not row.get("ad_active", True):
            continue
        days = row.get("running_days")
        if days is not None and days < floor_days:
            continue
        row["tier"] = ad_tier(days, cfg)
        row["industry"] = industry
        row["tags"] = [f"ads:{platform}"] + tags
        row["source_request"] = request_id
        row["scanned_at"] = iso(now)
        row["provisional"] = False
        row["checkpoint"] = "undated"
        if client:
            row["client"] = str(client)[:120]
        rows.append(row)
    rows.sort(key=lambda r: (r.get("running_days") or 0), reverse=True)
    return rows[: cfg.ads_max]


def run_ads(cfg: Config, log: Callable[[str], None], sb: Supabase, sc: ScrapeCreators, req: dict[str, Any], now: datetime) -> dict[str, Any]:
    params = req.get("params") if isinstance(req.get("params"), dict) else {}
    platform = str(params.get("platform") or req.get("platform") or "meta").lower()
    query = str(req.get("input") or "").strip()
    if not query:
        raise ValueError("no page, advertiser or keyword given")
    country = str(params.get("country") or cfg.ads_country or "")
    industry = "ours" if params.get("industry") == "ours" else "other"
    tags = [f"via:ads:{query}"] + ([str(params["client"])] if params.get("client") else [])
    warnings: list[str] = []
    matched: dict[str, Any] = {}
    if platform == "meta":
        if query.isdigit():
            ads = sc.fb_company_ads(query, country=country, pages=cfg.ads_pages)
            matched = {"page_id": query}
        else:
            companies = sc.fb_search_companies(query)
            page = match_company(companies, handle=query.lstrip("@"), name=query, min_likes=cfg.ads_page_min_likes)
            if page is None and companies and params.get("mode") == "page":
                page = companies[0]
            ads = []
            if page is not None:
                ads = sc.fb_company_ads(str(page.get("page_id")), country=country, pages=cfg.ads_pages)
                matched = {"page_id": page.get("page_id"), "name": page.get("name"), "ig_username": page.get("ig_username")}
            if not ads:
                # No page, or a page with nothing running: the words themselves, across every advertiser.
                ads = sc.fb_search_ads(query, country=country, pages=cfg.ads_pages)
                matched = {"keyword": query, "country": country or "ALL", **({"page_tried": page.get("name")} if page is not None else {})}
    elif platform == "google":
        advertisers = sc.google_advertisers(query, region=country)
        pick = next((a for a in advertisers if _norm(str(a.get("name") or "")) == _norm(query)), advertisers[0] if advertisers else None)
        if pick is None:
            raise ValueError(f"no Google advertiser matched '{query}'")
        ads = sc.google_company_ads(str(pick.get("advertiser_id")), region=country, pages=cfg.ads_pages)
        matched = {"advertiser_id": pick.get("advertiser_id"), "name": pick.get("name"), "region": pick.get("region")}
    else:
        raise ValueError(f"ad library '{platform}' is not wired (meta or google)")
    rows = build_ad_rows(cfg, ads, platform, now, tags=tags, industry=industry, request_id=req["id"], client=params.get("client"), min_days=params.get("min_days"))
    log(f"ads {platform} '{query}': {len(ads)} seen, {len(rows)} proposed")
    stored = _store(sb, log, rows, max_stills=cfg.ads_max)
    if ads and not rows:
        warnings.append(f"{len(ads)} ads seen, none running {cfg.ads_min_days} days or more yet")
    return {"platform": platform, "query": query, "country": country or "ALL", "matched": matched, "ads_seen": len(ads), "proposals": len(rows), "stored": stored, "longest_days": rows[0].get("running_days") if rows else None, "warnings": warnings, "credits": sc.credits_charged, "credits_remaining": sc.credits_remaining}


def run_requests(cfg: Config, log: Callable[[str], None], *, limit: int = 3, dry_run: bool = False, state: Optional[State] = None, sc: Optional[ScrapeCreators] = None, now: Optional[datetime] = None, sb: Optional[Supabase] = None) -> list[dict[str, Any]]:
    """Claim and run queued requests. Returns one summary per request."""
    if sb is None:
        if not cfg.use_supabase_sink:
            raise SupabaseError("requests need the Supabase home (RADAR_SUPABASE_URL and RADAR_SUPABASE_KEY)")
        sb = Supabase(cfg.supabase_url, cfg.supabase_key, table=cfg.supabase_table, bucket=cfg.supabase_bucket)
    now = now or utcnow()
    state = state or State.load(cfg.state_path)
    reqs = claim(sb, limit)
    out: list[dict[str, Any]] = []
    for req in reqs:
        summary: dict[str, Any] = {"id": req["id"], "kind": req.get("kind"), "input": req.get("input")}
        try:
            if sc is None:
                sc = ScrapeCreators(cfg.scrapecreators_key, log=log)
            if req.get("kind") == "profile":
                result = run_profile(cfg, log, sb, sc, state, req, now)
            elif req.get("kind") == "ads":
                result = run_ads(cfg, log, sb, sc, req, now)
            else:
                raise ValueError(f"unknown request kind '{req.get('kind')}'")
            summary.update({"status": "done", "result": result})
            if not dry_run:
                finish(sb, req, result=result)
        except (http.HttpError, SupabaseError, ValueError, KeyError) as e:
            msg = http.scrub(str(e))[:400]
            summary.update({"status": "failed", "error": msg})
            log(f"request {req['id']} failed: {msg}")
            if not dry_run:
                finish(sb, req, error=msg)
        out.append(summary)
    if reqs and not dry_run:
        state.prune()
        state.save()
    return out


def _int(v: Any) -> Optional[int]:
    try:
        return int(v) if v is not None and str(v).strip() != "" else None
    except (TypeError, ValueError):
        return None
