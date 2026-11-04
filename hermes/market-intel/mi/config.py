"""Every knob and every key name. Keys are read by NAME, never printed.

Lookup order for a name: the process environment, then ~/.market-intel/env (mode 600), then the Hermes key
files the other VPS workers read (/opt/data/bibi/api-keys.env, /opt/data/.env). MARKET_INTEL_ENV_FILE points at
another env file first (tests use it). Every knob has an environment override so the cron line can change a
cap without a code edit.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping, Optional

HOME = Path(os.path.expanduser(os.environ.get("MARKET_INTEL_HOME", "~/.market-intel")))
HERMES_KEY_FILES = ("/opt/data/bibi/api-keys.env", "/opt/data/.env")

# The card field and the test card (contract 4.13; the writer's research kind comes in MI-1b).
MARKET_RESEARCH_FIELD = "7489dbcc-fbbd-4eec-abfd-1306be7ff4b8"
TEST_CARD = "86eywg1cq"

# Key names (values never logged).
SUPABASE_URL = "MARKET_INTEL_SUPABASE_URL"
SUPABASE_KEY = "MARKET_INTEL_SUPABASE_KEY"
APIFY_KEYS = ("MARKET_INTEL_APIFY_KEY", "APIFY_API_KEY")
SCRAPECREATORS_KEY = "SCRAPECREATORS_API_KEY"
FOREPLAY_KEY = "FOREPLAY_API_KEY"
GOOGLE_KEY_FILE = "MARKET_INTEL_GOOGLE_KEY_FILE"
TEMPLATE_DOC = "MARKET_INTEL_TEMPLATE_DOC"
PROVIDER = "MARKET_INTEL_MODEL_PROVIDER"
CLAUDE_TOKEN = "CLAUDE_CODE_OAUTH_TOKEN"
APPLY = "MARKET_INTEL_APPLY"


def parse_env_file(path: str) -> dict[str, str]:
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
    """Secrets and settings by name. `environ` and `files` are injectable so tests never read the machine's."""

    def __init__(self, environ: Optional[Mapping[str, str]] = None, files: Optional[tuple[str, ...]] = None):
        self.environ = os.environ if environ is None else environ
        if files is None:
            files = (os.environ.get("MARKET_INTEL_ENV_FILE", ""), str(HOME / "env"), *HERMES_KEY_FILES)
        self.files = tuple(f for f in files if f)
        self._file_keys: Optional[dict[str, str]] = None

    def _files(self) -> dict[str, str]:
        if self._file_keys is None:
            merged: dict[str, str] = {}
            for path in self.files:
                if os.path.exists(path):
                    for k, v in parse_env_file(path).items():
                        merged.setdefault(k, v)
            self._file_keys = merged
        return self._file_keys

    def get(self, name: str, default: str = "") -> str:
        value = self.environ.get(name)
        if value:
            return value
        return self._files().get(name, default)

    def first(self, names: tuple[str, ...]) -> tuple[str, str]:
        """(name, value) of the first name that is set, else (names[0], '')."""
        for n in names:
            v = self.get(n)
            if v:
                return n, v
        return names[0], ""

    def has(self, name: str) -> bool:
        return bool(self.get(name))


def _float(keys: Keys, name: str, default: float) -> float:
    try:
        return float(keys.get(name, str(default)))
    except ValueError:
        return default


