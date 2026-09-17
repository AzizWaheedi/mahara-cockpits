"""Configuration: paths, thresholds, actor ids, model names and key lookup.

Keys are read by NAME from the environment first, then from the Hermes key
files (the same files hermes/cockpit-ask-ai/scripts/askai.py reads). Values
are never logged. Every knob has an environment override so the cron line
can change a threshold without editing code.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

KEY_FILES = (
    os.environ.get("RADAR_KEY_FILE", ""),
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
                name = name.strip()
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                if name and name not in out:
                    out[name] = value
    except OSError:
        pass
    return out


def key(name: str, default: str = "") -> str:
    """A secret or setting by name: environment first, then the key files."""
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


@dataclass
class Config:
    home: Path
    state_path: Path
    out_dir: Path
    watchlist_path: Path
    # Outlier rule (Aziz, locked 2026-05-15): 3x to 5x study it, 5x and above
    # reverse engineer it, below 3x is noise. Baseline is a trimmed median.
    threshold: float = 3.0
    reverse_threshold: float = 5.0
    sample_size: int = 30
    trim: float = 0.1
    min_baseline_n: int = 5
    min_age_hours: int = 48
    window_days: int = 30
    min_followers_for_audience: int = 2000
    # Apify
    apify_base: str = "https://api.apify.com/v2"
    actor_instagram: str = "apify~instagram-scraper"
    actor_instagram_hashtag: str = "apify~instagram-hashtag-scraper"
    actor_tiktok: str = "clockworks~tiktok-scraper"
    actor_snapchat: str = ""
    apify_concurrency: int = 4
    apify_timeout_sec: int = 600
    apify_max_runs_per_scan: int = 150
    # Models
    gemini_model: str = "gemini-2.5-flash"
    gemini_text_model: str = "gemini-2.5-flash"
    groq_model: str = "whisper-large-v3"
    openai_vision_model: str = "gpt-4o-mini"
    deepseek_model: str = "deepseek-flash"
    frame_every_sec: float = 2.5
    max_frames: int = 24
    max_video_bytes: int = 200 * 1024 * 1024
    max_duration_sec: int = 600
    # Sinks
    bridge_url: str = ""
    bridge_token: str = ""
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_table: str = "ideation_posts"
    slack_channel: str = ""
    extra: dict[str, str] = field(default_factory=dict)

    @staticmethod
    def from_env() -> "Config":
        home = Path(key("RADAR_HOME", str(Path.home() / ".ideation-radar"))).expanduser()
        cfg = Config(
            home=home,
            state_path=Path(key("RADAR_STATE", str(home / "state.json"))),
            out_dir=Path(key("RADAR_OUT", str(home / "out"))),
            watchlist_path=Path(key("RADAR_WATCHLIST", str(home / "watchlist.json"))),
            threshold=_float("RADAR_THRESHOLD", 3.0),
            reverse_threshold=_float("RADAR_REVERSE_THRESHOLD", 5.0),
            sample_size=_int("RADAR_SAMPLE", 30),
            trim=_float("RADAR_TRIM", 0.1),
            min_baseline_n=_int("RADAR_MIN_N", 5),
            min_age_hours=_int("RADAR_MIN_AGE_HOURS", 48),
            window_days=_int("RADAR_WINDOW_DAYS", 30),
            min_followers_for_audience=_int("RADAR_MIN_FOLLOWERS", 2000),
            actor_instagram=key("RADAR_ACTOR_INSTAGRAM", "apify~instagram-scraper"),
            actor_instagram_hashtag=key(
                "RADAR_ACTOR_INSTAGRAM_HASHTAG", "apify~instagram-hashtag-scraper"
            ),
            actor_tiktok=key("RADAR_ACTOR_TIKTOK", "clockworks~tiktok-scraper"),
            actor_snapchat=key("RADAR_ACTOR_SNAPCHAT", ""),
            apify_concurrency=_int("RADAR_APIFY_CONCURRENCY", 4),
            apify_timeout_sec=_int("RADAR_APIFY_TIMEOUT", 600),
            apify_max_runs_per_scan=_int("RADAR_APIFY_MAX_RUNS", 150),
            gemini_model=key("RADAR_GEMINI_MODEL", "gemini-2.5-flash"),
            gemini_text_model=key("RADAR_GEMINI_TEXT_MODEL", "gemini-2.5-flash"),
            groq_model=key("RADAR_GROQ_MODEL", "whisper-large-v3"),
            openai_vision_model=key("RADAR_OPENAI_VISION_MODEL", "gpt-4o-mini"),
            deepseek_model=key("RADAR_DEEPSEEK_MODEL", "deepseek-flash"),
            frame_every_sec=_float("RADAR_FRAME_EVERY_SEC", 2.5),
            max_frames=_int("RADAR_MAX_FRAMES", 24),
            max_video_bytes=_int("RADAR_MAX_VIDEO_BYTES", 200 * 1024 * 1024),
            max_duration_sec=_int("RADAR_MAX_DURATION_SEC", 600),
            bridge_url=key("COCKPIT_IDEATION_URL", ""),
            bridge_token=key("COCKPIT_IDEATION_TOKEN", ""),
            # Opt-in only: the generic SUPABASE_URL in the Hermes key file points at
            # another project, so nothing is written to Supabase unless these are set.
            supabase_url=key("RADAR_SUPABASE_URL", ""),
            supabase_key=key("RADAR_SUPABASE_KEY", ""),
            supabase_table=key("RADAR_SUPABASE_TABLE", "ideation_posts"),
            slack_channel=key("RADAR_SLACK_CHANNEL", ""),
        )
        return cfg

    # Secrets are looked up lazily so a missing key only fails the step that
    # needs it, never the whole run.
    @property
    def apify_token(self) -> str:
        return key("APIFY_API_KEY") or key("APIFY_TOKEN")

    @property
    def gemini_key(self) -> str:
        return key("GOOGLE_AI_API_KEY") or key("GEMINI_API_KEY")

    @property
    def groq_key(self) -> str:
        return key("GROQ_API_KEY")

    @property
    def openai_key(self) -> str:
        return key("OPENAI_API_KEY")

    @property
    def deepseek_key(self) -> str:
        return key("DEEPSEEK_API_KEY")

    @property
    def slack_token(self) -> str:
        return key("SLACK_BOT_TOKEN")

    def ensure_dirs(self) -> None:
        self.home.mkdir(parents=True, exist_ok=True)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
