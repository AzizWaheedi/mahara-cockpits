"""Per-client profiles for the Client Success cockpit.

One profile = the numbers the client actually cares about (leads, appointments booked,
shows, closes, their revenue), the rows on their sheet that nobody updated, and every
link the CSM needs in one place: the client sheet, their asset drive, their GHL
sub-account, their Meta ad account, their ClickUp record.

Everything is read, never written. Sources:
  * the client's own performance sheet (Sheet Link on Clients - Mahara) — leads,
    appointments, shows, closes and the stale rows live here, not in GHL. The agency
    GHL token cannot read sub-account CRM data, so the sheet is the only truth.
  * GHL location search — to resolve the sub-account link by client name.
  * the cockpit's `campaigns` / `metaTree` tables — live campaigns, ad sets, ads and
    Meta's own preview iframes, already synced for the media buyer.

Imported by csm_app_bridge.py; run directly to inspect one client.
"""

from __future__ import annotations

import asyncio
import datetime
import json
import re
import sys
import unicodedata
from urllib.parse import quote

from sdk.tools.pd_google_sheets import pd_google_sheets_proxy_get
from sdk.tools.pd_highlevel_oauth import pd_highlevel_oauth_proxy_get

GHL_APP = "https://app.maharamedia.com"
META_ADS_MANAGER = "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act="

# Column layout of every client performance sheet's month tab. Fixed by the template,
# so read by position; the headers themselves are wrapped multi-line strings.
COL = {
    "name": 0,
    "added": 1,
    "appDate": 2,
    "phone": 3,
    "caller": 4,
    "confirmed": 5,
    "deposit": 6,
    "notes": 7,
    "type": 8,
    "show": 9,
    "quote": 10,
    "closed": 11,
    "csat": 12,
    "revenue": 13,
}
MONTH_TAB = "%b %y"  # "Sep 26"


async def _body(coro):
    """Unwrap a proxy response into its JSON body.

    The proxy sometimes appends prose after the JSON (for example a note that a second
    Google Sheets connection exists), which makes a plain `json.loads` raise "Extra data"
    and silently turned every client sheet into "unreadable". Decode the JSON prefix and
    ignore whatever follows it.
    """
    r = await coro
    c = r["content"] if isinstance(r, dict) and "content" in r else r
    if isinstance(c, str):
        text = c.strip()
        start = min(
            (i for i in (text.find("{"), text.find("[")) if i != -1),
            default=-1,
        )
        if start == -1:
            raise ValueError(f"no JSON in proxy response: {text[:120]}")
        c, _ = json.JSONDecoder().raw_decode(text[start:])
    if isinstance(c, dict) and "body" in c:
        c = c["body"]
    return c


def sheet_id(url: str | None) -> str | None:
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", url or "")
    return m.group(1) if m else None


def kuwait_today() -> datetime.date:
    return (
        datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=3)
    ).date()


def month_tabs(today: datetime.date) -> tuple[str, str]:
    """This month's tab name and last month's."""
    first = today.replace(day=1)
    prev = first - datetime.timedelta(days=1)
    return today.strftime(MONTH_TAB), prev.strftime(MONTH_TAB)


def _yes(cell: str | None) -> bool:
    return str(cell or "").strip().upper().startswith("Y")


def _no(cell: str | None) -> bool:
    return str(cell or "").strip().upper().startswith("N")


def _money(cell: str | None) -> float:
    try:
        return float(re.sub(r"[^0-9.\-]", "", str(cell or "")) or 0)
    except ValueError:
        return 0.0


def parse_added(cell: str | None, today: datetime.date) -> datetime.date | None:
    """Parse the "Date Added" column, which the team fills two different ways.

    Sheets-locale rows read `8/19/2026` (month/day/year); hand-typed rows read `28/06`
    (day/month, year implied). Both appear in the same tab. A day/month value that would
    land in the future belongs to last year.
    """
    text = str(cell or "").strip()
    if not text:
        return None
    parts = re.split(r"[/\-.]", text)
    try:
        nums = [int(p) for p in parts if p != ""]
    except ValueError:
        return None
    try:
        if len(nums) >= 3:
            a, b, c = nums[0], nums[1], nums[2]
            year = c if c > 99 else 2000 + c
            month, day = (a, b) if a <= 12 else (b, a)
            return datetime.date(year, month, day)
        if len(nums) == 2:
            day, month = nums
            if month > 12 and day <= 12:
                day, month = month, day
            d = datetime.date(today.year, month, day)
            return d.replace(year=today.year - 1) if d > today + datetime.timedelta(days=30) else d
    except ValueError:
        return None
    return None


