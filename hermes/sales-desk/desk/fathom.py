"""Fathom, read directly: meetings per rep, and a recording's transcript.

The B2B copy (`fathom_calls`) has been refused with a 403 since 12 September,
so the desk asks Fathom itself, the way hermes/webinar-pull does. The key is
Aziz's: on its own it sees his recordings plus what the team shares, so the
index asks once for his and once per rep with `recorded_by[]`.

Paced and retried: one call at a time with a gap between them, a 429 waits
for Retry-After, and a 5xx is asked again. Nothing here is written anywhere.
"""
from __future__ import annotations

import json
import re
import time
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from . import http

API = "https://api.fathom.ai/external/v1"

# Client-service calls (launch, check-in, onboarding, renewals) and team
# meetings are not sales calls. The same filter as webinar-pull, so the two
# agree on what a sales call is.
NOT_SALES = re.compile(r"launch|check.?in|onboarding|kick.?off|renewal|review|wrap|pulse|1:1|"
                       r"whole team|fulfil|call cent", re.I)

# Turns that carry nothing: pure acknowledgement, no content. Dropping them
# takes 1-3% off the transcript. Any turn containing a digit is kept whatever
# it looks like, so a number can never be lost this way. (prepare.py)
FILLER = {
    "تمام", "طيب", "اوكي", "أوكي", "اه", "آه", "ايوه", "أيوه", "نعم", "مم", "همم",
    "ok", "okay", "yeah", "yes", "right", "mhm", "uh", "um", "sure",
}
_NOT_WORD = re.compile(r"[^\w؀-ۿ]+")


class FathomError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(http.scrub(message))


def flatten(transcript: Any, drop_filler: bool = True) -> str:
    """Fathom's turns are objects with a nested speaker and a timestamp, so two
    thirds of the payload is JSON envelope rather than speech. One line per turn
    keeps every word and drops the scaffolding."""
    lines = []
    for turn in transcript or []:
        if not isinstance(turn, dict):
            continue
        speaker = turn.get("speaker")
        if isinstance(speaker, dict):
            speaker = speaker.get("display_name")
        text = str(turn.get("text") or "").strip()
        if not text:
            continue
        if drop_filler and not any(ch.isdigit() for ch in text):
            bare = _NOT_WORD.sub("", text).lower()
            if bare in FILLER:
                continue
        lines.append(f"{speaker or 'Unknown'}: {text}")
    return "\n".join(lines)


def parse_ts(value: Any) -> Optional[datetime]:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        t = datetime.fromisoformat(text)
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


class Fathom:
    def __init__(self, key: str, *, pace: float = 1.1, log: Optional[Callable[[str], None]] = None,
                 transport: Optional[Callable[..., tuple[int, dict, bytes]]] = None):
        if not key:
            raise FathomError(0, "FATHOM_API_KEY is not set, so no recording can be read")
        self.key = key
        self.pace = pace
        self.log = log or (lambda _m: None)
        self._transport = transport or http.request
        self._last = 0.0

    def _wait_turn(self) -> None:
        gap = self.pace - (time.monotonic() - self._last)
        if gap > 0:
            time.sleep(gap)
        self._last = time.monotonic()

    def get(self, path: str, params: Optional[list[tuple[str, str]]] = None) -> dict[str, Any]:
        q = urllib.parse.urlencode([(k, v) for k, v in (params or []) if v not in (None, "")])
        url = f"{API}{path}{'?' + q if q else ''}"
        headers = {"X-Api-Key": self.key, "Accept": "application/json", "User-Agent": http.BROWSER_UA}
        for attempt in range(4):
            self._wait_turn()
            try:
                _, _, body = self._transport("GET", url, headers=headers, timeout=90, retries=0)
                return json.loads(body.decode("utf-8")) if body else {}
            except http.HttpError as e:
                if e.status in (429, 500, 502, 503, 504) and attempt < 3:
                    time.sleep(min(30, 2 * (attempt + 1) ** 2))
                    continue
                if e.status == 0 and attempt < 3:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise FathomError(e.status, f"Fathom answered {e.status or 'nothing'} on {path}: {e}")
            except ValueError as e:
                raise FathomError(0, f"Fathom sent something that is not JSON on {path}: {e}")
        raise FathomError(0, f"Fathom did not answer on {path}")

    def meetings(self, *, since: datetime, recorded_by: Optional[str] = None, max_pages: int = 60) -> list[dict[str, Any]]:
        """Meetings created since a time, ten a page, without transcripts."""
        out: list[dict[str, Any]] = []
        cursor = ""
        after = since.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        for _ in range(max_pages):
            params = [("created_after", after), ("cursor", cursor)]
            if recorded_by:
                params.append(("recorded_by[]", recorded_by))
            data = self.get("/meetings", params)
            out.extend(m for m in (data.get("items") or []) if isinstance(m, dict))
            cursor = str(data.get("next_cursor") or "")
            if not cursor:
                break
        return out

    def transcript(self, recording_id: Any) -> list[dict[str, Any]]:
        data = self.get(f"/recordings/{http.quote(recording_id)}/transcript")
        return [t for t in (data.get("transcript") or []) if isinstance(t, dict)]
