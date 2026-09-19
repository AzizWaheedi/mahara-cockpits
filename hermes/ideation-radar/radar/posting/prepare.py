"""One post, prepared: the video on disk, eight candidate frames, the
transcript with timestamps, the copy, and a first thumbnail and cover. The
row ends `ready` with everything Aziz needs to read, change and approve."""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Callable, Optional

from .. import media, speech
from ..config import Config
from . import thumbs, write
from .fetch import fetch_video
from .store import PostStore, now_iso

FRAMES = 8


def frame_times(duration: float, n: int = FRAMES) -> list[float]:
    """Where to look for a face: just after the start, then evenly through the middle."""
    d = max(0.0, float(duration or 0))
    if d <= 1.5:
        return [round(d / 2, 2)]
    pts = [1.0, 2.5] if d > 6 else [d * 0.2, d * 0.5]
    lo, hi = d * 0.1, d * 0.9
    k = max(1, n - len(pts))
    for i in range(k):
        pts.append(lo + (hi - lo) * i / max(1, k - 1))
    out = sorted({round(min(max(0.0, t), max(0.0, d - 0.2)), 2) for t in pts})
    return out[:n]


def grab(video: Path, ts: float, out: Path, *, max_w: int = 1280) -> bool:
    """One frame at `ts`, at most `max_w` wide, native aspect."""
    if not media.has_ffmpeg():
        return False
    out.parent.mkdir(parents=True, exist_ok=True)
    res = subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-ss", f"{ts:.2f}", "-i", str(video), "-frames:v", "1", "-q:v", "3", "-vf", f"scale='min({max_w},iw)':-2", str(out)],
        capture_output=True, text=True, timeout=120, check=False, stdin=subprocess.DEVNULL,
    )
    return res.returncode == 0 and out.exists() and out.stat().st_size > 500


def pick_frame(frames: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """The sharpest frame after the first moments, so the cut-in blur never wins."""
    if not frames:
        return None
    settled = [f for f in frames if int(f.get("ms") or 0) >= 800] or frames
    return max(settled, key=lambda f: float(f.get("sharpness") or 0))


def run(cfg: Config, log: Callable[[str], None], store: PostStore, post: dict[str, Any], workdir: Path) -> dict[str, Any]:
    pid = int(post["id"])
    video, patch = fetch_video(cfg, log, store, post, workdir)
    info = media.probe(video)
    patch.update({k: info.get(k) for k in ("duration_sec", "width", "height")})
    duration = float(info.get("duration_sec") or 0)
    fonts = thumbs.ensure_fonts(log)

    frames: list[dict[str, Any]] = []
    for i, ts in enumerate(frame_times(duration)):
        local = workdir / f"frame{i}.jpg"
        if not grab(video, ts, local):
            continue
        path = store.upload(f"posts/{pid}/frames/{i}.jpg", local.read_bytes(), "image/jpeg")
        frames.append({"ms": int(ts * 1000), "path": path, "sharpness": round(thumbs.sharpness(local), 1), "_local": local})
    log(f"post {pid}: {len(frames)} frames, {duration:.0f}s, {info.get('width')}x{info.get('height')}")

    transcript = speech.transcribe(cfg, video, workdir, log, has_audio=info.get("has_audio"))
    outliers = store.outliers(12)
    copy, copy_method = write.compose(cfg, log, post, transcript, info, outliers)

    best = pick_frame(frames)
    text = copy.get("thumb_text") or str(post.get("title_working") or "").strip()
    thumb_path = cover_path = None
    if best and text:
        thumb_path = store.upload(f"posts/{pid}/thumb.jpg", thumbs.render_youtube(best["_local"], text, fonts=fonts, log=log), "image/jpeg")
        cover_path = store.upload(f"posts/{pid}/cover.jpg", thumbs.render_cover(best["_local"], text, fonts=fonts, log=log), "image/jpeg")

    patch.update({
        "status": "ready",
        "error": None,
        "language": copy.get("language") or transcript.get("language"),
        "transcript": {k: transcript.get(k) for k in ("text", "language", "method", "segments", "warnings", "confidence")},
        "chapters": copy["chapters"],
        "yt_title": copy["yt_title"],
        "yt_title_options": copy["yt_title_options"],
        "yt_description": copy["yt_description"],
        "yt_tags": copy["yt_tags"],
        "ig_caption": copy["ig_caption"],
        "ig_hashtags": copy["ig_hashtags"],
        "thumb_text": text or None,
        "thumb_text_options": copy["thumb_text_options"],
        "thumb_frame_ms": best["ms"] if best else None,
        "thumb_path": thumb_path,
        "cover_path": cover_path,
        "frames": [{k: v for k, v in f.items() if not k.startswith("_")} for f in frames],
        "method": {"speech": transcript.get("method"), "copy": copy_method, "render": "pillow", "notes": copy.get("notes"), "at": now_iso()},
        "outlier_refs": [o.get("key") for o in outliers if o.get("key")],
    })
    store.patch_post(pid, patch)
    return {"frames": len(frames), "transcript_chars": len(str(transcript.get("text") or "")), "speech": transcript.get("method"), "copy": copy_method, "thumb": bool(thumb_path)}


def render(cfg: Config, log: Callable[[str], None], store: PostStore, post: dict[str, Any], params: dict[str, Any], workdir: Path) -> dict[str, Any]:
    """A new thumbnail and cover: Aziz changed the line or picked another frame."""
    pid = int(post["id"])
    text = str(params.get("thumb_text") or post.get("thumb_text") or "").strip()
    if not text:
        raise ValueError("no thumbnail line to render")
    frames = [f for f in (post.get("frames") or []) if isinstance(f, dict) and f.get("path")]
    if not frames:
        raise ValueError("this post has no frames yet")
    want = params.get("frame_ms")
    frame = min(frames, key=lambda f: abs(int(f.get("ms") or 0) - int(want))) if isinstance(want, (int, float)) else next((f for f in frames if f.get("ms") == post.get("thumb_frame_ms")), frames[0])
    local = workdir / "frame.jpg"
    local.write_bytes(store.download(str(frame["path"])))
    fonts = thumbs.ensure_fonts(log)
    thumb_path = store.upload(f"posts/{pid}/thumb.jpg", thumbs.render_youtube(local, text, fonts=fonts, log=log), "image/jpeg")
    cover_path = store.upload(f"posts/{pid}/cover.jpg", thumbs.render_cover(local, text, fonts=fonts, log=log), "image/jpeg")
    store.patch_post(pid, {"thumb_text": text, "thumb_frame_ms": int(frame.get("ms") or 0), "thumb_path": thumb_path, "cover_path": cover_path, "error": None})
    return {"thumb": thumb_path, "cover": cover_path, "frame_ms": frame.get("ms")}
