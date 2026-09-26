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

Since the same day ("the scripts that you can do now, do it"), two more:

* Reminders: every message HighLevel sent a registrant after they
  registered (WhatsApp, SMS, email) with its status, matched to the WEBBY
  template it came from, through HighLevel's conversations API with the
  webinar sub-account's key (GHL_B2B_API_KEY). Every six hours, hourly
  from a day and a half before a session. No message text is stored.
* Objections: a registrant's sales calls in Fathom (FATHOM_API_KEY), each
  tagged once by deepseek-flash into a fixed set of categories with the
  prospect's own words, as the brief asks ("tagged from the Fathom
  transcript, not from the closer's notes"). At most 8 new calls a run.

    python3 pull.py doctor      every key by name, each door, the join link
    python3 pull.py             everything (what cron runs)
    python3 pull.py zoom        Zoom only; --again reads finished sessions again
    python3 pull.py survey      the survey only
    python3 pull.py reminders   the reminder messages, due or not
    python3 pull.py objections  tag the registrants' new sales calls
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

# HighLevel, the webinar's sub-account. It sits behind Cloudflare, which
# refuses Python's default user agent (error 1010), so every call sends a
# browser's.
GHL_API = "https://services.leadconnectorhq.com"
GHL_LOCATION = os.environ.get("GHL_B2B_SUB_ACCOUNT_ID", "7NI8yyJtwsh2OOWA5Icr")
BROWSER_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
REGISTERED_TAG = "webby-registered"
# The contact field "Webinar Datetime" (webinarSql.ts SESSION_FIELD).
SESSION_FIELD = "x7aG8iLqmTzQEr6SGCaH"
CHANNEL = {"TYPE_WHATSAPP": "whatsapp", "TYPE_SMS": "sms", "TYPE_EMAIL": "email"}
# The WEBBY WhatsApp templates (ghl-workflow-builder phase E), each known by
# words that follow the greeting. SMS fallbacks carry the same text.
STEPS = (
    ("webby_01_registered_question", "وصلني تسجيلك بالتدريب"),
    ("webby_02_survey_gift", "طلعت لك صفحة فيها كم سؤال"),
    ("webby_03_calendar_nudge", "حط التدريب بتقويم"),
    ("webby_04_tomorrow", "باجر موعدنا"),
    ("webby_05_one_hour", "بعد ساعة نبدأ"),
    ("webby_06_fifteen_min", "أنا داش القاعة"),
    ("webby_07_five_min", "بنبدي بعد ٥ دقايق"),
    ("webby_08_started", "بدينا قبل شوي"),
    ("webby_09_last_call", "توني بديت بالخطوة الأولى"),
    ("webby_10_attended_book", "توني خلصت وقاعد أرسل للي حضروا"),
    ("webby_11_attended_question", "عقب تدريب أمس"),
    ("webby_12_noshow_vsl", "ما شفتك اليوم بالتدريب"),
    ("webby_13_noshow_last", "آخر رسالة مني عن هالموضوع"),
    ("webby_14_gift_delivery", "وصلتني إجاباتك"),
)
REMINDER_HOURS = 6

