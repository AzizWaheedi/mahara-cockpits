#!/usr/bin/env python3
"""Keeps the team's meetings and Google Calendar in step, every five minutes.

Team meetings v5, 2026-09-27. The cockpit writes its own changes to Google
(apps/media-buyer-cockpit/convex/teamCalendar.ts); this reads Google back,
so a change made in Google Calendar (a meeting moved, a guest added or
taken off, a sitting cancelled, a title changed) is in the cockpit within
five minutes.

What a meeting is keyed on: the calendar that organises it and the
recurring event's id (a single event's own id when it does not repeat).
Not the title. Renaming an event renames the same meeting; the title only
names a meeting the first time it is seen.

For a linked meeting Google decides the days, start, length, recurrence,
end, Meet link and guests, and there is one sitting per occurrence with its
real times, moved or cancelled. The sync never touches a purpose, a doc,
notes, agendas, the run of show, wheels or the creative pipeline, and it
leaves alone any meeting with a change still on its way to Google, so it
never undoes an edit that has not landed yet.

What counts as a meeting (unchanged since the first sync):

* a meeting link (Meet, Zoom or Teams, on the event or in its location or
  description), which rules out personal time blocks;
* two or more of our own people, counting the organiser, who is often not
  in the attendee list;
* nobody from outside, which is what separates an internal 1:1 from a
  client call.

Usage:
  python3 sync.py                 one pass
  python3 sync.py --dry-run       print what a pass would change, change nothing
  python3 sync.py links           propose Google series for the cockpit's own meetings
  python3 sync.py links --apply   and link the exact matches
  python3 sync.py doctor          which Google sign-in and Supabase it reaches
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
from zoneinfo import ZoneInfo

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "editor-desk")
)

LOOK_BACK = 60  # days of history read from Google
LOOK_ON = 45  # days ahead
QUIET_BACK = 21  # a calendar meeting with no occurrence in the last 21 days
QUIET_ON = 45  # and none in the next 45 is marked inactive, never deleted
LINK_AHEAD = 14  # `links` compares the next two weeks of a series
BY = "Google Calendar"  # team_changes.by_whom for what the sync changes
SETUP = "v5 setup"  # team_changes.by_whom for `links --apply`
TZ = "Asia/Kuwait"
DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]
DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
GCAL = "https://www.googleapis.com/calendar/v3"

Row = Dict[str, Any]
Key = Tuple[str, str]


def note(line: str) -> None:
    print(f"[{dt.datetime.now(dt.timezone.utc):%H:%M:%S}] {line}", flush=True)


# --- the two services -------------------------------------------------------


def sb(method: str, path: str, body=None, prefer: str = ""):
    base = os.environ["DESK_SUPABASE_URL"].rstrip("/")
    key = os.environ["DESK_SUPABASE_KEY"]
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(
        f"{base}/rest/v1/{path}", data=data, method=method, headers=headers
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw.strip() else []


def google_token() -> Tuple[str, str]:
    """A token for the CEO account's calendars, and which sign-in gave it.

    GOOGLE_CAL_CLIENT_ID / _SECRET / _REFRESH_TOKEN are the OAuth client the
    cockpit writes with. Until they are in this worker's environment the
    editor desk's Google sign-in reads the calendars, as the hourly sync did.
    """
    cid = os.environ.get("GOOGLE_CAL_CLIENT_ID", "")
    secret = os.environ.get("GOOGLE_CAL_CLIENT_SECRET", "")
    refresh = os.environ.get("GOOGLE_CAL_REFRESH_TOKEN", "")
    if cid and secret and refresh:
        body = urllib.parse.urlencode({
            "client_id": cid,
            "client_secret": secret,
            "refresh_token": refresh,
            "grant_type": "refresh_token",
        }).encode()
        req = urllib.request.Request(
            "https://oauth2.googleapis.com/token", data=body, method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())["access_token"], "GOOGLE_CAL_* (calendar sign-in)"
    from desk.config import Config
    from desk.drive import Drive

    return Drive(Config.from_env(), lambda s: None).token(), "editor desk Google sign-in"


class Google:
    def __init__(self, token: str):
        self.auth = {"Authorization": f"Bearer {token}"}

    def get(self, path: str, query: Optional[dict] = None) -> Row:
        url = f"{GCAL}/{path}" + (f"?{urllib.parse.urlencode(query)}" if query else "")
        req = urllib.request.Request(url, headers=self.auth)
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())

    def calendars(self) -> List[Row]:
        items: List[Row] = []
        token = None
        while True:
            q = {"maxResults": 250, **({"pageToken": token} if token else {})}
            page = self.get("users/me/calendarList", q)
            items += page.get("items", [])
            token = page.get("nextPageToken")
            if not token:
                return [
                    c for c in items
                    if "holiday" not in str(c.get("id", "")).lower()
                    and "todoist" not in str(c.get("summary", "")).lower()
                ]

    def events(self, calendar: str, start: dt.datetime, end: dt.datetime) -> List[Row]:
        """Every occurrence in the window, cancelled ones included."""
        items: List[Row] = []
        token = None
        while True:
            q = {
                "timeMin": start.isoformat(), "timeMax": end.isoformat(),
                "singleEvents": "true", "showDeleted": "true", "maxResults": 250,
                **({"pageToken": token} if token else {}),
            }
            page = self.get(f"calendars/{urllib.parse.quote(calendar)}/events", q)
            items += page.get("items", [])
            token = page.get("nextPageToken")
            if not token:
                return items

    def event(self, calendar: str, event_id: str) -> Optional[Row]:
        """One event, or None when Google no longer has it."""
        try:
            e = self.get(
                f"calendars/{urllib.parse.quote(calendar)}/events/{urllib.parse.quote(event_id)}"
            )
        except urllib.error.HTTPError as err:
            if err.code in (404, 410):
                return None
            raise
        return None if e.get("status") == "cancelled" else e


# --- reading an event --------------------------------------------------------


def internal(email: str) -> bool:
    return str(email).lower().endswith("@maharamedia.com")


def has_link(e: Row) -> bool:
    if e.get("hangoutLink"):
        return True
    if (e.get("conferenceData") or {}).get("entryPoints"):
        return True
    blob = f"{e.get('location', '')} {e.get('description', '')}"
    return any(w in blob for w in ("meet.google.com", "zoom.us", "teams.microsoft"))


def organiser(e: Row) -> str:
    return str((e.get("organizer") or {}).get("email") or "").lower()


def sides(e: Row) -> Tuple[List[str], List[str]]:
    """Our people and theirs, with the organiser counted as an attendee."""
    ours, theirs = [], []
    for a in e.get("attendees") or []:
        if a.get("resource"):
            continue
        email = str(a.get("email") or "").lower()
        (ours if internal(email) else theirs).append(email)
    org = organiser(e)
    # The organiser is often absent from the attendee list, and without
    # them every 1:1 has one person on it and is dropped as a solo block.
    if org and internal(org) and org not in ours:
        ours.append(org)
    return ours, theirs


def is_meeting(e: Row) -> bool:
    ours, theirs = sides(e)
    return has_link(e) and len(ours) >= 2 and not theirs


def meet_link(e: Row) -> Optional[str]:
    if e.get("hangoutLink"):
        return str(e["hangoutLink"])
    for p in (e.get("conferenceData") or {}).get("entryPoints") or []:
        if p.get("entryPointType") == "video" and p.get("uri"):
            return str(p["uri"])
    return None


def private(e: Row) -> Row:
    return ((e.get("extendedProperties") or {}).get("private")) or {}


def when(value: Optional[str]) -> Optional[dt.datetime]:
    if not value:
        return None
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def local(value: Optional[str], tz: str) -> Optional[dt.datetime]:
    t = when(value)
    return t.astimezone(ZoneInfo(tz)) if t else None


def sun0(d: dt.date) -> int:
    """0 = Sunday ... 6 = Saturday, the cockpit's numbering."""
    return (d.weekday() + 1) % 7


