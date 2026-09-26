"""Every answered phone call with a transcript, copied from Maqsam into the cockpit.

Aziz, 2026-09-26: "They should be allowed to pick all the recordings. Every
single one of them should pull in, and they can pick the ones they also want
reviewed by the AI." The Fathom calls came in through the vault; the phone
calls came in nowhere. B2B's own Maqsam sync keeps the setters only (the
closers' calls exist in Maqsam alone), and B2B's call ids do not open a call
in Maqsam's v3 API, so this step reads Maqsam itself, by the v3 id.

For every seat with a Maqsam address in cockpit_sales_reps or
cockpit_sales_people, setters and closers alike, it reads GET /v3/calls
(filtered by the seat's email and a time window; a hundred calls a page,
newest first) and, for each answered call that has a transcript:
- puts the transcript in the private bucket `sales-calls` as
  `maqsam/<id>.md`, one "[mm:ss] Rep: ..." or "[mm:ss] Lead: ..." line per
  turn, uploaded only when it changed;
- upserts cockpit_sales_recordings row `maqsam:<id>` (source maqsam, kind
  phone) with Maqsam's English summary, matched to the lead whose phone ends
  in the same eight digits. Two leads sharing them go to the newest, as
  cockpit_sales_link_dials links the dialer's calls, so a call and its dial
  land on the same lead. A match somebody made by hand is never overwritten
  (recordings._keep_earlier_matches).

The window starts at the last successful run less seven days, because Maqsam
writes a transcript some minutes after the call: a call read before its
transcript existed is read again next time. The mark is the setting
`maqsam_calls` in cockpit_sales_settings, written only after a run that read
every seat from no later than the mark, so a seat Maqsam refused is read again
from the same point. The first run starts on 2026-01-01.

Pages are handled one at a time, so a run holds at most a hundred calls (the
box went down under memory pressure on 2026-09-26 while another Maqsam count
ran). Nothing is written outside the cockpit.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Iterator, Optional

from . import http
from .fathom import parse_ts
from .recordings import _keep_earlier_matches
from .supabase import iso, now_iso

API = "https://api.mq.maqsam.com"
FIRST_DAY = datetime(2026, 1, 1, tzinfo=timezone.utc)
OVERLAP = timedelta(days=7)
SETTING = "maqsam_calls"
# Maqsam's states for a call somebody picked up: completed (outbound) and
# serviced (inbound). no_answer, busy, failed, blocked and abandoned are not.
ANSWERED = ("completed", "serviced")
PAGE = 100
MAX_PAGES = 200
PARTY = {"agent": "Rep", "customer": "Lead"}
MAX_SUMMARY = 20_000


class MaqsamError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(http.scrub(message))


class Maqsam:
    """Maqsam's v3 API: Basic auth with MAQSAM_ACCESS_KEY:MAQSAM_SECRET, one
    call at a time with a gap between them, a 429 or 5xx asked again."""

    def __init__(self, access_key: str, secret: str, *, base: str = API, pace: float = 0.7,
                 transport: Optional[Callable[..., tuple[int, dict, bytes]]] = None):
        if not access_key or not secret:
            raise MaqsamError(0, "MAQSAM_ACCESS_KEY and MAQSAM_SECRET are not set "
                                 "(/opt/data/bibi/api-keys.env), so no phone call can be read")
        token = base64.b64encode(f"{access_key}:{secret}".encode("utf-8")).decode("ascii")
        self._auth = f"Basic {token}"
        self.base = base.rstrip("/")
        self.pace = pace
        self._transport = transport or http.request
        self._last = 0.0

    def _wait_turn(self) -> None:
        gap = self.pace - (time.monotonic() - self._last)
        if gap > 0:
            time.sleep(gap)
        self._last = time.monotonic()

    def get(self, path: str, params: dict[str, Any]) -> Any:
        url = f"{self.base}{path}?{urllib.parse.urlencode(params)}"
        headers = {"Authorization": self._auth, "Accept": "application/json"}
        for attempt in range(4):
            self._wait_turn()
            try:
                _, _, body = self._transport("GET", url, headers=headers, timeout=60, retries=0)
                return json.loads(body.decode("utf-8")) if body else {}
            except http.HttpError as e:
                if (e.status in (429, 500, 502, 503, 504) or e.status == 0) and attempt < 3:
                    time.sleep(min(30, 3 * (attempt + 1)))
                    continue
                if e.status in (401, 403):
                    raise MaqsamError(e.status, f"Maqsam refused the key ({e.status}); set MAQSAM_ACCESS_KEY "
                                                "and MAQSAM_SECRET again")
                raise MaqsamError(e.status, f"Maqsam answered {e.status or 'nothing'} on {path}: {e}")
            except ValueError as e:
                raise MaqsamError(0, f"Maqsam sent something that is not JSON on {path}: {e}")
        raise MaqsamError(0, f"Maqsam did not answer on {path}")

    def calls(self, email: str, start: datetime, end: datetime, *, max_pages: int = MAX_PAGES) -> Iterator[list[dict[str, Any]]]:
        """One seat's calls between two times, a page at a time."""
        for page in range(1, max_pages + 1):
            d = self.get("/v3/calls", {"email": email, "start_time": int(start.timestamp()),
                                       "end_time": int(end.timestamp()), "page": page})
            rows = d.get("message") if isinstance(d, dict) else None
            if not isinstance(rows, list) or not rows:
                return
            yield [r for r in rows if isinstance(r, dict)]
            if len(rows) < PAGE:
                return
        raise MaqsamError(0, f"{email} has more than {max_pages * PAGE:,} calls in the window; "
                             "the rest were not read")