FATHOM_API = "https://api.fathom.ai/external/v1"
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
OBJECTIONS_MODEL = os.environ.get("WEBINAR_OBJECTIONS_MODEL", "deepseek-flash")
OBJECTIONS_PER_RUN = int(os.environ.get("WEBINAR_OBJECTIONS_PER_RUN", "8"))
# The categories, fixed so rounds can be compared. The cockpit shows the
# same words (convex/ceo/adapters/webinar.ts OBJECTION_NAMES).
CATEGORIES = {
    "price": "the fee or their budget",
    "timing": "not now: busy, after a season, later",
    "proof": "doubts it works for them; wants results, guarantees or examples",
    "capacity": "cannot take more projects, or lacks the team",
    "decision_maker": "a partner, owner or family member has to decide",
    "past_agency": "burned by an agency or by marketing before",
    "has_leads": "enough work already from referrals or their own marketing",
    "market": "the market or the economy is slow",
    "terms": "contract length, commitment or payment terms",
    "fit": "the offer does not fit their kind or size of work",
    "other": "anything else",
}
HANDLED = {"handled", "partly", "not"}
OBJECTION_PROMPT = (
    "You read the transcript of a sales call between Mahara Media, a marketing "
    "agency that brings construction, interior design and contracting firms in "
    "the Gulf booked calls with project owners, and a prospect who owns or runs "
    "such a firm. The transcript is mostly Gulf Arabic, with some English.\n\n"
    "List every objection the PROSPECT raised (not the Mahara rep). Put each "
    "in exactly one of these categories:\n"
    + "\n".join(f"- {k}: {v}" for k, v in CATEGORIES.items())
    + "\n\nFor each objection give the prospect's own words, at most 20 words, "
    "copied from the transcript in its language; and whether the rep answered "
    "it: handled (the prospect accepted the answer), partly, or not.\n\n"
    'Answer with one JSON object: {"objections": [{"category": "...", "quote": '
    '"...", "handled": "handled|partly|not"}], "summary": "one plain English '
    'sentence on where the call ended"}. If the prospect raised no objection, '
    "objections is an empty list. Do not invent objections."
)

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
         timeout: int = 90, retry_safe: bool = False) -> tuple[int, dict, bytes]:
    """Bounded retries for reads or explicitly idempotent operations. Never echo tokens."""
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    attempts = 3 if method == "GET" or retry_safe else 1
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                result = (r.status, dict(r.headers), r.read())
        except urllib.error.HTTPError as e:
            result = (e.code, dict(e.headers or {}), e.read() or b"")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
                continue
            host = urllib.parse.urlsplit(url).netloc
            raise Failure(f"{host} could not be reached ({type(e).__name__})")
        if result[0] not in (429, 500, 502, 503, 504) or attempt + 1 == attempts:
            return result
        retry_after = next((v for k, v in result[1].items() if k.lower() == 'retry-after'), '')
        delay = min(30, int(retry_after)) if str(retry_after).isdigit() else 2 ** attempt
        time.sleep(delay)
    raise Failure("HTTP retry budget exhausted")


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
        }, timeout=180, retry_safe=slug.startswith(("ZOOM_GET_", "TYPEFORM_GET_")))
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
            seen_tokens: set[str] = set()
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
                if token in seen_tokens:
                    raise Failure("Zoom recording cursor repeated")
                seen_tokens.add(token)
            else:
                raise Failure("Zoom recording pagination limit reached")
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
        seen_tokens: set[str] = set()
        expected = None
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
            if expected is None and isinstance(page.get("total_records"), int):
                expected = page["total_records"]
            if not isinstance(page.get("participants"), list):
                raise Failure("Zoom participant page has no list")
            rows.extend(p for p in page["participants"] if isinstance(p, dict))
            token = str(page.get("next_page_token") or "")
            if not token:
                if expected is not None and len(rows) != expected:
                    raise Failure("Zoom participant source count does not reconcile")
                return rows
            if token in seen_tokens:
                raise Failure("Zoom participant cursor repeated")
            seen_tokens.add(token)
        raise Failure("Zoom participant pagination limit reached")

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
            raise  # Unreadable Q&A is not evidence of zero questions.

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
                raise
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
                return out
        raise Failure("Zoom registrant pagination limit reached")


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
    if p.get("user_id"):
        return f"guest:{p.get('_session', '')}:{p['user_id']}"
    return f"unknown:{p.get('_session', '')}:{p.get('_row', '')}"


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
            uuid, p.get("user_id"), p.get("id"), p.get("join_time"), "" if (p.get("user_id") or p.get("id")) else p.get("name"), p.get("status")))
        rows.append({
            "session_uuid": uuid,
            "row_key": hashlib.sha1(key_src.encode()).hexdigest()[:24],
            "person_key": person_key({**p, "user_email": email, "_session": uuid, "_row": hashlib.sha1(key_src.encode()).hexdigest()[:24]}),
            "name": (str(p.get("name")).strip() or None) if p.get("name") else None,
            "email": email,
            "registrant_id": str(p["registrant_id"]) if p.get("registrant_id") else None,
            "participant_id": str(p["id"]) if p.get("id") else None,
            "zoom_user_id": str(p["user_id"]) if p.get("user_id") else None,
            "contact_id": reg.get("contact_id"),
            "status": str(p.get("status") or "in_meeting"),
            "internal": p.get("internal_user") is True or bool(email and email.endswith(OUR_DOMAIN)),
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
    """Only an unambiguous name may associate chat with a known session identity."""
    candidates: dict[str, set[str]] = {}
    for r in rows:
        n = norm_name(r.get("name"))
        if n:
            candidates.setdefault(n, set()).add(r["person_key"])
    return {n: next(iter(keys)) for n, keys in candidates.items() if len(keys) == 1}


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
            "person_key": keys.get(n),
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
                "person_key": f"email:{email}" if email else None,
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


# --- HighLevel, Fathom, DeepSeek -----------------------------------------------

class GHL:
    """HighLevel's API for the webinar's sub-account."""

    def __init__(self, key: str, location: str = GHL_LOCATION):
        self.key, self.location = key, location
        self.calls = 0

    @classmethod
    def from_env(cls) -> Optional["GHL"]:
        key = os.environ.get("GHL_B2B_API_KEY", "").strip()
        return cls(key) if key else None

    def req(self, method: str, path: str, body: Any = None, version: str = "2021-07-28",
            params: Optional[dict] = None) -> dict:
        q = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v not in (None, "")})
        url = f"{GHL_API}{path}{'?' + q if q else ''}"
        headers = {"Authorization": f"Bearer {self.key}", "Version": version,
                   "Accept": "application/json", "User-Agent": BROWSER_UA}
        if body is not None:
            headers["Content-Type"] = "application/json"
        for attempt in range(3):
            # HighLevel allows 100 calls in 10 seconds per sub-account.
            time.sleep(0.15)
            self.calls += 1
            status, _h, content = call(method, url, headers, body, timeout=60)
            if status == 429 and attempt < 2:
                time.sleep(10)
                continue
            if status >= 300:
                raise Failure(f"HighLevel {status} on {path}: {content[:160].decode('utf-8', 'replace')}")
            return json.loads(content) if content.strip() else {}
        raise Failure(f"HighLevel kept answering 429 on {path}")

    def registrants(self) -> list[dict]:
        """Every contact the WEBBY W1 workflow tagged as registered."""
        out: list[dict] = []
        for page in range(1, 101):
            d = self.req("POST", "/contacts/search", {
                "locationId": self.location, "page": page, "pageLimit": 100,
                "filters": [{"field": "tags", "operator": "contains", "value": REGISTERED_TAG}],
            })
            if not isinstance(d.get("contacts"), list):
                raise Failure("HighLevel registrant page has no contacts list")
            batch = [c for c in d["contacts"] if isinstance(c, dict)]
            out.extend(batch)
            if len(batch) < 100:
                if isinstance(d.get("total"), int) and len(out) != d["total"]:
                    raise Failure("HighLevel registrant count does not reconcile")
                if len({r.get("id") for r in out}) != len(out):
                    raise Failure("HighLevel repeated registrant rows")
                return out
        raise Failure("HighLevel registrant pagination limit reached")

    def messages(self, contact_id: str) -> list[dict]:
        """Every message in a contact's conversations, newest first."""
        convs = self.req("GET", "/conversations/search", version="2021-04-15",
                         params={"locationId": self.location, "contactId": contact_id, "limit": 20})
        if len(convs.get("conversations") or []) >= 20:
            raise Failure("HighLevel conversation search may be capped")
        out: list[dict] = []
        for c in convs.get("conversations") or []:
            last = ""
            seen_cursors: set[str] = set()
            for _ in range(20):
                d = self.req("GET", f"/conversations/{c['id']}/messages", version="2021-04-15",
                             params={"limit": 100, "lastMessageId": last})
                box = d.get("messages") or {}
                page = [m for m in box.get("messages") or [] if isinstance(m, dict)]
                out.extend(page)
                last = str(box.get("lastMessageId") or (page[-1].get("id") if page else ""))
                if not box.get("nextPage"):
                    break
                if not page or not last or last in seen_cursors:
                    raise Failure("HighLevel message cursor is missing or repeated")
                seen_cursors.add(last)
            else:
                raise Failure("HighLevel message pagination limit reached")
        return out


