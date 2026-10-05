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

from desk import engine, prompt, validate  # noqa: E402
from tests import fakes  # noqa: E402
from tests.fakes import general_deal  # noqa: E402
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

if __name__ == "__main__":
    unittest.main()
