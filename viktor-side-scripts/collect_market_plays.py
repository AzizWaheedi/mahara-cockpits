#!/usr/bin/env python3
"""Mine every Mahara ad account into the GCC winning-data database.

What this is for
----------------
Every client currently starts from scratch. But across ~40 accounts in the same
niche and the same region we already know a great deal: which targeting shape
produces cheap leads for interior design in Riyadh, which one does not, and
where a play that works in one city has never been tried in another.

This walks every ad account, reads each ad set's TARGETING alongside its actual
SPEND AND LEADS, joins it to the client's city and service line, and stores one
row per ad set in the Space's `marketPlays` table. The cockpit then reads it as
a playbook.

It talks to Meta directly with the system-user token, so it does not depend on
the Viktor Spaces tool endpoint that is currently down.

Usage
-----
    uv run python skills/client_onboarding_launch/scripts/collect_market_plays.py
    uv run python .../collect_market_plays.py --days 180
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import requests

from sdk.tools.pd_google_sheets import pd_google_sheets_proxy_get
from sdk.tools.utils_tools import ai_structured_output

APP = Path("/work/viktor-spaces/cockpit-6d490e190930")
GRAPH = "https://graph.facebook.com/v21.0/"

# Client -> country / city / service line. Aziz filled the city column by hand.
LABELS = "10vGT2Jw43eCsSi5UfGY6O35_6pq-rjaEDi-fN86yZ-A"

# Aziz, 2026-09-05: the MaharaMedia account is his own lead gen, not a client.
SKIP_ACCOUNTS = {"MaharaMedia"}

# The service lines the cockpit's audience builder already speaks.
SERVICE_LINES = [
    "Interior design",
    "Fit-out and finishing",
    "Construction and contracting",
    "Architecture and engineering",
    "Landscaping and outdoor",
    "Kitchens and joinery",
    "Real estate and development",
    "Furniture and home retail",
    "Maintenance and renovation",
]


def meta_token() -> str:
    out = subprocess.run(
        ["bunx", "convex", "env", "get", "META_SYSTEM_TOKEN"],
        cwd=APP,
        capture_output=True,
        text=True,
        timeout=180,
    )
    token = out.stdout.strip()
    if not token:
        raise RuntimeError("META_SYSTEM_TOKEN not set on the deployment")
    return token


# Ads with at least this much spend get Meta's rendered preview fetched.
PREVIEW_MIN_SPEND = 100


def graph(path: str, token: str, **params: Any) -> dict:
    params["access_token"] = token
    url = GRAPH + path + "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=180) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(exc.read().decode()[:300]) from exc


def convex(fn: str, arg: dict, kind: str = "mutation") -> Any:
    env = (APP / ".env.local").read_text()
    key = re.search(r"^CONVEX_DEPLOY_KEY=(.+)$", env, re.M).group(1).strip()
    url = re.search(r"^VITE_CONVEX_URL=(.+)$", env, re.M).group(1).strip()
    res = requests.post(
        f"{url}/api/{kind}",
        json={"path": fn, "args": arg, "format": "json"},
        headers={"Authorization": f"Convex {key}"},
        timeout=600,
    )
    res.raise_for_status()
    body = res.json()
    if body.get("status") != "success":
        raise RuntimeError(f"{fn}: {str(body)[:400]}")
    return body.get("value")


def unwrap(raw: Any) -> Any:
    """Gateway responses sometimes carry prose after the JSON — see sync_cockpit."""
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


async def load_clients() -> list[dict]:
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{LABELS}/values/A1:Z200"
    res = unwrap(await pd_google_sheets_proxy_get(url=url))
    values = res.get("values", []) if isinstance(res, dict) else []
    if not values:
        raise RuntimeError("client label sheet came back empty — refusing to run")

    head = values[0]
    col = {name: i for i, name in enumerate(head)}

    def cell(row: list[str], name: str) -> str:
        for key in col:
            if key.strip().lower().startswith(name):
                idx = col[key]
                return row[idx].strip() if idx < len(row) else ""
        return ""

    out = []
    for row in values[1:]:
        client = cell(row, "client")
        acct = cell(row, "ad account")
        if not client or not acct or client in SKIP_ACCOUNTS:
            continue
        out.append(
            {
                "client": client,
                "accountId": acct,
                "country": cell(row, "country"),
                "city": cell(row, "city"),
                "serviceText": cell(row, "service"),
            }
        )
    return out


async def classify(clients: list[dict]) -> dict[str, str]:
    """Normalise free-text service descriptions into our nine service lines.

    The sheet's service column is sparse and inconsistent ("Construction
    sercvices", blank, long prose). Grouping only works on a controlled
    vocabulary, so classify once here rather than at query time.
    """
    listing = "\n".join(
        f"- {c['client']}: {c['serviceText'] or '(no description)'}" for c in clients
    )
    prompt = (
        "These are construction and design businesses in the Gulf that we run "
        "Meta lead generation for. Assign each to exactly one service line.\n\n"
        f"Allowed service lines: {', '.join(SERVICE_LINES)}\n\n"
        "If the description is blank, infer from the company name where it is "
        "reasonable (Arabic names included), otherwise use 'Unknown'.\n\n"
        f"{listing}"
    )
    schema = {
        "type": "object",
        "properties": {
            "assignments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "client": {"type": "string"},
                        "serviceLine": {"type": "string"},
                    },
                    "required": ["client", "serviceLine"],
                },
            }
        },
        "required": ["assignments"],
    }
    result = await ai_structured_output(
        prompt=prompt, output_schema=schema, intelligence_level="smart"
    )
    data = unwrap(result)
    # ai_structured_output returns {"result": {...}, "error": None}.
    if isinstance(data, dict) and "result" in data:
        if data.get("error"):
            raise RuntimeError(f"classification failed: {data['error']}")
        data = data["result"]
    if isinstance(data, str):
        data = json.JSONDecoder().raw_decode(data.lstrip())[0]
    mapping = {
        a["client"]: a["serviceLine"] for a in data.get("assignments", [])
    }
    # Without service lines every play collapses into one bucket and the
    # playbook is worthless. Fail loudly rather than storing 'Unknown' for all.
    if len(mapping) < len(clients) * 0.5:
        raise RuntimeError(
            f"only {len(mapping)}/{len(clients)} clients classified — refusing to store"
        )
    return mapping


# --- creative side of a play -------------------------------------------------

CTA_CLEAN = {
    "LEARN_MORE": "Learn more", "SIGN_UP": "Sign up", "GET_QUOTE": "Get quote",
    "CONTACT_US": "Contact us", "MESSAGE_PAGE": "Message", "WHATSAPP_MESSAGE": "WhatsApp",
    "BOOK_TRAVEL": "Book", "APPLY_NOW": "Apply now", "GET_OFFER": "Get offer",
    "DOWNLOAD": "Download", "SUBSCRIBE": "Subscribe",
}


def creative_format(spec: dict) -> str:
    """video | image | carousel | unknown, from the object_story_spec shape."""
    if not spec:
        return "unknown"
    if spec.get("video_data"):
        return "video"
    link = spec.get("link_data") or {}
    if link.get("child_attachments"):
        return "carousel"
    if link:
        return "image"
    return "unknown"


def copy_parts(spec: dict) -> tuple[str | None, str | None, str | None]:
    """(body, headline, cta) out of whichever data block the creative uses."""
    block = (spec or {}).get("video_data") or (spec or {}).get("link_data") or {}
    body = block.get("message")
    headline = block.get("title") or block.get("name")
    cta = ((block.get("call_to_action") or {}).get("type"))
    return body, headline, CTA_CLEAN.get(cta or "", cta)


AR_RANGE = range(0x0600, 0x0700)


def copy_traits(body: str | None, headline: str | None) -> tuple[list[str], str | None]:
    """
    Describe the copy rather than storing a wall of it.

    The database is for pattern-matching across clients, so what matters is the
    shape of the copy — does it open on a question, does it name a number, how
    long is it — not the exact sentences, which never transfer verbatim.
    """
    text = " ".join(x for x in (headline, body) if x).strip()
    if not text:
        return [], None
    traits: list[str] = []
    arabic = sum(1 for ch in text if ord(ch) in AR_RANGE)
    language = "ar" if arabic > len(text) * 0.2 else "en"
    if "?" in text or "\u061f" in text:
        traits.append("question hook")
    if re.search(r"\d", text):
        traits.append("names a number")
    if re.search(r"(%|\bfree\b|\bمجان)", text, re.I):
        traits.append("free or discount offer")
    if re.search(r"(\bnow\b|\btoday\b|\bالحين\b|\bاليوم\b)", text, re.I):
        traits.append("urgency")
    words = len(text.split())
    traits.append("short copy" if words < 25 else "long copy" if words > 70 else "medium copy")
    if len([ln for ln in text.splitlines() if ln.strip()]) >= 4:
        traits.append("list layout")
    return traits, language


def read_creatives(ads: list[dict]) -> dict:
    """Aggregate the creative dimensions of the ads inside one ad set."""
    out: list[dict] = []
    formats: set[str] = set()
    ctas: set[str] = set()
    traits: set[str] = set()
    langs: set[str] = set()
    for ad in ads:
        spec = ((ad.get("creative") or {}).get("object_story_spec")) or {}
        fmt = creative_format(spec)
        body, headline, cta = copy_parts(spec)
        t, lang = copy_traits(body, headline)
        video_id = (spec.get("video_data") or {}).get("video_id")
        cr = ad.get("creative") or {}
        thumb = (
            cr.get("image_url")
            or cr.get("thumbnail_url")
            or (spec.get("video_data") or {}).get("image_url")
            or (spec.get("link_data") or {}).get("picture")
        )
        ins = (ad.get("insights") or {}).get("data") or [{}]
        spend = float(ins[0].get("spend") or 0)
        leads = 0
        for action in ins[0].get("actions") or []:
            if "lead" in (action.get("action_type") or ""):
                leads = max(leads, int(float(action.get("value") or 0)))
        formats.add(fmt)
        if cta:
            ctas.add(cta)
        traits.update(t)
        if lang:
            langs.add(lang)
        out.append(
            {
                "adId": ad["id"],
                "adName": ad.get("name", ""),
                "format": fmt,
                "cta": cta,
                "videoId": video_id,
                "thumbUrl": thumb,
                "headline": (headline or "")[:120] or None,
                # Enough to recognise the angle, not a full transcript.
                "body": (body or "")[:300] or None,
                "spend": round(spend, 2),
                "leads": leads,
                "cpl": round(spend / leads, 2) if leads else None,
            }
        )
    return {
        "creatives": out,
        "formats": sorted(formats - {"unknown"}),
        "ctas": sorted(ctas),
        "copyTraits": sorted(traits),
        "language": (langs.pop() if len(langs) == 1 else "mixed") if langs else None,
    }


def read_play(adset: dict) -> dict:
    """Turn one ad set's targeting into a comparable 'play'."""
    t = adset.get("targeting") or {}
    interests = sorted(
        {
            i.get("name")
            for spec in (t.get("flexible_spec") or [])
            for i in (spec.get("interests") or [])
            if i.get("name")
        }
        | {i.get("name") for i in (t.get("interests") or []) if i.get("name")}
    )
    if t.get("custom_audiences"):
        play_type = "lookalike"
    elif interests:
        play_type = "interests"
    else:
        play_type = "broad"

    insights = (adset.get("insights") or {}).get("data") or [{}]
    spend = float(insights[0].get("spend") or 0)
    leads = 0
    for action in insights[0].get("actions") or []:
        if "lead" in (action.get("action_type") or ""):
            leads = max(leads, int(float(action.get("value") or 0)))

    return {
        "adsetId": adset["id"],
        "adsetName": adset.get("name", ""),
        "playType": play_type,
        "interests": interests,
        "ageMin": t.get("age_min"),
        "ageMax": t.get("age_max"),
        "optimizationGoal": adset.get("optimization_goal"),
        "spend": round(spend, 2),
        "leads": leads,
        "cpl": round(spend / leads, 2) if leads else None,
    }


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=90, help="lookback window")
    args = ap.parse_args()
    preset = {30: "last_30d", 90: "last_90d", 180: "last_90d"}.get(args.days, "last_90d")

    token = meta_token()
    clients = await load_clients()
    print(f"{len(clients)} client accounts from the label sheet")

    service_by_client = await classify(clients)
    print(f"classified {len(service_by_client)} service lines")

    rows: list[dict] = []
    skipped: list[str] = []
    for c in clients:
        # The creative expansion makes this request much heavier, and Meta
        # refuses it outright on accounts with a lot of history. Fall back to
        # targeting-only rather than losing the account entirely — half a play
        # is still a play. [meta, 2026-09-06]
        base = (
            "id,name,optimization_goal,"
            "targeting{flexible_spec,interests,custom_audiences,age_min,age_max},"
            f"insights.date_preset({preset})" + "{spend,actions}"
        )
        rich = (
            "id,name,optimization_goal,"
            "targeting{flexible_spec,interests,custom_audiences,age_min,age_max},"
            "ads.limit(25){id,name,creative{object_story_spec,thumbnail_url,image_url},"
            f"insights.date_preset({preset})" + "{spend,actions}},"
            f"insights.date_preset({preset})" + "{spend,actions}"
        )
        res = None
        for fields, limit, label in ((rich, 200, "full"), (rich, 50, "full/small"), (base, 200, "targeting only")):
            try:
                res = graph(f"act_{c['accountId']}/adsets", token, fields=fields, limit=limit)
                if label != "full":
                    print(f"  ({c['client'][:24]}: fell back to {label})")
                break
            except RuntimeError as exc:
                last = exc
        if res is None:
            skipped.append(f"{c['client']}: {str(last)[:80]}")
            continue

        for adset in res.get("data", []):
            play = read_play(adset)
            # No spend means no evidence. Storing it would dilute every average.
            if play["spend"] <= 0:
                continue
            creative = read_creatives((adset.get("ads") or {}).get("data") or [])
            rows.append(
                {
                    **play,
                    **creative,
                    "client": c["client"],
                    "accountId": c["accountId"],
                    "country": c["country"] or None,
                    "city": c["city"] or None,
                    "serviceLine": service_by_client.get(c["client"], "Unknown"),
                }
            )
        print(f"  {c['client'][:32]:34} {len(res.get('data', []))} ad sets")

    print(f"\n{len(rows)} ad sets with spend")
    if skipped:
        print(f"{len(skipped)} account(s) unreadable:")
        for s in skipped[:10]:
            print("  -", s)

    if not rows:
        raise RuntimeError("no plays collected — refusing to write")

    # Meta's rendered preview for the ads that qualify as winners, so the
    # database shows the ad itself and not just its description. Only for ads
    # with real spend behind them: one Graph call each, and the rest of the
    # library would triple the run for creatives nobody will open.
    # [aziz, 2026-09-07]
    wanted = [
        cr
        for r in rows
        for cr in (r.get("creatives") or [])
        if (cr.get("spend") or 0) >= PREVIEW_MIN_SPEND
    ]
    got = 0
    for cr in wanted:
        try:
            prev = graph(f"{cr['adId']}/previews", token, ad_format="MOBILE_FEED_STANDARD")
            body = ((prev.get("data") or [{}])[0]).get("body") or ""
            src = re.search(r'src="([^"]+)"', body)
            if src:
                cr["previewSrc"] = src.group(1).replace("&amp;", "&")
                got += 1
        except Exception:  # noqa: BLE001
            # A missing preview is cosmetic; the thumbnail still shows.
            pass
    print(f"previews: {got} of {len(wanted)} ads with $" f"{PREVIEW_MIN_SPEND}+ spend")

    # Convex optional fields reject an explicit null: omit them instead. This
    # has to recurse — the creatives array carries its own optional fields, and
    # a null buried one level down fails the whole batch.
    def strip_nulls(value):
        if isinstance(value, dict):
            return {k: strip_nulls(v) for k, v in value.items() if v is not None}
        if isinstance(value, list):
            return [strip_nulls(v) for v in value]
        return value

    rows = [strip_nulls(r) for r in rows]

    for i in range(0, len(rows), 200):
        out = convex(
            "market:store", {"rows": rows[i : i + 200], "windowDays": args.days}
        )
        print(f"  stored {out['written']}")

    # Winners are kept forever, even after the ad is switched off: this writes
    # them into `winnersArchive` with the window they won in. [aziz, 2026-09-07]
    arch = convex("market:archiveWinners", {})
    print(
        f"  winners archive: {arch['archived']} kept "
        f"({arch['added']} new, {arch['retired']} newly off)"
    )

    dims = convex("market:dimensions", {}, kind="query")
    print(
        f"database now: {dims['plays']} plays, {dims['clients']} clients, "
        f"{len(dims['serviceLines'])} service lines, {len(dims['cities'])} cities"
    )


if __name__ == "__main__":
    asyncio.run(main())
