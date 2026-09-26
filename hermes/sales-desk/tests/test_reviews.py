"""Vince's reviews: his format read back, the archive joined to calls, and a
new review written by a scripted model. Every name and line is invented.

    python3 -m unittest tests.test_reviews
"""
from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, reviews  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests.fakes import FakePostgrest, FakeProvider  # noqa: E402

PARTS = ["Frame Set Execution", "Finding The Pain", "Understanding Current State", "Exhausting Past Attempts",
         "Cost Of Inaction", "Find The Goal", "Transitioning To The Pitch", "Pitching Your Product",
         "Investment & Close", "Objections", "Process", "Confidence", "Flow", "Tonality", "Closing The Deal"]


def demo_log(*, link: str = "https://fathom.video/share/AbC123", closer: str = "Rami Rep",
             lead: str = "Lina Lead", day: str = "2026-08-10", preamble: bool = True) -> str:
    items = "\n".join(f"*{i}. {p} — {5 if i % 2 else 6}/10*" for i, p in enumerate(PARTS, 1))
    return ((("Reading the transcript now.\n\n---\n\n") if preamble else "")
            + "# DEMO Call Coaching Log\n\n"
            f"*Closer Name:*{closer}\nLead Name: {lead}\nDate Of Call: {day}\nCall Recording Link: {link}\n\n---\n\n"
            f"{items}\n\n---\n\n*Grade: 82/150*\n\n---\n\n*Pros:*\n\n- You asked for the budget early.\n\n---\n\n"
            "*Feedback:*\n\n*Frame Set — too long*\nScript to use: *\"Let us start with you.\"*\n\n---\n\n"
            "> React to this message with a ✅ to confirm you have read the feedback.\n")


class Parse(unittest.TestCase):
    def test_a_demo_log_reads_into_its_parts(self):
        p = reviews.parse(demo_log(), "Demo_Lina_review.md")
        self.assertEqual((p["call_type"], p["rep_name"], p["lead_name"], p["call_day"]),
                         ("demo", "Rami Rep", "Lina Lead", "2026-08-10"))
        self.assertEqual(p["link"], "https://fathom.video/share/AbC123")
        self.assertEqual(len(p["items"]), 15)
        self.assertEqual((p["score"], p["score_max"]), (82.0, 150.0))
        self.assertIn("budget early", p["pros"])
        self.assertIn("Script to use", p["feedback"])
        self.assertTrue(p["body"].startswith("# DEMO Call Coaching Log"))
        self.assertNotIn("React to this message", p["body"])

    def test_the_templates_own_title_is_not_kept(self):
        p = reviews.parse(demo_log(preamble=False).replace(
            "# DEMO Call Coaching Log", "# DEMO Call Coaching Log — Reference Template"), "x")
        self.assertTrue(p["body"].startswith("# DEMO Call Coaching Log\n"))

    def test_an_intro_names_its_maqsam_call(self):
        text = "# INTRO Call Coaching Log\n\n*Frame Set Execution — 4/10*\n*Booking The Demo — 6/10*\n\n*Grade: 45/100*\n"
        p = reviews.parse(text, "miriam_intro_2026-06-08_abc-123_review.md")
        self.assertEqual((p["call_type"], p["maqsam_call_id"], p["call_day"]), ("intro", "abc-123", "2026-06-08"))
        self.assertEqual((p["score"], p["score_max"]), (45.0, 100.0))

    def test_rep_names_are_found_through_spelling_and_first_names(self):
        reps = [{"id": "ahmed", "display_name": "Ahmed Abushaiba", "closer_aliases": ["Ahmed Abushaiba"]},
                {"id": "maria", "display_name": "Maria", "closer_aliases": ["Maria"]},
                {"id": "mariam", "display_name": "Mariam", "closer_aliases": ["Mariam"]},
                {"id": "aziz", "display_name": "Aziz Waheedi", "closer_aliases": []}]
        self.assertEqual(reviews.rep_key_for("Ahmed Abusahiba (MaharaMedia)", reps), "ahmed")
        self.assertEqual(reviews.rep_key_for("Maria Jaadeh", reps), "maria")
        self.assertEqual(reviews.rep_key_for("Miriam Al Laham", reps), "mariam")
        self.assertEqual(reviews.rep_key_for("Abdulaziz Waheedi", reps), "aziz")
        self.assertIsNone(reviews.rep_key_for("Someone Else", reps))


class Archive(unittest.TestCase):
    def test_reviews_join_their_calls_by_link_or_by_the_days_longest(self):
        pg = FakePostgrest()
        pg.put("cockpit_sales_reps", {"id": "r1", "display_name": "Rami Rep", "closer_aliases": [],
                                      "fathom_email": "rami@maharamedia.com", "maqsam_email": None})
        pg.put("cockpit_sales_recordings", {"recording_id": "11", "contact_id": "c-lina",
                                            "share_url": "https://fathom.video/share/AbC123",
                                            "started_at": "2026-08-10T09:00:00+00:00"})
        for rid, dur in (("21", 1800), ("22", 3600)):
            pg.put("cockpit_sales_recordings", {"recording_id": rid, "contact_id": f"c-{rid}", "share_url": None,
                                                "started_at": "2026-08-12T09:00:00+00:00", "duration_s": dur,
                                                "recorded_by": "rami@maharamedia.com", "title": "مكالمة", "people": []})
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "a_review.md").write_text(demo_log(), encoding="utf-8")
            (Path(tmp) / "b_review.md").write_text(
                demo_log(link="", day="2026-08-12", lead="Nobody Named"), encoding="utf-8")
            with mock.patch.object(http, "request", pg):
                out = reviews.import_archive(Supabase("https://example.supabase.co", "k"), Path(tmp), lambda _m: None)
        self.assertEqual(out["joined_by"], {"link": 1, "day_longest": 1})
        a = pg.one("cockpit_sales_reviews", source_ref="vince:a_review.md")
        self.assertEqual((a["recording_id"], a["contact_id"], a["rep_key"]), ("11", "c-lina", "r1"))
        b = pg.one("cockpit_sales_reviews", source_ref="vince:b_review.md")
        self.assertEqual(b["recording_id"], "22")


