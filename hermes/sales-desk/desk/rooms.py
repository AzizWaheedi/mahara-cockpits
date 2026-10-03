"""The room worker: the sales cockpit's video rooms, made on the VPS.

How a room is made
- sales-api inserts a row in `cockpit_sales_rooms` in state `requested`. It
  has already checked the seat, the switches, the client and do-not-disturb
  rules and the host; this worker never decides who may have a room.
- The worker claims it with a conditional PATCH (`state=eq.requested`), so two
  runs, or fifty, can never make the same room twice: only the update that
  still sees `requested` gets the row back.
- Zoom: the host's own Zoom user on Mahara's account. Before anything is made
  it checks the host has no live meeting (Zoom allows one at a time) and that
  a demo is not on a Basic seat (Basic ends at 40 minutes). The meeting is
  type 2 with no start time, topic "Mahara call {code}" (the topic carries only
  the code, and the code is how a lost room is found again), a waiting room
  for anyone outside the account, nobody in before the host, no recording,
  and the passcode inside the link.
- Meet: a Calendar event on the calendar "Sales rooms" (made once if missing)
  through the CEO's Google sign-in, `conferenceDataVersion=1`,
  `sendUpdates=none`, no attendees, title "Mahara call {code}", and the room's
  uuid as the event id (base32hex), so an insert repeated after a crash finds
  the first one (409) instead of making a second. Google often answers
  "pending" first; the event is read every second for up to 30 s.
- It puts the host link (`start_url`) in `cockpit_sales_room_secrets`, which
  only the service role reads, saves `join_url` and `provider_meeting_id`,
  sets the room `open`, stores a `worker.ready` event and calls sales-api
  `room.event {kind: 'worker.ready'}` with its service key, the way the desk
  calls `followup.autosend`. sales-api sends the lead the link, once.
- A refusal or a provider failure sets the room `failed` with a sentence the
  rep can act on, and calls `room.event {kind: 'worker.failed'}`.

Timing
- One run lasts about 57 s (`--for 57`) and polls every second, under a cron
  line every minute with `flock -n`. It claims up to 3 rooms a tick and stops
  claiming 3 s before its end; a call in flight at the end is cut 2 s past it,
  so the next minute's run always gets the lock.
- A Meet room still waiting on Google when a run ends is left in `creating`
  and adopted by the next run at once: the event id is fixed, so reading it
  again is always safe.
- Crash recovery: a Zoom room in `creating` for more than 60 s is found again
  by the code in its topic, else failed. A Meet room is found by its event id,
  else failed.
- Final rooms: the Zoom meeting is ended (if it started) and deleted, then the
  host link is deleted, within a minute. Never for a room that reached
  `lead_in`, and never for a `booked` room, which wraps the appointment's own
  meeting. A Meet link cannot be stopped; only its host link is deleted.
- The status row (worker `sales-desk`, job `rooms`) is written at least every
  30 s with a plain sentence; the cockpit's health line reads its time.
- Every 10 minutes the host check writes `cockpit_sales_room_hosts`: each
  seat's Zoom user and status (licensed, basic, pending, missing), whether
  Google works, and the room each seat gets by default. A status it could not
  read is left empty, never written as "missing".

Every HTTP call has a timeout and at most two retries, on 429 or 5xx (and on
a dropped connection when repeating the call is safe). Zoom's create is not
safe to repeat blindly: after an unclear answer the host's meetings are read
for the room's code first.

Keys, by name only, never printed: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID,
ZOOM_CLIENT_SECRET (the server-to-server app webinar-pull uses);
GOOGLE_CAL_CLIENT_ID, GOOGLE_CAL_CLIENT_SECRET, GOOGLE_CAL_REFRESH_TOKEN (the
CEO's calendar sign-in), or else GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
GOOGLE_REFRESH_TOKEN (the editor desk's); DESK_SUPABASE_URL and
DESK_SUPABASE_KEY.
"""
from __future__ import annotations

import base64
import json
import os
import re
import socket
import time
import urllib.parse
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from . import http
from .config import WORKER, key
from .supabase import STATUS, Supabase, SupabaseError

ROOMS = "cockpit_sales_rooms"
SECRETS = "cockpit_sales_room_secrets"
EVENTS = "cockpit_sales_room_events"
HOSTS = "cockpit_sales_room_hosts"
PEOPLE = "cockpit_sales_people"
SETTINGS = "cockpit_sales_settings"
SETTING = "rooms"
JOB = "rooms"
HOSTS_JOB = "room-hosts"

FINAL = ("ended", "expired", "failed", "cancelled")
SEAT_ROLES = ("setter", "closer", "both", "manager")
ZOOM_KEYS = ("ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET")
GOOGLE_KEY_SETS = (
    ("GOOGLE_CAL_CLIENT_ID", "GOOGLE_CAL_CLIENT_SECRET", "GOOGLE_CAL_REFRESH_TOKEN"),
    ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"),
)
TOPIC = "Mahara call {code}"
CALENDAR_NAME = "Sales rooms"

RUN_SECONDS = 57.0
EVERY = 1.0
MAX_CLAIMS = 3
CLAIM_MARGIN = 3.0       # no new claim in the last 3 s of a run
HARD_SLACK = 2.0         # a call in flight at the end runs at most 2 s past it
STATUS_EVERY = 25.0      # the status row, at least every 30 s
CLOSE_EVERY = 10.0       # final rooms' provider sides, closed within a minute
HOSTS_EVERY = 600.0      # the host check
HOSTS_MIN_LEFT = 15.0    # only when the run has this long left
ORPHAN_RETRY = 5.0       # a lost room whose provider did not answer is asked again after this
GIVE_UP_S = 300.0        # ... and failed after this
CLOSE_GIVE_UP_S = 600.0  # a meeting Zoom will not close: the host link is deleted anyway
START_URL_TTL = 7200.0   # Zoom's start_url lasts two hours for a regular user
CALL_TIMEOUT = 10.0
API_TIMEOUT = 15.0
RENOTIFY_EVERY = 5.0
RENOTIFY_TRIES = 6

DEFAULTS: dict[str, Any] = {
    "enabled": None,
    "providers": {"zoom": None, "meet": None},
    "default_provider": {"setter": "meet", "closer": "zoom"},
    "waits_s": {"fail": 60, "meet_pending": 30, "handover_host": 120, "standby_host": 300,
                "fallback_host": 900},
    "lengths_min": {"intro": 30, "demo": 60},
}

# What the rep reads on the room panel when a room cannot be made. Plain,
# active, and each one says what to do next.
SAY = {
    "busy": "Your Zoom is in another meeting. End it or use Meet.",
    "basic_demo": "The closer's Zoom is Basic and ends at 40 minutes. Use Meet for this demo.",
    "pending": "Your Zoom invite is not accepted yet. Accept it from Zoom's email, or use Meet.",
    "no_user": "Your email has no Zoom user on Mahara's account. Use Meet, or ask the manager to add you in Zoom.",
    "zoom_keys": "Zoom is not connected on the room worker. Use Meet, and ask the manager to set the Zoom keys on the VPS.",
    "zoom_refused": "Zoom refused to make the room: {why}. Use Meet, or try again.",
    "zoom_down": "Zoom did not answer. Try again in a minute, or use Meet.",
    "google_keys": "Google is not connected on the room worker. Use Zoom, and ask the manager to connect Google Calendar on the VPS.",
    "meet_pending": "Google did not make the Meet link. Try Zoom.",
    "google_refused": "Google refused to make the Meet room: {why}. Try Zoom.",
    "google_down": "Google did not answer. Try again in a minute, or use Zoom.",
    "calendar": ("Google would not make the Sales rooms calendar. Ask the manager to create a calendar named "
                 "Sales rooms in Google Calendar, or use Zoom."),
    "switched_off": "Video rooms are switched off. A manager can switch them on in Settings.",
    "too_late": "The room worker did not pick this room up within a minute. Make a new room.",
    "lost": "This room was not finished in time. Make a new one.",
    "booked": "A booked call keeps its own meeting, so no new room is made. Open the booked call instead.",
    "provider": "This room asks for a video service the worker does not know. Make a new room with Zoom or Meet.",
    "no_host": "This room has no host. Make a new room.",
    "error": "The room could not be made because of an error on our side. Try again, or use the other video service.",
}


# ---- small pure helpers ------------------------------------------------------

