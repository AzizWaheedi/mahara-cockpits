"""One stream, with secrets scrubbed on the way out.

Cron sends stdout and stderr to ~/.sales-desk.log, so the desk writes no log
file of its own: two writers on one file is how lines end up doubled.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone

from .http import scrub


class Logger:
    def __init__(self, *, quiet: bool = False):
        self.quiet = quiet

    def _write(self, level: str, message: str) -> None:
        line = f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} {level:<5} {scrub(message)}"
        if level in ("WARN", "ERROR") or not self.quiet:
            print(line, file=sys.stderr, flush=True)

    def info(self, message: str) -> None:
        self._write("INFO", message)

    def warn(self, message: str) -> None:
        self._write("WARN", message)

    def error(self, message: str) -> None:
        self._write("ERROR", message)
