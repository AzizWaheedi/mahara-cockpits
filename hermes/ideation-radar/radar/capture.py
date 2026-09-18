"""One pasted link: fetch, watch, break down, save.

Idempotent on the post key: a link captured before returns the stored idea
unless --force. Every failure produces an Idea with status "failed" and the
reason, so the cockpit can show why instead of a spinner.
"""
from __future__ import annotations

import re
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
from .sinks import BridgeSink, JsonlSink, deliver
from .state import State
from .stills import attach_stills, storyboard_from_file
from .supabase import Supabase, SupabaseError
from .understand import understand
from .urls import Link, UnsupportedLink, canonicalize


class CaptureError(Exception):
    pass


AD_LIBRARY_RE = re.compile(r"facebook\.com/ads/library/?\?(?:.*&)?id=(\d+)", re.I)
GOOGLE_AD_RE = re.compile(r"adstransparency\.google\.com/advertiser/([A-Za-z0-9]+)/creative/([A-Za-z0-9]+)", re.I)
YOUTUBE_RE = re.compile(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/)|youtu\.be/)([A-Za-z0-9_-]{6,20})", re.I)
FACEBOOK_VIDEO_RE = re.compile(r"facebook\.com/(?:reel/(\d+)|watch/?\?v=(\d+)|[^/]+/videos/(\d+))", re.I)


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
    if isinstance(ad, Snapchat) and (not cfg.actor_snapchat_post or link.kind != "spotlight"):
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
    special = capture_special(cfg, log, url, saved_by=saved_by, note=note, industry=industry, tags=tags, cockpit_id=cockpit_id, dry_run=dry_run, state=state, when=when, understand_fn=understand_fn)
    if special is not None:
        return special
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
    if base is not None and post.views:
        mult, _ = score(post, base)
        tier = tier_for(mult, cfg.threshold, cfg.reverse_threshold)

    workdir = Path(tempfile.mkdtemp(prefix="radar-capture-"))
    result: dict[str, Any] = {}
    storyboard: Optional[bytes] = None
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
        captions = platform_captions(post, log)
        if captions:
            meta["platform_captions"] = captions[:6000]
        if video_path and post.duration_sec and post.duration_sec > cfg.max_duration_sec:
            warnings.append(f"video is {post.duration_sec:.0f}s, over the {cfg.max_duration_sec}s cap; not watched")
            video_path = None
        if video_path:
            try:
                storyboard = storyboard_from_file(video_path, workdir / "story", duration=post.duration_sec)
            except Exception as e:  # noqa: BLE001 - the picture is a bonus
                log(f"storyboard failed: {e}")
            try:
                result = understand_fn(cfg, video_path, meta, workdir, log)
            except (http.HttpError, ValueError, KeyError) as e:
                warnings.append(f"understanding failed: {http.scrub(str(e))[:200]}")
        if not result and meta.get("platform_captions"):
            # No model could watch it, but the platform's own auto-captions exist.
            from .understand import normalise_result
            result = normalise_result({"transcript": meta["platform_captions"], "has_speech": True, "voice": "voiceover", "language": "mixed", "on_screen_text": [], "format": "other", "hook": {"text": meta["platform_captions"].split("\n")[0][:200], "type": "opening line"}, "beats": [], "why_it_works": "", "transferable": "", "adaptations": [], "confidence": {"transcript": "medium", "on_screen_text": "low"}, "warnings": ["only the platform's auto-captions were available; no model watched the video"]})
            result["method"] = {"transcribe": "platform_captions", "on_screen": "none", "breakdown": "none"}
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
    _deliver(cfg, log, idea, dry_run, cockpit_id=cockpit_id, storyboard=storyboard)
    return idea


