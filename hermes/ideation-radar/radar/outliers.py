"""The outlier rule, in one place.

Locked by Aziz (2026-05-15): baseline is the trimmed median of an account's
recent posts; a post at 3x to 5x the baseline is worth studying, 5x and above
is reverse engineered immediately, below 3x is noise. This module adds the
two things a scheduled scan needs on top of that rule: an age gate, because
a post published a few hours ago has not collected its views yet, and a tiny
account guard, because a 700x multiplier on a 250 follower account proves
packaging, not audience.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from .models import Baseline, Candidate, Post


def parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    v = value.strip()
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        try:
            dt = datetime.fromtimestamp(float(v), tz=timezone.utc)
        except (ValueError, OSError):
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def trimmed_median(values: Iterable[float], trim: float = 0.1) -> Optional[float]:
    """Median after dropping the top and bottom `trim` share of the values.

    With five or more values at least one value is dropped on each side so
    one viral post never drags the baseline up. With fewer than three values
    nothing is dropped.
    """
    vals = sorted(float(v) for v in values if v is not None)
    n = len(vals)
    if n == 0:
        return None
    k = int(n * trim)
    if n >= 5 and k == 0:
        k = 1
    core = vals[k : n - k] if n - 2 * k >= 1 else vals
    m = len(core)
    mid = m // 2
    if m % 2 == 1:
        return core[mid]
    return (core[mid - 1] + core[mid]) / 2.0


def age_hours(post: Post, now: datetime) -> Optional[float]:
    dt = parse_iso(post.posted_at)
    if dt is None:
        return None
    return (now - dt).total_seconds() / 3600.0


def eligible_for_baseline(post: Post, now: datetime, min_age_hours: int) -> bool:
    if post.views is None or post.views < 0:
        return False
    if post.is_pinned:
        return False
    age = age_hours(post, now)
    if age is None:
        return True  # no date: keep, the count is real
    return age >= min_age_hours


def compute_baseline(
    posts: list[Post],
    *,
    now: datetime,
    sample_size: int = 30,
    trim: float = 0.1,
    min_n: int = 5,
    min_age_hours: int = 48,
) -> Optional[Baseline]:
    """The account's normal from its most recent eligible posts."""
    dated = sorted(
        posts,
        key=lambda p: parse_iso(p.posted_at) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    pool = [p for p in dated if eligible_for_baseline(p, now, min_age_hours)][:sample_size]
    if len(pool) < min_n:
        return None
    med = trimmed_median([p.views for p in pool], trim)
    if med is None or med <= 0:
        return None
    return Baseline(median=med, n=len(pool), computed_at=iso(now), trim=trim, min_age_hours=min_age_hours)


def tier_for(multiplier: float, threshold: float = 3.0, reverse_threshold: float = 5.0) -> str:
    if multiplier >= reverse_threshold:
        return "reverse_engineer"
    if multiplier >= threshold:
        return "study"
    return "noise"


def engagement_rate(post: Post) -> Optional[float]:
    if not post.views:
        return None
    total = sum(v or 0 for v in (post.likes, post.comments, post.shares, post.saves))
    return total / float(post.views)


def score(post: Post, base: Baseline) -> tuple[float, Optional[float]]:
    views = float(post.views or 0)
    return (views / base.median if base.median > 0 else 0.0), engagement_rate(post)


def find_candidates(
    posts: list[Post],
    base: Baseline,
    *,
    now: datetime,
    target_key: str,
    industry: str,
    tags: Optional[list[str]] = None,
    threshold: float = 3.0,
    reverse_threshold: float = 5.0,
    window_days: int = 30,
    min_age_hours: int = 48,
    min_followers: int = 2000,
) -> list[Candidate]:
    """Posts in the window, old enough to judge, at or above the threshold."""
    out: list[Candidate] = []
    scanned = iso(now)
    for p in posts:
        if p.views is None:
            continue
        age = age_hours(p, now)
        if age is not None and (age < min_age_hours or age > window_days * 24):
            continue
        mult, er = score(p, base)
        if mult < threshold:
            continue
        out.append(
            Candidate(
                post=p,
                baseline=base,
                multiplier=mult,
                tier=tier_for(mult, threshold, reverse_threshold),
                engagement_rate=er,
                packaging_only=(p.author_followers is not None and p.author_followers < min_followers),
                target_key=target_key,
                industry=industry,
                scanned_at=scanned,
                tags=list(tags or []),
            )
        )
    out.sort(key=lambda c: c.multiplier, reverse=True)
    return out


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def days_ago(n: int, now: Optional[datetime] = None) -> datetime:
    return (now or utcnow()) - timedelta(days=n)
