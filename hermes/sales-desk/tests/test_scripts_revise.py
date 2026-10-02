"""The cockpit's revisions to the call scripts (scripts_import/revise.py):
applied once on top of the Google Docs' text, never twice, and an import
that finds a doc changed under a revision stops instead of loading half of
it. Run from hermes/sales-desk:

    python3 -m unittest tests.test_scripts_revise
"""
from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts_import"))

import revise  # noqa: E402


def intro(lang: str = "en") -> dict:
    """The smallest intro doc with every line the revisions edit."""
    win = "So your conversion rate is [X%]" if lang == "en" else "يعني نسبة التحويل عندك [X%]"
    yes = "Yes, we do have guarantees." if lang == "en" else "إي، عندنا ضمانات."
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
                    {"type": "say", "text": yes},
                    {"type": "adapt", "text": "Do NOT state the guarantee (30 appointments in 90 days). Let the closer use it as a closing tool."},
                ],
            }
        ],
    }


def _say(text: str) -> dict:
    return {"type": "say", "text": text}


# The demo's lines that promised results, word for word as the live scripts
# had them on 2026-10-02 (version 2, already revised for the numbers).
OLD_DEMO = {
    "en": {
        "close": "The guarantee is not part of the close. Keep it for when they ask for certainty.",
        "handle": [
            {"type": "step", "text": "Handle"},
            {"type": "adapt", "text": "Step 2 — The guarantee:"},
            _say('"Here\'s our guarantee: 30 qualified appointments in 90 days — or we keep working for free until we deliver."'),
            {"type": "step", "text": "If they still seem uncertain"},
            _say('"You\'ve made bigger bets with less certainty. This time, you at least have a guarantee backing you up. 30 appointments or we work for free."'),
        ],
        "expensive": [
            _say('"And let me ask you something — when you started your company, did you have all the money figured out? You\'re not gambling — you\'re investing in a system with a guarantee behind it."'),
            _say('"Exactly. And the reason is simple — they need to commit resources. That\'s why we have the guarantee: 30 qualified appointments in 90 days or we keep working for free until we deliver. You\'re not paying and hoping. You\'re paying and we\'re guaranteeing the result."'),
        ],
        "agency": [
            _say('"So you\'re paying $[their current spend] and getting [their current results]. In 90 days with us, the guarantee is 30 qualified appointments. If your current agency was delivering that, would you even be looking?"'),
            _say('"I totally get that. Do they give you a live dashboard where you can see your exact ROI? Do they guarantee 30 appointments or they work for free?"'),
        ],
        "small": [
            _say('"Here\'s what I\'d suggest instead: commit to the 90-day program as designed. And on top of that, we guarantee 30 qualified appointments in 90 days, or we keep working for free until we get there. So the risk is on us, not on you."'),
            _say('"Does that feel fair — give it the right resources for 90 days and hold us to the guarantee?"'),
        ],
        "tried": [
            {"type": "adapt", "text": "Step 4 — Risk reversal:"},
            _say('"And here\'s the difference: your last agency didn\'t guarantee anything. We guarantee 30 qualified appointments in 90 days or we keep working for free."'),
        ],
        "outside": '"Our specialty is GCC construction and design companies. If you\'re outside the Gulf, we can discuss it, but we want to make sure we can deliver at the level we guarantee."',
        "faq": '"30 qualified appointments in 90 days. If we don\'t deliver 30 in 90 days, we keep working for free until we hit that number."',
    },
    "ar": {
        "close": "The guarantee is not part of the close. Keep it for when they ask for certainty.",
        "handle": [
            {"type": "step", "text": "Handle"},
            {"type": "adapt", "text": "Step 2 — The guarantee:"},
            _say('"هذا ضماننا: ٣٠ موعد مؤهل بـ ٩٠ يوم — ولا نستمر نشتغل مجاناً لين نوصّل."'),
            _say("If they still seem uncertain:"),
            _say('"أخذت قرارات أكبر بثقة أقل. هالمرة، على الأقل عندك ضمان وراك. ٣٠ موعد ولا نشتغل مجاناً."'),
        ],
        "expensive": [
            _say('"وخلني أسألك — لمن بديت شركتك، كان عندك كل الفلوس جاهزة؟ إنت مو تقامر — إنت تستثمر بنظام وراه ضمان."'),
            _say('"بالضبط. والسبب بسيط — يحتاجون يخصصون موارد. عشان جذي عندنا الضمان: ٣٠ موعد مؤهل بـ ٩٠ يوم ولا نستمر نشتغل مجاناً لين نوصّل. إنت مو تدفع وتتمنى. إنت تدفع وإحنا نضمنلك النتيجة."'),
        ],
        "agency": [
            _say('"يعني إنت تدفع $[مصروفهم الحالي] وتحصل [نتائجهم الحالية]. بـ ٩٠ يوم معنا، الضمان ٣٠ موعد مؤهل. لو وكالتك الحالية كانت توصّل هالنتائج، كنت بتدور أصلاً؟"'),
            _say('"أفهمك تمام. يعطونك لوحة بيانات حية تشوف فيها عائدك بالضبط؟ يضمنون ٣٠ موعد ولا يشتغلون مجاناً؟"'),
        ],
        "small": [
            _say('"اللي أقترحه بدال: التزم ببرنامج الـ ٩٠ يوم مثل ما هو مصمم. وفوق هذا، نضمن لك ٣٠ موعد مؤهل بـ ٩٠ يوم، ولا نكمل نشتغل ببلاش لين نوصلها. يعني المخاطرة علينا مو عليك."'),
            _say('"تحس هالشي عدل — تعطيه الموارد الصح لمدة ٩٠ يوم وتحاسبنا على الضمان؟"'),
        ],
        "tried": [
            {"type": "adapt", "text": "Step 4 — Risk reversal:"},
            _say('"وهذا الفرق: وكالتك السابقة ما ضمنت شي. إحنا نضمن ٣٠ موعد مؤهل بـ ٩٠ يوم ولا نستمر نشتغل مجاناً."'),
        ],
        "outside": '"تخصصنا شركات المقاولات والتصميم بالخليج. لو إنت برا الخليج، نقدر نتناقش، بس نبي نتأكد إننا نقدر نوصّل بالمستوى اللي نضمنه."',
        "faq": '"٣٠ موعد مؤهل بـ ٩٠ يوم. لو ما وصّلنا ٣٠ بـ ٩٠ يوم، نستمر نشتغل مجاناً لين نوصل هالرقم."',
    },
}
QUICK_ROW = '"Can you guarantee results?" | "30 qualified appointments in 90 days or we work for free."'


