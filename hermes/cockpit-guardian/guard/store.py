"""Incidents: one per check while it is broken, kept in two places.

- The state file (~/.cockpit-guardian/state.json, mode 600) is what the
  engine works from. It is always written, so the guardian keeps working,
  deduping and alerting while Supabase itself is down.
- public.cockpit_guardian_incidents (migration 20261003e) is the copy the
  CEO cockpit can read later through its own server. Every change is
  upserted there by id; a write that fails is queued in the state file and
  sent on a later scan.

A dry run uses its own state file (--state-dir) and never writes Supabase.
"""
from __future__ import annotations

import json
import os
import tempfile
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from .config import INCIDENTS_TABLE
from .db import Db, DbError
from .http import HttpError
from .model import iso, parse_time
from .redact import clean, clean_obj

KEEP_RESOLVED_DAYS = 7
VERSION = 1

ROW_COLUMNS = (
    "id", "check_id", "area", "status", "level", "severity", "title", "detail", "action", "owner", "evidence",
    "first_seen_at", "opened_at", "last_seen_at", "updated_at", "resolved_at", "resolved_by", "seen", "fix_attempts",
    "alerted_at", "resolve_alerted_at", "mode",
)


def empty_state() -> dict[str, Any]:
    return {"version": VERSION, "open": {}, "resolved": [], "streaks": {}, "last_alert": {}, "pending_db": [],
            "history": {}, "daily_sent": None, "last_scan": None}