def rrule_parts(rrule: Optional[str]) -> Dict[str, str]:
    if not rrule:
        return {}
    body = rrule.split(":", 1)[1] if rrule.upper().startswith("RRULE:") else rrule
    return {
        k.upper(): v
        for k, v in (p.split("=", 1) for p in body.split(";") if "=" in p)
    }


def weekdays_of(rrule: Optional[str], first: Optional[dt.datetime]) -> Optional[List[int]]:
    """The days a weekly series meets on; None for anything else."""
    parts = rrule_parts(rrule)
    if parts.get("FREQ") != "WEEKLY":
        return None
    by = parts.get("BYDAY")
    if not by:
        return [sun0(first.date())] if first else None
    return sorted({DAYS.index(d[-2:]) for d in by.split(",") if d[-2:] in DAYS})


def until_of(rrule: Optional[str], tz: str) -> Optional[str]:
    """The last day of a series with an UNTIL, in the meeting's time zone."""
    raw = rrule_parts(rrule).get("UNTIL")
    if not raw:
        return None
    if "T" in raw:
        t = dt.datetime.strptime(raw.rstrip("Z"), "%Y%m%dT%H%M%S").replace(tzinfo=dt.timezone.utc)
        return t.astimezone(ZoneInfo(tz)).date().isoformat()
    return dt.datetime.strptime(raw, "%Y%m%d").date().isoformat()


def series_fields(e: Row, tz: str) -> Row:
    """What Google says about a meeting's series, in the cockpit's columns.

    From the series' own event (the recurring master, or the single event).
    An occurrence says nothing about the recurrence, so from one only the
    time, length and Meet link are taken."""
    start = local((e.get("start") or {}).get("dateTime"), tz)
    end = local((e.get("end") or {}).get("dateTime"), tz)
    out: Row = {
        "start_time": start.strftime("%H:%M:%S") if start else None,
        "minutes": int((end - start).total_seconds() // 60) if start and end else None,
        "meet_link": meet_link(e),
    }
    if e.get("recurringEventId"):
        return out
    rrule = next(
        (r for r in e.get("recurrence") or [] if str(r).upper().startswith("RRULE:")),
        None,
    )
    out.update({
        "weekdays": weekdays_of(rrule, start) if rrule else None,
        "rrule": rrule,
        "ends_on": until_of(rrule, tz) if rrule else (start.date().isoformat() if start else None),
        "cal_etag": e.get("etag"),
    })
    return out


def cadence_of(rrule: Optional[str]) -> str:
    parts = rrule_parts(rrule)
    freq = parts.get("FREQ")
    if freq == "DAILY":
        return "daily"
    if freq == "MONTHLY":
        return "monthly"
    if freq != "WEEKLY":
        return "as needed"
    if parts.get("INTERVAL", "1") == "2":
        return "every two weeks"
    n = len([d for d in (parts.get("BYDAY") or "").split(",") if d])
    return {2: "twice a week", 3: "three times a week"}.get(n, "daily" if n >= 5 else "weekly")


def slug(text: str, limit: int = 48) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:limit]


def days_line(days: Optional[List[int]]) -> str:
    return " and ".join(DAY_NAMES[d] for d in days or []) or "no fixed day"


# --- series: the occurrences Google holds, grouped --------------------------


@dataclass
class Series:
    org: str  # the organiser's calendar
    master: str  # the recurring event's id, or the single event's own id
    items: Dict[str, Row] = field(default_factory=dict)  # occurrence id -> event

    @property
    def key(self) -> Key:
        return (self.org, self.master)

    def live(self) -> List[Row]:
        return [e for e in self.items.values() if e.get("status") != "cancelled"]

    def face(self) -> Optional[Row]:
        """The fullest live copy: the one to read a title and guests from."""
        live = self.live()
        return max(live, key=lambda e: len(e.get("attendees") or [])) if live else None


def group(events: List[Row], read_ok: Optional[Set[str]] = None) -> Dict[Key, Series]:
    """Occurrences by series. The same occurrence sits on every guest's
    calendar under the same id; it is counted once. A cancelled occurrence
    can come back without its organiser, so it joins its series by id.

    When the organiser's own calendar was read in this pass (`read_ok`, the
    calendars read, each event tagged with `_on`), only what that calendar
    holds counts. A guest's copy can go stale: on 2026-09-30 a teammate's
    calendar still had weekly occurrences of four series the CEO had ended
    or deleted, and the cockpit kept listing their sittings because of it."""
    out: Dict[Key, Series] = {}
    by_master: Dict[str, Key] = {}
    orphans: List[Row] = []
    on_org: Dict[Key, Set[str]] = {}
    for e in events:
        if e.get("status") != "cancelled" and not (e.get("start") or {}).get("dateTime"):
            continue  # an all-day entry is not a meeting
        master = str(e.get("recurringEventId") or e.get("id") or "")
        if not master:
            continue
        org = organiser(e)
        if not org:
            orphans.append(e)
            continue
        s = out.setdefault((org, master), Series(org, master))
        by_master[master] = (org, master)
        if str(e.get("_on") or "") == org.lower():
            on_org.setdefault((org, master), set()).add(str(e.get("id")))
        have = s.items.get(e["id"])
        if not have or len(e.get("attendees") or []) > len(have.get("attendees") or []):
            s.items[e["id"]] = e
    for e in orphans:
        key = by_master.get(str(e.get("recurringEventId") or e.get("id") or ""))
        if key and e["id"] not in out[key].items:
            out[key].items[e["id"]] = e
            if str(e.get("_on") or "") == key[0].lower():
                on_org.setdefault(key, set()).add(str(e.get("id")))
    if read_ok:
        for key, s in out.items():
            if key[0].lower() in read_ok:
                own = on_org.get(key, set())
                s.items = {i: e for i, e in s.items.items() if i in own}
    return out


