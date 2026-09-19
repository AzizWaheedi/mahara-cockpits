"""Test doubles: a ClickUp task, a Drive, a Supabase, all in memory."""
from __future__ import annotations

from typing import Any, Optional

from desk.config import FIELD

VIDEO_MIME = "video/mp4"


def task(
    task_id: str = "86abc",
    *,
    name: str = "New Video Request 🎥",
    status: str = "new video request",
    tags: Optional[list[str]] = None,
    editor: Optional[tuple[str, str]] = ("Karim Abdelrahman", "karim@maharamedia.com"),
    footage: str = "https://drive.google.com/drive/folders/1tTO2R44N3I3uKaFYKYwBa0gdVkrpHi?usp=drive_link",
    edited: str = "",
    references: str = "",
    description: str = "Cut a 30 second reel for the villa handover.",
    due: int = 1789520400000,
    created: int = 1789544058538,
) -> dict[str, Any]:
    fields = []

    def add(key: str, value: Any, ftype: str = "url"):
        fields.append({"id": FIELD[key], "name": key, "type": ftype, "value": value})

    if editor:
        add("assigned_editor", [{"id": 1, "username": editor[0], "email": editor[1]}], "users")
    if footage:
        add("footage_folder", footage)
    if edited:
        add("edited_video", edited)
    if references:
        add("references", references, "text")
    return {
        "id": task_id,
        "name": name,
        "url": f"https://app.clickup.com/t/{task_id}",
        "status": {"status": status},
        "tags": [{"name": t} for t in (tags or ["castello industries"])],
        "assignees": [],
        "custom_fields": fields,
        "description": description,
        "due_date": due,
        "date_created": created,
    }


def drive_file(fid: str, name: str, *, seconds: float = 60.0, size: int = 50_000_000, width: int = 1080, height: int = 1920, mime: str = VIDEO_MIME) -> dict[str, Any]:
    return {
        "id": fid,
        "name": name,
        "mimeType": mime,
        "size": str(size),
        "createdTime": "2026-09-01T10:00:00.000Z",
        "webViewLink": f"https://drive.google.com/file/d/{fid}/view",
        "videoMediaMetadata": {"width": width, "height": height, "durationMillis": int(seconds * 1000)},
    }


def folder(fid: str, name: str) -> dict[str, Any]:
    return {"id": fid, "name": name, "mimeType": "application/vnd.google-apps.folder"}


class FakeDrive:
    """Serves a folder tree and pretends to download."""

    def __init__(self, tree: dict[str, list[dict[str, Any]]], *, docs: Optional[dict[str, str]] = None, fail: Optional[set[str]] = None):
        self.tree = tree
        self.docs = docs or {}
        self.fail = fail or set()
        self.downloads: list[str] = []
        self.calls = 0

    def get(self, file_id: str) -> dict[str, Any]:
        self.calls += 1
        if file_id in self.tree:
            return folder(file_id, file_id)
        for items in self.tree.values():
            for f in items:
                if f["id"] == file_id:
                    return f
        return {}

    def list_folder(self, folder_id: str, *, pages: int = 4) -> list[dict[str, Any]]:
        self.calls += 1
        return list(self.tree.get(folder_id, []))

    def videos_under(self, folder_id: str, *, depth: int = 2, limit: int = 50) -> list[dict[str, Any]]:
        found: list[dict[str, Any]] = []
        stack = [(folder_id, 0)]
        while stack and len(found) < limit:
            fid, level = stack.pop(0)
            for f in self.tree.get(fid, []):
                if f.get("mimeType") == "application/vnd.google-apps.folder":
                    if level < depth:
                        stack.append((f["id"], level + 1))
                else:
                    found.append(f)
        return found

    def download(self, file_id: str, dest: str, *, max_bytes: int) -> int:
        from desk import http
        if file_id in self.fail:
            raise http.HttpError(404, "not found")
        self.downloads.append(file_id)
        with open(dest, "wb") as fh:
            fh.write(b"\x00" * 2048)
        return 2048

    def doc_text(self, file_id: str) -> str:
        return self.docs.get(file_id, "")


