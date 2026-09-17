"""What every platform adapter provides.

An adapter turns a watchlist target into an Apify job and turns the actor's
items back into Post records. It knows nothing about baselines or sinks.
Field mapping is tolerant (apify.first) because actor output drifts.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from ..apify import first, to_int
from ..config import Config
from ..models import Post


class PlatformError(Exception):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def iso_from(value: Any) -> Optional[str]:
    """ISO 8601 UTC from an ISO string, an epoch (s or ms) or a date string."""
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 1e12:
            ts /= 1000.0
        try:
            return datetime.fromtimestamp(ts, tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        except (OverflowError, OSError, ValueError):
            return None
    s = str(value).strip()
    if s.isdigit():
        return iso_from(int(s))
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s.replace(" ", "T"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class Adapter:
    platform = ""

    def __init__(self, cfg: Config):
        self.cfg = cfg

    # scan
    def profile_job(self, handle: str, limit: int) -> tuple[str, dict[str, Any]]:
        raise PlatformError(f"{self.platform}: profile scans not supported")

    def hashtag_job(self, tag: str, limit: int) -> tuple[str, dict[str, Any]]:
        raise PlatformError(f"{self.platform}: hashtag scans not supported")

    def details_job(self, handle: str) -> Optional[tuple[str, dict[str, Any]]]:
        """Optional extra run that returns follower counts; None when not needed."""
        return None

    # capture
    def post_job(self, canonical_url: str) -> tuple[str, dict[str, Any]]:
        raise PlatformError(f"{self.platform}: single post fetch not supported")

    # parsing
    def parse_posts(self, items: list[dict[str, Any]], *, handle: str = "") -> list[Post]:
        raise NotImplementedError

    def parse_details(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        return {}

    # helpers
    def _post(self, **kw: Any) -> Post:
        kw.setdefault("platform", self.platform)
        kw.setdefault("fetched_at", now_iso())
        return Post(**kw)


__all__ = ["Adapter", "PlatformError", "first", "to_int", "iso_from", "now_iso"]
