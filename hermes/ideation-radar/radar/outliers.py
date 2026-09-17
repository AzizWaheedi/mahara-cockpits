"""The outlier rule, in one place.

Locked by Aziz (2026-05-15): a post at 3x to 5x the account's baseline is
worth studying, 5x and above is reverse engineered immediately, below 3x is
noise. The baseline is the median of the account's recent posts after the
exclusions below; a symmetric percentage trim never moves a median, so
"trimmed median" means the median after these rules, and the rules are
recorded with every baseline:

- the candidate post itself is left out (leave-one-out, as 1of10 does);
- pinned posts are left out (old favourites);
- posts younger than seven days are left out of the baseline (their counts
  are still growing);
- only posts of the same kind count (video against video);
- at least eight eligible posts, else no tier; eight to fourteen is "low"
  confidence, fifteen or more "ok";
- the baseline is floored per platform (1,000 views on Instagram and TikTok,
  300 on Snapchat, configurable), so a 300-view account does not produce a
  10x from one 3,000-view post; a floored baseline says so.

Age: nothing under 24 hours is scored. A score before day seven is
provisional (checkpoint 24h or 72h); day seven locks it; a 30-day checkpoint
catches TikTok late bloomers. Two secondary numbers travel with every
candidate so a tiny account cannot outrank a big one: the engagement rate by
views and a robust z-score (median and MAD on log views, NIST). A post is
proposed only when its tier is study or better and it clears either the
views gate (three times the floor) or the engagement gate.

References checked 2026-09-17: 1of10, ViewStats, vidIQ, OutlierKit, Handler,
datascoutlab; NIST handbook 1.3.5.17 (modified z-score).
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from .models import Baseline, Candidate, Post

DAY_H = 24
WEEK_H = 168
MONTH_H = 720


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

    Kept for the report and for robustness when a caller passes an
    unfiltered list; with the exclusion rules applied it equals the median.
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


def eligible_for_baseline(post: Post, now: datetime, min_age_hours: int, is_video: Optional[bool] = None) -> bool:
    if post.views is None or post.views < 0:
        return False
    if post.is_pinned:
        return False
    if is_video is not None and post.is_video != is_video:
        return False
    age = age_hours(post, now)
    if age is None:
        return True  # undated: the count is real, keep it
    return age >= min_age_hours


def baseline_pool(
    posts: list[Post],
    *,
    now: datetime,
    sample_size: int = 30,
    min_age_hours: int = WEEK_H,
    is_video: Optional[bool] = None,
    exclude_key: Optional[str] = None,
) -> list[Post]:
    dated = sorted(
        posts,
        key=lambda p: parse_iso(p.posted_at) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return [
        p
        for p in dated
        if p.key != exclude_key and eligible_for_baseline(p, now, min_age_hours, is_video)
    ][:sample_size]


def compute_baseline(
    posts: list[Post],
    *,
    now: datetime,
    sample_size: int = 30,
    trim: float = 0.1,
    min_n: int = 8,
    min_age_hours: int = WEEK_H,
    floor: float = 0.0,
    is_video: Optional[bool] = None,
    exclude_key: Optional[str] = None,
) -> Optional[Baseline]:
    """The account's normal from its recent eligible posts, floored per platform."""
    pool = baseline_pool(posts, now=now, sample_size=sample_size, min_age_hours=min_age_hours, is_video=is_video, exclude_key=exclude_key)
    if len(pool) < min_n:
        return None
    raw = trimmed_median([p.views for p in pool], trim)
    if raw is None or raw < 0:
        return None
    floored = floor > 0 and raw < floor
    value = max(raw, floor) if floor > 0 else raw
    if value <= 0:
        return None
    rules = ["leave_one_out", "no_pinned", f"age>={min_age_hours}h", "same_kind"]
    if floor > 0:
        rules.append(f"floor={int(floor)}")
    return Baseline(
        median=value,
        n=len(pool),
        computed_at=iso(now),
        method="median_after_rules_v1",
        trim=trim,
        min_age_hours=min_age_hours,
        raw_median=raw,
        floored=floored,
        confidence="ok" if len(pool) >= 15 else "low",
        rules=rules,
    )


