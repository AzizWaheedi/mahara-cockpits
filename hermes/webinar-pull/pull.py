#!/usr/bin/env python3
"""The live training's Zoom sessions and survey answers, into Creative Triage.

Aziz, 2026-09-23: "we will collect the rest of the metrics use composio we
have zoom api. qualification in the form after also before they book a
call". The Live Training tracking brief (6 August 2026) makes Zoom the source
of truth for who showed and for how long, and Typeform for the post-event
form. This reads both and writes raw rows only, into the tables of
supabase/migrations/20260923g_webinar_collection.sql. The CEO cockpit's
webinar section computes every rate from them on read.

Two doors into Zoom, Composio first:

* Composio (COMPOSIO_API_KEY, the consumer key, spoken over MCP exactly as
  hermes/editor-desk/desk/foreplay.py does). Its Zoom connection reads the
  meeting, its cloud recordings (which name every session that ran) and a
  session's participants. It refuses the list of past sessions, poll results
  and Q&A: Zoom answers 4711, scopes missing (checked 2026-09-23).
* The Zoom app already on the VPS (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID,
  ZOOM_CLIENT_SECRET, server-to-server). Used for exactly what Composio
  cannot read, and as the fallback when a Composio call fails.

The survey is read through Composio's Typeform connection.

What Zoom gives about a guest: a display name and join and leave times, no
email, because the meeting has no registration (approval_type 2). So
attendance can be counted and the retention curve drawn, but a guest cannot
be tied to a HighLevel contact. Only a registrant id or an email ever joins a
row to a person; a name never does (the brief's rule).

    python3 pull.py doctor     every key by name, each door, the join link
    python3 pull.py            Zoom and the survey (what cron runs)
    python3 pull.py zoom       Zoom only; --again reads finished sessions again
    python3 pull.py survey     the survey only
"""

from __future__ import annotations

import argparse
import base64
import collections
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Optional

MEETING_ID = os.environ.get("WEBINAR_ZOOM_MEETING_ID", "88628953097")
SURVEY_ID = os.environ.get("WEBINAR_TYPEFORM_ID", "P1xP4r24")
# The first day a session can be on: the live training's Zoom meeting was
# made on 7 September 2026.
SINCE = os.environ.get("WEBINAR_SINCE", "2026-09-01")
# Sessions older than this are finished and stored; only look for new ones.
LOOK_BACK_DAYS = 45
JOIN_LINK = os.environ.get("WEBINAR_JOIN_LINK", "https://webinar.maharamedia.com/live")
OUR_DOMAIN = "@maharamedia.com"
COMPOSIO_MCP = "https://connect.composio.dev/mcp"
ZOOM_API = "https://api.zoom.us/v2"
TABLES = (
    "cockpit_webinar_sessions",
    "cockpit_webinar_attendance",
    "cockpit_webinar_engagement",
    "cockpit_webinar_forms",
    "cockpit_webinar_pulls",
)

# The gift survey's questions, by Typeform field ref (form P1xP4r24).
REFS = {
    "profit": "8ca026ce-0a96-4cde-b679-cfda04ee0dfd",
    "years": "5b7a691a-135b-4366-a624-160b5b83f9c5",
    "work": "4d4e99e3-074d-4974-8500-40ee8dffb6bf",
    "blocker": "b0bc49a4-f0d9-4466-837d-a6b692982785",
    "goal": "e14fb851-ab7f-4ebf-96c8-f25c74deb645",
    "success": "70ad73ff-f3ff-446a-99a9-409f034a2bd2",
    "first": "12bd11e4-3f5b-453d-adae-8711767aa2b8",
    "last": "c2e8fb25-bc2f-4bbb-bfa3-fc69d0a08e14",
    "phone": "288d7a23-720d-4444-bfc4-cb69d0829ed8",
    "email": "7f0722a2-f1e8-42c9-9546-dfedf0e50b55",
}

QUIET = False


class Failure(Exception):
    """A call that gave no answer. The message never carries a secret."""


def note(line: str) -> None:
    if not QUIET:
        print(f"[{dt.datetime.now(dt.timezone.utc):%H:%M:%S}] {line}", flush=True)


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(t: Optional[dt.datetime]) -> Optional[str]:
    return t.astimezone(dt.timezone.utc).isoformat(timespec="seconds") if t else None


def parse_ts(s: Any) -> Optional[dt.datetime]:
    """Zoom and Typeform write ISO with Z; Zoom's polls write 'YYYY-MM-DD HH:MM:SS' in UTC."""
    if not s:
        return None
    text = str(s).strip().replace("Z", "+00:00")
    if re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$", text):
        text = text.replace(" ", "T") + "+00:00"
    try:
        t = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def call(method: str, url: str, headers: Optional[dict] = None, body: Any = None,
         timeout: int = 90) -> tuple[int, dict, bytes]:
    """One HTTP call. An error names the host only: URLs here can carry a token."""
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read() or b""
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        host = urllib.parse.urlsplit(url).netloc
        raise Failure(f"{host} could not be reached ({type(e).__name__})")


# --- Composio, over MCP ------------------------------------------------------

