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


def order_by_header(cols: list, values) -> list:
    """A row given as named columns goes under the tab's own header, in its
    order, matching names without case; a list is already in order."""
    if not isinstance(values, dict):
        return list(values)
    named = {str(k).strip().lower(): v for k, v in values.items()}
    return [named.get(str(c).strip().lower(), "") for c in cols]


def file_row(tab: str, values) -> None:
    """Append to the tab, in that tab's own column order."""
    from desk import sheets
    from desk.config import Config
    from desk.drive import Drive

    token = Drive(Config.from_env(), lambda s: None).token()
    cols = sheets.header(token, EOD_SHEET, tab)
    if not cols:
        raise ValueError(f"the '{tab}' tab has no header row")
    sheets.append(token, EOD_SHEET, tab, order_by_header(cols, values))


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
        patch: dict = {}
        # The sheet and Slack each go once, on their own clocks. A Slack
        # refusal (the bot not invited to the channel, say) used to keep the
        # EOD out of the sheet as well; now the row is in the sheet as soon
        # as the sheet takes it, and only the part still missing is retried.
        if row.get("tab") and row.get("row_values") and not row.get("sheet_at"):
            try:
                file_row(str(row["tab"]), row["row_values"])
                patch.update({"sheet_at": now(), "sheet_error": None})
            except Exception as e:
                patch["sheet_error"] = str(e)[:400]
                note(f"  {row['id']}: the sheet refused it: {e}")
        slack_ts = row.get("slack_ts")
        slack_error = None
        if not slack_ts:
            try:
                slack_ts = slack_post(str(row["channel"]), str(row["body"]))
                patch.update({"slack_ts": slack_ts, "sent_at": now(), "error": None})
            except Exception as e:
                slack_error = f"{type(e).__name__}: {str(e)[:380]}"
        sheet_done = bool(patch.get("sheet_at") or row.get("sheet_at")) or not (row.get("tab") and row.get("row_values"))
        if slack_ts and sheet_done:
            patch["status"] = "sent"
            sent += 1
            note(f"  {row['person']} ({row['role']}) -> {row['channel']}")
        else:
            n = int(row.get("attempts") or 0) + 1
            patch.update({
                "attempts": n,
                "status": "failed" if n >= MAX_ATTEMPTS else "queued",
                **({"error": slack_error} if slack_error else {}),
            })
            failed += 1
            note(f"  {row['person']}: {slack_error or 'the sheet is still to go'}")
        sb.call("PATCH", f"eod_outbox?id=eq.{row['id']}", patch, "return=minimal")

    note(f"{sent} sent, {failed} failed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
