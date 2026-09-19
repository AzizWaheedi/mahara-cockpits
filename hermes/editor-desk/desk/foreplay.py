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


# Composio fronts the same API as a tool per endpoint. Aziz connected it
# there on 2026-09-19, so the worker can carry one Composio key instead of a
# key per vendor. Slugs confirmed live against his account the same day.
COMPOSIO = "https://backend.composio.dev/api/v3/tools/execute"
VIA_COMPOSIO = {
    "/api/usage": "CUSTOM_FOREPLAY_GET_USER_USAGE",
    "/api/boards": "CUSTOM_FOREPLAY_GET_BOARDS",
    "/api/board/ads": "CUSTOM_FOREPLAY_GET_BOARD_ADS",
    "/api/swipefile/ads": "CUSTOM_FOREPLAY_GET_SWIPEFILE_ADS",
    "/api/discovery/ads": "CUSTOM_FOREPLAY_SEARCH_DISCOVERY_ADS",
    "/api/spyder/brands": "CUSTOM_FOREPLAY_GET_SPYDER_BRANDS",
    "/api/spyder/brand/ads": "CUSTOM_FOREPLAY_GET_SPYDER_BRAND_ADS",
}


class Foreplay:
    """One client, two ways in.

    With a Foreplay key it calls Foreplay. With a Composio key it calls the
    same endpoints through Composio, which is where Aziz keeps the
    connection. Either one secret is enough; the rest of the worker cannot
    tell which is in use.
    """

    def __init__(self, cfg: Config, log: Optional[Callable[[str], None]] = None):
        self.cfg = cfg
        self.via_composio = bool(cfg.composio_key and not cfg.foreplay_key)
        if not cfg.foreplay_key and not cfg.composio_key:
            raise http.HttpError(0, "neither FOREPLAY_API_KEY nor COMPOSIO_API_KEY is set")
        self.log = log or (lambda m: None)
        self.calls = 0

    def _h(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.cfg.foreplay_key}", "Accept": "application/json"}

    def get(self, path: str, **params: Any) -> dict[str, Any]:
        self.calls += 1
        args = {k: v for k, v in params.items() if v not in (None, "")}
        if self.via_composio:
            return self._composio(path, args)
        q = http.encode_query(args)
        out = http.get_json(f"{BASE}{path}?{q}", headers=self._h(), timeout=60)
        return out if isinstance(out, dict) else {}

    def _composio(self, path: str, args: dict[str, Any]) -> dict[str, Any]:
        slug = VIA_COMPOSIO.get(path)
        if not slug:
            raise http.HttpError(0, f"{path} has no Composio tool; use a Foreplay key for it")
        out = http.post_json(
            f"{COMPOSIO}/{slug}",
            {"arguments": args, "user_id": self.cfg.composio_user or "default"},
            headers={"x-api-key": self.cfg.composio_key, "Accept": "application/json"},
            timeout=90,
        )
        if not isinstance(out, dict):
            return {}
        if out.get("successful") is False:
            raise http.HttpError(0, f"Composio refused {slug}: {str(out.get('error'))[:160]}")
        # Composio wraps the answer one layer deeper than Foreplay does.
        inner = out.get("data")
        return inner if isinstance(inner, dict) else out

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


def _forward_to_ideation(sb: Any, ads: list[dict[str, Any]], log: Callable[[str], None]) -> int:
    """Put anything new from the drop box on the shared ideation board.

    Only ads the board has never seen. Something the creative director
    already dismissed must not come back every half hour just because it is
    still sitting in the Foreplay folder.
    """
    if not ads:
        return 0
    keys = [f"foreplay:{a['id']}" for a in ads]
    known = set(sb.known_ideation_keys(keys))
    fresh = [a for a in ads if f"foreplay:{a['id']}" not in known]
    if not fresh:
        return 0
    rows = []
    for a in fresh:
        try:
            rows.append(as_idea(a, by_name=str(a.get("board_name") or "Foreplay")))
        except ValueError:
            continue
    if rows:
        sb.upsert("ideation_posts", rows, "key")
        log(f"  forwarded {len(rows)} to the ideation board")
    return len(rows)


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


