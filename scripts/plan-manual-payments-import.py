"""Offline, plan-only manual-payment migration. Never connects to a live system.

Only ceoManualPayments and the related ceoAudit entries are read from the ZIP.
Raw financial artifacts belong outside the repository, under the protected output
directory. There is deliberately no apply flag and no readiness-state write.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import unicodedata
import zipfile
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

DRY_RUN = True
NUMBERS = {"amount", "amount_usd", "usd_per_unit", "deal_contracted", "deal_contracted_usd"}
TIMES = {"added_at", "deleted_at"}


def money(value, field: str, *, positive: bool = False) -> str:
    if isinstance(value, bool) or value is None:
        raise ValueError(f"{field}: numeric source value required")
    try:
        result = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError(f"{field}: invalid number") from exc
    if not result.is_finite() or result < 0 or (positive and result <= 0):
        raise ValueError(f"{field}: invalid amount")
    return format(result, "f")


def timestamp(value, field: str) -> str:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field}: source millisecond timestamp required")
    return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat(timespec="milliseconds")


def text(row: dict, key: str) -> str:
    value = row.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key}: nonblank source text required")
    return value


def payment(row: dict, deployment: str) -> dict:
    currency = text(row, "currency")
    if currency not in {"USD", "KWD"}:
        raise ValueError("currency: unsupported source currency")
    amount = money(row.get("amount"), "amount", positive=True)
    scale = Decimal("0.01" if currency == "USD" else "0.001")
    if Decimal(amount) > 1_000_000 or Decimal(amount) != Decimal(amount).quantize(scale):
        raise ValueError("amount: source exceeds supported size or precision; review without rounding")
    day = text(row, "day")
    if datetime.strptime(day, "%Y-%m-%d").date().isoformat() != day:
        raise ValueError("day: invalid calendar date")
    rail = text(row, "rail")
    if rail not in {"bank_transfer", "cheque", "cash", "tap", "other"}:
        raise ValueError("rail: unsupported source method")
    kind = row.get("kind", "payment")
    if kind not in {"payment", "refund"}:
        raise ValueError("kind: unsupported source kind")
    usd = money(row.get("amountUsd"), "amountUsd")
    rate = money(row.get("usdPerUnit"), "usdPerUnit", positive=True)
    if Decimal(usd) != Decimal(usd).quantize(Decimal("0.01")):
        raise ValueError("amountUsd: stored value must be reviewed, never recalculated")
    deal = deal_usd = None
    if row.get("dealContracted") is not None:
        deal = money(row["dealContracted"], "dealContracted", positive=True)
        deal_usd = money(row.get("dealContractedUsd"), "dealContractedUsd")
        if kind == "refund" or Decimal(deal) > 1_000_000 or Decimal(deal) != Decimal(deal).quantize(scale):
            raise ValueError("dealContracted: invalid source deal")
    elif row.get("dealContractedUsd") is not None:
        raise ValueError("dealContracted: source deal pair is incomplete")
    client = text(row, "clientName")
    key = "".join(c for c in unicodedata.normalize("NFKD", client) if unicodedata.category(c)[0] in "LN").lower()
    deleted = row.get("deletedAt") is not None
    if not deleted and row.get("deletedBy") is not None:
        raise ValueError("deletedBy: removal actor without removal date")
    for field in ("note", "clickupTaskId"):
        if row.get(field) is not None and not isinstance(row[field], str):
            raise ValueError(f"{field}: source text required")
    return {
        "id": text(row, "_id"), "day": day, "amount": amount, "currency": currency,
        "amount_usd": usd, "usd_per_unit": rate, "client_name": client, "client_key": key,
        "clickup_task_id": row.get("clickupTaskId"), "rail": rail, "kind": kind,
        "deal_contracted": deal, "deal_contracted_usd": deal_usd, "note": row.get("note"),
        "added_by": text(row, "addedBy"), "added_at": timestamp(row.get("addedAt"), "addedAt"),
        "deleted_at": timestamp(row["deletedAt"], "deletedAt") if deleted else None,
        "deleted_by": text(row, "deletedBy") if deleted else None,
        "source_system": "convex", "source_deployment": deployment, "source_id": row["_id"],
    }


def read_table(archive: zipfile.ZipFile, name: str) -> list[dict]:
    member = f"{name}/documents.jsonl"
    if member not in archive.namelist():
        raise ValueError(f"Required source table is absent: {name}; absence is not an empty table")
    if archive.getinfo(member).file_size > 100_000_000:
        raise ValueError(f"{name}: table needs a streaming review before planning")
    with archive.open(member) as stream:
        rows = [json.loads(line) for line in stream if line.strip()]
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError(f"{name}: invalid source row")
    ids = [text(row, "_id") for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError(f"{name}: duplicate source identities")
    return rows


def equivalent(field: str, expected, actual) -> bool:
    if expected is None or actual is None:
        return expected is actual
    if field in NUMBERS:
        return Decimal(str(expected)) == Decimal(str(actual))
    if field in TIMES:
        return datetime.fromisoformat(str(expected).replace("Z", "+00:00")) == datetime.fromisoformat(str(actual).replace("Z", "+00:00"))
    return expected == actual


def plan(snapshot: Path, deployment: str, target: list[dict] | None = None) -> dict:
    with zipfile.ZipFile(snapshot) as archive:
        original = read_table(archive, "ceoManualPayments")
        all_audits = read_table(archive, "ceoAudit")
    source_by_id = {row["_id"]: row for row in original}
    audits = [r for r in all_audits if r.get("table") == "ceoManualPayments" or str(r.get("action", "")).startswith("manualPayment.")]
    payments, history, errors = [], [], []
    for row in original:
        try:
            payments.append(payment(row, deployment))
        except (ValueError, TypeError, OverflowError) as exc:
            errors.append({"table": "ceoManualPayments", "id": row["_id"], "error": str(exc)})
    for row in audits:
        try:
            history.append({
                "action": text(row, "action"), "entity_type": "cockpit_manual_payments",
                "entity_id": text(row, "rowId"), "actor_email": text(row, "by"),
                "source_app": "ceo", "source_system": "convex", "created_at": timestamp(row.get("at"), "at"),
                "before": row.get("before"), "after": row.get("after"),
                "metadata": {"what": text(row, "what"), "source_deployment": deployment,
                    "source_table": "ceoAudit", "source_id": row["_id"], "source_record": row,
                    "source_payment": source_by_id.get(row["rowId"])},
            })
        except (ValueError, TypeError, OverflowError) as exc:
            errors.append({"table": "ceoAudit", "id": row["_id"], "error": str(exc)})
    existing = {text(row, "id"): row for row in (target or [])}
    if len(existing) != len(target or []):
        raise ValueError("Target export contains duplicate identities")
    creates, unchanged, conflicts = [], [], []
    for row in payments:
        other = existing.get(row["id"])
        if other is None:
            same_source = [r for r in existing.values() if r.get("source_deployment") == deployment and r.get("source_id") == row["source_id"]]
            if same_source:
                conflicts.append({"id": row["id"], "fields": ["id/source mapping"]})
            else:
                creates.append(row["id"])
        else:
            fields = [field for field, value in row.items() if not equivalent(field, value, other.get(field))]
            if fields:
                conflicts.append({"id": row["id"], "fields": fields})
            else:
                unchanged.append(row["id"])
    orphan_audits = [r["_id"] for r in audits if r.get("rowId") not in source_by_id]
    covered = {r.get("rowId") for r in audits}
    uncovered = sorted(set(source_by_id) - covered)
    with snapshot.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"report": {
        "dry_run": DRY_RUN, "live_writes": 0, "apply_ready": False,
        "snapshot": snapshot.name, "snapshot_sha256": digest, "declared_deployment": deployment,
        "source_payments": len(original), "source_payment_audits": len(audits),
        "valid_payments": len(payments), "valid_audits": len(history), "target_compared": target is not None,
        "candidate_creates": creates, "unchanged": unchanged, "conflicts": conflicts, "errors": errors,
        "orphan_audits": orphan_audits, "payments_without_source_audit": uncovered,
        "remaining_gates": ["Verify a fresh source snapshot and final catch-up, not just its filename",
            "Apply and verify the reviewed additive schema separately", "Compare fresh target records before any import",
            "Import with database-enforced source-audit deduplication and read-back proof",
            "Reconcile history and money totals before changing readiness flags"],
    }, "payments": payments, "audits": history, "source_records": original}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--deployment", required=True)
    parser.add_argument("--target", type=Path, help="Previously exported target rows; omitted means not compared")
    parser.add_argument("--out", type=Path, required=True, help="New protected directory outside the repository")
    args = parser.parse_args(argv)
    target = json.loads(args.target.read_text(encoding="utf-8")) if args.target else None
    result = plan(args.snapshot, args.deployment, target)
    output = args.out.resolve()
    repository = Path(__file__).resolve().parents[1]
    if output == repository or repository in output.parents:
        raise ValueError("Raw financial artifacts must be stored outside the repository")
    output.mkdir(parents=True, exist_ok=False)
    for name, value in result.items():
        with (output / f"{name}.json").open("x", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
    report = result["report"]
    print(json.dumps({k: report[k] for k in ("dry_run", "live_writes", "apply_ready", "source_payments", "source_payment_audits", "target_compared")}
        | {"errors": len(report["errors"]), "conflicts": len(report["conflicts"]), "output": str(output)}))
    return 1 if report["errors"] or report["conflicts"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
