"""The queue the cockpit writes and the worker drains, every two minutes
under a lock. One job at a time, each in its own temporary folder, every
failure written back where Aziz can read it."""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Callable

from .. import http, media
from ..config import Config, key
from ..supabase import Supabase
from . import prepare, thumbs, youtube
from .fetch import fetch_video
from .store import BUCKET, PostStore, now_iso

YOUTUBE_NOTE = "Needs one consent: open the link, allow, then paste the address of the page you land on (it will look broken) into the Posting tab."


def make_store(cfg: Config) -> PostStore:
    if not cfg.supabase_configured:
        raise http.HttpError(0, "RADAR_SUPABASE_URL and RADAR_SUPABASE_KEY are needed for the posting desk")
    return PostStore(Supabase(cfg.supabase_url, cfg.supabase_key, table="cockpit_posts", bucket=BUCKET))


def refresh_youtube_door(store: PostStore, log: Callable[[str], None]) -> None:
    """Keep the cockpit's YouTube row honest: connected, or the link to fix that."""
    ch = store.channel("youtube") or {}
    if youtube.connected():
        if not ch.get("connected"):
            try:
                info = youtube.channel_mine()
                store.set_channel("youtube", connected=True, connected_at=now_iso(), handle=info.get("handle") or ch.get("handle"), external_id=info.get("id") or ch.get("external_id"), auth_url=None, note=f"Connected as {info.get('title')}.")
                log(f"youtube: connected as {info.get('title')}")
            except (http.HttpError, ValueError) as e:
                store.set_channel("youtube", connected=False, note=f"The saved consent no longer works: {http.scrub(str(e))[:160]}", auth_url=_auth_url_or_none())
        return
    url = _auth_url_or_none()
    if ch.get("connected") or ch.get("auth_url") != url:
        store.set_channel("youtube", connected=False, auth_url=url, note=YOUTUBE_NOTE if url else "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing on the VPS.")


def _auth_url_or_none() -> str | None:
    try:
        return youtube.auth_url()
    except http.HttpError:
        return None


def publish_youtube(cfg: Config, log: Callable[[str], None], store: PostStore, post: dict[str, Any], params: dict[str, Any], workdir: Path) -> dict[str, Any]:
    pid = int(post["id"])
    targets = list(post.get("targets") or [])
    if "youtube" not in targets:
        raise ValueError("YouTube is not one of this post's targets")
    if post.get("status") not in ("approved", "publishing"):
        raise ValueError(f"the post is {post.get('status')}, not approved")
    published = dict(post.get("published") or {})
    if (published.get("youtube") or {}).get("id"):
        return {"already": published["youtube"]}
    video, _ = fetch_video(cfg, log, store, post, workdir)
    store.patch_post(pid, {"status": "publishing"})
    privacy = str(params.get("privacy") or "public")
    title = str(post.get("yt_title") or post.get("title_working") or "").strip() or "Untitled"
    vid = youtube.upload(video, title=title, description=str(post.get("yt_description") or ""), tags=list(post.get("yt_tags") or []), privacy=privacy, language=str(post.get("language") or "ar")[:2] or "ar")
    log(f"post {pid}: uploaded to YouTube as {vid} ({privacy})")
    thumb_ok = False
    if post.get("thumb_path"):
        try:
            youtube.set_thumbnail(vid, store.download(str(post["thumb_path"])))
            thumb_ok = True
        except http.HttpError as e:
            log(f"post {pid}: thumbnail not set: {http.scrub(str(e))[:160]}")
    published["youtube"] = {"id": vid, "url": youtube.video_url(vid), "at": now_iso(), "privacy": privacy, "thumbnail": thumb_ok}
    done = all((published.get(t) or {}).get("id") for t in targets)
    store.patch_post(pid, {"published": published, "status": "published" if done else "publishing", "error": None})
    return {"video_id": vid, "url": youtube.video_url(vid), "privacy": privacy, "thumbnail": thumb_ok}


