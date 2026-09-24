"""Fathom recordings of sales calls, per rep, matched to a lead where the desk can.

A recording belongs to a lead when one of the invite's outside addresses is
the lead's email, any case. When nobody from outside was on the invite (the
lead joined from the link), it belongs to the lead whose intro or demo
appointment started within 30 minutes of the recording, if exactly one lead
had one then. Anything less certain stays unmatched: a proposal drafted for the
wrong lead is worse than one the closer has to point at the right call.

Client-service calls are left out by title, with the same filter webinar-pull
uses, and a meeting with nobody from outside on the invite and no appointment
beside it is a team meeting, not a sales call.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Optional

from . import http
from .errors import Refused
from .fathom import NOT_SALES, Fathom, flatten, parse_ts
from .supabase import iso

WINDOW = timedelta(minutes=30)
OUR_DOMAIN = "maharamedia.com"
SALES_CALLS = ("intro", "demo")
# What this desk writes in matched_by. Anything else on a row was put there by
# someone else (a person pointing a recording at a lead) and is left alone.
OURS = ("email", "appointment", "none")

NO_RECORDING = ("No Fathom recording of this lead's demo was found. Share the recording "
                "with the team in Fathom, then draft again.")
TOO_SHORT = ("The Fathom recordings of this lead are too short to draft from (under {n:,} "
             "characters of transcript). Share the demo's recording with the team in Fathom, "
             "then draft again.")


def title_of(meeting: dict[str, Any]) -> str:
    return str(meeting.get("title") or meeting.get("meeting_title") or "")


def started(meeting: dict[str, Any]) -> Optional[datetime]:
    return parse_ts(meeting.get("recording_start_time") or meeting.get("scheduled_start_time")
                    or meeting.get("created_at"))


def duration_s(meeting: dict[str, Any]) -> Optional[int]:
    a, b = parse_ts(meeting.get("recording_start_time")), parse_ts(meeting.get("recording_end_time"))
    return int((b - a).total_seconds()) if a and b and b >= a else None


def recorder(meeting: dict[str, Any]) -> dict[str, str]:
    who = meeting.get("recorded_by") if isinstance(meeting.get("recorded_by"), dict) else {}
    return {"name": str(who.get("name") or ""), "email": str(who.get("email") or "").strip().lower()}


def external_emails(meeting: dict[str, Any]) -> list[str]:
    """Outside addresses on the invite, in invite order. Our own domain is never outside."""
    out: list[str] = []
    for inv in meeting.get("calendar_invitees") or []:
        if not isinstance(inv, dict):
            continue
        email = str(inv.get("email") or "").strip().lower()
        if not email or "@" not in email or email.endswith("@" + OUR_DOMAIN):
            continue
        if inv.get("is_external") is False:
            continue
        if email not in out:
            out.append(email)
    return out


def _near(appointments: Iterable[dict[str, Any]], at: datetime) -> list[tuple[float, dict[str, Any]]]:
    out = []
    for a in appointments:
        if str(a.get("call_type") or "") not in SALES_CALLS:
            continue
        t = parse_ts(a.get("start_at"))
        if t is None:
            continue
        gap = abs((t - at).total_seconds())
        if gap <= WINDOW.total_seconds():
            out.append((gap, a))
    return sorted(out, key=lambda x: x[0])


def match(meeting: dict[str, Any], *, leads: dict[str, dict[str, Any]],
          appointments: list[dict[str, Any]], rep_user_ids: Iterable[str] = ()) -> tuple[Optional[str], Optional[str], str]:
    """(contact_id, appointment_id, matched_by) for one meeting."""
    at = started(meeting)
    for email in external_emails(meeting):
        lead = leads.get(email)
        if lead and lead.get("contact_id"):
            contact = str(lead["contact_id"])
            appt = None
            if at is not None:
                mine = [a for _gap, a in _near(appointments, at) if str(a.get("contact_id") or "") == contact]
                appt = mine[0].get("appointment_id") if mine else None
            return contact, appt, "email"
    if at is None:
        return None, None, "none"
    near = _near(appointments, at)
    reps = {str(u) for u in rep_user_ids if u}
    if reps:
        theirs = [(g, a) for g, a in near if str(a.get("assigned_user_id") or "") in reps]
        if theirs:
            near = theirs
    contacts = {str(a.get("contact_id")) for _g, a in near if a.get("contact_id")}
    if len(contacts) != 1:
        return None, None, "none"
    contact = contacts.pop()
    appt = next(a for _g, a in near if str(a.get("contact_id")) == contact)
    return contact, appt.get("appointment_id"), "appointment"


def row_for(meeting: dict[str, Any], contact: Optional[str], appointment: Optional[str], how: str) -> dict[str, Any]:
    at = started(meeting)
    who = recorder(meeting)
    return {
        "recording_id": str(meeting.get("recording_id")),
        "title": title_of(meeting)[:300] or None,
        "recorded_by": who["email"] or who["name"] or None,
        "started_at": iso(at) if at else None,
        "duration_s": duration_s(meeting),
        "share_url": meeting.get("share_url") or meeting.get("url"),
        "contact_id": contact,
        "appointment_id": appointment,
        "matched_by": how,
    }


def index(sb: Any, fathom: Fathom, log: Callable[[str], None], *, days: int) -> dict[str, Any]:
    """Every sales call recorded in the last `days`, each rep asked for by name."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    people = sb.people()
    reps: dict[str, Optional[str]] = {}
    for p in people:
        email = str(p.get("fathom_email") or "").strip().lower()
        if email:
            reps.setdefault(email, p.get("ghl_user_id"))

    meetings: dict[str, dict[str, Any]] = {}
    for m in fathom.meetings(since=since):  # the key's owner: Aziz's own calls
        if m.get("recording_id") is not None:
            meetings[str(m["recording_id"])] = m
    unread: list[str] = []
    for email in sorted(reps):
        try:
            for m in fathom.meetings(since=since, recorded_by=email):
                if m.get("recording_id") is not None:
                    meetings.setdefault(str(m["recording_id"]), m)
        except Exception as e:  # noqa: BLE001 - one rep's calls are not worth the rest
            unread.append(email)
            log(f"recordings: {email}'s calls could not be read: {http.scrub(str(e))[:160]}")

    sales = [m for m in meetings.values() if not NOT_SALES.search(title_of(m))]
    not_sales = len(meetings) - len(sales)
    leads = sb.leads_by_email({e for m in sales for e in external_emails(m)})
    starts = [t for t in (started(m) for m in sales) if t]
    appointments = (sb.appointments_between(iso(min(starts) - WINDOW), iso(max(starts) + WINDOW))
                    if starts else [])

    rows: list[dict[str, Any]] = []
    team = 0
    for m in sales:
        rep_id = reps.get(recorder(m)["email"])
        contact, appt, how = match(m, leads=leads, appointments=appointments,
                                   rep_user_ids=[rep_id] if rep_id else [])
        if how == "none" and not external_emails(m):
            team += 1
            continue
        rows.append(row_for(m, contact, appt, how))

    kept = _keep_earlier_matches(sb, rows)
    stored = sb.store_recordings(rows) if rows else 0
    by = {"email": 0, "appointment": 0, "none": 0}
    for r in rows:
        by[r["matched_by"]] = by.get(r["matched_by"], 0) + 1
    summary = {
        "days": days, "reps": len(reps), "seen": len(meetings), "not_sales": not_sales,
        "team": team, "indexed": stored, "by_email": by.get("email", 0),
        "by_appointment": by.get("appointment", 0), "unmatched": by.get("none", 0),
        "kept_earlier_match": kept, "reps_unread": unread,
    }
    log(f"recordings: {summary}")
    return summary


