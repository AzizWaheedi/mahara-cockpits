"""The client success Drive imports (docs/csm-decks/DRIVE-IMPORT.md 7).

A fake Drive, a fake Supabase that records every RPC and holds what was
uploaded, and fake tools for ffprobe, ffmpeg and heif-convert: no network,
no binaries.
"""
from __future__ import annotations

import io
import json
import os
import subprocess
import tempfile
import unittest
import urllib.error
from pathlib import Path
from typing import Any, Optional
from unittest import mock

os.environ.setdefault("DESK_HOME", "/tmp/desk-unit")
from desk import deck_import as di  # noqa: E402
from desk import http, media  # noqa: E402
from desk import supabase as supabase_mod  # noqa: E402
from desk.config import Config  # noqa: E402
from desk.drive import FOLDER_MIME, IMPORT_FIELDS, TOKEN_URL, resource_key_header  # noqa: E402
from desk.supabase import RpcError, StorageTooLarge  # noqa: E402

TASK = "86c1abcde"
IID = "6f0c1e2a-0000-4000-8000-000000000001"
ROOT = "1RootFolder0000000000"
CLIENT_FOLDER = "1ClientFolder00000000"
MP4 = b"\x00\x00\x00\x18ftypmp42"
MOV = b"\x00\x00\x00\x14ftypqt  "
HEIC = b"\x00\x00\x00\x18ftypheic"
JPEG = b"\xff\xd8\xff\xe0"
MKV = b"\x1a\x45\xdf\xa3"
PDF = b"%PDF-1.7"
GB = 1024**3


def cfg_in(tmp: str) -> Config:
    c = Config.from_env()
    c.home = Path(tmp)
    c.scratch = Path(tmp) / "scratch"
    c.out_dir = Path(tmp) / "out"
    c.state_path = Path(tmp) / "state.json"
    c.ensure_dirs()
    return c


def media_file(fid: str, name: str, *, mime: str = "video/mp4", size: int = 5_000_000,
               created: str = "2026-10-18T09:00:00Z", key: Optional[str] = None, **extra: Any) -> dict[str, Any]:
    f = {"id": fid, "name": name, "mimeType": mime, "size": str(size), "createdTime": created,
         "capabilities": {"canDownload": True}, "owners": [{"emailAddress": "owner@client.example"}]}
    if key:
        f["resourceKey"] = key
    f.update(extra)
    return f


