"""Build the live Meta tree (ad sets, ads, creative previews) for every client campaign.

Why this exists: the cockpit builds the same tree inside Convex, but in-app integration
calls currently fail at the gateway, so only the handful of URLs the bridge pre-fetches
ever resolved. The result was one account with previews and thirteen without, which reads
to the CSM as "the previews are broken".

Here the calls run from Viktor's side, where the Meta tools work, so every account gets
its ad sets, its ads and Meta's own preview iframe. Output shape matches the cockpit's
`metaTree` rows exactly, so `ads_for_client()` can consume either source.
"""

from __future__ import annotations

import asyncio
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from sdk.tools.mcp_meta_ads import (
    meta_ads_get_ad_previews,
    meta_ads_list_ad_sets,
    meta_ads_list_ads,
)

GRAPH = "https://graph.facebook.com/v21.0"

TOKEN_FILE = Path(__file__).resolve().parents[1] / ".env"
"""Aziz's own Meta user token. The connected app account can only read 3 of 12 client ad
accounts; his token reads all 34. Never print it, never put it in a snapshot."""


def user_token() -> str | None:
    try:
        for line in TOKEN_FILE.read_text().splitlines():
            if line.startswith("META_USER_TOKEN="):
                return line.split("=", 1)[1].strip() or None
    except OSError:
        return None
    return None


def graph(path: str, **params: Any) -> dict:
    """One Graph read with the user token. Errors come back as data, never as a crash."""
    token = user_token()
    if not token:
        return {}
    params["access_token"] = token
    url = f"{GRAPH}/{path}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=40) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        body = exc.read()[:200].decode("utf8", "ignore")
        return {"error": {"message": body, "status": exc.code}}
    except Exception as exc:
        return {"error": {"message": f"{type(exc).__name__} {exc}"}}


PREVIEW_FORMAT = "MOBILE_FEED_STANDARD"
"""Mobile feed: what a construction or design firm owner actually sees on their phone."""

MAX_PREVIEWS_PER_CAMPAIGN = 6
"""A preview call per ad is the slow part. Six covers a real campaign without stalling."""


def _payload(result: Any) -> dict:
    """Unwrap an MCP tool result into JSON, tolerating plain-text errors."""
    if isinstance(result, dict):
        content = result.get("content", result)
    else:
        content = result
    if isinstance(content, (dict, list)):
        return {"data": content} if isinstance(content, list) else content
    text = str(content or "").strip()
    if not text.startswith(("{", "[")):
        return {}
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return {"data": parsed} if isinstance(parsed, list) else parsed


def _iframe(preview: Any) -> str | None:
    """Pull the src out of Meta's preview iframe HTML."""
    body = _payload(preview)
    rows = body.get("data") or []
    for row in rows if isinstance(rows, list) else []:
        html = str(row.get("body") or "")
        found = re.search(r'src="([^"]+)"', html)
        if found:
            return found.group(1).replace("&amp;", "&")
    return None


