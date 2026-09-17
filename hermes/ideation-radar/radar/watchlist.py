"""The watchlist file: accounts and hashtags to scan, per platform.

Stored as JSON so the creative director, Aziz or the cockpit can edit it
without touching code. Handles are stored without @, hashtags without #.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Optional

from .models import Target


def load(path: Path) -> list[Target]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return []
    rows = data.get("targets", data) if isinstance(data, dict) else data
    out: list[Target] = []
    seen: set[str] = set()
    for row in rows or []:
        try:
            t = Target.from_dict(row)
        except (KeyError, TypeError, ValueError):
            continue
        if t.key in seen:
            continue
        seen.add(t.key)
        out.append(t)
    return out


def save(path: Path, targets: list[Target]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": 1, "targets": [t.to_dict() for t in targets]}
    fd, tmp = tempfile.mkstemp(prefix=".watchlist-", dir=str(path.parent))
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def add(path: Path, platform: str, value: str, *, industry: str = "other", tags: Optional[list[str]] = None, note: str = "") -> Target:
    kind = "hashtag" if value.startswith("#") else "account"
    t = Target(platform=platform.lower(), kind=kind, value=value.lstrip("@#").strip(), industry=industry, tags=list(tags or []), note=note)
    targets = [x for x in load(path) if x.key != t.key]
    targets.append(t)
    save(path, targets)
    return t


def remove(path: Path, platform: str, value: str) -> bool:
    kind = "hashtag" if value.startswith("#") else "account"
    key = f"{platform.lower()}:{kind}:{value.lstrip('@#').strip().lower()}"
    targets = load(path)
    kept = [t for t in targets if t.key != key]
    if len(kept) == len(targets):
        return False
    save(path, kept)
    return True


def as_rows(targets: list[Target]) -> list[dict[str, Any]]:
    return [t.to_dict() for t in targets]
