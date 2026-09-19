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
        return self.get("/api/usage")

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


def sync(cfg: Config, log: Callable[[str], None], sb: Any, *, max_ads: int = 1000) -> dict[str, Any]:
    """Every board, then the swipe file, into our own table.

    Bounded: a runaway board cannot pull the whole library, and a board that
    fails is reported rather than losing the boards after it.
    """
    fp = Foreplay(cfg, log)
    rows: dict[str, dict[str, Any]] = {}
    problems: list[str] = []

    boards = []
    try:
        boards = fp.boards()
    except http.HttpError as e:
        problems.append(f"boards: {http.scrub(str(e))[:120]}")
    log(f"foreplay: {len(boards)} boards")

    for b in boards:
        bid = str(b.get("id") or b.get("board_id") or "")
        bname = str(b.get("name") or "")
        if not bid:
            continue
        cursor = ""
        for _page in range(10):
            try:
                out = fp.board_ads(bid, limit=100, cursor=cursor)
            except http.HttpError as e:
                problems.append(f"{bname or bid}: {http.scrub(str(e))[:100]}")
                break
            ads = [a for a in (out.get("data") or []) if isinstance(a, dict)]
            for a in ads:
                r = row(a, board_id=bid, board_name=bname)
                if r:
                    rows[r["id"]] = r
            cursor = str(((out.get("metadata") or {}).get("cursor")) or "")
            if not cursor or not ads or len(rows) >= max_ads:
                break
        log(f"  {bname or bid}: {len(rows)} so far")
        if len(rows) >= max_ads:
            break

    # Anything saved but not on a board.
    if len(rows) < max_ads:
        try:
            out = fp.swipefile(limit=100)
            for a in (out.get("data") or []):
                if isinstance(a, dict):
                    r = row(a)
                    if r and r["id"] not in rows:
                        rows[r["id"]] = r
        except http.HttpError as e:
            problems.append(f"swipe file: {http.scrub(str(e))[:120]}")

    stored = sb.store_foreplay(list(rows.values())) if rows else 0
    out = {"boards": len(boards), "ads": len(rows), "stored": stored, "calls": fp.calls}
    if problems:
        out["problems"] = problems[:5]
    log(f"foreplay: {out}")
    return out
