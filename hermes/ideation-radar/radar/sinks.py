"""Where results go. Every sink is optional except the JSONL files, which are
the audit trail and the recovery path when a remote store is down.

- JsonlSink: out/candidates-YYYY-MM-DD.jsonl, out/ideas.jsonl, out/latest.json
- BridgeSink: the creative director cockpit's POST /bridge door
- Supabase (radar/supabase.py): the ideation home, tables plus the stills bucket
- SlackSink: a digest line per scan, posted even when nothing was found so
  silence is never ambiguous (the Radar rule from 2026-05-16)
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from . import http

BRIDGE_BATCH = 40


class SinkError(Exception):
    pass


class JsonlSink:
    def __init__(self, out_dir: Path):
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)

    def _append(self, name: str, rows: list[dict[str, Any]]) -> Path:
        path = self.out_dir / name
        with open(path, "a", encoding="utf-8") as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        return path

    def write_candidates(self, rows: list[dict[str, Any]], day: Optional[str] = None) -> Path:
        day = day or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return self._append(f"candidates-{day}.jsonl", rows)

    def write_ideas(self, rows: list[dict[str, Any]]) -> Path:
        return self._append("ideas.jsonl", rows)

    def write_latest(self, payload: dict[str, Any]) -> Path:
        path = self.out_dir / "latest.json"
        tmp = path.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=1)
        tmp.replace(path)
        return path


class BridgeSink:
    """POST {door} {fn, args} with a bearer token, 40 rows a call.

    The door is the creative director cockpit's dedicated /ideation route
    (its own IDEATION_TOKEN, four functions), not the general /bridge door
    whose token can rewrite every mirrored table. A bare site URL gets
    /ideation appended.
    """

    def __init__(self, url: str, token: str, *, timeout: float = 60):
        if not url or not token:
            raise SinkError("ideation door url and token are required")
        self.url = url.rstrip("/")
        from urllib.parse import urlparse
        if not urlparse(self.url).path.strip("/"):
            self.url += "/ideation"
        self.token = token
        self.timeout = timeout

    def call(self, fn: str, args: dict[str, Any]) -> Any:
        out = http.post_json(
            self.url,
            {"fn": fn, "args": args},
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=self.timeout,
            retries=2,
            ok_statuses=(200,),
        )
        if not isinstance(out, dict) or out.get("ok") is not True:
            raise SinkError(f"bridge {fn}: {str(out)[:300]}")
        return out.get("data")

    def store_candidates(self, rows: list[dict[str, Any]]) -> list[Any]:
        return [self.call("storeIdeationCandidates", {"rows": rows[i : i + BRIDGE_BATCH]}) for i in range(0, len(rows), BRIDGE_BATCH)]

    def store_ideas(self, rows: list[dict[str, Any]]) -> list[Any]:
        return [self.call("storeIdeationIdeas", {"rows": rows[i : i + BRIDGE_BATCH]}) for i in range(0, len(rows), BRIDGE_BATCH)]

    def pending_captures(self, limit: int = 10) -> list[dict[str, Any]]:
        """Links pasted in the cockpit that still need fetching and transcribing."""
        data = self.call("ideationPending", {"limit": limit})
        return list(data or [])

    def ping(self) -> Any:
        return self.call("ideationPing", {})


# Supabase lives in radar/supabase.py (the ideation home since 2026-09-17).


class SlackSink:
    def __init__(self, token: str, channel: str, *, timeout: float = 30):
        if not token or not channel:
            raise SinkError("slack token and channel are required")
        self.token = token
        self.channel = channel
        self.timeout = timeout

    def post(self, text: str) -> None:
        out = http.post_json(
            "https://slack.com/api/chat.postMessage",
            {"channel": self.channel, "text": text[:3900], "unfurl_links": False},
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=self.timeout,
            retries=1,
        )
        if not out or not out.get("ok"):
            raise SinkError(f"slack: {str(out)[:200]}")


def deliver(sinks: list[tuple[str, Callable[[], Any]]], log: Callable[[str], None]) -> dict[str, str]:
    """Run each sink; a failure is logged and reported, never fatal to the others."""
    report: dict[str, str] = {}
    for name, fn in sinks:
        try:
            fn()
            report[name] = "ok"
        except Exception as e:  # noqa: BLE001 - every sink failure must be visible, none fatal
            report[name] = f"failed: {http.scrub(str(e))[:300]}"
            log(f"sink {name} failed: {e}")
    return report