def robust_z(views: float, pool_views: Iterable[float]) -> Optional[float]:
    """NIST modified z-score on log views: 0.6745 * (x - median) / MAD, MAD floored at a small value."""
    logs = sorted(math.log1p(max(0.0, float(v))) for v in pool_views if v is not None)
    if len(logs) < 5:
        return None
    med = trimmed_median(logs, 0.0)
    if med is None:
        return None
    mad = trimmed_median([abs(x - med) for x in logs], 0.0) or 0.0
    mad = max(mad, 0.05)
    return round(0.6745 * (math.log1p(max(0.0, views)) - med) / mad, 2)


def tier_for(multiplier: float, threshold: float = 3.0, reverse_threshold: float = 5.0) -> str:
    if multiplier >= reverse_threshold:
        return "reverse_engineer"
    if multiplier >= threshold:
        return "study"
    return "noise"


def checkpoint_for(age_h: Optional[float]) -> str:
    if age_h is None:
        return "undated"
    if age_h < 72:
        return "24h"
    if age_h < WEEK_H:
        return "72h"
    if age_h < MONTH_H:
        return "7d"
    return "30d"


def engagement_rate(post: Post) -> Optional[float]:
    if not post.views:
        return None
    total = sum(v or 0 for v in (post.likes, post.comments, post.shares, post.saves))
    return total / float(post.views)


def reach_rate(post: Post) -> Optional[float]:
    if not post.views or not post.author_followers:
        return None
    return post.views / float(post.author_followers)


def score(post: Post, base: Baseline) -> tuple[float, Optional[float]]:
    views = float(post.views or 0)
    return (views / base.median if base.median > 0 else 0.0), engagement_rate(post)


def find_candidates(
    posts: list[Post],
    *,
    now: datetime,
    target_key: str,
    industry: str,
    tags: Optional[list[str]] = None,
    threshold: float = 3.0,
    reverse_threshold: float = 5.0,
    window_days: int = 30,
    min_age_hours: int = DAY_H,
    mature_hours: int = WEEK_H,
    baseline_min_age_hours: int = WEEK_H,
    sample_size: int = 30,
    trim: float = 0.1,
    min_n: int = 8,
    floor: float = 0.0,
    min_followers: int = 2000,
    min_engagement: float = 0.02,
    pool: Optional[list[Post]] = None,
) -> list[Candidate]:
    """Posts in the window, old enough to judge, at or above the threshold, past the gate.

    `pool` is the account's posts the baseline is built from; by default the
    same list as `posts` (a hashtag hit passes the author's own posts here).
    """
    source = pool if pool is not None else posts
    out: list[Candidate] = []
    scanned = iso(now)
    for p in posts:
        if p.views is None or p.views <= 0:
            continue
        age = age_hours(p, now)
        if age is not None and (age < min_age_hours or age > window_days * 24):
            continue
        base = compute_baseline(
            source, now=now, sample_size=sample_size, trim=trim, min_n=min_n,
            min_age_hours=baseline_min_age_hours, floor=floor, is_video=p.is_video, exclude_key=p.key,
        )
        if base is None:
            continue
        mult, er = score(p, base)
        if mult < threshold:
            continue
        views_gate = floor <= 0 or p.views >= 3 * floor
        engagement_gate = er is not None and er >= min_engagement
        if not (views_gate or engagement_gate):
            continue
        pool_posts = baseline_pool(source, now=now, sample_size=sample_size, min_age_hours=baseline_min_age_hours, is_video=p.is_video, exclude_key=p.key)
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
                provisional=(age is None) or age < mature_hours,
                checkpoint=checkpoint_for(age),
                robust_z=robust_z(float(p.views), [q.views for q in pool_posts if q.views is not None]),
                reach_rate=reach_rate(p),
            )
        )
    out.sort(key=lambda c: (c.tier == "reverse_engineer", c.reach_rate or 0.0, c.multiplier), reverse=True)
    return out


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def days_ago(n: int, now: Optional[datetime] = None) -> datetime:
    return (now or utcnow()) - timedelta(days=n)
