#!/usr/bin/env python3
"""Keeps the team's meetings in step with Google Calendar.

What counts as a team meeting, in Aziz's words: if there is no meeting
link attached, it does not count. That rules out personal time blocks --
Morning Workflow, Sleep, his own planning hours -- which is most of what
a calendar actually holds.

A link alone is not enough, though: every client call has one too, and
there are ten times more of those than meetings. So the rule is three
things together.

* **A meeting link.** Google Meet, Zoom or Teams, on the event or in its
  location or description.
* **Two or more of our own people**, counting the organiser, who is
  often not in the attendee list. Without counting them every 1:1 looks
  like one person talking to themselves and is dropped.
* **Nobody from outside.** This is what separates a 1:1 with Nada from a
  call with a client, since both are two people with a Meet link.

Sixteen calendars are scanned, not one: the real meetings live on
Miriam's, Saleh's and Abdulelah's rather than on Aziz's own.
"""

from __future__ import annotations

import collections
import datetime
import json
import os
import re
import sys
import urllib.parse
import urllib.request

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "editor-desk")
)

LOOK_BACK = 60
LOOK_ON = 45


def note(line: str) -> None:
    print(f"[{datetime.datetime.now(datetime.timezone.utc):%H:%M:%S}] {line}", flush=True)


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


def has_link(e: dict) -> bool:
    if e.get("hangoutLink"):
        return True
    if (e.get("conferenceData") or {}).get("entryPoints"):
        return True
    blob = f"{e.get('location', '')} {e.get('description', '')}"
    return any(w in blob for w in ("meet.google.com", "zoom.us", "teams.microsoft"))


def internal(email: str) -> bool:
    return str(email).lower().endswith("@maharamedia.com")


def sides(e: dict) -> tuple[list[str], list[str]]:
    """Our people and theirs, with the organiser counted as an attendee."""
    ours, theirs = [], []
    for a in e.get("attendees") or []:
        if a.get("resource"):
            continue
        email = str(a.get("email") or "").lower()
        (ours if internal(email) else theirs).append(email)
    org = str((e.get("organizer") or {}).get("email") or "").lower()
    # The organiser is often absent from the attendee list, and without
    # them every 1:1 has one person on it and is dropped as a solo block.
    if org and internal(org) and org not in ours:
        ours.append(org)
    return ours, theirs


# The roster spells some people one way and their email another, and a
# near-match is a second row for the same person rather than a new
# colleague. Checked by hand once; the sync must not undo it.
ALIASES = {
    "ahmedabushaiba": "ahmed-abu-shayba",
    "daniyaziad": "daniya",
    "lamah": "lama",
    "muhammedburhan": "muhammad-burhan",
    "sabry": "sabri",
    "moatazazab": "moaz",
}


def person_id(email: str) -> str:
    return slug(email.split("@")[0].replace(".", " "), 40)


def is_meeting(e: dict) -> bool:
    ours, theirs = sides(e)
    return has_link(e) and len(ours) >= 2 and not theirs


def slug(text: str, limit: int = 48) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:limit]


