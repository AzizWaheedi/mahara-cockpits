"""HTTP with retries, backoff and scrubbed errors. Standard library only.

The same shape as the editor desk's http module, kept separate on purpose:
both run from cron on the same box and neither should be able to break the
other by a shared edit.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

USER_AGENT = "mahara-sales-desk/1.0"
# Fathom is called with a browser's user agent, as webinar-pull does: the
# HighLevel side of the same stack sits behind Cloudflare, which refused
# Python's default one (error 1010, 2026-09-23).
BROWSER_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
RETRY_STATUSES = (408, 425, 429, 500, 502, 503, 504, 529)

# Anything that looks like a key is replaced before an error is logged or
# stored. Model providers echo part of a refused key back in their error body.
_KEEP_PREFIX = (
    re.compile(r"(?i)(bearer\s+)[^\s\"',)}\]]+"),
    re.compile(r"(?i)((?:x-api-key|apikey|api[_-]key|access_token|refresh_token|client_secret|token|key)\s*[=:]\s*[\"']?)[^\s\"'&,)}\]]+"),
)
_WHOLE = (
    re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_\-*.]{6,}"),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{4,}"),
)


class HttpError(Exception):
    def __init__(self, status: int, message: str, body: bytes = b"", url: str = ""):
        self.status = status
        self.body = body
        self.url = url
        super().__init__(f"HTTP {status}: {scrub(message)}" if status else scrub(message))

    @property
    def timed_out(self) -> bool:
        text = str(self).lower()
        return self.status == 0 and ("timed out" in text or "timeout" in text)


def scrub(text: Any) -> str:
    """Never let a key reach a log line, a Supabase row or the cockpit."""
    out = str(text)
    for pattern in _KEEP_PREFIX:
        out = pattern.sub(lambda m: m.group(1) + "<hidden>", out)
    for pattern in _WHOLE:
        out = pattern.sub("<hidden>", out)
    return out


def _retry_after(headers: Any) -> Optional[float]:
    try:
        v = headers.get("Retry-After")
        return float(v) if v else None
    except (AttributeError, TypeError, ValueError):
        return None


def request(
    method: str,
    url: str,
    *,
    headers: Optional[dict[str, str]] = None,
    data: Optional[bytes] = None,
    json_body: Any = None,
    timeout: float = 60,
    retries: int = 2,
    ok_statuses: tuple[int, ...] = (200, 201, 202, 204),
) -> tuple[int, dict[str, str], bytes]:
    h = {"User-Agent": USER_AGENT}
    if headers:
        h.update(headers)
    if json_body is not None:
        data = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
        h.setdefault("Content-Type", "application/json")
    last: Optional[Exception] = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, headers=h, method=method.upper())
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                body = res.read()
                if res.status not in ok_statuses:
                    raise HttpError(res.status, body[:400].decode("utf-8", "replace"), body, url)
                return res.status, {k: v for k, v in res.headers.items()}, body
        except urllib.error.HTTPError as e:
            body = e.read() if hasattr(e, "read") else b""
            last = HttpError(e.code, body[:600].decode("utf-8", "replace"), body, url)
            if e.code not in RETRY_STATUSES or attempt == retries:
                raise last
            wait = _retry_after(e.headers) or (2**attempt)
            time.sleep(min(wait, 30))
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = HttpError(0, f"{type(e).__name__}: {e}", b"", url)
            if attempt == retries:
                raise last
            time.sleep(2**attempt)
    raise last if last else HttpError(0, "request failed", b"", url)


def open_stream(url: str, *, headers: dict[str, str], json_body: Any, timeout: float) -> Any:
    """POST and hand back the open response, to be read line by line.

    `timeout` is the longest the socket may stay silent, not a budget for the
    whole answer. That is the reason the drafts stream at all: a proposal takes
    minutes to write, and against a blocking read no timeout can tell a slow
    answer from a hung one (run_proposal.py, where the first clean draft took
    374 seconds).
    """
    h = {"User-Agent": USER_AGENT, "Content-Type": "application/json", "Accept": "text/event-stream"}
    h.update(headers)
    data = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=h, method="POST")
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        body = e.read() if hasattr(e, "read") else b""
        raise HttpError(e.code, body[:600].decode("utf-8", "replace"), body, url)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise HttpError(0, f"{type(e).__name__}: {e}", b"", url)


def get_json(url: str, **kw: Any) -> Any:
    _, _, body = request("GET", url, **kw)
    return json.loads(body.decode("utf-8")) if body else None


def post_json(url: str, payload: Any, **kw: Any) -> Any:
    _, _, body = request("POST", url, json_body=payload, **kw)
    return json.loads(body.decode("utf-8")) if body else None


def quote(value: Any) -> str:
    return urllib.parse.quote(str(value), safe="")
