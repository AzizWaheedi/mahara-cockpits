"""Mahara CSM daily workflow engine.

Run order each morning (Sat-Thu, never Friday):
  1. read yesterday's Today tab
  2. write the ticks, booked dates, notes and stage changes back into ClickUp
  3. archive yesterday's rows + end-of-day answers to the Log tab
  4. rebuild the Today tab from fresh ClickUp data
  5. print a summary for the Slack nudge

Usage:  uv run python skills/csm_daily_workflow/scripts/csm_daily.py [--no-writeback]
"""
from __future__ import annotations

import asyncio
import base64
import datetime as dt
import json
import os
import sys
import zoneinfo

from sdk.tools.pd_clickup import pd_clickup_proxy_get, pd_clickup_proxy_post, pd_clickup_proxy_put
from sdk.tools.pd_google_calendar import pd_google_calendar_list_events
from sdk.tools.pd_google_sheets import pd_google_sheets_proxy_get, pd_google_sheets_proxy_post
from sdk.tools.pd_typeform import pd_typeform_proxy_get

LIST_ID = "901816559981"
CS_LIST_ID = "901816723211"  # Team - Maharamedia > All Assignments > Client Success
SID = "1DZ6eTUbVCSueSMNyRh4HwKxk3BboOZmFy48CDA4-XNE"
WID = 803447562
TZ = zoneinfo.ZoneInfo("Asia/Kuwait")

# Billing escalation ladder
EXT_FORM_ID = "gqBcyK6g"  # Typeform "Client Extension Form"
EXT_CLIENT_REF = "5145ff0c-009b-4f51-b3a9-4651efc908be"   # Client Company Name
EXT_DURATION_REF = "278c2f80-88bd-428e-b330-8c6b3175d63f"  # 1 WEEK / 2 WEEKS / 4 WEEKS
EXT_FORM_URL = "https://maharamedia.typeform.com/to/gqBcyK6g"
PAUSE_FORM_URL = "https://forms.clickup.com/90182518398/f/2kzmr1ky-1178/R1O1N5QXYLUTJOWQ3E"
PAUSE_AFTER_DAYS = 3  # days past the billing date with no logged extension


