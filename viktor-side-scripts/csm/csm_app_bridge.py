"""Feed the standalone Client Success cockpit and drain its writeback outbox.

Why this exists: the `client-success` Space's own tool gateway returns HTTP 500 for
every integration (platform-side, verified against `cockpit` with the same call), so the
app cannot read ClickUp or write to it directly. This bridge does both from Viktor's
side, using one source of logic:

  1. build   — run `csmSync:buildCsmSnapshot` in the `cockpit` project (its gateway
               works) to get clients / tasks / checks
  2. ingest  — write that payload into the client-success deployment via `csmSync:store`
  3. drain   — read `outbox:pending`, perform each ClickUp write with the SDK tools,
               then `outbox:markSent`

Run:  uv run python skills/csm_daily_workflow/scripts/csm_app_bridge.py [--skip-sync]
Retire it the moment the app's own gateway works: delete the outbox path and call
`csmSync.runCsmSync` inside the app instead.
"""

from __future__ import annotations

import asyncio
import datetime
import json
from urllib.parse import quote
import os
import re
import subprocess
import sys
import time

import requests
from sdk.tools.pd_clickup import pd_clickup_proxy_get, pd_clickup_proxy_post
from sdk.tools.pd_typeform import pd_typeform_proxy_get

# Same folder as this script, wherever it is run from.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from csm_assistant import answer_question, format_answer  # noqa: E402
from csm_client_profiles import build_profiles  # noqa: E402
from csm_report_doc import build_report_doc  # noqa: E402
from sdk.tools.gdrive import gdrive_google_sheets_read
from sdk.tools.pd_google_sheets import (
    pd_google_sheets_proxy_get,
)

COCKPIT = "/work/viktor-spaces/cockpit-6d490e190930"
CSM_APP = "/work/viktor-spaces/client-success-ba089198934f"

CLIENTS_LIST = "901816559981"
CS_LIST = "901816723211"

# Field ids on Clients - Mahara.
CF = {
    "lastPoc": "e183f2ce-8b7a-491a-b160-2287a247758b",
    "lastCall": "032203ad-e327-4d76-a0ce-c07496da6486",
    "nextPoc": "c48c1323-ca6a-465f-84cb-8c24f0f62df3",
    "status": "9368ca9e-3549-4320-84ff-9abd0a2901cb",
    "happiness": "4e3924e3-4898-4e98-aca1-cc1ac3015b73",
    # DFY or DWY. Decides whether we owe the client a full funnel or cost per lead only.
    "service": "fccfc09c-650e-4aed-b4cd-3f50beba05a3",
}

DEPARTMENTS = {
    "creative": ("901818016338", "Media/Creative"),
    "tech": ("901816723190", "Operations/Tech"),
    "client_success": ("901816723211", "Client Success"),
    "call_center": ("901816723206", "Call Center"),
    "media_buyer": ("901816723196", "Marketing/ADs"),
}

REQUEST_TYPE_FIELD = "e9fd8024-8abe-4094-ac08-e6c0e736ad7e"
REQUEST_TYPE = {
    "Switch this campaign to a landing page": "Create Landing Page📊",
    "Add qualification questions to the lead form": "Add Custom Qualification Questions🙋",
    "Tracking / page is broken": "Missing Leads ❌",
    "Pause this client": "Client Pause Request ⏸️",
    "Relaunch this client": "Client Relaunch Request ⏯️",
    "Offboard this client": "Client Offboarding Request 🔴",
}



BRIDGE_TOKEN = "mahara-csm-bridge-8f4c1d92a7be4c05b1e6"
# The app's production Convex deployment. `convex run --prod` cannot reach it (the CLI
# only holds a dev key), and the platform's database tool runs queries only, so the sync
# goes through the token-guarded HTTP route in convex/http.ts.
PROD_HTTP = "https://healthy-cobra-488.convex.site/bridge"
# Same token-guarded route on the CSM app's dev deployment. Profile payloads carry ad
# previews and lost-lead notes, which blew past the OS argv limit and killed the push with
# "File name too long: 'bunx'". Anything big goes over HTTP, never through the CLI.
DEV_HTTP = "https://pastel-sardine-251.convex.site/bridge"


async def _bridge(url: str, fn: str, args: dict | None = None):
    """Call the production deployment over its bridge route.

    Every "ingested into production" line printed before this existed was in fact a
    second write to dev — the deployed app the CSM opens had no data at all.
    """
    res = await asyncio.to_thread(
        requests.post,
        url,
        headers={"Authorization": f"Bearer {BRIDGE_TOKEN}"},
        json={"fn": fn, "args": args or {}},
        timeout=180,
    )
    if res.status_code != 200:
        raise RuntimeError(f"{fn} failed: {res.status_code} {res.text[:300]}")
    body = res.json()
    if not body.get("ok"):
        raise RuntimeError(f"{fn} failed: {body.get('error')}")
    return body.get("data")


async def prod(fn: str, args: dict | None = None):
    """Call the production deployment, the one the CSM actually opens."""
    return await _bridge(PROD_HTTP, fn, args)


async def dev(fn: str, args: dict | None = None):
    """Call the dev deployment over HTTP, for payloads too big for the CLI."""
    return await _bridge(DEV_HTTP, fn, args)


