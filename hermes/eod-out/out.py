#!/usr/bin/env python3
"""Carries every cockpit's end of day out to Slack and the EOD sheet.

Only the media buyer's EOD ever left its cockpit. The creative
director's and the CSM's were written into their own Convex tables and
read by nobody, so the tracking sheet marked those people MISSED every
day while they were filling one in.

The cockpits now drop a row in `eod_outbox` and this posts it. Two
things it is careful about, because both have already gone wrong here:

* **The message goes out as Slack `text`.** EOD Radar reads
  `message.text`. An EOD sent only as blocks arrives with whatever
  fallback the sender set, and the radar sees no name and credits
  nobody -- which is the bug that hid the media buyer's EODs for weeks.
* **The name and the `Submitted by: <@id>` line are in the body.** That
  is what the Roster matches on. A beautifully formatted EOD without
  them is invisible.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "editor-desk")
)

EOD_SHEET = "1EhPp7x0jZfV8dNjUvmuWv_alNvduMGpe_COjUAB13bw"
MAX_ATTEMPTS = 5


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def note(line: str) -> None:
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] {line}", flush=True)


class Store:
    def __init__(self) -> None:
        self.base = os.environ["DESK_SUPABASE_URL"].rstrip("/")
        self.key = os.environ["DESK_SUPABASE_KEY"]

    def call(self, method: str, path: str, body=None, prefer: str = ""):
        data = json.dumps(body).encode() if body is not None else None
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        req = urllib.request.Request(
            f"{self.base}/rest/v1/{path}", data=data, method=method, headers=headers
        )
        with urllib.request.urlopen(req, timeout=90) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else []


def slack_post(channel: str, text: str) -> str:
    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        raise RuntimeError("SLACK_BOT_TOKEN is not set")
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        # `text`, deliberately. See the note at the top of this file.
        data=json.dumps({"channel": channel, "text": text}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        out = json.loads(r.read().decode())
    if not out.get("ok"):
        raise RuntimeError(f"slack: {out.get('error')}")
    return str(out.get("ts") or "")


def file_row(tab: str, values: list) -> None:
    """Append to the tab, in that tab's own column order."""
    from desk import sheets
    from desk.config import Config
    from desk.drive import Drive

    token = Drive(Config.from_env(), lambda s: None).token()
    cols = sheets.header(token, EOD_SHEET, tab)
    if not cols:
        raise ValueError(f"the '{tab}' tab has no header row")
    sheets.append(token, EOD_SHEET, tab, values)


def main() -> int:
    sb = Store()
    rows = sb.call(
        "GET",
        "eod_outbox?select=*&status=eq.queued&order=created_at&limit=20",
    )
    if not rows:
        note("nothing queued")
        return 0

    sent = failed = 0
    for row in rows:
        try:
            ts = slack_post(str(row["channel"]), str(row["body"]))
            if row.get("tab") and row.get("row_values"):
                try:
                    file_row(str(row["tab"]), list(row["row_values"]))
                except Exception as e:
                    # Slack is what the radar reads, so a sheet failure
                    # must not undo a post that already succeeded and
                    # must not cause it to be sent twice.
                    note(f"  {row['id']}: posted, but the sheet refused it: {e}")
            sb.call(
                "PATCH",
                f"eod_outbox?id=eq.{row['id']}",
                {"status": "sent", "slack_ts": ts, "sent_at": now(), "error": None},
                "return=minimal",
            )
            sent += 1
            note(f"  {row['person']} ({row['role']}) -> {row['channel']}")
        except Exception as e:
            n = int(row.get("attempts") or 0) + 1
            sb.call(
                "PATCH",
                f"eod_outbox?id=eq.{row['id']}",
                {
                    "attempts": n,
                    "error": str(e)[:400],
                    "status": "failed" if n >= MAX_ATTEMPTS else "queued",
                },
                "return=minimal",
            )
            failed += 1
            note(f"  {row['person']}: {type(e).__name__}: {str(e)[:120]}")

    note(f"{sent} sent, {failed} failed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
