"""The client success decks' Drive imports (docs/csm-decks/DRIVE-IMPORT.md 7).

The CEO, 2026-10-20: "for their ads allow just a drive link to work and it
can work with folder or just the video. make it really easy for him to
prepare." The client success manager pastes a Drive link in prep or in the
notes window; the cockpit queues one import per link
(cockpit_csm_launch_ads_import_request), and this run brings the pictures
and videos behind it into the launch deck's ads tray, the way an upload by
hand lands: a row reserved first, the bytes into the private bucket
cockpit-launch-ads, then the server checks Storage's own metadata.

A phone video too large or in a format a browser cannot play is converted
to MP4 here, so the CSM never exports anything by hand. Its last step fills
the video slots' posters (VIDEOS.md 9).

What it never does: write to Drive, follow a link that is not Drive, open a
file other than the ones it listed, run anything a file contains, keep a
file after its run, or name a stored object after a Drive name (the path is
the row's id). Keys are read by name, never printed (http.scrub).
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import shutil
import socket
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

from . import http, media
from .drive import FOLDER_MIME, IMPORT_FIELDS, TOKEN_URL, parse_id
from .supabase import RpcError, StorageTooLarge

BUCKET = "cockpit-launch-ads"
VIDEO_CAP = 1_610_612_736  # 1.5 GB: a phone video downloaded to be converted
PICTURE_CAP = 157_286_400  # 150 MB: the bucket's own limit, and a picture's
LANDING_CAP = 157_286_400  # what lands, whatever it was
DISK_FLOOR = 4 * 1024**3  # a 1.5 GB source, its conversion, and the desk's other jobs
CLAIM_WINDOW = 8 * 60  # no new claim (and no posters) after 8 minutes in
STOP_AFTER = 45 * 60  # between files, a run stops itself at 45 minutes
FILE_SECONDS = 15 * 60  # a download, and a conversion
HEARTBEAT_EVERY = 60
CONVERT_LONGEST = 300  # five minutes of video at most, when it must be converted
LAND_LONGEST = 3600  # an hour, for a video that lands as it is
POSTER_WIDTH = 1080
POSTERS_AT_MOST = 6

MEDIA_EXT = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv")
VIDEO_EXT = (".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv")
SHORTCUT_MIME = "application/vnd.google-apps.shortcut"
PLAYABLE_CODECS = {"h264", "vp8", "vp9", "av1"}
PATH_OK = r"^{task}/{ad}(-poster)?\.(jpg|png|webp|mp4|mov|webm)$"
PLAN_MIME = re.compile(r"(image|video)/[a-z0-9.+-]{1,60}")  # the plan's own rule
EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
       "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm"}

# The second review round: every ffmpeg-family process that reads the Drive
# bytes (the probe, the conversion and the poster) may open local files only
# (never a network or playlist protocol, whatever the container asks for),
# and the conversion's output stops a megabyte past what can land, so a file
# that lies about its length cannot fill the scratch disk before the
# 15-minute kill.
LOCAL_ONLY = ("-protocol_whitelist", "file")
FFMPEG_CONVERT = [
    "nice", "-n", "10", "ffmpeg", "-nostdin", "-y", "-loglevel", "error",
    *LOCAL_ONLY, "-i", "{src}",
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", "scale='if(gt(iw,ih),-2,min(1080,iw))':'if(gt(iw,ih),min(1080,ih),-2)'",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "3500k", "-bufsize", "7000k",
    "-pix_fmt", "yuv420p", "-threads", "2", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
    "-fs", str(LANDING_CAP + (1 << 20)), "{dest}",
]

OEMBED = {
    "loom": "https://www.loom.com/v1/oembed?url={url}",
    "wistia": "https://fast.wistia.com/oembed?url={url}",
    "youtube": "https://www.youtube.com/oembed?format=json&url={url}",
    "vimeo": "https://vimeo.com/api/oembed.json?url={url}",
}
POSTER_HOST = {"loom": "cdn.loom.com", "wistia": "embed-ssl.wistia.com", "vimeo": "i.vimeocdn.com", "youtube": "i.ytimg.com"}


# ---------------------------------------------------------------------------
# What stops a turn, and what stops a file
# ---------------------------------------------------------------------------


class LostClaim(Exception):
    """40001: another run took the import after our claim expired. Nothing
    more is written for it."""


class TurnOver(Exception):
    """The import's turn ends here and it stays working, for a later run to
    resume: a heartbeat or an import-level call that failed (Supabase away),
    the roster being refreshed, the disk too full for the next file, or the
    45-minute mark. Never a file's own failure."""


class Ended(Exception):
    """The server ended the import (its requester lost the client)."""


class DriveDown(Exception):
    """Drive cannot be reached from here: a refresh token Google refused, a
    401 after one token refresh, or rate limits and 5xx after three tries."""


class NotFound(Exception):
    """404, or 403 for permissions, or not under the client's own folder."""


class FileFailed(Exception):
    def __init__(self, code: str, detail: str = ""):
        self.code = code
        super().__init__(f"{code}: {detail}" if detail else code)


def worker_name() -> str:
    host = re.sub(r"[^a-z0-9._-]", "-", socket.gethostname().lower())[:60] or "host"
    return f"editor-desk@{host}"


