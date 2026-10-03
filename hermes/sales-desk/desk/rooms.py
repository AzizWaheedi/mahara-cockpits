"""The room worker: the sales cockpit's video rooms, made on the VPS.

How a room is made
- sales-api inserts a row in `cockpit_sales_rooms` in state `requested`. It
  has already checked the seat, the switches, the client and do-not-disturb
  rules and the host; this worker never decides who may have a room. It does
  check the switches again: a room is made only while `rooms.enabled` is true
  and that provider's `rooms.providers` switch is true. A missing or
  unreadable setting is off, and a run that has not read the setting claims
  nothing.
- The worker claims it with a conditional PATCH (`state=eq.requested`), so two
  runs, or fifty, can never make the same room twice: only the update that
  still sees `requested` gets the row back.
- Zoom: the host's own Zoom user on Mahara's account, the one the Team page
  linked in `cockpit_sales_room_hosts.zoom_user_id` when there is one, else
  the user with the seat's email. Before anything is made it checks the host
  has no live meeting (Zoom allows one at a time; the meetings of the host's
  own finished cockpit rooms do not count) and that a demo is not on a Basic
  seat (Basic ends at 40 minutes). The meeting is type 2 with no start time,
  topic "Mahara call {code}" (the topic carries only the code, and the code is
  how a lost room is found again), a waiting room for anyone outside the
  account, nobody in before the host, no recording, and the passcode inside
  the link.
- Meet: a Calendar event on the calendar "Sales rooms" (made once if missing,
  or the one in SALES_ROOMS_CALENDAR_ID) through the CEO's Google sign-in,
  `conferenceDataVersion=1`, `sendUpdates=none`, no attendees, title "Mahara
  call {code}", and the room's uuid as the event id (base32hex), so an insert
  repeated after a crash finds the first one (409) instead of making a second.
  Google often answers "pending" first; the event is read every second for
  up to 30 s.
- It puts the host link (`start_url`) in `cockpit_sales_room_secrets`, which
  only the service role reads, stores a `worker.ready` event, then saves
  `join_url` and `provider_meeting_id` and sets the room `open`, then calls
  sales-api `room.event {kind: 'worker.ready'}` once. The event is stored
  before the room opens, so an open room always has one for the sweep to
  replay; the call is only the fast path. If the answer to the open write is
  lost, the room is read again and, when it is open with this run's meeting,
  the run goes on as if the answer had come.
- A refusal or a provider failure sets the room `failed` with a sentence the
  rep can act on, stores `worker.failed` and calls `room.event` the same way.

Never blocked by one provider
- Every call has a short timeout (4 s for a read, 8 s for a create, 3 s for a
  close) and each provider has its own breaker: two calls that time out
  within a minute and that provider is "down" for 30 s, so its new rooms fail
  at once with a sentence ("Zoom did not answer. Try again in a minute, or use
  Meet.") and the other provider's rooms are made as usual. sales-api has a
  breaker too; while it is down the stored events wait for the sweep.
- In a tick, new rooms are claimed first; then Meet rooms waiting on Google
  are read; then at most one room another run left behind is picked up and
  at most one finished room's Zoom meeting is closed.

Timing
- One run lasts about 57 s (`--for 57`) and polls every second, under a cron
  line every minute with `flock -w 10`. It claims up to 3 rooms a tick, stops
  claiming 3 s before its end (12 s for a Zoom room, which takes several
  calls), and nothing runs past 2 s after its end: provider and database
  calls alike get the time that is left as their timeout, and the database
  door never retries inside the HTTP layer (the next tick is the retry).
- A Meet room still waiting on Google when a run ends is left in `creating`
  and adopted by the next run at once: the event id is fixed, so reading it
  again is always safe. A Zoom room whose make the run's end cut short is
  marked handed over (`worker_run = handover:{run}`, or `unclear:{run}` when a
  create was sent and its answer never came) and the next run adopts it at
  once: it finds the meeting by its code, and makes one only when no create
  was ever sent. A run's id carries the second it stops, so a run that died
  is known to be over and its rooms are adopted at once too.
- Crash recovery: a meeting this run made is read by its id; else a Zoom room
  is found by the code in its topic, and a Meet room by its event id; else it
  fails. Each lost room is retried at 1, 2, 4 ... 15 s.
- Final rooms: the host link is always deleted. A Zoom meeting that never
  started is deleted. A started one is ended only when Zoom's live participant
  list shows nobody outside the team (room hosts and seats); with someone
  else in it, or when that list cannot be read, the meeting is left open, an
  alert is raised and the room is checked again every minute (H7: never end a
  room with a lead in it). The meeting's uuid is stored in `room_events`
  before it is deleted, for the participant report. Never anything for a
  room that reached `lead_in`, nor for a `booked` room, which wraps the
  appointment's own meeting. A Meet link cannot be stopped; only its host
  link is deleted.
- The status row (worker `sales-desk`, job `rooms`) is written at least every
  30 s with a plain sentence; the cockpit's health line reads its time.

The host check (`rooms --check-hosts`, its own cron line every 10 minutes)
writes each seat's Zoom status into `cockpit_sales_room_hosts` without
touching what the Team page set (`zoom_user_id`, `default_provider`), checks
the Google sign-in can use Calendar, and checks the Zoom rooms that ended in
the last day against Zoom's participant report. Its status row is
`sales-desk` / `room-hosts`.

Keys, by name only, never printed: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID,
ZOOM_CLIENT_SECRET (the server-to-server app webinar-pull uses);
GOOGLE_CAL_CLIENT_ID, GOOGLE_CAL_CLIENT_SECRET, GOOGLE_CAL_REFRESH_TOKEN (the
CEO's calendar sign-in), or else GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
GOOGLE_REFRESH_TOKEN (the CEO's Google connection on the box, checked live
by the doctor: it must carry a Calendar permission); DESK_SUPABASE_URL and
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
ALERTS = "cockpit_sales_alerts"
PEOPLE = "cockpit_sales_people"
SETTINGS = "cockpit_sales_settings"
SETTING = "rooms"
JOB = "rooms"
HOSTS_JOB = "room-hosts"

FINAL = ("ended", "expired", "failed", "cancelled")
LIVE_STATES = ("open", "host_in", "lead_in")
SEAT_ROLES = ("setter", "closer", "both", "manager")
ZOOM_KEYS = ("ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET")
GOOGLE_KEY_SETS = (
    ("GOOGLE_CAL_CLIENT_ID", "GOOGLE_CAL_CLIENT_SECRET", "GOOGLE_CAL_REFRESH_TOKEN"),
    ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"),
)
# Either lets the worker put events on a calendar; only the first lists or
# makes calendars, which SALES_ROOMS_CALENDAR_ID makes unnecessary.
CALENDAR_SCOPES = ("https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/calendar.events")
TOPIC = "Mahara call {code}"
CALENDAR_NAME = "Sales rooms"

RUN_SECONDS = 57.0
EVERY = 1.0
MAX_CLAIMS = 3
CLAIM_MARGIN = 3.0        # no new claim in the last 3 s of a run
ZOOM_CLAIM_MARGIN = 12.0  # ... and no new Zoom claim in its last 12 s: a Zoom room takes several calls
HARD_SLACK = 2.0          # nothing runs more than 2 s past the run's end
PROVIDER_RESERVE = 1.5    # provider calls end this long before that, so the run can still write down
                          # what it did (a room handed over, the status row)
STATUS_EVERY = 25.0       # the status row, at least every 30 s
SETTINGS_EVERY = 25.0     # the rooms setting is read again this often
SETTINGS_STALE_S = 60.0   # with no good read of it for this long, nothing new is claimed
CLOSE_SCAN_EVERY = 10.0   # finished rooms are looked for this often
STALE_S = 600.0           # a room asked for this long ago is failed, not made (the sweep fails one at 60 s)
GIVE_UP_S = 300.0         # a lost room whose provider does not answer is failed after this
CLOSE_GIVE_UP_S = 600.0   # a meeting Zoom will not close: the host link is deleted anyway
HOLD_GIVE_UP_S = 3 * 3600.0  # a meeting left open with someone in it is checked this long
HOLD_RECHECK_S = 60.0
START_URL_TTL = 7200.0    # Zoom's start_url lasts two hours for a regular user
HOSTS_EVERY = 600.0
HOSTS_BUDGET = 240.0      # the host check's own time limit
REPORT_WINDOW_S = 24 * 3600.0
REPORT_PER_RUN = 10

READ_TIMEOUT = 4.0
WRITE_TIMEOUT = 8.0
TOKEN_TIMEOUT = 6.0
CLOSE_TIMEOUT = 3.0
NOTIFY_TIMEOUT = 4.0
DB_TIMEOUT = 10.0
CALL_TIMEOUT = READ_TIMEOUT
API_TIMEOUT = NOTIFY_TIMEOUT

BREAK_AFTER = 2           # slow failures ...
BREAK_WINDOW = 60.0       # ... within this long ...
BREAK_FOR = 30.0          # ... and the provider is skipped for this long
SLOW_FAILURE_S = 2.0      # a failure without an answer that took this long counts, like a timeout

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "providers": {"zoom": False, "meet": False},
    "default_provider": {"setter": "meet", "closer": "zoom"},
    "waits_s": {"fail": 60, "meet_pending": 30, "handover_host": 120, "standby_host": 300,
                "fallback_host": 900},
    "lengths_min": {"intro": 30, "demo": 60},
}

# What the rep reads on the room panel when a room cannot be made. Plain,
# active, and each one says what to do next and who does it.
SAY = {
    "busy": "Your Zoom is in another meeting. End it or use Meet.",
    "basic_demo": "The closer's Zoom is Basic and ends at 40 minutes. Use Meet for this demo.",
    "pending": "Your Zoom invite is not accepted yet. Accept it from Zoom's email, or use Meet.",
    "no_user": "Your email has no Zoom user on Mahara's account. Use Meet, and ask the CEO to add you in Zoom.",
    "zoom_keys": "Zoom is not connected on the room worker. Use Meet, and ask the CEO to set the Zoom keys on the VPS.",
    "zoom_refused": "Zoom refused to make the room: {why}. Use Meet.",
    "zoom_down": "Zoom did not answer. Try again in a minute, or use Meet.",
    "zoom_off": "Zoom rooms are switched off. Use Meet, or ask a manager to switch Zoom on in Settings.",
    "google_keys": "Google is not connected on the room worker. Use Zoom, and ask the CEO to connect Google Calendar on the VPS.",
    "google_signin": ("Google refused the room worker's sign-in. Use Zoom, and ask the CEO to connect Google "
                      "Calendar again."),
    "google_scope": ("The room worker's Google sign-in cannot use Calendar. Use Zoom, and ask the CEO to connect "
                     "Google Calendar on the VPS."),
    "meet_pending": "Google did not make the Meet link. Try Zoom.",
    "google_refused": "Google refused to make the Meet room: {why}. Try Zoom.",
    "google_down": "Google did not answer. Try again in a minute, or use Zoom.",
    "calendar": ("Google would not make the Sales rooms calendar. Use Zoom, and ask the CEO to create a calendar "
                 "named Sales rooms in Google Calendar."),
    "meet_off": "Meet rooms are switched off. Use Zoom, or ask a manager to switch Meet on in Settings.",
    "switched_off": "Video rooms are switched off. A manager can switch them on in Settings.",
    "too_late": "The room worker did not pick this room up in time. Make a new room.",
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


def role_default(role: str, defaults: dict[str, Any]) -> str:
    """The room a role gets when nobody chose one: the closer's default for a
    closer, the setter's for every other seat (as cockpit_sales_presence)."""
    d = defaults or {}
    base = str(d.get("closer") or "zoom") if role == "closer" else str(d.get("setter") or "meet")
    return base if base in ("zoom", "meet") else ("zoom" if role == "closer" else "meet")


