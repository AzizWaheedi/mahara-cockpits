"""Every sales call in the Obsidian vault, copied into the cockpit.

The vault (/opt/data/obsidian-sync-vault on the VPS) is its own copy of
Fathom: one note per recording, written by /opt/data/scripts/vault-fathom.py
every two minutes, with Fathom's summary, the action items and the whole
transcript. A note whose `kind` is `sales` is a sales call (the vault decides
that from the title). Aziz, 2026-09-24: "it should also be pulling in all the
sales calls. If you check Obsidian now, all the sales calls are pulling in".

This step, for every sales note:
- upserts one cockpit_sales_recordings row per recording (source `vault`),
  with the summary, the action items, the invitees and the language;
- puts the transcript in the private bucket `sales-calls` as
  `<recording_id>.md`, only when it changed (sha256 of the text);
- matches the call to a lead exactly as the Fathom step does
  (recordings.match: an outside invitee's email, else the one lead with an
  intro or demo within 30 minutes), and keeps an earlier match or one made by
  hand (recordings._keep_earlier_matches).

A note with nobody from outside on the invite and no appointment beside it is
a team meeting that happens to use a sales word, and is left out, as the
Fathom step leaves it out. A row the Fathom step wrote keeps its share link;
the vault's link (fathom.video/calls/...) only fills an empty one.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

from . import http
from .recordings import OUR_DOMAIN, WINDOW, _keep_earlier_matches, external_emails, match
from .supabase import iso

TRANSCRIPT_BUCKET = "sales-calls"
MAX_SUMMARY = 20_000
MAX_ACTIONS = 8_000

_PERSON = re.compile(r"^\s*(?P<name>.*?)\s*\((?P<email>[^()\s]+@[^()\s]+)\)\s*$")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """The note's `---` block as a dict, and the body after it. Values the
    vault writes as JSON (lists) are decoded; the rest stay strings."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        return {}, text
    head, body = text[3:end], text[end + 4:]
    meta: dict[str, Any] = {}
    for line in head.splitlines():
        m = re.match(r"^([A-Za-z_][\w-]*):\s?(.*)$", line)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip()
        if v[:1] in "[{":
            try:
                meta[k] = json.loads(v)
                continue
            except ValueError:
                pass
        meta[k] = v.strip('"')
    return meta, body.lstrip("\n")


def sections(body: str) -> tuple[str, dict[str, str]]:
    """The note's title (its `# ` line) and each `## ` section's text, keyed by
    the heading in lower case without a trailing "(...)" count. `### `
    headings stay inside their section."""
    title = ""
    out: dict[str, str] = {}
    current: Optional[str] = None
    buf: list[str] = []
    for line in body.splitlines():
        if line.startswith("# ") and not title:
            title = line[2:].strip()
            continue
        if line.startswith("## "):
            if current is not None:
                out[current] = "\n".join(buf).strip()
            # "## Transcript (525 segments)" is the transcript section.
            current, buf = re.sub(r"\s*\([^)]*\)\s*$", "", line[3:].strip()).lower(), []
            continue
        if current is not None:
            buf.append(line)
    if current is not None:
        out[current] = "\n".join(buf).strip()
    return title, out


def people_of(values: Any) -> list[dict[str, str]]:
    """Invitees from "Name (email)", "email" or "Name" strings."""
    out: list[dict[str, str]] = []
    for v in values if isinstance(values, list) else []:
        s = str(v or "").strip()
        if not s:
            continue
        m = _PERSON.match(s)
        if m:
            out.append({"name": m.group("name"), "email": m.group("email").lower()})
        elif _EMAIL.match(s):
            out.append({"name": "", "email": s.lower()})
        else:
            out.append({"name": s, "email": ""})
    return out


def duration_seconds(text: Any) -> Optional[int]:
    """"16 min", "1 h 5 min", "45 s" as seconds."""
    s = str(text or "").lower()
    h = re.search(r"(\d+)\s*h", s)
    m = re.search(r"(\d+)\s*min", s)
    sec = re.search(r"(\d+)\s*s(?:ec)?\b", s)
    if not (h or m or sec):
        return None
    return (int(h.group(1)) * 3600 if h else 0) + (int(m.group(1)) * 60 if m else 0) + (
        int(sec.group(1)) if sec else 0)


