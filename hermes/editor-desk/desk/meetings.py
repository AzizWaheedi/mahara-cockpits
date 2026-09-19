"""Team meetings, from Fathom.

Aziz, 2026-09-19: team meetings, not client calls. Fathom records both, and
the difference is on the invite: a client call has someone from outside the
company on it, a team meeting does not. That is the whole rule, and it reads
off `calendar_invitees[].is_external` rather than guessing from the title,
which is written by whoever made the calendar entry.

Who may read one is decided in Postgres, not here: a row policy asks whether
your address is on the invite. An internal call can carry pay, performance or
a disagreement about somebody, so being on the editor list is not a reason to
read a meeting you were not in.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from . import http
from .config import Config

API = "https://api.fathom.ai/external/v1/meetings"


def _people(meeting: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for i in meeting.get("calendar_invitees") or []:
        if not isinstance(i, dict):
            continue
        out.append({
            "name": str(i.get("name") or ""),
            "email": str(i.get("email") or "").strip().lower(),
            "external": bool(i.get("is_external")),
        })
    return out


def is_team_meeting(meeting: dict[str, Any]) -> bool:
    """Nobody from outside the company on the invite, and somebody on it."""
    people = _people(meeting)
    if not people:
        return False
    return not any(p["external"] for p in people)


def row(meeting: dict[str, Any]) -> Optional[dict[str, Any]]:
    """One Fathom meeting as a `team_meetings` row, or nothing if unusable."""
    rid = str(meeting.get("recording_id") or "")
    if not rid:
        return None
    people = _people(meeting)
    summary = meeting.get("default_summary")
    md = ""
    if isinstance(summary, dict):
        md = str(summary.get("markdown_formatted") or "")
    elif isinstance(summary, str):
        md = summary
    actions = []
    for a in meeting.get("action_items") or []:
        if isinstance(a, dict):
            actions.append({
                "text": str(a.get("description") or a.get("text") or "")[:600],
                "for": str(((a.get("assignee") or {}) if isinstance(a.get("assignee"), dict) else {}).get("name") or ""),
            })
        elif isinstance(a, str):
            actions.append({"text": a[:600], "for": ""})
    return {
        "recording_id": rid,
        "title": str(meeting.get("meeting_title") or meeting.get("title") or "")[:300],
        "started_at": meeting.get("recording_start_time") or meeting.get("scheduled_start_time"),
        "ended_at": meeting.get("recording_end_time") or meeting.get("scheduled_end_time"),
        "url": meeting.get("url"),
        "share_url": meeting.get("share_url"),
        "host": str(((meeting.get("recorded_by") or {}) if isinstance(meeting.get("recorded_by"), dict) else {}).get("name") or ""),
        "invitees": people,
        "invitee_emails": sorted({p["email"] for p in people if p["email"]}),
        "summary_md": md[:20000] or None,
        "action_items": actions[:50],
        "language": meeting.get("transcript_language"),
    }


def fetch(cfg: Config, log: Callable[[str], None], *, days: int = 45, limit: int = 100) -> list[dict[str, Any]]:
    """Recent meetings from Fathom. The transcript is left behind: it is
    large, it is not what anyone opens this page for, and the summary and the
    recording link already carry the meeting."""
    key = cfg.fathom_key
    if not key:
        raise http.HttpError(0, "FATHOM_API_KEY is not set")
    since = (datetime.now(timezone.utc) - timedelta(days=days)).replace(microsecond=0)
    q = http.encode_query({
        "created_after": since.isoformat().replace("+00:00", "Z"),
        "include_summary": "true",
        "include_transcript": "false",
        "limit": limit,
    })
    data = http.get_json(f"{API}?{q}", headers={"X-Api-Key": key}, timeout=90)
    items = (data or {}).get("items") or (data or {}).get("data") or []
    out = [m for m in items if isinstance(m, dict)]
    log(f"fathom: {len(out)} meetings in the last {days} days")
    return out


def sync(cfg: Config, log: Callable[[str], None], sb: Any, *, days: int = 45) -> dict[str, Any]:
    meetings = fetch(cfg, log, days=days)
    team = [m for m in meetings if is_team_meeting(m)]
    rows = [r for r in (row(m) for m in team) if r]
    stored = sb.store_meetings(rows) if rows else 0
    log(f"team meetings: {len(rows)} of {len(meetings)} were internal")
    return {"seen": len(meetings), "team": len(rows), "stored": stored}
