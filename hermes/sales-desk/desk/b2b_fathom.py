"""Ahmed's private Fathom calls, which only B2B holds, copied into the cockpit once.

The desk sees Fathom through Aziz's key: his own recordings and what the team
shares, which is also everything the vault holds. Ahmed records privately, so
59 of his calls from 1 June to 8 September 2026 (47 of them demo-titled, 56
with a transcript) reached B2B's `fathom_calls`, which syncs with access the
desk does not have, and never the vault or the cockpit (counted 2026-09-26).

This copies the calls B2B has and neither the cockpit nor the vault does, in
the vault import's row shape with source `b2b_fathom`: the transcript as
`<recording id>.md` in the private bucket `sales-calls` (written the way the
vault writes one), Fathom's summary and action items, the invitees, and B2B's
own lead match, which is by email or by appointment, the desk's own two rules.
A call the vault holds is the vault step's to judge (calls_vault.py), so it is
left alone here even when it is not in the cockpit. As everywhere else, a
client-service title (launch, check-in, onboarding...) stays out, and so does
a call nobody from outside joined that B2B matched to no lead. Once the calls
are in, a meeting recorded twice is hidden (recordings.mark_recordings).

B2B is Muhammed's and read only for us. It is read the way sales-mirror reads
it: the Supabase management API's query endpoint with `read_only: true`,
which connects as supabase_read_only_user, so nothing here can write to it,
and only a single SELECT is ever sent. The token is SALES_B2B_MGMT_TOKEN, read
by name and never printed.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

from . import http
from .calls_vault import MAX_ACTIONS, MAX_SUMMARY, vault_ids
from .fathom import NOT_SALES, parse_ts
from .recordings import MATCHES, OUTSIDER, _keep_earlier_matches, mark_recordings
from .supabase import iso, now_iso

B2B_REF = "flwboeijllbtrufxkhts"
API = "https://api.supabase.com/v1/projects/{ref}/database/query"
AHMED = "ahmedabushaiba@maharamedia.com"
# Full rows are read a few at a time: a transcript is tens of kilobytes.
FULL_CHUNK = 10


class B2BError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(http.scrub(message))


def lit(value: Any) -> str:
    """A SQL string literal."""
    return "'" + str(value).replace("'", "''") + "'"


class B2B:
    """Read-only SQL on B2B through the management API, as sales-mirror does."""

    def __init__(self, token: str, *, ref: str = B2B_REF,
                 transport: Optional[Callable[..., tuple[int, dict, bytes]]] = None):
        if not token:
            raise B2BError(0, "SALES_B2B_MGMT_TOKEN is not set, so B2B cannot be read. Run this once with the "
                              "Supabase management token in that variable (it is only read, never stored)")
        self._token = token
        self.url = API.format(ref=ref)
        self._transport = transport or http.request

    def query(self, sql: str) -> list[dict[str, Any]]:
        body = sql.strip().rstrip(";")
        if not re.match(r"(?is)^select\b", body) or ";" in body:
            raise ValueError("only a single SELECT is ever sent to B2B")
        headers = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json",
                   "Accept": "application/json", "User-Agent": http.USER_AGENT}
        payload = json.dumps({"query": body, "read_only": True}).encode("utf-8")
        for attempt in range(3):
            try:
                _, _, raw = self._transport("POST", self.url, headers=headers, data=payload, timeout=120,
                                            retries=0, ok_statuses=(200, 201))
                out = json.loads(raw.decode("utf-8")) if raw else []
                return out if isinstance(out, list) else []
            except http.HttpError as e:
                if (e.status in (429, 500, 502, 503, 504) or e.status == 0) and attempt < 2:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise B2BError(e.status, f"B2B answered {e.status or 'nothing'}: {e}")
        raise B2BError(0, "B2B kept answering busy")


# ---- one call ----------------------------------------------------------------

def transcript_text(turns: Any) -> str:
    """Fathom's turns as the vault writes them (vault-fathom.py), so a copied
    call reads like every other one: "**Name** (00:01:02): words"."""
    lines = []
    for t in turns if isinstance(turns, list) else []:
        if not isinstance(t, dict):
            continue
        who = t.get("speaker") if isinstance(t.get("speaker"), dict) else {}
        lines.append(f"**{who.get('display_name') or '?'}** ({t.get('timestamp', '')}): {str(t.get('text') or '').strip()}")
    return "\n".join(lines)


def summary_text(md: Any) -> Optional[str]:
    """Fathom's summary with its parts a level down, as the vault keeps it."""
    lines = [("#" + x if x.startswith("#") else x) for x in str(md or "").strip().splitlines()]
    return "\n".join(lines).strip()[:MAX_SUMMARY] or None


