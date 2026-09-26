"""The vault's sales calls into the cockpit, tested on a synthetic vault.
Every name, address and line here is invented.

    python3 -m unittest tests.test_calls_vault
"""
from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import calls_vault, http, recordings  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests.fakes import FakeFathom, FakePostgrest, meeting  # noqa: E402


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
        f"# {title}\n\n## Summary \n\n## Meeting Purpose\n\nTo show the offer.\n\n"
        "## Topics\n\n### Price\n\n- Monthly or in full\n\n"
        "## Action items\n\n- Send the deck\n\n"
        f"## Transcript (2 segments)\n\n{transcript}\n"
    )


class Parsing(unittest.TestCase):
    def test_a_note_reads_into_its_parts(self):
        meta, body = calls_vault.parse_frontmatter(note(rid="11"))
        self.assertEqual(meta["recording_id"], "11")
        self.assertEqual(meta["people"][1], "Lina Lead (lina@example.com)")
        title, secs = calls_vault.sections(body)
        self.assertEqual(title, "Demo with Lina")
        summary = calls_vault.summary_of(body)
        # Fathom's parts are kept, a level down, and the summary stops at the action items.
        self.assertIn("### Meeting Purpose", summary)
        self.assertIn("#### Price", summary)
        self.assertNotIn("Send the deck", summary)
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


class VaultCase(unittest.TestCase):
    """A synthetic vault and cockpit; the tests are in the classes below."""

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


class Run(VaultCase):
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

    def test_a_call_the_fathom_step_holds_gets_the_vaults_summary_whatever_its_kind(self):
        self.pg.put("cockpit_sales_recordings", {
            "recording_id": "55", "share_url": "https://fathom.video/share/x", "contact_id": "c-lina",
            "matched_by": "email", "summary": None})
        # Someone from outside who is not a lead: the vault could not place them.
        partner = '["Rami Rep (rami@maharamedia.com)", "Pat Partner (pat@partner.example)"]'
        self.write("e.md", note(rid="55", kind="external", people=partner))
        self.write("f.md", note(rid="66", kind="external", people=partner))  # the desk never saw it: not a new row
        out = self.run_it()
        row = self.pg.one("cockpit_sales_recordings", recording_id="55")
        self.assertIn("Meeting Purpose", row["summary"])
        self.assertEqual((row["transcript_path"], row["contact_id"]), ("55.md", "c-lina"))
        self.assertIsNone(self.pg.one("cockpit_sales_recordings", recording_id="66"))
        self.assertEqual(out["filled_fathom_rows"], 1)

    def test_dry_run_writes_nothing(self):
        self.write("a.md", note(rid="11"))
        out = self.run_it(dry=True)
        self.assertEqual(out["rows"], 1)
        self.assertIsNone(self.pg.one("cockpit_sales_recordings", recording_id="11"))
        self.assertEqual(self.pg.objects, {})


class OutsiderJoined(VaultCase):
    """A lead who joined from the link is on no invite. The call is a sales
    call all the same when someone from outside was on it."""

    ONLY_US = '["Rami Rep (rami@maharamedia.com)"]'
    NOW = datetime(2026, 8, 20, tzinfo=timezone.utc)

    def test_the_note_the_cockpit_and_fathom_each_show_an_outsider_joined(self):
        # The vault files an impromptu meeting as sales only when Fathom saw an outsider on it.
        self.write("a.md", note(rid="71", title="Impromptu Zoom Meeting", people=self.ONLY_US, date="2026-08-12"))
        # A booking-page title: the note cannot say. Fathom is asked, once.
        self.write("b.md", note(rid="72", title="مكالمة حصول المشاريع", people=self.ONLY_US, date="2026-08-14"))
        self.write("c.md", note(rid="73", title="مكالمة حصول المشاريع", people=self.ONLY_US, date="2026-08-15"))
        # Already a cockpit call (the Fathom step kept it): it stays one.
        self.pg.put("cockpit_sales_recordings", {"recording_id": "74", "matched_by": "none", "source": None})
        self.write("d.md", note(rid="74", title="Demo", people=self.ONLY_US, date="2026-08-16"))
        # Older than the days Fathom is asked about: a team meeting, as before.
        self.write("e.md", note(rid="75", title="Demo practice", people=self.ONLY_US, date="2026-06-01"))
        asked = []

        def fathom(since):
            asked.append(since)
            return {"72", "999"}

        out = self.run_it(fathom_outsiders=fathom, fathom_days=14, now=self.NOW)
        self.assertEqual(asked, [datetime(2026, 8, 13, 9, 0, tzinfo=timezone.utc)])
        self.assertEqual(out["outsider_by"], {"note": 1, "cockpit": 1, "fathom": 1})
        self.assertEqual((out["team"], out["rows"], out["unmatched"]), (2, 3, 3))
        self.assertIn("asked about 2, 1 had someone from outside", out["fathom"])
        for rid in ("71", "72", "74"):
            row = self.pg.one("cockpit_sales_recordings", recording_id=rid)
            self.assertEqual((row["matched_by"], row["contact_id"], row["kind"]), ("none", None, "sales"))
            self.assertEqual(row["transcript_path"], f"{rid}.md")
        for rid in ("73", "75"):
            self.assertIsNone(self.pg.one("cockpit_sales_recordings", recording_id=rid))

    def test_an_impromptu_title_with_a_sales_word_proves_nothing(self):
        self.assertTrue(calls_vault.outsider_in_note({"kind": "sales", "title": "Impromptu Google Meet Meeting"}))
        self.assertFalse(calls_vault.outsider_in_note({"kind": "sales", "title": "Impromptu demo"}))
        self.assertFalse(calls_vault.outsider_in_note({"kind": "team", "title": "Impromptu Zoom Meeting"}))

    def test_fathom_is_not_asked_when_nothing_is_in_doubt_and_a_refusal_costs_nothing_else(self):
        self.write("a.md", note(rid="71", title="Impromptu Zoom Meeting", people=self.ONLY_US, date="2026-08-12"))
        out = self.run_it(fathom_outsiders=lambda _s: self.fail("Fathom asked for nothing"), now=self.NOW)
        self.assertEqual((out["rows"], out["fathom"]), (1, "not needed"))
        self.write("b.md", note(rid="72", title="مكالمة حصول المشاريع", people=self.ONLY_US, date="2026-08-14"))

        def refused(_since):
            raise RuntimeError("Fathom answered 401")

        out = self.run_it(fathom_outsiders=refused, now=self.NOW)
        self.assertEqual((out["rows"], out["team"]), (1, 1))
        self.assertTrue(out["fathom"].startswith("could not be asked"))