class FakeDrive:
    def __init__(self, *, folders: Optional[dict[str, list[dict[str, Any]]]] = None,
                 meta: Optional[dict[str, dict[str, Any]]] = None, content: Optional[dict[str, bytes]] = None):
        self.folders = folders or {}
        self.meta = meta or {}
        self.content = content or {}
        self.lists: list[dict[str, Any]] = []
        self.downloads: list[dict[str, Any]] = []
        self.token_error: Optional[Exception] = None
        self.get_error: dict[str, Exception] = {}
        self.download_error: dict[str, Exception] = {}
        self.download_seconds: dict[str, int] = {}
        self.more = False
        self.forgot = 0

    def token(self) -> str:
        if self.token_error:
            raise self.token_error
        return "t"

    def forget_token(self) -> None:
        self.forgot += 1

    def get(self, file_id: str, *, fields: str = "", resource_keys: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        if file_id in self.get_error:
            raise self.get_error[file_id]
        if file_id in self.meta:
            return self.meta[file_id]
        if file_id in self.folders:
            return {"id": file_id, "name": file_id, "mimeType": FOLDER_MIME,
                    "owners": [{"emailAddress": "owner@client.example"}]}
        raise http.HttpError(404, "File not found")

    def list_folder(self, folder_id: str, *, pages: int = 4, fields: str = "", order_by: str = "",
                    q_extra: str = "", page_size: int = 200, resource_keys: Optional[dict[str, Any]] = None,
                    stop_after: Any = None) -> list[dict[str, Any]]:
        self.lists.append({"folder": folder_id, "fields": fields, "order_by": order_by, "q_extra": q_extra,
                           "page_size": page_size, "pages": pages, "keys": dict(resource_keys or {})})
        items = list(self.folders.get(folder_id, []))
        want_folders = "mimeType = " in q_extra
        items = [x for x in items if (x.get("mimeType") == FOLDER_MIME) == want_folders]
        items.sort(key=lambda x: str(x.get("createdTime") or ""), reverse=True)
        cap = page_size * pages
        self.more = len(items) > cap
        return items[:cap]

    def download(self, file_id: str, dest: str, *, max_bytes: int, resource_keys: Optional[dict[str, Any]] = None,
                 timeout: float = 0, deadline: Optional[float] = None, on_chunk: Any = None) -> int:
        self.downloads.append({"id": file_id, "keys": dict(resource_keys or {}), "max_bytes": max_bytes,
                               "timeout": timeout, "deadline": deadline})
        if file_id in self.download_error:
            raise self.download_error[file_id]
        blob = self.content.get(file_id, MP4)
        with open(dest, "wb") as fh:
            fh.write(blob)
        if on_chunk:
            for _ in range(self.download_seconds.get(file_id, 1)):
                on_chunk(len(blob))
        if len(blob) > max_bytes:
            raise http.TooLarge(0, "too large")
        return len(blob)


class FakeSb:
    """The worker's RPCs with the server's answers, in memory."""

    def __init__(self, imports: Optional[list[dict[str, Any]]] = None):
        self.queue = list(imports or [])
        self.imports: dict[str, dict[str, Any]] = {}
        self.calls: list[tuple[str, dict[str, Any], bool]] = []
        self.in_tray: set[str] = set()
        self.uploads: list[dict[str, Any]] = []
        self.upload_answer: Any = "uploaded"
        self.errors: dict[str, Exception] = {}
        self.client_folder: Optional[str] = CLIENT_FOLDER
        self.poster_due: list[dict[str, Any]] = []

    def names(self) -> list[str]:
        return [c[0].replace("cockpit_csm_launch_ads_import_", "").replace("cockpit_csm_deck_video_", "") for c in self.calls]

    def select(self, table: str, params: str) -> list[dict[str, Any]]:
        if table == "editor_clients" and self.client_folder:
            return [{"drive_url": f"https://drive.google.com/drive/folders/{self.client_folder}"}]
        return []

    def rpc(self, name: str, args: dict[str, Any], *, retry: bool = True) -> Any:
        self.calls.append((name, args, retry))
        short = name.replace("cockpit_csm_launch_ads_import_", "")
        if short in self.errors:
            err = self.errors[short]
            if isinstance(err, list):
                e = err.pop(0)
                if e is not None:
                    raise e
            else:
                raise err
        if short == "claim":
            if not self.queue:
                return {"import": None, "queued": 0}
            imp = self.queue.pop(0)
            imp.setdefault("status", "working")
            self.imports[imp["id"]] = imp
            return {"import": imp, "queued": len(self.queue)}
        imp = self.imports.get(str(args.get("p_import_id")))
        if short == "heartbeat":
            return None
        if short == "plan":
            files = []
            for f in args["p_files"]:
                files.append({"driveId": f["id"], "name": f["name"], "mime": f["mime"], "bytes": f["bytes"],
                              "resourceKey": f.get("resourceKey"), "status": "skipped" if f["id"] in self.in_tray else "queued",
                              "adId": None, "note": None})
            imp.update(files=files, found=len(files), kind=args["p_kind"], overLimit=args["p_over_limit"])
            return imp
        entry = None
        if imp and args.get("p_drive_file_id"):
            entry = next((e for e in imp["files"] if e["driveId"] == args["p_drive_file_id"]), None)
        if short == "file_reserve":
            if entry["status"] in ("landed", "skipped", "failed"):
                return {"done": True}
            resumed = bool(entry.get("adId"))
            ad = entry.get("adId") or f"00000000-0000-4000-8000-{len(self.calls):012d}"
            ext = di.EXT[args["p_mime"]]
            entry.update(status="working", adId=ad, note=args["p_note"],
                         reserved={k: v for k, v in args.items() if k.startswith("p_")})
            return {"adId": ad, "path": f"{imp['taskId']}/{ad}.{ext}",
                    "posterPath": f"{imp['taskId']}/{ad}-poster.jpg" if args["p_poster_mime"] else None, "resumed": resumed}
        if short == "file_landed":
            entry["status"] = "landed"
            return imp
        if short == "file_failed":
            entry.update(status="failed", code=args["p_code"])
            return imp
        if short == "finish":
            imp.update(status="failed" if args["p_code"] else "done", code=args["p_code"],
                       landed=sum(1 for e in imp.get("files") or [] if e["status"] == "landed"),
                       failed=sum(1 for e in imp.get("files") or [] if e["status"] == "failed"))
            return imp
        if name == "cockpit_csm_deck_video_posters_due":
            return {"due": self.poster_due}
        if name == "cockpit_csm_deck_video_poster_save":
            return {"saved": True, "posterUrl": args["p_poster_url"]}
        raise AssertionError(f"unexpected rpc {name}")

    def upload_file(self, bucket: str, path: str, file_path: str, content_type: str, *, upsert: bool = False,
                    on_chunk: Any = None) -> str:
        self.uploads.append({"bucket": bucket, "path": path, "type": content_type, "upsert": upsert,
                             "bytes": os.path.getsize(file_path)})
        if isinstance(self.upload_answer, Exception):
            raise self.upload_answer
        return self.upload_answer


class FakeTools(di.Tools):
    def __init__(self):
        self.free = 100 * GB
        self.probes: dict[bytes, dict[str, Any]] = {
            MP4: {"width": 1080, "height": 1920, "seconds": 30.0, "video_codec": "h264", "format_name": "mov,mp4,m4a"},
            MOV: {"width": 1080, "height": 1920, "seconds": 30.0, "video_codec": "h264", "format_name": "mov,mp4,m4a"},
            JPEG: {"width": 1080, "height": 1350},
            MKV: {"width": 1920, "height": 1080, "seconds": 40.0, "video_codec": "h264", "format_name": "matroska,webm"},
        }
        self.converted: dict[str, Any] = {"width": 1080, "height": 1920, "seconds": 30.0, "video_codec": "h264",
                                          "format_name": "mov,mp4,m4a"}
        self.convert_code = 0
        self.convert_size = 1000
        self.conversions: list[list[str]] = []
        self.heif = True
        self.probe_error: Optional[Exception] = None

    def free_bytes(self, path: Path) -> int:
        return self.free

    def has(self, binary: str) -> bool:
        return binary != "heif-convert" or self.heif

    def probe(self, path: Path) -> dict[str, Any]:
        if self.probe_error:
            raise self.probe_error
        if path.name == "out.mp4":
            return dict(self.converted)
        head = path.read_bytes()[:12]
        for magic, p in self.probes.items():
            if head.startswith(magic):
                return dict(p)
        return {"width": None, "video_codec": None}

    def heif_convert(self, src: Path, dest: Path) -> bool:
        if not self.heif:
            return False
        dest.write_bytes(JPEG + b"converted")
        return True

    def convert(self, src: Path, dest: Path, *, tick: Any, limit: float, clock: Any) -> int:
        self.conversions.append([x.replace("{src}", str(src)).replace("{dest}", str(dest)) for x in di.FFMPEG_CONVERT])
        tick()
        if self.convert_code == 0:
            dest.write_bytes(MP4 + b"\x00" * self.convert_size)
        return self.convert_code

    def poster(self, src: Path, ts: float, dest: Path) -> bool:
        dest.write_bytes(JPEG + b"poster")
        return True


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def an_import(**extra: Any) -> dict[str, Any]:
    imp = {"id": IID, "taskId": TASK, "driveId": ROOT, "kind": "folder", "resourceKey": None,
           "resumed": False, "files": [], "found": None}
    imp.update(extra)
    return imp


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = cfg_in(self.tmp.name)
        self.logs: list[str] = []
        self.clock = Clock()
        self.tools = FakeTools()
        self.sleeps: list[float] = []

    def tearDown(self):
        self.tmp.cleanup()

    def run_with(self, drive: FakeDrive, sb: FakeSb, limit: int = 3) -> dict[str, Any]:
        r = di.Run(self.cfg, self.logs.append, sb, drive, worker="editor-desk@test", tools=self.tools,
                   clock=self.clock, sleep=self.sleeps.append)
        return r.run(limit=limit)


class Listing(Base):
    def test_a_folder_of_25_two_docs_and_a_subfolder_of_3_gives_the_newest_20_across_both(self):
        own = [media_file(f"1Own{i:08d}xx", f"own-{i:02d}.mp4", created=f"2026-10-{i % 28 + 1:02d}T10:00:00Z") for i in range(25)]
        docs = [media_file(f"1Doc{i:08d}xx", f"brief-{i}", mime="application/vnd.google-apps.document") for i in range(2)]
        sub = {"id": "1SubFolder000000000", "name": "site", "mimeType": FOLDER_MIME, "createdTime": "2026-10-01T00:00:00Z"}
        subs = [media_file(f"1Sub{i:08d}xx", f"site-{i}.jpg", mime="image/jpeg", created="2026-10-29T10:00:00Z") for i in range(3)]
        drive = FakeDrive(folders={ROOT: own + docs + [sub], "1SubFolder000000000": subs},
                          content={f["id"]: MP4 for f in own} | {f["id"]: JPEG for f in subs})
        sb = FakeSb([an_import()])
        self.run_with(drive, sb)
        plan = next(c for c in sb.calls if c[0].endswith("_plan"))[1]
        ids = [f["id"] for f in plan["p_files"]]
        self.assertEqual(len(ids), 20)
        self.assertTrue(plan["p_over_limit"])
        self.assertTrue(all(i.startswith("1Sub") for i in ids[:3]), "the subfolder's newer files come first")
        self.assertFalse(any(i.startswith("1Doc") for i in ids))
        media_lists = [x for x in drive.lists if "!=" in x["q_extra"]]
        self.assertTrue(all(x["order_by"] == "createdTime desc" and x["fields"] == IMPORT_FIELDS for x in media_lists))
        self.assertEqual(sb.imports[IID]["status"], "done")

    def test_a_child_with_its_own_resource_key_sends_it_and_the_folders_on_download(self):
        child = media_file("1Child000000000000", "reel.mp4", key="0-childkey")
        drive = FakeDrive(folders={ROOT: [child]})
        sb = FakeSb([an_import(resourceKey="0-rootkey")])
        self.run_with(drive, sb)
        self.assertEqual(drive.downloads[0]["keys"], {"1Child000000000000": "0-childkey", ROOT: "0-rootkey"})
        self.assertEqual(resource_key_header({"a": "1", "b": None, "c": "3"}),
                         {"X-Goog-Drive-Resource-Keys": "a/1,c/3"})
        self.assertEqual(sb.imports[IID]["files"][0]["status"], "landed")

    def test_a_file_link_to_a_pdf_is_not_media_and_an_empty_folder_is_nothing_found(self):
        drive = FakeDrive(meta={"1Pdf0000000000000": media_file("1Pdf0000000000000", "quote.pdf", mime="application/pdf")})
        sb = FakeSb([an_import(driveId="1Pdf0000000000000", kind="file")])
        self.run_with(drive, sb)
        self.assertEqual(sb.imports[IID]["code"], "not_media")
        drive = FakeDrive(folders={ROOT: []})
        sb = FakeSb([an_import()])
        self.run_with(drive, sb)
        self.assertEqual(sb.imports[IID]["code"], "nothing_found")

    def test_404_and_403_are_not_found(self):
        for status in (404, 403):
            drive = FakeDrive()
            drive.get_error[ROOT] = http.HttpError(status, "no", b'{"error":{"reason":"notFound"}}')
            sb = FakeSb([an_import()])
            self.run_with(drive, sb)
            self.assertEqual(sb.imports[IID]["code"], "not_found", status)

    def test_a_revoked_refresh_token_is_drive_down_and_nothing_is_left_queued_or_working(self):
        drive = FakeDrive(folders={ROOT: [media_file("1A00000000000000", "a.mp4")]})
        drive.token_error = http.HttpError(400, '{"error":"invalid_grant"}', b'{"error":"invalid_grant"}', TOKEN_URL)
        sb = FakeSb([an_import()])
        self.run_with(drive, sb)
        self.assertEqual(sb.imports[IID]["status"], "failed")
        self.assertEqual(sb.imports[IID]["code"], "drive_down")
        self.assertNotIn("plan", sb.names())
        self.assertEqual(drive.downloads, [])

    def test_a_token_refused_mid_import_ends_the_import_drive_down_not_the_file(self):
        drive = FakeDrive(folders={ROOT: [media_file("1A00000000000000", "a.mp4"), media_file("1B00000000000000", "b.mp4")]})
        drive.download_error["1A00000000000000"] = http.HttpError(0, "Google refused the refresh token")
        sb = FakeSb([an_import()])
        self.run_with(drive, sb)
        self.assertEqual(sb.imports[IID]["code"], "drive_down")
        self.assertNotIn("file_failed", sb.names())

    def test_rate_limits_are_tried_three_times_then_drive_down(self):
        drive = FakeDrive()
        drive.get_error[ROOT] = http.HttpError(403, "limit", b'{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}')
        sb = FakeSb([an_import()])
        self.run_with(drive, sb)
        self.assertEqual(self.sleeps, [2, 4, 8])
        self.assertEqual(sb.imports[IID]["code"], "drive_down")

    def test_a_folder_outside_the_clients_own_folder_and_owned_by_the_team_is_not_found(self):
        team = {"id": ROOT, "name": "Hiring", "mimeType": FOLDER_MIME, "owners": [{"emailAddress": "ops@maharamedia.com"}],
                "parents": ["1TeamDrive000000000"]}
        drive = FakeDrive(folders={ROOT: [media_file("1A00000000000000", "a.mp4")]},
                          meta={ROOT: team, "1TeamDrive000000000": {"id": "1TeamDrive000000000", "parents": []}})
        sb = FakeSb([an_import()])
        self.run_with(drive, sb)
        self.assertEqual(sb.imports[IID]["code"], "not_found")
        self.assertEqual(drive.downloads, [])

    def test_a_failed_read_of_the_clients_folder_leaves_the_import_working_never_not_found(self):
        team = {"id": ROOT, "name": "Reels", "mimeType": FOLDER_MIME, "owners": [{"emailAddress": "ops@maharamedia.com"}],
                "parents": ["1Mid000000000000000"]}
        drive = FakeDrive(folders={ROOT: [media_file("1A00000000000000", "a.mp4")]}, meta={ROOT: team})
        sb = FakeSb([an_import()])

        def select(table: str, params: str) -> list[dict[str, Any]]:
            raise http.HttpError(503, "service unavailable")

        sb.select = select  # type: ignore[method-assign]
        out = self.run_with(drive, sb)
        self.assertEqual(out["imports"][0]["status"], "working")
        self.assertNotIn("finish", sb.names())
        self.assertEqual(drive.downloads, [])

    def test_a_subfolder_of_the_clients_folder_lands_even_when_the_team_owns_it(self):
        sub = {"id": ROOT, "name": "Reels", "mimeType": FOLDER_MIME, "owners": [{"emailAddress": "ops@maharamedia.com"}],
               "parents": ["1Mid000000000000000"]}
        drive = FakeDrive(folders={ROOT: [media_file("1A00000000000000", "a.mp4")]},
                          meta={ROOT: sub, "1Mid000000000000000": {"id": "1Mid000000000000000", "parents": [CLIENT_FOLDER]}})
        sb = FakeSb([an_import()])
        self.run_with(drive, sb)
        self.assertEqual(sb.imports[IID]["status"], "done")
        self.assertEqual(sb.imports[IID]["files"][0]["status"], "landed")


class Files(Base):
    def one(self, f: dict[str, Any], blob: bytes, *, imp: Optional[dict[str, Any]] = None) -> tuple[FakeDrive, FakeSb]:
        drive = FakeDrive(folders={ROOT: [f]}, content={f["id"]: blob})
        sb = FakeSb([imp or an_import()])
        self.run_with(drive, sb)
        return drive, sb

    def entry(self, sb: FakeSb) -> dict[str, Any]:
        return sb.imports[IID]["files"][0]

    def test_a_16_gb_video_by_drives_size_is_too_big_and_never_downloaded(self):
        drive, sb = self.one(media_file("1Big000000000000", "big.mov", size=int(1.6 * GB)), MOV)
        self.assertEqual(self.entry(sb)["code"], "too_big")
        self.assertEqual(drive.downloads, [])

    def test_a_151_mb_picture_by_drives_size_is_too_big(self):
        drive, sb = self.one(media_file("1Pic000000000000", "p.jpg", mime="image/jpeg", size=151 * 1024 * 1024), JPEG)
        self.assertEqual(self.entry(sb)["code"], "too_big")

    def test_a_download_past_its_cap_is_too_big_and_past_its_deadline_is_download(self):
        f = media_file("1Dl0000000000000", "a.mp4")
        drive = FakeDrive(folders={ROOT: [f, media_file("1Dl1000000000000", "b.mp4")]})
        drive.download_error["1Dl0000000000000"] = http.TooLarge(0, "too large")
        drive.download_error["1Dl1000000000000"] = http.HttpError(0, "download deadline passed")
        sb = FakeSb([an_import()])
        self.run_with(drive, sb)
        self.assertEqual([e["code"] for e in sb.imports[IID]["files"]], ["too_big", "download"])

    def test_a_403_on_download_and_a_probe_that_times_out_fail_their_file_while_the_next_lands(self):
        files = [media_file("1F00000000000000", "a.mp4", created="2026-10-20T00:00:00Z"),
                 media_file("1F10000000000000", "b.mp4", created="2026-10-19T00:00:00Z"),
                 media_file("1F20000000000000", "c.mp4", created="2026-10-18T00:00:00Z")]
        drive = FakeDrive(folders={ROOT: files})
        drive.download_error["1F00000000000000"] = urllib.error.HTTPError("u", 403, "Forbidden", {}, io.BytesIO(b""))
        sb = FakeSb([an_import()])
        calls = {"n": 0}
        real = self.tools.probe

        def probe(path: Path) -> dict[str, Any]:
            calls["n"] += 1
            if calls["n"] == 1:
                raise subprocess.TimeoutExpired("ffprobe", 120)
            return real(path)

        self.tools.probe = probe  # type: ignore[method-assign]
        self.run_with(drive, sb)
        self.assertEqual([e.get("code") or e["status"] for e in sb.imports[IID]["files"]], ["download", "unplayable", "landed"])

    def test_each_sniffed_type(self):
        cases = [(MP4, "x.mov", "video/mp4"), (MOV, "x.mp4", "video/quicktime"), (JPEG, "x.png", "image/jpeg"),
                 (HEIC, "x.jpg", "image/jpeg")]
        for blob, name, want in cases:
            _, sb = self.one(media_file("1S00000000000000", name), blob)
            self.assertEqual(self.entry(sb)["reserved"]["p_mime"], want, name)
        _, sb = self.one(media_file("1S00000000000000", "x.mp4"), PDF)
        self.assertEqual(self.entry(sb)["code"], "wrong_type")
        self.assertEqual(di.sniff(b"RIFF\x00\x00\x00\x00WEBPVP8 "), "webp")
        self.assertEqual(di.sniff(b"RIFF\x00\x00\x00\x00AVI LIST"), "avi")
        for brand in (b"iso5", b"iso6", b"3gp4", b"3g2a"):
            self.assertEqual(di.sniff(b"\x00\x00\x00\x18ftyp" + brand), "mp4", brand)
        self.assertIsNone(di.sniff(b"\x00\x00\x00\x18ftypavis"))
        self.assertIsNone(di.sniff(b"#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0"))
        self.assertIsNone(di.sniff(b"ffconcat version 1.0\nfile "))

    def test_the_plan_gets_a_type_the_server_takes_whatever_drive_says(self):
        cases = [
            ({"mimeType": "Video/MP4", "name": "clip"}, "video/mp4"),
            ({"mimeType": "video/mp4; codecs=avc1", "name": "clip"}, "video/mp4"),
            ({"mimeType": "application/octet-stream", "name": "IMG_2.MOV"}, "video/quicktime"),
            ({"mimeType": "application/octet-stream", "name": "IMG_3.HEIC"}, "image/heic"),
            ({"mimeType": "image/jpeg", "name": "a.jpg"}, "image/jpeg"),
            ({"mimeType": "", "name": "photo"}, "image/jpeg"),
        ]
        for f, want in cases:
            got = di.Run.plan_mime(f)
            self.assertEqual(got, want, f)
            self.assertIsNotNone(di.PLAN_MIME.fullmatch(got))
        drive, sb = self.one(media_file("1Z00000000000000", "huge.mov", size=6 * 10**12), MOV)
        plan = next(c for c in sb.calls if c[0].endswith("_plan"))[1]
        self.assertEqual(plan["p_files"][0]["bytes"], 10**12)
        self.assertEqual(self.entry(sb)["code"], "too_big")
        self.assertEqual(drive.downloads, [])

    def test_heic_without_heif_convert_is_heic(self):
        self.tools.heif = False
        _, sb = self.one(media_file("1H00000000000000", "IMG_1.HEIC", mime="image/heic"), HEIC)
        self.assertEqual(self.entry(sb)["code"], "heic")

    def test_conversion_with_the_exact_arguments_for_hevc_prores_mkv_big_and_4k(self):
        cases = [
            ({"video_codec": "hevc"}, MOV),
            ({"video_codec": "prores"}, MOV),
            ({}, MKV),
            ({"width": 2160, "height": 3840}, MP4),
        ]
        for change, blob in cases:
            self.tools = FakeTools()
            magic = next(m for m in self.tools.probes if blob.startswith(m))
            self.tools.probes[magic].update(change)
            _, sb = self.one(media_file("1C00000000000000", "v.mov"), blob)
            e = self.entry(sb)
            self.assertEqual(e["reserved"]["p_mime"], "video/mp4", change)
            self.assertEqual(e["reserved"]["p_note"], "converted")
            args = self.tools.conversions[0]
            self.assertEqual(args[:3], ["nice", "-n", "10"])
            for want in ("-maxrate", "3500k", "-bufsize", "7000k", "+faststart",
                         "scale='if(gt(iw,ih),-2,min(1080,iw))':'if(gt(iw,ih),min(1080,ih),-2)'"):
                self.assertIn(want, args)
            # The second review round: the input opens local files only, and
            # the output stops a megabyte past what can land.
            i = args.index("-i")
            self.assertEqual(args[i - 2:i], ["-protocol_whitelist", "file"])
            self.assertTrue(args[i + 1].endswith("in.mov") or args[i + 1].endswith("in.mp4") or args[i + 1].endswith("in.mkv"))
            self.assertEqual(args[-3:-1], ["-fs", str(di.LANDING_CAP + (1 << 20))])
            self.assertTrue(args[-1].endswith("out.mp4"))

    def test_an_h264_mp4_over_the_buckets_limit_is_converted(self):
        self.tools.convert_size = 0
        with mock.patch.object(di, "LANDING_CAP", 20):
            _, sb = self.one(media_file("1L00000000000000", "big.mp4"), MP4 + b"\x00" * 20)
        self.assertEqual(self.entry(sb)["reserved"]["p_note"], "converted")
        self.assertEqual(len(self.tools.conversions), 1)

    def test_conversion_that_fails_is_unplayable_one_over_five_minutes_is_too_big_never_run(self):
        self.tools.probes[MOV]["video_codec"] = "hevc"
        self.tools.convert_code = 1
        _, sb = self.one(media_file("1X00000000000000", "v.mov"), MOV)
        self.assertEqual(self.entry(sb)["code"], "unplayable")
        self.tools = FakeTools()
        self.tools.probes[MOV].update(video_codec="hevc", seconds=301.0)
        _, sb = self.one(media_file("1X00000000000000", "v.mov"), MOV)
        self.assertEqual(self.entry(sb)["code"], "too_big")
        self.assertEqual(self.tools.conversions, [])

    def test_an_output_over_150_mb_is_too_big(self):
        self.tools.probes[MOV]["video_codec"] = "hevc"
        with mock.patch.object(di, "LANDING_CAP", 100):
            self.tools.convert_size = 200
            _, sb = self.one(media_file("1O00000000000000", "v.mov"), MOV)
        self.assertEqual(self.entry(sb)["code"], "too_big")

    def test_a_rotated_phone_video_lands_upright(self):
        self.tools.probes[MP4].update(width=1920, height=1080, rotation=90)
        _, sb = self.one(media_file("1R00000000000000", "v.mp4"), MP4)
        r = self.entry(sb)["reserved"]
        self.assertEqual((r["p_width"], r["p_height"]), (1080, 1920))
        self.assertEqual(media.rotation_of({"tags": {"rotate": "-90"}}), 270)
        self.assertEqual(media.rotation_of({"side_data_list": [{"rotation": 90}]}), 90)
        self.assertIsNone(media.rotation_of({}))

    def test_a_file_the_plan_marks_skipped_is_never_downloaded(self):
        drive = FakeDrive(folders={ROOT: [media_file("1K00000000000000", "a.mp4")]})
        sb = FakeSb([an_import()])
        sb.in_tray.add("1K00000000000000")
        self.run_with(drive, sb)
        self.assertEqual(drive.downloads, [])
        self.assertEqual(sb.imports[IID]["status"], "done")


class Resume(Base):
    def test_a_resumed_import_skips_resolve_and_plan_reserves_the_same_row_and_uploads_with_upsert(self):
        entry = {"driveId": "1Res000000000000", "name": "a.mp4", "mime": "video/mp4", "bytes": 100, "status": "working",
                 "adId": "00000000-0000-4000-8000-000000000777", "resourceKey": None}
        imp = an_import(resumed=True, files=[entry], found=1)
        drive = FakeDrive(content={"1Res000000000000": MP4})
        sb = FakeSb([imp])
        self.run_with(drive, sb)
        self.assertNotIn("plan", sb.names())
        self.assertTrue(all(u["upsert"] for u in sb.uploads))
        self.assertEqual(sb.uploads[0]["path"], f"{TASK}/00000000-0000-4000-8000-000000000777.mp4")
        self.assertEqual(sb.imports[IID]["status"], "done")

    def test_a_resumed_import_never_reads_what_the_previous_import_learned_about_a_file(self):
        shared = "1Same000000000000"
        first = an_import()
        second_id = "6f0c1e2a-0000-4000-8000-000000000002"
        entry = {"driveId": shared, "name": "a.mp4", "mime": "video/mp4", "bytes": 100, "status": "queued",
                 "adId": None, "resourceKey": None}
        second = an_import(id=second_id, taskId="86c1other", driveId="1OtherRoot000000000", resumed=True,
                           files=[entry], found=1)
        # In the first client's folder Drive says it cannot be downloaded.
        drive = FakeDrive(folders={ROOT: [media_file(shared, "a.mp4", capabilities={"canDownload": False})]},
                          content={shared: MP4})
        sb = FakeSb([first, second])
        self.run_with(drive, sb)
        self.assertEqual(sb.imports[IID]["files"][0]["code"], "download")
        self.assertEqual(sb.imports[second_id]["files"][0]["status"], "landed")
        self.assertEqual(drive.downloads[0]["keys"], {shared: None})


class Upload(Base):
    def go(self, answer: Any) -> FakeSb:
        drive = FakeDrive(folders={ROOT: [media_file("1U00000000000000", "a.jpg", mime="image/jpeg")]},
                          content={"1U00000000000000": JPEG})
        sb = FakeSb([an_import()])
        sb.upload_answer = answer
        self.run_with(drive, sb)
        return sb

    def test_a_duplicate_goes_to_landed(self):
        sb = self.go("exists")
        self.assertIn("file_landed", sb.names())
        self.assertEqual(sb.imports[IID]["files"][0]["status"], "landed")

    def test_too_large_is_too_big_and_anything_else_is_storage(self):
        self.assertEqual(self.go(StorageTooLarge(413, "too large")).imports[IID]["files"][0]["code"], "too_big")
        self.assertEqual(self.go(http.HttpError(500, "boom")).imports[IID]["files"][0]["code"], "storage")

    def test_a_reserve_whose_path_is_outside_the_row_gives_storage_without_uploading(self):
        drive = FakeDrive(folders={ROOT: [media_file("1U00000000000000", "a.jpg", mime="image/jpeg")]},
                          content={"1U00000000000000": JPEG})
        sb = FakeSb([an_import()])
        real = sb.rpc

        def rpc(name: str, args: dict[str, Any], *, retry: bool = True) -> Any:
            out = real(name, args, retry=retry)
            if name.endswith("file_reserve") and isinstance(out, dict) and out.get("path"):
                out["path"] = f"otherTask/{out['adId']}.jpg"
            return out

        sb.rpc = rpc  # type: ignore[method-assign]
        self.run_with(drive, sb)
        self.assertEqual(sb.uploads, [])
        self.assertEqual(sb.imports[IID]["files"][0]["code"], "storage")

    def test_a_reserved_path_with_a_trailing_newline_is_refused_too(self):
        drive = FakeDrive(folders={ROOT: [media_file("1U00000000000000", "a.jpg", mime="image/jpeg")]},
                          content={"1U00000000000000": JPEG})
        sb = FakeSb([an_import()])
        real = sb.rpc

        def rpc(name: str, args: dict[str, Any], *, retry: bool = True) -> Any:
            out = real(name, args, retry=retry)
            if name.endswith("file_reserve") and isinstance(out, dict) and out.get("path"):
                out["path"] = out["path"] + "\n"
            return out

        sb.rpc = rpc  # type: ignore[method-assign]
        self.run_with(drive, sb)
        self.assertEqual(sb.uploads, [])
        self.assertEqual(sb.imports[IID]["files"][0]["code"], "storage")


class Claims(Base):
    def test_a_lost_claim_stops_the_import_without_writing(self):
        drive = FakeDrive(folders={ROOT: [media_file("1A00000000000000", "a.mp4"), media_file("1B00000000000000", "b.mp4")]})
        sb = FakeSb([an_import()])
        sb.errors["file_reserve"] = RpcError("40001", "This import is not yours to work on.")
        out = self.run_with(drive, sb)
        self.assertEqual(out["imports"][0]["status"], "lost")
        self.assertEqual([n for n in sb.names() if n in ("file_failed", "finish")], [])

    def test_a_55000_from_plan_is_never_a_lost_claim(self):
        drive = FakeDrive(folders={ROOT: [media_file("1A00000000000000", "a.mp4")]})
        sb = FakeSb([an_import()])
        sb.errors["plan"] = RpcError("55000", "This import already started its files.")
        out = self.run_with(drive, sb)
        self.assertEqual(out["imports"][0]["status"], "working")

    def test_heartbeats_at_most_once_a_minute_during_a_long_download(self):
        drive = FakeDrive(folders={ROOT: [media_file("1A00000000000000", "a.mp4")]})
        drive.download_seconds["1A00000000000000"] = 3
        sb = FakeSb([an_import()])
        beats = []
        real = drive.download

        def download(*a: Any, **kw: Any) -> int:
            chunk = kw["on_chunk"]

            def on_chunk(n: int) -> None:
                self.clock.t += 61
                beats.append(n)
                chunk(n)

            kw["on_chunk"] = on_chunk
            return real(*a, **kw)

        drive.download = download  # type: ignore[method-assign]
        self.run_with(drive, sb)
        self.assertEqual(sb.names().count("heartbeat"), 3)

    def test_a_heartbeat_that_fails_mid_download_leaves_the_import_working_and_fails_no_file(self):
        drive = FakeDrive(folders={ROOT: [media_file("1A00000000000000", "a.mp4")]})
        sb = FakeSb([an_import()])
        sb.errors["heartbeat"] = http.HttpError(503, "unavailable")
        real = drive.download

        def download(*a: Any, **kw: Any) -> int:
            self.clock.t += 61
            return real(*a, **kw)

        drive.download = download  # type: ignore[method-assign]
        out = self.run_with(drive, sb)
        self.assertEqual(out["imports"][0]["status"], "working")
        self.assertNotIn("file_failed", sb.names())
        self.assertNotIn("finish", sb.names())

    def test_a_heartbeat_that_dies_outside_urllib_is_the_turns_never_the_files(self):
        """http.client's IncompleteRead is not an OSError, so http.request
        lets it through; a heartbeat failing that way mid-download must not
        fail a good file with a Drive sentence."""
        import http.client

        for err in (http.client.IncompleteRead(b""), ValueError("odd answer")):
            drive = FakeDrive(folders={ROOT: [media_file("1A00000000000000", "a.mp4")]})
            sb = FakeSb([an_import()])
            sb.errors["heartbeat"] = err
            real = drive.download

            def download(*a: Any, _real: Any = real, **kw: Any) -> int:
                self.clock.t += 61
                return _real(*a, **kw)

            drive.download = download  # type: ignore[method-assign]
            out = self.run_with(drive, sb)
            self.assertEqual(out["imports"][0]["status"], "working", err)
            self.assertNotIn("file_failed", sb.names(), err)
            self.assertNotIn("finish", sb.names(), err)

    def test_a_40001_mid_upload_writes_nothing_more(self):
        drive = FakeDrive(folders={ROOT: [media_file("1A00000000000000", "a.mp4")]})
        sb = FakeSb([an_import()])
        sb.errors["heartbeat"] = RpcError("40001", "This import is not yours to work on.")

        def upload_file(*a: Any, **kw: Any) -> str:
            self.clock.t += 61
            kw["on_chunk"](10)
            return "uploaded"

        sb.upload_file = upload_file  # type: ignore[method-assign]
        self.run_with(drive, sb)
        beat = sb.names().index("heartbeat")
        after = [c for c in sb.calls[beat + 1:] if c[1].get("p_import_id") == IID]
        self.assertEqual(after, [])

    def test_a_roster_mid_refresh_at_reserve_is_the_imports_turn(self):
        drive = FakeDrive(folders={ROOT: [media_file("1A00000000000000", "a.mp4")]})
        sb = FakeSb([an_import()])
        sb.errors["file_reserve"] = RpcError("55006", "The client roster is being refreshed.", "roster")
        out = self.run_with(drive, sb)
        self.assertEqual(out["imports"][0]["status"], "working")
        self.assertNotIn("file_failed", sb.names())

    def test_the_claim_is_sent_once_never_retried(self):
        sb = FakeSb()
        self.run_with(FakeDrive(), sb)
        claims = [c for c in sb.calls if c[0].endswith("_claim")]
        self.assertEqual(len(claims), 1)
        self.assertFalse(claims[0][2])

    def test_a_leftover_scratch_from_a_killed_run_is_gone_before_the_claim(self):
        left = self.cfg.scratch / "deck-import" / IID / "1A"
        left.mkdir(parents=True)
        (left / "in.bin").write_bytes(b"x" * 100)
        self.run_with(FakeDrive(), FakeSb())
        self.assertFalse((self.cfg.scratch / "deck-import").exists())

    def test_a_second_run_beside_a_working_one_does_nothing_and_keeps_its_scratch(self):
        import fcntl
        left = self.cfg.scratch / "deck-import" / IID / "1A"
        left.mkdir(parents=True)
        (left / "in.bin").write_bytes(b"x" * 100)
        with open(self.cfg.scratch / "deck-import.lock", "a") as held:
            fcntl.flock(held.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            sb = FakeSb([an_import()])
            out = self.run_with(FakeDrive(), sb)
        self.assertEqual(out.get("skipped"), "running")
        self.assertEqual(sb.calls, [])
        self.assertTrue((left / "in.bin").exists(), "the working run's download is untouched")
        # Once the first run is gone, the next one runs.
        sb = FakeSb()
        self.assertNotIn("skipped", self.run_with(FakeDrive(), sb))

    def test_under_4_gb_free_nothing_is_claimed(self):
        self.tools.free = 3 * GB
        sb = FakeSb([an_import()])
        out = self.run_with(FakeDrive(), sb)
        self.assertEqual(out.get("skipped"), "disk")
        self.assertEqual(sb.calls, [])

    def test_a_file_that_would_take_the_disk_under_its_floor_waits_working(self):
        drive = FakeDrive(folders={ROOT: [media_file("1A00000000000000", "a.mp4", size=int(1.2 * GB))]})
        sb = FakeSb([an_import()])
        self.tools.free = int(5 * GB)
        out = self.run_with(drive, sb)
        self.assertEqual(out["imports"][0]["status"], "working")
        self.assertEqual(drive.downloads, [])


class Posters(Base):
    def go(self, provider: str, url: str, answers: list[tuple[int, dict[str, str], bytes]]) -> FakeSb:
        sb = FakeSb()
        sb.poster_due = [{"deck": "launch", "slotKey": "calendar-hours", "lang": "any", "provider": provider, "url": url}]
        queue = list(answers)

        def fetch(method: str, u: str, **kw: Any):
            status, headers, body = queue.pop(0)
            if status >= 400:
                raise http.HttpError(status, "no")
            return status, headers, body

        r = di.Run(self.cfg, self.logs.append, sb, FakeDrive(), worker="editor-desk@test", tools=self.tools,
                   clock=self.clock, fetch=fetch)
        r.run()
        return sb

    def saved(self, sb: FakeSb) -> Any:
        return next(c for c in sb.calls if c[0] == "cockpit_csm_deck_video_poster_save")[1]["p_poster_url"]

    def test_a_loom_gif_is_saved_as_its_jpg_sibling(self):
        sb = self.go("loom", "https://www.loom.com/share/abc", [
            (200, {}, json.dumps({"thumbnail_url": "https://cdn.loom.com/sessions/thumbnails/abc-1.gif"}).encode()),
            (200, {"Content-Type": "image/jpeg"}, b""),
        ])
        self.assertEqual(self.saved(sb), "https://cdn.loom.com/sessions/thumbnails/abc-1.jpg")

    def test_a_thumbnail_on_another_host_is_refused_and_an_oembed_error_saves_null(self):
        sb = self.go("loom", "https://www.loom.com/share/abc", [
            (200, {}, json.dumps({"thumbnail_url": "https://evil.example/x.jpg"}).encode()),
        ])
        self.assertIsNone(self.saved(sb))
        sb = self.go("wistia", "https://fast.wistia.net/embed/iframe/x", [(500, {}, b"")])
        self.assertIsNone(self.saved(sb))


class Links(unittest.TestCase):
    def test_the_shared_cases_through_the_dry_runs_parser(self):
        path = Path(__file__).resolve().parents[3] / "apps/client-success-cockpit/src/present/driveLink.cases.json"
        cases = json.loads(path.read_text("utf-8"))["cases"]
        self.assertGreater(len(cases), 60)
        for c in cases:
            self.assertEqual(di.parse_drive_link(c["link"]), c["want"], c["name"])

    def test_links_built_to_slip_past_a_parser(self):
        """The security review's table; the same one runs through the
        server's parser (csm-decks-supabase.test.ts)."""
        i, i2 = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345", "1ZyXwVuTsRqPoNmLkJiHgFeDcBa98765"
        bad = [
            (f"https://drive.google.com/drive/folders/%31{i[1:]}", "link_bad"),
            (f"https://drive.google.com/open?id=%31{i[1:]}", "link_bad"),
            (f"https://drive.google.com/file/d/{i}%2F..%2F/view", "link_bad"),
            (f"https://drive.google.com/drive/folders/{i}‏", "link_bad"),
            (f"‮https://drive.google.com/drive/folders/{i}", "link_bad"),
            (f"https://drive.google.com/drive/folders/{i}​", "link_bad"),
            (f"https://drіve.google.com/drive/folders/{i}", "link_bad"),
            (f"https://drive.google.com\\@evil.example/drive/folders/{i}", "link_bad"),
            (f"https://evil.example\\.drive.google.com/drive/folders/{i}", "link_bad"),
            (f"https://drive.google.com#@evil.example/drive/folders/{i}", "link_bad"),
            (f"https://drive.google.com?/drive/folders/{i}", "link_bad"),
            (f"https://drive.google.com./drive/folders/{i}", "link_bad"),
            (f"https://127.0.0.1/drive/folders/{i}", "link_bad"),
            (f"https://drive.google.com/drive/folders/{i}/../../file/d/{i2}", "link_bad"),
            (f"https:/drive.google.com/drive/folders/{i}", "link_bad"),
            (f"https:\\\\drive.google.com/drive/folders/{i}", "link_bad"),
            (f"//drive.google.com/drive/folders/{i}", "link_bad"),
            (f"https://drive.google.com/drive/folders/{i}\thttps://drive.google.com/drive/folders/{i2}", "link_bad"),
            ("https://forms.gle/AbCdEfGhIjKl", "link_bad"),
            ("https://docs.google.com/forms/d/e/1FAIpQLSfAbCdEf/viewform?usp=sf_link", "link_docs"),
        ]
        for link, code in bad:
            self.assertEqual(di.parse_drive_link(link), {"ok": False, "code": code}, link)
        good = [
            (f"https://drive.google.com/open?id={i}&resourcekey=0-abc%2F..",
             {"ok": True, "id": i, "kind": "either", "resourceKey": None, "link": f"https://drive.google.com/open?id={i}"}),
            (f"https://drive.google.com/drive/folders/{i}?resourcekey=0-ok&resourcekey=0-second",
             {"ok": True, "id": i, "kind": "folder", "resourceKey": "0-ok",
              "link": f"https://drive.google.com/drive/folders/{i}?resourcekey=0-ok"}),
            (f"https://DRIVE.google.com/file/d/{i}/view?resourcekey=RK_1-x#frag",
             {"ok": True, "id": i, "kind": "file", "resourceKey": "RK_1-x",
              "link": f"https://drive.google.com/file/d/{i}/view?resourcekey=RK_1-x"}),
            (f"https://drive.google.com/uc?id={i}&id={i2}",
             {"ok": True, "id": i, "kind": "file", "resourceKey": None, "link": f"https://drive.google.com/file/d/{i}/view"}),
        ]
        for link, want in good:
            self.assertEqual(di.parse_drive_link(link), want, link)


class Helpers(unittest.TestCase):
    def test_rpc_error_reads_postgrests_fields(self):
        e = http.HttpError(400, "x", json.dumps({"code": "40001", "message": "This import is not yours to work on.", "hint": None}).encode())
        r = supabase_mod.rpc_error(e)
        self.assertEqual((r.sqlstate, r.message, r.hint), ("40001", "This import is not yours to work on.", None))
        self.assertIsNone(supabase_mod.rpc_error(http.HttpError(502, "bad gateway", b"<html>")))

    def test_rpc_without_retry_is_called_once_on_a_502(self):
        sb = supabase_mod.Supabase("https://x.supabase.co", "k")
        calls = []

        def rest(*a: Any, **kw: Any) -> Any:
            calls.append(1)
            raise http.HttpError(502, "bad gateway", b"")

        sb.rest = rest  # type: ignore[method-assign]
        with self.assertRaises(http.HttpError):
            sb.rpc("cockpit_csm_launch_ads_import_claim", {}, retry=False, sleep=lambda s: None)
        self.assertEqual(len(calls), 1)
        calls.clear()
        with self.assertRaises(http.HttpError):
            sb.rpc("cockpit_csm_launch_ads_import_heartbeat", {}, sleep=lambda s: None)
        self.assertEqual(len(calls), 3)

    def test_upload_file_duplicates_and_too_large(self):
        sb = supabase_mod.Supabase("https://x.supabase.co", "k")
        with tempfile.NamedTemporaryFile() as fh:
            fh.write(b"x" * 10)
            fh.flush()
            for status, body, want in [
                (409, b"", "exists"),
                (400, json.dumps({"statusCode": "409", "error": "Duplicate"}).encode(), "exists"),
            ]:
                err = urllib.error.HTTPError("u", status, "x", {}, io.BytesIO(body))
                with mock.patch("urllib.request.urlopen", side_effect=err):
                    self.assertEqual(sb.upload_file("b", "t/a.jpg", fh.name, "image/jpeg", sleep=lambda s: None), want)
            for status, body in [(413, b""), (400, b'{"message":"The object exceeded the maximum allowed size"}')]:
                err = urllib.error.HTTPError("u", status, "x", {}, io.BytesIO(body))
                with mock.patch("urllib.request.urlopen", side_effect=err):
                    with self.assertRaises(StorageTooLarge):
                        sb.upload_file("b", "t/a.jpg", fh.name, "image/jpeg", sleep=lambda s: None)

    def test_a_download_past_its_deadline_stops(self):
        class Res:
            def __init__(self):
                self.left = 3

            def read(self, n: int) -> bytes:
                self.left -= 1
                return b"x" * 10 if self.left >= 0 else b""

            def __enter__(self):
                return self

            def __exit__(self, *a: Any) -> None:
                return None

        times = iter([0.0, 5.0, 11.0, 20.0, 30.0])
        with tempfile.TemporaryDirectory() as d, mock.patch("urllib.request.urlopen", return_value=Res()), \
                mock.patch("time.monotonic", side_effect=lambda: next(times)):
            with self.assertRaises(http.HttpError) as ctx:
                http.download("https://x", f"{d}/f", max_bytes=1000, deadline=10.0)
        self.assertIn("deadline", str(ctx.exception))

    def test_a_broken_answer_is_a_transport_error_for_every_caller(self):
        """IncompleteRead is an http.client.HTTPException, not an OSError:
        http.request retries it and then raises HttpError(0), so file_reserve
        and file_landed end the turn instead of failing a good file."""
        import http.client as stdlib_http

        class Res:
            status = 200
            headers: dict[str, str] = {}

            def read(self, *a: Any) -> bytes:
                raise stdlib_http.IncompleteRead(b"")

            def __enter__(self):
                return self

            def __exit__(self, *a: Any) -> None:
                return None

        with mock.patch("urllib.request.urlopen", return_value=Res()) as opened, \
                mock.patch("time.sleep"):
            with self.assertRaises(http.HttpError) as ctx:
                http.request("POST", "https://x.supabase.co/rest/v1/rpc/f", json_body={}, retries=2)
        self.assertEqual(ctx.exception.status, 0)
        self.assertIn("IncompleteRead", str(ctx.exception))
        self.assertEqual(opened.call_count, 3)

    def test_the_probe_and_the_poster_open_local_files_only(self):
        """The second review round's lock on the input is on every ffmpeg-family
        process that reads the Drive bytes, not the conversion alone."""
        seen: list[list[str]] = []

        def run(cmd: list[str], **kw: Any) -> Any:
            seen.append(list(cmd))
            return subprocess.CompletedProcess(cmd, 1, "{}", "")

        with tempfile.TemporaryDirectory() as d, mock.patch.object(media, "has", return_value=True), \
                mock.patch("subprocess.run", side_effect=run):
            src = Path(d) / "in.mov"
            src.write_bytes(b"x")
            di.Tools().probe(src)
            di.Tools().poster(src, 1.0, Path(d) / "p.jpg")
        self.assertEqual(len(seen), 2)
        probe_cmd, poster_cmd = seen
        self.assertEqual(probe_cmd[0], "ffprobe")
        self.assertEqual(probe_cmd[3:5], ["-protocol_whitelist", "file"])
        self.assertEqual(probe_cmd[-1], str(src))
        self.assertEqual(poster_cmd[0], "ffmpeg")
        i = poster_cmd.index("-i")
        self.assertEqual(poster_cmd[i + 1], str(src))
        j = poster_cmd.index("-protocol_whitelist")
        self.assertEqual(poster_cmd[j:j + 2], ["-protocol_whitelist", "file"])
        self.assertLess(j, i)
        # Every other worker's probe stays as it was.
        seen.clear()
        with tempfile.TemporaryDirectory() as d, mock.patch.object(media, "has", return_value=True), \
                mock.patch("subprocess.run", side_effect=run):
            media.probe(Path(d) / "x.mp4")
        self.assertNotIn("-protocol_whitelist", seen[0])

    def test_the_heic_doctor_names_whats_missing(self):
        t = FakeTools()
        t.heif = False
        ok, detail = di.doctor_heic(t)
        self.assertFalse(ok)
        self.assertIn("libheif-examples", detail)
        fixture = Path(__file__).resolve().parent / "fixtures" / "grid-1024.heic"
        self.assertTrue(fixture.exists())
        self.assertLess(fixture.stat().st_size, 200_000)


if __name__ == "__main__":
    unittest.main()
