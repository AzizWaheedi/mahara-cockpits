"""Supabase as the ideation home (Aziz, 2026-09-17: "move it now to Supabase").

One PostgREST client, standard library only, for the three tables the
migration created in the Creative Triage project (public.ideation_posts,
public.ideation_watchlist, public.ideation_scans) and the private
"ideation-stills" storage bucket. The service role key is a server secret:
it never leaves the worker's environment and every table keeps row security
on with no policies, so nothing reads these rows without it.

Rules the writes follow:
- a proposal never overwrites a decision: a row the creative director kept,
  queued, dismissed or that failed only takes the fresh numbers;
- a captured idea for a pasted link takes over the pasted row (or merges into
  an existing row with the same post key and deletes the pasted one);
- claiming a queued link leases it for 30 minutes and gives up after four
  tries with the reason on the row;
- every write is an upsert or a patch by key, so a retried run is harmless.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional
from urllib.parse import quote

from . import http
from .models import Target

POST_COLUMNS = {
    "key", "platform", "post_id", "url", "origin", "status", "at", "created_at",
    "format_label", "hook_kind", "topic", "format_vec", "trend_id", "trend_label", "trend_n", "trend_at",
    "ad_id", "ad_page_id", "advertiser", "ad_started_at", "ad_last_seen_at", "running_days", "ad_platforms", "ad_format", "ad_active", "source_request", "client",
    "author_handle", "author_name", "author_followers", "posted_at", "views", "likes", "comments", "shares", "saves",
    "caption", "duration_sec", "thumb_url", "media_url", "target_key", "industry", "tags",
    "baseline_views", "baseline_raw", "baseline_floored", "baseline_n", "baseline_confidence", "baseline_method", "baseline_rules",
    "multiplier", "tier", "engagement_rate", "reach_rate", "robust_z", "packaging_only", "provisional", "checkpoint", "scanned_at",
    "captured_at", "language", "dialect", "has_speech", "voice", "transcript", "on_screen_text", "format", "hook", "beats",
    "cta", "why_it_works", "transferable", "adaptations", "music", "method", "confidence", "warnings", "error",
    "pasted_by", "pasted_by_name", "pasted_at", "note", "saved_by", "saved_by_name", "saved_at", "saved_note",
    "dismissed_by", "dismissed_at", "fetching_at", "attempts", "still_path", "still_at", "still_error", "updated_at",
}
METRIC_COLUMNS = {
    "views", "likes", "comments", "shares", "saves", "author_followers", "multiplier", "tier", "engagement_rate", "reach_rate",
    "robust_z", "packaging_only", "provisional", "checkpoint", "baseline_views", "baseline_raw", "baseline_floored", "baseline_n",
    "baseline_confidence", "baseline_method", "baseline_rules", "scanned_at", "thumb_url", "media_url", "updated_at",
    "still_path", "still_at", "still_error", "running_days", "ad_last_seen_at", "ad_active",
}
CAPTURE_COLUMNS = {
    "captured_at", "language", "dialect", "has_speech", "voice", "transcript", "on_screen_text", "format", "hook", "beats",
    "cta", "why_it_works", "transferable", "adaptations", "music", "method", "confidence", "warnings", "error",
    "author_handle", "author_name", "author_followers", "posted_at", "views", "likes", "comments", "shares", "saves",
    "caption", "duration_sec", "thumb_url", "media_url", "multiplier", "tier", "post_id", "platform", "url",
    "still_path", "still_at", "still_error",
}
FETCH_TTL_MIN = 30
MAX_ATTEMPTS = 4
KEY_RE = re.compile(r"^(instagram|tiktok|snapchat|youtube|facebook|meta_ads|google_ads|linkedin_ads):[A-Za-z0-9_.-]{1,140}$")
PASTED_RE = re.compile(r"^pasted:[A-Za-z0-9_-]{1,64}$")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _q(value: str) -> str:
    """One value inside a PostgREST in.(...) list: quoted, quotes escaped."""
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


class SupabaseError(Exception):
    pass


class Supabase:
    def __init__(self, url: str, key: str, *, table: str = "ideation_posts", bucket: str = "ideation-stills", timeout: float = 60):
        if not url or not key:
            raise SupabaseError("RADAR_SUPABASE_URL and RADAR_SUPABASE_KEY are required")
        self.url = url.rstrip("/")
        self.key = key
        self.table = table
        self.bucket = bucket
        self.timeout = timeout

    # ---- plumbing ------------------------------------------------------------
    def _headers(self, prefer: Optional[str] = None, extra: Optional[dict[str, str]] = None) -> dict[str, str]:
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Accept": "application/json"}
        if prefer:
            h["Prefer"] = prefer
        if extra:
            h.update(extra)
        return h

    def rest(self, method: str, path: str, *, json_body: Any = None, prefer: Optional[str] = None, ok: tuple[int, ...] = (200, 201, 204), retries: int = 2) -> tuple[int, dict[str, str], Any]:
        headers = self._headers(prefer)
        data = None
        if json_body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
        status, resp_headers, body = http.request(method, f"{self.url}/rest/v1/{path}", headers=headers, data=data, timeout=self.timeout, retries=retries, ok_statuses=ok)
        parsed: Any = None
        if body:
            try:
                parsed = json.loads(body.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                parsed = body.decode("utf-8", "replace")
        return status, resp_headers, parsed

    def select(self, table: str, params: str) -> list[dict[str, Any]]:
        _, _, rows = self.rest("GET", f"{table}?{params}")
        return rows if isinstance(rows, list) else []

    def upsert(self, table: str, rows: list[dict[str, Any]], on_conflict: str = "key") -> int:
        """PostgREST requires every object in one request to carry the same keys
        (PGRST102), so rows are sent in groups that share a key set."""
        if not rows:
            return 0
        groups: dict[tuple[str, ...], list[dict[str, Any]]] = {}
        for row in rows:
            groups.setdefault(tuple(sorted(row.keys())), []).append(row)
        for group in groups.values():
            for i in range(0, len(group), 200):
                self.rest("POST", f"{table}?on_conflict={on_conflict}", json_body=group[i : i + 200], prefer="resolution=merge-duplicates,return=minimal")
        return len(rows)

    def patch(self, table: str, where: str, body: dict[str, Any]) -> None:
        if not body:
            return
        self.rest("PATCH", f"{table}?{where}", json_body=body, prefer="return=minimal")

    def insert(self, table: str, row: dict[str, Any]) -> None:
        self.rest("POST", table, json_body=row, prefer="return=minimal")

    def delete(self, table: str, where: str) -> None:
        self.rest("DELETE", f"{table}?{where}", prefer="return=minimal")

    def ping(self) -> bool:
        self.rest("GET", f"{self.table}?select=key&limit=1")
        return True

    # ---- posts -------------------------------------------------------------
    def existing(self, keys: Iterable[str]) -> dict[str, dict[str, Any]]:
        keys = [k for k in dict.fromkeys(keys) if k]
        out: dict[str, dict[str, Any]] = {}
        for i in range(0, len(keys), 100):
            chunk = keys[i : i + 100]
            rows = self.select(self.table, f"select=key,status,still_path,saved_at,saved_by,saved_by_name,note,saved_note,industry,tags,origin,attempts,captured_at&key=in.({','.join(_q(k) for k in chunk)})")
            for r in rows:
                out[r["key"]] = r
        return out

    @staticmethod
    def _post_row(d: dict[str, Any], allowed: set[str]) -> dict[str, Any]:
        row = {k: v for k, v in d.items() if k in allowed}
        for k in ("on_screen_text", "beats", "adaptations", "warnings", "tags", "baseline_rules"):
            if k in row and row[k] is None:
                row[k] = []
        return row

    def store_candidates(self, rows: list[dict[str, Any]]) -> dict[str, int]:
        """Scan proposals: new rows inserted, proposed rows refreshed, decided rows take numbers only."""
        now = now_iso()
        keys = [r.get("key") for r in rows if r.get("key") and KEY_RE.match(str(r.get("key")))]
        have = self.existing(keys)
        full: list[dict[str, Any]] = []
        patched = 0
        for r in rows:
            key = r.get("key")
            if not key or not KEY_RE.match(str(key)):
                continue
            prev = have.get(key)
            if prev is None:
                row = self._post_row(r, POST_COLUMNS)
                row.update({"origin": r.get("origin") or "scan", "status": "proposed", "at": now, "created_at": now, "updated_at": now})
                full.append(row)
            elif prev.get("status") == "proposed":
                row = self._post_row(r, POST_COLUMNS)
                row.update({"status": "proposed", "at": now, "updated_at": now})
                row.pop("created_at", None)
                full.append(row)
            else:
                body = self._post_row(r, METRIC_COLUMNS)
                body["updated_at"] = now
                if prev.get("still_path"):
                    body.pop("thumb_url", None)
                self.patch(self.table, f"key=eq.{quote(key, safe='')}", body)
                patched += 1
        inserted = sum(1 for row in full if row.get("created_at") == now)
        self.upsert(self.table, full)
        return {"inserted": inserted, "refreshed": len(full) - inserted, "patched": patched}

    def store_idea(self, row: dict[str, Any], origin_key: Optional[str] = None) -> str:
        """A capture result. origin_key is the queued row it answers (a pasted:... key or the real key)."""
        now = now_iso()
        real = row.get("key") or ""
        failed = row.get("status") == "failed" or (not row.get("transcript") and not row.get("hook") and row.get("error"))
        if not KEY_RE.match(real):
            # An unusable link (not a post, not a supported host). Only a queued row can carry it, as a failure.
            if origin_key and PASTED_RE.match(origin_key):
                self.patch(self.table, f"key=eq.{quote(origin_key, safe='')}", {"status": "failed", "error": str(row.get("error") or "not a usable link")[:400], "at": now, "updated_at": now})
                return origin_key
            raise SupabaseError(f"not a post key, nothing stored: {real[:60]}")
        body = self._post_row(row, CAPTURE_COLUMNS)
        body["updated_at"] = now
        body["at"] = now
        if failed:
            body["status"] = "failed"
            body["error"] = str(row.get("error") or "the radar could not fetch this post")[:400]
            for k in ("transcript", "on_screen_text", "hook", "beats", "why_it_works", "transferable", "adaptations"):
                body.pop(k, None)
        else:
            body["status"] = "saved"
            body["error"] = None
        have = self.existing([k for k in (real, origin_key) if k])
        pasted = have.get(origin_key) if origin_key and origin_key != real else None
        existing_real = have.get(real) if real else None
        carry = {}
        src = pasted or existing_real or {}
        for k in ("saved_by", "saved_by_name", "saved_at", "note", "saved_note", "industry", "tags"):
            if src.get(k) not in (None, "", []):
                carry[k] = src[k]
        if not failed:
            carry.setdefault("saved_at", now)
            if row.get("saved_by") and not carry.get("saved_by"):
                carry["saved_by"] = row["saved_by"]
            if row.get("note") and not carry.get("note"):
                carry["note"] = row["note"]
                carry.setdefault("saved_note", row["note"])
        if failed:
            body["attempts"] = int(src.get("attempts") or 0) + 1
        body.update(carry)
        if pasted and existing_real:
            # The pasted link turned out to be a post already in the library.
            self.patch(self.table, f"key=eq.{quote(real, safe='')}", body)
            self.delete(self.table, f"key=eq.{quote(origin_key, safe='')}")
            return real
        if pasted:
            body["key"] = real or origin_key
            body["origin"] = "manual"
            self.patch(self.table, f"key=eq.{quote(origin_key, safe='')}", body)
            return body["key"]
        if existing_real:
            if existing_real.get("status") == "dismissed" and not failed:
                body["status"] = "dismissed"
            self.patch(self.table, f"key=eq.{quote(real, safe='')}", body)
            return real
        body.update({"key": real, "origin": row.get("origin") or "manual", "created_at": now, "platform": row.get("platform") or "instagram", "url": row.get("url") or ""})
        self.upsert(self.table, [body])
        return real

    def claim_pending(self, limit: int = 10) -> list[dict[str, Any]]:
        """Links waiting for the radar: queued rows, plus fetches that went stale."""
        now = datetime.now(timezone.utc)
        cutoff = (now - timedelta(minutes=FETCH_TTL_MIN)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        queued = self.select(self.table, f"select=key,url,saved_by,pasted_by,note,industry,tags,attempts&status=eq.queued&order=at.asc&limit={int(limit)}")
        stale = self.select(self.table, f"select=key,url,saved_by,pasted_by,note,industry,tags,attempts&status=eq.fetching&fetching_at=lt.{cutoff}&order=at.asc&limit=50")
        out: list[dict[str, Any]] = []
        stamp = now_iso()
        for r in (queued + stale)[: int(limit)]:
            attempts = int(r.get("attempts") or 0) + 1
            where = f"key=eq.{quote(r['key'], safe='')}"
            if attempts > MAX_ATTEMPTS:
                self.patch(self.table, where, {"status": "failed", "error": "The radar took this link four times and never answered.", "attempts": attempts, "at": stamp, "updated_at": stamp})
                continue
            self.patch(self.table, where, {"status": "fetching", "fetching_at": stamp, "attempts": attempts, "updated_at": stamp})
            out.append({"key": r["key"], "url": r.get("url") or "", "saved_by": r.get("saved_by") or r.get("pasted_by") or "", "note": r.get("note") or "", "industry": r.get("industry") or "other", "tags": list(r.get("tags") or [])})
        return out

    # ---- stills ------------------------------------------------------------
    def upload_still(self, platform: str, post_id: str, blob: bytes, content_type: str = "image/jpeg") -> str:
        ext = {"image/png": "png", "image/webp": "webp"}.get(content_type, "jpg")
        path = f"{platform}/{post_id}.{ext}"
        headers = self._headers(extra={"Content-Type": content_type, "x-upsert": "true"})
        http.request("POST", f"{self.url}/storage/v1/object/{self.bucket}/{quote(path, safe='/')}", headers=headers, data=blob, timeout=self.timeout, retries=1, ok_statuses=(200, 201))
        return path

    def download_still(self, path: str) -> bytes:
        """The stored picture, read with the service key (the bucket is private)."""
        _, _, body = http.request("GET", f"{self.url}/storage/v1/object/{self.bucket}/{quote(path, safe='/')}", headers=self._headers(), timeout=self.timeout, retries=1)
        return body

    # ---- watchlist and scans --------------------------------------------------
    def load_watchlist(self) -> list[Target]:
        rows = self.select("ideation_watchlist", "select=platform,kind,value,industry,tags,active,note&active=eq.true&order=platform.asc,value.asc&limit=1000")
        out: list[Target] = []
        for r in rows:
            try:
                out.append(Target.from_dict(r))
            except (KeyError, TypeError, ValueError):
                continue
        return out

    def upsert_watchlist(self, targets: list[Target], *, source: str = "manual", added_by: str = "") -> int:
        now = now_iso()
        rows = [{"key": t.key, "platform": t.platform, "kind": t.kind, "value": t.value, "industry": t.industry, "tags": t.tags, "active": t.active, "note": t.note or None, "source": source, "added_by": added_by or None, "updated_at": now} for t in targets]
        return self.upsert("ideation_watchlist", rows)

    def mark_target(self, key: str, **fields: Any) -> None:
        fields["updated_at"] = now_iso()
        self.patch("ideation_watchlist", f"key=eq.{quote(key, safe='')}", fields)

    def request_row(self, request_id: str) -> Optional[dict[str, Any]]:
        rows = self.select("ideation_requests", f"select=*&id=eq.{quote(request_id, safe='')}&limit=1")
        return rows[0] if rows else None

    def log_scan(self, report: dict[str, Any]) -> None:
        row = {k: report.get(k) for k in ("at", "targets", "scanned", "failed", "skipped", "posts", "candidates_total", "candidates_new", "apify_runs", "usage_usd", "duration_sec", "dry_run", "warnings", "sinks")}
        row["per_target"] = report.get("per_target") or []
        self.insert("ideation_scans", row)

    def new_pasted_key(self) -> str:
        return f"pasted:{uuid.uuid4().hex[:12]}"
