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

Two more kinds of note are sales calls too (Aziz, 2026-09-26: "Every single
one of them should pull in"):
- a sales note with nobody from outside on the invite and no appointment
  beside it, when someone from outside joined all the same (the lead came in
  from the link). The note shows it when the vault itself could only have
  called it `sales` because Fathom flagged an outsider (an "Impromptu"
  meeting with no sales word, below); a call already in the cockpit shows it;
  and for the rest Fathom is asked once which of them it flagged
  (`fathom_outsiders`, the calls of the last `fathom_days`). 111 calls had
  been dropped as team meetings before this;
- a note the vault files as `external` whose outside invitee is a lead, and
  whose title is not a client-service one (launch, check-in, review...):
  the vault calls `external` anyone outside it cannot place, and a lead on
  the invite places them. 163 such notes, 139 of them not in the cockpit.

A sales note with nobody from outside at all, on the invite or on the call,
and no appointment beside it is a team meeting that happens to use a sales
word, and is left out, as the Fathom step leaves it out. A row the Fathom step
wrote keeps its share link; the vault's link (fathom.video/calls/...) only
fills an empty one.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

from . import http
from .fathom import NOT_SALES
from .recordings import OUR_DOMAIN, WINDOW, _keep_earlier_matches, external_emails, match
from .supabase import CALLS_BUCKET, iso

TRANSCRIPT_BUCKET = CALLS_BUCKET
MAX_SUMMARY = 20_000
MAX_ACTIONS = 8_000

# The vault writer's own sales words (/opt/data/scripts/vault-fathom.py,
# kind()). It files a note as `sales` when its title has one of them, or when
# the title says "impromptu" and Fathom flagged someone from outside on the
# call (calendar_invitees_domains_type, which the note does not keep). So an
# impromptu sales note with none of these words is one Fathom saw an outsider
# on, whoever the invite named. Keep this list in step with that script.
VAULT_SALES_WORDS = ("حصول المشاريع", "مكالمة", "demo", "intro call", "discovery", "strategy call",
                     "pipeline audit", "consultation")

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


def summary_of(body: str) -> str:
    """Fathom's summary: everything from `## Summary` to the action items or
    the transcript. Fathom writes its parts (Meeting Purpose, Key Takeaways,
    Topics, Next Steps) as `##` headings of their own under an empty
    `## Summary`, so the parts are kept, one level down."""
    out: list[str] = []
    inside = False
    for line in body.splitlines():
        if line.startswith("## "):
            head = re.sub(r"\s*\([^)]*\)\s*$", "", line[3:].strip()).lower()
            if head == "summary":
                inside = True
                continue
            if head in ("action items", "transcript"):
                if inside:
                    break
                continue
        if inside:
            out.append("#" + line if line.startswith("#") else line)
    return "\n".join(out).strip()


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


def read_note(path: Path, root: Path, *, any_kind: bool = False) -> Optional[dict[str, Any]]:
    """One note as the fields the cockpit keeps, or None when it is not a
    sales call (any call, with `any_kind`) with a recording id."""
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    meta, body = parse_frontmatter(text)
    kind = str(meta.get("kind") or "").lower()
    if kind != "sales" and not any_kind:
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
        "kind": kind or None,
        "title": (title or path.stem)[:300],
        "started": started_at(meta),
        "duration_s": duration_seconds(meta.get("duration")),
        "url": str(meta.get("url") or "") or None,
        "language": str(meta.get("language") or "") or None,
        "people": people,
        "rep_email": ours[0]["email"] if ours else None,
        "summary": summary_of(body)[:MAX_SUMMARY] or None,
        "action_items": secs.get("action items", "")[:MAX_ACTIONS] or None,
        "transcript": transcript,
        "note_path": str(path.relative_to(root)),
    }


def outsider_in_note(note: dict[str, Any]) -> bool:
    """The note itself shows that someone from outside joined: the vault
    filed an "impromptu" meeting with no sales word as `sales`, which its rule
    does only when Fathom flagged an outsider on the call."""
    title = str(note.get("title") or "").lower()
    return (note.get("kind") == "sales" and "impromptu" in title
            and not any(w in title for w in VAULT_SALES_WORDS))


