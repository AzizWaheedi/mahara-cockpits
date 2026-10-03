"""Two doors into Creative Triage, one shape for the checks.

- RestDb: PostgREST with the service key (DESK_SUPABASE_URL / DESK_SUPABASE_KEY),
  what the guardian uses on the VPS. It can write incidents. pg_cron, pg_net
  and auth roles are not tables PostgREST serves, so it reads them through
  public.cockpit_guardian_probe() (migration 20261003e), which returns names,
  schedules and counts and never cron.job.command (it holds a literal
  Authorization value for three jobs).
- MgmtDb: the Management API's SQL endpoint with read_only true, for a
  read-only run from the Mac (the token in ~/.config/mahara/sb_mgmt_token).
  It never writes.

Checks call rows / count / exists / probe and never build SQL or URLs.
A filter is a tuple (column, op, value) with op one of OPS.
"""
from __future__ import annotations

import json
import re
from typing import Any, Iterable, Optional, Sequence
from urllib.parse import quote

from . import http
from .config import MGMT_API, PROBE_FN, REF
from .redact import scrub

OPS = ("eq", "neq", "lt", "lte", "gt", "gte", "is", "in", "like", "ilike")
_IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")
_SQL_OPS = {"eq": "=", "neq": "<>", "lt": "<", "lte": "<=", "gt": ">", "gte": ">=", "like": "like", "ilike": "ilike"}

# The body of public.cockpit_guardian_probe(). The migration holds the same
# text between $probe$ markers; tests/test_db.py fails if the two drift.
PROBE_SQL = """
select jsonb_build_object(
  'at', now(),
  'cron_jobs', coalesce((
    select jsonb_agg(jsonb_build_object('jobid', j.jobid, 'jobname', j.jobname,
                                        'schedule', j.schedule, 'active', j.active) order by j.jobid)
      from cron.job as j), '[]'::jsonb),
  'cron_runs', coalesce((
    select jsonb_agg(to_jsonb(x)) from (
      select d.jobid,
             count(*) filter (where d.start_time > now() - interval '24 hours') as runs_24h,
             count(*) filter (where d.start_time > now() - interval '24 hours'
                                and d.status <> 'succeeded') as failed_24h,
             max(d.start_time) as last_start,
             (array_agg(d.status order by d.start_time desc))[1] as last_status,
             left((array_agg(d.return_message order by d.start_time desc)
                     filter (where d.status <> 'succeeded'))[1], 160) as last_error
        from cron.job_run_details as d
       where d.start_time > now() - interval '2 days'
       group by d.jobid) as x), '[]'::jsonb),
  'http_1h', coalesce((
    select jsonb_object_agg(y.k, y.n) from (
      select case when r.timed_out then 'timeout'
                  when r.status_code is null then 'error'
                  when r.status_code = 404 and r.content like '%Requested function was not found%'
                    then 'missing_function'
                  else r.status_code::text end as k,
             count(*) as n
        from net._http_response as r
       where r.created > now() - interval '1 hour'
       group by 1) as y), '{}'::jsonb),
  'auth_roles', coalesce((
    select jsonb_object_agg(z.role, z.n) from (
      select coalesce(u.role, '(none)') as role, count(*) as n
        from auth.users as u
       where u.role is distinct from 'authenticated' and u.deleted_at is null
       group by 1) as z), '{}'::jsonb)
)
""".strip()


class DbError(Exception):
    pass


class ProbeMissing(DbError):
    """public.cockpit_guardian_probe() is not installed yet."""


class Unavailable(DbError):
    """This door cannot answer that question (no management token)."""


def _check_ident(name: str) -> str:
    if not _IDENT.match(name):
        raise DbError(f"not a plain column or table name: {name[:40]}")
    return name


def _columns(select: str) -> list[str]:
    cols = [c.strip() for c in select.split(",") if c.strip()]
    return ["*"] if cols == ["*"] else [_check_ident(c) for c in cols]


class Mgmt:
    """The Supabase Management API: health, functions list, read-only SQL."""

    def __init__(self, token: str, ref: str = REF, timeout: float = 60):
        if not token:
            raise Unavailable("no management token")
        self.token = token
        self.ref = ref
        self.timeout = timeout

    def _get(self, path: str) -> Any:
        r = http.get(f"{MGMT_API}{path}", headers={"Authorization": f"Bearer {self.token}"}, timeout=self.timeout)
        if r.status != 200:
            raise DbError(f"management API {r.status}: {scrub(r.text(300))}")
        return r.json()

    def health(self) -> list[dict[str, Any]]:
        services = "&".join(f"services={s}" for s in ("db", "rest", "auth", "storage", "realtime"))
        out = self._get(f"/v1/projects/{self.ref}/health?{services}")
        return out if isinstance(out, list) else []

    def functions(self) -> list[dict[str, Any]]:
        out = self._get(f"/v1/projects/{self.ref}/functions")
        return out if isinstance(out, list) else []

    def sql(self, query: str) -> list[dict[str, Any]]:
        r = http.request("POST", f"{MGMT_API}/v1/projects/{self.ref}/database/query",
                         headers={"Authorization": f"Bearer {self.token}"},
                         json_body={"query": query, "read_only": True}, timeout=self.timeout)
        if r.status not in (200, 201):
            raise DbError(f"SQL {r.status}: {scrub(r.text(300))}")
        out = r.json()
        return out if isinstance(out, list) else []