def occurrence(e: Row, tz: str) -> Optional[Row]:
    """One occurrence as the cockpit's sitting columns (without its id).

    A sitting belongs to the day it was planned for: an occurrence moved to
    another day keeps its sitting, its notes and its spins."""
    start = local((e.get("start") or {}).get("dateTime"), tz)
    end = local((e.get("end") or {}).get("dateTime"), tz)
    orig = local((e.get("originalStartTime") or {}).get("dateTime"), tz) or start
    if not orig:
        return None
    cancelled = e.get("status") == "cancelled"
    shown = start or orig
    return {
        "on_date": orig.date().isoformat(),
        "starts_at": shown.astimezone(dt.timezone.utc).isoformat(),
        "ends_at": end.astimezone(dt.timezone.utc).isoformat() if end else None,
        "cal_instance_id": str(e.get("id")),
        "status": "cancelled" if cancelled else ("moved" if start and start != orig else "scheduled"),
    }


# --- matching series to meetings --------------------------------------------


def split_base(master: str) -> Optional[str]:
    """Google names the rest of a series split in Google Calendar ("this and
    following events") after the original: "<id>_R<date>"."""
    return master.split("_R")[0] if "_R" in master else None


@dataclass
class Match:
    owner: Dict[Key, str]  # every series a meeting owns -> the meeting
    parts: Dict[str, List[Key]]  # meeting -> the series it is made of
    loose: List[Key]  # series no meeting owns
    adopted: List[Key] = field(default_factory=list)  # same-titled series joined to a calendar meeting


def match(series: Dict[Key, Series], meetings: List[Row], part_rows: List[Row]) -> Match:
    """Which meeting each series belongs to.

    A series a meeting is made of (a team_meeting_series row, or the one
    series a meeting was linked to before that table) is matched on the
    organiser's calendar and the series id, or on the id alone for a meeting
    linked before the calendar was stored. The rest of a series Google split
    ("<id>_R<date>") is a part of the same meeting. An event the cockpit
    made for a single sitting carries the meeting's id in its private
    properties: it belongs to the meeting without being a part of it."""
    ids = {m["id"] for m in meetings}
    by_key: Dict[Key, str] = {}
    for r in part_rows:
        by_key[(r["cal_calendar"], r["cal_event_id"])] = r["meeting_id"]
    for m in meetings:
        if m.get("cal_calendar") and m.get("cal_event_id"):
            by_key.setdefault((m["cal_calendar"], m["cal_event_id"]), m["id"])
    by_event = {m["cal_event_id"]: m["id"]
                for m in meetings if m.get("cal_event_id") and not m.get("cal_calendar")}
    by_base = {**{k[1]: mid for k, mid in by_key.items()}, **by_event}
    by_title = {str(m.get("title") or "").strip(): m for m in meetings if m.get("title")}
    by_slug = {m["id"]: m for m in meetings}
    out = Match({}, {}, [])
    for key in sorted(series):
        s = series[key]
        face = s.face() or next(iter(s.items.values()), {})
        mid = by_key.get(key) or by_event.get(s.master)
        part = bool(mid)
        if not mid:
            base = split_base(s.master)
            mark = private(face).get("teamMeetingId")
            if base in by_base:
                mid, part = by_base[base], True
            elif mark in ids:
                mid = mark
        if not mid:
            # The hourly sync this replaced filed meetings by title, so one
            # meeting it made can stand for several series of that title.
            # Such a series joins that meeting as another part, once; from
            # then on it is matched by its id. A meeting the cockpit manages
            # links its own series, so an old one of its title is left alone.
            title = str(face.get("summary") or "").strip()
            same = by_title.get(title) or by_slug.get(slug(title))
            if same and not s.live():
                continue  # nothing of it left to show: history the meeting already has
            if same and (same.get("managed") or "calendar") == "calendar":
                mid, part = same["id"], True
                out.adopted.append(key)
            elif same:
                continue
        if not mid:
            out.loose.append(key)
            continue
        out.owner[key] = mid
        if part:
            out.parts.setdefault(mid, []).append(key)
    # A part with nothing in the window is still a part.
    for k, mid in by_key.items():
        if mid in ids and k not in out.parts.get(mid, []):
            out.parts.setdefault(mid, []).append(k)
    return out


# --- the plan: what one pass changes ---------------------------------------


class Plan:
    """Writes to Supabase, with the change log, applied or printed."""

    def __init__(self) -> None:
        self.writes: List[Tuple[str, str, Any, str]] = []
        self.changes: List[Row] = []

    def write(self, method: str, path: str, body: Any = None, prefer: str = "return=minimal") -> None:
        self.writes.append((method, path, body, prefer))

    def log(self, meeting_id: Optional[str], what: str, detail: Optional[Row] = None, by: str = BY) -> None:
        self.changes.append({"by_whom": by, "meeting_id": meeting_id, "what": what, "detail": detail})

    def apply(self, send: Callable[..., Any]) -> None:
        for method, path, body, prefer in self.writes:
            send(method, path, body, prefer)
        if self.changes:
            send("POST", "team_changes", self.changes, "return=minimal")

    def show(self) -> None:
        for method, path, body, _ in self.writes:
            text = json.dumps(body, default=str)[:300] if body is not None else ""
            print(f"  would {method} {path} {text}")
        for c in self.changes:
            print(f"  would log [{c['meeting_id']}] {c['what']}")


@dataclass
class State:
    """What Supabase holds, read once at the start of a pass."""

    meetings: List[Row]
    people: List[Row]
    links: List[Row]  # team_meeting_people
    sittings: List[Row]  # team_sittings in the window
    pending: Set[str]  # meetings with a change still on its way to Google
    parts: List[Row] = field(default_factory=list)  # team_meeting_series
    busy_sittings: Set[str] = field(default_factory=set)  # sittings with spins or closed items


GONE: Row = {"gone": True}  # a series Google no longer has
q = urllib.parse.quote