def convex(
    project: str, name: str, args: dict | None = None
) -> dict | list | None:
    """Run a Convex function on a project's DEV deployment.

    The CLI only ever reaches dev, whatever flags are passed — production goes through
    `prod()` above.
    """
    env = dict(os.environ, CONVEX_TMPDIR=f"{project}/tmp")
    cmd = ["bunx", "convex", "run", name]
    if args is not None:
        # `convex run` only takes JSON in argv; ~100KB payloads are well under the limit.
        cmd += [json.dumps(args)]
    out = subprocess.run(
        cmd,
        cwd=project,
        env=env,
        capture_output=True,
        text=True,
        timeout=900,
    )
    if out.returncode != 0:
        raise RuntimeError(f"{name} failed: {out.stderr[-800:]}")
    text = out.stdout.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


async def _body(coro):
    res = await coro
    content = res.get("content") if isinstance(res, dict) else res
    if isinstance(content, str):
        content = json.loads(content)
    return content.get("body", content) if isinstance(content, dict) else content


async def option_id(list_id: str, field_id: str, label: str) -> str | None:
    defs = await _body(
        pd_clickup_proxy_get(url=f"https://api.clickup.com/api/v2/list/{list_id}/field")
    )
    for f in defs.get("fields", []):
        if f["id"] == field_id:
            for o in (f.get("type_config") or {}).get("options") or []:
                if o.get("name") == label:
                    return o["id"]
    return None


async def field_id_by_name(name: str) -> str | None:
    """Resolve a Clients - Mahara field id by name, for fields added after this was written."""
    defs = await _body(
        pd_clickup_proxy_get(url=f"https://api.clickup.com/api/v2/list/{CLIENTS_LIST}/field")
    )
    for f in defs.get("fields", []):
        if str(f.get("name", "")).strip().lower() == name.lower():
            return f["id"]
    return None


async def set_field(task_id: str, field_id: str, value) -> None:
    await pd_clickup_proxy_post(
        url=f"https://api.clickup.com/api/v2/task/{task_id}/field/{field_id}",
        json_body={"value": value},
    )


async def comment(task_id: str, text: str) -> None:
    await pd_clickup_proxy_post(
        url=f"https://api.clickup.com/api/v2/task/{task_id}/comment",
        json_body={"comment_text": text, "notify_all": False},
    )


def ms_today() -> int:
    import datetime as dt
    import zoneinfo

    tz = zoneinfo.ZoneInfo("Asia/Kuwait")
    now = dt.datetime.now(tz).replace(hour=9, minute=0, second=0, microsecond=0)
    return int(now.timestamp() * 1000)


async def handle(row: dict) -> tuple[str | None, str | None]:
    """Perform one outbox row. Returns (result_url, error)."""
    kind = row["kind"]
    task_id = row.get("clientTaskId") or ""
    try:
        if kind == "report":
            # "Last report sent" is a field Aziz added by hand, so resolve it by name.
            fid = await field_id_by_name("Last report sent")
            if fid:
                await set_field(task_id, fid, ms_today())
            else:
                # Never mark it sent when there is nowhere to record it.
                return None, 'ClickUp field "Last report sent" does not exist yet'
        elif kind in ("touchpoint", "call"):
            await set_field(task_id, CF["lastPoc"], ms_today())
            if kind == "call":
                await set_field(task_id, CF["lastCall"], ms_today())
        elif kind == "booked" and row.get("value"):
            import datetime as dt

            when = dt.date.fromisoformat(row["value"])
            await set_field(
                task_id,
                CF["nextPoc"],
                int(dt.datetime.combine(when, dt.time(9)).timestamp() * 1000),
            )
        elif kind == "stage" and row.get("value"):
            oid = await option_id(CLIENTS_LIST, CF["status"], row["value"])
            if oid:
                await set_field(task_id, CF["status"], oid)
        elif kind == "service" and row.get("value"):
            # DFY or DWY on the Clients board. Decides which numbers we owe the client.
            fid = CF.get("service") or await field_id_by_name("Service")
            oid = await option_id(CLIENTS_LIST, fid, row["value"]) if fid else None
            if oid:
                await set_field(task_id, fid, oid)
            else:
                return None, f"no Service option called {row['value']}"
        elif kind == "happiness" and row.get("value"):
            oid = await option_id(CLIENTS_LIST, CF["happiness"], row["value"])
            if oid:
                await set_field(task_id, CF["happiness"], oid)

        result_url = None
        if kind == "plan_task" or kind == "issue":
            name = (
                f"{row['clientName']} — {row['action']}"
                if row.get("clientName")
                else (
                    f"Cockpit fix — {row['action'][:60]}"
                    if kind == "issue"
                    else row["action"]
                )
            )
            created = await _body(
                pd_clickup_proxy_post(
                    url=f"https://api.clickup.com/api/v2/list/{CS_LIST}/task",
                    json_body={"name": name, "description": row["evidence"]},
                )
            )
            return created.get("url"), None

        if row.get("department"):
            list_id, label = DEPARTMENTS[row["department"]]
            created = await _body(
                pd_clickup_proxy_post(
                    url=f"https://api.clickup.com/api/v2/list/{list_id}/task",
                    json_body={
                        "name": f"{row['clientName']} — {row['action']}",
                        "description": "\n".join(
                            [
                                "Requested by the CSM via the Client Success Cockpit.",
                                "",
                                f"Client: {row['clientName']}",
                                f"Why: {row['evidence']}",
                                (f"Note: {row['note']}" if row.get("note") else ""),
                                f"Client task: https://app.clickup.com/t/{task_id}",
                            ]
                        ).strip(),
                    },
                )
            )
            result_url = created.get("url")
            type_label = REQUEST_TYPE.get(row["action"])
            if result_url and type_label:
                oid = await option_id(list_id, REQUEST_TYPE_FIELD, type_label)
                if oid:
                    await set_field(created["id"], REQUEST_TYPE_FIELD, oid)

        head = {
            "call": "CALL LOGGED",
            "touchpoint": "TOUCHPOINT",
            "left": "LEFT AS IS",
            "report": "MONTHLY REPORT SENT",
        }.get(kind, "UPDATED")
        if row.get("department"):
            head = f"SENT TO {DEPARTMENTS[row['department']][1].upper()}"
        if task_id:
            lines = [f"🎯 Viktor · {head} — {row['action']}", "", f"Why: {row['evidence']}"]
            if row.get("note"):
                lines.append(f"Note: {row['note']}")
            if row.get("snooze"):
                lines.append(f"Checked again: {row['snooze']}")
            if result_url:
                lines.append(f"Task created: {result_url}")
            lines.append("Logged by the CSM via the Client Success Cockpit.")
            await comment(task_id, "\n".join(lines))
        return result_url, None
    except Exception as exc:  # one bad row must not stop the queue
        return None, str(exc)[:300]