class Composio:
    """Composio's MCP door with the consumer key (a `ck_` key is an MCP client
    credential; the REST execute endpoint refuses it, checked 2026-09-19)."""

    def __init__(self, key: str):
        self.key = key
        self.session = ""
        self.calls = 0

    def _headers(self) -> dict:
        h = {
            "x-consumer-api-key": self.key,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.session:
            h["mcp-session-id"] = self.session
        return h

    @staticmethod
    def sse(body: bytes) -> dict:
        """One JSON-RPC answer out of a server-sent-event body."""
        for raw in body.decode("utf-8", "replace").splitlines():
            line = raw.strip()
            if line.startswith("data:"):
                line = line[5:].strip()
            if line.startswith("{"):
                try:
                    return json.loads(line)
                except ValueError:
                    continue
        return {}

    def open(self) -> None:
        if self.session:
            return
        status, headers, _body = call("POST", COMPOSIO_MCP, self._headers(), {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18", "capabilities": {},
                "clientInfo": {"name": "webinar-pull", "version": "1"},
            },
        }, timeout=60)
        sid = next((str(v).strip() for k, v in headers.items() if k.lower() == "mcp-session-id"), "")
        if not sid:
            raise Failure(f"Composio gave no MCP session (HTTP {status})")
        self.session = sid
        try:
            call("POST", COMPOSIO_MCP, self._headers(),
                 {"jsonrpc": "2.0", "method": "notifications/initialized"}, timeout=30)
        except Failure:
            pass

    def run(self, slug: str, args: dict, retry: bool = True) -> dict:
        self.open()
        self.calls += 1
        status, _h, body = call("POST", COMPOSIO_MCP, self._headers(), {
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": {
                "name": "COMPOSIO_MULTI_EXECUTE_TOOL",
                "arguments": {"tools": [{"tool_slug": slug, "arguments": args}]},
            },
        }, timeout=180)
        if status in (400, 404) and retry and b"session" in body.lower():
            self.session = ""  # the MCP session expired; open a new one once
            return self.run(slug, args, retry=False)
        answer = self.sse(body)
        if answer.get("error"):
            raise Failure(f"Composio refused {slug}: {json.dumps(answer['error'])[:200]}")
        text = next((str(c["text"]) for c in ((answer.get("result") or {}).get("content") or [])
                     if isinstance(c, dict) and c.get("text")), "")
        if not text:
            raise Failure(f"Composio returned nothing for {slug} (HTTP {status})")
        try:
            outer = json.loads(text)
        except ValueError:
            raise Failure(f"Composio returned unreadable JSON for {slug}")
        results = ((outer.get("data") or {}).get("results") or [])
        if not results:
            raise Failure(f"Composio ran nothing for {slug}: {json.dumps(outer)[:200]}")
        response = results[0].get("response") or {}
        if response.get("successful") is False:
            raise Failure(f"{slug}: {str(response.get('error'))[:240]}")
        data = response.get("data")
        return data if isinstance(data, dict) else {}


# --- The Zoom app (server-to-server) ------------------------------------------

def uuid_path(u: str) -> str:
    """Zoom's rule: a session UUID that starts with / or holds // is encoded twice."""
    once = urllib.parse.quote(u, safe="")
    return urllib.parse.quote(once, safe="") if u.startswith("/") or "//" in u else once


class ZoomApp:
    def __init__(self, account: str, client: str, secret: str):
        self.account, self.client, self.secret = account, client, secret
        self.token = ""
        self.expires = 0.0
        self.scopes: set[str] = set()

    @classmethod
    def from_env(cls) -> Optional["ZoomApp"]:
        a, c, s = (os.environ.get(k, "").strip() for k in ("ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"))
        return cls(a, c, s) if a and c and s else None

    def bearer(self) -> str:
        if self.token and time.time() < self.expires - 60:
            return self.token
        basic = base64.b64encode(f"{self.client}:{self.secret}".encode()).decode()
        status, _h, body = call(
            "POST",
            "https://zoom.us/oauth/token?grant_type=account_credentials&account_id="
            + urllib.parse.quote(self.account),
            {"Authorization": f"Basic {basic}"}, b"", timeout=30)
        if status != 200:
            raise Failure(f"the Zoom app's credentials were refused (HTTP {status})")
        d = json.loads(body)
        self.token = str(d.get("access_token") or "")
        self.expires = time.time() + int(d.get("expires_in") or 3600)
        self.scopes = set(str(d.get("scope") or "").split())
        return self.token

    def can(self, scope: str) -> bool:
        self.bearer()
        return scope in self.scopes or f"{scope}:admin" in self.scopes

    def get(self, path: str, **params: Any) -> dict:
        q = urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, "")})
        status, _h, body = call("GET", f"{ZOOM_API}{path}{'?' + q if q else ''}",
                                {"Authorization": f"Bearer {self.bearer()}", "Accept": "application/json"})
        if status >= 300:
            raise Failure(f"Zoom {status}: {body[:200].decode('utf-8', 'replace')}")
        return json.loads(body) if body.strip() else {}


# --- Zoom, through whichever door answers -------------------------------------