@dataclass
class Part:
    key: Key
    row: Row  # the team_meeting_series row as it should be
    fields: Row  # series_fields() of what was read ({} when nothing was)
    face: Optional[Row]  # the event read (the series' own, or an occurrence)


def read_parts(plan: Plan, m: Row, keys: List[Key], rows: Dict[Key, Row], series: Dict[Key, Series],
               masters: Dict[Key, Row], writable: Set[str], stamp: str) -> Tuple[List[Part], List[Key]]:
    """Each series the meeting is made of, as Google has it now; and the ones
    Google deleted."""
    out: List[Part] = []
    gone: List[Key] = []
    for key in sorted(set(keys)):
        master, s = masters.get(key), series.get(key)
        if master is GONE and not (s and s.live()):
            gone.append(key)
            continue
        was = rows.get(key) or {}
        face = master if master and master is not GONE else (s.face() if s else None)
        if not face:
            if was:
                out.append(Part(key, was, {}, None))
            continue
        f = series_fields(face, m.get("tz") or TZ)
        # A series is edited through its own event. When Google has cancelled
        # that event but kept occurrences, or it could not be read, the
        # occurrences still show, and the page offers to take the series over.
        editable = key[0] in writable and master is not None and master is not GONE
        row: Row = {
            "meeting_id": m["id"], "cal_calendar": key[0], "cal_event_id": key[1],
            "cal_title": str(face.get("summary") or "").strip() or was.get("cal_title"),
            "cal_writable": editable, "start_time": f.get("start_time"),
            "minutes": f.get("minutes"), "meet_link": f.get("meet_link"),
        }
        if "rrule" in f:
            days = f.get("weekdays")
            row.update({"rrule": f["rrule"], "ends_on": f["ends_on"], "cal_etag": f["cal_etag"],
                        "weekday": days[0] if days and len(days) == 1 else None})
        else:
            row.update({k: was.get(k) for k in ("rrule", "ends_on", "cal_etag", "weekday")})
        if not was or any(not _same(was.get(k), v) for k, v in row.items()):
            plan.write("POST", "team_meeting_series?on_conflict=cal_calendar,cal_event_id",
                       [{**row, "updated_at": stamp}], "resolution=merge-duplicates,return=minimal")
        out.append(Part(key, row, f, face))
    return out, gone


def plan_pass(
    state: State,
    series: Dict[Key, Series],
    masters: Dict[Key, Row],
    writable: Set[str],
    now: dt.datetime,
    read_everything: bool,
    whois: Callable[[str, Optional[str]], Optional[str]],
) -> Plan:
    """Everything one pass changes, decided without the network.

    `masters` holds the series events read from Google, GONE for one Google
    no longer has; a series missing from it was not read. `writable` is the
    calendars our account can edit: only there is a guest list complete.
    `read_everything` is False when a calendar could not be read, which
    keeps the deactivation rule from mistaking an unread meeting for a quiet
    one. `whois` finds, or adds, the roster person behind an address."""
    plan = Plan()
    today = now.astimezone(ZoneInfo(TZ)).date()
    stamp = now.isoformat()
    mt = match(series, state.meetings, state.parts)
    by_id = {m["id"]: m for m in state.meetings}
    names = getattr(whois, "names", None) or {p["id"]: p.get("name") or p["id"] for p in state.people}
    legacy = {m.get("calendar_id") for m in state.meetings if m.get("calendar_id")}
    for key in mt.adopted:
        plan.log(mt.owner[key], "found another series of it", {"calendar": key[0], "event": key[1]})

    # A series nobody has, that passes the rule: a new meeting.
    taken = set(by_id)
    for key in mt.loose:
        s = series[key]
        face = s.face()
        if not face or s.master in legacy or not is_meeting(face):
            continue
        title = str(face.get("summary") or "").strip()
        if not title:
            continue
        base = slug(title) or "meeting"
        mid, n = base, 2
        while mid in taken:
            mid, n = f"{base}-{n}", n + 1
        taken.add(mid)
        master = masters.get(key)
        f = series_fields(master if master and master is not GONE else face, TZ)
        if f.get("ends_on") and str(f["ends_on"]) <= (today + dt.timedelta(days=LINK_AHEAD)).isoformat():
            continue  # a series on its way out is not a new meeting
        ours, _ = sides(face)
        host = whois(s.org, None) if internal(s.org) else None
        pids = list(dict.fromkeys(p for p in (whois(e, None) for e in ours) if p))
        plan.write("POST", "team_meetings", [{
            "id": mid, "title": title, "cadence": cadence_of(f.get("rrule")),
            "host_id": host, "calendar_id": s.master[:120], "created_by": "calendar",
            "managed": "calendar", "active": True, "tz": TZ,
            "cal_calendar": s.org, "cal_event_id": s.master, "cal_title": title,
            "cal_writable": s.org in writable, "cal_synced_at": stamp,
            "start_time": f.get("start_time"), "minutes": f.get("minutes"),
            "weekdays": f.get("weekdays"), "rrule": f.get("rrule"), "ends_on": f.get("ends_on"),
            "meet_link": f.get("meet_link"), "cal_etag": f.get("cal_etag"),
        }])
        plan.write("POST", "team_meeting_series", [{
            "meeting_id": mid, "cal_calendar": s.org, "cal_event_id": s.master, "weekday": None,
            "cal_title": title, "cal_etag": f.get("cal_etag"), "rrule": f.get("rrule"),
            "start_time": f.get("start_time"), "minutes": f.get("minutes"),
            "meet_link": f.get("meet_link"), "ends_on": f.get("ends_on"), "cal_writable": s.org in writable,
        }])
        if pids:
            plan.write("POST", "team_meeting_people", [{
                "meeting_id": mid, "person_id": p, "part": "host" if p == host else "required",
                "source": "calendar", "cal_optional": False,
            } for p in pids])
        rows = sitting_rows(mid, [s], today)
        if rows:
            plan.write("POST", "team_sittings?on_conflict=id", rows, "resolution=merge-duplicates,return=minimal")
        plan.log(mid, f'brought in "{title}"', {"calendar": s.org, "event": s.master})

    for mid in sorted(set(mt.owner.values()) | set(mt.parts)):
        if mid in state.pending:
            continue  # its change has not reached Google yet
        m = by_id[mid]
        rows = {(r["cal_calendar"], r["cal_event_id"]): r for r in state.parts if r["meeting_id"] == mid}
        parts, gone = read_parts(plan, m, mt.parts.get(mid, []), rows, series, masters, writable, stamp)
        for key in gone:
            if key in rows:
                plan.write("DELETE", f"team_meeting_series?cal_calendar=eq.{q(key[0])}&cal_event_id=eq.{q(key[1])}")
        live = [p for p in parts if not p.row.get("ends_on") or str(p.row["ends_on"]) >= today.isoformat()]
        patch: Row = {}
        if live:
            here = (m.get("cal_calendar"), m.get("cal_event_id"))
            main = (next((p for p in live if p.key == here), None)
                    or next((p for p in live if p.key[1] == here[1]), None) or live[0])
            if main.key != here:
                patch.update({"cal_calendar": main.key[0], "cal_event_id": main.key[1],
                              "calendar_id": main.key[1][:120]})
            now_fields = meeting_fields(m, main, live, today)
            for k, v in now_fields.items():
                if not _same(v, m.get(k)):
                    patch[k] = v
            moved = {k: now_fields[k] for k in ("start_time", "minutes", "weekdays")
                     if k in now_fields and not _same(now_fields[k], m.get(k))}
            if moved:
                after = {**{k: m.get(k) for k in ("start_time", "minutes", "weekdays")}, **moved}
                line = (f"{days_line(after['weekdays']) + ', ' if after.get('weekdays') else ''}"
                        f"{str(after.get('start_time') or '')[:5]} for {after.get('minutes')} min")
                plan.log(mid, f"moved the series to {line}" if m.get("cal_calendar")
                         else f"set its time from the calendar: {line}",
                         {"before": {k: m.get(k) for k in moved}})
            # The title follows Google only for a meeting that is one series:
            # a series a day carries the day in its title.
            if len(live) == 1 and main.face:
                title = str(main.face.get("summary") or "").strip()
                if title and title != m.get("cal_title"):
                    patch["cal_title"] = title
                    if m.get("cal_title") and title != m.get("title"):
                        patch["title"] = title
                        plan.log(mid, f'renamed it "{title}"', {"before": m.get("title")})
            faces = [p.face for p in live if p.face]
            if faces:
                plan_guests(plan, state, m, faces, all(p.key[0] in writable for p in live), whois, names)
            if m.get("cal_error") and faces:
                patch["cal_error"] = None
        elif gone and not parts:
            patch.update({"cal_calendar": None, "cal_event_id": None, "cal_etag": None, "cal_writable": False})
            plan.log(mid, "deleted its event, so it is no longer on the calendar")
        elif parts and (m.get("managed") or "calendar") == "calendar" and m.get("active"):
            # Every series of it has ended on the calendar: the meeting is over
            # now, not three weeks from now (the quiet rule). A meeting the
            # cockpit manages is left to the page.
            last = max((str(p.row.get("ends_on")) for p in parts if p.row.get("ends_on")), default="")
            patch["active"] = False
            plan.log(mid, f"marked it inactive: its series ended{' on ' + last if last else ''}")
        if patch:
            plan.write("PATCH", f"team_meetings?id=eq.{q(mid)}", {**patch, "updated_at": stamp})
        plan_sittings(plan, state, mid, [series[k] for k, v in mt.owner.items() if v == mid], today)

    if read_everything:
        plan_quiet(plan, state, series, mt.owner, today)
    return plan


