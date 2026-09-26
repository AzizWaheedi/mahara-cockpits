#!/usr/bin/env python3
"""Offline unit tests for EOD delivery worker (hermes/eod-out/out.py).

Verifies:
- Default DRY_RUN: no side effects, no mutations, preview report accurately skips already receipted transports
- Explicit --apply: records durable send intent, delivers to Slack and Sheets, records independent receipts
- Independent receipts: does not re-send Slack or re-append Sheets on retry
- Durable send intent & fence: requires claim_token, worker_id, and active lease
- Send-success then receipt-failure stops further sends: fails closed without downgrading successful external effects
- Ambiguous outcome handling: fails closed with reconciliation_needed flag, halts auto-resends
- Google Sheets date serialization: converts Timestamp UTC string, DD-MM-YYYY, YYYY-MM-DD to serial integers
- Human-owned sheet column ordering and list position preservation across actual producer examples
- Doctor diagnostics: checks configuration without exposing credential fragments, prefixes, or lengths
- Bounds validation: --limit (1..100) and --lease (10..3600)
"""

from __future__ import annotations

import io
import os
import sys
import unittest
import uuid
from unittest.mock import patch, Mock
from contextlib import redirect_stdout
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import out as worker

from out import (
    DEFAULT_LEASE_SECONDS,
    AmbiguousExternalOutcome,
    StaleLeaseError,
    order_by_header,
    run_doctor,
    run_worker,
    to_sheets_serial_date,
)