def parse_appt(
    cell: str | None, today: datetime.date, added: datetime.date | None = None
) -> datetime.date | None:
    """Parse the appointment date column, which is the messiest column in the sheet.

    Three real shapes appear: `9/12/2026`, `12/9` and free text like `Wed 12 5:00 PM`,
    where only the day of the month is given. The free-text shape is anchored to the month
    the lead came in, rolling into the next month when the day already passed, because a
    call is always booked on or after the day the lead arrived. Anything unreadable returns
    None and is treated as an unknown date, never as a future one.
    """
    text = str(cell or "").strip()
    if not text:
        return None
    parts = re.split(r"[/\-.]", text)
    try:
        nums = [int(p) for p in parts if p.strip().isdigit()]
    except ValueError:
        nums = []
    try:
        dated = "/" in text or "-" in text
        if len(nums) >= 3 and dated:
            a, b, c = nums[0], nums[1], nums[2]
            if a > 99:  # year first, 2026-09-02
                return datetime.date(a, b, c)
            year = c if c > 99 else 2000 + c
            month, day = (a, b) if a <= 12 else (b, a)
            return datetime.date(year, month, day)
        if len(nums) == 2 and dated:
            day, month = nums
            if month > 12 and day <= 12:
                day, month = month, day
            d = datetime.date(today.year, month, day)
            # Only a date more than half a year ahead is really last year's.
            return (
                d.replace(year=today.year - 1)
                if d > today + datetime.timedelta(days=180)
                else d
            )
    except ValueError:
        return None
    # Free text: take the day of the month, anchored to when the lead came in.
    if added:
        day_nums = [int(m) for m in re.findall(r"\b(\d{1,2})\b", re.sub(r"\d{1,2}:\d{2}", " ", text))]
        for day in day_nums:
            if 1 <= day <= 31:
                for month_shift in (0, 1):
                    month = added.month + month_shift
                    year = added.year + (1 if month > 12 else 0)
                    month = month - 12 if month > 12 else month
                    try:
                        d = datetime.date(year, month, day)
                    except ValueError:
                        continue
                    if d >= added:
                        return d
                return None
    return None


BLANK_OK = re.compile(r"^\s*$")


def appointment_rows(rows: list[list[str]], today: datetime.date) -> list[dict]:
    """Normalise the Appointments log into one dict per lead."""
    out: list[dict] = []
    for r in rows:
        cell = lambda k: (str(r[COL[k]]) if len(r) > COL[k] else "")  # noqa: E731
        name = cell("name").strip()
        if not name or name.lower() == "name":
            continue
        added = parse_added(cell("added"), today)
        appt = parse_appt(cell("appDate"), today, added)
        out.append(
            {
                "name": name,
                "added": added.isoformat() if added else None,
                "month": added.strftime("%Y-%m") if added else None,
                "ageDays": (today - added).days if added else None,
                "appDate": cell("appDate").strip(),
                # Whether the appointment has actually happened yet. An outcome can only be
                # late once the date has passed, so nothing before that is chased.
                "appAt": (appt.isoformat() if appt else None),
                # None means the date could not be read, which is not the same as upcoming.
                "appPast": (None if appt is None else appt < today),
                "appDaysAgo": ((today - appt).days if appt else None),
                "caller": cell("caller").strip(),
                "confirmed": cell("confirmed").strip(),
                "deposit": cell("deposit").strip(),
                "type": cell("type").strip(),
                "show": cell("show").strip(),
                "quote": cell("quote").strip(),
                "closed": cell("closed").strip(),
                "csat": cell("csat").strip(),
                "ad": (str(r[14]) if len(r) > 14 else "").strip(),
                "source": (str(r[15]) if len(r) > 15 else "").strip(),
            }
        )
    return out


