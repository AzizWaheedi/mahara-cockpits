"""`desk.py deploy-check`: is this box ready for live calls and the follow-up
agent, with every switch still off? Run on the VPS, as `hermes`, after the
migrations are applied and before anything is switched on.

It changes nothing: no row, no status row, no file, no call to Zoom, Google,
Slack or HighLevel. It reads keys by name (a value is never printed, not
even its length), the database through PostgREST GETs (a table or a column
that is missing is a 404 or a 400; a function is asked with GET, which
PostgREST runs read-only), and `crontab -l`.

Each line says what is missing and what that means, in the doctor's marks:
`OK` ready, `--` missing or switched on (the deploy is not ready), `??` not
known or only needed before a switch is turned on. Missing is never zero:
a check that could not be made says so, and is never counted as passed.

The exit code is 0 when nothing is `--`, else 1.
"""
from __future__ import annotations

import re
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from . import http
from .config import key
from .rooms import GOOGLE_KEY_SETS, LEASE_FN, ZOOM_KEYS, db_reason, parse_ts

# What the code reads and writes, by migration. A missing table or column
# here is a write that fails on the day the switch is turned on.
TABLES: dict[str, tuple[str, tuple[str, ...]]] = {
    "cockpit_sales_rooms": ("20261003a_sales_rooms.sql", (
        "id", "code", "contact_id", "purpose", "call_kind", "provider", "host_email", "state", "version", "error",
        "result", "requested_at", "claimed_at", "worker_run", "opened_at", "join_url", "provider_meeting_id",
        "host_by", "lead_by", "ends_at", "ended_at", "lead_in_at", "appointment_id")),
    "cockpit_sales_room_secrets": ("20261003a_sales_rooms.sql", ("room_id", "start_url", "expires_at")),
    "cockpit_sales_room_events": ("20261003a_sales_rooms.sql", (
        "id", "room_id", "kind", "source", "dedupe_key", "at", "handled_at", "tries", "last_try_at", "lease_until",
        "text", "detail")),
    "cockpit_sales_room_hosts": ("20261003a_sales_rooms.sql", (
        "email", "zoom_user_id", "zoom_status", "zoom_live_until", "google_ok", "default_provider", "checked_at")),
    "cockpit_sales_availability": ("20261003a_sales_rooms.sql", ("email", "state", "until", "reason")),
    "cockpit_sales_live": ("20261003a_sales_rooms.sql", ("id", "state", "claim_room", "room_id")),
    "cockpit_sales_alerts": ("20261003a_sales_rooms.sql", (
        "dedupe_key", "source", "kind", "subject", "message", "detail", "resolved_at")),
    "cockpit_sales_presence": ("20261003a_sales_rooms.sql", ("email", "state")),
    "cockpit_sales_followup_waves": ("20261003c_sales_followup_agent.sql", (
        "id", "pool", "segment", "per_day", "holdout_share", "state", "made_by", "started_at")),
    "cockpit_sales_followup_wave_members": ("20261003c_sales_followup_agent.sql", (
        "wave_id", "contact_id", "arm", "state", "followup_id", "event_at", "drafted_at", "sent_at",
        "excluded_reason")),
    "cockpit_sales_followup_meta": ("20261003c_sales_followup_agent.sql", (
        "followup_id", "kind_key", "wave_id", "send_after", "held_by", "held_at", "approved_by")),
    "cockpit_sales_followup_stops": ("20261003c_sales_followup_agent.sql", (
        "contact_id", "said_at", "kind", "state", "paused_until")),
    "cockpit_sales_settings": ("20260924a_sales_cockpit.sql", ("key", "value")),
    "cockpit_sales_worker_status": ("20260924a_sales_cockpit.sql", ("worker", "job", "ok", "detail", "at")),
    "cockpit_sales_people": ("20260924a_sales_cockpit.sql", ("email", "role", "active")),
    "cockpit_sales_followups": ("the follow-ups migration", ("id", "contact_id", "segment", "status")),
    "cockpit_sales_wa_templates": ("the WhatsApp templates migration", ("key",)),
}

