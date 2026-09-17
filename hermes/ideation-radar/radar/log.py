"""Plain logging to stderr and to a file, with secrets scrubbed."""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .http import scrub


class Logger:
    def __init__(self, path: Optional[Path] = None, quiet: bool = False):
        self.path = path
        self.quiet = quiet
        self.lines: list[str] = []

    def _emit(self, level: str, msg: str) -> None:
        stamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        line = f"{stamp} {level:5s} {scrub(msg)}"
        self.lines.append(line)
        if not self.quiet or level in ("WARN", "ERROR"):
            print(line, file=sys.stderr, flush=True)
        if self.path:
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with open(self.path, "a", encoding="utf-8") as fh:
                    fh.write(line + "\n")
            except OSError:
                pass

    def info(self, msg: str) -> None:
        self._emit("INFO", msg)

    def warn(self, msg: str) -> None:
        self._emit("WARN", msg)

    def error(self, msg: str) -> None:
        self._emit("ERROR", msg)
