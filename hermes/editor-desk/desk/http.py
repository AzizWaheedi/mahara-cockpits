"""HTTP with retries, backoff and scrubbed errors. Standard library only.

The same shape as the ideation radar's http module, kept separate on purpose:
both run from cron on the same box and neither should be able to break the
other by a shared edit.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

USER_AGENT = "mahara-editor-desk/1.0"
RETRY_STATUSES = (408, 425, 429, 500, 502, 503, 504)

# Anything that looks like a key is replaced before an error is logged or stored.
_SECRET_HINTS = ("key=", "token=", "Bearer ", "xi-api-key", "access_token", "refresh_token", "client_secret")


class HttpError(Exception):
    def __init__(self, status: int, message: str, body: bytes = b"", url: str = ""):
        self.status = status
        self.body = body
        self.url = url
        super().__init__(f"HTTP {status}: {scrub(message)}" if status else scrub(message))


def scrub(text: str) -> str:
    """Never let a key reach a log line, a Supabase row or a ClickUp comment."""
    out = str(text)
    for hint in _SECRET_HINTS:
        i = 0
        while True:
            i = out.find(hint, i)
            if i < 0:
                break
            start = i + len(hint)
            end = start
            while end < len(out) and out[end] not in " \n\r\t\"'&,)}":
                end += 1
            out = out[:start] + "<hidden>" + out[end:]
            i = start + 8
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
            last = HttpError(e.code, body[:400].decode("utf-8", "replace"), body, url)
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


def get_json(url: str, **kw: Any) -> Any:
    _, _, body = request("GET", url, **kw)
    return json.loads(body.decode("utf-8")) if body else None


def post_json(url: str, payload: Any, **kw: Any) -> Any:
    _, _, body = request("POST", url, json_body=payload, **kw)
    return json.loads(body.decode("utf-8")) if body else None


def post_form(url: str, fields: dict[str, str], **kw: Any) -> Any:
    data = urllib.parse.urlencode(fields).encode("utf-8")
    kw.setdefault("headers", {})["Content-Type"] = "application/x-www-form-urlencoded"
    _, _, body = request("POST", url, data=data, **kw)
    return json.loads(body.decode("utf-8")) if body else None


def post_multipart(url: str, fields: dict[str, str], files: dict[str, tuple[str, bytes, str]], **kw: Any) -> Any:
    """One multipart POST, built by hand so nothing outside the standard library is needed."""
    boundary = "----maharadesk" + str(int(time.time() * 1000))
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode("utf-8"))
    for name, (filename, blob, ctype) in files.items():
        chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: {ctype}\r\n\r\n'.encode("utf-8"))
        chunks.append(blob)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(chunks)
    headers = dict(kw.pop("headers", {}))
    headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    _, _, out = request("POST", url, data=body, headers=headers, **kw)
    return json.loads(out.decode("utf-8")) if out else None


def download(url: str, path: str, *, max_bytes: int, timeout: float = 600, headers: Optional[dict[str, str]] = None) -> int:
    """Stream a file to disk with a hard size cap. Returns bytes written."""
    h = {"User-Agent": USER_AGENT}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    written = 0
    with urllib.request.urlopen(req, timeout=timeout) as res, open(path, "wb") as fh:
        while True:
            chunk = res.read(1 << 16)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                raise HttpError(0, f"file is larger than the {max_bytes} byte cap", b"", url)
            fh.write(chunk)
    return written


def encode_query(params: dict[str, Any]) -> str:
    return urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})


def quote(value: str) -> str:
    return urllib.parse.quote(str(value), safe="")