CHURN_SHEET = "1p8CAd5pL9zKjc1mZ73Gc_hoj4NSWHfFPs4FoC_WuBUU"
MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _num(text: str) -> float | None:
    cleaned = re.sub(r"[^0-9.\-]", "", text or "")
    try:
        return float(cleaned)
    except ValueError:
        return None


async def _drive_values(sid: str, tab: str) -> list[list[str]]:
    """The churn tracker read through Drive, used when the Sheets token is dead."""
    try:
        res = await gdrive_google_sheets_read(unified_uri=sid, range=f"{tab}!A1:K20")
    except Exception:
        return []
    table = (res or {}).get("data") if isinstance(res, dict) else None
    rows = []
    for line in str(table or "").splitlines():
        if not line.startswith("|") or set(line) <= set("|-: "):
            continue
        rows.append([cell.strip() for cell in line.strip().strip("|").split("|")])
    return rows


DATABASE_SHEET = "1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0"
CLIENT_DATA_TAB = 100700936


async def client_data_rows() -> list[dict[str, str]]:
    """Read `Client Data` from DATABASE - MAHARA as a list of header-keyed dicts.

    This tab, not ClickUp, is the record the founder maintains, so it wins on Service Mode
    and it fills the report sheet links that never made it onto the ClickUp task.
    """
    from sdk.tools.pd_google_sheets import pd_google_sheets_get_values_in_range

    res = await pd_google_sheets_get_values_in_range(
        sheetId=DATABASE_SHEET, worksheetId=CLIENT_DATA_TAB, range="A1:S200"
    )
    text = res if isinstance(res, str) else str(res.get("content") or res)
    rows, _ = json.JSONDecoder().raw_decode(text.strip())
    if not rows:
        return []
    header = [str(h).strip() for h in rows[0]]
    if "Client Name" not in header:
        raise RuntimeError("Client Data has no Client Name column")
    out = []
    for row in rows[1:]:
        rec = {
            header[i]: str(row[i]).strip() if i < len(row) else ""
            for i in range(len(header))
        }
        if rec.get("Client Name"):
            out.append(rec)
    return out


def service_mode_map(rows: list[dict[str, str]]) -> dict[str, str]:
    """Client name (lowercased) -> DFY or DWY, only where the sheet actually says one."""
    out: dict[str, str] = {}
    for rec in rows:
        mode = rec.get("Service Mode", "").upper()
        if mode in ("DFY", "DWY"):
            out[rec["Client Name"].lower()] = mode
    return out


def sheet_link_map(rows: list[dict[str, str]]) -> dict[str, str]:
    """Client name (lowercased) -> report sheet URL from the database."""
    out: dict[str, str] = {}
    for rec in rows:
        link = rec.get("Sheet Link", "")
        if link.startswith("http"):
            out[rec["Client Name"].lower()] = link
    return out


def apply_service_modes(clients: list[dict], modes: dict[str, str]) -> int:
    """Overlay the sheet's Service Mode onto the snapshot. Returns rows changed."""
    changed = 0
    for c in clients:
        mode = modes.get(str(c.get("name", "")).strip().lower())
        if not mode:
            continue
        dwy = mode == "DWY"
        if c.get("service") != mode or bool(c.get("dwy")) != dwy:
            changed += 1
        c["service"], c["dwy"] = mode, dwy
    return changed


def apply_sheet_links(clients: list[dict], links: dict[str, str]) -> int:
    """Fill the report sheet from the database where ClickUp has none.

    A sheet that exists in the database but not on the ClickUp task is not a missing
    sheet, so the loose end is cleared too, otherwise the CSM chases work already done.
    """
    changed = 0
    for c in clients:
        if c.get("sheetLink"):
            continue
        link = links.get(str(c.get("name", "")).strip().lower())
        if not link:
            continue
        c["sheetLink"] = link
        c["sheetFromDatabase"] = True
        c["loose"] = [
            t for t in (c.get("loose") or []) if "No report sheet linked" not in t
        ]
        changed += 1
    return changed


KUWAIT = datetime.timezone(datetime.timedelta(hours=3))

GHL_CLIENT_PIT = "REDACTED_GHL_PIT_TOKEN_SET_VIA_ENV"

