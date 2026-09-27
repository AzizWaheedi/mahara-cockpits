"""The cockpit's revisions to the call scripts (scripts_import/revise.py):
applied once on top of the Google Docs' text, never twice, and an import
that finds a doc changed under a revision stops instead of loading half of
it. Run from hermes/sales-desk:

    python3 -m unittest tests.test_scripts_revise
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts_import"))

import revise  # noqa: E402


def intro(lang: str = "en") -> dict:
    """The smallest intro doc with every line the revision edits."""
    win = "So your conversion rate is [X%]" if lang == "en" else "يعني نسبة التحويل عندك [X%]"
    return {
        "key": "intro",
        "lang": lang,
        "stages": [
            {"no": 3, "blocks": [{"type": "say", "text": win}], "checklist": []},
            {
                "no": 4,
                "checklist": ["You know if they've tried marketing before"],
                "blocks": [
                    {"type": "say", "text": "Are you currently doing anything to solve it?"},
                    {"type": "say", "text": "And how's that going?", "branch": "If YES (tried marketing before)"},
                    {"type": "say", "text": "Awesome.", "branch": "If they say it's going well"},
                ],
            },
        ],
        "objections": [],
        "faqs": [
            {
                "title": '"Do you have guarantees?"',
                "blocks": [
                    {"type": "say", "text": "Yes, we do have guarantees."},
                    {"type": "adapt", "text": "Do NOT state the guarantee (30 appointments in 90 days). Let the closer use it as a closing tool."},
                ],
            }
        ],
    }


class ReviseTests(unittest.TestCase):
    def test_intro_asks_two_light_numbers_after_the_marketing_answer(self):
        out = revise.apply(intro())
        s4 = next(s for s in out["stages"] if s["no"] == 4)
        branches = [b.get("branch") for b in s4["blocks"]]
        self.assertEqual(
            branches,
            [None, "If YES (tried marketing before)", revise.INTRO_ADS, revise.INTRO_ADS, "If they say it's going well"],
        )
        self.assertIn("inquiries does that bring in", s4["blocks"][2]["text"])
        self.assertIn(revise.INTRO_STAGE4_CHECKS[0], s4["checklist"])
        s3 = next(s for s in out["stages"] if s["no"] == 3)
        self.assertEqual(s3["blocks"][0]["text"], "So you're winning about [QUOTE WIN RATE] of your quotes.")
        faq = out["faqs"][0]["blocks"][1]["text"]
        self.assertNotIn("closing tool", faq)
        self.assertIn("answer to an objection", faq)

    def test_the_arabic_intro_asks_in_kuwaiti(self):
        out = revise.apply(intro("ar"))
        s4 = next(s for s in out["stages"] if s["no"] == 4)
        self.assertEqual(s4["blocks"][2]["text"], "وتقريباً جم تحط على الإعلانات بالشهر؟ وجم استفسار ييك منها؟")

    def test_applied_once_and_the_input_is_untouched(self):
        doc = intro()
        once = revise.apply(doc)
        self.assertEqual(revise.apply(once), once)
        self.assertNotIn("revisions", doc)
        self.assertEqual(once["revisions"], [revise.NUMBERS])

    def test_a_doc_changed_under_a_revision_stops_the_import(self):
        doc = intro()
        doc["stages"][0]["blocks"][0]["text"] = "So you close [X%] of quotes"
        with self.assertRaises(revise.Drift) as e:
            revise.apply(doc)
        self.assertIn("So your conversion rate is", str(e.exception))

    def test_a_script_it_does_not_know_is_refused(self):
        with self.assertRaises(revise.Drift):
            revise.apply({"key": "follow-up", "lang": "en", "stages": []})

    def test_every_leak_branch_says_which_leak_it_tells(self):
        # The demo's branches carry the step the cockpit opens them for.
        whens = set()
        for kind in (revise.ADS, revise.BOOKING, revise.SHOW, revise.CLOSE, revise.VOLUME, revise.REFERRALS):
            self.assertTrue(kind.startswith("If "))
        src = (Path(revise.__file__)).read_text()
        for key in ("ads", "booking", "show", "close", "volume", "referrals"):
            self.assertGreaterEqual(src.count(f'"leak:{key}"'), 4, key)
            whens.add(key)
        self.assertEqual(len(whens), 6)


if __name__ == "__main__":
    unittest.main()
