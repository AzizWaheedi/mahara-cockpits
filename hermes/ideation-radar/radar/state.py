"""Durable state between runs: one JSON file, written atomically.

What it remembers: every post the scan has seen (with a short history of its
view counts, so a candidate can be re-scored at later checkpoints), the last
baseline per account, a log of recent scans with their Apify cost, and the
status of proposals (proposed, captured, dismissed) so nothing is proposed
twice. Empty results never erase a baseline: a failed fetch keeps the old
numbers and is recorded as a failure.
"""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from .models import Baseline, Candidate, Post

VIEW_HISTORY_MAX = 12
SCAN_LOG_MAX = 60


class State:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.data: dict[str, Any] = {
            "version": 1,
            "posts": {},
            "accounts": {},
            "scans": [],
            "captures": {},
        }

    # ---- persistence -------------------------------------------------
    @classmethod
    def load(cls, path: Path) -> "State":
        st = cls(path)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                loaded = json.load(fh)
            if isinstance(loaded, dict):
                st.data.update(loaded)
        except FileNotFoundError:
            pass
        except json.JSONDecodeError:
            # A half written file is worse than none: keep a copy and start over.
            corrupt = str(path) + ".corrupt"
            try:
                os.replace(path, corrupt)
            except OSError:
                pass
        st.data.setdefault("posts", {})
        st.data.setdefault("accounts", {})
        st.data.setdefault("scans", [])
        st.data.setdefault("captures", {})
        return st

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".state-", dir=str(self.path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(self.data, fh, ensure_ascii=False, indent=1, sort_keys=True)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, self.path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    # ---- posts and proposals ------------------------------------------
    def post(self, key: str) -> Optional[dict[str, Any]]:
        return self.data["posts"].get(key)

    def status(self, key: str) -> Optional[str]:
        row = self.post(key)
        return row.get("status") if row else None

    def remember_post(self, post: Post, now_iso: str) -> dict[str, Any]:
        row = self.data["posts"].setdefault(
            post.key,
            {
                "platform": post.platform,
                "post_id": post.post_id,
                "url": post.url,
                "author": post.author_handle,
                "posted_at": post.posted_at,
                "first_seen": now_iso,
                "status": "seen",
                "views_history": [],
            },
        )
        row["last_seen"] = now_iso
        if post.views is not None:
            hist = row.setdefault("views_history", [])
            if not hist or hist[-1][1] != post.views:
                hist.append([now_iso, post.views])
                del hist[:-VIEW_HISTORY_MAX]
        return row

    def propose(self, cand: Candidate) -> bool:
        """Record a candidate. Returns True when it is new (not proposed before)."""
        row = self.remember_post(cand.post, cand.scanned_at)
        row["multiplier"] = round(cand.multiplier, 2)
        row["tier"] = cand.tier
        row["baseline"] = cand.baseline.median
        if row.get("status") in ("proposed", "captured", "dismissed", "saved"):
            return False
        row["status"] = "proposed"
        row["proposed_at"] = cand.scanned_at
        row["target_key"] = cand.target_key
        return True

    def mark(self, key: str, status: str, when: str, **extra: Any) -> None:
        row = self.data["posts"].setdefault(key, {"status": status, "first_seen": when})
        row["status"] = status
        row[f"{status}_at"] = when
        row.update(extra)

    # ---- accounts ------------------------------------------------------
    def set_baseline(self, target_key: str, base: Baseline, followers: Optional[int], posts_seen: int) -> None:
        self.data["accounts"][target_key] = {
            "baseline": base.to_dict(),
            "followers": followers,
            "posts_seen": posts_seen,
            "updated_at": base.computed_at,
            "failures": 0,
        }

    def baseline(self, target_key: str) -> Optional[Baseline]:
        row = self.data["accounts"].get(target_key)
        if not row or not row.get("baseline"):
            return None
        b = row["baseline"]
        return Baseline(
            median=float(b["median"]),
            n=int(b["n"]),
            computed_at=str(b["computed_at"]),
            method=str(b.get("method", "median_after_rules_v1")),
            trim=float(b.get("trim", 0.1)),
            min_age_hours=int(b.get("min_age_hours", 168)),
            raw_median=b.get("raw_median"),
            floored=bool(b.get("floored", False)),
            confidence=str(b.get("confidence", "low")),
            rules=list(b.get("rules", [])),
        )

    def record_failure(self, target_key: str, when: str, error: str) -> int:
        row = self.data["accounts"].setdefault(target_key, {})
        row["failures"] = int(row.get("failures", 0)) + 1
        row["last_error"] = error[:300]
        row["last_error_at"] = when
        return row["failures"]

    def expected_posts(self, target_key: str) -> Optional[int]:
        row = self.data["accounts"].get(target_key)
        return int(row["posts_seen"]) if row and row.get("posts_seen") else None

    # ---- scans and captures -------------------------------------------
    def add_scan(self, record: dict[str, Any]) -> None:
        scans = self.data.setdefault("scans", [])
        scans.append(record)
        del scans[:-SCAN_LOG_MAX]

    def last_scan(self) -> Optional[dict[str, Any]]:
        scans = self.data.get("scans") or []
        return scans[-1] if scans else None

    def capture(self, key: str) -> Optional[dict[str, Any]]:
        return self.data["captures"].get(key)

    def set_capture(self, key: str, record: dict[str, Any]) -> None:
        self.data["captures"][key] = record

    # ---- housekeeping --------------------------------------------------
    def prune(self, *, keep_days: int = 180, now: Optional[datetime] = None) -> int:
        now = now or datetime.now(timezone.utc)
        cutoff = (now - timedelta(days=keep_days)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        removed = 0
        for key in list(self.data["posts"].keys()):
            row = self.data["posts"][key]
            if row.get("status") in ("captured", "saved"):
                continue
            last = row.get("last_seen") or row.get("first_seen") or ""
            if last and last < cutoff:
                del self.data["posts"][key]
                removed += 1
        return removed
