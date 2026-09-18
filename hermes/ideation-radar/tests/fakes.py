"""Test doubles: a fake Apify that serves fixture items, a fake HTTP layer."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from radar.apify import RunResult

NOW = datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc)


def ig_item(code: str, views: int, hours_ago: float, likes: int = 100, pinned: bool = False, owner: str = "acct") -> dict[str, Any]:
    ts = (NOW - timedelta(hours=hours_ago)).isoformat().replace("+00:00", "Z")
    return {
        "type": "Video", "productType": "clips", "shortCode": code, "url": f"https://www.instagram.com/reel/{code}/",
        "caption": f"caption {code}", "timestamp": ts, "likesCount": likes, "commentsCount": 5,
        "videoPlayCount": views, "videoViewCount": views - 1, "videoDuration": 21.5,
        "videoUrl": f"https://cdn.example/{code}.mp4", "displayUrl": f"https://cdn.example/{code}.jpg",
        "ownerUsername": owner, "ownerFullName": "Account Name", "isPinned": pinned,
    }


def tt_item(vid: str, views: int, hours_ago: float, author: str = "tk", fans: int = 50000, pinned: bool = False) -> dict[str, Any]:
    ts = (NOW - timedelta(hours=hours_ago)).isoformat().replace("+00:00", "Z")
    return {
        "id": vid, "text": f"desc {vid}", "createTimeISO": ts, "webVideoUrl": f"https://www.tiktok.com/@{author}/video/{vid}",
        "authorMeta": {"name": author, "nickName": "TK Name", "fans": fans},
        "videoMeta": {"duration": 18, "coverUrl": f"https://cdn.example/{vid}.jpg", "downloadAddr": f"https://cdn.example/{vid}.mp4"},
        "mediaUrls": [f"https://cdn.example/{vid}.mp4"],
        "playCount": views, "diggCount": 300, "shareCount": 20, "commentCount": 10, "collectCount": 40, "isPinned": pinned,
    }


def ig_search_item(username: str, followers: int, latest: list[dict[str, Any]] | None = None, private: bool = False) -> dict[str, Any]:
    return {
        "username": username, "fullName": f"{username} name", "followersCount": followers, "postsCount": 120,
        "private": private, "verified": False, "businessCategoryName": "Contractor", "url": f"https://www.instagram.com/{username}/",
        "latestPosts": latest or [],
    }


class FakeApify:
    """Serves items per (actor, label) and counts runs like the real one."""

    def __init__(self, fixtures: dict[str, list[dict[str, Any]]], fail: set[str] | None = None):
        self.fixtures = fixtures
        self.fail = fail or set()
        self.runs_started = 0
        self.usage_usd = 0.0
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    def run_many(self, actor_id: str, jobs: list[tuple[str, dict[str, Any]]], **kw: Any) -> list[RunResult]:
        out = []
        for label, inp in jobs:
            self.runs_started += 1
            self.calls.append((actor_id, label, inp))
            r = RunResult(label=label, input=inp, run={"id": f"run-{self.runs_started}", "status": "SUCCEEDED", "usageTotalUsd": 0.01, "defaultDatasetId": "d"})
            self.usage_usd += 0.01
            if label in self.fail:
                r.run["status"] = "FAILED"
                r.error = "run FAILED"
            else:
                r.items = list(self.fixtures.get(label, []))
            out.append(r)
        return out

    def run_sync_items(self, actor_id: str, inp: dict[str, Any], **kw: Any) -> list[dict[str, Any]]:
        self.runs_started += 1
        self.calls.append((actor_id, "sync", inp))
        key = json.dumps(inp, sort_keys=True)
        for k, v in self.fixtures.items():
            if k in key:
                return list(v)
        return []


class FakeHttp:
    """Patch radar.http.request with this to capture calls and script replies."""

    def __init__(self, replies: list[tuple[int, dict[str, str], bytes]] | None = None):
        self.calls: list[dict[str, Any]] = []
        self.replies = list(replies or [])

    def __call__(self, method: str, url: str, **kw: Any):
        self.calls.append({"method": method, "url": url, **kw})
        if self.replies:
            status, headers, body = self.replies.pop(0)
            from radar.http import HttpError
            if status >= 400:
                raise HttpError(status, "scripted", body, url)
            return status, headers, body
        return 200, {}, b'{"ok": true}'
