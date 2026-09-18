"""One scheduled scan over the watchlist.

For every account: fetch its recent posts through Apify, compute the
trimmed-median baseline, flag posts at or above the threshold, remember
everything in state, hand new proposals to the sinks. For every hashtag:
fetch the hashtag's recent posts, then baseline only the few authors whose
posts look like outliers, because every profile fetch costs a run.

Failure rules: an empty or failed fetch never erases a baseline; a fetch
that returns far fewer posts than last time is reported; the scan finishes
every target it can and reports the rest.
"""
from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from . import http
from .apify import Apify, ApifyError, RunResult
from .config import Config
from .models import Baseline, Candidate, Post, Target
from .outliers import compute_baseline, find_candidates, iso, parse_iso, utcnow
from .platforms import PlatformError, adapter_for
from .sinks import BridgeSink, JsonlSink, SlackSink, deliver
from .state import State
from .stills import attach_stills
from .supabase import Supabase
from .trends import detect as detect_trends
from .trends import digest_lines as trend_lines
from .watchlist import load as load_watchlist

FOLLOWERS_TTL_DAYS = 7


@dataclass
class ScanReport:
    at: str
    targets: int = 0
    scanned: int = 0
    failed: int = 0
    skipped: int = 0
    posts: int = 0
    candidates_total: int = 0
    candidates_new: int = 0
    apify_runs: int = 0
    usage_usd: float = 0.0
    duration_sec: float = 0.0
    dry_run: bool = False
    warnings: list[str] = field(default_factory=list)
    per_target: list[dict[str, Any]] = field(default_factory=list)
    new_candidates: list[dict[str, Any]] = field(default_factory=list)
    sinks: dict[str, str] = field(default_factory=dict)
    trends: Optional[dict[str, Any]] = None
    watch_added: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "at": self.at, "targets": self.targets, "scanned": self.scanned, "failed": self.failed,
            "skipped": self.skipped, "posts": self.posts, "candidates_total": self.candidates_total,
            "candidates_new": self.candidates_new, "apify_runs": self.apify_runs,
            "usage_usd": round(self.usage_usd, 4), "duration_sec": round(self.duration_sec, 1),
            "dry_run": self.dry_run, "warnings": self.warnings[:40], "sinks": self.sinks,
            "per_target": self.per_target, "new_candidates": self.new_candidates,
            "trends": [{k: v for k, v in t.items() if k != "keys"} for t in (self.trends or {}).get("trends", [])],
            "watch_added": self.watch_added,
        }


def _followers_stale(state: State, key: str, now: datetime) -> bool:
    row = state.data["accounts"].get(key) or {}
    if row.get("followers") is None:
        return True
    at = parse_iso(row.get("followers_at"))
    return at is None or (now - at) > timedelta(days=FOLLOWERS_TTL_DAYS)