def default_provider(role: str, zoom_status: Optional[str], google_ok: Optional[bool],
                     defaults: dict[str, Any], *, zoom_keys: bool = True) -> str:
    """The room that would work for a seat: its role's default, unless that
    one cannot work and the other can. Zoom cannot host for a seat whose
    invite is pending, which has no user, or when the worker has no Zoom keys;
    Meet cannot when the Google sign-in does not work."""
    base = role_default(role, defaults)
    zoom_unusable = not zoom_keys or zoom_status in ("pending", "missing")
    if base == "zoom" and zoom_unusable and google_ok is not False:
        return "meet"
    if base == "meet" and google_ok is False and zoom_keys and zoom_status in ("licensed", "basic"):
        return "zoom"
    return base


_RUN_END = re.compile(r"-e(\d{9,11})$")


def run_ends(worker_run: Any) -> Optional[float]:
    """The second a run stops, from its id ("...-e1790000000"): after it,
    whatever that run left in `creating` is nobody's."""
    m = _RUN_END.search(str(worker_run or ""))
    return float(m.group(1)) if m else None


def meeting_uuid_path(value: Any) -> str:
    """A meeting uuid in a URL path: Zoom asks for it encoded twice when it
    starts with a slash or holds two in a row."""
    text = str(value or "")
    once = urllib.parse.quote(text, safe="")
    return urllib.parse.quote(once, safe="") if text.startswith("/") or "//" in text else once


def db_reason(e: Exception) -> str:
    """What the database said, short: PostgREST's code and message only.
    `details` and `hint` echo the row that was refused, which can carry a
    host link, so they are never kept."""
    status = int(getattr(e, "status", 0) or 0)
    data: Any = None
    raw = getattr(e, "body", b"") or b""
    try:
        data = json.loads(raw.decode("utf-8")) if raw else None
    except (ValueError, UnicodeDecodeError):
        data = None
    if not isinstance(data, dict):
        m = re.search(r"\{.*\}", str(e), re.S)
        if m:
            try:
                data = json.loads(m.group(0))
            except ValueError:
                data = None
    if isinstance(data, dict) and (data.get("code") or data.get("message")):
        code, message = str(data.get("code") or "").strip(), str(data.get("message") or "").strip()
        out = f"{code}: {message}" if code and message else (message or code)
    elif status:
        out = f"HTTP {status}"
    else:
        out = str(e).split("\n", 1)[0]
    return http.scrub(out)[:160]


# ---- HTTP: one door for Zoom, Google and sales-api --------------------------


class ProviderError(Exception):
    def __init__(self, status: int, message: str, *, code: Any = None, reason: str = "", where: str = "",
                 down: bool = False, timeup: bool = False, timed_out: bool = False):
        self.status = int(status or 0)
        self.code = code
        self.reason = reason
        self.where = where
        self.down = down            # not called: the provider's breaker is open
        self.timeup = timeup        # not called: the run's time is up
        self.timed_out = timed_out
        # http.scrub hides keys, Zoom host tokens (zak=) and passcodes (pwd=),
        # whatever a provider echoes back.
        self.message = http.scrub(message)[:240]
        super().__init__(f"{where} {self.status}: {self.message}" if self.status else f"{where}: {self.message}")

    @property
    def unclear(self) -> bool:
        """The call may or may not have done its work: a dropped connection,
        a timeout or a server error."""
        return self.status == 0 or self.status >= 500

    @property
    def gone(self) -> bool:
        return self.status == 404 or str(self.code) in ("3001", "1001")

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
            else:  # Zoom, PostgREST, sales-api
                code = data.get("code")
                message = str(data.get("message") or data.get("reason") or err or "")
        if not message:
            message = str(e).split(": ", 1)[-1] if e.status else str(e)
        return cls(e.status, message, code=code, reason=reason, where=where, timed_out=e.timed_out)


class Breaker:
    """One per provider. Two slow failures (a timeout, or no answer after
    2 s) within a minute and the provider is skipped for 30 s: its calls fail
    at once instead of each holding the loop for its timeout. After the 30 s
    one call goes through; if that one is slow too, it is skipped again."""

    def __init__(self, name: str, clock: Callable[[], float]):
        self.name = name
        self.clock = clock
        self.fails: list[float] = []
        self.open_until = 0.0
        self.trips = 0

    def blocked(self) -> bool:
        return self.clock() < self.open_until

    def failed(self) -> None:
        now = self.clock()
        self.fails = [t for t in self.fails if now - t < BREAK_WINDOW] + [now]
        if len(self.fails) >= BREAK_AFTER:
            self.open_until = now + BREAK_FOR
            self.trips += 1

    def answered(self) -> None:
        self.fails = []


def _parse(raw: bytes) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return raw.decode("utf-8", "replace")


class Sender:
    """A timeout on every call, never past the run's hard stop; at most two
    retries, only on an answer that says "again" (429, or a 5xx on a call that
    is safe to repeat) or a dropped connection on a safe call. A timeout is
    never retried: it goes to the provider's breaker instead."""

    def __init__(self, clock: Callable[[], float], sleep: Callable[[float], None],
                 left: Optional[Callable[[], Optional[float]]] = None):
        self.clock = clock
        self.sleep = sleep
        self.left = left or (lambda: None)

    def _left(self) -> Optional[float]:
        """The time a provider call may use: the run's, less the reserve its
        own last database writes need."""
        left = self.left()
        return None if left is None else left - PROVIDER_RESERVE

    def __call__(self, method: str, url: str, *, headers: Optional[dict[str, str]] = None, body: Any = None,
                 form: Any = None, timeout: float = READ_TIMEOUT, retries: int = 2,
                 safe: bool = True, breaker: Optional[Breaker] = None) -> tuple[int, Any]:
        h = dict(headers or {})
        data: Optional[bytes] = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            h["Content-Type"] = "application/json"
        elif form is not None:
            data = urllib.parse.urlencode(form).encode("utf-8") if isinstance(form, dict) else bytes(form)
            h["Content-Type"] = "application/x-www-form-urlencoded"
        where = urllib.parse.urlsplit(url).netloc
        retries = max(0, min(2, int(retries)))
        attempt = 0
        while True:
            left = self._left()
            if left is not None and left <= 0.5:
                # Past the run's hard stop nothing new starts: the next
                # minute's run must find the lock free.
                raise ProviderError(0, "this run's time is up", where=where, timeup=True)
            if breaker is not None and breaker.blocked():
                raise ProviderError(0, f"{breaker.name} did not answer twice in the last minute", where=where,
                                    down=True)
            t = timeout if left is None else max(0.25, min(timeout, left - 0.5))
            started = self.clock()
            try:
                status, _h, raw = http.request(method, url, headers=h, data=data, timeout=t, retries=0,
                                               ok_statuses=(200, 201, 202, 204))
                if breaker is not None:
                    breaker.answered()
                return status, _parse(raw)
            except http.HttpError as e:
                err = ProviderError.of(e, url)
                if breaker is not None:
                    if err.status:
                        breaker.answered()
                    elif e.timed_out or self.clock() - started >= SLOW_FAILURE_S:
                        breaker.failed()
                again = (err.status == 429 or (safe and err.status >= 500)
                         or (safe and err.status == 0 and not e.timed_out))
                if breaker is not None and breaker.blocked():
                    again = False
                left = self._left()
                if not again or attempt >= retries or (left is not None and left <= 1.5):
                    raise err
                attempt += 1
                wait = float(attempt)
                if left is not None:
                    wait = max(0.0, min(wait, left - 1.5))
                self.sleep(wait)


class TimeUp(SupabaseError):
    """A database call not made because the run's time is up."""


class RoomsDb(Supabase):
    """The worker's database door. Every call's timeout is the time the run
    has left (at most 10 s), and the HTTP layer never retries: its retries
    sleep for real, up to 30 s on a Retry-After, which would keep the run, and
    the cron lock, past its minute. The next tick is the retry."""

    def __init__(self, url: str, service_key: str, left: Callable[[], Optional[float]]):
        super().__init__(url, service_key, timeout=DB_TIMEOUT)
        self._left = left

    @classmethod
    def around(cls, sb: Supabase, left: Callable[[], Optional[float]]) -> "RoomsDb":
        return cls(sb.url, sb.key, left)

    def rest(self, method: str, path: str, *, json_body: Any = None, prefer: Optional[str] = None,
             retries: int = 0) -> Any:
        left = self._left()
        timeout = DB_TIMEOUT
        if left is not None:
            if left <= 0.5:
                raise TimeUp("this run's time is up, so the database was not asked")
            timeout = max(0.25, min(DB_TIMEOUT, left - 0.5))
        headers = self._headers(prefer)
        data = None
        if json_body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(json_body, ensure_ascii=False, default=str).encode("utf-8")
        _, _, body = http.request(method, f"{self.url}/rest/v1/{path}", headers=headers, data=data,
                                  timeout=timeout, retries=0, ok_statuses=(200, 201, 204))
        if not body:
            return None
        try:
            return json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return body.decode("utf-8", "replace")


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
        self.breaker = Breaker("Zoom", send.clock)
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
            headers={"Authorization": f"Basic {basic}"}, form=b"", timeout=TOKEN_TIMEOUT, breaker=self.breaker)
        token = str((data or {}).get("access_token") or "") if isinstance(data, dict) else ""
        if not token:
            raise ProviderError(401, "the Zoom app's keys were refused", where="zoom.us")
        self._token = token
        self._expires = self.send.clock() + float((data or {}).get("expires_in") or 3600)
        return token

    def call(self, method: str, path: str, *, query: Optional[dict[str, Any]] = None, body: Any = None,
             retries: int = 2, safe: Optional[bool] = None, timeout: float = READ_TIMEOUT) -> Any:
        q = urllib.parse.urlencode({k: v for k, v in (query or {}).items() if v not in (None, "")})
        url = f"{self.API}{path}" + (f"?{q}" if q else "")
        for auth in range(2):
            try:
                _s, data = self.send(method, url, headers={"Authorization": f"Bearer {self.token()}",
                                                           "Accept": "application/json"},
                                     body=body, retries=retries, timeout=timeout,
                                     safe=(method != "POST") if safe is None else safe, breaker=self.breaker)
                return data
            except ProviderError as e:
                if e.status == 401 and auth == 0:
                    self._token = ""
                    continue
                raise
        raise ProviderError(401, "Zoom refused the app's token twice", where="api.zoom.us")

    def user(self, who: str) -> dict[str, Any]:
        """A user by email or by Zoom user id."""
        out = self.call("GET", f"/users/{_qe(who)}")
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
        out = self.call("POST", f"/users/{_qe(user)}/meetings", body=body, retries=0, safe=False,
                        timeout=WRITE_TIMEOUT)
        return out if isinstance(out, dict) else {}

    def meeting(self, meeting_id: Any, *, timeout: float = READ_TIMEOUT, retries: int = 2) -> dict[str, Any]:
        out = self.call("GET", f"/meetings/{_qe(meeting_id)}", timeout=timeout, retries=retries)
        return out if isinstance(out, dict) else {}

    def end(self, meeting_id: Any) -> None:
        self.call("PUT", f"/meetings/{_qe(meeting_id)}/status", body={"action": "end"}, retries=0,
                  timeout=CLOSE_TIMEOUT)

    def delete(self, meeting_id: Any) -> None:
        # No email to the host about a room nobody needs any more.
        self.call("DELETE", f"/meetings/{_qe(meeting_id)}", retries=0, timeout=CLOSE_TIMEOUT,
                  query={"schedule_for_reminder": "false", "cancel_meeting_reminder": "false"})

    def live_participants(self, meeting_id: Any) -> list[dict[str, Any]]:
        """Who is in a live meeting now (the dashboard's live participant
        list; path UNVERIFIED on Mahara's plan). Any failure is raised: not
        knowing who is inside is never "nobody"."""
        out = self.call("GET", f"/metrics/meetings/{_qe(meeting_id)}/participants",
                        query={"type": "live", "page_size": 300}, retries=0, timeout=CLOSE_TIMEOUT)
        if not isinstance(out, dict) or not isinstance(out.get("participants"), list):
            raise ProviderError(0, "Zoom answered without a participant list", where="api.zoom.us")
        return [p for p in out["participants"] if isinstance(p, dict)]

    def past_participants(self, meeting_ref: Any) -> list[dict[str, Any]]:
        """Everyone who was in a finished meeting (Zoom's participant report;
        path UNVERIFIED on Mahara's plan), by meeting uuid or id."""
        out: list[dict[str, Any]] = []
        token = None
        for _ in range(3):
            page = self.call("GET", f"/past_meetings/{meeting_uuid_path(meeting_ref)}/participants",
                             query={"page_size": 300, "next_page_token": token})
            if not isinstance(page, dict) or not isinstance(page.get("participants"), list):
                raise ProviderError(0, "Zoom answered without a participant report", where="api.zoom.us")
            out.extend(p for p in page["participants"] if isinstance(p, dict))
            token = page.get("next_page_token")
            if not token:
                break
        return out


