"""Every phone call a seat made or took, copied from Maqsam into the cockpit.

Aziz, 2026-09-26: "They should be allowed to pick all the recordings. Every
single one of them should pull in, and they can pick the ones they also want
reviewed by the AI." The Fathom calls came in through the vault; the phone
calls came in nowhere. B2B's own Maqsam sync keeps the setters only (the
closers' calls exist in Maqsam alone), and B2B's call ids do not open a call
in Maqsam's v3 API, so this step reads Maqsam itself, by the v3 id.

For every seat with a Maqsam address in cockpit_sales_reps or
cockpit_sales_people, setters and closers alike, it reads GET /v3/calls
(filtered by the seat's email and a time window; a hundred calls a page,
newest first) and:
- adds every call it reads that cockpit_sales_dials does not hold to that
  dial log, whatever became of the call (below);
- for each answered call that has a transcript, puts the transcript in the
  private bucket `sales-calls` as `maqsam/<id>.md`, one "[mm:ss] Rep: ..." or
  "[mm:ss] Lead: ..." line per turn, uploaded only when it changed;
- upserts cockpit_sales_recordings row `maqsam:<id>` (source maqsam, kind
  phone) with Maqsam's English summary, matched to the lead whose number it
  is by the rule cockpit_sales_link_dials links the dialer's calls with
  (pick_lead), so a call and its dial land on the same lead. The phone rule
  is decided afresh whenever a call is read again; a match somebody made by
  hand, or by email or appointment, is never overwritten
  (recordings._keep_earlier_matches).

The dial log. B2B's copy (sales-mirror, every three minutes) holds the
setters' calls only, so a closer's seat showed no dials and "never called"
counted leads a closer had reached: 457 of their calls since 1 January were
in Maqsam alone. A call the log does not hold goes in with origin `maqsam`,
inserted and never updated, under Maqsam's reference id: the v3 `referenceId`
is the id B2B keys its copy by, and the v3 `id` is another numbering (none of
Tahreer's 1,219 v3 ids is among B2B's, which hold the same 1,219 calls;
2026-09-26). So B2B's copy of a call always wins, and a call the log holds
for one of its agents at the same second, under any id, is left alone too.
The words are B2B's, which are Maqsam's own (DIRECTIONS, STATES); the rep id
is B2B's (cockpit_sales_reps), without which no seat counts the call; and
cockpit_sales_link_dials links each call to its lead by the whole number.

The check. After writing, the calls Maqsam listed for each seat on each of
the last seven Kuwait days are set against the calls the dial log holds for
that seat and day, in cockpit_sales_dial_checks: the second source for every
dial count. A seat Maqsam could not be read for gets no row, nor does a run
stopped early by --limit or a day the window does not cover: missing is never
zero. A call two seats handled is in both seats' Maqsam lists and in the log
once.

The window starts at the last successful run less seven days, because Maqsam
writes a transcript some minutes after the call: a call read before its
transcript existed is read again next time. The mark is the setting
`maqsam_calls` in cockpit_sales_settings, written only after a run that read
every seat from no later than the mark and put every call in the dial log, so
a seat Maqsam refused is read again from the same point. The first run starts
on 2026-01-01, and so does the first after the dial log came here (a mark
without `dials`), once. A run that wrote asks cockpit_sales_mark_recordings to
hide the calls whose transcript is only the carrier's message.

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
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Iterator, Optional

from . import http
from .fathom import parse_ts
from .recordings import _keep_earlier_matches, mark_recordings
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
DIALS = "cockpit_sales_dials"
CHECKS = "cockpit_sales_dial_checks"
# Every word B2B's copy uses, which are Maqsam's own (read in both on
# 2026-09-26). The dialer counts direction 'outbound' and takes state
# 'completed' as answered.
DIRECTIONS = ("outbound", "inbound")
STATES = ("completed", "serviced", "no_answer", "busy", "failed", "blocked", "abandoned")
# A lead the CRM wrote just after the call still existed at it.
GRACE = timedelta(hours=1)
# The day every count in the cockpit is kept by.
KUWAIT = timezone(timedelta(hours=3))
CHECK_DAYS = 7


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

def digits_of(number: Any) -> str:
    return re.sub(r"\D", "", str(number or ""))


def phone8(number: Any) -> Optional[str]:
    """The last eight digits, which is how a Maqsam call finds the leads it
    could belong to (pick_lead decides between them)."""
    digits = digits_of(number)
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


def whole(seconds: Any) -> Optional[int]:
    """Seconds as a whole number, and None where Maqsam gave none (a blocked
    call has no duration, as in B2B's copy)."""
    if seconds is None or seconds == "":
        return None
    try:
        return int(float(seconds))
    except (TypeError, ValueError):
        return None


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


def kuwait_day(at: datetime) -> date:
    return at.astimezone(KUWAIT).date()


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


def dial_row(call: dict[str, Any], *, agent: str, rep_id: Optional[str], stamp: str) -> Optional[dict[str, Any]]:
    """One call as B2B's copy of a call looks in cockpit_sales_dials, or None
    for a call with no reference id or time to be kept by. The lead is left
    for cockpit_sales_link_dials, which links by the whole number."""
    ref = str(call.get("referenceId") or "").strip()
    at = started(call)
    if not re.fullmatch(r"\d+", ref) or at is None:
        return None
    digits = digits_of(lead_number(call))
    return {
        "call_id": ref,
        "occurred_at": iso(at),
        "agent_email": agent,
        "agent_name": next((a["name"] for a in agents_of(call) if a["email"] == agent and a["name"]), None),
        "sales_rep_id": rep_id,
        "direction": str(call.get("type") or call.get("direction") or "").strip().lower() or None,
        "state": str(call.get("state") or "").strip().lower() or None,
        "duration_s": whole(call.get("duration")),
        "lead_phone8": digits[-8:] if len(digits) >= 8 else None,
        "lead_digits": digits or None,
        "has_transcript": bool(transcript_of(call)),
        "tags": [],
        "origin": "maqsam",
        "mirrored_at": stamp,
    }


def _rank(lead: dict[str, Any], at: datetime) -> tuple[int, float, str]:
    """Leads that existed at the call first, the newest of them first (a lead
    with no date after the dated ones); then those created after it, the
    earliest first. The contact id settles a tie."""
    created = parse_ts(lead.get("lead_created_at"))
    contact = str(lead.get("contact_id") or "")
    if created is None:
        return 1, 0.0, contact
    if created <= at + GRACE:
        return 0, -created.timestamp(), contact
    return 2, created.timestamp(), contact


def pick_lead(number: Any, at: Optional[datetime], leads: list[dict[str, Any]]) -> tuple[Optional[str], bool]:
    """The lead a call to or from `number` belongs to, and whether it was left
    unmatched because more than one could be meant.

    `leads` are those whose number ends in the same eight digits. When both
    numbers have nine digits or more they must agree on the last nine; among
    leads with the same number, the one that existed at the call wins (an
    hour's grace), else the first created after it. Eight digits alone match
    only when exactly one lead could be meant. This is the rule
    cockpit_sales_link_dials links the dialer's calls by (20260926m)."""
    digits = digits_of(number)
    if len(digits) < 8:
        return None, False
    same: list[dict[str, Any]] = []
    maybe: list[dict[str, Any]] = []
    for lead in leads:
        if not lead.get("contact_id"):
            continue
        theirs = digits_of(lead.get("phone"))
        if len(digits) >= 9 and len(theirs) >= 9:
            if digits[-9:] == theirs[-9:]:
                same.append(lead)
        else:
            maybe.append(lead)
    if len(same) == 1:
        return str(same[0]["contact_id"]), False
    if same:
        if at is None:
            # Without the call's time nobody can say which lead existed at it.
            return None, True
        return str(min(same, key=lambda lead: _rank(lead, at))["contact_id"]), False
    if len(maybe) == 1:
        return str(maybe[0]["contact_id"]), False
    return None, len(maybe) > 1


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


def rep_ids(sb: Any) -> dict[str, str]:
    """Maqsam address -> B2B's rep id (cockpit_sales_reps.id), the id every
    dial count and speed to lead read a call by: a call without one counts for
    nobody, as a call-centre agent's call does not."""
    out: dict[str, str] = {}
    for r in sb.select("cockpit_sales_reps", "select=id,maqsam_email&maqsam_email=not.is.null&order=id&limit=500"):
        e = str(r.get("maqsam_email") or "").strip().lower()
        if "@" in e and r.get("id"):
            out.setdefault(e, str(r["id"]))
    return out


def b2b_keeps(sb: Any) -> set[str]:
    """The Maqsam addresses whose calls B2B copies itself: its setters and
    those who both set and close (B2B's sync leaves out the closers, role
    `rep`). The desk writes none of these, so a call B2B has not copied yet
    is never written twice under Maqsam's other id; sales-mirror also drops
    any such twin (cockpit_sales_dedupe_dials)."""
    out: set[str] = set()
    for r in sb.select("cockpit_sales_reps", "select=maqsam_email,role&role=in.(setter,both)"
                                             "&maqsam_email=not.is.null&limit=500"):
        e = str(r.get("maqsam_email") or "").strip().lower()
        if "@" in e:
            out.add(e)
    return out


def leads_by_phone8(sb: Any, phones: set[str]) -> tuple[dict[str, list[dict[str, Any]]], int]:
    """phone8 -> every lead whose number ends in those digits, for pick_lead;
    and how many of the digits two leads or more shared."""
    out: dict[str, list[dict[str, Any]]] = {}
    wanted = sorted(p for p in phones if p)
    for i in range(0, len(wanted), 100):
        chunk = wanted[i : i + 100]
        for r in sb.select("cockpit_sales_leads", "select=contact_id,phone,phone8,lead_created_at"
                                                  f"&phone8=in.({_quoted(chunk)})&limit=1000"):
            p8 = str(r.get("phone8") or "")
            if p8 and r.get("contact_id"):
                out.setdefault(p8, []).append(r)
    return out, sum(1 for found in out.values() if len(found) > 1)


def stored_shas(sb: Any, ids: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(ids), 100):
        for r in sb.select("cockpit_sales_recordings", "select=recording_id,transcript_sha,transcript_path"
                                                       f"&recording_id=in.({_quoted(ids[i : i + 100])})"):
            out[str(r["recording_id"])] = r
    return out


def _every(sb: Any, table: str, params: str) -> list[dict[str, Any]]:
    """Every row of a read: the API answers at most 1,000 rows a request."""
    out: list[dict[str, Any]] = []
    while True:
        rows = sb.select(table, f"{params}&limit=1000&offset={len(out)}")
        out.extend(rows)
        if len(rows) < 1000:
            return out


def copy_dials(sb: Any, calls: list[dict[str, Any]], *, seat: str, ours: set[str], reps: dict[str, str],
               stamp: str, dry: bool, keeps: Optional[set[str]] = None) -> dict[str, int]:
    """Put the page's calls the dial log does not hold in it, inserted and
    never updated (resolution=ignore-duplicates). A call the log holds under
    the same id, or for one of the call's agents at the same second under any
    id, is B2B's copy and is left alone; so is a call credited to someone B2B
    copies itself (`keeps`). `dry` counts what would go in."""
    out = {"read": len(calls), "new": 0, "held": 0, "unusable": 0, "no_rep": 0, "unfamiliar": 0, "b2b_keeps": 0}
    rows: list[tuple[dict[str, Any], set[str]]] = []
    refs: set[str] = set()
    for call in calls:
        agents = [a["email"] for a in agents_of(call) if a["email"]]
        # Credited as the recording is: the call's first agent who holds a seat.
        by = next((a for a in agents if a in ours), seat)
        if keeps and by in keeps:
            out["b2b_keeps"] += 1
            continue
        row = dial_row(call, agent=by, rep_id=reps.get(by), stamp=stamp)
        if row is None:
            out["unusable"] += 1
        elif row["call_id"] in refs:
            out["held"] += 1
        else:
            refs.add(row["call_id"])
            rows.append((row, set(agents) | {by}))
    if not rows:
        return out
    # dial_row keeps only calls with a time, so every row has one.
    times = [parse_ts(r["occurred_at"]) for r, _a in rows]
    who = sorted({a for _r, agents in rows for a in agents})
    held_ids: set[str] = set()
    held_at: set[tuple[str, datetime]] = set()
    for r in _every(sb, DIALS, "select=call_id,agent_email,occurred_at"
                               f"&occurred_at=gte.{http.quote(iso(min(times)))}"
                               f"&occurred_at=lte.{http.quote(iso(max(times)))}"
                               f"&agent_email=in.({_quoted(who)})&order=call_id"):
        held_ids.add(str(r.get("call_id")))
        at = parse_ts(r.get("occurred_at"))
        if at is not None:
            held_at.add((str(r.get("agent_email") or "").strip().lower(), at))
    fresh = []
    for (row, agents), at in zip(rows, times):
        if row["call_id"] in held_ids or any((a, at) in held_at for a in agents):
            out["held"] += 1
        else:
            fresh.append(row)
    written = fresh
    if fresh and not dry:
        made = sb.rest("POST", f"{DIALS}?on_conflict=call_id", json_body=fresh,
                       prefer="resolution=ignore-duplicates,return=representation")
        # Only the rows that went in come back: one B2B copied since the read stays B2B's.
        written = [r for r in made if isinstance(r, dict)] if isinstance(made, list) else []
        out["held"] += len(fresh) - len(written)
    out["new"] = len(written)
    out["no_rep"] = sum(1 for r in written if not r.get("sales_rep_id"))
    out["unfamiliar"] = sum(1 for r in written if r.get("direction") not in DIRECTIONS or r.get("state") not in STATES)
    return out


def check_days(start: datetime, now: datetime) -> list[date]:
    """The last seven Kuwait days, today's so far included, that this run read
    whole: a day that began before the window did is not counted at all."""
    today = kuwait_day(now)
    out = []
    for back in range(CHECK_DAYS - 1, -1, -1):
        d = today - timedelta(days=back)
        if datetime(d.year, d.month, d.day, tzinfo=KUWAIT) >= start:
            out.append(d)
    return out


def check_dials(sb: Any, counted: dict[str, dict[date, int]], days: list[date], *, now: datetime, stamp: str,
                dry: bool) -> dict[str, Any]:
    """Per seat read whole and Kuwait day: the calls Maqsam listed against the
    calls the dial log holds for that seat, upserted into
    cockpit_sales_dial_checks."""
    out: dict[str, Any] = {"days": [d.isoformat() for d in days[:1] + days[-1:]], "seats": len(counted),
                           "maqsam": 0, "copied": 0, "short": [], "over": [], "written": 0}
    if not days or not counted:
        return out
    begins = datetime(days[0].year, days[0].month, days[0].day, tzinfo=KUWAIT)
    held: dict[tuple[str, date], int] = {}
    for r in _every(sb, DIALS, "select=call_id,agent_email,occurred_at"
                               f"&occurred_at=gte.{http.quote(iso(begins))}&occurred_at=lte.{http.quote(iso(now))}"
                               "&order=call_id"):
        at = parse_ts(r.get("occurred_at"))
        who = str(r.get("agent_email") or "").strip().lower()
        if at is not None and who in counted:
            held[(who, kuwait_day(at))] = held.get((who, kuwait_day(at)), 0) + 1
    rows = []
    for email in sorted(counted):
        for d in days:
            listed, copied = counted[email].get(d, 0), held.get((email, d), 0)
            rows.append({"day": d.isoformat(), "agent_email": email, "maqsam_calls": listed,
                         "copied_calls": copied, "checked_at": stamp})
            out["maqsam"] += listed
            out["copied"] += copied
            if listed != copied:
                out["short" if copied < listed else "over"].append(
                    {"agent": email, "day": d.isoformat(), "maqsam": listed, "copied": copied})
    if not dry:
        out["written"] = sb.upsert(CHECKS, rows, "day,agent_email")
    return out


def dials_said(dials: dict[str, Any], check: dict[str, Any], unchecked: list[str]) -> str:
    """The dial log and its check in one sentence, for the run's output."""
    s = f"{dials['new']:,} {'call' if dials['new'] == 1 else 'calls'} added to the dial log"
    if dials["no_rep"]:
        s += f" ({dials['no_rep']:,} on a Maqsam address no rep carries, so no seat counts them)"
    if dials["unusable"]:
        s += f", {dials['unusable']:,} left out with no reference id or time"
    if dials["unfamiliar"]:
        s += f", {dials['unfamiliar']:,} with a direction or state B2B's copy never uses"
    if dials.get("b2b_keeps"):
        s += f", {dials['b2b_keeps']:,} left to B2B's own copy"
    if dials.get("errors"):
        s += f"; could not add {', '.join(sorted(dials['errors']))}'s"
    if check.get("not_done"):
        return s + f"; dial check not done: {check['not_done']}"
    first, last = check["days"]
    s += f"; dial check {first} to {last} (Kuwait): Maqsam has {check['maqsam']:,}, the log {check['copied']:,}"
    gaps = check["short"] + check["over"]
    if gaps:
        s += "; " + ", ".join(f"{g['agent']} {g['day']} {g['copied']} of {g['maqsam']}" for g in gaps[:6])
        if len(gaps) > 6:
            s += f" and {len(gaps) - 6} more"
    if unchecked:
        s += f"; not checked (Maqsam not read): {', '.join(unchecked)}"
    return s


# ---- the run -----------------------------------------------------------------

def window(sb: Any, now: datetime, days: Optional[int]) -> tuple[datetime, Optional[datetime], bool]:
    """Where this run starts, the mark it starts from, and whether the dial
    log already holds every call since the first day. A mark from before the
    log was kept here sends the run back to the first day once, as
    sales-mirror read every call again for its whole number: the closers'
    calls since then go in, and every phone recording is matched again."""
    mark = sb.setting(SETTING)
    through = parse_ts(mark.get("through")) if isinstance(mark, dict) else None
    filled = bool(isinstance(mark, dict) and mark.get("dials"))
    if days:
        return now - timedelta(days=days), through, filled
    return ((through - OVERLAP) if through and filled else FIRST_DAY), through, filled


def run(sb: Any, mq: Maqsam, log: Callable[[str], None], *, days: Optional[int] = None, dry: bool = False,
        limit: Optional[int] = None, upload: Optional[Callable[[str, bytes], Any]] = None,
        now: Optional[datetime] = None) -> dict[str, Any]:
    """Read every seat's calls since the mark (or the last `days`), put each in
    the dial log and copy each answered one with a transcript in. `dry` reads
    and matches only; `limit` stops after that many calls (a first try by
    hand)."""
    now = (now or datetime.now(timezone.utc)).replace(microsecond=0)
    start, through, filled = window(sb, now, days)
    emails = seats(sb)
    ours = set(emails)
    reps = rep_ids(sb)
    keeps = b2b_keeps(sb)
    to_check = check_days(start, now)
    per: dict[str, dict[str, Any]] = {}
    unread: list[str] = []
    done: set[str] = set()
    dialed: set[str] = set()
    counted: dict[str, dict[date, int]] = {}
    dials: dict[str, Any] = {"read": 0, "new": 0, "held": 0, "unusable": 0, "no_rep": 0, "unfamiliar": 0,
                             "b2b_keeps": 0, "errors": {}}
    totals = {"rows": 0, "stored": 0, "uploaded": 0, "by_phone": 0, "unmatched": 0, "kept_earlier_match": 0,
              "shared_phone8": 0, "ambiguous": 0}
    first: Optional[str] = None
    last: Optional[str] = None
    stamp = now_iso()

    def full() -> bool:
        return limit is not None and totals["rows"] >= limit

    for email in emails:
        if full():
            break
        c = per[email] = {"seen": 0, "answered": 0, "with_transcript": 0, "rows": 0, "dials": 0}
        on_day: dict[date, set[str]] = {}
        try:
            for page in mq.calls(email, start, now):
                theirs = [x for x in page if email in {a["email"] for a in agents_of(x)}]
                c["seen"] += len(theirs)
                if page and not theirs:
                    raise MaqsamError(0, f"Maqsam answered {email}'s page with none of their calls, so its "
                                         "email filter was not applied; stopped reading them")
                for call in theirs:
                    at = started(call)
                    if at is not None and kuwait_day(at) in to_check:
                        # A page can repeat a call when a new one pushes the list down.
                        seen = on_day.setdefault(kuwait_day(at), set())
                        seen.add(str(call.get("id") or "") or f"no id {len(seen)}")
                fresh = [x for x in theirs if not x.get("id") or str(x["id"]) not in dialed]
                if fresh and email not in dials["errors"]:
                    # A dial log that cannot be written stops neither the recordings
                    # nor the other seats; it keeps the mark where it is.
                    try:
                        got = copy_dials(sb, fresh, seat=email, ours=ours, reps=reps, stamp=stamp, dry=dry,
                                         keeps=keeps)
                    except http.HttpError as e:
                        dials["errors"][email] = http.scrub(str(e))[:200]
                        log(f"maqsam-calls: {email}'s calls could not be added to the dial log: "
                            f"{dials['errors'][email]}")
                    else:
                        for k, v in got.items():
                            dials[k] += v
                        c["dials"] += got["new"]
                        dialed.update(str(x["id"]) for x in fresh if x.get("id"))
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
                rows, texts = [], {}
                for call, text in keep:
                    # The first of the call's own agents who holds a seat, so
                    # a call two seats handled is always credited the same way.
                    by = next((a["email"] for a in agents_of(call) if a["email"] in ours), email)
                    number = lead_number(call)
                    contact, unsure = pick_lead(number, started(call), leads.get(phone8(number) or "", []))
                    totals["ambiguous"] += int(unsure)
                    row = row_for(call, text, recorded_by=by, contact=contact)
                    rows.append(row)
                    texts[row["recording_id"]] = text
                # An earlier phone match is the phone rule's to decide again.
                totals["kept_earlier_match"] += _keep_earlier_matches(sb, rows, redo=("phone",))
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
            if limit is None:
                counted[email] = {d: len(ids) for d, ids in on_day.items()}
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

    # A seat Maqsam could not be read for is not compared at all: missing is never zero.
    unchecked = [e for e in emails if e not in counted] if limit is None else []
    if limit is not None:
        check: dict[str, Any] = {"not_done": "a run stopped by --limit read no seat whole"}
    elif not counted or not to_check:
        check = {"not_done": "no seat was read whole" if not counted else "the window covers no whole Kuwait day"}
    else:
        try:
            check = check_dials(sb, counted, to_check, now=now, stamp=stamp, dry=dry)
        except http.HttpError as e:
            check = {"not_done": f"the dial log could not be read: {http.scrub(str(e))[:200]}"}
    marked = None if dry else mark_recordings(sb, log, "maqsam-calls")
    covered = (not unread and not dials["errors"] and limit is None and start <= (through or FIRST_DAY)
               and len(per) == len(emails))
    if covered and not dry:
        sb.store_setting(SETTING, {"through": iso(now), "from": iso(start), "calls": totals["rows"],
                                   "seats": len(emails), "at": stamp, "dials": filled or start <= FIRST_DAY},
                         "sales-desk")
    said = dials_said(dials, check, unchecked)
    summary = {
        "from": iso(start), "to": iso(now), "seats": len(emails), "seats_unread": unread, "per_seat": per,
        **totals, "first": first, "last": last, "dry": dry, "mark_written": covered and not dry,
        "dials": dials, "dial_check": check, "dials_said": said, "marked": marked,
    }
    log(f"maqsam-calls: {said}")
    log(f"maqsam-calls: {json.dumps({k: v for k, v in summary.items() if k != 'per_seat'}, default=str)}")
    return summary