# GHL's own labels are inconsistent, so the calendar name is mapped to the journey step the
# CSM actually thinks in.
CALL_KINDS = (
    ("blueprint", ("brand blueprint",)),
    ("launch", ("launch",)),
    ("onboarding", ("onboarding",)),
    ("checkin", ("check in", "check-in", "checkin", "sucess", "success")),
)


def call_kind(calendar: str) -> str:
    low = calendar.lower()
    for kind, needles in CALL_KINDS:
        if any(n in low for n in needles):
            return kind
    return "other"


def _norm_name(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


def match_client(appt: dict, contact: dict | None, names: list[str]) -> str | None:
    """Tie a booking to a ClickUp client, or admit we do not know.

    Only exact normalised containment counts. A wrong match would show the CSM a call with
    the wrong client, which is worse than showing the booking unlabelled.
    """
    haystacks = [appt.get("title") or ""]
    if contact:
        haystacks += [
            contact.get("companyName") or "",
            contact.get("name") or "",
        ]
    blob = " ".join(_norm_name(h) for h in haystacks)
    hits = [n for n in names if len(_norm_name(n)) >= 4 and _norm_name(n) in blob]
    if len(hits) == 1:
        return hits[0]
    # Longest unique match wins, e.g. "Arch Home" over "Arch".
    if hits:
        hits.sort(key=lambda n: -len(_norm_name(n)))
        if len(_norm_name(hits[0])) > len(_norm_name(hits[1])):
            return hits[0]
    return None


async def calendar_rows(client_names: list[str]) -> list[dict]:
    """Every client call booked from 14 days back to 42 days ahead.

    GHL's events endpoint gets unreliable over long windows, so it is read one week at a
    time and the weeks are stitched together here.
    """
    today = datetime.datetime.now(KUWAIT).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    raw: dict[str, dict] = {}
    for offset in range(-14, 42, 7):
        start = today + datetime.timedelta(days=offset)
        got = convex(
            COCKPIT,
            "ghlCalendar:events",
            {
                "token": GHL_CLIENT_PIT,
                "fromMs": int(start.timestamp() * 1000),
                "toMs": int((start + datetime.timedelta(days=7)).timestamp() * 1000),
            },
        )
        for e in got or []:
            if e.get("id"):
                raw[str(e["id"])] = e

    contact_ids = sorted({str(e["contactId"]) for e in raw.values() if e.get("contactId")})
    contacts: dict[str, dict] = {}
    if contact_ids:
        got = convex(
            COCKPIT, "ghlCalendar:contacts", {"token": GHL_CLIENT_PIT, "ids": contact_ids}
        )
        contacts = {str(c["id"]): c for c in (got or [])}

    rows = []
    for e in raw.values():
        start = str(e.get("startTime") or "")
        if not start:
            continue
        contact = contacts.get(str(e.get("contactId") or ""))
        # Convex optional fields reject null, so empty values are omitted, not sent as None.
        row = {
            "apptId": str(e["id"]),
            "calendar": e.get("calendar") or "",
            "title": e.get("title") or "",
            "kind": call_kind(e.get("calendar") or ""),
            "startTime": start,
            "day": start[:10],
            "status": e.get("status") or "",
        }
        for key, val in (
            ("contactName", (contact or {}).get("name")),
            ("clientName", match_client(e, contact, client_names)),
            ("joinUrl", e.get("address")),
        ):
            if val:
                row[key] = val
        rows.append(row)
    rows.sort(key=lambda r: r["startTime"])
    return rows


def apply_next_call(clients: list[dict], rows: list[dict]) -> int:
    """A booked call in GHL answers "when is our next call", so ClickUp is not chased for it.

    Only future, non-cancelled bookings count, and only ones we could tie to a client.
    """
    today = kuwait_today_iso()
    changed = 0
    upcoming: dict[str, dict] = {}
    for r in rows:
        name, day = r.get("clientName"), r["day"]
        if not name or day < today or r["status"] == "cancelled":
            continue
        if name not in upcoming or r["startTime"] < upcoming[name]["startTime"]:
            upcoming[name] = r
    for c in clients:
        hit = upcoming.get(str(c.get("name", "")).strip())
        if not hit:
            continue
        c["nextCallAt"] = hit["startTime"]
        c["nextCallKind"] = hit["kind"]
        c["loose"] = [
            t
            for t in (c.get("loose") or [])
            if "No next touchpoint booked" not in t and "has passed, nothing rebooked" not in t
        ]
        changed += 1
    return changed


async def _proxy_json(url: str) -> dict:
    """Read a Google API URL through the proxy, which still authenticates correctly."""
    res = await pd_google_sheets_proxy_get(url=url)
    text = res if isinstance(res, str) else str(res.get("content") or res)
    start = text.find('"body"')
    if start == -1:
        return {}
    brace = text.find("{", start)
    depth = 0
    for i in range(brace, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                blob = text[brace : i + 1]
                break
    else:
        return {}
    try:
        return json.loads(blob.encode().decode("unicode_escape"))
    except Exception:
        try:
            return json.loads(blob)
        except Exception:
            return {}


async def churn_rows() -> list[dict]:
    """Read this month's churn straight from Aziz's Churn Tracker.

    The app never computes churn itself: ClickUp has no status history, so any number
    we derived would be a guess. His sheet is the source of truth, and we label it.
    """
    # The Sheets *actions* (list_worksheets, get_values_in_range) return 401 on this
    # workspace's connection while the raw proxy works, so read through the proxy. The
    # sheet is only a cross-check now: the app's churn number comes from the roster.
    meta = await _proxy_json(
        f"https://sheets.googleapis.com/v4/spreadsheets/{CHURN_SHEET}"
        "?fields=sheets(properties(title,sheetId))"
    )
    sheets = (meta or {}).get("sheets") or []
    if not sheets:
        # Sheets connection down: the tracker's month tabs start with "01", and that is the
        # one we need. Drive can read it by name without the metadata call.
        sheets = [{"properties": {"title": "01: Churn Tracker"}}]
    title = next(
        (
            s["properties"]["title"]
            for s in sheets
            if isinstance(s, dict)
            and str(s.get("properties", {}).get("title", "")).startswith("01")
        ),
        None,
    )
    if not title:
        return []
    grid = await _proxy_json(
        f"https://sheets.googleapis.com/v4/spreadsheets/{CHURN_SHEET}"
        f"/values/{quote(title)}!A1:K20"
    )
    if not (isinstance(grid, dict) and grid.get("values")):
        grid = {"values": await _drive_values(CHURN_SHEET, title)}
    values = grid.get("values", []) if isinstance(grid, dict) else grid
    month_name = MONTHS[int(kuwait_month().split("-")[1]) - 1]
    row = next((r for r in values if r and r[0].strip() == month_name), None)
    if not row:
        return []
    cell = lambda i: (row[i].strip() if len(row) > i else "")  # noqa: E731
    start, lost, churn = cell(1), cell(2), cell(4)
    source = f"Churn Tracker sheet, tab 01, {month_name} row"
    note = (
        "Churn = clients lost this month ÷ clients at the start of the month "
        "(non-renewal, cancellation, refund, or a freeze over 14 days). "
        "Update the tracker and this updates itself."
    )
    # A blank "clients lost" cell makes the sheet's churn formula read 0.00%. Publishing
    # that would tell him churn is perfect when it is simply not filled in, so the churn
    # number is only published when both halves of the fraction exist.
    if not lost or not start:
        churn = ""
        note = (
            "Not published: the Churn Tracker's "
            f"{month_name} row is missing "
            + " and ".join(
                x for x in [
                    "clients lost" if not lost else "",
                    "clients at start of month" if not start else "",
                ] if x
            )
            + ", so its 0.00% is an empty cell, not a real result."
        )
    rows = [
        {
            "key": "churn",
            "label": "Churn this month",
            "value": churn or None,
            "numeric": _num(churn),
            "month": kuwait_month(),
            "source": source,
            "note": note,
        },
        {
            "key": "clients_at_start",
            "label": "Clients at start of month",
            "value": start or None,
            "numeric": _num(start),
            "month": kuwait_month(),
            "source": source,
        },
        {
            "key": "clients_lost",
            "label": "Clients lost this month",
            "value": lost or None,
            "numeric": _num(lost),
            "month": kuwait_month(),
            "source": source,
        },
    ]
    published = [r for r in rows if r["value"] is not None]
    if not any(r["key"] == "churn" for r in published):
        published.append(
            {
                "key": "churn_missing",
                "label": "Churn not published",
                "value": "unfilled",
                "month": kuwait_month(),
                "source": source,
                "note": note,
            }
        )
    return published


def kuwait_today_iso() -> str:
    """Today in Kuwait, for stamping when a number was last actually read."""
    return (
        datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=3)
    ).strftime("%Y-%m-%d")


def kuwait_month() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(hours=3)
    ).strftime("%Y-%m")


