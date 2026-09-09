"""Reconstruct monthly churn for the year from ClickUp, so the number is not blank.

Aziz asked for a churn process he does not have to maintain. Going forward the app measures it
exactly, from the daily roster of paying clients. The problem is the past: his Churn Tracker
sheet has January filled, August half filled and nothing else, so a month over month view built
on it would be mostly empty cells reading as 0.00%.

This rebuilds the history from the Clients board itself:
  * a client counts as paying from the month their ClickUp record was created,
  * a churned client stops counting from the month their record last changed,
  * churn in a month = clients lost that month / clients paying at the start of it.

The churn month for a lost client is approximate, because ClickUp gives the last update, not
the moment the status changed. Every reconstructed row is labelled as such, and September
onwards comes from the roster, which is exact. Approximate and labelled beats blank.
"""

from __future__ import annotations

import datetime
import re
import sys

sys.path.insert(0, "/work/skills/csm_daily_workflow/scripts")

CHURNED = re.compile(r"stop|cancel|churn|offboard|refund|terminat", re.I)
NOT_A_CLIENT = re.compile(r"lead|prospect|proposal|lost", re.I)
YEAR = 2026


def _month(ms: int | str | None) -> str | None:
    """The YYYY-MM a ClickUp millisecond timestamp falls in, Kuwait time."""
    if not ms:
        return None
    try:
        t = int(ms)
    except (TypeError, ValueError):
        return None
    d = datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc) + datetime.timedelta(
        hours=3
    )
    return d.strftime("%Y-%m")


CLIENT_STATUS_FIELD = "9368ca9e-3549-4320-84ff-9abd0a2901cb"


def _client_status(task: dict) -> str:
    """The Client Status dropdown, which is the real lifecycle, not the ClickUp task status."""
    for f in task.get("custom_fields") or []:
        if f.get("id") != CLIENT_STATUS_FIELD:
            continue
        value = f.get("value")
        options = ((f.get("type_config") or {}).get("options")) or []
        if isinstance(value, int) and value < len(options):
            return str(options[value].get("name") or "")
        for o in options:
            if o.get("id") == value or o.get("orderindex") == value:
                return str(o.get("name") or "")
    return str(((task.get("status") or {}) or {}).get("status") or "")


async def client_tasks() -> list[dict]:
    """Every row on Clients - Mahara, closed ones included."""
    from csm_app_bridge import CLIENTS_LIST, _body  # noqa: PLC0415
    from sdk.tools.pd_clickup import pd_clickup_proxy_get  # noqa: PLC0415

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
    return tasks


def series(tasks: list[dict]) -> list[dict]:
    """One row per month of this year, up to now: at start, lost, churn percent."""
    people = []
    for t in tasks:
        status = _client_status(t)
        if NOT_A_CLIENT.search(status):
            continue
        joined = _month(t.get("date_created"))
        if not joined:
            continue
        lost = None
        if CHURNED.search(status):
            lost = _month(t.get("date_closed") or t.get("date_updated"))
        people.append({"joined": joined, "lost": lost})

    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3)))
    out: list[dict] = []
    for m in range(1, now.month + 1):
        key = f"{YEAR}-{m:02d}"
        at_start = sum(
            1
            for p in people
            if p["joined"] < key and (p["lost"] is None or p["lost"] >= key)
        )
        lost = sum(1 for p in people if p["lost"] == key)
        out.append(
            {
                "month": key,
                "atStart": at_start,
                "lost": lost,
                "churn": round(lost * 100 / at_start, 2) if at_start else None,
            }
        )
    return out


def kpi_rows(rows: list[dict]) -> list[dict]:
    """The reconstructed history as kpi rows the churn tab can chart."""
    return [
        {
            "key": f"churn_hist_{r['month']}",
            "label": f"Churn {r['month']}",
            "value": f"{r['churn']:.2f}%" if r["churn"] is not None else None,
            "numeric": r["churn"],
            "month": r["month"],
            "source": "reconstructed from ClickUp record dates, approximate",
            "note": (
                f"{r['lost']} of {r['atStart']} paying clients lost. The month a client was "
                "lost is taken from when their ClickUp record last changed, so treat it as "
                "close, not exact. From September the number comes from the daily roster "
                "and is exact."
            ),
        }
        for r in rows
        if r["atStart"]
    ]


async def main() -> None:
    tasks = await client_tasks()
    rows = series(tasks)
    for r in rows:
        print(r)
    print(f"{len(kpi_rows(rows))} months publishable")


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