def summarise(rows: list[dict]) -> dict:
    """Counts for a set of appointment rows. Blank is blank — never guessed as a no."""
    booked = sum(1 for r in rows if r["appDate"])
    # Only an appointment whose date has passed can be missing an outcome. Upcoming ones
    # are simply not due yet.
    upcoming = sum(1 for r in rows if r["appDate"] and r["appPast"] is False)
    awaiting = sum(
        1
        for r in rows
        if r["appDate"]
        and r["appPast"] is not False
        and not str(r["show"]).strip()
        and not str(r["closed"]).strip()
    )
    shows = sum(1 for r in rows if _yes(r["show"]))
    noshows = sum(1 for r in rows if _no(r["show"]))
    closes = sum(1 for r in rows if _yes(r["closed"]))
    quotes = sum(1 for r in rows if _yes(r["quote"]))
    deposits = sum(1 for r in rows if _yes(r["deposit"]))
    scores = [_money(r["csat"]) for r in rows if _money(r["csat"])]
    decided = shows + noshows
    return {
        "leads": len(rows),
        "booked": booked,
        "shows": shows,
        "noshows": noshows,
        "quotes": quotes,
        "deposits": deposits,
        "closes": closes,
        "unknownOutcome": awaiting,
        "upcoming": upcoming,
        "showRate": round(100 * shows / decided) if decided else None,
        "closeRate": round(100 * closes / shows) if shows else None,
        "csat": round(sum(scores) / len(scores), 1) if scores else None,
    }


def stale_rows(rows: list[dict], min_age: int = 2) -> list[dict]:
    """Appointments the client never updated — the CSM's chase list.

    An unfilled row reads as a loss in every report we send, so these are worth money.
    The clock runs from the appointment date, not the day the lead came in, and only rows
    at least `min_age` days past it count. An upcoming appointment is never late.
    """
    out = []
    for r in rows:
        # Prefer the appointment date; when it is unreadable, fall back to the lead's age.
        age = r.get("appDaysAgo")
        if r.get("appPast") is False:
            continue
        if age is None:
            age = r["ageDays"]
        if not r["appDate"] or age is None or age < min_age:
            continue
        if not r["show"]:
            out.append({**r, "missing": "attended?"})
        elif _yes(r["show"]) and not r["closed"]:
            out.append({**r, "missing": "closed?"})
    return sorted(out, key=lambda r: -(r.get("appDaysAgo") or r["ageDays"] or 0))


def by_ad(rows: list[dict]) -> list[dict]:
    """Which ad each lead came from, and what that ad's leads actually did.

    This is how the team judges an ad on lead quality rather than lead volume: attendance
    and closes per ad, plus how many of that ad's appointments nobody has filled in (an ad
    can look bad purely because its rows were never updated).
    """
    seen: dict[str, dict] = {}
    for r in rows:
        key = r["ad"] or r["source"] or "not tagged"
        item = seen.setdefault(
            key,
            {
                "ad": key,
                "leads": 0,
                "booked": 0,
                "shows": 0,
                "noshows": 0,
                "closes": 0,
                "unknown": 0,
            },
        )
        item["leads"] += 1
        item["booked"] += 1 if r["appDate"] else 0
        item["noshows"] += 1 if _no(r["show"]) else 0
        item["shows"] += 1 if _yes(r["show"]) else 0
        item["closes"] += 1 if _yes(r["closed"]) else 0
        if (
            r["appPast"] is not False
            and not str(r["show"]).strip()
            and not str(r["closed"]).strip()
        ):
            item["unknown"] += 1
    out = []
    for a in seen.values():
        decided = a["leads"] - a["unknown"]
        a["bookRate"] = round(100 * a["booked"] / a["leads"]) if a["leads"] else None
        a["showRate"] = round(100 * a["shows"] / decided) if decided else None
        a["closeRate"] = round(100 * a["closes"] / a["shows"]) if a["shows"] else None
        out.append(a)
    return sorted(out, key=lambda a: (-a["closes"], -a["shows"], -a["leads"]))[:12]