NO_RECORDING = ("3301", "does not exist", "no recording")


class Zoom:
    def __init__(self, composio: Optional[Composio], app: Optional[ZoomApp]):
        self.c, self.app = composio, app
        self.via: set[str] = set()

    def _either(self, what: str, by_composio: Optional[Callable[[], Any]],
                by_app: Optional[Callable[[], Any]]) -> Any:
        errors = []
        if self.c and by_composio:
            try:
                out = by_composio()
                self.via.add("composio")
                return out
            except Failure as e:
                errors.append(f"Composio: {e}")
        if self.app and by_app:
            try:
                out = by_app()
                self.via.add("zoom-app")
                return out
            except Failure as e:
                errors.append(f"the Zoom app: {e}")
        raise Failure(f"{what}: " + ("; ".join(errors) if errors else "no Zoom key is set"))

    def meeting(self) -> dict:
        return self._either(
            "the meeting",
            lambda: self.c.run("ZOOM_GET_A_MEETING", {"meeting_id": MEETING_ID}),
            lambda: self.app.get(f"/meetings/{MEETING_ID}"))

    def recordings(self, host: str, since: dt.date) -> list[dict]:
        """Every cloud recording of the meeting since a day; one per session."""
        out: dict[str, dict] = {}
        start, end = since, utcnow().date() + dt.timedelta(days=1)
        while start < end:
            stop = min(start + dt.timedelta(days=30), end)
            token = ""
            for _ in range(20):
                args = {"user_id": "me", "from": start.isoformat(), "to": stop.isoformat(),
                        "page_size": 300, "meeting_id": MEETING_ID}
                if token:
                    args["next_page_token"] = token
                page = self._either(
                    "the recordings",
                    lambda a=args: self.c.run("ZOOM_LIST_ALL_RECORDINGS", a),
                    (lambda a=args: self.app.get(
                        f"/users/{urllib.parse.quote(host or 'me')}/recordings",
                        **{k: v for k, v in a.items() if k != "user_id"})) if host else None)
                for m in page.get("meetings") or []:
                    if str(m.get("id")) == MEETING_ID and m.get("uuid"):
                        out[str(m["uuid"])] = m
                token = str(page.get("next_page_token") or "")
                if not token:
                    break
            start = stop
        return list(out.values())

    def instances(self) -> list[dict]:
        """Every past session by UUID. Only the Zoom app has the scope."""
        if not self.app:
            return []
        try:
            d = self.app.get(f"/past_meetings/{MEETING_ID}/instances")
        except Failure as e:
            note(f"past sessions could not be listed by the Zoom app: {e}")
            return []
        self.via.add("zoom-app")
        return [m for m in d.get("meetings") or [] if m.get("uuid")]

    def details(self, uuid: str) -> dict:
        """A finished session's start, end and host. The Zoom app only."""
        if not self.app:
            return {}
        try:
            return self.app.get(f"/past_meetings/{uuid_path(uuid)}")
        except Failure:
            return {}

    def participants(self, uuid: str) -> list[dict]:
        rows: list[dict] = []
        token = ""
        for _ in range(100):
            args: dict[str, Any] = {"meeting_id": uuid, "page_size": 300}
            if token:
                args["next_page_token"] = token
            page = self._either(
                "the participants",
                lambda a=args: self.c.run("ZOOM_GET_PAST_MEETING_PARTICIPANTS", a),
                lambda a=args: self.app.get(
                    f"/past_meetings/{uuid_path(uuid)}/participants",
                    page_size=300, next_page_token=a.get("next_page_token")))
            rows.extend(p for p in page.get("participants") or [] if isinstance(p, dict))
            token = str(page.get("next_page_token") or "")
            if not token:
                break
        return rows

    def recording(self, uuid: str) -> dict:
        """The session's recording files and a token to download them, or {}."""
        try:
            return self._either(
                "the recording",
                lambda: self.c.run("ZOOM_GET_MEETING_RECORDINGS", {
                    "meeting_id": uuid, "include_fields": "download_access_token", "ttl": 3600}),
                lambda: self.app.get(f"/meetings/{uuid_path(uuid)}/recordings",
                                     include_fields="download_access_token", ttl=3600))
        except Failure as e:
            if any(w in str(e).lower() for w in NO_RECORDING):
                return {}
            raise

    def download(self, url: str, token: str) -> str:
        joined = url + ("&" if "?" in url else "?") + "access_token=" + urllib.parse.quote(token)
        status, _h, body = call("GET", joined, timeout=120)
        if status in (401, 403) and self.app:
            status, _h, body = call("GET", url, {"Authorization": f"Bearer {self.app.bearer()}"}, timeout=120)
        if status >= 300:
            raise Failure(f"a recording file could not be downloaded (HTTP {status})")
        return body.decode("utf-8", "replace")

    def polls(self, uuid: str) -> Optional[dict]:
        """Poll answers; None when no door can read them."""
        if not self.app or not self.app.can("meeting:read:list_poll_results"):
            return None
        try:
            return self.app.get(f"/past_meetings/{uuid_path(uuid)}/polls")
        except Failure as e:
            if "3001" in str(e) or "does not exist" in str(e).lower() or "12702" in str(e):
                return {}
            raise

    def qa(self, uuid: str) -> Optional[dict]:
        if not self.app or not self.app.can("meeting:read:past_qa"):
            return None
        try:
            return self.app.get(f"/past_meetings/{uuid_path(uuid)}/qa")
        except Failure:
            return {}

    def registrants(self) -> dict[str, dict]:
        """Registrant id to email and HighLevel contact id, when registration is on."""
        if not self.app:
            return {}
        out: dict[str, dict] = {}
        token = ""
        for _ in range(50):
            try:
                d = self.app.get(f"/meetings/{MEETING_ID}/registrants", status="approved",
                                 page_size=300, next_page_token=token)
            except Failure:
                return out
            for r in d.get("registrants") or []:
                contact = ""
                for q in r.get("custom_questions") or []:
                    if "contact" in str(q.get("title", "")).lower():
                        contact = str(q.get("value") or "").strip()
                out[str(r.get("id"))] = {
                    "email": str(r.get("email") or "").strip().lower() or None,
                    "contact_id": contact or None,
                }
            token = str(d.get("next_page_token") or "")
            if not token:
                break
        return out