def started_at(meta: dict[str, Any]) -> Optional[datetime]:
    """The vault writes Fathom's recording start in UTC: date plus HH:MM."""
    day, hm = str(meta.get("date") or ""), str(meta.get("time") or "")
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", day):
        return None
    if not re.match(r"^\d{2}:\d{2}$", hm):
        hm = "00:00"
    return datetime.fromisoformat(f"{day}T{hm}:00+00:00")


def read_note(path: Path, root: Path) -> Optional[dict[str, Any]]:
    """One sales note as the fields the cockpit keeps, or None when it is not
    a sales call with a recording id."""
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    meta, body = parse_frontmatter(text)
    if str(meta.get("kind") or "").lower() != "sales":
        return None
    rid = str(meta.get("recording_id") or "").strip()
    if not rid:
        return None
    title, secs = sections(body)
    transcript = secs.get("transcript", "")
    people = people_of(meta.get("people"))
    ours = [p for p in people if p["email"].endswith("@" + OUR_DOMAIN)]
    return {
        "recording_id": rid,
        "title": (title or path.stem)[:300],
        "started": started_at(meta),
        "duration_s": duration_seconds(meta.get("duration")),
        "url": str(meta.get("url") or "") or None,
        "language": str(meta.get("language") or "") or None,
        "people": people,
        "rep_email": ours[0]["email"] if ours else None,
        "summary": secs.get("summary", "")[:MAX_SUMMARY] or None,
        "action_items": secs.get("action items", "")[:MAX_ACTIONS] or None,
        "transcript": transcript,
        "note_path": str(path.relative_to(root)),
    }


def scan(vault: Path) -> list[dict[str, Any]]:
    """Every sales note under Calls/, one per recording. Where the vault wrote
    a call twice, the note with the longer transcript wins."""
    best: dict[str, dict[str, Any]] = {}
    root = vault
    for path in sorted((vault / "Calls").rglob("*.md")):
        if path.name.startswith("_"):
            continue
        note = read_note(path, root)
        if not note:
            continue
        have = best.get(note["recording_id"])
        if have is None or len(note["transcript"]) > len(have["transcript"]):
            best[note["recording_id"]] = note
    return list(best.values())


def meeting_of(note: dict[str, Any]) -> dict[str, Any]:
    """The note in the shape recordings.match reads (a Fathom meeting)."""
    return {
        "recording_id": note["recording_id"],
        "title": note["title"],
        "recording_start_time": iso(note["started"]) if note["started"] else None,
        "calendar_invitees": [
            {"email": p["email"], "is_external": not p["email"].endswith("@" + OUR_DOMAIN)}
            for p in note["people"] if p["email"]
        ],
    }


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _chunks(items: list[Any], n: int) -> Iterable[list[Any]]:
    for i in range(0, len(items), n):
        yield items[i : i + n]


def _all(sb: Any, table: str, params: str, page: int = 1000) -> list[dict[str, Any]]:
    """Every row of a read: the API answers at most 1,000 rows a request."""
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        rows = sb.select(table, f"{params}&limit={page}&offset={offset}")
        out.extend(rows)
        if len(rows) < page:
            return out
        offset += page