NOTES_FORM = "fRokTITH"
EXT_FORM = "gqBcyK6g"
CHUNK = 60_000  # Convex args travel through argv; Linux caps one arg at ~128KB.


async def _get_text(tool, url: str) -> str:
    """Fetch a URL with an SDK proxy tool and return its body as JSON text."""
    body = await _body(tool(url=url))
    return json.dumps(body)


def push_raw(url: str, text: str) -> None:
    parts = [text[i : i + CHUNK] for i in range(0, len(text), CHUNK)] or [""]
    for i, part in enumerate(parts):
        convex(
            COCKPIT,
            "rawFetch:put",
            {"url": url, "part": i, "text": part, **({"reset": True} if i == 0 else {})},
        )


async def prefetch() -> list[str]:
    """Fetch everything the snapshot needs and push it into the cockpit's rawFetch cache.

    The Space tool gateway answers HTTP 500 for every integration call, so the snapshot
    action can no longer fetch for itself. These are the exact URLs it asks for; anything
    missed here would fall back to the broken gateway and come back empty.
    """
    urls: list[str] = []
    todo = [
        (pd_clickup_proxy_get, f"https://api.clickup.com/api/v2/list/{CLIENTS_LIST}/field"),
        (
            pd_typeform_proxy_get,
            f"https://api.typeform.com/forms/{NOTES_FORM}/responses?page_size=200",
        ),
        (
            pd_typeform_proxy_get,
            f"https://api.typeform.com/forms/{EXT_FORM}/responses?page_size=200",
        ),
    ]
    for tool, url in todo:
        push_raw(url, await _get_text(tool, url))
        urls.append(url)

    for list_id, include_closed in ((CLIENTS_LIST, "true"), (CS_LIST, "false")):
        for page in range(6):
            url = (
                f"https://api.clickup.com/api/v2/list/{list_id}/task"
                f"?include_closed={include_closed}&page={page}"
            )
            text = await _get_text(pd_clickup_proxy_get, url)
            push_raw(url, text)
            urls.append(url)
            if len(json.loads(text).get("tasks", [])) < 100:
                break
    return urls