# --- Rows ----------------------------------------------------------------------

def norm_name(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().casefold()


def person_key(p: dict) -> str:
    """Who a Zoom row is, strongest identity first. A name is only a count."""
    if p.get("registrant_id"):
        return f"reg:{p['registrant_id']}"
    email = str(p.get("user_email") or "").strip().lower()
    if email:
        return f"email:{email}"
    if p.get("id"):
        return f"zoom:{p['id']}"
    return f"name:{norm_name(p.get('name'))}"


def attendance_rows(uuid: str, participants: list[dict], registrants: dict[str, dict],
                    pulled: str) -> list[dict]:
    rows = []
    for p in participants:
        join = parse_ts(p.get("join_time"))
        if not join:
            continue
        reg = registrants.get(str(p.get("registrant_id") or "")) or {}
        email = str(p.get("user_email") or "").strip().lower() or reg.get("email") or None
        seconds = p.get("duration")
        key_src = "|".join(str(x or "") for x in (
            uuid, p.get("user_id"), p.get("id"), p.get("join_time"), p.get("name"), p.get("status")))
        rows.append({
            "session_uuid": uuid,
            "row_key": hashlib.sha1(key_src.encode()).hexdigest()[:24],
            "person_key": person_key({**p, "user_email": email}),
            "name": (str(p.get("name")).strip() or None) if p.get("name") else None,
            "email": email,
            "registrant_id": str(p["registrant_id"]) if p.get("registrant_id") else None,
            "participant_id": str(p["id"]) if p.get("id") else None,
            "zoom_user_id": str(p["user_id"]) if p.get("user_id") else None,
            "contact_id": reg.get("contact_id"),
            "status": str(p.get("status") or "in_meeting"),
            "internal": bool(p.get("internal_user")) or bool(email and email.endswith(OUR_DOMAIN)),
            "join_at": iso(join),
            "leave_at": iso(parse_ts(p.get("leave_time"))),
            "seconds": int(seconds) if isinstance(seconds, (int, float)) or str(seconds or "").isdigit() else None,
            "failover": bool(p.get("failover")),
            "pulled_at": pulled,
        })
    return rows


CHAT_TAB = re.compile(r"^(\d{1,2}):(\d{2}):(\d{2})\t(.*?):\t?(.*)$")
CHAT_FROM = re.compile(r"^(\d{1,2}):(\d{2}):(\d{2})\s+From\s+(.+?)\s+to\s+(.+?):\s*(.*)$")


def parse_chat(text: str) -> list[dict]:
    """A Zoom cloud-recording chat file. Two layouts exist:

        00:10:42<TAB>Name:<TAB>message
        00:10:42 From Name to Everyone:
        <TAB>message

    A line without a time continues the message above it."""
    out: list[dict] = []
    for raw in text.replace("\r\n", "\n").replace("﻿", "").split("\n"):
        if not raw.strip():
            continue
        m = CHAT_FROM.match(raw)
        if m:
            h, mi, s, name, to, body = m.groups()
            out.append({"offset_s": int(h) * 3600 + int(mi) * 60 + int(s), "name": name.strip(),
                        "to": to.strip(), "body": body.strip()})
            continue
        m = CHAT_TAB.match(raw)
        if m:
            h, mi, s, name, body = m.groups()
            out.append({"offset_s": int(h) * 3600 + int(mi) * 60 + int(s), "name": name.strip(),
                        "to": "Everyone", "body": body.strip()})
            continue
        if out:
            out[-1]["body"] = (out[-1]["body"] + "\n" + raw.strip()).strip()
    return out


def name_keys(rows: list[dict]) -> dict[str, str]:
    """A display name to the strongest person key the session knows for it."""
    keys: dict[str, str] = {}
    for r in rows:
        n = norm_name(r.get("name"))
        if not n:
            continue
        if n not in keys or keys[n].startswith("name:"):
            keys[n] = r["person_key"]
    return keys


def chat_rows(uuid: str, base: dt.datetime, lines: list[dict], keys: dict[str, str],
              pulled: str) -> list[dict]:
    rows = []
    seen: collections.Counter = collections.Counter()
    for c in lines:
        k = f"{uuid}|{c['offset_s']}|{c['name']}|{c['body']}"
        seen[k] += 1  # the same line sent twice in one second stays two lines
        n = norm_name(c["name"])
        to = c.get("to") or "Everyone"
        rows.append({
            "session_uuid": uuid,
            "kind": "chat",
            "row_key": hashlib.sha1(f"{k}|{seen[k]}".encode()).hexdigest()[:24],
            "at": iso(base + dt.timedelta(seconds=c["offset_s"])),
            "offset_s": c["offset_s"],
            "person_key": keys.get(n, f"name:{n}"),
            "name": c["name"] or None,
            "email": None,
            "contact_id": None,
            "pitch_number": None,
            "body": c["body"][:4000],
            "payload": None if to.lower() == "everyone" else {"to": to},
            "pulled_at": pulled,
        })
    return rows


def answer_rows(uuid: str, data: dict, kind: str, start: Optional[dt.datetime],
                pulled: str) -> list[dict]:
    """Poll answers or Q&A questions, one row per answer."""
    rows = []
    seen: collections.Counter = collections.Counter()
    for q in data.get("questions") or []:
        email = str(q.get("email") or "").strip().lower() or None
        name = str(q.get("name") or "").strip() or None
        for d in q.get("question_details") or []:
            at = parse_ts(d.get("date_time"))
            k = f"{uuid}|{kind}|{email}|{name}|{d.get('polling_id')}|{d.get('question')}|{d.get('date_time')}"
            seen[k] += 1
            rows.append({
                "session_uuid": uuid,
                "kind": kind,
                "row_key": hashlib.sha1(f"{k}|{seen[k]}".encode()).hexdigest()[:24],
                "at": iso(at),
                "offset_s": int((at - start).total_seconds()) if at and start else None,
                "person_key": f"email:{email}" if email else f"name:{norm_name(name)}",
                "name": name,
                "email": email,
                "contact_id": None,
                "pitch_number": None,
                "body": str(d.get("answer") or "")[:4000] or None,
                "payload": {"question": d.get("question"), "polling_id": d.get("polling_id")},
                "pulled_at": pulled,
            })
    return rows


def profit_min(label: Optional[str]) -> Optional[float]:
    """The lower bound of a profit band in dollars: '$100K - $250k' is 100000,
    'less than $100,000' (أقل من) is 0."""
    if not label:
        return None
    s = str(label).lower().replace(" ", "")
    if "أقلمن" in s or "lessthan" in s or "under" in s or s.startswith("<"):
        return 0.0
    m = re.search(r"\$?([\d][\d.,]*)([km]?)", s)
    if not m:
        return None
    n = float(m.group(1).replace(",", ""))
    return n * {"k": 1_000, "m": 1_000_000}.get(m.group(2), 1)


def digits(s: Any) -> Optional[str]:
    d = re.sub(r"\D", "", str(s or ""))
    if d.startswith("00"):
        d = d[2:]
    return d or None


GHL_ID = re.compile(r"^[A-Za-z0-9]{15,32}$")


def survey_row(item: dict, pulled: str) -> Optional[dict]:
    rid = str(item.get("response_id") or item.get("token") or "")
    submitted = parse_ts(item.get("submitted_at"))
    if not rid or not submitted:
        return None
    by_ref: dict[str, Any] = {}
    compact = []
    for a in item.get("answers") or []:
        ref = str((a.get("field") or {}).get("ref") or "")
        t = a.get("type")
        if t == "choice":
            c = a.get("choice") or {}
            value: Any = c.get("label") or c.get("other")
        elif t == "choices":
            c = a.get("choices") or {}
            value = ", ".join([*(c.get("labels") or []), *([c["other"]] if c.get("other") else [])])
        else:
            value = a.get(t) if t in a else a.get("text")
        by_ref[ref] = value
        compact.append({"ref": ref, "type": t, "value": value})
    hidden = {k: v for k, v in (item.get("hidden") or {}).items() if v not in (None, "")}
    email = str(by_ref.get(REFS["email"]) or hidden.get("email") or "").strip().lower() or None
    phone = digits(by_ref.get(REFS["phone"]) or hidden.get("phone_number"))
    uid = str(hidden.get("user_id") or "").strip()
    first = str(by_ref.get(REFS["first"]) or hidden.get("first_name") or "").strip()
    last = str(by_ref.get(REFS["last"]) or hidden.get("last_name") or "").strip()
    band = by_ref.get(REFS["profit"])
    return {
        "response_id": rid,
        "form_id": SURVEY_ID,
        "submitted_at": iso(submitted),
        "landed_at": iso(parse_ts(item.get("landed_at"))),
        "email": email,
        "phone": phone,
        "contact_id": uid if GHL_ID.match(uid) else None,
        "name": " ".join(x for x in (first, last) if x) or None,
        "profit_band": band,
        "profit_min": profit_min(band),
        "years_band": by_ref.get(REFS["years"]),
        "work_type": by_ref.get(REFS["work"]),
        "blocker": by_ref.get(REFS["blocker"]),
        "goal_band": by_ref.get(REFS["goal"]),
        "success": by_ref.get(REFS["success"]),
        "hidden": hidden or None,
        "answers": compact,
        "pulled_at": pulled,
    }


# --- Supabase ------------------------------------------------------------------

class Supabase:
    def __init__(self, url: str, key: str, dry: bool = False):
        self.url, self.key, self.dry = url.rstrip("/"), key, dry

    @classmethod
    def from_env(cls, dry: bool = False) -> "Supabase":
        url = os.environ.get("DESK_SUPABASE_URL", "").strip()
        key = os.environ.get("DESK_SUPABASE_KEY", "").strip()
        if not url or not key:
            raise Failure("DESK_SUPABASE_URL and DESK_SUPABASE_KEY are not set (~/.editor-desk/env)")
        return cls(url, key, dry)

    def req(self, method: str, path: str, body: Any = None, prefer: str = "") -> Any:
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}",
                   "Content-Type": "application/json", "Accept": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        status, _h, content = call(method, f"{self.url}/rest/v1/{path}", headers, body)
        if status >= 300:
            raise Failure(f"Supabase {status} on {path.split('?')[0]}: {content[:200].decode('utf-8', 'replace')}")
        return json.loads(content) if content.strip() else []

    def upsert(self, table: str, rows: list[dict], on_conflict: str) -> int:
        if not rows:
            return 0
        if self.dry:
            note(f"dry run: {len(rows)} rows for {table}")
            return len(rows)
        for i in range(0, len(rows), 500):
            self.req("POST", f"{table}?on_conflict={on_conflict}", rows[i:i + 500],
                     "resolution=merge-duplicates,return=minimal")
        return len(rows)

    def begin(self, source: str) -> Optional[int]:
        if self.dry:
            return None
        out = self.req("POST", "cockpit_webinar_pulls", {"source": source}, "return=representation")
        return int(out[0]["id"]) if out else None

    def finish(self, run: Optional[int], ok: bool, via: str, detail: str, counts: dict) -> None:
        if self.dry or run is None:
            return
        self.req("PATCH", f"cockpit_webinar_pulls?id=eq.{run}", {
            "finished_at": iso(utcnow()), "ok": ok, "via": via or None,
            "detail": detail[:1000] or None, "counts": counts})