async def tree_for_campaign(account_id: str, campaign_id: str, campaign_name: str) -> list[dict]:
    """One campaign's ad sets and ads, with previews, in cockpit `metaTree` shape."""
    act = account_id if str(account_id).startswith("act_") else f"act_{account_id}"
    rows: list[dict] = []
    if user_token():
        rows = await asyncio.to_thread(_graph_tree, act, campaign_id, campaign_name)
        if rows:
            return rows
    try:
        sets = _payload(await meta_ads_list_ad_sets(ad_account_id=act, campaign_id=campaign_id))
        ads = _payload(await meta_ads_list_ads(ad_account_id=act, campaign_id=campaign_id))
    except Exception as exc:  # a dead account should not kill the whole run
        print(f"  ! {campaign_name}: {type(exc).__name__} {exc}")
        return rows

    for s in sets.get("data") or []:
        rows.append(
            {
                "campaignName": campaign_name,
                "kind": "adset",
                "metaId": str(s.get("id")),
                "name": str(s.get("name") or ""),
                "status": str(s.get("status") or ""),
                "effectiveStatus": s.get("effective_status"),
                "dailyBudget": (
                    round(float(s["daily_budget"]) / 100, 2) if s.get("daily_budget") else None
                ),
            }
        )

    ad_rows = list(ads.get("data") or [])
    previews: dict[str, str | None] = {}
    for ad in ad_rows[:MAX_PREVIEWS_PER_CAMPAIGN]:
        try:
            previews[str(ad.get("id"))] = _iframe(
                await meta_ads_get_ad_previews(ad_id=str(ad.get("id")), ad_format=PREVIEW_FORMAT)
            )
        except Exception:
            previews[str(ad.get("id"))] = None

    for ad in ad_rows:
        rows.append(
            {
                "campaignName": campaign_name,
                "kind": "ad",
                "metaId": str(ad.get("id")),
                "adsetId": str(ad.get("adset_id") or ""),
                "name": str(ad.get("name") or ""),
                "status": str(ad.get("status") or ""),
                "effectiveStatus": ad.get("effective_status"),
                "previewSrc": previews.get(str(ad.get("id"))),
            }
        )
    return rows


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9\u0600-\u06ff]+", "", str(name or "").lower())


_ACCOUNTS: list[dict] | None = None


def accounts() -> list[dict]:
    """Every ad account the token can read, cached for the run."""
    global _ACCOUNTS
    if _ACCOUNTS is None:
        body = graph("me/adaccounts", fields="account_id,name,account_status", limit=200)
        _ACCOUNTS = list(body.get("data") or [])
    return _ACCOUNTS


def account_for_client(client: str) -> dict | None:
    """Match a client to their ad account by name. Exact first, then a contains match, and
    only when it is unambiguous: showing one client another client's ads would be worse
    than showing none."""
    target = _norm(client)
    if len(target) < 4:
        return None
    rows = accounts()
    exact = [a for a in rows if _norm(a.get("name")) == target]
    if exact:
        return exact[0]
    partial = [
        a
        for a in rows
        if target in _norm(a.get("name")) or _norm(a.get("name")) in target
    ]
    return partial[0] if len(partial) == 1 else None


def discover_campaigns(clients: list[str], known: list[dict]) -> list[dict]:
    """Campaigns read straight from Meta for clients the ads board never covered.

    The board only carries campaigns a media buyer added by hand, so a client whose account
    the app could not read showed up as "not linked" even while they were spending. Shape
    matches `campaignsForCsm` so `ads_for_client()` consumes it unchanged.
    """
    if not user_token():
        return []
    covered = {_norm(c.get("clientName") or "") for c in known}
    covered |= {_norm(c.get("accountName") or "") for c in known}
    out: list[dict] = []
    for client in clients:
        if _norm(client) in covered:
            continue
        acct = account_for_client(client)
        if not acct:
            continue
        body = graph(
            f"act_{acct['account_id']}/campaigns",
            fields="id,name,status,effective_status",
            effective_status='["ACTIVE","PAUSED"]',
            limit=50,
        )
        for c in body.get("data") or []:
            out.append(
                {
                    "clientName": client,
                    "campaignName": c.get("name"),
                    "accountName": acct.get("name"),
                    "metaAccountId": acct.get("account_id"),
                    "metaCampaignId": c.get("id"),
                    "adStatus": c.get("effective_status") or c.get("status"),
                }
            )
    return out