def _quoted(values: Iterable[str]) -> list[str]:
    return ['"' + str(v).replace('"', '') + '"' for v in values]


def _keep_earlier_matches(sb: Any, rows: list[dict[str, Any]]) -> int:
    """A match found once is evidence. A later run that cannot see it again
    (the appointment left the mirror, say) does not overwrite it with none,
    and a match somebody made by hand is never overwritten at all."""
    ids = [r["recording_id"] for r in rows]
    have: dict[str, dict[str, Any]] = {}
    for i in range(0, len(ids), 100):
        chunk = ids[i : i + 100]
        for r in sb.select("cockpit_sales_recordings",
                           "select=recording_id,contact_id,appointment_id,matched_by"
                           f"&recording_id=in.({','.join(_quoted(chunk))})"):
            have[str(r.get("recording_id"))] = r
    kept = 0
    for r in rows:
        was = have.get(r["recording_id"])
        if not was:
            continue
        how = str(was.get("matched_by") or "")
        by_hand = how and how not in OURS
        lost = r["matched_by"] == "none" and how in ("email", "appointment")
        if by_hand or lost:
            r["contact_id"], r["appointment_id"], r["matched_by"] = (
                was.get("contact_id"), was.get("appointment_id"), how)
            kept += 1
    return kept


@dataclass
class Picked:
    recording: dict[str, Any]
    text: str


def pick(sb: Any, fathom: Fathom, log: Callable[[str], None], *, contact_id: str,
         recording_id: str = "", min_chars: int = 5000,
         reindex: Optional[Callable[[], Any]] = None) -> Picked:
    """The call a proposal is drafted from.

    A recording the closer named is used as named. Otherwise the newest
    recording matched to the lead whose transcript is long enough to be a
    demo, looking in Fathom again once if the index has nothing yet: a closer
    who asks straight after the call can be ahead of the half-hourly index.
    """
    if recording_id:
        row = sb.recording(recording_id) or {"recording_id": recording_id}
        text = flatten(fathom.transcript(recording_id))
        if not text:
            raise RuntimeError("Fathom has no transcript for that recording yet. It usually appears "
                               "within minutes of the call ending; this will try again.")
        return Picked(row, text)

    if not contact_id:
        raise Refused("This request names neither a lead nor a recording, so there is no call to draft from.")
    rows = sb.recordings_of(contact_id)
    if not rows and reindex is not None:
        log(f"no recording indexed for {contact_id} yet; reading Fathom again")
        reindex()
        rows = sb.recordings_of(contact_id)
    if not rows:
        raise Refused(NO_RECORDING)
    for row in rows:
        text = flatten(fathom.transcript(row["recording_id"]))
        if len(text) >= min_chars:
            return Picked(row, text)
        log(f"recording {row['recording_id']}: {len(text)} characters, too short to draft from")
    raise Refused(TOO_SHORT.format(n=min_chars))
