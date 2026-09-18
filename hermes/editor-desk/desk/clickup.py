"""The ClickUp Video Pipeline: the source of truth for what the editors owe.

The desk reads the list, and writes back exactly two things plus a comment:
the Edited Video Link and the status. Everything else on the card belongs to
the people who fill it in. Field ids are in config.FIELD, read live on
2026-09-18; a renamed field keeps working, a deleted one is reported.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Optional

from . import http
from .config import DONE_STATUSES, FIELD, VIDEO_LIST, Config

BASE = "https://api.clickup.com/api/v2"


def _iso(ms: Any) -> Optional[str]:
    try:
        n = int(ms)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return datetime.fromtimestamp(n / 1000, tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fields_of(task: dict[str, Any]) -> dict[str, Any]:
    """Custom fields keyed by our stable ids, so a rename on the board is harmless."""
    by_id = {str(c.get("id")): c for c in (task.get("custom_fields") or []) if isinstance(c, dict)}
    out: dict[str, Any] = {}
    for name, fid in FIELD.items():
        c = by_id.get(fid)
        if not c:
            continue
        value = c.get("value")
        if value in (None, "", []):
            continue
        if c.get("type") == "drop_down":
            opts = ((c.get("type_config") or {}).get("options") or [])
            try:
                out[name] = str(opts[int(value)].get("name"))
            except (TypeError, ValueError, IndexError):
                out[name] = value
        else:
            out[name] = value
    return out


def editors_of(task: dict[str, Any]) -> list[dict[str, str]]:
    """The Assigned Editor field is a users field; ClickUp assignees are usually empty."""
    people: list[dict[str, str]] = []
    seen: set[str] = set()
    f = fields_of(task).get("assigned_editor") or []
    for u in f if isinstance(f, list) else []:
        if not isinstance(u, dict):
            continue
        email = str(u.get("email") or "").lower()
        name = str(u.get("username") or "")
        if email or name:
            k = email or name
            if k not in seen:
                seen.add(k)
                people.append({"email": email, "name": name})
    for u in task.get("assignees") or []:
        if not isinstance(u, dict):
            continue
        email = str(u.get("email") or "").lower()
        name = str(u.get("username") or "")
        k = email or name
        if k and k not in seen:
            seen.add(k)
            people.append({"email": email, "name": name})
    return people


def is_open(status: str) -> bool:
    return (status or "").strip().lower() not in DONE_STATUSES


class ClickUp:
    def __init__(self, cfg: Config, log: Optional[Callable[[str], None]] = None):
        if not cfg.clickup_key:
            raise http.HttpError(0, "CLICKUP_API_KEY is not set")
        self.cfg = cfg
        self.log = log or (lambda m: None)
        self.calls = 0

    def _h(self) -> dict[str, str]:
        return {"Authorization": self.cfg.clickup_key}

    def tasks(self, *, include_closed: bool = False, pages: int = 5) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for page in range(pages):
            self.calls += 1
            q = http.encode_query({
                "include_closed": "true" if include_closed else "false",
                "subtasks": "true",
                "page": page,
            })
            data = http.get_json(f"{BASE}/list/{VIDEO_LIST}/task?{q}", headers=self._h(), timeout=90)
            batch = (data or {}).get("tasks") or []
            out.extend(t for t in batch if isinstance(t, dict))
            if len(batch) < 100:
                break
        return out

    def task(self, task_id: str) -> dict[str, Any]:
        self.calls += 1
        out = http.get_json(f"{BASE}/task/{http.quote(task_id)}", headers=self._h(), timeout=60)
        return out if isinstance(out, dict) else {}

    def comment(self, task_id: str, text: str) -> None:
        self.calls += 1
        http.post_json(
            f"{BASE}/task/{http.quote(task_id)}/comment",
            {"comment_text": text[:9000], "notify_all": False},
            headers=self._h(),
            timeout=60,
        )

    def comments(self, task_id: str) -> list[dict[str, Any]]:
        self.calls += 1
        out = http.get_json(f"{BASE}/task/{http.quote(task_id)}/comment", headers=self._h(), timeout=60)
        return [c for c in (out or {}).get("comments", []) if isinstance(c, dict)]

    def set_field(self, task_id: str, field_key: str, value: Any) -> None:
        fid = FIELD.get(field_key)
        if not fid:
            raise http.HttpError(0, f"unknown field {field_key}")
        self.calls += 1
        http.post_json(
            f"{BASE}/task/{http.quote(task_id)}/field/{fid}",
            {"value": value},
            headers=self._h(),
            timeout=60,
        )

    def set_status(self, task_id: str, status: str) -> None:
        self.calls += 1
        http.request("PUT", f"{BASE}/task/{http.quote(task_id)}", json_body={"status": status}, headers=self._h(), timeout=60)


def job_row(task: dict[str, Any], *, now_iso: str) -> dict[str, Any]:
    """One board task as an `editor_jobs` row. Worker state is not touched here."""
    f = fields_of(task)
    people = editors_of(task)
    status = str((task.get("status") or {}).get("status") or "")
    tags = [str(t.get("name") or "") for t in (task.get("tags") or []) if isinstance(t, dict)]
    footage = f.get("footage_folder") or f.get("raw_video") or f.get("drive_folder") or ""
    brief = str(task.get("description") or task.get("text_content") or "").strip()
    if not brief and f.get("notes"):
        brief = str(f["notes"]).strip()
    return {
        "task_id": str(task.get("id") or ""),
        "name": str(task.get("name") or ""),
        "url": task.get("url"),
        "status": status,
        "client": tags[0] if tags else None,
        "clients": tags,
        "editor": (people[0]["name"] or people[0]["email"]) if people else None,
        "editors": people,
        "request_type": f.get("request_type") or ("Edit" if "edit" in str(task.get("name", "")).lower() else "New"),
        "brief": brief or None,
        "footage_url": str(footage) or None,
        "raw_url": str(f.get("raw_video") or "") or None,
        "edited_url": str(f.get("edited_video") or "") or None,
        "website": str(f.get("website") or "") or None,
        "due_at": _iso(task.get("due_date")),
        "opened_at": _iso(task.get("date_created")),
        "synced_at": now_iso,
        "updated_at": now_iso,
    }
