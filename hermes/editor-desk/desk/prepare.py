"""Prepare one job: find the footage, read it, and say what is there.

This is the whole point of the desk and the one thing ClickUp cannot do. For
each video in the job's folder it reads the file, transcribes the speech with
word timings, finds the shot boundaries, takes a three-frame storyboard, and
notes where each line of the script was actually said. It selects nothing and
cuts nothing: the editor opens their own app and decides.

Every step is bounded and resumable. A file already prepared is skipped, a
file too large is recorded with the reason, and the scratch directory is
emptied after each file so a four-core box with 69 GB free never fills.
"""
from __future__ import annotations

import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from . import drive as drive_mod
from . import http, media, speech
from .clickup import ClickUp
from .config import Config
from .drive import Drive
from .supabase import Supabase, now_iso

# Keep at least this much room free, so a download can never fill the box.
DISK_FLOOR_BYTES = 8 * 1024 * 1024 * 1024


def _asset_id(task_id: str, drive_id: str) -> str:
    return f"{task_id}:{drive_id}"


def readiness(job: dict[str, Any], assets: list[dict[str, Any]], cfg: Config) -> tuple[bool, list[str]]:
    """What is still missing before an editor can start. Plain sentences: this
    text is shown to a person and copied into ClickUp."""
    missing: list[str] = []
    if not job.get("footage_url"):
        missing.append("No footage folder on the card. Add the Client Footage Folder or Raw Video Link.")
    elif not assets:
        missing.append("The footage folder has no video in it yet, or it is not shared with us.")
    if not (job.get("brief") or "").strip() and not (job.get("script") or "").strip():
        missing.append("No brief and no script on the card.")
    if cfg.require_script and not (job.get("script") or "").strip():
        missing.append("No script linked to this job.")
    if not job.get("editor"):
        missing.append("No editor assigned.")
    silent = [a for a in assets if a.get("has_audio") is False]
    if assets and len(silent) == len(assets):
        missing.append("Every file is silent, so there is no transcript to search.")
    return (not missing), missing


def prepare_job(
    cfg: Config,
    log: Callable[[str], None],
    sb: Supabase,
    drive: Drive,
    job: dict[str, Any],
    *,
    clickup: Optional[ClickUp] = None,
    force: bool = False,
    transcribe_fn: Callable[..., dict[str, Any]] = speech.transcribe,
) -> dict[str, Any]:
    """Read every video in the job's folder. Returns a summary for the caller."""
    task_id = str(job.get("task_id") or "")
    stamp = now_iso()
    summary: dict[str, Any] = {
        "task_id": task_id, "files": 0, "read": 0, "skipped": 0, "failed": 0,
        "seconds": 0.0, "transcript_chars": 0, "warnings": [],
    }
    folder_link = str(job.get("footage_url") or job.get("raw_url") or "")
    folder_id = drive_mod.parse_id(folder_link)
    if not folder_id:
        summary["warnings"].append("no usable Drive link on the card" if folder_link else "no footage link on the card")
        return _finish(cfg, log, sb, job, [], summary, stamp, clickup)

    try:
        node = drive.get(folder_id)
    except http.HttpError as e:
        summary["warnings"].append(f"the footage link could not be opened: {http.scrub(str(e))[:160]}")
        return _finish(cfg, log, sb, job, [], summary, stamp, clickup)

    if node.get("mimeType") == drive_mod.FOLDER_MIME:
        files = drive.videos_under(folder_id, depth=2, limit=cfg.max_files_per_job * 3)
    elif drive_mod.is_video(node):
        files = [node]
    else:
        summary["warnings"].append("that link is not a folder and not a video")
        return _finish(cfg, log, sb, job, [], summary, stamp, clickup)

    files = files[: cfg.max_files_per_job]
    summary["files"] = len(files)
    log(f"{task_id}: {len(files)} video file(s) under the folder")

    known = {a.get("drive_id"): a for a in sb.assets(task_id) if a.get("drive_id")}
    script = str(job.get("script") or "")
    rows: list[dict[str, Any]] = []

    for f in files:
        fid = str(f.get("id"))
        prior = known.get(fid)
        if prior and not force and prior.get("transcript") is not None and not prior.get("error"):
            summary["skipped"] += 1
            rows.append(prior)
            continue
        row = _read_file(cfg, log, drive, f, task_id, script, summary, transcribe_fn, sb)
        rows.append(row)
        try:
            sb.store_assets([row])
        except Exception as e:  # noqa: BLE001 - one bad row must not lose the rest
            log(f"could not store {fid}: {http.scrub(str(e))[:140]}")

    return _finish(cfg, log, sb, job, rows, summary, stamp, clickup)