# ---- one call ----------------------------------------------------------------

def phone8(number: Any) -> Optional[str]:
    """The last eight digits, which is how a Maqsam call finds its lead."""
    digits = re.sub(r"\D", "", str(number or ""))
    return digits[-8:] if len(digits) >= 8 else None


def lead_number(call: dict[str, Any]) -> Any:
    """The other end of the line: the number called on an outbound call, the
    caller on an inbound one."""
    return call.get("calleeNumber") if str(call.get("type") or "") == "outbound" else call.get("callerNumber")


def agents_of(call: dict[str, Any]) -> list[dict[str, str]]:
    out = []
    for a in call.get("agents") or []:
        if isinstance(a, dict):
            out.append({"name": str(a.get("name") or ""), "email": str(a.get("email") or "").strip().lower()})
    return out


def clock(seconds: Any) -> str:
    try:
        s = max(0, int(float(seconds or 0)))
    except (TypeError, ValueError):
        s = 0
    return f"{s // 60:02d}:{s % 60:02d}"


def transcript_of(call: dict[str, Any]) -> str:
    """One "[mm:ss] Rep: ..." or "[mm:ss] Lead: ..." line per turn.

    v3 gives the turns as `segments` ({speaker: agent|customer, startTime,
    endTime, content}, seconds) and the same words again as one flat
    `transcription` text ("agent: ..." lines, no times). The segments are
    used; the flat text only when a call has no segments."""
    lines = []
    turns = call.get("segments")
    if not turns and isinstance(call.get("transcription"), list):
        turns = call.get("transcription")
    for seg in turns or []:
        if not isinstance(seg, dict):
            continue
        text = re.sub(r"\s+", " ", str(seg.get("content") or seg.get("text") or "")).strip()
        if not text:
            continue
        who = PARTY.get(str(seg.get("speaker") or seg.get("party") or "").lower(), "Unknown")
        lines.append(f"[{clock(seg.get('startTime'))}] {who}: {text}")
    if not lines and isinstance(call.get("transcription"), str):
        for line in call["transcription"].splitlines():
            m = re.match(r"^\s*(agent|customer)\s*:\s*(.*)$", line, re.I)
            if m and m.group(2).strip():
                lines.append(f"{PARTY[m.group(1).lower()]}: {m.group(2).strip()}")
    return "\n".join(lines)


def summary_of(call: dict[str, Any]) -> Optional[str]:
    """Maqsam's English summary; its Arabic one only when there is no English."""
    s = call.get("summary")
    if isinstance(s, dict):
        text = str(s.get("en") or "").strip() or str(s.get("ar") or "").strip()
    else:
        text = str(s or "").strip()
    return text[:MAX_SUMMARY] or None


