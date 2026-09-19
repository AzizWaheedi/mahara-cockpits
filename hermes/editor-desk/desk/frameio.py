"""Frame.io: the review, read back into the desk.

The editor uploads a cut, the creative director points at frames, the
client points at frames, and all of it has to end up in `editor_notes`
where the job page already shows it. That is the whole job of this module.

Two things about their API shape the code more than anything else.

First, **a webhook tells you nothing**. The payload is ids -- account,
project, resource, type -- and no content. So a comment has to be fetched,
and fetching needs a token. There is no arrangement in which this runs
without one.

Second, **the token rotates**. Adobe's refresh token is good for fourteen
days and every refresh spends it and issues another, so the new one has to
be written down or the next run is locked out. Google's never changes and
sits in the env file; this one lives in `frameio_auth`, and the write
happens before the token is used for anything else.

Nothing here creates, uploads or shares. It reads comments and files. The
one thing it writes to Frame.io is nothing at all.
"""
from __future__ import annotations

import time
from typing import Any, Callable, Optional

from . import http
from .config import Config

API = "https://api.frame.io/v4"
TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3"

#: What a comment's `timestamp` means. Their migration guide says it is a
#: framestamp counting from 1; their own create-comment example looks like
#: seconds, and their forum has people caught between the two. So it is a
#: setting, not a guess, and `unknown` writes no timecode rather than a
#: wrong one. The pilot's first real comment decides it.
UNITS = ("frames", "seconds", "unknown")


class Frameio:
    def __init__(
        self,
        cfg: Config,
        store: Any,
        log: Optional[Callable[[str], None]] = None,
    ):
        self.cfg = cfg
        self.store = store
        self.log = log or (lambda m: None)
        self._token = ""
        self._expires = 0.0
        self.calls = 0

    # ---- auth ------------------------------------------------------------
    def token(self) -> str:
        """An access token, refreshing when it is nearly out.

        The new refresh token is stored *before* the access token is
        returned. If the store failed after a successful refresh, the old
        refresh token would already be spent and the next run would have no
        way in -- so the write has to be the thing that can fail, not the
        thing that is skipped.
        """
        if self._token and time.time() < self._expires - 60:
            return self._token
        auth = self.store.frameio_auth()
        refresh = str((auth or {}).get("refresh_token") or "")
        if not refresh:
            raise http.HttpError(
                0,
                "Frame.io has never been authorised. Run the one-time sign-in "
                "and put the refresh token in frameio_auth.",
            )
        out = http.post_form(
            TOKEN_URL,
            {
                "client_id": self.cfg.frameio_client_id,
                "client_secret": self.cfg.frameio_client_secret,
                "refresh_token": refresh,
                "grant_type": "refresh_token",
            },
            timeout=30,
            retries=2,
        )
        if not isinstance(out, dict) or not out.get("access_token"):
            self.store.frameio_failed("Adobe refused the refresh token")
            raise http.HttpError(
                0,
                "Adobe refused the Frame.io refresh token. It expires after "
                "fourteen days unused; somebody has to sign in again.",
            )
        fresh = str(out.get("refresh_token") or "")
        if fresh and fresh != refresh:
            self.store.frameio_refreshed(fresh)
        else:
            self.store.frameio_refreshed(refresh)
        self._token = str(out["access_token"])
        self._expires = time.time() + float(out.get("expires_in") or 3600)
        return self._token

    def _h(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token()}"}

    def account(self) -> str:
        acct = str((self.store.frameio_auth() or {}).get("account_id") or "")
        if not acct:
            raise http.HttpError(0, "frameio_auth has no account_id")
        return acct

    # ---- reading ---------------------------------------------------------
    def comments(self, file_id: str) -> list[dict[str, Any]]:
        """Every comment and reply on one cut, flat, as they return it."""
        self.calls += 1
        out = http.get_json(
            f"{API}/accounts/{self.account()}/files/{http.quote(file_id)}/comments",
            headers=self._h(),
            timeout=60,
        )
        rows = out.get("data") if isinstance(out, dict) else out
        return [c for c in (rows or []) if isinstance(c, dict)]

    def comment(self, comment_id: str) -> dict[str, Any]:
        """One comment, which is all a webhook gives us the id of."""
        self.calls += 1
        out = http.get_json(
            f"{API}/accounts/{self.account()}/comments/{http.quote(comment_id)}",
            headers=self._h(),
            timeout=60,
        )
        if isinstance(out, dict) and isinstance(out.get("data"), dict):
            return out["data"]
        return out if isinstance(out, dict) else {}

    def file(self, file_id: str) -> dict[str, Any]:
        self.calls += 1
        out = http.get_json(
            f"{API}/accounts/{self.account()}/files/{http.quote(file_id)}",
            headers=self._h(),
            timeout=60,
        )
        if isinstance(out, dict) and isinstance(out.get("data"), dict):
            return out["data"]
        return out if isinstance(out, dict) else {}


# ---------------------------------------------------------------------------
# Turning a comment into a note


