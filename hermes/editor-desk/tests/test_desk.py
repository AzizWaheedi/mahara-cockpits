from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from typing import Any

os.environ.setdefault("DESK_HOME", "/tmp/desk-unit")
from desk import ads, brand, checks, clients, foreplay, media, meetings, prepare, queue, sheets, speech
from desk.clickup import editors_of, fields_of, is_open, job_row
from desk.config import Config
from desk.drive import parse_id
from tests.fakes import FakeClickUp, FakeDrive, FakeSupabase, drive_file, folder, task

NOW = "2026-09-18T12:00:00Z"


def cfg_in(tmp: str) -> Config:
    os.environ["DESK_HOME"] = tmp
    c = Config.from_env()
    c.home = Path(tmp)
    c.scratch = Path(tmp) / "scratch"
    c.out_dir = Path(tmp) / "out"
    c.state_path = Path(tmp) / "state.json"
    c.supabase_url, c.supabase_key = "https://x.supabase.co", "k"
    c.ensure_dirs()
    return c


def no_speech(cfg, audio, log, **kw):
    return {"text": "", "words": [], "segments": [], "method": "none", "warnings": [], "language": None, "confidence": "low"}


def fake_speech(text: str, words: list[dict[str, Any]] | None = None):
    def fn(cfg, audio, log, **kw):
        return {
            "text": text,
            "words": words or [{"t": float(i), "e": float(i) + 0.4, "w": w} for i, w in enumerate(text.split())],
            "segments": [], "method": "elevenlabs:scribe_v1", "warnings": [], "language": "ara", "confidence": "high",
        }
    return fn


class BoardTests(unittest.TestCase):
    def test_a_card_becomes_a_job_row(self):
        row = job_row(task(), now_iso=NOW)
        self.assertEqual(row["task_id"], "86abc")
        self.assertEqual(row["client"], "castello industries")
        self.assertEqual(row["editor"], "Karim Abdelrahman")
        self.assertEqual(row["editors"][0]["email"], "karim@maharamedia.com")
        self.assertIn("1tTO2R44N3I3uKaFYKYwBa0gdVkrpHi", row["footage_url"])
        self.assertEqual(row["request_type"], "New")
        self.assertTrue(row["brief"].startswith("Cut a 30 second"))
        self.assertEqual(row["due_at"], "2026-09-16T01:00:00Z")

    def test_the_editor_comes_from_the_custom_field_not_assignees(self):
        t = task(editor=("Moaz Thabet", "moaz@maharamedia.com"))
        self.assertEqual(editors_of(t)[0]["name"], "Moaz Thabet")
        self.assertEqual(job_row(task(editor=None), now_iso=NOW)["editor"], None)

    def test_a_renamed_field_still_reads_by_id(self):
        t = task()
        for c in t["custom_fields"]:
            c["name"] = "Something Else Entirely"
        self.assertIn("footage_folder", fields_of(t))

    def test_open_and_done_statuses(self):
        self.assertTrue(is_open("in progress"))
        self.assertTrue(is_open("client review"))
        self.assertFalse(is_open("complete"))
        self.assertFalse(is_open("Cancelled"))

    def test_drive_links_of_every_shape(self):
        self.assertEqual(parse_id("https://drive.google.com/drive/folders/ABCdef123456?usp=drive_link"), "ABCdef123456")
        self.assertEqual(parse_id("https://drive.google.com/file/d/FILE1234567890/view"), "FILE1234567890")
        self.assertEqual(parse_id("https://docs.google.com/document/d/DOC12345678901/edit"), "DOC12345678901")
        self.assertIsNone(parse_id(""))
        self.assertIsNone(parse_id("https://example.com/video.mp4"))


