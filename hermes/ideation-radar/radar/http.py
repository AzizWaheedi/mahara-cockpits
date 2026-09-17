"""HTTP with retries, backoff and no secrets in error text. Standard library only.

Every outside call in the radar goes through here so the behaviour is the
same everywhere: a timeout on every request, retries on 429 and 5xx and on
network errors, Retry-After honoured, exponential backoff with jitter, and
tokens scrubbed from any message that could reach a log or Slack.
"""
from __future__ import annotations

import json
import random
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Callable, Optional

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 ideation-radar/1.0"

_SECRET_RE = re.compile(r"(token|key|secret|apikey|api_key|authorization)=([^&\s]+)", re.I)

# Overridable in tests.
sleep: Callable[[float], None] = time.sleep


class HttpError(Exception):
    def __init__(self, status: int, message: str, body: bytes = b"", url: str = ""):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.body = body
        self.url = scrub(url)


def scrub(text: str) -> str:
    """Remove token-like query values from a URL or message."""
    return _SECRET_RE.sub(r"\1=<hidden>", text or "")


def _retry_after(headers: Any) -> Optional[float]:
    try:
        v = headers.get("Retry-After") if headers else None
        return float(v) if v else None
    except (TypeError, ValueError):
        return None


def request(
    method: str,
    url: str,
    *,
    headers: Optional[dict[str, str]] = None,
    data: Optional[bytes] = None,
    json_body: Any = None,
    timeout: float = 60,
    retries: int = 3,
    backoff: float = 2.0,
    ok_statuses: tuple[int, ...] = (200, 201, 202, 204),
) -> tuple[int, dict[str, str], bytes]:
    """Perform one HTTP request with retries. Returns (status, headers, body)."""
    hdrs = {"User-Agent": USER_AGENT}
    if headers:
        hdrs.update(headers)
    body = data
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")
    last_error: Optional[Exception] = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=body, method=method.upper(), headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                status = res.getcode()
                out = res.read()
                resp_headers = {k: v for k, v in res.headers.items()}
                if status in ok_statuses:
                    return status, resp_headers, out
                raise HttpError(status, "unexpected status", out, url)
        except urllib.error.HTTPError as e:
            out = b""
            try:
                out = e.read()
            except Exception:
                pass
            status = e.code
            retryable = status == 429 or status >= 500
            last_error = HttpError(status, (out[:300].decode("utf-8", "replace") or e.reason), out, url)
            if not retryable or attempt >= retries:
                raise last_error
            wait = _retry_after(e.headers) or (backoff ** attempt) * (1 + random.random() * 0.5)
            sleep(min(wait, 120))
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last_error = e
            if attempt >= retries:
                raise HttpError(0, f"network error: {scrub(str(e))}", b"", url)
            sleep(min((backoff ** attempt) * (1 + random.random() * 0.5), 60))
    assert last_error is not None
    raise last_error


def get_json(url: str, **kw: Any) -> Any:
    _, _, body = request("GET", url, **kw)
    return json.loads(body.decode("utf-8")) if body else None


def post_json(url: str, payload: Any, **kw: Any) -> Any:
    _, _, body = request("POST", url, json_body=payload, **kw)
    return json.loads(body.decode("utf-8")) if body else None


def post_multipart(
    url: str,
    fields: dict[str, str],
    files: dict[str, tuple[str, bytes, str]],
    *,
    headers: Optional[dict[str, str]] = None,
    timeout: float = 300,
    retries: int = 1,
) -> Any:
    """POST multipart/form-data. files = {field: (filename, bytes, content_type)}."""
    boundary = "----radar" + uuid.uuid4().hex
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(
            (
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            ).encode("utf-8")
        )
    for name, (filename, blob, ctype) in files.items():
        parts.append(
            (
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: {ctype}\r\n\r\n"
            ).encode("utf-8")
            + blob
            + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(parts)
    hdrs = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if headers:
        hdrs.update(headers)
    _, _, out = request("POST", url, headers=hdrs, data=body, timeout=timeout, retries=retries)
    return json.loads(out.decode("utf-8")) if out else None


def download(url: str, path: str, *, max_bytes: int, timeout: float = 180) -> int:
    """Stream a file to disk with a size cap. Returns bytes written."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    written = 0
    with urllib.request.urlopen(req, timeout=timeout) as res, open(path, "wb") as fh:
        while True:
            chunk = res.read(1 << 16)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                raise HttpError(0, f"file exceeds {max_bytes} bytes", b"", url)
            fh.write(chunk)
    return written


def resolve_redirect(url: str, timeout: float = 20) -> str:
    """Follow redirects (HEAD, then GET) and return the final URL."""
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.geturl()
        except urllib.error.HTTPError as e:
            if e.code in (405, 403) and method == "HEAD":
                continue
            return e.geturl() if hasattr(e, "geturl") and e.geturl() else url
        except (urllib.error.URLError, OSError):
            return url
    return url


def encode_query(params: dict[str, Any]) -> str:
    return urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
