"""Google Drive through the team's existing OAuth refresh token.

The VPS carries GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
GOOGLE_REFRESH_TOKEN with the full Drive scope (checked 2026-09-18), which
reaches the client folders a service account would not see. Nothing is ever
written to Drive by this module except into a folder the caller names.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any, Callable, Optional

from . import http
from .config import Config

TOKEN_URL = "https://oauth2.googleapis.com/token"
FILES = "https://www.googleapis.com/drive/v3/files"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"

FOLDER_MIME = "application/vnd.google-apps.folder"
SHORTCUT_MIME = "application/vnd.google-apps.shortcut"
FILE_FIELDS = (
    "id,name,mimeType,size,md5Checksum,createdTime,modifiedTime,webViewLink,"
    "videoMediaMetadata(width,height,durationMillis),parents,shortcutDetails(targetId,targetMimeType)"
)
# What the client success Drive import reads (docs/csm-decks/DRIVE-IMPORT.md 7).
IMPORT_FIELDS = (
    "id,name,mimeType,size,createdTime,trashed,shortcutDetails,capabilities(canDownload),resourceKey,"
    "owners(emailAddress),driveId,parents"
)


def resource_key_header(resource_keys: Optional[dict[str, Optional[str]]]) -> dict[str, str]:
    """A file shared by link before 2021 needs its resource key, sent as one
    header: `X-Goog-Drive-Resource-Keys: <id>/<key>[,<id>/<key>...]`."""
    pairs = [f"{fid}/{key}" for fid, key in (resource_keys or {}).items() if fid and key]
    return {"X-Goog-Drive-Resource-Keys": ",".join(pairs)} if pairs else {}

# Any Drive link shape the team pastes into ClickUp.
_ID_PATTERNS = [
    re.compile(r"/folders/([A-Za-z0-9_-]{10,})"),
    re.compile(r"/file/d/([A-Za-z0-9_-]{10,})"),
    re.compile(r"/document/d/([A-Za-z0-9_-]{10,})"),
    re.compile(r"[?&]id=([A-Za-z0-9_-]{10,})"),
]


def parse_id(link: str) -> Optional[str]:
    """The Drive id inside a pasted link, or None when there is not one."""
    text = (link or "").strip()
    if not text:
        return None
    for pat in _ID_PATTERNS:
        m = pat.search(text)
        if m:
            return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{20,}", text):
        return text
    return None


# The footage folder rule (2026-10-22). Linked folders often hold finished
# work beside the raw clips: the Clients V2 template has "Completed Ads /
# EDITED" next to "Raw Videos", and some cards link a client's whole archive.
_RAW_FOLDER = re.compile(r"\b(raw\s+(videos?|footage|clips?)|client\s+footage|footage)\b|(?:^|\s)(?:ال)?خام(?:$|\s)")
_FINISHED_FOLDER = re.compile(
    r"\b(completed|edited|final|finals|finished|exports?|promos?|promotions?|posts|reels|published)\b"
    r"|نهائي|نهائيه|نهائية|منشور"
)


def _folder_name(name: Any) -> str:
    return " ".join(str(name or "").lower().split())


def is_raw_folder(name: Any) -> bool:
    """A folder that holds the client's raw clips: "Raw Videos", "Client Footage"."""
    n = _folder_name(name)
    return bool(_RAW_FOLDER.search(n)) and not _FINISHED_FOLDER.search(n)


def is_finished_folder(name: Any) -> bool:
    """A folder of finished work: "Completed Ads", "EDITED", "Final", "نهائي", promos, posts, reels."""
    return bool(_FINISHED_FOLDER.search(_folder_name(name)))


def _folder_id(f: dict[str, Any]) -> Optional[str]:
    """The folder a listing entry opens: a folder, or a shortcut to one."""
    if f.get("mimeType") == FOLDER_MIME:
        return str(f.get("id") or "") or None
    target = f.get("shortcutDetails") or {}
    if f.get("mimeType") == SHORTCUT_MIME and target.get("targetMimeType") == FOLDER_MIME:
        return str(target.get("targetId") or "") or None
    return None


def is_video(f: dict[str, Any]) -> bool:
    mime = str(f.get("mimeType") or "")
    if mime.startswith("video/"):
        return True
    name = str(f.get("name") or "").lower()
    return name.endswith((".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"))


