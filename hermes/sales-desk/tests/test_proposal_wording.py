"""What the live check of 5 October 2026 found on the deployed generator
(recordings 180273419 and 176954619): the "You sign" row repeating the
target, an absolute outcome on the solution page, a project count read as a
margin, the one-third rule left unnamed, range and tree wording, and draft
notes saying no margin was given when a gross one was. One class per finding.
Run from hermes/sales-desk:

    python3 -m unittest tests.test_proposal_wording
"""
from __future__ import annotations

import copy
import os
import unittest
from typing import Any

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import engine, prompt, references, validate  # noqa: E402
from tests import fakes  # noqa: E402
from tests.fakes import TEST_OFFER, general_deal, specific_deal  # noqa: E402
from tests.test_desk import check, failing  # noqa: E402
from tests.test_proposal_quality import run_engine, volume_deal  # noqa: E402

# SKILL.md with its lines joined, so a sentence is found wherever it wraps.
SKILL = " ".join(prompt.SKILL_FILE.read_text(encoding="utf-8").split())


def volume_page(rate: str, target: str, **arith: Any) -> dict[str, Any]:
    """176954619's arithmetic page in dollars: projects of USD 30,000 at a 20
    percent gross margin, against our USD 10,500 engagement."""
    deal = general_deal()
    deal["roi"].update({"local_currency": "USD", "usd_rate": 1})
    deal["arithmetic"] = {"mode": "volume", "currency": "USD", "months": 3, "project_value_low": 30000,
                          "project_value_high": 40000, "target_additional_low": 2, "target_additional_high": 4,
                          "gross_margin": 20, "rate_display": rate, "target_display": target,
                          "title": "What it takes to pay for itself",
                          "verdict": "At the 20 percent gross margin you gave, the engagement takes 1.75 projects.",
                          **arith}
    return deal


def rows(result: validate.Result, name: str, status: str) -> list[str]:
    return [r["detail"] for r in result.rows if r["check"] == name and r["status"] == status]


# --------------------------------------------------------------- finding 1 ---
class SigningRateTests(unittest.TestCase):
    """176954619 page 4: "You sign" said "2 to 4 over the term", the target,
    directly above the target row saying the same."""

    def test_the_target_in_the_rate_row_fails(self):
        deal = volume_page("2 to 4 over the term", "2 to 4 projects across the three months")
        found = failing(check(deal, text=None), "rate")
        self.assertTrue(any("arithmetic.rate_display" in f and "target" in f for f in found), found)

    def test_the_arabic_form_fails_too(self):
        deal = volume_page("٢ إلى ٤ خلال المدة", "٢ إلى ٤ مشاريع خلال الأشهر الثلاثة")
        self.assertTrue(failing(check(deal, text=None), "rate"))

    def test_the_client_s_own_rate_passes(self):
        for rate, target in (("3 since the start of the year", "2 to 4 projects across the three months"),
                             ("1 to 2 a month", "3 to 6 over three months"),
                             ("two a month", "2 to 4 over three months")):
            deal = volume_page(rate, target)
            self.assertFalse(failing(check(deal, text=None), "rate"), (rate, target))

    def test_a_target_said_as_more_than_today_passes(self):
        deal = volume_page("2 a month", "2 more a month")
        self.assertFalse(failing(check(deal, text=None), "rate"))

    def test_a_rate_left_for_the_closer_or_left_out_is_no_repeat(self):
        for rate in ("FILL", ""):
            self.assertFalse(failing(check(volume_page(rate, "2 to 4 over three months"), text=None), "rate"))

    def test_the_rate_is_repaired(self):
        self.assertIn("rate", engine.REPAIRABLE)
        text = prompt.repair_user(general_deal(), ["rate: arithmetic.rate_display repeats the target"])
        self.assertIn("rate the client signs at today", text)
        bad = volume_deal(rate_display="2 to 4 over the term", project_value_high=None)
        good = copy.deepcopy(bad)
        good["arithmetic"]["rate_display"] = "2 a month"
        out, p = run_engine([fakes.triage_answer(margin=None), bad, good], over=[[]])
        self.assertEqual(len(p.calls), 3)
        self.assertIn("- rate:", p.calls[2]["user"])
        self.assertFalse(failing(out.result, "rate"), out.result.text())

    def test_the_drafter_is_told_the_rate_is_never_the_target(self):
        self.assertTrue("`rate_display` is the rate the client signs at today" in SKILL)
        self.assertTrue("never the target" in SKILL)



# --------------------------------------------------------------- finding 2 ---
def with_fix(line: str, key: str = "fix", lang: str = "en") -> dict[str, Any]:
    """A deal whose second solution row's fix (or another outcome field) says `line`."""
    deal = general_deal(lang=lang)
    if key == "fix":
        deal["solution"][1]["fix"] = line
    else:
        deal[key] = line
    return deal


