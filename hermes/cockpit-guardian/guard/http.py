"""HTTP for the guardian: short timeouts, no retries by default, scrubbed errors.

A probe that cannot get an answer raises HttpError with status 0; the check
then says "could not be checked", never zero.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Optional

from .redact import scrub

USER_AGENT = "mahara-cockpit-guardian/1.0"
BROWSER_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


class HttpError(Exception):
    def __init__(self, status: int, message: str, body: bytes = b""):
        self.status = status
        self.body = body
        super().__init__(f"HTTP {status}: {scrub(message)}" if status else scrub(message))


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    body: bytes
    seconds: float

    def text(self, limit: int = 2_000_000) -> str:
        return self.body[:limit].decode("utf-8", "replace")

    def json(self) -> Any:
        try:
            return json.loads(self.body.decode("utf-8") or "null")
        except (ValueError, UnicodeDecodeError):
            return None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: D401 - urllib hook
        return None


def request(method: str, url: str, *, headers: Optional[dict[str, str]] = None, data: Optional[bytes] = None,
            json_body: Any = None, timeout: float = 20, retries: int = 0, follow: bool = True,
            max_bytes: int = 8_000_000) -> Response:
    """Any status comes back as a Response; only a network failure raises."""
    h = {"User-Agent": USER_AGENT}
    if headers:
        h.update(headers)
    if json_body is not None:
        data = json.dumps(json_body, ensure_ascii=False, default=str).encode("utf-8")
        h.setdefault("Content-Type", "application/json")
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(_NoRedirect)
    last: Optional[Exception] = None
    for attempt in range(retries + 1):
        started = time.monotonic()
        req = urllib.request.Request(url, data=data, headers=h, method=method.upper())
        try:
            with opener.open(req, timeout=timeout) as res:
                body = res.read(max_bytes)
                return Response(res.status, {k.lower(): v for k, v in res.headers.items()}, body, time.monotonic() - started)
        except urllib.error.HTTPError as e:
            body = b""
            try:
                body = e.read(max_bytes)
            except Exception:  # noqa: BLE001 - the body is a courtesy
                pass
            return Response(e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, body, time.monotonic() - started)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            last = HttpError(0, f"{type(e).__name__}: {getattr(e, 'reason', e)}")
            if attempt < retries:
                time.sleep(2 ** attempt)
    raise last if last else HttpError(0, "request failed")


def get(url: str, **kw: Any) -> Response:
    return request("GET", url, **kw)