def run_scan(
    cfg: Config,
    log: Callable[[str], None],
    *,
    dry_run: bool = False,
    platforms: Optional[list[str]] = None,
    only: Optional[list[str]] = None,
    now: Optional[datetime] = None,
    apify: Optional[Apify] = None,
    state: Optional[State] = None,
    targets: Optional[list[Target]] = None,
) -> ScanReport:
    now = now or utcnow()
    started = time.monotonic()
    report = ScanReport(at=iso(now), dry_run=dry_run)
    cfg.ensure_dirs()
    state = state or State.load(cfg.state_path)
    sb: Optional[Supabase] = Supabase(cfg.supabase_url, cfg.supabase_key, table=cfg.supabase_table, bucket=cfg.supabase_bucket) if cfg.use_supabase_sink else None
    if targets is not None:
        all_targets = targets
    elif sb is not None and cfg.watchlist_from_supabase:
        try:
            all_targets = sb.load_watchlist()
            log(f"watchlist from Supabase: {len(all_targets)} targets")
        except Exception as e:  # noqa: BLE001 - fall back to the file, say so
            report.warnings.append(f"could not read the Supabase watchlist ({http.scrub(str(e))[:120]}); using the file")
            all_targets = load_watchlist(cfg.watchlist_path)
    else:
        all_targets = load_watchlist(cfg.watchlist_path)
    wanted = [t for t in all_targets if t.active and (not platforms or t.platform in platforms) and (not only or t.value.lower() in [o.lower().lstrip("@#") for o in only])]
    report.targets = len(wanted)
    if not wanted:
        report.warnings.append("watchlist is empty or nothing matched the filter")
        return _finish(cfg, log, report, state, started, dry_run)
    try:
        apify = apify or Apify(cfg.apify_token, base=cfg.apify_base, timeout_sec=cfg.apify_timeout_sec, max_runs=cfg.apify_max_runs_per_scan, log=log)
    except ApifyError as e:
        report.warnings.append(str(e))
        report.failed = len(wanted)
        return _finish(cfg, log, report, state, started, dry_run)

    # ---- build jobs grouped by actor --------------------------------------
    jobs: dict[str, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    job_target: dict[str, Target] = {}
    job_role: dict[str, str] = {}
    for t in wanted:
        try:
            ad = adapter_for(t.platform, cfg)
            if t.kind == "hashtag":
                actor, inp = ad.hashtag_job(t.value, cfg.sample_size)
                label = f"{t.key}#posts"
            elif t.kind == "search":
                if not hasattr(ad, "search_job"):
                    raise PlatformError(f"keyword search is not wired for {t.platform}")
                actor, inp = ad.search_job(t.value, cfg.search_limit)
                label = f"{t.key}#posts"
            else:
                actor, inp = ad.profile_job(t.value, cfg.sample_size)
                label = f"{t.key}#posts"
                if _followers_stale(state, t.key, now):
                    dj = ad.details_job(t.value)
                    if dj:
                        jobs[dj[0]].append((f"{t.key}#details", dj[1]))
                        job_target[f"{t.key}#details"] = t
                        job_role[f"{t.key}#details"] = "details"
            jobs[actor].append((label, inp))
            job_target[label] = t
            job_role[label] = "posts"
        except PlatformError as e:
            report.skipped += 1
            report.warnings.append(f"{t.key}: skipped ({e})")
            report.per_target.append({"target": t.key, "status": "skipped", "reason": str(e)})

    results: dict[str, RunResult] = {}
    for actor, actor_jobs in jobs.items():
        for r in apify.run_many(actor, actor_jobs, concurrency=cfg.apify_concurrency):
            results[r.label] = r

    # ---- accounts ------------------------------------------------------------
    new_candidates: list[Candidate] = []
    hashtag_posts: dict[str, list[Post]] = {}
    search_hits: dict[str, list[dict[str, Any]]] = {}
    for t in wanted:
        label = f"{t.key}#posts"
        if label not in results:
            continue
        r = results[label]
        ad = adapter_for(t.platform, cfg)
        entry: dict[str, Any] = {"target": t.key, "run": r.run_id, "usd": round(r.usage_usd, 4)}
        if r.error:
            failures = state.record_failure(t.key, report.at, r.error)
            report.failed += 1
            entry.update({"status": "failed", "error": r.error, "failures": failures})
            report.per_target.append(entry)
            report.warnings.append(f"{t.key}: {r.error}")
            continue
        if t.kind == "search":
            search_hits[t.key] = ad.parse_search(r.items)  # type: ignore[attr-defined]
            entry.update({"status": "ok", "accounts": len(search_hits[t.key])})
            report.per_target.append(entry)
            report.scanned += 1
            continue
        posts = ad.parse_posts(r.items, handle=t.value)
        if t.kind == "hashtag":
            hashtag_posts[t.key] = posts
            entry.update({"status": "ok", "posts": len(posts)})
            report.per_target.append(entry)
            report.scanned += 1
            report.posts += len(posts)
            continue
        if not posts:
            failures = state.record_failure(t.key, report.at, "no posts returned")
            report.failed += 1
            entry.update({"status": "empty", "failures": failures})
            report.per_target.append(entry)
            report.warnings.append(f"{t.key}: no posts returned (baseline kept)")
            continue
        expected = state.expected_posts(t.key)
        if expected and len(posts) < expected * 0.5:
            report.warnings.append(f"{t.key}: only {len(posts)} posts, usually {expected}")
        followers = next((p.author_followers for p in posts if p.author_followers is not None), None)
        dl = f"{t.key}#details"
        if dl in results and results[dl].ok:
            det = ad.parse_details(results[dl].items)
            if det.get("followers") is not None:
                followers = det["followers"]
        acct = state.data["accounts"].setdefault(t.key, {})
        if followers is not None:
            acct["followers"], acct["followers_at"] = followers, report.at
        elif acct.get("followers") is not None:
            followers = acct["followers"]
        for p in posts:
            if p.author_followers is None and followers is not None:
                p.author_followers = followers
            state.remember_post(p, report.at)
        floor = cfg.floor_for(t.platform)
        base = compute_baseline(posts, now=now, sample_size=cfg.sample_size, trim=cfg.trim, min_n=cfg.min_baseline_n, min_age_hours=cfg.baseline_min_age_hours, floor=floor, is_video=True)
        if base is None:
            old = state.baseline(t.key)
            entry.update({"status": "no_baseline", "posts": len(posts)})
            report.per_target.append(entry)
            report.warnings.append(f"{t.key}: fewer than {cfg.min_baseline_n} settled posts for a baseline" + (" (previous one kept)" if old else ""))
            report.scanned += 1
            report.posts += len(posts)
            continue
        state.set_baseline(t.key, base, followers, len(posts))
        cands = find_candidates(
            posts, now=now, target_key=t.key, industry=t.industry, tags=t.tags,
            threshold=cfg.threshold, reverse_threshold=cfg.reverse_threshold, window_days=cfg.window_days,
            min_age_hours=cfg.min_age_hours, mature_hours=cfg.mature_hours, baseline_min_age_hours=cfg.baseline_min_age_hours,
            sample_size=cfg.sample_size, trim=cfg.trim, min_n=cfg.min_baseline_n, floor=floor,
            min_followers=cfg.min_followers_for_audience, min_engagement=cfg.min_engagement,
        )
        fresh = [c for c in cands if state.propose(c)]
        new_candidates.extend(fresh)
        report.scanned += 1
        report.posts += len(posts)
        report.candidates_total += len(cands)
        entry.update({"status": "ok", "posts": len(posts), "baseline": round(base.median), "baseline_n": base.n, "baseline_floored": base.floored, "candidates": len(cands), "new": len(fresh), "followers": followers})
        report.per_target.append(entry)

    # ---- hashtags: baseline only the promising authors -------------------------
    if hashtag_posts:
        new_candidates.extend(_score_hashtags(cfg, log, apify, state, hashtag_posts, wanted, now, report))
    # ---- keyword searches: the promising accounts, then they watch themselves --
    if search_hits:
        new_candidates.extend(_score_search(cfg, log, apify, state, search_hits, wanted, now, report, sb if not dry_run else None))

    report.candidates_new = len(new_candidates)
    report.apify_runs = apify.runs_started
    report.usage_usd = apify.usage_usd
    report.new_candidates = [c.to_dict() for c in new_candidates]
    if sb is not None and not dry_run and report.new_candidates:
        attach_stills(sb, report.new_candidates, log, max_items=40)
    if sb is not None and not dry_run:
        for entry in report.per_target:
            try:
                sb.mark_target(entry["target"], last_scanned_at=report.at, last_status=entry.get("status"), baseline_views=entry.get("baseline"), baseline_n=entry.get("baseline_n"), followers=entry.get("followers"))
            except Exception as e:  # noqa: BLE001 - bookkeeping only
                log(f"watchlist mark failed for {entry.get('target')}: {e}")
    return _finish(cfg, log, report, state, started, dry_run, sb=sb)


def _score_hashtags(cfg: Config, log: Callable[[str], None], apify: Apify, state: State, hashtag_posts: dict[str, list[Post]], wanted: list[Target], now: datetime, report: ScanReport) -> list[Candidate]:
    out: list[Candidate] = []
    by_key = {t.key: t for t in wanted}
    watched = {(t.platform, t.value.lower()) for t in wanted if t.kind == "account"}
    # A hashtag hit has no baseline of its own. Keep only hits worth a paid
    # author fetch: enough views, one per author, author not already watched
    # (watched accounts are scored on their own row anyway).
    to_fetch: list[tuple[Target, str, str, list[Post]]] = []
    for hkey, posts in hashtag_posts.items():
        t = by_key[hkey]
        by_author: dict[str, list[Post]] = defaultdict(list)
        for p in posts:
            state.remember_post(p, report.at)
            if p.author_handle and _worth_a_fetch(p, cfg) and (t.platform, p.author_handle) not in watched:
                by_author[p.author_handle].append(p)
        ranked = sorted(by_author.items(), key=lambda kv: max((reach_or_views(p) for p in kv[1])), reverse=True)
        for author, aposts in ranked[: cfg.hashtag_top_k]:
            to_fetch.append((t, author, t.platform, aposts))
    to_fetch = to_fetch[: cfg.hashtag_profile_cap]
    if not to_fetch:
        return out
    jobs: dict[str, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    meta: dict[str, tuple[Target, str, list[Post]]] = {}
    for t, author, platform, aposts in to_fetch:
        try:
            ad = adapter_for(platform, cfg)
            actor, inp = ad.profile_job(author, cfg.sample_size)
        except PlatformError as e:
            report.warnings.append(f"#{t.value} author {author}: {e}")
            continue
        label = f"{platform}:account:{author}#viatag"
        jobs[actor].append((label, inp))
        meta[label] = (t, author, aposts)
    for actor, actor_jobs in jobs.items():
        try:
            runs = apify.run_many(actor, actor_jobs, concurrency=cfg.apify_concurrency)
        except ApifyError as e:
            report.warnings.append(f"hashtag author fetch stopped: {e}")
            break
        for r in runs:
            t, author, aposts = meta[r.label]
            if r.error:
                report.warnings.append(f"#{t.value} author {author}: {r.error}")
                continue
            ad = adapter_for(t.platform, cfg)
            posts = ad.parse_posts(r.items, handle=author)
            akey = f"{t.platform}:account:{author}"
            floor = cfg.floor_for(t.platform)
            base = compute_baseline(posts, now=now, sample_size=cfg.sample_size, trim=cfg.trim, min_n=cfg.min_baseline_n, min_age_hours=cfg.baseline_min_age_hours, floor=floor, is_video=True)
            if base is None:
                report.warnings.append(f"#{t.value} author {author}: fewer than {cfg.min_baseline_n} settled posts")
                continue
            followers = next((p.author_followers for p in posts if p.author_followers is not None), None)
            state.set_baseline(akey, base, followers, len(posts))
            for p in posts:
                state.remember_post(p, report.at)
            pool = {p.key: p for p in posts}
            for p in aposts:
                pool.setdefault(p.key, p)
            cands = find_candidates(
                list(pool.values()), now=now, target_key=t.key, industry=t.industry, tags=t.tags + [f"via:#{t.value}"],
                threshold=cfg.threshold, reverse_threshold=cfg.reverse_threshold, window_days=cfg.window_days,
                min_age_hours=cfg.min_age_hours, mature_hours=cfg.mature_hours, baseline_min_age_hours=cfg.baseline_min_age_hours,
                sample_size=cfg.sample_size, trim=cfg.trim, min_n=cfg.min_baseline_n, floor=floor,
                min_followers=cfg.min_followers_for_audience, min_engagement=cfg.min_engagement, pool=list(pool.values()),
            )
            out.extend(c for c in cands if state.propose(c))
    return out


def _score_search(cfg: Config, log: Callable[[str], None], apify: Apify, state: State, hits: dict[str, list[dict[str, Any]]], wanted: list[Target], now: datetime, report: ScanReport, sb: Optional[Supabase]) -> list[Candidate]:
    """Keyword search results: pick public accounts big enough and recently active,
    profile scan them like hashtag authors, and add those with a baseline to the
    watchlist so next week's scan covers them without anyone typing a handle."""
    out: list[Candidate] = []
    by_key = {t.key: t for t in wanted}
    watched = {(t.platform, t.value.lower()) for t in wanted if t.kind == "account"}
    seen: dict[str, str] = state.data.setdefault("search_seen", {})
    retry_before = (now - timedelta(days=cfg.search_retry_days)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    recent_cut = (now - timedelta(days=90)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    to_fetch: list[tuple[Target, str, dict[str, Any]]] = []
    for skey, accounts in hits.items():
        t = by_key[skey]
        ranked: list[tuple[float, dict[str, Any]]] = []
        for a in accounts:
            u = a["username"]
            if a.get("private") or (t.platform, u) in watched:
                continue
            if (a.get("followers") or 0) < cfg.min_followers_for_audience:
                continue
            last = seen.get(f"{t.platform}:{u}")
            if last and last > retry_before:
                continue
            latest = a.get("latest") or []
            recent_video = [p for p in latest if p.is_video and (p.posted_at or "") >= recent_cut]
            if not recent_video:
                continue
            best = max((p.views or 0) for p in recent_video)
            ranked.append((best * 1000.0 + (a.get("followers") or 0), a))
        ranked.sort(key=lambda kv: kv[0], reverse=True)
        for _score, a in ranked[: cfg.search_top_k]:
            to_fetch.append((t, a["username"], a))
        entry = next((e for e in report.per_target if e.get("target") == skey), None)
        if entry is not None:
            entry["candidates_accounts"] = len(ranked)
    to_fetch = to_fetch[: cfg.search_profile_cap]
    if not to_fetch:
        return out
    jobs: dict[str, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    meta: dict[str, tuple[Target, str, dict[str, Any]]] = {}
    for t, user, a in to_fetch:
        try:
            ad = adapter_for(t.platform, cfg)
            actor, inp = ad.profile_job(user, cfg.sample_size)
        except PlatformError as e:
            report.warnings.append(f"search {t.value} account {user}: {e}")
            continue
        label = f"{t.platform}:account:{user}#viasearch"
        jobs[actor].append((label, inp))
        meta[label] = (t, user, a)
        seen[f"{t.platform}:{user}"] = report.at
    for actor, actor_jobs in jobs.items():
        try:
            runs = apify.run_many(actor, actor_jobs, concurrency=cfg.apify_concurrency)
        except ApifyError as e:
            report.warnings.append(f"search account fetch stopped: {e}")
            break
        for r in runs:
            t, user, a = meta[r.label]
            if r.error:
                report.warnings.append(f"search {t.value} account {user}: {r.error}")
                continue
            ad = adapter_for(t.platform, cfg)
            posts = ad.parse_posts(r.items, handle=user)
            followers = a.get("followers") or next((p.author_followers for p in posts if p.author_followers is not None), None)
            for p in posts:
                if p.author_followers is None and followers is not None:
                    p.author_followers = followers
                state.remember_post(p, report.at)
            akey = f"{t.platform}:account:{user}"
            floor = cfg.floor_for(t.platform)
            base = compute_baseline(posts, now=now, sample_size=cfg.sample_size, trim=cfg.trim, min_n=cfg.min_baseline_n, min_age_hours=cfg.baseline_min_age_hours, floor=floor, is_video=True)
            if base is None:
                report.warnings.append(f"search {t.value} account {user}: fewer than {cfg.min_baseline_n} settled posts")
                continue
            state.set_baseline(akey, base, followers, len(posts))
            cands = find_candidates(
                posts, now=now, target_key=t.key, industry=t.industry, tags=t.tags + [f"via:search:{t.value}"],
                threshold=cfg.threshold, reverse_threshold=cfg.reverse_threshold, window_days=cfg.window_days,
                min_age_hours=cfg.min_age_hours, mature_hours=cfg.mature_hours, baseline_min_age_hours=cfg.baseline_min_age_hours,
                sample_size=cfg.sample_size, trim=cfg.trim, min_n=cfg.min_baseline_n, floor=floor,
                min_followers=cfg.min_followers_for_audience, min_engagement=cfg.min_engagement,
            )
            out.extend(c for c in cands if state.propose(c))
            if cfg.search_autowatch:
                target = Target(platform=t.platform, kind="account", value=user, industry=t.industry, tags=[x for x in t.tags if not x.startswith("via:")] + ["via:search"], note=f"found by search '{t.value}' on {report.at[:10]}")
                if sb is not None:
                    try:
                        sb.upsert_watchlist([target], source="search", added_by="radar")
                        sb.mark_target(target.key, last_scanned_at=report.at, last_status="ok", baseline_views=round(base.median), baseline_n=base.n, followers=followers)
                    except Exception as e:  # noqa: BLE001 - the proposals matter more than the bookkeeping
                        report.warnings.append(f"could not add @{user} to the watchlist: {http.scrub(str(e))[:120]}")
                        continue
                report.watch_added.append(f"{t.platform}:{user}")
    return out


def engagement(p: Post) -> int:
    """Likes plus comments: the only public numbers on an Instagram tag page."""
    return max(0, int(p.likes or 0)) + max(0, int(p.comments or 0))  # -1 means hidden


def _worth_a_fetch(p: Post, cfg: Config) -> bool:
    """Is this hashtag hit worth a paid author fetch?

    With a view count: views must clear ``hashtag_min_views``. Without one
    (Instagram hides reel plays on tag pages from a logged-out fetch): likes
    plus comments must clear ``hashtag_min_engagement``. The author's profile
    scan then supplies real view counts, so the outlier rule itself is untouched.
    """
    if p.views is not None:
        return p.views >= cfg.hashtag_min_views
    return engagement(p) >= cfg.hashtag_min_engagement


def reach_or_views(p: Post) -> float:
    """Rank hashtag hits by reach (views over followers) when followers are known,
    else by views, else by likes plus comments when the platform hides views."""
    if p.views and p.author_followers:
        return p.views / float(p.author_followers) * 1e6
    if p.views is not None:
        return float(p.views)
    return float(engagement(p))


def digest_text(report: ScanReport) -> str:
    head = f"Ideation radar {report.at[:10]}: {report.scanned} of {report.targets} targets scanned"
    if report.failed:
        head += f", {report.failed} failed"
    if report.skipped:
        head += f", {report.skipped} skipped"
    tiers = defaultdict(int)
    for c in report.new_candidates:
        tiers[c.get("tier", "")] += 1
    head += f". {report.candidates_new} new outliers ({tiers['reverse_engineer']} to reverse engineer, {tiers['study']} to study)."
    lines = [head]
    for c in sorted(report.new_candidates, key=lambda x: x.get("multiplier", 0), reverse=True)[:8]:
        views = c.get("views")
        vtxt = f"{views:,}" if isinstance(views, int) else "?"
        flag = " (tiny account)" if c.get("packaging_only") else ""
        prov = " (provisional)" if c.get("provisional") else ""
        lines.append(f"- {c.get('multiplier')}x @{c.get('author_handle')} on {c.get('platform')}: {vtxt} views{flag}{prov} {c.get('url')}")
    lines += trend_lines(report.trends)
    if report.watch_added:
        handles = ", ".join("@" + a.split(":", 1)[1] for a in report.watch_added[:8])
        lines.append(f"Found by keyword search and now watched: {handles}" + (f" and {len(report.watch_added) - 8} more" if len(report.watch_added) > 8 else "") + ".")
    if report.warnings:
        lines.append(f"Warnings: {len(report.warnings)} (see the log).")
    lines.append(f"Apify: {report.apify_runs} runs, ${report.usage_usd:.2f}.")
    if report.dry_run:
        lines.append("Dry run: nothing was written to the cockpit.")
    return "\n".join(lines)


def _finish(cfg: Config, log: Callable[[str], None], report: ScanReport, state: State, started: float, dry_run: bool, sb: Optional[Supabase] = None) -> ScanReport:
    report.duration_sec = time.monotonic() - started
    jsonl = JsonlSink(cfg.out_dir / ("dry" if dry_run else ""))
    sinks: list[tuple[str, Callable[[], Any]]] = []
    rows = report.new_candidates
    sinks.append(("jsonl", lambda: (jsonl.write_candidates(rows) if rows else None, jsonl.write_latest({"scan": report.to_dict()}))))
    if not dry_run:
        if sb is not None and rows:
            sinks.append(("supabase", lambda: sb.store_candidates(rows)))
        if cfg.use_cockpit_sink and rows:
            sinks.append(("cockpit", lambda: BridgeSink(cfg.bridge_url, cfg.bridge_token).store_candidates(rows)))
    report.sinks = deliver(sinks, log)
    if sb is not None and not dry_run:
        # After the rows are stored: the same format on several accounts becomes a trend.
        try:
            report.trends = detect_trends(cfg, sb, log)
            report.sinks["trends"] = "ok" if not report.trends.get("errors") else f"{len(report.trends['errors'])} errors"
        except Exception as e:  # noqa: BLE001 - trends are a bonus on top of the scan
            report.sinks["trends"] = f"failed: {http.scrub(str(e))[:200]}"
            log(f"trends failed: {e}")
    if not dry_run and cfg.slack_token and cfg.slack_channel:
        report.sinks.update(deliver([("slack", lambda: SlackSink(cfg.slack_token, cfg.slack_channel).post(digest_text(report)))], log))
    if sb is not None and not dry_run:
        try:
            sb.log_scan(report.to_dict())
        except Exception as e:  # noqa: BLE001 - the log line is not worth failing the scan
            log(f"scan log to Supabase failed: {e}")
    record = report.to_dict()
    record.pop("per_target", None)
    record.pop("new_candidates", None)
    state.add_scan(record)
    if not dry_run:
        state.prune()
        state.save()
    else:
        # Even a dry run must not lose the view history it collected? No: a dry
        # run leaves state untouched so a real run proposes the same posts.
        pass
    log(f"scan done: {report.scanned}/{report.targets} ok, {report.candidates_new} new, {report.apify_runs} runs, ${report.usage_usd:.3f}, {report.duration_sec:.0f}s")
    return report
