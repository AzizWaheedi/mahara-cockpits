"""HTTP with retries, backoff and no secrets in error text. Standard library only (the radar's, trimmed).

Every outside call goes through here: a timeout on every request, retries on 429, 5xx and network errors,
Retry-After honoured, and tokens scrubbed from any message that could reach a log or a sentence.
"""
from __future__ import annotations

import http.client
import json
import random
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Optional

USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 market-intel/1.0"
_SECRET_RE = re.compile(r"(token|key|secret|apikey|api_key|authorization)=([^&\s]+)", re.I)

sleep: Callable[[float], None] = time.sleep


class HttpError(Exception):
    def __init__(self, status: int, message: str, body: bytes = b"", url: str = ""):
        super().__init__(f"HTTP {status}: {scrub(message)}")
        self.status = status
        self.body = body
        self.url = scrub(url)


def scrub(text: str) -> str:
    return _SECRET_RE.sub(r"\1=<hidden>", text or "")


def _retry_after(headers: Any) -> Optional[float]:
    try:
        v = headers.get("Retry-After") if headers else None
        return float(v) if v else None
    except (TypeError, ValueError):
        return None


def request(method: str, url: str, *, headers: Optional[dict[str, str]] = None, data: Optional[bytes] = None,
            json_body: Any = None, timeout: float = 60, retries: int = 3, backoff: float = 2.0,
            ok_statuses: tuple[int, ...] = (200, 201, 202, 204),
            opener: Optional[urllib.request.OpenerDirector] = None) -> tuple[int, dict[str, str], bytes]:
    """`opener`: a caller's own (the website fetcher's refuses private addresses on every hop)."""
    open_ = opener.open if opener is not None else urllib.request.urlopen
    hdrs = {"User-Agent": USER_AGENT}
    if headers:
        hdrs.update(headers)
    body = data
    if json_body is not None:
        body = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")
    last: Optional[Exception] = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=body, method=method.upper(), headers=hdrs)
        try:
            with open_(req, timeout=timeout) as res:
                status = res.getcode()
                out = res.read()
                if status in ok_statuses:
                    return status, {k: v for k, v in res.headers.items()}, out
                raise HttpError(status, "unexpected status", out, url)
        except urllib.error.HTTPError as e:
            out = b""
            try:
                out = e.read()
            except Exception:  # noqa: BLE001
                pass
            last = HttpError(e.code, out[:300].decode("utf-8", "replace") or str(e.reason), out, url)
            if not (e.code == 429 or e.code >= 500) or attempt >= retries:
                raise last
            sleep(min(_retry_after(e.headers) or (backoff ** attempt) * (1 + random.random() * 0.5), 120))
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, http.client.HTTPException) as e:
            last = e
            if attempt >= retries:
                raise HttpError(0, f"network error: {scrub(str(e))[:200]}", b"", url)
            sleep(min((backoff ** attempt) * (1 + random.random() * 0.5), 60))
    assert last is not None
    raise last


def get_json(url: str, **kw: Any) -> Any:
    _, _, body = request("GET", url, **kw)
    return json.loads(body.decode("utf-8")) if body else None


def post_json(url: str, payload: Any, **kw: Any) -> Any:
    _, _, body = request("POST", url, json_body=payload, **kw)
    return json.loads(body.decode("utf-8")) if body else None


def open_stream(url: str, *, headers: dict[str, str], json_body: Any, timeout: float) -> Any:
    """POST and hand back the open response, read line by line. `timeout` is the longest silence, not a budget."""
    h = {"User-Agent": USER_AGENT, "Content-Type": "application/json", "Accept": "text/event-stream"}
    h.update(headers)
    req = urllib.request.Request(url, data=json.dumps(json_body, ensure_ascii=False).encode("utf-8"), headers=h,
                                 method="POST")
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        body = e.read() if hasattr(e, "read") else b""
        raise HttpError(e.code, body[:600].decode("utf-8", "replace"), body, url)
    except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException, ValueError) as e:
        raise HttpError(0, f"{type(e).__name__}: {scrub(str(e))[:200]}", b"", url)


def encode_query(params: dict[str, Any]) -> str:
    return urllib.parse.urlencode({k: v for k, v in params.items() if v is not None and v != ""})


def resource_of(url: str, *, host_only: bool = False) -> str:
    """What the ledger records for a call: scheme, host and path, never the query (keys live there)."""
    p = urllib.parse.urlsplit(url)
    if host_only:
        return f"{p.scheme}://{p.netloc}/"[:200]
    return f"{p.scheme}://{p.netloc}{p.path}"[:200]
