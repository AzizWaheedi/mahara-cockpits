"""The video itself, from wherever it was pointed at, into the bucket and
onto the disk the worker renders from. Drive through the team's OAuth
refresh token (the same one the editor desk uses), links straight through,
uploads already sit in the bucket."""
from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Optional

from .. import http
from ..config import Config, key
from .store import PostStore

MAX_BYTES = 2 * 1024 * 1024 * 1024
TOKEN_URL = "https://oauth2.googleapis.com/token"
FILES = "https://www.googleapis.com/drive/v3/files"
_DRIVE_ID = [
    re.compile(r"/file/d/([A-Za-z0-9_-]{10,})"),
    re.compile(r"[?&]id=([A-Za-z0-9_-]{10,})"),
    re.compile(r"^([A-Za-z0-9_-]{20,})$"),
]


def drive_id(ref: str) -> Optional[str]:
    v = (ref or "").strip()
    for pat in _DRIVE_ID:
        m = pat.search(v)
        if m:
            return m.group(1)
    return None


def google_token(*, scope_note: str = "drive") -> str:
    cid, secret, refresh = key("GOOGLE_CLIENT_ID"), key("GOOGLE_CLIENT_SECRET"), key("GOOGLE_REFRESH_TOKEN")
    if not (cid and secret and refresh):
        raise http.HttpError(0, f"GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN are needed for {scope_note}")
    body = urllib.parse.urlencode({"client_id": cid, "client_secret": secret, "refresh_token": refresh, "grant_type": "refresh_token"}).encode()
    _, _, raw = http.request("POST", TOKEN_URL, headers={"Content-Type": "application/x-www-form-urlencoded"}, data=body, timeout=30, retries=2)
    out = json.loads(raw or b"{}")
    if not out.get("access_token"):
        raise http.HttpError(0, "Google refused the refresh token")
    return str(out["access_token"])


def stream_to(url: str, dest: Path, *, headers: Optional[dict[str, str]] = None, max_bytes: int = MAX_BYTES, timeout: float = 1800) -> int:
    """A large download, written as it arrives."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers=headers or {})
    size = 0
    with urllib.request.urlopen(req, timeout=timeout) as res, open(dest, "wb") as fh:
        while True:
            chunk = res.read(1 << 20)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                raise http.HttpError(0, f"the video is bigger than {max_bytes // (1 << 20)} MB")
            fh.write(chunk)
    if size < 1000:
        raise http.HttpError(0, "the download was empty")
    return size


def fetch_video(cfg: Config, log: Callable[[str], None], store: PostStore, post: dict[str, Any], workdir: Path) -> tuple[Path, dict[str, Any]]:
    """The video on disk, and the fields to patch onto the post (video_path, size)."""
    kind = str(post.get("source_kind") or "")
    ref = str(post.get("source_ref") or "").strip()
    pid = int(post["id"])
    dest = workdir / "source.mp4"
    patch: dict[str, Any] = {}
    if post.get("video_path"):
        size = store.download_to(str(post["video_path"]), dest, max_bytes=MAX_BYTES)
        log(f"post {pid}: video from the bucket, {size >> 20} MB")
        return dest, patch
    if kind == "upload":
        size = store.download_to(ref, dest, max_bytes=MAX_BYTES)
        patch = {"video_path": ref, "size_bytes": size}
        log(f"post {pid}: uploaded file, {size >> 20} MB")
        return dest, patch
    if kind == "drive":
        fid = drive_id(ref)
        if not fid:
            raise ValueError("that is not a Google Drive file link")
        token = google_token(scope_note="Drive")
        q = urllib.parse.urlencode({"alt": "media", "supportsAllDrives": "true"})
        size = stream_to(f"{FILES}/{urllib.parse.quote(fid)}?{q}", dest, headers={"Authorization": f"Bearer {token}"})
        log(f"post {pid}: from Drive, {size >> 20} MB")
    elif kind == "url":
        if not ref.lower().startswith("http"):
            raise ValueError("that is not a link")
        size = stream_to(ref, dest, headers={"User-Agent": "Mozilla/5.0 (Mahara posting desk)"})
        log(f"post {pid}: from the link, {size >> 20} MB")
    else:
        raise ValueError(f"unknown source {kind!r}")
    path = f"posts/{pid}/source.mp4"
    store.upload_file(path, dest, "video/mp4")
    patch = {"video_path": path, "size_bytes": size}
    return dest, patch