def _graph_tree(act: str, campaign_id: str, campaign_name: str) -> list[dict]:
    """The same tree read with Aziz's user token, which reaches every client account."""
    rows: list[dict] = []
    sets = graph(
        f"{campaign_id}/adsets",
        fields="id,name,status,effective_status,daily_budget",
        limit=100,
    )
    for s in sets.get("data") or []:
        rows.append(
            {
                "campaignName": campaign_name,
                "kind": "adset",
                "metaId": str(s.get("id")),
                "name": str(s.get("name") or ""),
                "status": str(s.get("status") or ""),
                "effectiveStatus": s.get("effective_status"),
                "dailyBudget": (
                    round(float(s["daily_budget"]) / 100, 2) if s.get("daily_budget") else None
                ),
            }
        )
    ads = graph(
        f"{campaign_id}/ads",
        fields="id,name,status,effective_status,adset_id",
        limit=100,
    )
    ad_rows = list(ads.get("data") or [])
    for ad in ad_rows:
        preview = None
        if len([r for r in rows if r["kind"] == "ad"]) < MAX_PREVIEWS_PER_CAMPAIGN:
            body = graph(f"{ad['id']}/previews", ad_format=PREVIEW_FORMAT)
            preview = _iframe(body)
        rows.append(
            {
                "campaignName": campaign_name,
                "kind": "ad",
                "metaId": str(ad.get("id")),
                "adsetId": str(ad.get("adset_id") or ""),
                "name": str(ad.get("name") or ""),
                "status": str(ad.get("status") or ""),
                "effectiveStatus": ad.get("effective_status"),
                "previewSrc": preview,
            }
        )
    return rows


async def build_tree(campaigns: list[dict], existing: list[dict] | None = None) -> list[dict]:
    """The tree for every campaign that has both a Meta account and a Meta campaign id.

    Campaigns the cockpit already covered are kept as they are, so a working preview is
    never replaced by a fresh call that might fail.
    """
    covered = {row.get("campaignName") for row in (existing or [])}
    out = list(existing or [])
    for c in campaigns:
        name = c.get("campaignName")
        account = c.get("metaAccountId")
        campaign_id = c.get("metaCampaignId")
        if not name or not account or not campaign_id or name in covered:
            continue
        rows = await tree_for_campaign(str(account), str(campaign_id), str(name))
        ads = sum(1 for r in rows if r["kind"] == "ad")
        shots = sum(1 for r in rows if r.get("previewSrc"))
        print(f"  {name}: {ads} ads, {shots} previews")
        out.extend(rows)
    return out


async def main() -> None:
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).parent))
    from csm_app_bridge import COCKPIT, convex  # noqa: PLC0415

    campaigns = convex(COCKPIT, "csmSync:campaignsForCsm", {}) or []
    tree = await build_tree(campaigns, convex(COCKPIT, "csmSync:metaTreeForCsm", {}) or [])
    print(
        f"tree rows: {len(tree)} · "
        f"ads {sum(1 for r in tree if r['kind'] == 'ad')} · "
        f"previews {sum(1 for r in tree if r.get('previewSrc'))}"
    )


if __name__ == "__main__":
    asyncio.run(main())


def month_spend(client: str, since: str, until: str) -> dict:
    """Ad spend and leads for one client's account between two YYYY-MM-DD dates.

    Account level, not per ad: the sheet tags leads as "ad-5" while Meta names them
    something else entirely, so a per ad spend join would be a guess. Account totals are
    true, which is what a client report needs.
    """
    account = account_for_client(client)
    if not account:
        return {}
    body = graph(
        f"act_{account['account_id']}/insights",
        fields="spend,impressions,actions",
        time_range=json.dumps({"since": since, "until": until}),
        level="account",
    )
    rows = body.get("data") or []
    if not rows:
        return {"account": account.get("name")}
    row = rows[0]
    leads = 0
    for action in row.get("actions") or []:
        if str(action.get("action_type", "")).endswith("lead") or "lead" in str(
            action.get("action_type", "")
        ):
            leads = max(leads, int(float(action.get("value") or 0)))
    spend = round(float(row.get("spend") or 0), 2)
    return {
        "account": account.get("name"),
        "spend": spend,
        "leads": leads,
        "cpl": round(spend / leads, 2) if leads else None,
    }
