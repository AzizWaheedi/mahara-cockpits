#!/usr/bin/env python3
"""Refresh the media buyer cockpit from OUTSIDE the Space.

Why this exists
---------------
The cockpit's Convex backend normally fetches its own data. It calls the Viktor
Spaces tool endpoint to do that, and as of 2026-09-05 that endpoint returns 500
for every role, platform-side (a deliberately wrong project secret returns 500
instead of 401, so it fails before checking credentials).

The very same integrations work fine from the Viktor sandbox. So this script
does the fetching here, stages the payload into the Space's database in chunks,
and then triggers the sync. `runSync` prefers staged input and falls back to
fetching for itself, so when the platform recovers nothing needs undoing —
just stop running this.

Usage
-----
    uv run python skills/client_onboarding_launch/scripts/sync_cockpit.py
"""

from __future__ import annotations

import asyncio
import json
import re
import time
import subprocess

import requests
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sdk.tools.pd_clickup import pd_clickup_proxy_get
from sdk.tools.pd_google_sheets import pd_google_sheets_proxy_get
from sdk.tools.pd_typeform import pd_typeform_get_form, pd_typeform_list_responses

APP = Path("/work/viktor-spaces/cockpit-6d490e190930")
# The creative director has his own Space, on its own Convex deployment, so the
# media buyer and the creative director never share a surface. [aziz, 2026-09-06]
CREATIVE_APP = Path("/work/viktor-spaces/creative-e94cd85de6ab")
# The Brand Blueprint form is the real "creative onboarding is done" signal.
BLUEPRINT_FORM = "oYZKtogO"

def _const(name: str) -> str:
    """Read a constant out of convex/sync.ts.

    These IDs must never be duplicated by hand: an earlier version of this
    script hardcoded stale list IDs and would have staged the wrong ClickUp
    board without any error.
    """
    src = (APP / "convex" / "sync.ts").read_text()
    m = re.search(rf'const {name} = "([^"]+)"', src)
    if not m:
        raise RuntimeError(f"{name} not found in convex/sync.ts")
    return m.group(1)


def _const_list(name: str) -> list[str]:
    src = (APP / "convex" / "sync.ts").read_text()
    m = re.search(rf"const {name} = \[([^\]]+)\]", src)
    if not m:
        raise RuntimeError(f"{name} not found in convex/sync.ts")
    return re.findall(r'"([^"]+)"', m.group(1))


TRACKER = _const("TRACKER")
DATABASE = _const("DATABASE")
ADS_LIST = _const("ADS_LIST")
HER_LISTS = _const_list("HER_LISTS")
CREATIVE_LIST = _const("CREATIVE_LIST")
VIDEO_LIST = _const("VIDEO_LIST")
CONTENT_LIST = _const("CONTENT_LIST")
CLIENTS_LIST = _const("CLIENTS_LIST")

# Rows older than 30 days are discarded by the sync anyway. Dropping them here
# keeps the staged payload small enough to move in one pass.
DATE_COL = 0
CHUNK = 400_000


def unwrap(raw: Any) -> Any:
    """Tool results arrive as objects, or as JSON inside a `content` string.

    The gateway sometimes appends a human-readable note AFTER the JSON body
    ("sibling connections: ..."), which makes a plain json.loads fail with
    "Extra data". Use raw_decode so the trailing prose is ignored instead of
    silently costing us the whole payload.
    """
    out = raw
    if hasattr(out, "model_dump"):
        out = out.model_dump()
    for _ in range(4):
        if isinstance(out, dict) and isinstance(out.get("content"), str):
            try:
                out = json.JSONDecoder().raw_decode(out["content"].lstrip())[0]
                continue
            except ValueError:
                break
        if isinstance(out, dict) and "body" in out:
            out = out["body"]
            continue
        break
    return out


async def sheet(sheet_id: str, rng: str) -> list[list[str]]:
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{rng}"
    res = unwrap(await pd_google_sheets_proxy_get(url=url))
    values = res.get("values", []) if isinstance(res, dict) else []
    # Never stage an empty sheet: it would overwrite good numbers with nothing.
    if not values:
        raise RuntimeError(f"sheet {sheet_id} range {rng} came back empty — refusing to stage")
    return values


async def clickup(path: str, *, attempts: int = 3) -> Any:
    """GET from ClickUp, retrying the gateway's transient failures.

    The gateway intermittently returns 408 / 5xx. Letting one of those kill an
    otherwise good sync is how the cockpit ends up stale without anyone
    noticing, so retry with a short backoff. [2026-09-06]
    """
    last: Exception | None = None
    for i in range(attempts):
        try:
            return unwrap(
                await pd_clickup_proxy_get(
                    url=f"https://api.clickup.com/api/v2/{path}"
                )
            )
        except Exception as exc:  # noqa: BLE001
            last = exc
            if i < attempts - 1:
                await asyncio.sleep(2 * (i + 1))
    raise last if last else RuntimeError("clickup failed")


def _deploy_key(app: Path = APP) -> tuple[str, str]:
    env = (app / ".env.local").read_text()
    key = re.search(r"^CONVEX_DEPLOY_KEY=(.+)$", env, re.M).group(1).strip()
    url = re.search(r"^VITE_CONVEX_URL=(.+)$", env, re.M).group(1).strip()
    return url, key


