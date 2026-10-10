"""Where each answer's field sits in the cockpit's script (sales simplify,
2026-10-10): captures.json anchors a field under the line that asks for it,
load.py keeps an anchor only where that line is in the language's own stage,
and parse.py no longer cuts a stage off at a label set as a heading (the
Arabic intro's "Examples:", which carried the booking, the tie-downs and the
show-rate lock out of Transition to Demo). Run from hermes/sales-desk:

    python3 -m unittest tests.test_scripts_import_anchors
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent / "scripts_import"
sys.path.insert(0, str(HERE))

import load  # noqa: E402
import parse  # noqa: E402


def doc(stages: dict[int, list[str]]) -> dict:
    """A doc whose stages hold blocks of the given types, in order."""
    return {
        "key": "intro",
        "lang": "en",
        "stages": [
            {"no": no, "blocks": [{"type": t, "text": f"{no}.{i} {t}"} for i, t in enumerate(types)], "checklist": []}
            for no, types in stages.items()
        ],
    }


class CapturesFor(unittest.TestCase):
    def test_kept_where_the_line_is(self):
        caps = [{"stage": 3, "after": 2, "key": "focus_project", "label": "x", "type": "text"}]
        out, dropped = load.captures_for(doc({3: ["say", "step", "say"]}), caps)
        self.assertEqual(out[0]["after"], 2)
        self.assertEqual(dropped, [])

    def test_a_step_heading_is_refused(self):
        caps = [{"stage": 3, "after": 1, "key": "focus_project", "label": "x", "type": "text"}]
        out, dropped = load.captures_for(doc({3: ["say", "step", "say"]}), caps)
        self.assertNotIn("after", out[0])
        self.assertEqual(dropped, ["focus_project (stage 3, block 1)"])

    def test_out_of_range_or_missing_stage_is_dropped(self):
        caps = [
            {"stage": 6, "after": 18, "key": "partner_on_demo", "label": "x", "type": "choice"},
            {"stage": 9, "after": 0, "key": "nowhere", "label": "x", "type": "text"},
            {"stage": 6, "after": -1, "key": "negative", "label": "x", "type": "text"},
            {"stage": 6, "after": True, "key": "not_a_number", "label": "x", "type": "text"},
        ]
        out, dropped = load.captures_for(doc({6: ["step", "say", "say", "step"]}), caps)
        self.assertTrue(all("after" not in c for c in out))
        self.assertEqual(len(dropped), 4)

    def test_unanchored_fields_pass_through_and_the_input_is_left_as_it_is(self):
        caps = [{"stage": 6, "key": "for_the_closer", "label": "For the closer", "type": "text"},
                {"stage": 6, "after": 9, "key": "partner_on_demo", "label": "x", "type": "choice"}]
        before = json.dumps(caps)
        out, dropped = load.captures_for(doc({6: ["say"]}), caps)
        self.assertEqual(out[0], caps[0])
        self.assertEqual(json.dumps(caps), before)
        self.assertEqual(dropped, ["partner_on_demo (stage 6, block 9)"])

    def test_per_language(self):
        """The same anchor is kept in a full stage and dropped in a short one."""
        caps = [{"stage": 6, "after": 18, "key": "partner_on_demo", "label": "x", "type": "choice"}]
        en, _ = load.captures_for(doc({6: ["say"] * 26}), caps)
        ar, dropped = load.captures_for(doc({6: ["step", "say", "say", "step"]}), caps)
        self.assertEqual(en[0]["after"], 18)
        self.assertNotIn("after", ar[0])
        self.assertEqual(dropped, ["partner_on_demo (stage 6, block 18)"])


class CapturesFile(unittest.TestCase):
    def test_every_anchor_is_a_whole_number_on_a_known_stage(self):
        data = json.loads((HERE / "captures.json").read_text())
        for key, caps in data.items():
            keys = [c["key"] for c in caps]
            self.assertEqual(len(keys), len(set(keys)), key)
            for c in caps:
                if "after" in c:
                    self.assertIsInstance(c["after"], int, c["key"])
                    self.assertGreaterEqual(c["after"], 0, c["key"])

    def test_the_closers_line_has_no_field_of_its_own(self):
        """For the closer is part 6's notes in the cockpit, so it is never anchored."""
        data = json.loads((HERE / "captures.json").read_text())
        closer = next(c for c in data["intro"] if c["key"] == "for_the_closer")
        self.assertNotIn("after", closer)

    def test_the_numbers_the_demo_walks_are_in_funnel_order(self):
        data = json.loads((HERE / "captures.json").read_text())
        at = {c["key"]: c.get("after") for c in data["demo"] if c["stage"] == 4}
        order = ["ad_spend_month", "ad_leads_month", "leads_month", "booked_month", "showed_month", "closed_month"]
        self.assertEqual([at[k] for k in order], sorted(at[k] for k in order))


