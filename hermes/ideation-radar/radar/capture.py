"""One pasted link: fetch, watch, break down, save.

Idempotent on the post key: a link captured before returns the stored idea
unless --force. Every failure produces an Idea with status "failed" and the
reason, so the cockpit can show why instead of a spinner.
"""
from __future__ import annotations

import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional

from . import http, media
from .apify import Apify, ApifyError
from .config import Config
from .models import Idea, Post
from .outliers import iso, score, tier_for, utcnow
from .platforms import PlatformError, adapter_for
from .platforms.snapchat import Snapchat
from .sinks import BridgeSink, JsonlSink, SupabaseSink, deliver
from .state import State
from .understand import understand
from .urls import Link, UnsupportedLink, canonicalize


class CaptureError(Exception):
    pass


def resolve_link(url: str) -> Link:
    link = canonicalize(url)
    if link.needs_resolve:
        final = http.resolve_redirect(url)
        link = canonicalize(final)
        if link.needs_resolve:
            raise UnsupportedLink(f"could not resolve the short link: {url}")
    return link


def fetch_post(cfg: Config, apify: Optional[Apify], link: Link, log: Callable[[str], None]) -> tuple[Optional[Post], list[str]]:
    ad = adapter_for(link.platform, cfg)
    warnings: list[str] = []
    if isinstance(ad, Snapchat) and not cfg.actor_snapchat:
        return ad.fetch_public_page(link.canonical_url)
    if apify is None:
        raise CaptureError("APIFY_API_KEY is not set")
    actor, inp = ad.post_job(link.canonical_url)
    items: list[dict[str, Any]] = []
    for attempt in range(2):
        items = apify.run_sync_items(actor, inp, timeout_secs=240)
        if items:
            break
        log(f"apify returned no items for {link.canonical_url} (attempt {attempt + 1})")
    posts = ad.parse_posts(items, handle=link.handle)
    if not posts:
        return None, warnings + ["the platform returned nothing for this link (private, removed, or blocked)"]
    exact = [p for p in posts if p.post_id == link.post_id]
    return (exact[0] if exact else posts[0]), warnings