# Columns contract-v2 section 10 adds (the database lane's delta migration
# after 20261003c), with what fails without them.
DELTA: dict[str, tuple[tuple[str, ...], str]] = {
    "cockpit_sales_rooms": (("link_claimed_at", "count_undo_at", "link_unconfirmed_at"),
                            "sales-api's link claim and its count undo fail, so no lead gets a room link"),
    "cockpit_sales_followup_waves": (("enrolled_at", "done_reason", "settled_at"),
                                     "the waves job's writes are refused, so no wave enrols, ends or settles"),
    "cockpit_sales_followup_wave_members": (
        ("next_try_at", "later_reason", "fail_count", "last_error", "due_at", "replied_at", "booked_at", "closed_at"),
        "the waves job cannot keep its members in step, so no opener is written"),
    "cockpit_sales_followup_meta": (("hold_reason",), "an opener set aside for a person cannot say why"),
}
DELTA_WHERE = "the delta migration after 20261003c (contract-v2 section 10)"

SETTINGS = ("rooms", "live", "followups", "whatsapp_guard", "threads")

# (where, value it must have, what it means when it does not). Every one of
# them ships off (glossary 1.4 and updates.md: "Everything ships switched off").
SWITCHES: tuple[tuple[str, tuple[str, ...], Any, str], ...] = (
    ("rooms", ("enabled",), False, "video rooms are live for every rep"),
    ("rooms", ("test_only",), True, "rooms are not kept to the test contacts"),
    ("rooms", ("providers", "zoom"), False, "Zoom rooms can be made"),
    ("rooms", ("providers", "meet"), False, "Meet rooms can be made"),
    ("rooms", ("send", "whatsapp_text"), False, "room links go to leads by WhatsApp"),
    ("rooms", ("send", "whatsapp_template"), False, "room links go to leads by WhatsApp template"),
    ("rooms", ("send", "email"), False, "room links go to leads by email"),
    ("rooms", ("count_on_join",), False, "a lead joining is booked and marked shown"),
    ("rooms", ("fallback", "auto_on_miss"), False, "a missed dial makes a room by itself"),
    ("rooms", ("short_link",), False, "messages carry the short link, whose page copy is still a draft"),
    ("live", ("enabled",), False, "live handovers are on"),
    ("live", ("slack",), False, "handover offers and replies go to Slack"),
    ("live", ("kinds", "intro"), False, "intro handovers are on"),
    ("live", ("kinds", "demo"), False, "demo handovers are on"),
    ("threads", ("enabled",), False, "demo chats are on"),
    ("followups", ("autosend", "reactivate"), False, "backlog openers send by themselves, not by an approved batch"),
)

CRON_LINES: tuple[tuple[str, tuple[str, ...], str], ...] = (
    ("rooms", ("flock -w 10", "desk.py --quiet rooms --for 57"),
     "the room worker does not run: rooms wait and the sweep fails them at 60 s, and Slack replies are not sent"),
    ("room-hosts", ("rooms --check-hosts",), "seats' Zoom status and the Google sign-in are not checked"),
    ("doctor", ("doctor --cron",), "nobody checks the desk hourly; the watchdog's doctor row goes stale"),
    ("followups", ("desk.py --quiet followups",), "no follow-up is drafted"),
    ("waves", ("desk.py --quiet waves",), "no backlog wave enrols, drafts or sends"),
)

# (worker, job, what it is, how stale it may be in seconds: the watchdog's
# and the health line's thresholds, glossary 1.7 and contract-v2 7.9).
STATUS_ROWS: tuple[tuple[str, str, str, int], ...] = (
    ("sales-desk", "rooms", "the room worker", 90),
    ("sales-desk", "room-hosts", "the room host check", 20 * 60),
    ("sales-desk", "slack", "the Slack poster (inside the rooms run)", 10 * 60),
    ("sales-desk", "doctor", "the hourly doctor", 75 * 60),
    ("sales-desk", "followups", "the follow-up drafter", 75 * 60),
    ("sales-desk", "waves", "the backlog wave run", 15 * 60),
    ("sales-api", "sweep", "the room sweep (pg_cron mahara-sales-rooms-sweep)", 5 * 60),
)