def demo(lang: str = "en") -> dict:
    """A demo already revised for the numbers, with every line the guarantee
    revision edits, as the scripts in the cockpit were on 2026-10-02."""
    o = OLD_DEMO[lang]

    def entry(title: str, blocks: list) -> dict:
        return {"title": title, "blocks": [dict(b) for b in blocks]}

    return {
        "key": "demo",
        "lang": lang,
        "revisions": [revise.NUMBERS],
        "stages": [
            {"no": 12, "blocks": [_say("Nothing in life is 100% guaranteed — what's keeping you from a 10?")]},
            {"no": 13, "blocks": [{"type": "note", "text": o["close"]}]},
        ],
        "objections": [
            entry('"How do I know this will work?" / "Can you guarantee results?"', [
                {"type": "note", "text": "Frequency: ★★★★☆ — Comes up on most calls in some form."},
            ] + o["handle"]),
            entry('"It\'s too expensive" / "I can\'t pay upfront"', o["expensive"] + [
                {"type": "step", "text": "Common Mistakes"},
            ]),
            entry('"Already with another agency" / "Same price as everyone else"', o["agency"]),
            entry('"I want to start small / lower budget first"', o["small"]),
            entry('"I\'ve tried marketing before and it didn\'t work"', o["tried"] + [
                {"type": "adapt", "text": "Tie down:"},
            ]),
        ],
        "faqs": [
            entry('"Do you work with companies outside the Gulf?"', [_say(o["outside"])]),
            entry('"What\'s the guarantee exactly?"', [_say(o["faq"])]),
            entry('"Do people actually fill in a form? Isn\'t just putting a phone number better?"', [
                _say('"Let me think about it" | "No worries at all. What specifically are you thinking about?"'),
                _say(QUICK_ROW),
            ]),
        ],
    }


