"""Creative Triage, through PostgREST and Storage with the service key.

The tables are in supabase/migrations/20260924a_sales_cockpit.sql and the
bucket in 20260924b_sales_proposal_files.sql. Row security gives a browser
select and nothing else, so every write the sales cockpit sees comes from its
server or from here.

Rules the writes follow, as in the editor desk:
- PostgREST refuses a bulk upsert whose rows carry different keys (PGRST102),
  so rows are grouped by key set before they are sent;
- a request is claimed with a conditional update before anything is done for
  it, so two runs can never work the same one;
- every write is an upsert or a patch by primary key, so a retry is harmless.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from . import http

# PostgREST's max-rows on Creative Triage: a request never answers more rows
# than this, whatever its limit asks.
MAX_ROWS = 1000
# What a job failed on, per item (20260926m): an item that failed twice within
# a day of its first failure is set aside until that day has passed.
FAILURES = "cockpit_sales_desk_failures"
FAILURE_WINDOW = timedelta(hours=24)

REQUESTS = "cockpit_sales_requests"
PROPOSALS = "cockpit_sales_proposals"
LEADS = "cockpit_sales_leads"
RECORDINGS = "cockpit_sales_recordings"
APPOINTMENTS = "cockpit_sales_appointments"
PEOPLE = "cockpit_sales_people"
STATUS = "cockpit_sales_worker_status"
SETTINGS = "cockpit_sales_settings"
TABLES = (REQUESTS, PROPOSALS, LEADS, RECORDINGS, APPOINTMENTS, PEOPLE, STATUS, SETTINGS)
# The private bucket every call's transcript is kept in (20260924m).
CALLS_BUCKET = "sales-calls"

RECORDING_COLUMNS = (
    "recording_id", "title", "recorded_by", "started_at", "duration_s", "share_url",
    "contact_id", "appointment_id", "matched_by", "indexed_at",
)
PROPOSAL_COLUMNS = {
    "variant", "status", "deal", "validation", "fill_count", "html_path", "pdf_path",
    "model", "recording_id", "lang", "error", "updated_at",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _q(value: str) -> str:
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def _when(v: Any) -> Optional[datetime]:
    try:
        t = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def set_aside(failures: dict[str, dict[str, Any]], now: datetime, *, times: int = 2) -> set[str]:
    """The items that failed `times` times within a day of their first
    failure, while that day lasts: each run would pay for the same failure
    again, and a call that always fails would stay at the front of the queue."""
    return {item for item, r in failures.items()
            if int(r.get("failures") or 0) >= times and (_when(r.get("first_at")) or now) > now - FAILURE_WINDOW}


class SupabaseError(Exception):
    pass


class Supabase:
    def __init__(self, url: str, key: str, *, bucket: str = "sales-proposals", timeout: float = 60):
        if not url or not key:
            raise SupabaseError("DESK_SUPABASE_URL and DESK_SUPABASE_KEY are required (~/.editor-desk/env)")
        self.url = url.rstrip("/")
        self.key = key
        self.bucket = bucket
        self.timeout = timeout

    # ---- plumbing --------------------------------------------------------
    def _headers(self, prefer: Optional[str] = None, extra: Optional[dict[str, str]] = None) -> dict[str, str]:
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Accept": "application/json"}
        if prefer:
            h["Prefer"] = prefer
        if extra:
            h.update(extra)
        return h

    def rest(self, method: str, path: str, *, json_body: Any = None, prefer: Optional[str] = None, retries: int = 2) -> Any:
        headers = self._headers(prefer)
        data = None
        if json_body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(json_body, ensure_ascii=False, default=str).encode("utf-8")
        _, _, body = http.request(
            method, f"{self.url}/rest/v1/{path}", headers=headers, data=data,
            timeout=self.timeout, retries=retries, ok_statuses=(200, 201, 204),
        )
        if not body:
            return None
        try:
            return json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return body.decode("utf-8", "replace")

    def select(self, table: str, params: str) -> list[dict[str, Any]]:
        rows = self.rest("GET", f"{table}?{params}")
        return rows if isinstance(rows, list) else []

    def select_all(self, table: str, params: str, *, order: str, page: int = MAX_ROWS) -> list[dict[str, Any]]:
        """Every row a read matches. The API answers at most 1,000 rows a
        request whatever the limit asks, so a read that can grow goes page by
        page, limit and offset over `order` (which ends on a unique column, so
        no row is skipped or read twice), until a page comes back short. A
        page larger than the cap would always look short, so it never is."""
        page = max(1, min(int(page), MAX_ROWS))
        out: list[dict[str, Any]] = []
        offset = 0
        while True:
            rows = self.select(table, f"{params}&order={order}&limit={page}&offset={offset}")
            out.extend(rows)
            if len(rows) < page:
                return out
            offset += page

    def upsert(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> int:
        if not rows:
            return 0
        groups: dict[tuple[str, ...], list[dict[str, Any]]] = {}
        for row in rows:
            groups.setdefault(tuple(sorted(row.keys())), []).append(row)
        for group in groups.values():
            for i in range(0, len(group), 200):
                self.rest(
                    "POST", f"{table}?on_conflict={on_conflict}",
                    json_body=group[i : i + 200],
                    prefer="resolution=merge-duplicates,return=minimal",
                )
        return len(rows)

    def patch(self, table: str, where: str, body: dict[str, Any]) -> None:
        if body:
            self.rest("PATCH", f"{table}?{where}", json_body=body, prefer="return=minimal")

    def patch_returning(self, table: str, where: str, body: dict[str, Any], *, retries: int = 1) -> list[dict[str, Any]]:
        out = self.rest("PATCH", f"{table}?{where}", json_body=body, prefer="return=representation", retries=retries)
        return out if isinstance(out, list) else []

    # ---- storage ---------------------------------------------------------
    def upload(self, path: str, blob: bytes, content_type: str) -> str:
        """Into the private bucket, overwriting. Returns the path stored on the row."""
        headers = self._headers(extra={"Content-Type": content_type, "x-upsert": "true"})
        http.request(
            "POST", f"{self.url}/storage/v1/object/{self.bucket}/{path}",
            headers=headers, data=blob, timeout=max(self.timeout, 120), retries=2, ok_statuses=(200, 201),
        )
        return path

    def upload_to(self, bucket: str, path: str, blob: bytes, content_type: str) -> str:
        """Into another private bucket (the call transcripts), overwriting."""
        headers = self._headers(extra={"Content-Type": content_type, "x-upsert": "true"})
        http.request(
            "POST", f"{self.url}/storage/v1/object/{bucket}/{path}",
            headers=headers, data=blob, timeout=max(self.timeout, 120), retries=2, ok_statuses=(200, 201),
        )
        return path

    def download_from(self, bucket: str, path: str) -> bytes:
        """An object from a private bucket (a call's transcript)."""
        _, _, body = http.request(
            "GET", f"{self.url}/storage/v1/object/{bucket}/{path}",
            headers=self._headers(), timeout=max(self.timeout, 120), retries=2,
        )
        return body

    def bucket_info(self) -> dict[str, Any]:
        _, _, body = http.request(
            "GET", f"{self.url}/storage/v1/bucket/{self.bucket}",
            headers=self._headers(), timeout=self.timeout, retries=1,
        )
        return json.loads(body.decode("utf-8")) if body else {}

    # ---- the request queue ----------------------------------------------
    def queued(self, kind: str, *, max_attempts: int, limit: int) -> list[dict[str, Any]]:
        return self.select(
            REQUESTS,
            f"select=*&kind=eq.{http.quote(kind)}&status=eq.queued&attempts=lt.{int(max_attempts)}"
            f"&order=requested_at.asc&limit={int(limit)}",
        )

    def stuck(self, kind: str, cutoff: str) -> list[dict[str, Any]]:
        """Rows a run claimed and never finished: running, with no sign of life since the cutoff."""
        return self.select(
            REQUESTS,
            f"select=*&kind=eq.{http.quote(kind)}&status=eq.running&claimed_at=lt.{http.quote(cutoff)}"
            "&order=claimed_at.asc&limit=50",
        )

    def claim(self, req: dict[str, Any], host: str) -> Optional[dict[str, Any]]:
        """Take one request. Only the runner whose update still sees `queued` gets the row back."""
        rows = self.patch_returning(
            REQUESTS,
            f"id=eq.{http.quote(req['id'])}&status=eq.queued",
            {"status": "running", "attempts": int(req.get("attempts") or 0) + 1,
             "claimed_at": now_iso(), "claimed_by": host, "error": None},
        )
        return rows[0] if rows else None

    def touch(self, request_id: str, host: str) -> None:
        """A sign of life, so a long draft is not taken for a dead one."""
        self.patch(REQUESTS, f"id=eq.{http.quote(request_id)}&status=eq.running&claimed_by=eq.{http.quote(host)}",
                   {"claimed_at": now_iso()})

    def request_done(self, request_id: str, result: dict[str, Any]) -> None:
        self.patch(REQUESTS, f"id=eq.{http.quote(request_id)}",
                   {"status": "done", "result": result, "error": None, "finished_at": now_iso()})

    def request_failed(self, request_id: str, message: str, *, final: bool) -> None:
        """Back in the queue while there are tries left; parked when there are not."""
        body: dict[str, Any] = {"status": "failed" if final else "queued", "error": message[:600],
                                "claimed_at": None, "claimed_by": None}
        if final:
            body["finished_at"] = now_iso()
        self.patch(REQUESTS, f"id=eq.{http.quote(request_id)}", body)

    def request_released(self, request_id: str, message: str, attempts: int) -> None:
        """Handed back untouched: the try did not count, because nothing was tried."""
        self.patch(REQUESTS, f"id=eq.{http.quote(request_id)}&status=eq.running",
                   {"status": "queued", "attempts": max(0, int(attempts)), "error": message[:600],
                    "claimed_at": None, "claimed_by": None})

    def reaped(self, req: dict[str, Any], message: str, *, final: bool) -> bool:
        """A stuck row back to the queue, or parked. Conditional on nobody having touched it since."""
        where = (f"id=eq.{http.quote(req['id'])}&status=eq.running"
                 f"&claimed_at=eq.{http.quote(str(req.get('claimed_at') or ''))}")
        body: dict[str, Any] = {"status": "failed" if final else "queued", "error": message[:600],
                                "claimed_at": None, "claimed_by": None}
        if final:
            body["finished_at"] = now_iso()
        return bool(self.patch_returning(REQUESTS, where, body))

    # ---- proposals -------------------------------------------------------
    def proposal(self, proposal_id: str) -> Optional[dict[str, Any]]:
        rows = self.select(PROPOSALS, f"select=*&id=eq.{http.quote(proposal_id)}&limit=1")
        return rows[0] if rows else None

    def proposal_for_request(self, request_id: str) -> Optional[dict[str, Any]]:
        rows = self.select(PROPOSALS, f"select=*&request_id=eq.{http.quote(request_id)}&order=created_at.desc&limit=1")
        return rows[0] if rows else None

    def update_proposal(self, proposal_id: str, **fields: Any) -> None:
        body = {k: v for k, v in fields.items() if k in PROPOSAL_COLUMNS}
        body["updated_at"] = now_iso()
        self.patch(PROPOSALS, f"id=eq.{http.quote(proposal_id)}", body)

    # ---- the lead and the people ----------------------------------------
    def lead(self, contact_id: str) -> Optional[dict[str, Any]]:
        if not contact_id:
            return None
        rows = self.select(LEADS, "select=contact_id,name,email,company,country"
                                  f"&contact_id=eq.{http.quote(contact_id)}&limit=1")
        return rows[0] if rows else None

    def leads_by_email(self, emails: Iterable[str]) -> dict[str, dict[str, Any]]:
        """Leads whose address is one of these, any case. PostgREST has no lower()
        in a filter, so ilike does the case and Python checks the match is exact."""
        wanted = sorted({str(e).strip().lower() for e in emails if e and "@" in str(e)})
        out: dict[str, dict[str, Any]] = {}
        for i in range(0, len(wanted), 20):
            chunk = wanted[i : i + 20]
            ors = ",".join(f"email.ilike.{_q(e)}" for e in chunk)
            rows = self.select(LEADS, "select=contact_id,name,email,company,country"
                                      f"&or=({http.quote(ors)})&limit=200")
            for r in rows:
                e = str(r.get("email") or "").strip().lower()
                if e in chunk and e not in out:
                    out[e] = r
        return out

    def appointments_between(self, start: str, end: str) -> list[dict[str, Any]]:
        return self.select(
            APPOINTMENTS,
            "select=appointment_id,contact_id,call_type,start_at,status,assigned_user_id"
            f"&start_at=gte.{http.quote(start)}&start_at=lte.{http.quote(end)}"
            "&call_type=in.(intro,demo)&order=start_at.asc&limit=1000",
        )

    def people(self) -> list[dict[str, Any]]:
        return self.select(PEOPLE, "select=email,name,role,active,ghl_user_id,fathom_email&limit=500")

    # ---- recordings ------------------------------------------------------
    def recordings_of(self, contact_id: str) -> list[dict[str, Any]]:
        """The lead's recorded calls a proposal can be drafted from, newest first.
        Phone calls are left out: a phone call is never the demo, and a lead
        a setter rang twenty times would otherwise push the demo off the list.
        (A null source is a row the Fathom step wrote.)"""
        return self.select(RECORDINGS, f"select=*&contact_id=eq.{http.quote(contact_id)}"
                                       "&or=(source.is.null,source.neq.maqsam)"
                                       "&order=started_at.desc&limit=20")

    def recording(self, recording_id: str) -> Optional[dict[str, Any]]:
        rows = self.select(RECORDINGS, f"select=*&recording_id=eq.{http.quote(recording_id)}&limit=1")
        return rows[0] if rows else None

    def store_recordings(self, rows: list[dict[str, Any]]) -> int:
        stamp = now_iso()
        clean = [{**{c: r.get(c) for c in RECORDING_COLUMNS}, "indexed_at": stamp} for r in rows if r.get("recording_id")]
        return self.upsert(RECORDINGS, clean, "recording_id")

    # ---- settings --------------------------------------------------------
    def setting(self, key: str) -> Optional[Any]:
        rows = self.select(SETTINGS, f"select=key,value&key=eq.{http.quote(key)}&limit=1")
        return rows[0].get("value") if rows else None

    def store_setting(self, key: str, value: Any, by: str) -> None:
        self.upsert(SETTINGS, [{"key": key, "value": value, "updated_by": by, "updated_at": now_iso()}], "key")

    # ---- what a job keeps failing on ------------------------------------
    def failures(self, job: str) -> dict[str, dict[str, Any]]:
        """The items a job has failed on and not yet got right, by item id."""
        rows = self.select_all(FAILURES, f"select=item_id,failures,first_at,last_at&job=eq.{http.quote(job)}",
                               order="item_id")
        return {str(r["item_id"]): r for r in rows}

    def record_failure(self, job: str, item_id: str, error: str, *, known: Optional[dict[str, Any]] = None,
                       now: Optional[datetime] = None) -> None:
        """One more failure of an item: counted within a day of its first
        failure (`known`, the row read at the start of the run), and counted
        afresh once that day has passed."""
        now = now or datetime.now(timezone.utc)
        first = _when((known or {}).get("first_at"))
        fresh = first is not None and now - first < FAILURE_WINDOW
        self.upsert(FAILURES, [{
            "job": job, "item_id": str(item_id),
            "failures": int((known or {}).get("failures") or 0) + 1 if fresh else 1,
            "last_error": http.scrub(error)[:600],
            "first_at": iso(first) if fresh and first else iso(now), "last_at": iso(now),
        }], "job,item_id")

    def clear_failure(self, job: str, item_id: str) -> None:
        """An item that worked: what it failed on before is forgotten."""
        self.rest("DELETE", f"{FAILURES}?job=eq.{http.quote(job)}&item_id=eq.{http.quote(str(item_id))}",
                  prefer="return=minimal")

    # ---- health ----------------------------------------------------------
    def worker_status(self, worker: str, job: str, ok: bool, detail: str) -> None:
        self.upsert(STATUS, [{"worker": worker, "job": job, "ok": bool(ok),
                              "detail": http.scrub(detail)[:1000], "at": now_iso()}], "worker,job")