class FakeStore:
    def __init__(self, rows: Optional[List[Dict[str, Any]]] = None) -> None:
        self.rows: Dict[int, Dict[str, Any]] = {
            r["id"]: dict(r) for r in (rows or [])
        }
        self.intent_calls: List[Tuple[int, str, str, str]] = []
        self.receipt_calls: List[Dict[str, Any]] = []
        self.fail_receipt_for_id: Optional[int] = None

    def call(self, method: str, path: str, body=None, prefer: str = "") -> Any:
        if method == "GET" and path.startswith("eod_outbox"):
            return [
                dict(r) for r in self.rows.values()
                if r.get("status") == "queued" and not r.get("reconciliation_needed")
            ]
        raise NotImplementedError(f"Direct raw call {method} {path} not permitted in strict RPC mode")

    def claim_rows(self, worker_id: str, lease_seconds: int = DEFAULT_LEASE_SECONDS, limit: int = 20) -> List[Dict[str, Any]]:
        claimed = []
        now_dt = datetime.now(timezone.utc)
        for r in self.rows.values():
            if r.get("reconciliation_needed"):
                continue
            is_queued = r.get("status") == "queued"
            is_expired = False
            if r.get("status") == "processing" and r.get("lease_expires_at"):
                exp = datetime.fromisoformat(r["lease_expires_at"])
                if exp < now_dt and not r.get("slack_started_at") and not r.get("sheet_started_at"):
                    is_expired = True

            if (is_queued or is_expired) and int(r.get("attempts") or 0) < 5:
                r["status"] = "processing"
                r["claimed_by"] = worker_id
                r["claim_token"] = str(uuid.uuid4())
                r["claimed_at"] = now_dt.isoformat()
                r["lease_expires_at"] = (now_dt + timedelta(seconds=lease_seconds)).isoformat()
                r["attempts"] = int(r.get("attempts") or 0) + 1
                claimed.append(dict(r))
                if len(claimed) >= limit:
                    break
        return claimed

    def start_send(self, row_id: Any, worker_id: str, claim_token: str, transport: str) -> None:
        row = self.rows.get(int(row_id))
        if not row:
            raise StaleLeaseError(f"Row {row_id} not found")
        if row.get("claimed_by") != worker_id or row.get("claim_token") != claim_token:
            raise StaleLeaseError(f"Fenced send-start write rejected: wrong worker or token")
        if transport == "slack":
            row["slack_started_at"] = datetime.now(timezone.utc).isoformat()
        elif transport == "sheet":
            row["sheet_started_at"] = datetime.now(timezone.utc).isoformat()
        self.intent_calls.append((int(row_id), worker_id, claim_token, transport))

    def record_receipt(
        self,
        row_id: Any,
        worker_id: str,
        claim_token: str,
        *,
        slack_ts: Optional[str] = None,
        slack_error: Optional[str] = None,
        sheet_at: Optional[str] = None,
        sheet_error: Optional[str] = None,
        status: Optional[str] = None,
        reconciliation_needed: bool = False,
        reconcile_reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        if self.fail_receipt_for_id == int(row_id):
            raise RuntimeError(f"Database error writing receipt for row {row_id}")

        row = self.rows.get(int(row_id))
        if not row:
            raise StaleLeaseError(f"Row {row_id} not found")
        if row.get("claimed_by") != worker_id or row.get("claim_token") != claim_token:
            raise StaleLeaseError(f"Fenced receipt write rejected: wrong worker or token")

        if slack_ts is not None:
            row["slack_ts"] = slack_ts
            row["sent_at"] = datetime.now(timezone.utc).isoformat()
        if slack_error is not None:
            row["error"] = slack_error
        if sheet_at is not None:
            row["sheet_at"] = sheet_at
        if sheet_error is not None:
            row["sheet_error"] = sheet_error
        if status is not None:
            row["status"] = status
        if reconciliation_needed:
            row["reconciliation_needed"] = True
            row["reconcile_reason"] = reconcile_reason

        self.receipt_calls.append({"id": int(row_id), **dict(row)})
        return dict(row)


class EodWorkerTests(unittest.TestCase):
    def test_default_dry_run_no_effects_and_preview_skipping(self):
        """Dry-run by default: no Slack, no Sheets, no mutations, skips already receipted transports in preview."""
        store = FakeStore([
            {
                "id": 1,
                "role": "media_buyer",
                "day": "2026-09-27",
                "person": "Sarah Al-Mutawa",
                "tab": "Media Buyers",
                "row_values": {"date": "2026-09-27", "spend": 500},
                "channel": "C123",
                "body": "EOD Media Buyer - Sarah\nSubmitted by: <@U123>",
                "status": "queued",
                "attempts": 0,
                "slack_ts": "ts_already_sent_111",
                "sheet_at": None,
            }
        ])

        slack_calls = []
        sheets_calls = []

        buf = io.StringIO()
        with redirect_stdout(buf):
            code = run_worker(
                apply_mode=False,
                store=store,
                slack_fn=lambda ch, txt: slack_calls.append((ch, txt)),
                file_row_fn=lambda tab, val: sheets_calls.append((tab, val)),
            )

        self.assertEqual(code, 0)
        self.assertEqual(len(slack_calls), 0)
        self.assertEqual(len(sheets_calls), 0)
        self.assertEqual(store.rows[1]["status"], "queued")
        output = buf.getvalue()
        self.assertIn("[DRY RUN]", output)
        self.assertIn("Slack: already sent (ts: ts_already_sent_111)", output)
        self.assertIn("Intended Sheet: tab 'Media Buyers'", output)

    def test_explicit_apply_with_durable_intent(self):
        """Explicit apply writes durable intent before each external send, then records receipt."""
        store = FakeStore([
            {
                "id": 2,
                "role": "csm",
                "day": "2026-09-27",
                "person": "Dina Ezzat",
                "tab": "CSM",
                "row_values": {"Date": "2026-09-27", "Name": "Dina Ezzat"},
                "channel": "C456",
                "body": "CSM EOD - Dina Ezzat\nSubmitted by: <@U456>",
                "status": "queued",
                "attempts": 0,
            }
        ])

        code = run_worker(
            apply_mode=True,
            store=store,
            slack_fn=lambda ch, txt: "slack_ts_456",
            file_row_fn=lambda tab, val: None,
        )

        self.assertEqual(code, 0)
        # Verify durable intent was recorded for both transports
        transports = [call[3] for call in store.intent_calls if call[0] == 2]
        self.assertIn("sheet", transports)
        self.assertIn("slack", transports)

        row = store.rows[2]
        self.assertEqual(row["status"], "sent")
        self.assertEqual(row["slack_ts"], "slack_ts_456")
        self.assertIsNotNone(row.get("sheet_at"))

    def test_independent_receipts_skip_completed_transports(self):
        """If Slack or Sheets is already receipted, it is skipped on retry."""
        store = FakeStore([
            {
                "id": 3,
                "role": "video_editor",
                "day": "2026-09-27",
                "person": "Karim Abdelrahman",
                "tab": "Video Editors",
                "row_values": {"Date for": "2026-09-27", "Name": "Karim"},
                "channel": "C789",
                "body": "Video Editor EOD - Karim\nSubmitted by: <@U789>",
                "status": "queued",
                "slack_ts": "existing_slack_ts_999",
                "sheet_at": None,
                "attempts": 1,
            }
        ])

        slack_calls = []
        sheets_calls = []

        code = run_worker(
            apply_mode=True,
            store=store,
            slack_fn=lambda ch, txt: slack_calls.append((ch, txt)),
            file_row_fn=lambda tab, val: sheets_calls.append((tab, val)),
        )

        self.assertEqual(code, 0)
        self.assertEqual(len(slack_calls), 0, "Must not re-send Slack if receipt exists")
        self.assertEqual(len(sheets_calls), 1, "Must append sheet if not receipted")
        self.assertEqual(store.rows[3]["status"], "sent")
        self.assertEqual(store.rows[3]["slack_ts"], "existing_slack_ts_999")

    def test_successful_send_then_receipt_failure_stops_further_sends(self):
        """If sheet append succeeds but receipt write fails, stop further sends and fail closed."""
        store = FakeStore([
            {
                "id": 4,
                "role": "media_buyer",
                "day": "2026-09-27",
                "person": "Sarah Al-Mutawa",
                "tab": "Media Buyers",
                "row_values": {"date": "2026-09-27"},
                "channel": "C123",
                "body": "EOD Media Buyer\nSubmitted by: <@U123>",
                "status": "queued",
                "attempts": 0,
            }
        ])
        store.fail_receipt_for_id = 4  # Simulate DB failure on receipt write

        slack_calls = []
        sheets_calls = []

        run_worker(
            apply_mode=True,
            store=store,
            slack_fn=lambda ch, txt: slack_calls.append((ch, txt)),
            file_row_fn=lambda tab, val: sheets_calls.append((tab, val)),
        )

        self.assertEqual(len(sheets_calls), 1)
        self.assertEqual(len(slack_calls), 0, "Must halt immediately on receipt write failure; no further sends")
        self.assertNotEqual(store.rows[4].get("status"), "sent")

    def test_ambiguous_outcome_fails_closed_for_reconciliation(self):
        """Ambiguous external outcome (timeout) marks reconciliation_needed and halts automatic resends."""
        store = FakeStore([
            {
                "id": 5,
                "role": "media_buyer",
                "day": "2026-09-27",
                "person": "Sarah",
                "channel": "C123",
                "body": "EOD",
                "status": "queued",
                "attempts": 0,
            }
        ])

        def ambiguous_slack(ch, txt):
            raise AmbiguousExternalOutcome("Connection reset by peer during postMessage")

        run_worker(apply_mode=True, store=store, slack_fn=ambiguous_slack)

        row = store.rows[5]
        self.assertTrue(row.get("reconciliation_needed"))
        self.assertEqual(row.get("status"), "failed")
        self.assertIn("Connection reset", str(row.get("reconcile_reason")))

    def test_date_conversion_formats_and_position_preservation(self):
        """Converts YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, and Timestamp UTC string; retains list positions."""
        # YYYY-MM-DD -> 46292 (2026-09-27)
        self.assertEqual(to_sheets_serial_date("2026-09-27"), 46292)

        # DD-MM-YYYY
        self.assertEqual(to_sheets_serial_date("27-09-2026"), 46292)

        # DD/MM/YYYY
        self.assertEqual(to_sheets_serial_date("27/09/2026"), 46292)

        # Timestamp UTC string in UTC: 2026-09-26T21:30:00Z -> +3h is 2026-09-27 00:30:00 -> 46292
        self.assertEqual(to_sheets_serial_date("2026-09-26T21:30:00Z"), 46292)

        # Retains array positions
        cols = ["Date", "Name", "Videos completed", "Day summary"]
        arr_values = ["27-09-2026", "Karim Abdelrahman", 3, "Cut reels"]
        ordered = order_by_header(cols, arr_values)
        self.assertEqual(ordered, [46292, "Karim Abdelrahman", 3, "Cut reels"])

        # Named sales fields in dict
        sales_cols = ["Date", "Rep Name", "Cash Collected", "Calls"]
        sales_values = {
            "date": "2026-09-27",
            "rep name": "Ahmed",
            "cash collected": 1500,
            "calls": 12,
        }
        ordered_sales = order_by_header(sales_cols, sales_values)
        self.assertEqual(ordered_sales, [46292, "Ahmed", 1500, 12])

    def test_doctor_command_no_credential_fragments(self):
        """Doctor reports only configured/missing state with no secret prefixes or lengths."""
        os.environ["DESK_SUPABASE_URL"] = "https://bldgtotkfmhoxmlzowdx.supabase.co"
        os.environ["DESK_SUPABASE_KEY"] = "super-secret-key-12345"
        os.environ["SLACK_BOT_TOKEN"] = "xoxb-secret-token-67890"

        buf = io.StringIO()
        with redirect_stdout(buf), patch.dict(os.environ, {"GOOGLE_APPLICATION_CREDENTIALS": "fixture.json"}), patch("os.path.isfile", return_value=True):
            code = run_doctor()

        output = buf.getvalue()
        self.assertEqual(code, 0)
        self.assertNotIn("xoxb", output)
        self.assertNotIn("12345", output)
        self.assertNotIn("67890", output)
        self.assertNotIn("length", output.lower())
        self.assertNotIn("bldgtotkfmhoxmlzowdx", output)
        self.assertIn("DESK_SUPABASE_URL: configured", output)
        self.assertIn("SLACK_BOT_TOKEN: configured", output)

    def test_bounds_validation(self):
        """Validates bounds on limit and lease."""
        with self.assertRaises(ValueError):
            run_worker(limit=0)
        with self.assertRaises(ValueError):
            run_worker(limit=101)
        with self.assertRaises(ValueError):
            run_worker(lease_seconds=5)
        with self.assertRaises(ValueError):
            run_worker(lease_seconds=4000)

    def test_store_never_falls_back_or_accepts_unconfirmed_intent(self):
        store = worker.Store("https://example.invalid", "fixture-key")
        with patch.object(store, "call", side_effect=RuntimeError("RPC unavailable")) as call:
            with self.assertRaises(RuntimeError):
                store.claim_rows("worker")
            self.assertEqual(call.call_count, 1)
        with patch.object(store, "call", return_value={"ok": True}):
            with self.assertRaises(worker.StaleLeaseError):
                store.start_send(1, "worker", "token", "slack")
            with self.assertRaises(RuntimeError):
                store.record_receipt(1, "worker", "token", slack_ts="123")

    def test_slack_missing_or_malformed_receipts_are_ambiguous(self):
        for body in [b'{"ok":true}', b'[]', b'not json']:
            with patch.dict(os.environ, {"SLACK_BOT_TOKEN": "fixture"}), patch("urllib.request.urlopen", return_value=io.BytesIO(body)) as call:
                with self.assertRaises(worker.AmbiguousExternalOutcome):
                    worker.slack_post("TEST", "TEST")
                self.assertEqual(call.call_count, 1)
        with patch.dict(os.environ, {"SLACK_BOT_TOKEN": "fixture"}), patch("urllib.request.urlopen", return_value=io.BytesIO(b'{"ok":false,"error":"not_in_channel"}')):
            with self.assertRaises(worker.KnownNotSent):
                worker.slack_post("TEST", "TEST")

    def test_sheets_once_only_service_account_and_confirmed_row(self):
        append = Mock(return_value={})
        with patch.object(worker, "service_account_token", return_value="fixture"):
            with self.assertRaises(worker.AmbiguousExternalOutcome):
                worker.file_row("TEST", ["27-09-2026"], header_fn=lambda *a: ["Date"], append_fn=append)
            self.assertEqual(append.call_count, 1)
            append.return_value = {"updates": {"updatedRows": 1, "updatedRange": "TEST!A2"}}
            worker.file_row("TEST", ["27-09-2026"], header_fn=lambda *a: ["Date"], append_fn=append)
            self.assertEqual(append.call_args.args[-1], [46292])
        with patch.dict(os.environ, {}, clear=True), patch("urllib.request.urlopen") as http:
            with self.assertRaises(worker.KnownNotSent):
                worker.service_account_token()
            http.assert_not_called()
        with patch("urllib.request.urlopen", side_effect=TimeoutError) as http:
            with self.assertRaises(TimeoutError):
                worker.sheet_append_once("fixture", "TEST", "TEST", [1])
            self.assertEqual(http.call_count, 1)

    def test_legacy_timestamp_and_report_date_are_serials_without_moving_columns(self):
        self.assertEqual(order_by_header(["Timestamp", "Name", "Response ID", "Date"],
            ["2026-09-26 21:30:00", "Fixture", "fixture-id", "27-09-2026"]),
            [46292, "Fixture", "fixture-id", 46292])

    def test_unknown_send_outcome_does_not_become_a_retryable_error(self):
        store = FakeStore([{"id": 99, "status": "queued", "channel": "TEST", "body": "TEST"}])
        send = Mock(side_effect=RuntimeError("Unclassified transport fault"))
        self.assertEqual(run_worker(apply_mode=True, store=store, slack_fn=send), 1)
        self.assertEqual(store.rows[99]["status"], "processing")
        self.assertTrue(store.rows[99]["slack_started_at"])
        self.assertEqual(send.call_count, 1)


if __name__ == "__main__":
    unittest.main()
