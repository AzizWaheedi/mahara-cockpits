from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from typing import Any

os.environ.setdefault("DESK_HOME", "/tmp/desk-unit")
from desk import checks, clients, media, prepare, speech
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