def vault_ids(vault: Path) -> set[str]:
    """Every recording id the vault holds, whatever its kind (the calls the
    vault step judges; b2b_fathom.py leaves them to it)."""
    out: set[str] = set()
    for path in (vault / "Calls").rglob("*.md"):
        if path.name.startswith("_"):
            continue
        try:
            meta, _body = parse_frontmatter(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError):
            continue
        rid = str(meta.get("recording_id") or "").strip()
        if rid:
            out.add(rid)
    return out


def scan(vault: Path, *, any_kind: bool = False) -> list[dict[str, Any]]:
    """Every sales note under Calls/ (every call note, with `any_kind`), one
    per recording. Where the vault wrote a call twice, the note with the
    longer transcript wins."""
    best: dict[str, dict[str, Any]] = {}
    root = vault
    for path in sorted((vault / "Calls").rglob("*.md")):
        if path.name.startswith("_"):
            continue
        note = read_note(path, root, any_kind=any_kind)
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


def row_of(n: dict[str, Any], was: dict[str, Any], contact: Optional[str], appt: Optional[str],
           how: str) -> dict[str, Any]:
    """One note as its cockpit row. A share link the Fathom step stored is kept."""
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
    return row


def run(sb: Any, vault: Path, log: Callable[[str], None], *, upload: Optional[Callable[[str, bytes], str]] = None,
        dry: bool = False, fathom_outsiders: Optional[Callable[[datetime], set[str]]] = None,
        fathom_days: int = 14, now: Optional[datetime] = None) -> dict[str, Any]:
    """Copy the vault's sales calls in. `upload(path, blob)` stores a
    transcript in the sales-calls bucket; `dry` reads and matches only.

    `fathom_outsiders(since)` gives the recording ids since then that Fathom
    says someone from outside was on. It is asked at most once a run, and only
    when a sales note of the last `fathom_days` has no outside invitee, no
    appointment beside it and nothing else to show an outsider joined: a
    handful of pages in the half-hourly run, and the whole history once with
    a long `fathom_days`."""
    if not (vault / "Calls").is_dir():
        raise FileNotFoundError(f"No Calls folder in the vault at {vault}")
    every = scan(vault, any_kind=True)
    if not every:
        log("calls-vault: the vault has no call notes")
        return {"notes": 0}
    now = now or datetime.now(timezone.utc)
    sales_notes = [n for n in every if n["kind"] == "sales"]
    external = [n for n in every if n["kind"] == "external" and not NOT_SALES.search(n["title"] or "")]
    leads = sb.leads_by_email({e for n in sales_notes + external for e in external_emails(meeting_of(n))})
    # An `external` note is one the vault could not place; a lead on its
    # invite places it. Client-service titles stay out, as everywhere.
    lead_calls = [n for n in external if any(e in leads for e in external_emails(meeting_of(n)))]
    notes = sales_notes + lead_calls
    chosen = {n["recording_id"] for n in notes}
    # A call the desk's own Fathom step indexed as sales that the vault files
    # under another kind (team, training, an external one with no lead)
    # still gets its summary and transcript from the vault; it never becomes
    # a new row that way.
    others = {n["recording_id"]: n for n in every if n["recording_id"] not in chosen}

    starts = [n["started"] for n in notes if n["started"]]
    appointments = _all(
        sb, "cockpit_sales_appointments",
        "select=appointment_id,contact_id,call_type,start_at,status,assigned_user_id"
        f"&start_at=gte.{http.quote(iso(min(starts) - WINDOW))}"
        f"&start_at=lte.{http.quote(iso(max(starts) + WINDOW))}"
        "&call_type=in.(intro,demo)&order=start_at.asc,appointment_id.asc",
    ) if starts else []
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
    in_cockpit = set(have)

    enriched = 0
    fill: list[dict[str, Any]] = []
    fathom_rows = _all(sb, "cockpit_sales_recordings",
                       "select=recording_id,transcript_sha,transcript_path&summary=is.null&order=recording_id")
    for r in fathom_rows:
        n = others.get(str(r["recording_id"]))
        if not n:
            continue
        have.setdefault(n["recording_id"], r)
        fill.append({"recording_id": n["recording_id"], "language": n["language"], "people": n["people"],
                     "summary": n["summary"], "action_items": n["action_items"], "note_path": n["note_path"],
                     "transcript_chars": len(n["transcript"]) or None})
    note_of = {n["recording_id"]: n for n in notes}
    note_of.update({r["recording_id"]: others[r["recording_id"]] for r in fill})

    rows: list[dict[str, Any]] = []
    joined = {"note": 0, "cockpit": 0, "fathom": 0}
    undecided: list[dict[str, Any]] = []
    for n in notes:
        m = meeting_of(n)
        rep = reps.get(str(n["rep_email"] or ""))
        contact, appt, how = match(m, leads=leads, appointments=appointments,
                                   rep_user_ids=[rep] if rep else [])
        if how == "none" and not external_emails(m):
            # Nobody from outside on the invite and no appointment: a sales
            # call only if someone from outside joined all the same.
            if outsider_in_note(n):
                joined["note"] += 1
            elif n["recording_id"] in in_cockpit:
                joined["cockpit"] += 1
            else:
                undecided.append(n)
                continue
        rows.append(row_of(n, have.get(n["recording_id"], {}), contact, appt, how))

    horizon = now - timedelta(days=max(0, fathom_days))
    ask = [n for n in undecided if n["started"] and n["started"] >= horizon]
    flagged: set[str] = set()
    fathom_said = "not needed"
    if ask and fathom_outsiders is not None and fathom_days > 0:
        try:
            flagged = {str(x) for x in fathom_outsiders(min(n["started"] for n in ask) - timedelta(days=1))}
            fathom_said = (f"asked about {len(ask)}, "
                           f"{sum(1 for n in ask if n['recording_id'] in flagged)} had someone from outside")
        except Exception as e:  # noqa: BLE001 - the rest of the vault still comes in
            fathom_said = f"could not be asked: {http.scrub(str(e))[:160]}"
            log(f"calls-vault: Fathom {fathom_said}")
    elif ask:
        fathom_said = f"not asked about {len(ask)}"
    team = 0
    for n in undecided:
        if n["recording_id"] in flagged:
            joined["fathom"] += 1
            rows.append(row_of(n, have.get(n["recording_id"], {}), None, None, "none"))
        else:
            team += 1

    kept = _keep_earlier_matches(sb, rows)
    uploaded = new_transcripts = 0
    for r in rows + fill:
        text = note_of[r["recording_id"]]["transcript"]
        if not text:
            continue
        digest = sha(text)
        was = have.get(r["recording_id"], {})
        path = f"{r['recording_id']}.md"
        if was.get("transcript_sha") == digest and was.get("transcript_path"):
            continue
        r["transcript_sha"], r["transcript_path"] = digest, path
        new_transcripts += 1
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
        for r in fill:
            rid = r.pop("recording_id")
            sb.patch("cockpit_sales_recordings", f"recording_id=eq.{http.quote(rid)}", r)
            enriched += 1

    by: dict[str, int] = {}
    for r in rows:
        by[r["matched_by"]] = by.get(r["matched_by"], 0) + 1
    lead_ids = {n["recording_id"] for n in lead_calls}
    summary = {
        "notes": len(sales_notes), "lead_calls": len(lead_calls), "other_notes": len(others), "team": team,
        "outsider_joined": sum(joined.values()), "outsider_by": joined, "fathom": fathom_said,
        "rows": len(rows), "new_rows": sum(1 for r in rows if r["recording_id"] not in in_cockpit),
        "new_lead_calls": sum(1 for r in rows if r["recording_id"] in lead_ids and r["recording_id"] not in in_cockpit),
        "stored": stored, "transcripts_uploaded": uploaded, "transcripts_new": new_transcripts,
        "kept_earlier_match": kept, "filled_fathom_rows": enriched if not dry else len(fill),
        "by_email": by.get("email", 0), "by_appointment": by.get("appointment", 0),
        "unmatched": by.get("none", 0), "dry": dry,
        "first": min((r["started_at"] for r in rows if r["started_at"]), default=None),
        "last": max((r["started_at"] for r in rows if r["started_at"]), default=None),
    }
    log(f"calls-vault: {summary}")
    return summary
