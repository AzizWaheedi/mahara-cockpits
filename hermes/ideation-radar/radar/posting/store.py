"""The posting tables and bucket in Creative Triage, through the radar's
Supabase client. Nothing here decides anything; it reads and writes rows."""
from __future__ import annotations

import json
import mimetypes
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from .. import http
from ..supabase import Supabase

BUCKET = "posting"
JOBS = "cockpit_post_jobs"
POSTS = "cockpit_posts"
CHANNELS = "cockpit_channels"
RUNNING_TTL_MIN = 45
MAX_ATTEMPTS = 3


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class PostStore:
    def __init__(self, sb: Supabase):
        self.sb = sb

    # ---- the queue --------------------------------------------------------
    def claim_jobs(self, limit: int = 2) -> list[dict[str, Any]]:
        """Queued jobs oldest first, plus any that have been running too long.

        A job that has failed three times is marked failed rather than tried
        forever; the cockpit shows the error and Aziz can queue it again.
        """
        now = datetime.now(timezone.utc)
        stale = (now - timedelta(minutes=RUNNING_TTL_MIN)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        queued = self.sb.select(JOBS, f"select=*&status=eq.queued&order=created_at.asc&limit={int(limit)}")
        hung = self.sb.select(JOBS, f"select=*&status=eq.running&started_at=lt.{stale}&order=created_at.asc&limit=5")
        out: list[dict[str, Any]] = []
        stamp = now_iso()
        for r in (queued + hung)[: int(limit)]:
            attempts = int(r.get("attempts") or 0) + 1
            where = f"id=eq.{int(r['id'])}"
            if attempts > MAX_ATTEMPTS:
                self.sb.patch(JOBS, where, {"status": "failed", "error": "Tried three times and never finished.", "attempts": attempts, "finished_at": stamp})
                continue
            self.sb.patch(JOBS, where, {"status": "running", "started_at": stamp, "attempts": attempts})
            r["attempts"] = attempts
            out.append(r)
        return out

    def finish_job(self, job: dict[str, Any], *, result: Optional[dict[str, Any]] = None, error: Optional[str] = None) -> None:
        body: dict[str, Any] = {"status": "failed" if error else "done", "finished_at": now_iso(), "error": (error or "")[:600] or None}
        if result is not None:
            body["result"] = result
        self.sb.patch(JOBS, f"id=eq.{int(job['id'])}", body)

    # ---- posts ----------------------------------------------------------------
    def post(self, post_id: int) -> Optional[dict[str, Any]]:
        rows = self.sb.select(POSTS, f"select=*&id=eq.{int(post_id)}&limit=1")
        return rows[0] if rows else None

    def patch_post(self, post_id: int, body: dict[str, Any]) -> None:
        self.sb.patch(POSTS, f"id=eq.{int(post_id)}", body)

    # ---- the bucket -----------------------------------------------------------
    def _object_url(self, path: str) -> str:
        return f"{self.sb.url}/storage/v1/object/{BUCKET}/{quote(path, safe='/')}"

    def upload(self, path: str, blob: bytes, content_type: str = "application/octet-stream") -> str:
        headers = self.sb._headers(extra={"Content-Type": content_type, "x-upsert": "true"})
        http.request("POST", self._object_url(path), headers=headers, data=blob, timeout=300, retries=1, ok_statuses=(200, 201))
        return path

    def upload_file(self, path: str, file: Path, content_type: Optional[str] = None) -> str:
        """A large file, streamed rather than read into memory."""
        ct = content_type or mimetypes.guess_type(str(file))[0] or "application/octet-stream"
        headers = self.sb._headers(extra={"Content-Type": ct, "x-upsert": "true", "Content-Length": str(file.stat().st_size)})
        with open(file, "rb") as fh:
            req = urllib.request.Request(self._object_url(path), data=fh, method="POST", headers=headers)
            with urllib.request.urlopen(req, timeout=1800) as res:
                if res.status not in (200, 201):
                    raise http.HttpError(res.status, f"upload {path}: HTTP {res.status}")
        return path

    def download(self, path: str) -> bytes:
        _, _, body = http.request("GET", self._object_url(path), headers=self.sb._headers(), timeout=300, retries=1)
        return body

    def download_to(self, path: str, dest: Path, *, max_bytes: int) -> int:
        """Stream an object to disk through a short signed link (no header on the download)."""
        return http.download(self.signed_url(path, 3600), str(dest), max_bytes=max_bytes, timeout=1800)

    def signed_url(self, path: str, expires_sec: int = 3600) -> str:
        _, _, out = self.sb.rest("POST", f"/storage/v1/object/sign/{BUCKET}/{quote(path, safe='/')}", json_body={"expiresIn": int(expires_sec)})
        signed = (out or {}).get("signedURL") or (out or {}).get("signedUrl")
        if not signed:
            raise http.HttpError(0, f"no signed link for {path}: {json.dumps(out)[:160]}")
        return f"{self.sb.url}/storage/v1{signed}"

    # ---- context ----------------------------------------------------------------
    def outliers(self, limit: int = 12) -> list[dict[str, Any]]:
        """What is winning on the Mahara board on YouTube right now, biggest multiple first."""
        params = (
            "select=key,platform,url,caption,hook,hook_kind,format_label,multiplier,views,author_handle"
            "&industry=eq.mahara&platform=eq.youtube&status=in.(proposed,saved)&multiplier=not.is.null"
            f"&order=multiplier.desc&limit={int(limit)}"
        )
        try:
            return self.sb.select("ideation_posts", params)
        except http.HttpError:
            return []

    def channel(self, platform: str) -> Optional[dict[str, Any]]:
        rows = self.sb.select(CHANNELS, f"select=*&platform=eq.{platform}&limit=1")
        return rows[0] if rows else None

    def set_channel(self, platform: str, **fields: Any) -> None:
        fields["checked_at"] = now_iso()
        self.sb.patch(CHANNELS, f"platform=eq.{platform}", fields)
