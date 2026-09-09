"""Single pre-run entry point for the /csm/daily-brief cron.

Runs the sheet engine first (writeback + rebuild), then the signal scan
(WhatsApp groups + Fathom calls since the last working day). Sections are
clearly delimited so the reading agent can never confuse the two.

Usage:
    uv run python skills/csm_daily_workflow/scripts/morning.py
"""

import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).parent
STEPS = [("SHEET ENGINE", "csm_daily.py"), ("SIGNAL SCAN", "scan_signals.py")]


def run(label: str, script: str) -> int:
    print(f"\n########## {label} ##########", flush=True)
    proc = subprocess.run([sys.executable, str(HERE / script)], capture_output=True, text=True)
    print(proc.stdout.strip())
    if proc.returncode != 0:
        print(f"!! {label} FAILED (exit {proc.returncode})\n{proc.stderr.strip()[-2000:]}")
    return proc.returncode


def main() -> None:
    codes = [run(label, script) for label, script in STEPS]
    print(f"\n########## END (exit codes {codes}) ##########")


if __name__ == "__main__":
    main()