def _read_file(
    cfg: Config,
    log: Callable[[str], None],
    drive: Drive,
    f: dict[str, Any],
    task_id: str,
    script: str,
    summary: dict[str, Any],
    transcribe_fn: Callable[..., dict[str, Any]],
    sb: Supabase,
) -> dict[str, Any]:
    fid = str(f.get("id"))
    name = str(f.get("name") or fid)
    meta = f.get("videoMediaMetadata") or {}
    row: dict[str, Any] = {
        "id": _asset_id(task_id, fid),
        "task_id": task_id,
        "kind": "footage",
        "drive_id": fid,
        "name": name,
        "mime": f.get("mimeType"),
        "bytes": int(f.get("size") or 0) or None,
        "width": meta.get("width"),
        "height": meta.get("height"),
        "seconds": round(int(meta.get("durationMillis") or 0) / 1000, 2) or None,
        "preview_url": drive_mod.preview_url(fid),
        "at": now_iso(),
    }

    size = int(f.get("size") or 0)
    if size and size > cfg.max_file_bytes:
        row["error"] = f"{round(size / 1e9, 1)} GB is over the {round(cfg.max_file_bytes / 1e9, 1)} GB cap; read it in the editor instead"
        summary["skipped"] += 1
        return row
    if media.free_bytes(cfg.scratch) - size < DISK_FLOOR_BYTES:
        row["error"] = "not enough free disk on the worker to read this file; it will be retried"
        summary["skipped"] += 1
        return row

    work = Path(tempfile.mkdtemp(prefix="desk-", dir=str(cfg.scratch)))
    try:
        local = work / "source"
        try:
            drive.download(fid, str(local), max_bytes=cfg.max_file_bytes)
        except (http.HttpError, OSError) as e:
            row["error"] = f"could not download: {http.scrub(str(e))[:180]}"
            summary["failed"] += 1
            return row

        info = media.probe(local)
        row.update({
            "bytes": info.get("bytes") or row.get("bytes"),
            "seconds": info.get("seconds") or row.get("seconds"),
            "width": info.get("width") or row.get("width"),
            "height": info.get("height") or row.get("height"),
            "fps": info.get("fps"),
            "has_audio": info.get("has_audio"),
        })
        summary["seconds"] += float(row.get("seconds") or 0)

        # Speech, the reason any of this exists.
        result = {"text": "", "words": [], "segments": [], "method": "none", "warnings": [], "language": None}
        if info.get("has_audio") is not False:
            seconds = float(row.get("seconds") or 0)
            cap = cfg.max_transcribe_seconds
            audio = media.extract_audio(local, work / "audio.mp3", seconds=cap if seconds > cap else None)
            if seconds > cap:
                result["warnings"].append(f"only the first {int(cap / 60)} minutes were transcribed")
            if audio is None:
                result["warnings"].append("the audio could not be extracted (ffmpeg)")
            else:
                result = transcribe_fn(cfg, audio, log, has_audio=info.get("has_audio"))
        row.update({
            "transcript": result.get("text") or "",
            "words": result.get("words") or [],
            "language": result.get("language"),
            "method": {"transcribe": result.get("method"), "confidence": result.get("confidence")},
        })
        summary["transcript_chars"] += len(row["transcript"])
        for w in result.get("warnings") or []:
            summary["warnings"].append(f"{name}: {w}")

        row["scenes"] = media.scenes(local, threshold=cfg.scene_threshold)
        if script and row["words"]:
            row["script_hits"] = speech.find_lines(script, row["words"])

        board = media.storyboard(local, work / "story", seconds=row.get("seconds"), count=cfg.still_count)
        if board:
            try:
                row["still_path"] = sb.upload_still(task_id, f"{fid}.jpg", board, "image/jpeg")
            except Exception as e:  # noqa: BLE001 - a picture is a bonus
                log(f"still not stored for {fid}: {http.scrub(str(e))[:120]}")
        summary["read"] += 1
        log(f"  {name}: {row.get('seconds')}s, {len(row['transcript'])} characters, {len(row.get('scenes') or [])} shots")
        return row
    finally:
        media.cleanup([work])