async def sheet_performance(url: str | None, today: datetime.date | None = None) -> dict | None:
    """Read one client's performance sheet.

    The `Appointments` tab is the master log every caller actually fills; the month tabs
    are only partly used, so they are read as a fallback rather than a second truth.
    """
    sid = sheet_id(url)
    if not sid:
        return None
    today = today or kuwait_today()
    this_tab, last_tab = month_tabs(today)
    wanted = ["Appointments", this_tab, last_tab]
    qs = "&".join(f"ranges={quote(t + '!A1:P600')}" for t in wanted)
    raw: dict[str, list[list[str]]] = {}
    try:
        data = await _body(
            pd_google_sheets_proxy_get(
                url=(
                    f"https://sheets.googleapis.com/v4/spreadsheets/{sid}"
                    f"/values:batchGet?{qs}"
                )
            )
        )
    except Exception as exc:
        data = {"error": str(exc)[:200]}
    grids = data.get("valueRanges", []) if isinstance(data, dict) else []
    if grids:
        raw = {t: (g.get("values") or []) for t, g in zip(wanted, grids)}
    else:
        # Deliberately NOT falling back to the Drive reader here. Drive returns the tab as
        # a markdown table, which silently truncates around 50 rows and drops trailing
        # empty columns, so positional columns A to P no longer line up. Measured on Olivar
        # Design: 147 real rows came back as 51 rows and 7 columns. Half a client's history
        # read as the whole of it is worse than no read at all, so the failure is reported
        # and the previously stored numbers are kept instead.
        detail = ""
        if isinstance(data, dict):
            detail = str(data.get("error") or "")[:300]
        return {"sheetId": sid, "error": detail or "sheet unreadable"}

    rows = appointment_rows(raw.get("Appointments", []), today)
    source = "Appointments tab"
    if not rows:  # some sheets are only filled month by month
        rows = appointment_rows(
            raw.get(this_tab, []) + raw.get(last_tab, []), today
        )
        source = "month tabs"

    this_month = today.strftime("%Y-%m")
    first = today.replace(day=1)
    prev_month = (first - datetime.timedelta(days=1)).strftime("%Y-%m")
    return {
        "sheetId": sid,
        "source": source,
        "monthLabel": this_tab,
        "lastMonthLabel": last_tab,
        "month": summarise([r for r in rows if r["month"] == this_month]),
        "lastMonth": summarise([r for r in rows if r["month"] == prev_month]),
        "allTime": summarise(rows),
        "undated": sum(1 for r in rows if not r["month"]),
        "stale": stale_rows(rows)[:40],
        "staleCount": len(stale_rows(rows)),
        "byAd": by_ad([r for r in rows if r["month"] in (this_month, prev_month)]),
        # Since start, for the report a CSM sends when the current months are still empty.
        "byAdAllTime": by_ad(rows),
        # Every recent lead, so the team can see lead by lead which ad produced it.
        "recent": rows[-60:][::-1],
    }


async def ghl_locations() -> list[dict]:
    """All 94 sub-accounts. Agency token can read locations (and only locations)."""
    try:
        data = await _body(
            pd_highlevel_oauth_proxy_get(
                url="https://services.leadconnectorhq.com/locations/search",
                query_params={"limit": "200"},
                headers={"Version": "2021-07-28"},
            )
        )
    except Exception:
        return []
    return data.get("locations", []) if isinstance(data, dict) else []


def _norm(name: str) -> str:
    text = unicodedata.normalize("NFKD", str(name or "")).lower()
    text = re.sub(r"\b(company|co|llc|w\.l\.l|wll|group|designs?|design)\b", " ", text)
    return re.sub(r"[^a-z0-9\u0600-\u06ff]+", "", text)


def match_location(client: str, locations: list[dict]) -> dict | None:
    """Name-match a client to a GHL sub-account.

    Deliberately conservative: exact normalised match, then a containment match only
    when it is unambiguous. A wrong sub-account link is worse than no link — the CSM
    would open someone else's CRM and act on it.
    """
    target = _norm(client)
    if not target:
        return None
    exact = [l for l in locations if _norm(l.get("name")) == target]
    if len(exact) == 1:
        return exact[0]
    if exact:
        return exact[0]
    if len(target) >= 5:
        partial = [
            l
            for l in locations
            if target in _norm(l.get("name")) or _norm(l.get("name")) in target
        ]
        if len(partial) == 1:
            return partial[0]
    return None


