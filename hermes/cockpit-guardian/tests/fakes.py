"""Fakes for the guardian's tests: a database, a VPS, the web. No network."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from guard import http
from guard.config import Config, Keys
from guard.context import Context
from guard.db import Db, DbError, ProbeMissing, Unavailable
from guard.host import Host
from guard.model import parse_time

NOW = datetime(2026, 10, 3, 14, 0, tzinfo=timezone.utc)   # a Saturday, 17:00 Kuwait time


def ago(minutes: float, now: datetime = NOW) -> str:
    return (now - timedelta(minutes=minutes)).isoformat()


def _cmp(a: Any, b: Any) -> tuple[Any, Any]:
    ta, tb = parse_time(a) if isinstance(a, str) else None, parse_time(b) if isinstance(b, str) else None
    if ta is not None and tb is not None:
        return ta, tb
    return a, b


class FakeDb(Db):
    name = "fake"

    def __init__(self, tables: Optional[dict[str, list[dict]]] = None, *, missing: tuple[str, ...] = (),
                 probe: Any = None, functions: Any = None, health: Any = None, can_write: bool = True,
                 down: bool = False):
        super().__init__(None)
        self.tables = tables or {}
        self.missing = set(missing)
        self._probe = probe
        self._functions = functions
        self._health = health
        self.can_write = can_write
        self.down = down
        self.writes: list[tuple[str, dict]] = []
        self.reads: list[str] = []

    def _guard(self) -> None:
        if self.down:
            raise DbError("connection refused")

    def rows(self, table, select="*", where=(), order=None, limit=None):
        self._guard()
        self.reads.append(table)
        if table in self.missing:
            raise DbError(f"{table}: 404 PGRST205")
        out = []
        for r in self.tables.get(table, []):
            keep = True
            for col, op, val in where:
                v = r.get(col)
                if op == "eq":
                    keep = v == val
                elif op == "neq":
                    keep = v != val
                elif op == "is":
                    keep = v is val
                elif op == "in":
                    keep = v in val
                elif op in ("lt", "lte", "gt", "gte"):
                    if v is None:
                        keep = False
                    else:
                        x, y = _cmp(v, val)
                        keep = {"lt": x < y, "lte": x <= y, "gt": x > y, "gte": x >= y}[op]
                if not keep:
                    break
            if keep:
                out.append(dict(r))
        if order:
            col, _, direction = order.partition(".")
            out.sort(key=lambda r: (r.get(col) is None, _sortable(r.get(col))), reverse=(direction == "desc"))
        if limit is not None:
            out = out[:limit]
        if select != "*":
            cols = [c.strip() for c in select.split(",")]
            out = [{c: r.get(c) for c in cols} for r in out]
        return out

    def count(self, table, where=()):
        return len(self.rows(table, "*", where))

    def exists(self, table):
        self._guard()
        return table not in self.missing

    def probe(self):
        self._guard()
        if self._probe is None:
            raise ProbeMissing("public.cockpit_guardian_probe() is not installed yet (migration 20261003e)")
        return self._probe

    def functions(self):
        if self._functions is None:
            raise Unavailable("SUPABASE_ACCESS_TOKEN is not set")
        return self._functions

    def health(self):
        if self._health is None:
            raise Unavailable("SUPABASE_ACCESS_TOKEN is not set")
        return self._health

    def ping_seconds(self):
        self._guard()
        return 0.2

    def upsert(self, table, rows, on_conflict):
        self._guard()
        for r in rows:
            self.writes.append((table, json.loads(json.dumps(r, default=str))))


def _sortable(v: Any) -> Any:
    t = parse_time(v) if isinstance(v, str) else None
    return t.timestamp() if t else (v if isinstance(v, (int, float)) else str(v))


class FakeHost(Host):
    def __init__(self, snap: Optional[dict] = None, *, remote: bool = False, home: str = "/home/hermes"):
        self.snap = snap or {}
        self.remote = remote
        self._home = home
        self.spawned: list[str] = []
        self.killed: list[tuple[int, int]] = []
        self.ran: list[list[str]] = []
        self.alive_pids: set[int] = set()

    def snapshot(self, spec):
        if isinstance(self.snap, Exception):
            raise self.snap
        return self.snap

    def spawn(self, command):
        if self.remote:
            return super().spawn(command)
        self.spawned.append(command)
        return 4242

    def run(self, argv, timeout=60, stdin=None):
        self.ran.append(argv)
        return 0, "* * * * * true\n", ""

    def alive(self, pid):
        return pid in self.alive_pids

    def kill(self, pid, sig):
        self.killed.append((pid, sig))
        if sig == 9:
            self.alive_pids.discard(pid)

    @property
    def home(self):
        return self._home


def resp(status: int = 200, body: Any = b"", headers: Optional[dict] = None) -> http.Response:
    if isinstance(body, (dict, list)):
        body = json.dumps(body).encode()
    elif isinstance(body, str):
        body = body.encode()
    return http.Response(status, headers or {}, body, 0.1)


class FakeWeb:
    def __init__(self, pages: Optional[dict[str, Any]] = None):
        self.pages = pages or {}
        self.calls: list[str] = []

    def __call__(self, url: str, **kw: Any) -> http.Response:
        self.calls.append(url)
        for prefix, value in self.pages.items():
            if url == prefix or url.startswith(prefix):
                if isinstance(value, Exception):
                    raise value
                return value
        raise http.HttpError(0, f"no fake page for {url}")


def config(tmp: Path, *, mode: str = "report-only", dry_run: bool = False, remote: bool = False,
           keys: Optional[dict[str, str]] = None) -> Config:
    k = Keys(environ=keys or {}, use_files=False)
    return Config(keys=k, home=tmp, mode=mode, dry_run=dry_run, ssh=["ssh", "x"] if remote else [],
                  slack_token="xoxb-test", slack_channel="C123")


def ctx(tmp: Path, *, db: Optional[Db] = None, host: Optional[Host] = None, web: Optional[Callable] = None,
        now: datetime = NOW, resolve: Optional[Callable[[str], bool]] = None, state: Optional[dict] = None,
        **cfg_kw: Any) -> Context:
    return Context(config(tmp, **cfg_kw), db if db is not None else FakeDb(), host, now=now,
                   http_get=web or FakeWeb(), resolve=resolve or (lambda h: False), state=state if state is not None else {})


def snapshot(**over: Any) -> dict:
    """A healthy VPS, as the snapshot script reports it."""
    now_s = int(NOW.timestamp())
    logs = ["~/.editor-desk/out/cron.log", "~/.salma.log", "~/.ideation-radar/out/cron.log", "~/.hala.log",
            "~/.reviewwatch.log", "~/.reviewimport.log", "~/.ideation-radar/out/hiring.log", "~/.eodout.log",
            "~/.teamsync.log", "~/.webinar-pull.log", "~/.sales-desk.log"]
    files = {p: {"mtime": now_s - 60, "size": 1000, "mode": "644", "owner": "hermes"} for p in logs}
    for env in ("~/.editor-desk/env", "~/.ideation-radar/env", "~/.sales-desk/env", "/opt/data/bibi/api-keys.env",
                "/opt/data/.cockpit-worker/env", "~/.team-sync/env"):
        files[env] = {"mtime": now_s, "size": 100, "mode": "600", "owner": "hermes"}
    from checks.keys import REQUIRED
    env_keys: dict[str, dict] = {}
    for name, (path, _) in REQUIRED.items():
        env_keys.setdefault(path, {})[name] = "set"
    env_keys["/opt/data/bibi/api-keys.env"]["ANTHROPIC_API_KEY"] = "set"
    from guard.jobs import manifest_lines
    snap = {
        "at": now_s, "user": "hermes", "home": "/home/hermes",
        "crontab": {"lines": manifest_lines()},
        "mem": {"MemTotal": 16_000_000, "MemAvailable": 4_000_000, "MemFree": 1_000_000, "SwapTotal": 0},
        "disk": {"pct": 72.0, "avail_gb": 57.0, "size_gb": 200.0},
        "load": {"load": [1.0, 1.0, 1.0], "cpus": 4},
        "procs": {"jobs": [], "top": [{"user": "aziz", "name": "node openclaw-gateway", "rss_mb": 516}],
                  "cloudflared": {"n": 1, "rss_kb": 20000, "users": {"root": 1}}},
        "listen": ["127.0.0.1:3456", "0.0.0.0:22"],
        "files": files,
        "logs": {p: {"tracebacks": 0, "flagged": [], "last": "ok", "rotated": 0} for p in logs},
        "env_keys": env_keys,
        "settings": {"SALES_MODEL_PROVIDER": "vps"},
        "proxy": {"http": 200, "status": "ok"},
        "salma_vps": {"state": "signed in", "at": NOW.isoformat()},
        "git": {"head": "abc1234", "date": NOW.isoformat(), "dirty": 0},
        "monitors": {
            "mahara-cockpits": {"at": NOW.isoformat(), "not_ok": {}, "checks": 20, "incidents": {}},
            "public-sites": {"at": NOW.isoformat(), "not_ok": {}, "checks": 18, "incidents": {}},
        },
        "hermes_jobs": [{"id": "a", "name": "Nightly Backup", "enabled": True, "last_status": "ok"}],
        "fixer": {"mtime": now_s - 7200},
        "rooms": {"file": False, "unit": "inactive"},
    }
    snap.update(over)
    return snap
