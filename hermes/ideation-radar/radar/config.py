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
    min_baseline_n: int = 8
    # Score nothing under a day old; the tier is provisional until day seven;
    # baseline posts must be at least seven days old (their counts have settled).
    min_age_hours: int = 24
    mature_hours: int = 168
    baseline_min_age_hours: int = 168
    window_days: int = 30
    min_followers_for_audience: int = 2000
    floor_instagram: float = 1000.0
    floor_tiktok: float = 1000.0
    floor_snapchat: float = 300.0
    min_engagement: float = 0.02
    hashtag_min_views: int = 10000
    # Instagram tag pages hide reel play counts from a logged-out fetch. A hit
    # with no view count is kept when likes plus comments clear this floor;
    # its author still gets a real profile scan, which is where views come from.
    hashtag_min_engagement: int = 300
    hashtag_top_k: int = 10
    hashtag_profile_cap: int = 20
    # Instagram discovery without handles (Aziz, 2026-09-17): a "search" target
    # is a keyword such as "ديكور الكويت"; the search actor lists matching
    # accounts, the promising public ones get a profile scan, and those with a
    # baseline join the watchlist by themselves (source "search").
    search_limit: int = 20
    search_top_k: int = 8
    search_profile_cap: int = 15
    search_retry_days: int = 90
    search_autowatch: bool = True
    # Trends: the same format from several accounts inside the window.
    trend_window_days: int = 14
    trend_min_authors: int = 3
    trend_similarity: float = 0.82
    trend_max_describe: int = 40
    embed_model: str = "gemini-embedding-001"
    embed_dims: int = 256
    openai_embed_model: str = "text-embedding-3-small"
    # Speech: ElevenLabs Scribe first for Arabic dialects, Groq Whisper second.
    speech_providers: str = "elevenlabs,groq"
    elevenlabs_stt_model: str = "scribe_v1"
    # Apify
    apify_base: str = "https://api.apify.com/v2"
    actor_instagram: str = "apify~instagram-scraper"
    # Empty: hashtags go through the main Instagram actor with an explore/tags URL
    # (the dedicated hashtag actor is rated 3.4 against 4.7 for the main one).
    actor_instagram_hashtag: str = ""
    actor_instagram_search: str = "apify~instagram-search-scraper"
    # Same Clockworks engine and fields as the flagship tiktok-scraper, without
    # its run fee and at a lower per-result price (checked 2026-09-17).
    actor_tiktok: str = "clockworks~free-tiktok-scraper"
    actor_tiktok_profile: str = "clockworks~tiktok-profile-scraper"
    # Snapchat (checked 2026-09-17): the most run actors. Profile rows carry the
    # spotlights; a pasted Spotlight link goes through the spotlight actor.
    actor_snapchat: str = "tri_angle~snapchat-scraper"
    actor_snapchat_post: str = "tri_angle~snapchat-spotlight-scraper"
    # TikTok media links only exist through the paid download add-on; the copy
    # lands in this named key-value store on Apify.
    tiktok_media_store: str = "ideation-radar-media"
    tiktok_subtitles: str = "DOWNLOAD_SUBTITLES"
    apify_concurrency: int = 4
    apify_timeout_sec: int = 600
    apify_max_runs_per_scan: int = 150
    # Models
    # Google retired gemini-2.5-flash for new keys on 2026-09-17 and points at 3.6 Flash.
    gemini_model: str = "gemini-3.6-flash"
    gemini_text_model: str = "gemini-3.6-flash"
    # High media resolution reads small Arabic text cards; three times the video tokens, still cents.
    gemini_resolution: str = "MEDIA_RESOLUTION_HIGH"
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
    supabase_bucket: str = "ideation-stills"
    slack_channel: str = ""
    # One authoritative store. Aziz, 2026-09-17: the ideation home is Supabase.
    # "auto": Supabase when its keys are set, else the cockpit door, else files only.
    sink_mode: str = "auto"
    # "auto": the Supabase watchlist when Supabase is the sink, else the JSON file.
    watchlist_source: str = "auto"
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
            min_baseline_n=_int("RADAR_MIN_N", 8),
            min_age_hours=_int("RADAR_MIN_AGE_HOURS", 24),
            mature_hours=_int("RADAR_MATURE_HOURS", 168),
            baseline_min_age_hours=_int("RADAR_BASELINE_MIN_AGE_HOURS", 168),
            window_days=_int("RADAR_WINDOW_DAYS", 30),
            min_followers_for_audience=_int("RADAR_MIN_FOLLOWERS", 2000),
            floor_instagram=_float("RADAR_FLOOR_INSTAGRAM", 1000.0),
            floor_tiktok=_float("RADAR_FLOOR_TIKTOK", 1000.0),
            floor_snapchat=_float("RADAR_FLOOR_SNAPCHAT", 300.0),
            min_engagement=_float("RADAR_MIN_ENGAGEMENT", 0.02),
            hashtag_min_views=_int("RADAR_HASHTAG_MIN_VIEWS", 10000),
            hashtag_min_engagement=_int("RADAR_HASHTAG_MIN_ENGAGEMENT", 300),
            hashtag_top_k=_int("RADAR_HASHTAG_TOP_K", 10),
            hashtag_profile_cap=_int("RADAR_HASHTAG_PROFILE_CAP", 20),
            search_limit=_int("RADAR_SEARCH_LIMIT", 20),
            search_top_k=_int("RADAR_SEARCH_TOP_K", 8),
            search_profile_cap=_int("RADAR_SEARCH_PROFILE_CAP", 15),
            search_retry_days=_int("RADAR_SEARCH_RETRY_DAYS", 90),
            search_autowatch=key("RADAR_SEARCH_AUTOWATCH", "1").lower() not in ("0", "false", "no"),
            trend_window_days=_int("RADAR_TREND_WINDOW_DAYS", 14),
            trend_min_authors=_int("RADAR_TREND_MIN_AUTHORS", 3),
            trend_similarity=_float("RADAR_TREND_SIMILARITY", 0.82),
            trend_max_describe=_int("RADAR_TREND_MAX_DESCRIBE", 40),
            embed_model=key("RADAR_EMBED_MODEL", "gemini-embedding-001"),
            embed_dims=_int("RADAR_EMBED_DIMS", 256),
            openai_embed_model=key("RADAR_OPENAI_EMBED_MODEL", "text-embedding-3-small"),
            speech_providers=key("RADAR_SPEECH_PROVIDER", "elevenlabs,groq"),
            elevenlabs_stt_model=key("RADAR_ELEVENLABS_STT_MODEL", "scribe_v1"),
            actor_instagram=key("RADAR_ACTOR_INSTAGRAM", "apify~instagram-scraper"),
            actor_instagram_hashtag=key("RADAR_ACTOR_INSTAGRAM_HASHTAG", ""),
            actor_instagram_search=key("RADAR_ACTOR_INSTAGRAM_SEARCH", "apify~instagram-search-scraper"),
            actor_tiktok=key("RADAR_ACTOR_TIKTOK", "clockworks~free-tiktok-scraper"),
            actor_tiktok_profile=key("RADAR_ACTOR_TIKTOK_PROFILE", "clockworks~tiktok-profile-scraper"),
            actor_snapchat=key("RADAR_ACTOR_SNAPCHAT", "tri_angle~snapchat-scraper"),
            actor_snapchat_post=key("RADAR_ACTOR_SNAPCHAT_POST", "tri_angle~snapchat-spotlight-scraper"),
            tiktok_media_store=key("RADAR_TIKTOK_MEDIA_STORE", "ideation-radar-media"),
            tiktok_subtitles=key("RADAR_TIKTOK_SUBTITLES", "DOWNLOAD_SUBTITLES"),
            apify_concurrency=_int("RADAR_APIFY_CONCURRENCY", 4),
            apify_timeout_sec=_int("RADAR_APIFY_TIMEOUT", 600),
            apify_max_runs_per_scan=_int("RADAR_APIFY_MAX_RUNS", 150),
            gemini_model=key("RADAR_GEMINI_MODEL", "gemini-3.6-flash"),
            gemini_text_model=key("RADAR_GEMINI_TEXT_MODEL", "gemini-3.6-flash"),
            gemini_resolution=key("RADAR_GEMINI_RESOLUTION", "MEDIA_RESOLUTION_HIGH"),
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
            supabase_bucket=key("RADAR_SUPABASE_BUCKET", "ideation-stills"),
            slack_channel=key("RADAR_SLACK_CHANNEL", ""),
            sink_mode=key("RADAR_SINK", "auto").lower(),
            watchlist_source=key("RADAR_WATCHLIST_SOURCE", "auto").lower(),
        )
        return cfg

    def floor_for(self, platform: str) -> float:
        return {"instagram": self.floor_instagram, "tiktok": self.floor_tiktok, "snapchat": self.floor_snapchat}.get(platform, 0.0)

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_key)

    @property
    def effective_sink(self) -> str:
        if self.sink_mode == "auto":
            if self.supabase_configured:
                return "supabase"
            if self.bridge_url and self.bridge_token:
                return "cockpit"
            return "files"
        return self.sink_mode

    @property
    def use_cockpit_sink(self) -> bool:
        return self.effective_sink in ("cockpit", "both") and bool(self.bridge_url and self.bridge_token)

    @property
    def use_supabase_sink(self) -> bool:
        return self.effective_sink in ("supabase", "both") and self.supabase_configured

    @property
    def watchlist_from_supabase(self) -> bool:
        if self.watchlist_source == "supabase":
            return self.supabase_configured
        if self.watchlist_source == "file":
            return False
        return self.use_supabase_sink

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

    @property
    def elevenlabs_key(self) -> str:
        # ELEVENLABS_API_KEY_V2 in the Hermes key file is a key id, not a key (checked 2026-09-18).
        return key("ELEVENLABS_API_KEY")

    @property
    def slack_channels(self) -> list[str]:
        """RADAR_SLACK_CHANNEL takes one id or a comma separated list (Aziz and Sabry)."""
        return [c.strip() for c in self.slack_channel.split(",") if c.strip()]

    def ensure_dirs(self) -> None:
        self.home.mkdir(parents=True, exist_ok=True)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
