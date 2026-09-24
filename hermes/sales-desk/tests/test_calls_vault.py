"""The vault's sales calls into the cockpit, tested on a synthetic vault.
Every name, address and line here is invented.

    python3 -m unittest tests.test_calls_vault
"""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import calls_vault, http  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402


def note(*, rid: str, kind: str = "sales", date: str = "2026-08-10", time: str = "09:00",
         people: str = '["Rami Rep (rami@maharamedia.com)", "Lina Lead (lina@example.com)"]',
         transcript: str = "**Rami Rep** (00:00:01): Hello\n**Lina Lead** (00:00:03): Hi",
         title: str = "Demo with Lina") -> str:
    return (
        "---\n"
        f"type: call\nsource: fathom\nkind: {kind}\ndate: {date}\ntime: {time}\n"
        f"duration: 1 h 5 min\nrecording_id: {rid}\nurl: https://fathom.video/calls/{rid}\n"
        f"language: en\npeople: {people}\ntags: [\"call\"]\n"
        "---\n\n"
        f"# {title}\n\n## Summary \n\n### Meeting Purpose\nTo show the offer.\n\n"
        "## Action items\n\n- Send the deck\n\n"
        f"## Transcript \n\n{transcript}\n"
    )


class Parsing(unittest.TestCase):
    def test_a_note_reads_into_its_parts(self):
        meta, body = calls_vault.parse_frontmatter(note(rid="11"))
        self.assertEqual(meta["recording_id"], "11")
        self.assertEqual(meta["people"][1], "Lina Lead (lina@example.com)")
        title, secs = calls_vault.sections(body)
        self.assertEqual(title, "Demo with Lina")
        self.assertIn("### Meeting Purpose", secs["summary"])
        self.assertEqual(secs["action items"], "- Send the deck")
        self.assertTrue(secs["transcript"].startswith("**Rami Rep**"))

    def test_invitees_durations_and_times(self):
        self.assertEqual(
            calls_vault.people_of(["A B (a@x.com)", "c@y.com", "Just A Name"]),
            [{"name": "A B", "email": "a@x.com"}, {"name": "", "email": "c@y.com"},
             {"name": "Just A Name", "email": ""}])
        self.assertEqual(calls_vault.duration_seconds("1 h 5 min"), 3900)
        self.assertEqual(calls_vault.duration_seconds("16 min"), 960)
        self.assertIsNone(calls_vault.duration_seconds(""))
        t = calls_vault.started_at({"date": "2026-08-10", "time": "09:05"})
        self.assertEqual(t.isoformat(), "2026-08-10T09:05:00+00:00")


class Run(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.vault = Path(self.tmp.name)
        (self.vault / "Calls" / "2026").mkdir(parents=True)
        self.pg = FakePostgrest()
        self.pg.put("cockpit_sales_leads", {"contact_id": "c-lina", "name": "Lina", "email": "Lina@Example.com"})
        self.pg.put("cockpit_sales_leads", {"contact_id": "c-omar", "name": "Omar", "email": "omar@example.com"})
        self.pg.put("cockpit_sales_appointments", {
            "appointment_id": "a-omar", "contact_id": "c-omar", "call_type": "demo",
            "start_at": "2026-08-11T12:10:00+00:00", "status": "confirmed", "assigned_user_id": "u-rami"})
        self.pg.put("cockpit_sales_reps", {"id": "r1", "ghl_user_id": "u-rami",
                                           "fathom_email": "rami@maharamedia.com", "maqsam_email": None})
        self.sb = Supabase("https://example.supabase.co", "service-test")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name: str, text: str) -> None:
        (self.vault / "Calls" / "2026" / name).write_text(text, encoding="utf-8")

    def run_it(self, **kw):
        with mock.patch.object(http, "request", self.pg):
            return calls_vault.run(
                self.sb, self.vault, lambda _m: None,
                upload=lambda path, blob: self.sb.upload_to("sales-calls", path, blob, "text/markdown"), **kw)

    def test_calls_land_matched_with_their_transcripts(self):
        self.write("a.md", note(rid="11"))
        # The lead joined from the link: nobody from outside on the invite, but
        # Omar's demo with this rep began 10 minutes after the recording.
        self.write("b.md", note(rid="22", date="2026-08-11", time="12:00",
                                people='["Rami Rep (rami@maharamedia.com)"]', title="Demo"))
        # A team meeting with a sales word: no outsider, no appointment.
        self.write("c.md", note(rid="33", date="2026-08-12", people='["Rami Rep (rami@maharamedia.com)"]'))
        self.write("d.md", note(rid="44", kind="team"))
        out = self.run_it()
        self.assertEqual((out["rows"], out["team"], out["by_email"], out["by_appointment"]), (2, 1, 1, 1))
        a = self.pg.one("cockpit_sales_recordings", recording_id="11")
        self.assertEqual((a["contact_id"], a["matched_by"], a["source"]), ("c-lina", "email", "vault"))
        self.assertEqual(a["duration_s"], 3900)
        self.assertIn("Meeting Purpose", a["summary"])
        self.assertEqual(a["transcript_path"], "11.md")
        b = self.pg.one("cockpit_sales_recordings", recording_id="22")
        self.assertEqual((b["contact_id"], b["appointment_id"], b["matched_by"]), ("c-omar", "a-omar", "appointment"))
        self.assertIn("sales-calls/11.md", self.pg.objects)
        self.assertIsNone(self.pg.one("cockpit_sales_recordings", recording_id="33"))

    def test_a_second_run_uploads_nothing_new_and_keeps_links_and_hand_matches(self):
        self.pg.put("cockpit_sales_recordings", {
            "recording_id": "11", "share_url": "https://fathom.video/share/abc", "source": "fathom",
            "contact_id": "c-omar", "matched_by": "hand"})
        self.write("a.md", note(rid="11"))
        first = self.run_it()
        self.assertEqual(first["transcripts_uploaded"], 1)
        row = self.pg.one("cockpit_sales_recordings", recording_id="11")
        self.assertEqual(row["share_url"], "https://fathom.video/share/abc")
        self.assertEqual((row["contact_id"], row["matched_by"], row["source"]), ("c-omar", "hand", "fathom"))
        again = self.run_it()
        self.assertEqual(again["transcripts_uploaded"], 0)

    def test_a_call_written_twice_keeps_the_longer_transcript(self):
        self.write("a.md", note(rid="11", transcript="**A** (00:00:01): short"))
        self.write("a2.md", note(rid="11", transcript="**A** (00:00:01): a much longer transcript line"))
        self.run_it()
        self.assertIn(b"much longer", self.pg.objects["sales-calls/11.md"][1])

    def test_dry_run_writes_nothing(self):
        self.write("a.md", note(rid="11"))
        out = self.run_it(dry=True)
        self.assertEqual(out["rows"], 1)
        self.assertIsNone(self.pg.one("cockpit_sales_recordings", recording_id="11"))
        self.assertEqual(self.pg.objects, {})


if __name__ == "__main__":
    unittest.main()