def actions_text(items: Any) -> Optional[str]:
    out = []
    for a in items if isinstance(items, list) else []:
        if isinstance(a, dict):
            text = str(a.get("description") or a.get("text") or "").strip()
            if text:
                out.append(f"- [{'x' if a.get('completed') else ' '}] {text}")
    return "\n".join(out)[:MAX_ACTIONS] or None


def people_of(invitees: Any) -> list[dict[str, str]]:
    return [{"name": str(i.get("name") or ""), "email": str(i.get("email") or "").strip().lower()}
            for i in (invitees if isinstance(invitees, list) else []) if isinstance(i, dict)]


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def row_for(r: dict[str, Any], text: str) -> dict[str, Any]:
    """One B2B call as the cockpit's row, in the vault import's shape."""
    rid = str(r["recording_id"])
    at = parse_ts(r.get("recording_start_time") or r.get("scheduled_start_time"))
    end = parse_ts(r.get("recording_end_time"))
    duration = r.get("duration_seconds") or (int((end - at).total_seconds()) if at and end and end >= at else None)
    contact = str(r.get("lead_contact_id") or "") or None
    appointment = (str(r.get("ghl_appointment_id") or "") or None) if contact else None
    how = str(r.get("match_method") or "")
    row: dict[str, Any] = {
        "recording_id": rid,
        "title": str(r.get("title") or r.get("meeting_title") or "Untitled")[:300],
        "recorded_by": str(r.get("recorded_by_email") or "").strip().lower() or None,
        "started_at": iso(at) if at else None,
        "duration_s": int(duration) if duration else None,
        "share_url": r.get("share_url") or None,
        "contact_id": contact,
        "appointment_id": appointment,
        # B2B's own rule when it is one of the desk's (email, appointment);
        # a lead B2B found some other way is kept and marked as B2B's.
        "matched_by": (how if how in MATCHES else "b2b") if contact else "none",
        "source": "b2b_fathom",
        "kind": "sales",
        "language": r.get("transcript_language") or None,
        "people": people_of(r.get("invitees")),
        "summary": summary_text(r.get("summary_md")),
        "action_items": actions_text(r.get("action_items")),
        "note_path": None,
        "transcript_chars": len(text) or None,
    }
    if text:
        row["transcript_path"], row["transcript_sha"] = f"{rid}.md", sha(text)
    return row


# ---- the run -----------------------------------------------------------------

def _in_cockpit(sb: Any, ids: list[str]) -> set[str]:
    out: set[str] = set()
    for i in range(0, len(ids), 100):
        quoted = ",".join('"' + x + '"' for x in ids[i : i + 100])
        out |= {str(r["recording_id"]) for r in sb.select("cockpit_sales_recordings",
                                                          f"select=recording_id&recording_id=in.({quoted})")}
    return out


