"""Keeping our own copy of the ads we ran.

Measured on our own accounts on 2026-09-19, and the numbers decide the
design. Of 29 winning ads, **19 have already stopped**. A stopped commercial
ad is gone from the Meta Ad Library, so no tool that reads the Ad Library --
Foreplay and its Spyder included -- can ever fetch it. Those 19 are not
Foreplay's to lose or to find; they were never reachable that way.

They are reachable a different way. The video belongs to the client's
Facebook Page, not to the ad account, which is why the ad-account token is
refused and **the Page's own token returns the file**. Our system token
reaches 41 client Pages, and 22 of the 29 download as real mp4.

So the division is: Foreplay is the net from today forward, and this is the
backlog and the guarantee. Once the bytes are in our bucket, no expiring
link, no API permission and no vendor going out of business can take the ad
away from us.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Callable, Optional

from . import http
from .config import Config

V = "v21.0"
GRAPH = f"https://graph.facebook.com/{V}"
BUCKET = "ad-videos"
# An ad is half a minute of vertical video; ours average 4.8 MB. Anything far
# over this is not an ad and is left alone rather than filling the bucket.
MAX_BYTES = 200 * 1024 * 1024


def graph(path: str, token: str, fields: str = "", extra: str = "") -> dict[str, Any]:
    q = f"access_token={token}" + (f"&fields={fields}" if fields else "") + extra
    try:
        return http.get_json(f"{GRAPH}/{path}?{q}", timeout=60) or {}
    except http.HttpError as e:
        return {"_err": str(e)[:160]}


def page_tokens(token: str) -> dict[str, str]:
    """A token per Page we administer. This is the whole trick."""
    out = graph("me/accounts", token, "id,access_token", "&limit=200")
    return {
        str(p.get("id")): str(p.get("access_token"))
        for p in (out.get("data") or [])
        if p.get("id") and p.get("access_token")
    }


def video_id_of(ad_id: str, token: str) -> Optional[str]:
    """Where the video id hides, in the four places it can hide."""
    out = graph(ad_id, token, "creative{video_id,object_story_spec,asset_feed_spec}")
    cr = out.get("creative") or {}
    if cr.get("video_id"):
        return str(cr["video_id"])
    spec = cr.get("object_story_spec") or {}
    vid = (spec.get("video_data") or {}).get("video_id")
    if vid:
        return str(vid)
    for child in (spec.get("link_data") or {}).get("child_attachments") or []:
        if isinstance(child, dict) and child.get("video_id"):
            return str(child["video_id"])
    for v in (cr.get("asset_feed_spec") or {}).get("videos") or []:
        if isinstance(v, dict) and v.get("video_id"):
            return str(v["video_id"])
    return None


def source_for(video_id: str, token: str, pages: dict[str, str]) -> Optional[str]:
    """The playable file. The ad-account token is usually refused, and the
    Page that published the video is usually not."""
    out = graph(video_id, token, "source,from")
    src = out.get("source")
    if src:
        return str(src)
    owner = str((out.get("from") or {}).get("id") or "")
    page_token = pages.get(owner)
    if not page_token:
        return None
    again = graph(video_id, page_token, "source")
    return str(again["source"]) if again.get("source") else None


def fetch(url: str, *, max_bytes: int = MAX_BYTES) -> bytes:
    """Download now. The signed link dies within days, so the bytes are the
    only thing worth keeping."""
    req = urllib.request.Request(url, headers={"User-Agent": "mahara-editor-desk"})
    with urllib.request.urlopen(req, timeout=300) as r:
        blob = r.read(max_bytes + 1)
    if len(blob) > max_bytes:
        raise ValueError(f"over the {round(max_bytes / 1e6)} MB cap")
    if not blob:
        raise ValueError("the download was empty")
    return blob


def archive(
    cfg: Config,
    log: Callable[[str], None],
    sb: Any,
    *,
    limit: int = 25,
    retry_failed: bool = False,
) -> dict[str, Any]:
    """Pull the file for every winning ad we do not already hold."""
    token = cfg.meta_token
    if not token:
        raise http.HttpError(0, "META_ACCESS_TOKEN is not set")
    where = "select=ad_id,client,video_id&file_path=is.null"
    if not retry_failed:
        where += "&file_error=is.null"
    rows = sb.select("winner_ads", f"{where}&limit={int(limit)}")
    if not rows:
        return {"looked": 0, "saved": 0, "note": "every winner we can reach is already ours"}

    pages = page_tokens(token)
    log(f"{len(pages)} page tokens, {len(rows)} ads without a file")
    saved = failed = 0
    total = 0
    for r in rows:
        ad_id = str(r.get("ad_id") or "")
        vid = r.get("video_id") or video_id_of(ad_id, token)
        patch: dict[str, Any] = {"ad_id": ad_id, "video_id": vid}
        if not vid:
            patch["file_error"] = "no video on this creative"
            failed += 1
            sb.store_winner_file(patch)
            continue
        src = source_for(str(vid), token, pages)
        if not src:
            patch["file_error"] = "Meta would not hand over the file, even with the page token"
            failed += 1
            sb.store_winner_file(patch)
            continue
        try:
            blob = fetch(src)
            path = sb.upload_ad_video(ad_id, blob)
        except (urllib.error.URLError, ValueError, OSError, http.HttpError) as e:
            patch["file_error"] = http.scrub(str(e))[:200]
            failed += 1
            sb.store_winner_file(patch)
            continue
        total += len(blob)
        saved += 1
        patch.update({"file_path": path, "file_bytes": len(blob), "file_error": None})
        sb.store_winner_file(patch)
        log(f"  {str(r.get('client'))[:24]}: {round(len(blob) / 1e6, 1)} MB")

    return {
        "looked": len(rows), "saved": saved, "failed": failed,
        "megabytes": round(total / 1e6, 1),
    }