def google_key_source() -> Optional[tuple[str, str, str, str]]:
    """(client id, secret, refresh token, which names) of the first complete
    Google sign-in on the box, or None."""
    for names in GOOGLE_KEY_SETS:
        values = [key(n).strip() for n in names]
        if all(values):
            prefix = names[0].rsplit("_CLIENT_ID", 1)[0]
            return values[0], values[1], values[2], f"{prefix}_*"
    return None


class CalendarNotMade(ProviderError):
    """Google would not make the "Sales rooms" calendar."""


class Google:
    """Google Calendar through an OAuth refresh token, with the refresh step
    of the editor desk (hermes/editor-desk/desk/drive.py, Drive.token)."""

    TOKEN_URL = "https://oauth2.googleapis.com/token"
    API = "https://www.googleapis.com/calendar/v3"

    def __init__(self, client_id: str, secret: str, refresh: str, source: str, send: Sender):
        self.client_id, self.secret, self.refresh, self.source = client_id, secret, refresh, source
        self.send = send
        self.breaker = Breaker("Google", send.clock)
        self.scopes: Optional[set[str]] = None
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
            "refresh_token": self.refresh, "grant_type": "refresh_token"}, timeout=TOKEN_TIMEOUT,
            breaker=self.breaker)
        token = str((data or {}).get("access_token") or "") if isinstance(data, dict) else ""
        if not token:
            raise ProviderError(401, "Google refused the refresh token", where="oauth2.googleapis.com")
        scope = (data or {}).get("scope")
        if isinstance(scope, str) and scope.strip():
            self.scopes = set(scope.split())
        self._token = token
        self._expires = self.send.clock() + float((data or {}).get("expires_in") or 3600)
        return token

    def calendar_ok(self) -> Optional[bool]:
        """Whether the sign-in carries a Calendar permission: None until a
        token answer said which permissions it has."""
        if self.scopes is None:
            return None
        return any(s in self.scopes for s in CALENDAR_SCOPES)

    def call(self, method: str, path: str, *, query: Optional[dict[str, Any]] = None, body: Any = None,
             retries: int = 2, safe: bool = True, timeout: float = READ_TIMEOUT) -> Any:
        q = urllib.parse.urlencode({k: v for k, v in (query or {}).items() if v not in (None, "")})
        url = f"{self.API}/{path}" + (f"?{q}" if q else "")
        for auth in range(2):
            try:
                _s, data = self.send(method, url, headers={"Authorization": f"Bearer {self.token()}",
                                                           "Accept": "application/json"},
                                     body=body, retries=retries, safe=safe, timeout=timeout, breaker=self.breaker)
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
        # Never repeated: a second calendar would be made.
        out = self.call("POST", "calendars", body={
            "summary": name, "timeZone": "Asia/Kuwait",
            "description": "Video rooms made by the sales cockpit. Each event is one room; its title carries only the room code.",
        }, safe=False, retries=0, timeout=WRITE_TIMEOUT)
        return out if isinstance(out, dict) else {}

    def probe(self, calendar: str) -> None:
        """One event read on a known calendar: needs only the events permission."""
        self.call("GET", f"calendars/{urllib.parse.quote(calendar, safe='')}/events", query={"maxResults": 1})

    def insert(self, calendar: str, body: dict[str, Any]) -> dict[str, Any]:
        # Safe to repeat: the event id is fixed, so a second insert is a 409.
        out = self.call("POST", f"calendars/{urllib.parse.quote(calendar, safe='')}/events",
                        query={"conferenceDataVersion": 1, "sendUpdates": "none"}, body=body, safe=True,
                        timeout=WRITE_TIMEOUT)
        return out if isinstance(out, dict) else {}

    def event(self, calendar: str, eid: str) -> dict[str, Any]:
        out = self.call("GET", f"calendars/{urllib.parse.quote(calendar, safe='')}/events/{urllib.parse.quote(eid, safe='')}")
        return out if isinstance(out, dict) else {}


def check_google(google: Optional[Google], calendar_name: str = CALENDAR_NAME,
                 calendar_id: str = "") -> tuple[Optional[bool], str, str]:
    """(works, sentence, calendar id found) for the Google sign-in, checked
    live: the token, its Calendar permission, then the calendar itself. None
    when Google did not answer, so the last known state stays."""
    if not google:
        return False, ("Google: no sign-in is set on the VPS (GOOGLE_CAL_CLIENT_ID, GOOGLE_CAL_CLIENT_SECRET and "
                       "GOOGLE_CAL_REFRESH_TOKEN, or GOOGLE_*), so Meet rooms cannot be made. Ask the CEO to "
                       "connect Google Calendar on the VPS."), ""
    try:
        google.token()
    except ProviderError as e:
        if e.unclear or e.status == 429:
            return None, f"Google: the sign-in could not be checked ({e.why}); the last known state stays.", ""
        return False, (f"Google refused the sign-in in {google.source} ({e.why}), so Meet rooms cannot be made. "
                       "Ask the CEO to connect Google Calendar again."), ""
    if google.calendar_ok() is False:
        return False, (f"Google: the sign-in in {google.source} has no Calendar permission (it was given for "
                       "something else, such as Drive), so Meet rooms cannot be made. Ask the CEO to connect Google "
                       "Calendar and set GOOGLE_CAL_CLIENT_ID, GOOGLE_CAL_CLIENT_SECRET and GOOGLE_CAL_REFRESH_TOKEN "
                       "on the VPS."), ""
    try:
        if calendar_id:
            google.probe(calendar_id)
            return True, (f"Google: signed in with {google.source}; the calendar in SALES_ROOMS_CALENDAR_ID "
                          "answers."), calendar_id
        name = calendar_name.strip().casefold()
        found = next((str(c["id"]) for c in google.calendars()
                      if str(c.get("summary") or "").strip().casefold() == name and c.get("id")), "")
    except ProviderError as e:
        if e.unclear or e.status == 429:
            return None, f"Google: Calendar did not answer ({e.why}); the last known state stays.", ""
        if e.status == 404 and calendar_id:
            return False, (f"Google: the calendar in SALES_ROOMS_CALENDAR_ID is not one {google.source} can use, "
                           "so Meet rooms cannot be made. Fix the id in ~/.sales-desk/env."), ""
        if e.status == 401:
            return False, (f"Google refused the sign-in in {google.source} ({e.why}), so Meet rooms cannot be "
                           "made. Ask the CEO to connect Google Calendar again."), ""
        return False, (f"Google: the sign-in in {google.source} cannot use Calendar ({e.why}), so Meet rooms "
                       "cannot be made. Ask the CEO to connect Google Calendar for the CEO's account."), ""
    hint = " Set SALES_ROOMS_CALENDAR_ID in ~/.sales-desk/env to skip the calendar list."
    if found:
        return True, (f"Google: signed in with {google.source}; the {calendar_name} calendar is ready.{hint}"), found
    return True, (f"Google: signed in with {google.source}; the {calendar_name} calendar does not exist yet and is "
                  f"made with the first Meet room.{hint}"), ""


def doctor_lines(offline: bool) -> list[tuple[str, Optional[bool], str]]:
    """The doctor's two room lines. Offline: which keys are set. Online: the
    Zoom app's token and the Google sign-in's Calendar permission, live,
    because keys that are present can still not work."""
    out: list[tuple[str, Optional[bool], str]] = []
    zoom_missing = [n for n in ZOOM_KEYS if not key(n)]
    google = google_key_source()
    if offline:
        out.append(("rooms: zoom", None if zoom_missing else True,
                    "set" if not zoom_missing else f"not set ({', '.join(zoom_missing)}): Zoom rooms cannot be made"))
        out.append(("rooms: google", True if google else None,
                    f"{google[3]} set (not checked offline)" if google else
                    "no Google sign-in (GOOGLE_CAL_* or GOOGLE_*): Meet rooms cannot be made"))
        return out
    send = Sender(time.time, time.sleep)
    zoom = Zoom.from_keys(send)
    if not zoom:
        out.append(("rooms: zoom", None, f"not set ({', '.join(zoom_missing)}): Zoom rooms cannot be made"))
    else:
        try:
            zoom.token()
            out.append(("rooms: zoom", True, "the Zoom app's keys work"))
        except ProviderError as e:
            out.append(("rooms: zoom", None if e.unclear else False,
                        f"Zoom did not answer ({e.why}); try again" if e.unclear else
                        f"Zoom refused the app's keys ({e.why}): Zoom rooms cannot be made. The CEO checks the "
                        "server-to-server app in Zoom's marketplace"))
    ok, line, _cal = check_google(Google.from_keys(send), key("SALES_ROOMS_CALENDAR", CALENDAR_NAME).strip() or CALENDAR_NAME,
                                  key("SALES_ROOMS_CALENDAR_ID", "").strip())
    out.append(("rooms: google", None if ok is None and google else (True if ok else (False if google else None)), line))
    return out


class SalesApi:
    """sales-api's desk door, asked with the service key exactly as the
    follow-up agent asks `followup.autosend` (desk.py cmd_followups). One call,
    a short timeout and no retry: the event is already stored, and the sweep
    replays one that sales-api did not mark handled, so a slow or repeated
    call never holds the next room or sends the link twice."""

    def __init__(self, url: str, service_key: str, send: Sender):
        self.url = f"{url.rstrip('/')}/functions/v1/sales-api"
        self.key = service_key
        self.send = send
        self.breaker = Breaker("sales-api", send.clock)

    def event(self, kind: str, room_id: str, payload: dict[str, Any]) -> tuple[str, str]:
        """('delivered' | 'refused' | 'unclear', what happened). The request id
        is the same for one room and kind, so sales-api can treat the sweep's
        replay as the first call (its request-id pattern)."""
        body = {"action": "room.event", "kind": kind, "room_id": room_id,
                "request_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"mahara-room/{kind}/{room_id}")),
                "dedupe_key": f"{kind}:{room_id}", "payload": payload}
        try:
            _s, data = self.send("POST", self.url, headers={
                "Authorization": f"Bearer {self.key}", "x-region": "eu-west-1"},
                body=body, timeout=NOTIFY_TIMEOUT, retries=0, safe=False, breaker=self.breaker)
        except ProviderError as e:
            if e.down or e.timeup or e.status in (0, 429) or e.status >= 500:
                return "unclear", e.why
            return "refused", e.why
        if isinstance(data, dict) and data.get("error"):
            return "refused", http.scrub(str(data.get("error"))).rstrip(". ")[:200]
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


def _s(n: int, word: str, plural: Optional[str] = None) -> str:
    return f"{n} {word if n == 1 else (plural or word + 's')}"