class Drive:
    def __init__(self, cfg: Config, log: Optional[Callable[[str], None]] = None):
        if not cfg.google_configured:
            raise http.HttpError(0, "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN are required")
        self.cfg = cfg
        self.log = log or (lambda m: None)
        self._token = ""
        self._expires = 0.0
        self.calls = 0
        self.more = False  # whether the last list_folder stopped with a page left

    # ---- auth ------------------------------------------------------------
    def token(self) -> str:
        if self._token and time.time() < self._expires - 60:
            return self._token
        out = http.post_form(
            TOKEN_URL,
            {
                "client_id": self.cfg.google_client_id,
                "client_secret": self.cfg.google_client_secret,
                "refresh_token": self.cfg.google_refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=30,
            retries=2,
        )
        if not isinstance(out, dict) or not out.get("access_token"):
            raise http.HttpError(0, "Google refused the refresh token")
        self._token = str(out["access_token"])
        self._expires = time.time() + float(out.get("expires_in") or 3600)
        return self._token

    def forget_token(self) -> None:
        """Drop the cached access token, so the next call mints a fresh one
        (once, after a 401)."""
        self._token = ""
        self._expires = 0.0

    def _headers(self, extra: Optional[dict[str, str]] = None) -> dict[str, str]:
        h = {"Authorization": f"Bearer {self.token()}"}
        if extra:
            h.update(extra)
        return h

    # ---- reading ---------------------------------------------------------
    def get(
        self,
        file_id: str,
        *,
        fields: str = FILE_FIELDS,
        resource_keys: Optional[dict[str, Optional[str]]] = None,
    ) -> dict[str, Any]:
        self.calls += 1
        q = http.encode_query({"fields": fields, "supportsAllDrives": "true"})
        out = http.get_json(
            f"{FILES}/{http.quote(file_id)}?{q}",
            headers=self._headers(resource_key_header(resource_keys)),
            timeout=60,
        )
        return out if isinstance(out, dict) else {}

    def list_folder(
        self,
        folder_id: str,
        *,
        pages: int = 4,
        fields: str = FILE_FIELDS,
        order_by: str = "folder,createdTime",
        q_extra: str = "",
        page_size: int = 200,
        resource_keys: Optional[dict[str, Optional[str]]] = None,
        stop_after: Optional[Callable[[list[dict[str, Any]]], bool]] = None,
    ) -> list[dict[str, Any]]:
        """Everything directly inside a folder. Trashed files are skipped.

        `q_extra` is appended to the query (" and mimeType != ..."), and
        `stop_after(items)` returning true ends the listing early. Afterwards
        `self.more` says whether Drive still had a page when it stopped.
        """
        items: list[dict[str, Any]] = []
        token = None
        self.more = False
        for _ in range(max(1, pages)):
            self.calls += 1
            q = http.encode_query({
                "q": f"'{folder_id}' in parents and trashed=false{q_extra}",
                "fields": f"nextPageToken,files({fields})",
                "pageSize": page_size,
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
                "pageToken": token,
                "orderBy": order_by,
            })
            out = http.get_json(f"{FILES}?{q}", headers=self._headers(resource_key_header(resource_keys)), timeout=90)
            if not isinstance(out, dict):
                token = None
                break
            items.extend(x for x in (out.get("files") or []) if isinstance(x, dict))
            token = out.get("nextPageToken")
            if not token or (stop_after is not None and stop_after(items)):
                break
        self.more = bool(token)
        return items

    def follow(self, shortcut: dict[str, Any]) -> Optional[dict[str, Any]]:
        """The file a shortcut points to, under the shortcut's own id.

        Drive refuses to download a shortcut (HTTP 403): the 12 clips of one
        job on 2026-10-22 were all shortcuts into a client's shared drive.
        The row keeps the shortcut's id, so the failed rows already stored
        for it are replaced by the read, and `target_id` is what is fetched.
        A target the desk cannot open stays a shortcut, so its download
        fails with a reason on the clip instead of the clip vanishing.
        """
        tid = str((shortcut.get("shortcutDetails") or {}).get("targetId") or "")
        if not tid:
            return None
        try:
            target = self.get(tid)
        except http.HttpError as e:
            self.log(f"shortcut {shortcut.get('id')}: its target could not be read: {http.scrub(str(e))[:120]}")
            return {**shortcut, "target_id": tid}
        return {**target, "id": shortcut.get("id"), "name": shortcut.get("name") or target.get("name"), "target_id": tid}

    def videos_under(self, folder_id: str, *, depth: int = 2, limit: int = 50, name: str = "") -> list[dict[str, Any]]:
        """Video files in a folder and its subfolders, newest last, bounded.
        A shortcut to a video counts as that video; a shortcut to a folder
        is walked like a subfolder.

        The footage folder rule: when the linked folder (`name`) is not itself
        raw footage and holds a raw-footage folder ("Raw Videos", "Client
        Footage"), only those folders are read, and loose videos beside them
        are not. A folder named for finished work ("Completed Ads", "EDITED",
        "Final", "نهائي", promos, posts, reels) is never walked."""
        found: list[dict[str, Any]] = []
        frontier = [(folder_id, 0)]
        seen: set[str] = set()
        while frontier and len(found) < limit:
            fid, level = frontier.pop(0)
            if fid in seen:
                continue
            seen.add(fid)
            items = self.list_folder(fid)
            if level == 0 and not is_raw_folder(name):
                raw = [_folder_id(f) for f in items if _folder_id(f) and is_raw_folder(f.get("name"))]
                if raw:
                    frontier.extend((r, 1) for r in raw if r)
                    continue
            for f in items:
                if f.get("mimeType") == SHORTCUT_MIME:
                    target = f.get("shortcutDetails") or {}
                    kind = str(target.get("targetMimeType") or "")
                    if kind == FOLDER_MIME:
                        if level < depth and target.get("targetId") and not is_finished_folder(f.get("name")):
                            frontier.append((str(target["targetId"]), level + 1))
                        continue
                    if not kind.startswith("video/"):
                        continue
                    followed = self.follow(f)
                    if followed:
                        found.append(followed)
                        if len(found) >= limit:
                            break
                    continue
                if f.get("mimeType") == FOLDER_MIME:
                    if level < depth and not is_finished_folder(f.get("name")):
                        frontier.append((f["id"], level + 1))
                elif is_video(f):
                    found.append(f)
                    if len(found) >= limit:
                        break
        found.sort(key=lambda f: str(f.get("createdTime") or ""))
        return found

    def download(
        self,
        file_id: str,
        dest: str,
        *,
        max_bytes: int,
        resource_keys: Optional[dict[str, Optional[str]]] = None,
        timeout: float = 1800,
        deadline: Optional[float] = None,
        on_chunk: Optional[Callable[[int], None]] = None,
    ) -> int:
        q = http.encode_query({"alt": "media", "supportsAllDrives": "true"})
        return http.download(
            f"{FILES}/{http.quote(file_id)}?{q}", dest, max_bytes=max_bytes,
            headers=self._headers(resource_key_header(resource_keys)), timeout=timeout,
            deadline=deadline, on_chunk=on_chunk,
        )

    def doc_text(self, file_id: str) -> str:
        """A Google Doc exported as plain text: the brief, when it lives in a Doc."""
        try:
            q = http.encode_query({"mimeType": "text/plain", "supportsAllDrives": "true"})
            _, _, body = http.request("GET", f"{FILES}/{http.quote(file_id)}/export?{q}", headers=self._headers(), timeout=90, retries=1)
            return body.decode("utf-8", "replace").strip()
        except http.HttpError:
            return ""

    # ---- writing ---------------------------------------------------------
    def find_child(self, parent_id: str, name: str) -> Optional[dict[str, Any]]:
        safe = name.replace("'", "\\'")
        q = http.encode_query({
            "q": f"'{parent_id}' in parents and name='{safe}' and trashed=false",
            "fields": f"files({FILE_FIELDS})",
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        })
        out = http.get_json(f"{FILES}?{q}", headers=self._headers(), timeout=60)
        files = (out or {}).get("files") or []
        return files[0] if files else None

    def ensure_folder(self, parent_id: str, name: str) -> str:
        existing = self.find_child(parent_id, name)
        if existing and existing.get("mimeType") == FOLDER_MIME:
            return str(existing["id"])
        out = http.post_json(
            f"{FILES}?{http.encode_query({'fields': 'id', 'supportsAllDrives': 'true'})}",
            {"name": name, "mimeType": FOLDER_MIME, "parents": [parent_id]},
            headers=self._headers(),
            timeout=60,
        )
        return str((out or {}).get("id") or "")

    def copy_into(self, file_id: str, parent_id: str, name: str = "") -> dict[str, Any]:
        """Copy an existing Drive file into a folder. No bytes move through this box."""
        body: dict[str, Any] = {"parents": [parent_id]}
        if name:
            body["name"] = name
        out = http.post_json(
            f"{FILES}/{http.quote(file_id)}/copy?{http.encode_query({'fields': FILE_FIELDS, 'supportsAllDrives': 'true'})}",
            body,
            headers=self._headers(),
            timeout=180,
        )
        return out if isinstance(out, dict) else {}

    def upload(self, parent_id: str, name: str, blob: bytes, mime: str = "application/octet-stream") -> dict[str, Any]:
        """Small multipart upload, for stills and text, not for video."""
        meta = json.dumps({"name": name, "parents": [parent_id]}, ensure_ascii=False).encode("utf-8")
        boundary = "----maharadrive" + str(int(time.time() * 1000))
        body = b"".join([
            f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode(),
            meta,
            f"\r\n--{boundary}\r\nContent-Type: {mime}\r\n\r\n".encode(),
            blob,
            f"\r\n--{boundary}--\r\n".encode(),
        ])
        q = http.encode_query({"uploadType": "multipart", "fields": FILE_FIELDS, "supportsAllDrives": "true"})
        _, _, out = http.request(
            "POST",
            f"{UPLOAD}?{q}",
            data=body,
            headers=self._headers({"Content-Type": f"multipart/related; boundary={boundary}"}),
            timeout=300,
            retries=1,
        )
        return json.loads(out.decode("utf-8")) if out else {}


def preview_url(file_id: str) -> str:
    """Drive plays video in this frame, so the desk stores no proxies of its own."""
    return f"https://drive.google.com/file/d/{file_id}/preview"


def view_url(file_id: str) -> str:
    return f"https://drive.google.com/file/d/{file_id}/view"
