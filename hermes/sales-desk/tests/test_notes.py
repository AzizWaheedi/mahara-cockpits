"""Notes after every call and the digest: a scripted model, invented calls.

    python3 -m unittest tests.test_notes
"""
from __future__ import annotations

import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, notes  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests.fakes import FakePostgrest, FakeProvider  # noqa: E402

NOTE = {
    "summary": "A contracting firm that wants more villa projects.",
    "pains": ["Leads from Instagram are not serious"],
    "goals": ["Two villa projects a month"],
    "budget": "Ready to put 5,000 KWD in",
    "questions": ["How long until the first project?"],
    "objections": [{"objection": "Tried an agency before", "handled": True, "how": "Showed the case study"}, "Price"],
    "expectations": ["Meetings within a month"],
    "for_closer": "The partner decides with him; ask for both on the demo.",
    "gate": {"industry_fit": "yes", "revenue_500k": "Yes", "decision_maker": "maybe", "pain_in_words": "yes", "budget_5k": "yes"},
    "assessment": {"readiness": "8", "authority": 12, "budget": "5,000 KWD"},
    "verdict": "Qualified",
    "verdict_why": "Real firm, budget ready, he decides with his partner.",
}


class Notes(unittest.TestCase):
    def setUp(self):
        self.pg = FakePostgrest()
        self.pg.put("cockpit_sales_reps", {"id": "r1", "display_name": "Rami Rep",
                                           "fathom_email": "rami@maharamedia.com", "maqsam_email": None})
        self.pg.put("cockpit_sales_recordings", {
            "recording_id": "11", "title": "Intro call", "recorded_by": "rami@maharamedia.com",
            "started_at": "2026-09-20T09:00:00+00:00", "contact_id": "c1", "appointment_id": None,
            "transcript_path": "11.md", "transcript_chars": 9000, "source": "vault"})
        self.pg.objects["sales-calls/11.md"] = ("text/markdown", b"**Rami** (00:00:01): Hello")

    def run_notes(self, replies, now=None):
        p = FakeProvider(replies)
        self.warned = []
        with mock.patch.object(http, "request", self.pg):
            out = notes.run_notes(Supabase("https://example.supabase.co", "k"), p, lambda _m: None,
                                  since=datetime(2026, 9, 1, tzinfo=timezone.utc), limit=4, min_chars=5000,
                                  now=now or datetime(2026, 9, 26, 9, 0, tzinfo=timezone.utc), warn=self.warned.append)
        return out, p

    def test_a_call_gets_notes_once_in_the_cockpits_shape(self):
        out, p = self.run_notes([json.dumps(NOTE)])
        self.assertEqual((out["due"], out["written"]), (1, 1))
        row = self.pg.one("cockpit_sales_call_notes", recording_id="11")
        self.assertEqual((row["call_type"], row["verdict"], row["rep"]), ("intro", "qualified", "Rami Rep"))
        self.assertEqual(row["notes"]["objections"][1], {"objection": "Price", "handled": False, "how": ""})
        self.assertIn("Hello", p.calls[0]["user"])
        again, _ = self.run_notes([])
        self.assertEqual(again["due"], 0)

    def test_the_gate_and_assessment_keep_only_what_they_can_be(self):
        n = notes.clean_notes(NOTE)
        self.assertEqual(n["gate"], {"industry_fit": "yes", "revenue_500k": "yes", "decision_maker": "unknown",
                                     "pain_in_words": "yes", "budget_5k": "yes"})
        self.assertEqual((n["assessment"]["readiness"], n["assessment"]["authority"]), (8, None))

    def test_a_verdict_the_cockpit_does_not_know_is_unclear(self):
        self.assertEqual(notes.clean_notes({"verdict": "maybe"})["verdict"], "unclear")
        self.assertEqual(notes.clean_notes({"verdict": "not qualified"})["verdict"], "not_qualified")

    def test_the_digest_reads_the_notes_and_an_empty_window_says_so(self):
        self.pg.put("cockpit_sales_call_notes", {"recording_id": "11", "call_type": "intro",
                                                 "call_at": "2026-09-20T09:00:00+00:00", "verdict": "qualified",
                                                 "notes": notes.clean_notes(NOTE)})
        digest = {"questions": [{"text": "How long until results?", "count": 3, "example": "متى النتائج؟"}],
                  "objections": [{"text": "Tried an agency", "count": 2, "answer": "Case study"}],
                  "problems": [], "expectations": [], "marketing": [{"idea": "A video on time to first project", "why": "Asked most"}]}
        p = FakeProvider([json.dumps(digest)])
        now = datetime(2026, 9, 26, tzinfo=timezone.utc)
        with mock.patch.object(http, "request", self.pg):
            out = notes.run_digest(Supabase("https://example.supabase.co", "k"), p, lambda _m: None, days=7, now=now)
            empty = notes.run_digest(Supabase("https://example.supabase.co", "k"), FakeProvider([]), lambda _m: None,
                                     days=7, now=datetime(2026, 10, 30, tzinfo=timezone.utc))
        self.assertEqual((out["calls"], empty["calls"]), (1, 0))
        self.assertIn("Tried an agency before", p.calls[0]["user"])
        rows = sorted(self.pg.rows("cockpit_sales_digests"), key=lambda r: r["to_at"])
        self.assertEqual(rows[0]["digest"]["questions"][0]["count"], 3)
        self.assertEqual(rows[1]["digest"]["questions"], [])


    def test_a_call_that_fails_twice_in_a_day_is_set_aside_until_the_day_passes(self):
        del self.pg.objects["sales-calls/11.md"]  # its transcript cannot be read
        first = datetime(2026, 9, 26, 9, 0, tzinfo=timezone.utc)
        for hours in (0, 2):
            out, _ = self.run_notes([], now=first + timedelta(hours=hours))
            self.assertEqual((out["due"], out["failed"]), (1, 1))
        self.assertIn("notes: 11 failed", self.warned[0])
        row = self.pg.one("cockpit_sales_desk_failures", job="notes", item_id="11")
        self.assertEqual((row["failures"], row["first_at"]), (2, "2026-09-26T09:00:00Z"))
        out, p = self.run_notes([], now=first + timedelta(hours=5))
        self.assertEqual((out["due"], out["set_aside"], len(p.calls)), (0, 1, 0))
        # A day after the first failure it is tried again, and once it works its failures are forgotten.
        self.pg.objects["sales-calls/11.md"] = ("text/markdown", b"**Rami** (00:00:01): Hello")
        out, _ = self.run_notes([json.dumps(NOTE)], now=first + timedelta(hours=25))
        self.assertEqual((out["written"], out["set_aside"]), (1, 0))
        self.assertIsNone(self.pg.one("cockpit_sales_desk_failures", job="notes", item_id="11"))

    def test_a_hidden_recording_gets_no_notes(self):
        self.pg.one("cockpit_sales_recordings", recording_id="11")["hidden_reason"] = "duplicate"
        out, p = self.run_notes([])
        self.assertEqual((out["due"], len(p.calls)), (0, 0))

    def test_a_digest_from_part_of_the_window_says_so_and_counts_the_unmarked_calls(self):
        now = datetime(2026, 9, 26, tzinfo=timezone.utc)
        self.pg.put("cockpit_sales_call_notes", {"recording_id": "11", "call_type": "intro",
                                                 "call_at": "2026-09-20T09:00:00+00:00", "verdict": "qualified",
                                                 "notes": notes.clean_notes(NOTE)})
        # A second call waits for its notes; a hidden copy and a short one are not the window's calls.
        for rid, over in (("12", {}), ("13", {"hidden_reason": "duplicate"}), ("14", {"transcript_chars": 900})):
            self.pg.put("cockpit_sales_recordings", {"recording_id": rid, "started_at": "2026-09-22T09:00:00+00:00",
                                                     "transcript_path": f"{rid}.md", "transcript_chars": 9000, **over})
        for aid, start, mark in (("a1", "2026-09-24T09:00:00+00:00", True), ("a2", "2026-09-10T09:00:00+00:00", True),
                                 ("a3", "2026-09-24T10:00:00+00:00", False)):
            self.pg.put("cockpit_sales_calendar", {"appointment_id": aid, "start_at": start, "needs_mark": mark})
        digest = {"questions": [], "objections": [], "problems": [], "expectations": [], "marketing": []}
        with mock.patch.object(http, "request", self.pg):
            out = notes.run_digest(Supabase("https://example.supabase.co", "k"), FakeProvider([json.dumps(digest)]),
                                   lambda _m: None, days=7, now=now, min_chars=5000)
        self.assertEqual(out, {"days": 7, "calls": 1, "of": 2, "partial": True, "unmarked": 1})
        row = self.pg.rows("cockpit_sales_digests")[0]
        self.assertEqual((row["calls_used"], row["digest"]["calls_total"], row["digest"]["partial"],
                          row["digest"]["calls_unmarked"]), (1, 2, True, 1))
        # Once every call has its notes, the digest is whole.
        self.pg.put("cockpit_sales_call_notes", {"recording_id": "12", "call_type": "demo",
                                                 "call_at": "2026-09-22T09:00:00+00:00", "notes": notes.clean_notes(NOTE)})
        with mock.patch.object(http, "request", self.pg):
            out = notes.run_digest(Supabase("https://example.supabase.co", "k"), FakeProvider([json.dumps(digest)]),
                                   lambda _m: None, days=7, now=now, min_chars=5000)
        self.assertEqual((out["calls"], out["of"], out["partial"]), (2, 2, False))


if __name__ == "__main__":
    unittest.main()
