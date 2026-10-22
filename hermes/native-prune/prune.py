"""Delete old native sync plans so the Hermes VPS disk stays free.

The native cycle runner (~/.cockpit-native-state/run-source-ceo-cycle.py) writes a
sync-plan.json of about 10 MB into a new cycle-<uuid>/ folder every 15 minutes,
about 0.8 GB a day. Only the runner reads a plan, and only the one it just wrote.

Only files named exactly sync-plan.json, directly inside a cycle-* folder, go.
Receipts, logs and failure files always stay. A plan stays when:
  - it is younger than --keep-hours (48),
  - it is one of the --keep-newest (8) newest plans, whatever its age,
  - its cycle failed: a sync-plan.json.failure.json, a sync step that did not
    publish, or a receipt that is missing, unreadable or unfinished.
A cycle whose sync published but whose CEO refresh failed is not a failed sync:
its plan goes after 48 hours, and its receipt and ceo.log stay.

  python3 prune.py            report only, deletes nothing
  python3 prune.py --apply    delete, then write native-prune-last.json

Every run prints one line: "native-prune ok: ..." or "native-prune FAILED: ...".
An --apply run that fails exits 1 and still records the failure.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

STATE = Path("/home/hermes/.cockpit-native-state")
PLAN = "sync-plan.json"
FAILURE = PLAN + ".failure.json"
LAST = "native-prune-last.json"
PUBLISHED = "media-core-published"
MIN_KEEP_HOURS = 24


def _stamp(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def failed_reason(folder: Path) -> str | None:
    """Why this cycle counts as failed, or None when its sync step published."""
    if (folder / FAILURE).exists():
        return "failed"
    try:
        receipt = json.loads((folder / "receipt.json").read_text())
    except (OSError, ValueError):
        return "no receipt"
    if not isinstance(receipt, dict) or receipt.get("ok") is None:
        return "unfinished"
    if receipt.get("ok") is True:
        return None
    jobs = receipt.get("jobs") or []
    sync = jobs[0] if jobs and isinstance(jobs[0], dict) and jobs[0].get("job") == "sync" else None
    if sync is None or sync.get("exit_code") != 0 or sync.get("status") != PUBLISHED:
        return "failed"
    return None


def decide(state: Path, now: float, keep_hours: float, keep_newest: int):
    """Split the plans into those to delete and the reasons the others stay."""
    plans: list[tuple[float, Path]] = []
    unreadable = 0
    for folder in sorted(state.glob("cycle-*")):
        try:
            if folder.is_symlink() or not folder.is_dir():
                continue
            plan = folder / PLAN
            if plan.is_symlink() or not plan.is_file():
                continue
            plans.append((plan.stat().st_mtime, plan))
        except OSError:
            unreadable += 1
    plans.sort(key=lambda p: p[0], reverse=True)

    delete: list[Path] = []
    kept: Counter = Counter()
    for rank, (mtime, plan) in enumerate(plans):
        if now - mtime < keep_hours * 3600:
            kept["recent"] += 1
        elif rank < keep_newest:
            kept["newest"] += 1
        else:
            try:
                reason = failed_reason(plan.parent)
            except OSError:
                reason = "no receipt"
            if reason:
                kept[reason] += 1
            else:
                delete.append(plan)
    return delete, kept, unreadable


def _summary(deleted: int, mb: float, kept: Counter, unreadable: int, free_gb: float) -> str:
    failed = kept["failed"] + kept["no receipt"] + kept["unfinished"]
    return (f"{deleted} plans, {mb:.0f} MB; kept {failed} failed, {kept['recent']} recent, "
            f"{kept['newest']} newest; unreadable folders {unreadable}; free {free_gb:.1f} GB")


def _write_last(state: Path, record: dict) -> None:
    path = state / LAST
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(record, indent=2))
    os.replace(tmp, path)


def run(state: Path, *, apply: bool, keep_hours: float, keep_newest: int, now: float | None = None) -> int:
    now = time.time() if now is None else now
    if keep_hours < MIN_KEEP_HOURS or keep_newest < 1:
        print(f"{_stamp(now)} native-prune FAILED: keep at least {MIN_KEEP_HOURS} hours and 1 plan")
        return 1
    if not state.is_dir():
        print(f"{_stamp(now)} native-prune FAILED: {state} is not a folder")
        return 1
    try:
        delete, kept, unreadable = decide(state, now, keep_hours, keep_newest)
    except OSError as e:
        print(f"{_stamp(now)} native-prune FAILED: cannot read {state}: {e.strerror or e}")
        return 1

    if not apply:
        mb = sum(p.stat().st_size for p in delete) / 1048576
        free_gb = shutil.disk_usage(state).free / 1e9
        print(f"{_stamp(now)} native-prune dry run: would delete {_summary(len(delete), mb, kept, unreadable, free_gb)}")
        return 0

    deleted, size, errors = 0, 0, []
    for plan in delete:
        try:
            n = plan.stat().st_size
            plan.unlink()
        except FileNotFoundError:
            continue
        except OSError as e:
            errors.append(f"{plan.parent.name}: {e.strerror or e}")
            continue
        deleted += 1
        size += n
    mb = size / 1048576
    free_gb = shutil.disk_usage(state).free / 1e9
    ok = not errors

    try:
        previous = json.loads((state / LAST).read_text())
    except (OSError, ValueError):
        previous = {}
    record = {
        "at": _stamp(now),
        "ok": ok,
        "deleted": deleted,
        "deleted_mb": round(mb, 1),
        "kept": dict(kept),
        "unreadable_folders": unreadable,
        "errors": errors[:5],
        "error_count": len(errors),
        "free_gb": round(free_gb, 1),
        "last_success_at": _stamp(now) if ok else previous.get("last_success_at"),
        "failed_runs_in_a_row": 0 if ok else int(previous.get("failed_runs_in_a_row") or 0) + 1,
    }
    try:
        _write_last(state, record)
    except OSError as e:
        errors.append(f"{LAST}: {e.strerror or e}")
        ok = False

    line = _summary(deleted, mb, kept, unreadable, free_gb)
    if ok:
        print(f"{_stamp(now)} native-prune ok: deleted {line}")
        return 0
    print(f"{_stamp(now)} native-prune FAILED: {len(errors)} errors, first: {errors[0]}; deleted {line}")
    return 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Delete old native sync plans; report only unless --apply.")
    p.add_argument("--apply", action="store_true", help="delete the plans (default: report only)")
    p.add_argument("--state", type=Path, default=STATE, help="the native state folder")
    p.add_argument("--keep-hours", type=float, default=48.0)
    p.add_argument("--keep-newest", type=int, default=8)
    a = p.parse_args(argv)
    return run(a.state, apply=a.apply, keep_hours=a.keep_hours, keep_newest=a.keep_newest)


if __name__ == "__main__":
    sys.exit(main())