class Fathom:
    def __init__(self, key: str):
        self.key = key

    @classmethod
    def from_env(cls) -> Optional["Fathom"]:
        key = os.environ.get("FATHOM_API_KEY", "").strip()
        return cls(key) if key else None

    def get(self, path: str, **params: Any) -> dict:
        q = urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, "")})
        status, _h, content = call("GET", f"{FATHOM_API}{path}{'?' + q if q else ''}",
                                   {"X-Api-Key": self.key, "Accept": "application/json",
                                    "User-Agent": BROWSER_UA}, timeout=90)
        if status >= 300:
            raise Failure(f"Fathom {status} on {path}: {content[:160].decode('utf-8', 'replace')}")
        return json.loads(content)

    def meetings(self, since: dt.datetime) -> list[dict]:
        """Recorded calls created since a time, without transcripts (light)."""
        out: list[dict] = []
        cursor = ""
        for _ in range(60):
            d = self.get("/meetings", created_after=iso(since).replace("+00:00", "Z"), cursor=cursor)
            out.extend(m for m in d.get("items") or [] if isinstance(m, dict))
            cursor = str(d.get("next_cursor") or "")
            if not cursor:
                break
        return out

    def transcript(self, recording_id: Any) -> list[dict]:
        return [t for t in self.get(f"/recordings/{recording_id}/transcript").get("transcript") or []
                if isinstance(t, dict)]


class DeepSeek:
    def __init__(self, key: str):
        self.key = key

    @classmethod
    def from_env(cls) -> Optional["DeepSeek"]:
        key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
        # SALES_COCKPIT_PLAN.md: no lead data to DeepSeek. Explicit webinar
        # approval is required before this transcript-only route can resume.
        approved = os.environ.get("WEBINAR_DEEPSEEK_TRANSCRIPTS_APPROVED") == "true"
        return cls(key) if key and approved else None

    def json(self, system: str, user: str) -> dict:
        # deepseek-flash is a reasoning model: reasoning tokens are spent
        # first and count against max_tokens, and the answer is in content.
        # A long transcript can use the whole budget thinking, so a run that
        # ends without an answer goes again once with twice the budget.
        last = ""
        for budget in (12000, 24000):
            status, _h, content = call("POST", DEEPSEEK_URL, {
                "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}, {
                "model": OBJECTIONS_MODEL,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "response_format": {"type": "json_object"},
                "max_tokens": budget,
                "temperature": 0,
            }, timeout=420)
            if status >= 300:
                raise Failure(f"DeepSeek {status}: {content[:160].decode('utf-8', 'replace')}")
            d = json.loads(content)
            choice = (d.get("choices") or [{}])[0]
            msg = choice.get("message") or {}
            for text in (str(msg.get("content") or ""), str(msg.get("reasoning_content") or "")):
                found = _last_json(text)
                if found is not None:
                    return found
            last = f"finish_reason {choice.get('finish_reason')}, {len(str(msg.get('content') or ''))} characters"
        raise Failure(f"DeepSeek gave no JSON ({last})")