class FakeSupabase:
    """Rows in memory with the same method names the real client exposes."""

    def __init__(self):
        self.jobs: dict[str, dict[str, Any]] = {}
        self.requests_rows: dict[str, dict[str, Any]] = {}
        self.people_rows: dict[str, dict[str, Any]] = {}
        self.foreplay_rows: dict[str, dict[str, Any]] = {}
        self.ideation_rows: dict[str, dict[str, Any]] = {}
        self.clients_rows: dict[str, dict[str, Any]] = {}
        self.assets_rows: dict[str, dict[str, Any]] = {}
        self.versions_rows: dict[str, dict[str, Any]] = {}
        self.notes_rows: dict[str, dict[str, Any]] = {}
        self.stills: list[str] = []

    # jobs
    def existing_jobs(self, ids):
        return {i: self.jobs[i] for i in ids if i in self.jobs}

    def store_jobs(self, rows):
        new = updated = 0
        for r in rows:
            tid = r["task_id"]
            if tid in self.jobs:
                self.jobs[tid].update({k: v for k, v in r.items() if k != "task_id"})
                updated += 1
            else:
                self.jobs[tid] = {"state": "new", "ready": False, "attempts": 0, **r}
                new += 1
        return {"new": new, "updated": updated}

    def job(self, task_id):
        return self.jobs.get(task_id)

    def jobs_to_prepare(self, limit):
        return [j for j in self.jobs.values() if j.get("state") in ("new", "stale") and int(j.get("attempts") or 0) < 4][:limit]

    def retire_missing(self, on_board, stamp):
        have = {str(t) for t in on_board if t}
        stored = [j for j in self.jobs.values() if j.get("state") != "gone"]
        if not stored:
            return {"retired": 0}
        if len(have) < max(1, len(stored) // 2):
            return {"retired": 0, "refused": f"only {len(have)} cards"}
        missing = [j["task_id"] for j in stored if j.get("task_id") not in have]
        for tid in missing:
            self.jobs[tid].update({"state": "gone", "error": "the card is no longer on the board"})
        return {"retired": len(missing), "task_ids": missing}

    def mark_job(self, task_id, **fields):
        self.jobs.setdefault(task_id, {"task_id": task_id}).update(fields)

    # assets, versions, notes
    def store_assets(self, rows):
        for r in rows:
            self.assets_rows[r["id"]] = r
        return len(rows)

    def assets(self, task_id):
        return [a for a in self.assets_rows.values() if a.get("task_id") == task_id]

    def store_version(self, row):
        self.versions_rows[row["id"]] = row
        return row["id"]

    def versions(self, task_id):
        return [v for v in self.versions_rows.values() if v.get("task_id") == task_id]

    def store_notes(self, rows):
        for r in rows:
            self.notes_rows[r["id"]] = r
        return len(rows)

    def notes(self, task_id):
        return [n for n in self.notes_rows.values() if n.get("task_id") == task_id]

    def known_ideation_keys(self, keys):
        return [k for k in keys if k in self.ideation_rows]

    def upsert(self, table, rows, on_conflict):
        if table == "ideation_posts":
            for r in rows:
                self.ideation_rows[r["key"]] = r
            return len(rows)
        raise AssertionError(f"unexpected upsert: {table}")

    def known_foreplay_ids(self, limit=5000):
        return list(self.foreplay_rows)

    def store_foreplay(self, rows):
        for r in rows:
            self.foreplay_rows[r["id"]] = r
        return len(rows)

    def seats_from_board(self, people, stamp):
        want = {p["email"].lower(): p.get("name") or "" for p in people if p.get("email")}
        for email, name in want.items():
            row = self.people_rows.setdefault(email, {"email": email})
            row.update({"via_clickup": True, "clickup_seen_at": stamp})
            if name:
                row["name"] = name
        stale = [e for e, r in self.people_rows.items() if r.get("via_clickup") and e not in want]
        for email in stale:
            self.people_rows[email]["via_clickup"] = False
        return {"granted": len(want), "revoked": len(stale)}

    def select(self, table, params):
        if table == "editor_jobs":
            return list(self.jobs.values())
        if table == "editor_requests":
            rows = [r for r in self.requests_rows.values() if r.get("status") == "queued"]
            if "attempts=lt.4" in params:
                rows = [r for r in rows if int(r.get("attempts") or 0) < 4]
            return sorted(rows, key=lambda r: str(r.get("created_at") or ""))
        if table == "editor_clients":
            return list(self.clients_rows.values())
        return []

    # requests, the queue the cockpit writes to
    def store_clients(self, rows):
        for r in rows:
            self.clients_rows[r["task_id"]] = {**self.clients_rows.get(r["task_id"], {}), **r}
        return len(rows)

    def clients(self, task_ids=None):
        if task_ids is None:
            return list(self.clients_rows.values())
        want = {t for t in task_ids if t}
        return [c for c in self.clients_rows.values() if c["task_id"] in want]

    def client(self, task_id):
        return self.clients_rows.get(task_id)

    def queue(self, row):
        self.requests_rows[row["id"]] = {"status": "queued", "attempts": 0, **row}

    def rest(self, method, path, *, json_body=None, prefer=None, retries=2):
        """Only the conditional claim the drain uses is modelled here."""
        if method == "PATCH" and path.startswith("editor_requests?id=eq."):
            rid = path.split("id=eq.", 1)[1].split("&", 1)[0]
            row = self.requests_rows.get(rid)
            if row is None:
                return []
            if "&status=eq.queued" in path and row.get("status") != "queued":
                return []
            row.update(json_body or {})
            return [row] if prefer and "representation" in prefer else None
        raise AssertionError(f"unexpected rest call: {method} {path}")

    def patch(self, table, where, body):
        if table == "editor_requests":
            rid = where.split("id=eq.", 1)[1]
            self.requests_rows.setdefault(rid, {"id": rid}).update(body)
            return
        if table == "editor_jobs":
            tid = where.split("task_id=eq.", 1)[1]
            self.jobs.setdefault(tid, {"task_id": tid}).update(body)
            return
        raise AssertionError(f"unexpected patch: {table}")

    def upload_still(self, task_id, name, blob, content_type="image/jpeg"):
        path = f"{task_id}/{name}"
        self.stills.append(path)
        return path


class FakeClickUp:
    def __init__(self, tasks: Optional[list[dict[str, Any]]] = None, comments: Optional[list[dict[str, Any]]] = None):
        self._tasks = tasks or []
        self._comments = comments or []
        self.posted: list[tuple[str, str]] = []
        self.fields: list[tuple[str, str, Any]] = []
        self.statuses: list[tuple[str, str]] = []

    def tasks(self, *, include_closed: bool = False, pages: int = 5):
        return list(self._tasks)

    def task(self, task_id):
        return next((t for t in self._tasks if t["id"] == task_id), {})

    def comment(self, task_id, text):
        self.posted.append((task_id, text))

    def comments(self, task_id):
        return list(self._comments)

    def set_field(self, task_id, field_key, value):
        self.fields.append((task_id, field_key, value))

    def set_status(self, task_id, status):
        self.statuses.append((task_id, status))
