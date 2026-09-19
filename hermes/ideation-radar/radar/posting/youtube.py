"""YouTube through the Data API with the team's own OAuth client and a
refresh token Aziz grants once. The token lives in the radar home on the
VPS and nowhere else; the cockpit only ever sees the consent link and, after
that, the channel name.

The consent uses the loopback redirect Google allows a desktop client
(`http://localhost`), which lands on a page that does not exist; Aziz pastes
that page's address into the cockpit and the worker exchanges the code."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

from .. import http
from ..config import key

SCOPES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.readonly"
REDIRECT = "http://localhost"
AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/youtube/v3"
UPLOAD = "https://www.googleapis.com/upload/youtube/v3"
CHUNK = 32 * 1024 * 1024


def token_path() -> Path:
    return Path(key("RADAR_HOME", str(Path.home() / ".ideation-radar"))).expanduser() / "youtube.json"


def client() -> tuple[str, str]:
    cid, secret = key("GOOGLE_CLIENT_ID"), key("GOOGLE_CLIENT_SECRET")
    if not (cid and secret):
        raise http.HttpError(0, "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are needed for YouTube")
    return cid, secret


def auth_url() -> str:
    cid, _ = client()
    q = urllib.parse.urlencode({
        "client_id": cid, "redirect_uri": REDIRECT, "response_type": "code", "scope": SCOPES,
        "access_type": "offline", "prompt": "consent", "include_granted_scopes": "true",
    })
    return f"{AUTH}?{q}"


def parse_code(pasted: str) -> str:
    """The code out of the address bar, or the code itself."""
    v = (pasted or "").strip()
    if "code=" in v:
        qs = urllib.parse.urlparse(v).query if "?" in v else v
        code = urllib.parse.parse_qs(qs).get("code", [""])[0]
        return urllib.parse.unquote(code)
    return v


def connected() -> bool:
    try:
        return bool(json.loads(token_path().read_text()).get("refresh_token"))
    except (OSError, ValueError):
        return False


def _post_form(url: str, fields: dict[str, str]) -> dict[str, Any]:
    body = urllib.parse.urlencode(fields).encode()
    _, _, raw = http.request("POST", url, headers={"Content-Type": "application/x-www-form-urlencoded"}, data=body, timeout=30, retries=1, ok_statuses=(200,))
    return json.loads(raw or b"{}")


def exchange(pasted: str) -> dict[str, Any]:
    code = parse_code(pasted)
    if not code:
        raise ValueError("no code in what was pasted")
    cid, secret = client()
    out = _post_form(TOKEN, {"code": code, "client_id": cid, "client_secret": secret, "redirect_uri": REDIRECT, "grant_type": "authorization_code"})
    if not out.get("refresh_token"):
        raise http.HttpError(0, f"Google gave no refresh token: {json.dumps(out)[:160]}")
    p = token_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"refresh_token": out["refresh_token"], "scope": out.get("scope"), "granted_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()}))
    os.chmod(p, 0o600)
    return channel_mine()


def access_token() -> str:
    try:
        refresh = json.loads(token_path().read_text())["refresh_token"]
    except (OSError, ValueError, KeyError):
        raise http.HttpError(0, "YouTube is not connected yet: open the consent link on the Posting tab")
    cid, secret = client()
    out = _post_form(TOKEN, {"refresh_token": refresh, "client_id": cid, "client_secret": secret, "grant_type": "refresh_token"})
    if not out.get("access_token"):
        raise http.HttpError(0, "Google refused the YouTube refresh token; connect again from the Posting tab")
    return str(out["access_token"])


def _api(method: str, path: str, *, params: Optional[dict[str, Any]] = None, json_body: Any = None) -> dict[str, Any]:
    q = urllib.parse.urlencode(params or {})
    _, _, raw = http.request(method, f"{API}/{path}?{q}", headers={"Authorization": f"Bearer {access_token()}"}, json_body=json_body, timeout=60, retries=1)
    return json.loads(raw or b"{}")


def channel_mine() -> dict[str, Any]:
    out = _api("GET", "channels", params={"part": "snippet,statistics", "mine": "true"})
    items = out.get("items") or []
    if not items:
        raise http.HttpError(0, "the Google account that consented has no YouTube channel")
    c = items[0]
    sn = c.get("snippet") or {}
    return {"id": c.get("id"), "title": sn.get("title"), "handle": (sn.get("customUrl") or "").lstrip("@"), "subscribers": (c.get("statistics") or {}).get("subscriberCount")}


def upload(path: Path, *, title: str, description: str, tags: list[str], privacy: str = "private", language: str = "ar", category: str = "27") -> str:
    """Resumable upload in 32 MB chunks; returns the video id."""
    size = path.stat().st_size
    meta = {
        "snippet": {"title": title[:100], "description": description[:5000], "tags": tags[:30], "categoryId": category, "defaultLanguage": language, "defaultAudioLanguage": language},
        "status": {"privacyStatus": privacy, "selfDeclaredMadeForKids": False},
    }
    q = urllib.parse.urlencode({"uploadType": "resumable", "part": "snippet,status"})
    req = urllib.request.Request(f"{UPLOAD}/videos?{q}", data=json.dumps(meta).encode(), method="POST", headers={
        "Authorization": f"Bearer {access_token()}", "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/*", "X-Upload-Content-Length": str(size),
    })
    with urllib.request.urlopen(req, timeout=60) as res:
        session = res.headers.get("Location")
    if not session:
        raise http.HttpError(0, "YouTube gave no upload session")
    sent = 0
    with open(path, "rb") as fh:
        while sent < size:
            chunk = fh.read(CHUNK)
            end = sent + len(chunk) - 1
            r = urllib.request.Request(session, data=chunk, method="PUT", headers={"Content-Length": str(len(chunk)), "Content-Range": f"bytes {sent}-{end}/{size}"})
            try:
                with urllib.request.urlopen(r, timeout=600) as res:
                    if res.status in (200, 201):
                        out = json.loads(res.read() or b"{}")
                        vid = out.get("id")
                        if not vid:
                            raise http.HttpError(0, "YouTube finished the upload without a video id")
                        return str(vid)
                    sent = end + 1
            except urllib.error.HTTPError as e:
                if e.code == 308:
                    rng = e.headers.get("Range") or ""
                    sent = int(rng.split("-")[-1]) + 1 if "-" in rng else end + 1
                    fh.seek(sent)
                    continue
                raise http.HttpError(e.code, f"YouTube upload failed: {e.read()[:200]!r}")
    raise http.HttpError(0, "YouTube upload ended without a video id")


def set_thumbnail(video_id: str, jpeg: bytes) -> None:
    q = urllib.parse.urlencode({"videoId": video_id})
    http.request("POST", f"{UPLOAD}/thumbnails/set?{q}", headers={"Authorization": f"Bearer {access_token()}", "Content-Type": "image/jpeg"}, data=jpeg, timeout=120, retries=1)


def set_privacy(video_id: str, privacy: str) -> None:
    _api("PUT", "videos", params={"part": "status"}, json_body={"id": video_id, "status": {"privacyStatus": privacy, "selfDeclaredMadeForKids": False}})


def video_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"