def capture_special(cfg: Config, log: Callable[[str], None], url: str, *, saved_by: str, note: str, industry: str, tags: Optional[list[str]], cockpit_id: str, dry_run: bool, state: State, when: str, understand_fn: Callable[..., dict[str, Any]]) -> Optional[Idea]:
    """Links the platform adapters do not know: a Meta ad, a Google ad, a YouTube or Facebook video."""
    u = url.strip()
    m = AD_LIBRARY_RE.search(u)
    if m:
        return capture_meta_ad(cfg, log, u, m.group(1), saved_by=saved_by, note=note, industry=industry, tags=tags, cockpit_id=cockpit_id, dry_run=dry_run, state=state, when=when, understand_fn=understand_fn)
    g = GOOGLE_AD_RE.search(u)
    if g:
        idea = Idea(key=f"google_ads:{g.group(2)}", platform="google_ads", post_id=g.group(2), url=u, origin="ads", status="failed", captured_at=when, saved_by=saved_by, note=note, industry=industry, tags=list(tags or []), error="Google's Transparency Center gives no downloadable creative here; open the ad in the browser to read it")
        _deliver(cfg, log, idea, dry_run, cockpit_id=cockpit_id)
        return idea
    y = YOUTUBE_RE.search(u)
    if y:
        return capture_transcript_only(cfg, log, "youtube", y.group(1), f"https://www.youtube.com/watch?v={y.group(1)}", "/v1/youtube/video/transcript", saved_by=saved_by, note=note, industry=industry, tags=tags, cockpit_id=cockpit_id, dry_run=dry_run, state=state, when=when)
    f = FACEBOOK_VIDEO_RE.search(u)
    if f:
        vid = next(x for x in f.groups() if x)
        return capture_transcript_only(cfg, log, "facebook", vid, u, "/v1/facebook/post/transcript", saved_by=saved_by, note=note, industry=industry, tags=tags, cockpit_id=cockpit_id, dry_run=dry_run, state=state, when=when)
    return None


def capture_meta_ad(cfg: Config, log: Callable[[str], None], url: str, ad_id: str, *, saved_by: str, note: str, industry: str, tags: Optional[list[str]], cockpit_id: str, dry_run: bool, state: State, when: str, understand_fn: Callable[..., dict[str, Any]]) -> Idea:
    """A Meta Ad Library ad: fresh media through ScrapeCreators, then the same watch and breakdown as any post."""
    from datetime import datetime, timezone

    from .sources.scrapecreators import ScrapeCreators, meta_ad_row

    key = f"meta_ads:{ad_id}"
    warnings: list[str] = []
    row: Optional[dict[str, Any]] = None
    try:
        sc = ScrapeCreators(cfg.scrapecreators_key, log=log)
        ad = sc.fb_ad(ad_id)
        if ad is None and cfg.use_supabase_sink:
            # The library's single-ad lookup misses active ads at times; the page's list has it.
            sb = Supabase(cfg.supabase_url, cfg.supabase_key, table=cfg.supabase_table, bucket=cfg.supabase_bucket)
            stored = sb.select(sb.table, f"select=ad_page_id,advertiser&key=eq.{http.quote_key(key)}&limit=1")
            page_id = stored[0].get("ad_page_id") if stored else None
            if page_id:
                for a in sc.fb_company_ads(str(page_id), pages=3):
                    if str(a.get("ad_archive_id")) == ad_id:
                        ad = a
                        break
        if ad is not None:
            row = meta_ad_row(ad, now=datetime.now(timezone.utc))
    except (http.HttpError, SupabaseError) as e:
        warnings.append(f"ad lookup failed: {http.scrub(str(e))[:160]}")
    if row is None:
        idea = Idea(key=key, platform="meta_ads", post_id=ad_id, url=url, origin="ads", status="failed", captured_at=when, saved_by=saved_by, note=note, industry=industry, tags=list(tags or []), warnings=warnings, error=warnings[-1] if warnings else "this ad is no longer in the Ad Library (ended or removed)")
        _deliver(cfg, log, idea, dry_run, cockpit_id=cockpit_id)
        return idea
    post = Post(platform="meta_ads", post_id=ad_id, url=url, author_handle=str(row.get("author_handle") or ""), author_name=str(row.get("author_name") or ""), author_followers=row.get("author_followers"), posted_at=row.get("posted_at"), caption=str(row.get("caption") or ""), media_url=row.get("media_url"), thumb_url=row.get("thumb_url"), is_video=bool(row.get("media_url")))
    idea = _watch_and_build(cfg, log, post, key, origin="ads", when=when, saved_by=saved_by, note=note, industry=industry, tags=tags, warnings=warnings, state=state, dry_run=dry_run, cockpit_id=cockpit_id, understand_fn=understand_fn)
    return idea