class Report:
    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    def add(self, section: str, name: str, ok: Optional[bool], detail: str) -> None:
        self.rows.append({"section": section, "check": name, "ok": ok, "detail": detail})

    @property
    def blockers(self) -> list[dict[str, Any]]:
        return [r for r in self.rows if r["ok"] is False]


def _get(sb: Any, path: str) -> tuple[Optional[int], Any, str]:
    """(status or None when there was no answer, the rows, the reason). A GET
    only, never retried, short: this is a check, not a job."""
    try:
        out = sb.rest("GET", path, retries=0)
        return 200, out, ""
    except http.HttpError as e:
        return (e.status or None), None, db_reason(e)


def _missing_column(reason: str) -> bool:
    return "42703" in reason or "does not exist" in reason or "PGRST204" in reason or "Could not find" in reason


def _dig(value: Any, path: tuple[str, ...]) -> Any:
    for part in path:
        value = value.get(part) if isinstance(value, dict) else None
    return value


def check_keys(report: Report, settings: dict[str, Any]) -> None:
    sec = "Keys on this box (by name; no value is printed)"
    have = {n: bool(key(n)) for n in ("DESK_SUPABASE_URL", "DESK_SUPABASE_KEY")}
    missing = [n for n, ok in have.items() if not ok]
    report.add(sec, "DESK_SUPABASE_URL, DESK_SUPABASE_KEY", not missing,
               "set" if not missing else f"not set ({', '.join(missing)}): nothing in the database can be read or "
               "written, so no room is made and no reply is sent. Source ~/.editor-desk/env")
    rooms = settings.get("rooms") if isinstance(settings.get("rooms"), dict) else {}
    live = settings.get("live") if isinstance(settings.get("live"), dict) else {}
    zoom_on = _dig(rooms, ("providers", "zoom")) is True
    meet_on = _dig(rooms, ("providers", "meet")) is True
    slack_on = live.get("slack") is True

    zoom_missing = [n for n in ZOOM_KEYS if not key(n)]
    report.add(sec, "Zoom keys",
               True if not zoom_missing else (False if zoom_on else None),
               f"set ({', '.join(ZOOM_KEYS)}; the doctor checks them live)" if not zoom_missing else
               f"not set ({', '.join(zoom_missing)}): Zoom rooms cannot be made, and a rep who asks for one reads "
               "\"Zoom is not connected on the room worker.\" Set them in /opt/data/bibi/api-keys.env before "
               "rooms.providers.zoom is switched on")

    google = next((names for names in GOOGLE_KEY_SETS if all(key(n) for n in names)), None)
    if google and google[0].startswith("GOOGLE_CAL_"):
        report.add(sec, "Google keys", True, "GOOGLE_CAL_* set: the CEO's calendar sign-in (the doctor checks it "
                                             "live)")
    elif google:
        report.add(sec, "Google keys", None,
                   "GOOGLE_CAL_* not set; the worker falls back to GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and "
                   "GOOGLE_REFRESH_TOKEN, which may have been given for Drive only. Run python3 desk.py doctor: "
                   "its rooms: google line says whether it carries a Calendar permission")
    else:
        report.add(sec, "Google keys", False if meet_on else None,
                   "GOOGLE_CAL_* not set, and no GOOGLE_* sign-in either: Meet rooms cannot be made, and a rep who asks for one "
                   "reads \"Google is not connected on the room worker.\" Connect Google Calendar for the CEO's "
                   "account and set GOOGLE_CAL_CLIENT_ID, GOOGLE_CAL_CLIENT_SECRET and GOOGLE_CAL_REFRESH_TOKEN "
                   "before rooms.providers.meet is switched on")
    report.add(sec, "SALES_ROOMS_CALENDAR_ID", True if key("SALES_ROOMS_CALENDAR_ID") else None,
               "set: Meet rooms go on that calendar and no calendar is listed or made" if
               key("SALES_ROOMS_CALENDAR_ID") else
               "not set (recommended): the worker lists the CEO's calendars to find \"Sales rooms\" and makes it "
               "if missing, which needs the full Calendar permission. Put the calendar's id in ~/.sales-desk/env")
    report.add(sec, "SLACK_SALES_BOT_TOKEN", True if key("SLACK_SALES_BOT_TOKEN") else (False if slack_on else None),
               "set: the Slack poster can send App Home replies" if key("SLACK_SALES_BOT_TOKEN") else
               "not set: Slack replies to App Home presses cannot be sent, and the slack status row says so. Put "
               "the Mahara Sales bot token in /opt/data/bibi/api-keys.env before live.slack is switched on")
    ghl = key("GHL_B2B_API_KEY") or key("SALES_GHL_TOKEN")
    report.add(sec, "GHL_B2B_API_KEY", True if ghl else None,
               "set (or SALES_GHL_TOKEN): the follow-up agent and the waves can read conversations" if ghl else
               "not set, nor SALES_GHL_TOKEN: the follow-up agent and the waves cannot read a conversation and "
               "write nothing. Set it in /opt/data/bibi/api-keys.env")