def _strip_nulls(obj: Any) -> Any:
    """Drop None values anywhere in the payload.

    Convex optional fields reject an explicit null (v.optional means "absent",
    not "null"). This has bitten three separate writes, so strip centrally
    rather than at each call site.
    """
    if isinstance(obj, dict):
        return {k: _strip_nulls(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_strip_nulls(v) for v in obj]
    return obj


def convex(
    fn: str,
    arg: dict | None = None,
    kind: str = "mutation",
    app: Path = APP,
) -> Any:
    """Call a Convex function over HTTP.

    Not the CLI: staged chunks are far too large to pass as a command-line
    argument (`OSError: File name too long`), so they go in a request body.
    """
    url, key = _deploy_key(app)
    res = requests.post(
        f"{url}/api/{kind}",
        json={"path": fn, "args": _strip_nulls(arg or {}), "format": "json"},
        headers={"Authorization": f"Convex {key}"},
        timeout=900,
    )
    res.raise_for_status()
    body = res.json()
    if body.get("status") != "success":
        raise RuntimeError(f"{fn} failed: {str(body)[:600]}")
    return body.get("value")


def meta_token(app: Path = APP) -> str:
    """The deployment's Meta system token — the only Meta credential we use."""
    out = subprocess.run(
        ["bunx", "convex", "env", "get", "META_SYSTEM_TOKEN"],
        cwd=app,
        capture_output=True,
        text=True,
        timeout=180,
    )
    token = out.stdout.strip()
    if not token:
        raise RuntimeError("META_SYSTEM_TOKEN not set on the deployment")
    return token


def meta_upload(account_id: str, path: str, is_video: bool = False) -> dict:
    """Load a local file into a Meta ad account's creative library.

    Returns `{"id": ...}` for a video or `{"hash": ..., "url": ...}` for an
    image — the shape an ad creative needs. Uploading is the only way a file on
    Drive can become an ad; Meta will not read a URL we do not own.
    """
    token = meta_token()
    acct = account_id if str(account_id).startswith("act_") else f"act_{account_id}"
    edge = "advideos" if is_video else "adimages"
    with open(path, "rb") as fh:
        files = {"source": (Path(path).name, fh)}
        res = requests.post(
            f"https://graph.facebook.com/v21.0/{acct}/{edge}",
            data={"access_token": token},
            files=files,
            timeout=900,
        )
    body = res.json()
    if "error" in body:
        raise RuntimeError(str(body["error"])[:300])
    if is_video:
        return {"id": body.get("id")}
    images = body.get("images") or {}
    first = next(iter(images.values()), {})
    return {"hash": first.get("hash"), "url": first.get("url")}


async def gather() -> dict[str, Any]:
    since30 = (datetime.now(timezone.utc) + timedelta(hours=3) - timedelta(days=30)).strftime("%Y-%m-%d")

    rows_all, client_rows, board = await asyncio.gather(
        sheet(TRACKER, "'data_fb'!A3:Y11005"),
        sheet(DATABASE, "'Client Data'!A1:S200"),
        clickup(f"list/{ADS_LIST}/task?include_closed=true&subtasks=true"),
    )
    rows = [r for r in rows_all if len(r) > DATE_COL and r[DATE_COL] >= since30]
    print(f"spend rows: {len(rows_all)} fetched, {len(rows)} within 30 days")

    her_lists: dict[str, Any] = {}
    for lst in HER_LISTS:
        her_lists[lst] = await clickup(
            f"list/{lst}/task?include_closed=false&subtasks=false"
        )

    # Comments, only for tasks touched in the last 14 days — same rule the
    # in-app sync uses, so the staged result matches what it would fetch.
    tasks = (board or {}).get("tasks", [])
    cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).timestamp() * 1000
    recent = [t for t in tasks if float(t.get("date_updated") or 0) > cutoff][:40]
    comments: dict[str, Any] = {}
    missed = 0
    for t in recent:
        try:
            comments[str(t["id"])] = await clickup(f"task/{t['id']}/comment")
        except Exception as exc:  # noqa: BLE001
            # One unreachable comment thread must not cost us the whole sync.
            missed += 1
            print(f"  comment fetch failed for {t.get('name', t['id'])}: {exc}")
    print(
        f"board tasks: {len(tasks)}, comments pulled for {len(comments)}"
        + (f", {missed} unavailable" if missed else "")
    )

    # Client Data is the spine: without a Meta ad account id nothing can be
    # built for a launching client, so resolve it here and let the cockpit say
    # so plainly instead of failing quietly later.
    head = client_rows[0] if client_rows else []

    def _col(name: str) -> int:
        return head.index(name) if name in head else -1

    ci, mi = _col("Client Name"), _col("Ad Account - Meta")

    def _norm(x: str) -> str:
        return "".join(ch for ch in x.lower() if ch.isalnum())

    def _match(name: str, table: dict) -> str | None:
        """Client names differ between ClickUp and the sheet ("City Wood" vs
        "city wood industry co."), so match on either being a prefix of the
        other once normalized."""
        key = _norm(name)
        if key in table:
            return table[key]
        for k, v in table.items():
            if len(k) >= 5 and (key.startswith(k) or k.startswith(key)):
                return v
        return None

    # The "Ad Account - Meta" column normally holds the ad account NAME, not a
    # numeric id — that is how the tracker joins. Keep both: the digits when the
    # sheet really has an id, and the name either way, so Convex can resolve the
    # name against Meta's own account list. Requiring digits here is what made
    # City Wood look like it had no ad account after Aziz had filled it in.
    # [aziz, 2026-09-07]
    acct_by_client = {}
    acct_name_by_client = {}
    for r in client_rows[1:]:
        nm = r[ci].strip() if 0 <= ci < len(r) else ""
        acct = r[mi].strip() if 0 <= mi < len(r) else ""
        if not nm or not acct:
            continue
        if acct.isdigit():
            acct_by_client[_norm(nm)] = acct
        else:
            acct_name_by_client[_norm(nm)] = acct

    # New-client launches. The checklist is NOT on the launch task: it lives on
    # four subtasks (Setup, Buildout, Tracking, QA), each with its own items.
    onboardings = []
    for lst_tasks in her_lists.values():
        for t in (lst_tasks or {}).get("tasks", []):
            name = t.get("name", "")
            status = (t.get("status") or {}).get("status", "").lower()
            if "new client campaign launch" not in name.lower():
                continue
            if status in {"complete", "closed", "done"}:
                continue
            detail = await clickup(f"task/{t['id']}?include_subtasks=true")
            groups = []
            for sub in (detail or {}).get("subtasks", []):
                sd = await clickup(f"task/{sub['id']}")
                items = [
                    {"name": i.get("name", ""), "done": bool(i.get("resolved"))}
                    for cl in (sd or {}).get("checklists", [])
                    for i in cl.get("items", [])
                ]
                if items:
                    groups.append({"name": sub.get("name", ""), "items": items})
            onboardings.append(
                {
                    "taskId": t["id"],
                    "taskUrl": t.get("url"),
                    "client": name.split(" - New Client")[0].strip(),
                    "status": (t.get("status") or {}).get("status", ""),
                    "accountId": _match(
                        name.split(" - New Client")[0].strip(), acct_by_client
                    ),
                    "accountName": _match(
                        name.split(" - New Client")[0].strip(),
                        acct_name_by_client,
                    ),
                    "groups": groups,
                }
            )
    print(f"open launches: {len(onboardings)}")

    clients = await gather_clients()
    creative = await gather_creative(acct_by_client, clients)
    blueprints = await fetch_blueprints()

    return {
        "creative": creative,
        "clients": clients,
        "blueprints": blueprints,
        "onboardings": onboardings,
        "rows": rows,
        "clientRows": client_rows,
        "board": board,
        "herLists": her_lists,
        "comments": comments,
    }


CLIENT_HINTS: list[str] = []

# --- Client resolution -------------------------------------------------------
#
# Aziz, 2026-09-07: "the tags are the thing that decides which client it's for
# and the actual stage on the board says where they are right now". So: tags
# first, always. Titles are only a fallback for Brand DNA rows, which carry the
# client in the title and no tag at all.

CLIENT_FIELDS = {
    "brandDnaDoc": "\U0001f9ec Brand DNA",
    "offerCheatSheet": "\U0001f4c8 Offer Cheat Sheet",
    "blueprintFormLink": "\U0001f9ec Brand Blueprint Form Link",
    # Two Drive fields exist on the board and clients use one or the other:
    # newer rows fill "Drive Link", older rows fill "Drive Folder". Sync both
    # and let the cockpit fall back. [clickup, 2026-09-07]
    "driveFolder": "Drive Folder",
    "driveLink": "Drive Link",
    "sheetLink": "Sheet Link",
    "clientHistoryDoc": "Client History Document",
    "marketResearchDoc": "Market Research doc",
}

# Rows on Clients - Mahara that are onboarding checklist notes, not companies.
_NOT_A_CLIENT = ("videos", "footage", "launch", "access", "scripts", "dropbox",
                 "ad account", "ads manager")


def _norm_client(x: str) -> str:
    """Normalise a client name WITHOUT destroying Arabic.

    The old version stripped everything outside [a-z0-9], which flattened every
    Arabic client name to an empty string. Empty names then matched each other,
    so Arabic campaigns were attributed to the wrong client. Keep any letter or
    digit in any script and only drop punctuation. [2026-09-07]
    """
    return re.sub(r"[^\w\d]+", " ", (x or "").lower(), flags=re.UNICODE).strip()