def run_jobs(cfg: Config, log: Callable[[str], None], *, limit: int = 2, dry_run: bool = False) -> list[dict[str, Any]]:
    store = make_store(cfg)
    try:
        refresh_youtube_door(store, log)
    except (http.HttpError, ValueError) as e:
        log(f"youtube door: {http.scrub(str(e))[:160]}")
    if dry_run:
        return store.sb.select("cockpit_post_jobs", "select=id,kind,post_id,status,attempts,created_at&status=eq.queued&order=created_at.asc&limit=20")
    done: list[dict[str, Any]] = []
    for job in store.claim_jobs(limit):
        kind = str(job.get("kind") or "")
        params = job.get("params") if isinstance(job.get("params"), dict) else {}
        pid = job.get("post_id")
        with tempfile.TemporaryDirectory(prefix="posting-") as tmp:
            workdir = Path(tmp)
            try:
                if kind == "youtube_auth":
                    info = youtube.exchange(str(params.get("redirect_url") or params.get("code") or ""))
                    store.set_channel("youtube", connected=True, connected_at=now_iso(), handle=info.get("handle"), external_id=info.get("id"), auth_url=None, note=f"Connected as {info.get('title')}.")
                    result: dict[str, Any] = {"channel": info}
                else:
                    post = store.post(int(pid)) if pid else None
                    if not post:
                        raise ValueError("the post this job is about is gone")
                    if kind == "prepare":
                        store.patch_post(int(pid), {"status": "preparing", "error": None})
                        result = prepare.run(cfg, log, store, post, workdir)
                    elif kind == "render":
                        result = prepare.render(cfg, log, store, post, params, workdir)
                    elif kind == "publish_youtube":
                        result = publish_youtube(cfg, log, store, post, params, workdir)
                    else:
                        raise ValueError(f"unknown job kind {kind!r}")
                store.finish_job(job, result=result)
                done.append({"id": job["id"], "kind": kind, "post_id": pid, "status": "done", "result": result})
                log(f"job {job['id']} {kind}: done {result}")
            except Exception as e:  # noqa: BLE001 - the error is the result
                msg = http.scrub(str(e))[:400] or e.__class__.__name__
                store.finish_job(job, error=msg)
                if kind in ("prepare", "publish_youtube") and pid:
                    try:
                        store.patch_post(int(pid), {"status": "failed", "error": msg})
                    except http.HttpError:
                        pass
                done.append({"id": job["id"], "kind": kind, "post_id": pid, "status": "failed", "error": msg})
                log(f"job {job['id']} {kind}: FAILED {msg}")
    return done


def doctor(cfg: Config) -> list[tuple[str, str, str]]:
    """Rows for `radar.py posts --doctor`: (status, what, note)."""
    rows: list[tuple[str, str, str]] = []
    rows.append(("OK" if media.has_ffmpeg() and media.has_ffprobe() else "MISSING", "ffmpeg", "frames and audio"))
    try:
        from PIL import features  # noqa: F401

        import PIL

        rows.append(("OK", "pillow", f"{PIL.__version__}, raqm {'on' if thumbs._raqm() else 'off (reshaper fallback)'}"))
    except Exception:  # noqa: BLE001
        rows.append(("MISSING", "pillow", "python3 -m pip install --user --break-system-packages pillow arabic-reshaper python-bidi"))
    try:
        fonts = thumbs.ensure_fonts()
        rows.append(("OK", "fonts", ", ".join(p.name for p in fonts.values())))
    except Exception as e:  # noqa: BLE001
        rows.append(("MISSING", "fonts", http.scrub(str(e))[:120]))
    rows.append(("OK" if cfg.elevenlabs_key or cfg.groq_key else "MISSING", "speech", "ElevenLabs Scribe, then Groq"))
    rows.append(("OK" if cfg.gemini_key or cfg.openai_key or cfg.deepseek_key else "MISSING", "copy model", key("POSTING_TEXT_PROVIDER", "gemini,openai,deepseek")))
    rows.append(("OK" if key("GOOGLE_CLIENT_ID") and key("GOOGLE_CLIENT_SECRET") else "MISSING", "google client", "for Drive downloads and the YouTube consent"))
    rows.append(("OK" if key("GOOGLE_REFRESH_TOKEN") else "--", "drive token", "Drive links need it; uploads and plain links do not"))
    rows.append(("OK" if youtube.connected() else "--", "youtube", "connected" if youtube.connected() else "not consented yet; the Posting tab shows the link"))
    try:
        store = make_store(cfg)
        ch = store.channel("instagram")
        rows.append(("OK" if ch else "MISSING", "posting tables", "cockpit_posts, cockpit_post_jobs, cockpit_channels in Creative Triage"))
    except Exception as e:  # noqa: BLE001
        rows.append(("MISSING", "posting tables", http.scrub(str(e))[:120]))
    return rows