def _int(keys: Keys, name: str, default: int) -> int:
    try:
        return int(keys.get(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Actors:
    maps: str = "compass~crawler-google-places"
    reviews: str = "compass~Google-Maps-Reviews-Scraper"
    serp: str = "apify~google-search-scraper"
    web: str = "apify~website-content-crawler"
    instagram: str = "apify~instagram-profile-scraper"
    facebook: str = "apify~facebook-pages-scraper"
    ads: str = "apify~facebook-ads-scraper"
    tiktok: str = "clockworks~tiktok-profile-scraper"
    snapchat: str = "tri_angle~snapchat-scraper"


# Apify Store prices, BRONZE (Starter), read 2026-11-02 (design market-intel.md 2.4). Used for the estimate a
# pull reserves before it starts; the run's usageTotalUsd is what is counted after it.
PRICE = {
    "maps_place": 0.005,       # a place plus its details
    "maps_search_place": 0.003,
    "review": 0.00045,
    "serp_page": 0.0025,
    "serp_ads": 0.005,
    "ig_profile": 0.0023,
    "fb_page": 0.0082,
    "apify_ad": 0.005,
    "tiktok_result": 0.002,
    "snap_profile": 0.002,
    "web_page_apify": 0.0025,
}


@dataclass
class Caps:
    """Per-run pull caps (design 2.4). Each is the most a pull may ask for."""
    client_reviews: int = 100
    competitor_reviews: int = 40
    brand_queries: int = 3
    maps_queries: int = 4
    maps_places_per_query: int = 15
    local_queries: int = 4
    ad_keyword_queries: int = 2
    ads_per_keyword: int = 25
    client_ads: int = 30
    competitor_ads: int = 20
    client_web_pages: int = 12
    competitor_web_pages: int = 8
    client_tiktok: int = 20
    competitor_tiktok: int = 10
    shortlist: int = 25
    competitors: int = 6
    reserves: int = 2


@dataclass
class Config:
    keys: Keys
    home: Path = HOME
    usd_cap_run: float = 2.0
    usd_cap_month: float = 25.0
    sc_usd_per_credit: float = 0.0019
    apify_max_runs: int = 40
    apify_concurrency: int = 4
    apify_timeout_sec: int = 900
    apify_poll_sec: float = 6.0
    provider: str = "vps"
    vps_url: str = "http://127.0.0.1:3456/v1"
    claude_bin: str = "claude"
    model_pick: str = "sonnet"
    model_write: str = "opus"
    model_timeout: float = 900.0
    evidence_chars: int = 480_000
    apply: bool = False
    worker: str = "market-intel"
    actors: Actors = field(default_factory=Actors)
    caps: Caps = field(default_factory=Caps)

    @property
    def runs_dir(self) -> Path:
        return self.home / "runs"

    def actor(self, name: str) -> str:
        override = self.keys.get(f"MARKET_INTEL_ACTOR_{name.upper()}")
        return override or getattr(self.actors, name)


def load(keys: Optional[Keys] = None, home: Optional[Path] = None) -> Config:
    keys = keys or Keys()
    cfg = Config(keys=keys, home=home or Path(os.path.expanduser(keys.get("MARKET_INTEL_HOME", str(HOME)))))
    cfg.usd_cap_run = _float(keys, "MARKET_INTEL_USD_CAP_RUN", cfg.usd_cap_run)
    cfg.usd_cap_month = _float(keys, "MARKET_INTEL_USD_CAP_MONTH", cfg.usd_cap_month)
    cfg.sc_usd_per_credit = _float(keys, "MARKET_INTEL_SC_USD_PER_CREDIT", cfg.sc_usd_per_credit)
    cfg.apify_max_runs = _int(keys, "MARKET_INTEL_APIFY_MAX_RUNS", cfg.apify_max_runs)
    cfg.apify_concurrency = max(1, _int(keys, "MARKET_INTEL_APIFY_CONCURRENCY", cfg.apify_concurrency))
    cfg.apify_timeout_sec = _int(keys, "MARKET_INTEL_APIFY_TIMEOUT_SEC", cfg.apify_timeout_sec)
    cfg.provider = (keys.get(PROVIDER, cfg.provider) or "vps").strip().lower()
    cfg.vps_url = keys.get("MARKET_INTEL_VPS_URL", cfg.vps_url).rstrip("/")
    cfg.claude_bin = keys.get("MARKET_INTEL_CLAUDE_BIN", cfg.claude_bin)
    cfg.model_pick = keys.get("MARKET_INTEL_MODEL_PICK", cfg.model_pick)
    cfg.model_write = keys.get("MARKET_INTEL_MODEL_WRITE", cfg.model_write)
    cfg.model_timeout = _float(keys, "MARKET_INTEL_MODEL_TIMEOUT", cfg.model_timeout)
    cfg.evidence_chars = _int(keys, "MARKET_INTEL_EVIDENCE_CHARS", cfg.evidence_chars)
    cfg.apply = keys.get(APPLY, "").strip().lower() in ("1", "true", "yes")
    return cfg
