"""Fetch a video, read its length, sample frames, extract audio. Needs ffmpeg for
frames and audio; without it the capture still runs on the whole video file.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from . import http


def has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def has_ffprobe() -> bool:
    return shutil.which("ffprobe") is not None


def download_video(url: str, dest: Path, *, max_bytes: int, timeout: float = 240) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    return http.download(url, str(dest), max_bytes=max_bytes, timeout=timeout)


def probe(path: Path) -> dict:
    """Duration in seconds, width, height and whether there is an audio stream."""
    out = {"duration_sec": None, "width": None, "height": None, "has_audio": None}
    if not has_ffprobe():
        return out
    try:
        res = subprocess.run(
            [
                "ffprobe", "-v", "error", "-print_format", "json",
                "-show_format", "-show_streams", str(path),
            ],
            capture_output=True, text=True, timeout=60, check=False,
        )
        info = json.loads(res.stdout or "{}")
        fmt = info.get("format", {})
        if fmt.get("duration"):
            out["duration_sec"] = round(float(fmt["duration"]), 2)
        streams = info.get("streams", [])
        out["has_audio"] = any(s.get("codec_type") == "audio" for s in streams)
        for s in streams:
            if s.get("codec_type") == "video":
                out["width"], out["height"] = s.get("width"), s.get("height")
                break
    except (subprocess.SubprocessError, ValueError, OSError):
        pass
    return out


def extract_frames(path: Path, out_dir: Path, *, every_sec: float = 2.5, max_frames: int = 24, duration: Optional[float] = None) -> list[tuple[float, Path]]:
    """One JPEG every `every_sec` seconds, capped, scaled to 720px wide.

    `-strict unofficial` is the fix recorded on 2026-09-08 for reels whose
    YUV range makes ffmpeg refuse to write JPEGs.
    """
    if not has_ffmpeg():
        return []
    out_dir.mkdir(parents=True, exist_ok=True)
    total = duration or probe(path).get("duration_sec") or 60.0
    times: list[float] = []
    t = 0.5
    while t < total and len(times) < max_frames:
        times.append(round(t, 2))
        t += every_sec
    if len(times) >= max_frames and total > times[-1] + every_sec:
        # Spread evenly instead of stopping early on a long video.
        step = total / max_frames
        times = [round(step * i + 0.5, 2) for i in range(max_frames)]
    frames: list[tuple[float, Path]] = []
    for ts in times:
        target = out_dir / f"frame_{int(ts * 1000):07d}.jpg"
        if target.exists():
            target.unlink()
        res = subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error", "-ss", str(ts), "-i", str(path),
                "-frames:v", "1", "-q:v", "4", "-vf", "scale='min(720,iw)':-2",
                "-strict", "unofficial", str(target),
            ],
            capture_output=True, text=True, timeout=60, check=False,
        )
        if res.returncode == 0 and target.exists() and target.stat().st_size > 500:
            frames.append((ts, target))
    return frames


def extract_audio(path: Path, dest: Path) -> Optional[Path]:
    """Mono 16 kHz mp3, small enough to upload quickly. None without ffmpeg."""
    if not has_ffmpeg():
        return None
    res = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", str(dest)],
        capture_output=True, text=True, timeout=180, check=False,
    )
    if res.returncode != 0 or not dest.exists() or dest.stat().st_size < 200:
        return None
    return dest


def cleanup(paths: list[Path]) -> None:
    for p in paths:
        try:
            if p.is_dir():
                shutil.rmtree(p, ignore_errors=True)
            elif p.exists():
                os.unlink(p)
        except OSError:
            pass