def capture_transcript_only(cfg: Config, log: Callable[[str], None], platform: str, post_id: str, url: str, path: str, *, saved_by: str, note: str, industry: str, tags: Optional[list[str]], cockpit_id: str, dry_run: bool, state: State, when: str) -> Idea:
    """YouTube and Facebook videos: the vendor's transcript plus a text breakdown, no download (yet)."""
    from .sources.scrapecreators import ScrapeCreators
    from .understand import normalise_result, text_model_json, text_prompt

    key = f"{platform}:{post_id}"
    warnings: list[str] = []
    transcript = ""
    try:
        sc = ScrapeCreators(cfg.scrapecreators_key, log=log)
        out = sc.get(path, url=url)
        transcript = _transcript_text(out)
    except http.HttpError as e:
        warnings.append(f"transcript fetch failed: {http.scrub(str(e))[:160]}")
    result: dict[str, Any] = {}
    if transcript:
        meta = {"platform": platform, "author_handle": "", "caption": ""}
        try:
            raw, method = text_model_json(cfg, text_prompt(meta, transcript, [], "", True), log)
            result = normalise_result(raw)
            result["transcript"] = transcript[:12000]
            result["method"] = {"transcribe": f"scrapecreators:{platform}-transcript", "on_screen": "none", "breakdown": method}
            result["confidence"] = {"transcript": "medium", "on_screen_text": "low"}
        except (http.HttpError, ValueError, KeyError) as e:
            warnings.append(f"no breakdown: {http.scrub(str(e))[:160]}")
    else:
        warnings.append("no transcript available for this video")
    idea = Idea(
        key=key, platform=platform, post_id=post_id, url=url, origin="manual", status="captured" if result else "failed", captured_at=when,
        industry=industry, tags=list(tags or []), saved_by=saved_by, note=note,
        language=result.get("language"), dialect=result.get("dialect"), has_speech=result.get("has_speech"), voice=result.get("voice"),
        transcript=result.get("transcript", ""), on_screen_text=[], format=result.get("format"), hook=result.get("hook"), beats=result.get("beats", []),
        cta=result.get("cta"), why_it_works=result.get("why_it_works", ""), transferable=result.get("transferable", ""), adaptations=result.get("adaptations", []),
        method=result.get("method", {}), confidence=result.get("confidence", {}), warnings=list(result.get("warnings", [])) + warnings,
        error=None if result else (warnings[-1] if warnings else "no transcript"),
    )
    state.set_capture(key, {"status": idea.status, "at": when, "idea": idea.to_dict()})
    state.mark(key, "captured" if result else "failed", when)
    if not dry_run:
        state.save()
    _deliver(cfg, log, idea, dry_run, cockpit_id=cockpit_id)
    return idea


def _transcript_text(out: Any) -> str:
    """The vendor's transcript reply, whatever shape it takes."""
    if isinstance(out, dict):
        for k in ("transcript", "transcript_only_text", "text"):
            v = out.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
            if isinstance(v, list):
                parts = [str(x.get("text") if isinstance(x, dict) else x) for x in v]
                joined = " ".join(p for p in parts if p and p != "None").strip()
                if joined:
                    return joined
        for v in out.values():
            if isinstance(v, dict):
                t = _transcript_text(v)
                if t:
                    return t
    return ""


