"""The Foreplay swipe file, mirrored into our own store.

Aziz picked Foreplay on 2026-09-19. Their public API is real and entirely
read-only: 22 endpoints, all GET, bearer auth, and an MCP endpoint at
`/mcp` for assistants. Saving happens in their Chrome extension or by
pointing Spyder at a brand's Ad Library page; nothing can be pushed in.

So the shape of the integration is: they hold the swipe file, we hold a copy.
Mirroring rather than calling live buys three things. The cockpit needs no
Foreplay key in the browser. The board still reads when Foreplay is down or
the subscription lapses. And MagicBrief, which was bigger and funded, shut
down eight weeks ago without saying what happened to customers' libraries.

Two fields here are worth more than the rest. `running_duration` is how many
days an ad has been on air, which is the strongest single signal that it is
working, and `timestamped_transcription` is what was said and when, which is
what a script is actually built from.

**The API is metered: one ad returned is one credit, and the plan includes
10,000 a month (20,000 on annual).** So this never re-reads the library. It
asks for the most recently saved ads first and stops the moment a page holds
nothing new, which on a normal week costs a handful of credits rather than
the whole allowance. It also reads the remaining balance first and refuses to
start when it is nearly gone, because running out silently would take the
board down rather than the sync.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

from . import http
from .config import Config

BASE = "https://public.api.foreplay.co"
MCP = f"{BASE}/mcp"


class Foreplay:
    def __init__(self, cfg: Config, log: Optional[Callable[[str], None]] = None):
        if not cfg.foreplay_key:
            raise http.HttpError(0, "FOREPLAY_API_KEY is not set")
        self.cfg = cfg
        self.log = log or (lambda m: None)
        self.calls = 0

    def _h(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.cfg.foreplay_key}", "Accept": "application/json"}

    def get(self, path: str, **params: Any) -> dict[str, Any]:
        self.calls += 1
        q = http.encode_query({k: v for k, v in params.items() if v not in (None, "")})
        out = http.get_json(f"{BASE}{path}?{q}", headers=self._h(), timeout=60)
        return out if isinstance(out, dict) else {}

    def usage(self) -> dict[str, Any]:
        """Credits left. Reading this is free and tells us whether to start."""
        out = self.get("/api/usage")
        return out.get("data") if isinstance(out.get("data"), dict) else out

    def boards(self, limit: int = 100) -> list[dict[str, Any]]:
        out = self.get("/api/boards", limit=limit)
        return [b for b in (out.get("data") or out.get("boards") or []) if isinstance(b, dict)]

    def board_ads(self, board_id: str, *, limit: int = 100, cursor: str = "") -> dict[str, Any]:
        return self.get("/api/board/ads", board_id=board_id, limit=limit, cursor=cursor)

    def swipefile(self, *, limit: int = 100, offset: int = 0, **filters: Any) -> dict[str, Any]:
        return self.get("/api/swipefile/ads", limit=limit, offset=offset, **filters)


def _list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def row(ad: dict[str, Any], *, board_id: str = "", board_name: str = "") -> Optional[dict[str, Any]]:
    """One Foreplay ad as a `foreplay_ads` row.

    Their schema marks almost every field as "anyOf", meaning any of them can
    be null, so nothing here assumes a field is present. Only `id` is
    load-bearing.
    """
    ident = str(ad.get("id") or "").strip()
    if not ident:
        return None
    duration = ad.get("running_duration")
    try:
        days = int(duration) if duration is not None else None
    except (TypeError, ValueError):
        days = None
    return {
        "id": ident,
        "ad_id": str(ad.get("ad_id") or "") or None,
        "name": str(ad.get("name") or "") or None,
        "brand_id": str(ad.get("brand_id") or "") or None,
        "board_id": board_id or None,
        "board_name": board_name or None,
        "video": ad.get("video"),
        "image": ad.get("image"),
        "thumbnail": ad.get("thumbnail"),
        "foreplay_url": ad.get("foreplay_url"),
        "link_url": ad.get("link_url"),
        "headline": ad.get("headline"),
        "description": ad.get("description"),
        "cta_title": ad.get("cta_title"),
        "display_format": ad.get("display_format"),
        "publisher_platform": _list(ad.get("publisher_platform")),
        "niches": _list(ad.get("niches")),
        "languages": _list(ad.get("languages")),
        "market_target": ad.get("market_target"),
        "live": ad.get("live"),
        "started_running": ad.get("started_running"),
        "running_duration": days,
        "video_duration": ad.get("video_duration"),
        "full_transcription": (str(ad.get("full_transcription") or "") or None),
        "timestamped_transcription": ad.get("timestamped_transcription"),
        "emotional_drivers": _list(ad.get("emotional_drivers")),
        "persona": ad.get("persona"),
    }


def credits_left(usage: dict[str, Any]) -> Optional[int]:
    """However they spell it. None means we could not tell, which is not the
    same as none left and must not stop the sync."""
    for key in ("credits_remaining", "remaining", "credits_left", "available"):
        v = usage.get(key)
        if isinstance(v, (int, float)):
            return int(v)
    used, total = usage.get("credits_used"), usage.get("credits_total") or usage.get("credits")
    if isinstance(used, (int, float)) and isinstance(total, (int, float)):
        return int(total) - int(used)
    return None


def sync(
    cfg: Config,
    log: Callable[[str], None],
    sb: Any,
    *,
    max_ads: int = 250,
    full: bool = False,
    floor: int = 500,
) -> dict[str, Any]:
    """The swipe file into our own table, newest save first, stopping early.

    One ad returned costs one credit, so this reads only as far as the ads it
    has not seen. `full` walks the whole library and is for the first run.
    """
    fp = Foreplay(cfg, log)
    problems: list[str] = []

    left = None
    try:
        left = credits_left(fp.usage())
    except http.HttpError as e:
        problems.append(f"usage: {http.scrub(str(e))[:100]}")
    if left is not None:
        log(f"foreplay: {left} credits left")
        if left < floor and not full:
            return {"ads": 0, "stored": 0, "credits_left": left,
                    "note": f"under the {floor} credit floor, so nothing was read"}
        max_ads = min(max_ads, max(0, left - floor)) if not full else max_ads

    known = set(sb.known_foreplay_ids()) if not full else set()
    log(f"foreplay: {len(known)} ads already ours")

    rows: dict[str, dict[str, Any]] = {}
    offset, page_size, seen = 0, min(250, max_ads or 250), 0
    while seen < max_ads:
        try:
            out = fp.swipefile(limit=min(page_size, max_ads - seen), offset=offset, order="saved_newest")
        except http.HttpError as e:
            problems.append(f"swipe file: {http.scrub(str(e))[:120]}")
            break
        ads = [a for a in (out.get("data") or []) if isinstance(a, dict)]
        if not ads:
            break
        seen += len(ads)
        offset += len(ads)
        fresh = 0
        for a in ads:
            r = row(a)
            if not r:
                continue
            if r["id"] not in known:
                fresh += 1
            rows[r["id"]] = r
        # Newest first, so a page with nothing new means the rest is older
        # and already ours. Stopping here is what keeps the credits.
        if fresh == 0 and not full:
            log("  reached ads we already have; stopping")
            break

    # Which board each ad sits on, for the cockpit's filters. Boards are
    # cheap: they are not ads, so they are not credits.
    boards = []
    try:
        boards = fp.boards()
    except http.HttpError as e:
        problems.append(f"boards: {http.scrub(str(e))[:100]}")

    stored = sb.store_foreplay(list(rows.values())) if rows else 0
    result = {
        "ads_read": seen, "new_or_changed": len(rows), "stored": stored,
        "boards": len(boards), "calls": fp.calls, "credits_left": left,
    }
    if problems:
        result["problems"] = problems[:5]
    log(f"foreplay: {result}")
    return result