class Db:
    name = "db"
    can_write = False

    def __init__(self, mgmt: Optional[Mgmt] = None):
        self.mgmt = mgmt

    def rows(self, table: str, select: str = "*", where: Sequence[tuple[str, str, Any]] = (),
             order: Optional[str] = None, limit: Optional[int] = None) -> list[dict[str, Any]]:
        raise NotImplementedError

    def count(self, table: str, where: Sequence[tuple[str, str, Any]] = ()) -> int:
        raise NotImplementedError

    def exists(self, table: str) -> bool:
        raise NotImplementedError

    def probe(self) -> dict[str, Any]:
        raise NotImplementedError

    def functions(self) -> list[dict[str, Any]]:
        if not self.mgmt:
            raise Unavailable("SUPABASE_ACCESS_TOKEN is not set, so the Edge Function list cannot be read")
        return self.mgmt.functions()

    def health(self) -> list[dict[str, Any]]:
        if not self.mgmt:
            raise Unavailable("SUPABASE_ACCESS_TOKEN is not set")
        return self.mgmt.health()

    # writes: only RestDb has them
    def upsert(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> None:
        raise DbError(f"{self.name} is read-only")

    def ping_seconds(self) -> float:
        raise NotImplementedError


def _rest_value(op: str, value: Any) -> str:
    if op == "is":
        return "null" if value is None else ("true" if value is True else "false" if value is False else str(value))
    if op == "in":
        items = ",".join('"' + str(v).replace('"', '\\"') + '"' for v in value)
        return f"({items})"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


class RestDb(Db):
    name = "rest"
    can_write = True

    def __init__(self, url: str, key: str, *, mgmt: Optional[Mgmt] = None, timeout: float = 30):
        super().__init__(mgmt)
        if not url or not key:
            raise DbError("DESK_SUPABASE_URL and DESK_SUPABASE_KEY are not set (~/.editor-desk/env)")
        self.url = url.rstrip("/")
        self.key = key
        self.timeout = timeout

    def _headers(self, extra: Optional[dict[str, str]] = None) -> dict[str, str]:
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Accept": "application/json"}
        if extra:
            h.update(extra)
        return h

    def _query(self, select: str, where: Iterable[tuple[str, str, Any]], order: Optional[str], limit: Optional[int]) -> str:
        parts = [f"select={','.join(_columns(select))}"]
        for col, op, value in where:
            if op not in OPS:
                raise DbError(f"op {op}")
            encoded = quote(_rest_value(op, value), safe='(),"*')
            parts.append(f"{_check_ident(col)}={op}.{encoded}")
        if order:
            col, _, direction = order.partition(".")
            parts.append(f"order={_check_ident(col)}.{'desc' if direction == 'desc' else 'asc'}.nullslast")
        if limit is not None:
            parts.append(f"limit={int(limit)}")
        return "&".join(parts)

    def rows(self, table, select="*", where=(), order=None, limit=None):
        r = http.get(f"{self.url}/rest/v1/{_check_ident(table)}?{self._query(select, where, order, limit)}",
                     headers=self._headers(), timeout=self.timeout)
        if r.status != 200:
            raise DbError(f"{table}: {r.status} {scrub(r.text(200))}")
        out = r.json()
        return out if isinstance(out, list) else []

    def count(self, table, where=()):
        q = self._query("*", where, None, 0)
        r = http.get(f"{self.url}/rest/v1/{_check_ident(table)}?{q}", headers=self._headers({"Prefer": "count=exact"}),
                     timeout=self.timeout)
        if r.status not in (200, 206):
            raise DbError(f"{table}: {r.status} {scrub(r.text(200))}")
        rng = r.headers.get("content-range", "")
        try:
            return int(rng.rsplit("/", 1)[1])
        except (IndexError, ValueError):
            raise DbError(f"{table}: no count in the answer")

    def exists(self, table):
        r = http.get(f"{self.url}/rest/v1/{_check_ident(table)}?select=*&limit=0", headers=self._headers(),
                     timeout=self.timeout)
        if r.status == 200:
            return True
        body = r.text(400)
        if r.status in (404, 400) and ("PGRST205" in body or "42P01" in body or "Could not find the table" in body):
            return False
        raise DbError(f"{table}: {r.status} {scrub(body[:200])}")

    def probe(self):
        r = http.request("POST", f"{self.url}/rest/v1/rpc/{PROBE_FN}", headers=self._headers(), json_body={},
                         timeout=self.timeout)
        if r.status == 200:
            out = r.json()
            return out if isinstance(out, dict) else {}
        body = r.text(400)
        if r.status == 404 or "PGRST202" in body:
            if self.mgmt:
                return _probe_from_rows(self.mgmt.sql(f"select ({PROBE_SQL}) as probe"))
            raise ProbeMissing("public.cockpit_guardian_probe() is not installed yet (migration 20261003e)")
        raise DbError(f"probe: {r.status} {scrub(body[:200])}")

    def upsert(self, table, rows, on_conflict):
        if not rows:
            return
        r = http.request("POST", f"{self.url}/rest/v1/{_check_ident(table)}?on_conflict={_check_ident(on_conflict)}",
                         headers=self._headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
                         json_body=rows, timeout=self.timeout)
        if r.status not in (200, 201, 204):
            raise DbError(f"{table}: write {r.status} {scrub(r.text(200))}")

    def ping_seconds(self):
        r = http.get(f"{self.url}/rest/v1/cockpit_sections?select=key&limit=1", headers=self._headers(),
                     timeout=self.timeout)
        if r.status != 200:
            raise DbError(f"PostgREST answered {r.status}")
        return r.seconds

    def storage(self, method: str, path: str, body: Any = None) -> http.Response:
        return http.request(method, f"{self.url}/storage/v1/{path}", headers=self._headers(), json_body=body,
                            timeout=self.timeout)


def _sql_literal(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def _probe_from_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {}
    v = rows[0].get("probe")
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            return {}
    return v if isinstance(v, dict) else {}


class MgmtDb(Db):
    """Read-only SQL through the Management API (a run from the Mac)."""

    name = "mgmt"
    can_write = False

    def __init__(self, mgmt: Mgmt):
        super().__init__(mgmt)

    def _where(self, where: Iterable[tuple[str, str, Any]]) -> str:
        out = []
        for col, op, value in where:
            c = _check_ident(col)
            if op == "is":
                out.append(f"{c} is {_rest_value('is', value)}")
            elif op == "in":
                out.append(f"{c} in ({', '.join(_sql_literal(v) for v in value)})" if value else "false")
            elif op in _SQL_OPS:
                out.append(f"{c} {_SQL_OPS[op]} {_sql_literal(value)}")
            else:
                raise DbError(f"op {op}")
        return (" where " + " and ".join(out)) if out else ""

    def rows(self, table, select="*", where=(), order=None, limit=None):
        cols = ", ".join(_columns(select))
        sql = f"select {cols} from public.{_check_ident(table)}{self._where(where)}"
        if order:
            col, _, direction = order.partition(".")
            sql += f" order by {_check_ident(col)} {'desc' if direction == 'desc' else 'asc'} nulls last"
        if limit is not None:
            sql += f" limit {int(limit)}"
        return [_decode_row(r) for r in self.mgmt.sql(sql)]

    def count(self, table, where=()):
        rows = self.mgmt.sql(f"select count(*) as n from public.{_check_ident(table)}{self._where(where)}")
        return int(rows[0]["n"]) if rows else 0

    def exists(self, table):
        rows = self.mgmt.sql(f"select to_regclass('public.{_check_ident(table)}') is not null as e")
        return bool(rows and rows[0].get("e"))

    def probe(self):
        rows = self.mgmt.sql(f"select ({PROBE_SQL}) as probe")
        return _probe_from_rows(rows)

    def ping_seconds(self):
        import time
        t = time.monotonic()
        self.mgmt.sql("select 1 as one")
        return time.monotonic() - t


def _decode_row(row: dict[str, Any]) -> dict[str, Any]:
    """The SQL endpoint gives jsonb back as JSON already; text that is JSON stays text."""
    return dict(row)


def open_db(cfg: Any) -> Db:
    """The door the config asks for: rest on the VPS, mgmt for a read-only run elsewhere."""
    mgmt = Mgmt(cfg.mgmt_token) if cfg.mgmt_token else None
    door = cfg.db_door
    if door == "mgmt" or (door == "auto" and not cfg.supabase_key and mgmt):
        if not mgmt:
            raise DbError("GUARDIAN_DB=mgmt needs SUPABASE_ACCESS_TOKEN or GUARDIAN_MGMT_TOKEN_FILE")
        return MgmtDb(mgmt)
    return RestDb(cfg.supabase_url, cfg.supabase_key, mgmt=mgmt)