def capture_url(
    cfg: Config,
    log: Callable[[str], None],
    url: str,
    *,
    saved_by: str = "",
    note: str = "",
    industry: str = "other",
    tags: Optional[list[str]] = None,
    cockpit_id: str = "",
    dry_run: bool = False,
    force: bool = False,
    keep_media: bool = False,
    apify: Optional[Apify] = None,
    state: Optional[State] = None,
    now: Optional[datetime] = None,
    understand_fn: Callable[..., dict[str, Any]] = understand,
) -> Idea:
    now = now or utcnow()
    cfg.ensure_dirs()
    state = state or State.load(cfg.state_path)
    when = iso(now)
    try:
        link = resolve_link(url)
    except UnsupportedLink as e:
        idea = Idea(key=f"unknown:{url[:80]}", platform="unknown", post_id="", url=url, origin="manual", status="failed", captured_at=when, saved_by=saved_by, note=note, error=str(e))
        _deliver(cfg, log, idea, dry_run)
        return idea
    if link.kind not in ("post", "spotlight", "story"):
        idea = Idea(key=link.key, platform=link.platform, post_id="", url=url, origin="manual", status="failed", captured_at=when, saved_by=saved_by, note=note, error=f"this is a {link.kind} link; paste one post, or add the account to the watchlist")
        _deliver(cfg, log, idea, dry_run)
        return idea
    existing = state.capture(link.key)
    if existing and existing.get("status") == "captured" and not force:
        log(f"already captured {link.key}, returning the stored idea")
        idea = Idea(**{k: v for k, v in existing["idea"].items() if k in Idea.__dataclass_fields__})
        if cockpit_id and not dry_run:
            _deliver(cfg, log, idea, dry_run, cockpit_id=cockpit_id)
        return idea

    if apify is None and cfg.apify_token:
        apify = Apify(cfg.apify_token, base=cfg.apify_base, timeout_sec=cfg.apify_timeout_sec, max_runs=cfg.apify_max_runs_per_scan, log=log)
    warnings: list[str] = []
    try:
        post, w = fetch_post(cfg, apify, link, log)
        warnings += w
    except (PlatformError, ApifyError, CaptureError, http.HttpError) as e:
        post, warnings = None, warnings + [f"fetch failed: {e}"]
    if post is None:
        idea = Idea(key=link.key, platform=link.platform, post_id=link.post_id, url=link.canonical_url, origin="manual", status="failed", captured_at=when, saved_by=saved_by, note=note, industry=industry, tags=list(tags or []), warnings=warnings, error=warnings[-1] if warnings else "fetch failed")
        state.set_capture(link.key, {"status": "failed", "at": when, "error": idea.error})
        if not dry_run:
            state.save()
        _deliver(cfg, log, idea, dry_run, cockpit_id=cockpit_id)
        return idea

    mult: Optional[float] = None
    tier: Optional[str] = None
    base = state.baseline(f"{post.platform}:account:{post.author_handle}") if post.author_handle else None
    if base is not None and post.views is not None:
        mult, _ = score(post, base)
        tier = tier_for(mult, cfg.threshold, cfg.reverse_threshold)

    workdir = Path(tempfile.mkdtemp(prefix="radar-capture-"))
    result: dict[str, Any] = {}
    try:
        video_path: Optional[Path] = None
        if post.media_url:
            video_path = workdir / "video.mp4"
            try:
                size = media.download_video(post.media_url, video_path, max_bytes=cfg.max_video_bytes)
                log(f"downloaded {size} bytes for {link.key}")
            except (http.HttpError, OSError) as e:
                warnings.append(f"media download failed: {e}")
                video_path = None
        else:
            warnings.append("no media URL returned; breakdown is from the caption only")
        info = media.probe(video_path) if video_path else {}
        if post.duration_sec is None and info.get("duration_sec"):
            post.duration_sec = info["duration_sec"]
        meta = {k: getattr(post, k) for k in ("platform", "author_handle", "author_name", "posted_at", "duration_sec", "views", "likes", "comments", "shares", "caption")}
        if video_path and post.duration_sec and post.duration_sec > cfg.max_duration_sec:
            warnings.append(f"video is {post.duration_sec:.0f}s, over the {cfg.max_duration_sec}s cap; not watched")
            video_path = None
        if video_path:
            try:
                result = understand_fn(cfg, video_path, meta, workdir, log)
            except (http.HttpError, ValueError, KeyError) as e:
                warnings.append(f"understanding failed: {http.scrub(str(e))[:200]}")
        if not result:
            from .understand import normalise_result, text_model_json, text_prompt  # local import keeps the fallback lazy
            try:
                raw, method = text_model_json(cfg, text_prompt(meta, "", [], "", None), log)
                result = normalise_result(raw)
                result["method"] = {"transcribe": "none", "on_screen": "none", "breakdown": method}
                result["confidence"] = {"transcript": "low", "on_screen_text": "low"}
            except (http.HttpError, ValueError, KeyError) as e:
                warnings.append(f"no breakdown: {http.scrub(str(e))[:200]}")
                result = {}
    finally:
        if keep_media:
            keep = cfg.out_dir / "media" / link.platform
            keep.mkdir(parents=True, exist_ok=True)
            for p in workdir.glob("video.*"):
                shutil.copy2(p, keep / f"{link.post_id}{p.suffix}")
        media.cleanup([workdir])

    idea = Idea(
        key=link.key, platform=post.platform, post_id=post.post_id, url=post.url or link.canonical_url,
        origin="manual", status="captured" if result else "failed", captured_at=when,
        author_handle=post.author_handle, author_name=post.author_name, author_followers=post.author_followers,
        posted_at=post.posted_at, views=post.views, likes=post.likes, comments=post.comments, shares=post.shares, saves=post.saves,
        caption=post.caption, duration_sec=post.duration_sec, thumb_url=post.thumb_url, media_url=post.media_url,
        industry=industry, tags=list(tags or []), saved_by=saved_by, note=note,
        language=result.get("language"), dialect=result.get("dialect"), has_speech=result.get("has_speech"), voice=result.get("voice"),
        transcript=result.get("transcript", ""), on_screen_text=result.get("on_screen_text", []), format=result.get("format"),
        hook=result.get("hook"), beats=result.get("beats", []), cta=result.get("cta"), why_it_works=result.get("why_it_works", ""),
        transferable=result.get("transferable", ""), adaptations=result.get("adaptations", []), music=result.get("music"),
        method=result.get("method", {}), confidence=result.get("confidence", {}),
        warnings=list(result.get("warnings", [])) + warnings, multiplier=None if mult is None else round(mult, 2), tier=tier,
        error=None if result else (warnings[-1] if warnings else "no breakdown"),
    )
    state.set_capture(link.key, {"status": idea.status, "at": when, "idea": idea.to_dict()})
    state.mark(link.key, "captured" if result else "failed", when)
    if not dry_run:
        state.save()
    _deliver(cfg, log, idea, dry_run, cockpit_id=cockpit_id)
    return idea


def _deliver(cfg: Config, log: Callable[[str], None], idea: Idea, dry_run: bool, *, cockpit_id: str = "") -> None:
    row = idea.to_dict()
    if cockpit_id:
        row["cockpit_id"] = cockpit_id
    jsonl = JsonlSink(cfg.out_dir / ("dry" if dry_run else ""))
    sinks: list[tuple[str, Callable[[], Any]]] = [("jsonl", lambda: jsonl.write_ideas([row]))]
    if not dry_run:
        if cfg.bridge_url and cfg.bridge_token:
            sinks.append(("bridge", lambda: BridgeSink(cfg.bridge_url, cfg.bridge_token).store_ideas([row])))
        if cfg.supabase_url and cfg.supabase_key:
            sinks.append(("supabase", lambda: SupabaseSink(cfg.supabase_url, cfg.supabase_key, cfg.supabase_table).upsert([row])))
    deliver(sinks, log)


def capture_pending(cfg: Config, log: Callable[[str], None], *, limit: int = 10, dry_run: bool = False, apify: Optional[Apify] = None, state: Optional[State] = None) -> list[Idea]:
    """Links pasted in the cockpit: fetch them from the bridge, capture each, push back."""
    if not (cfg.bridge_url and cfg.bridge_token):
        raise CaptureError("COCKPIT_IDEATION_URL and COCKPIT_IDEATION_TOKEN are not set")
    bridge = BridgeSink(cfg.bridge_url, cfg.bridge_token)
    rows = bridge.pending_captures(limit)
    log(f"{len(rows)} pending capture(s) in the cockpit")
    out: list[Idea] = []
    for r in rows:
        url = str(r.get("url") or "")
        if not url:
            continue
        idea = capture_url(
            cfg, log, url,
            saved_by=str(r.get("savedBy") or r.get("saved_by") or ""), note=str(r.get("note") or ""),
            industry=str(r.get("industry") or "other"), tags=list(r.get("tags") or []),
            cockpit_id=str(r.get("id") or ""), dry_run=dry_run, apify=apify, state=state,
        )
        out.append(idea)
    return out