def over_before_next(days: List[int], ends_on: Optional[str], today: dt.date) -> bool:
    """A series that ends before its next sitting is over as far as the
    meeting's days go (CSM Daily's Sunday once the Sunday meeting took its
    place): the same rule as the cockpit's read-back (teamCalendar.ts)."""
    if not ends_on or not days:
        return False
    for i in range(7):
        d = today + dt.timedelta(days=i)
        if sun0(d) in days:
            return d.isoformat() > str(ends_on)[:10]
    return False


def meeting_fields(m: Row, main: Part, live: List[Part], today: Optional[dt.date] = None) -> Row:
    """The meeting's own series columns from the series it is made of: the
    series itself when it is one, the days of all of them when it is a
    series a day (the time, length and link are the main one's). A day's
    series that ends before its next sitting no longer counts as a day."""
    f = main.fields
    out: Row = {k: f[k] for k in ("start_time", "minutes", "meet_link") if f.get(k) is not None}
    out["cal_writable"] = all(p.row.get("cal_writable") for p in live)
    if len(live) == 1:
        for k in ("weekdays", "rrule", "ends_on", "cal_etag"):
            if k in f:
                out[k] = f[k]
        return out
    days: Set[int] = set()
    for p in live:
        own = list(p.fields.get("weekdays") or ([] if p.row.get("weekday") is None else [int(p.row["weekday"])]))
        ends = p.fields.get("ends_on") or p.row.get("ends_on")
        if today and over_before_next(own, ends, today):
            continue
        days |= set(own)
    out["weekdays"] = sorted(days) or m.get("weekdays")
    if "rrule" in f:
        out.update({"rrule": f["rrule"], "cal_etag": f["cal_etag"]})
    ends = [p.row.get("ends_on") for p in live]
    out["ends_on"] = None if any(e is None for e in ends) else max(str(e) for e in ends)
    return out


def sitting_rows(mid: str, mine: List[Series], today: dt.date) -> List[Row]:
    """One sitting a meeting a day; a live occurrence wins over a cancelled
    one on the same day."""
    rows: Dict[str, Row] = {}
    for s in mine:
        for e in sorted(s.items.values(), key=lambda e: e.get("status") != "cancelled"):
            occ = occurrence(e, TZ)
            if not occ:
                continue
            sid = f"{mid}:{occ['on_date']}"
            if sid in rows and rows[sid]["status"] != "cancelled" and occ["status"] == "cancelled":
                continue
            rows[sid] = {
                "id": sid, "meeting_id": mid, **occ,
                "held": occ["on_date"] <= today.isoformat() and occ["status"] != "cancelled",
            }
    return list(rows.values())


def _same(a: Any, b: Any) -> bool:
    if isinstance(a, str) and isinstance(b, str) and len(a) >= 19 and a[10:11] == "T":
        return when(a) == when(b)
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return a == b
    return a == b or (a in (None, "") and b in (None, ""))


