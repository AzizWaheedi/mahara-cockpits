"""ffmpeg and ffprobe: read a file, take its audio, its scenes and a few stills.

Nothing here edits anything. It measures and it samples, so the cockpit can
describe the footage and check an export. Every call passes `-nostdin` and
closes stdin, after the radar lost the next URL in a list to an ffmpeg that
swallowed it (2026-09-17).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

RUN = {"capture_output": True, "text": True, "check": False, "stdin": subprocess.DEVNULL}


def has(binary: str) -> bool:
    return shutil.which(binary) is not None


def probe(path: Path) -> dict[str, Any]:
    """Duration, size, frame rate and whether there is audio."""
    out: dict[str, Any] = {
        "seconds": None, "width": None, "height": None, "fps": None,
        "has_audio": None, "bytes": None, "video_codec": None, "audio_codec": None,
    }
    try:
        out["bytes"] = os.path.getsize(path)
    except OSError:
        pass
    if not has("ffprobe"):
        return out
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        timeout=120, **RUN,
    )
    try:
        info = json.loads(res.stdout or "{}")
    except ValueError:
        return out
    fmt = info.get("format") or {}
    if fmt.get("duration"):
        try:
            out["seconds"] = round(float(fmt["duration"]), 2)
        except ValueError:
            pass
    streams = info.get("streams") or []
    out["has_audio"] = any(s.get("codec_type") == "audio" for s in streams)
    for s in streams:
        if s.get("codec_type") == "video" and out["width"] is None:
            out["width"], out["height"] = s.get("width"), s.get("height")
            out["video_codec"] = s.get("codec_name")
            rate = str(s.get("avg_frame_rate") or s.get("r_frame_rate") or "")
            if "/" in rate:
                num, _, den = rate.partition("/")
                try:
                    if float(den):
                        out["fps"] = round(float(num) / float(den), 3)
                except ValueError:
                    pass
        if s.get("codec_type") == "audio" and out["audio_codec"] is None:
            out["audio_codec"] = s.get("codec_name")
    return out


def extract_audio(path: Path, dest: Path, *, seconds: Optional[float] = None) -> Optional[Path]:
    """Mono 16 kHz mp3: small enough to upload, good enough for speech."""
    if not has("ffmpeg"):
        return None
    cmd = ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", str(path)]
    if seconds:
        cmd += ["-t", str(seconds)]
    cmd += ["-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", str(dest)]
    res = subprocess.run(cmd, timeout=1800, **RUN)
    if res.returncode != 0 or not dest.exists() or dest.stat().st_size < 200:
        return None
    return dest


_SCENE_RE = re.compile(r"pts_time:([0-9.]+)")


def scenes(path: Path, *, threshold: float = 0.35, limit: int = 400) -> list[float]:
    """Seconds where the picture changes enough to be a new shot."""
    if not has("ffmpeg"):
        return []
    res = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-i", str(path),
         "-filter:v", f"select='gt(scene,{threshold})',showinfo", "-f", "null", "-"],
        timeout=3600, **RUN,
    )
    found: list[float] = []
    for m in _SCENE_RE.finditer(res.stderr or ""):
        try:
            found.append(round(float(m.group(1)), 2))
        except ValueError:
            continue
        if len(found) >= limit:
            break
    return found


def loudness(path: Path) -> Optional[float]:
    """Integrated loudness in LUFS, measured and reported, never applied."""
    if not has("ffmpeg"):
        return None
    res = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-i", str(path), "-af", "loudnorm=print_format=json", "-f", "null", "-"],
        timeout=1800, **RUN,
    )
    text = res.stderr or ""
    start = text.rfind("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(text[start : end + 1])
        return round(float(data.get("input_i")), 2)
    except (ValueError, TypeError):
        return None


def frame_at(path: Path, ts: float, dest: Path, *, width: int = 480) -> bool:
    """One JPEG. `-strict unofficial` is the fix for reels whose colour range
    makes ffmpeg refuse to write a JPEG (recorded 2026-09-08)."""
    if not has("ffmpeg"):
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        dest.unlink()
    res = subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-ss", str(max(0.0, ts)), "-i", str(path),
         "-frames:v", "1", "-q:v", "5", "-vf", f"scale='min({width},iw)':-2", "-strict", "unofficial", str(dest)],
        timeout=120, **RUN,
    )
    return res.returncode == 0 and dest.exists() and dest.stat().st_size > 500


def storyboard(path: Path, workdir: Path, *, seconds: Optional[float], count: int = 3, width: int = 480) -> Optional[bytes]:
    """Start, middle and end side by side, as one small JPEG."""
    if not has("ffmpeg"):
        return None
    total = seconds or probe(path).get("seconds") or 0.0
    if total <= 0:
        times = [1.0, 3.0, 5.0][:count]
    elif total < 4:
        times = [round(total * f, 2) for f in (0.1, 0.5, 0.85)][:count]
    else:
        times = [1.0, round(total / 2, 2), round(max(total - 1.5, total * 0.85), 2)][:count]
    workdir.mkdir(parents=True, exist_ok=True)
    frames: list[Path] = []
    for i, ts in enumerate(times):
        target = workdir / f"f{i}.jpg"
        if frame_at(path, ts, target, width=width):
            frames.append(target)
    if not frames:
        return None
    out = workdir / "storyboard.jpg"
    if len(frames) == 1:
        cmd = ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", str(frames[0]), "-q:v", "5", str(out)]
    else:
        cmd = ["ffmpeg", "-nostdin", "-y", "-loglevel", "error"]
        for f in frames:
            cmd += ["-i", str(f)]
        cmd += ["-filter_complex", f"hstack=inputs={len(frames)}", "-q:v", "5", str(out)]
    res = subprocess.run(cmd, timeout=120, **RUN)
    if res.returncode != 0 or not out.exists():
        return None
    blob = out.read_bytes()
    return blob if 200 < len(blob) < 900_000 else None


def cleanup(paths: list[Path]) -> None:
    for p in paths:
        try:
            if p.is_dir():
                shutil.rmtree(p, ignore_errors=True)
            elif p.exists():
                os.unlink(p)
        except OSError:
            pass


def free_bytes(path: Path) -> int:
    try:
        st = os.statvfs(str(path))
        return st.f_bavail * st.f_frsize
    except (OSError, AttributeError):
        return 0