class NewReviews(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        k = Path(self.tmp.name)
        for f in ("coaching-log-template.md", "sales-framework.md", "intro-coaching-log-template.md",
                  "intro-call-framework.md"):
            (k / f).write_text(f"# {f}\n", encoding="utf-8")
        self.knowledge = k
        self.pg = FakePostgrest()
        self.pg.put("cockpit_sales_reps", {"id": "r1", "display_name": "Rami Rep",
                                           "fathom_email": "rami@maharamedia.com", "maqsam_email": None})
        self.pg.put("cockpit_sales_leads", {"contact_id": "c-lina", "name": "Lina Lead", "email": "l@example.com"})
        self.pg.put("cockpit_sales_recordings", {
            "recording_id": "11", "title": "Demo", "recorded_by": "rami@maharamedia.com",
            "started_at": "2026-09-01T09:00:00+00:00", "share_url": "https://fathom.video/share/x",
            "contact_id": "c-lina", "appointment_id": None, "transcript_path": "11.md", "transcript_chars": 9000})
        self.pg.objects["sales-calls/11.md"] = ("text/markdown", b"**Rami** (00:00:01): Hello")

    def tearDown(self):
        self.tmp.cleanup()

    def run_it(self, replies):
        p = FakeProvider(replies)
        with mock.patch.object(http, "request", self.pg):
            out = reviews.review_new(Supabase("https://example.supabase.co", "k"), p, lambda _m: None,
                                     knowledge=self.knowledge, since=datetime(2026, 8, 24, tzinfo=timezone.utc),
                                     limit=2, min_chars=5000)
        return out, p

    def test_a_new_call_gets_a_scored_review_and_is_not_reviewed_twice(self):
        out, p = self.run_it([demo_log(preamble=False)])
        self.assertEqual((out["due"], out["reviewed"]), (1, 1))
        row = self.pg.one("cockpit_sales_reviews", source_ref="desk:11")
        self.assertEqual((row["score"], row["rep_key"], row["lead_name"]), (82.0, "r1", "Lina Lead"))
        self.assertIn("Hello", p.calls[0]["user"])
        again, _ = self.run_it([])
        self.assertEqual(again["due"], 0)

    def test_an_unscored_answer_is_asked_again_then_given_up(self):
        out, p = self.run_it(["A chat with no scores.", "Still no scores."])
        self.assertEqual((out["reviewed"], out["failed"]), (0, 1))
        self.assertEqual(len(p.calls), 2)
        self.assertIsNone(self.pg.one("cockpit_sales_reviews", source_ref="desk:11"))

    def ask(self, replies, **ask):
        self.pg.put("cockpit_sales_review_asks", {"id": "q1", "recording_id": "11", "requested_by": "rep@x.com",
                                                  "state": "queued", "requested_at": "2026-09-26T08:00:00+00:00",
                                                  **ask})
        p = FakeProvider(replies)
        with mock.patch.object(http, "request", self.pg):
            out = reviews.review_asked(Supabase("https://example.supabase.co", "k"), p, lambda _m: None,
                                       knowledge=self.knowledge, limit=5)
        return out, p

    def test_a_call_a_rep_asked_about_is_reviewed_and_the_ask_closed(self):
        out, _ = self.ask([demo_log(preamble=False)])
        self.assertEqual((out["asked"], out["reviewed"], out["failed"]), (1, 1, 0))
        self.assertEqual(self.pg.one("cockpit_sales_review_asks", id="q1")["state"], "done")
        self.assertIsNotNone(self.pg.one("cockpit_sales_reviews", source_ref="desk:11"))

    def test_a_call_already_reviewed_closes_the_ask_without_a_second_review(self):
        self.pg.put("cockpit_sales_reviews", {"id": "v1", "source_ref": "desk:11", "recording_id": "11"})
        out, p = self.ask([])
        self.assertEqual((out["reviewed"], out["failed"]), (0, 0))
        self.assertEqual(len(p.calls), 0)
        self.assertEqual(self.pg.one("cockpit_sales_review_asks", id="q1")["state"], "done")

    def test_an_ask_that_fails_says_why(self):
        self.pg.put("cockpit_sales_recordings", {"recording_id": "12", "title": "No words", "transcript_path": None})
        out, _ = self.ask([], recording_id="12")
        self.assertEqual(out["failed"], 1)
        row = self.pg.one("cockpit_sales_review_asks", id="q1")
        self.assertEqual(row["state"], "failed")
        self.assertIn("no transcript", row["error"])


if __name__ == "__main__":
    unittest.main()
