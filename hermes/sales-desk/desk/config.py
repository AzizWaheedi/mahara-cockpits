"""Settings and secrets for the sales desk.

Keys are read BY NAME from the environment first, then from the env files on
the box, exactly like the editor desk. Values are never printed. Every knob
has an environment override so a cron line can change behaviour without a
code change.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent

WORKER = "sales-desk"

# The model each provider drafts on unless SALES_PROPOSAL_MODEL says otherwise.
#
# openai: gpt-5. The drafter follows a long rulebook over a transcript that can
# run past 60,000 tokens and returns a 20,000 character JSON document with every
# figure copied out exactly; that is reasoning-model work, and the original ran
# on the strongest model its proxy had (Claude Opus). gpt-4.1 is what the box's
# key already writes captions with, and is the fallback to set by hand if
# `desk.py doctor` says gpt-5 is not on the key.
# anthropic: claude-opus-5, the current Opus. The key is empty on the VPS today.
# openrouter: the same OpenAI model through OpenRouter's router.
DEFAULT_MODELS = {
    "openai": "gpt-5",
    "anthropic": "claude-opus-5",
    "openrouter": "openai/gpt-5",
}
PROVIDERS = tuple(DEFAULT_MODELS)

# A request is tried four times, then parked as failed with its reason.
MAX_ATTEMPTS = 4


def _key_files() -> tuple[str, ...]:
    home = Path.home()
    return (
        os.environ.get("SALES_KEY_FILE", ""),
        str(home / ".sales-desk" / "env"),
        str(home / ".editor-desk" / "env"),
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
    if os.environ.get("SALES_NO_KEY_FILES"):
        return default
    if _file_keys is None:
        merged: dict[str, str] = {}
        for path in _key_files():
            if path and os.path.exists(path):
                for k, v in _parse_env_file(path).items():
                    merged.setdefault(k, v)
        _file_keys = merged
    return _file_keys.get(name, default)


def reset_keys() -> None:
    """Forget the key files read so far. Tests only."""
    global _file_keys
    _file_keys = None


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
    out_dir: Path
    reference_dir: Path

    supabase_url: str = ""
    supabase_key: str = ""
    bucket: str = "sales-proposals"

    provider: str = "openai"
    model: str = DEFAULT_MODELS["openai"]
    # Per attempt, and the longest the answer may stay silent, not a budget
    # for the whole answer: a draft legitimately takes six to eleven minutes.
    model_timeout: float = 900.0
    model_attempts: int = 3
    max_tokens: Optional[int] = None
    reasoning_effort: str = ""

    tighten_rounds: int = 3
    # Rounds that hand the checker's fixable findings back to the drafter.
    repair_rounds: int = 1
    render_timeout: int = 120
    requests_per_run: int = 3
    stuck_minutes: int = 30
    recordings_days: int = 14
    min_transcript_chars: int = 5000
    fathom_pace: float = 1.1

    @staticmethod
    def from_env() -> "Config":
        home = Path(key("SALES_DESK_HOME", str(Path.home() / ".sales-desk"))).expanduser()
        provider = key("SALES_MODEL_PROVIDER", "openai").strip().lower() or "openai"
        max_tokens = key("SALES_MAX_TOKENS", "").strip()
        return Config(
            home=home,
            out_dir=Path(key("SALES_DESK_OUT", str(home / "out"))).expanduser(),
            reference_dir=Path(key("SALES_REFERENCE_DIR", str(home / "reference"))).expanduser(),
            supabase_url=key("DESK_SUPABASE_URL") or key("RADAR_SUPABASE_URL", ""),
            supabase_key=key("DESK_SUPABASE_KEY") or key("RADAR_SUPABASE_KEY", ""),
            bucket=key("SALES_BUCKET", "sales-proposals"),
            provider=provider,
            model=key("SALES_PROPOSAL_MODEL", "").strip() or DEFAULT_MODELS.get(provider, ""),
            model_timeout=_float("SALES_MODEL_TIMEOUT", 900.0),
            model_attempts=max(1, _int("SALES_MODEL_ATTEMPTS", 3)),
            max_tokens=int(max_tokens) if max_tokens.isdigit() else None,
            reasoning_effort=key("SALES_REASONING_EFFORT", "").strip().lower(),
            tighten_rounds=max(0, _int("SALES_TIGHTEN_ROUNDS", 3)),
            repair_rounds=max(0, _int("SALES_REPAIR_ROUNDS", 1)),
            render_timeout=_int("SALES_RENDER_TIMEOUT", _int("PROPOSAL_RENDER_TIMEOUT", 120)),
            requests_per_run=max(1, _int("SALES_REQUESTS_PER_RUN", 3)),
            stuck_minutes=max(5, _int("SALES_STUCK_MINUTES", 30)),
            recordings_days=max(1, _int("SALES_RECORDINGS_DAYS", 14)),
            min_transcript_chars=max(0, _int("SALES_MIN_TRANSCRIPT_CHARS", 5000)),
            fathom_pace=max(0.0, _float("SALES_FATHOM_PACE", 1.1)),
        )

    # Secrets are looked up lazily so a missing one only fails its own step.
    @property
    def fathom_key(self) -> str:
        return key("FATHOM_API_KEY")

    @property
    def openai_key(self) -> str:
        return key("OPENAI_API_KEY")

    @property
    def anthropic_key(self) -> str:
        return key("ANTHROPIC_API_KEY")

    @property
    def openrouter_key(self) -> str:
        return key("OPENROUTER_API_KEY")

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_key)

    def ensure_dirs(self) -> None:
        """The working files are a client's call and figures: owner only."""
        for p in (self.home, self.out_dir):
            p.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.out_dir, 0o700)
        except OSError:
            pass