# --- The two pulls ---------------------------------------------------------------

def join_link_ok() -> Optional[bool]:
    """Does the reminders' join link lead to Zoom? None when it cannot be checked."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):  # noqa: D401
            return None
    opener = urllib.request.build_opener(NoRedirect)
    try:
        r = opener.open(urllib.request.Request(JOIN_LINK, method="GET"), timeout=20)
        return "zoom.us" in str(r.headers.get("Location") or "")
    except urllib.error.HTTPError as e:
        return 300 <= e.code < 400 and "zoom.us" in str(e.headers.get("Location") or "")
    except (urllib.error.URLError, TimeoutError, OSError):
        return None


def pull_zoom(sb: Supabase, zoom: Zoom, again: bool = False) -> dict:
    pulled = iso(utcnow())
    try:
        meeting = zoom.meeting()
    except Failure as e:
        # A meeting that ended long ago can expire or be deleted in Zoom while
        # its past sessions and recordings stay readable.
        if "3001" not in str(e):
            raise
        note(f"meeting {MEETING_ID} no longer exists in Zoom; reading its past sessions only")
        meeting = {}
    live = str(meeting.get("status") or "") == "started"
    registration = (meeting.get("settings") or {}).get("approval_type") in (0, 1)
    registrants = zoom.registrants() if registration else {}

    known = {r["uuid"]: r for r in sb.req(
        "GET", "cockpit_webinar_sessions?select=uuid,complete,started_at,pitch1_at")}
    since = max(dt.date.fromisoformat(SINCE), utcnow().date() - dt.timedelta(days=LOOK_BACK_DAYS))
    found: dict[str, dict] = {}
    for m in zoom.recordings(str(meeting.get("host_id") or ""), since):
        found[str(m["uuid"])] = {"start": m.get("start_time"), "duration": m.get("duration"),
                                 "topic": m.get("topic"), "recording": m}
    for m in zoom.instances():
        found.setdefault(str(m["uuid"]), {"start": m.get("start_time")})
    for uuid, row in known.items():
        if not row.get("complete"):
            found.setdefault(uuid, {"start": row.get("started_at")})

    counts = {"sessions": 0, "attendance_rows": 0, "chat_rows": 0, "poll_rows": 0, "qa_rows": 0,
              "registration": registration, "join_link_ok": join_link_ok(), "live": live,
              "polls_readable": bool(zoom.app and zoom.app.can("meeting:read:list_poll_results"))}
    problems: list[str] = []
    newest = max((parse_ts(s["start"]) for s in found.values() if parse_ts(s["start"])), default=None)
    for uuid, s in sorted(found.items(), key=lambda kv: str(kv[1].get("start") or "")):
        if known.get(uuid, {}).get("complete") and not again:
            continue
        start = parse_ts(s.get("start"))
        if live and start and newest and start >= newest:
            note(f"session {uuid} is live now; read it after it ends")
            continue
        details = zoom.details(uuid)
        start = parse_ts(details.get("start_time")) or start
        if not start:
            continue
        people = zoom.participants(uuid)
        att = attendance_rows(uuid, people, registrants, pulled)
        leaves = [parse_ts(r["leave_at"]) for r in att if r["leave_at"]]
        duration = details.get("duration") or s.get("duration")
        ended = (parse_ts(details.get("end_time"))
                 or (max(leaves) if leaves else None)
                 or (start + dt.timedelta(minutes=int(duration)) if duration else None))

        # Attendance is saved even when the recording, the chat or the polls
        # cannot be read this run; the session stays incomplete and is read
        # again next run.
        rec = s.get("recording") or {}
        files = rec.get("recording_files") or []
        chat: list[dict] = []
        rec_state = "none"
        try:
            full = zoom.recording(uuid)
            if full:
                files = full.get("recording_files") or files
                token = str(full.get("download_access_token") or "")
                rec_state = "ready" if files and all(
                    str(f.get("status") or "completed") == "completed" for f in files) else "processing"
                for f in files:
                    if (f.get("file_type") == "CHAT" and f.get("download_url")
                            and str(f.get("status") or "completed") == "completed"):
                        base = parse_ts(f.get("recording_start")) or start
                        chat = chat_rows(uuid, base, parse_chat(zoom.download(str(f["download_url"]), token)),
                                         name_keys(att), pulled)
        except Failure as e:
            rec_state = "error"
            problems.append(f"chat of {start:%Y-%m-%d}: {e}")
        poll_rows: list[dict] = []
        qa_rows: list[dict] = []
        try:
            polls = zoom.polls(uuid)
            poll_rows = answer_rows(uuid, polls, "poll", start, pulled) if polls else []
            qa = zoom.qa(uuid)
            qa_rows = answer_rows(uuid, qa, "qa", start, pulled) if qa else []
        except Failure as e:
            problems.append(f"polls of {start:%Y-%m-%d}: {e}")

        age_h = (utcnow() - ended).total_seconds() / 3600 if ended else 0
        chat_done = rec_state == "ready" or (rec_state == "none" and age_h > 6) or age_h > 48
        if rec_state == "error":
            chat_done = age_h > 48
        complete = bool(ended) and age_h > 0.5 and chat_done

        sb.upsert("cockpit_webinar_sessions", [{
            "uuid": uuid,
            "meeting_id": MEETING_ID,
            "topic": s.get("topic") or meeting.get("topic"),
            "started_at": iso(start),
            "ended_at": iso(ended),
            "duration_min": int(duration) if duration else None,
            "host_email": details.get("host_email") or meeting.get("host_email"),
            "recording_files": sorted({str(f.get("file_type")) for f in files if f.get("file_type")}),
            "participant_rows": len(att),
            "chat_rows": len(chat),
            "poll_rows": len(poll_rows),
            "complete": complete,
            "pulled_at": pulled,
        }], "uuid")
        sb.upsert("cockpit_webinar_attendance", att, "session_uuid,row_key")
        sb.upsert("cockpit_webinar_engagement", chat + poll_rows + qa_rows, "kind,row_key")
        counts["sessions"] += 1
        counts["attendance_rows"] += len(att)
        counts["chat_rows"] += len(chat)
        counts["poll_rows"] += len(poll_rows)
        counts["qa_rows"] += len(qa_rows)
        note(f"session {start:%Y-%m-%d %H:%M} UTC: {len(att)} join rows, {len(chat)} chat lines, "
             f"{len(poll_rows)} poll answers, recording {rec_state}, {'complete' if complete else 'read again next run'}")
    if problems:
        counts["problems"] = problems[:10]
    return counts


def pull_survey(sb: Supabase, composio: Composio) -> dict:
    pulled = iso(utcnow())
    last = sb.req("GET", "cockpit_webinar_forms?select=submitted_at&order=submitted_at.desc&limit=1")
    since = None
    if last:
        t = parse_ts(last[0]["submitted_at"])
        since = iso(t - dt.timedelta(days=2)) if t else None
    rows: list[dict] = []
    before = ""
    for _ in range(50):
        args: dict[str, Any] = {"form_id": SURVEY_ID, "page_size": 1000}
        if since:
            args["since"] = since.replace("+00:00", "Z")
        if before:
            args["before"] = before
        page = composio.run("TYPEFORM_GET_FORM_RESPONSES", args)
        items = [i for i in page.get("items") or [] if isinstance(i, dict)]
        rows.extend(r for r in (survey_row(i, pulled) for i in items) if r)
        if len(items) < 1000:
            break
        before = str(items[-1].get("token") or "")
        if not before:
            break
    sb.upsert("cockpit_webinar_forms", rows, "response_id")
    note(f"survey {SURVEY_ID}: {len(rows)} responses read{' since ' + since if since else ''}")
    return {"responses": len(rows), "since": since}


# --- Doctor ------------------------------------------------------------------------

def doctor() -> int:
    blockers, warnings = [], []

    def line(ok: Optional[bool], what: str, detail: str = "") -> None:
        mark = {True: "ok  ", False: "FAIL", None: "warn"}[ok]
        print(f"  {mark} {what}{': ' + detail if detail else ''}")

    print("keys (by name; values never shown)")
    for name in ("COMPOSIO_API_KEY", "DESK_SUPABASE_URL", "DESK_SUPABASE_KEY",
                 "ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"):
        print(f"  {'set ' if os.environ.get(name, '').strip() else 'none'} {name}")

    print("Creative Triage")
    try:
        sb = Supabase.from_env()
        for t in TABLES:
            sb.req("GET", f"{t}?select=*&limit=1")
        line(True, "the five webinar tables answer")
    except Failure as e:
        blockers.append(str(e))
        line(False, "tables", str(e))

    key = os.environ.get("COMPOSIO_API_KEY", "").strip()
    composio = Composio(key) if key else None
    app = ZoomApp.from_env()
    zoom = Zoom(composio, app)

    print("Zoom")
    if not composio and not app:
        blockers.append("no Zoom door: neither COMPOSIO_API_KEY nor the ZOOM_* app keys")
    try:
        m = zoom.meeting()
        s = m.get("settings") or {}
        line(True, f"meeting {MEETING_ID} via {', '.join(sorted(zoom.via))}",
             f"{m.get('topic')}, starts {m.get('start_time')}, status {m.get('status')}")
        if str(s.get("auto_recording") or "") != "cloud" and not app:
            warnings.append("cloud recording is off and the Zoom app keys are missing")
            line(None, "cloud recording is off",
                 "sessions are found through their recording; without it and without the Zoom app a session is missed")
        if s.get("approval_type") not in (0, 1):
            warnings.append("registration is off")
            line(None, "registration is off",
                 "guests join with a name only, so attendees are counted but cannot be matched to registrants")
    except Failure as e:
        blockers.append(str(e))
        line(False, "meeting", str(e))
    if app:
        try:
            app.bearer()
            for scope in ("meeting:read:list_past_instances", "meeting:read:list_poll_results",
                          "meeting:read:past_qa", "meeting:read:list_past_participants"):
                line(app.can(scope) or None, f"Zoom app scope {scope}")
        except Failure as e:
            warnings.append(str(e))
            line(None, "Zoom app", str(e))
    else:
        warnings.append("no Zoom app keys: polls, Q&A and the session list are not read")
        line(None, "Zoom app keys not set", "polls, Q&A and the session list are not read")

    print("Typeform")
    if composio:
        try:
            d = composio.run("TYPEFORM_GET_FORM_RESPONSES", {"form_id": SURVEY_ID, "page_size": 1})
            line(True, f"survey {SURVEY_ID}", f"{d.get('total_items', 0)} responses so far")
        except Failure as e:
            blockers.append(str(e))
            line(False, "survey", str(e))
    else:
        blockers.append("COMPOSIO_API_KEY is not set, so the survey cannot be read")

    print("join link")
    ok = join_link_ok()
    if ok is False:
        warnings.append(f"{JOIN_LINK} does not lead to Zoom")
    line(ok, JOIN_LINK, "leads to Zoom" if ok else "does not lead to Zoom: the reminders' link is broken"
         if ok is False else "could not be checked")

    print()
    if blockers:
        print("blocked: " + "; ".join(blockers))
        return 1
    print("ready" + (f", with {len(warnings)} warning(s)" if warnings else ""))
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    global QUIET
    ap = argparse.ArgumentParser(description="The live training's Zoom sessions and survey, into Creative Triage.")
    ap.add_argument("command", nargs="?", default="pull", choices=("pull", "zoom", "survey", "doctor"))
    ap.add_argument("--again", action="store_true", help="read finished sessions again")
    ap.add_argument("--dry-run", action="store_true", help="read everything, write nothing")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    QUIET = a.quiet
    if a.command == "doctor":
        return doctor()

    try:
        sb = Supabase.from_env(dry=a.dry_run)
    except Failure as e:
        note(str(e))
        return 1
    key = os.environ.get("COMPOSIO_API_KEY", "").strip()
    composio = Composio(key) if key else None
    failed = False
    if a.command in ("pull", "zoom"):
        zoom = Zoom(composio, ZoomApp.from_env())
        run = sb.begin("zoom")
        try:
            counts = pull_zoom(sb, zoom, again=a.again)
            sb.finish(run, True, "+".join(sorted(zoom.via)), "", counts)
        except Failure as e:
            failed = True
            note(f"zoom: {e}")
            sb.finish(run, False, "+".join(sorted(zoom.via)), str(e), {})
    if a.command in ("pull", "survey"):
        run = sb.begin("typeform")
        try:
            if not composio:
                raise Failure("COMPOSIO_API_KEY is not set, so the survey cannot be read")
            counts = pull_survey(sb, composio)
            sb.finish(run, True, "composio", "", counts)
        except Failure as e:
            failed = True
            note(f"survey: {e}")
            sb.finish(run, False, "composio", str(e), {})
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
