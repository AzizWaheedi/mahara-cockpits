#!/usr/bin/env python3
"""Tells the editors a client has been through a review.

The note itself already reaches them: `review_decide` writes it into
`editor_notes` in the same transaction as the decision, so it is in the
editor's own list with its timecode whether or not this runs. This is
the nudge, not the delivery -- which is the right way round, because a
Slack message that fails must never be the reason a note is lost.

One message per review per run, not one per note: a client going through
four cuts in two minutes should produce one line in Slack, not four.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


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
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else []


def slack(text: str) -> bool:
    token = os.environ.get("SLACK_BOT_TOKEN")
    channel = os.environ.get("REVIEW_SLACK_CHANNEL") or os.environ.get(
        "SLACK_HEALTH_CHANNEL"
    )
    if not token or not channel:
        note("no Slack token or channel; the notes are in the cockpit regardless")
        return False
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=json.dumps({"channel": channel, "text": text}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            out = json.loads(r.read().decode())
        if not out.get("ok"):
            note(f"slack refused it: {out.get('error')}")
            return False
        return True
    except urllib.error.HTTPError as e:
        note(f"slack {e.code}: {e.read().decode()[:120]}")
        return False


def clock(sec) -> str:
    if sec is None:
        return ""
    s = int(float(sec))
    return f"{s // 60}:{s % 60:02d}"


def main() -> int:
    sb = Store()
    links = sb.call(
        "GET",
        "review_links?select=token,title,client_name,reviewer_name,"
        "last_activity_at,announced_at&revoked=is.false"
        "&last_activity_at=not.is.null&order=last_activity_at.desc&limit=40",
    )
    pending = [
        l
        for l in links
        if l.get("last_activity_at")
        and (
            not l.get("announced_at")
            or str(l["announced_at"]) < str(l["last_activity_at"])
        )
    ]
    if not pending:
        note("nothing new")
        return 0

    told = 0
    for link in pending:
        token = link["token"]
        items = sb.call(
            "GET",
            f"review_items?select=n,title,decision&token=eq."
            f"{urllib.parse.quote(token)}&order=n",
        )
        notes = sb.call(
            "GET",
            "review_notes?select=body,at_seconds,item_id,at"
            f"&item_id=like.{urllib.parse.quote(token)}%25&order=at.desc&limit=6",
        )
        approved = sum(1 for i in items if i.get("decision") == "approved")
        changes = sum(1 for i in items if i.get("decision") == "changes")
        who = link.get("reviewer_name") or link.get("client_name") or "The client"

        lines = [
            f"*{who}* went through *{link.get('title')}* "
            f"— {approved} approved, {changes} needing a change, "
            f"{len(items) - approved - changes} still to look at."
        ]
        for n in notes[:4]:
            stamp = clock(n.get("at_seconds"))
            lines.append(f"> {stamp + '  ' if stamp else ''}{str(n.get('body'))[:180]}")
        lines.append("The notes are already on the job in the editor cockpit.")

        if slack("\n".join(lines)):
            told += 1
            sb.call(
                "PATCH",
                f"review_links?token=eq.{urllib.parse.quote(token)}",
                {"announced_at": now()},
                "return=minimal",
            )

    note(f"{len(pending)} review(s) moved, {told} announced")
    return 0


if __name__ == "__main__":
    sys.exit(main())
