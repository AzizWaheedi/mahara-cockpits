#!/usr/bin/env python3
"""Carries a client's review out to where the editors already work.

Three places, in order of how much they matter:

1. **The editor cockpit**, which does not need this script at all --
   `review_decide` writes the note into `editor_notes` in the same
   transaction as the decision. That is the delivery.
2. **The ClickUp task**, as a comment on the video's own card, so the
   note is on the job wherever it is being tracked.
3. **#media-adjustments on Slack**, as the nudge that something changed.

The order is deliberate. A Slack outage or a ClickUp hiccup must never
be the reason a client's note is lost, so neither of them is the
delivery. Both are retried on the next run and neither repeats itself:
a note carries `posted_at` once it has gone to ClickUp, and a review
carries `announced_at` once Slack has been told.

One Slack message per review per run, not one per note -- a client going
through four cuts in two minutes is one thing happening, not four.
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


def clickup(task_id: str, text: str) -> bool:
    """Put the note on the video's own card.

    ClickUp is where the job is tracked, so a change request that only
    exists in our cockpit is one an editor working from the board will
    not see.
    """
    key = os.environ.get("CLICKUP_API_KEY")
    if not key:
        note("no CLICKUP_API_KEY; the note is on the job in the cockpit regardless")
        return False
    req = urllib.request.Request(
        f"https://api.clickup.com/api/v2/task/{urllib.parse.quote(task_id)}/comment",
        data=json.dumps({"comment_text": text, "notify_all": False}).encode(),
        headers={"Authorization": key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status < 300
    except urllib.error.HTTPError as e:
        note(f"clickup {e.code} on {task_id}: {e.read().decode()[:140]}")
        return False


def slack(text: str) -> bool:
    token = os.environ.get("SLACK_BOT_TOKEN")
    # #media-adjustments: where the editors already read change requests.
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

    told = posted = 0
    for link in pending:
        token = link["token"]
        items = sb.call(
            "GET",
            f"review_items?select=n,title,decision,post_id&token=eq."
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
        # A review of social posts lands on the posts, not on an editor's
        # job, and saying otherwise sends people to the wrong cockpit.
        if any(i.get("post_id") for i in items):
            lines.append("The answers are on the posts in the social calendar.")
        else:
            lines.append("The notes are already on the job in the editor cockpit.")

        # Onto the cards first: the board is where the work is tracked,
        # and Slack saying "there are notes" before the notes exist on
        # the task sends people looking for something not there yet.
        unposted = sb.call(
            "GET",
            "review_notes?select=id,body,at_seconds,task_id"
            f"&item_id=like.{urllib.parse.quote(token)}%25"
            "&posted_at=is.null&task_id=not.is.null&order=at",
        )
        by_task: dict[str, list[dict]] = {}
        for n in unposted:
            by_task.setdefault(str(n["task_id"]), []).append(n)
        for task_id, group in by_task.items():
            # Plain text: ClickUp comments are not mrkdwn, so asterisks
            # meant as bold arrive as asterisks.
            body = f"{who} reviewed “{link.get('title')}” and asked for:\n" + "\n".join(
                f"- {clock(n.get('at_seconds')) or 'no timecode'}  {n['body']}"
                for n in group
            )
            if clickup(task_id, body):
                for n in group:
                    sb.call(
                        "PATCH",
                        f"review_notes?id=eq.{n['id']}",
                        {"posted_at": now()},
                        "return=minimal",
                    )
                posted += len(group)

        if slack("\n".join(lines)):
            told += 1
            sb.call(
                "PATCH",
                f"review_links?token=eq.{urllib.parse.quote(token)}",
                {"announced_at": now()},
                "return=minimal",
            )

    note(f"{len(pending)} review(s) moved, {posted} note(s) onto cards, {told} announced")
    return 0


if __name__ == "__main__":
    sys.exit(main())
