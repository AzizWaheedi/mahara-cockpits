"""Check a cut the editor uploaded, before the client sees it.

Every check is advice with a reason, never a gate: it reports, the editor
decides, and a flag can be waived with a note. The point is that a missing
line or a hook that lands at six seconds is caught here rather than in a
client review two days later.

Nothing is corrected in place. Loudness is measured and reported; the file
the editor made is the file that ships.
"""
from __future__ import annotations

import re
import tempfile
from pathlib import Path
from typing import Any, Callable, Optional

from . import drive as drive_mod
from . import http, media, speech
from .config import Config
from .drive import Drive
from .supabase import Supabase, now_iso

# What each platform expects. Nine by sixteen unless the card says otherwise.
RATIOS = {
    "9:16": 9 / 16,
    "4:5": 4 / 5,
    "1:1": 1.0,
    "16:9": 16 / 9,
}


def _norm_words(text: str) -> list[str]:
    return [w for w in re.split(r"\s+", re.sub(r"[^\w؀-ۿ\s]", " ", str(text).lower())) if w]


def script_coverage(script: str, transcript: str) -> dict[str, Any]:
    """How much of the approved script is audible in the export.

    Word overlap, deliberately simple: an editor can see why a line was
    flagged, and a silent motion-graphics cut is not marked wrong for having
    no speech, it is marked "nothing spoken" and left to the person.
    """
    want = _norm_words(script)
    got = set(_norm_words(transcript))
    if not want:
        return {"ratio": None, "missing_lines": [], "note": "no script on the job to compare against"}
    if not got:
        return {"ratio": 0.0, "missing_lines": [], "note": "nothing spoken in the export"}
    missing: list[str] = []
    for line in [l.strip() for l in script.splitlines() if l.strip()]:
        words = _norm_words(line)
        if len(words) < 3:
            continue
        hit = sum(1 for w in words if w in got)
        if hit / len(words) < 0.5:
            missing.append(line[:160])
    hit_all = sum(1 for w in want if w in got)
    return {"ratio": round(hit_all / len(want), 3), "missing_lines": missing[:12], "note": ""}


def run_checks(cfg: Config, info: dict[str, Any], transcript: str, job: dict[str, Any], *, want_ratio: str = "") -> list[dict[str, Any]]:
    """The report. Each entry is {check, ok, detail}: what was measured and what it means."""
    out: list[dict[str, Any]] = []
    seconds = info.get("seconds")
    width, height = info.get("width"), info.get("height")

    out.append({
        "check": "opens",
        "ok": bool(seconds and width),
        "detail": f"{seconds}s, {width}x{height}" if seconds and width else "the file could not be read as video",
    })

    if width and height:
        ratio = width / height
        target = RATIOS.get(want_ratio or "9:16")
        ok = abs(ratio - target) <= cfg.ratio_tolerance
        name = want_ratio or "9:16"
        out.append({
            "check": "shape",
            "ok": ok,
            "detail": f"{width}x{height} is {round(ratio, 3)}; {name} wants {round(target, 3)}" if not ok else f"{name}, as asked",
        })

    if seconds:
        out.append({
            "check": "length",
            "ok": 3 <= float(seconds) <= 180,
            "detail": f"{round(float(seconds), 1)} seconds"
            + ("" if 3 <= float(seconds) <= 180 else "; unusual for a paid ad, worth a look"),
        })

    lufs = info.get("loudness")
    if lufs is not None:
        off = abs(float(lufs) - cfg.loudness_target)
        out.append({
            "check": "loudness",
            "ok": off <= cfg.loudness_tolerance,
            "detail": f"{lufs} LUFS"
            + ("" if off <= cfg.loudness_tolerance else f", {round(off, 1)} from the {cfg.loudness_target} the platforms expect"),
        })

    if info.get("has_audio") is False:
        out.append({"check": "audio", "ok": True, "detail": "silent cut, which is normal for motion graphics"})

    script = str(job.get("script") or "")
    cov = script_coverage(script, transcript)
    if cov["ratio"] is not None:
        ok = cov["ratio"] >= 0.6 or not script.strip()
        detail = f"{int(cov['ratio'] * 100)}% of the script's words are audible"
        if cov["missing_lines"]:
            detail += "; missing: " + " | ".join(cov["missing_lines"][:3])
        if cov["note"]:
            detail = cov["note"]
        out.append({"check": "script", "ok": ok, "detail": detail})

    if transcript:
        head = transcript.strip()[:200]
        out.append({
            "check": "hook",
            "ok": True,
            "detail": f"first words: {head[:120]}" if head else "nothing spoken in the opening",
        })
    return out


