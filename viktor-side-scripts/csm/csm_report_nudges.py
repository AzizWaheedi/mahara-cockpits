"""This week's report reminders waiting on the CSM's approval, read from #csm-general.

Every Thursday a bot posts one message per client in #csm-general: the exact Arabic text that
will reach the client's WhatsApp, the appointments still missing an outcome, and a REVIEW AND
SEND link. Nothing reaches the client until the CSM opens that link and presses send.

The app can therefore tell her which clients are waiting on her this week, and hand her the
link. What it must never claim is that the client received it: the approval page is outside
anything readable here, so the wording stays "waiting for your approval", never "sent".
"""

from __future__ import annotations

import datetime
import os
import re
from pathlib import Path

CHANNEL_DIR = "csm-general"
PENDING = re.compile(
    r"\*Report reminder pending approval[,:\u2014\u2013\-]*\s*([^*]+?)\*(.*?)(?=\n\[|\Z)",
    re.S,
)
COUNT = re.compile(r"(\d+)\s+appointments?\s+(?:is|are)?\s*missing an outcome")
REVIEW = re.compile(r"<(https://hook\.eu2\.make\.com/[^|>]+action=review)")


def iso_week(day: datetime.date | None = None) -> str:
    """The week key the bot uses in its links, for example 2026-W36."""
    d = day or datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).date()
    year, week, _ = d.isocalendar()
    return f"{year}-W{week:02d}"


def _log_text() -> str:
    """This month's and last month's channel text, so a week spanning a month still reads."""
    root = os.environ.get("SLACK_ROOT")
    if not root:
        return ""
    base = Path(root) / CHANNEL_DIR
    if not base.exists():
        return ""
    files = sorted(base.glob("*.log"))[-2:]
    return "\n".join(f.read_text(errors="replace") for f in files)


def nudges(week: str | None = None) -> dict[str, dict]:
    """Client name to {missing, url, week} for the reminders still on the board this week.

    Keyed by the client name exactly as the bot writes it, which is the ClickUp name, so it
    joins to a profile without fuzzy matching.
    """
    want = week or iso_week()
    text = _log_text()
    out: dict[str, dict] = {}
    for name, body in PENDING.findall(text):
        url = REVIEW.search(body)
        if not url or f"-{want}&" not in url.group(1):
            continue
        count = COUNT.search(body)
        clean = name.strip().lstrip("\u2014\u2013- ").strip()
        out[clean] = {
            "missing": int(count.group(1)) if count else 1,
            "url": url.group(1).replace("&amp;", "&"),
            "week": want,
        }
    return out


def main() -> None:
    found = nudges()
    print(f"week {iso_week()}: {len(found)} clients waiting for approval")
    for name, n in found.items():
        print(f"  {name}: {n['missing']} missing")


if __name__ == "__main__":
    main()