class LeadOnTheInvite(VaultCase):
    """The vault files as `external` anyone outside it cannot place. A lead on
    the invite places them: that note is a sales call."""

    def test_an_external_note_whose_invitee_is_a_lead_comes_in_matched_by_email(self):
        self.write("a.md", note(rid="81", kind="external", title="Lina and Rami"))
        self.write("b.md", note(rid="82", kind="external", title="Rami and a partner",
                                people='["Rami Rep (rami@maharamedia.com)", "Pat (pat@partner.example)"]'))
        self.write("c.md", note(rid="83", kind="external", title="Launch call"))  # client service
        self.write("d.md", note(rid="84", kind="client", title="Onboarding"))
        out = self.run_it()
        self.assertEqual((out["lead_calls"], out["new_lead_calls"], out["rows"]), (1, 1, 1))
        row = self.pg.one("cockpit_sales_recordings", recording_id="81")
        self.assertEqual((row["contact_id"], row["matched_by"], row["kind"], row["source"]),
                         ("c-lina", "email", "sales", "vault"))
        self.assertIn("sales-calls/81.md", self.pg.objects)
        for rid in ("82", "83", "84"):
            self.assertIsNone(self.pg.one("cockpit_sales_recordings", recording_id=rid))

    def test_the_vault_lists_every_recording_it_holds(self):
        self.write("a.md", note(rid="81", kind="external"))
        self.write("b.md", note(rid="82", kind="team"))
        self.write("_index.md", "not a call")
        self.assertEqual(calls_vault.vault_ids(self.vault), {"81", "82"})


class Marking(VaultCase):
    """Once an import has written, one meeting recorded twice and the phone
    calls that are only the carrier's message are marked, once a run."""

    def test_the_vault_import_marks_once_and_says_how_many_and_a_dry_run_never(self):
        asked = []
        self.pg.rpcs["cockpit_sales_mark_recordings"] = lambda body: asked.append(body) or 3
        self.write("a.md", note(rid="11"))
        self.assertEqual((self.run_it(dry=True)["marked"], asked), (None, []))
        self.assertEqual((self.run_it()["marked"], asked), (3, [{}]))

    def test_the_fathom_index_marks_too_and_a_refusal_is_said_not_raised(self):
        said: list[str] = []
        start = (datetime.now(timezone.utc) - timedelta(hours=5)).replace(microsecond=0).isoformat()
        f = FakeFathom(meetings={None: [meeting("7", start=start, invitees=[
            {"email": "lina@example.com", "is_external": True}])]})
        with mock.patch.object(http, "request", self.pg):  # nobody stood the function up: a 404
            out = recordings.index(self.sb, f, said.append, days=14)
        self.assertEqual((out["indexed"], out["by_email"], out["marked"]), (1, 1, None))
        self.assertTrue(any("recordings stored, but duplicates and stubs were not marked" in s for s in said))
        self.assertEqual(self.pg.one("cockpit_sales_recordings", recording_id="7")["contact_id"], "c-lina")


if __name__ == "__main__":
    unittest.main()