PROFILE_CF = {
    "sheet": "e6da13ae-6498-44a1-b7dd-9c6198500aa9",
    "drive": "19e39b91-dd2f-4027-ba88-31bc6aae07c3",
    "driveFolder": "ce6129a5-c8e5-41ba-ac50-8650c7556469",
    "contract": "10b41484-c70d-4295-aab9-06a30443a3a2",
    "profile": "7755485f-74a8-496c-85d8-562588e77944",
    "status": "9368ca9e-3549-4320-84ff-9abd0a2901cb",
    "happiness": "4e3924e3-4898-4e98-aca1-cc1ac3015b73",
    "launch": "2e744484-f581-4c37-962a-023c4de23729",
    "service": "fccfc09c-650e-4aed-b4cd-3f50beba05a3",
    "platform": "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9",
}
CSM_FIELD = "68ff84db-6c66-4e70-8e72-15d70828fda6"
PROFILE_BATCH = 6  # keeps each convex argv payload well inside the ~128KB cap


def _cf(task: dict) -> dict:
    return {c["id"]: c for c in task.get("custom_fields", [])}


def _drop(field: dict | None) -> str | None:
    """Resolve a ClickUp dropdown value to its label."""
    if not field or field.get("value") in (None, ""):
        return None
    options = (field.get("type_config") or {}).get("options") or []
    value = field["value"]
    for o in options:
        if o.get("id") == value or o.get("orderindex") == value:
            return o.get("name")
    return None


def _iso(field: dict | None) -> str | None:
    raw = (field or {}).get("value")
    if not raw:
        return None
    try:
        return (
            datetime.datetime.fromtimestamp(int(raw) / 1000, datetime.timezone.utc)
            .date()
            .isoformat()
        )
    except (TypeError, ValueError):
        return None


async def profile_inputs() -> list[dict]:
    """Client rows for the profile builder, straight off Clients - Mahara."""
    tasks: list[dict] = []
    for page in range(6):
        d = await _body(
            pd_clickup_proxy_get(
                url=(
                    f"https://api.clickup.com/api/v2/list/{CLIENTS_LIST}/task"
                    f"?include_closed=true&page={page}"
                )
            )
        )
        batch = d.get("tasks", [])
        tasks += batch
        if len(batch) < 100:
            break

    out = []
    today = datetime.date.today()
    for t in tasks:
        cf = _cf(t)
        stage = _drop(cf.get(PROFILE_CF["status"]))
        # Same client set the rest of the cockpit shows: no junk rows, no lost sales
        # leads, no internal test accounts.
        csm_field = cf.get(CSM_FIELD) or {}
        if not stage and not (csm_field.get("value") or []):
            continue
        if stage and stage.strip().upper() == "SALES TEAM TO CONTACT":
            continue
        if re.search(r"playing account", t["name"], re.I):
            continue
        launch = _iso(cf.get(PROFILE_CF["launch"]))
        live_days = (
            (today - datetime.date.fromisoformat(launch)).days if launch else None
        )
        out.append(
            {
                "name": t["name"],
                "taskId": t["id"],
                "taskUrl": t.get("url"),
                "sheetLink": (cf.get(PROFILE_CF["sheet"]) or {}).get("value"),
                "driveLink": (cf.get(PROFILE_CF["drive"]) or {}).get("value")
                or (cf.get(PROFILE_CF["driveFolder"]) or {}).get("value"),
                "contractLink": (cf.get(PROFILE_CF["contract"]) or {}).get("value"),
                "profileText": (cf.get(PROFILE_CF["profile"]) or {}).get("value"),
                "stage": stage,
                "happiness": _drop(cf.get(PROFILE_CF["happiness"])),
                "service": _drop(cf.get(PROFILE_CF["service"])),
                "adsPlatform": _drop(cf.get(PROFILE_CF["platform"])),
                "launchDate": launch,
                "liveDays": live_days,
            }
        )
    return out