def find_board(boards: list[dict[str, Any]], want: str) -> Optional[dict[str, Any]]:
    """The drop box board, by name, however it was capitalised."""
    target = " ".join(str(want or "").lower().split())
    if not target:
        return None
    for b in boards:
        if " ".join(str(b.get("name") or "").lower().split()) == target:
            return b
    return None


def board_ads(fp: "Foreplay", board: dict[str, Any], *, cap: int = 200) -> list[dict[str, Any]]:
    """Every ad on one board. Costs a credit each, so only the drop box is
    read this way; everything else comes from the incremental swipe file."""
    bid = str(board.get("id") or board.get("board_id") or "")
    if not bid:
        return []
    name = str(board.get("name") or "")
    out: list[dict[str, Any]] = []
    cursor = ""
    for _page in range(5):
        page = fp.board_ads(bid, limit=min(100, cap - len(out)), cursor=cursor)
        ads = [a for a in (page.get("data") or []) if isinstance(a, dict)]
        for a in ads:
            r = row(a, board_id=bid, board_name=name)
            if r:
                out.append(r)
        cursor = str(((page.get("metadata") or {}).get("cursor")) or "")
        if not cursor or not ads or len(out) >= cap:
            break
    return out


def sync(
    cfg: Config,
    log: Callable[[str], None],
    sb: Any,
    *,
    max_ads: int = 250,
    full: bool = False,
    floor: int = 500,
    drop_box: str = "",
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

    # Which board each ad sits on. Listing boards is free: they are not ads.
    boards = []
    try:
        boards = fp.boards()
    except http.HttpError as e:
        problems.append(f"boards: {http.scrub(str(e))[:100]}")

    # The drop box. Aziz, 2026-09-19: anything anyone saves into this board,
    # from any device, should turn up on the shared ideation board without
    # a second action. Only this board is read ad by ad, because that is
    # what costs credits.
    forwarded = 0
    box = find_board(boards, drop_box) if drop_box else None
    if box:
        try:
            on_box = board_ads(fp, box)
            for r in on_box:
                rows[r["id"]] = r
            forwarded = _forward_to_ideation(sb, on_box, log)
        except http.HttpError as e:
            problems.append(f"{drop_box}: {http.scrub(str(e))[:100]}")
    elif drop_box:
        problems.append(f"no board named {drop_box!r}; nothing was forwarded")

    stored = sb.store_foreplay(list(rows.values())) if rows else 0
    result = {
        "ads_read": seen, "new_or_changed": len(rows), "stored": stored,
        "boards": len(boards), "forwarded_to_ideation": forwarded,
        "calls": fp.calls, "credits_left": left,
    }
    if problems:
        result["problems"] = problems[:5]
    log(f"foreplay: {result}")
    return result


def as_idea(ad: dict[str, Any], *, by: str = "", by_name: str = "", note: str = "") -> dict[str, Any]:
    """A saved Foreplay ad as a row on the shared ideation board.

    The board is what the creative director works from, so an ad the editor
    or the media buyer saved on their phone turns up in Sabry's cockpit
    without anybody forwarding a link. `origin` says where it came from, so a
    hand-saved ad is never mistaken for something the radar scored.
    """
    platforms = ad.get("publisher_platform") or []
    platform = (platforms[0] if isinstance(platforms, list) and platforms else None) or "meta"
    url = ad.get("link_url") or ad.get("foreplay_url") or ""
    if not url:
        raise ValueError("that ad has no link to save")
    caption = ad.get("headline") or ad.get("description") or ad.get("name") or ""
    days = ad.get("running_duration")
    why = None
    if isinstance(days, int) and days > 0:
        why = f"Still running after {days} days, which is why it was kept."
    return {
        "key": f"foreplay:{ad.get('id')}",
        "platform": str(platform).lower(),
        "url": url,
        "origin": "foreplay",
        "status": "saved",
        "author_name": ad.get("name"),
        "caption": caption[:2000] or None,
        "thumb_url": ad.get("thumbnail") or ad.get("image"),
        "media_url": ad.get("video"),
        "transcript": (str(ad.get("full_transcription") or "") or None),
        "duration_sec": ad.get("video_duration"),
        "why_it_works": why,
        "running_days": days if isinstance(days, int) else None,
        "saved_by": by or None,
        "saved_by_name": by_name or None,
        "saved_note": note[:1000] or None,
        "pasted_by": by or None,
        "pasted_by_name": by_name or None,
    }
