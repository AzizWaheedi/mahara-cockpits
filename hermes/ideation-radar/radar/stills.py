"""The cockpit's own picture per post.

Platform thumbnail links expire within hours, so a copy goes into the
private stills bucket when a row is written. Since 2026-09-18 the copy is a
three-frame storyboard (start, middle, end of the video, side by side) when
the video can be fetched and ffmpeg is present; otherwise the platform's
single thumbnail, as before. Small, bounded, best effort; a failure is
noted on the row and never stops the batch.

A storyboard is stored as `<platform>/<post_id>.story.jpg`; the cockpit
recognises the suffix and shows it wide.
"""
from __future__ import annotations

import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable, Optional

from . import http, media
from .supabase import Supabase

MAX_BYTES = 250_000
STORY_MAX_BYTES = 700_000
MIN_BYTES = 200
TIMEOUT = 10
BUDGET_SEC = 40
STORY_BUDGET_SEC = 300
STORY_VIDEO_MAX_BYTES = 40 * 1024 * 1024
STORY_VIDEO_TIMEOUT = 25
FRAME_W, FRAME_H = 480, 854


def fetch_image(url: str) -> tuple[bytes, str]:
    if not url.lower().startswith("https://"):
        raise http.HttpError(0, "not an https link")
    req = urllib.request.Request(url, headers={"User-Agent": http.USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        ctype = (res.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if not ctype.startswith("image/"):
            raise http.HttpError(0, f"not an image ({ctype[:40]})")
        blob = res.read(MAX_BYTES + 1)
    if len(blob) < MIN_BYTES:
        raise http.HttpError(0, "empty image")
    if len(blob) > MAX_BYTES:
        raise http.HttpError(0, f"over {MAX_BYTES} bytes")
    return blob, ctype


def story_times(duration: Optional[float]) -> list[float]:
    """Start, middle, end: past the first frame, and before the closing card fades."""
    d = float(duration) if duration and duration > 0 else 0.0
    if d <= 0:
        return [1.0, 6.0, 12.0]
    if d < 4:
        return [round(d * 0.1, 2), round(d * 0.5, 2), round(d * 0.85, 2)]
    return [1.0, round(d * 0.5, 2), round(max(d - 1.5, d * 0.85), 2)]


def storyboard_from_file(video_path: Path, workdir: Path, *, duration: Optional[float] = None) -> Optional[bytes]:
    """Three frames side by side as one JPEG, or None when fewer than two frames could be read."""
    if not media.has_ffmpeg():
        return None
    total = duration or media.probe(video_path).get("duration_sec")
    frames: list[Path] = []
    for i, ts in enumerate(story_times(total)):
        target = workdir / f"story_{i}.jpg"
        if media.frame_at(video_path, ts, target, width=FRAME_W, height=FRAME_H):
            frames.append(target)
    if len(frames) < 2:
        return None
    out = workdir / "storyboard.jpg"
    if not media.hstack(frames, out):
        return None
    blob = out.read_bytes()
    if len(blob) < MIN_BYTES or len(blob) > STORY_MAX_BYTES:
        return None
    return blob


def storyboard_from_url(media_url: str, *, duration: Optional[float] = None) -> Optional[bytes]:
    """Fetch the clip (size and time capped) and build the storyboard; None on any failure."""
    if not media_url or not media_url.lower().startswith("https://") or not media.has_ffmpeg():
        return None
    with tempfile.TemporaryDirectory(prefix="radar-story-") as tmp:
        work = Path(tmp)
        video = work / "clip.mp4"
        try:
            http.download(media_url, str(video), max_bytes=STORY_VIDEO_MAX_BYTES, timeout=STORY_VIDEO_TIMEOUT)
        except (http.HttpError, OSError, ValueError):
            return None
        try:
            return storyboard_from_file(video, work, duration=duration)
        except (subprocess.SubprocessError, OSError):
            return None


def attach_stills(
    sb: Supabase,
    rows: list[dict[str, Any]],
    log: Callable[[str], None],
    *,
    max_items: int = 40,
    storyboards: bool = True,
    story_fn: Callable[[str, Optional[float]], Optional[bytes]] = lambda url, d: storyboard_from_url(url, duration=d),
) -> dict[str, int]:
    """Give each row a picture in the bucket and set still_path on the row dict (before it is stored).

    A row that already carries a `_storyboard` (bytes from a capture's own
    download) uses it directly. Otherwise a storyboard is built from the
    row's media link while the time budget lasts, then the thumbnail.
    """
    started = time.monotonic()
    copied = boards = failed = skipped = 0
    for row in rows[:max_items]:
        if row.get("still_path") and not row.get("_storyboard"):
            continue
        if time.monotonic() - started > STORY_BUDGET_SEC:
            skipped += 1
            continue
        post_id = str(row.get("post_id") or str(row.get("key", "x")).split(":")[-1])
        platform = str(row.get("platform"))
        blob: Optional[bytes] = row.pop("_storyboard", None) if isinstance(row.get("_storyboard"), (bytes, bytearray)) else None
        if blob is None and storyboards and row.get("media_url") and not row.get("still_path"):
            try:
                blob = story_fn(str(row["media_url"]), _num(row.get("duration_sec")))
            except Exception:  # noqa: BLE001 - the thumbnail path below is the fallback
                blob = None
        try:
            if blob:
                path = sb.upload_still(platform, f"{post_id}.story", blob, "image/jpeg")
                boards += 1
            else:
                url = row.get("thumb_url")
                if not url or row.get("still_path"):
                    continue
                img, ctype = fetch_image(str(url))
                path = sb.upload_still(platform, post_id, img, ctype)
                copied += 1
            row["still_path"] = path
            row["still_at"] = _now()
            row["still_error"] = None
        except Exception as e:  # noqa: BLE001 - one bad picture must not stop the batch
            row["still_error"] = http.scrub(str(e))[:200]
            failed += 1
    log(f"stills: {boards} storyboards, {copied} thumbnails, {failed} failed, {skipped} skipped")
    return {"copied": copied, "storyboards": boards, "failed": failed, "skipped": skipped}


def _num(v: Any) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _now() -> str:
    from .supabase import now_iso

    return now_iso()