def _watch_and_build(cfg: Config, log: Callable[[str], None], post: Post, key: str, *, origin: str, when: str, saved_by: str, note: str, industry: str, tags: Optional[list[str]], warnings: list[str], state: State, dry_run: bool, cockpit_id: str, understand_fn: Callable[..., dict[str, Any]]) -> Idea:
    """Download, storyboard, watch, break down and deliver: the shared tail of every capture."""
    workdir = Path(tempfile.mkdtemp(prefix="radar-capture-"))
    result: dict[str, Any] = {}
    storyboard: Optional[bytes] = None
    try:
        video_path: Optional[Path] = None
        if post.media_url:
            video_path = workdir / "video.mp4"
            try:
                size = media.download_video(post.media_url, video_path, max_bytes=cfg.max_video_bytes)
                log(f"downloaded {size} bytes for {key}")
            except (http.HttpError, OSError) as e:
                warnings.append(f"media download failed: {e}")
                video_path = None
        else:
            warnings.append("no video on this ad; breakdown is from its copy only")
        info = media.probe(video_path) if video_path else {}
        if post.duration_sec is None and info.get("duration_sec"):
            post.duration_sec = info["duration_sec"]
        meta = {k: getattr(post, k) for k in ("platform", "author_handle", "author_name", "posted_at", "duration_sec", "views", "likes", "comments", "shares", "caption")}
        if video_path:
            try:
                storyboard = storyboard_from_file(video_path, workdir / "story", duration=post.duration_sec)
            except Exception as e:  # noqa: BLE001
                log(f"storyboard failed: {e}")
            try:
                result = understand_fn(cfg, video_path, meta, workdir, log)
            except (http.HttpError, ValueError, KeyError) as e:
                warnings.append(f"understanding failed: {http.scrub(str(e))[:200]}")
        if not result and post.caption:
            from .understand import normalise_result, text_model_json, text_prompt
            try:
                raw, method = text_model_json(cfg, text_prompt(meta, "", [], "", None), log)
                result = normalise_result(raw)
                result["method"] = {"transcribe": "none", "on_screen": "none", "breakdown": method}
                result["confidence"] = {"transcript": "low", "on_screen_text": "low"}
            except (http.HttpError, ValueError, KeyError) as e:
                warnings.append(f"no breakdown: {http.scrub(str(e))[:200]}")
    finally:
        media.cleanup([workdir])
    idea = Idea(
        key=key, platform=post.platform, post_id=post.post_id, url=post.url, origin=origin, status="captured" if result else "failed", captured_at=when,
        author_handle=post.author_handle, author_name=post.author_name, author_followers=post.author_followers, posted_at=post.posted_at,
        views=post.views, likes=post.likes, comments=post.comments, caption=post.caption, duration_sec=post.duration_sec, thumb_url=post.thumb_url, media_url=post.media_url,
        industry=industry, tags=list(tags or []), saved_by=saved_by, note=note,
        language=result.get("language"), dialect=result.get("dialect"), has_speech=result.get("has_speech"), voice=result.get("voice"),
        transcript=result.get("transcript", ""), on_screen_text=result.get("on_screen_text", []), format=result.get("format"), hook=result.get("hook"),
        beats=result.get("beats", []), cta=result.get("cta"), why_it_works=result.get("why_it_works", ""), transferable=result.get("transferable", ""),
        adaptations=result.get("adaptations", []), music=result.get("music"), method=result.get("method", {}), confidence=result.get("confidence", {}),
        warnings=list(result.get("warnings", [])) + warnings, error=None if result else (warnings[-1] if warnings else "no breakdown"),
    )
    state.set_capture(key, {"status": idea.status, "at": when, "idea": idea.to_dict()})
    state.mark(key, "captured" if result else "failed", when)
    if not dry_run:
        state.save()
    _deliver(cfg, log, idea, dry_run, cockpit_id=cockpit_id, storyboard=storyboard)
    return idea


