"""Read a client's lost leads, with the reason and the notes, from their own GHL sub-account.

Why this exists: the CSM's hardest conversation is "your leads are bad". The answer lives in
the client's own Lost Leads pipeline, where the **stage name is the reason** (Financial
Issue, Unreachable, Client Had Unrealistic Expectations, and so on) and the free text sits
in the contact's notes. Pull both and the CSM walks into the call with the diagnosis instead
of an opinion.

Auth: the agency-class connection can read locations only, so every call here uses the
client's own **Private Integration token** from the DATABASE - MAHARA sheet, tab
`Client Data`, column E. 38 of 59 rows carry one [gsheets, 2026-09-05].
"""

from __future__ import annotations

import asyncio
import re
from urllib.parse import quote

import httpx

from sdk.tools.pd_google_sheets import pd_google_sheets_proxy_get

LC = "https://services.leadconnectorhq.com"
DATABASE_SHEET = "1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0"
CLIENT_DATA_TAB = "Client Data"

MAX_LOST = 40
"""Enough to see the pattern in a month without turning the card into a phone book."""

NOTE_NOISE = re.compile(r"knowledge base link|form answers|applied before|^https?://|^\s*$", re.I)
"""Automation drops boilerplate notes on contacts. They are not a lost reason."""

MAX_NOTES = 15
"""Notes cost one call per contact, so fetch them for the newest leads only."""

_ACCOUNTS: dict[str, dict] | None = None


def _norm(name: str) -> str:
    """Match ClickUp names to sheet names despite emoji, case and spacing drift."""
    return re.sub(r"[^a-z0-9\u0600-\u06ff]+", "", str(name or "").lower())


async def _sheet_values(tab: str, rng: str) -> list[list[str]]:
    from csm_client_profiles import _body  # noqa: PLC0415  (shared JSON-prefix decoder)

    data = await _body(
        pd_google_sheets_proxy_get(
            url=(
                f"https://sheets.googleapis.com/v4/spreadsheets/{DATABASE_SHEET}"
                f"/values/{quote(tab + '!' + rng)}"
            )
        )
    )
    return data.get("values", []) if isinstance(data, dict) else []


async def accounts() -> dict[str, dict]:
    """`{normalised client name: {name, clickupId, locationId, token}}`, cached per run."""
    global _ACCOUNTS  # noqa: PLW0603
    if _ACCOUNTS is not None:
        return _ACCOUNTS
    rows = await _sheet_values(CLIENT_DATA_TAB, "A1:E200")
    out: dict[str, dict] = {}
    for row in rows[1:]:
        cells = list(row) + [""] * (5 - len(row))
        name, clickup_id, location_id, token = cells[1], cells[2], cells[3], cells[4]
        if not name or not token.startswith("pit-") or not location_id:
            continue
        entry = {
            "name": name,
            "clickupId": clickup_id,
            "locationId": location_id,
            "token": token,
        }
        out[_norm(name)] = entry
        if clickup_id:
            out[f"id:{clickup_id}"] = entry
    _ACCOUNTS = out
    return out


def account_for(client_name: str, task_id: str | None = None) -> dict | None:
    """Prefer the ClickUp id, because client names drift between the two systems."""
    if _ACCOUNTS is None:
        return None
    if task_id and f"id:{task_id}" in _ACCOUNTS:
        return _ACCOUNTS[f"id:{task_id}"]
    key = _norm(client_name)
    if key in _ACCOUNTS:
        return _ACCOUNTS[key]
    for k, v in _ACCOUNTS.items():
        if k.startswith("id:"):
            continue
        if key and (key in k or k in key):
            return v
    return None


async def _get(client: httpx.AsyncClient, token: str, path: str, params: dict) -> dict:
    resp = await client.get(
        f"{LC}/{path}",
        headers={"Authorization": f"Bearer {token}", "Version": "2021-07-28"},
        params=params,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"{path} {resp.status_code}: {resp.text[:160]}")
    return resp.json()