async def push_profiles() -> int:
    """Build every client profile and write it to both deployments.

    When a client's stats sheet cannot be read (the Google Sheets connection 401s from time
    to time), the previously stored numbers are kept and the profile is marked stale rather
    than overwritten with a partial read. A CSM acting on half a client's history is worse
    off than one told the numbers are a day old.
    """
    clients = await profile_inputs()
    campaigns = convex(COCKPIT, "csmSync:campaignsForCsm", {}) or []
    tree = convex(COCKPIT, "csmSync:metaTreeForCsm", {}) or []
    # The ads board only carries campaigns a media buyer added by hand. Aziz's Meta token
    # reads all 34 accounts, so fill in the clients the board never covered, then build the
    # ad sets, ads and previews for anything still missing them.
    from csm_ad_tree import build_tree, discover_campaigns  # noqa: PLC0415

    found = discover_campaigns([c.get("name", "") for c in clients], campaigns)
    if found:
        print(f"campaigns discovered from Meta directly: {len(found)}")
        campaigns = campaigns + found
    tree = await build_tree(campaigns, tree)
    profiles = await build_profiles(clients, campaigns, tree)
    kept = 0
    for profile in profiles:
        perf = profile.get("performance")
        if not (isinstance(perf, dict) and perf.get("error")):
            continue
        previous = await prod("profileFor", {"clientName": profile["clientName"]})
        old = (previous or {}).get("performance")
        if isinstance(old, dict) and not old.get("error"):
            profile["performance"] = {
                **old,
                "staleReason": perf.get("error"),
                "staleAt": kuwait_today_iso(),
            }
            kept += 1
    if kept:
        print(f"kept last good numbers for {kept} clients (their sheet was unreadable)")

    # Lost leads, with the reason and the notes, from each client's own GHL sub-account.
    # This is the answer to "your leads are bad", so it belongs on the client card.
    from csm_ghl_lost import accounts as ghl_accounts, lost_for  # noqa: PLC0415

    try:
        await ghl_accounts()
    except Exception as exc:
        print(f"GHL token sheet unreadable, skipping lost leads: {exc}")
    else:
        with_lost = 0
        for profile in profiles:
            try:
                data = await lost_for(profile["clientName"], profile.get("taskId"))
            except Exception as exc:
                print(f"  lost leads {profile['clientName']} failed: {exc}")
                continue
            if data and not data.get("error"):
                profile["lost"] = data
                with_lost += 1
        print(f"lost leads read for {with_lost} of {len(profiles)} clients")
    # This week's report reminders still waiting on her approval in #csm-general.
    from csm_report_nudges import nudges as report_nudges  # noqa: PLC0415

    try:
        waiting = report_nudges()
    except Exception as exc:
        waiting = {}
        print(f"could not read this week's report reminders: {exc}")
    if waiting:
        # The bot writes the client name from GHL, which is not always the ClickUp name, so
        # match on letters and digits only. An unmatched reminder is reported, never dropped
        # silently, because a reminder nobody sees is a client nobody answers.
        norm = lambda x: re.sub(r"[^0-9\u0600-\u06FFa-z]", "", str(x).lower())  # noqa: E731
        by_key = {norm(k): v for k, v in waiting.items()}
        hit = 0
        for profile in profiles:
            key = norm(profile["clientName"])
            n = by_key.get(key) or next(
                (
                    v
                    for k, v in by_key.items()
                    if k and (k.startswith(key[:12]) or key.startswith(k[:12]))
                ),
                None,
            )
            if n:
                profile["reportNudge"] = n
                by_key.pop(key, None)
                hit += 1
        print(f"report approvals waiting: {len(waiting)} posted, matched to {hit} clients")
        if hit < len(waiting):
            missed = [k for k in waiting if norm(k) not in {norm(p["clientName"]) for p in profiles}]
            print(f"  unmatched reminders, check the name on ClickUp: {missed}")

    # Write every batch first, delete the old set only once they are all in. The previous
    # order cleared the table on batch one, so the run that died mid-push on 2026-09-07 left
    # the CSM looking at 18 of 46 clients and no error anywhere.
    sync_id = f"{kuwait_today_iso()}-{int(time.time())}"
    for i in range(0, len(profiles), PROFILE_BATCH):
        batch = {"profiles": profiles[i : i + PROFILE_BATCH], "syncId": sync_id}
        await dev("storeProfiles", batch)
        await prod("storeProfiles", batch)
    await dev("commitProfiles", {"syncId": sync_id})
    done = await prod("commitProfiles", {"syncId": sync_id})
    if isinstance(done, dict):
        print(f"profiles committed: {done.get('kept')} kept, {done.get('removed')} old rows dropped")
    return len(profiles)


async def drain_reports() -> None:
    """Turn queued report requests into editable, branded Google Docs.

    Production only: the report link goes to the app the CSM actually opens. A failure is
    written back on the row so she sees the reason instead of a spinner forever.
    """
    rows = await prod("pendingReports") or []
    if rows:
        print(f"report docs queued: {len(rows)}")
    for row in rows:
        try:
            profile = await prod("profileFor", {"clientName": row["clientName"]})
            if not profile:
                raise RuntimeError("no stored profile for this client yet")
            url = await build_report_doc(
                profile,
                row.get("language") or "en",
                row.get("note"),
                row.get("extras"),
            )
            await prod("reportDone", {"id": row["_id"], "docUrl": url})
            print(f"  report {row['clientName']} {row['month']} -> {url}")
        except Exception as exc:
            await prod("reportDone", {"id": row["_id"], "error": str(exc)[:300]})
            print(f"  report {row['clientName']} failed: {exc}")


async def drain_eods() -> None:
    """Send every EOD filed in the app to #eods-csms and the EOD Reports sheet.

    Aziz reads both surfaces to see who filed and who did not, so the app filing an EOD has
    to show up there or the app quietly breaks his accountability loop.
    """
    from csm_eod_export import export_eod  # noqa: PLC0415

    rows = await prod("pendingEods") or []
    if rows:
        print(f"EODs to export: {len(rows)}")
    for row in rows:
        try:
            await export_eod(row)
            await prod("eodExported", {"id": row["_id"]})
            print(f"  EOD {row.get('day')} pushed to the channel and the sheet")
        except Exception as exc:
            await prod("eodExported", {"id": row["_id"], "error": str(exc)[:300]})
            print(f"  EOD {row.get('day')} export failed: {exc}")


async def drain_asks() -> None:
    """Answer the CSM's questions from Mahara's own SOP, in the app."""
    rows = await prod("pendingAsks") or []
    if rows:
        print(f"questions queued: {len(rows)}")
    for row in rows:
        try:
            profile = (
                await prod("profileFor", {"clientName": row["clientName"]})
                if row.get("clientName")
                else None
            )
            data = await answer_question(row["question"], profile)
            await prod("answerAsk", {"id": row["_id"], "answer": format_answer(data)})
            print(f"  answered: {row['question'][:60]}")
        except Exception as exc:
            await prod("answerAsk", {"id": row["_id"], "error": str(exc)[:300]})
            print(f"  question failed: {exc}")


