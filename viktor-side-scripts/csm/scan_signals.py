"""Collect yesterday's client-facing signal for the CSM daily brief.

Prints a compact digest, never a verdict: WhatsApp group traffic since the last
working day, plus Fathom calls in the same window. The reading agent classifies
it into upsell openings, churn risk, calls that happened, and loose tasks.

Usage:
    uv run python skills/csm_daily_workflow/scripts/scan_signals.py [--hours 24]
"""

import asyncio
import datetime as dt
import os
import sys
import zoneinfo

import httpx

TZ = zoneinfo.ZoneInfo("Asia/Kuwait")
WHAPI_ENV = "/work/skills/integrations/whapi/.env"
# The primary .env is chmod 600 and owned by another UID; every cron run gets a new UID,
# so this readable cache is the working credential source.
WHAPI_ENV_CACHE = "/work/crons/client-success/daily-wa-monitor/scripts/.env_cache"
FATHOM_ENV = "/work/skills/integrations/fathom/.env"
MAX_MSG = 60          # per group, newest first
BODY_CHARS = 300      # truncate long messages


def load_dotenv(path: str) -> None:
    """Minimal .env reader: python-dotenv is not installable in this sandbox."""
    try:
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except (FileNotFoundError, PermissionError):
        pass


def window_hours(default: int = 24) -> int:
    """Saturday looks back across Friday, so the window stretches to cover it."""
    if "--hours" in sys.argv:
        return int(sys.argv[sys.argv.index("--hours") + 1])
    today = dt.datetime.now(TZ)
    return 48 if today.weekday() == 5 else default


async def whatsapp(hours: int) -> list[dict]:
    load_dotenv(WHAPI_ENV)
    load_dotenv(WHAPI_ENV_CACHE)
    base, token = os.getenv("WHAPI_BASE_URL"), os.getenv("WHAPI_TOKEN")
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30) as c:
        h = await c.get(f"{base}/health", headers=headers)
        code = (h.json().get("status") or {}).get("code")
        text = (h.json().get("status") or {}).get("text")
        if code != 0:
            return [{"group": "SESSION", "error": f"WHAPI session not connected: code {code} ({text}). "
                     "Needs a QR re-scan on the Mahara WhatsApp number.", "messages": []}]
    cutoff = dt.datetime.now(TZ) - dt.timedelta(hours=hours)
    out = []
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.get(f"{base}/groups?count=100", headers=headers)
        r.raise_for_status()
        groups = r.json().get("groups", [])
        for g in groups:
            gid, name = g.get("id"), g.get("name", "unnamed")
            try:
                m = await c.get(f"{base}/messages/list/{gid}?count={MAX_MSG}", headers=headers)
                m.raise_for_status()
                msgs = m.json().get("messages", [])
            except httpx.HTTPError as exc:
                out.append({"group": name, "error": str(exc), "messages": []})
                continue
            recent = []
            for msg in msgs:
                ts = dt.datetime.fromtimestamp(int(msg.get("timestamp", 0)), TZ)
                if ts < cutoff:
                    continue
                body = (msg.get("text") or {}).get("body") or f"[{msg.get('type', 'media')}]"
                recent.append({
                    "at": ts.strftime("%a %H:%M"),
                    "who": "MAHARA" if msg.get("from_me") else (msg.get("from_name") or msg.get("from")),
                    "text": body[:BODY_CHARS].replace("\n", " "),
                })
            recent.reverse()
            last_ts = max((int(m.get("timestamp", 0)) for m in msgs), default=0)
            out.append({
                "group": name,
                "messages": recent,
                "silent_days": (dt.datetime.now(TZ) - dt.datetime.fromtimestamp(last_ts, TZ)).days
                if last_ts else None,
                "last_from_mahara": bool(msgs and msgs[0].get("from_me")),
            })
    return out


async def fathom(hours: int) -> list[dict]:
    load_dotenv(FATHOM_ENV)
    key = os.getenv("FATHOM_API_KEY") or os.getenv("FATHOM_KEY")
    cutoff = dt.datetime.now(dt.UTC) - dt.timedelta(hours=hours)
    out = []
    async with httpx.AsyncClient(timeout=90) as c:
        r = await c.get(
            "https://api.fathom.ai/external/v1/meetings",
            headers={"X-Api-Key": key},
            params={"created_after": cutoff.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "include_summary": "true"},
        )
        r.raise_for_status()
        for m in r.json().get("items", []):
            summary = m.get("default_summary") or {}
            out.append({
                "title": m.get("title"),
                "at": m.get("scheduled_start_time") or m.get("created_at"),
                "host": (m.get("recorded_by") or {}).get("name"),
                "external": [i.get("name") for i in (m.get("calendar_invitees") or [])
                             if i.get("is_external")],
                "url": m.get("url") or m.get("share_url"),
                "summary": (summary.get("markdown_formatted") or "")[:1500],
            })
    return out


async def main() -> None:
    hours = window_hours()
    wa, fa = await asyncio.gather(whatsapp(hours), fathom(hours), return_exceptions=True)
    print(f"WINDOW: last {hours}h, generated {dt.datetime.now(TZ):%a %d %b %H:%M} Kuwait")

    print("\n===== WHATSAPP GROUPS =====")
    if isinstance(wa, BaseException):
        print(f"ERROR: {wa}")
    else:
        errors = [g for g in wa if g.get("error")]
        for g in errors:
            print(f"!! {g['group']}: {g['error']}")
        wa = [g for g in wa if not g.get("error")]
        active = [g for g in wa if g.get("messages")]
        print(f"{len(wa)} groups, {len(active)} with traffic in window\n")
        for g in active:
            print(f"--- {g['group']} ({len(g['messages'])} msgs)")
            for m in g["messages"]:
                print(f"    [{m['at']}] {m['who']}: {m['text']}")
        quiet = [g for g in wa if not g.get("messages")]
        print("\nNO TRAFFIC IN WINDOW: " + ("; ".join(
            f"{g['group']} (silent {g['silent_days']}d)" if g.get("silent_days") is not None
            else g["group"] for g in quiet) or "n/a"))
        hanging = [g["group"] for g in wa if g.get("messages") and not g.get("last_from_mahara")]
        print("\nLAST WORD WAS THE CLIENT (possible unanswered): " + ("; ".join(hanging) or "none"))

    print("\n===== FATHOM CALLS =====")
    if isinstance(fa, BaseException):
        print(f"ERROR: {fa}")
    elif not fa:
        print("no calls recorded in window")
    else:
        for m in fa:
            print(f"--- {m['title']} | {m['at']} | host {m['host']} | external {m['external']}")
            print(f"    {m['url']}")
            print("    " + (m["summary"] or "no summary").replace("\n", "\n    "))


if __name__ == "__main__":
    asyncio.run(main())
