"""Supabase (Creative Triage) through PostgREST with the service key, read by name. Standard library only.

The worker writes only through the cockpit_market_intel_* functions (each audited), plus its health row in
cockpit_sync_state and the ledger rows in cockpit_csm_provider_health, as the other VPS workers do.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import quote

from . import http

HEALTH_KEY = "market-intel"


class SupabaseError(Exception):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class Supabase:
    def __init__(self, url: str, key: str, *, timeout: float = 60):
        if not url or not key:
            raise SupabaseError("MARKET_INTEL_SUPABASE_URL and MARKET_INTEL_SUPABASE_KEY are not both set.")
        self.url = url.rstrip("/")
        self.key = key
        self.timeout = timeout

    def _headers(self, prefer: Optional[str] = None) -> dict[str, str]:
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Accept": "application/json",
             "Content-Type": "application/json"}
        if prefer:
            h["Prefer"] = prefer
        return h

    def _call(self, method: str, path: str, body: Any = None, prefer: Optional[str] = None, retries: int = 2) -> Any:
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        try:
            _, _, out = http.request(method, f"{self.url}/rest/v1/{path}", headers=self._headers(prefer), data=data,
                                     timeout=self.timeout, retries=retries)
        except http.HttpError as e:
            said = e.body[:400].decode("utf-8", "replace") if e.body else str(e)
            try:
                said = json.loads(said).get("message") or said
            except (ValueError, AttributeError):
                pass
            raise SupabaseError(f"Supabase {path.split('?')[0]} answered {e.status}: {http.scrub(said)[:300]}") from None
        if not out:
            return None
        return json.loads(out.decode("utf-8"))

    def rpc(self, name: str, args: dict[str, Any]) -> Any:
        # Writes are not retried blindly: every write function is idempotent or lease-checked, but a 5xx after a
        # commit would replay an audit row; one try, and the run resumes on the next claim.
        return self._call("POST", f"rpc/{name}", args, retries=0)

    def select(self, table: str, params: str) -> list[dict[str, Any]]:
        out = self._call("GET", f"{table}?{params}")
        return out if isinstance(out, list) else []

    def insert(self, table: str, row: dict[str, Any]) -> None:
        self._call("POST", table, row, prefer="return=minimal", retries=1)

    def upsert(self, table: str, row: dict[str, Any], on_conflict: str) -> None:
        self._call("POST", f"{table}?on_conflict={quote(on_conflict)}", row,
                   prefer="resolution=merge-duplicates,return=minimal", retries=1)


class Home:
    """The worker's typed door onto its own functions."""

    def __init__(self, db: Any):
        self.db = db

    def scan(self, limit: int = 20) -> dict[str, Any]:
        return self.db.rpc("cockpit_market_intel_scan", {"p_limit": limit}) or {}

    def enqueue(self, task_id: str, response_id: str, reason: str, by: str, note: Optional[str]) -> dict[str, Any]:
        return self.db.rpc("cockpit_market_intel_enqueue", {"p_task_id": task_id, "p_response_id": response_id,
                                                            "p_reason": reason, "p_by": by, "p_note": note}) or {}

    def claim(self, worker: str) -> dict[str, Any]:
        return self.db.rpc("cockpit_market_intel_claim", {"p_worker": worker, "p_lease_minutes": 60}) or {}

    def progress(self, run_id: str, claim: str, state: Optional[str], progress: Optional[dict[str, Any]],
                 spend: Optional[dict[str, Any]]) -> dict[str, Any]:
        return self.db.rpc("cockpit_market_intel_progress", {"p_run_id": run_id, "p_claim": claim, "p_state": state,
                                                             "p_progress": progress, "p_spend": spend}) or {}

    def store(self, run_id: str, claim: str, kind: str, rows: list[dict[str, Any]]) -> None:
        for i in range(0, len(rows), 200):
            self.db.rpc("cockpit_market_intel_store", {"p_run_id": run_id, "p_claim": claim, "p_kind": kind,
                                                       "p_rows": rows[i:i + 200]})

    def release(self, run_id: str, claim: str, sentence: str, retry_minutes: int = 30,
                kind: str = "error") -> dict[str, Any]:
        """Back to the queue. kind: error (a try), outage (not a try; 24 hours of it ends needs_person), paused."""
        return self.db.rpc("cockpit_market_intel_release", {"p_run_id": run_id, "p_claim": claim,
                                                            "p_sentence": sentence[:600],
                                                            "p_retry_minutes": retry_minutes, "p_kind": kind}) or {}

    def done(self, run_id: str, claim: str, state: str, sentence: str, summary: dict[str, Any]) -> dict[str, Any]:
        return self.db.rpc("cockpit_market_intel_done", {"p_run_id": run_id, "p_claim": claim, "p_state": state,
                                                         "p_sentence": sentence[:600], "p_summary": summary}) or {}

    def input(self, run_id: str) -> dict[str, Any]:
        return self.db.rpc("cockpit_market_intel_input", {"p_run_id": run_id}) or {}

    def preview(self, task_id: str) -> dict[str, Any]:
        return self.db.rpc("cockpit_market_intel_preview", {"p_task_id": task_id}) or {}

    def latest_response(self, task_id: str) -> Optional[str]:
        rows = self.db.select("cockpit_form_responses",
                              f"select=id&form_key=eq.onboarding&task_id=eq.{quote(task_id)}&state=in.(submitted,confirmed)"
                              "&order=submitted_at.desc.nullslast&limit=1")
        return str(rows[0]["id"]) if rows else None

    def nap(self, run_id: str, listing_phone: Optional[str]) -> str:
        out = self.db.rpc("cockpit_market_intel_nap", {"p_run_id": run_id, "p_listing_phone": listing_phone})
        return out if out in ("match", "differs", "not_checked") else "not_checked"

    def settings(self) -> dict[str, Any]:
        return self.db.rpc("cockpit_market_intel_settings", {}) or {}

    def month_usd(self) -> Optional[float]:
        try:
            return float(self.db.rpc("cockpit_market_intel_month_usd", {}))
        except (TypeError, ValueError):
            return None

    def prune(self, days: int) -> dict[str, Any]:
        return self.db.rpc("cockpit_market_intel_prune", {"p_days": days}) or {}

    def runs(self, params: str) -> list[dict[str, Any]]:
        return self.db.select("cockpit_market_intel_runs", params)

    def evidence(self, run_id: str) -> list[dict[str, Any]]:
        """In the run's own order (E1, E2, ... E10), not the text order the database sorts eid in: the facts depend
        on it (a second source read after the first), so a resend shows the same numbers as the run."""
        rows = self.db.select("cockpit_market_intel_evidence",
                              f"select=eid,kind,subject,url,retrieved_at,source,usd,body,sha256&run_id=eq.{run_id}&order=eid")

        def n(e: dict[str, Any]) -> int:
            digits = str(e.get("eid") or "")[1:]
            return int(digits) if digits.isdigit() else 1 << 30

        return sorted(rows, key=n)

    def findings(self, run_id: str) -> list[dict[str, Any]]:
        return self.db.select("cockpit_market_intel_findings", f"select=lang,findings,checks&run_id=eq.{run_id}")

    def competitors(self, run_id: str) -> list[dict[str, Any]]:
        return self.db.select("cockpit_market_intel_competitors", f"select=*&run_id=eq.{run_id}&order=cid")

    def ledger_row(self, row: dict[str, Any]) -> None:
        self.db.insert("cockpit_csm_provider_health", row)

    def health(self, ok: bool, note: str, detail: dict[str, Any], rows_seen: int = 0) -> None:
        at = now_iso()
        row = {"key": HEALTH_KEY, "ok": ok, "note": note[:500], "detail": detail, "rows_seen": rows_seen,
               "last_run_at": at, "updated_at": at}
        if ok:
            row["last_ok_at"] = at
        self.db.upsert("cockpit_sync_state", row, "key")