def main() -> int:
    from desk import http
    from desk.config import Config
    from desk.drive import Drive

    token = Drive(Config.from_env(), lambda s: None).token()
    auth = {"Authorization": f"Bearer {token}"}
    now = datetime.datetime.now(datetime.timezone.utc)

    people = sb("GET", "team_people?select=id,name,email")
    by_first: dict[str, str] = {}
    by_email: dict[str, str] = {}
    for p in people:
        by_first.setdefault(str(p["name"]).split()[0].lower(), p["id"])
        if p.get("email"):
            by_email[str(p["email"]).lower()] = p["id"]

    def whois(email: str, display: str | None = None) -> str:
        """The person behind an address, adding them if we have not met them.

        The EOD roster only holds the people who file one, so the team
        leads whose calendars carry most of the meetings were missing --
        and a meeting with no host and no attendees is not much of a
        meeting. Anyone on our own domain who turns up on an internal
        meeting is on the team by definition.
        """
        email = email.lower()
        if email in by_email:
            return by_email[email]
        local = email.split("@")[0]
        if local in ALIASES:
            by_email[email] = ALIASES[local]
            return ALIASES[local]
        first = local.split(".")[0]
        if first in by_first:
            by_email[email] = by_first[first]
            return by_first[first]
        pid = person_id(email)
        name = (display or "").strip() or first.replace("-", " ").title()
        sb("POST", "team_people?on_conflict=id", [{
            "id": pid, "name": name, "email": email, "active": True,
        }], "resolution=merge-duplicates,return=minimal")
        by_email[email] = pid
        by_first.setdefault(first, pid)
        note(f"  met {name} <{email}>")
        return pid

    cals = [
        c
        for c in http.get_json(
            "https://www.googleapis.com/calendar/v3/users/me/calendarList",
            headers=auth, timeout=40,
        ).get("items", [])
        if "holiday" not in str(c.get("id", "")).lower()
        and "todoist" not in str(c.get("summary", "")).lower()
    ]

    window = urllib.parse.urlencode({
        "timeMin": (now - datetime.timedelta(days=LOOK_BACK)).isoformat(),
        "timeMax": (now + datetime.timedelta(days=LOOK_ON)).isoformat(),
        "singleEvents": "true", "orderBy": "startTime", "maxResults": 250,
    })

    series: dict[str, dict] = {}
    skipped = 0
    for c in cals:
        try:
            items = http.get_json(
                "https://www.googleapis.com/calendar/v3/calendars/"
                f"{urllib.parse.quote(str(c['id']))}/events?{window}",
                headers=auth, timeout=60,
            ).get("items", [])
        except Exception as e:
            note(f"  {str(c.get('summary'))[:24]}: {type(e).__name__}")
            continue
        for e in items:
            title = str(e.get("summary") or "").strip()
            if not title:
                continue
            if not is_meeting(e):
                skipped += 1
                continue
            ours, _ = sides(e)
            s = series.setdefault(
                title, {"n": 0, "ours": [], "rec": False, "cid": "", "dates": []}
            )
            s["n"] += 1
            s["rec"] = s["rec"] or bool(e.get("recurringEventId"))
            start = (e.get("start") or {}).get("dateTime") or (e.get("start") or {}).get("date")
            if start:
                s["dates"].append(start[:10])
            names = {
                str(a.get("email") or "").lower(): str(a.get("displayName") or "")
                for a in (e.get("attendees") or [])
            }
            s["names"] = {**s.get("names", {}), **names}
            if len(ours) > len(s["ours"]):
                s["ours"] = ours
                s["cid"] = str(e.get("recurringEventId") or e.get("id") or "")[:120]
                s["organizer"] = str((e.get("organizer") or {}).get("email") or "").lower()

    # What the team decided on the screen (portal /team) is theirs: a meeting
    # edited there is `managed = 'cockpit'`, and the calendar no longer sets
    # its title, cadence, department or host. [2026-09-23]
    managed = {
        r["id"]: r.get("managed") or "calendar"
        for r in sb("GET", "team_meetings?select=id,managed")
    }

    made = attached = sittings = 0
    for title, s in series.items():
        mid = slug(title)
        if not mid:
            continue
        ids, host = [], None
        for email in s["ours"]:
            pid = whois(email, s.get("names", {}).get(email))
            if pid not in ids:
                ids.append(pid)
            if email == s.get("organizer"):
                host = pid
        depts = collections.Counter(
            r["department"]
            for r in (sb("GET", "team_people?select=id,department&id=in.("
                         + ",".join(f'"{i}"' for i in ids) + ")") if ids else [])
            if r.get("department")
        )
        if managed.get(mid) == "cockpit":
            sb("PATCH", f"team_meetings?id=eq.{urllib.parse.quote(mid)}", {
                "calendar_id": s["cid"],
                "updated_at": now.isoformat(),
            }, "return=minimal")
        else:
            sb("POST", "team_meetings?on_conflict=id", [{
                "id": mid,
                "title": title,
                "cadence": "weekly" if s["rec"] and s["n"] >= 6 else ("monthly" if s["rec"] else "as needed"),
                # Only when everyone on it is from one department; a meeting
                # spanning two is not "a Media meeting" and saying so is worse
                # than saying nothing.
                "department": depts.most_common(1)[0][0] if len(depts) == 1 else None,
                "host_id": host,
                "calendar_id": s["cid"],
                "created_by": "calendar",
                "updated_at": now.isoformat(),
            }], "resolution=merge-duplicates,return=minimal")
        made += 1

        if ids:
            # Only people the meeting has never had are added. A part chosen
            # on the screen (host, required, optional), or a person taken off
            # there (kept as `removed`), is never overwritten from the invite.
            sb("POST", "team_meeting_people?on_conflict=meeting_id,person_id",
               [{"meeting_id": mid, "person_id": p,
                 "part": "host" if p == host else "required"} for p in ids],
               "resolution=ignore-duplicates,return=minimal")
            attached += len(ids)

        # A sitting per date it actually ran, so an agenda has somewhere
        # to hang and last time's notes have a place to be read.
        rows = [{"id": f"{mid}:{d}", "meeting_id": mid, "on_date": d,
                 "held": d <= now.date().isoformat()}
                for d in sorted(set(s["dates"]))]
        if rows:
            sb("POST", "team_sittings?on_conflict=id", rows,
               "resolution=merge-duplicates,return=minimal")
            sittings += len(rows)

    note(f"{made} meeting(s), {attached} attendance(s), {sittings} sitting(s); "
         f"{skipped} calendar entries were not meetings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