def run(sb: Any, b2b: B2B, log: Callable[[str], None], *, emails: Iterable[str] = (AHMED,),
        vault: Optional[Path] = None, dry: bool = False, limit: Optional[int] = None,
        upload: Optional[Callable[[str, bytes], Any]] = None) -> dict[str, Any]:
    """Copy the named people's calls that only B2B holds. `dry` reads and
    decides only; `limit` stops after that many calls (a first try by hand)."""
    who = sorted({str(e).strip().lower() for e in emails if "@" in str(e)})
    if not who:
        raise ValueError("no address to copy calls for")
    listing = b2b.query(
        "select recording_id::text as recording_id, title, invitees_domains_type, lead_contact_id, "
        "coalesce(array_length(external_emails, 1), 0) as outside_emails "
        f"from public.fathom_calls where lower(recorded_by_email) in ({', '.join(lit(e) for e in who)}) "
        "order by recording_start_time, recording_id")
    ids = [str(r["recording_id"]) for r in listing if re.fullmatch(r"\d+", str(r.get("recording_id") or ""))]
    have = _in_cockpit(sb, ids)
    in_vault = vault_ids(vault) if vault is not None and (vault / "Calls").is_dir() else set()
    counts = {"in_b2b": len(listing), "in_cockpit": 0, "in_vault": 0, "client_service": 0, "team": 0}
    todo: list[str] = []
    for r in listing:
        rid = str(r.get("recording_id") or "")
        if rid in have:
            counts["in_cockpit"] += 1
        elif rid in in_vault:
            counts["in_vault"] += 1
        elif NOT_SALES.search(str(r.get("title") or "")):
            counts["client_service"] += 1
        elif (r.get("invitees_domains_type") != OUTSIDER and not int(r.get("outside_emails") or 0)
              and not r.get("lead_contact_id")):
            counts["team"] += 1
        elif re.fullmatch(r"\d+", rid):
            todo.append(rid)
    if limit is not None:
        todo = todo[: max(0, limit)]

    stamp = now_iso()
    rows_done = stored = uploaded = kept = 0
    by: dict[str, int] = {}
    with_transcript = 0
    first: Optional[str] = None
    last: Optional[str] = None
    for i in range(0, len(todo), FULL_CHUNK):
        chunk = todo[i : i + FULL_CHUNK]
        full = b2b.query(
            "select recording_id::text as recording_id, title, meeting_title, recorded_by_email, "
            "scheduled_start_time, recording_start_time, recording_end_time, duration_seconds, "
            "transcript_language, transcript, summary_md, action_items, invitees, share_url, "
            "lead_contact_id, ghl_appointment_id, match_method "
            f"from public.fathom_calls where recording_id in ({', '.join(chunk)})")
        rows = []
        texts: dict[str, str] = {}
        for r in full:
            text = transcript_text(r.get("transcript"))
            row = row_for(r, text)
            rows.append(row)
            texts[row["recording_id"]] = text
        kept += _keep_earlier_matches(sb, rows)
        for row in rows:
            text = texts[row["recording_id"]]
            if text:
                with_transcript += 1
                if not dry and upload is not None:
                    upload(row["transcript_path"], text.encode("utf-8"))
                    uploaded += 1
            by[row["matched_by"]] = by.get(row["matched_by"], 0) + 1
            if row["started_at"]:
                first = min(first or row["started_at"], row["started_at"])
                last = max(last or row["started_at"], row["started_at"])
        if not dry and rows:
            stored += sb.upsert("cockpit_sales_recordings", [{**r, "indexed_at": stamp} for r in rows],
                                "recording_id")
        rows_done += len(rows)
    marked = None if dry else mark_recordings(sb, log, "calls-b2b-fathom")

    summary = {
        "people": who, **counts, "to_copy": len(todo), "rows": rows_done, "stored": stored,
        "with_transcript": with_transcript, "transcripts_uploaded": uploaded, "kept_earlier_match": kept,
        "by_email": by.get("email", 0), "by_appointment": by.get("appointment", 0), "by_b2b": by.get("b2b", 0),
        "unmatched": by.get("none", 0), "vault_checked": vault is not None and bool(in_vault),
        "first": first, "last": last, "dry": dry, "marked": marked,
    }
    log(f"calls-b2b-fathom: {json.dumps(summary, default=str)}")
    return summary
