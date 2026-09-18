"""Supabase as the desk's home: four tables in the Creative Triage project.

`editor_jobs` mirrors the ClickUp Video Pipeline and adds what the worker
learned; `editor_assets` is a row per piece of footage with its transcript;
`editor_versions` is a row per cut with its check report; `editor_notes` is
timestamped feedback. Row security is on with no policies, so only the
service key reaches them.

Rules the writes follow, learned the hard way on the radar:
- PostgREST refuses a bulk upsert whose rows carry different keys (PGRST102),
  so rows are grouped by key set before they are sent;
- a sync never overwrites what the worker learned, and the worker never
  overwrites what the board says;
- every write is an upsert or a patch by primary key, so a retry is harmless.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from . import http

JOB_COLUMNS = {
    "task_id", "name", "url", "status", "client", "clients", "editor", "editors", "request_type",
    "brief", "script_task_id", "script", "footage_url", "raw_url", "edited_url", "website",
    "due_at", "opened_at", "state", "ready", "missing", "files", "seconds", "transcript_chars",
    "prepared_at", "attempts", "error", "synced_at", "updated_at",
}
# What a board sync is allowed to touch. Worker state is not in this set.
BOARD_COLUMNS = {
    "name", "url", "status", "client", "clients", "editor", "editors", "request_type", "brief",
    "footage_url", "raw_url", "edited_url", "website", "due_at", "opened_at", "synced_at", "updated_at",
}
ASSET_COLUMNS = {
    "id", "task_id", "kind", "drive_id", "name", "mime", "bytes", "seconds", "width", "height", "fps",
    "has_audio", "preview_url", "still_path", "language", "transcript", "words", "scenes", "script_hits",
    "method", "error", "at", "updated_at",
}
VERSION_COLUMNS = {
    "id", "task_id", "n", "url", "drive_id", "name", "bytes", "seconds", "width", "height", "fps",
    "ratio", "loudness", "transcript", "checks", "passed", "waived", "by_email", "by_name", "at", "updated_at",
}
NOTE_COLUMNS = {"id", "task_id", "version", "at_sec", "text", "by_email", "by_name", "source", "done", "at"}

JSON_COLUMNS = ("clients", "editors", "missing", "words", "scenes", "script_hits", "method", "checks", "waived")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _q(value: str) -> str:
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


class SupabaseError(Exception):
    pass


class Supabase:
    def __init__(self, url: str, key: str, *, bucket: str = "editor-stills", timeout: float = 60):
        if not url or not key:
            raise SupabaseError("DESK_SUPABASE_URL and DESK_SUPABASE_KEY are required")
        self.url = url.rstrip("/")
        self.key = key
        self.bucket = bucket
        self.timeout = timeout

    # ---- plumbing --------------------------------------------------------
    def _headers(self, prefer: Optional[str] = None, extra: Optional[dict[str, str]] = None) -> dict[str, str]:
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Accept": "application/json"}
        if prefer:
            h["Prefer"] = prefer
        if extra:
            h.update(extra)
        return h

    def rest(self, method: str, path: str, *, json_body: Any = None, prefer: Optional[str] = None, retries: int = 2) -> Any:
        headers = self._headers(prefer)
        data = None
        if json_body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
        _, _, body = http.request(
            method, f"{self.url}/rest/v1/{path}", headers=headers, data=data,
            timeout=self.timeout, retries=retries, ok_statuses=(200, 201, 204),
        )
        if not body:
            return None
        try:
            return json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return body.decode("utf-8", "replace")

    def select(self, table: str, params: str) -> list[dict[str, Any]]:
        rows = self.rest("GET", f"{table}?{params}")
        return rows if isinstance(rows, list) else []

    def upsert(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> int:
        if not rows:
            return 0
        groups: dict[tuple[str, ...], list[dict[str, Any]]] = {}
        for row in rows:
            groups.setdefault(tuple(sorted(row.keys())), []).append(row)
        for group in groups.values():
            for i in range(0, len(group), 200):
                self.rest(
                    "POST", f"{table}?on_conflict={on_conflict}",
                    json_body=group[i : i + 200],
                    prefer="resolution=merge-duplicates,return=minimal",
                )
        return len(rows)

    def patch(self, table: str, where: str, body: dict[str, Any]) -> None:
        if not body:
            return
        self.rest("PATCH", f"{table}?{where}", json_body=body, prefer="return=minimal")

    def delete(self, table: str, where: str) -> None:
        self.rest("DELETE", f"{table}?{where}", prefer="return=minimal")

    def ping(self) -> bool:
        self.rest("GET", "editor_jobs?select=task_id&limit=1")
        return True

    @staticmethod
    def _row(d: dict[str, Any], allowed: set[str]) -> dict[str, Any]:
        row = {k: v for k, v in d.items() if k in allowed}
        for k in JSON_COLUMNS:
            if k in row and row[k] is None:
                row[k] = []
        return row

    # ---- jobs ------------------------------------------------------------
    def existing_jobs(self, task_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
        ids = [t for t in dict.fromkeys(task_ids) if t]
        out: dict[str, dict[str, Any]] = {}
        for i in range(0, len(ids), 100):
            chunk = ids[i : i + 100]
            rows = self.select(
                "editor_jobs",
                f"select=task_id,state,ready,prepared_at,attempts,script_task_id,error&task_id=in.({','.join(_q(t) for t in chunk)})",
            )
            for r in rows:
                out[r["task_id"]] = r
        return out

    def store_jobs(self, rows: list[dict[str, Any]]) -> dict[str, int]:
        """Board rows in. A job already known keeps its worker state; a new one starts at `new`."""
        stamp = now_iso()
        have = self.existing_jobs([r.get("task_id", "") for r in rows])
        fresh: list[dict[str, Any]] = []
        known: list[dict[str, Any]] = []
        for r in rows:
            tid = r.get("task_id")
            if not tid:
                continue
            if tid in have:
                body = self._row(r, BOARD_COLUMNS)
                body["updated_at"] = stamp
                known.append({**body, "task_id": tid})
            else:
                body = self._row(r, JOB_COLUMNS)
                body.update({"state": "new", "ready": False, "attempts": 0, "updated_at": stamp})
                fresh.append(body)
        self.upsert("editor_jobs", fresh, "task_id")
        self.upsert("editor_jobs", known, "task_id")
        return {"new": len(fresh), "updated": len(known)}

    def job(self, task_id: str) -> Optional[dict[str, Any]]:
        rows = self.select("editor_jobs", f"select=*&task_id=eq.{http.quote(task_id)}&limit=1")
        return rows[0] if rows else None

    def jobs_to_prepare(self, limit: int) -> list[dict[str, Any]]:
        """Open jobs the worker has not finished, oldest first, tried fewer than four times."""
        rows = self.select(
            "editor_jobs",
            "select=*&state=in.(\"new\",\"stale\")&attempts=lt.4&order=opened_at.asc&limit=" + str(int(limit)),
        )
        return rows

    def mark_job(self, task_id: str, **fields: Any) -> None:
        fields["updated_at"] = now_iso()
        self.patch("editor_jobs", f"task_id=eq.{http.quote(task_id)}", fields)

    # ---- assets, versions, notes -----------------------------------------
    def store_assets(self, rows: list[dict[str, Any]]) -> int:
        stamp = now_iso()
        clean = []
        for r in rows:
            body = self._row(r, ASSET_COLUMNS)
            body.setdefault("at", stamp)
            body["updated_at"] = stamp
            clean.append(body)
        return self.upsert("editor_assets", clean, "id")

    def assets(self, task_id: str) -> list[dict[str, Any]]:
        return self.select("editor_assets", f"select=*&task_id=eq.{http.quote(task_id)}&order=at.asc")

    def store_version(self, row: dict[str, Any]) -> str:
        stamp = now_iso()
        body = self._row(row, VERSION_COLUMNS)
        body.setdefault("at", stamp)
        body["updated_at"] = stamp
        self.upsert("editor_versions", [body], "id")
        return str(body.get("id") or "")

    def versions(self, task_id: str) -> list[dict[str, Any]]:
        return self.select("editor_versions", f"select=*&task_id=eq.{http.quote(task_id)}&order=n.asc")

    def store_notes(self, rows: list[dict[str, Any]]) -> int:
        return self.upsert("editor_notes", [self._row(r, NOTE_COLUMNS) for r in rows], "id")

    def notes(self, task_id: str) -> list[dict[str, Any]]:
        return self.select("editor_notes", f"select=*&task_id=eq.{http.quote(task_id)}&order=at.asc")

    # ---- stills ----------------------------------------------------------
    def upload_still(self, task_id: str, name: str, blob: bytes, content_type: str = "image/jpeg") -> str:
        path = f"{task_id}/{name}"
        headers = self._headers(extra={"Content-Type": content_type, "x-upsert": "true"})
        http.request(
            "POST", f"{self.url}/storage/v1/object/{self.bucket}/{http.quote(path)}",
            headers=headers, data=blob, timeout=self.timeout, retries=1, ok_statuses=(200, 201),
        )
        return path