def _demo_write_capture_enabled() -> bool:
    """Return whether this process is running in captured cron-demo mode.

    The cron test gateway currently exposes this in the tool token claim. An
    explicit environment override is also useful for local validation and
    keeps the script independent of any one gateway error message.
    """
    explicit = os.getenv("VIKTOR_CRON_DEMO_MODE", "").strip().lower()
    if explicit in {"1", "true", "yes", "on", "demo", "capture"}:
        return True

    token = os.getenv("TOOL_TOKEN", "")
    try:
        encoded = token.split(".", 2)[1]
        encoded += "=" * (-len(encoded) % 4)
        claims = json.loads(base64.urlsafe_b64decode(encoded).decode("utf-8"))
    except (IndexError, ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
        return False
    return (
        claims.get("external_delivery_policy") == "capture"
        or (
            claims.get("subagent_capability_profile") == "external_actor"
            and claims.get("call_origin") == "cron_test"
        )
    )


def _is_demo_write_error(exc: BaseException) -> bool:
    """Recognize the gateway error used to block writes in cron demos."""
    text = str(exc).lower()
    return (
        "cron test subagents run in demo mode" in text
        or "permanent external writes are blocked" in text
        or ("demo mode" in text and "external writes" in text)
    )
CONFIG = "skills/csm_daily_workflow/config.json"

F_LAST_POC = "e183f2ce-8b7a-491a-b160-2287a247758b"
F_LAST_CALL = "032203ad-e327-4d76-a0ce-c07496da6486"
F_NEXT_POC = "c48c1323-ca6a-465f-84cb-8c24f0f62df3"
F_STATUS = "9368ca9e-3549-4320-84ff-9abd0a2901cb"

ORDER = ["Needs Contacting", "GHOSTED", "DELAY OUT OF OUR CONTROL", "Onboarding Booked",
         "LAUNCH BOOKED", "Ready For Launch\U0001f680", "Active"]
HEAD = ["Client", "Stage", "Silent", "Check-in", "What to do today", "Text \u2713", "Call \u2713",
        "Next check-in booked", "Note (goes to ClickUp)", "Moved to"]
SPRINTS = ["Start of day reply sprint", "Midday reply sprint", "End of day reply sprint"]
TASK_STATUSES = ["to do", "in progress", "review required", "pending", "complete", "cancelled"]
MARK_SPRINTS = "DAILY SPRINTS"
MARK_TASKS = "CLIENT SUCCESS TASKS (ClickUp)"
MARK_EOD = "END OF DAY"
TASK_HEAD = ["Task", "Due", "Assignee", "Status in ClickUp", "", "Done \u2713"]
TODO = {
    "Needs Contacting": "Call now. Book the onboarding call.",
    "GHOSTED": "Chase on call, WhatsApp and email. Hands to sales after 14 days.",
    "DELAY OUT OF OUR CONTROL": "Chase what we are waiting on. Set a follow-up date.",
    "Onboarding Booked": "Kickoff form in? Tech access done? Book the Blueprint call.",
    "LAUNCH BOOKED": "Run the launch call. Set expectations on how appointments work.",
    "Ready For Launch\U0001f680": "Chase the media buyer to flip the campaign live.",
    "Active": "",
}


# ---------------------------------------------------------------- helpers
def body_of(resp: dict):
    b = json.loads(resp["content"])["body"]
    return json.loads(b) if isinstance(b, str) else b


def ms(d: dt.date) -> int:
    return int(dt.datetime(d.year, d.month, d.day, 12, tzinfo=dt.UTC).timestamp() * 1000)


def custom(task: dict) -> dict:
    out = {}
    for f in task.get("custom_fields", []):
        v = f.get("value")
        if v in (None, "", []):
            continue
        if f["type"] == "drop_down":
            opts = f["type_config"]["options"]
            hit = [o for o in opts if o["id"] == v or o.get("orderindex") == v]
            if hit:
                v = hit[0]["name"]
        elif f["type"] == "users":
            v = ", ".join(u.get("username", "") for u in v)
        elif f["type"] == "date":
            try:
                v = dt.datetime.fromtimestamp(int(v) / 1000, dt.UTC).date()
            except (TypeError, ValueError):
                pass
        out[f["name"]] = v
    return out


def status_options(tasks: list[dict]) -> dict[str, str]:
    for t in tasks:
        for f in t.get("custom_fields", []):
            if f["id"] == F_STATUS:
                return {o["name"]: o["id"] for o in f["type_config"]["options"]}
    return {}


# ---------------------------------------------------------------- clickup
async def fetch_tasks() -> list[dict]:
    tasks: list[dict] = []
    for page in range(6):
        r = await pd_clickup_proxy_get(
            url=f"https://api.clickup.com/api/v2/list/{LIST_ID}/task",
            query_params={"include_closed": "true", "subtasks": "false", "page": page},
        )
        chunk = body_of(r).get("tasks", [])
        tasks += chunk
        if len(chunk) < 100:
            break
    return tasks


async def fetch_cs_tasks(today: dt.date) -> list[dict]:
    """Open Client Success board tasks that are due today or already overdue/undated."""
    r = await pd_clickup_proxy_get(
        url=f"https://api.clickup.com/api/v2/list/{CS_LIST_ID}/task",
        query_params={"include_closed": "false", "subtasks": "true"},
    )
    out = []
    for t in body_of(r).get("tasks", []):
        status = t["status"]["status"]
        if status in ("complete", "cancelled"):
            continue
        due = t.get("due_date")
        due_date = dt.datetime.fromtimestamp(int(due) / 1000, dt.UTC).date() if due else None
        if due_date and due_date > today:
            continue
        out.append({
            "id": t["id"],
            "name": t["name"],
            "due": due_date.strftime("%d %b").lstrip("0") if due_date else "no date",
            "overdue": bool(due_date and due_date < today),
            "status": status,
            "assignee": ", ".join(a["username"] for a in t.get("assignees", [])) or "unassigned",
        })
    out.sort(key=lambda x: (not x["overdue"], x["name"]))
    return out


async def set_status(task_id: str, status: str) -> None:
    await pd_clickup_proxy_put(
        url=f"https://api.clickup.com/api/v2/task/{task_id}",
        json_body={"status": status},
    )


async def set_field(task_id: str, field_id: str, value) -> None:
    await pd_clickup_proxy_post(
        url=f"https://api.clickup.com/api/v2/task/{task_id}/field/{field_id}",
        json_body={"value": value},
    )


async def add_comment(task_id: str, text: str) -> None:
    await pd_clickup_proxy_post(
        url=f"https://api.clickup.com/api/v2/task/{task_id}/comment",
        json_body={"comment_text": text, "notify_all": False},
    )


# ---------------------------------------------------------------- calendar
async def extensions() -> list[dict]:
    """Granted billing extensions, read from the Client Extension Form responses.

    Returns [{"client": str, "until": date, "weeks": int, "granted": date}]. The clock
    starts at submission, not at the billing date, so a late extension does not
    retroactively cover the whole overdue period.
    """
    out: list[dict] = []
    try:
        resp = await pd_typeform_proxy_get(
            url=f"https://api.typeform.com/forms/{EXT_FORM_ID}/responses?page_size=200")
        items = (body_of(resp) or {}).get("items") or []
    except Exception as exc:  # never let a form outage block the sheet
        print(f"!! EXTENSION FORM UNREADABLE: {exc}")
        return out
    for item in items:
        answers = {a["field"].get("ref"): a for a in item.get("answers") or []}
        client = (answers.get(EXT_CLIENT_REF) or {}).get("text") or ""
        label = ((answers.get(EXT_DURATION_REF) or {}).get("choice") or {}).get("label") or ""
        weeks = {"1 WEEK": 1, "2 WEEKS": 2, "4 WEEKS": 4}.get(label.strip().upper())
        if not client.strip() or not weeks:
            continue
        granted = dt.datetime.fromisoformat(
            item["submitted_at"].replace("Z", "+00:00")).astimezone(TZ).date()
        out.append({"client": client.strip(), "weeks": weeks, "granted": granted,
                    "until": granted + dt.timedelta(weeks=weeks)})
    return out


def match_extension(client: str, exts: list[dict], today: dt.date) -> dict | None:
    """Live extension for this client, matched on a loose name overlap."""
    key = "".join(ch for ch in client.lower() if ch.isalnum())
    best = None
    for e in exts:
        other = "".join(ch for ch in e["client"].lower() if ch.isalnum())
        if not other or len(other) < 4:
            continue
        if other in key or key in other:
            if e["until"] >= today and (best is None or e["until"] > best["until"]):
                best = e
    return best


def billing_line(npd, amt, today: dt.date, ext: dict | None) -> tuple[str, bool]:
    """The billing instruction for one client, plus whether a pause is now required."""
    if not isinstance(npd, dt.date) or not amt:
        return "", False
    delta, money = (today - npd).days, f"${int(float(amt)):,}"
    due = npd.strftime("%d %b").lstrip("0")
    if delta > 0 and ext:
        until = ext["until"].strftime("%d %b").lstrip("0")
        return (f"Invoice {money} is {delta}d late but an extension is logged to {until} "
                f"({ext['weeks']}w). Do not chase, do not pause."), False
    if delta >= PAUSE_AFTER_DAYS:
        return (f"\U0001f6d1 PAUSE REQUIRED. Invoice {money} is {delta}d past due with no "
                f"extension logged. File the pause task on the ClickUp form, then tell the "
                f"client we are pausing."), True
    if delta > 0:
        return (f"\u26a0\ufe0f Invoice {money} is {delta}d PAST DUE. Chase payment today. "
                f"Valid reason to wait? Log the extension form. Pause at day "
                f"{PAUSE_AFTER_DAYS}."), False
    if delta == 0:
        return f"\u26a0\ufe0f Invoice {money} is due TODAY ({due}). Confirm payment.", False
    if delta >= -3:
        return (f"Billing {money} in {-delta}d ({due}). Confirm now that they know "
                f"and are ready."), False
    if delta >= -7:
        return f"Billing week: {money} due {due} ({-delta}d). Give them notice.", False
    return "", False


def csm_calendar() -> str | None:
    try:
        with open(CONFIG) as fh:
            return json.load(fh).get("csm_calendar") or None
    except OSError:
        return None


async def todays_calls(today: dt.date) -> list[dict]:
    """Today's events on the CSM's calendar, earliest first."""
    cal_id = csm_calendar()
    if not cal_id:
        return []
    try:
        r = await pd_google_calendar_list_events(
            calendarId=cal_id,
            timeMin=f"{today}T00:00:00+03:00",
            timeMax=f"{today}T23:59:59+03:00",
            singleEvents=True, orderBy="startTime", maxResults=50,
        )
        data = json.loads(r["content"])
    except Exception as exc:  # calendar must never break the rebuild
        print(f"CALENDAR_ERROR: {exc}")
        return []
    items = data if isinstance(data, list) else data.get("items", [])
    out = []
    for e in items:
        start = (e.get("start") or {}).get("dateTime") or (e.get("start") or {}).get("date", "")
        out.append({"time": start[11:16] if "T" in start else "all day",
                    "title": e.get("summary", "(no title)"),
                    "guests": [a.get("email", "") for a in e.get("attendees", [])]})
    return out


def match_call(client: str, calls: list[dict]) -> dict | None:
    """Best-effort match of a client name to a calendar event title."""
    words = [w for w in client.lower().replace(",", " ").split() if len(w) > 3]
    for call in calls:
        title = call["title"].lower()
        if any(w in title for w in words):
            return call
    return None


# ---------------------------------------------------------------- sheet io
async def read_today() -> list[list[str]]:
    r = await pd_google_sheets_proxy_get(
        url=f"https://sheets.googleapis.com/v4/spreadsheets/{SID}/values/Today!A1:K120"
    )
    return body_of(r).get("values", [])


async def ensure_log_tab() -> None:
    r = await pd_google_sheets_proxy_get(
        url=f"https://sheets.googleapis.com/v4/spreadsheets/{SID}?fields=sheets.properties"
    )
    names = [s["properties"]["title"] for s in body_of(r)["sheets"]]
    if "Log" in names:
        return
    await pd_google_sheets_proxy_post(
        url=f"https://sheets.googleapis.com/v4/spreadsheets/{SID}:batchUpdate",
        json_body={"requests": [{"addSheet": {"properties": {"title": "Log", "hidden": True}}}]},
    )
    await pd_google_sheets_proxy_post(
        url=f"https://sheets.googleapis.com/v4/spreadsheets/{SID}/values/Log!A1:append"
        "?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",
        json_body={"values": [["Date", "Type", "Client", "Stage", "Silent", "Check-in",
                              "Texted", "Called", "Booked", "Note", "Moved to"]]},
    )


async def append_log(rows: list[list]) -> None:
    if not rows:
        return
    await pd_google_sheets_proxy_post(
        url=f"https://sheets.googleapis.com/v4/spreadsheets/{SID}/values/Log!A1:append"
        "?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",
        json_body={"values": rows},
    )


# ---------------------------------------------------------------- writeback
async def writeback(prev: list[list[str]], tasks: list[dict], today: dt.date) -> dict:
    """Push yesterday's sheet edits into ClickUp and archive the whole day. Marker driven.

    Client and board-task rows carry their ClickUp id in hidden column K, so nothing is
    matched on name.
    """
    done = {"texted": 0, "called": 0, "booked": 0, "notes": 0, "moved": 0,
            "task_status": 0, "sprints": 0, "skipped_no_id": []}
    if not prev:
        return done
    opts = status_options(tasks)
    log: list[list] = []
    day = prev[0][0] if prev[0] else ""

    def cells(row):
        return (list(row) + [""] * 11)[:11]

    def index_of(text):
        return next((i for i, r in enumerate(prev) if r and str(r[0]).startswith(text)), None)

    def section(start_idx):
        out = []
        for row in prev[start_idx:]:
            if not row or not str(row[0]).strip():
                break
            out.append(cells(row))
        return out

    # 1. reply sprints
    i = index_of(MARK_SPRINTS)
    if i is not None:
        for row in section(i + 1):
            ticked = str(row[1]).upper() == "TRUE"
            done["sprints"] += 1 if ticked else 0
            log.append([day, "sprint", row[0], "yes" if ticked else "no"])

    # 2. clients
    i = next((k for k, r in enumerate(prev) if r and r[0] == "Client"), None)
    if i is not None:
        for row in section(i + 1):
            name, stage, silent, chk = row[0], row[1], row[2], row[3]
            texted = str(row[5]).upper() == "TRUE"
            called = str(row[6]).upper() == "TRUE"
            booked, note, moved, tid = row[7].strip(), row[8].strip(), row[9].strip(), row[10].strip()
            log.append([day, "client", name, stage, silent, chk,
                        "yes" if texted else "", "yes" if called else "", booked, note, moved])
            if not any([texted, called, booked, note, moved]):
                continue
            if not tid:
                done["skipped_no_id"].append(name)
                continue
            if texted or called:
                await set_field(tid, F_LAST_POC, ms(today))
                done["texted"] += 1 if texted else 0
            if called:
                await set_field(tid, F_LAST_CALL, ms(today))
                done["called"] += 1
            if booked:
                try:
                    d = dt.datetime.strptime(booked.replace(",", " ").strip(), "%d %b").date()
                    d = d.replace(year=today.year if d.month >= today.month else today.year + 1)
                except ValueError:
                    d = None
                if d:
                    await set_field(tid, F_NEXT_POC, ms(d))
                    done["booked"] += 1
            if note:
                await add_comment(tid, f"CSM check-in {today:%d %b %Y}: {note}")
                done["notes"] += 1
            if moved and moved in opts:
                await set_field(tid, F_STATUS, opts[moved])
                done["moved"] += 1

    # 3. client success board tasks
    i = index_of(MARK_TASKS)
    if i is not None:
        for row in section(i + 2):  # skip the task header row
            name, status, ticked, tid = row[0], row[3].strip(), str(row[5]).upper() == "TRUE", row[10].strip()
            log.append([day, "task", name, row[1], "", status, "", "yes" if ticked else "", "", "", ""])
            if not tid:
                continue
            new_status = "complete" if ticked else (status if status in TASK_STATUSES else "")
            if new_status:
                await set_status(tid, new_status)
                done["task_status"] += 1

    # 4. end of day answers
    i = index_of(MARK_EOD)
    if i is not None:
        for row in prev[i + 1:]:
            row = cells(row)
            if row[0] and row[1]:
                log.append([day, "eod", row[0], row[1]])
            if row[4] and row[5]:
                log.append([day, "eod", row[4], row[5]])

    await append_log(log)
    return done


# ---------------------------------------------------------------- build rows
def build_rows(tasks: list[dict], today: dt.date, calls: list[dict] | None = None,
               exts: list[dict] | None = None):
    rows, nothing_due, booked = [], [], []
    calls, exts = calls or [], exts or []
    for t in tasks:
        c = custom(t)
        st, name = c.get("Client Status"), t["name"]
        if not st and not c.get("CSM"):
            continue
        if "Playing Account" in name or st not in ORDER:
            continue
        lp, nx, ld = c.get("Last POC"), c.get("Next POC"), c.get("Launch Date")
        silent = (today - lp).days if isinstance(lp, dt.date) else None
        ext = match_extension(name, exts, today)
        inv, pause_due = billing_line(c.get("Next Payment Date"),
                                      c.get("Next Payment Amount"), today, ext)
        if isinstance(nx, dt.date) and nx > today:
            chk = "BOOKED " + nx.strftime("%d %b").lstrip("0")
        elif silent is None:
            chk = "NO RECORD"
        elif silent >= 14:
            chk = f"OVERDUE {silent}d"
        elif silent >= 7:
            chk = "Call due"
        else:
            chk = "OK"
        call_today = match_call(name, calls)
        if call_today:
            chk = f"CALL {call_today['time']}"
        week1 = isinstance(ld, dt.date) and 0 <= (today - ld).days <= 7
        todo = TODO[st]
        if st == "Active":
            if call_today:
                todo = f"Check-in call on the calendar at {call_today['time']}. Run it, then tick Call."
            elif chk.startswith("BOOKED"):
                if not inv:
                    booked.append(f"{name} ({chk[7:]})")
                    continue
                todo = "Call is booked. Today only chase the invoice."
            elif week1:
                due = (ld + dt.timedelta(days=7)).strftime("%d %b").lstrip("0")
                todo = f"Week 1 live. Text daily, day-7 review call due {due}."
            elif chk.startswith("OVERDUE") or chk == "Call due":
                todo = "Text today AND book the check-in call. Call is late."
            elif silent is not None and silent < 1 and not inv:
                nothing_due.append(f"{name} (texted today)")
                continue
            else:
                todo = "Text check-in."
        action = todo + (" \u00b7 " + inv if inv else "")
        rows.append([(-1 if pause_due else ORDER.index(st)), name, st,
                     "never" if silent is None else f"{silent}d", chk, action, t["id"]])
    rows.sort(key=lambda r: (r[0], -(999 if r[3] == "never" else int(r[3][:-1]))))
    return rows, nothing_due, booked


# ---------------------------------------------------------------- render
NAVY = {"red": 0.035, "green": 0.075, "blue": 0.2}
CYAN = {"red": 0.0, "green": 0.812, "blue": 0.784}
RED = {"backgroundColor": {"red": 1, "green": 0.89, "blue": 0.89},
       "textFormat": {"bold": True, "foregroundColor": {"red": 0.65, "green": 0, "blue": 0}}}
AMB = {"textFormat": {"bold": True, "foregroundColor": {"red": 0.7, "green": 0.42, "blue": 0}}}
GRN = {"textFormat": {"bold": True, "foregroundColor": {"red": 0.07, "green": 0.49, "blue": 0.23}}}
BLU = {"textFormat": {"bold": True, "foregroundColor": {"red": 0.18, "green": 0.36, "blue": 0.84}}}
STAGES = ["Onboarding Booked", "LAUNCH BOOKED", "Ready For Launch\U0001f680", "Active", "GHOSTED",
          "DELAY OUT OF OUR CONTROL", "Paused", "Stopped", "SALES TEAM TO CONTACT", "CANCELLED ONBOARDING"]
WIDTHS = [(0, 1, 230), (1, 2, 150), (2, 3, 62), (3, 4, 110), (4, 5, 420), (5, 6, 58),
          (6, 7, 58), (7, 8, 130), (8, 9, 240), (9, 10, 140)]


async def reset_today_tab() -> int:
    """Wipe the Today tab in place: values, formats, merges, validation, colour rules.

    The tab is never deleted (Sheets refuses to delete the only visible sheet, and the
    Log tab is hidden), so the sheetId stays stable across rebuilds.
    """
    r = await pd_google_sheets_proxy_get(
        url=f"https://sheets.googleapis.com/v4/spreadsheets/{SID}"
        "?fields=sheets(properties,conditionalFormats,merges)"
    )
    sheet = next(s for s in body_of(r)["sheets"] if s["properties"]["title"] == "Today")
    wid = sheet["properties"]["sheetId"]
    whole = {"sheetId": wid, "startRowIndex": 0, "endRowIndex": 200,
             "startColumnIndex": 0, "endColumnIndex": 11}
    reqs: list[dict] = []
    if sheet.get("merges"):
        reqs.append({"unmergeCells": {"range": whole}})
    for _ in sheet.get("conditionalFormats", []):
        reqs.append({"deleteConditionalFormatRule": {"sheetId": wid, "index": 0}})
    reqs.append({"repeatCell": {"range": whole, "cell": {},
                                "fields": "userEnteredFormat,dataValidation"}})
    await pd_google_sheets_proxy_post(
        url=f"https://sheets.googleapis.com/v4/spreadsheets/{SID}:batchUpdate",
        json_body={"requests": reqs},
    )
    await pd_google_sheets_proxy_post(
        url=f"https://sheets.googleapis.com/v4/spreadsheets/{SID}/values/Today!A1:K200:clear",
        json_body={},
    )
    return wid


def sheet_values(rows, nothing_due, booked, today: dt.date, calls=None, tasks=None):
    """Build the Today tab. Returns (values, layout) with 0-based row indexes.

    Column K (index 10) carries ClickUp ids so the writeback never has to match on name.
    It is hidden in the formatting pass.
    """
    calls, tasks = calls or [], tasks or []
    vals: list[list] = []
    layout: dict[str, int] = {}

    vals.append([f"MAHARA CSM DAILY \u00b7 {today:%A %d %B %Y}".replace(" 0", " ")])
    vals.append([f"{len(rows)} clients and {len(tasks)} board tasks today. "
                 "Finish this sheet and your day is done. Ticking a box logs it in ClickUp. "
                 "Booking a next check-in date takes the client off the list until then. Friday is off."])
    vals.append([])

    vals.append([MARK_SPRINTS, "Done \u2713"])
    layout["sprint_start"] = len(vals)
    for label in SPRINTS:
        vals.append([label, False])
    vals.append([])

    vals.append(HEAD)
    layout["client_head"] = len(vals) - 1
    layout["client_start"] = len(vals)
    for r in rows:
        vals.append([r[1], r[2], r[3], r[4], r[5], False, False, "", "", "", r[6]])
    layout["client_n"] = len(rows)
    vals.append([])

    layout["foot_start"] = len(vals)
    vals.append(["Calls on your calendar today: " + (
        ", ".join(f"{c['time']} {c['title']}" for c in calls) if calls else "none")])
    vals.append(["Check-in booked ahead, off today's list: " + (", ".join(booked) if booked else "none")])
    vals.append(["Healthy, nothing due today: " + (", ".join(nothing_due) if nothing_due else "none")])
    vals.append([f"Forms: extension {EXT_FORM_URL}  \u00b7  pause task {PAUSE_FORM_URL}"])
    vals.append([])

    vals.append([MARK_TASKS])
    vals.append(TASK_HEAD)
    layout["task_head"] = len(vals) - 1
    layout["task_start"] = len(vals)
    for t in tasks:
        flag = " \u26a0\ufe0f overdue" if t["overdue"] else ""
        vals.append([t["name"], t["due"] + flag, t["assignee"], t["status"], "", False,
                     "", "", "", "", t["id"]])
    layout["task_n"] = len(tasks)
    if not tasks:
        vals.append(["Nothing open on the Client Success board today."])
    vals.append([])

    vals.append([MARK_EOD])
    layout["eod_start"] = len(vals)
    vals.append(["Stress level (1-10)", "", "", "", "Upsells today"])
    vals.append(["Energy grade (1-10)", "", "", "", "Google reviews today"])
    vals.append(["One 1% improvement we can make", "", "", "", "Referrals today"])
    vals.append(["", "", "", "", "Clients lost today"])
    return vals, layout


def format_requests(wid: int, layout: dict) -> list[dict]:
    n = layout["client_n"]
    tn = max(layout["task_n"], 1)

    def block(r0, count, a=0, b=11):
        return {"sheetId": wid, "startRowIndex": r0, "endRowIndex": r0 + count,
                "startColumnIndex": a, "endColumnIndex": b}

    def clients(a=0, b=11):
        return block(layout["client_start"], n, a, b)

    def rule(target, cond, fmt):
        return {"addConditionalFormatRule": {"index": 0, "rule": {
            "ranges": [target], "booleanRule": {"condition": cond, "format": fmt}}}}

    def txt(kind, value):
        return {"type": kind, "values": [{"userEnteredValue": value}]}

    def label_row(r0, count=1, size=10, colour=None):
        fmt = {"bold": True, "fontFamily": "Inter", "fontSize": size}
        if colour:
            fmt["foregroundColor"] = colour
        return {"repeatCell": {"range": block(r0, count), "cell": {
            "userEnteredFormat": {"textFormat": fmt}}, "fields": "userEnteredFormat.textFormat"}}

    def header_row(r0):
        return {"repeatCell": {"range": block(r0, 1, 0, 10), "cell": {"userEnteredFormat": {
            "backgroundColor": CYAN, "wrapStrategy": "WRAP",
            "textFormat": {"bold": True, "fontFamily": "Inter", "foregroundColor": NAVY}}},
            "fields": "userEnteredFormat"}}

    def checkbox(r0, count, col):
        return {"repeatCell": {"range": block(r0, count, col, col + 1), "cell": {
            "dataValidation": {"condition": {"type": "BOOLEAN"}},
            "userEnteredFormat": {"horizontalAlignment": "CENTER"}},
            "fields": "dataValidation,userEnteredFormat.horizontalAlignment"}}

    border = {"style": "SOLID", "color": {"red": .85, "green": .86, "blue": .9}}
    box = {"backgroundColor": {"red": 1, "green": 0.99, "blue": 0.95},
           "borders": {k: border for k in ("top", "bottom", "left", "right")}}
    eod = layout["eod_start"]
    reqs = [
        {"updateSpreadsheetProperties": {"properties": {"title": "CSM Daily \u00b7 Mahara",
                                                        "timeZone": "Asia/Kuwait"},
                                         "fields": "title,timeZone"}},
        {"repeatCell": {"range": block(0, 1, 0, 11), "cell": {"userEnteredFormat": {
            "backgroundColor": NAVY, "textFormat": {
                "bold": True, "fontSize": 13, "foregroundColor": {"red": 1, "green": 1, "blue": 1},
                "fontFamily": "Inter"}}}, "fields": "userEnteredFormat"}},
        {"mergeCells": {"range": block(0, 1, 0, 10), "mergeType": "MERGE_ROWS"}},
        {"mergeCells": {"range": block(1, 1, 0, 10), "mergeType": "MERGE_ROWS"}},
        {"repeatCell": {"range": block(1, 1, 0, 11), "cell": {"userEnteredFormat": {
            "backgroundColor": {"red": 0.95, "green": 0.96, "blue": 0.98},
            "textFormat": {"fontSize": 10, "fontFamily": "Inter"}}}, "fields": "userEnteredFormat"}},
        # sprints
        label_row(layout["sprint_start"] - 1, 1, 12, CYAN),
        label_row(layout["sprint_start"], len(SPRINTS)),
        checkbox(layout["sprint_start"], len(SPRINTS), 1),
        # client table
        header_row(layout["client_head"]),
        {"repeatCell": {"range": clients(), "cell": {"userEnteredFormat": {
            "verticalAlignment": "MIDDLE", "wrapStrategy": "WRAP",
            "textFormat": {"fontFamily": "Inter", "fontSize": 10}}},
            "fields": "userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)"}},
        label_row(layout["client_start"], n) if False else
        {"repeatCell": {"range": clients(0, 1), "cell": {"userEnteredFormat": {"textFormat": {
            "bold": True, "fontFamily": "Inter", "fontSize": 10}}},
            "fields": "userEnteredFormat.textFormat"}},
        {"repeatCell": {"range": clients(2, 4), "cell": {"userEnteredFormat": {
            "horizontalAlignment": "CENTER"}}, "fields": "userEnteredFormat.horizontalAlignment"}},
        checkbox(layout["client_start"], n, 5),
        checkbox(layout["client_start"], n, 6),
        {"repeatCell": {"range": clients(7, 8), "cell": {"userEnteredFormat": {
            "backgroundColor": {"red": 0.93, "green": 0.95, "blue": 1},
            "numberFormat": {"type": "DATE", "pattern": "d mmm"}}},
            "fields": "userEnteredFormat(backgroundColor,numberFormat)"}},
        {"repeatCell": {"range": clients(8, 9), "cell": {"userEnteredFormat": {
            "backgroundColor": {"red": 1, "green": 0.99, "blue": 0.95}}},
            "fields": "userEnteredFormat.backgroundColor"}},
        {"setDataValidation": {"range": clients(7, 8), "rule": {
            "condition": {"type": "DATE_IS_VALID"}, "strict": False,
            "inputMessage": "Type the date of the booked check-in call. "
                            "Client drops off the list until then."}}},
        {"setDataValidation": {"range": clients(9, 10), "rule": {
            "condition": {"type": "ONE_OF_LIST",
                          "values": [{"userEnteredValue": x} for x in STAGES]},
            "showCustomUi": True, "strict": False}}},
        rule(clients(3, 4), txt("TEXT_STARTS_WITH", "OVERDUE"), RED),
        rule(clients(3, 4), txt("TEXT_EQ", "NO RECORD"), RED),
        rule(clients(3, 4), txt("TEXT_EQ", "Call due"), AMB),
        rule(clients(3, 4), txt("TEXT_EQ", "OK"), GRN),
        rule(clients(3, 4), txt("TEXT_STARTS_WITH", "BOOKED"), BLU),
        rule(clients(3, 4), txt("TEXT_STARTS_WITH", "CALL "), BLU),
        rule(clients(4, 5), txt("TEXT_CONTAINS", "PAST DUE"), RED),
        rule(clients(4, 5), txt("TEXT_CONTAINS", "PAUSE REQUIRED"), RED),
        rule(clients(2, 3), txt("TEXT_EQ", "never"),
             {"textFormat": {"bold": True, "foregroundColor": {"red": 0.65, "green": 0, "blue": 0}}}),
        rule(clients(0, 10), txt("CUSTOM_FORMULA",
                                 f"=AND($F{layout['client_start'] + 1}=TRUE,$G{layout['client_start'] + 1}=TRUE)"),
             {"backgroundColor": {"red": 0.90, "green": 0.96, "blue": 0.91}}),
        {"updateBorders": {"range": {"sheetId": wid, "startRowIndex": layout["client_head"],
                                    "endRowIndex": layout["client_start"] + n,
                                    "startColumnIndex": 0, "endColumnIndex": 10},
                           "innerHorizontal": border, "innerVertical": border,
                           "top": border, "bottom": border, "left": border, "right": border}},
        # footer lines
        label_row(layout["foot_start"], 4),
        # task table
        label_row(layout["task_head"] - 1, 1, 12, CYAN),
        header_row(layout["task_head"]),
        {"repeatCell": {"range": block(layout["task_start"], tn), "cell": {"userEnteredFormat": {
            "wrapStrategy": "WRAP", "textFormat": {"fontFamily": "Inter", "fontSize": 10}}},
            "fields": "userEnteredFormat(wrapStrategy,textFormat)"}},
        {"setDataValidation": {"range": block(layout["task_start"], tn, 3, 4), "rule": {
            "condition": {"type": "ONE_OF_LIST",
                          "values": [{"userEnteredValue": x} for x in TASK_STATUSES]},
            "showCustomUi": True, "strict": False,
            "inputMessage": "Change this and the ClickUp task status changes tonight."}}},
        checkbox(layout["task_start"], tn, 5),
        rule(block(layout["task_start"], tn, 1, 2), txt("TEXT_CONTAINS", "overdue"), RED),
        # end of day
        label_row(eod - 1, 1, 12, CYAN),
        label_row(eod, 4),
        {"repeatCell": {"range": block(eod, 4, 4, 5), "cell": {"userEnteredFormat": {
            "textFormat": {"bold": True, "fontFamily": "Inter", "fontSize": 10}}},
            "fields": "userEnteredFormat.textFormat"}},
        {"repeatCell": {"range": block(eod, 4, 1, 4), "cell": {"userEnteredFormat": box},
                        "fields": "userEnteredFormat(backgroundColor,borders)"}},
        {"repeatCell": {"range": block(eod, 4, 5, 8), "cell": {"userEnteredFormat": box},
                        "fields": "userEnteredFormat(backgroundColor,borders)"}},
        {"updateSheetProperties": {"properties": {
            "sheetId": wid, "gridProperties": {"frozenRowCount": 2}},
            "fields": "gridProperties.frozenRowCount"}},
        {"updateDimensionProperties": {"range": {
            "sheetId": wid, "dimension": "COLUMNS", "startIndex": 10, "endIndex": 11},
            "properties": {"hiddenByUser": True}, "fields": "hiddenByUser"}},
    ]
    for a, b, px in WIDTHS:
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": wid, "dimension": "COLUMNS", "startIndex": a, "endIndex": b},
            "properties": {"pixelSize": px}, "fields": "pixelSize"}})
    reqs.append({"updateDimensionProperties": {
        "range": {"sheetId": wid, "dimension": "ROWS", "startIndex": layout["client_start"],
                  "endIndex": layout["client_start"] + n},
        "properties": {"pixelSize": 34}, "fields": "pixelSize"}})
    return reqs