def started(call: dict[str, Any]) -> Optional[datetime]:
    try:
        ts = int(call.get("timestamp") or 0)
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(ts, timezone.utc) if ts > 0 else None


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def row_for(call: dict[str, Any], text: str, *, recorded_by: str, contact: Optional[str]) -> dict[str, Any]:
    cid = str(call.get("id"))
    at = started(call)
    direction = str(call.get("type") or "").lower()
    try:
        duration = int(call.get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0
    return {
        "recording_id": f"maqsam:{cid}",
        "title": f"Phone call, {direction}" if direction in ("outbound", "inbound") else "Phone call",
        "recorded_by": recorded_by,
        "started_at": iso(at) if at else None,
        "duration_s": duration or None,
        "share_url": None,
        "contact_id": contact,
        "appointment_id": None,
        "matched_by": "phone" if contact else "none",
        "source": "maqsam",
        "kind": "phone",
        # Maqsam gives no language for a call.
        "language": None,
        "people": agents_of(call),
        "summary": summary_of(call),
        "action_items": None,
        "note_path": None,
        "transcript_path": f"maqsam/{cid}.md",
        "transcript_chars": len(text),
        "transcript_sha": sha(text),
    }


# ---- the cockpit side --------------------------------------------------------

def _quoted(values: Iterable[str]) -> str:
    return ",".join('"' + str(v).replace('"', "") + '"' for v in values)


def seats(sb: Any) -> list[str]:
    """Every Maqsam address on a rep or a seat, setters and closers alike."""
    out: set[str] = set()
    for table in ("cockpit_sales_reps", "cockpit_sales_people"):
        for r in sb.select(table, "select=maqsam_email&maqsam_email=not.is.null&limit=500"):
            e = str(r.get("maqsam_email") or "").strip().lower()
            if "@" in e:
                out.add(e)
    return sorted(out)


def leads_by_phone8(sb: Any, phones: set[str]) -> tuple[dict[str, str], int]:
    """phone8 -> contact_id, the newest lead where two share the digits (the
    rule of cockpit_sales_link_dials); and how many digits two leads shared."""
    best: dict[str, tuple[str, str]] = {}
    shared: set[str] = set()
    wanted = sorted(p for p in phones if p)
    for i in range(0, len(wanted), 100):
        chunk = wanted[i : i + 100]
        for r in sb.select("cockpit_sales_leads", "select=contact_id,phone8,lead_created_at"
                                                  f"&phone8=in.({_quoted(chunk)})&limit=1000"):
            p8, contact = str(r.get("phone8") or ""), str(r.get("contact_id") or "")
            if not p8 or not contact:
                continue
            # Newest first, a missing date last; the contact id settles a tie.
            key = (str(r.get("lead_created_at") or ""), contact)
            if p8 in best:
                shared.add(p8)
                if key <= best[p8]:
                    continue
            best[p8] = key
    return {p: c for p, (_at, c) in best.items()}, len(shared)


def stored_shas(sb: Any, ids: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(ids), 100):
        for r in sb.select("cockpit_sales_recordings", "select=recording_id,transcript_sha,transcript_path"
                                                       f"&recording_id=in.({_quoted(ids[i : i + 100])})"):
            out[str(r["recording_id"])] = r
    return out


# ---- the run -----------------------------------------------------------------

def window(sb: Any, now: datetime, days: Optional[int]) -> tuple[datetime, Optional[datetime]]:
    """Where this run starts, and the mark it starts from."""
    mark = sb.setting(SETTING)
    through = parse_ts(mark.get("through")) if isinstance(mark, dict) else None
    if days:
        return now - timedelta(days=days), through
    return ((through - OVERLAP) if through else FIRST_DAY), through


def run(sb: Any, mq: Maqsam, log: Callable[[str], None], *, days: Optional[int] = None, dry: bool = False,
        limit: Optional[int] = None, upload: Optional[Callable[[str, bytes], Any]] = None,
        now: Optional[datetime] = None) -> dict[str, Any]:
    """Read every seat's calls since the mark (or the last `days`) and copy
    each answered one with a transcript in. `dry` reads and matches only;
    `limit` stops after that many calls (a first try by hand)."""
    now = (now or datetime.now(timezone.utc)).replace(microsecond=0)
    start, through = window(sb, now, days)
    emails = seats(sb)
    per: dict[str, dict[str, Any]] = {}
    unread: list[str] = []
    done: set[str] = set()
    totals = {"rows": 0, "stored": 0, "uploaded": 0, "by_phone": 0, "unmatched": 0, "kept_earlier_match": 0,
              "shared_phone8": 0}
    first: Optional[str] = None
    last: Optional[str] = None
    stamp = now_iso()

    def full() -> bool:
        return limit is not None and totals["rows"] >= limit

    for email in emails:
        if full():
            break
        c = per[email] = {"seen": 0, "answered": 0, "with_transcript": 0, "rows": 0}
        try:
            for page in mq.calls(email, start, now):
                theirs = [x for x in page if email in {a["email"] for a in agents_of(x)}]
                c["seen"] += len(theirs)
                if page and not theirs:
                    raise MaqsamError(0, f"Maqsam answered {email}'s page with none of their calls, so its "
                                         "email filter was not applied; stopped reading them")
                keep: list[tuple[dict[str, Any], str]] = []
                for call in theirs:
                    cid = str(call.get("id") or "")
                    if not cid or cid in done or str(call.get("state") or "") not in ANSWERED:
                        continue
                    c["answered"] += 1
                    text = transcript_of(call)
                    if not text:
                        continue
                    c["with_transcript"] += 1
                    done.add(cid)
                    keep.append((call, text))
                if limit is not None:
                    keep = keep[: max(0, limit - totals["rows"])]
                if not keep:
                    if full():
                        break
                    continue
                leads, shared = leads_by_phone8(sb, {p for p in (phone8(lead_number(x)) for x, _t in keep) if p})
                totals["shared_phone8"] += shared
                ours = set(emails)
                rows, texts = [], {}
                for call, text in keep:
                    # The first of the call's own agents who holds a seat, so
                    # a call two seats handled is always credited the same way.
                    by = next((a["email"] for a in agents_of(call) if a["email"] in ours), email)
                    row = row_for(call, text, recorded_by=by, contact=leads.get(phone8(lead_number(call)) or ""))
                    rows.append(row)
                    texts[row["recording_id"]] = text
                totals["kept_earlier_match"] += _keep_earlier_matches(sb, rows)
                have = stored_shas(sb, [r["recording_id"] for r in rows])
                for r in rows:
                    was = have.get(r["recording_id"], {})
                    changed = not (was.get("transcript_sha") == r["transcript_sha"] and was.get("transcript_path"))
                    if changed and not dry and upload is not None:
                        upload(r["transcript_path"], texts[r["recording_id"]].encode("utf-8"))
                        totals["uploaded"] += 1
                    totals["by_phone" if r["matched_by"] != "none" else "unmatched"] += 1
                    at = r["started_at"]
                    if at:
                        first = min(first or at, at)
                        last = max(last or at, at)
                if not dry:
                    totals["stored"] += sb.upsert("cockpit_sales_recordings",
                                                  [{**r, "indexed_at": stamp} for r in rows], "recording_id")
                c["rows"] += len(rows)
                totals["rows"] += len(rows)
                if full():
                    break
        except MaqsamError as e:
            unread.append(email)
            c["error"] = str(e)[:200]
            log(f"maqsam-calls: {email}'s calls could not be read: {e}")
            if e.status in (401, 403):
                break
        except http.HttpError as e:
            unread.append(email)
            c["error"] = http.scrub(str(e))[:200]
            log(f"maqsam-calls: {email}'s calls could not be stored: {c['error']}")

    covered = not unread and limit is None and start <= (through or FIRST_DAY) and len(per) == len(emails)
    if covered and not dry:
        sb.store_setting(SETTING, {"through": iso(now), "from": iso(start), "calls": totals["rows"],
                                   "seats": len(emails), "at": stamp}, "sales-desk")
    summary = {
        "from": iso(start), "to": iso(now), "seats": len(emails), "seats_unread": unread, "per_seat": per,
        **totals, "first": first, "last": last, "dry": dry, "mark_written": covered and not dry,
    }
    log(f"maqsam-calls: {json.dumps({k: v for k, v in summary.items() if k != 'per_seat'}, default=str)}")
    return summary