def check_database(report: Report, sb: Any) -> dict[str, Any]:
    """Tables, columns, the lease function and the settings. Returns the
    settings it read (empty when they could not be read)."""
    sec = "Database (read only)"
    reachable = True
    for table, (where, columns) in TABLES.items():
        status, _rows, reason = _get(sb, f"{table}?select={','.join(columns)}&limit=1")
        if status == 200:
            report.add(sec, table, True, f"there, with the {len(columns)} column{'s' if len(columns) != 1 else ''} "
                                         "the code uses")
        elif status == 404 or (status == 400 and "42P01" in reason):
            report.add(sec, table, False, f"not there ({reason}): apply {where}")
        elif status == 400 and _missing_column(reason):
            # Which ones: each column on its own.
            gone = [c for c in columns if _get(sb, f"{table}?select={c}&limit=1")[0] != 200]
            report.add(sec, table, False, f"there, but without {', '.join(gone) or 'a column the code uses'} "
                                          f"({reason}): apply {where} again, as it is in this branch")
        elif status in (401, 403):
            report.add(sec, table, False, f"refused ({reason}): DESK_SUPABASE_KEY is not the service key")
            reachable = False
            break
        else:
            report.add(sec, table, None, f"could not be read ({reason or 'no answer'}); run the check again")
            reachable = False
            break
    if not reachable:
        return {}
    for table, (columns, meaning) in DELTA.items():
        status, _rows, reason = _get(sb, f"{table}?select={','.join(columns)}&limit=1")
        gone = [] if status == 200 else [c for c in columns if _get(sb, f"{table}?select={c}&limit=1")[0] != 200]
        report.add(sec, f"contract-v2 columns: {table.replace('cockpit_sales_', '')}", not gone,
                   f"there ({', '.join(columns)})" if not gone else
                   f"not there ({', '.join(gone)}): apply {DELTA_WHERE}. Until then {meaning}")
    report.add(sec, "wave member state closed", None,
               "not readable through the API: the members' state check must allow closed (contract-v2 section 10, "
               "item 9), or the desk's 14-day close is refused. python3 supabase/migrations/tests/run_checks.py "
               "checks it")
    status, _rows, reason = _get(sb, f"rpc/{LEASE_FN}?p_event_id=00000000-0000-0000-0000-000000000000")
    if status == 404:
        report.add(sec, LEASE_FN, False, f"not there ({reason}): sales-api, the worker and the Slack poster cannot "
                                         "take an event with the lease. Apply 20261003a_sales_rooms.sql")
    elif status is None:
        report.add(sec, LEASE_FN, None, f"could not be asked ({reason or 'no answer'})")
    else:
        # A GET runs read-only: the function exists whether it answers or
        # refuses to write.
        report.add(sec, LEASE_FN, True, "there")
    status, rows, reason = _get(sb, "cockpit_sales_settings?select=key,value&key=in.("
                                    + ",".join(SETTINGS) + ")")
    if status != 200 or not isinstance(rows, list):
        report.add(sec, "settings", None, f"could not be read ({reason or 'no answer'})")
        return {}
    settings = {str(r.get("key")): r.get("value") for r in rows}
    for name, what in (("rooms", "apply 20261003a_sales_rooms.sql: it inserts the rooms setting switched off"),
                       ("live", "apply 20261003a_sales_rooms.sql: it inserts the live setting switched off"),
                       ("followups", "the follow-up agent's setting is gone: a manager saves Follow-ups settings "
                                     "once"),
                       ("whatsapp_guard", "the WhatsApp gate's setting is gone, so the desk keeps every WhatsApp send "
                                          "shut; a manager saves it once")):
        report.add(sec, f"setting {name}", name in settings, "there" if name in settings else f"not there: {what}")
    return settings