def lines(doc: dict):
    """Every block in the doc, with where it sits."""
    for part in ("stages", "objections", "faqs"):
        for e in doc.get(part, []):
            for b in e.get("blocks", []):
                yield part, e.get("title") or f"stage {e.get('no')}", b


# A result promised: free work, or a number of appointments.
PROMISES = ("30 qualified", "30 appointments", "٣٠ موعد", "for free", "مجان", "ببلاش", "نضمن لك",
            "guaranteeing the result", "نضمنلك", "وراه ضمان", "with a guarantee behind")


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
        self.assertEqual(faq, revise.SETTER_NOTE)

    def test_the_arabic_intro_asks_in_kuwaiti(self):
        out = revise.apply(intro("ar"))
        s4 = next(s for s in out["stages"] if s["no"] == 4)
        self.assertEqual(s4["blocks"][2]["text"], "وتقريباً جم تحط على الإعلانات بالشهر؟ وجم استفسار ييك منها؟")

    def test_applied_once_and_the_input_is_untouched(self):
        doc = intro()
        once = revise.apply(doc)
        self.assertEqual(revise.apply(once), once)
        self.assertNotIn("revisions", doc)
        self.assertEqual(once["revisions"], [revise.NUMBERS, revise.GUARANTEE])

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


class GuaranteeTests(unittest.TestCase):
    """2026-10-02: no results promised anywhere; the 7-day satisfaction
    guarantee only as the answer to the guarantee objection."""

    def handle(self, out: dict) -> list:
        obj = next(e for e in out["objections"] if e["title"].startswith('"How do I know'))
        blocks = obj["blocks"]
        return blocks[next(i for i, b in enumerate(blocks) if b["text"] == "Handle"):]

    def test_the_handle_opens_on_the_legal_line(self):
        for lang, words in (("en", "legally, we can't give you a guarantee on results"),
                            ("ar", "قانونياً ما نقدر نعطيك ضمان على النتائج")):
            first = next(b for b in self.handle(revise.apply(demo(lang))) if b["type"] == "say")
            self.assertIn(words, first["text"], lang)

    def test_gordons_handle_runs_in_order_and_the_seven_days_come_last(self):
        says = [b["text"] for b in self.handle(revise.apply(demo("en"))) if b["type"] == "say"]
        order = ["are you asking for a reason?", "came with a 100% guarantee?", "your side of it",
                 "Are those two things you're willing to do?", "What other question do you have?",
                 "within 7 days of paying in full you're unhappy with the process for any reason",
                 "is that something you're willing to move forward with today?"]
        at = [next(i for i, t in enumerate(says) if words in t) for words in order]
        self.assertEqual(at, sorted(at))
        blocks = self.handle(revise.apply(demo("en")))
        seven = next(i for i, b in enumerate(blocks) if "7 days" in b["text"] and b["type"] == "say")
        when = next(i for i, b in enumerate(blocks) if b["text"] == revise.SEVEN_DAYS)
        self.assertLess(when, seven)

    def test_no_line_promises_results(self):
        for lang in ("en", "ar"):
            out = revise.apply(demo(lang))
            for part, where, b in lines(out):
                if b["type"] in ("say", "adapt"):
                    for words in PROMISES:
                        self.assertNotIn(words, b["text"], f"{lang} {where}")
            quick = out["faqs"][2]["blocks"][1]["text"]
            self.assertEqual(quick, revise.QUICK + revise.QUICK_ANSWER)

    def test_the_seven_days_answer_only_the_guarantee_question(self):
        for lang, words in (("en", "7 days"), ("ar", "٧ أيام")):
            places = {where for part, where, b in lines(revise.apply(demo(lang)))
                      if b["type"] == "say" and words in b["text"]}
            self.assertEqual(places, {'"How do I know this will work?" / "Can you guarantee results?"',
                                      '"What\'s the guarantee exactly?"'}, lang)

    def test_the_close_keeps_it_out(self):
        s13 = next(s for s in revise.apply(demo("ar"))["stages"] if s["no"] == 13)
        self.assertEqual(s13["blocks"], [{"type": "note", "text": revise.CLOSE_NOTE}])

    def test_a_script_already_revised_gets_only_the_new_revision(self):
        # The demo fixture has none of the lines the numbers revision edits,
        # so running it again would stop the import.
        out = revise.apply(demo("en"))
        self.assertEqual(out["revisions"], [revise.NUMBERS, revise.GUARANTEE, revise.TERMS])
        self.assertEqual(revise.apply(out), out)

    def test_the_setter_says_the_legal_line_and_hands_over(self):
        for lang, words in (("en", "Legally, nobody can guarantee you results"),
                            ("ar", "قانونياً ماحد يقدر يضمن لك نتائج")):
            faq = revise.apply(intro(lang))["faqs"][0]["blocks"]
            self.assertTrue(faq[0]["text"].startswith(words), lang)
            self.assertIn("[CLOSER NAME]", faq[0]["text"])
            self.assertNotIn("7", faq[0]["text"])
            self.assertEqual(faq[1], {"type": "adapt", "text": revise.SETTER_NOTE})

    def test_a_guarantee_line_changed_in_the_doc_stops_the_import(self):
        doc = demo("en")
        doc["faqs"][1]["blocks"][0]["text"] = '"Thirty appointments in ninety days."'
        with self.assertRaises(revise.Drift) as e:
            revise.apply(doc)
        self.assertIn("30 qualified appointments in 90 days.", str(e.exception))