def _ad_of(opp: dict) -> str:
    """Which ad produced this lead, so a pattern of bad leads can be traced to a creative."""
    for att in opp.get("attributions") or []:
        for key in ("utmContent", "utmTerm", "utmCampaign", "adSource"):
            if att.get(key):
                return str(att[key])
    return ""


async def lost_leads(entry: dict) -> dict:
    """Recent lost leads for one sub-account, grouped by reason.

    Returns `{reasons: [{reason, count}], leads: [...], total, pipeline}`. The stage name is
    the reason: that is how Mahara's snapshot is built, there is no separate reason field the
    private token may read (`pipelines/lost-reasons` is out of scope).
    """
    token, location = entry["token"], entry["locationId"]
    async with httpx.AsyncClient(timeout=60) as client:
        pipelines = (
            await _get(client, token, "opportunities/pipelines", {"locationId": location})
        ).get("pipelines", [])
        target = next(
            (
                p
                for p in pipelines
                if "lost" in str(p.get("name", "")).lower()
                and "old" not in str(p.get("name", "")).lower()
            ),
            None,
        )
        if not target:
            return {"reasons": [], "leads": [], "total": 0, "pipeline": ""}
        stage_names = {s["id"]: s.get("name", "") for s in target.get("stages", [])}
        found = await _get(
            client,
            token,
            "opportunities/search",
            {
                "location_id": location,
                "pipeline_id": target["id"],
                "limit": str(MAX_LOST),
            },
        )
        # The API refuses a sort parameter, so order newest first here.
        opps = sorted(
            found.get("opportunities", []) or [],
            key=lambda o: str(o.get("lastStageChangeAt") or o.get("updatedAt") or ""),
            reverse=True,
        )

        leads: list[dict] = []
        for i, opp in enumerate(opps):
            contact = opp.get("contact") or {}
            note = ""
            if i < MAX_NOTES and contact.get("id"):
                try:
                    notes = (
                        await _get(client, token, f"contacts/{contact['id']}/notes", {})
                    ).get("notes", [])
                    real = [
                        str(n.get("bodyText") or "").strip()
                        for n in notes
                        if not NOTE_NOISE.search(str(n.get("bodyText") or "").strip())
                    ]
                    note = " · ".join(real[:2])[:220]
                except Exception:
                    note = ""
            leads.append(
                {
                    "name": opp.get("name") or contact.get("name") or "Unnamed",
                    "phone": contact.get("phone") or "",
                    "reason": stage_names.get(opp.get("pipelineStageId"), "Not set"),
                    "note": note,
                    "ad": _ad_of(opp),
                    "source": opp.get("source") or "",
                    "movedAt": (opp.get("lastStageChangeAt") or "")[:10],
                }
            )

    counts: dict[str, int] = {}
    for lead in leads:
        counts[lead["reason"]] = counts.get(lead["reason"], 0) + 1
    return {
        "pipeline": target.get("name", ""),
        "total": (found.get("meta") or {}).get("total") or len(leads),
        "reasons": [
            {"reason": r, "count": c}
            for r, c in sorted(counts.items(), key=lambda kv: -kv[1])
        ],
        "leads": leads,
    }


async def lost_for(client_name: str, task_id: str | None = None) -> dict | None:
    """Lost leads for a client by name, or None when the sheet has no token for them."""
    await accounts()
    entry = account_for(client_name, task_id)
    if not entry:
        return None
    try:
        return await lost_leads(entry)
    except Exception as exc:
        return {"error": str(exc)[:200], "reasons": [], "leads": [], "total": 0}


if __name__ == "__main__":

    async def _main() -> None:
        import sys

        await accounts()
        name = sys.argv[1] if len(sys.argv) > 1 else "Joe and Sera Company"
        data = await lost_for(name)
        if not data:
            print(f"no GHL token on the DATABASE sheet for {name}")
            return
        if data.get("error"):
            print("error:", data["error"])
            return
        print(f"{name}: {data['total']} in {data['pipeline']}")
        for r in data["reasons"]:
            print(f"  {r['count']:>3}  {r['reason']}")
        for lead in data["leads"][:6]:
            print(f"  - {lead['name']} | {lead['reason']} | {lead['ad']} | {lead['note'][:60]}")

    asyncio.run(_main())
