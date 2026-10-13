#!/usr/bin/env python3
"""Turns a Drive folder into a client review.

Paste a folder in a cockpit, and this reads it, copies every video and
image into our own public bucket, and makes the review link.

The copy is the point. A Drive link does not play in a video tag and
does not render in an image tag -- it serves a viewer page, and a client
who opens a review and sees nothing does not write in to say so. So the
files are fetched here, where the team's Drive token lives, and served
from a bucket the client's browser can actually read.

Order inside the folder is kept: Drive's own `folder,createdTime` is
usually the order somebody exported them in, which is closer to the
order they want them watched than anything we would invent.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# The editor desk next door already carries a Drive client with the
# team's OAuth refresh token and the scopes that reach client folders.
# Borrowed rather than rebuilt: a second Drive client is a second thing
# to fix when the token changes.
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "editor-desk"),
)

BUCKET = "review-videos"
# Big enough for a finished cut, small enough that one bad file cannot
# fill the bucket. Anything larger is a master, not a review copy.
MAX_BYTES = 600 * 1024 * 1024


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
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else []

    def rpc(self, fn: str, args: dict):
        return self.call("POST", f"rpc/{fn}", args)

    def put_blob(self, path: str, blob: bytes, mime: str) -> str:
        req = urllib.request.Request(
            f"{self.base}/storage/v1/object/{BUCKET}/{urllib.parse.quote(path)}",
            data=blob,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.key}",
                "apikey": self.key,
                "Content-Type": mime or "application/octet-stream",
                "x-upsert": "true",
            },
        )
        urllib.request.urlopen(req, timeout=600).read()
        return f"{self.base}/storage/v1/object/public/{BUCKET}/{urllib.parse.quote(path)}"


def is_image(f: dict) -> bool:
    mime = str(f.get("mimeType") or "")
    if mime.startswith("image/"):
        return True
    return str(f.get("name") or "").lower().endswith(
        (".jpg", ".jpeg", ".png", ".webp", ".heic")
    )


def pretty(name: str) -> str:
    """A filename a client can read, without the export cruft."""
    base = name.rsplit(".", 1)[0]
    base = base.replace("_", " ").replace("-", " ")
    base = " ".join(base.split())
    return (base[:1].upper() + base[1:])[:120] or "Untitled"


def run_one(sb: Store, drive, job: dict) -> None:
    from desk import drive as drive_mod

    folder_id = drive_mod.parse_id(str(job["folder_url"]))
    if not folder_id:
        raise ValueError("that does not look like a Drive link")

    files = drive.list_folder(folder_id)
    media = [
        f
        for f in files
        if str(f.get("mimeType")) != "application/vnd.google-apps.folder"
        and (drive_mod.is_video(f) or is_image(f))
    ]
    if not media:
        raise ValueError("no videos or images directly in that folder")

    sb.call(
        "PATCH",
        f"review_imports?id=eq.{job['id']}",
        {"status": "working", "found": len(media), "updated_at": now()},
        "return=minimal",
    )

    items, copied, skipped = [], 0, []
    for f in media:
        size = int(f.get("size") or 0)
        if size and size > MAX_BYTES:
            # Said out loud rather than dropped: a client noticing a cut
            # is missing is worse than being told which one was too big.
            skipped.append(f"{f.get('name')} ({size // (1024 * 1024)}MB)")
            continue
        tmp = f"/tmp/rev-{f['id']}"
        try:
            drive.download(f["id"], tmp, max_bytes=MAX_BYTES)
            with open(tmp, "rb") as fh:
                blob = fh.read()
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in str(f["name"]))[-80:]
        url = sb.put_blob(f"{job['id']}/{f['id']}-{safe}", blob, str(f.get("mimeType") or ""))
        items.append({
            "title": pretty(str(f.get("name") or "")),
            "video_url": url,
            "kind": "image" if is_image(f) else "video",
        })
        copied += 1

    if not items:
        raise ValueError(
            "everything in that folder was too big to copy: " + ", ".join(skipped[:4])
        )

    note_text = job.get("note") or ""
    if skipped:
        note_text = (note_text + "\n" if note_text else "") + (
            f"({len(skipped)} file(s) were too large to include)"
        )

    made = sb.rpc("review_create", {
        "p_title": job["title"],
        "p_note": note_text or None,
        "p_client": job.get("client_name"),
        "p_client_task_id": job.get("client_task_id"),
        "p_by": job.get("requested_by") or "folder import",
        "p_items": items,
        "p_days": 30,
    })
    token = (made or {}).get("token")

    sb.call(
        "PATCH",
        f"review_imports?id=eq.{job['id']}",
        {"status": "done", "token": token, "copied": copied, "updated_at": now()},
        "return=minimal",
    )
    note(f"  {job['id']}: {copied} of {len(media)} copied -> {token}")


def main() -> int:
    sb = Store()
    jobs = sb.call(
        "GET", "review_imports?select=*&status=eq.queued&order=created_at&limit=3"
    )
    if not jobs:
        note("nothing queued")
        return 0

    from desk.config import Config
    from desk.drive import Drive

    drive = Drive(Config.from_env(), note)

    for job in jobs:
        try:
            run_one(sb, drive, job)
        except Exception as e:
            # The person waiting sees the sentence, so it has to be one.
            sb.call(
                "PATCH",
                f"review_imports?id=eq.{job['id']}",
                {"status": "failed", "error": str(e)[:400], "updated_at": now()},
                "return=minimal",
            )
            note(f"  {job['id']} failed: {type(e).__name__}: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