def check_switches(report: Report, sb: Any, settings: dict[str, Any]) -> None:
    sec = "Switches (every one ships off)"
    if not settings:
        report.add(sec, "switches", None, "not checked: the settings could not be read")
        return
    for setting, path, want, meaning in SWITCHES:
        name = f"{setting}.{'.'.join(path)}"
        if setting not in settings:
            report.add(sec, name, True, "not set up yet, so off" if want is False else
                       f"not set up yet: {setting} is missing (see the database lines)")
            continue
        value = _dig(settings[setting], path)
        if want is False:
            ok = value is not True
            shown = "off" if value is False else ("not set, so off" if value is None else f"{value!r}, read as off")
        else:
            ok = value is True
            shown = "on, as it ships" if ok else ("not set" if value is None else f"{value!r}")
        report.add(sec, name, ok, shown if ok else f"{'on' if want is False else shown}: {meaning}. Set it to "
                                                  f"{str(want).lower()} until the CEO says go")
    guard = settings.get("whatsapp_guard") if isinstance(settings.get("whatsapp_guard"), dict) else {}
    gate_open = guard.get("connector_off") is True and bool(guard.get("single_copy_ok_at"))
    report.add(sec, "whatsapp_guard gate", None if not gate_open else True,
               "open: the WA Connector is off and the single-copy test passed" if gate_open else
               "shut: WhatsApp sends from the desk wait until the WA Connector is off and the single-copy test "
               "passes (expected before go-live)")
    status, rows, reason = _get(sb, "cockpit_sales_followup_waves?select=id,pool,state&state=in.(running,paused)"
                                    "&limit=20")
    if status != 200 or not isinstance(rows, list):
        report.add(sec, "backlog waves", None, f"could not be read ({reason or 'no answer'})")
    else:
        report.add(sec, "backlog waves", not rows, "none running" if not rows else
                   f"{len(rows)} running or paused ({', '.join(str(r.get('pool')) for r in rows)}): the follow-up "
                   "agent is live. A manager stops them on the Follow-ups page until the CEO says go")


def check_status_rows(report: Report, sb: Any, now: datetime) -> None:
    sec = "Status rows (what has run)"
    status, rows, reason = _get(sb, "cockpit_sales_worker_status?select=worker,job,ok,detail,at"
                                    "&worker=in.(sales-desk,sales-api)")
    if status != 200 or not isinstance(rows, list):
        report.add(sec, "status rows", None, f"could not be read ({reason or 'no answer'})")
        return
    have = {(str(r.get("worker")), str(r.get("job"))): r for r in rows}
    for worker, job, label, stale_s in STATUS_ROWS:
        r = have.get((worker, job))
        if not r:
            report.add(sec, f"{worker}/{job}", None, f"{label} has never reported: its cron line is not installed "
                                                     "here, or it has not run yet")
            continue
        at = parse_ts(r.get("at"))
        late = at is None or now.timestamp() - at > stale_s
        age = "at an unknown time" if at is None else _ago(now.timestamp() - at)
        said = re.sub(r"\s+", " ", str(r.get("detail") or "")).strip()[:160]
        report.add(sec, f"{worker}/{job}", True if r.get("ok") and not late else None,
                   f"{label} reported {age}" + (f", later than its {_ago(stale_s).replace(' ago', '')}: it may have "
                                                "stopped" if late else "")
                   + ("" if r.get("ok") else ", not OK") + f": {said or 'no detail'}")