ANNOTATED = """TAB Arabic
<HEADING_1> Intro Call Framework
<HEADING_2> 6 · Transition to Demo
GOAL: Book the demo.
TIME: 2 min
<HEADING_3> THE PRE-PITCH
[[HL:#ffff00]][NAME]، يمديني أعطيك رأيي؟[[/HL]]
<HEADING_3> The missing piece is [match to their specific pain]
<HEADING_2> Examples:
[[HL:#ffff00]]الميزة اللي تميّزنا تحل لك المشكلة[[/HL]]
<HEADING_3> CALENDAR LOCK (do this while on the call)
[[HL:#ffff00]]جدولي مفتوح الحين… متى يناسبك — __ ولا __؟[[/HL]]
**If they say "no, I'll be there" → verbal commitment locked.**
- Demo booked for soonest available time
- Calendar invite accepted ON THE CALL
━━━━━━━━━━━━━━━━━━━━
<HEADING_2> How To Use This Script
Read it out loud.
"""


class HeadingLabel(unittest.TestCase):
    def test_a_label_set_as_a_heading_stays_in_its_stage(self):
        tabs = parse.split_tabs(ANNOTATED)
        out = parse.parse_framework(tabs["Arabic"], "intro")
        stage = out["stages"][0]
        types = [b["type"] for b in stage["blocks"]]
        self.assertEqual(types, ["step", "say", "step", "note", "say", "step", "say"])
        self.assertEqual(stage["blocks"][3]["text"], "Examples:")
        self.assertEqual(stage["checklist"], ["Demo booked for soonest available time", "Calendar invite accepted ON THE CALL"])
        # A real section after the stage is still a section.
        self.assertEqual([s["title"] for s in out["sections"]], ["How To Use This Script"])

    def test_a_heading_without_a_colon_is_still_a_section(self):
        tabs = parse.split_tabs(ANNOTATED.replace("<HEADING_2> Examples:", "<HEADING_2> Examples"))
        out = parse.parse_framework(tabs["Arabic"], "intro")
        self.assertEqual(len(out["stages"][0]["blocks"]), 3)
        self.assertIn("Examples", [s["title"] for s in out["sections"]])


class Rejoin(unittest.TestCase):
    def broken(self) -> dict:
        """The Arabic intro as the old parser stored it (2026-10-10)."""
        return {
            "key": "intro",
            "lang": "ar",
            "stages": [{"no": 6, "title": "Transition to Demo", "checklist": [], "blocks": [
                {"type": "step", "text": "THE PRE-PITCH"},
                {"type": "say", "text": "[NAME]، يمديني أعطيك رأيي من برا على وضعك؟"},
                {"type": "say", "text": "بناءً على إن عندك [STRENGTHS] مظبوطة"},
                {"type": "step", "text": "The missing piece is [match to their specific pain]"},
            ]}],
            "sections": [
                {"title": "How To Use This Script", "blocks": [{"type": "note", "text": "x"}]},
                {"title": "Examples:", "blocks": [
                    {"type": "say", "text": "[X الميزة اللي تميّزنا]"},
                    {"type": "step", "text": "CALENDAR LOCK (do this while on the call)"},
                    {"type": "say", "text": "جدولي مفتوح الحين… متى يناسبك — __ ولا __؟"},
                    {"type": "list", "branch": "If they say \"no, I'll be there\"", "items": ["Demo booked", "Homework video mentioned"]},
                ]},
            ],
        }

    def test_the_section_goes_back_into_its_stage(self):
        out = parse.rejoin(self.broken(), "Examples:", 6)
        stage = out["stages"][0]
        self.assertEqual(len(stage["blocks"]), 8)
        self.assertEqual(stage["blocks"][4], {"type": "note", "text": "Examples:"})
        self.assertEqual(stage["blocks"][7]["text"], "جدولي مفتوح الحين… متى يناسبك — __ ولا __؟")
        self.assertEqual(stage["checklist"], ["Demo booked", "Homework video mentioned"])
        self.assertEqual([s["title"] for s in out["sections"]], ["How To Use This Script"])

    def test_the_input_is_left_as_it_is_and_a_wrong_title_is_refused(self):
        b = self.broken()
        before = json.dumps(b, ensure_ascii=False)
        parse.rejoin(b, "Examples:", 6)
        self.assertEqual(json.dumps(b, ensure_ascii=False), before)
        with self.assertRaises(ValueError):
            parse.rejoin(b, "Nope:", 6)
        with self.assertRaises(ValueError):
            parse.rejoin(b, "Examples:", 9)

    def test_the_cli_rewrites_the_file(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "intro.ar.json"
            f.write_text(json.dumps(self.broken(), ensure_ascii=False))
            argv = sys.argv
            sys.argv = ["parse.py", "rejoin", str(f), "Examples:", "6"]
            try:
                with contextlib.redirect_stdout(io.StringIO()) as said:
                    parse.main()
            finally:
                sys.argv = argv
            self.assertIn("stage 6 now has 8 blocks and 2 checklist items", said.getvalue())
            self.assertEqual(len(json.loads(f.read_text())["stages"][0]["blocks"]), 8)


if __name__ == "__main__":
    unittest.main()
