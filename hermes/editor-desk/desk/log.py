"""One log file and one stream, with secrets scrubbed on the way out."""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .http import scrub


class Logger:
    def __init__(self, path: Optional[Path] = None, *, quiet: bool = False):
        self.path = Path(path) if path else None
        self.quiet = quiet
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)

    def _write(self, level: str, message: str) -> None:
        line = f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} {level:<5} {scrub(message)}"
        if self.path:
            try:
                with open(self.path, "a", encoding="utf-8") as fh:
                    fh.write(line + "\n")
            except OSError:
                pass
        if level in ("WARN", "ERROR") or not self.quiet:
            print(line, file=sys.stderr, flush=True)

    def info(self, message: str) -> None:
        self._write("INFO", message)

    def warn(self, message: str) -> None:
        self._write("WARN", message)

    def error(self, message: str) -> None:
        self._write("ERROR", message)
