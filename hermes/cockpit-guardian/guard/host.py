"""The VPS, read locally (the guardian runs there as hermes) or over ssh.

Over ssh the guardian only reads: `snapshot` pipes vps_snapshot.py to
`python3 -` and nothing else is ever run remotely. `spawn`, `kill` and the
file writes the fixes need exist only on LocalHost, so a remote run cannot
fix anything even by mistake.
"""
from __future__ import annotations

import base64
import json
import os
import signal
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

from .config import ROOT, VPS_PUBLIC
from .jobs import HERMES_LOGS, PROCESS_MARKERS
from .redact import scrub

SNAPSHOT = Path(__file__).resolve().parent / "vps_snapshot.py"
MONITOR_ROOT = "/docker/hermes-agent-ff5p/data/portal-monitor/state"

ENV_FILES = (
    "~/.editor-desk/env",
    "~/.ideation-radar/env",
    "~/.sales-desk/env",
    "/opt/data/bibi/api-keys.env",
    "/opt/data/.cockpit-worker/env",
    "~/.team-sync/env",
    "~/.cockpit-guardian/env",
)


def snapshot_spec(repo: str = "~/mahara-cockpits") -> dict[str, Any]:
    logs = list(HERMES_LOGS)
    return {
        "markers": PROCESS_MARKERS,
        "logs": logs,
        "tail_lines": 80,
        "files": logs + list(ENV_FILES) + ["~/.salma-vps.json", "~/.cockpit-guardian/state.json", "~/.cockpit-guardian"],
        "env_files": list(ENV_FILES),
        "settings": {"SALES_MODEL_PROVIDER": "~/.sales-desk/env"},
        "proxy": "http://127.0.0.1:3456/health",
        "salma_vps": "~/.salma-vps.json",
        "repo": repo,
        "monitors": {
            "mahara-cockpits": f"{MONITOR_ROOT}/mahara-cockpits/state.json",
            "public-sites": f"{MONITOR_ROOT}/public-sites/state.json",
        },
        "jobs_json": "/opt/data/cron/jobs.json",
        "fixer_attempts": "/opt/data/bibi/workspace/reliability/fixer-attempts.json",
        "rooms": {"file": f"{repo}/hermes/sales-desk/desk/rooms.py", "unit": "sales-desk-rooms"},
    }


class HostError(Exception):
    pass


class Host:
    remote = False
    public_ip = VPS_PUBLIC

    def snapshot(self, spec: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    # Only LocalHost does these.
    def spawn(self, command: str) -> int:
        raise HostError("a remote run never starts anything on the VPS")

    def run(self, argv: list[str], timeout: int = 60, stdin: Optional[str] = None) -> tuple[int, str, str]:
        raise HostError("a remote run never runs a command on the VPS besides the snapshot")

    def alive(self, pid: int) -> bool:
        raise HostError("remote")

    def kill(self, pid: int, sig: int) -> None:
        raise HostError("a remote run never stops a process")

    @property
    def home(self) -> str:
        raise NotImplementedError


def _decode(out: str) -> dict[str, Any]:
    try:
        snap = json.loads(out)
    except ValueError as e:
        raise HostError(f"the VPS snapshot was not JSON: {scrub(out[:160])}") from e
    if not isinstance(snap, dict):
        raise HostError("the VPS snapshot was not an object")
    return snap


class LocalHost(Host):
    def snapshot(self, spec):
        arg = base64.b64encode(json.dumps(spec).encode()).decode()
        p = subprocess.run([sys.executable, str(SNAPSHOT), arg], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=180)
        if p.returncode != 0:
            raise HostError(f"snapshot failed: {scrub(p.stderr.decode('utf-8', 'replace')[-300:])}")
        return _decode(p.stdout.decode("utf-8", "replace"))

    def spawn(self, command: str) -> int:
        """Start `command` detached through bash, as cron would, and return its pid.
        The command carries its own flock and its own log redirect."""
        p = subprocess.Popen(["bash", "-c", command], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True, cwd=str(Path.home()))
        return p.pid

    def run(self, argv, timeout=60, stdin=None):
        p = subprocess.run(argv, input=(stdin.encode() if stdin is not None else None), stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, timeout=timeout)
        return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")

    def alive(self, pid: int) -> bool:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True

    def kill(self, pid: int, sig: int = signal.SIGTERM) -> None:
        os.kill(pid, sig)

    @property
    def home(self) -> str:
        return str(Path.home())


class SshHost(Host):
    remote = True

    def __init__(self, ssh_argv: list[str]):
        if not ssh_argv:
            raise HostError("GUARDIAN_SSH is empty")
        self.argv = list(ssh_argv)
        self._home: Optional[str] = None

    def snapshot(self, spec):
        arg = base64.b64encode(json.dumps(spec).encode()).decode()
        script = SNAPSHOT.read_text(encoding="utf-8")
        p = subprocess.run(self.argv + [f"python3 - {arg}"], input=script.encode(), stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, timeout=240)
        if p.returncode != 0:
            raise HostError(f"ssh snapshot failed ({p.returncode}): {scrub(p.stderr.decode('utf-8', 'replace')[-300:])}")
        snap = _decode(p.stdout.decode("utf-8", "replace"))
        self._home = snap.get("home")
        return snap

    @property
    def home(self) -> str:
        return self._home or "/home/hermes"


def open_host(cfg: Any) -> Host:
    return SshHost(cfg.ssh) if cfg.ssh else LocalHost()


__all__ = ["Host", "LocalHost", "SshHost", "HostError", "snapshot_spec", "open_host", "ROOT"]