def _finish(
    cfg: Config,
    log: Callable[[str], None],
    sb: Supabase,
    job: dict[str, Any],
    assets: list[dict[str, Any]],
    summary: dict[str, Any],
    stamp: str,
    clickup: Optional[ClickUp],
) -> dict[str, Any]:
    task_id = str(job.get("task_id") or "")
    ready, missing = readiness(job, assets, cfg)
    state = "ready" if ready else "blocked"
    if summary["failed"] and not summary["read"]:
        state = "stale"
    fields = {
        "state": state,
        "ready": ready,
        "missing": missing,
        "files": summary["files"],
        "seconds": round(summary["seconds"], 2),
        "transcript_chars": summary["transcript_chars"],
        "prepared_at": stamp,
        "attempts": int(job.get("attempts") or 0) + 1,
        "error": "; ".join(summary["warnings"])[:400] or None,
    }
    try:
        sb.mark_job(task_id, **fields)
    except Exception as e:  # noqa: BLE001
        log(f"could not mark {task_id}: {http.scrub(str(e))[:140]}")
    summary["state"] = state
    summary["ready"] = ready
    summary["missing"] = missing
    if clickup is not None and cfg.clickup_writeback and (summary["read"] or missing):
        try:
            clickup.comment(task_id, comment_text(job, assets, summary))
        except http.HttpError as e:
            log(f"ClickUp comment failed for {task_id}: {http.scrub(str(e))[:140]}")
    log(f"{task_id}: {state}, {summary['read']} read, {summary['skipped']} skipped, {summary['failed']} failed")
    return summary


def comment_text(job: dict[str, Any], assets: list[dict[str, Any]], summary: dict[str, Any]) -> str:
    """What the editor reads on the card. Plain, short, and useful on a phone."""
    lines: list[str] = []
    total_min = round(float(summary.get("seconds") or 0) / 60, 1)
    if summary.get("read") or summary.get("skipped"):
        lines.append(f"Footage read: {summary.get('files', 0)} file(s), {total_min} minutes in total.")
    for a in assets[:8]:
        if a.get("error"):
            lines.append(f"- {a.get('name')}: {a['error']}")
            continue
        bits = []
        if a.get("seconds"):
            bits.append(f"{round(float(a['seconds']) / 60, 1)} min")
        if a.get("width") and a.get("height"):
            bits.append(f"{a['width']}x{a['height']}")
        if a.get("has_audio") is False:
            bits.append("silent")
        elif a.get("transcript"):
            bits.append(f"{len(a['transcript'])} characters of speech")
        if a.get("scenes"):
            bits.append(f"{len(a['scenes'])} shots")
        lines.append(f"- {a.get('name')}: " + ", ".join(bits))
    hits = [h for a in assets for h in (a.get("script_hits") or [])]
    if hits:
        lines.append(f"Script lines found in the footage: {len(hits)}.")
    if summary.get("missing"):
        lines.append("")
        lines.append("Not ready to start yet:")
        for m in summary["missing"]:
            lines.append(f"- {m}")
    elif summary.get("ready"):
        lines.append("")
        lines.append("Ready to start: transcript and shots are on the job page.")
    for w in (summary.get("warnings") or [])[:4]:
        lines.append(f"Note: {w}")
    lines.append("")
    lines.append("Posted by the editor desk. It reads the footage; it does not cut anything.")
    return "\n".join(lines)