def ads_for_client(client: str, campaigns: list[dict], tree: list[dict]) -> list[dict]:
    """The client's live campaigns with their ad sets and ads, from the cockpit sync."""
    target = _norm(client)
    mine = [
        c
        for c in campaigns
        if _norm(c.get("clientName") or "") == target
        or (target and target in _norm(c.get("accountName") or ""))
    ]
    out = []
    for c in sorted(mine, key=lambda c: -(c.get("spend7d") or 0)):
        nodes = [t for t in tree if t.get("campaignName") == c.get("campaignName")]
        adsets = [t for t in nodes if t.get("kind") == "adset"]
        ads = [t for t in nodes if t.get("kind") == "ad"]
        out.append(
            {
                "campaign": c.get("campaignName"),
                "account": c.get("accountName"),
                "accountId": c.get("metaAccountId"),
                "status": c.get("adStatus") or c.get("boardAdStatus"),
                "spend7d": c.get("spend7d"),
                "leads7d": c.get("leads7d"),
                "cpl": c.get("cpl"),
                "bookings7d": c.get("bookings7d"),
                "showed7d": c.get("showed7d"),
                "costPerBooking": c.get("costPerBooking"),
                "taskUrl": c.get("taskUrl"),
                "adsets": [
                    {
                        "name": a.get("name"),
                        "status": a.get("effectiveStatus") or a.get("status"),
                        "ads": [
                            {
                                "name": ad.get("name"),
                                "status": ad.get("effectiveStatus") or ad.get("status"),
                                "previewSrc": ad.get("previewSrc"),
                            }
                            for ad in ads
                            if ad.get("adsetId") == a.get("metaId")
                        ],
                    }
                    for a in adsets
                ],
            }
        )
    return out


LIVE = re.compile(r"active", re.I)


def live_counts(ads: list[dict]) -> dict:
    campaigns = sum(1 for c in ads if LIVE.search(str(c.get("status") or "")))
    adsets = sum(
        1
        for c in ads
        for a in c["adsets"]
        if LIVE.search(str(a.get("status") or ""))
    )
    creatives = sum(
        1
        for c in ads
        for a in c["adsets"]
        for ad in a["ads"]
        if LIVE.search(str(ad.get("status") or ""))
    )
    return {"campaigns": campaigns, "adsets": adsets, "ads": creatives}


def ads_access(ads: list[dict]) -> str:
    """Why the ad tree looks empty, so the screen never says "nothing live" about an
    account we simply cannot read. Only 3 of 12 client ad accounts are shared with Mahara's
    app, and a CSM told "nothing live" would go and panic a client who is running fine.
    """
    if not ads:
        return "no_campaigns"
    if not any(c.get("adsets") for c in ads):
        return "no_access"
    return "ok"


async def build_profiles(
    clients: list[dict],
    campaigns: list[dict],
    tree: list[dict],
    concurrency: int = 6,
) -> list[dict]:
    """One profile row per client, ready for `csmSync:storeProfiles`.

    `clients` rows come from the cockpit snapshot and must carry `name`, `taskId`,
    `taskUrl`, `sheetLink`, plus the optional `driveLink` / `profileText` extras.
    """
    locations = await ghl_locations()
    sem = asyncio.Semaphore(concurrency)

    async def one(c: dict) -> dict:
        async with sem:
            perf = await sheet_performance(c.get("sheetLink"))
        loc = match_location(c.get("name", ""), locations)
        ads = ads_for_client(c.get("name", ""), campaigns, tree)
        account_id = next((a["accountId"] for a in ads if a.get("accountId")), None)
        return {
            "clientName": c["name"],
            "taskId": c.get("taskId"),
            "links": {
                k: v
                for k, v in {
                    "clickup": c.get("taskUrl"),
                    "sheet": c.get("sheetLink"),
                    "drive": c.get("driveLink"),
                    "ghl": f"{GHL_APP}/v2/location/{loc['id']}/dashboard" if loc else None,
                    "adAccount": (
                        f"{META_ADS_MANAGER}{str(account_id).replace('act_', '')}"
                        if account_id
                        else None
                    ),
                    "contract": c.get("contractLink"),
                }.items()
                if v
            },
            "ghlName": loc.get("name") if loc else None,
            "stage": c.get("stage"),
            "happiness": c.get("happiness"),
            "launchDate": c.get("launchDate"),
            "liveDays": c.get("liveDays"),
            "service": c.get("service"),
            "adsPlatform": c.get("adsPlatform"),
            "profileText": c.get("profileText"),
            "performance": perf,
            "ads": ads,
            "live": live_counts(ads),
            "adsAccess": ads_access(ads),
            "syncedAt": int(datetime.datetime.now().timestamp() * 1000),
        }

    return list(await asyncio.gather(*(one(c) for c in clients)))


async def _demo(url: str) -> None:
    print(json.dumps(await sheet_performance(url), indent=2, ensure_ascii=False)[:3000])


if __name__ == "__main__":
    asyncio.run(_demo(sys.argv[1]))