async def write_sheet(rows, nothing_due, booked, today: dt.date, calls=None, tasks=None) -> None:
    wid = await reset_today_tab()
    vals, layout = sheet_values(rows, nothing_due, booked, today, calls, tasks)
    await pd_google_sheets_proxy_post(
        url=f"https://sheets.googleapis.com/v4/spreadsheets/{SID}/values:batchUpdate",
        json_body={"valueInputOption": "USER_ENTERED",
                   "data": [{"range": "Today!A1", "values": vals}]},
    )
    await pd_google_sheets_proxy_post(
        url=f"https://sheets.googleapis.com/v4/spreadsheets/{SID}:batchUpdate",
        json_body={"requests": format_requests(wid, layout)},
    )


# ---------------------------------------------------------------- main
async def main() -> None:
    today = dt.datetime.now(TZ).date()
    if today.weekday() == 4:  # Friday
        print("FRIDAY: nothing generated.")
        return
    tasks = await fetch_tasks()
    summary = {}
    demo_mode = _demo_write_capture_enabled()
    if "--no-writeback" not in sys.argv and not demo_mode:
        try:
            await ensure_log_tab()
            summary = await writeback(await read_today(), tasks, today)
        except Exception as exc:
            # Cron test subagents block integration writes. Preserve the
            # read-only summary in that mode, but never hide a real write
            # failure during a normal scheduled run.
            if not _is_demo_write_error(exc):
                raise
            demo_mode = True
            summary = {
                "demo_mode": True,
                "writeback_skipped_after_block": True,
                "write_error": str(exc),
            }
    calls = await todays_calls(today)
    cs_tasks = await fetch_cs_tasks(today)
    exts = await extensions()
    rows, nothing_due, booked = build_rows(tasks, today, calls, exts)
    if not demo_mode:
        try:
            await write_sheet(rows, nothing_due, booked, today, calls, cs_tasks)
        except Exception as exc:
            if not _is_demo_write_error(exc):
                raise
            demo_mode = True
            summary = {
                **summary,
                "demo_mode": True,
                "sheet_rebuild_skipped_after_block": True,
                "write_error": str(exc),
            }

    red = [r for r in rows if r[4] == "NO RECORD" or r[4].startswith("OVERDUE")]
    money = [r for r in rows if "PAST DUE" in r[5]]
    pauses = [r for r in rows if "PAUSE REQUIRED" in r[5]]
    notice = [r for r in rows if "Billing" in r[5] or "due TODAY" in r[5]]
    if demo_mode:
        print("DEMO_MODE: integration writes skipped; summary computed from read-only ClickUp data.")
    print(f"DATE: {today:%A %d %b %Y}")
    print(f"CLIENTS_TODAY: {len(rows)}")
    print(f"RED_ROWS: {len(red)} -> " + "; ".join(f"{r[1]} ({r[4]})" for r in red[:12]))
    print(f"PAUSE_REQUIRED: {len(pauses)} -> " + "; ".join(r[1] for r in pauses))
    print(f"PAST_DUE: {len(money)} -> " + "; ".join(r[1] for r in money))
    print(f"BILLING_NOTICE: {len(notice)} -> " + "; ".join(r[1] for r in notice))
    print(f"EXTENSIONS_LIVE: {len(exts)} -> " + "; ".join(
        f"{e['client']} to {e['until']:%d %b}" for e in exts if e["until"] >= today))
    print(f"BOOKED_AHEAD: {len(booked)} -> " + ", ".join(booked))
    print(f"NOTHING_DUE: {len(nothing_due)} -> " + ", ".join(nothing_due))
    print("BOARD_TASKS: " + (
        "; ".join(f"{t['name']} ({t['due']}{', overdue' if t['overdue'] else ''})" for t in cs_tasks)
        if cs_tasks else "none"))
    print("CALLS_TODAY: " + (", ".join(f"{c['time']} {c['title']}" for c in calls) if calls else "none"))
    print(f"WRITEBACK: {summary}")
    print(f"SHEET: https://docs.google.com/spreadsheets/d/{SID}")


if __name__ == "__main__":
    asyncio.run(main())