# Words that are not a client: matching on them alone attributes half the
# account to whoever happens to be listed first.
_GENERIC_ALIAS = {
    "شركة", "مؤسسة", "مكتب", "شركه", "company", "the", "al", "abu", "group",
    "construction", "contracting", "design", "industries", "mahara",
}


def _alias_set(name: str) -> list[str]:
    """Aliases a tag or campaign name might use for this client."""
    n = _norm_client(name)
    out = {n}
    for junk in (" company", " co", " w l l", " wll", " llc", " limited",
                 " group", " contracting", " construction", " industries"):
        if n.endswith(junk):
            out.add(n[: -len(junk)].strip())
    parts = n.split(" ")
    if len(parts) > 1 and parts[0] not in _GENERIC_ALIAS:
        out.add(parts[0])
    # Arabic firms are usually "شركة X": the distinguishing word is the second.
    if len(parts) > 1 and parts[0] in _GENERIC_ALIAS:
        out.add(" ".join(parts[1:]))
    return sorted(
        a for a in out if len(a) > 2 and a not in _GENERIC_ALIAS
    )


DRIVE_SCAN_MAX_AGE_H = 6


def _folder_id(url: str) -> str | None:
    """The folder id inside a Drive URL, or None if it is not a folder link."""
    m = re.search(r"/folders/([A-Za-z0-9_-]{10,})", url or "")
    return m.group(1) if m else None


_DRIVE_ROW = re.compile(r"([^\u2500\u251c\u2514\u2502]+?)\s*\(id: ([A-Za-z0-9_-]{10,})")


async def scan_client_drive(folder_id: str) -> list[dict[str, str]]:
    """The subfolders inside one client's Drive folder.

    Aziz, 2026-09-08: each client folder gets a "Client Footage" folder for the
    ads we made and a "Scripts" folder for the scripts. gdrive_list returns a
    drawn tree, not JSON, so parse "name (id: ...)" rows and drop anything with
    a mime type, which is a file rather than a folder.
    """
    from sdk.tools.gdrive import gdrive_list

    try:
        out = await gdrive_list(path=folder_id)
    except Exception as exc:  # noqa: BLE001
        print(f"drive scan {folder_id} FAILED: {exc}")
        return []
    text = (out or {}).get("content") or ""
    subs: list[dict[str, str]] = []
    for line in text.splitlines()[1:]:
        if "mime:" in line:
            continue
        m = _DRIVE_ROW.search(line)
        if not m:
            continue
        name = m.group(1).strip().strip('"')
        fid = m.group(2)
        if not name or fid == folder_id:
            continue
        subs.append({
            "name": name,
            "id": fid,
            "url": f"https://drive.google.com/drive/folders/{fid}",
        })
    return subs


async def attach_drive_subfolders(roster: list[dict[str, Any]]) -> None:
    """Fill driveSubfolders / driveFootage / driveScripts on the roster.

    Rescanned at most every few hours: a Drive listing per client is 35 API
    calls, and the folder tree does not change every 15 minutes. Anything
    already cached in the cockpit is reused. [viktor, 2026-09-08]
    """
    try:
        cache = {
            c["name"]: c
            for c in (convex("clients:driveCache", {}, kind="query",
                             app=CREATIVE_APP) or [])
        }
    except Exception as exc:  # noqa: BLE001
        print(f"drive cache read failed, doing a full scan: {exc}")
        cache = {}

    now = time.time() * 1000
    scanned = 0
    for c in roster:
        fid = _folder_id(c.get("driveFolder") or "") or _folder_id(
            c.get("driveLink") or "")
        if not fid:
            continue
        old = cache.get(c["name"]) or {}
        fresh = (
            old.get("driveFolderId") == fid
            and old.get("driveScannedAt")
            and now - old["driveScannedAt"] < DRIVE_SCAN_MAX_AGE_H * 3600_000
        )
        if fresh:
            subs = old.get("driveSubfolders") or []
            c["driveScannedAt"] = old["driveScannedAt"]
        else:
            subs = await scan_client_drive(fid)
            c["driveScannedAt"] = now
            scanned += 1
        c["driveFolderId"] = fid
        c["driveSubfolders"] = subs
        for sub in subs:
            n = sub["name"].lower()
            if "footage" in n or "raw video" in n:
                c.setdefault("driveFootage", sub["url"])
            if "script" in n:
                c.setdefault("driveScripts", sub["url"])
    print(f"drive: {scanned} folder(s) rescanned, "
          f"{sum(1 for c in roster if c.get('driveScripts'))} with a scripts "
          f"folder, {sum(1 for c in roster if c.get('driveFootage'))} with "
          "footage")


async def gather_clients() -> list[dict[str, Any]]:
    """The client roster: status, the docs he works from, and match aliases."""
    data = await clickup(f"list/{CLIENTS_LIST}/task?include_closed=true")
    rows = []
    for t in (data or {}).get("tasks", []):
        name = (t.get("name") or "").strip()
        low = name.lower()
        if not name or any(k in low for k in _NOT_A_CLIENT) and len(name) > 25:
            continue
        f = {}
        for c in t.get("custom_fields", []) or []:
            v = c.get("value")
            if v in (None, "", []):
                continue
            if c.get("type") == "drop_down":
                opts = (c.get("type_config") or {}).get("options") or []
                if isinstance(v, int) and v < len(opts):
                    v = opts[v].get("name")
            f[c["name"]] = v
        status = f.get("Client Status")
        if not status:
            # No Client Status at all = a checklist row, not a company.
            continue
        row = {
            "taskId": t["id"],
            "name": name,
            "url": t.get("url"),
            "clientStatus": status,
            "happiness": f.get("Client Happiness"),
            "service": f.get("Service"),
            "consultationTypes": [
                c for c in (f.get("Consultation Types") or []) if isinstance(c, str)
            ],
            "aliases": _alias_set(name),
            "launchDate": float(f["Launch Date"]) if f.get("Launch Date") else None,
            "onboardingCallDate": (
                float(f["Onboarding Call Date"]) if f.get("Onboarding Call Date") else None
            ),
            "phone": f.get("Phone Number"),
            # Aziz, 2026-09-08: a filled Brand DNA / Offer Cheat Sheet URL
            # proves nothing, because the doc is generated automatically from
            # the template. The Offer Creation dropdown ("Working on it" /
            # "Done" / "Stuck") is the only human sign-off on the board, so
            # completion is read from it, never from the link.
            "offerCreationStatus": f.get("Offer Creation"),
        }
        for key, label in CLIENT_FIELDS.items():
            val = f.get(label)
            row[key] = val if isinstance(val, str) else None
        rows.append(row)
    print(f"clients: {len(rows)}")
    return rows


