"""What a check can read, each source fetched once per scan.

Everything a check touches comes through here (the database door, the VPS
snapshot, HTTP, DNS, keys, the clock), so the tests can hand a check fakes
and the scan reads every source at most once.
"""
from __future__ import annotations

import socket
from datetime import datetime
from typing import Any, Callable, Optional

from . import http
from .config import Config
from .db import Db, DbError, ProbeMissing, Unavailable
from .host import Host, snapshot_spec
from .model import now_utc
from .redact import clean


class SourceError(Exception):
    """A source could not be read; the check says 'could not be checked'."""


class Context:
    def __init__(self, cfg: Config, db: Optional[Db], host: Optional[Host], *, now: Optional[datetime] = None,
                 http_get: Optional[Callable[..., http.Response]] = None,
                 resolve: Optional[Callable[[str], bool]] = None, state: Optional[dict[str, Any]] = None):
        self.cfg = cfg
        self.db = db
        self.host = host
        self.now = now or now_utc()
        self.http_get = http_get or http.get
        self._resolve = resolve
        self.state = state if state is not None else {}
        self.results: dict[str, Any] = {}    # check id -> Result, filled as the scan goes
        self._cache: dict[str, Any] = {}

    # ---- memo ----------------------------------------------------------------
    def _once(self, key: str, fn: Callable[[], Any]) -> Any:
        if key not in self._cache:
            try:
                self._cache[key] = ("ok", fn())
            except Exception as e:  # noqa: BLE001 - any failure to read a source is "could not be checked"
                self._cache[key] = ("err", e)
        kind, value = self._cache[key]
        if kind == "err":
            raise SourceError(clean(value, 240)) from value
        return value

    # ---- database ------------------------------------------------------------
    def need_db(self) -> Db:
        if self.db is None:
            raise SourceError("Creative Triage cannot be read: no database door (DESK_SUPABASE_URL / DESK_SUPABASE_KEY)")
        return self.db

    def rows(self, table: str, select: str = "*", where=(), order: Optional[str] = None,
             limit: Optional[int] = None) -> list[dict[str, Any]]:
        key = f"rows:{table}:{select}:{where}:{order}:{limit}"
        return self._once(key, lambda: self.need_db().rows(table, select, where, order, limit))

    def count(self, table: str, where=()) -> int:
        return self._once(f"count:{table}:{where}", lambda: self.need_db().count(table, where))

    def exists(self, table: str) -> bool:
        return self._once(f"exists:{table}", lambda: self.need_db().exists(table))

    def probe(self) -> dict[str, Any]:
        """pg_cron, pg_net and auth roles. Raises SourceError, or ProbeMissing
        (as SourceError with .missing) when the function is not installed."""
        key = "probe"
        if key not in self._cache:
            try:
                self._cache[key] = ("ok", self.need_db().probe())
            except ProbeMissing as e:
                self._cache[key] = ("missing", e)
            except (DbError, http.HttpError, OSError, ValueError) as e:
                self._cache[key] = ("err", e)
        kind, value = self._cache[key]
        if kind == "missing":
            err = SourceError(str(value))
            err.missing = True  # type: ignore[attr-defined]
            raise err
        if kind == "err":
            raise SourceError(clean(value, 240))
        return value

    def functions(self) -> list[dict[str, Any]]:
        key = "functions"
        if key not in self._cache:
            try:
                self._cache[key] = ("ok", self.need_db().functions())
            except Unavailable as e:
                self._cache[key] = ("gap", e)
            except (DbError, http.HttpError, OSError, SourceError) as e:
                self._cache[key] = ("err", e)
        kind, value = self._cache[key]
        if kind == "gap":
            err = SourceError(str(value))
            err.gap = True  # type: ignore[attr-defined]
            raise err
        if kind == "err":
            raise SourceError(clean(value, 240))
        return value

    def supabase_health(self) -> list[dict[str, Any]]:
        key = "health"
        if key not in self._cache:
            try:
                self._cache[key] = ("ok", self.need_db().health())
            except Unavailable as e:
                self._cache[key] = ("gap", e)
            except (DbError, http.HttpError, OSError, SourceError) as e:
                self._cache[key] = ("err", e)
        kind, value = self._cache[key]
        if kind == "gap":
            err = SourceError(str(value))
            err.gap = True  # type: ignore[attr-defined]
            raise err
        if kind == "err":
            raise SourceError(clean(value, 240))
        return value

    def section(self, key: str) -> dict[str, Any]:
        rows = self.rows("cockpit_sections", "key,ok,error,computed_at,payload", where=[("key", "eq", key)], limit=1)
        if not rows:
            raise SourceError(f"cockpit_sections has no '{key}' row")
        return rows[0]

    def setting(self, key: str) -> Optional[Any]:
        rows = self.rows("cockpit_sales_settings", "key,value,updated_at", where=[("key", "eq", key)], limit=1)
        return rows[0].get("value") if rows else None

    # ---- the VPS -------------------------------------------------------------
    def snapshot(self) -> dict[str, Any]:
        if self.host is None:
            raise SourceError("the VPS cannot be read from here (no host)")
        return self._once("snapshot", lambda: self.host.snapshot(snapshot_spec(self.cfg.repo_on_vps)))

    def snap_part(self, name: str) -> Any:
        snap = self.snapshot()
        part = snap.get(name)
        if part is None:
            raise SourceError(f"the VPS snapshot has no {name}")
        if isinstance(part, dict) and set(part.keys()) == {"error"}:
            raise SourceError(f"the VPS could not read {name}: {clean(part['error'], 160)}")
        return part

    # ---- the web -------------------------------------------------------------
    def get(self, url: str, **kw: Any) -> http.Response:
        key = f"get:{url}:{sorted(kw.get('headers', {}).items()) if kw.get('headers') else ''}"
        return self._once(key, lambda: self.http_get(url, **kw))

    def resolves(self, hostname: str) -> bool:
        if self._resolve:
            return self._resolve(hostname)
        try:
            socket.getaddrinfo(hostname, 443)
            return True
        except socket.gaierror:
            return False

    # ---- keys ----------------------------------------------------------------
    def key(self, name: str) -> str:
        """A key's value, for a probe made right here. Remote runs have none."""
        if self.cfg.remote:
            return ""
        return self.cfg.keys.get(name)