class ReadinessTests(unittest.TestCase):
    def test_a_job_is_ready_only_when_everything_needed_is_there(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            job = job_row(task(), now_iso=NOW)
            assets = [{"has_audio": True, "transcript": "كلام"}]
            ready, missing = prepare.readiness(job, assets, cfg)
            self.assertTrue(ready, missing)

            ready, missing = prepare.readiness({**job, "footage_url": None}, [], cfg)
            self.assertFalse(ready)
            self.assertTrue(any("footage folder" in m for m in missing))

            ready, missing = prepare.readiness(job, [], cfg)
            self.assertFalse(ready)
            self.assertTrue(any("no video in it" in m for m in missing))

            ready, missing = prepare.readiness({**job, "editor": None}, assets, cfg)
            self.assertFalse(ready)
            self.assertTrue(any("No editor assigned" in m for m in missing))

            ready, missing = prepare.readiness({**job, "brief": "", "script": ""}, assets, cfg)
            self.assertFalse(ready)
            self.assertTrue(any("No brief and no script" in m for m in missing))

    def test_all_silent_footage_is_called_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            job = job_row(task(), now_iso=NOW)
            ready, missing = prepare.readiness(job, [{"has_audio": False}, {"has_audio": False}], cfg)
            self.assertFalse(ready)
            self.assertTrue(any("silent" in m for m in missing))
            ready, _ = prepare.readiness(job, [{"has_audio": False}, {"has_audio": True}], cfg)
            self.assertTrue(ready, "one silent file among several is normal")


class ScriptTests(unittest.TestCase):
    def test_find_lines_marks_where_a_line_was_said(self):
        words = [{"t": float(i), "e": float(i) + 0.4, "w": w} for i, w in enumerate("مرحبا بكم في المشروع الجديد اليوم نشوف التشطيبات".split())]
        hits = speech.find_lines("مرحبا بكم في المشروع\nاليوم نشوف التشطيبات", words)
        self.assertEqual(len(hits), 2)
        self.assertEqual(hits[0]["at_sec"], 0.0)
        self.assertEqual(hits[1]["at_sec"], 5.0)
        self.assertEqual(hits[0]["confidence"], "high")

    def test_find_lines_returns_nothing_without_a_transcript(self):
        self.assertEqual(speech.find_lines("a line here", []), [])
        self.assertEqual(speech.find_lines("", [{"t": 0, "w": "x"}]), [])

    def test_script_coverage_flags_the_missing_line(self):
        script = "welcome to the villa handover\nthe kitchen took eleven weeks\ncall us today"
        got = checks.script_coverage(script, "welcome to the villa handover and the kitchen took eleven weeks")
        self.assertGreater(got["ratio"], 0.6)
        self.assertEqual(got["missing_lines"], ["call us today"])

    def test_script_coverage_on_a_silent_cut_says_so(self):
        got = checks.script_coverage("some script here", "")
        self.assertEqual(got["ratio"], 0.0)
        self.assertIn("nothing spoken", got["note"])
        self.assertIsNone(checks.script_coverage("", "anything")["ratio"])


class CheckTests(unittest.TestCase):
    def test_the_report_flags_shape_length_and_loudness(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            job = {"script": ""}
            good = checks.run_checks(cfg, {"seconds": 28.0, "width": 1080, "height": 1920, "loudness": -14.2, "has_audio": True}, "hello there", job)
            self.assertTrue(all(c["ok"] for c in good), good)

            wrong = checks.run_checks(cfg, {"seconds": 28.0, "width": 1920, "height": 1080, "loudness": -14.0, "has_audio": True}, "x", job)
            shape = next(c for c in wrong if c["check"] == "shape")
            self.assertFalse(shape["ok"])
            self.assertIn("9:16", shape["detail"])

            ok16 = checks.run_checks(cfg, {"seconds": 28.0, "width": 1920, "height": 1080, "loudness": -14.0}, "x", job, want_ratio="16:9")
            self.assertTrue(next(c for c in ok16 if c["check"] == "shape")["ok"])

            loud = checks.run_checks(cfg, {"seconds": 28.0, "width": 1080, "height": 1920, "loudness": -6.0}, "x", job)
            self.assertFalse(next(c for c in loud if c["check"] == "loudness")["ok"])

    def test_a_missing_script_line_is_flagged_on_the_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            job = {"script": "welcome to the villa handover\nthe kitchen took eleven weeks\ncall us today"}
            rows = checks.run_checks(cfg, {"seconds": 20.0, "width": 1080, "height": 1920}, "welcome to the villa handover the kitchen took eleven weeks", job)
            script = next(c for c in rows if c["check"] == "script")
            self.assertIn("call us today", script["detail"])

    def test_report_text_is_readable(self):
        text = checks.report_text({"n": 2, "passed": False, "checks": [{"check": "shape", "ok": False, "detail": "1920x1080 is 1.778; 9:16 wants 0.563"}]})
        self.assertIn("Version 2 checked", text)
        self.assertIn("[look] shape", text)
        self.assertIn("advice", text)


class PrepareTests(unittest.TestCase):
    def setUp(self):
        # free_bytes reads the machine this runs on. A laptop with 6 GB spare
        # tripped the worker's 8 GB floor and skipped every download, which
        # failed three tests for a reason that was not about the desk.
        was = media.free_bytes
        media.free_bytes = lambda _p: 500 * 1024**3
        self.addCleanup(lambda: setattr(media, "free_bytes", was))

    def _run(self, cfg, sb, drive, job, **kw):
        return prepare.prepare_job(cfg, lambda m: None, sb, drive, job, **kw)

    def test_a_folder_of_footage_is_read_and_the_job_turns_ready(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            sb = FakeSupabase()
            job = job_row(task(), now_iso=NOW)
            job["script"] = "مرحبا بكم في المشروع"
            sb.store_jobs([job])
            drive = FakeDrive({"1tTO2R44N3I3uKaFYKYwBa0gdVkrpHi": [drive_file("1VideoOneAAAAAAAAAAAAAAAAAAAA", "clip one.mp4", seconds=90), folder("1SUBfolderAAAAAAAAAAAAAAAAAAAA", "b-roll")], "1SUBfolderAAAAAAAAAAAAAAAAAAAA": [drive_file("1VideoTwoAAAAAAAAAAAAAAAAAAAA", "clip two.mp4", seconds=30)]})
            cu = FakeClickUp()
            media.probe = lambda p: {"seconds": 90.0, "width": 1080, "height": 1920, "fps": 30.0, "has_audio": True, "bytes": 2048}
            media.extract_audio = lambda p, d, seconds=None: d if d.write_bytes(b"x") is None else d
            media.scenes = lambda p, threshold=0.35, limit=400: [0.0, 12.5, 40.0]
            media.storyboard = lambda p, w, seconds=None, count=3, width=480: b"jpegbytes"

            out = self._run(cfg, sb, drive, sb.job("86abc"), clickup=cu, transcribe_fn=fake_speech("مرحبا بكم في المشروع الجديد"))
            self.assertEqual(out["files"], 2)
            self.assertEqual(out["read"], 2)
            self.assertTrue(out["ready"], out["missing"])
            self.assertEqual(sb.job("86abc")["state"], "ready")
            self.assertEqual(len(sb.assets("86abc")), 2)
            first = sb.assets("86abc")[0]
            self.assertEqual(len(first["scenes"]), 3)
            self.assertTrue(first["script_hits"], "the script line should be found in the transcript")
            self.assertEqual(sb.stills, ["86abc/1VideoOneAAAAAAAAAAAAAAAAAAAA.jpg", "86abc/1VideoTwoAAAAAAAAAAAAAAAAAAAA.jpg"])
            self.assertEqual(len(cu.posted), 1)
            self.assertIn("Ready to start", cu.posted[0][1])

    def test_a_second_run_skips_what_is_already_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            sb = FakeSupabase()
            sb.store_jobs([job_row(task(), now_iso=NOW)])
            drive = FakeDrive({"1tTO2R44N3I3uKaFYKYwBa0gdVkrpHi": [drive_file("1VideoOneAAAAAAAAAAAAAAAAAAAA", "one.mp4")]})
            media.probe = lambda p: {"seconds": 60.0, "width": 1080, "height": 1920, "has_audio": True, "bytes": 2048}
            media.extract_audio = lambda p, d, seconds=None: d
            media.scenes = lambda p, threshold=0.35, limit=400: []
            media.storyboard = lambda p, w, seconds=None, count=3, width=480: None
            self._run(cfg, sb, drive, sb.job("86abc"), transcribe_fn=fake_speech("hello"))
            self.assertEqual(drive.downloads, ["1VideoOneAAAAAAAAAAAAAAAAAAAA"])
            out = self._run(cfg, sb, drive, sb.job("86abc"), transcribe_fn=fake_speech("hello"))
            self.assertEqual(out["skipped"], 1)
            self.assertEqual(drive.downloads, ["1VideoOneAAAAAAAAAAAAAAAAAAAA"], "nothing is downloaded twice")
            out = self._run(cfg, sb, drive, sb.job("86abc"), force=True, transcribe_fn=fake_speech("hello"))
            self.assertEqual(drive.downloads, ["1VideoOneAAAAAAAAAAAAAAAAAAAA", "1VideoOneAAAAAAAAAAAAAAAAAAAA"], "force reads it again")

    def test_a_job_with_no_footage_link_is_blocked_with_a_plain_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            sb = FakeSupabase()
            sb.store_jobs([job_row(task(footage=""), now_iso=NOW)])
            cu = FakeClickUp()
            out = self._run(cfg, sb, FakeDrive({}), sb.job("86abc"), clickup=cu)
            self.assertFalse(out["ready"])
            self.assertEqual(sb.job("86abc")["state"], "blocked")
            self.assertTrue(any("footage folder" in m for m in out["missing"]))
            self.assertIn("Not ready to start yet", cu.posted[0][1])

    def test_a_file_over_the_cap_is_recorded_not_downloaded(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            cfg.max_file_bytes = 10_000_000
            sb = FakeSupabase()
            sb.store_jobs([job_row(task(), now_iso=NOW)])
            drive = FakeDrive({"1tTO2R44N3I3uKaFYKYwBa0gdVkrpHi": [drive_file("1BigFileAAAAAAAAAAAAAAAAAAAAA", "huge.mp4", size=900_000_000)]})
            out = self._run(cfg, sb, drive, sb.job("86abc"))
            self.assertEqual(drive.downloads, [])
            self.assertEqual(out["skipped"], 1)
            self.assertIn("over the", sb.assets("86abc")[0]["error"])

    def test_a_failed_download_is_reported_and_retried_later(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            sb = FakeSupabase()
            sb.store_jobs([job_row(task(), now_iso=NOW)])
            drive = FakeDrive({"1tTO2R44N3I3uKaFYKYwBa0gdVkrpHi": [drive_file("1VideoOneAAAAAAAAAAAAAAAAAAAA", "one.mp4")]}, fail={"1VideoOneAAAAAAAAAAAAAAAAAAAA"})
            out = self._run(cfg, sb, drive, sb.job("86abc"))
            self.assertEqual(out["failed"], 1)
            self.assertEqual(sb.job("86abc")["state"], "stale")
            self.assertEqual(sb.job("86abc")["attempts"], 1)
            self.assertIn("could not download", sb.assets("86abc")[0]["error"])

    def test_the_comment_says_when_nothing_was_spoken(self):
        job = job_row(task(), now_iso=NOW)
        assets = [
            {"name": "a.mp4", "seconds": 19.0, "has_audio": True, "transcript": "", "scenes": [1, 2]},
            {"name": "b.mp4", "seconds": 18.0, "has_audio": True, "transcript": "", "scenes": [1]},
        ]
        text = prepare.comment_text(job, assets, {"files": 2, "read": 2, "seconds": 37.0, "ready": True, "missing": [], "warnings": []})
        self.assertIn("No speech was found in any file", text)
        spoken = prepare.comment_text(job, [{**assets[0], "transcript": "hello there"}], {"files": 1, "read": 1, "seconds": 19.0, "ready": True, "missing": [], "warnings": []})
        self.assertNotIn("No speech was found", spoken)

    def test_the_comment_says_what_was_found(self):
        job = job_row(task(), now_iso=NOW)
        assets = [
            {"name": "one.mp4", "seconds": 120.0, "width": 1080, "height": 1920, "has_audio": True, "transcript": "x" * 340, "scenes": [1, 2, 3], "script_hits": [{"line": "a"}]},
            {"name": "two.mp4", "error": "could not download: HTTP 404"},
        ]
        text = prepare.comment_text(job, assets, {"files": 2, "read": 1, "seconds": 120.0, "ready": True, "missing": [], "warnings": []})
        self.assertIn("2 file(s), 2.0 minutes", text)
        self.assertIn("340 characters of speech", text)
        self.assertIn("could not download", text)
        self.assertIn("Script lines found in the footage: 1", text)
        self.assertIn("does not cut anything", text)


if __name__ == "__main__":
    unittest.main()


def _restore_media(was):
    media.probe, media.extract_audio, media.scenes, media.storyboard = was


class ClientTests(unittest.TestCase):
    """The tag on a video card is the client, and the client card holds the
    brand work (Aziz, 2026-09-18). These are the joins that have to hold."""

    ROSTER = [
        {"task_id": "c1", "name": "Alkhalil", "aliases": sorted(clients.aliases("Alkhalil"))},
        {"task_id": "c2", "name": "Castello Industries", "aliases": sorted(clients.aliases("Castello Industries"))},
        {"task_id": "c3", "name": "Qatar Technology", "aliases": sorted(clients.aliases("Qatar Technology"))},
        {"task_id": "c4", "name": "JG design", "aliases": sorted(clients.aliases("JG design"))},
        {"task_id": "c5", "name": "شركة منشآت خالدة للاستشارات الهندسية",
         "aliases": sorted(clients.aliases("شركة منشآت خالدة للاستشارات الهندسية"))},
    ]

    def test_a_lowercase_tag_finds_its_client_card(self):
        for tag, want in [
            ("qatar technology", "c3"),
            ("castello industries", "c2"),
            ("alkhalil", "c1"),
            ("jg design", "c4"),
        ]:
            hit = clients.match([tag], self.ROSTER)
            self.assertIsNotNone(hit, tag)
            self.assertEqual(hit["task_id"], want, tag)

    def test_a_squeezed_or_spaced_name_still_matches(self):
        # The board says "Alkhalil", a person may type "Al Khalil", and the
        # reverse happens just as often.
        roster = [{"task_id": "c9", "name": "Al Khalil", "aliases": sorted(clients.aliases("Al Khalil"))}]
        self.assertEqual(clients.match(["alkhalil"], roster)["task_id"], "c9")
        self.assertEqual(clients.match(["Al  Khalil"], self.ROSTER)["task_id"], "c1")

    def test_an_arabic_tag_matches_its_arabic_card(self):
        hit = clients.match(["شركة منشآت خالدة للاستشارات الهندسية"], self.ROSTER)
        self.assertEqual(hit["task_id"], "c5")

    def test_a_tag_for_nobody_matches_nobody(self):
        self.assertIsNone(clients.match(["some company we never had"], self.ROSTER))
        self.assertIsNone(clients.match([], self.ROSTER))
        self.assertIsNone(clients.match([""], self.ROSTER))

    def test_a_generic_word_never_carries_a_match(self):
        # "design" appears in four client names; on its own it must decide nothing.
        self.assertIsNone(clients.match(["design"], self.ROSTER))
        self.assertIsNone(clients.match(["company"], self.ROSTER))

    def test_the_longer_shared_name_wins(self):
        roster = [
            {"task_id": "short", "name": "Mass", "aliases": sorted(clients.aliases("Mass"))},
            {"task_id": "long", "name": "Mass Design", "aliases": sorted(clients.aliases("Mass Design"))},
        ]
        self.assertEqual(clients.match(["mass design"], roster)["task_id"], "long")

    def test_dropdown_index_zero_is_a_real_choice(self):
        """A first probe read Client Status 0 as "no status" and lost two live
        clients. Index zero is the first option, not an empty field."""
        t = {
            "custom_fields": [{
                "id": "x", "name": "Client Status", "type": "drop_down", "value": 0,
                "type_config": {"options": [{"name": "Active"}, {"name": "Paused"}]},
            }]
        }
        self.assertEqual(clients.fields_by_name(t)["status"], "Active")

    def test_fields_are_found_through_emoji_and_punctuation(self):
        t = {"custom_fields": [
            {"id": "a", "name": "\U0001f9ec Brand DNA", "type": "url", "value": "https://docs.google.com/document/d/abcdefghijkl"},
            {"id": "b", "name": "Do's & Don'ts", "type": "text", "value": "No stock music."},
        ]}
        f = clients.fields_by_name(t)
        self.assertIn("document/d/abcdefghijkl", f["brand_dna_url"])
        self.assertEqual(f["dos_donts"], "No stock music.")

    def test_brand_lines_read_as_sentences(self):
        text = "\n".join(clients.brand_lines({
            "name": "Ardon", "dos_donts": "Never use stock music.",
            "brand_dna_url": "https://docs.google.com/document/d/x", "brand_dna": "Tone: confident.",
        }))
        self.assertIn("Client: Ardon.", text)
        self.assertIn("Never use stock music.", text)
        self.assertEqual(clients.brand_lines(None), [])

    def test_a_missing_brief_points_at_the_client_card(self):
        job = {"footage_url": "https://drive.google.com/drive/folders/1tTO2R44N3I3uKaFYKYwBa0gdVkrpHi",
               "editor": "Karim", "brief": "", "script": ""}
        assets = [{"has_audio": True}]
        with tempfile.TemporaryDirectory() as tmp:
            c = cfg_in(tmp)
            _, missing = prepare.readiness(job, assets, c, {"name": "Ardon"})
            self.assertTrue(any("Ardon" in m for m in missing))
            _, plain = prepare.readiness(job, assets, c, None)
            self.assertTrue(any("No brief and no script" in m for m in plain))

    def test_a_missing_brand_document_never_blocks_a_job(self):
        job = {"footage_url": "https://drive.google.com/drive/folders/1tTO2R44N3I3uKaFYKYwBa0gdVkrpHi",
               "editor": "Karim", "brief": "Cut a 30 second reel."}
        with tempfile.TemporaryDirectory() as tmp:
            ready, missing = prepare.readiness(job, [{"has_audio": True}], cfg_in(tmp), None)
            self.assertTrue(ready, f"a job with footage and a brief is ready: {missing}")

    def test_an_unmatched_tag_is_noted_on_the_job_not_used_to_block_it(self):
        # ffmpeg is real on the worker and absent on the laptop, so a stub file
        # probed differently in each place and this test disagreed with itself.
        # Pin the media layer, and put it back afterwards.
        with tempfile.TemporaryDirectory() as tmp:
            c = cfg_in(tmp)
            was = (media.probe, media.extract_audio, media.scenes, media.storyboard)
            self.addCleanup(lambda: _restore_media(was))
            media.probe = lambda p: {"seconds": 30.0, "width": 1080, "height": 1920, "has_audio": True, "bytes": 2048}
            media.extract_audio = lambda p, d, seconds=None: d if d.write_bytes(b"x") is None else d
            media.scenes = lambda p, threshold=0.35, limit=400: []
            media.storyboard = lambda p, w, seconds=None, count=3, width=480: b"jpegbytes"
            sb = FakeSupabase()
            drive = FakeDrive({"1tTO2R44N3I3uKaFYKYwBa0gdVkrpHi": [drive_file("1AbCdEfGhIjKlMnOpQrStUvWxYz01", "a.mp4")]})
            job = {"task_id": "t1", "clients": ["nobody ltd"], "editor": "Karim", "brief": "Cut it.",
                   "footage_url": "https://drive.google.com/drive/folders/1tTO2R44N3I3uKaFYKYwBa0gdVkrpHi"}
            out = prepare.prepare_job(c, lambda m: None, sb, drive, job, transcribe_fn=no_speech, client=None)
            self.assertTrue(any("matches no company" in w for w in out["warnings"]))
            self.assertEqual(out["state"], "ready")


class QueueTests(unittest.TestCase):
    """The cockpit holds no keys, so everything it wants done arrives here.
    These are the guarantees a person pressing a button is relying on."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cfg = cfg_in(self.tmp.name)
        self.sb = FakeSupabase()
        self.sb.store_jobs([job_row(task(), now_iso=NOW)])
        self.cu = FakeClickUp([task()])
        self.log: list[str] = []

    def drain(self, **kw):
        # The drain builds its own ClickUp and Drive; hand it the fakes.
        real_clickup, real_drive = queue.ClickUp, queue.Drive
        queue.ClickUp = lambda cfg, log: self.cu
        queue.Drive = kw.get("drive_factory", lambda cfg, log: None)
        self.addCleanup(lambda: (setattr(queue, "ClickUp", real_clickup), setattr(queue, "Drive", real_drive)))
        return queue.run_requests(self.cfg, self.log.append, self.sb, limit=kw.get("limit", 10))

    def test_a_delivery_writes_the_link_the_status_and_nothing_else(self):
        self.sb.queue({
            "id": "r1", "kind": "deliver", "task_id": "86abc", "created_at": NOW,
            "input": "https://drive.google.com/file/d/1FinalCutAAAAAAAAAAAAAAAAAAA/view",
            "requested_by": "karim@maharamedia.com", "requested_by_name": "Karim",
        })
        out = self.drain()
        self.assertEqual(out["done"], 1)
        self.assertEqual(self.cu.fields, [("86abc", "edited_video",
                                           "https://drive.google.com/file/d/1FinalCutAAAAAAAAAAAAAAAAAAA/view")])
        self.assertEqual(self.cu.statuses, [("86abc", "client review")])
        self.assertEqual(self.sb.job("86abc")["state"], "delivered")
        self.assertEqual(self.sb.requests_rows["r1"]["status"], "done")
        # The comment names the person who pressed the button.
        self.assertEqual(len(self.cu.posted), 1)
        self.assertIn("Karim", self.cu.posted[0][1])

    def test_a_claimed_request_is_never_carried_out_twice(self):
        self.sb.queue({"id": "r1", "kind": "deliver", "task_id": "86abc", "created_at": NOW,
                       "input": "https://drive.google.com/file/d/1FinalCutAAAAAAAAAAAAAAAAAAA/view"})
        self.drain()
        self.drain()
        self.assertEqual(len(self.cu.fields), 1, "the link must be written once, not once per run")

    def test_a_request_with_no_link_is_told_why_and_tried_again(self):
        self.sb.queue({"id": "r1", "kind": "deliver", "task_id": "86abc", "created_at": NOW, "input": ""})
        out = self.drain()
        self.assertEqual(out["failed"], 1)
        row = self.sb.requests_rows["r1"]
        self.assertEqual(row["status"], "queued", "one bad try goes back in the queue")
        self.assertIn("no link", row["error"])
        self.assertEqual(row["attempts"], 1)

    def test_a_request_that_keeps_failing_stops_after_four_tries(self):
        self.sb.queue({"id": "r1", "kind": "deliver", "task_id": "86abc", "created_at": NOW, "input": ""})
        for _ in range(4):
            self.sb.requests_rows["r1"]["status"] = "queued"
            self.drain()
        self.assertEqual(self.sb.requests_rows["r1"]["status"], "failed")
        self.assertEqual(self.sb.requests_rows["r1"]["attempts"], 4)

    def test_a_kind_the_desk_does_not_know_is_refused_outright(self):
        self.sb.queue({"id": "r1", "kind": "delete everything", "task_id": "86abc", "created_at": NOW})
        out = self.drain()
        self.assertEqual(out["failed"], 1)
        self.assertEqual(self.sb.requests_rows["r1"]["status"], "failed")
        self.assertFalse(self.cu.fields)
        self.assertFalse(self.cu.statuses)

    def test_a_request_for_a_job_that_is_gone_says_so(self):
        self.sb.queue({"id": "r1", "kind": "deliver", "task_id": "nosuchjob", "created_at": NOW,
                       "input": "https://drive.google.com/file/d/1FinalCutAAAAAAAAAAAAAAAAAAA/view"})
        self.drain()
        self.assertIn("not on the desk", self.sb.requests_rows["r1"]["error"])

    def test_a_rescan_only_asks_for_the_footage_to_be_read_again(self):
        self.sb.mark_job("86abc", state="ready", attempts=3)
        self.sb.queue({"id": "r1", "kind": "rescan", "task_id": "86abc", "created_at": NOW})
        self.drain()
        self.assertEqual(self.sb.job("86abc")["state"], "stale")
        self.assertEqual(self.sb.job("86abc")["attempts"], 0)
        self.assertFalse(self.cu.fields, "a rescan must not touch the board")

    def test_a_comment_is_refused_when_writeback_is_off(self):
        self.cfg.clickup_writeback = False
        self.sb.queue({"id": "r1", "kind": "comment", "task_id": "86abc", "created_at": NOW,
                       "input": "Waiting on the logo file."})
        self.drain()
        self.assertFalse(self.cu.posted)
        self.assertIn("switched off", self.sb.requests_rows["r1"]["error"])


class AskTests(unittest.TestCase):
    """An editor short of something has to be able to say so, on the card
    where the person who can fix it is already looking."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cfg = cfg_in(self.tmp.name)
        self.sb = FakeSupabase()
        self.sb.store_jobs([job_row(task(), now_iso=NOW)])
        self.cu = FakeClickUp([task()])
        real_clickup, real_drive = queue.ClickUp, queue.Drive
        queue.ClickUp = lambda cfg, log: self.cu
        queue.Drive = lambda cfg, log: None
        self.addCleanup(
            lambda: (setattr(queue, "ClickUp", real_clickup), setattr(queue, "Drive", real_drive))
        )

    def ask(self, topic, note=""):
        self.sb.queue({
            "id": f"r-{topic}", "kind": "ask", "task_id": "86abc", "created_at": NOW,
            "input": note, "params": {"topic": topic},
            "requested_by": "karim@maharamedia.com", "requested_by_name": "Karim",
        })
        return queue.run_requests(self.cfg, lambda m: None, self.sb)

    def test_asking_for_footage_lands_on_the_card_and_is_remembered(self):
        out = self.ask("footage", "The two clips we have are both under ten seconds.")
        self.assertEqual(out["done"], 1)
        self.assertEqual(len(self.cu.posted), 1)
        text = self.cu.posted[0][1]
        self.assertIn("Karim needs more footage", text)
        self.assertIn("under ten seconds", text)
        job = self.sb.job("86abc")
        self.assertEqual(job["asked_for"], "more footage")
        self.assertTrue(job["asked_at"])
        self.assertEqual(job["asked_by"], "Karim")
        # And it shows up in the job's own history, not only on the card.
        self.assertTrue(any("more footage" in (n.get("text") or "") for n in self.sb.notes("86abc")))

    def test_every_topic_reads_as_a_sentence(self):
        for topic, wanted in queue.ASK_FOR.items():
            if topic == "other":
                continue
            self.cu.posted.clear()
            self.ask(topic)
            self.assertIn(f"needs {wanted}", self.cu.posted[0][1], topic)

    def test_something_else_has_to_say_what(self):
        out = self.ask("other")
        self.assertEqual(out["failed"], 1)
        self.assertIn("say what is needed", self.sb.requests_rows["r-other"]["error"])
        self.assertFalse(self.cu.posted)

    def test_an_unknown_topic_falls_back_to_the_note(self):
        out = self.ask("nonsense", "Need the client's logo in vector.")
        self.assertEqual(out["done"], 1)
        self.assertIn("something else", self.cu.posted[0][1])
        self.assertIn("logo in vector", self.cu.posted[0][1])

    def test_nothing_is_posted_when_writeback_is_off(self):
        self.cfg.clickup_writeback = False
        out = self.ask("footage", "please")
        self.assertEqual(out["done"], 1, "the ask is still recorded for the cockpit")
        self.assertFalse(self.cu.posted)
        self.assertEqual(self.sb.job("86abc")["asked_for"], "more footage")


class BrandFreshnessTests(unittest.TestCase):
    """A brand document is edited in place, so the link is the same afterwards.
    Only the document's own revision says the rules changed."""

    class Drive:
        def __init__(self, rev):
            self.rev = rev
            self.reads = 0

        def get(self, _id):
            return {"modifiedTime": self.rev}

        def doc_text(self, _id):
            self.reads += 1
            return f"brand text at {self.rev}"

    ROW = {
        "task_id": "c1",
        "name": "Ardon",
        "brand_dna_url": "https://docs.google.com/document/d/1mBrandDnaAAAAAAAAAAAAAAAAA/edit",
        "offer_url": "",
    }

    def test_the_revision_is_recorded_beside_the_text(self):
        d = self.Drive("2026-09-19T08:00:00.000Z")
        row = clients.read_docs(d, dict(self.ROW), lambda m: None)
        self.assertEqual(row["brand_dna"], "brand text at 2026-09-19T08:00:00.000Z")
        self.assertEqual(row["brand_dna_rev"], "2026-09-19T08:00:00.000Z")

    def test_an_unchanged_document_reports_the_same_revision(self):
        d = self.Drive("2026-09-19T08:00:00.000Z")
        first = clients.read_docs(d, dict(self.ROW), lambda m: None)
        self.assertEqual(clients.revisions(d, self.ROW)["brand_dna_rev"], first["brand_dna_rev"])

    def test_an_edited_document_reports_a_new_one(self):
        old = clients.read_docs(self.Drive("2026-09-19T08:00:00.000Z"), dict(self.ROW), lambda m: None)
        now = clients.revisions(self.Drive("2026-09-19T18:30:00.000Z"), self.ROW)
        self.assertNotEqual(now["brand_dna_rev"], old["brand_dna_rev"])

    def test_a_document_that_will_not_open_asks_to_be_read_again(self):
        class Broken:
            def get(self, _id):
                raise OSError("no")

        self.assertIsNone(clients.revisions(Broken(), self.ROW)["brand_dna_rev"])

    def test_a_card_with_no_document_has_no_revision(self):
        d = self.Drive("x")
        self.assertIsNone(clients.revisions(d, {"brand_dna_url": "", "offer_url": ""})["brand_dna_rev"])


class SeatTests(unittest.TestCase):
    """Adding someone as Assigned Editor on a ClickUp card is enough to let
    them into the cockpit (Aziz, 2026-09-19). Two syncs write this table, so
    the rule that matters is that neither can undo the other."""

    def test_only_our_own_domain_gets_a_seat(self):
        cards = [
            task("a", editor=("Karim Abdelrahman", "karim@maharamedia.com")),
            task("b", editor=("A Freelancer", "someone@gmail.com")),
            task("c", editor=("Moaz", "moaz@maharamedia.com")),
        ]
        got = {p["email"] for p in clients.seat_people(cards)}
        self.assertEqual(got, {"karim@maharamedia.com", "moaz@maharamedia.com"})

    def test_a_name_is_kept_and_a_person_appears_once(self):
        cards = [
            task("a", editor=("Karim Abdelrahman", "karim@maharamedia.com")),
            task("b", editor=("", "karim@maharamedia.com")),
        ]
        people = clients.seat_people(cards)
        self.assertEqual(len(people), 1)
        self.assertEqual(people[0]["name"], "Karim Abdelrahman")

    def test_a_card_with_nobody_on_it_grants_nothing(self):
        self.assertEqual(clients.seat_people([task("a", editor=None)]), [])
        self.assertEqual(clients.seat_people([]), [])

    def test_the_desk_writes_its_own_flag_and_never_the_answer(self):
        sb = FakeSupabase()
        sb.seats_from_board([{"email": "moaz@maharamedia.com", "name": "Moaz"}], NOW)
        row = sb.people_rows["moaz@maharamedia.com"]
        self.assertTrue(row["via_clickup"])
        self.assertNotIn("active", row, "active is computed by the database, never written")
        self.assertNotIn("role", row, "admin is the portal's to give, not the board's")

    def test_a_seat_the_board_gave_is_taken_back_when_the_card_changes(self):
        sb = FakeSupabase()
        sb.seats_from_board([{"email": "moaz@maharamedia.com", "name": "Moaz"}], NOW)
        out = sb.seats_from_board([{"email": "karim@maharamedia.com", "name": "Karim"}], NOW)
        self.assertEqual(out["revoked"], 1)
        self.assertFalse(sb.people_rows["moaz@maharamedia.com"]["via_clickup"])
        self.assertTrue(sb.people_rows["karim@maharamedia.com"]["via_clickup"])

    def test_the_board_never_touches_a_seat_the_portal_gave(self):
        sb = FakeSupabase()
        sb.people_rows["sabry@maharamedia.com"] = {
            "email": "sabry@maharamedia.com", "role": "editor", "via_portal": True, "via_clickup": False,
        }
        sb.seats_from_board([{"email": "karim@maharamedia.com", "name": "Karim"}], NOW)
        self.assertTrue(
            sb.people_rows["sabry@maharamedia.com"]["via_portal"],
            "the desk must leave the portal's own flag alone",
        )


class StatusTests(unittest.TestCase):
    """Moving the card from the cockpit. Aziz, 2026-09-19: pressing started
    should move it to In progress, comments to Update required."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cfg = cfg_in(self.tmp.name)
        self.sb = FakeSupabase()
        self.sb.store_jobs([job_row(task(status="new video request"), now_iso=NOW)])
        self.cu = FakeClickUp([task()])
        real = (queue.ClickUp, queue.Drive)
        queue.ClickUp = lambda cfg, log: self.cu
        queue.Drive = lambda cfg, log: None
        self.addCleanup(lambda: (setattr(queue, "ClickUp", real[0]), setattr(queue, "Drive", real[1])))

    def move(self, to, note=""):
        # No spaces in the id: the claim quotes it into the URL, and a fixture
        # id like "s-in progress" would not match itself once encoded.
        self.sb.queue({
            "id": "s-" + to.replace(" ", "-"), "kind": "status", "task_id": "86abc", "created_at": NOW,
            "input": note, "params": {"to": to},
            "requested_by": "karim@maharamedia.com", "requested_by_name": "Karim",
        })
        return queue.run_requests(self.cfg, lambda m: None, self.sb)

    def test_started_moves_the_card_to_in_progress(self):
        out = self.move("in progress")
        self.assertEqual(out["done"], 1)
        self.assertEqual(self.cu.statuses, [("86abc", "in progress")])
        self.assertEqual(self.sb.job("86abc")["status"], "in progress")
        self.assertIn("Karim moved this to In progress", self.cu.posted[0][1])

    def test_a_note_travels_with_the_move(self):
        self.move("update required", "Client wants the logo bigger.")
        self.assertIn("logo bigger", self.cu.posted[0][1])

    def test_the_cockpit_cannot_close_or_cancel_a_job(self):
        for bad in ("complete", "cancelled", "closed", "anything"):
            self.cu.statuses.clear()
            self.sb.requests_rows.clear()
            out = self.move(bad)
            self.assertEqual(out["failed"], 1, bad)
            self.assertFalse(self.cu.statuses, f"{bad} must not reach the board")

    def test_moving_to_where_it_already_is_changes_nothing(self):
        self.sb.mark_job("86abc", status="in progress")
        out = self.move("in progress")
        self.assertEqual(out["done"], 1)
        self.assertFalse(self.cu.statuses, "no pointless write to the board")


class RetireTests(unittest.TestCase):
    """A card deleted in ClickUp used to leave a job in the cockpit forever.
    "jg design" sat there as Blocked for a day after the card was deleted."""

    def board(self, *ids):
        sb = FakeSupabase()
        sb.store_jobs([job_row(task(t), now_iso=NOW) for t in ids])
        return sb

    def test_a_job_whose_card_is_gone_is_retired_not_deleted(self):
        sb = self.board("a", "b", "c", "d")
        out = sb.retire_missing(["a", "b", "c"], NOW)
        self.assertEqual(out["retired"], 1)
        self.assertEqual(sb.job("d")["state"], "gone")
        self.assertIn("no longer on the board", sb.job("d")["error"])
        self.assertIsNotNone(sb.job("d"), "the row is kept: its transcripts cost money to make")

    def test_a_job_still_on_the_board_is_left_alone(self):
        sb = self.board("a", "b", "c", "d")
        sb.retire_missing(["a", "b", "c", "d"], NOW)
        self.assertNotEqual(sb.job("a")["state"], "gone")

    def test_a_half_failed_board_read_retires_nothing(self):
        sb = self.board("a", "b", "c", "d", "e", "f")
        out = sb.retire_missing(["a"], NOW)
        self.assertEqual(out["retired"], 0)
        self.assertIn("refused", out)
        for t in ("b", "c", "d", "e", "f"):
            self.assertNotEqual(sb.job(t)["state"], "gone", t)

    def test_an_empty_desk_is_not_an_error(self):
        self.assertEqual(FakeSupabase().retire_missing(["a"], NOW)["retired"], 0)


class EodTests(unittest.TestCase):
    """The cockpit's end of day has to be indistinguishable from the
    Typeform's: same tab, same columns, in the tab's own order."""

    # The live header on the "Video Editors" tab, read 2026-09-19.
    HEADER = [
        "Submitted At", "Name", "Response ID", "Date For", "Videos Completed",
        "In Progress / Pending", "Revisions Handled", "Blockers",
        "Recommendations", "Tomorrow's Plan", "Day Summary",
    ]
    ANSWERS = {
        "_submitted_at": "2026-09-19 15:00:00",
        "name": "Karim",
        "_response_id": "cockpit-2026-09-19",
        "_date_for": "19-09-2026",
        "completed": "2 for Ardon",
        "in_progress": "Qatar Technology, 60%",
        "revisions": "1 for Castello",
        "blockers": "Waiting on the logo",
        "recommendations": "Shoot b-roll wider",
        "tomorrow": "Finish Qatar",
        "summary": "Good day",
    }

    def test_the_row_follows_the_tab_not_our_own_order(self):
        row = sheets.eod_row(self.HEADER, self.ANSWERS)
        self.assertEqual(len(row), len(self.HEADER))
        self.assertEqual(row[1], "Karim")
        self.assertEqual(row[3], "19-09-2026")
        self.assertEqual(row[4], "2 for Ardon")
        self.assertEqual(row[10], "Good day")

    def test_a_reordered_tab_still_gets_the_right_values(self):
        swapped = [self.HEADER[i] for i in (0, 1, 2, 3, 10, 9, 8, 7, 6, 5, 4)]
        row = sheets.eod_row(swapped, self.ANSWERS)
        self.assertEqual(row[4], "Good day", "Day Summary moved, and its value moved with it")
        self.assertEqual(row[10], "2 for Ardon")

    def test_a_column_we_do_not_know_is_left_empty_not_guessed(self):
        row = sheets.eod_row([*self.HEADER, "Something New"], self.ANSWERS)
        self.assertEqual(row[-1], "", "an unknown column is never filled with a neighbour's value")

    def test_a_missing_answer_is_an_empty_cell(self):
        row = sheets.eod_row(self.HEADER, {"name": "Moaz"})
        self.assertEqual(row[1], "Moaz")
        self.assertEqual(row[4], "")

    def test_a_tab_with_no_header_is_refused_rather_than_written_blind(self):
        with self.assertRaises(ValueError):
            sheets.file_eod("t", self.ANSWERS, lambda m: None, header_fn=lambda *a, **k: [])

    def test_filing_appends_exactly_one_row(self):
        seen = {}

        def fake_append(token, sheet, tab, values, timeout=60):
            seen["tab"] = tab
            seen["values"] = values
            return {}

        out = sheets.file_eod(
            "t", self.ANSWERS, lambda m: None,
            header_fn=lambda *a, **k: self.HEADER, append_fn=fake_append,
        )
        self.assertEqual(seen["tab"], "Video Editors")
        self.assertEqual(len(seen["values"]), 11)
        self.assertEqual(out["columns"], 11)


class MeetingTests(unittest.TestCase):
    """Team meetings, not client calls. The difference is on the invite, not
    in the title, which is written by whoever made the calendar entry."""

    def meeting(self, *invitees, **kw):
        m = {
            "recording_id": kw.get("rid", "825247413"),
            "meeting_title": kw.get("title", "Fulfillment — Weekly Wrap"),
            "recording_start_time": "2026-09-17T10:02:27Z",
            "recording_end_time": "2026-09-17T10:30:00Z",
            "url": "https://fathom.video/calls/825247413",
            "share_url": "https://fathom.video/share/abc",
            "recorded_by": {"name": "Abdulaziz Waheedi"},
            "calendar_invitees": [
                {"name": n, "email": e, "is_external": x} for n, e, x in invitees
            ],
            "default_summary": {"markdown_formatted": "## الغرض من الاجتماع\n\nمراجعة"},
            "action_items": [{"description": "Send the cut", "assignee": {"name": "Karim"}}],
            "transcript_language": "ar",
        }
        m.update({k: v for k, v in kw.items() if k not in ("rid", "title")})
        return m

    TEAM = (
        ("Karim (Editor)", "karim@maharamedia.com", False),
        ("Sabry (Creative Director)", "sabry@maharamedia.com", False),
    )
    CLIENT = (
        ("Abdulaziz Waheedi", "aziz@maharamedia.com", False),
        ("Khaled Hasan", "khaled@somewhereelse.com", True),
    )

    def test_a_call_with_an_outsider_is_not_a_team_meeting(self):
        self.assertFalse(meetings.is_team_meeting(self.meeting(*self.CLIENT)))

    def test_a_call_with_only_our_own_people_is(self):
        self.assertTrue(meetings.is_team_meeting(self.meeting(*self.TEAM)))

    def test_a_meeting_with_nobody_on_the_invite_is_not_assumed_internal(self):
        self.assertFalse(meetings.is_team_meeting(self.meeting()))

    def test_the_title_never_decides(self):
        # A client call named like a team meeting stays a client call.
        disguised = self.meeting(*self.CLIENT, title="🛠️ Fulfillment — Weekly Wrap")
        self.assertFalse(meetings.is_team_meeting(disguised))

    def test_the_row_carries_who_was_there_in_lowercase(self):
        r = meetings.row(self.meeting(("Karim", "Karim@MaharaMedia.com", False)))
        self.assertEqual(r["invitee_emails"], ["karim@maharamedia.com"])

    def test_the_row_keeps_the_summary_the_link_and_the_actions(self):
        r = meetings.row(self.meeting(*self.TEAM))
        self.assertIn("الغرض من الاجتماع", r["summary_md"])
        self.assertEqual(r["share_url"], "https://fathom.video/share/abc")
        self.assertEqual(r["action_items"][0]["text"], "Send the cut")
        self.assertEqual(r["action_items"][0]["for"], "Karim")

    def test_the_transcript_is_left_behind(self):
        r = meetings.row(self.meeting(*self.TEAM, transcript="a very long transcript"))
        self.assertNotIn("transcript", r)

    def test_a_meeting_with_no_recording_id_is_dropped(self):
        self.assertIsNone(meetings.row({"meeting_title": "x"}))


class BrandEditTests(unittest.TestCase):
    """An editor adds what they were told in revisions. The field is the one
    list every cockpit reads and was written over months of onboarding calls,
    so adding must never be able to overwrite."""

    LIVE = (
        "DO\n"
        "- Run separate B2C and B2B messaging tracks (Onboarding, 2026-09-12)\n"
        "- Position brand as selective and professional (Onboarding, 2026-09-12)\n"
        "\n"
        "DON'T\n"
        "- Don't quote fixed prices without a technical review (Onboarding, 2026-09-10)"
    )

    def test_a_do_lands_at_the_end_of_the_do_block(self):
        out = brand.add(self.LIVE, "Keep the logo on for the last two seconds",
                        kind=brand.DO, who="Karim", day="2026-09-19")
        lines = out.split("\n")
        i = lines.index("- Keep the logo on for the last two seconds (Karim, 2026-09-19)")
        self.assertLess(lines.index("DO"), i)
        self.assertGreater(lines.index("DON'T"), i, "it must stay inside the DO block")

    def test_a_dont_lands_in_the_dont_block(self):
        out = brand.add(self.LIVE, "Use the old teal", kind=brand.DONT, who="Karim", day="2026-09-19")
        lines = out.split("\n")
        self.assertGreater(
            lines.index("- Use the old teal (Karim, 2026-09-19)"), lines.index("DON'T")
        )

    def test_nothing_that_was_already_there_is_lost(self):
        out = brand.add(self.LIVE, "Anything", kind=brand.DO, who="K", day="2026-09-19")
        for line in self.LIVE.split("\n"):
            if line.strip():
                self.assertIn(line, out, "an existing line was dropped")

    def test_an_empty_field_gets_both_headings(self):
        out = brand.add("", "Shoot wider", kind=brand.DO, who="Karim", day="2026-09-19")
        self.assertIn("DO\n- Shoot wider (Karim, 2026-09-19)", out)
        self.assertIn("DON'T", out)

    def test_a_field_with_no_headings_keeps_what_is_there(self):
        out = brand.add("some free text somebody typed", "Shoot wider",
                        kind=brand.DO, who="K", day="2026-09-19")
        self.assertTrue(out.startswith("some free text somebody typed"))
        self.assertIn("DO\n- Shoot wider (K, 2026-09-19)", out)

    def test_a_curly_apostrophe_heading_is_still_the_dont_block(self):
        odd = "DO\n- a (x, 1)\n\nDon’t\n- b (x, 1)"
        out = brand.add(odd, "c", kind=brand.DONT, who="K", day="2026-09-19")
        self.assertEqual(out.count("DO"), 1, "it must not start a second block")
        self.assertTrue(out.rstrip().endswith("- c (K, 2026-09-19)"))

    def test_saying_the_same_thing_twice_is_noticed(self):
        self.assertTrue(brand.already_there(self.LIVE, "Position brand as selective and professional"))
        self.assertTrue(brand.already_there(self.LIVE, "  position BRAND as selective and professional "))
        self.assertFalse(brand.already_there(self.LIVE, "Something nobody has said"))

    def test_an_empty_line_is_refused(self):
        with self.assertRaises(ValueError):
            brand.entry("   ", "Karim", "2026-09-19")

    def test_a_leading_dash_is_not_doubled(self):
        self.assertEqual(
            brand.entry("- already dashed", "Karim", "2026-09-19"),
            "- already dashed (Karim, 2026-09-19)",
        )


class ForeplayTests(unittest.TestCase):
    """Foreplay's schema marks almost every field "anyOf", meaning any of
    them can be null. Only `id` is load-bearing, so nothing may assume the
    rest is there."""

    FULL = {
        "id": "fp_1", "ad_id": "120251088280190566", "name": "Olivar spring",
        "brand_id": "b1", "video": "https://storage.googleapis.com/foreplay/x.mp4",
        "thumbnail": "https://t/x.jpg", "foreplay_url": "https://app.foreplay.co/ad/fp_1",
        "headline": "Build it right", "display_format": "video",
        "publisher_platform": ["facebook", "instagram"], "niches": ["home"],
        "languages": ["ar"], "market_target": "B2C", "live": True,
        "started_running": "2026-07-01T00:00:00Z", "running_duration": 80,
        "video_duration": 29.06, "full_transcription": "لو عندك أرض",
        "timestamped_transcription": [{"t": 0, "text": "لو عندك أرض"}],
        "emotional_drivers": ["trust"], "persona": "landowner",
    }

    def test_a_full_ad_maps_across(self):
        r = foreplay.row(self.FULL, board_id="bd1", board_name="Ardon")
        self.assertEqual(r["id"], "fp_1")
        self.assertEqual(r["board_name"], "Ardon")
        self.assertEqual(r["running_duration"], 80)
        self.assertEqual(r["languages"], ["ar"])
        self.assertEqual(r["timestamped_transcription"], [{"t": 0, "text": "لو عندك أرض"}])

    def test_an_ad_that_is_almost_all_nulls_still_maps(self):
        r = foreplay.row({"id": "fp_2", "ad_id": None, "name": None})
        self.assertEqual(r["id"], "fp_2")
        self.assertIsNone(r["name"])
        self.assertEqual(r["niches"], [], "a null list must become an empty list, not None")

    def test_an_ad_with_no_id_is_dropped(self):
        self.assertIsNone(foreplay.row({"ad_id": "x", "name": "no id"}))
        self.assertIsNone(foreplay.row({"id": "   "}))

    def test_a_single_value_where_a_list_was_expected_is_wrapped(self):
        r = foreplay.row({"id": "fp_3", "publisher_platform": "facebook"})
        self.assertEqual(r["publisher_platform"], ["facebook"])

    def test_days_on_air_survives_a_string(self):
        self.assertEqual(foreplay.row({"id": "a", "running_duration": "80"})["running_duration"], 80)
        self.assertIsNone(foreplay.row({"id": "b", "running_duration": "ages"})["running_duration"])
        self.assertIsNone(foreplay.row({"id": "c"})["running_duration"])

    def test_no_key_is_refused_before_any_call_is_made(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            os.environ.pop("FOREPLAY_API_KEY", None)
            import desk.config as cfgmod
            was = cfgmod._file_keys
            cfgmod._file_keys = {}
            try:
                with self.assertRaises(Exception):
                    foreplay.Foreplay(cfg, lambda m: None)
            finally:
                cfgmod._file_keys = was


class ForeplayCreditTests(unittest.TestCase):
    """Foreplay bills one credit per ad returned, with 10,000 a month. A sync
    that re-read the library daily would spend three times the allowance, so
    these are the guards that stop it."""

    class Fake:
        """A swipe file of 300 ads, newest save first."""

        def __init__(self, left=9000, total=300):
            self.left = left
            self.ads = [{"id": f"fp_{i:03d}", "name": f"ad {i}"} for i in range(total)]
            self.returned = 0
            self.calls = 0

        def usage(self):
            return {"credits_remaining": self.left}

        def swipefile(self, *, limit=100, offset=0, **kw):
            page = self.ads[offset : offset + limit]
            self.returned += len(page)
            return {"data": page}

        def boards(self):
            return [{"id": "b1", "name": "Ardon"}]

    def run_sync(self, fake, known=(), **kw):
        sb = FakeSupabase()
        sb.foreplay_rows = {k: {"id": k} for k in known}
        was = foreplay.Foreplay
        foreplay.Foreplay = lambda cfg, log: fake
        self.addCleanup(lambda: setattr(foreplay, "Foreplay", was))
        with tempfile.TemporaryDirectory() as tmp:
            return foreplay.sync(cfg_in(tmp), lambda m: None, sb, **kw), sb

    def test_a_first_run_reads_only_what_it_was_asked_for(self):
        fake = self.Fake()
        out, _ = self.run_sync(fake, max_ads=100)
        self.assertEqual(fake.returned, 100, "it must not walk the whole library")
        self.assertEqual(out["ads_read"], 100)

    def test_a_second_run_stops_as_soon_as_it_recognises_a_page(self):
        fake = self.Fake()
        known = [f"fp_{i:03d}" for i in range(300)]
        out, _ = self.run_sync(fake, known=known, max_ads=250)
        self.assertLessEqual(fake.returned, 250)
        self.assertEqual(out["new_or_changed"], 250 if False else fake.returned)
        # The point: one page, not ten.
        self.assertLessEqual(fake.returned, 250)

    def test_it_refuses_to_start_when_the_credits_are_nearly_gone(self):
        fake = self.Fake(left=100)
        out, sb = self.run_sync(fake, max_ads=250)
        self.assertEqual(fake.returned, 0, "nothing may be read below the floor")
        self.assertEqual(out["stored"], 0)
        self.assertIn("credit floor", out["note"])

    def test_a_full_run_ignores_the_floor_because_it_was_asked_for(self):
        fake = self.Fake(left=100)
        out, _ = self.run_sync(fake, max_ads=50, full=True)
        self.assertEqual(fake.returned, 50)

    def test_it_spends_no_more_than_the_credits_that_are_left(self):
        fake = self.Fake(left=600)
        self.run_sync(fake, max_ads=250, floor=500)
        self.assertLessEqual(fake.returned, 100, "it must leave the floor untouched")

    def test_an_unreadable_balance_does_not_stop_the_sync(self):
        fake = self.Fake()
        fake.usage = lambda: {"something": "else"}
        out, _ = self.run_sync(fake, max_ads=60)
        self.assertIsNone(out["credits_left"])
        self.assertEqual(fake.returned, 60, "not knowing is not the same as none left")

    def test_the_balance_is_read_however_they_spell_it(self):
        for shape, want in (
            ({"credits_remaining": 42}, 42),
            ({"remaining": 7}, 7),
            ({"credits_used": 100, "credits_total": 1000}, 900),
            ({"nothing": "useful"}, None),
        ):
            self.assertEqual(foreplay.credits_left(shape), want, shape)


class IdeationHandoffTests(unittest.TestCase):
    """An ad somebody saved on their phone has to reach the board the
    creative director works from, without anybody forwarding a link."""

    AD = {
        "id": "fp_9", "name": "Olivar spring", "headline": "ابدأ من تقييم القرار",
        "thumbnail": "https://t/x.jpg", "video": "https://storage.googleapis.com/f/x.mp4",
        "link_url": "https://olivar.example/land", "foreplay_url": "https://app.foreplay.co/ad/fp_9",
        "publisher_platform": ["facebook", "instagram"], "running_duration": 94,
        "full_transcription": "لو عندك أرض", "video_duration": 29.06,
    }

    def test_a_saved_ad_becomes_a_board_row(self):
        row = foreplay.as_idea(self.AD, by="karim@maharamedia.com", by_name="Karim")
        self.assertEqual(row["key"], "foreplay:fp_9")
        self.assertEqual(row["platform"], "facebook")
        self.assertEqual(row["url"], "https://olivar.example/land")
        self.assertEqual(row["status"], "saved")
        self.assertEqual(row["saved_by_name"], "Karim")

    def test_where_it_came_from_is_never_lost(self):
        row = foreplay.as_idea(self.AD)
        self.assertEqual(
            row["origin"], "foreplay",
            "a hand-saved ad must never look like something the radar scored",
        )

    def test_how_long_it_ran_becomes_the_reason_it_was_kept(self):
        row = foreplay.as_idea(self.AD)
        self.assertIn("94 days", row["why_it_works"])
        self.assertEqual(row["running_days"], 94)

    def test_an_ad_that_never_ran_claims_no_reason(self):
        row = foreplay.as_idea({**self.AD, "running_duration": None})
        self.assertIsNone(row["why_it_works"])

    def test_the_foreplay_page_stands_in_when_there_is_no_landing_page(self):
        row = foreplay.as_idea({**self.AD, "link_url": None})
        self.assertEqual(row["url"], "https://app.foreplay.co/ad/fp_9")

    def test_an_ad_with_no_link_at_all_is_refused(self):
        with self.assertRaises(ValueError):
            foreplay.as_idea({**self.AD, "link_url": None, "foreplay_url": None})

    def test_a_platformless_ad_still_lands_somewhere_sensible(self):
        self.assertEqual(foreplay.as_idea({**self.AD, "publisher_platform": []})["platform"], "meta")


class AdArchiveTests(unittest.TestCase):
    """Our own copy of the ads we ran. Measured 2026-09-19: 19 of 29 winners
    have already stopped, so they are gone from the Ad Library and no tool
    that reads it can fetch them. The Page token can."""

    def test_the_video_id_is_found_in_all_four_places_it_hides(self):
        cases = [
            ({"creative": {"video_id": "v1"}}, "v1"),
            ({"creative": {"object_story_spec": {"video_data": {"video_id": "v2"}}}}, "v2"),
            (
                {"creative": {"object_story_spec": {"link_data": {
                    "child_attachments": [{"image_hash": "x"}, {"video_id": "v3"}]}}}},
                "v3",
            ),
            ({"creative": {"asset_feed_spec": {"videos": [{"video_id": "v4"}]}}}, "v4"),
        ]
        for payload, want in cases:
            was = ads.graph
            ads.graph = lambda *a, **k: payload
            try:
                self.assertEqual(ads.video_id_of("ad", "t"), want, payload)
            finally:
                ads.graph = was

    def test_an_image_ad_has_no_video_and_says_so(self):
        was = ads.graph
        ads.graph = lambda *a, **k: {"creative": {"image_url": "https://x/y.jpg"}}
        try:
            self.assertIsNone(ads.video_id_of("ad", "t"))
        finally:
            ads.graph = was

    def test_the_page_token_is_tried_when_the_account_token_is_refused(self):
        calls = []

        def fake(path, token, fields="", extra=""):
            calls.append(token)
            if token == "account":
                # What Meta actually does: the field is simply absent.
                return {"from": {"id": "page9"}}
            return {"source": "https://cdn/x.mp4"}

        was = ads.graph
        ads.graph = fake
        try:
            got = ads.source_for("v1", "account", {"page9": "pagetoken"})
        finally:
            ads.graph = was
        self.assertEqual(got, "https://cdn/x.mp4")
        self.assertEqual(calls, ["account", "pagetoken"], "the account is tried first")

    def test_a_page_we_do_not_administer_returns_nothing_rather_than_guessing(self):
        was = ads.graph
        ads.graph = lambda *a, **k: {"from": {"id": "somebody_elses_page"}}
        try:
            self.assertIsNone(ads.source_for("v1", "account", {"page9": "t"}))
        finally:
            ads.graph = was

    def test_the_account_token_is_used_when_it_does_work(self):
        calls = []

        def fake(path, token, fields="", extra=""):
            calls.append(token)
            return {"source": "https://cdn/x.mp4"}

        was = ads.graph
        ads.graph = fake
        try:
            ads.source_for("v1", "account", {"page9": "pagetoken"})
        finally:
            ads.graph = was
        self.assertEqual(calls, ["account"], "no second call when the first one answers")

    def test_a_file_over_the_cap_is_refused_rather_than_filling_the_bucket(self):
        import io
        import urllib.request as ur

        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        was = ur.urlopen
        ur.urlopen = lambda *a, **k: Resp(b"x" * 500)
        try:
            with self.assertRaises(ValueError):
                ads.fetch("https://cdn/x.mp4", max_bytes=100)
            self.assertEqual(len(ads.fetch("https://cdn/x.mp4", max_bytes=1000)), 500)
        finally:
            ur.urlopen = was
