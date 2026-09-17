"""Data shapes shared by the scanner, the capture command and the sinks.

Every record is a plain dataclass with a to_dict() so the JSONL sink, the
cockpit bridge and the Supabase sink all receive the same keys. Field names
follow the cockpits' winnersArchive vocabulary where the meaning is the same
(hook, transcript, voice, format, language, savedBy) so a saved idea can sit
next to a winning ad in the same UI grammar.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Optional

PLATFORMS = ("instagram", "tiktok", "snapchat")
TIERS = ("noise", "study", "reverse_engineer")


@dataclass
class Target:
    """One watchlist entry: an account or a hashtag on one platform."""

    platform: str
    kind: str  # "account" | "hashtag"
    value: str  # handle without @, or hashtag without #
    industry: str = "other"  # "ours" (construction and design) | "other"
    tags: list[str] = field(default_factory=list)
    active: bool = True
    note: str = ""

    @property
    def key(self) -> str:
        return f"{self.platform}:{self.kind}:{self.value.lower()}"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Target":
        return Target(
            platform=str(d["platform"]).lower(),
            kind=str(d.get("kind", "account")).lower(),
            value=str(d["value"]).lstrip("@#").strip(),
            industry=str(d.get("industry", "other")),
            tags=list(d.get("tags", [])),
            active=bool(d.get("active", True)),
            note=str(d.get("note", "")),
        )


@dataclass
class Post:
    """One post as returned by a platform adapter, normalised."""

    platform: str
    post_id: str
    url: str
    author_handle: str
    author_name: str = ""
    author_followers: Optional[int] = None
    posted_at: Optional[str] = None  # ISO 8601 UTC
    views: Optional[int] = None
    likes: Optional[int] = None
    comments: Optional[int] = None
    shares: Optional[int] = None
    saves: Optional[int] = None
    caption: str = ""
    duration_sec: Optional[float] = None
    media_url: Optional[str] = None  # direct video URL, usually short lived
    thumb_url: Optional[str] = None
    is_pinned: bool = False
    is_video: bool = True
    fetched_at: Optional[str] = None
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def key(self) -> str:
        return f"{self.platform}:{self.post_id}"

    def to_dict(self, with_raw: bool = False) -> dict[str, Any]:
        d = asdict(self)
        if not with_raw:
            d.pop("raw", None)
        return d


@dataclass
class Baseline:
    """An account's normal: the trimmed median of views over its recent posts."""

    median: float
    n: int
    computed_at: str
    method: str = "trimmed_median"
    trim: float = 0.1
    min_age_hours: int = 48

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Candidate:
    """A post that scored above the outlier threshold for its account."""

    post: Post
    baseline: Baseline
    multiplier: float
    tier: str
    engagement_rate: Optional[float]
    packaging_only: bool
    target_key: str
    industry: str
    scanned_at: str
    tags: list[str] = field(default_factory=list)

    @property
    def key(self) -> str:
        return self.post.key

    def to_dict(self) -> dict[str, Any]:
        d = self.post.to_dict()
        d.update(
            {
                "key": self.key,
                "origin": "scan",
                "status": "proposed",
                "target_key": self.target_key,
                "industry": self.industry,
                "tags": list(self.tags),
                "baseline_views": self.baseline.median,
                "baseline_n": self.baseline.n,
                "baseline_method": self.baseline.method,
                "multiplier": round(self.multiplier, 2),
                "tier": self.tier,
                "engagement_rate": None
                if self.engagement_rate is None
                else round(self.engagement_rate, 4),
                "packaging_only": self.packaging_only,
                "scanned_at": self.scanned_at,
            }
        )
        return d


@dataclass
class Idea:
    """A captured post: metadata plus the transcript and the breakdown."""

    key: str
    platform: str
    post_id: str
    url: str
    origin: str  # "manual" | "scan"
    status: str  # "captured" | "failed"
    captured_at: str
    author_handle: str = ""
    author_name: str = ""
    author_followers: Optional[int] = None
    posted_at: Optional[str] = None
    views: Optional[int] = None
    likes: Optional[int] = None
    comments: Optional[int] = None
    shares: Optional[int] = None
    saves: Optional[int] = None
    caption: str = ""
    duration_sec: Optional[float] = None
    thumb_url: Optional[str] = None
    media_url: Optional[str] = None
    industry: str = "other"
    tags: list[str] = field(default_factory=list)
    saved_by: str = ""
    note: str = ""
    # Understanding
    language: Optional[str] = None  # ar | en | mixed | none
    dialect: Optional[str] = None
    has_speech: Optional[bool] = None
    voice: Optional[str] = None  # voiceover | text on screen | both | silent
    transcript: str = ""
    on_screen_text: list[dict[str, Any]] = field(default_factory=list)
    format: Optional[str] = None
    hook: Optional[dict[str, Any]] = None
    beats: list[dict[str, Any]] = field(default_factory=list)
    cta: Optional[str] = None
    why_it_works: str = ""
    transferable: str = ""
    adaptations: list[str] = field(default_factory=list)
    music: Optional[str] = None
    method: dict[str, Any] = field(default_factory=dict)
    confidence: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    multiplier: Optional[float] = None
    tier: Optional[str] = None
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
