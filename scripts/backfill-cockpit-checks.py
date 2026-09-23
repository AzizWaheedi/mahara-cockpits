"""Canary one authoritative daily check from three Convex snapshots.

DRY_RUN = True by default: read and reconcile offline only. --apply-one writes
exactly the requested role/day/key. After that canary, --apply-batch imports at
most 25 checks strictly before the current Kuwait day, with a full preflight
and per-row read-back/audit. Never import the media-buyer CSM mirror.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


PROJECT_REF = "bldgtotkfmhoxmlzowdx"
PROJECT_URL = f"https://{PROJECT_REF}.supabase.co"
DEFAULT_ENV = Path(r"D:\MaharaMedia\mahara-cockpits\.env.local")
SOURCE = {
    "media_buyer": ("media-buyer", "adorable-seahorse-418"),
    "csm": ("client-success", "impressive-dinosaur-375"),
    "creative": ("creative-director", "colorful-wombat-644"),
}

spec = importlib.util.spec_from_file_location(
    "reconcile_cockpit_checks", Path(__file__).with_name("reconcile-cockpit-checks.py")
)
assert spec and spec.loader
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


def timestamp_ms(value: Any, name: str) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"Invalid {name} timestamp")
    try:
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError) as error:
        raise ValueError(f"Invalid {name} timestamp") from error


def optional_text(doc: dict[str, Any], name: str) -> str | None:
    value = doc.get(name)
    if value is not None and not isinstance(value, str):
        raise ValueError(f"Invalid {name} in check {doc.get('_id', '<unknown>')}")
    return value


def build_row(doc: dict[str, Any], role: str, snapshot_ts: str) -> dict[str, Any]:
    owner_app, deployment = SOURCE[role]
    if role != "creative" and doc.get("role") != role:
        raise ValueError("Selected check has the wrong source role")
    if role == "creative" and doc.get("role") not in (None, "creative"):
        raise ValueError("Selected creative check has the wrong source role")
    source_id = doc.get("_id")
    check_key = doc.get("key")
    label = doc.get("label")
    if not all(isinstance(value, str) and value for value in (source_id, check_key, label)):
        raise ValueError("Selected check has a missing source ID, key, or label")
    try:
        day = date.fromisoformat(doc["day"]).isoformat()
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError(f"Invalid day in check {source_id}") from error
    if not isinstance(doc.get("done"), bool):
        raise ValueError(f"Invalid done value in check {source_id}")
    order = doc.get("order")
    if order is not None and (
        isinstance(order, bool) or not isinstance(order, (int, float)) or not math.isfinite(order)
    ):
        raise ValueError(f"Invalid order in check {source_id}")
    return {
        "role": role,
        "owner_app": owner_app,
        "day": day,
        "check_key": check_key,
        "label": label,
        "detail": optional_text(doc, "detail"),
        "phase": optional_text(doc, "phase"),
        "block": optional_text(doc, "block"),
        "display_order": order,
        "href": optional_text(doc, "href"),
        "done": doc["done"],
        "done_at": timestamp_ms(doc.get("doneAt"), "doneAt"),
        "source_system": "convex",
        "source_deployment": deployment,
        "source_id": source_id,
        "source_created_at": timestamp_ms(doc.get("_creationTime"), "_creationTime"),
        "source_snapshot_ts": snapshot_ts,
        "source_row": doc,
        "changed_by": "migration-backfill",
    }


def read_env_value(path: Path, name: str) -> str | None:
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip().strip("\"'")
    return None


def request_json(url: str, key: str, *, method: str = "GET", body: Any = None) -> Any:
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers.update({
            "Content-Type": "application/json",
            "Prefer": "resolution=ignore-duplicates,return=representation",
        })
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Supabase request failed (HTTP {error.code}); no success confirmed") from error


def remote_rows(key: str, **filters: str) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({**{name: f"eq.{value}" for name, value in filters.items()}, "select": "*"})
    return request_json(f"{PROJECT_URL}/rest/v1/cockpit_daily_checks?{query}", key)


def verify_row(expected: dict[str, Any], actual: dict[str, Any]) -> None:
    for field in (
        "role", "owner_app", "day", "check_key", "label", "detail", "phase", "block",
        "display_order", "href", "done", "source_system", "source_deployment",
        "source_id", "source_snapshot_ts", "source_row", "changed_by",
    ):
        if expected[field] != actual.get(field):
            raise RuntimeError(f"Supabase checks read-back differs in {field}")
    for field in ("done_at", "source_created_at"):
        if expected[field] is None:
            if actual.get(field) is not None:
                raise RuntimeError(f"Supabase checks read-back differs in {field}")
        else:
            actual_time = datetime.fromisoformat(actual[field].replace("Z", "+00:00"))
            expected_time = datetime.fromisoformat(expected[field])
            if abs((actual_time - expected_time).total_seconds()) > 0.001:
                raise RuntimeError(f"Supabase checks read-back differs in {field}")


def insert_and_verify(expected: dict[str, Any], key: str) -> None:
    endpoint = f"{PROJECT_URL}/rest/v1/cockpit_daily_checks?on_conflict=source_deployment,source_id"
    request_json(endpoint, key, method="POST", body=expected)
    written = remote_rows(key, source_deployment=expected["source_deployment"], source_id=expected["source_id"])
    if len(written) != 1:
        raise RuntimeError("Selected checks write was not visible on read-back")
    verify_row(expected, written[0])
    audits = request_json(
        f"{PROJECT_URL}/rest/v1/cockpit_audit_log?" + urllib.parse.urlencode({
            "entity_type": "eq.cockpit_daily_checks",
            "entity_id": f"eq.{written[0]['id']}",
            "action": "eq.INSERT",
            "select": "id",
        }),
        key,
    )
    if len(audits) != 1:
        raise RuntimeError("Selected check was written but exactly one INSERT audit was not found")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("media-buyer", "client-success", "creative"):
        parser.add_argument(f"--{name}", type=Path, required=True)
        parser.add_argument(f"--{name}-ts", required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply-one", action="store_true")
    mode.add_argument("--plan-batch", action="store_true", help="read-only live diff before a batch")
    mode.add_argument("--apply-batch", action="store_true")
    parser.add_argument("--canary-role", choices=SOURCE)
    parser.add_argument("--canary-day")
    parser.add_argument("--canary-key")
    parser.add_argument("--through-day", help="last historical Kuwait day eligible for a batch")
    parser.add_argument("--limit", type=int, help="maximum inserts in one guarded batch, 1 to 25")
    parser.add_argument("--env-path", type=Path, default=DEFAULT_ENV)
    args = parser.parse_args(argv)
    snapshots = {
        "media_buyer": checks.read_checks(args.media_buyer),
        "csm": checks.read_checks(args.client_success),
        "creative": checks.read_checks(args.creative),
    }
    report = checks.reconcile(snapshots["media_buyer"], snapshots["csm"], snapshots["creative"])
    if not report["safe_to_backfill_selected_rows"]:
        raise ValueError("CSM mirror has keys missing from client success; no write allowed")
    print(json.dumps({
        "DRY_RUN": not (args.apply_one or args.apply_batch),
        "ownership": report,
        "max_batch_rows": 25,
    }))
    if not args.apply_one and not args.apply_batch and not args.plan_batch:
        return 0
    selected = {
        "media_buyer": [row for row in snapshots["media_buyer"] if row.get("role") == "media_buyer"],
        "csm": snapshots["csm"],
        "creative": snapshots["creative"],
    }
    snapshot_ts_by_role = {
        "media_buyer": args.media_buyer_ts,
        "csm": args.client_success_ts,
        "creative": args.creative_ts,
    }
    if any(not value.isdigit() for value in snapshot_ts_by_role.values()):
        raise ValueError("Snapshot timestamps must contain only digits")

    if args.apply_one:
        if not all((args.canary_role, args.canary_day, args.canary_key)):
            raise ValueError("--apply-one requires --canary-role, --canary-day, and --canary-key")
        matches = [
            row for row in selected[args.canary_role]
            if row["day"] == args.canary_day and row["key"] == args.canary_key
        ]
        if len(matches) != 1:
            raise ValueError("Canary must select exactly one authoritative check")
        expected = build_row(matches[0], args.canary_role, snapshot_ts_by_role[args.canary_role])
    else:
        if args.limit is None or not 1 <= args.limit <= 25 or not args.through_day:
            raise ValueError("Batch planning/apply requires --limit 1..25 and --through-day")
        cutoff = date.fromisoformat(args.through_day)
        kuwait_today = datetime.now(timezone(timedelta(hours=3))).date()
        if cutoff >= kuwait_today:
            raise ValueError("Batch cutoff must be strictly before the current Kuwait day")

    if read_env_value(args.env_path, "SUPABASE_URL") != PROJECT_URL:
        raise ValueError("SUPABASE_URL is not Creative Triage")
    key = read_env_value(args.env_path, "SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY is missing")

    if args.apply_batch or args.plan_batch:
        expected_rows = sorted(
            (
                build_row(doc, role, snapshot_ts_by_role[role])
                for role, docs in selected.items()
                for doc in docs
                if date.fromisoformat(doc["day"]) <= cutoff
            ),
            key=lambda row: (row["day"], row["role"], row["check_key"]),
        )
        if len(expected_rows) >= 1000:
            raise ValueError("Batch preflight is limited to fewer than 1000 historical rows")
        all_remote = request_json(f"{PROJECT_URL}/rest/v1/cockpit_daily_checks?select=*&limit=1000", key)
        if len(all_remote) >= 1000:
            raise RuntimeError("Supabase checks query reached its limit; no batch write allowed")
        by_source = {}
        by_logical = {}
        for row in all_remote:
            source_key = (row["source_deployment"], row["source_id"])
            logical_key = (row["role"], row["day"], row["check_key"])
            if source_key in by_source or logical_key in by_logical:
                raise RuntimeError("Duplicate Supabase check identity in batch preflight")
            by_source[source_key] = row
            by_logical[logical_key] = row

        canary_key = ("csm", "2026-09-14", "sprint_1")
        canary = by_logical.get(canary_key)
        if not canary or not canary["done"] or canary["source_deployment"] != SOURCE["csm"][1]:
            raise RuntimeError("The checked CSM canary is not present; no batch write allowed")

        planned = []
        existing_count = 0
        for row in expected_rows:
            source_key = (row["source_deployment"], row["source_id"])
            logical_key = (row["role"], row["day"], row["check_key"])
            source_match = by_source.get(source_key)
            logical_match = by_logical.get(logical_key)
            if source_match or logical_match:
                if not source_match or not logical_match or source_match["id"] != logical_match["id"]:
                    raise RuntimeError("Supabase source/logical check identity conflict; no batch write allowed")
                verify_row(row, source_match)
                existing_count += 1
            else:
                planned.append(row)
        print(json.dumps({
            "DRY_RUN": args.plan_batch,
            "eligible_historical_rows": len(expected_rows),
            "already_verified": existing_count,
            "planned_missing": len(planned),
            "this_run": min(args.limit, len(planned)),
            "through_day": args.through_day,
            "first_planned": [
                {"role": row["role"], "day": row["day"], "key": row["check_key"]}
                for row in planned[:args.limit]
            ],
        }))
        if args.plan_batch:
            return 0
        for row in planned[:args.limit]:
            insert_and_verify(row, key)
        print(f"Verified {min(args.limit, len(planned))} historical check inserts and their audit rows.")
        return 0

    by_source = remote_rows(key, source_deployment=expected["source_deployment"], source_id=expected["source_id"])
    by_logical = remote_rows(key, role=expected["role"], day=expected["day"], check_key=expected["check_key"])
    if len(by_source) > 1 or len(by_logical) > 1:
        raise RuntimeError("Unexpected duplicate Supabase checks rows")
    if by_source or by_logical:
        if not by_source or not by_logical or by_source[0]["id"] != by_logical[0]["id"]:
            raise RuntimeError("Supabase source/logical check identity conflict; no write allowed")
        verify_row(expected, by_source[0])
        print("Selected historical check already exists and matches; no write performed.")
        return 0

    print(
        "Planned database change: insert one authoritative "
        f"{expected['role']} check for {expected['day']} / {expected['check_key']}."
    )
    insert_and_verify(expected, key)
    print("One authoritative historical check and its INSERT audit verified. No bulk import performed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, KeyError, zipfile.BadZipFile) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