def _ago(seconds: float) -> str:
    s = max(0, int(seconds))
    if s < 120:
        return f"{s} s ago"
    if s < 7200:
        return f"{s // 60} minutes ago"
    return f"{s // 3600} hours ago"


def read_crontab() -> tuple[Optional[str], str]:
    """(the crontab, why not). Read only."""
    try:
        out = subprocess.run(["crontab", "-l"], capture_output=True, text=True, timeout=5, check=False)
    except (OSError, subprocess.SubprocessError) as e:
        return None, f"crontab could not be run here ({type(e).__name__})"
    if out.returncode != 0:
        return None, (out.stderr or "no crontab for this user").strip()[:160]
    return out.stdout, ""


def check_cron(report: Report, crontab: Optional[str], why: str) -> None:
    sec = "Cron on this box (README, Cron)"
    if crontab is None:
        report.add(sec, "crontab", None, f"not read: {why}. Run this on the VPS as hermes")
        return
    lines = [ln.strip() for ln in crontab.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    for job, needles, meaning in CRON_LINES:
        hit = next((ln for ln in lines if all(n in ln for n in needles)), None)
        report.add(sec, job, True if hit else None,
                   "installed" if hit else f"no line ({' and '.join(needles)}): {meaning}. Copy it from the "
                                           "README's Cron block with crontab -l > f, edit f, crontab f")


def run(sb: Optional[Any], *, now: Optional[datetime] = None,
        crontab: Optional[Callable[[], tuple[Optional[str], str]]] = None) -> Report:
    report = Report()
    now = now or datetime.now(timezone.utc)
    report.add("This box", "python", sys.version_info >= (3, 9), sys.version.split()[0] + (
        "" if sys.version_info >= (3, 9) else ": the desk needs Python 3.9 or newer"))
    settings: dict[str, Any] = {}
    if sb is not None:
        settings = check_database(report, sb)
    check_keys(report, settings)
    if sb is not None:
        check_switches(report, sb, settings)
        check_status_rows(report, sb, now)
    else:
        report.add("Database (read only)", "database", False,
                   "not asked: DESK_SUPABASE_URL and DESK_SUPABASE_KEY are not set")
    text, why = (crontab or read_crontab)()
    check_cron(report, text, why)
    return report


def words(report: Report) -> str:
    """The printed report, grouped by section."""
    out = ["Deploy check: live calls and the follow-up agent on this box. Nothing is changed.", ""]
    section = None
    for r in report.rows:
        if r["section"] != section:
            section = r["section"]
            out += ["", section] if out[-1] else [section]
        mark = {True: "OK ", False: "-- ", None: "?? "}[r["ok"]]
        out.append(f"{mark} {r['check']:<44} {r['detail']}")
    out.append("")
    blockers = report.blockers
    notes = [r for r in report.rows if r["ok"] is None]
    if blockers:
        out.append(f"Not ready: {len(blockers)} piece{'s are' if len(blockers) != 1 else ' is'} missing or switched on:")
        out += [f"  {r['check']}: {r['detail']}" for r in blockers]
    else:
        out.append("Ready: every table, column, function and setting the desk needs is there, and every switch is "
                   "off." + (f" {len(notes)} line{'s' if len(notes) != 1 else ''} marked ?? say what to set before "
                             "switching something on." if notes else ""))
    return "\n".join(out)