def plan_sittings(plan: Plan, state: State, mid: str, mine: List[Series], today: dt.date) -> None:
    stored = {s["id"]: s for s in state.sittings if s["meeting_id"] == mid}
    rows = sitting_rows(mid, mine, today)
    changed = []
    for r in rows:
        was = stored.get(r["id"])
        if was and all(_same(was.get(k), r.get(k)) for k in ("starts_at", "ends_at", "cal_instance_id", "status", "held")):
            continue
        changed.append(r)
        if was and was.get("status") != r["status"] and r["status"] != "scheduled":
            plan.log(mid, f"{'cancelled' if r['status'] == 'cancelled' else 'moved'} the {r['on_date']} sitting")
    if changed:
        plan.write("POST", "team_sittings?on_conflict=id", changed, "resolution=merge-duplicates,return=minimal")
    # An occurrence Google no longer has is gone from the cockpit too, unless
    # something hangs on it (notes, a spin, a goal, a closed agenda item):
    # then it stays, cancelled. A sitting just written under another
    # occurrence (its day's series is a different event now) is not gone:
    # on 2026-09-30 CSM Daily's sittings were rewritten, then deleted.
    live = {r["cal_instance_id"] for r in rows}
    kept = {r["id"] for r in rows}
    horizon = (today + dt.timedelta(days=LOOK_ON)).isoformat()
    for sid, was in stored.items():
        if sid in kept or not was.get("cal_instance_id") or was["cal_instance_id"] in live:
            continue
        if not (today.isoformat() <= str(was["on_date"]) <= horizon):
            continue
        if str(was.get("notes") or "").strip() or was.get("goal_hit") is not None or sid in state.busy_sittings:
            if was.get("status") != "cancelled":
                plan.write("PATCH", f"team_sittings?id=eq.{q(sid)}", {"status": "cancelled"})
        else:
            plan.write("DELETE", f"team_sittings?id=eq.{q(sid)}")


def plan_guests(
    plan: Plan, state: State, m: Row, faces: List[Row], full_view: bool,
    whois: Callable[[str, Optional[str]], Optional[str]], names: Dict[str, str],
) -> None:
    """Guests added in Google are added and guests taken off in Google are
    marked removed. A part chosen on the page stays, unless Google's
    optional flag for that person changed. A meeting that is a series a day
    has the guests of all its days."""
    mid = m["id"]
    want: Dict[str, bool] = {}  # person -> optional in Google (on every day they are on)
    hosts: Set[str] = set()
    for face in faces:
        for a in face.get("attendees") or []:
            if a.get("resource"):
                continue
            email = str(a.get("email") or "").lower()
            if not internal(email):
                continue
            pid = whois(email, a.get("displayName"))
            if pid:
                want[pid] = want.get(pid, True) and bool(a.get("optional"))
        org = organiser(face)
        host = whois(org, None) if internal(org) else None
        if host:
            hosts.add(host)
            want[host] = False
    rows = {r["person_id"]: r for r in state.links if r["meeting_id"] == mid}
    now = dt.datetime.now(dt.timezone.utc).isoformat()

    def where(pid: str) -> str:
        return f"team_meeting_people?meeting_id=eq.{q(mid)}&person_id=eq.{q(pid)}"

    for pid, optional in want.items():
        r = rows.get(pid)
        name = names.get(pid, pid)
        if not r or r.get("removed"):
            if r and r.get("part") in ("host", "required") and not optional:
                part = r["part"]
            else:
                part = "optional" if optional else ("host" if pid in hosts else "required")
            plan.write("POST", "team_meeting_people?on_conflict=meeting_id,person_id", [{
                "meeting_id": mid, "person_id": pid, "part": part, "removed": False,
                "source": "calendar", "cal_optional": optional, "changed_by": BY, "changed_at": now,
            }], "resolution=merge-duplicates,return=minimal")
            plan.log(mid, f"added {name}" if not r else f"put {name} back")
        elif r.get("cal_optional") is None:
            plan.write("PATCH", where(pid), {"cal_optional": optional})
        elif bool(r["cal_optional"]) != optional:
            part = "optional" if optional else ("required" if r.get("part") == "optional" else r.get("part"))
            plan.write("PATCH", where(pid), {"cal_optional": optional, "part": part, "source": "calendar",
                                             "changed_by": BY, "changed_at": now})
            plan.log(mid, f"made {name} {'optional' if optional else 'required'}")
    # Only a calendar our account can edit shows the whole guest list, and a
    # person put in on the page before the calendar was linked (never seen
    # on the invite) was not taken off in Google.
    if not full_view or not any(face.get("attendees") for face in faces):
        return
    for pid, r in rows.items():
        if r.get("removed") or pid in want:
            continue
        if r.get("source") == "cockpit" and r.get("cal_optional") is None:
            continue
        plan.write("PATCH", where(pid), {"removed": True, "source": "calendar", "changed_by": BY, "changed_at": now})
        plan.log(mid, f"took {names.get(pid, pid)} off the invite")


def plan_quiet(plan: Plan, state: State, series: Dict[Key, Series], owner: Dict[Key, str], today: dt.date) -> None:
    """A calendar meeting with no occurrence in the last three weeks and none
    in the next 45 days is marked inactive: never deleted, and never one the
    cockpit manages."""
    since = (today - dt.timedelta(days=QUIET_BACK)).isoformat()
    until = (today + dt.timedelta(days=QUIET_ON)).isoformat()
    met: Set[str] = set()
    for key, mid in owner.items():
        for e in series[key].live():
            occ = occurrence(e, TZ)
            if occ and since <= occ["on_date"] <= until:
                met.add(mid)
    for m in state.meetings:
        if (m.get("active") and (m.get("managed") or "calendar") == "calendar"
                and m["id"] not in met and m["id"] not in state.pending):
            plan.write("PATCH", f"team_meetings?id=eq.{q(m['id'])}", {"active": False})
            plan.log(m["id"], "marked it inactive: no sitting in the last 21 days or the next 45")


# --- links: the cockpit's own meetings and the series they already have -----


def bare(title: Optional[str]) -> str:
    """A title without its emoji and punctuation, for comparing."""
    return re.sub(r"[^a-z0-9 ]+", " ", str(title or "").lower()).strip()