def absolute(deal: dict[str, Any]) -> list[str]:
    return [f for f in failing(check(deal, text=None), "guarantee") if "as certain" in f]


class AbsoluteOutcomeTests(unittest.TestCase):
    """180273419 page 5: "so small jobs never arrive" in the solution rows, a
    promise the program cannot keep, passed the guarantee check."""

    def test_the_live_line_fails_naming_the_field(self):
        found = absolute(with_fix("Targeting and filtering set to your minimum ticket, so small jobs never arrive."))
        self.assertTrue(any("solution[1].fix" in f and "never arrive" in f for f in found), found)

    def test_other_absolute_outcomes_fail(self):
        for line in ("Small jobs will never reach you.",
                     "Every lead is qualified before it reaches your team.",
                     "A filtration funnel, so every showroom visit is a real buyer.",
                     "No more wasted meetings with people who cannot afford you.",
                     "A calendar that is always full.",
                     "Nothing below your ticket ever reaches you."):
            self.assertTrue(absolute(with_fix(line)), line)
        self.assertTrue(absolute(with_fix("Every lead is qualified.", key="solution_close")))

    def test_the_arabic_forms_fail(self):
        for line in ("استهداف وتصفية على حد مشروعك الأدنى، فلن تصلك الأعمال الصغيرة.",
                     "الأعمال الصغيرة لا تصل إليك أبدا.",
                     "كل عميل محتمل مؤهل قبل أن يصل إلى فريقك.",
                     "لا مزيد من الاجتماعات الضائعة.",
                     "جدولك ممتلئ دائما."):
            self.assertTrue(absolute(with_fix(line, lang="ar")), line)

    def test_ordinary_uses_pass(self):
        for line in ("We never share your data with anyone.",
                     "Thirty meetings is the target we work to, never a promise.",
                     "Every enquiry called in 5 to 30 minutes.",
                     "Our team answers every enquiry and books only the meetings worth your time.",
                     "No more than 30 minutes to the first call.",
                     "Always-on campaigns on two platforms.",
                     "A line that never bids against it.",
                     "Direct enquiries that never go to open tender.",
                     "Targeting and filtering set to your minimum ticket, so fewer small jobs arrive.",
                     "Small jobs are filtered out before they reach you."):
            self.assertEqual(absolute(with_fix(line)), [], line)
        for line in ("لا نشارك بياناتك مع أحد أبدا.", "كل استفسار يتصل به فريقنا خلال 5 إلى 30 دقيقة."):
            self.assertEqual(absolute(with_fix(line, lang="ar")), [], line)

    def test_the_diagnosis_pages_may_say_never(self):
        deal = general_deal(subhead="Referrals keep you busy, and the large villas never arrive.")
        deal["tree"]["branches"][0]["note"] = "The big developers never reach you."
        self.assertEqual(absolute(deal), [])

    def test_it_is_repaired_by_rewording(self):
        self.assertIn("guarantee", engine.REPAIRABLE)
        text = prompt.repair_user(general_deal(), ["guarantee: solution[1].fix states an outcome as certain"])
        self.assertIn("fewer", text)

    def test_the_drafter_is_told_to_write_fewer(self):
        self.assertTrue('write "fewer" or "filtered out", never "never"' in SKILL)


# --------------------------------------------------------------- finding 3 ---
def gross_warned(deal: dict[str, Any]) -> list[str]:
    rep = validate.Report()
    validate.check_margin_words(deal, rep)
    return [r["detail"] for r in rep.rows if r["status"] == validate.WARN and "gross margin" in r["detail"]]


def margin_line(**words: str) -> dict[str, Any]:
    """A volume page with no gross_margin set, and the words given."""
    deal = volume_deal()
    for path, text in words.items():
        block, key = path.split("__")
        deal[block][key] = text
    return deal