def platform_captions(post: Post, log: Callable[[str], None]) -> str:
    """TikTok returns its own auto-caption tracks (videoMeta.subtitleLinks). They are
    free and often good for Arabic speech; used as a hint for the model and as
    the transcript of last resort."""
    links = post.raw.get("subtitleLinks") if isinstance(post.raw, dict) else None
    if not isinstance(links, list) or not links:
        return ""
    pick = None
    for l in links:
        if not isinstance(l, dict):
            continue
        lang = str(l.get("language") or "").lower()
        if lang.startswith("ar"):
            pick = l
            break
        pick = pick or l
    url = pick.get("downloadLink") or pick.get("url") if isinstance(pick, dict) else None
    if not url:
        return ""
    try:
        _, _, body = http.request("GET", str(url), timeout=30, retries=1)
    except http.HttpError as e:
        log(f"captions fetch failed: {e}")
        return ""
    text = body.decode("utf-8", "replace")
    lines = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("WEBVTT") or "-->" in s or s.isdigit():
            continue
        if not lines or lines[-1] != s:
            lines.append(s)
    return "\n".join(lines)


def _deliver(cfg: Config, log: Callable[[str], None], idea: Idea, dry_run: bool, *, cockpit_id: str = "", storyboard: Optional[bytes] = None) -> None:
    row = idea.to_dict()
    if cockpit_id:
        row["cockpit_id"] = cockpit_id
    jsonl = JsonlSink(cfg.out_dir / ("dry" if dry_run else ""))
    sinks: list[tuple[str, Callable[[], Any]]] = [("jsonl", lambda: jsonl.write_ideas([row]))]
    if not dry_run:
        if cfg.use_supabase_sink:
            sb = Supabase(cfg.supabase_url, cfg.supabase_key, table=cfg.supabase_table, bucket=cfg.supabase_bucket)
            def to_supabase() -> None:
                if idea.status == "captured":
                    if storyboard:
                        row["_storyboard"] = storyboard  # the capture's own download: no second fetch
                    attach_stills(sb, [row], log, max_items=1)
                    row.pop("_storyboard", None)
                try:
                    sb.store_idea(row, origin_key=cockpit_id or None)
                except SupabaseError as e:
                    log(f"supabase: {e}")
            sinks.append(("supabase", to_supabase))
        if cfg.use_cockpit_sink:
            sinks.append(("cockpit", lambda: BridgeSink(cfg.bridge_url, cfg.bridge_token).store_ideas([row])))
    deliver(sinks, log)


def capture_pending(cfg: Config, log: Callable[[str], None], *, limit: int = 10, dry_run: bool = False, apify: Optional[Apify] = None, state: Optional[State] = None) -> list[Idea]:
    """Links pasted in the cockpit: claim them from the store, capture each, write back."""
    if cfg.use_supabase_sink:
        sb = Supabase(cfg.supabase_url, cfg.supabase_key, table=cfg.supabase_table, bucket=cfg.supabase_bucket)
        rows = sb.claim_pending(limit)
        id_field = "key"
    elif cfg.bridge_url and cfg.bridge_token:
        rows = BridgeSink(cfg.bridge_url, cfg.bridge_token).pending_captures(limit)
        id_field = "id"
    else:
        raise CaptureError("no store configured: set RADAR_SUPABASE_URL and RADAR_SUPABASE_KEY (or the cockpit door)")
    log(f"{len(rows)} pending capture(s)")
    out: list[Idea] = []
    for r in rows:
        url = str(r.get("url") or "")
        if not url:
            continue
        idea = capture_url(
            cfg, log, url,
            saved_by=str(r.get("savedBy") or r.get("saved_by") or ""), note=str(r.get("note") or ""),
            industry=str(r.get("industry") or "other"), tags=list(r.get("tags") or []),
            cockpit_id=str(r.get(id_field) or ""), dry_run=dry_run, apify=apify, state=state, force=True,
        )
        out.append(idea)
    return out