def token_refused(e: BaseException) -> bool:
    """An HttpError raised while minting the access token: Google answering
    400 invalid_grant for a revoked refresh token, or no token in the
    answer. It happens before any Drive call, so it is the import's, never a
    file's."""
    if not isinstance(e, http.HttpError):
        return False
    return getattr(e, "url", "") == TOKEN_URL or (e.status == 0 and str(e).startswith("Google refused"))


# ---------------------------------------------------------------------------
# The links (the same rules as the server and the browser, DRIVE-IMPORT.md 2)
# ---------------------------------------------------------------------------

_ID = r"[A-Za-z0-9_-]{10,200}"


def parse_drive_link(text: Optional[str]) -> dict[str, Any]:
    """One link, by DRIVE-IMPORT.md 2's rules, for the dry run. Tested against
    the shared cases (apps/client-success-cockpit/src/present/driveLink.cases.json)."""
    s = (text or "").strip(" \t\n\r\f\v")
    if not s:
        return {"ok": False, "code": "link_empty"}
    if len(s) > 2000 or not re.fullmatch(r"[ -~]+", s):
        return {"ok": False, "code": "link_bad"}
    rest = s
    m = re.match(r"([A-Za-z][A-Za-z0-9+.-]*):", s)
    if m:
        if m.group(1).lower() not in ("http", "https"):
            return {"ok": False, "code": "link_bad"}
        rest = s[len(m.group(1)) + 1:]
        if not rest.startswith("//"):
            return {"ok": False, "code": "link_bad"}
        rest = rest[2:]
    authority = re.match(r"[^/?#]*", rest).group(0)
    after = rest[len(authority):]
    if "@" in authority or ":" in authority:
        return {"ok": False, "code": "link_bad"}
    host = authority.lower()
    nofrag = after.split("#", 1)[0]
    path, _, query = nofrag.partition("?")

    def param(name: str) -> Optional[str]:
        for part in query.split("&"):
            if part.startswith(name + "="):
                return part[len(name) + 1:]
        return None

    rk = param("resourcekey")
    if rk is not None and not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", rk):
        rk = None

    def ok(fid: str, kind: str) -> dict[str, Any]:
        tail = f"resourcekey={rk}" if rk else ""
        link = {
            "folder": f"https://drive.google.com/drive/folders/{fid}" + (f"?{tail}" if tail else ""),
            "file": f"https://drive.google.com/file/d/{fid}/view" + (f"?{tail}" if tail else ""),
            "either": f"https://drive.google.com/open?id={fid}" + (f"&{tail}" if tail else ""),
        }[kind]
        return {"ok": True, "id": fid, "kind": kind, "resourceKey": rk, "link": link}

    def id_param() -> Optional[str]:
        v = param("id")
        return v if v and re.fullmatch(_ID, v) else None

    if host == "docs.google.com":
        docs = re.match(r"/(document|spreadsheets|presentation|forms|drawings)/", path)
        return {"ok": False, "code": "link_docs" if docs else "link_bad"}
    if host in ("drive.google.com", "www.drive.google.com"):
        m = re.fullmatch(rf"/drive(?:/u/[0-9])?(?:/mobile)?/folders/({_ID})/?", path)
        if m:
            return ok(m.group(1), "folder")
        m = re.fullmatch(rf"/file(?:/u/[0-9])?/d/({_ID})(?:/view|/edit|/preview|/)?", path)
        if m:
            return ok(m.group(1), "file")
        if path in ("/folderview", "/open", "/uc"):
            fid = id_param()
            if not fid:
                return {"ok": False, "code": "link_bad"}
            return ok(fid, {"/folderview": "folder", "/open": "either", "/uc": "file"}[path])
        if re.fullmatch(r"/drive(?:/u/[0-9])?(?:/(?:my-drive|shared-with-me|recent|starred|home|computers|search)?)?/?", path):
            return {"ok": False, "code": "link_page"}
        return {"ok": False, "code": "link_bad"}
    if host == "drive.usercontent.google.com" and path == "/download":
        fid = id_param()
        return ok(fid, "file") if fid else {"ok": False, "code": "link_bad"}
    return {"ok": False, "code": "link_bad"}


# ---------------------------------------------------------------------------
# What a file is
# ---------------------------------------------------------------------------


def is_candidate(f: dict[str, Any]) -> bool:
    mime = str(f.get("mimeType") or "")
    if mime == SHORTCUT_MIME or mime.startswith("application/vnd.google-apps."):
        return False
    name = str(f.get("name") or "").lower()
    return mime.startswith(("image/", "video/")) or name.endswith(MEDIA_EXT)


def is_video_entry(mime: str, name: str) -> bool:
    return mime.startswith("video/") or name.lower().endswith(VIDEO_EXT)