_TS = re.compile(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$")


def parse_ts(value: Any) -> Optional[float]:
    """Epoch seconds from a PostgREST or Zoom timestamp, any fraction length
    (Postgres trims trailing zeros, which Python 3.9's fromisoformat refuses)."""
    if value in (None, ""):
        return None
    m = _TS.match(str(value).strip())
    if not m:
        return None
    day, clock, frac, zone = m.groups()
    frac = ((frac or "") + "000000")[:6]
    if not zone or zone == "Z":
        zone = "+00:00"
    elif len(zone) == 3:
        zone += ":00"
    elif ":" not in zone:
        zone = zone[:3] + ":" + zone[3:]
    try:
        return datetime.fromisoformat(f"{day}T{clock}.{frac}{zone}").timestamp()
    except ValueError:
        return None


def iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


_B32HEX = "0123456789abcdefghijklmnopqrstuv"


def base32hex(raw: bytes) -> str:
    """Lowercase base32hex without padding: the alphabet Google allows in an
    event id (a to v and 0 to 9). Written out because base64.b32hexencode
    needs Python 3.10 and the desk runs on 3.9."""
    if not raw:
        return ""
    bits, n = int.from_bytes(raw, "big"), len(raw) * 8
    pad = (5 - n % 5) % 5
    bits, n = bits << pad, n + pad
    return "".join(_B32HEX[(bits >> (n - 5 * (i + 1))) & 31] for i in range(n // 5))


def event_id(room_id: Any) -> str:
    """The room's uuid as base32hex: 26 characters, the same on every try."""
    try:
        raw = uuid.UUID(str(room_id)).bytes
    except ValueError:
        raw = str(room_id).encode("utf-8")
    return base32hex(raw)


def topic_of(code: Any) -> str:
    return TOPIC.format(code=str(code or "").strip())


def merged(base: dict[str, Any], over: Any) -> dict[str, Any]:
    out = {k: (dict(v) if isinstance(v, dict) else v) for k, v in base.items()}
    if isinstance(over, dict):
        for k, v in over.items():
            if isinstance(v, dict) and isinstance(out.get(k), dict):
                out[k] = merged(out[k], v)
            else:
                out[k] = v
    return out


def with_passcode(join_url: str, meeting: dict[str, Any]) -> str:
    """The lead taps one link and is not asked for a passcode. Zoom embeds it
    when the account's "embed passcode" setting is on; when it is not, the
    meeting's encrypted passcode is the value Zoom's own links carry."""
    url = str(join_url or "")
    if not url or "pwd=" in url:
        return url
    enc = str(meeting.get("encrypted_password") or "").strip()
    if not enc:
        return url
    return url + ("&" if "?" in url else "?") + "pwd=" + urllib.parse.quote(enc, safe="")


def zoom_body(code: str, call_kind: str, lengths: dict[str, Any]) -> dict[str, Any]:
    """Type 2 with no start time: the meeting can start now, and its link
    stays the room's. The waiting-room options are Zoom's documented
    `waiting_room_options` (mode custom, users not in the account); the
    account's own Waiting Room setting must allow custom options."""
    try:
        minutes = int((lengths or {}).get(call_kind) or 30)
    except (TypeError, ValueError):
        minutes = 30
    return {
        "topic": topic_of(code),
        "type": 2,
        "duration": max(15, minutes),
        "settings": {
            "join_before_host": False,
            "waiting_room": True,
            "waiting_room_options": {"mode": "custom", "who_goes_to_waiting_room": "users_not_in_account"},
            "auto_recording": "none",
            "approval_type": 2,
            "meeting_authentication": False,
            "email_notification": False,
            "host_video": True,
            "participant_video": True,
            "mute_upon_entry": False,
            "use_pmi": False,
        },
    }


def meet_body(room: dict[str, Any], now: float, lengths: dict[str, Any]) -> dict[str, Any]:
    try:
        minutes = int((lengths or {}).get(room.get("call_kind")) or 30)
    except (TypeError, ValueError):
        minutes = 30
    return {
        "id": event_id(room["id"]),
        "summary": topic_of(room.get("code")),
        "start": {"dateTime": iso(now)},
        "end": {"dateTime": iso(now + max(15, minutes) * 60)},
        "visibility": "private",
        "transparency": "transparent",
        "guestsCanInviteOthers": False,
        "guestsCanSeeOtherGuests": False,
        "guestsCanModify": False,
        "reminders": {"useDefault": False, "overrides": []},
        "conferenceData": {"createRequest": {"requestId": str(room["id"]),
                                             "conferenceSolutionKey": {"type": "hangoutsMeet"}}},
    }


def conference_state(event: dict[str, Any]) -> tuple[str, str, str]:
    """(status, link, meeting code) of a Calendar event's Meet conference:
    status is success, pending or failure."""
    conf = (event or {}).get("conferenceData") or {}
    status = str(((conf.get("createRequest") or {}).get("status") or {}).get("statusCode") or "").lower()
    link = str((event or {}).get("hangoutLink") or "")
    if not link:
        for ep in conf.get("entryPoints") or []:
            if isinstance(ep, dict) and ep.get("entryPointType") == "video" and ep.get("uri"):
                link = str(ep["uri"])
                break
    if link and status in ("", "success"):
        status = "success"
    elif not status:
        status = "pending"
    return status, link, str(conf.get("conferenceId") or "")


def zoom_seat_status(user: dict[str, Any]) -> str:
    """licensed, basic, pending or missing, from Zoom's user record."""
    status = str(user.get("status") or "").lower()
    if status == "pending":
        return "pending"
    if status and status != "active":
        return "missing"
    try:
        kind = int(user.get("type") or 0)
    except (TypeError, ValueError):
        kind = 0
    return {2: "licensed", 1: "basic"}.get(kind, "missing")


def default_provider(role: str, zoom_status: Optional[str], google_ok: Optional[bool],
                     defaults: dict[str, Any]) -> str:
    """The room a seat gets unless the rep picks the other one. The setter's
    default is Meet and the closer's Zoom (rooms.default_provider); a seat
    whose Zoom cannot host goes to Meet, and one whose Google does not work
    goes to Zoom when its Zoom can host."""
    d = defaults or {}
    if role == "setter":
        base = str(d.get("setter") or "meet")
    else:
        base = str(d.get("closer") or "zoom")
    base = base if base in ("zoom", "meet") else "zoom"
    if base == "zoom" and zoom_status in ("pending", "missing") and google_ok is not False:
        return "meet"
    if base == "meet" and google_ok is False and zoom_status in ("licensed", "basic"):
        return "zoom"
    return base


# ---- HTTP: one door for Zoom, Google and sales-api --------------------------


_ZAK = re.compile(r"(?i)(zak=)[^&\s\"']+")


class ProviderError(Exception):
    def __init__(self, status: int, message: str, *, code: Any = None, reason: str = "", where: str = ""):
        self.status = int(status or 0)
        self.code = code
        self.reason = reason
        self.where = where
        # A Zoom host link carries the host's token as zak=; it never reaches
        # a log line or a room's error, whatever a provider echoes back.
        self.message = _ZAK.sub(r"\1<hidden>", http.scrub(message))[:240]
        super().__init__(f"{where} {self.status}: {self.message}" if self.status else f"{where}: {self.message}")

    @property
    def unclear(self) -> bool:
        """The call may or may not have done its work: a dropped connection,
        a timeout or a server error."""
        return self.status == 0 or self.status >= 500

    @property
    def why(self) -> str:
        """What the provider said, short enough for a panel sentence."""
        text = self.message.rstrip(". ")
        return text[:160] if text else f"HTTP {self.status}"

    @classmethod
    def of(cls, e: http.HttpError, url: str) -> "ProviderError":
        where = urllib.parse.urlsplit(url).netloc or "the provider"
        code: Any = None
        reason = ""
        message = ""
        try:
            data = json.loads((e.body or b"").decode("utf-8") or "null")
        except (ValueError, UnicodeDecodeError):
            data = None
        if isinstance(data, dict):
            err = data.get("error")
            if isinstance(err, dict):  # Google
                code = err.get("code")
                message = str(err.get("message") or "")
                reasons = [x.get("reason") for x in err.get("errors") or [] if isinstance(x, dict)]
                reason = str(reasons[0] or "") if reasons else ""
            else:  # Zoom, PostgREST
                code = data.get("code")
                message = str(data.get("message") or data.get("reason") or err or "")
        if not message:
            message = str(e).split(": ", 1)[-1] if e.status else str(e)
        return cls(e.status, message, code=code, reason=reason, where=where)


def _parse(raw: bytes) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return raw.decode("utf-8", "replace")


class Sender:
    """A timeout on every call; at most two retries, on 429 or 5xx, and on a
    dropped connection only when the call is safe to repeat; never past the
    run's hard stop."""

    def __init__(self, clock: Callable[[], float], sleep: Callable[[float], None],
                 left: Optional[Callable[[], Optional[float]]] = None):
        self.clock = clock
        self.sleep = sleep
        self.left = left or (lambda: None)

    def __call__(self, method: str, url: str, *, headers: Optional[dict[str, str]] = None, body: Any = None,
                 form: Any = None, timeout: float = CALL_TIMEOUT, retries: int = 2,
                 safe: bool = True) -> tuple[int, Any]:
        h = dict(headers or {})
        data: Optional[bytes] = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            h["Content-Type"] = "application/json"
        elif form is not None:
            data = urllib.parse.urlencode(form).encode("utf-8") if isinstance(form, dict) else bytes(form)
            h["Content-Type"] = "application/x-www-form-urlencoded"
        retries = max(0, min(2, int(retries)))
        attempt = 0
        while True:
            left = self.left()
            if left is not None and left <= 0.5:
                # Past the run's hard stop nothing new starts: the next
                # minute's run must find the lock free.
                raise ProviderError(0, "this run's time is up", where=urllib.parse.urlsplit(url).netloc)
            t = timeout if left is None else max(1.0, min(timeout, left))
            try:
                status, _h, raw = http.request(method, url, headers=h, data=data, timeout=t, retries=0,
                                               ok_statuses=(200, 201, 202, 204))
                return status, _parse(raw)
            except http.HttpError as e:
                err = ProviderError.of(e, url)
                again = err.status == 429 or err.status >= 500 or (err.status == 0 and safe)
                left = self.left()
                if not again or attempt >= retries or (left is not None and left <= 1.0):
                    raise err
                attempt += 1
                wait = float(attempt)
                if left is not None:
                    wait = max(0.0, min(wait, left - 1.0))
                self.sleep(wait)


# ---- the providers -----------------------------------------------------------


def _qe(value: Any) -> str:
    return urllib.parse.quote(str(value), safe="@.")


class Zoom:
    """Mahara's server-to-server Zoom app, as webinar-pull uses it
    (hermes/webinar-pull/pull.py, ZoomApp): an account-credentials token kept
    until a minute before it lapses, asked again once if Zoom says 401."""

    TOKEN_URL = "https://zoom.us/oauth/token"
    API = "https://api.zoom.us/v2"

    def __init__(self, account: str, client: str, secret: str, send: Sender):
        self.account, self.client, self.secret = account, client, secret
        self.send = send
        self._token = ""
        self._expires = 0.0

    @classmethod
    def from_keys(cls, send: Sender) -> Optional["Zoom"]:
        a, c, s = (key(n).strip() for n in ZOOM_KEYS)
        return cls(a, c, s, send) if a and c and s else None

    def token(self) -> str:
        if self._token and self.send.clock() < self._expires - 60:
            return self._token
        basic = base64.b64encode(f"{self.client}:{self.secret}".encode()).decode()
        _s, data = self.send(
            "POST", f"{self.TOKEN_URL}?grant_type=account_credentials&account_id={urllib.parse.quote(self.account, safe='')}",
            headers={"Authorization": f"Basic {basic}"}, form=b"", timeout=CALL_TIMEOUT)
        token = str((data or {}).get("access_token") or "") if isinstance(data, dict) else ""
        if not token:
            raise ProviderError(401, "the Zoom app's keys were refused", where="zoom.us")
        self._token = token
        self._expires = self.send.clock() + float((data or {}).get("expires_in") or 3600)
        return token

    def call(self, method: str, path: str, *, query: Optional[dict[str, Any]] = None, body: Any = None,
             retries: int = 2, safe: Optional[bool] = None) -> Any:
        q = urllib.parse.urlencode({k: v for k, v in (query or {}).items() if v not in (None, "")})
        url = f"{self.API}{path}" + (f"?{q}" if q else "")
        for auth in range(2):
            try:
                _s, data = self.send(method, url, headers={"Authorization": f"Bearer {self.token()}",
                                                           "Accept": "application/json"},
                                     body=body, retries=retries,
                                     safe=(method != "POST") if safe is None else safe)
                return data
            except ProviderError as e:
                if e.status == 401 and auth == 0:
                    self._token = ""
                    continue
                raise
        raise ProviderError(401, "Zoom refused the app's token twice", where="api.zoom.us")

    def user(self, email: str) -> dict[str, Any]:
        out = self.call("GET", f"/users/{_qe(email)}")
        return out if isinstance(out, dict) else {}

    def pending_emails(self) -> set[str]:
        """Who has a Zoom invite not yet accepted. A pending user may not be
        found by address at all, so a 404 is checked against this list before
        it is called missing."""
        out: set[str] = set()
        token = None
        for _ in range(5):
            page = self.call("GET", "/users", query={"status": "pending", "page_size": 300, "next_page_token": token})
            for u in (page or {}).get("users") or []:
                if isinstance(u, dict) and u.get("email"):
                    out.add(str(u["email"]).strip().lower())
            token = (page or {}).get("next_page_token")
            if not token:
                break
        return out

    def meetings(self, user: str, kind: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        token = None
        for _ in range(3):
            page = self.call("GET", f"/users/{_qe(user)}/meetings",
                             query={"type": kind, "page_size": 300, "next_page_token": token})
            out.extend(m for m in (page or {}).get("meetings") or [] if isinstance(m, dict))
            token = (page or {}).get("next_page_token")
            if not token:
                break
        return out

    def live(self, user: str) -> list[dict[str, Any]]:
        return self.meetings(user, "live")

    def find(self, user: str, topic: str) -> Optional[dict[str, Any]]:
        """The host's meeting with this topic: how a room whose create answer
        was lost, or whose worker died, is found again."""
        for m in self.meetings(user, "scheduled"):
            if str(m.get("topic") or "").strip() == topic:
                return m
        return None

    def create(self, user: str, body: dict[str, Any]) -> dict[str, Any]:
        out = self.call("POST", f"/users/{_qe(user)}/meetings", body=body, retries=0, safe=False)
        return out if isinstance(out, dict) else {}

    def meeting(self, meeting_id: Any) -> dict[str, Any]:
        out = self.call("GET", f"/meetings/{_qe(meeting_id)}")
        return out if isinstance(out, dict) else {}

    def end(self, meeting_id: Any) -> None:
        self.call("PUT", f"/meetings/{_qe(meeting_id)}/status", body={"action": "end"})

    def delete(self, meeting_id: Any) -> None:
        # No email to the host about a room nobody needs any more.
        self.call("DELETE", f"/meetings/{_qe(meeting_id)}",
                  query={"schedule_for_reminder": "false", "cancel_meeting_reminder": "false"})


def google_key_source() -> Optional[tuple[str, str, str, str]]:
    """(client id, secret, refresh token, which names) of the first complete
    Google sign-in on the box, or None."""
    for names in GOOGLE_KEY_SETS:
        values = [key(n).strip() for n in names]
        if all(values):
            prefix = names[0].rsplit("_CLIENT_ID", 1)[0]
            return values[0], values[1], values[2], f"{prefix}_*"
    return None


class Google:
    """Google Calendar through an OAuth refresh token, with the refresh step
    of the editor desk (hermes/editor-desk/desk/drive.py, Drive.token)."""

    TOKEN_URL = "https://oauth2.googleapis.com/token"
    API = "https://www.googleapis.com/calendar/v3"

    def __init__(self, client_id: str, secret: str, refresh: str, source: str, send: Sender):
        self.client_id, self.secret, self.refresh, self.source = client_id, secret, refresh, source
        self.send = send
        self._token = ""
        self._expires = 0.0

    @classmethod
    def from_keys(cls, send: Sender) -> Optional["Google"]:
        found = google_key_source()
        return cls(*found, send=send) if found else None

    def token(self) -> str:
        if self._token and self.send.clock() < self._expires - 60:
            return self._token
        _s, data = self.send("POST", self.TOKEN_URL, form={
            "client_id": self.client_id, "client_secret": self.secret,
            "refresh_token": self.refresh, "grant_type": "refresh_token"}, timeout=CALL_TIMEOUT)
        token = str((data or {}).get("access_token") or "") if isinstance(data, dict) else ""
        if not token:
            raise ProviderError(401, "Google refused the refresh token", where="oauth2.googleapis.com")
        self._token = token
        self._expires = self.send.clock() + float((data or {}).get("expires_in") or 3600)
        return token

    def call(self, method: str, path: str, *, query: Optional[dict[str, Any]] = None, body: Any = None,
             retries: int = 2, safe: bool = True) -> Any:
        q = urllib.parse.urlencode({k: v for k, v in (query or {}).items() if v not in (None, "")})
        url = f"{self.API}/{path}" + (f"?{q}" if q else "")
        for auth in range(2):
            try:
                _s, data = self.send(method, url, headers={"Authorization": f"Bearer {self.token()}",
                                                           "Accept": "application/json"},
                                     body=body, retries=retries, safe=safe)
                return data
            except ProviderError as e:
                if e.status == 401 and auth == 0:
                    self._token = ""
                    continue
                raise
        raise ProviderError(401, "Google refused the token twice", where="www.googleapis.com")

    def calendars(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        token = None
        for _ in range(5):
            page = self.call("GET", "users/me/calendarList",
                             query={"minAccessRole": "owner", "maxResults": 250, "showHidden": "true",
                                    "pageToken": token})
            out.extend(c for c in (page or {}).get("items") or [] if isinstance(c, dict))
            token = (page or {}).get("nextPageToken")
            if not token:
                break
        return out

    def make_calendar(self, name: str) -> dict[str, Any]:
        # Not repeated on a dropped connection: a second calendar would be made.
        out = self.call("POST", "calendars", body={
            "summary": name, "timeZone": "Asia/Kuwait",
            "description": "Video rooms made by the sales cockpit. Each event is one room; its title carries only the room code.",
        }, safe=False)
        return out if isinstance(out, dict) else {}

    def insert(self, calendar: str, body: dict[str, Any]) -> dict[str, Any]:
        # Safe to repeat: the event id is fixed, so a second insert is a 409.
        out = self.call("POST", f"calendars/{urllib.parse.quote(calendar, safe='')}/events",
                        query={"conferenceDataVersion": 1, "sendUpdates": "none"}, body=body, safe=True)
        return out if isinstance(out, dict) else {}

    def event(self, calendar: str, eid: str) -> dict[str, Any]:
        out = self.call("GET", f"calendars/{urllib.parse.quote(calendar, safe='')}/events/{urllib.parse.quote(eid, safe='')}")
        return out if isinstance(out, dict) else {}


class SalesApi:
    """sales-api's desk door, asked with the service key exactly as the
    follow-up agent asks `followup.autosend` (desk.py cmd_followups)."""

    def __init__(self, url: str, service_key: str, send: Sender):
        self.url = f"{url.rstrip('/')}/functions/v1/sales-api"
        self.key = service_key
        self.send = send

    def event(self, kind: str, room_id: str, payload: dict[str, Any]) -> tuple[str, str]:
        """('delivered' | 'refused' | 'unclear', what happened). The request id
        is the same on every try for one room and kind, so sales-api can treat
        a repeat as the first call (its request-id pattern)."""
        body = {"action": "room.event", "kind": kind, "room_id": room_id,
                "request_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"mahara-room/{kind}/{room_id}")),
                "dedupe_key": f"{kind}:{room_id}", "payload": payload}
        try:
            _s, data = self.send("POST", self.url, headers={
                "Authorization": f"Bearer {self.key}", "x-region": "eu-west-1"},
                body=body, timeout=API_TIMEOUT, retries=2, safe=True)
        except ProviderError as e:
            return ("unclear" if e.status in (0, 429) or e.status >= 500 else "refused"), str(e)
        if isinstance(data, dict) and data.get("error"):
            return "refused", http.scrub(str(data.get("error")))[:200]
        return "delivered", ""


# ---- the worker --------------------------------------------------------------


@dataclass
class Pending:
    """A Meet room waiting on Google to fill in its link."""
    room: dict[str, Any]
    calendar: str
    eid: str
    until: float
    next_at: float


class TablesMissing(Exception):
    pass


def _q(value: Any) -> str:
    return http.quote(value)


def _in(values: list[str]) -> str:
    return http.quote("(" + ",".join('"' + str(v).replace('"', '') + '"' for v in values) + ")")


class Worker:
    def __init__(self, sb: Supabase, *, zoom: Optional[Zoom], google: Optional[Google],
                 api: Optional[SalesApi], log: Any, clock: Callable[[], float] = time.time,
                 sleep: Callable[[float], None] = time.sleep, run_id: Optional[str] = None,
                 calendar_name: str = CALENDAR_NAME, calendar_id: str = ""):
        self.sb = sb
        self.zoom = zoom
        self.google = google
        self.api = api
        self.log = log
        self.clock = clock
        self.sleep = sleep
        self.run_id = run_id or f"{socket.gethostname()[:40]}-{os.getpid()}-{int(clock())}"
        self.calendar_name = calendar_name
        self._calendar = calendar_id
        self.settings: dict[str, Any] = merged(DEFAULTS, None)
        self.deadline = clock() + RUN_SECONDS
        self.hard_stop = self.deadline + HARD_SLACK
        self.claim_until = float("inf")
        self.pending: dict[str, Pending] = {}
        self._made: dict[str, Any] = {}          # Zoom meetings made for a room not yet saved
        self._busy: set[str] = set()             # rooms this run is working on right now
        self._retry_at: dict[str, float] = {}    # lost rooms whose provider did not answer
        self._renotify: dict[tuple[str, str], tuple[float, int, dict[str, Any]]] = {}
        self._users: dict[str, tuple[float, Optional[dict[str, Any]], Optional[str]]] = {}
        self._pending_users: Optional[set[str]] = None
        self.closed_ids: set[str] = set()
        self._status_due = 0.0
        self._close_due = 0.0
        self._settings_due = 0.0
        self._hosts_due: Optional[float] = None
        self._event_warned = False
        self.total = self._counts()
        self.window = self._counts()
        self._window_from = clock()

    # ---- wiring ------------------------------------------------------------
    @classmethod
    def from_env(cls, sb: Supabase, supabase_url: str, supabase_key: str, log: Any, *,
                 clock: Callable[[], float] = time.time, sleep: Callable[[float], None] = time.sleep) -> "Worker":
        holder: dict[str, Any] = {}
        send = Sender(clock, sleep, left=lambda: holder["w"].left() if "w" in holder else None)
        w = cls(sb, zoom=Zoom.from_keys(send), google=Google.from_keys(send),
                api=SalesApi(supabase_url, supabase_key, send), log=log, clock=clock, sleep=sleep,
                calendar_name=key("SALES_ROOMS_CALENDAR", CALENDAR_NAME).strip() or CALENDAR_NAME,
                calendar_id=key("SALES_ROOMS_CALENDAR_ID", "").strip())
        holder["w"] = w
        return w

    def left(self) -> float:
        """Seconds until the hard stop: no call may run past it."""
        return self.hard_stop - self.clock()

    @staticmethod
    def _counts() -> dict[str, Any]:
        return {"made": 0, "zoom": 0, "meet": 0, "failed": 0, "refused": 0, "closed": 0, "withdrawn": 0,
                "db_errors": 0, "db_refused": "", "faults": [], "notify_lost": 0}

    def _count(self, name: str, n: int = 1) -> None:
        self.total[name] += n
        self.window[name] += n

    def _fault(self, sentence: str) -> None:
        self.total["faults"].append(sentence)
        self.window["faults"].append(sentence)

    # ---- the loop ----------------------------------------------------------
    def run(self, seconds: float = RUN_SECONDS, every: float = EVERY, max_claims: int = MAX_CLAIMS) -> dict[str, Any]:
        """About a minute of work: a tick every `every` seconds until
        `seconds` have passed. Returns what the run did."""
        start = self.clock()
        seconds = max(0.0, float(seconds))
        self.deadline = start + seconds
        if seconds >= 2 * CLAIM_MARGIN:
            # Under cron: no claim in the last seconds, and nothing past the
            # hard stop, so the next minute's run finds the lock free.
            self.claim_until = self.deadline - CLAIM_MARGIN
            self.hard_stop = self.deadline + HARD_SLACK
        else:
            # A tick by hand (--once): it claims, and its calls get their
            # whole timeout.
            self.claim_until = float("inf")
            self.hard_stop = start + 60.0
        self._window_from = start
        self._status_due = start
        try:
            self._read_settings(start)
            self._hosts_due = self._hosts_check_due(start)
        except TablesMissing as e:
            self._write_status(False, str(e))
            self.log.error(str(e))
            return {**self.summary(), "blocked": str(e)}
        while True:
            t0 = self.clock()
            try:
                self.tick(t0, max_claims=max_claims)
            except TablesMissing as e:
                self._write_status(False, str(e))
                self.log.error(str(e))
                return {**self.summary(), "blocked": str(e)}
            self._maybe_status()
            now = self.clock()
            if seconds <= 0 or now >= self.deadline:
                break
            wait = min(every - (now - t0), self.deadline - now)
            if wait > 0:
                self.sleep(wait)
            if self.clock() >= self.deadline:
                break
        if self.pending:
            self.log.info(f"rooms: {len(self.pending)} Meet room(s) still waiting on Google are left for the next run")
        self.status(final=True)
        return self.summary()

    def _window_empty(self) -> bool:
        w = self.window
        return not any((w["made"], w["failed"], w["closed"], w["withdrawn"], w["db_errors"], w["notify_lost"],
                        w["faults"]))

    def tick(self, now: float, *, max_claims: int = MAX_CLAIMS) -> None:
        if now >= self._close_due:
            self._close_due = now + CLOSE_EVERY
            try:
                self.close_finals()
            except (SupabaseError, http.HttpError) as e:
                self._db_trouble(e)
        if now >= self._settings_due:
            self._read_settings(now)
        try:
            rows = self.sb.select(ROOMS, "select=*&state=in.(requested,creating)&order=requested_at.asc&limit=50")
        except (SupabaseError, http.HttpError) as e:
            self._db_trouble(e)
            rows = None
        claimed = 0
        if rows is not None:
            for r in rows:
                if r.get("state") == "creating" and str(r.get("id")) not in self._busy | set(self.pending):
                    self._guard(r, self.orphan)
                    self._maybe_status()
            fail_s = float(self.waits("fail", 60))
            for r in rows:
                if r.get("state") != "requested":
                    continue
                if claimed >= max_claims or self.clock() > self.claim_until:
                    break
                asked = parse_ts(r.get("requested_at"))
                if asked is not None and self.clock() - asked > fail_s:
                    self._fail_unclaimed(r, SAY["too_late"])
                    continue
                claimed += 1
                got = self.claim(r)
                if got:
                    self._guard(got, self.process)
                self._maybe_status()
        self.poll_pending()
        self._retry_notifications()
        if (self._hosts_due is not None and self.clock() >= self._hosts_due and not claimed and not self.pending
                and self.deadline - self.clock() >= HOSTS_MIN_LEFT):
            self._hosts_due = None
            try:
                self.check_hosts()
            except (SupabaseError, http.HttpError, ProviderError) as e:
                self.log.warn(f"rooms: the host check stopped: {http.scrub(str(e))[:200]}")

    def summary(self) -> dict[str, Any]:
        t = self.total
        return {"made": t["made"], "zoom": t["zoom"], "meet": t["meet"], "failed": t["failed"],
                "refused": t["refused"], "closed": t["closed"], "withdrawn": t["withdrawn"],
                "waiting_on_google": len(self.pending), "db_errors": t["db_errors"],
                "problems": list(dict.fromkeys(t["faults"]))[:5], "run": self.run_id}

    # ---- settings and the database ------------------------------------------
    def waits(self, name: str, default: float) -> float:
        try:
            return float((self.settings.get("waits_s") or {}).get(name) or default)
        except (TypeError, ValueError):
            return default

    def _read_settings(self, now: float) -> None:
        self._settings_due = now + STATUS_EVERY
        try:
            raw = self.sb.setting(SETTING)
        except http.HttpError as e:
            if e.status == 404:
                raise TablesMissing("The settings table does not answer, so the room worker cannot start. "
                                    "Apply the sales cockpit migrations.")
            self._db_trouble(e)
            return
        except SupabaseError as e:
            self._db_trouble(e)
            return
        self.settings = merged(DEFAULTS, raw)

    def _db_trouble(self, e: Exception) -> None:
        if isinstance(e, http.HttpError) and e.status == 404:
            raise TablesMissing("The video room tables are not in the database yet (migration "
                                "20261003a_sales_rooms.sql), so no room can be made.")
        self._count("db_errors")
        if isinstance(e, http.HttpError) and 400 <= e.status < 500 and e.status != 429:
            # It answered, and refused: most often a column this worker writes
            # that the rooms migration does not have.
            self.window["db_refused"] = self.total["db_refused"] = http.scrub(str(e))[:160]
        if self.window["db_errors"] == 1:
            self.log.warn(f"rooms: the database did not answer as expected: {http.scrub(str(e))[:200]}")

    def _hosts_check_due(self, now: float) -> Optional[float]:
        try:
            rows = self.sb.select(STATUS, f"select=at&worker=eq.{_q(WORKER)}&job=eq.{_q(HOSTS_JOB)}&limit=1")
        except (SupabaseError, http.HttpError):
            return None
        last = parse_ts(rows[0].get("at")) if rows else None
        return now if last is None or now - last >= HOSTS_EVERY else last + HOSTS_EVERY

    def _read(self, room_id: str) -> Optional[dict[str, Any]]:
        rows = self.sb.select(ROOMS, f"select=*&id=eq.{_q(room_id)}&limit=1")
        return rows[0] if rows else None

    # ---- claim and make ------------------------------------------------------
    def claim(self, room: dict[str, Any]) -> Optional[dict[str, Any]]:
        """Only the update that still sees `requested` gets the row back."""
        body = {"state": "creating", "claimed_at": iso(self.clock()), "worker_run": self.run_id,
                "version": int(room.get("version") or 0) + 1, "error": None}
        try:
            got = self.sb.patch_returning(ROOMS, f"id=eq.{_q(room['id'])}&state=eq.requested", body)
        except (SupabaseError, http.HttpError) as e:
            self._db_trouble(e)
            return None
        return got[0] if got else None

    def _guard(self, room: dict[str, Any], step: Callable[[dict[str, Any]], Any]) -> None:
        """One room's fault never stops the loop or another room."""
        rid = str(room.get("id"))
        self._busy.add(rid)
        try:
            step(room)
        except TablesMissing:
            raise
        except (SupabaseError, http.HttpError) as e:
            # The database is the trouble: the room stays where it is and the
            # recovery path picks it up when the database answers again.
            self._db_trouble(e)
        except Exception as e:  # noqa: BLE001 - one room's fault is that room's
            self.log.error(f"rooms: room {room.get('code')} stopped on an error: {http.scrub(repr(e))[:300]}")
            self._fault(SAY["error"])
            try:
                self.fail(room, SAY["error"], fault=False)
            except Exception as e2:  # noqa: BLE001
                self.log.error(f"rooms: room {room.get('code')} could not be marked failed: {http.scrub(str(e2))[:200]}")
        finally:
            self._busy.discard(rid)

    def process(self, room: dict[str, Any]) -> None:
        if self.settings.get("enabled") is False:
            self.fail(room, SAY["switched_off"], refusal=True)
        elif room.get("purpose") == "booked":
            self.fail(room, SAY["booked"], refusal=True)
        elif not room.get("host_email"):
            self.fail(room, SAY["no_host"], refusal=True)
        elif room.get("provider") == "zoom":
            self.make_zoom(room)
        elif room.get("provider") == "meet":
            self.start_meet(room)
        else:
            self.fail(room, SAY["provider"], refusal=True)

    # ---- Zoom ------------------------------------------------------------------
    def zoom_user(self, email: str) -> tuple[Optional[dict[str, Any]], Optional[str]]:
        """(Zoom's user record or None, seat status or None when unknown),
        kept five minutes."""
        e = email.strip().lower()
        hit = self._users.get(e)
        if hit and self.clock() - hit[0] < 300:
            return hit[1], hit[2]
        assert self.zoom is not None
        try:
            user = self.zoom.user(e)
            status: Optional[str] = zoom_seat_status(user)
        except ProviderError as err:
            if err.status == 404 or str(err.code) == "1001":
                user = None
                try:
                    if self._pending_users is None:
                        self._pending_users = self.zoom.pending_emails()
                    status = "pending" if e in self._pending_users else "missing"
                except ProviderError:
                    status = "missing"
            elif err.unclear or err.status == 429:
                return None, None
            else:
                raise
        self._users[e] = (self.clock(), user, status)
        return user, status

    def make_zoom(self, room: dict[str, Any]) -> None:
        if not self.zoom:
            self.fail(room, SAY["zoom_keys"], fault=True)
            return
        host = str(room["host_email"]).strip().lower()
        try:
            user, status = self.zoom_user(host)
        except ProviderError as e:
            self.fail(room, SAY["zoom_refused"].format(why=e.why), fault=True)
            return
        if status == "pending":
            self.fail(room, SAY["pending"], refusal=True)
            return
        if status == "missing":
            self.fail(room, SAY["no_user"], refusal=True)
            return
        if status == "basic" and room.get("call_kind") == "demo":
            self.fail(room, SAY["basic_demo"], refusal=True)
            return
        target = str((user or {}).get("id") or host)
        try:
            live = [m for m in self.zoom.live(target) if str(m.get("id")) not in self.closed_ids]
        except ProviderError as e:
            # Not knowing is not a refusal: Zoom itself stops a second live
            # meeting, and the rep would rather have the room.
            self.log.warn(f"rooms: Zoom's live-meeting check did not answer for room {room.get('code')}: {e.why}")
            live = []
        if live:
            self.fail(room, SAY["busy"], refusal=True)
            return
        meeting = self.zoom_create(room, target)
        if meeting is None:
            return
        self._made[str(room["id"])] = meeting.get("id")
        self.finish(room, provider="zoom", meeting_id=meeting.get("id"),
                    join_url=with_passcode(str(meeting.get("join_url") or ""), meeting),
                    start_url=str(meeting.get("start_url") or ""))

    def zoom_create(self, room: dict[str, Any], user: str) -> Optional[dict[str, Any]]:
        """Three tries at most, on a 429 or an unclear answer (a timeout, a
        dropped connection, a 5xx). Before each new try the host's meetings
        are read for the room's code, so a meeting is never made twice, even
        when a gateway answers 429 after Zoom did the work."""
        topic = topic_of(room.get("code"))
        body = zoom_body(str(room.get("code") or ""), str(room.get("call_kind") or "intro"),
                         self.settings.get("lengths_min") or {})
        last: Optional[ProviderError] = None
        for attempt in range(3):
            if attempt:
                if self.left() <= 2.0:
                    break
                self.sleep(min(float(attempt), max(0.0, self.left() - 2.0)))
            try:
                made = self.zoom.create(user, body)  # type: ignore[union-attr]
                if made.get("id") and made.get("join_url"):
                    if not made.get("start_url"):
                        made = {**made, **self.zoom.meeting(made["id"])}  # type: ignore[union-attr]
                    return made
                last = ProviderError(0, "Zoom answered without a meeting", where="api.zoom.us")
            except ProviderError as e:
                last = e
                if not (e.unclear or e.status == 429):
                    break
            try:
                found = self.zoom.find(user, topic)  # type: ignore[union-attr]
                if found:
                    return self.zoom.meeting(found["id"])  # type: ignore[union-attr]
            except ProviderError as e:
                self.log.warn(f"rooms: Zoom's meeting list did not answer for room {room.get('code')}: {e.why}")
        if last is not None and not last.unclear and last.status not in (0, 429):
            self.fail(room, SAY["zoom_refused"].format(why=last.why), fault=True)
        else:
            self.fail(room, SAY["zoom_down"], fault=True)
        return None

    def recover_zoom(self, room: dict[str, Any], age: float) -> None:
        """A Zoom room left in `creating`: found again by the code in its
        topic, or made now when this run knows it never was, or failed."""
        if not self.zoom:
            self.fail(room, SAY["zoom_keys"], fault=True)
            return
        host = str(room.get("host_email") or "").strip().lower()
        if not host:
            self.fail(room, SAY["no_host"], refusal=True)
            return
        try:
            user, _status = self.zoom_user(host)
            target = str((user or {}).get("id") or host)
            found = self.zoom.find(target, topic_of(room.get("code")))
            meeting = self.zoom.meeting(found["id"]) if found else None
        except ProviderError as e:
            if age > GIVE_UP_S:
                self.fail(room, SAY["lost"], fault=True)
            else:
                self._retry_at[str(room["id"])] = self.clock() + ORPHAN_RETRY
                self.log.warn(f"rooms: room {room.get('code')} could not be looked up in Zoom yet: {e.why}")
            return
        if meeting:
            self.log.info(f"rooms: room {room.get('code')} found again in Zoom by its code")
            self._made[str(room["id"])] = meeting.get("id")
            self.finish(room, provider="zoom", meeting_id=meeting.get("id"),
                        join_url=with_passcode(str(meeting.get("join_url") or ""), meeting),
                        start_url=str(meeting.get("start_url") or ""))
        elif age <= self.waits("fail", 60):
            # Only this run's own rooms reach here this young: the claim's
            # answer was lost before anything was made.
            self.make_zoom(room)
        else:
            self.fail(room, SAY["lost"], fault=True)

    def close_zoom(self, meeting_id: Any) -> None:
        """End a meeting that started, then delete it, so its raw link stops
        working. A meeting already gone is closed."""
        assert self.zoom is not None
        try:
            m = self.zoom.meeting(meeting_id)
        except ProviderError as e:
            if e.status == 404 or str(e.code) == "3001":
                self.closed_ids.add(str(meeting_id))
                return
            raise
        if str(m.get("status") or "").lower() == "started":
            self.zoom.end(meeting_id)
        try:
            self.zoom.delete(meeting_id)
        except ProviderError as e:
            if not (e.status == 404 or str(e.code) == "3001"):
                raise
        self.closed_ids.add(str(meeting_id))

    # ---- Meet ------------------------------------------------------------------
    def calendar(self) -> str:
        """The "Sales rooms" calendar's id, made once if it does not exist."""
        if self._calendar:
            return self._calendar
        assert self.google is not None
        name = self.calendar_name.strip().casefold()
        mine = sorted((c for c in self.google.calendars()
                       if str(c.get("summary") or "").strip().casefold() == name and c.get("id")),
                      key=lambda c: str(c["id"]))
        if mine:
            self._calendar = str(mine[0]["id"])
        else:
            made = self.google.make_calendar(self.calendar_name)
            if not made.get("id"):
                raise ProviderError(0, "Google answered without a calendar", where="www.googleapis.com")
            self._calendar = str(made["id"])
            self.log.info(f"rooms: made the Google calendar {self.calendar_name!r} for Meet rooms")
        return self._calendar

    def _calendar_or_fail(self, room: dict[str, Any]) -> Optional[str]:
        try:
            return self.calendar()
        except ProviderError as e:
            if e.status in (401, 403):
                self.fail(room, SAY["calendar"], fault=True)
            elif e.unclear or e.status == 429:
                self.fail(room, SAY["google_down"], fault=True)
            else:
                self.fail(room, SAY["google_refused"].format(why=e.why), fault=True)
            return None

    def _meet_until(self, room: dict[str, Any]) -> float:
        claimed = parse_ts(room.get("claimed_at")) or self.clock()
        return claimed + self.waits("meet_pending", 30)

    def start_meet(self, room: dict[str, Any]) -> None:
        if not self.google:
            self.fail(room, SAY["google_keys"], fault=True)
            return
        cal = self._calendar_or_fail(room)
        if not cal:
            return
        eid = event_id(room["id"])
        try:
            ev = self.google.insert(cal, meet_body(room, self.clock(), self.settings.get("lengths_min") or {}))
        except ProviderError as e:
            if e.status != 409:
                self._meet_refused(room, e)
                return
            try:
                ev = self.google.event(cal, eid)
            except ProviderError as e2:
                self._meet_refused(room, e2)
                return
        self.track_meet(room, cal, eid, ev)

    def _meet_refused(self, room: dict[str, Any], e: ProviderError) -> None:
        if e.unclear or e.status == 429:
            self.fail(room, SAY["google_down"], fault=True)
        else:
            self.fail(room, SAY["google_refused"].format(why=e.why), fault=True)

    def track_meet(self, room: dict[str, Any], cal: str, eid: str, ev: dict[str, Any]) -> None:
        status, link, code = conference_state(ev)
        rid = str(room["id"])
        if str(ev.get("status") or "") == "cancelled":
            self.fail(room, SAY["lost"], fault=True)
        elif status == "success" and link:
            self.finish(room, provider="meet", meeting_id=code or eid, join_url=link, start_url=link)
        elif status == "failure":
            self.fail(room, SAY["meet_pending"], fault=True)
        else:
            until = self._meet_until(room)
            if self.clock() >= until:
                self.fail(room, SAY["meet_pending"], fault=True)
            else:
                self.pending[rid] = Pending(room=room, calendar=cal, eid=eid, until=until,
                                            next_at=self.clock() + 1.0)

    def poll_pending(self) -> None:
        """Each Meet room still pending, read once a second until Google fills
        in its link or the 30 s wait runs out."""
        for rid, p in list(self.pending.items()):
            now = self.clock()
            if now < p.next_at:
                continue
            self._busy.add(rid)
            try:
                try:
                    ev = self.google.event(p.calendar, p.eid)  # type: ignore[union-attr]
                except ProviderError as e:
                    if self.clock() >= p.until:
                        self.pending.pop(rid, None)
                        self.fail(p.room, SAY["meet_pending"] if e.unclear else
                                  SAY["google_refused"].format(why=e.why), fault=True)
                    else:
                        p.next_at = self.clock() + 1.0
                    continue
                self.pending.pop(rid, None)
                self.track_meet(p.room, p.calendar, p.eid, ev)
            except (SupabaseError, http.HttpError) as e:
                self._db_trouble(e)
            except Exception as e:  # noqa: BLE001
                self.pending.pop(rid, None)
                self.log.error(f"rooms: Meet room {p.room.get('code')} stopped on an error: {http.scrub(repr(e))[:300]}")
                self.fail(p.room, SAY["error"], fault=True)
            finally:
                self._busy.discard(rid)
            self._maybe_status()

    def resume_meet(self, room: dict[str, Any], age: float) -> None:
        """A Meet room another run left in `creating` (its run ended while
        Google was still pending, or it died): read by its event id."""
        if not self.google:
            self.fail(room, SAY["google_keys"], fault=True)
            return
        cal = self._calendar_or_fail(room)
        if not cal:
            return
        eid = event_id(room["id"])
        try:
            ev = self.google.event(cal, eid)
        except ProviderError as e:
            if e.status in (404, 410):
                if self.clock() < self._meet_until(room):
                    self.start_meet(room)  # it was claimed and never inserted
                else:
                    self.fail(room, SAY["lost"], fault=True)
            elif (e.unclear or e.status == 429) and age <= GIVE_UP_S:
                self._retry_at[str(room["id"])] = self.clock() + ORPHAN_RETRY
            else:
                self._meet_refused(room, e)
            return
        self.track_meet(room, cal, eid, ev)

    # ---- rooms nobody is working on -------------------------------------------
    def orphan(self, room: dict[str, Any]) -> None:
        rid = str(room["id"])
        now = self.clock()
        if self._retry_at.get(rid, 0) > now:
            return
        since = parse_ts(room.get("claimed_at")) or parse_ts(room.get("requested_at")) or now
        age = now - since
        mine = room.get("worker_run") == self.run_id
        # A Meet room is safe to adopt at once (its event id is fixed). A Zoom
        # room another run holds may be in the middle of its create, so it is
        # left for the 60 s of the state table.
        if not (room.get("provider") == "meet" or mine or age > self.waits("fail", 60)):
            return
        adopted = self.adopt(room)
        if not adopted:
            return
        if self.settings.get("enabled") is False:
            self.fail(adopted, SAY["switched_off"], refusal=True)
        elif adopted.get("provider") == "meet":
            self.resume_meet(adopted, age)
        elif adopted.get("provider") == "zoom":
            self.recover_zoom(adopted, age)
        else:
            self.fail(adopted, SAY["provider"], refusal=True)

    def adopt(self, room: dict[str, Any]) -> Optional[dict[str, Any]]:
        old = room.get("worker_run")
        if old == self.run_id:
            return room
        where = f"id=eq.{_q(room['id'])}&state=eq.creating&" + (f"worker_run=eq.{_q(old)}" if old else "worker_run=is.null")
        got = self.sb.patch_returning(ROOMS, where, {"worker_run": self.run_id})
        return got[0] if got else None

    def _fail_unclaimed(self, room: dict[str, Any], sentence: str) -> None:
        try:
            got = self.sb.patch_returning(
                ROOMS, f"id=eq.{_q(room['id'])}&state=eq.requested",
                {"state": "failed", "error": sentence, "result": "failed", "ended_at": iso(self.clock()),
                 "version": int(room.get("version") or 0) + 1})
        except (SupabaseError, http.HttpError) as e:
            self._db_trouble(e)
            return
        if got:
            self._after_fail(got[0], sentence, fault=True)

    # ---- the two endings of a make ---------------------------------------------
    def _host_by_and_ends(self, room: dict[str, Any], now: float) -> dict[str, Any]:
        """Deadlines sales-api did not set already, from the moment the room
        opened: the host's wait by purpose, and the room's length."""
        out: dict[str, Any] = {}
        if not room.get("host_by"):
            wait = {"handover": self.waits("handover_host", 120), "standby": self.waits("standby_host", 300)}.get(
                str(room.get("purpose") or ""), self.waits("fallback_host", 900))
            out["host_by"] = iso(now + wait)
        if not room.get("ends_at"):
            try:
                minutes = int((self.settings.get("lengths_min") or {}).get(room.get("call_kind")) or 30)
            except (TypeError, ValueError):
                minutes = 30
            out["ends_at"] = iso(now + minutes * 60)
        return out

    def finish(self, room: dict[str, Any], *, provider: str, meeting_id: Any, join_url: str, start_url: str) -> bool:
        rid = str(room["id"])
        now = self.clock()
        self.pending.pop(rid, None)
        if not join_url:
            self.fail(room, SAY["zoom_down"] if provider == "zoom" else SAY["meet_pending"], fault=True)
            return False
        # 1. The host link, where only the service role reads it.
        self.sb.upsert(SECRETS, [{"room_id": rid, "start_url": start_url or join_url,
                                  "expires_at": iso(now + START_URL_TTL)}], "room_id")
        # 2. The room, open, only if it is still this run's and still being made.
        body = {"state": "open", "join_url": join_url, "provider_meeting_id": str(meeting_id),
                "opened_at": iso(now), "error": None, "version": int(room.get("version") or 0) + 1,
                **self._host_by_and_ends(room, now)}
        got = self.sb.patch_returning(
            ROOMS, f"id=eq.{_q(rid)}&state=eq.creating&worker_run=eq.{_q(self.run_id)}", body)
        if not got:
            current = self._read(rid)
            if current and current.get("state") in FINAL:
                # Cancelled while it was being made: nothing of it stays open.
                try:
                    self._close_provider({**room, **current, "provider_meeting_id": str(meeting_id)})
                    self._drop_secret(rid)
                except ProviderError as e:
                    # The host link stays until Zoom closes it: close_finals
                    # tries again every ten seconds.
                    self.log.warn(f"rooms: Zoom did not close cancelled room {room.get('code')} yet: {e.why}")
                self._count("withdrawn")
                self.log.info(f"rooms: room {room.get('code')} was {current.get('state')} while it was being made; "
                              "its meeting is closed")
            self._made.pop(rid, None)
            return False
        self._made.pop(rid, None)
        opened = got[0]
        payload = {"provider": provider, "provider_meeting_id": str(meeting_id), "worker_run": self.run_id,
                   "seconds": round(now - (parse_ts(room.get("requested_at")) or now), 1)}
        self.store_event(rid, "worker.ready", payload)
        self.notify(rid, "worker.ready", payload)
        self._count("made")
        self._count(provider)
        self.log.info(f"rooms: room {opened.get('code') or room.get('code')} ready on {provider} "
                      f"{payload['seconds']}s after it was asked for")
        return True

    def fail(self, room: dict[str, Any], sentence: str, *, fault: bool = False, refusal: bool = False) -> bool:
        rid = str(room["id"])
        self.pending.pop(rid, None)
        made = self._made.pop(rid, None)
        if made and self.zoom:
            try:
                self.close_zoom(made)
            except ProviderError as e:
                self.log.warn(f"rooms: the Zoom meeting of failed room {room.get('code')} could not be deleted: {e.why}")
        got = self.sb.patch_returning(
            ROOMS, f"id=eq.{_q(rid)}&state=in.(requested,creating)",
            {"state": "failed", "error": sentence, "result": "failed", "ended_at": iso(self.clock()),
             "version": int(room.get("version") or 0) + 1})
        if not got:
            return False
        self._after_fail(got[0], sentence, fault=fault, refusal=refusal)
        return True

    def _after_fail(self, room: dict[str, Any], sentence: str, *, fault: bool = False, refusal: bool = False) -> None:
        rid = str(room["id"])
        self._retry_at.pop(rid, None)
        self.store_event(rid, "worker.failed", {"error": sentence, "worker_run": self.run_id})
        self.notify(rid, "worker.failed", {"error": sentence, "worker_run": self.run_id})
        self._count("failed")
        if refusal:
            self._count("refused")
        if fault:
            self._fault(sentence)
        (self.log.warn if fault else self.log.info)(f"rooms: room {room.get('code')} failed: {sentence}")

    # ---- telling sales-api -------------------------------------------------------
    def store_event(self, room_id: str, kind: str, detail: dict[str, Any]) -> None:
        """The worker's event, kept like the door's Zoom events so the sweep
        can replay one sales-api never handled. Best effort: the call that
        follows is the main path."""
        try:
            self.sb.rest("POST", f"{EVENTS}?on_conflict=dedupe_key",
                         json_body=[{"room_id": room_id, "kind": kind, "source": "worker",
                                     "dedupe_key": f"{kind}:{room_id}", "detail": detail}],
                         prefer="resolution=ignore-duplicates,return=minimal", retries=1)
        except (SupabaseError, http.HttpError) as e:
            if not self._event_warned:
                self._event_warned = True
                self.log.warn(f"rooms: room events are not being stored: {http.scrub(str(e))[:200]}")

    def notify(self, room_id: str, kind: str, payload: dict[str, Any], tries: int = 0) -> None:
        if not self.api:
            return
        outcome, why = self.api.event(kind, room_id, payload)
        if outcome == "delivered":
            self._renotify.pop((room_id, kind), None)
            return
        if outcome == "refused":
            self._renotify.pop((room_id, kind), None)
            self.log.warn(f"rooms: sales-api refused {kind} for room {room_id}: {why}")
            return
        if tries + 1 >= RENOTIFY_TRIES:
            self._renotify.pop((room_id, kind), None)
            self._count("notify_lost")
            self.log.warn(f"rooms: sales-api did not take {kind} for room {room_id} after {tries + 1} tries; "
                          "the sweep replays the stored event")
            return
        self._renotify[(room_id, kind)] = (self.clock() + RENOTIFY_EVERY, tries + 1, payload)

    def _retry_notifications(self) -> None:
        now = self.clock()
        for (rid, kind), (at, tries, payload) in list(self._renotify.items()):
            if at <= now:
                self.notify(rid, kind, payload, tries)

    # ---- final rooms: close the provider side ---------------------------------------
    def _close_provider(self, room: dict[str, Any]) -> None:
        """Zoom only, and never a room a lead reached or a booked call's own meeting."""
        if (room.get("provider") != "zoom" or not room.get("provider_meeting_id") or room.get("lead_in_at")
                or room.get("purpose") == "booked" or not self.zoom):
            return
        self.close_zoom(room["provider_meeting_id"])

    def _drop_secret(self, room_id: str) -> None:
        self.sb.rest("DELETE", f"{SECRETS}?room_id=eq.{_q(room_id)}", prefer="return=minimal")

    def close_finals(self) -> None:
        secrets = self.sb.select(SECRETS, "select=room_id&limit=200")
        ids = [str(s["room_id"]) for s in secrets if s.get("room_id")]
        if not ids:
            return
        rows = self.sb.select(ROOMS, f"select=*&id=in.{_in(ids)}&state=in.(ended,expired,failed,cancelled)")
        for r in rows:
            rid = str(r["id"])
            try:
                self._close_provider(r)
            except ProviderError as e:
                ended = parse_ts(r.get("ended_at")) or parse_ts(r.get("opened_at")) or self.clock()
                if self.clock() - ended < CLOSE_GIVE_UP_S:
                    self.log.warn(f"rooms: Zoom did not close room {r.get('code')} yet: {e.why}")
                    continue
                self._fault(f"Zoom would not close room {r.get('code')}; its host link is deleted anyway.")
            self._drop_secret(rid)
            self._count("closed")

    # ---- status ------------------------------------------------------------------
    def _maybe_status(self) -> None:
        if self.clock() >= self._status_due:
            self.status()

    def sentence(self) -> tuple[bool, str]:
        w = self.window
        span = max(1, int(round(self.clock() - self._window_from)))
        last = "the last second" if span == 1 else f"the last {span} seconds"
        bits: list[str] = []
        if w["made"] or w["failed"] or w["closed"] or w["withdrawn"]:
            bits.append(f"Working. In {last}: {w['made']} room{'s' if w['made'] != 1 else ''} made "
                        f"({w['zoom']} Zoom, {w['meet']} Meet), {w['failed']} failed"
                        + (f" ({w['refused']} refused for the rep to fix)" if w["refused"] else "")
                        + f", {w['closed']} closed.")
        else:
            bits.append(f"Working. No rooms were asked for in {last}.")
        if w["withdrawn"]:
            bits.append(f"{w['withdrawn']} cancelled while being made, and closed.")
        if self.pending:
            bits.append(f"{len(self.pending)} Meet room{'s are' if len(self.pending) != 1 else ' is'} waiting on Google.")
        ok = True
        providers = self.settings.get("providers") or {}
        if not self.zoom:
            bits.append("The Zoom keys are not set on the VPS (" + ", ".join(ZOOM_KEYS) + "), so Zoom rooms cannot be made.")
            ok = ok and providers.get("zoom") is not True
        if not self.google:
            bits.append("No Google sign-in is set on the VPS (GOOGLE_CAL_CLIENT_ID, GOOGLE_CAL_CLIENT_SECRET, "
                        "GOOGLE_CAL_REFRESH_TOKEN), so Meet rooms cannot be made.")
            ok = ok and providers.get("meet") is not True
        if self.settings.get("enabled") is False:
            bits.append("Video rooms are switched off in Settings.")
        if w["db_refused"]:
            bits.append(f"The database refused the worker's request ({w['db_refused']}). The rooms tables may not "
                        "match this worker: apply the latest sales migration.")
            ok = False
        elif w["db_errors"]:
            bits.append(f"The database did not answer {w['db_errors']} time{'s' if w['db_errors'] != 1 else ''}; "
                        "the worker kept trying.")
            ok = False
        if w["notify_lost"]:
            bits.append(f"sales-api did not take {w['notify_lost']} room message{'s' if w['notify_lost'] != 1 else ''}; "
                        "the sweep sends them again.")
            ok = False
        faults = list(dict.fromkeys(w["faults"]))
        if faults:
            bits.append(f"Last problem: {faults[-1]}")
            ok = False
        return ok, " ".join(bits)

    def status(self, final: bool = False) -> None:
        if final and self._window_empty() and self.clock() - self._window_from < STATUS_EVERY:
            # Nothing new since the last row, which is fresh: keep its
            # sentence rather than overwrite it with an empty few seconds.
            return
        ok, detail = self.sentence()
        self._write_status(ok, detail)
        self.window = self._counts()
        self._window_from = self.clock()
        self._status_due = self.clock() + STATUS_EVERY

    def _write_status(self, ok: bool, detail: str, job: str = JOB) -> None:
        try:
            self.sb.upsert(STATUS, [{"worker": WORKER, "job": job, "ok": bool(ok),
                                     "detail": http.scrub(detail)[:1000], "at": iso(self.clock())}], "worker,job")
        except (SupabaseError, http.HttpError) as e:
            self.log.warn(f"rooms: the status row was not written: {http.scrub(str(e))[:200]}")

    # ---- the host check (the doctor) ---------------------------------------------
    def google_check(self) -> tuple[Optional[bool], str]:
        if not self.google:
            return False, ("Google: no sign-in is set on the VPS (GOOGLE_CAL_CLIENT_ID, GOOGLE_CAL_CLIENT_SECRET and "
                           "GOOGLE_CAL_REFRESH_TOKEN, or the editor desk's GOOGLE_*), so Meet rooms cannot be made.")
        try:
            self.google.token()
        except ProviderError as e:
            if e.unclear or e.status == 429:
                return None, f"Google: the sign-in could not be checked ({e.why}); the last known state stays."
            return False, (f"Google refused the sign-in in {self.google.source} ({e.why}), so Meet rooms cannot be "
                           "made. Connect Google Calendar again.")
        try:
            name = self.calendar_name.strip().casefold()
            found = self._calendar or next((str(c["id"]) for c in self.google.calendars()
                                            if str(c.get("summary") or "").strip().casefold() == name and c.get("id")), "")
        except ProviderError as e:
            if e.unclear or e.status == 429:
                return None, f"Google: Calendar did not answer ({e.why}); the last known state stays."
            return False, (f"Google: the sign-in in {self.google.source} cannot use Calendar ({e.why}), so Meet rooms "
                           "cannot be made. Connect Google Calendar for the CEO's account.")
        if found:
            return True, f"Google: signed in with {self.google.source}; the {self.calendar_name} calendar is ready."
        return True, (f"Google: signed in with {self.google.source}; the {self.calendar_name} calendar does not exist "
                      "yet and is made with the first Meet room.")

    def zoom_seat(self, email: str, who: str) -> dict[str, Any]:
        if not self.zoom:
            return {"status": None, "line": f"{who}: Zoom not checked, because the Zoom keys are not set on the VPS."}
        self._users.pop(email.strip().lower(), None)
        try:
            user, status = self.zoom_user(email)
        except ProviderError as e:
            return {"status": None, "line": f"{who}: Zoom refused the check ({e.why}); the last known status stays."}
        if status is None:
            return {"status": None, "line": f"{who}: Zoom did not answer; the last known status stays."}
        live_until = None
        if status in ("licensed", "basic") and user and user.get("id"):
            try:
                ends = []
                for m in self.zoom.live(str(user["id"])):
                    start = parse_ts(m.get("start_time"))
                    minutes = float(m.get("duration") or 0)
                    ends.append((start + minutes * 60) if start and minutes else self.clock() + HOSTS_EVERY)
                live_until = iso(max(ends)) if ends else None
            except ProviderError:
                live_until = None
        line = {
            "licensed": f"{who}: Zoom licensed, so Zoom rooms have no time limit.",
            "basic": f"{who}: Zoom Basic, so meetings end at 40 minutes and demos go on Meet.",
            "pending": f"{who}: Zoom invite not accepted yet, so rooms go on Meet until it is.",
            "missing": f"{who}: no Zoom user that can host on Mahara's account, so rooms go on Meet.",
        }[status]
        if live_until:
            line += " In a Zoom meeting now."
        return {"status": status, "user_id": (user or {}).get("id"), "live_until": live_until, "line": line}

    def check_hosts(self) -> dict[str, Any]:
        """Every seat's Zoom user and status, whether Google works, and the
        room each seat gets by default, into `cockpit_sales_room_hosts`."""
        now = self.clock()
        google_ok, gline = self.google_check()
        lines = [gline]
        people = [p for p in self.sb.select(PEOPLE, "select=email,name,role,active&limit=500")
                  if p.get("email") and p.get("active") is not False and p.get("role") in SEAT_ROLES]
        if not people:
            lines.append("No active sales seat to check.")
        defaults = self.settings.get("default_provider") or {}
        rows: list[dict[str, Any]] = []
        for p in sorted(people, key=lambda x: str(x["email"]).lower()):
            email = str(p["email"]).strip().lower()
            role = str(p.get("role") or "")
            seat = self.zoom_seat(email, f"{email} ({role})")
            default = default_provider(role, seat["status"], google_ok, defaults)
            row: dict[str, Any] = {"email": email, "default_provider": default}
            if google_ok is not None:
                row["google_ok"] = google_ok
            if seat["status"] is not None:
                row.update({"zoom_user_id": str(seat["user_id"]) if seat.get("user_id") else None,
                            "zoom_status": seat["status"], "zoom_live_until": seat["live_until"],
                            "checked_at": iso(now)})
            rows.append(row)
            lines.append(seat["line"] + f" Default room: {'Zoom' if default == 'zoom' else 'Meet'}.")
        if rows:
            self.sb.upsert(HOSTS, rows, "email")
        ok = bool(self.zoom) and google_ok is True
        self._write_status(ok, " ".join(lines), job=HOSTS_JOB)
        return {"ok": ok, "lines": lines, "rows": rows}


def supabase(url: str, service_key: str) -> Supabase:
    """The worker's database door: short timeouts, because it polls every second."""
    if not url or not service_key:
        raise SupabaseError("DESK_SUPABASE_URL and DESK_SUPABASE_KEY are not set (~/.editor-desk/env)")
    return Supabase(url, service_key, timeout=10)
