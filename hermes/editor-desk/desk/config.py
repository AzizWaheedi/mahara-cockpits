"""Settings and secrets for the editor desk.

Keys are read BY NAME from the environment first, then from the Hermes key
files, exactly like the ideation radar. Values are never printed. Every knob
has an environment override so a cron line can change behaviour without a
code change.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

KEY_FILES = (
    os.environ.get("DESK_KEY_FILE", ""),
    "/opt/data/bibi/api-keys.env",
    "/opt/data/.env",
)

_file_keys: Optional[dict[str, str]] = None


def _parse_env_file(path: str) -> dict[str, str]:
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


def key(name: str, default: str = "") -> str:
    global _file_keys
    value = os.environ.get(name)
    if value:
        return value
    if _file_keys is None:
        merged: dict[str, str] = {}
        for path in KEY_FILES:
            if path and os.path.exists(path):
                for k, v in _parse_env_file(path).items():
                    merged.setdefault(k, v)
        _file_keys = merged
    return _file_keys.get(name, default)


def _int(name: str, default: int) -> int:
    try:
        return int(key(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(key(name, str(default)))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    return key(name, "1" if default else "0").strip().lower() not in ("0", "false", "no", "off", "")


# Clients - Mahara, and the one field on it the cockpit may add to.
# Read live 2026-09-19.
CLIENT_LIST = "901816559981"
CLIENT_FIELD = {"dos_donts": "0f06a523-64f9-4f20-90a1-f76cb6f85318"}

# The ClickUp Video Pipeline. Ids checked live on 2026-09-18.
VIDEO_LIST = "901816720767"
FIELD = {
    "assigned_editor": "8e519279-da37-4ae2-93fa-78865ee187fc",
    "footage_folder": "083df377-ca22-4c8d-a769-006c2b0b9bdc",
    "raw_video": "d37a6747-c4a1-43c5-bb73-e1725ecec982",
    "edited_video": "c2aa2852-0370-4c94-bb78-6dfc56eb2aaf",
    "request_type": "c4b89a5b-e853-425a-abab-ec13157fd76c",
    "references": "62d96cc1-ce78-4abf-a702-3411104bd0e8",
    "notes": "6742edfb-9b6f-4615-933d-7ebd74f9542b",
    "dialect": "673028fc-8cf7-4e56-815b-bd454c8d604a",
    "orientation": "7cbff577-4a7b-491f-ab60-5937b3bda4a3",
    "format": "fb7856a4-b568-4dc5-b6a3-e2ebcd517f65",
    "revision_round": "dbeddaf4-f85b-4921-832d-b3b3f726e963",
    "client_feedback": "33f39089-0f7e-42b6-99af-dd333d25fcc0",
    "website": "f9acdb61-06bb-4c32-ab72-abac105b043f",
    "instagram": "d724c74f-5857-4ea8-8458-1b59cb24ab5c",
    "drive_folder": "ce6129a5-c8e5-41ba-ac50-8650c7556469",
}

# Statuses the board uses. "open" is everything a person still owes work on.
DONE_STATUSES = ("complete", "closed", "done", "cancelled")

VIDEO_MIMES = ("video/", "application/mp4", "application/octet-stream")


@dataclass
class Config:
    home: Path
    scratch: Path
    out_dir: Path
    state_path: Path

    # What a job needs before an editor can start.
    require_script: bool = False

    # Preparation limits. The box has four cores, no GPU and 69 GB free, so the
    # work is bounded per run rather than per day.
    max_files_per_job: int = 12
    max_file_bytes: int = 3 * 1024 * 1024 * 1024
    max_transcribe_seconds: float = 5400.0
    max_jobs_per_run: int = 3
    scene_threshold: float = 0.35
    still_count: int = 3

    # Version checks.
    hook_window_sec: float = 3.0
    loudness_target: float = -14.0
    loudness_tolerance: float = 3.0
    ratio_tolerance: float = 0.02

    # Speech.
    # The Foreplay board that acts as a drop box: anything saved into it,
    # by anyone on any device, reaches the shared ideation board.
    foreplay_drop_box: str = "Ideation"
    speech_providers: str = "elevenlabs"
    elevenlabs_stt_model: str = "scribe_v1"

    # Stores.
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_bucket: str = "editor-stills"
    slack_channel: str = ""
    clickup_writeback: bool = True
    extra: dict[str, str] = field(default_factory=dict)

    @staticmethod
    def from_env() -> "Config":
        home = Path(key("DESK_HOME", str(Path.home() / ".editor-desk"))).expanduser()
        return Config(
            home=home,
            scratch=Path(key("DESK_SCRATCH", str(home / "scratch"))),
            out_dir=Path(key("DESK_OUT", str(home / "out"))),
            state_path=Path(key("DESK_STATE", str(home / "state.json"))),
            require_script=_bool("DESK_REQUIRE_SCRIPT", False),
            max_files_per_job=_int("DESK_MAX_FILES", 12),
            max_file_bytes=_int("DESK_MAX_FILE_BYTES", 3 * 1024 * 1024 * 1024),
            max_transcribe_seconds=_float("DESK_MAX_TRANSCRIBE_SEC", 5400.0),
            max_jobs_per_run=_int("DESK_MAX_JOBS", 3),
            scene_threshold=_float("DESK_SCENE_THRESHOLD", 0.35),
            still_count=_int("DESK_STILLS", 3),
            hook_window_sec=_float("DESK_HOOK_WINDOW", 3.0),
            loudness_target=_float("DESK_LOUDNESS_TARGET", -14.0),
            loudness_tolerance=_float("DESK_LOUDNESS_TOLERANCE", 3.0),
            ratio_tolerance=_float("DESK_RATIO_TOLERANCE", 0.02),
            foreplay_drop_box=key("FOREPLAY_DROP_BOX", "Ideation"),
            speech_providers=key("DESK_SPEECH_PROVIDER", "elevenlabs"),
            elevenlabs_stt_model=key("DESK_ELEVENLABS_STT_MODEL", "scribe_v1"),
            supabase_url=key("DESK_SUPABASE_URL") or key("RADAR_SUPABASE_URL", ""),
            supabase_key=key("DESK_SUPABASE_KEY") or key("RADAR_SUPABASE_KEY", ""),
            supabase_bucket=key("DESK_SUPABASE_BUCKET", "editor-stills"),
            slack_channel=key("DESK_SLACK_CHANNEL", ""),
            clickup_writeback=_bool("DESK_CLICKUP_WRITEBACK", True),
        )

    # Secrets are looked up lazily so a missing one only fails its own step.
    @property
    def clickup_key(self) -> str:
        return key("CLICKUP_API_KEY") or key("CLICKUP_API_TOKEN")

    @property
    def google_client_id(self) -> str:
        return key("GOOGLE_CLIENT_ID")

    @property
    def google_client_secret(self) -> str:
        return key("GOOGLE_CLIENT_SECRET")

    @property
    def google_refresh_token(self) -> str:
        return key("GOOGLE_REFRESH_TOKEN")

    @property
    def elevenlabs_key(self) -> str:
        return key("ELEVENLABS_API_KEY")

    @property
    def groq_key(self) -> str:
        return key("GROQ_API_KEY")

    @property
    def fathom_key(self) -> str:
        return key("FATHOM_API_KEY")

    @property
    def foreplay_key(self) -> str:
        return key("FOREPLAY_API_KEY")

    @property
    def meta_token(self) -> str:
        return key("META_ACCESS_TOKEN") or key("META_SYSTEM_TOKEN")

    @property
    def slack_token(self) -> str:
        return key("SLACK_BOT_TOKEN")

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_key)

    @property
    def google_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret and self.google_refresh_token)

    def ensure_dirs(self) -> None:
        for p in (self.home, self.scratch, self.out_dir):
            p.mkdir(parents=True, exist_ok=True)
