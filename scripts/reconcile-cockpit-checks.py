#!/usr/bin/env python3
"""Read-only ownership check for Convex daily-check snapshots.

The media-buyer deployment contains a second CSM checklist copy. A backfill
must use the client-success deployment for CSM human checkmarks, not union the
two copies or let either overwrite the other by export order.
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path
from typing import Any


def read_checks(path: Path) -> list[dict[str, Any]]:
    """Read only checks/documents.jsonl from an official Convex ZIP export."""
    with zipfile.ZipFile(path) as archive:
        with archive.open("checks/documents.jsonl") as stream:
            rows = []
            for line_number, raw in enumerate(stream, 1):
                if not raw.strip():
                    continue
                row = json.loads(raw)
                if not isinstance(row, dict):
                    raise ValueError(f"{path.name}: checks line {line_number} is not an object")
                for field in ("_id", "day", "key", "done"):
                    if field not in row:
                        raise ValueError(
                            f"{path.name}: checks line {line_number} lacks {field}"
                        )
                if not isinstance(row["done"], bool):
                    raise ValueError(
                        f"{path.name}: checks line {line_number} has non-boolean done"
                    )
                rows.append(row)
            return rows


def by_day_key(rows: list[dict[str, Any]], label: str) -> dict[tuple[str, str], dict[str, Any]]:
    result = {}
    for row in rows:
        key = (str(row["day"]), str(row["key"]))
        if key in result:
            raise ValueError(f"{label}: duplicate day/key {key[0]}/{key[1]}")
        result[key] = row
    return result


def reconcile(
    media_buyer: list[dict[str, Any]],
    client_success: list[dict[str, Any]],
    creative: list[dict[str, Any]],
) -> dict[str, Any]:
    mb_own = [row for row in media_buyer if row.get("role") == "media_buyer"]
    mb_csm = [row for row in media_buyer if row.get("role") == "csm"]
    other_mb = [row for row in media_buyer if row.get("role") not in {"media_buyer", "csm"}]
    other_csm = [row for row in client_success if row.get("role") != "csm"]
    other_creative = [row for row in creative if row.get("role") not in {None, "creative"}]
    if other_mb or other_csm or other_creative:
        raise ValueError("Unexpected role in a checks snapshot; review before mapping")

    own_index = by_day_key(mb_own, "media-buyer-owned")
    mb_csm_index = by_day_key(mb_csm, "media-buyer CSM copy")
    csm_index = by_day_key(client_success, "client-success-owned")
    creative_index = by_day_key(creative, "creative-owned")
    overlap = sorted(mb_csm_index.keys() & csm_index.keys())
    missing_in_child = sorted(mb_csm_index.keys() - csm_index.keys())
    only_in_child = sorted(csm_index.keys() - mb_csm_index.keys())

    completion_conflicts = []
    detail_conflicts = 0
    for day, key in overlap:
        left, right = mb_csm_index[(day, key)], csm_index[(day, key)]
        if left["done"] != right["done"] or left.get("doneAt") != right.get("doneAt"):
            completion_conflicts.append(
                {
                    "day": day,
                    "key": key,
                    "media_buyer_done": left["done"],
                    "client_success_done": right["done"],
                }
            )
        if any(left.get(field) != right.get(field) for field in ("label", "detail", "block")):
            detail_conflicts += 1

    # Each authoritative source has a distinct role. Never import the
    # media-buyer deployment's CSM mirror as a second logical check.
    selected = len(own_index) + len(csm_index) + len(creative_index)
    return {
        "DRY_RUN": True,
        "source_rows": {
            "media_buyer": len(media_buyer),
            "client_success": len(client_success),
            "creative": len(creative),
        },
        "authoritative_rows": {
            "media_buyer": len(own_index),
            "client_success": len(csm_index),
            "creative": len(creative_index),
            "total": selected,
        },
        "media_buyer_csm_mirror": {
            "rows": len(mb_csm_index),
            "matching_day_keys": len(overlap),
            "missing_in_child": [{"day": day, "key": key} for day, key in missing_in_child],
            "only_in_child": [{"day": day, "key": key} for day, key in only_in_child],
            "completion_conflicts": completion_conflicts,
            "label_detail_block_conflicts": detail_conflicts,
        },
        "safe_to_backfill_selected_rows": not missing_in_child,
        "writes_performed": 0,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media-buyer", required=True, type=Path)
    parser.add_argument("--client-success", required=True, type=Path)
    parser.add_argument("--creative", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        result = reconcile(
            read_checks(args.media_buyer),
            read_checks(args.client_success),
            read_checks(args.creative),
        )
    except (OSError, ValueError, zipfile.BadZipFile, KeyError) as error:
        print(f"Checks reconciliation failed: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0 if result["safe_to_backfill_selected_rows"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