def _last_json(text: str) -> Optional[dict]:
    """The JSON object in a model's text: the whole of it, else the last
    balanced {...} that parses."""
    text = text.strip()
    if not text:
        return None
    try:
        out = json.loads(text)
        return out if isinstance(out, dict) else None
    except ValueError:
        pass
    ends = [i for i, ch in enumerate(text) if ch == "}"]
    for end in reversed(ends):
        depth = 0
        for start in range(end, -1, -1):
            if text[start] == "}":
                depth += 1
            elif text[start] == "{":
                depth -= 1
                if depth == 0:
                    try:
                        out = json.loads(text[start:end + 1])
                        if isinstance(out, dict) and "objections" in out:
                            return out
                    except ValueError:
                        pass
                    break
    return None


# Client-service calls in Fathom (launch, check-in, onboarding, renewals) and
# team meetings are not sales calls; their "objections" are not the funnel's.
NOT_SALES = re.compile(r"launch|check.?in|onboarding|kick.?off|renewal|review|wrap|pulse|1:1|"
                       r"whole team|fulfil|call cent", re.I)


# Shared policy with convex/ceo/webinarSql.ts; readiness reports a mismatch.
SESSION_HOUR_KUWAIT = 20
KUWAIT = dt.timezone(dt.timedelta(hours=3))


def session_value(value: Any) -> Optional[dt.datetime]:
    """DATE/midnight epochs use the training schedule; explicit ISO retains time."""
    v = str(value if value is not None else "").strip()
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            day = dt.date.fromisoformat(v)
        elif re.fullmatch(r"\d{10}(\d{3})?", v):
            epoch = dt.datetime.fromtimestamp(int(v) / (1000 if len(v) == 13 else 1), dt.timezone.utc)
            if epoch.time() == dt.time(0):
                day = epoch.date()
            elif epoch.astimezone(KUWAIT).time() == dt.time(0):
                day = epoch.astimezone(KUWAIT).date()
            else:
                return epoch
        elif re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:\d{2})", v):
            return parse_ts(v)
        else:
            return None
        return dt.datetime.combine(day, dt.time(SESSION_HOUR_KUWAIT), KUWAIT).astimezone(dt.timezone.utc)
    except (ValueError, OverflowError, OSError):
        return None


def session_of(contact: dict) -> Optional[dt.datetime]:
    for cf in contact.get("customFields") or []:
        if isinstance(cf, dict) and cf.get("id") == SESSION_FIELD:
            return session_value(cf.get("value") if cf.get("value") is not None else cf.get("fieldValue"))
    return None


def registered_from(contact: dict) -> Optional[dt.datetime]:
    """When a contact's webinar story starts, as in webinarSql.ts webbyFrom:
    their creation, or three weeks before their session when older."""
    added = parse_ts(contact.get("dateAdded"))
    session = session_of(contact)
    if added and session:
        return max(added, session - dt.timedelta(days=21))
    return added or (session - dt.timedelta(days=21) if session else None)


def step_of(body: Any) -> Optional[str]:
    text = re.sub(r"\s+", " ", str(body or ""))
    for key, words in STEPS:
        if words in text:
            return key
    return None


def message_rows(contact_id: str, msgs: list[dict], since: Optional[dt.datetime],
                 pulled: str) -> list[dict]:
    """Outbound messages since registering; calls and notes are not messages."""
    rows = []
    for m in msgs:
        if m.get("direction") != "outbound" or not m.get("id"):
            continue
        channel = CHANNEL.get(str(m.get("messageType") or ""))
        at = parse_ts(m.get("dateAdded"))
        if not channel or not at or (since and at < since - dt.timedelta(hours=1)):
            continue
        rows.append({
            "message_id": str(m["id"]),
            "contact_id": contact_id,
            "channel": channel,
            "direction": "outbound",
            "status": str(m["status"]).lower() if m.get("status") not in (None, "") else None,
            "source": str(m["source"]) if m.get("source") else None,
            "step": step_of(m.get("body")),
            "sent_at": iso(at),
            "updated_at": iso(parse_ts(m.get("dateUpdated"))),
            "pulled_at": pulled,
        })
    return rows


