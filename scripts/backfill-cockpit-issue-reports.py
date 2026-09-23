"""Prepare historical media-buyer issue reports from a Convex snapshot.

DRY_RUN = True by default. ``--apply-one`` inserts at most one historical row,
reads it back, and verifies the audit trigger. There is intentionally no bulk
write flag until a real production snapshot and one-row result are reviewed.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


PROJECT_REF = "bldgtotkfmhoxmlzowdx"
PROJECT_URL = f"https://{PROJECT_REF}.supabase.co"
DEFAULT_ENV = Path(r"D:\MaharaMedia\mahara-cockpits\.env.local")
SNAPSHOT_MEMBER = "feedback/documents.jsonl"


def documents_from_lines(lines: Iterator[str]) -> Iterator[dict[str, Any]]:
    for line_number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSONL at line {line_number}") from exc
        if not isinstance(value, dict):
            raise ValueError(f"Expected an object at line {line_number}")
        yield value


def read_documents(source: Path) -> list[dict[str, Any]]:
    if source.suffix.lower() == ".zip":
        with zipfile.ZipFile(source) as archive:
            if SNAPSHOT_MEMBER not in archive.namelist():
                raise ValueError(f"Snapshot does not contain {SNAPSHOT_MEMBER}")
            with archive.open(SNAPSHOT_MEMBER) as raw:
                return list(documents_from_lines(line.decode("utf-8") for line in raw))
    if source.suffix.lower() == ".jsonl":
        with source.open(encoding="utf-8") as stream:
            return list(documents_from_lines(stream))
    raise ValueError("Source must be a Convex snapshot .zip or feedback .jsonl")


def required_text(doc: dict[str, Any], field: str) -> str:
    value = doc.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Feedback row {doc.get('_id', '<unknown>')} has invalid {field}")
    return value.strip()


def build_row(doc: dict[str, Any]) -> dict[str, Any] | None:
    if doc.get("role") != "media_buyer":
        return None
    source_id = required_text(doc, "_id")
    page = required_text(doc, "page")
    body = required_text(doc, "text")
    if len(source_id) > 200 or len(page) > 255 or len(body) > 10_000:
        raise ValueError(f"Feedback row {source_id} exceeds the mirror contract")
    at = doc.get("at")
    if isinstance(at, bool) or not isinstance(at, (int, float)) or not math.isfinite(at) or at <= 0:
        raise ValueError(f"Feedback row {source_id} has invalid at timestamp")
    try:
        created_at = datetime.fromtimestamp(at / 1000, tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError) as exc:
        raise ValueError(f"Feedback row {source_id} has invalid at timestamp") from exc
    email = doc.get("email")
    if email is not None and (not isinstance(email, str) or len(email) > 320):
        raise ValueError(f"Feedback row {source_id} has invalid email")
    actor_email = email.strip().lower() if email else None
    metadata: dict[str, Any] = {"historical_import": True}
    for key in ("day", "delivered", "reply", "replyAt", "clickupTaskUrl"):
        if key in doc:
            metadata[key] = doc[key]
    return {
        "kind": "issue",
        "text": body,
        "status": "historical",
        "created_by": actor_email or "media_buyer",
        "created_at": created_at,
        "source_system": "convex",
        "source_id": source_id,
        "app": "media-buyer",
        "page": page,
        "role": "media_buyer",
        "actor_email": actor_email,
        "metadata": metadata,
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
        headers["Content-Type"] = "application/json"
        headers["Prefer"] = "resolution=ignore-duplicates,return=representation"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Supabase request failed (HTTP {exc.code}); no success was confirmed") from exc


def remote_row(key: str, source_id: str) -> dict[str, Any] | None:
    query = urllib.parse.urlencode(
        {"source_system": "eq.convex", "source_id": f"eq.{source_id}", "select": "*", "limit": 1}
    )
    rows = request_json(f"{PROJECT_URL}/rest/v1/cockpit_issue_reports?{query}", key)
    return rows[0] if rows else None


def verify_row(expected: dict[str, Any], actual: dict[str, Any]) -> None:
    for field in ("kind", "text", "status", "created_by", "source_system", "source_id", "app", "page", "role", "actor_email", "metadata"):
        if actual.get(field) != expected[field]:
            raise RuntimeError(f"Supabase read-back differs in {field}")
    actual_time = datetime.fromisoformat(actual["created_at"].replace("Z", "+00:00"))
    expected_time = datetime.fromisoformat(expected["created_at"])
    if abs((actual_time - expected_time).total_seconds()) > 0.001:
        raise RuntimeError("Supabase read-back differs in created_at")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Convex snapshot ZIP or feedback JSONL")
    parser.add_argument("--apply-one", action="store_true", help="insert at most one row after the dry-run report")
    parser.add_argument("--env-path", type=Path, default=DEFAULT_ENV)
    args = parser.parse_args()

    documents = read_documents(args.source)
    rows = [row for doc in documents if (row := build_row(doc)) is not None]
    source_ids = [row["source_id"] for row in rows]
    if len(source_ids) != len(set(source_ids)):
        raise ValueError("Snapshot contains duplicate feedback IDs")
    rows.sort(key=lambda row: (row["created_at"], row["source_id"]))
    print(json.dumps({
        "DRY_RUN": not args.apply_one,
        "source_documents": len(documents),
        "media_buyer_reports": len(rows),
        "skipped_other_roles": len(documents) - len(rows),
        "planned_first_source_id": rows[0]["source_id"] if rows else None,
        "bulk_write_supported": False,
    }))
    if not args.apply_one or not rows:
        return 0

    if not args.env_path.is_file():
        raise ValueError("Local env file is missing")
    if read_env_value(args.env_path, "SUPABASE_URL") != PROJECT_URL:
        raise ValueError("SUPABASE_URL is not the Creative Triage project")
    key = read_env_value(args.env_path, "SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY is missing")

    expected = rows[0]
    existing = remote_row(key, expected["source_id"])
    if existing:
        verify_row(expected, existing)
        print("First report already exists and matches; no write performed.")
        return 0

    url = f"{PROJECT_URL}/rest/v1/cockpit_issue_reports?on_conflict=source_system,source_id"
    request_json(url, key, method="POST", body=expected)
    written = remote_row(key, expected["source_id"])
    if not written:
        raise RuntimeError("Single-row write was not visible on read-back")
    verify_row(expected, written)
    audit_query = urllib.parse.urlencode({
        "entity_type": "eq.cockpit_issue_reports",
        "entity_id": f"eq.{written['id']}",
        "action": "eq.INSERT",
        "select": "id",
        "limit": 1,
    })
    audit = request_json(f"{PROJECT_URL}/rest/v1/cockpit_audit_log?{audit_query}", key)
    if not audit:
        raise RuntimeError("Single-row write succeeded but its audit row was not found")
    print("One historical issue report and its audit row verified. Bulk import remains disabled.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, FileNotFoundError, zipfile.BadZipFile) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