def _build_index(clients: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    idx: dict[str, dict[str, Any]] = {}
    for c in clients:
        for a in [_norm_client(c["name"]), *c["aliases"]]:
            idx.setdefault(a, c)
    return idx


def _resolve(tags: list[str], index: dict[str, dict[str, Any]],
             fallback_title: str | None = None) -> tuple[list[str], list[str]]:
    """Return (client names, raw tags). Tags win; title is the last resort."""
    names, raw = [], []
    for tag in tags:
        raw.append(tag)
        hit = index.get(_norm_client(tag))
        names.append(hit["name"] if hit else tag)
    if not names and fallback_title:
        hit = index.get(_norm_client(fallback_title))
        names = [hit["name"] if hit else fallback_title]
    # Dedupe, keep order.
    seen, out = set(), []
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out, raw



def _client_from_name(name: str) -> str | None:
    """Pull the client out of a ClickUp task title.

    Creative titles are written as "<Client> - Brand DNA" or
    "<Client> - Creative Onboarding". Anything without that separator (every
    "New Script Request", for instance) genuinely has no client on it, and the
    cockpit says so rather than guessing.
    """
    # Split on whichever separator comes FIRST, not whichever we check first:
    # "RM Decor · P13 — Villa Full Tour" must yield "RM Decor", not
    # "RM Decor · P13".
    cuts = [name.index(sep) for sep in (" - ", " — ", " · ") if sep in name]
    if not cuts:
        return None
    head = name[: min(cuts)].strip()
    if head and not head[0].isdigit():
        return head
    return None


def _kind(name: str) -> str:
    low = name.lower()
    if "brand dna" in low:
        return "brandDNA"
    if "script request" in low:
        return "script"
    if "creative onboarding" in low:
        return "onboarding"
    if "website" in low:
        return "website"
    return "other"


# The content calendar list was built as a demo and never became real work.
# Aziz, 2026-09-08: "rmd core was just a test, they're not actually on the
# content calendar." Filtered here rather than in the cockpit, so no screen and
# no count is ever built on invented posts.
_DEMO_POSTS = ("rm decor", "rmd core", "template")


def _is_demo_post(name: str) -> bool:
    n = (name or "").strip().lower()
    return (not n) or len(n) < 3 or any(n.startswith(d) for d in _DEMO_POSTS)


# --- Client stat sheets ------------------------------------------------------
# Aziz, 2026-09-08: the creative director should see the client's booking, show,
# quotation and close rates, not only cost per lead. Those live in each client's
# own stat sheet, one tab per month, one row per appointment.
#
# Columns are fixed by the template: Name(0) Date Added(1) App Date(2)
# Phone(3) Caller(4) Confirmed(5) Deposit(6) Notes(7) Consultation type(8)
# Show(9) Quotation Given(10) Closed(11).
STAT_SHEET_MAX_AGE_H = 2
_MONTH_TABS = (
    "Jan 26", "Feb 26", "Mar 26", "Apr 26", "May 26", "Jun 26",
    "Jul 26", "Aug 26", "Sep 26", "Oct 26", "Nov 26", "Dec 26",
)


def _sheet_id(link: str | None) -> str | None:
    if not link:
        return None
    m = re.search(r"/spreadsheets/d/([A-Za-z0-9_-]{20,})", link)
    return m.group(1) if m else None


def _yes(cell: str) -> bool:
    return (cell or "").strip().upper().startswith("Y")


async def read_stat_sheet(sheet_id: str, tab: str) -> dict[str, Any] | None:
    """Count one month of appointments off a client's stat sheet.

    Returns raw counts only. Rates are computed in the Space, so there is one
    place where the arithmetic lives.
    """
    try:
        rows = await sheet(sheet_id, f"'{tab}'!A3:L400")
    except Exception:  # noqa: BLE001 — an empty or missing tab is not an error
        return None
    booked = shows = quotes = closes = 0
    for r in rows:
        r = list(r) + [""] * (12 - len(r))
        if not (r[0] or "").strip():
            continue
        booked += 1
        if _yes(r[9]):
            shows += 1
        if _yes(r[10]):
            quotes += 1
        if _yes(r[11]):
            closes += 1
    if booked == 0:
        return None
    return {
        "tab": tab,
        "booked": booked,
        "shows": shows,
        "quotes": quotes,
        "closes": closes,
    }


async def attach_stat_sheets(roster: list[dict[str, Any]]) -> None:
    """Fill each client row with this month's appointment counts.

    Cached in the Space and refreshed every couple of hours: a stat sheet is
    filled in by hand through the day, not every 15 minutes, and 24 sheet reads
    per sync would be pure waste.
    """
    try:
        cache = convex("clients:statCache", {}, kind="query", app=CREATIVE_APP) or {}
    except Exception as exc:  # noqa: BLE001
        print(f"stat sheet cache lookup failed: {exc}")
        cache = {}
    now = time.time() * 1000
    tab = _MONTH_TABS[datetime.now(timezone.utc).month - 1]
    read = fresh = 0
    for row in roster:
        sid = _sheet_id(row.get("sheetLink"))
        if not sid:
            continue
        old = cache.get(row["name"]) or {}
        if old.get("statsScannedAt") and now - old["statsScannedAt"] < (
            STAT_SHEET_MAX_AGE_H * 3600 * 1000
        ):
            # Convex rejects an explicit null on an optional field, so a client
            # with no appointments this month simply carries no stats key.
            if old.get("stats"):
                row["stats"] = old["stats"]
            row["statsScannedAt"] = old["statsScannedAt"]
            fresh += 1
            continue
        stats = await read_stat_sheet(sid, tab)
        read += 1
        if stats:
            row["stats"] = stats
        row["statsScannedAt"] = now
    with_stats = sum(1 for r in roster if r.get("stats"))
    print(
        f"stat sheets: {read} read, {fresh} cached, {with_stats} client(s) with "
        f"appointments in {tab}"
    )


async def gather_creative(
    acct_by_client: dict[str, str],
    clients: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """The creative director's three boards, flattened for the cockpit.

    Client attribution comes from ClickUp TAGS, and the stage shown is the raw
    ClickUp status. Both rules are Aziz's, after the first build guessed from
    titles and inflated every queue. [aziz, 2026-09-07]
    """
    index = _build_index(clients or [])
    status_by_client = {c["name"]: c.get("clientStatus") for c in (clients or [])}
    board, video, content = await asyncio.gather(
        clickup(f"list/{CREATIVE_LIST}/task?include_closed=true&subtasks=true"),
        clickup(f"list/{VIDEO_LIST}/task?include_closed=true&subtasks=true"),
        clickup(f"list/{CONTENT_LIST}/task?include_closed=true&subtasks=true"),
    )

    def fields(t: dict) -> dict[str, Any]:
        out = {}
        for c in t.get("custom_fields", []) or []:
            v = c.get("value")
            if v in (None, "", []):
                continue
            if c.get("type") == "drop_down":
                opts = (c.get("type_config") or {}).get("options") or []
                idx = v if isinstance(v, int) else None
                if idx is not None and idx < len(opts):
                    v = opts[idx].get("name")
            elif c.get("type") == "users":
                v = [u.get("username") for u in v if isinstance(u, dict)]
            out[c["name"]] = v
        return out

    tasks = []
    for t in (board or {}).get("tasks", []):
        name = t.get("name", "")
        f = fields(t)
        tag_names = [x.get("name", "") for x in (t.get("tags") or [])]
        # Brand DNA rows are the one place the client lives in the title.
        title_client = _client_from_name(name) if " - " in name else None
        resolved, raw_tags = _resolve(tag_names, index, title_client)
        tasks.append({
            "taskId": t["id"],
            "name": name,
            "url": t.get("url"),
            "status": (t.get("status") or {}).get("status", ""),
            # A task with a parent is a step of the six-part onboarding
            # sequence. Its title contains "Brand DNA", so classifying by
            # keyword alone would pollute the brand queue with subtasks.
            "kind": "onboardingStep" if t.get("parent") else _kind(name),
            "client": resolved[0] if resolved else None,
            "clients": resolved or None,
            "tags": raw_tags or None,
            "clientStatus": (
                status_by_client.get(resolved[0]) if resolved else None
            ),
            "parentId": t.get("parent"),
            "assignees": [a.get("username") for a in t.get("assignees", [])],
            "dueDate": float(t["due_date"]) if t.get("due_date") else None,
            "createdAt": float(t.get("date_created") or 0),
            "updatedAt": float(t.get("date_updated") or 0),
            "notes": str(f.get("Additional Notes") or "")[:400] or None,
        })

    videos = []
    for t in (video or {}).get("tasks", []):
        f = fields(t)
        editors = f.get("Assigned Editor") or []
        tag_names = [x.get("name", "") for x in (t.get("tags") or [])]
        resolved, raw_tags = _resolve(
            tag_names, index, _client_from_name(t.get("name", ""))
        )
        videos.append({
            "taskId": t["id"],
            "name": t.get("name", ""),
            "url": t.get("url"),
            "status": (t.get("status") or {}).get("status", ""),
            # The client is the TAG. Every live row on this board carries one.
            "client": resolved[0] if resolved else None,
            "clients": resolved or None,
            "tags": raw_tags or None,
            "clientStatus": (
                status_by_client.get(resolved[0]) if resolved else None
            ),
            "editors": [e for e in editors if e],
            "dueDate": float(t["due_date"]) if t.get("due_date") else None,
            "createdAt": float(t.get("date_created") or 0),
            "editedLink": f.get("Edited Video Link"),
            "rawLink": f.get("Raw Video Link"),
        })

    posts = []
    for t in (content or {}).get("tasks", []):
        if _is_demo_post(t.get("name", "")):
            continue
        f = fields(t)
        posts.append({
            "taskId": t["id"],
            "name": t.get("name", ""),
            "url": t.get("url"),
            "status": (t.get("status") or {}).get("status", ""),
            "client": _client_from_name(t.get("name", "")),
            "publishDate": float(t["due_date"]) if t.get("due_date") else None,
            "designers": f.get("Designer") or [],
            "liveLink": f.get("Live Post Link"),
            "designLink": f.get("Design Link"),
        })

    print(f"creative: {len(tasks)} tasks, {len(videos)} videos, {len(posts)} posts")
    return {"tasks": tasks, "videos": videos, "posts": posts}


TOOLS = {
    "pd_clickup_proxy_post": "sdk.tools.pd_clickup:pd_clickup_proxy_post",
    "pd_google_sheets_proxy_post": "sdk.tools.pd_google_sheets:pd_google_sheets_proxy_post",
}


# Nada, the media buyer. Questions from the cockpit go to her own Viktor DM so
# the answer reaches her where she already works.
MEDIA_BUYER_SLACK_ID = "U0AJQ8P1ACF"


async def relay_to_slack(args: dict) -> bool:
    """
    Send a cockpit question to Viktor in Slack, with the campaign attached.

    The point of attaching context is that "should I scale this?" is unanswerable
    on its own — whoever picks it up would have to go and look the numbers up,
    which is exactly the work the cockpit exists to remove.
    """
    from sdk.tools.slack_admin_tools import coworker_send_slack_message

    if args.get("kind") == "campaign_question":
        lines = [
            f"*Question from the cockpit* — {args.get('campaign', 'a campaign')}",
        ]
        if args.get("client"):
            lines.append(f"Client: {args['client']}")
        if args.get("context"):
            lines.append(f"Right now: {args['context']}")
        lines.append("")
        lines.append(f"> {args.get('text', '')}")
        text = "\n".join(lines)
    else:
        text = f"*Request from the cockpit*\n\n> {args.get('text', '')}"

    try:
        res = await coworker_send_slack_message(
            channel_id=MEDIA_BUYER_SLACK_ID,
            do_send=True,
            blocks=[{"type": "section", "text": {"type": "mrkdwn", "text": text}}],
        )
        env = res.model_dump() if hasattr(res, "model_dump") else res
        ok = bool(env.get("success", True)) if isinstance(env, dict) else True
        print(f"  {'relayed' if ok else 'FAILED to relay'} to Slack: {args.get('text', '')[:70]}")
        return ok
    except Exception as exc:  # noqa: BLE001
        print(f"  FAILED to relay to Slack: {exc}")
        print(f"  QUESTION WAS: {args.get('text', '')}")
        return False



async def _close_task(task_id: str) -> tuple[bool, str]:
    """Move a task to its list's closed status, and verify it moved."""
    from sdk.tools.pd_clickup import pd_clickup_proxy_put

    task = await clickup(f"task/{task_id}")
    if not task:
        return False, "task not found"
    list_id = ((task.get("list") or {}).get("id")) or ""
    statuses = ((await clickup(f"list/{list_id}")) or {}).get("statuses", [])
    names = [s.get("status", "") for s in statuses]
    # Only ClickUp's "done" type counts. The "closed" type on these lists is
    # `cancelled`, and marking a finished video cancelled would be worse than
    # doing nothing, so a list without a done status is refused rather than
    # guessed at. [viktor, 2026-09-07]
    closed = next(
        (s["status"] for s in statuses if s.get("type") == "done"), None
    )
    if not closed:
        return False, f"list has no done status, only {names}"
    unwrap(await pd_clickup_proxy_put(
        url=f"https://api.clickup.com/api/v2/task/{task_id}",
        json_body={"status": closed},
    ))
    after = await clickup(f"task/{task_id}")
    now_status = ((after or {}).get("status") or {}).get("status", "")
    if now_status.lower() != closed.lower():
        return False, f"status still {now_status!r}, wanted {closed!r}"
    return True, f"moved to {closed}"


DAY_MS = 86_400_000


def _epoch_ms(day: str) -> int:
    """Midday UTC on a YYYY-MM-DD, so a date never slips a day in Kuwait."""
    return int(
        datetime.strptime(day, "%Y-%m-%d")
        .replace(hour=12, tzinfo=timezone.utc)
        .timestamp() * 1000
    )


async def drain_creative_outbox() -> None:
    """Execute the creative director's queued ClickUp writes.

    His cockpit holds no credentials, so "complete this", "comment this" and
    "raise a video request" are queued as intents and executed here. Anything
    that fails is marked failed with the reason, so a write is never silently
    dropped. [aziz, 2026-09-07]
    """
    from sdk.tools.pd_clickup import (
        pd_clickup_proxy_post,
        pd_clickup_proxy_put,
    )

    try:
        items = convex("clients:outboxPending", {}, kind="query",
                       app=CREATIVE_APP) or []
    except Exception as exc:  # noqa: BLE001
        print(f"creative outbox read FAILED: {exc}")
        return
    if not items:
        return

    for item in items:
        kind, task_id = item["kind"], item.get("taskId")
        data = item.get("payload") or {}
        ok, result = False, ""
        try:
            if kind == "comment" and task_id:
                unwrap(await pd_clickup_proxy_post(
                    url=f"https://api.clickup.com/api/v2/task/{task_id}/comment",
                    json_body={"comment_text": data.get("text", ""),
                          "notify_all": False},
                ))
                ok, result = True, "comment posted"
            elif kind == "complete" and task_id:
                # "complete" is not a status on every list. The Video Pipeline
                # runs new video request -> ... -> live, and ClickUp accepts a
                # PUT with an unknown status without applying it, so a blind
                # write reported success while the board never moved. Resolve
                # the list's own closed status, then read the task back and
                # only claim success if it actually changed. [viktor, 2026-09-07]
                ok, result = await _close_task(task_id)
            elif kind == "videoRequest":
                body: dict[str, Any] = {
                    "name": data.get("type") or "New Video Request \U0001f3a5",
                    "description": data.get("brief", ""),
                    # The tag is what makes the task findable per client.
                    "tags": [str(data.get("client", "")).lower()],
                }
                if data.get("due"):
                    body["due_date"] = int(
                        datetime.strptime(data["due"], "%Y-%m-%d")
                        .replace(tzinfo=timezone.utc)
                        .timestamp() * 1000
                    )
                created = unwrap(await pd_clickup_proxy_post(
                    url=f"https://api.clickup.com/api/v2/list/{VIDEO_LIST}/task",
                    json_body=body,
                ))
                new_id = (created or {}).get("id")
                if new_id and data.get("footage"):
                    await pd_clickup_proxy_post(
                        url=(
                            "https://api.clickup.com/api/v2/task/"
                            f"{new_id}/field/d37a6747-c4a1-43c5-bb73-e1725ecec982"
                        ),
                        json_body={"value": data["footage"]},
                    )
                ok, result = bool(new_id), f"video task {new_id}"
            elif kind == "planScript":
                # Proactive scripting: put a dated script request on the
                # creative board so the calendar has something real to show.
                body = {
                    "name": data.get("title") or "New Script Request\u270d\ufe0f",
                    "description": data.get("brief", ""),
                    "tags": [str(data.get("client", "")).lower()],
                }
                if data.get("due"):
                    body["due_date"] = _epoch_ms(data["due"])
                    body["due_date_time"] = False
                created = unwrap(await pd_clickup_proxy_post(
                    url=f"https://api.clickup.com/api/v2/list/{CREATIVE_LIST}/task",
                    json_body=body,
                ))
                new_id = (created or {}).get("id")
                ok, result = bool(new_id), f"script task {new_id}"
            elif kind == "schedule" and task_id:
                # Moving a card on the calendar writes the due date back.
                unwrap(await pd_clickup_proxy_put(
                    url=f"https://api.clickup.com/api/v2/task/{task_id}",
                    json_body={"due_date": _epoch_ms(data["due"]),
                               "due_date_time": False},
                ))
                back = unwrap(await pd_clickup_proxy_get(
                    url=f"https://api.clickup.com/api/v2/task/{task_id}"))
                got = (back or {}).get("due_date")
                ok = bool(got) and abs(int(got) - _epoch_ms(data["due"])) < DAY_MS
                result = f"due {data['due']}" if ok else f"board still says {got}"
            else:
                result = f"unknown action {kind}"
        except Exception as exc:  # noqa: BLE001
            result = str(exc)[:300]
        try:
            convex("clients:outboxSettle",
                   {"id": item["id"], "ok": ok, "result": result},
                   app=CREATIVE_APP)
        except Exception as exc:  # noqa: BLE001
            print(f"creative outbox settle FAILED: {exc}")
        print(f"creative outbox {kind}: {'ok' if ok else 'FAILED'} — {result}")


async def drain_outbox() -> None:
    """Deliver writes the app could not send itself.

    While the Spaces tool endpoint is down, ClickUp comments and sheet appends
    made from the cockpit are queued rather than lost. Deliver them here.
    Slack posts are skipped: they need the coworker tool, which only the agent
    runtime has, so those are reported instead of silently dropped.
    """
    import importlib

    items = convex("outbox:pending", {}, kind="query") or []
    if not items:
        return
    print(f"outbox: {len(items)} queued write(s)")
    for item in items:
        role, args = item["role"], item["args"]
        if role == "slack_request":
            # Something typed into the cockpit that needs Viktor rather than an
            # API: a free-form build request, or a question about a campaign.
            # Deliver it to her Slack DM with Viktor, carrying the campaign's
            # numbers, so she can carry on the conversation there and get a real
            # answer. Printed as well, so a failed send is never silent.
            ok = await relay_to_slack(args)
            convex("outbox:settle", {"id": item["id"], "ok": ok})
            # Tell the cockpit the message actually left the building. Without
            # this the sender sees "queued" forever and cannot tell a working
            # relay from a broken one. [aziz, 2026-09-07]
            if args.get("campaignId"):
                convex(
                    "chat:markSent",
                    {
                        "campaignId": args["campaignId"],
                        "text": args.get("text"),
                        "ok": ok,
                    },
                )
            continue
        target = TOOLS.get(role)
        if not target:
            print(f"  skip {role} — not deliverable from here")
            continue
        mod, fn = target.split(":")
        try:
            func = getattr(importlib.import_module(mod), fn)
            raw = await func(**args)
            # The proxy reports the upstream HTTP status inside the envelope,
            # so a 2xx from the gateway does not by itself mean success.
            env = raw.model_dump() if hasattr(raw, "model_dump") else raw
            code = None
            if isinstance(env, dict) and isinstance(env.get("content"), str):
                try:
                    code = json.JSONDecoder().raw_decode(
                        env["content"].lstrip()
                    )[0].get("status_code")
                except ValueError:
                    pass
            ok = code is not None and int(code) < 300
            settle: dict[str, Any] = {"id": item["id"], "ok": ok}
            if not ok:
                settle["error"] = f"upstream status {code}"
            convex("outbox:settle", settle)
            print(f"  {'sent' if ok else 'failed'} {role} (status {code})")
        except Exception as exc:  # noqa: BLE001
            convex("outbox:settle",
                   {"id": item["id"], "ok": False, "error": str(exc)[:300]})
            print(f"  failed {role}: {exc}")




# --- Funnels: where the leads actually come in ------------------------------
# The creative director scripts the funnel, not just the ad, so he needs the
# destination behind every live ad: the instant form and its exact questions,
# the landing page, or the WhatsApp thread. Meta is the only honest source for
# this, the spend tracker has no destination column. Spend and leads come from
# the tracker and are joined on Ad ID. [aziz, 2026-09-07]
GRAPH = "https://graph.facebook.com/v21.0"
# Questions that actually filter a lead. Anything else is contact detail.
GATE_HINTS = (
    "project", "مشروع", "budget", "ميزاني", "when", "متى", "timeline",
    "size", "مساحة", "type", "نوع", "stage", "مرحل", "own", "تملك",
    "location", "منطق", "service", "خدم",
)
CONTACT_TYPES = {
    "FULL_NAME", "FIRST_NAME", "LAST_NAME", "PHONE", "EMAIL", "CITY",
    "STATE", "COUNTRY", "ZIP", "STREET_ADDRESS", "COMPANY_NAME",
}


def _graph(params: dict[str, Any]) -> dict[str, Any]:
    r = requests.get(GRAPH + "/", params=params, timeout=90)
    if r.status_code != 200:
        raise RuntimeError(f"graph {r.status_code}: {r.text[:200]}")
    return r.json()


def _destination(ad: dict[str, Any]) -> dict[str, Any]:
    """Pull the destination out of a creative, whatever shape Meta used."""
    found: dict[str, Any] = {"formId": None, "url": None}

    def scan(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("lead_gen_form_id"):
                found["formId"] = str(node["lead_gen_form_id"])
            for key in ("link", "link_url", "website_url"):
                val = node.get(key)
                if isinstance(val, str) and val.startswith("http") and not found["url"]:
                    found["url"] = val
            for val in node.values():
                scan(val)
        elif isinstance(node, list):
            for val in node:
                scan(val)

    scan(ad.get("creative") or {})
    url = found["url"] or ""
    dtype = str((ad.get("adset") or {}).get("destination_type") or "")
    if found["formId"]:
        kind = "Instant form"
    elif "whatsapp" in url or dtype == "WHATSAPP":
        kind = "WhatsApp"
    elif "instagram.com" in url and "direct" not in url:
        kind = "Instagram"
    elif "fb.me" in url or "facebook.com" in url:
        kind = "Facebook"
    elif url:
        kind = "Landing page"
    elif dtype in ("ON_POST", "ON_VIDEO", "ON_PAGE"):
        kind = "Stays on the post"
    else:
        kind = "Unknown"
    return {"kind": kind, "url": found["url"], "formId": found["formId"]}


# Mahara's own lead gen account. Aziz, 2026-09-08: "don't include the
# maharamedia ad account because that's b2b, it's different." The creative
# director scripts client funnels, and Mahara's own funnel plays by different
# rules, so it is filtered out of the funnels feed entirely.
OWN_ACCOUNTS = {"maharamedia", "mahara media"}


async def gather_funnels() -> list[dict[str, Any]]:
    """One row per destination per ad account, with its questions and cost.

    Client accounts only: Mahara's own account is excluded on purpose.
    """
    rows = await sheet(TRACKER, "'data_fb'!A3:Y11005")
    since = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
    ads: dict[str, dict[str, Any]] = {}
    for r in rows:
        if len(r) < 19 or not r[0] or r[0] < since or not r[16]:
            continue
        if (r[1] or "").strip().lower() in OWN_ACCOUNTS:
            continue
        a = ads.setdefault(r[16], {
            "account": r[1], "adName": r[17], "status": r[18],
            "spend": 0.0, "leads": 0.0,
        })
        try:
            a["spend"] += float(r[4] or 0)
            a["leads"] += float(r[5] or 0)
        except ValueError:
            pass
    live = [k for k, v in ads.items() if v["status"] in ("ACTIVE", "WITH_ISSUES")]
    if not live:
        print("funnels: no live ads in the window")
        return []

    token = meta_token()
    fields = (
        "name,effective_status,creative{object_story_spec,asset_feed_spec,"
        "link_url,effective_object_story_id},adset{destination_type,name}"
    )
    meta: dict[str, Any] = {}
    for i in range(0, len(live), 40):
        try:
            meta.update(_graph({
                "access_token": token, "ids": ",".join(live[i:i + 40]),
                "fields": fields,
            }))
        except Exception as exc:  # noqa: BLE001
            print(f"funnels: ad batch failed, skipped — {exc}")

    # Group by account + destination.
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    form_ids: set[str] = set()
    for ad_id, ad in meta.items():
        row = ads.get(ad_id)
        if not row:
            continue
        d = _destination(ad)
        key = (row["account"], d["formId"] or d["url"] or d["kind"])
        g = groups.setdefault(key, {
            "account": row["account"], "kind": d["kind"], "url": d["url"],
            "formId": d["formId"], "spend": 0.0, "leads": 0.0, "ads": [],
        })
        g["spend"] += row["spend"]
        g["leads"] += row["leads"]
        g["ads"].append({"adId": ad_id, "adName": row["adName"],
                         "status": ad.get("effective_status") or row["status"]})
        if d["formId"]:
            form_ids.add(d["formId"])

    forms: dict[str, Any] = {}
    fl = sorted(form_ids)
    for i in range(0, len(fl), 40):
        try:
            forms.update(_graph({
                "access_token": token, "ids": ",".join(fl[i:i + 40]),
                "fields": ("name,status,leads_count,questions,"
                           "question_page_custom_headline,follow_up_action_url"),
            }))
        except Exception as exc:  # noqa: BLE001
            print(f"funnels: form batch failed, skipped — {exc}")

    out: list[dict[str, Any]] = []
    for g in groups.values():
        form = forms.get(g["formId"] or "") or {}
        questions = []
        for q in form.get("questions") or []:
            label = str(q.get("label") or q.get("key") or "")
            qtype = str(q.get("type") or "")
            low = label.lower()
            gate = qtype not in CONTACT_TYPES and any(h in low for h in GATE_HINTS)
            questions.append({
                "label": label,
                "type": qtype,
                "options": [str(o.get("value") or o.get("key") or "")
                            for o in (q.get("options") or [])],
                "isGate": gate,
            })
        out.append({
            "account": g["account"],
            "kind": g["kind"],
            "url": g["url"],
            "formId": g["formId"],
            "formName": form.get("name"),
            "formStatus": form.get("status"),
            "headline": form.get("question_page_custom_headline"),
            "followUpUrl": form.get("follow_up_action_url"),
            "leadsAllTime": float(form.get("leads_count") or 0) or None,
            "questions": questions,
            "gates": sum(1 for q in questions if q["isGate"]),
            "spend": round(g["spend"], 2),
            "leads": g["leads"],
            "cpl": round(g["spend"] / g["leads"], 2) if g["leads"] else None,
            "ads": sorted(g["ads"], key=lambda a: a["adName"]),
        })
    out.sort(key=lambda r: (-r["spend"], r["account"]))
    withq = sum(1 for r in out if r["questions"])
    print(f"funnels: {len(out)} destinations across "
          f"{len({r['account'] for r in out})} accounts, {withq} with questions")
    return out


async def fetch_blueprints() -> list[dict[str, Any]]:
    """Brand Blueprint submissions, flattened to the fields the cockpit shows.

    Typeform nests questions inside `inline_group`s, so the field map has to be
    walked recursively or half the titles go missing. Answers are matched by
    field id, never by position. [2026-09-06]
    """
    try:
        form = unwrap(await pd_typeform_get_form(formId=BLUEPRINT_FORM))
    except Exception as exc:  # noqa: BLE001
        print(f"blueprint form unavailable: {exc}")
        return []

    titles: dict[str, str] = {}

    def walk(fields: list[dict[str, Any]]) -> None:
        for f in fields or []:
            titles[f.get("id", "")] = str(f.get("title") or "")
            walk((f.get("properties") or {}).get("fields") or [])

    walk(form.get("fields") or [])

    try:
        res = unwrap(await pd_typeform_list_responses(formId=BLUEPRINT_FORM, pageSize=200))
    except Exception as exc:  # noqa: BLE001
        print(f"blueprint responses unavailable: {exc}")
        return []
    items = res if isinstance(res, list) else res.get("items", [])

    def value(ans: dict[str, Any]) -> str:
        for k in ("text", "email", "url", "date", "number", "boolean"):
            if ans.get(k) is not None:
                return str(ans[k])
        if isinstance(ans.get("choice"), dict):
            return str(ans["choice"].get("label") or "")
        if isinstance(ans.get("choices"), dict):
            return ", ".join(ans["choices"].get("labels") or [])
        return ""

    rows: list[dict[str, Any]] = []
    for it in items:
        by_title: dict[str, str] = {}
        for a in it.get("answers") or []:
            fid = (a.get("field") or {}).get("id", "")
            by_title[titles.get(fid, fid)] = value(a)
        hidden = it.get("hidden") or {}

        def pick(*needles: str) -> str | None:
            for t, v in by_title.items():
                low = t.lower()
                if all(n in low for n in needles) and v:
                    return v
            return None

        rows.append({
            "responseId": it.get("response_id") or it.get("token") or "",
            # Typeform has no client question: the client arrives as a hidden
            # field from the link. Without it a submission cannot be attributed.
            "client": hidden.get("client") or hidden.get("client_name") or None,
            "submittedAt": _iso_ms(it.get("submitted_at")),
            "brandDnaStatus": pick("brand dna status"),
            "brandDnaDoc": pick("brand dna doc"),
            "offerSheet": pick("offer cheat sheet"),
            "stillMissing": pick("still missing"),
            "approvalNeeded": pick("client approval"),
            "editor": pick("which editor"),
            "launchCallDate": pick("launch call date"),
            "answers": by_title,
        })
    named = sum(1 for r in rows if r["client"])
    print(f"blueprints: {len(rows)} submissions, {named} attributable to a client")
    return rows


def _iso_ms(value: Any) -> float:
    if not value:
        return 0.0
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp() * 1000
    except ValueError:
        return 0.0


async def push_creative_space(payload: dict[str, Any]) -> None:
    """Mirror the creative boards and ad performance into the creative Space.

    The creative director's cockpit is a separate deployment with no
    credentials of its own, so everything it shows arrives through here. Ad
    performance is taken from the media buyer's scoped snapshot -- only
    campaigns that exist on the Ads Managment board -- so both cockpits agree
    on which campaigns are ours. [aziz, 2026-09-06]
    """
    blueprints = payload.get("blueprints")
    if blueprints is not None:
        try:
            res = convex(
                "sync:storeBlueprints", {"rows": blueprints}, app=CREATIVE_APP
            )
            print(f"creative space blueprints: {res}")
        except Exception as exc:  # noqa: BLE001
            print(f"creative space blueprints FAILED: {exc}")

    funnels = payload.get("funnels")
    if funnels:
        try:
            res = convex("sync:storeFunnels", {"rows": funnels}, app=CREATIVE_APP)
            print(f"creative space funnels: {res}")
        except Exception as exc:  # noqa: BLE001
            print(f"creative space funnels FAILED: {exc}")

    roster = payload.get("clients") or []
    if roster:
        await attach_drive_subfolders(roster)
        await attach_stat_sheets(roster)
        try:
            res = convex("sync:storeClients", {"clients": roster}, app=CREATIVE_APP)
            print(f"creative space clients: {res}")
        except Exception as exc:  # noqa: BLE001
            print(f"creative space clients FAILED: {exc}")

    cre = payload.get("creative") or {}
    if not cre:
        print("creative space: nothing to push")
        return
    try:
        res = convex(
            "sync:storeCreative",
            {
                "tasks": cre.get("tasks", []),
                "videos": cre.get("videos", []),
                "posts": cre.get("posts", []),
            },
            app=CREATIVE_APP,
        )
        print(f"creative space boards: {res}")
    except Exception as exc:  # noqa: BLE001
        print(f"creative space boards FAILED: {exc}")

    # Read back the scoped rows the media buyer's sync just stored, rather than
    # recomputing them here -- one source of truth for what a campaign earned.
    try:
        ads = convex("sync:exportAdPerformance", {}, kind="query") or {}
        if ads.get("ads"):
            res = convex(
                "sync:storeAdPerformance",
                {
                    "ads": ads["ads"],
                    "campaigns": ads.get("campaigns", []),
                    "tree": ads.get("tree", []),
                },
                app=CREATIVE_APP,
            )
            print(f"creative space performance: {res}")
        else:
            print("creative space performance: no ads in scope, skipped")
    except Exception as exc:  # noqa: BLE001
        print(f"creative space performance FAILED: {exc}")

    # Mirror the raw plays so the creative director's "What works" page IS the
    # media buyer's page: same query file, same rows, one definition of a proven
    # play in the company. [aziz, 2026-09-07]
    try:
        plays = convex("market:rawPlays", {}, kind="query") or []
        if plays:
            res = convex("sync:storePlays", {"plays": plays}, app=CREATIVE_APP)
            print(f"creative space plays: {len(plays)} rows -> {res}")
        else:
            print("creative space plays: cockpit returned none, kept existing")
    except Exception as exc:  # noqa: BLE001
        print(f"creative space plays FAILED: {exc}")

    # Mirror the winning-ads archive so the creative director scripts from the
    # SAME rows the media buyer judges ads on. The cockpit owns the definition
    # of "winning"; copying it here keeps one definition, not two that drift.
    try:
        won = convex("market:winners", {"limit": 500}, kind="query") or []
        keep = {
            "adId", "adName", "client", "serviceLine", "city", "language",
            "format", "cta", "headline", "body", "transcript", "hook", "voice",
            "previewSrc", "thumbUrl", "playType", "interests", "copyTraits",
            "spend", "leads", "cpl", "wonFrom", "wonTo", "stillLive",
            "retiredOn",
        }
        rows = [
            {k: v for k, v in r.items() if k in keep and v is not None}
            for r in won
        ]
        if rows:
            res = convex("winners:store", {"rows": rows}, app=CREATIVE_APP)
            print(f"creative space winners: {len(rows)} rows -> {res}")
        else:
            print("creative space winners: none returned, skipped")
    except Exception as exc:  # noqa: BLE001
        print(f"creative space winners FAILED: {exc}")


async def main() -> None:
    # Drain his queued writes FIRST so the pull that follows already reflects
    # them, instead of showing a stale board for another 15 minutes.
    await drain_creative_outbox()
    payload = await gather()
    blob = json.dumps(payload, separators=(",", ":"))
    parts = [blob[i : i + CHUNK] for i in range(0, len(blob), CHUNK)]
    print(f"staging {len(blob):,} chars in {len(parts)} chunk(s)")

    convex("sync:stageClear")
    for i, part in enumerate(parts):
        convex("sync:stagePut", {"part": i, "data": part})

    convex("sync:storeOnboardings", {"rows": payload.get("onboardings", [])})
    # The creative boards go to the creative director's own Space, not here --
    # see push_creative_space below. [aziz, 2026-09-06]

    print("running sync…")
    result = convex("sync:runSync", {}, kind="action")
    print(result)

    # Surface the sync's own self-check. A cockpit that quietly loses a feature
    # is worse than one that is obviously broken, so a failed invariant is
    # printed loudly here and shown in the app. [aziz, 2026-09-06]
    try:
        run = convex("sync:lastRunHealth", {}, kind="query")
        if run and run.get("problems"):
            print("!! SYNC HEALTH PROBLEMS:")
            for p_ in run["problems"]:
                print(f"   - {p_}")
        elif run:
            h = run.get("health") or {}
            print(
                "sync health OK: "
                f"{h.get('adsWithCreative')}/{h.get('ads')} ad rows show a creative, "
                f"{h.get('treeWithPreview')}/{h.get('treeAds')} ads have a preview"
            )
    except Exception as exc:  # noqa: BLE001
        print(f"sync health check unavailable: {exc}")
    convex("sync:stageClear")
    print("done — staging cleared")

    try:
        payload["funnels"] = await gather_funnels()
    except Exception as exc:  # noqa: BLE001
        print(f"funnels gather FAILED (non-fatal): {exc}")

    await push_creative_space(payload)

    await drain_outbox()

    # Tracking audit runs against Meta directly, so it works regardless of the
    # tool endpoint. Cheap enough to refresh on every sync.
    try:
        audit = convex("tracking:audit", {}, kind="action")
        print(f"tracking: {audit['issues']} gaps across {audit['checked']} live ads")
    except Exception as exc:  # noqa: BLE001
        print(f"tracking audit failed (non-fatal): {exc}")


if __name__ == "__main__":
    asyncio.run(main())
