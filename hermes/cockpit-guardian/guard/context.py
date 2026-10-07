"""What a check can read, each source fetched once per scan.

Everything a check touches comes through here (the database door, the VPS
snapshot, HTTP, DNS, keys, the clock), so the tests can hand a check fakes
and the scan reads every source at most once.

Two rules keep an outage to one message and one short scan:
- every "could not be read" carries the source it came from (db, vps), so
  the engine folds those readings into the supabase-health or vps-snapshot
  incident instead of opening one per check;
- a circuit breaker: after the first database call that times out, cannot
  connect or answers 5xx, every later database read in the same scan fails
  at once instead of waiting out its own 30 s timeout.
"""
from __future__ import annotations

import socket
from datetime import datetime
from typing import Any, Callable, Optional

from . import http
from .config import Config
from .db import Db, DbDown, ProbeMissing, Unavailable
from .host import Host, snapshot_spec
from .model import now_utc
from .redact import clean

DB = "db"
VPS = "vps"
PARENT_OF_SOURCE = {DB: "supabase-health", VPS: "vps-snapshot"}


class SourceError(Exception):
    """A source could not be read; the check says 'could not be checked'.
    `source` says which (db, vps, or None for anything else)."""

    def __init__(self, message: Any = "", source: Optional[str] = None):
        super().__init__(message)
        self.source = source


def parent_of(*errors: BaseException) -> Optional[str]:
    """The incident a set of unreadable sources folds into, when they all share one."""
    parents = {PARENT_OF_SOURCE.get(getattr(e, "source", None) or "") for e in errors}
    return parents.pop() if len(parents) == 1 else None


def is_outage(e: BaseException) -> bool:
    """No answer at all (a timeout, a refused connection) or a 5xx: the source is down."""
    if isinstance(e, DbDown):
        return True
    if isinstance(e, http.HttpError):
        return e.status == 0 or e.status >= 500
    return isinstance(e, (TimeoutError, socket.timeout, ConnectionError))


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
        self.db_down: Optional[str] = None   # set by the first outage; later database reads fail at once

    # ---- the circuit breaker -------------------------------------------------
    def trip_db(self, reason: Any) -> None:
        if not self.db_down:
            self.db_down = clean(reason, 160)

    def _db_guard(self) -> None:
        if self.db_down:
            raise SourceError(f"Creative Triage did not answer earlier in this scan ({self.db_down}), so this read was "
                              "skipped", source=DB)

    # ---- memo ----------------------------------------------------------------
    def _once(self, key: str, fn: Callable[[], Any], source: Optional[str] = None) -> Any:
        if key not in self._cache:
            if source == DB:
                self._db_guard()
            try:
                self._cache[key] = ("ok", fn())
            except SourceError as e:
                self._cache[key] = ("err", e)
            except Exception as e:  # noqa: BLE001 - any failure to read a source is "could not be checked"
                if source == DB and is_outage(e):
                    self.trip_db(e)
                self._cache[key] = ("err", e)
        kind, value = self._cache[key]
        if kind == "err":
            if isinstance(value, SourceError):
                raise SourceError(str(value), source=value.source if value.source else source) from value
            raise SourceError(clean(value, 240), source=source) from value
        return value

    # ---- database ------------------------------------------------------------
    def need_db(self) -> Db:
        if self.db is None:
            raise SourceError("Creative Triage cannot be read: no database door (DESK_SUPABASE_URL / DESK_SUPABASE_KEY)",
                              source=DB)
        return self.db

    def rows(self, table: str, select: str = "*", where=(), order: Optional[str] = None,
             limit: Optional[int] = None) -> list[dict[str, Any]]:
        key = f"rows:{table}:{select}:{where}:{order}:{limit}"
        return self._once(key, lambda: self.need_db().rows(table, select, where, order, limit), DB)

    def count(self, table: str, where=()) -> int:
        return self._once(f"count:{table}:{where}", lambda: self.need_db().count(table, where), DB)

    def exists(self, table: str) -> bool:
        return self._once(f"exists:{table}", lambda: self.need_db().exists(table), DB)

    def probe(self) -> dict[str, Any]:
        """pg_cron, pg_net and auth roles. Raises SourceError, or ProbeMissing
        (as SourceError with .missing) when the function is not installed."""
        key = "probe"
        if key not in self._cache:
            self._db_guard()
            try:
                self._cache[key] = ("ok", self.need_db().probe())
            except ProbeMissing as e:
                self._cache[key] = ("missing", e)
            except SourceError as e:
                self._cache[key] = ("err", e)
            except Exception as e:  # noqa: BLE001
                if is_outage(e):
                    self.trip_db(e)
                self._cache[key] = ("err", e)
        kind, value = self._cache[key]
        if kind == "missing":
            err = SourceError(str(value))
            err.missing = True  # type: ignore[attr-defined]
            raise err
        if kind == "err":
            raise SourceError(clean(value, 240), source=DB)
        return value

    def _mgmt(self, key: str, fn: Callable[[], Any]) -> Any:
        """The Management API (functions list, service health): a separate door, so its
        failures never trip the database breaker and are not folded into supabase-health."""
        if key not in self._cache:
            try:
                self._cache[key] = ("ok", fn())
            except Unavailable as e:
                self._cache[key] = ("gap", e)
            except Exception as e:  # noqa: BLE001
                self._cache[key] = ("err", e)
        kind, value = self._cache[key]
        if kind == "gap":
            err = SourceError(str(value))
            err.gap = True  # type: ignore[attr-defined]
            raise err
        if kind == "err":
            raise SourceError(clean(value, 240))
        return value

    def functions(self) -> list[dict[str, Any]]:
        return self._mgmt("functions", lambda: self.need_db().functions())

    def function_files(self, slug: str) -> list[str]:
        return self._mgmt("function_files:" + slug, lambda: self.need_db().function_files(slug))

    def supabase_health(self) -> list[dict[str, Any]]:
        return self._mgmt("health", lambda: self.need_db().health())

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
        offsets = (self.state.get("log_offsets") or {}) if isinstance(self.state, dict) else {}
        return self._once("snapshot", lambda: self.host.snapshot(snapshot_spec(self.cfg.repo_on_vps, offsets)), VPS)

    def refresh_snapshot(self) -> None:
        """Fixes act on a fresh look, not on one taken minutes ago at the start of the scan."""
        self._cache.pop("snapshot", None)

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
        """A page fetched once per scan. No answer raises http.HttpError itself (not
        SourceError), so a check can say "does not answer" for a site that is down."""
        key = f"get:{url}:{sorted(kw.get('headers', {}).items()) if kw.get('headers') else ''}"
        if key not in self._cache:
            try:
                self._cache[key] = ("ok", self.http_get(url, **kw))
            except http.HttpError as e:
                self._cache[key] = ("http", e)
            except Exception as e:  # noqa: BLE001
                self._cache[key] = ("err", e)
        kind, value = self._cache[key]
        if kind == "http":
            raise value
        if kind == "err":
            raise SourceError(clean(value, 240))
        return value

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