class Worker:
    def __init__(self, sb: Supabase, *, zoom: Optional[Zoom], google: Optional[Google],
                 api: Optional[SalesApi], log: Any, clock: Callable[[], float] = time.time,
                 sleep: Callable[[float], None] = time.sleep, run_id: Optional[str] = None,
                 calendar_name: str = CALENDAR_NAME, calendar_id: str = ""):
        self.clock = clock
        self.sleep = sleep
        self.deadline = clock() + RUN_SECONDS
        self.hard_stop = self.deadline + HARD_SLACK
        self.sb = RoomsDb.around(sb, self.left)
        self.zoom = zoom
        self.google = google
        self.api = api
        self.log = log
        self._auto_id = run_id is None
        self.run_id = run_id or f"{socket.gethostname()[:40]}-{os.getpid()}-{int(clock())}"
        self.calendar_name = calendar_name
        self._calendar = calendar_id
        self._calendar_fixed = bool(calendar_id)
        self.settings: dict[str, Any] = merged(DEFAULTS, None)
        self._settings_at: Optional[float] = None
        self.claim_until = float("inf")
        self.zoom_claim_until = float("inf")
        self.pending: dict[str, Pending] = {}
        self._made: dict[str, dict[str, Any]] = {}   # Zoom meetings this run made, by room, until saved or closed
        self._busy: set[str] = set()                 # rooms this run is working on right now
        self._done: set[str] = set()                 # rooms this run opened or failed: never picked up again
        self._sent: set[str] = set()                 # Zoom rooms a create was sent for
        self._swept: set[str] = set()                # finished rooms already looked for in Zoom
        self._retry_at: dict[str, float] = {}        # lost rooms: when to look again
        self._tries: dict[str, int] = {}
        self._users: dict[str, tuple[float, Optional[dict[str, Any]], Optional[str]]] = {}
        self._pending_users: Optional[set[str]] = None
        self.closed_ids: set[str] = set()
        self._to_close: dict[str, dict[str, Any]] = {}
        self._close_at: dict[str, float] = {}
        self._close_tries: dict[str, int] = {}
        self._held: set[str] = set()
        self._noted: set[str] = set()
        self._staff_cache: Optional[tuple[set[str], set[str]]] = None
        self._status_due = 0.0
        self._close_scan_due = 0.0
        self._settings_due = 0.0
        self._warned: set[str] = set()
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
                "held": 0, "handed": 0, "db_errors": 0, "db_refused": "", "faults": [],
                "notify_unclear": 0, "notify_refused": 0, "notify_why": ""}

    def _count(self, name: str, n: int = 1) -> None:
        self.total[name] += n
        self.window[name] += n

    def _fault(self, sentence: str) -> None:
        self.total["faults"].append(sentence)
        self.window["faults"].append(sentence)

    def _warn_once(self, what: str, line: str) -> None:
        if what not in self._warned:
            self._warned.add(what)
            self.log.warn(line)

    def _zoom_down(self) -> bool:
        return self.zoom is not None and self.zoom.breaker.blocked()

    def _google_down(self) -> bool:
        return self.google is not None and self.google.breaker.blocked()

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
            self.zoom_claim_until = self.deadline - (ZOOM_CLAIM_MARGIN if seconds >= 30 else CLAIM_MARGIN)
            self.hard_stop = self.deadline + HARD_SLACK
        else:
            # A tick by hand (--once): it claims, and its calls get their
            # whole timeout.
            self.claim_until = float("inf")
            self.zoom_claim_until = float("inf")
            self.hard_stop = start + 60.0
        if self._auto_id:
            self.run_id = f"{socket.gethostname()[:40]}-{os.getpid()}-{int(start)}-e{int(self.hard_stop) + 1}"
        self._window_from = start
        self._status_due = start
        try:
            self._read_settings(start)
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
        return not any((w["made"], w["failed"], w["closed"], w["withdrawn"], w["held"], w["handed"],
                        w["db_errors"], w["notify_unclear"], w["notify_refused"], w["faults"]))

    def tick(self, now: float, *, max_claims: int = MAX_CLAIMS) -> None:
        """New rooms first; then Meet rooms waiting on Google; then at most
        one room another run left behind, and at most one finished room's
        Zoom meeting closed."""
        if now >= self._settings_due:
            self._read_settings(now)
        rows: Optional[list[dict[str, Any]]] = None
        try:
            rows = self.sb.select(ROOMS, "select=*&state=in.(requested,creating)&order=requested_at.asc&limit=50")
        except TimeUp:
            rows = None
        except (SupabaseError, http.HttpError) as e:
            self._db_trouble(e)
        fresh = self._settings_fresh()
        if rows is not None and fresh:
            self._claims(rows, max_claims)
        self.poll_pending()
        if rows is not None and fresh:
            self._orphans(rows)
        self._close_step()

    def _claims(self, rows: list[dict[str, Any]], max_claims: int) -> None:
        claimed = 0
        for r in rows:
            if r.get("state") != "requested":
                continue
            if claimed >= max_claims:
                break
            now = self.clock()
            if now > self.claim_until:
                break
            if r.get("provider") == "zoom" and now > self.zoom_claim_until:
                continue  # the next run has the time a Zoom room takes
            asked = parse_ts(r.get("requested_at"))
            if asked is not None and now - asked > STALE_S:
                # The sweep fails a room nobody claimed at 60 s on the
                # database's clock; this is only for when it is not running.
                self._guard(r, lambda room: self._fail_unclaimed(room, SAY["too_late"]))
                continue
            claimed += 1
            got = self.claim(r)
            if got:
                self._guard(got, self.process)
            self._maybe_status()

    def summary(self) -> dict[str, Any]:
        t = self.total
        return {"made": t["made"], "zoom": t["zoom"], "meet": t["meet"], "failed": t["failed"],
                "refused": t["refused"], "closed": t["closed"], "withdrawn": t["withdrawn"], "held": t["held"],
                "handed": t["handed"], "waiting_on_google": len(self.pending), "db_errors": t["db_errors"],
                "notify_unclear": t["notify_unclear"], "notify_refused": t["notify_refused"],
                "problems": list(dict.fromkeys(t["faults"]))[:5], "run": self.run_id}

    # ---- settings and the database ------------------------------------------
    def waits(self, name: str, default: float) -> float:
        try:
            return float((self.settings.get("waits_s") or {}).get(name) or default)
        except (TypeError, ValueError):
            return default

    def _read_settings(self, now: float) -> None:
        # A read that fails is tried again next tick: until it works a run
        # that has never read the switches claims nothing.
        self._settings_due = now + EVERY
        try:
            raw = self.sb.setting(SETTING)
        except TimeUp:
            return
        except http.HttpError as e:
            if e.status == 404:
                raise TablesMissing("The settings table does not answer, so the room worker cannot start. "
                                    "Apply the sales cockpit migrations.")
            self._db_trouble(e)
            return
        except SupabaseError as e:
            self._db_trouble(e)
            return
        self._settings_due = now + SETTINGS_EVERY
        # A missing `rooms` setting is the defaults: switched off.
        self.settings = merged(DEFAULTS, raw)
        self._settings_at = self.clock()

    def _settings_fresh(self) -> bool:
        """Only a run that has read the switches lately claims a room: a
        setting it could not read is never taken as on."""
        return self._settings_at is not None and self.clock() - self._settings_at <= SETTINGS_STALE_S

    def _switched_on(self, provider: Any) -> Optional[str]:
        """None when rooms on this provider may be made, else the sentence."""
        if self.settings.get("enabled") is not True:
            return SAY["switched_off"]
        if (self.settings.get("providers") or {}).get(provider) is not True:
            return SAY["zoom_off"] if provider == "zoom" else SAY["meet_off"] if provider == "meet" else SAY["provider"]
        return None

    def _db_trouble(self, e: Exception) -> None:
        if isinstance(e, TimeUp):
            return
        if isinstance(e, http.HttpError) and e.status == 404:
            raise TablesMissing("The video room tables are not in the database yet (migration "
                                "20261003a_sales_rooms.sql), so no room can be made.")
        self._count("db_errors")
        reason = db_reason(e)
        if isinstance(e, http.HttpError) and 400 <= e.status < 500 and e.status != 429:
            # It answered, and refused: most often a column this worker writes
            # that the rooms migration does not have.
            self.window["db_refused"] = self.total["db_refused"] = reason
        if self.window["db_errors"] == 1:
            self.log.warn(f"rooms: the database did not answer as expected: {reason}")

    def _read(self, room_id: str) -> Optional[dict[str, Any]]:
        rows = self.sb.select(ROOMS, f"select=*&id=eq.{_q(room_id)}&limit=1")
        return rows[0] if rows else None

    def _patch_or_lost(self, where: str, body: dict[str, Any]) -> list[dict[str, Any]]:
        """A conditional room write. A refusal is raised; an answer that never
        came is an empty result, so the caller reads the room again."""
        try:
            return self.sb.patch_returning(ROOMS, where, body)
        except TimeUp:
            raise
        except http.HttpError as e:
            if 400 <= e.status < 500 and e.status != 429:
                raise
            self._db_trouble(e)
            return []
        except SupabaseError as e:
            self._db_trouble(e)
            return []

    # ---- claim and make ------------------------------------------------------
    def claim(self, room: dict[str, Any]) -> Optional[dict[str, Any]]:
        """Only the update that still sees `requested` gets the row back."""
        body = {"state": "creating", "claimed_at": iso(self.clock()), "worker_run": self.run_id,
                "version": int(room.get("version") or 0) + 1, "error": None}
        try:
            got = self.sb.patch_returning(ROOMS, f"id=eq.{_q(room['id'])}&state=eq.requested", body)
        except TimeUp:
            return None
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
        except TimeUp:
            self.log.info(f"rooms: room {room.get('code')} is left for the next run: this run's time is up")
        except (SupabaseError, http.HttpError) as e:
            # The database is the trouble: the room stays where it is and the
            # recovery path picks it up when the database answers again.
            self._db_trouble(e)
        except ProviderError as e:
            if e.timeup:
                self._hand_over(room, unclear=False)
            else:
                self._step_error(room, e)
        except Exception as e:  # noqa: BLE001 - one room's fault is that room's
            self._step_error(room, e)
        finally:
            self._busy.discard(rid)

    def _step_error(self, room: dict[str, Any], e: Exception) -> None:
        self.log.error(f"rooms: room {room.get('code')} stopped on an error: {http.scrub(repr(e))[:300]}")
        self._fault(SAY["error"])
        try:
            self.fail(room, SAY["error"], fault=False)
        except Exception as e2:  # noqa: BLE001
            self.log.error(f"rooms: room {room.get('code')} could not be marked failed: {http.scrub(str(e2))[:200]}")

    def process(self, room: dict[str, Any]) -> None:
        off = self._switched_on(room.get("provider"))
        if self.settings.get("enabled") is not True:
            self.fail(room, SAY["switched_off"], refusal=True)
        elif room.get("purpose") == "booked":
            self.fail(room, SAY["booked"], refusal=True)
        elif not room.get("host_email"):
            self.fail(room, SAY["no_host"], refusal=True)
        elif room.get("provider") not in ("zoom", "meet"):
            self.fail(room, SAY["provider"], refusal=True)
        elif off:
            self.fail(room, off, refusal=True)
        elif room.get("provider") == "zoom":
            self.make_zoom(room)
        else:
            self.start_meet(room)

    def _hand_over(self, room: dict[str, Any], *, unclear: bool) -> None:
        """This run's time is up in the middle of a Zoom room: mark it for the
        next run, which adopts it at once. `unclear`: a create was sent and its
        answer never came, so the next run only looks for the meeting."""
        if room.get("provider") != "zoom":
            return  # a Meet room is adopted at once anyway (its event id is fixed)
        rid = str(room["id"])
        marker = ("unclear:" if unclear else "handover:") + self.run_id
        try:
            self.sb.patch_returning(ROOMS, f"id=eq.{_q(rid)}&state=eq.creating&worker_run=eq.{_q(self.run_id)}",
                                    {"worker_run": marker})
        except (SupabaseError, http.HttpError) as e:
            self.log.warn(f"rooms: room {room.get('code')} could not be marked for the next run: {db_reason(e)}")
        self._count("handed")
        self.log.info(f"rooms: room {room.get('code')} is handed to the next run: this run's time is up")

    # ---- Zoom ------------------------------------------------------------------
    def _linked_user(self, email: str) -> Optional[str]:
        """The Zoom user the Team page linked to this seat, if any."""
        try:
            rows = self.sb.select(HOSTS, f"select=zoom_user_id&email=eq.{_q(email)}&limit=1")
        except TimeUp:
            raise
        except (SupabaseError, http.HttpError) as e:
            self._warn_once("hosts-read", f"rooms: the room hosts could not be read, so Zoom users are looked up "
                                          f"by email: {db_reason(e)}")
            return None
        value = str((rows[0] if rows else {}).get("zoom_user_id") or "").strip()
        return value or None

    def zoom_user(self, email: str, linked: Optional[str] = None) -> tuple[Optional[dict[str, Any]], Optional[str]]:
        """(Zoom's user record or None, seat status or None when unknown),
        kept five minutes: the Team page's Zoom user first, else the email."""
        e = email.strip().lower()
        cache = linked or e
        hit = self._users.get(cache)
        if hit and self.clock() - hit[0] < 300:
            return hit[1], hit[2]
        assert self.zoom is not None
        if linked:
            try:
                user = self.zoom.user(linked)
                status = zoom_seat_status(user)
                self._users[cache] = (self.clock(), user, status)
                return user, status
            except ProviderError as err:
                if err.unclear or err.status == 429:
                    return None, None
                if not err.gone:
                    raise
                self.log.warn(f"rooms: the Zoom user the Team page set for {e} does not exist; looking up the email")
        try:
            user = self.zoom.user(e)
            status = zoom_seat_status(user)
        except ProviderError as err:
            if err.gone:
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
        self._users[cache] = (self.clock(), user, status)
        return user, status

    def _own_meetings(self, host: str) -> set[str]:
        """The meetings of this host's own finished cockpit rooms: a standby
        room replaced at 35 minutes still has the closer in it, and that is
        not "another meeting"."""
        out = set(self.closed_ids)
        try:
            rows = self.sb.select(ROOMS, f"select=provider_meeting_id&host_email=eq.{_q(host)}&provider=eq.zoom"
                                         "&state=in.(ended,expired,failed,cancelled)&provider_meeting_id=not.is.null"
                                         "&order=requested_at.desc&limit=20")
        except TimeUp:
            raise
        except (SupabaseError, http.HttpError):
            return out
        return out | {str(r["provider_meeting_id"]) for r in rows if r.get("provider_meeting_id")}

    def make_zoom(self, room: dict[str, Any]) -> None:
        if not self.zoom:
            self.fail(room, SAY["zoom_keys"], fault=True)
            return
        if self._zoom_down():
            self.fail(room, SAY["zoom_down"], fault=True)
            return
        host = str(room["host_email"]).strip().lower()
        linked = self._linked_user(host)
        try:
            user, status = self.zoom_user(host, linked)
        except ProviderError as e:
            self.fail(room, SAY["zoom_refused"].format(why=e.why), fault=True)
            return
        if self._zoom_down():
            self.fail(room, SAY["zoom_down"], fault=True)
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
        target = str((user or {}).get("id") or linked or host)
        try:
            own = self._own_meetings(host)
            live = [m for m in self.zoom.live(target) if str(m.get("id")) not in own]
        except ProviderError as e:
            if e.timeup:
                raise
            if self._zoom_down():
                self.fail(room, SAY["zoom_down"], fault=True)
                return
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
        self._made[str(room["id"])] = meeting
        self.finish(room, provider="zoom", meeting_id=meeting.get("id"),
                    join_url=with_passcode(str(meeting.get("join_url") or ""), meeting),
                    start_url=str(meeting.get("start_url") or ""))

    def zoom_create(self, room: dict[str, Any], user: str) -> Optional[dict[str, Any]]:
        """Three tries at most, on a 429 or an unclear answer (a dropped
        connection, a 5xx). Before each new try the host's meetings are read
        for the room's code, so a meeting is never made twice, even when a
        gateway answers 429 after Zoom did the work. Zoom not answering at
        all stops at once (its breaker); the run's time running out hands the
        room to the next run instead of failing it."""
        assert self.zoom is not None
        topic = topic_of(room.get("code"))
        body = zoom_body(str(room.get("code") or ""), str(room.get("call_kind") or "intro"),
                         self.settings.get("lengths_min") or {})
        last: Optional[ProviderError] = None
        sent_unclear = False
        for attempt in range(3):
            if attempt:
                if self._zoom_down():
                    break
                spare = self.left() - PROVIDER_RESERVE
                if spare <= 2.5:
                    self._hand_over(room, unclear=sent_unclear)
                    return None
                self.sleep(min(float(attempt), max(0.0, spare - 2.5)))
            if self.left() - PROVIDER_RESERVE <= 1.0:
                self._hand_over(room, unclear=sent_unclear)
                return None
            self._note_create(room)
            try:
                made = self.zoom.create(user, body)
                if made.get("id") and made.get("join_url"):
                    if not made.get("start_url"):
                        made = {**made, **self.zoom.meeting(made["id"])}
                    return made
                last = ProviderError(0, "Zoom answered without a meeting", where="api.zoom.us")
                sent_unclear = True
            except ProviderError as e:
                last = e
                if e.timeup:
                    self._hand_over(room, unclear=sent_unclear)
                    return None
                if e.down:
                    break
                if not (e.unclear or e.status == 429):
                    break
                sent_unclear = True
            try:
                found = self.zoom.find(user, topic)
                if found:
                    return self.zoom.meeting(found["id"])
            except ProviderError as e:
                if e.timeup:
                    self._hand_over(room, unclear=True)
                    return None
                self.log.warn(f"rooms: Zoom's meeting list did not answer for room {room.get('code')}: {e.why}")
        if last is not None and not last.unclear and not last.down and last.status != 429:
            self.fail(room, SAY["zoom_refused"].format(why=last.why), fault=True)
        else:
            self.fail(room, SAY["zoom_down"], fault=True)
        return None

    def _note_create(self, room: dict[str, Any]) -> None:
        """Written down before the first create goes out, so no run ever sends
        a second one for this room: after a lost answer, a hand-over or a
        crash, the meeting is only looked for by its code."""
        rid = str(room["id"])
        if rid in self._sent:
            return
        self._sent.add(rid)
        self.store_event(rid, "worker.create_sent", {"worker_run": self.run_id}, handled=True)

    def _create_was_sent(self, rid: str) -> bool:
        if rid in self._sent:
            return True
        try:
            rows = self.sb.select(EVENTS, f"select=id&dedupe_key=eq.{_q('worker.create_sent:' + rid)}&limit=1")
        except TimeUp:
            raise
        except (SupabaseError, http.HttpError):
            return True  # not knowing: never risk a second meeting; the room fails as lost at worst
        return bool(rows)

    def recover_zoom(self, room: dict[str, Any], age: float, *, unclear: bool = False) -> None:
        """A Zoom room left in `creating`: the meeting this run made is read by
        its id; else it is found by the code in its topic; else made now when
        it is young and no create was ever sent for it; else failed."""
        if not self.zoom:
            self.fail(room, SAY["zoom_keys"], fault=True)
            return
        host = str(room.get("host_email") or "").strip().lower()
        if not host:
            self.fail(room, SAY["no_host"], refusal=True)
            return
        rid = str(room["id"])
        if self._zoom_down():
            if age > GIVE_UP_S:
                self.fail(room, SAY["lost"], fault=True)
            return
        known = self._made.get(rid) or {}
        meeting: Optional[dict[str, Any]] = None
        try:
            if known.get("id"):
                try:
                    meeting = self.zoom.meeting(known["id"])
                except ProviderError as e:
                    if not e.gone:
                        raise
            if not meeting:
                linked = self._linked_user(host)
                user, _status = self.zoom_user(host, linked)
                target = str((user or {}).get("id") or linked or host)
                found = self.zoom.find(target, topic_of(room.get("code")))
                meeting = self.zoom.meeting(found["id"]) if found else None
        except ProviderError as e:
            if e.timeup:
                raise
            if age > GIVE_UP_S:
                self.fail(room, SAY["lost"], fault=True)
            else:
                self.log.warn(f"rooms: room {room.get('code')} could not be looked up in Zoom yet: {e.why}")
            return
        if meeting:
            if not known:
                self.log.info(f"rooms: room {room.get('code')} found again in Zoom by its code")
            self._made[rid] = meeting
            self.finish(room, provider="zoom", meeting_id=meeting.get("id"),
                        join_url=with_passcode(str(meeting.get("join_url") or ""), meeting),
                        start_url=str(meeting.get("start_url") or ""))
        elif age > self.waits("fail", 60):
            self.fail(room, SAY["lost"], fault=True)
        elif unclear or self._create_was_sent(rid):
            # A create went out and its answer never came: Zoom's list can
            # lag, so it is looked for again rather than made a second time.
            self.log.info(f"rooms: room {room.get('code')} is not in Zoom's list yet; looking again")
        else:
            # Never sent: the claim's answer was lost, or the last run handed
            # it over before its create.
            self.make_zoom(room)

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
            try:
                made = self.google.make_calendar(self.calendar_name)
            except ProviderError as e:
                if e.status in (401, 403):
                    raise CalendarNotMade(e.status, e.message, code=e.code, where=e.where)
                raise
            if not made.get("id"):
                raise ProviderError(0, "Google answered without a calendar", where="www.googleapis.com")
            self._calendar = str(made["id"])
            self.log.info(f"rooms: made the Google calendar {self.calendar_name!r} for Meet rooms")
        return self._calendar

    def _google_sentence(self, e: ProviderError) -> str:
        if isinstance(e, CalendarNotMade):
            return SAY["calendar"]
        if e.down or e.unclear or e.status == 429:
            return SAY["google_down"]
        if e.status == 401 or (e.where == "oauth2.googleapis.com" and 400 <= e.status < 500):
            # The token endpoint answers 400 invalid_grant for a revoked or
            # lapsed sign-in.
            return SAY["google_signin"]
        if e.status == 403:
            return SAY["google_scope"]
        return SAY["google_refused"].format(why=e.why)

    def _calendar_or_fail(self, room: dict[str, Any]) -> Optional[str]:
        assert self.google is not None
        try:
            self.google.token()
            if self.google.calendar_ok() is False:
                self.fail(room, SAY["google_scope"], fault=True)
                return None
            return self.calendar()
        except ProviderError as e:
            if e.timeup:
                raise
            self.fail(room, self._google_sentence(e), fault=True)
            return None

    def _meet_until(self, room: dict[str, Any]) -> float:
        claimed = parse_ts(room.get("claimed_at")) or self.clock()
        return claimed + self.waits("meet_pending", 30)

    def start_meet(self, room: dict[str, Any]) -> None:
        if not self.google:
            self.fail(room, SAY["google_keys"], fault=True)
            return
        if self._google_down():
            self.fail(room, SAY["google_down"], fault=True)
            return
        cal = self._calendar_or_fail(room)
        if not cal:
            return
        eid = event_id(room["id"])
        try:
            ev = self.google.insert(cal, meet_body(room, self.clock(), self.settings.get("lengths_min") or {}))
        except ProviderError as e:
            if e.timeup:
                return  # left in creating: the next run reads it by its event id
            if e.status != 409:
                self.fail(room, self._google_sentence(e), fault=True)
                return
            try:
                ev = self.google.event(cal, eid)
            except ProviderError as e2:
                if e2.timeup:
                    return
                self.fail(room, self._google_sentence(e2), fault=True)
                return
        self.track_meet(room, cal, eid, ev)

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
        in its link or the 30 s wait runs out. While Google is not answering
        they fail at once, so the rep can make the room on Zoom."""
        if not self.pending:
            return
        if self.google is None or self._google_down():
            for rid, p in list(self.pending.items()):
                self.pending.pop(rid, None)
                self._guard(p.room, lambda room: self.fail(room, SAY["google_down"], fault=True))
            return
        for rid, p in list(self.pending.items()):
            now = self.clock()
            if now < p.next_at:
                continue
            if rid not in self.pending:
                continue
            self._busy.add(rid)
            try:
                try:
                    ev = self.google.event(p.calendar, p.eid)
                except ProviderError as e:
                    if e.timeup:
                        self.pending.pop(rid, None)  # the next run reads it by its event id
                    elif e.down or self.clock() >= p.until:
                        self.pending.pop(rid, None)
                        self.fail(p.room, SAY["google_down"] if e.down else SAY["meet_pending"] if e.unclear else
                                  self._google_sentence(e), fault=True)
                    else:
                        p.next_at = self.clock() + 1.0
                    continue
                self.pending.pop(rid, None)
                self.track_meet(p.room, p.calendar, p.eid, ev)
            except TablesMissing:
                raise
            except TimeUp:
                self.pending.pop(rid, None)
            except (SupabaseError, http.HttpError) as e:
                # The room stays `creating`; the recovery path reads its event.
                self.pending.pop(rid, None)
                self._db_trouble(e)
            except Exception as e:  # noqa: BLE001
                self.pending.pop(rid, None)
                self._step_error(p.room, e)
            finally:
                self._busy.discard(rid)
            self._maybe_status()

    def resume_meet(self, room: dict[str, Any], age: float) -> None:
        """A Meet room another run left in `creating` (its run ended while
        Google was still pending, or it died): read by its event id."""
        if not self.google:
            self.fail(room, SAY["google_keys"], fault=True)
            return
        if self._google_down():
            self.fail(room, SAY["google_down"], fault=True)
            return
        cal = self._calendar_or_fail(room)
        if not cal:
            return
        eid = event_id(room["id"])
        try:
            ev = self.google.event(cal, eid)
        except ProviderError as e:
            if e.timeup:
                return
            if e.status in (404, 410):
                if self.clock() < self._meet_until(room):
                    self.start_meet(room)  # it was claimed and never inserted
                else:
                    self.fail(room, SAY["lost"], fault=True)
            elif (e.unclear or e.status == 429) and not e.down and age <= GIVE_UP_S:
                pass  # asked again after the room's back-off
            else:
                self.fail(room, self._google_sentence(e), fault=True)
            return
        self.track_meet(room, cal, eid, ev)

    # ---- rooms nobody is working on -------------------------------------------
    def _orphan_ready(self, room: dict[str, Any], now: float) -> bool:
        rid = str(room.get("id"))
        # The tick's rows were read before this tick's claims and Meet reads:
        # a room this run settled since is not lost.
        if (rid in self._busy or rid in self.pending or rid in self._done
                or self._retry_at.get(rid, 0.0) > now):
            return False
        owner = str(room.get("worker_run") or "")
        if room.get("provider") == "meet" or owner == self.run_id or owner.startswith(("handover:", "unclear:")):
            return True
        ends = run_ends(owner)
        if ends is not None and now > ends:
            return True  # its run is over: nobody else will finish it
        since = parse_ts(room.get("claimed_at")) or parse_ts(room.get("requested_at")) or now
        # A Zoom room another run holds may be in the middle of its create,
        # so it is left for the minute of the state table.
        return now - since > self.waits("fail", 60)

    def _orphans(self, rows: list[dict[str, Any]]) -> None:
        """At most one lost room a tick, so new rooms never wait behind them."""
        for r in rows:
            if r.get("state") != "creating" or not self._orphan_ready(r, self.clock()):
                continue
            self._guard(r, self.orphan)
            self._maybe_status()
            return

    def orphan(self, room: dict[str, Any]) -> None:
        rid = str(room["id"])
        now = self.clock()
        since = parse_ts(room.get("claimed_at")) or parse_ts(room.get("requested_at")) or now
        age = now - since
        n = self._tries.get(rid, 0)
        self._tries[rid] = n + 1
        wait = min(15.0, 2.0 ** n)
        fail_s = self.waits("fail", 60)
        if age <= fail_s:
            wait = min(wait, max(1.0, since + fail_s + 1.0 - now))  # looked at again just past its minute
        self._retry_at[rid] = now + wait
        was = str(room.get("worker_run") or "")
        adopted = self.adopt(room)
        if not adopted:
            return
        off = self._switched_on(adopted.get("provider"))
        if adopted.get("provider") not in ("zoom", "meet"):
            self.fail(adopted, SAY["provider"], refusal=True)
        elif off:
            self.fail(adopted, off, refusal=True)
        elif adopted.get("provider") == "meet":
            self.resume_meet(adopted, age)
        else:
            self.recover_zoom(adopted, age, unclear=was.startswith("unclear:"))

    def adopt(self, room: dict[str, Any]) -> Optional[dict[str, Any]]:
        old = room.get("worker_run")
        if old == self.run_id:
            return room
        where = f"id=eq.{_q(room['id'])}&state=eq.creating&" + (f"worker_run=eq.{_q(old)}" if old else "worker_run=is.null")
        got = self.sb.patch_returning(ROOMS, where, {"worker_run": self.run_id})
        return got[0] if got else None

    def _fail_unclaimed(self, room: dict[str, Any], sentence: str) -> None:
        rid = str(room["id"])
        self.store_event(rid, "worker.failed", {"error": sentence, "worker_run": self.run_id})
        got = self._patch_or_lost(
            f"id=eq.{_q(rid)}&state=eq.requested",
            {"state": "failed", "error": sentence, "result": "failed", "ended_at": iso(self.clock()),
             "version": int(room.get("version") or 0) + 1})
        row = got[0] if got else None
        if row is None:
            current = self._read(rid)
            if current and current.get("state") == "failed" and current.get("error") == sentence:
                row = current
        if row:
            self._after_fail(row, sentence, fault=True)

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
        # 2. The event, before the room opens: an open room always has one
        #    for the sweep to replay, whatever happens to the call below.
        payload = {"provider": provider, "provider_meeting_id": str(meeting_id), "worker_run": self.run_id,
                   "seconds": round(now - (parse_ts(room.get("requested_at")) or now), 1)}
        self.store_event(rid, "worker.ready", payload, must=True)
        # 3. The room, open, only if it is still this run's and still being made.
        body = {"state": "open", "join_url": join_url, "provider_meeting_id": str(meeting_id),
                "opened_at": iso(now), "error": None, "version": int(room.get("version") or 0) + 1,
                **self._host_by_and_ends(room, now)}
        got = self._patch_or_lost(f"id=eq.{_q(rid)}&state=eq.creating&worker_run=eq.{_q(self.run_id)}", body)
        opened = got[0] if got else None
        if opened is None:
            current = self._read(rid)
            if (current and current.get("state") in LIVE_STATES and current.get("worker_run") == self.run_id
                    and str(current.get("provider_meeting_id")) == str(meeting_id)):
                opened = current  # it opened; only the answer was lost
            elif current and current.get("state") in FINAL:
                self._withdrawn(room, current, meeting_id)
                return False
            else:
                self._made.pop(rid, None)
                return False
        self._made.pop(rid, None)
        self._retry_at.pop(rid, None)
        self._tries.pop(rid, None)
        self._done.add(rid)
        self.notify(rid, "worker.ready", payload)
        self._count("made")
        self._count(provider)
        self.log.info(f"rooms: room {opened.get('code') or room.get('code')} ready on {provider} "
                      f"{payload['seconds']}s after it was asked for")
        return True

    def _withdrawn(self, room: dict[str, Any], current: dict[str, Any], meeting_id: Any) -> None:
        """Cancelled while it was being made: its meeting is closed like any
        finished room's. The meeting id goes on the room, so a close Zoom
        refuses now is tried again, by this run or the next."""
        rid = str(room["id"])
        self._done.add(rid)
        if room.get("provider") == "zoom" and meeting_id and not current.get("provider_meeting_id"):
            try:
                self.sb.patch_returning(ROOMS, f"id=eq.{_q(rid)}&provider_meeting_id=is.null",
                                        {"provider_meeting_id": str(meeting_id)})
            except (SupabaseError, http.HttpError) as e:
                self.log.warn(f"rooms: the meeting of cancelled room {room.get('code')} could not be noted on it: "
                              f"{db_reason(e)}")
        if room.get("provider") == "zoom" and meeting_id:
            self._to_close[rid] = {**room, **current, "provider_meeting_id": str(meeting_id)}
            self._close_at.setdefault(rid, self.clock())
        self._retry_at.pop(rid, None)
        self._count("withdrawn")
        self.log.info(f"rooms: room {room.get('code')} was {current.get('state')} while it was being made; "
                      "its meeting is closed")

    def fail(self, room: dict[str, Any], sentence: str, *, fault: bool = False, refusal: bool = False) -> bool:
        rid = str(room["id"])
        self.pending.pop(rid, None)
        made = self._made.get(rid) or {}
        body: dict[str, Any] = {"state": "failed", "error": sentence, "result": "failed",
                                "ended_at": iso(self.clock()), "version": int(room.get("version") or 0) + 1}
        if made.get("id"):
            # A meeting was made for a room that never opened: it is noted on
            # the room with its host link, and closed like any finished room's.
            body["provider_meeting_id"] = str(made["id"])
            if made.get("start_url"):
                try:
                    self.sb.upsert(SECRETS, [{"room_id": rid, "start_url": str(made["start_url"]),
                                              "expires_at": iso(self.clock() + START_URL_TTL)}], "room_id")
                except (SupabaseError, http.HttpError) as e:
                    self.log.warn(f"rooms: the meeting of failed room {room.get('code')} could not be noted: "
                                  f"{db_reason(e)}")
        self.store_event(rid, "worker.failed", {"error": sentence, "worker_run": self.run_id})
        got = self._patch_or_lost(f"id=eq.{_q(rid)}&state=in.(requested,creating)", body)
        row = got[0] if got else None
        if row is None:
            current = self._read(rid)
            if current and current.get("state") == "failed" and current.get("error") == sentence:
                row = current  # it failed; only the answer was lost
            else:
                if made.get("id") and current and current.get("state") in FINAL:
                    self._withdrawn(room, current, made["id"])
                else:
                    self._made.pop(rid, None)
                return False
        if made.get("id"):
            self._to_close[rid] = {**room, **row, "provider_meeting_id": str(made["id"])}
            self._close_at.setdefault(rid, self.clock())
        self._after_fail(row, sentence, fault=fault, refusal=refusal)
        return True

    def _after_fail(self, room: dict[str, Any], sentence: str, *, fault: bool = False, refusal: bool = False) -> None:
        rid = str(room["id"])
        self._retry_at.pop(rid, None)
        self._tries.pop(rid, None)
        self._done.add(rid)
        self.notify(rid, "worker.failed", {"error": sentence, "worker_run": self.run_id})
        self._count("failed")
        if refusal:
            self._count("refused")
        if fault:
            self._fault(sentence)
        (self.log.warn if fault else self.log.info)(f"rooms: room {room.get('code')} failed: {sentence}")

    # ---- telling sales-api -------------------------------------------------------
    def store_event(self, room_id: str, kind: str, detail: dict[str, Any], *, must: bool = False,
                    handled: bool = False) -> None:
        """The worker's event, kept like the door's Zoom events. One sales-api
        has not marked handled is replayed by the sweep, so a stored
        `worker.ready` is the guarantee the link goes; `must` makes the room
        wait for it. `handled` is a note only (a closed meeting's uuid)."""
        row: dict[str, Any] = {"room_id": room_id, "kind": kind, "source": "worker",
                               "dedupe_key": f"{kind}:{room_id}", "detail": detail}
        if handled:
            row["handled_at"] = iso(self.clock())
        try:
            self.sb.rest("POST", f"{EVENTS}?on_conflict=dedupe_key", json_body=[row],
                         prefer="resolution=ignore-duplicates,return=minimal")
        except TimeUp:
            if must:
                raise
        except (SupabaseError, http.HttpError) as e:
            if must:
                raise
            self._warn_once("events", f"rooms: room events are not being stored: {db_reason(e)}")

    def notify(self, room_id: str, kind: str, payload: dict[str, Any]) -> None:
        """One call to sales-api; anything unclear is left to the stored event
        and the sweep, so the same room.event never runs twice at once."""
        if not self.api:
            return
        outcome, why = self.api.event(kind, room_id, payload)
        if outcome == "delivered":
            return
        if outcome == "refused":
            self._count("notify_refused")
            self.window["notify_why"] = self.total["notify_why"] = why
            self.log.warn(f"rooms: sales-api refused {kind} for room {room_id}: {why}")
            return
        self._count("notify_unclear")
        self.log.warn(f"rooms: sales-api did not answer {kind} for room {room_id} ({why}); "
                      "the sweep sends the stored event again")

    def _alert(self, dedupe_key: str, kind: str, subject: str, message: str, detail: dict[str, Any]) -> None:
        """One alert row per incident (cockpit_sales_alerts); the watchdog posts
        it to #sales-alerts. Room codes and counts only, never a lead's name."""
        try:
            self.sb.rest("POST", f"{ALERTS}?on_conflict=dedupe_key", json_body=[{
                "dedupe_key": dedupe_key, "source": WORKER, "kind": kind, "subject": subject[:100],
                "message": message[:1000], "detail": detail}],
                prefer="resolution=ignore-duplicates,return=minimal")
        except (SupabaseError, http.HttpError) as e:
            self._warn_once("alerts", f"rooms: an alert could not be raised: {db_reason(e)}")

    def _resolve_alert(self, dedupe_key: str) -> None:
        try:
            self.sb.rest("PATCH", f"{ALERTS}?dedupe_key=eq.{_q(dedupe_key)}&resolved_at=is.null",
                         json_body={"resolved_at": iso(self.clock()),
                                    "dedupe_key": f"{dedupe_key}:resolved:{int(self.clock())}"},
                         prefer="return=minimal")
        except (SupabaseError, http.HttpError):
            pass

    # ---- final rooms: close the provider side ---------------------------------------
    def _drop_secret(self, room_id: str) -> None:
        self.sb.rest("DELETE", f"{SECRETS}?room_id=eq.{_q(room_id)}", prefer="return=minimal")

    def _close_step(self) -> None:
        now = self.clock()
        if now >= self._close_scan_due:
            self._close_scan_due = now + CLOSE_SCAN_EVERY
            try:
                self._scan_finals()
            except TablesMissing:
                raise
            except TimeUp:
                return
            except (SupabaseError, http.HttpError) as e:
                self._db_trouble(e)
        due = [rid for rid in self._to_close if self._close_at.get(rid, 0.0) <= now]
        if not due or self.zoom is None or self._zoom_down():
            return
        rid = min(due, key=lambda x: self._close_at.get(x, 0.0))
        try:
            self._close_one(self._to_close[rid])
        except TimeUp:
            return
        except (SupabaseError, http.HttpError) as e:
            self._db_trouble(e)

    def _scan_finals(self) -> None:
        """Finished rooms that still hold a host link. Those with nothing to
        close at Zoom lose the link now; Zoom meetings are queued, one closed
        a tick. Then the finished Zoom rooms a create was sent for that carry
        no meeting id (a cancel, a crash or a database outage in the middle of
        a make, or the sweep failing a room the worker could not save): their
        meeting is looked for by its code and closed."""
        self._staff_cache = None
        self._scan_unsaved()
        secrets = self.sb.select(SECRETS, "select=room_id&limit=200")
        ids = [str(s["room_id"]) for s in secrets if s.get("room_id")]
        if not ids:
            return
        rows = self.sb.select(ROOMS, f"select=*&id=in.{_in(ids)}&state=in.(ended,expired,failed,cancelled)")
        for r in rows:
            rid = str(r["id"])
            mid = r.get("provider_meeting_id") or (self._made.get(rid) or {}).get("id")
            if (r.get("provider") != "zoom" or not mid or r.get("lead_in_at") or r.get("purpose") == "booked"
                    or not self.zoom):
                # Never a room a lead reached, never a booked call's own
                # meeting, and a Meet link cannot be stopped: the host link goes.
                self._drop_secret(rid)
                self._forget_close(rid)
                self._count("closed")
                continue
            self._to_close[rid] = {**r, "provider_meeting_id": str(mid)}
            self._close_at.setdefault(rid, self.clock())

    def _scan_unsaved(self) -> None:
        if not self.zoom:
            return
        rows = self.sb.select(ROOMS, "select=*&provider=eq.zoom&state=in.(ended,expired,failed,cancelled)"
                                     "&provider_meeting_id=is.null"
                                     f"&ended_at=gte.{_q(iso(self.clock() - 3600))}&order=ended_at.desc&limit=20")
        rows = [r for r in rows if str(r["id"]) not in self._swept and str(r["id"]) not in self._to_close
                and not r.get("lead_in_at") and r.get("purpose") != "booked"]
        if not rows:
            return
        ids = [str(r["id"]) for r in rows]
        noted = {str(e.get("room_id")) for e in self.sb.select(
            EVENTS, f"select=room_id&kind=eq.worker.create_sent&room_id=in.{_in(ids)}&limit=50")}
        for r in rows:
            rid = str(r["id"])
            if rid in self._made or rid in noted:
                self._to_close[rid] = {**r, "provider_meeting_id": (self._made.get(rid) or {}).get("id")}
                self._close_at.setdefault(rid, self.clock())
            else:
                self._swept.add(rid)  # no create was ever sent for it

    def _find_unsaved(self, room: dict[str, Any]) -> Optional[str]:
        """The meeting of a finished room that never got its meeting id, found
        by its code; noted on the room with its host link, so the next run
        closes it if this one cannot."""
        assert self.zoom is not None
        rid = str(room["id"])
        host = str(room.get("host_email") or "").strip().lower()
        linked = self._linked_user(host) if host else None
        user, _status = self.zoom_user(host, linked) if host else (None, None)
        found = self.zoom.find(str((user or {}).get("id") or linked or host), topic_of(room.get("code")))
        if not found:
            return None
        mid = str(found["id"])
        m = self.zoom.meeting(mid, timeout=CLOSE_TIMEOUT, retries=0)
        try:
            if m.get("start_url"):
                self.sb.upsert(SECRETS, [{"room_id": rid, "start_url": str(m["start_url"]),
                                          "expires_at": iso(self.clock() + START_URL_TTL)}], "room_id")
            self.sb.patch_returning(ROOMS, f"id=eq.{_q(rid)}&provider_meeting_id=is.null", {"provider_meeting_id": mid})
        except (SupabaseError, http.HttpError) as e:
            self.log.warn(f"rooms: the meeting of room {room.get('code')} could not be noted on it: {db_reason(e)}")
        self.log.info(f"rooms: room {room.get('code')} ended before its meeting was saved; found it by its code")
        return mid

    def _forget_close(self, rid: str) -> None:
        self._to_close.pop(rid, None)
        self._close_at.pop(rid, None)
        self._close_tries.pop(rid, None)
        self._made.pop(rid, None)

    def _close_one(self, room: dict[str, Any]) -> None:
        rid = str(room["id"])
        now = self.clock()
        ended = parse_ts(room.get("ended_at")) or parse_ts(room.get("opened_at")) or now
        try:
            if not room.get("provider_meeting_id"):
                mid = self._find_unsaved(room)
                if not mid:
                    self._swept.add(rid)
                    self._forget_close(rid)
                    return
                room = self._to_close[rid] = {**room, "provider_meeting_id": mid}
            outcome, outside = self.close_meeting(room, room["provider_meeting_id"])
        except ProviderError as e:
            if e.down or e.timeup:
                self._close_at[rid] = now + 5.0
                return
            n = self._close_tries.get(rid, 0) + 1
            self._close_tries[rid] = n
            if now - ended >= CLOSE_GIVE_UP_S:
                self._fault(f"Zoom would not close room {room.get('code')}; its host link is deleted anyway.")
                self._drop_secret(rid)
                self._forget_close(rid)
                self._count("closed")
            else:
                self._close_at[rid] = now + (5.0 if n < 6 else 30.0)
                if n == 1:
                    self.log.warn(f"rooms: Zoom did not close room {room.get('code')} yet: {e.why}")
            return
        if outcome == "closed":
            self._drop_secret(rid)
            self._forget_close(rid)
            self._count("closed")
            if rid in self._held:
                self._held.discard(rid)
                self._resolve_alert(f"room_held:{rid}")
            return
        # Held: someone outside the team may be in it (H7).
        if now - ended >= HOLD_GIVE_UP_S:
            self._fault(f"Room {room.get('code')}'s Zoom meeting was left open for three hours with someone in it; "
                        "the worker stops checking it and its host link is deleted.")
            self._drop_secret(rid)
            self._forget_close(rid)
            return
        self._hold(room, outside)
        self._close_at[rid] = now + HOLD_RECHECK_S

    def close_meeting(self, room: dict[str, Any], meeting_id: Any) -> tuple[str, Optional[int]]:
        """('closed', None), or ('held', how many outside the team, None when
        it could not be read). A meeting that never started is deleted. A
        started one is ended first, and only when nobody outside the team is
        in it. Its uuid is noted before it is deleted."""
        assert self.zoom is not None
        try:
            m = self.zoom.meeting(meeting_id, timeout=CLOSE_TIMEOUT, retries=0)
        except ProviderError as e:
            if e.gone:
                self.closed_ids.add(str(meeting_id))
                return "closed", None
            raise
        status = str(m.get("status") or "").lower()
        self._note_meeting(room, meeting_id, m)
        if status == "started":
            outside = self._outside(room, meeting_id, m)
            if outside is None or outside > 0:
                return "held", outside
            self.zoom.end(meeting_id)
        try:
            self.zoom.delete(meeting_id)
        except ProviderError as e:
            if not e.gone:
                raise
        self.closed_ids.add(str(meeting_id))
        return "closed", None

    def _note_meeting(self, room: dict[str, Any], meeting_id: Any, m: dict[str, Any]) -> None:
        rid = str(room["id"])
        if rid in self._noted:
            return
        self._noted.add(rid)
        self.store_event(rid, "worker.closing", {"meeting_id": str(meeting_id), "meeting_uuid": m.get("uuid"),
                                                  "status": m.get("status")}, handled=True)

    def _staff(self) -> tuple[set[str], set[str]]:
        """(Zoom user ids, emails) of the team: every room host and every seat.
        Unreadable means empty, which keeps every meeting with a guest open."""
        if self._staff_cache is not None:
            return self._staff_cache
        ids: set[str] = set()
        emails: set[str] = set()
        try:
            for h in self.sb.select(HOSTS, "select=email,zoom_user_id&limit=500"):
                if h.get("email"):
                    emails.add(str(h["email"]).strip().lower())
                if h.get("zoom_user_id"):
                    ids.add(str(h["zoom_user_id"]))
            for p in self.sb.select(PEOPLE, "select=email&limit=500"):
                if p.get("email"):
                    emails.add(str(p["email"]).strip().lower())
        except TimeUp:
            raise
        except (SupabaseError, http.HttpError) as e:
            self._warn_once("staff", f"rooms: the team list could not be read, so only the host counts as staff: "
                                     f"{db_reason(e)}")
        self._staff_cache = (ids, emails)
        return self._staff_cache

    @staticmethod
    def _is_staff(p: dict[str, Any], ids: set[str], emails: set[str]) -> bool:
        pid = str(p.get("id") or "").strip()
        email = str(p.get("email") or p.get("user_email") or "").strip().lower()
        return bool((pid and pid in ids) or (email and email in emails))

    def _outside(self, room: dict[str, Any], meeting_id: Any, m: dict[str, Any]) -> Optional[int]:
        """How many people outside the team are in a live meeting now, or None
        when Zoom would not say."""
        assert self.zoom is not None
        try:
            people = self.zoom.live_participants(meeting_id)
        except ProviderError as e:
            if e.timeup:
                raise
            self._warn_once(f"participants:{meeting_id}",
                            f"rooms: Zoom's live participant list did not answer for room {room.get('code')}: {e.why}")
            return None
        ids, emails = self._staff()
        ids = ids | {str(m.get("host_id") or "")} - {""}
        emails = emails | {str(room.get("host_email") or "").strip().lower()} - {""}
        return sum(1 for p in people if not p.get("leave_time") and not self._is_staff(p, ids, emails))

    def _hold(self, room: dict[str, Any], outside: Optional[int]) -> None:
        rid = str(room["id"])
        if rid in self._held:
            return
        self._held.add(rid)
        code = str(room.get("code") or "")
        if outside:
            sentence = (f"Room {code} has ended, but {_s(outside, 'person', 'people')} outside the team "
                        f"{'is' if outside == 1 else 'are'} still in its Zoom meeting, so the meeting was left open. "
                        "Check it in Zoom.")
        else:
            sentence = (f"Room {code} has ended while its Zoom meeting was running, and Zoom would not say who is in "
                        "it, so the meeting was left open. Check it in Zoom.")
        self._fault(sentence)
        self._count("held")
        self.log.warn(f"rooms: {sentence}")
        self.store_event(rid, "worker.held", {"outside": outside, "meeting_id": str(room.get("provider_meeting_id"))},
                         handled=True)
        self._alert(f"room_held:{rid}", "room_held", f"Room {code}", sentence,
                    {"room_id": rid, "code": code, "outside": outside})

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
            bits.append(f"Working. In {last}: {_s(w['made'], 'room')} made "
                        f"({w['zoom']} Zoom, {w['meet']} Meet), {w['failed']} failed"
                        + (f" ({w['refused']} refused for the rep to fix)" if w["refused"] else "")
                        + f", {w['closed']} closed.")
        else:
            bits.append(f"Working. No rooms were asked for in {last}.")
        if w["withdrawn"]:
            bits.append(f"{w['withdrawn']} cancelled while being made, and closed.")
        if w["handed"]:
            bits.append(f"{_s(w['handed'], 'Zoom room')} handed to the next run because this run ran out of time.")
        if self.pending:
            bits.append(f"{len(self.pending)} Meet room{'s are' if len(self.pending) != 1 else ' is'} waiting on Google.")
        ok = True
        providers = self.settings.get("providers") or {}
        if not self._settings_fresh():
            bits.append("The rooms setting could not be read, so no new room is made until it can be.")
            ok = False
        elif self.settings.get("enabled") is not True:
            bits.append("Video rooms are switched off in Settings.")
        if not self.zoom:
            bits.append("The Zoom keys are not set on the VPS (" + ", ".join(ZOOM_KEYS) + "), so Zoom rooms cannot be made.")
            ok = ok and providers.get("zoom") is not True
        elif self._zoom_down():
            bits.append("Zoom is not answering, so new Zoom rooms fail at once until it answers again.")
            ok = False
        if not self.google:
            bits.append("No Google sign-in is set on the VPS (GOOGLE_CAL_CLIENT_ID, GOOGLE_CAL_CLIENT_SECRET, "
                        "GOOGLE_CAL_REFRESH_TOKEN), so Meet rooms cannot be made.")
            ok = ok and providers.get("meet") is not True
        elif self._google_down():
            bits.append("Google is not answering, so new Meet rooms fail at once until it answers again.")
            ok = False
        if w["db_refused"]:
            bits.append(f"The database refused the worker's request ({w['db_refused']}). The rooms tables may not "
                        "match this worker: apply the latest sales migration.")
            ok = False
        elif w["db_errors"]:
            bits.append(f"The database did not answer {w['db_errors']} time{'s' if w['db_errors'] != 1 else ''}; "
                        "the worker kept trying.")
            ok = False
        if w["notify_refused"]:
            why = str(w["notify_why"] or "no reason given").rstrip(". ")
            bits.append(f"sales-api refused the room message for {_s(w['notify_refused'], 'room')}: {why}.")
            ok = False
        if w["notify_unclear"]:
            bits.append(f"sales-api did not answer for {_s(w['notify_unclear'], 'room message')}; "
                        "the sweep sends them again.")
            if self.api is not None and self.api.breaker.blocked():
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
            self.log.warn(f"rooms: the status row was not written: {db_reason(e)}")

    # ---- the host check (its own cron line) ---------------------------------------
    def google_check(self) -> tuple[Optional[bool], str]:
        ok, line, found = check_google(self.google, self.calendar_name, self._calendar if self._calendar_fixed else "")
        if found and not self._calendar:
            self._calendar = found
        return ok, line

    def zoom_seat(self, email: str, who: str, linked: Optional[str] = None) -> dict[str, Any]:
        if not self.zoom:
            return {"status": None, "line": f"{who}: Zoom not checked, because the Zoom keys are not set on the VPS."}
        self._users.pop(linked or email.strip().lower(), None)
        try:
            user, status = self.zoom_user(email, linked)
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
        if linked and user:
            line += " Zoom user set on the Team page."
        if live_until:
            line += " In a Zoom meeting now."
        return {"status": status, "user_id": (user or {}).get("id"), "live_until": live_until, "line": line}

    def check_hosts(self) -> dict[str, Any]:
        """Every seat's Zoom user and status and whether Google works, into
        `cockpit_sales_room_hosts`, never over what the Team page set: its
        Zoom user is the one checked and is never cleared, and its default
        room is never changed (an empty one means the role's default). Then
        the Zoom rooms that ended in the last day against Zoom's participant
        report."""
        now = self.clock()
        self.deadline = now + HOSTS_BUDGET
        self.hard_stop = self.deadline
        self._read_settings(now)
        google_ok, gline = self.google_check()
        lines = [gline]
        people = [p for p in self.sb.select(PEOPLE, "select=email,name,role,active,via_portal"
                                                    "&via_portal=eq.true&active=eq.true&limit=500")
                  if p.get("email") and p.get("role") in SEAT_ROLES]
        existing: dict[str, dict[str, Any]] = {}
        for h in self.sb.select(HOSTS, "select=email,zoom_user_id,default_provider&limit=500"):
            if h.get("email"):
                existing[str(h["email"]).strip().lower()] = h
        if not people:
            lines.append("No active sales seat to check.")
        defaults = self.settings.get("default_provider") or {}
        rows: list[dict[str, Any]] = []
        seat_ids: set[str] = set()
        for p in sorted(people, key=lambda x: str(x["email"]).lower()):
            email = str(p["email"]).strip().lower()
            role = str(p.get("role") or "")
            mine = existing.get(email) or {}
            linked = str(mine.get("zoom_user_id") or "").strip() or None
            seat = self.zoom_seat(email, f"{email} ({role})", linked)
            if seat.get("user_id"):
                seat_ids.add(str(seat["user_id"]))
            chosen = str(mine.get("default_provider") or "")
            shown = chosen if chosen in ("zoom", "meet") else role_default(role, defaults)
            works = default_provider(role, seat["status"], google_ok, defaults, zoom_keys=bool(self.zoom))
            row: dict[str, Any] = {"email": email}
            if google_ok is not None:
                row["google_ok"] = google_ok
            if seat["status"] is not None:
                row.update({"zoom_status": seat["status"], "zoom_live_until": seat["live_until"],
                            "checked_at": iso(now)})
                if seat.get("user_id") and not linked:
                    row["zoom_user_id"] = str(seat["user_id"])
            rows.append(row)
            label = {"zoom": "Zoom", "meet": "Meet"}
            line = seat["line"] + f" Default room: {label[shown]}" + (", set on the Team page." if chosen else ".")
            if works != shown:
                line += f" {label[shown]} rooms will fail for this seat: set {label[works]} on the Team page."
            lines.append(line)
        if rows:
            self.sb.upsert(HOSTS, rows, "email")
        report_ok, report_lines = self.report_check(now, seat_ids)
        lines += report_lines
        ok = bool(self.zoom) and google_ok is True and report_ok
        self._write_status(ok, " ".join(lines), job=HOSTS_JOB)
        return {"ok": ok, "lines": lines, "rows": rows}

    def report_check(self, now: float, seat_ids: Optional[set[str]] = None) -> tuple[bool, list[str]]:
        """Zoom's participant report against the cockpit, for the Zoom rooms
        that ended in the last day: someone outside the team joined exactly
        when the room reached lead_in. Each room is checked once; a report
        that cannot be read is said, never taken as nobody."""
        if not self.zoom:
            return True, []
        try:
            rows = self.sb.select(ROOMS, "select=id,code,host_email,provider_meeting_id,lead_in_at,ended_at"
                                         "&provider=eq.zoom&state=in.(ended,expired,failed,cancelled)"
                                         f"&provider_meeting_id=not.is.null&ended_at=gte.{_q(iso(now - REPORT_WINDOW_S))}"
                                         "&order=ended_at.desc&limit=50")
            events: list[dict[str, Any]] = []
            if rows:
                events = self.sb.select(EVENTS, f"select=room_id,kind,detail&room_id=in.{_in([str(r['id']) for r in rows])}"
                                                "&kind=in.(worker.closing,report.checked)&limit=200")
        except TimeUp:
            return False, ["Zoom participant reports: not checked, the check ran out of time."]
        except (SupabaseError, http.HttpError) as e:
            return False, [f"Zoom participant reports: the rooms could not be read ({db_reason(e)})."]
        if not rows:
            return True, ["Zoom participant reports: no Zoom room ended in the last day."]
        done = {str(e.get("room_id")) for e in events if e.get("kind") == "report.checked"}
        uuids = {str(e.get("room_id")): (e.get("detail") or {}).get("meeting_uuid")
                 for e in events if e.get("kind") == "worker.closing"}
        ids, emails = self._staff()
        ids = ids | set(seat_ids or ())
        checked, unread, bad = 0, 0, []
        why = ""
        for r in [r for r in rows if str(r["id"]) not in done][:REPORT_PER_RUN]:
            rid = str(r["id"])
            ref = uuids.get(rid) or r.get("provider_meeting_id")
            try:
                people = self.zoom.past_participants(ref)
            except ProviderError as e:
                if e.gone:
                    people = []  # never held, so nobody joined
                else:
                    unread += 1
                    why = e.why
                    continue
            host = {str(r.get("host_email") or "").strip().lower()} - {""}
            outside = [p for p in people if not self._is_staff(p, ids, emails | host)]
            joined, seen = bool(outside), bool(r.get("lead_in_at"))
            self.store_event(rid, "report.checked", {"outside_joined": joined, "cockpit_lead_in": seen,
                                                     "match": joined == seen, "participants": len(people)},
                             handled=True)
            checked += 1
            if joined != seen:
                code = str(r.get("code") or "")
                bad.append(code)
                said = ("someone outside the team joined, but the cockpit never saw the lead come in" if joined else
                        "the cockpit marked the lead in, but Zoom's report shows nobody outside the team")
                self._alert(f"room_report:{rid}", "room_report", f"Room {code}",
                            f"Room {code}: {said}. Check the room's joins.", {"room_id": rid, "code": code})
        if not checked and not unread:
            return True, ["Zoom participant reports: every Zoom room that ended in the last day is checked."]
        line = f"Zoom participant reports: {_s(checked, 'room')} checked"
        line += (f", {len(bad)} not matching the cockpit ({', '.join(bad)})." if bad else ", all matching the cockpit.")
        if unread:
            line += (f" {_s(unread, 'report')} could not be read ({why}); "
                     f"{'it is' if unread == 1 else 'they are'} tried again in ten minutes.")
        return not bad and not unread, [line]


def supabase(url: str, service_key: str) -> Supabase:
    """The worker's database door: short timeouts, because it polls every second."""
    if not url or not service_key:
        raise SupabaseError("DESK_SUPABASE_URL and DESK_SUPABASE_KEY are not set (~/.editor-desk/env)")
    return Supabase(url, service_key, timeout=DB_TIMEOUT)