def propose_links(meetings: List[Row], series: Dict[Key, Series], writable: Set[str],
                  now: dt.datetime, ends: Dict[Key, Optional[str]]) -> List[Row]:
    """For each cockpit meeting with days and a start time, the team series
    that meet then in the next two weeks, and the link to make.

    A candidate meets only at the meeting's start time, on a calendar our
    account can edit, and does not end in the next two weeks (a series
    being retired is not the meeting's). The link is one series on exactly
    the meeting's days, or one series for each of its days. When a day has
    two candidates, the one whose title carries the meeting's name wins."""
    tz = ZoneInfo(TZ)
    start, end = now.astimezone(tz), (now + dt.timedelta(days=LINK_AHEAD)).astimezone(tz)
    horizon = end.date().isoformat()
    out = []
    for m in meetings:
        if (m.get("managed") or "calendar") != "cockpit" or m.get("cal_calendar") or not m.get("start_time"):
            continue
        want_days = sorted(m.get("weekdays") or [])
        want_time = str(m["start_time"])[:5]
        cands = []
        for key, s in sorted(series.items()):
            face = s.face() or {}
            linked_now = m.get("cal_event_id") == s.master
            if not linked_now and not (face and is_meeting(face)):
                continue
            starts = [local((e.get("start") or {}).get("dateTime"), TZ) for e in s.live()]
            starts = [t for t in starts if t and start <= t <= end]
            if not starts:
                continue
            times = {t.strftime("%H:%M") for t in starts}
            days = sorted({sun0(t.date()) for t in starts})
            if not (linked_now or want_time in times):
                continue
            retiring = bool(ends.get(key)) and str(ends.get(key)) <= horizon
            ok = times == {want_time} and key[0] in writable and not retiring
            cands.append({
                "calendar": key[0], "event": key[1], "title": face.get("summary"),
                "days": days, "times": sorted(times), "writable": key[0] in writable,
                "retiring": retiring, "linked_now": linked_now,
                "whole": ok and days == want_days,
                "day": days[0] if ok and len(days) == 1 and days[0] in want_days else None,
            })
        named = lambda c: bare(m.get("title")) in bare(c["title"])  # noqa: E731
        whole = [c for c in cands if c["whole"]]
        if len(whole) > 1:
            whole = [c for c in whole if named(c)]
        link = None
        if len(whole) == 1:
            link = {"kind": "one series", "parts": [(whole[0], None)]}
        elif want_days:
            per_day = {}
            for d in want_days:
                these = [c for c in cands if c["day"] == d]
                if len(these) > 1:
                    these = [c for c in these if named(c)]
                if len(these) == 1:
                    per_day[d] = these[0]
            if len(per_day) == len(want_days) and len(want_days) > 1:
                link = {"kind": "a series a day", "parts": [(per_day[d], d) for d in want_days]}
        out.append({"meeting": m["id"], "title": m.get("title"), "days": want_days,
                    "time": want_time, "candidates": cands, "link": link})
    return out


# --- a pass --------------------------------------------------------------------


def read_state(now: dt.datetime) -> State:
    since = (now - dt.timedelta(days=LOOK_BACK + 1)).date().isoformat()
    meetings = sb("GET", "team_meetings?select=*")
    people = sb("GET", "team_people?select=id,name,email,department")
    links = sb("GET", "team_meeting_people?select=*")
    sittings = sb("GET", "team_sittings?select=id,meeting_id,on_date,starts_at,ends_at,cal_instance_id,"
                         f"status,held,notes,goal_hit&on_date=gte.{since}")
    pending = {r["meeting_id"] for r in sb("GET", "team_calendar_ops?select=meeting_id&status=eq.pending")}
    parts = sb("GET", "team_meeting_series?select=*")
    busy = {r["sitting_id"] for r in sb("GET", "team_wheel_spins?select=sitting_id") if r.get("sitting_id")}
    busy |= {r["sitting_id"] for r in sb("GET", "team_agenda?select=sitting_id&sitting_id=not.is.null")}
    return State(meetings, people, links, sittings, pending, parts, busy)


class Roster:
    """whois(), with the names of everyone it knows, newcomers included."""

    def __init__(self, fn: Callable[[str, Optional[str]], Optional[str]], names: Dict[str, str]):
        self.fn, self.names = fn, names

    def __call__(self, email: str, display: Optional[str]) -> Optional[str]:
        return self.fn(email, display)


def roster(state: State, newcomers: List[Row]) -> Roster:
    """The person behind an address, adding someone we have not met.

    Anyone on our own domain who turns up on an internal meeting is on the
    team by definition. An address is matched by the email the roster
    holds. A roster row with no email yet takes the address of the first
    guest whose first name is its first name, once, so the match is exact
    from then on."""
    by_email = {str(p["email"]).lower(): p["id"] for p in state.people if p.get("email")}
    known_ids = {p["id"] for p in state.people}
    by_first: Dict[str, Row] = {}
    for p in state.people:
        if not p.get("email"):
            by_first.setdefault(str(p.get("name") or p["id"]).split()[0].lower(), p)

    def whois(email: str, display: Optional[str]) -> Optional[str]:
        email = email.lower()
        if not internal(email):
            return None
        if email in by_email:
            return by_email[email]
        first = re.split(r"[.\-_]", email.split("@")[0])[0]
        p = by_first.pop(first, None)
        if p:
            newcomers.append({"patch": p["id"], "email": email})
            by_email[email] = p["id"]
            return p["id"]
        pid = slug(email.split("@")[0].replace(".", " "), 40)
        by_email[email] = pid
        if pid in known_ids:
            return pid  # a second address for someone already on the roster
        name = (display or "").strip() or first.replace("-", " ").title()
        newcomers.append({"id": pid, "name": name, "email": email, "active": True})
        known_ids.add(pid)
        names[pid] = name
        return pid

    names = {p["id"]: p.get("name") or p["id"] for p in state.people}
    return Roster(whois, names)


def read_google(g: Google, now: dt.datetime) -> Tuple[List[Row], List[Row], bool, Set[str]]:
    """Every calendar's events in the window, each tagged with the calendar
    it was read from (`_on`), and the calendars that could be read."""
    cals = g.calendars()
    events: List[Row] = []
    everything = True
    read_ok: Set[str] = set()
    start, end = now - dt.timedelta(days=LOOK_BACK), now + dt.timedelta(days=LOOK_ON)
    for c in cals:
        cid = str(c["id"])
        try:
            got = g.events(cid, start, end)
        except Exception as e:  # one unreadable calendar is not a failed pass
            note(f"  {str(c.get('summary'))[:24]}: {type(e).__name__}")
            everything = False
            continue
        for e in got:
            e["_on"] = cid.lower()
        events += got
        read_ok.add(cid.lower())
    return cals, events, everything, read_ok


