"""Settings and keys for the guardian.

Keys are read BY NAME, from the environment first and then from the env
files the cron line loads, exactly like the other hermes workers. A value is
never printed, logged, stored or posted; only its name and whether it is set.
"""
from __future__ import annotations

import os
import shlex
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent  # hermes/cockpit-guardian
REPO = ROOT.parent.parent                       # the mahara-cockpits checkout

WORKER = "cockpit-guardian"
REF = "bldgtotkfmhoxmlzowdx"                    # Creative Triage
SUPABASE_URL = f"https://{REF}.supabase.co"
MGMT_API = "https://api.supabase.com"
CONVEX_DEPLOYMENTS = ("adorable-seahorse-418", "impressive-dinosaur-375", "colorful-wombat-644")
VPS_PUBLIC = "187.77.156.166"
INCIDENTS_TABLE = "cockpit_guardian_incidents"
PROBE_FN = "cockpit_guardian_probe"

MODES = ("report-only", "fix")


def _default_key_files() -> list[str]:
    home = Path.home()
    return [
        str(home / ".cockpit-guardian" / "env"),
        str(home / ".editor-desk" / "env"),
        "/opt/data/bibi/api-keys.env",
    ]


def parse_env_file(path: str) -> dict[str, str]:
    """NAME=value lines. Comments, blanks and `export ` are handled; quotes stripped."""
    out: dict[str, str] = {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                if line.startswith("export "):
                    line = line[7:]
                name, _, value = line.partition("=")
                name, value = name.strip(), value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                if name and name not in out:
                    out[name] = value
    except OSError:
        pass
    return out


class Keys:
    """Every key by name. `files` is searched in order after the environment."""

    def __init__(self, files: Optional[list[str]] = None, environ: Optional[dict[str, str]] = None, use_files: bool = True):
        self.files = files if files is not None else (
            [p for p in os.environ.get("GUARDIAN_KEY_FILES", "").split(":") if p] or _default_key_files())
        self.environ = environ if environ is not None else os.environ
        self.use_files = use_files
        self._merged: Optional[dict[str, str]] = None

    def _file_keys(self) -> dict[str, str]:
        if self._merged is None:
            merged: dict[str, str] = {}
            if self.use_files:
                for path in self.files:
                    if path and os.path.exists(path):
                        for k, v in parse_env_file(path).items():
                            merged.setdefault(k, v)
            self._merged = merged
        return self._merged

    def get(self, name: str, default: str = "") -> str:
        v = self.environ.get(name)
        if v:
            return v
        return self._file_keys().get(name, default)

    def has(self, name: str) -> bool:
        return bool(self.get(name).strip())


@dataclass
class Config:
    keys: Keys
    home: Path                       # the guardian's own folder (state, briefs, logs)
    mode: str = "report-only"
    dry_run: bool = False
    quiet: bool = False
    ssh: list[str] = field(default_factory=list)  # set: the VPS is read over ssh (never fixed)
    db_door: str = "auto"            # rest | mgmt | auto
    supabase_url: str = ""
    supabase_key: str = ""
    mgmt_token: str = ""
    slack_token: str = ""
    slack_channel: str = ""
    repo_on_vps: str = "~/mahara-cockpits"

    @property
    def remote(self) -> bool:
        return bool(self.ssh)

    @property
    def can_fix(self) -> bool:
        return self.mode == "fix" and not self.dry_run and not self.remote

    @property
    def state_file(self) -> Path:
        return self.home / "state.json"


def load(*, mode: Optional[str] = None, dry_run: bool = False, quiet: bool = False,
         state_dir: Optional[str] = None, keys: Optional[Keys] = None) -> Config:
    keys = keys or Keys()
    home = Path(state_dir or keys.get("GUARDIAN_HOME") or (Path.home() / ".cockpit-guardian")).expanduser()
    chosen = mode or keys.get("GUARDIAN_MODE") or "report-only"
    if chosen not in MODES:
        raise ValueError(f"--mode must be one of {', '.join(MODES)}")
    token = keys.get("SUPABASE_ACCESS_TOKEN")
    token_file = keys.get("GUARDIAN_MGMT_TOKEN_FILE")
    if not token and token_file:
        try:
            token = Path(token_file).expanduser().read_text(encoding="utf-8").strip()
        except OSError:
            token = ""
    ssh_raw = keys.get("GUARDIAN_SSH")
    return Config(
        keys=keys,
        home=home,
        mode=chosen,
        dry_run=dry_run,
        quiet=quiet,
        ssh=shlex.split(os.path.expanduser(ssh_raw)) if ssh_raw else [],
        db_door=(keys.get("GUARDIAN_DB") or "auto").lower(),
        supabase_url=(keys.get("GUARDIAN_SUPABASE_URL") or keys.get("DESK_SUPABASE_URL") or SUPABASE_URL).rstrip("/"),
        supabase_key=keys.get("GUARDIAN_SUPABASE_KEY") or keys.get("DESK_SUPABASE_KEY"),
        mgmt_token=token,
        slack_token=keys.get("SLACK_BOT_TOKEN"),
        slack_channel=keys.get("GUARDIAN_SLACK_CHANNEL") or keys.get("SLACK_HEALTH_CHANNEL"),
        repo_on_vps=keys.get("GUARDIAN_REPO_ON_VPS") or "~/mahara-cockpits",
    )