class TermsTests(unittest.TestCase):
    """The 7-day lines say what the contract says (section 3 of "90 Day
    Agreement (7 Day Satisfaction Guarantee)", read on 2026-10-02)."""

    def seven(self, out: dict) -> list:
        return [(where, b["text"]) for _, where, b in lines(out)
                if b["type"] == "say" and ("7 days" in b["text"] or "٧ أيام" in b["text"])]

    def test_the_lines_carry_the_contracts_terms(self):
        for lang, words in (("en", ("within 7 days of paying in full", "program fee in full", "onboarding")),
                            ("ar", ("خلال ٧ أيام من يوم تدفع المبلغ كامل", "رسوم البرنامج كاملة", "الأونبوردنق"))):
            said = self.seven(revise.apply(demo(lang)))
            self.assertEqual(len(said), 2, lang)
            for _, text in said:
                for w in words:
                    self.assertIn(w, text, lang)
                self.assertNotIn("in your first 7 days", text)
                self.assertNotIn("بأول ٧ أيام", text)

    def test_the_closer_note_names_the_contract_section(self):
        out = revise.apply(demo("en"))
        notes = [b["text"] for _, where, b in lines(out) if b["type"] == "note" and where.startswith('"How do I know')]
        self.assertIn(revise.SEVEN_DAYS_TERMS_NOTE, notes)
        self.assertNotIn(revise.SEVEN_DAYS_NOTE, notes)
        self.assertIn("section 3", revise.SEVEN_DAYS_TERMS_NOTE)

    def test_a_script_loaded_with_the_guarantee_gets_only_the_terms(self):
        # Version 3 in the cockpit: the numbers and the guarantee, not the terms.
        for lang in ("en", "ar"):
            v3 = copy.deepcopy(demo(lang))
            revise._guarantee_demo(v3, lang)
            v3["revisions"] = [revise.NUMBERS, revise.GUARANTEE]
            out = revise.apply(v3)
            self.assertEqual(out["revisions"], [revise.NUMBERS, revise.GUARANTEE, revise.TERMS])
            self.assertEqual(out, revise.apply(demo(lang)))

    def test_a_seven_day_line_changed_in_the_cockpit_stops_the_import(self):
        v3 = copy.deepcopy(demo("en"))
        revise._guarantee_demo(v3, "en")
        v3["revisions"] = [revise.NUMBERS, revise.GUARANTEE]
        faq = next(e for e in v3["faqs"] if e["title"].startswith('"What'))
        faq["blocks"][-1]["text"] = '"Seven days, money back."'
        with self.assertRaises(revise.Drift) as e:
            revise.apply(v3)
        self.assertIn("If in your first 7 days", str(e.exception))

    def test_the_setters_intro_is_not_touched(self):
        out = revise.apply(intro("ar"))
        self.assertNotIn(revise.TERMS, out["revisions"])


if __name__ == "__main__":
    unittest.main()