def at_seconds(
    stamp: Any,
    *,
    unit: str,
    fps: Optional[float],
    duration: Optional[float],
) -> Optional[float]:
    """Where in the video a comment points, in seconds, or nothing.

    Nothing is a real answer here. A note at the wrong second sends the
    editor to the wrong part of the cut and looks authoritative doing it,
    which is worse than a note with no timecode at all -- the editor
    already knows how to find "the bit where she says the price".

    So: no timecode unless it can be justified. Unknown unit, no frame
    rate, or a result past the end of the cut all mean null. The frame rate
    and the duration are the desk's own, measured with ffprobe when the cut
    was checked, not Frame.io's word for it.
    """
    try:
        t = float(stamp)
    except (TypeError, ValueError):
        return None
    if t < 0:
        return None
    if unit == "seconds":
        secs = t
    elif unit == "frames":
        if not fps or fps <= 0:
            return None  # a framestamp with no frame rate is not a time
        # Their framestamps count from 1, so frame 1 is the first frame.
        secs = max(0.0, (t - 1.0) / fps)
    else:
        return None
    if duration and secs > duration + 1.0:
        # The unit is set wrong, or this comment is not on this cut. Either
        # way, say nothing rather than point past the end.
        return None
    return round(secs, 2)


def note_row(
    comment: dict[str, Any],
    *,
    task_id: str,
    version: Optional[int] = None,
    unit: str = "frames",
    fps: Optional[float] = None,
    duration: Optional[float] = None,
) -> Optional[dict[str, Any]]:
    """One Frame.io comment as an `editor_notes` row.

    Keyed on the comment's own id, so reading the same comment twice -- and
    the webhook and the sweep will read some of them twice -- is one row.
    """
    cid = str(comment.get("id") or "")
    text = str(comment.get("text") or "").strip()
    if not cid or not text:
        return None
    owner = comment.get("owner")
    if not isinstance(owner, dict):
        owner = {}
    return {
        "id": f"frameio:{cid}",
        "task_id": task_id,
        "version": version,
        "at_sec": at_seconds(
            comment.get("timestamp"), unit=unit, fps=fps, duration=duration
        ),
        "text": text[:4000],
        "by_email": str(owner.get("email") or "").lower() or None,
        "by_name": str(owner.get("name") or owner.get("display_name") or "") or None,
        "source": "frameio",
        "done": bool(comment.get("completed_at") or comment.get("completed")),
        "at": comment.get("inserted_at") or comment.get("created_at"),
    }


def measured(versions: list[dict[str, Any]]) -> tuple[Optional[float], Optional[float]]:
    """The frame rate and length of the newest cut we checked ourselves.

    Frame.io is not asked for either. The desk already ran ffprobe over the
    export when the editor pressed Check it first, and its own measurement
    is the one thing here that cannot be wrong about our own file.
    """
    for v in sorted(versions, key=lambda r: r.get("n") or 0, reverse=True):
        fps = v.get("fps")
        secs = v.get("seconds")
        if fps:
            return (float(fps), float(secs) if secs else None)
    return (None, None)


def sync(
    fp: Frameio,
    sb: Any,
    *,
    log: Callable[[str], None],
    unit: str = "frames",
    limit: int = 40,
) -> dict[str, Any]:
    """Read the comments on every open job that has a cut in Frame.io.

    A sweep, not a stream. The webhook makes it prompt when there is one;
    without a webhook this on its own is the whole integration, twenty
    minutes behind. Nothing below knows or cares which is running.
    """
    jobs = sb.frameio_jobs(limit=limit)
    stored = 0
    no_timecode = 0
    problems: list[str] = []
    for job in jobs:
        task_id = str(job.get("task_id") or "")
        file_id = str(job.get("frameio_file_id") or "")
        if not task_id or not file_id:
            continue
        try:
            found = fp.comments(file_id)
        except http.HttpError as e:
            problems.append(f"{task_id}: {http.scrub(str(e))[:90]}")
            continue
        fps, duration = measured(sb.versions(task_id))
        rows = []
        for c in found:
            row = note_row(
                c,
                task_id=task_id,
                version=job.get("frameio_version"),
                unit=unit,
                fps=fps,
                duration=duration,
            )
            if not row:
                continue
            if row["at_sec"] is None:
                no_timecode += 1
            rows.append(row)
        if rows:
            sb.store_notes(rows)
            stored += len(rows)
            log(f"  {task_id}: {len(rows)} notes from Frame.io")
    out: dict[str, Any] = {
        "jobs": len(jobs),
        "notes": stored,
        "without_timecode": no_timecode,
        "calls": fp.calls,
    }
    if problems:
        out["problems"] = problems
    # Worth seeing in the log rather than buried: if every note came back
    # without a timecode the unit is probably set wrong, and the whole point
    # of this was the timecodes.
    if stored and no_timecode == stored:
        log("  none of these carried a usable timecode -- check FRAMEIO_TIMESTAMP_UNIT")
    return out