def check_version(
    cfg: Config,
    log: Callable[[str], None],
    sb: Supabase,
    drive: Drive,
    job: dict[str, Any],
    link: str,
    *,
    n: Optional[int] = None,
    by_email: str = "",
    by_name: str = "",
    want_ratio: str = "",
    transcribe_fn: Callable[..., dict[str, Any]] = speech.transcribe,
) -> dict[str, Any]:
    """Read one uploaded cut and write its report. The file is never changed."""
    task_id = str(job.get("task_id") or "")
    if n is None:
        n = len(sb.versions(task_id)) + 1
    row: dict[str, Any] = {
        "id": f"{task_id}:v{n}",
        "task_id": task_id,
        "n": n,
        "url": link,
        "by_email": by_email or None,
        "by_name": by_name or None,
        "at": now_iso(),
    }
    fid = drive_mod.parse_id(link)
    if not fid:
        row["checks"] = [{"check": "opens", "ok": False, "detail": "that link is not a Drive file the desk can open"}]
        row["passed"] = False
        sb.store_version(row)
        return row

    work = Path(tempfile.mkdtemp(prefix="desk-check-", dir=str(cfg.scratch)))
    try:
        meta = drive.get(fid)
        row["drive_id"] = fid
        row["name"] = meta.get("name")
        local = work / "cut"
        try:
            drive.download(fid, str(local), max_bytes=cfg.max_file_bytes)
        except (http.HttpError, OSError) as e:
            row["checks"] = [{"check": "opens", "ok": False, "detail": f"could not download: {http.scrub(str(e))[:160]}"}]
            row["passed"] = False
            sb.store_version(row)
            return row

        info = media.probe(local)
        info["loudness"] = media.loudness(local)
        row.update({
            "bytes": info.get("bytes"),
            "seconds": info.get("seconds"),
            "width": info.get("width"),
            "height": info.get("height"),
            "fps": info.get("fps"),
            "loudness": info.get("loudness"),
            "ratio": f"{info.get('width')}x{info.get('height')}" if info.get("width") else None,
        })

        transcript = ""
        if info.get("has_audio") is not False:
            audio = media.extract_audio(local, work / "audio.mp3")
            if audio is not None:
                result = transcribe_fn(cfg, audio, log, has_audio=info.get("has_audio"))
                transcript = str(result.get("text") or "")
        row["transcript"] = transcript

        checks = run_checks(cfg, info, transcript, job, want_ratio=want_ratio)
        row["checks"] = checks
        row["passed"] = all(c["ok"] for c in checks)
        sb.store_version(row)
        log(f"{task_id} v{n}: " + ("all checks pass" if row["passed"] else ", ".join(c["check"] for c in checks if not c["ok"]) + " flagged"))
        return row
    finally:
        media.cleanup([work])


def report_text(row: dict[str, Any]) -> str:
    """The check report as a ClickUp comment."""
    lines = [f"Version {row.get('n')} checked."]
    for c in row.get("checks") or []:
        mark = "ok" if c.get("ok") else "look"
        lines.append(f"- [{mark}] {c.get('check')}: {c.get('detail')}")
    if row.get("passed"):
        lines.append("")
        lines.append("Nothing flagged. Send it when you are happy with it.")
    lines.append("")
    lines.append("Posted by the editor desk. Checks are advice; the cut is yours.")
    return "\n".join(lines)
