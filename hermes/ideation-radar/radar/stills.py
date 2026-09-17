"""The cockpit's own picture per post: platform thumbnail links expire within
hours, so the thumbnail is copied into the private stills bucket when a row
is written. Small, bounded, best effort; a failure is noted on the row.
"""
from __future__ import annotations

import time
import urllib.request
from typing import Any, Callable

from . import http
from .supabase import Supabase

MAX_BYTES = 250_000
MIN_BYTES = 200
TIMEOUT = 10
BUDGET_SEC = 40


def fetch_image(url: str) -> tuple[bytes, str]:
    if not url.lower().startswith("https://"):
        raise http.HttpError(0, "not an https link")
    req = urllib.request.Request(url, headers={"User-Agent": http.USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        ctype = (res.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if not ctype.startswith("image/"):
            raise http.HttpError(0, f"not an image ({ctype[:40]})")
        blob = res.read(MAX_BYTES + 1)
    if len(blob) < MIN_BYTES:
        raise http.HttpError(0, "empty image")
    if len(blob) > MAX_BYTES:
        raise http.HttpError(0, f"over {MAX_BYTES} bytes")
    return blob, ctype


def attach_stills(sb: Supabase, rows: list[dict[str, Any]], log: Callable[[str], None], *, max_items: int = 40) -> dict[str, int]:
    """Copy each row's thumbnail into the bucket and set still_path on the row dict (before it is stored)."""
    started = time.monotonic()
    copied = failed = skipped = 0
    for row in rows[:max_items]:
        if time.monotonic() - started > BUDGET_SEC:
            skipped += 1
            continue
        url = row.get("thumb_url")
        if not url or row.get("still_path"):
            continue
        try:
            blob, ctype = fetch_image(str(url))
            path = sb.upload_still(str(row.get("platform")), str(row.get("post_id") or row.get("key", "x").split(":")[-1]), blob, ctype)
            row["still_path"] = path
            row["still_at"] = _now()
            row["still_error"] = None
            copied += 1
        except Exception as e:  # noqa: BLE001 - one bad picture must not stop the batch
            row["still_error"] = http.scrub(str(e))[:200]
            failed += 1
    log(f"stills: {copied} copied, {failed} failed, {skipped} skipped")
    return {"copied": copied, "failed": failed, "skipped": skipped}


def _now() -> str:
    from .supabase import now_iso
    return now_iso()