class Store:
    def __init__(self, path: Path, db: Optional[Db] = None, *, write_db: bool = True):
        self.path = Path(path)
        self.db = db
        self.write_db = write_db and db is not None and getattr(db, "can_write", False)
        self.state = empty_state()
        self.db_note: Optional[str] = None

    # ---- the file ---------------------------------------------------------------
    def load(self) -> dict[str, Any]:
        try:
            with open(self.path, encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                base = empty_state()
                base.update(data)
                self.state = base
                return self.state
        except FileNotFoundError:
            pass
        except (OSError, ValueError):
            # A damaged file: keep it aside, start clean, and say so.
            try:
                os.replace(self.path, str(self.path) + ".damaged")
            except OSError:
                pass
        self.state = empty_state()
        self._recover_from_db()
        return self.state

    def _recover_from_db(self) -> None:
        """A new box or a lost file: the open incidents come back from Supabase."""
        if self.db is None:
            return
        try:
            rows = self.db.rows(INCIDENTS_TABLE, "*", where=[("status", "eq", "open")], limit=500)
        except (DbError, HttpError, OSError):
            return
        for r in rows:
            inc = {k: r.get(k) for k in ROW_COLUMNS}
            inc["fix_attempts"] = r.get("fix_attempts") or []
            self.state["open"][r["check_id"]] = inc

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.path.parent, 0o700)
        except OSError:
            pass
        self._trim()
        fd, tmp = tempfile.mkstemp(prefix=".state.", dir=str(self.path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(self.state, fh, ensure_ascii=False, indent=1, default=str)
            os.chmod(tmp, 0o600)
            os.replace(tmp, self.path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def _trim(self) -> None:
        cutoff = datetime.now().astimezone() - timedelta(days=KEEP_RESOLVED_DAYS)
        self.state["resolved"] = [i for i in self.state["resolved"]
                                  if (parse_time(i.get("resolved_at")) or cutoff) >= cutoff][-300:]

    # ---- incidents ---------------------------------------------------------------
    @property
    def open(self) -> dict[str, dict[str, Any]]:
        return self.state["open"]

    def get(self, ref: str) -> Optional[dict[str, Any]]:
        """By check id, incident id, or the first 8 characters of the id."""
        if ref in self.open:
            return self.open[ref]
        for inc in list(self.open.values()) + list(reversed(self.state["resolved"])):
            if inc.get("id") == ref or str(inc.get("id", "")).startswith(ref):
                return inc
        return None

    def open_incident(self, check: Any, result: Any, now: datetime, mode: str) -> dict[str, Any]:
        first = result.since if result.since and result.since <= now else now
        inc = {
            "id": str(uuid.uuid4()),
            "check_id": check.id,
            "area": check.area,
            "status": "open",
            "level": result.status,
            "severity": check.severity,
            "title": clean(check.name, 120),
            "detail": clean(result.summary, 600),
            "action": clean(result.action or check.action, 400),
            "owner": check.owner,
            "evidence": clean_obj(result.evidence),
            "first_seen_at": iso(first),
            "opened_at": iso(now),
            "last_seen_at": iso(now),
            "updated_at": iso(now),
            "resolved_at": None,
            "resolved_by": None,
            "seen": 1,
            "fix_attempts": [],
            "alerted_at": None,
            "resolve_alerted_at": None,
            "mode": mode,
        }
        self.open[check.id] = inc
        self.write(inc)
        return inc

    def touch(self, inc: dict[str, Any], check: Any, result: Any, now: datetime) -> bool:
        """Same incident, seen again. True when what it says changed (level or text)."""
        changed = inc.get("level") != result.status or inc.get("detail") != clean(result.summary, 600)
        inc.update({
            "level": result.status,
            "detail": clean(result.summary, 600),
            "action": clean(result.action or check.action, 400),
            "evidence": clean_obj(result.evidence),
            "last_seen_at": iso(now),
            "updated_at": iso(now),
            "seen": int(inc.get("seen") or 0) + 1,
        })
        if result.since and parse_time(inc.get("first_seen_at")) and result.since < parse_time(inc["first_seen_at"]):
            inc["first_seen_at"] = iso(result.since)
        # Write a quiet repeat only every 6th scan (half an hour) to keep the table light.
        if changed or inc["seen"] % 6 == 0:
            self.write(inc)
        return changed

    def resolve(self, check_id: str, now: datetime, resolved_by: str) -> Optional[dict[str, Any]]:
        inc = self.open.pop(check_id, None)
        if inc is None:
            return None
        inc.update({"status": "resolved", "resolved_at": iso(now), "updated_at": iso(now),
                    "resolved_by": clean(resolved_by, 300)})
        self.state["resolved"].append(inc)
        self.write(inc)
        return inc

    def record_attempt(self, inc: dict[str, Any], attempt: dict[str, Any]) -> None:
        inc.setdefault("fix_attempts", []).append({k: clean(v, 400) if isinstance(v, str) else v for k, v in attempt.items()})
        inc["fix_attempts"] = inc["fix_attempts"][-20:]
        inc["updated_at"] = attempt.get("at")
        self.write(inc)

    # ---- Supabase copy -------------------------------------------------------------
    def _row(self, inc: dict[str, Any]) -> dict[str, Any]:
        return {k: inc.get(k) for k in ROW_COLUMNS}

    def write(self, inc: dict[str, Any]) -> None:
        if not self.write_db:
            return
        pending = self.state.setdefault("pending_db", [])
        if inc["id"] not in pending:
            pending.append(inc["id"])

    def flush(self) -> Optional[str]:
        """Send every queued incident row. Returns a sentence when Supabase refused."""
        if not self.write_db:
            return None
        pending = self.state.get("pending_db") or []
        if not pending:
            return None
        by_id = {i["id"]: i for i in list(self.open.values()) + self.state["resolved"]}
        rows = [self._row(by_id[pid]) for pid in pending if pid in by_id]
        # Resolved rows first, so the one-open-per-check index never sees two open rows.
        rows.sort(key=lambda r: 0 if r["status"] == "resolved" else 1)
        left = [pid for pid in pending if pid in by_id]
        for r in rows:
            try:
                self.db.upsert(INCIDENTS_TABLE, [r], on_conflict="id")
            except (DbError, HttpError, OSError) as e:
                self.state["pending_db"] = left
                self.db_note = (f"Supabase did not take {len(left)} incident row(s) ({clean(e, 160)}); they wait in the "
                                "state file and go on a later scan.")
                return self.db_note
            left.remove(r["id"])
        self.state["pending_db"] = []
        return None