async def run_all() -> tuple[list[str], int, int]:
    """One full sync pass. Returns (errors, clients, profiles) instead of raising, so a
    single broken feed never costs the CSM the rest of the run."""
    errors: list[str] = []
    clients = profiles = 0
    skip_sync = "--skip-sync" in sys.argv

    if not skip_sync:
        try:
            urls = await prefetch()
            print(f"prefetched {len(urls)} URLs into the cockpit cache")
            payload = convex(COCKPIT, "csmSync:buildCsmSnapshot", {})
            if not isinstance(payload, dict):
                raise RuntimeError("no snapshot built")
            try:
                rows = await client_data_rows()
                modes = service_mode_map(rows)
                touched = apply_service_modes(payload["clients"], modes)
                sheets = sheet_link_map(rows)
                filled = apply_sheet_links(payload["clients"], sheets)
                print(
                    f"Client Data overlay: {len(rows)} rows, "
                    f"{touched} service modes corrected, "
                    f"{filled} report sheets filled from the database"
                )
            except Exception as exc:
                # Not fatal: the ClickUp fields are the fallback.
                errors.append(f"client data overlay: {exc}")
                print(f"Client Data read failed, using ClickUp fields: {exc}")
            try:
                appts = await calendar_rows(
                    [str(c.get("name", "")) for c in payload["clients"]]
                )
                booked = apply_next_call(payload["clients"], appts)
                convex(CSM_APP, "csmSync:storeAppointments", {"rows": appts})
                await prod("storeAppointments", {"rows": appts})
                print(
                    f"GHL calendars: {len(appts)} bookings, "
                    f"{booked} clients with a next call"
                )
            except Exception as exc:
                # Not fatal: the app falls back to the ClickUp next point of contact.
                errors.append(f"ghl calendars: {exc}")
                print(f"GHL calendar read failed: {exc}")
            args = {
                "clients": payload["clients"],
                "tasks": payload["tasks"],
                "checks": payload["checks"],
            }
            # Both deployments. The CSM uses the production link, so feeding dev only
            # leaves her looking at an empty app while preview looks perfect.
            convex(CSM_APP, "csmSync:store", args)
            await prod("store", args)
            clients = len(payload["clients"])
            print(
                f"ingested into dev and production: {clients} clients, "
                f"{len(payload['tasks'])} tasks, {len(payload['checks'])} checks"
            )
        except Exception as exc:
            errors.append(f"client feed: {exc}")
            print(f"client feed failed: {exc}")

    if not skip_sync and "--no-profiles" not in sys.argv:
        try:
            profiles = await push_profiles()
            print(f"client profiles pushed: {profiles}")
        except Exception as exc:  # a profile failure must not cost him the daily sync
            errors.append(f"client profiles: {exc}")
            print(f"client profiles failed: {exc}")

    if not skip_sync:
        try:
            rows = await churn_rows()
            convex(CSM_APP, "csmSync:storeKpi", {"rows": rows})
            await prod("storeKpi", {"rows": rows})
            print(f"churn KPIs pushed: {[r['key'] for r in rows]}")
        except Exception as exc:  # never let a KPI read break the client sync
            errors.append(f"churn KPIs: {exc}")
            print(f"churn read failed (app will say 'not tracked'): {exc}")

    for label, step in (
        ("report docs", drain_reports),
        ("end of day exports", drain_eods),
        ("AI answers", drain_asks),
    ):
        try:
            await step()
        except Exception as exc:
            errors.append(f"{label}: {exc}")
            print(f"{label} failed: {exc}")

    # Drain both deployments: whichever link she clicked, her writes must reach ClickUp.
    for is_prod in (False, True):
        label = "production" if is_prod else "dev"
        try:
            rows = (
                await prod("pending") if is_prod
                else convex(CSM_APP, "outbox:pending", {})
            ) or []
        except Exception as exc:
            errors.append(f"outbox {label}: {exc}")
            print(f"outbox ({label}) unreadable: {exc}")
            continue
        print(f"outbox ({label}): {len(rows)} pending")
        for row in rows:
            url, err = await handle(row)
            mark = {
                "id": row["_id"],
                **({"resultUrl": url} if url else {}),
                **({"error": err} if err else {}),
            }
            if is_prod:
                await prod("markSent", mark)
            else:
                convex(CSM_APP, "outbox:markSent", mark)
            print(
                f"  [{label}] {row['kind']} "
                f"{row['clientName'] or row['action'][:40]} -> {err or url or 'ok'}"
            )
    return errors, clients, profiles


async def main() -> None:
    started = time.time()
    try:
        errors, clients, profiles = await run_all()
    except Exception as exc:  # hard failure: still leave a record the app can read
        errors, clients, profiles = [f"run aborted: {exc}"], 0, 0
        print(f"run aborted: {exc}")

    # The report card. Both deployments get it, so preview and production agree on
    # whether the data underneath them is trustworthy.
    health = {
        "ok": not errors,
        "clients": clients,
        "profiles": profiles,
        "errors": [e[:300] for e in errors[:5]],
    }
    for name, call in (("dev", dev), ("production", prod)):
        try:
            await call("recordHealth", health)
        except Exception as exc:
            print(f"could not record health on {name}: {exc}")
    print(
        f"run finished in {round(time.time() - started)}s, "
        f"{'clean' if not errors else str(len(errors)) + ' failed step(s)'}"
    )
    if errors:
        # Non zero exit makes the failure visible in the cron log, not just in stdout.
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
