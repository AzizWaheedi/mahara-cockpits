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
import time
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


# A catch-up run gets cron's environment, not the guardian's: the cron command
# sources its own env files, so nothing else (no key) is passed down.
SPAWN_ENV_KEYS = ("HOME", "SHELL", "LOGNAME", "LANG")
SPAWN_PATH = "/usr/bin:/bin"
SPAWN_WATCH_S = 2.0


def snapshot_spec(repo: str = "~/mahara-cockpits", offsets: Optional[dict[str, int]] = None) -> dict[str, Any]:
    logs = list(HERMES_LOGS)
    return {
        "markers": PROCESS_MARKERS,
        "logs": logs,
        "log_offsets": dict(offsets or {}),
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
            "portal": f"{MONITOR_ROOT}/state.json",
            "dialer": f"{MONITOR_ROOT}/dialer/state.json",
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
    def spawn(self, command: str) -> tuple[int, Optional[int]]:
        """Start `command`; (pid, exit code if it ended within 2 s, else None)."""
        raise HostError("a remote run never starts anything on the VPS")

    def proc_stat(self, pid: int) -> Optional[tuple[int, int]]:
        """(start time in ticks, CPU time in ticks) of a live process, or None when it is gone."""
        raise HostError("a remote run never looks at one process")

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

    def spawn(self, command: str) -> tuple[int, Optional[int]]:
        """Start `command` detached through bash, as cron would, with cron's bare
        environment (the command sources its own env files), and watch it for 2 s:
        `flock -n` exits 1 at once when another run holds the lock."""
        env = {k: os.environ[k] for k in SPAWN_ENV_KEYS if os.environ.get(k)}
        env.setdefault("HOME", str(Path.home()))
        env["PATH"] = SPAWN_PATH
        p = subprocess.Popen(["bash", "-c", command], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True, cwd=str(Path.home()), env=env)
        try:
            return p.pid, p.wait(timeout=SPAWN_WATCH_S)
        except subprocess.TimeoutExpired:
            return p.pid, None

    def proc_stat(self, pid: int) -> Optional[tuple[int, int]]:
        try:
            with open(f"/proc/{int(pid)}/stat") as fh:
                fields = fh.read().rsplit(")", 1)[1].split()
        except (OSError, IndexError):
            return None
        return int(fields[19]), int(fields[11]) + int(fields[12])

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


def write_monitor_state(path: str, incidents: dict[str, Any], now: float) -> None:
    """The guardian's Hermes-owned incidents in the Hermes monitor's own shape, so the
    reliability fixer's trigger can pick them up once a person adds a cockpit-guardian
    row to fixer-projects.json. Written atomically, mode 640 like the monitors' files."""
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    body = {"incidents": incidents, "last_tick": {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
                                                  "status": {}}, "outbox": []}
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(body, fh, ensure_ascii=False, sort_keys=True)
        os.chmod(tmp, 0o640)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


__all__ = ["Host", "LocalHost", "SshHost", "HostError", "snapshot_spec", "open_host", "write_monitor_state", "ROOT"]