def read_masters(g: Google, state: State, series: Dict[Key, Series], readable: Set[str],
                 today: dt.date) -> Dict[Key, Row]:
    """The series events a pass needs: every live part of a linked meeting,
    and each new team series. GONE for one Google no longer has."""
    mt = match(series, state.meetings, state.parts)
    legacy = {m.get("calendar_id") for m in state.meetings if m.get("calendar_id")}
    ended = {(r["cal_calendar"], r["cal_event_id"]) for r in state.parts
             if r.get("ends_on") and str(r["ends_on"]) < today.isoformat()}
    want: Set[Key] = set()
    for mid, keys in mt.parts.items():
        if mid not in state.pending:
            want |= {k for k in keys if k not in ended or k in series}
    want |= {k for k in mt.loose if series[k].face() and is_meeting(series[k].face())
             and series[k].master not in legacy}
    out: Dict[Key, Row] = {}
    for k in want:
        if k[0] in readable:
            e = g.event(k[0], k[1])
            out[k] = e if e is not None else GONE
            continue
        # A teammate's calendar the sign-in does not list can still show its
        # series event to a guest. Without it the copies decide, and Karim's
        # Video Quality sync took a moved one-off's 12:45 for its time
        # (2026-09-30). Only what is read counts: not finding it proves nothing.
        try:
            e = g.event(k[0], k[1])
        except Exception:
            continue
        if e is not None:
            out[k] = e
    return out


def run(dry: bool) -> int:
    now = dt.datetime.now(dt.timezone.utc)
    today = now.astimezone(ZoneInfo(TZ)).date()
    token, via = google_token()
    g = Google(token)
    cals, events, everything, read_ok = read_google(g, now)
    readable = {str(c["id"]).lower() for c in cals}
    writable = {str(c["id"]).lower() for c in cals if c.get("accessRole") in ("owner", "writer")}
    series = group(events, read_ok)
    state = read_state(now)
    masters = read_masters(g, state, series, readable, today)
    newcomers: List[Row] = []
    plan = plan_pass(state, series, masters, writable, now, everything, roster(state, newcomers))
    people = Plan()
    for p in newcomers:
        if "patch" in p:
            people.write("PATCH", f"team_people?id=eq.{q(p['patch'])}&email=is.null", {"email": p["email"]})
        else:
            people.write("POST", "team_people?on_conflict=id", [p], "resolution=ignore-duplicates,return=minimal")
    mt = match(series, state.meetings, state.parts)
    synced = [mid for mid in mt.parts if mid not in state.pending]
    if dry:
        note(f"dry run ({via}): {len(series)} series read, "
             f"{len(people.writes) + len(plan.writes)} write(s), {len(plan.changes)} change(s)")
        people.show()
        plan.show()
        return 0
    people.apply(sb)
    plan.apply(sb)
    if synced:
        sb("PATCH", "team_meetings?id=in.(" + ",".join(f'"{i}"' for i in synced) + ")",
           {"cal_synced_at": now.isoformat()}, "return=minimal")
    note(f"{len(series)} series read ({via}), {len(plan.writes)} write(s), {len(plan.changes)} change(s)"
         + ("" if everything else "; a calendar could not be read, so nothing was marked inactive"))
    return 0


def links(apply: bool) -> int:
    now = dt.datetime.now(dt.timezone.utc)
    token, via = google_token()
    g = Google(token)
    cals, events, _, read_ok = read_google(g, now)
    writable = {str(c["id"]).lower() for c in cals if c.get("accessRole") in ("owner", "writer")}
    series = group(events, read_ok)
    meetings = sb("GET", "team_meetings?select=*&active=eq.true")
    # When each series that could be linked ends, from its own event.
    ends: Dict[Key, Optional[str]] = {}
    for key, s in series.items():
        face = s.face()
        if face and is_meeting(face) and key[0] in writable:
            master = g.event(key[0], key[1])
            ends[key] = series_fields(master, TZ).get("ends_on") if master and master.get("recurrence") else None
    found = propose_links(meetings, series, writable, now, ends)
    note(f"links ({via}): {len(found)} cockpit meeting(s)")
    for f in found:
        print(f"{f['meeting']} ({f['title']}): {days_line(f['days'])} {f['time']}")
        for c in f["candidates"]:
            tag = ("linked now" if c["linked_now"] else "retiring" if c["retiring"]
                   else "match" if (c["whole"] or c["day"] is not None) else "near")
            print(f"  {tag}: {c['title']!r} ({'can edit' if c['writable'] else 'read only'}), "
                  f"{days_line(c['days'])} at {', '.join(c['times'])}, series {c['event']}")
        link = f["link"]
        if not link:
            print("  no exact match: it stays off the calendar until 'Put on calendar' on its page")
            continue
        print(f"  EXACT, {link['kind']}: " + "; ".join(
            f"{DAY_NAMES[d] + ' ' if d is not None else ''}{c['title']!r}" for c, d in link["parts"]))
        if not apply:
            continue
        first = link["parts"][0][0]
        sb("PATCH", f"team_meetings?id=eq.{q(f['meeting'])}", {
            "cal_calendar": first["calendar"], "cal_event_id": first["event"],
            "calendar_id": first["event"][:120], "updated_at": now.isoformat(),
        }, "return=minimal")
        sb("POST", "team_meeting_series?on_conflict=cal_calendar,cal_event_id", [{
            "meeting_id": f["meeting"], "cal_calendar": c["calendar"], "cal_event_id": c["event"],
            "weekday": d, "cal_title": c["title"], "cal_writable": c["writable"],
        } for c, d in link["parts"]], "resolution=merge-duplicates,return=minimal")
        sb("POST", "team_changes", [{
            "by_whom": SETUP, "meeting_id": f["meeting"],
            "what": "linked to its Google Calendar series" + (
                f", one a day ({days_line(f['days'])})" if link["kind"] == "a series a day" else ""),
            "detail": {"series": [{"calendar": c["calendar"], "event": c["event"], "weekday": d}
                                  for c, d in link["parts"]]},
        }], "return=minimal")
        print("  linked")
    return 0


def doctor() -> int:
    ok = True
    try:
        token, via = google_token()
        cals = Google(token).calendars()
        editable = sum(1 for c in cals if c.get("accessRole") in ("owner", "writer"))
        print(f"google: OK via {via}, {len(cals)} calendars, {editable} editable")
    except Exception as e:
        ok = False
        print(f"google: FAILED {type(e).__name__}: {str(e)[:160]}")
    for k in ("GOOGLE_CAL_CLIENT_ID", "GOOGLE_CAL_CLIENT_SECRET", "GOOGLE_CAL_REFRESH_TOKEN"):
        print(f"{k}: {'set' if os.environ.get(k) else 'missing (the editor desk sign-in reads instead)'}")
    try:
        print(f"supabase: OK, {len(sb('GET', 'team_meetings?select=id'))} meetings")
    except Exception as e:
        ok = False
        print(f"supabase: FAILED {type(e).__name__}: {str(e)[:160]}")
    return 0 if ok else 1


def main(argv: List[str]) -> int:
    if argv[:1] == ["doctor"]:
        return doctor()
    if argv[:1] == ["links"]:
        return links("--apply" in argv)
    return run("--dry-run" in argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