def transcript_text(items: list[dict], limit: int = 60000) -> str:
    lines = []
    for t in items:
        who = ((t.get("speaker") or {}).get("display_name") or "Speaker") if isinstance(t.get("speaker"), dict) else "Speaker"
        text = str(t.get("text") or "").strip()
        if text:
            lines.append(f"[{t.get('timestamp') or ''}] {who}: {text}")
    out = "\n".join(lines)
    return out[:limit]


def objection_row(meeting: dict, contact: dict, email: str, answer: dict, pulled: str) -> dict:
    """The model's answer, checked: known categories only, short quotes."""
    found = []
    for o in answer.get("objections") or []:
        if not isinstance(o, dict):
            continue
        cat = str(o.get("category") or "").strip().lower()
        cat = cat if cat in CATEGORIES else "other"
        handled = str(o.get("handled") or "").strip().lower()
        found.append({
            "category": cat,
            "quote": str(o.get("quote") or "").strip()[:240] or None,
            "handled": handled if handled in HANDLED else None,
        })
    start = parse_ts(meeting.get("recording_start_time"))
    end = parse_ts(meeting.get("recording_end_time"))
    return {
        "call_id": str(meeting.get("recording_id")),
        "contact_id": str(contact.get("id") or "") or None,
        "email": email,
        "call_at": iso(start),
        "title": str(meeting.get("title") or meeting.get("meeting_title") or "")[:200] or None,
        "duration_s": int((end - start).total_seconds()) if start and end else None,
        "categories": sorted({o["category"] for o in found}),
        "objections": found,
        "summary": str(answer.get("summary") or "").strip()[:400] or None,
        "model": OBJECTIONS_MODEL,
        "tagged_at": pulled,
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
        status, _h, content = call(method, f"{self.url}/rest/v1/{path}", headers, body, retry_safe=path == "rpc/cockpit_ingest_webinar_snapshot" or "on_conflict=" in path)
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
    """Does the reminders' join link lead to Zoom? Either a redirect to it, or
    the site's /live page, which records the click and then opens the
    meeting (sites/webinar/live.html). None when it cannot be checked."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):  # noqa: D401
            return None
    opener = urllib.request.build_opener(NoRedirect)
    try:
        r = opener.open(urllib.request.Request(JOIN_LINK, method="GET",
                                               headers={"User-Agent": BROWSER_UA}), timeout=20)
        if "zoom.us" in str(r.headers.get("Location") or ""):
            return True
        page = r.read(20000).decode("utf-8", "replace")
        return bool(re.search(r"location\.replace\(\s*[\"']https://[a-z0-9.]*zoom\.us/j/", page))
    except urllib.error.HTTPError as e:
        return 300 <= e.code < 400 and "zoom.us" in str(e.headers.get("Location") or "")
    except (urllib.error.URLError, TimeoutError, OSError):
        return None


WEBBY_API_HEALTH = "https://webby-live-training.vercel.app/api/health"
WEBBY_PAGE = "https://webinar.maharamedia.com/"
WORKFLOW_STEPS = ("W1", "W2", "W4a", "W4b", "W5", "W6")


def workflow_states(rows: Any) -> dict:
    """Only the six WEBBY workflow states; no bodies, contacts or credentials."""
    if not isinstance(rows, list):
        return {}
    result = {}
    for step in WORKFLOW_STEPS:
        found = [w for w in rows if isinstance(w, dict)
                 and re.search(r"\bWEBBY\b", str(w.get("name") or ""), re.I)
                 and re.search(r"\b" + step + r"\b", str(w.get("name") or ""), re.I)]
        # Duplicate names are ambiguous, never a successful check.
        result[step] = (str(found[0].get("status") or "").lower()
                        if len(found) == 1 else "missing" if not found else "ambiguous")
    return result


def launch_snapshot(meeting: dict, join_ok: Optional[bool]) -> dict:
    """Read-only setup evidence. Store only allowlisted booleans/dates/states.
    A failed check cannot stop collection or expose its provider error body.
    """
    settings = meeting.get("settings") or {}
    start = parse_ts(meeting.get("start_time"))
    snapshot = {"checked_at": iso(utcnow()), "join_link_ok": join_ok,
                "zoom": {"start": iso(start) if start else None,
                         "registration": settings.get("approval_type") in (0, 1) if "approval_type" in settings else None,
                         "cloud_recording": settings.get("auto_recording") == "cloud" if "auto_recording" in settings else None},
                "api": {}, "page": {}, "workflows": {}}
    try:
        status, _h, body = call("GET", WEBBY_API_HEALTH, {"User-Agent": BROWSER_UA}, timeout=20)
        if status == 200:
            health = json.loads(body)
            at = parse_ts(health.get("webinarStart"))
            token = health.get("ghlTokenSet")
            snapshot["api"] = {"start": iso(at) if at else None,
                               "ghl_token_set": token if isinstance(token, bool) else None}
    except (Failure, ValueError, TypeError, AttributeError):
        pass
    try:
        status, _h, body = call("GET", WEBBY_PAGE, {"User-Agent": BROWSER_UA}, timeout=20)
        if status == 200:
            match = re.search(r"COUNTDOWN_ISO\s*=\s*['\"]([^'\"]+)['\"]", body.decode("utf-8", "replace"))
            at = parse_ts(match[1]) if match else None
            snapshot["page"] = {"start": iso(at) if at else None}
    except (Failure, ValueError, TypeError):
        pass
    try:
        ghl = GHL.from_env()
        if ghl:
            data = ghl.req("GET", "/workflows/", params={"locationId": ghl.location})
            snapshot["workflows"] = workflow_states(data.get("workflows"))
    except (Failure, ValueError, TypeError, AttributeError):
        pass
    return snapshot


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
        if again or not row.get("complete") or (parse_ts(row.get("started_at")) and parse_ts(row["started_at"]) > utcnow() - dt.timedelta(days=7)):
            found.setdefault(uuid, {"start": row.get("started_at")})

    counts = {"sessions": 0, "attendance_rows": 0, "chat_rows": 0, "poll_rows": 0, "qa_rows": 0,
              "registration": registration, "join_link_ok": join_link_ok(), "live": live,
              "polls_readable": bool(zoom.app and zoom.app.can("meeting:read:list_poll_results"))}
    counts["launch"] = launch_snapshot(meeting, counts["join_link_ok"])
    problems: list[str] = []
    newest = max((parse_ts(s["start"]) for s in found.values() if parse_ts(s["start"])), default=None)
    for uuid, s in sorted(found.items(), key=lambda kv: str(kv[1].get("start") or "")):
        previous = known.get(uuid, {})
        if previous.get("complete") and not again and (parse_ts(previous.get("started_at")) or utcnow()) < utcnow() - dt.timedelta(days=7):
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
        # The last guest leaving or a recording ending is not the meeting's
        # verified end. Keep it unknown until Zoom's instance details supply it.
        ended = parse_ts(details.get("end_time"))

        # Attendance is saved even when the recording, the chat or the polls
        # cannot be read this run; the session stays incomplete and is read
        # again next run.
        rec = s.get("recording") or {}
        files = rec.get("recording_files") or []
        chat: list[dict] = []
        rec_state = "none"
        coverage = {"attendance": "complete", "chat": "pending", "poll": "unavailable", "qa": "unavailable"}
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
                        coverage["chat"] = "complete"
                        chat += chat_rows(uuid, base, parse_chat(zoom.download(str(f["download_url"]), token)),
                                         name_keys(att), pulled)
        except Failure as e:
            rec_state = "error"
            coverage["chat"] = "error"
            problems.append(f"chat of {start:%Y-%m-%d}: {e}")
        channels: dict[str, list[dict]] = {"poll": [], "qa": []}
        for kind, read in (("poll", zoom.polls), ("qa", zoom.qa)):
            try:
                result = read(uuid)
                coverage[kind] = "complete" if result is not None else "unavailable"
                channels[kind] = answer_rows(uuid, result, kind, start, pulled) if result else []
            except Failure as e:
                coverage[kind] = "error"
                problems.append(f"{kind} of {start:%Y-%m-%d}: {e}")
        poll_rows, qa_rows = channels["poll"], channels["qa"]
        age_h = (utcnow() - ended).total_seconds() / 3600 if ended else 0
        if coverage["chat"] == "pending" and age_h > 48:
            coverage["chat"] = "unavailable"
        if len(att) != len(people):
            raise Failure("Zoom rows with missing join time require review; snapshot was not replaced")
        complete = bool(ended) and age_h > 0.5 and all(v == "complete" for v in coverage.values())

        session_row = {
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
        }
        if not sb.dry:
            sb.req("POST", "rpc/cockpit_ingest_webinar_snapshot", {
                "p_session": session_row, "p_attendance": att,
                "p_engagement": chat + poll_rows + qa_rows, "p_coverage": coverage})
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


def pull_survey(sb: Supabase, composio: Composio, full: bool = False) -> dict:
    pulled = iso(utcnow())
    last = sb.req("GET", "cockpit_webinar_forms?select=submitted_at&order=submitted_at.desc&limit=1")
    since = None
    if last and not full:
        t = parse_ts(last[0]["submitted_at"])
        since = iso(t - dt.timedelta(days=2)) if t else None
    rows: list[dict] = []
    before = ""
    seen_cursors: set[str] = set()
    expected = None
    received = 0
    for _ in range(50):
        args: dict[str, Any] = {"form_id": SURVEY_ID, "page_size": 1000}
        if since:
            args["since"] = since.replace("+00:00", "Z")
        if before:
            args["before"] = before
        page = composio.run("TYPEFORM_GET_FORM_RESPONSES", args)
        if not isinstance(page.get("items"), list):
            raise Failure("Typeform response page has no items list")
        if expected is None and isinstance(page.get("total_items"), int):
            expected = page["total_items"]
        items = [i for i in page["items"] if isinstance(i, dict)]
        received += len(items)
        rows.extend(r for r in (survey_row(i, pulled) for i in items) if r)
        if len(items) < 1000:
            break
        before = str(items[-1].get("token") or "")
        if not before or before in seen_cursors:
            raise Failure("Typeform cursor is missing or repeated")
        seen_cursors.add(before)
    else:
        raise Failure("Typeform pagination limit reached; no watermark advanced")
    if expected is not None and received != expected:
        raise Failure("Typeform source count does not reconcile; no watermark advanced")
    if len({r["response_id"] for r in rows}) != len(rows):
        raise Failure("Typeform returned duplicate response pages")
    sb.upsert("cockpit_webinar_forms", rows, "response_id")
    note(f"survey {SURVEY_ID}: {len(rows)} responses read{' since ' + since if since else ''}")
    return {"responses": len(rows), "received": received, "source_total": expected,
            "since": since, "complete": True, "full_backfill": full}


def reminders_due(sb: Supabase, registrants: list[dict]) -> bool:
    """Every six hours; hourly from a day and a half before a session to
    six hours after it, when the reminders go out."""
    now = utcnow()
    for c in registrants:
        s = session_of(c)
        if s and s - dt.timedelta(hours=36) <= now <= s + dt.timedelta(hours=6):
            return True
    last = sb.req("GET", "cockpit_webinar_pulls?source=eq.reminders&ok=eq.true"
                         "&select=finished_at&order=finished_at.desc&limit=1")
    t = parse_ts(last[0]["finished_at"]) if last else None
    return not t or now - t > dt.timedelta(hours=REMINDER_HOURS)


def pull_reminders(sb: Supabase, ghl: GHL, registrants: list[dict]) -> dict:
    pulled = iso(utcnow())
    rows: list[dict] = []
    for c in registrants:
        cid = str(c.get("id") or "")
        if not cid:
            continue
        rows.extend(message_rows(cid, ghl.messages(cid), registered_from(c), pulled))
    sb.upsert("cockpit_webinar_messages", rows, "message_id")
    steps = collections.Counter(r["step"] for r in rows if r["step"])
    note(f"reminders: {len(rows)} messages to {len(registrants)} registrants, {len(steps)} WEBBY steps seen, "
         f"{ghl.calls} HighLevel calls")
    return {"registrants": len(registrants), "messages": len(rows), "steps": dict(steps),
            "calls": ghl.calls}


def pull_objections(sb: Supabase, fathom: Fathom, model: DeepSeek, registrants: list[dict]) -> dict:
    """Tag each registrant's new sales calls once. A call is theirs when an
    invitee's email is the registrant's and it was recorded after they
    registered."""
    pulled = iso(utcnow())
    by_email: dict[str, tuple[dict, Optional[dt.datetime]]] = {}
    for c in registrants:
        start = registered_from(c)
        for e in [c.get("email"), *(c.get("additionalEmails") or [])]:
            e = str(e.get("email") if isinstance(e, dict) else e or "").strip().lower()
            if e:
                by_email[e] = (c, start)
    if not by_email:
        note("objections: no registrant has an email yet")
        return {"registrants": len(registrants), "matched": 0, "tagged": 0}
    since = min((s for _c, s in by_email.values() if s), default=utcnow() - dt.timedelta(days=60))
    done = {r["call_id"] for r in sb.req(
        "GET", f"cockpit_webinar_objections?select=call_id&call_at=gte.{iso(since - dt.timedelta(days=1))}")}
    matched: list[tuple[dict, dict, str]] = []
    for m in fathom.meetings(since - dt.timedelta(days=1)):
        if NOT_SALES.search(str(m.get("title") or m.get("meeting_title") or "")):
            continue
        start = parse_ts(m.get("recording_start_time"))
        for inv in m.get("calendar_invitees") or []:
            email = str((inv or {}).get("email") or "").strip().lower()
            hit = by_email.get(email)
            if hit and (not hit[1] or not start or start >= hit[1] - dt.timedelta(hours=1)):
                matched.append((m, hit[0], email))
                break
    todo = [x for x in matched if str(x[0].get("recording_id")) not in done]
    tagged = 0
    for m, contact, email in todo[:OBJECTIONS_PER_RUN]:
        text = transcript_text(fathom.transcript(m.get("recording_id")))
        if len(text) < 200:
            continue  # nothing said on the recording; try again when Fathom has it
        rep = ((m.get("recorded_by") or {}).get("name") or "the Mahara rep")
        answer = model.json(OBJECTION_PROMPT, f"The Mahara rep on this call is {rep}.\n\n{text}")
        sb.upsert("cockpit_webinar_objections", [objection_row(m, contact, email, answer, pulled)], "call_id")
        tagged += 1
    note(f"objections: {len(matched)} registrant calls in Fathom, {tagged} tagged now, "
         f"{max(0, len(todo) - tagged)} left for the next runs")
    return {"registrants": len(registrants), "matched": len(matched), "tagged": tagged,
            "left": max(0, len(todo) - tagged)}


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

    print("HighLevel, Fathom, DeepSeek")
    ghl = GHL.from_env()
    if ghl:
        try:
            d = ghl.req("POST", "/contacts/search", {"locationId": ghl.location, "pageLimit": 1,
                        "filters": [{"field": "tags", "operator": "contains", "value": REGISTERED_TAG}]})
            line(True, f"HighLevel {ghl.location}", f"{d.get('total', 0)} contacts tagged {REGISTERED_TAG}")
        except Failure as e:
            warnings.append(str(e))
            line(None, "HighLevel", str(e))
    else:
        warnings.append("GHL_B2B_API_KEY is not set: no reminder stats")
        line(None, "GHL_B2B_API_KEY not set", "no reminder stats")
    fathom = Fathom.from_env()
    if fathom:
        try:
            d = fathom.get("/meetings", created_after=iso(utcnow() - dt.timedelta(days=7)).replace("+00:00", "Z"))
            line(True, "Fathom", f"{len(d.get('items') or [])} calls recorded in the last week (first page)")
        except Failure as e:
            warnings.append(str(e))
            line(None, "Fathom", str(e))
    else:
        warnings.append("FATHOM_API_KEY is not set: no objection tags")
        line(None, "FATHOM_API_KEY not set", "no objection tags")
    line(True if DeepSeek.from_env() else None, f"Objection provider {OBJECTIONS_MODEL}",
         "explicitly enabled" if DeepSeek.from_env() else "paused: requires an approved transcript provider; a configured key alone does not permit sending lead data")

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
    ap.add_argument("command", nargs="?", default="pull",
                    choices=("pull", "zoom", "survey", "reminders", "objections", "doctor", "readiness"))
    ap.add_argument("--full-backfill", action="store_true", help="replay all Typeform response pages, ignoring the watermark")
    ap.add_argument("--again", action="store_true", help="read finished sessions again")
    ap.add_argument("--dry-run", action="store_true", help="read everything, write nothing")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    QUIET = a.quiet
    if a.command == "doctor":
        return doctor()

    if a.command == "readiness":
        key = os.environ.get("COMPOSIO_API_KEY", "").strip()
        zoom = Zoom(Composio(key) if key else None, ZoomApp.from_env())
        try:
            meeting = zoom.meeting()
        except Failure:
            meeting = {}
        print(json.dumps(launch_snapshot(meeting, join_link_ok()), sort_keys=True))
        return 0

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
            ok = not counts.get("problems")
            failed = failed or not ok
            sb.finish(run, ok, "+".join(sorted(zoom.via)), "Partial source read" if not ok else "", counts)
        except Failure as e:
            failed = True
            note(f"zoom: {e}")
            sb.finish(run, False, "+".join(sorted(zoom.via)), str(e), {})
    if a.command in ("pull", "survey"):
        run = sb.begin("typeform")
        try:
            if not composio:
                raise Failure("COMPOSIO_API_KEY is not set, so the survey cannot be read")
            counts = pull_survey(sb, composio, full=a.full_backfill)
            sb.finish(run, True, "composio", "", counts)
        except Failure as e:
            failed = True
            note(f"survey: {e}")
            sb.finish(run, False, "composio", str(e), {})
    if a.command in ("pull", "reminders", "objections"):
        ghl = GHL.from_env()
        registrants: list[dict] = []
        registrants_ok = ghl is not None
        try:
            registrants = ghl.registrants() if ghl else []
        except Failure as e:
            failed = True
            registrants_ok = False
            note(f"registrants: {e}")
            for source in ("reminders", "objections"):
                if a.command in ("pull", source):
                    sb.finish(sb.begin(source), False, "highlevel", "Registrant read failed; dependent collection skipped", {})
        if a.command in ("pull", "reminders") and ghl and registrants_ok:
            try:
                due = a.command == "reminders" or reminders_due(sb, registrants)
            except Failure as e:
                due, failed = False, True
                note(f"reminders: {e}")
            if due:
                run = sb.begin("reminders")
                try:
                    sb.finish(run, True, "highlevel", "", pull_reminders(sb, ghl, registrants))
                except Failure as e:
                    failed = True
                    note(f"reminders: {e}")
                    sb.finish(run, False, "highlevel", str(e), {})
        fathom, model = Fathom.from_env(), DeepSeek.from_env()
        if a.command in ("pull", "objections") and not model:
            run = sb.begin("objections")
            sb.finish(run, False, "policy", "Objection tagging paused: approve a transcript provider before sending lead data.", {"provider_approved": False})
            if a.command == "objections":
                failed = True
        if a.command in ("pull", "objections") and fathom and model and registrants_ok:
            run = sb.begin("objections")
            try:
                sb.finish(run, True, f"fathom+{OBJECTIONS_MODEL}", "",
                          pull_objections(sb, fathom, model, registrants))
            except Failure as e:
                failed = True
                note(f"objections: {e}")
                sb.finish(run, False, f"fathom+{OBJECTIONS_MODEL}", str(e), {})
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