def sniff(head: bytes) -> Optional[str]:
    """The type from the first bytes (it wins over Drive's mimeType)."""
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if head.startswith(b"\x89PNG"):
        return "png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head[:4] == b"RIFF" and head[8:12] == b"AVI ":
        return "avi"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "matroska"  # WebM or Matroska: ffprobe's format_name tells them apart
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in (b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1"):
            return "heic"
        if brand == b"qt  ":
            return "quicktime"
        # iso3 to iso6 (CMAF and app exports) and 3GPP (older Android
        # phones) are MP4 too; their codecs decide whether it is converted.
        if brand in (b"isom", b"iso2", b"iso3", b"iso4", b"iso5", b"iso6", b"mp41", b"mp42", b"avc1",
                     b"M4V ", b"dash", b"3gp4", b"3gp5", b"3g2a"):
            return "mp4"
    return None


# ---------------------------------------------------------------------------
# The machine around it: ffmpeg, heif-convert, the disk (swapped in tests)
# ---------------------------------------------------------------------------


class Tools:
    """The binaries the run needs, behind one seam the tests replace."""

    def free_bytes(self, path: Path) -> int:
        return media.free_bytes(path)

    def probe(self, path: Path) -> dict[str, Any]:
        return media.probe(path, input_args=LOCAL_ONLY)

    def has(self, binary: str) -> bool:
        return media.has(binary)

    def heif_convert(self, src: Path, dest: Path) -> bool:
        """heif-convert only (ffmpeg before 7.1 decodes one tile of an
        iPhone's grid image and exits 0), 120 s."""
        if not self.has("heif-convert"):
            return False
        try:
            res = subprocess.run(["heif-convert", "-q", "90", str(src), str(dest)],
                                 timeout=120, capture_output=True, stdin=subprocess.DEVNULL, check=False)
        except subprocess.TimeoutExpired:
            return False
        return res.returncode == 0 and dest.exists() and dest.stat().st_size > 0

    def convert(self, src: Path, dest: Path, *, tick: Callable[[], None], limit: float, clock: Callable[[], float]) -> int:
        """The one conversion command, polled every 5 s so the claim keeps
        its heartbeat, killed after `limit` seconds (returns -9)."""
        cmd = [x.replace("{src}", str(src)).replace("{dest}", str(dest)) for x in FFMPEG_CONVERT]
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        start = clock()
        try:
            while True:
                try:
                    return proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    if clock() - start > limit:
                        proc.kill()
                        proc.wait()
                        return -9
                    tick()
        except BaseException:
            proc.kill()
            proc.wait()
            raise

    def poster(self, src: Path, ts: float, dest: Path) -> bool:
        return media.frame_at(src, ts, dest, width=POSTER_WIDTH, input_args=LOCAL_ONLY)


# ---------------------------------------------------------------------------
# One run
# ---------------------------------------------------------------------------


class Run:
    def __init__(
        self,
        cfg: Any,
        log: Callable[[str], None],
        sb: Any,
        drive: Any,
        *,
        worker: Optional[str] = None,
        tools: Optional[Tools] = None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        fetch: Callable[..., Any] = http.request,
    ):
        self.cfg = cfg
        self.log = log
        self.sb = sb
        self.drive = drive
        self.worker = worker or worker_name()
        self.tools = tools or Tools()
        self.clock = clock
        self.sleep = sleep
        self.fetch = fetch
        self.started = clock()
        self.last_beat = 0.0
        self.root = Path(cfg.scratch) / "deck-import"

    # ---- calls ------------------------------------------------------------
    def call(self, name: str, args: dict[str, Any], *, retry: bool = True) -> Any:
        """A worker function. 40001 is a lost claim, and only that."""
        try:
            return self.sb.rpc(name, {"p_worker": self.worker, **args}, retry=retry)
        except RpcError as e:
            if e.sqlstate == "40001":
                raise LostClaim(e.message) from None
            raise

    def beat(self, import_id: str, *, force: bool = False) -> None:
        """At most once a minute. Its errors are the import's: a Supabase
        blip mid-download must never fail a good file with a Drive sentence."""
        now = self.clock()
        if not force and now - self.last_beat < HEARTBEAT_EVERY:
            return
        self.last_beat = now
        try:
            self.call("cockpit_csm_launch_ads_import_heartbeat", {"p_import_id": import_id})
        except LostClaim:
            raise
        except Exception as e:  # noqa: BLE001 - any failed heartbeat (http.client's IncompleteRead too) is the turn's
            raise TurnOver(f"heartbeat: {http.scrub(str(e))[:160]}") from None

    def elapsed(self) -> float:
        return self.clock() - self.started

    # ---- the run ---------------------------------------------------------
    def run(self, limit: int = 3) -> dict[str, Any]:
        """One run, under the command's own lock (the review round): the
        cron line's flock guards cron from itself, but a run started by hand
        beside it would otherwise clear the scratch of the run that is
        mid-download. A second run says so and does nothing."""
        out: dict[str, Any] = {"imports": [], "posters": None}
        try:
            lock = open(Path(self.cfg.scratch) / "deck-import.lock", "a")
        except OSError as e:
            self.log(f"deck-import: its lock file can't be opened: {e}")
            out["skipped"] = "lock"
            return out
        try:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                self.log("deck-import: another run is working; this one does nothing")
                out["skipped"] = "running"
                return out
            return self._run(out, limit)
        finally:
            lock.close()

    def _run(self, out: dict[str, Any], limit: int) -> dict[str, Any]:
        # A run killed at the 50-minute ceiling skips its `finally`: its
        # scratch would otherwise pin the disk gate shut. Under the lock, so
        # nothing else of this command is using it.
        shutil.rmtree(self.root, ignore_errors=True)
        free = self.tools.free_bytes(Path(self.cfg.scratch))
        if free < DISK_FLOOR:
            self.log(f"deck-import: {round(free / 1024**3, 1)} GB free in scratch, waiting for 4 GB")
            out["skipped"] = "disk"
            return out
        while len(out["imports"]) < max(1, limit) and self.elapsed() < CLAIM_WINDOW:
            try:
                got = self.call("cockpit_csm_launch_ads_import_claim", {"p_peek": False}, retry=False)
            except (RpcError, http.HttpError, LostClaim) as e:
                self.log(f"deck-import: claim failed: {http.scrub(str(e))[:200]}")
                break
            if not isinstance(got, dict) or not got.get("import"):
                if isinstance(got, dict) and got.get("waiting"):
                    self.log(f"deck-import: waiting: {got['waiting']}")
                break
            out["imports"].append(self.work(got["import"]))
            if self.elapsed() >= STOP_AFTER:
                break
        if self.elapsed() < CLAIM_WINDOW:
            out["posters"] = self.posters()
        return out

    def work(self, imp: dict[str, Any]) -> dict[str, Any]:
        """One import's turn."""
        iid = str(imp["id"])
        summary: dict[str, Any] = {"id": iid, "status": "working"}
        self.last_beat = self.clock()
        # What the last import's plan learned about its files is not this
        # one's: a resumed import plans nothing, so it starts from empty.
        self.can_download: dict[str, bool] = {}
        self.parent_of: dict[str, str] = {}
        work_dir = self.root / str(uuid.UUID(iid))
        try:
            # A refresh token Google refused answers 400 before any Drive
            # call: the import says Drive can't be reached, at once.
            try:
                self.drive.token()
            except http.HttpError as e:
                raise DriveDown(str(e)) from None
            if imp.get("resumed"):
                files = list(imp.get("files") or [])
                keys = {imp.get("driveId"): imp.get("resourceKey")}
            else:
                planned, keys = self.resolve_and_plan(imp)
                if planned is None:
                    summary["status"] = "finished"
                    return summary
                files = list(planned.get("files") or [])
            for entry in files:
                if entry.get("status") not in ("queued", "working"):
                    continue
                if self.elapsed() >= STOP_AFTER:
                    raise TurnOver("45 minutes into the run")
                self.one_file(imp, entry, keys, work_dir)
            done = self.call("cockpit_csm_launch_ads_import_finish", {"p_import_id": iid, "p_code": None})
            summary.update(status="done", landed=(done or {}).get("landed"), failed=(done or {}).get("failed"))
        except LostClaim:
            summary["status"] = "lost"
        except Ended:
            summary["status"] = "ended"
        except DriveDown as e:
            self.log(f"deck-import {iid}: Drive can't be reached: {http.scrub(str(e))[:160]}")
            summary["status"] = self.finish_failed(iid, "drive_down")
        except NotFound as e:
            self.log(f"deck-import {iid}: can't open it: {http.scrub(str(e))[:160]}")
            summary["status"] = self.finish_failed(iid, "not_found")
        except TurnOver as e:
            self.log(f"deck-import {iid}: turn over, left working: {e}")
            summary["status"] = "working"
        except (RpcError, http.HttpError) as e:
            # An import-level call failed: it stays working, and a later run
            # resumes it once its claim expires.
            self.log(f"deck-import {iid}: left working: {http.scrub(str(e))[:200]}")
            summary["status"] = "working"
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)
        return summary

    def finish_failed(self, iid: str, code: str) -> str:
        try:
            self.call("cockpit_csm_launch_ads_import_finish", {"p_import_id": iid, "p_code": code})
            return code
        except LostClaim:
            return "lost"
        except (RpcError, http.HttpError) as e:
            self.log(f"deck-import {iid}: finish {code} failed: {http.scrub(str(e))[:160]}")
            return "working"

    # ---- Drive ------------------------------------------------------------
    def drive_call(self, fn: Callable[[], Any]) -> Any:
        """404 or 403 for permissions: NotFound. 401 after one token
        refresh, a refused token, 403 for rate limits after three tries (2,
        4 and 8 s), or 5xx after three: DriveDown."""
        refreshed = False
        limited = 0
        while True:
            try:
                return fn()
            except http.HttpError as e:
                if token_refused(e):
                    raise DriveDown(str(e)) from None
                body = (e.body or b"").decode("utf-8", "replace")
                if e.status == 404:
                    raise NotFound(str(e)) from None
                if e.status == 401:
                    if refreshed:
                        raise DriveDown(str(e)) from None
                    refreshed = True
                    self.drive.forget_token()
                    continue
                if e.status in (403, 429) and re.search(r"rateLimitExceeded|userRateLimitExceeded|quotaExceeded", body):
                    if limited == 3:
                        raise DriveDown(str(e)) from None
                    self.sleep(2 ** (limited + 1))
                    limited += 1
                    continue
                if e.status == 403:
                    raise NotFound(str(e)) from None
                if e.status >= 500 or e.status == 0:
                    raise DriveDown(str(e)) from None
                raise

    def client_folder(self, task_id: str) -> Optional[str]:
        """The client's own Drive folder, from their editor card. None when
        the card has none. A read that failed is not "no folder": the turn
        ends and the import stays working, so a Supabase blip never closes
        it as not_found (a final sentence telling the CSM to reshare)."""
        try:
            rows = self.sb.select("editor_clients", f"select=drive_url&task_id=eq.{http.quote(task_id)}")
        except Exception as e:  # noqa: BLE001 - any failed read is the turn's, never the link's
            raise TurnOver(f"the client's Drive folder was not read: {http.scrub(str(e))[:160]}") from None
        url = str((rows[0] if rows else {}).get("drive_url") or "")
        return parse_id(url) if url else None

    def owned_by_client(self, meta: dict[str, Any], task_id: str) -> bool:
        """The team's token reaches every client's folder, so the gate on the
        CSM's seat is not enough: the link must be the client's own share (no
        owner of ours, not in a shared drive), or sit under their own folder
        (at most 10 parents up). Otherwise a seat limited to one client could
        pull another client's or the team's files into its tray."""
        owners = [str(o.get("emailAddress") or "").lower() for o in (meta.get("owners") or []) if isinstance(o, dict)]
        if owners and not any(o.endswith("@maharamedia.com") for o in owners) and not meta.get("driveId"):
            return True
        root = self.client_folder(task_id)
        if not root:
            return False
        node = meta
        for _ in range(10):
            if str(node.get("id") or "") == root:
                return True
            parents = [p for p in (node.get("parents") or []) if p]
            if not parents:
                return False
            if root in parents:
                return True
            node = self.drive_call(lambda p=parents[0]: self.drive.get(p, fields="id,parents"))
        return False

    def media_in(self, folder_id: str, key: Optional[str]) -> tuple[list[dict[str, Any]], bool]:
        """A folder's own media, newest first, stopping once it gave 20."""
        items = self.drive_call(lambda: self.drive.list_folder(
            folder_id, fields=IMPORT_FIELDS, order_by="createdTime desc",
            q_extra=f" and mimeType != '{FOLDER_MIME}'", page_size=200, pages=4,
            resource_keys={folder_id: key},
            stop_after=lambda got: sum(1 for x in got if is_candidate(x)) >= 20,
        ))
        more = bool(getattr(self.drive, "more", False))
        return [x for x in items if is_candidate(x)], more

    def resolve_and_plan(self, imp: dict[str, Any]) -> tuple[Optional[dict[str, Any]], dict[str, Optional[str]]]:
        iid = str(imp["id"])
        did = str(imp["driveId"])
        rk = imp.get("resourceKey")
        meta = self.drive_call(lambda: self.drive.get(did, fields=IMPORT_FIELDS, resource_keys={did: rk}))
        # A shortcut is followed to its target once.
        if meta.get("mimeType") == SHORTCUT_MIME:
            sc = meta.get("shortcutDetails") or {}
            tid, tkey = sc.get("targetId"), sc.get("targetResourceKey")
            if not tid:
                raise NotFound("a shortcut with no target")
            meta = self.drive_call(lambda: self.drive.get(tid, fields=IMPORT_FIELDS, resource_keys={tid: tkey}))
            did, rk = str(tid), tkey
        if not meta or meta.get("trashed"):
            raise NotFound("trashed or empty")
        if not self.owned_by_client(meta, str(imp["taskId"])):
            self.log(f"deck-import {iid}: not the client's own share or under their folder")
            raise NotFound("outside the client's folder")
        keys: dict[str, Optional[str]] = {did: rk}
        if meta.get("mimeType") == FOLDER_MIME:
            kind = "folder"
            found, over = self.media_in(did, rk)
            subs = self.drive_call(lambda: self.drive.list_folder(
                did, fields="id,name,resourceKey,createdTime", order_by="createdTime desc",
                q_extra=f" and mimeType = '{FOLDER_MIME}'", page_size=20, pages=1, resource_keys={did: rk},
            ))
            for sub in subs:
                sid = str(sub.get("id") or "")
                if not sid:
                    continue
                keys[sid] = sub.get("resourceKey")
                more_files, more = self.media_in(sid, sub.get("resourceKey"))
                for f in more_files:
                    f["_parent"] = sid
                found.extend(more_files)
                over = over or more
            if not found:
                self.finish_or_raise(iid, "nothing_found")
                return None, keys
            # Newest first, then by name (two stable sorts).
            found.sort(key=lambda f: str(f.get("name") or ""))
            found.sort(key=lambda f: str(f.get("createdTime") or ""), reverse=True)
            over = over or len(found) > 20
            found = found[:20]
        else:
            kind = "file"
            if not is_candidate(meta):
                self.finish_or_raise(iid, "not_media")
                return None, keys
            found, over = [meta], False
        for f in found:
            if f.get("resourceKey"):
                keys[str(f["id"])] = f.get("resourceKey")
        self.can_download = {str(f["id"]): (f.get("capabilities") or {}).get("canDownload", True) is not False for f in found}
        self.parent_of = {str(f["id"]): f.get("_parent") or did for f in found}
        files = [{
            "id": str(f["id"]), "name": str(f.get("name") or f["id"]), "mime": self.plan_mime(f),
            # The plan takes 0 to 10^12; anything larger is over the cap anyway.
            "bytes": min(int(f["size"]), 10**12) if str(f.get("size") or "").isdigit() else None,
            "createdTime": f.get("createdTime"), "resourceKey": f.get("resourceKey"),
        } for f in found]
        planned = self.call("cockpit_csm_launch_ads_import_plan", {
            "p_import_id": iid, "p_kind": kind, "p_files": files, "p_over_limit": over,
        })
        return planned, keys

    @staticmethod
    def plan_mime(f: dict[str, Any]) -> str:
        """Drive's type when the plan takes it as it is (the server refuses
        anything but `^(image|video)/[a-z0-9.+-]{1,60}$`, and one refused
        entry would refuse the whole plan); else a type from the name. The
        bytes decide what the file really is, after the download."""
        mime = str(f.get("mimeType") or "").strip().lower()
        if PLAN_MIME.fullmatch(mime):
            return mime
        name = str(f.get("name") or "").lower()
        if mime.startswith("video/") or name.endswith(VIDEO_EXT):
            return "video/" + ("quicktime" if name.endswith(".mov") else "mp4")
        return "image/" + ("heic" if name.endswith((".heic", ".heif")) else "jpeg")

    def finish_or_raise(self, iid: str, code: str) -> None:
        self.call("cockpit_csm_launch_ads_import_finish", {"p_import_id": iid, "p_code": code})

    # ---- one file ---------------------------------------------------------
    def one_file(self, imp: dict[str, Any], entry: dict[str, Any], keys: dict[str, Optional[str]], work_dir: Path) -> None:
        """One file, inside its own try: a failure maps to its stage's code
        (bring_in names it), is reported, and the next file goes on. Only
        the import-level stops leave."""
        iid = str(imp["id"])
        fid = str(entry["driveId"])
        name = str(entry.get("name") or fid)
        work = work_dir / fid
        try:
            self.bring_in(imp, entry, keys, work)
        except FileFailed as f:
            self.fail_file(iid, fid, f.code, name, str(f))
        except (LostClaim, TurnOver, Ended, DriveDown, NotFound):
            raise
        except Exception as e:  # noqa: BLE001 - one file's failure never stops the others
            self.fail_file(iid, fid, "storage", name, f"{type(e).__name__}: {e}")
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def fail_file(self, iid: str, fid: str, code: str, name: str, detail: str) -> None:
        self.log(f"deck-import {iid}: {name}: {code}: {http.scrub(detail)[:200]}")
        try:
            self.call("cockpit_csm_launch_ads_import_file_failed", {
                "p_import_id": iid, "p_drive_file_id": fid, "p_code": code})
        except LostClaim:
            raise
        except (RpcError, http.HttpError) as e:
            raise TurnOver(f"file_failed: {http.scrub(str(e))[:160]}") from None

    def bring_in(self, imp: dict[str, Any], entry: dict[str, Any], keys: dict[str, Optional[str]], work: Path) -> bool:
        iid = str(imp["id"])
        task = str(imp["taskId"])
        fid = str(entry["driveId"])
        name = str(entry.get("name") or fid)
        mime = str(entry.get("mime") or "")
        video = is_video_entry(mime, name)
        cap = VIDEO_CAP if video else PICTURE_CAP
        size = entry.get("bytes")
        if isinstance(size, int) and size > cap:
            raise FileFailed("too_big", f"{size} bytes by Drive's size")
        if getattr(self, "can_download", {}).get(fid) is False:
            raise FileFailed("download", "Drive says it cannot be downloaded")
        if self.tools.free_bytes(Path(self.cfg.scratch)) - int(size or 0) < DISK_FLOOR:
            raise TurnOver(f"not enough disk for {name}")
        work.mkdir(parents=True, exist_ok=True)
        raw = work / "in.bin"
        file_keys = {fid: entry.get("resourceKey")}
        parent = getattr(self, "parent_of", {}).get(fid) or imp.get("driveId")
        if parent and keys.get(parent):
            file_keys[str(parent)] = keys[parent]
        # Download.
        try:
            self.drive.download(
                fid, str(raw), max_bytes=cap, resource_keys=file_keys, timeout=60,
                deadline=self.clock() + FILE_SECONDS, on_chunk=lambda n: self.beat(iid),
            )
        except (LostClaim, TurnOver):
            raise
        except http.TooLarge:
            raise FileFailed("too_big", "past the cap while downloading") from None
        except http.HttpError as e:
            if token_refused(e):
                raise DriveDown(str(e)) from None
            raise FileFailed("download", str(e)) from None
        except Exception as e:  # noqa: BLE001 - urllib's own errors included
            raise FileFailed("download", f"{type(e).__name__}: {e}") from None
        # Sniff, convert, probe, poster.
        try:
            facts = self.media_facts(iid, raw, work, name)
        except (FileFailed, LostClaim, TurnOver):
            raise
        except Exception as e:  # noqa: BLE001
            raise FileFailed("heic" if getattr(self, "_heic", False) else "unplayable", f"{type(e).__name__}: {e}") from None
        # Reserve.
        try:
            res = self.call("cockpit_csm_launch_ads_import_file_reserve", {
                "p_import_id": iid, "p_drive_file_id": fid, "p_mime": facts["mime"], "p_bytes": facts["bytes"],
                "p_width": facts.get("width"), "p_height": facts.get("height"), "p_seconds": facts.get("seconds"),
                "p_poster_mime": "image/jpeg" if facts.get("poster") else None,
                "p_poster_bytes": facts["poster"].stat().st_size if facts.get("poster") else None,
                "p_note": facts.get("note"),
            })
        except RpcError as e:
            if e.sqlstate == "55006":
                raise TurnOver("the client roster is being refreshed") from None
            raise FileFailed("storage", str(e)) from None
        except http.HttpError as e:
            raise TurnOver(f"reserve: {http.scrub(str(e))[:160]}") from None
        res = res or {}
        if res.get("stopped"):
            raise Ended("access revoked")
        if res.get("done") or res.get("skipped") or res.get("failed"):
            return True
        ad = str(res.get("adId") or "")
        ok_path = re.compile(PATH_OK.format(task=re.escape(task), ad=re.escape(ad)))
        posters = [res.get("posterPath")] if facts.get("poster") else []
        # fullmatch: `$` alone would let a path end in a newline.
        if not ad or not ok_path.fullmatch(str(res.get("path") or "")) or any(not ok_path.fullmatch(str(p or "")) for p in posters):
            raise FileFailed("storage", "the reserved path is not the row's own")
        # Upload, the file then the poster.
        upsert = bool(res.get("resumed"))
        try:
            for path, local, ctype in [(res["path"], facts["file"], facts["mime"])] + (
                    [(res["posterPath"], facts["poster"], "image/jpeg")] if facts.get("poster") else []):
                self.sb.upload_file(BUCKET, str(path), str(local), ctype, upsert=upsert,
                                    on_chunk=lambda n: self.beat(iid))
        except (LostClaim, TurnOver):
            raise
        except StorageTooLarge:
            raise FileFailed("too_big", "Storage refused its size") from None
        except Exception as e:  # noqa: BLE001
            raise FileFailed("storage", f"{type(e).__name__}: {e}") from None
        # Landed: the server checks Storage's own metadata.
        try:
            self.call("cockpit_csm_launch_ads_import_file_landed", {"p_import_id": iid, "p_drive_file_id": fid})
        except RpcError as e:
            raise FileFailed("storage", str(e)) from None
        except http.HttpError as e:
            raise TurnOver(f"landed: {http.scrub(str(e))[:160]}") from None
        return True

    def media_facts(self, iid: str, raw: Path, work: Path, name: str) -> dict[str, Any]:
        self._heic = False
        with open(raw, "rb") as fh:
            head = fh.read(32)
        kind = sniff(head)
        if kind is None:
            raise FileFailed("wrong_type", "not a picture or a video by its bytes")
        size = raw.stat().st_size
        if kind == "heic":
            self._heic = True
            src = work / "in.heic"
            raw.rename(src)
            out = work / "out.jpg"
            if not self.tools.heif_convert(src, out):
                raise FileFailed("heic", "heif-convert missing, failed or timed out")
            self._heic = False
            kind, raw, size = "jpeg", out, out.stat().st_size
        if kind in ("jpeg", "png", "webp"):
            if size > LANDING_CAP:
                raise FileFailed("too_big", "a picture over 150 MB")
            ext = {"jpeg": "jpg", "png": "png", "webp": "webp"}[kind]
            final = work / f"in.{ext}"
            if raw != final:
                raw.rename(final)
            p = self.tools.probe(final)
            return {"file": final, "mime": f"image/{kind}", "bytes": final.stat().st_size,
                    "width": p.get("width"), "height": p.get("height")}
        # A video.
        ext = {"mp4": "mp4", "quicktime": "mov", "matroska": "mkv", "avi": "avi"}[kind]
        src = work / f"in.{ext}"
        raw.rename(src)
        p = self.tools.probe(src)
        if not p.get("width") or not p.get("video_codec"):
            raise FileFailed("unplayable", "no video stream")
        seconds = float(p.get("seconds") or 0) or None
        if seconds and seconds > LAND_LONGEST:
            raise FileFailed("too_big", "over an hour")
        fmt = str(p.get("format_name") or "")
        if kind == "matroska" and "webm" in fmt.split(",") and p.get("video_codec") in ("vp8", "vp9", "av1"):
            kind = "webm"
        w, h = int(p.get("width") or 0), int(p.get("height") or 0)
        if p.get("rotation") in (90, 270):
            w, h = h, w
        codec = str(p.get("video_codec") or "")
        convert = (size > LANDING_CAP or codec == "hevc" or codec not in PLAYABLE_CODECS
                   or kind in ("avi", "matroska") or min(w, h) > 1080)
        note = None
        mime = {"mp4": "video/mp4", "quicktime": "video/quicktime", "webm": "video/webm"}.get(kind, "")
        final = src
        if convert:
            if seconds and seconds > CONVERT_LONGEST:
                raise FileFailed("too_big", "over five minutes and needs converting")
            out = work / "out.mp4"
            code = self.tools.convert(src, out, tick=lambda: self.beat(iid), limit=FILE_SECONDS, clock=self.clock)
            if code != 0 or not out.exists():
                raise FileFailed("unplayable", f"ffmpeg exited {code}")
            q = self.tools.probe(out)
            if not q.get("width") or not q.get("video_codec"):
                raise FileFailed("unplayable", "no video stream after converting")
            if out.stat().st_size > LANDING_CAP:
                raise FileFailed("too_big", "over 150 MB after converting")
            final, mime, note = out, "video/mp4", "converted"
            w, h = int(q.get("width") or 0), int(q.get("height") or 0)
            if q.get("rotation") in (90, 270):
                w, h = h, w
            seconds = float(q.get("seconds") or 0) or seconds
        poster = work / "poster.jpg"
        if not self.tools.poster(final, min(1.0, (seconds or 0) * 0.1), poster):
            raise FileFailed("unplayable", "no poster frame")
        return {"file": final, "mime": mime, "bytes": final.stat().st_size, "width": w or None,
                "height": h or None, "seconds": round(seconds, 2) if seconds else None,
                "poster": poster, "note": note}

    # ---- posters (VIDEOS.md 9) ---------------------------------------------
    def posters(self) -> dict[str, Any]:
        out = {"due": 0, "saved": 0, "none": 0}
        try:
            due = self.call("cockpit_csm_deck_video_posters_due", {})
        except (RpcError, http.HttpError, LostClaim) as e:
            self.log(f"deck-import: posters not read: {http.scrub(str(e))[:160]}")
            return out
        slots = (due or {}).get("due") or []
        out["due"] = len(slots)
        for slot in slots[:POSTERS_AT_MOST]:
            poster = None
            try:
                poster = self.find_poster(str(slot.get("provider") or ""), str(slot.get("url") or ""))
            except Exception as e:  # noqa: BLE001 - a failure leaves the slot for a day
                self.log(f"deck-import: poster for {slot.get('deck')}:{slot.get('slotKey')}: {http.scrub(str(e))[:160]}")
            try:
                self.call("cockpit_csm_deck_video_poster_save", {
                    "p_deck": slot.get("deck"), "p_slot_key": slot.get("slotKey"), "p_lang": slot.get("lang"),
                    "p_url": slot.get("url"), "p_poster_url": poster,
                })
            except (RpcError, http.HttpError, LostClaim) as e:
                self.log(f"deck-import: poster not saved: {http.scrub(str(e))[:160]}")
                continue
            out["saved" if poster else "none"] += 1
        return out

    def find_poster(self, provider: str, url: str) -> Optional[str]:
        tmpl = OEMBED.get(provider)
        host = POSTER_HOST.get(provider)
        if not tmpl or not host:
            return None
        _, _, body = self.fetch("GET", tmpl.format(url=http.quote(url)), timeout=20, retries=0)
        data = json.loads(body.decode("utf-8")) if body else {}
        thumb = str((data or {}).get("thumbnail_url") or "")
        if provider == "loom" and thumb.endswith(".gif"):
            # The GIF moves and runs to megabytes; its JPEG sibling is the still.
            thumb = thumb[:-4] + ".jpg"
        m = re.match(r"https://([^/?#]+)/", thumb)
        if not m or m.group(1).lower() != host:
            return None
        _, headers, _ = self.fetch("GET", thumb, timeout=20, retries=0)
        ctype = str({k.lower(): v for k, v in (headers or {}).items()}.get("content-type") or "").split(";")[0].strip()
        return thumb if ctype in ("image/jpeg", "image/png", "image/webp") else None

    # ---- the dry run --------------------------------------------------------
    def dry_run(self, link: str) -> dict[str, Any]:
        """What a link would bring in: read-only (no claim, no plan, no write)."""
        p = parse_drive_link(link)
        if not p.get("ok"):
            return {"link": link, "refused": p.get("code")}
        did, rk = p["id"], p.get("resourceKey")
        try:
            meta = self.drive_call(lambda: self.drive.get(did, fields=IMPORT_FIELDS, resource_keys={did: rk}))
        except NotFound:
            return {"link": p["link"], "result": "not_found"}
        except DriveDown:
            return {"link": p["link"], "result": "drive_down"}
        if meta.get("mimeType") == FOLDER_MIME:
            files, over = self.media_in(did, rk)
            return {"link": p["link"], "kind": "folder", "files": [f.get("name") for f in files[:20]],
                    "overLimit": over or len(files) > 20}
        return {"link": p["link"], "kind": "file", "files": [meta.get("name")] if is_candidate(meta) else [],
                "result": None if is_candidate(meta) else "not_media"}


def run(cfg: Any, log: Callable[[str], None], sb: Any, drive: Any, *, limit: int = 3) -> dict[str, Any]:
    return Run(cfg, log, sb, drive).run(limit=limit)


def doctor_heic(tools: Optional[Tools] = None, fixture: Optional[Path] = None) -> tuple[bool, str]:
    """heif-convert turns the 1024 x 1024 grid fixture into a whole JPEG."""
    t = tools or Tools()
    if not t.has("heif-convert"):
        return False, "missing: iPhone photos (HEIC) fail with a sentence; install libheif-examples"
    src = fixture or Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "grid-1024.heic"
    if not src.exists():
        return False, f"the fixture {src.name} is missing"
    out = Path(os.environ.get("TMPDIR", "/tmp")) / f"deck-import-doctor-{os.getpid()}.jpg"
    try:
        if not t.heif_convert(src, out):
            return False, "heif-convert failed on the grid fixture"
        p = t.probe(out)
        w, h = p.get("width"), p.get("height")
        if (w, h) != (1024, 1024):
            return False, f"heif-convert wrote {w} x {h} for a 1024 x 1024 grid"
        return True, "heif-convert, grid images whole"
    finally:
        try:
            out.unlink()
        except OSError:
            pass
