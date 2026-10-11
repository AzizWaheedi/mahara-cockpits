"""HTTP for the invoice desk. Standard library only.

Reads (GET) are retried with backoff. Writes that create something (a Drive
upload, a register row) are sent once: a retried append can add a row twice.
The worker makes those safe instead by reading back before it writes again.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Optional

USER_AGENT = "mahara-invoice-desk/1.0"
RETRY_STATUSES = (408, 425, 429, 500, 502, 503, 504)

_SECRETS = (
    re.compile(r"(?i)(bearer\s+)[^\s\"',)}\]]+"),
    re.compile(r"(?i)((?:apikey|api[_-]key|access_token|refresh_token|private_key|token|key)\s*[=:]\s*[\"']?)[^\s\"'&,)}\]]+"),
)
_WHOLE = (re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{4,}"),
          re.compile(r"-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----"))


def scrub(text: Any) -> str:
    out = str(text)
    for pattern in _SECRETS:
        out = pattern.sub(lambda m: m.group(1) + "[hidden]", out)
    for pattern in _WHOLE:
        out = pattern.sub("[hidden]", out)
    return out[:600]


class HttpError(Exception):
    def __init__(self, status: int, message: str, body: bytes = b""):
        self.status = status
        self.body = body
        super().__init__(f"HTTP {status}: {scrub(message)}" if status else scrub(message))


# Every call is reported here (method, url, status, ok) so it lands in the
# worker's health ledger. Set by the worker; tests leave it as a no-op.
Ledger = Callable[[str, str, Optional[int], bool, str], None]
ledger: Ledger = lambda method, url, status, ok, detail: None
# The invoice being worked on, so a ledger row says which one a call was for.
current_invoice: Optional[str] = None


def request(method: str, url: str, *, headers: Optional[dict[str, str]] = None,
            body: Optional[bytes] = None, json_body: Any = None, timeout: float = 60,
            retries: Optional[int] = None) -> tuple[int, bytes]:
    """Send one request and return (status, body). Raises HttpError on a
    non-2xx answer. GET is tried four times; anything else once unless asked."""
    hdrs = {"User-Agent": USER_AGENT, **(headers or {})}
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")
    tries = retries if retries is not None else (4 if method == "GET" else 1)
    last: Optional[HttpError] = None
    for attempt in range(tries):
        req = urllib.request.Request(url, data=body, method=method, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
                ledger(method, url, resp.status, True, "")
                return resp.status, data
        except urllib.error.HTTPError as e:
            data = e.read() if hasattr(e, "read") else b""
            last = HttpError(e.code, data.decode("utf-8", "replace")[:400] or str(e), data)
            ledger(method, url, e.code, False, scrub(last))
            if e.code not in RETRY_STATUSES:
                raise last from None
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last = HttpError(0, f"{type(e).__name__}: {e}")
            ledger(method, url, None, False, scrub(last))
        if attempt + 1 < tries:
            time.sleep(min(2 ** attempt, 8))
    assert last is not None
    raise last


def get_json(url: str, **kw: Any) -> Any:
    _, data = request("GET", url, **kw)
    return json.loads(data or b"null")


def send_json(method: str, url: str, payload: Any, **kw: Any) -> Any:
    _, data = request(method, url, json_body=payload, **kw)
    return json.loads(data) if data else None


def quote(value: Any) -> str:
    return urllib.parse.quote(str(value), safe="")
