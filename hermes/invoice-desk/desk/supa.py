"""The cockpit database (Creative Triage) through PostgREST, with the service key.

The worker only calls the cockpit_invoice_* functions of migration
20261011v and reads two tables; it never writes the invoice rows directly.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from . import http


class Supa:
    def __init__(self, url: str, service_key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.h = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    def rpc(self, name: str, args: dict[str, Any]) -> Any:
        return http.send_json("POST", f"{self.base}/rpc/{name}", args, headers=self.h)

    def select(self, table: str, query: str) -> list[dict[str, Any]]:
        return http.get_json(f"{self.base}/{table}?{query}", headers=self.h)

    # ----------------------------------------------------------------- invoices --
    def claim(self, lease_seconds: int = 300) -> Optional[dict[str, Any]]:
        rows = self.rpc("cockpit_invoice_claim", {"p_lease_seconds": lease_seconds}) or []
        return rows[0] if rows else None

    def progress(self, invoice_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        return self.rpc("cockpit_invoice_progress", {"p_id": invoice_id, "p_patch": patch})

    def finish(self, invoice_id: str, ok: bool, error: Optional[str] = None) -> dict[str, Any]:
        return self.rpc("cockpit_invoice_finish", {"p_id": invoice_id, "p_ok": ok, "p_error": error})

    def invoice(self, invoice_id: str) -> Optional[dict[str, Any]]:
        rows = self.select("cockpit_invoices", f"id=eq.{http.quote(invoice_id)}&select=*")
        return rows[0] if rows else None

    def numbers_used(self, year: int) -> list[str]:
        rows = self.select("cockpit_invoices", f"invoice_no=like.INV-{year}-*&select=invoice_no")
        return [r["invoice_no"] for r in rows if r.get("invoice_no")]

    # ------------------------------------------------------------------ folders --
    def folder_for(self, task_id: str) -> Optional[dict[str, Any]]:
        rows = self.select("cockpit_client_drive_folders", f"clickup_task_id=eq.{http.quote(task_id)}&select=*")
        return rows[0] if rows else None

    def save_folder(self, task_id: str, client: str, folder_id: str, folder_name: str) -> dict[str, Any]:
        return self.rpc("cockpit_invoice_save_folder", {"p_task": task_id, "p_client": client,
                                                        "p_folder_id": folder_id, "p_folder_name": folder_name})

    # ------------------------------------------------------------------- health --
    def beat(self, ok: bool, detail: Optional[str], version: str) -> None:
        at = datetime.now(timezone.utc).isoformat()
        http.request("POST", f"{self.base}/cockpit_invoice_desk_status?on_conflict=id",
                     json_body={"id": True, "beat_at": at, "ok": ok, "detail": detail, "version": version},
                     headers={**self.h, "Prefer": "resolution=merge-duplicates,return=minimal"}, retries=2)

    def health(self, rows: list[dict[str, Any]]) -> None:
        if rows:
            http.request("POST", f"{self.base}/cockpit_invoice_desk_health", json_body=rows,
                         headers={**self.h, "Prefer": "return=minimal"}, retries=2)