def run(sb: Any, vault: Path, log: Callable[[str], None], *, upload: Optional[Callable[[str, bytes], str]] = None,
        dry: bool = False) -> dict[str, Any]:
    """Copy the vault's sales calls in. `upload(path, blob)` stores a
    transcript in the sales-calls bucket; `dry` reads and matches only."""
    if not (vault / "Calls").is_dir():
        raise FileNotFoundError(f"No Calls folder in the vault at {vault}")
    notes = scan(vault)
    if not notes:
        log("calls-vault: the vault has no sales notes")
        return {"notes": 0}

    starts = [n["started"] for n in notes if n["started"]]
    appointments = _all(
        sb, "cockpit_sales_appointments",
        "select=appointment_id,contact_id,call_type,start_at,status,assigned_user_id"
        f"&start_at=gte.{http.quote(iso(min(starts) - WINDOW))}"
        f"&start_at=lte.{http.quote(iso(max(starts) + WINDOW))}"
        "&call_type=in.(intro,demo)&order=start_at.asc,appointment_id.asc",
    ) if starts else []
    leads = sb.leads_by_email({e for n in notes for e in external_emails(meeting_of(n))})
    reps: dict[str, str] = {}
    for r in _all(sb, "cockpit_sales_reps", "select=ghl_user_id,fathom_email,maqsam_email&order=id"):
        for k in ("fathom_email", "maqsam_email"):
            e = str(r.get(k) or "").strip().lower()
            if e and r.get("ghl_user_id"):
                reps.setdefault(e, str(r["ghl_user_id"]))
    have: dict[str, dict[str, Any]] = {}
    for chunk in _chunks([n["recording_id"] for n in notes], 100):
        ids = ",".join('"' + i.replace('"', "") + '"' for i in chunk)
        for r in sb.select("cockpit_sales_recordings",
                           "select=recording_id,share_url,source,transcript_sha,transcript_path"
                           f"&recording_id=in.({ids})"):
            have[str(r["recording_id"])] = r

    rows: list[dict[str, Any]] = []
    team = 0
    for n in notes:
        m = meeting_of(n)
        rep = reps.get(str(n["rep_email"] or ""))
        contact, appt, how = match(m, leads=leads, appointments=appointments,
                                   rep_user_ids=[rep] if rep else [])
        if how == "none" and not external_emails(m):
            team += 1
            continue
        was = have.get(n["recording_id"], {})
        row: dict[str, Any] = {
            "recording_id": n["recording_id"],
            "title": n["title"],
            "recorded_by": n["rep_email"],
            "started_at": iso(n["started"]) if n["started"] else None,
            "duration_s": n["duration_s"],
            "contact_id": contact,
            "appointment_id": appt,
            "matched_by": how,
            "source": was.get("source") or "vault",
            "kind": "sales",
            "language": n["language"],
            "people": n["people"],
            "summary": n["summary"],
            "action_items": n["action_items"],
            "note_path": n["note_path"],
            "transcript_chars": len(n["transcript"]) or None,
        }
        if not was.get("share_url"):
            row["share_url"] = n["url"]
        rows.append(row)

    kept = _keep_earlier_matches(sb, rows)
    uploaded = 0
    note_of = {n["recording_id"]: n for n in notes}
    for r in rows:
        text = note_of[r["recording_id"]]["transcript"]
        if not text:
            continue
        digest = sha(text)
        was = have.get(r["recording_id"], {})
        path = f"{r['recording_id']}.md"
        if was.get("transcript_sha") == digest and was.get("transcript_path"):
            continue
        r["transcript_sha"], r["transcript_path"] = digest, path
        if not dry and upload is not None:
            upload(path, text.encode("utf-8"))
            uploaded += 1

    stamp = datetime.now(timezone.utc).isoformat()
    stored = 0
    if not dry:
        # Rows differ in which columns they carry (a share link only where
        # none was stored), and PostgREST wants one shape per request.
        by_shape: dict[tuple[str, ...], list[dict[str, Any]]] = {}
        for r in rows:
            by_shape.setdefault(tuple(sorted(r)), []).append({**r, "indexed_at": stamp})
        for group in by_shape.values():
            for chunk in _chunks(group, 100):
                stored += sb.upsert("cockpit_sales_recordings", chunk, "recording_id")

    by: dict[str, int] = {}
    for r in rows:
        by[r["matched_by"]] = by.get(r["matched_by"], 0) + 1
    summary = {
        "notes": len(notes), "team": team, "rows": len(rows), "stored": stored,
        "transcripts_uploaded": uploaded, "kept_earlier_match": kept,
        "by_email": by.get("email", 0), "by_appointment": by.get("appointment", 0),
        "unmatched": by.get("none", 0), "dry": dry,
        "first": min((r["started_at"] for r in rows if r["started_at"]), default=None),
        "last": max((r["started_at"] for r in rows if r["started_at"]), default=None),
    }
    log(f"calls-vault: {summary}")
    return summary