class MarginWordsTests(unittest.TestCase):
    """180273419: the intro said no margin was given, gross or net, and the
    check read its project count, 4, as a gross margin."""

    def test_a_count_beside_gross_is_not_a_margin(self):
        deal = margin_line(arithmetic__intro="You gave a minimum ticket and a goal of 4 projects, and no margin, "
                                             "gross or net.")
        self.assertEqual(gross_warned(deal), [])
        deal = margin_line(roi__margin_note="Your gross takings run to 4 projects a quarter.")
        self.assertEqual(gross_warned(deal), [])

    def test_a_line_saying_no_margin_was_given_is_skipped(self):
        for line in ("You gave no margin, gross or net; the table uses 10 and 20 percent.",
                     "No gross margin was given. The grid shows 10 and 20 percent.",
                     "You did not give a margin, so 20 percent gross is only an example."):
            self.assertEqual(gross_warned(margin_line(arithmetic__intro=line)), [], line)

    def test_a_gross_margin_in_percent_still_warns(self):
        for line in ("You gave 20 to 30 percent, before admin and general expenses, so it is gross.",
                     "A gross margin of 25% on every job.",
                     "You gave a gross margin of 20 to 30 percent and no net margin.",
                     "هامش إجمالي ٢٠ بالمئة على كل مشروع.",
                     "الهامش الإجمالي ٢٥٪."):
            self.assertTrue(gross_warned(margin_line(roi__margin_note=line)), line)
        deal = margin_line(roi__margin_note="A gross margin of 25% on every job.")
        deal["arithmetic"]["gross_margin"] = 25
        self.assertEqual(gross_warned(deal), [])


# --------------------------------------------------------------- finding 4 ---
def arithmetic_rows(deal: dict[str, Any]) -> list[str]:
    rep = validate.Report()
    validate.check_arithmetic(deal, rep)
    return [r["detail"] for r in rep.rows]


class OneThirdRuleTests(unittest.TestCase):
    """176954619: the engagement is 35 percent of one project, over a third,
    so the drafter counted projects, and no line said why."""

    def test_the_share_and_the_rule_are_on_the_detail_line(self):
        found = arithmetic_rows(volume_page("3 since the start of the year", "2 to 4 over three months"))
        self.assertTrue(any("35.0% of one project at the bottom value, over one third, so the page counts projects"
                            in d for d in found), found)
        deal = volume_page("3 since the start of the year", "2 to 4 over three months")
        deal["arithmetic"].pop("gross_margin")
        self.assertTrue(any("35.0% of one project" in d for d in arithmetic_rows(deal)))

    def test_a_share_inside_one_third_says_so(self):
        # SAR 39,375 against SAR 450,000 is 8.75 percent.
        found = arithmetic_rows(volume_deal())
        self.assertTrue(any("8.75% of one project at the bottom value, inside one third" in d for d in found), found)


# --------------------------------------------------------------- finding 5 ---
def tree_warned(deal: dict[str, Any]) -> list[str]:
    return rows(check(deal, text=None), "tree", "WARN")


class RangeAndTreeWordingTests(unittest.TestCase):
    """176954619: the intro said "a 20 percent margin" for a 20 to 30 range,
    the verdict called the target "qualified projects", and page 3 printed
    "No third branch." Thirteen of B2B's fourteen drafts carry that line, from
    the references' tree.note."""

    def test_a_tree_note_saying_there_is_no_third_branch_warns(self):
        for note in ("No third branch. Capacity is not what limits you.", "There is no third branch.",
                     "لا فرع ثالث. الطاقة الإنتاجية ليست الحد."):
            deal = general_deal()
            deal["tree"]["note"] = note
            found = tree_warned(deal)
            self.assertTrue(any("tree.note" in f for f in found), (note, found))
        deal = specific_deal()
        deal["tree"]["note"] = "No third branch."
        self.assertTrue(tree_warned(deal))

    def test_a_tree_note_with_a_finding_passes_and_a_reference_is_not_failed(self):
        deal = general_deal()
        deal["tree"]["note"] = "Capacity is not what limits you."
        self.assertEqual(tree_warned(deal), [])
        deal["tree"]["note"] = "No third branch. Capacity is not what limits you."
        self.assertFalse([p for p in references.problems_in(deal, TEST_OFFER) if p.startswith("tree")])

    def test_the_drafter_is_not_shown_the_line(self):
        ref = general_deal()
        ref["tree"]["note"] = "No third branch. Capacity is not the constraint."
        self.assertEqual(prompt.shape_of(ref)["tree"]["note"], "Capacity is not the constraint.")
        ref["tree"]["note"] = "No third branch."
        self.assertNotIn("note", prompt.shape_of(ref)["tree"])
        ref["tree"]["note"] = "لا فرع ثالث. الطاقة الإنتاجية ليست الحد."
        self.assertEqual(prompt.shape_of(ref)["tree"]["note"], "الطاقة الإنتاجية ليست الحد.")
        ref["tree"]["note"] = "Capacity is not the constraint."
        self.assertEqual(prompt.shape_of(ref)["tree"]["note"], "Capacity is not the constraint.")

    def test_the_drafter_is_told(self):
        self.assertTrue("Quote a range as the client gave it" in SKILL)
        self.assertTrue("say which end the page counts" in SKILL)
        self.assertTrue('never "qualified projects"' in SKILL)
        self.assertTrue("leave `tree.note` empty" in SKILL)

if __name__ == "__main__":
    unittest.main()
