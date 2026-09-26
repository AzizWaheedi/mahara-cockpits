#!/usr/bin/env python3
"""Carries every cockpit's end of day out to Slack and the EOD sheet safely.

Hardened against duplicates and crash windows:
* DRY_RUN is active by default. Live execution requires explicit --apply.
* --doctor verifies configuration state without exposing credential fragments.
* Atomic claims and leases prevent simultaneous delivery across multiple workers.
* Durable send-start intent recorded in DB before any external network call.
* Fenced receipts require status=processing, active lease, worker ID, and unique claim token.
* If an external send succeeds but receipt recording fails, stops further processing and fails closed.
* All raw REST PATCH and GET+PATCH fallbacks removed; worker fails closed if RPCs fail.
* Supported report date fields are converted to Google Sheets serial integers UTC+3.
* Slack message is delivered as `text` preserving the required Submitted by line.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

EOD_SHEET = "1EhPp7x0jZfV8dNjUvmuWv_alNvduMGpe_COjUAB13bw"
MAX_ATTEMPTS = 5
DEFAULT_LEASE_SECONDS = 300
SHEETS_EPOCH = date(1899, 12, 30)
UTC_PLUS_3 = timezone(timedelta(hours=3))
DATE_HEADERS = {"date", "date for", "_date_for", "day", "report date", "timestamp", "submitted at", "_submitted_at"}


class KnownNotSent(RuntimeError):
    """Preflight failure or explicit provider rejection, safe to retry."""


class StaleLeaseError(RuntimeError):
    """Raised when an outbox claim lease has expired or was claimed by another worker."""
    pass


class AmbiguousExternalOutcome(RuntimeError):
    """Raised when external status (Slack/Sheets) is uncertain due to timeout or transport fault."""
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def note(line: str) -> None:
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] {line}", flush=True)


def to_sheets_serial_date(val: Any) -> Any:
    """Convert supported report date field to Google Sheets serial integer UTC+3.

    Google Sheets counts serial days from 1899-12-30. If the value cannot be
    parsed as a date, return it untouched.
    """
    if isinstance(val, (int, float)):
        return val
    if not isinstance(val, str):
        return val
    s = val.strip()
    if not s:
        return val

    # ISO timestamp with time (e.g. 2026-09-27T18:00:00Z)
    if "T" in s or (len(s) > 10 and s[10] == " "):
        try:
            clean_s = s.replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean_s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            dt_utc3 = dt.astimezone(UTC_PLUS_3)
            return (dt_utc3.date() - SHEETS_EPOCH).days
        except (ValueError, TypeError):
            pass

    # YYYY-MM-DD
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        try:
            d = datetime.strptime(s, "%Y-%m-%d").date()
            return (d - SHEETS_EPOCH).days
        except ValueError:
            pass

    # DD-MM-YYYY
    if len(s) == 10 and s[2] == "-" and s[5] == "-":
        try:
            d = datetime.strptime(s, "%d-%m-%Y").date()
            return (d - SHEETS_EPOCH).days
        except ValueError:
            pass

    # DD/MM/YYYY
    if len(s) == 10 and s[2] == "/" and s[5] == "/":
        try:
            d = datetime.strptime(s, "%d/%m/%Y").date()
            return (d - SHEETS_EPOCH).days
        except ValueError:
            pass

    return val


def order_by_header(cols: list, values: Any) -> list:
    """A row given as named columns goes under the tab's own header, in its
    order, matching names without case; a list retains its positions.
    Supported report date fields are converted to Google Sheets serial integers UTC+3.
    """
    if not isinstance(values, dict):
        out = list(values)
        for i, val in enumerate(out):
            if i < len(cols) and str(cols[i]).strip().lower() in DATE_HEADERS:
                out[i] = to_sheets_serial_date(val)
        return out
    named = {str(k).strip().lower(): v for k, v in values.items()}
    out = []
    for c in cols:
        ckey = str(c).strip().lower()
        val = named.get(ckey, "")
        if ckey in DATE_HEADERS:
            val = to_sheets_serial_date(val)
        out.append(val)
    return out


class Store:
    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None) -> None:
        self.base = (base_url or os.environ.get("DESK_SUPABASE_URL", "")).rstrip("/")
        self.key = api_key or os.environ.get("DESK_SUPABASE_KEY", "")

    def call(self, method: str, path: str, body=None, prefer: str = "") -> Any:
        if not self.base or not self.key:
            raise RuntimeError("DESK_SUPABASE_URL and DESK_SUPABASE_KEY must be set")
        data = json.dumps(body).encode() if body is not None else None
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        url = f"{self.base}/rest/v1/{path}"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=90) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else []

    def claim_rows(self, worker_id: str, lease_seconds: int = DEFAULT_LEASE_SECONDS, limit: int = 20) -> List[Dict[str, Any]]:
        """Atomically claim queued rows via RPC. Fails closed with no raw REST fallback."""
        res = self.call(
            "POST",
            "rpc/cockpit_claim_eod_outbox",
            {"p_worker_id": worker_id, "p_lease_seconds": lease_seconds, "p_limit": limit},
        )
        if isinstance(res, list):
            return res
        raise RuntimeError("cockpit_claim_eod_outbox RPC failed or returned unexpected payload")

    def start_send(self, row_id: Any, worker_id: str, claim_token: str, transport: str) -> None:
        """Record durable send intent in DB before executing external send. Fails closed with no fallback."""
        res = self.call(
            "POST",
            "rpc/cockpit_start_eod_send",
            {
                "p_id": row_id,
                "p_worker_id": worker_id,
                "p_claim_token": claim_token,
                "p_transport": transport,
            },
        )
        if (not isinstance(res, dict) or str(res.get("id")) != str(row_id)
                or res.get("status") != "processing" or res.get("claimed_by") != worker_id
                or res.get("claim_token") != claim_token or not res.get(f"{transport}_started_at")):
            raise StaleLeaseError("Send-start was not confirmed; no external send is allowed")

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
        """Record receipt under strict claim token, worker ID, and lease fence. Fails closed with no fallback."""
        res = self.call(
            "POST",
            "rpc/cockpit_record_eod_receipt",
            {
                "p_id": row_id,
                "p_worker_id": worker_id,
                "p_claim_token": claim_token,
                "p_slack_ts": slack_ts,
                "p_slack_error": slack_error,
                "p_sheet_at": sheet_at,
                "p_sheet_error": sheet_error,
                "p_status": status,
                "p_reconciliation_needed": reconciliation_needed,
                "p_reconcile_reason": reconcile_reason,
            },
        )
        if (isinstance(res, dict) and str(res.get("id")) == str(row_id)
                and (res.get("claim_token") == claim_token or res.get("status") == "queued")
                and (slack_ts is None or res.get("slack_ts") == slack_ts)
                and (sheet_at is None or bool(res.get("sheet_at")))
                and (status is None or res.get("status") == status or
                     (status == "queued" and res.get("status") == "failed"))
                and (not reconciliation_needed or res.get("reconciliation_needed") is True)):
            return res
        raise RuntimeError(f"cockpit_record_eod_receipt RPC failed for row {row_id}")


def is_ambiguous_error(exc: Exception) -> bool:
    """True if an exception represents an uncertain delivery state (timeout, connection reset)."""
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return True
    if isinstance(exc, urllib.error.URLError):
        reason = str(exc.reason).lower()
        if "timed out" in reason or "connection reset" in reason or "connection refused" in reason:
            return True
    if isinstance(exc, urllib.error.HTTPError):
        # 5xx responses from Slack / Google Sheets may mean request succeeded before connection died
        if exc.code in (500, 502, 503, 504):
            return True
    return False


def slack_post(channel: str, text: str) -> str:
    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        raise KnownNotSent("SLACK_BOT_TOKEN is not set")
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=json.dumps({"channel": channel, "text": text}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            out = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        if 400 <= e.code < 500 and e.code != 408:
            raise KnownNotSent(f"Slack rejected request: HTTP {e.code}") from e
        raise AmbiguousExternalOutcome("Slack delivery response is uncertain") from e
    except Exception as e:
        raise AmbiguousExternalOutcome("Slack delivery response is uncertain") from e

    if isinstance(out, dict) and out.get("ok") is False and isinstance(out.get("error"), str):
        err_msg = str(out.get("error") or "unknown_error")
        # Explicit Slack API rejection: message definitely not delivered
        raise KnownNotSent(f"slack: {err_msg}")
    if not isinstance(out, dict) or out.get("ok") is not True or not isinstance(out.get("ts"), str) or not out["ts"].strip():
        raise AmbiguousExternalOutcome("Slack response has no confirmed message receipt")
    return out["ts"]


def service_account_token() -> str:
    """Only a service account may write the EOD sheet; no personal OAuth fallback."""
    from google.oauth2.service_account import Credentials
    from google.auth.transport.requests import Request
    credential_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if not credential_path:
        raise KnownNotSent("GOOGLE_APPLICATION_CREDENTIALS is not configured")
    creds = Credentials.from_service_account_file(
        credential_path, scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    creds.refresh(Request())
    if not creds.token:
        raise KnownNotSent("Service account did not return a token")
    return creds.token


def sheet_header(token: str, sheet: str, tab: str) -> list:
    quoted_tab = "'" + tab.replace("'", "''") + "'"
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{sheet}/values/"
           + urllib.parse.quote(quoted_tab + "!1:1", safe="")
           + "?valueRenderOption=UNFORMATTED_VALUE")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=40) as response:
        data = json.loads(response.read())
    return data.get("values", [[]])[0]


def sheet_append_once(token: str, sheet: str, tab: str, values: list) -> dict:
    # Exactly one HTTP attempt. A generic retrying HTTP wrapper can duplicate rows.
    n, column = max(1, len(values)), ""
    while n:
        n, rem = divmod(n - 1, 26)
        column = chr(65 + rem) + column
    quoted_tab = "'" + tab.replace("'", "''") + "'"
    url = (f"https://sheets.googleapis.com/v4/spreadsheets/{sheet}/values/"
           + urllib.parse.quote(quoted_tab + "!A:" + column, safe="")
           + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS")
    req = urllib.request.Request(url, data=json.dumps({"values": [values]}).encode(),
        method="POST", headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as response:
        return json.loads(response.read())


def file_row(tab: str, values: Any, header_fn: Optional[Callable] = None, append_fn: Optional[Callable] = None) -> None:
    """Preserve header order and human text; append once using the service account."""
    try:
        if not isinstance(values, (dict, list)):
            raise ValueError("Sheet values must be a list or column mapping")
        token = service_account_token()
        cols = (header_fn or sheet_header)(token, EOD_SHEET, tab)
        if not cols:
            raise ValueError("Sheet header is missing")
        ordered = order_by_header(cols, values)
    except Exception as e:
        raise KnownNotSent("Google Sheets preflight failed") from e
    try:
        receipt = (append_fn or sheet_append_once)(token, EOD_SHEET, tab, ordered)
        updates = receipt.get("updates") if isinstance(receipt, dict) else None
        if not isinstance(updates, dict) or updates.get("updatedRows") != 1 or not updates.get("updatedRange"):
            raise AmbiguousExternalOutcome("Sheet append has no confirmed row receipt")
    except urllib.error.HTTPError as e:
        if 400 <= e.code < 500 and e.code != 408:
            raise KnownNotSent(f"Google Sheets rejected request: HTTP {e.code}") from e
        raise AmbiguousExternalOutcome("Google Sheets delivery response is uncertain") from e
    except Exception as e:
        raise AmbiguousExternalOutcome("Google Sheets delivery response is uncertain") from e


def run_doctor() -> int:
    """Check configuration without revealing secrets or credential fragments."""
    note("--- EOD Delivery Worker Doctor ---")
    sb_url = bool(os.environ.get("DESK_SUPABASE_URL", "").strip())
    sb_key = bool(os.environ.get("DESK_SUPABASE_KEY", "").strip())
    slack_token = bool(os.environ.get("SLACK_BOT_TOKEN", "").strip())

    ok = True
    note(f"  DESK_SUPABASE_URL: {'configured' if sb_url else 'missing'}")
    if not sb_url:
        ok = False

    note(f"  DESK_SUPABASE_KEY: {'configured' if sb_key else 'missing'}")
    if not sb_key:
        ok = False

    note(f"  SLACK_BOT_TOKEN: {'configured' if slack_token else 'missing'}")
    if not slack_token:
        ok = False

    account_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    account_ok = bool(account_path and os.path.isfile(account_path))
    try:
        from google.oauth2.service_account import Credentials
        from google.auth.transport.requests import Request
    except ImportError:
        account_ok = False
    note(f"  Google service account: {'configured' if account_ok else 'missing'}")
    ok = ok and account_ok

    if ok:
        note("Doctor: ALL REQUIRED CONFIGURATIONS CONFIGURED")
        return 0
    note("Doctor: MISSING CONFIGURATIONS DETECTED")
    return 1


def run_worker(
    *,
    apply_mode: bool = False,
    limit: int = 20,
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
    store: Optional[Store] = None,
    slack_fn: Optional[Callable[[str, str], str]] = None,
    file_row_fn: Optional[Callable[[str, Any], None]] = None,
) -> int:
    if limit < 1 or limit > 100:
        raise ValueError("Limit must be between 1 and 100")
    if lease_seconds < 10 or lease_seconds > 3600:
        raise ValueError("Lease must be between 10 and 3600 seconds")

    sb = store or Store()
    post_slack = slack_fn or slack_post
    append_row = file_row_fn or file_row

    if not apply_mode:
        note("[DRY RUN] Active by default. No external calls (Slack/Sheets) or database mutations will be made.")
        note("          Pass --apply to execute live delivery.")
        try:
            rows = sb.call("GET", f"eod_outbox?select=*&status=eq.queued&reconciliation_needed=is.false&order=created_at&limit={limit}")
        except Exception as e:
            note(f"Failed to query outbox in dry run: {e}")
            return 1

        if not rows:
            note("[DRY RUN] Nothing queued in eod_outbox.")
            return 0

        note(f"[DRY RUN] Found {len(rows)} queued row(s):")
        for r in rows:
            person = r.get("person") or "(unknown)"
            role = r.get("role") or "(unknown)"
            note(f"  - Row #{r.get('id')} [{role}] {person}:")
            if r.get("slack_ts"):
                note(f"      Slack: already sent (ts: {r.get('slack_ts')})")
            else:
                body_summary = (r.get("body") or "").splitlines()[0] if r.get("body") else "(empty)"
                channel = r.get("channel") or "(no channel)"
                note(f"      Intended Slack: channel {channel} | \"{body_summary[:60]}\"")

            if r.get("sheet_at"):
                note(f"      Sheet: already filed ({r.get('sheet_at')})")
            elif r.get("tab") and r.get("row_values"):
                tab = r.get("tab")
                note(f"      Intended Sheet: tab '{tab}' | {r.get('row_values')}")
            else:
                note("      Intended Sheet: (none specified)")
        return 0

    worker_id = f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:8]}"
    note(f"Starting live EOD delivery worker (worker_id={worker_id}, lease={lease_seconds}s, limit={limit})")

    try:
        rows = sb.claim_rows(worker_id, lease_seconds=lease_seconds, limit=limit)
    except Exception as e:
        note(f"Failed to claim outbox rows (failing closed): {e}")
        return 1

    if not rows:
        note("Nothing queued for delivery.")
        return 0

    sent = failed = reconciled = 0
    for row in rows:
        row_id = row.get("id")
        claim_token = row.get("claim_token")
        if not claim_token:
            note(f"  Row #{row_id}: missing claim token, skipping to fail closed")
            failed += 1
            continue

        person = row.get("person", "unknown")
        role = row.get("role", "unknown")
        channel = row.get("channel", "")
        tab = row.get("tab")
        row_values = row.get("row_values")

        sheet_done = bool(row.get("sheet_at")) or not (tab and row_values)
        sheet_err: Optional[str] = None
        new_sheet_at: Optional[str] = None

        if tab and row_values and not row.get("sheet_at"):
            # 1. Record durable send intent BEFORE external network call
            try:
                sb.start_send(row_id, worker_id, claim_token, "sheet")
            except Exception as e:
                note(f"  Row #{row_id}: failed to record sheet send-start intent ({e}); halting send")
                failed += 1
                continue

            # 2. Execute external Sheets call
            try:
                append_row(str(tab), row_values)
                new_sheet_at = now()
            except AmbiguousExternalOutcome as aeo:
                note(f"  Row #{row_id} [AMBIGUOUS SHEETS]: {aeo}. Failing closed for reconciliation.")
                try:
                    sb.record_receipt(
                        row_id,
                        worker_id,
                        claim_token,
                        sheet_error=str(aeo)[:400],
                        status="failed",
                        reconciliation_needed=True,
                        reconcile_reason=f"Sheets ambiguous: {aeo}",
                    )
                except Exception as rec_err:
                    note(f"  Row #{row_id}: failed to record reconciliation receipt: {rec_err}")
                reconciled += 1
                continue
            except KnownNotSent as e:
                sheet_err = str(e)[:400]
                note(f"  Row #{row_id}: sheet append failed: {e}")
                try:
                    sb.record_receipt(row_id, worker_id, claim_token, sheet_error=sheet_err)
                except Exception as rec_err:
                    note(f"  Row #{row_id}: failed to record sheet error receipt: {rec_err}")
                    failed += 1
                    continue
            except Exception:
                note(f"  Row #{row_id}: uncertain sheet outcome; durable intent retained for reconciliation")
                failed += 1
                continue

            # 3. If external send succeeded, record receipt immediately
            if new_sheet_at:
                try:
                    sb.record_receipt(row_id, worker_id, claim_token, sheet_at=new_sheet_at, sheet_error=None)
                    sheet_done = True
                    note(f"  Row #{row_id}: filed to sheet '{tab}'")
                except Exception as e:
                    # External send succeeded, but receipt write failed: STOP further sends!
                    # Do NOT downgrade successful external effect to retryable.
                    note(f"  Row #{row_id} [CRITICAL]: Sheet append succeeded but receipt write failed ({e}). Halting row.")
                    failed += 1
                    continue

        slack_ts = row.get("slack_ts")
        slack_err: Optional[str] = None
        new_slack_ts: Optional[str] = None

        if not slack_ts:
            # 1. Record durable send intent BEFORE external network call
            try:
                sb.start_send(row_id, worker_id, claim_token, "slack")
            except Exception as e:
                note(f"  Row #{row_id}: failed to record slack send-start intent ({e}); halting send")
                failed += 1
                continue

            # 2. Execute external Slack call
            try:
                new_slack_ts = post_slack(str(channel), str(row.get("body", "")))
                if not isinstance(new_slack_ts, str) or not new_slack_ts.strip():
                    raise AmbiguousExternalOutcome("Slack returned no confirmed receipt")
            except AmbiguousExternalOutcome as aeo:
                note(f"  Row #{row_id} [AMBIGUOUS SLACK]: {aeo}. Failing closed for reconciliation.")
                try:
                    sb.record_receipt(
                        row_id,
                        worker_id,
                        claim_token,
                        slack_error=str(aeo)[:380],
                        status="failed",
                        reconciliation_needed=True,
                        reconcile_reason=f"Slack ambiguous: {aeo}",
                    )
                except Exception as rec_err:
                    note(f"  Row #{row_id}: failed to record reconciliation receipt: {rec_err}")
                reconciled += 1
                continue
            except KnownNotSent as e:
                slack_err = f"{type(e).__name__}: {str(e)[:380]}"
                note(f"  Row #{row_id}: Slack post failed: {slack_err}")
                try:
                    sb.record_receipt(row_id, worker_id, claim_token, slack_error=slack_err)
                except Exception as rec_err:
                    note(f"  Row #{row_id}: failed to record slack error receipt: {rec_err}")
                    failed += 1
                    continue
            except Exception:
                note(f"  Row #{row_id}: uncertain Slack outcome; durable intent retained for reconciliation")
                failed += 1
                continue

            # 3. If external send succeeded, record receipt immediately
            if new_slack_ts:
                try:
                    sb.record_receipt(row_id, worker_id, claim_token, slack_ts=new_slack_ts, slack_error=None)
                    slack_ts = new_slack_ts
                    note(f"  Row #{row_id}: posted to Slack channel {channel}")
                except Exception as e:
                    # External send succeeded, but receipt write failed: STOP further sends!
                    note(f"  Row #{row_id} [CRITICAL]: Slack post succeeded but receipt write failed ({e}). Halting row.")
                    failed += 1
                    continue

        # Finalize only when BOTH required receipts are confirmed
        if slack_ts and sheet_done:
            try:
                sb.record_receipt(row_id, worker_id, claim_token, status="sent")
                sent += 1
                note(f"  Completed #{row_id} for {person} ({role}) -> {channel}")
            except Exception as e:
                note(f"  Row #{row_id}: failed to finalize status to sent: {e}")
                failed += 1
        else:
            n = int(row.get("attempts") or 0)
            final_status = "failed" if n >= MAX_ATTEMPTS else "queued"
            try:
                sb.record_receipt(row_id, worker_id, claim_token, status=final_status)
                note(f"  Row #{row_id} parked as {final_status} (attempts={n})")
            except Exception as e:
                note(f"  Row #{row_id}: failed to update status: {e}")
            failed += 1

    note(f"Run completed: {sent} sent, {failed} failed, {reconciled} flagged for reconciliation.")
    return 1 if failed or reconciled else 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Deliver EOD messages to Slack and Google Sheets safely.")
    parser.add_argument("--apply", action="store_true", help="Execute live sends and mutations (default: dry run)")
    parser.add_argument("--dry-run", action="store_true", help="Run without external sends or DB writes (default)")
    parser.add_argument("--doctor", action="store_true", help="Check config/credentials health without exposing secrets")
    parser.add_argument("--limit", type=int, default=20, help="Maximum number of outbox rows to claim per run (1..100)")
    parser.add_argument("--lease", type=int, default=DEFAULT_LEASE_SECONDS, help="Claim lease timeout in seconds (10..3600)")

    args = parser.parse_args(argv)

    if args.doctor:
        return run_doctor()

    apply_mode = args.apply and not args.dry_run
    try:
        return run_worker(apply_mode=apply_mode, limit=args.limit, lease_seconds=args.lease)
    except ValueError as e:
        note(f"Invalid argument: {e}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
