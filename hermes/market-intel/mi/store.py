"""The run's local folder (~/.market-intel/runs/<run id>/, mode 700): the raw pull cache that makes a resume
free, the evidence, the findings, the rendered report and the outputs that would be sent. Every write is
atomic (a temporary file, then a rename), so a killed worker never leaves half a file.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, Optional

SAFE = re.compile(r"[^A-Za-z0-9_.-]+")


class RunFolder:
    def __init__(self, root: Path, run_id: str):
        if not re.fullmatch(r"[0-9a-f-]{36}", run_id):
            raise ValueError("a run folder is named by the run's id")
        self.path = root / run_id
        self.path.mkdir(parents=True, exist_ok=True)
        (self.path / "pulls").mkdir(exist_ok=True)
        for p in (root, self.path, self.path / "pulls"):
            try:
                os.chmod(p, 0o700)
            except OSError:
                pass

    def file(self, name: str) -> Path:
        return self.path / name

    def write_text(self, name: str, text: str) -> Path:
        target = self.path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=".tmp-")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.chmod(tmp, 0o600)
        os.replace(tmp, target)
        return target

    def write_json(self, name: str, value: Any) -> Path:
        return self.write_text(name, json.dumps(value, ensure_ascii=False, indent=1, sort_keys=False))

    def read_json(self, name: str, default: Any = None) -> Any:
        try:
            return json.loads((self.path / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return default

    # ---- the pull cache: a finished pull is never paid for again ------------------------------------------
    def _pull_name(self, key: str) -> str:
        return f"pulls/{SAFE.sub('_', key)[:150]}.json"

    def cached(self, key: str) -> Optional[Any]:
        return self.read_json(self._pull_name(key))

    def cache(self, key: str, value: Any) -> None:
        self.write_json(self._pull_name(key), value)


def prune_folders(root: Path, days: int, now: Optional[float] = None) -> int:
    """Run folders older than `days` (by their last change) are removed. Returns how many."""
    now = now or time.time()
    n = 0
    if not root.exists():
        return 0
    for p in root.iterdir():
        if p.is_dir() and re.fullmatch(r"[0-9a-f-]{36}", p.name) and now - p.stat().st_mtime > days * 86400:
            shutil.rmtree(p, ignore_errors=True)
            n += 1
    return n
