"""The proposal defects found on 5 October 2026, when three past demos were
drafted again with the live generator and judged against the old engine's
drafts. One class per defect, named for what the reader of the document
would have seen. Run from hermes/sales-desk:

    python3 -m unittest tests.test_proposal_quality

The template's own behaviour is tested in LiveTemplateTests, which builds and
renders real pages with this machine's browser, and only when asked:

    SALES_RENDER_LIVE=1 python3 -m unittest tests.test_proposal_quality
"""
from __future__ import annotations

import copy
import os
import re
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import build, offer, render, validate  # noqa: E402
from desk.config import ROOT  # noqa: E402
from tests import fakes  # noqa: E402
from tests.fakes import TEST_OFFER, general_deal, specific_deal  # noqa: E402
from tests.test_desk import check, failing, resolved  # noqa: E402

TEMPLATE = (ROOT / "proposal-template.html").read_text(encoding="utf-8")

SHEETS = "".join(f'<section class="sheet"><p>page {i}</p></section>' for i in range(1, 8))


def dom_with(extra: str, deal: dict[str, Any]) -> str:
    """A rendered page with the sheets the deal should have, and `extra` in the last one."""
    n = validate.expected_sheets(deal)
    sheets = "".join(f'<section class="sheet"><p>page {i}</p>{extra if i == n else ""}</section>'
                     for i in range(1, n + 1))
    return f'<html><body><div id="doc">{sheets}</div></body></html>'


def tiles(values: list[str], side: str = "Break-even") -> str:
    """The break-even row as the template draws it."""
    inner = "".join(f'<div><span class="v">{v}</span><span class="k">label</span></div>' for v in values)
    return (f'<div class="row"><div class="side">{side}</div><div class="main">\n'
            f'        <div class="big accent">{inner}</div>\n      </div></div>')


def validated(deal: dict[str, Any], dom: str) -> validate.Result:
    return validate.validate(deal, None, resolved=offer.from_deal(deal, TEST_OFFER), offer=TEST_OFFER, dom=dom,
                             engine="test", checked_note="checked at draft time")


# --------------------------------------------------------------- defect 1 ---
class BreakEvenTileTests(unittest.TestCase):
    """"0.0 extra projects to break even" on the price page of every general
    proposal that had a project value and no margin."""

    def test_a_break_even_tile_that_reads_zero_fails_the_render_check(self):
        deal = general_deal()
        r = validated(deal, dom_with(tiles(["0.0", "0.0", "2 to 4"]), deal))
        self.assertTrue(any("break-even" in x for x in failing(r, "render")), r.text())

    def test_an_arabic_break_even_tile_reading_zero_fails_too(self):
        deal = general_deal(lang="ar")
        r = validated(deal, dom_with(tiles(["٠٫٠", "1.2"], side="نقطة التعادل"), deal))
        self.assertTrue(any("break-even" in x for x in failing(r, "render")), r.text())

    def test_real_break_even_tiles_pass(self):
        deal = specific_deal()
        r = validated(deal, dom_with(tiles(["1.8", "0.6", "2 to 4"]), deal))
        self.assertFalse(failing(r, "render"), r.text())

    def test_the_template_draws_the_tiles_only_with_a_value_and_a_margin(self):
        self.assertTrue(re.search(r"Number\(P\.roi\.avg_project_value\) > 0 && Number\(P\.roi\.margin_pct\) > 0",
                                  TEMPLATE), "the break-even condition")


# --------------------------------------------------------------- defect 2 ---
class TargetWordingTests(unittest.TestCase):
    """"The program is built to deliver thirty qualified meetings": a target
    may be stated as a target and never as what the program produces."""

    def claims(self, line: str, lang: str = "en") -> list[str]:
        deal = general_deal(lang=lang, investment_close=line)
        return failing(check(deal), "guarantee")

    def test_built_to_deliver_meetings_is_a_results_claim(self):
        self.assertTrue(self.claims("The program is built to deliver thirty qualified meetings across the three months."))

    def test_built_to_add_signed_work_is_one_too(self):
        self.assertTrue(self.claims("You get a program built to add two to four signed across the term."))
        self.assertTrue(self.claims("A system built to produce 30 qualified appointments in 90 days."))
        self.assertTrue(self.claims("It is built to bring you new projects every month."))

    def test_the_same_sentence_saying_target_is_not_a_claim(self):
        self.assertFalse(self.claims("Thirty qualified meetings across the three months is the target the program works to."))
        self.assertFalse(self.claims("The plan is built to deliver thirty qualified meetings, the target we work to."))
        # Built to deliver something that is not a result is ordinary English.
        self.assertFalse(self.claims("The landing page is built to deliver the brief in under a minute."))

    def test_the_arabic_claim_and_the_arabic_target(self):
        self.assertTrue(self.claims("البرنامج مبني ليحقق ٣٠ اجتماعاً مؤهلاً خلال ثلاثة أشهر.", "ar"))
        self.assertFalse(self.claims("هدف البرنامج ٣٠ اجتماعاً مؤهلاً خلال ثلاثة أشهر، وهو مبني ليحقق هذا الهدف.", "ar"))

    def test_the_tile_label_is_a_target_across_the_term(self):
        self.assertTrue('beTarget: "The plan\'s target across the term"' in TEMPLATE, "the English label")
        self.assertFalse("built to produce" in TEMPLATE, "the old label")
        arabic = re.search(r'ar: \{.*?beTarget: "([^"]*)"', TEMPLATE, re.S).group(1)
        text = arabic.encode().decode("unicode_escape") if "\\u" in arabic else arabic
        self.assertNotIn("بُني", text)
        self.assertIn("هدف", text)

    def test_the_drafter_is_told_the_meetings_are_a_target(self):
        block = offer.prompt_block(resolved())
        self.assertNotIn("built to deliver", block)
        self.assertIn("30 qualified meetings across the term** is the target the program works to", block)


# --------------------------------------------------------------- defect 3 ---
RECORD = """# Patterns

## The cost of the gap

The design firm: SAR 4,667 plus SAR 11,550 a month, SAR 194,604 a year.

## Numbers quoted as proof, across the calls

Use these as given.

- A contracting company signed four projects worth about USD 2 million in its first two months.
- A campaign spending USD 500 produced 104 enquiries, 35 meetings, 28 quotations and three signed deals worth USD 147,000.
- A campaign spending USD 3,000 a month produced signed contracts worth USD 225,000 to 252,000.

## Something after it

Not proof: 999 of anything.
"""


class ProofRecordTests(unittest.TestCase):
    """Our case study quoted the way the rep said it on the call (USD 149K,
    32 meetings) instead of the record in PATTERNS.md (USD 147,000, 35)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        path = Path(self.tmp.name) / "PATTERNS.md"
        path.write_text(RECORD, encoding="utf-8")
        self.patch = mock.patch.object(validate, "PATTERNS_FILE", path)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def proof(self, *items: dict[str, str], lang: str = "en", text: Any = "default") -> list[str]:
        return failing(check(general_deal(lang=lang, proof=list(items)), text=text), "proof")

    def test_the_figures_as_the_rep_said_them_fail(self):
        bad = self.proof({"v": "USD 149K", "k": "USD 500 of ads became 104 leads, 32 meetings and three signed "
                                                 "projects.", "src": "Design firm, GCC"})
        self.assertTrue(bad)
        self.assertIn("proof[0].v", bad[0])
        self.assertIn("149,000", bad[0])
        self.assertIn("proof[0].k", bad[0])
        self.assertIn("32", bad[0])

    def test_the_record_passes_however_it_is_written(self):
        self.assertFalse(self.proof(
            {"v": "USD 147,000", "k": "USD 500 became 104 enquiries, 35 meetings and 28 quotations.", "src": "GCC"},
            {"v": "USD 2M", "k": "Four projects in the first two months.", "src": "Contracting company"},
            {"v": "USD 225,000 to 252,000", "k": "From USD 3,000 a month.", "src": "GCC"},
            {"v": "4x", "k": "Revenue inside three months.", "src": "Design and fit-out"}))
        self.assertFalse(self.proof({"v": "USD 2 million", "k": "Thirty-five meetings.", "src": "GCC"}))

    def test_a_figure_in_words_is_read_too(self):
        bad = self.proof({"v": "USD 147,000", "k": "Thirty-two meetings from one campaign.", "src": "GCC"})
        self.assertTrue(bad and "32" in bad[0], bad)

    def test_arabic_figures_and_the_word_for_thousand(self):
        self.assertTrue(self.proof({"v": "١٤٩ ألف دولار", "k": "من حملة واحدة.", "src": "الخليج"}, lang="ar"))
        self.assertFalse(self.proof({"v": "١٤٧ ألف دولار", "k": "٣٥ اجتماعاً من حملة واحدة.", "src": "الخليج"},
                                    lang="ar"))

    def test_only_the_proof_list_is_the_record(self):
        # In PATTERNS.md, but in the cost section's worked example, not in the proof list.
        self.assertTrue(self.proof({"v": "SAR 194,604", "k": "A year.", "src": "Design firm"}))
        self.assertTrue(self.proof({"v": "999", "k": "Things.", "src": "Nobody"}))

    def test_it_is_checked_with_no_transcript_too(self):
        self.assertTrue(self.proof({"v": "USD 149K", "k": "One campaign.", "src": "GCC"}, text=None))

    def test_the_drafter_is_handed_a_wrong_proof_figure_to_fix(self):
        from desk import engine
        self.assertIn("proof", engine.REPAIRABLE)

    def test_the_real_record_carries_the_official_figures(self):
        self.patch.stop()
        try:
            record = validate.proof_record()
        finally:
            self.patch.start()
        self.assertIsNotNone(record)
        self.assertTrue({147000, 35, 104, 28, 500}.issubset(record), record)


# --------------------------------------------------------------- defect 4 ---
def warned(result: validate.Result, name: str) -> list[str]:
    return [r["detail"] for r in result.rows if r["check"] == name and r["status"] == "WARN"]


class NumberWordTests(unittest.TestCase):
    """Wrong figures about the client passed: a number written in words was
    never read, and six signed on one page and two on another went through."""

    def test_words_and_scales_become_figures(self):
        cases = {
            "thirty-five meetings": [35],
            "two hundred and fifty projects": [250],
            "four hundred and fifty thousand riyals": [450000],
            "USD 149K and USD 2M": [149000, 2000000],
            "1.5 million": [1500000],
            "خمسة وثلاثين اجتماع": [35],
            "ثلاث مئة ألف ريال": [300000],
            "٤٥٠ ألف": [450000],
            "ألفين وخمسمائة": [2500],
            "someone said six, two": [6, 2],
        }
        for text, want in cases.items():
            self.assertEqual(validate.figures_in(text), want, text)

    def test_a_count_in_words_is_checked_against_the_call(self):
        deal = specific_deal()
        deal["gap_points"][2] = {"v": "Seven", "k": "Projects signed a month"}
        self.assertTrue(any("gap_points[2].v=7" in w for w in warned(check(deal), "evidence counts")))

    def test_a_large_figure_in_words_is_checked_in_the_copy(self):
        deal = specific_deal(headline="Nine hundred thousand riyals a year walks out of the door")
        self.assertTrue(any("900,000" in x or "900000" in x for x in failing(check(deal), "prose")))

    def test_a_figure_said_in_words_on_the_call_counts_as_said(self):
        words = fakes.transcript().replace("around 450,000 riyals", "around four hundred and fifty thousand riyals")
        deal = specific_deal()
        r = check(deal, text=words)
        self.assertFalse(failing(r, "evidence"), r.text())


class SameCountTests(unittest.TestCase):
    """The same count told two ways across the gap, the tree and the funnel."""

    def deal(self) -> dict[str, Any]:
        deal = general_deal()
        deal["gap_points"] = [{"v": "6", "k": "Projects signed in eight months, every one through someone you knew"},
                              {"v": "0", "k": "Channels you control"}]
        deal["funnel"] = {"title": "The year so far", "note": "Referrals only.", "stages": [
            {"label": "Meetings held", "value": 14, "display": "14", "note": "four reached a signature"},
            {"label": "Related to a real project", "value": 10, "display": "8 to 10", "note": "the rest were not"}]}
        return deal

    def test_six_signed_on_the_gap_and_two_in_the_tree_warns_naming_both(self):
        deal = self.deal()
        deal["tree"]["goal_note"] = "Two signed in eight months, a tenth of the year you set."
        got = warned(check(deal), "figures")
        self.assertTrue(got, check(deal).text())
        self.assertIn("gap_points[0]", got[0])
        self.assertIn("tree.goal_note", got[0])
        self.assertIn("signed", got[0])

    def test_the_same_count_twice_is_fine(self):
        deal = self.deal()
        deal["tree"]["goal_note"] = "Six signed in eight months, every one from a referral."
        self.assertFalse(warned(check(deal), "figures"))

    def test_an_extra_project_and_a_project_in_passing_are_not_counts(self):
        deal = self.deal()
        deal["tree"]["goal_note"] = "One more project a month would rebuild the team."
        deal["tree"]["branches"][0]["note"] = "Eight to ten relate to a project; none close."
        self.assertFalse(warned(check(deal), "figures"))

    def test_the_funnel_against_the_gap(self):
        deal = self.deal()
        deal["funnel"]["stages"].append({"label": "Projects signed", "value": 3, "display": "3", "note": "this year"})
        got = warned(check(deal), "figures")
        self.assertTrue(any("gap_points[0]" in g and "funnel.stages[2]" in g for g in got), got)

    def test_arabic_counts(self):
        deal = self.deal()
        deal["lang"] = "ar"
        deal["gap_points"] = [{"v": "٦", "k": "مشاريع موقعة خلال ثمانية أشهر"}]
        deal["tree"]["goal_note"] = "ثلاثة مشاريع موقعة خلال ثمانية أشهر."
        self.assertTrue(warned(check(deal), "figures"))

    def test_the_drafter_is_told_a_passing_figure_is_never_a_headline(self):
        from desk import prompt
        text = prompt.draft_user({}, "the call", "en", "general", has_reference=False)
        self.assertIn("said only in passing", text)
        self.assertIn("never a headline", text)


# ------------------------------------------------------------ defects 5, 6 ---
def offer_fails(deal: dict[str, Any]) -> list[str]:
    return failing(check(deal), "offer")


def two_payments(detail: str, total: str = "USD 3,000") -> dict[str, Any]:
    deal = specific_deal()
    deal["offer"] = offer.stamp(resolved({"payment": "two_payments"}))
    deal["investment"]["rows"][1] = {"item": "Payment structure", "detail": detail, "amount": "2 x USD 3,000"}
    deal["investment"]["total_amount"] = total
    return deal


class PaymentTiedToAResultTests(unittest.TestCase):
    """The retired split paid its second half "after the first contract
    signs". Since 3 October 2026 the two payments fall due on dates."""

    def test_a_payment_tied_to_a_first_contract_fails(self):
        for line in ("USD 3,000 at the start and USD 3,000 when your first contract signs.",
                     "Half at the start, half after the first project is signed.",
                     "The second USD 3,000 is due once your first client signs.",
                     "USD 3,000 at the start; the rest on your first deal."):
            self.assertTrue(any("first" in x for x in offer_fails(two_payments(line))), line)

    def test_the_arabic_form_fails_too(self):
        deal = two_payments("٣٬٠٠٠ دولار عند البدء و٣٬٠٠٠ دولار بعد توقيع أول عقد.")
        deal["lang"] = "ar"
        self.assertTrue(any("first" in x for x in offer_fails(deal)))

    def test_payments_on_dates_pass(self):
        self.assertEqual(offer_fails(two_payments("USD 3,000 at the start and USD 3,000 45 days after the start.")),
                         [])

    def test_a_first_project_that_is_not_about_paying_is_fine(self):
        deal = specific_deal()
        deal["terms"].append("We review the numbers with you after your first project.")
        self.assertEqual(offer_fails(deal), [])


class PricePageTotalTests(unittest.TestCase):
    """The total printed USD 10,500 ("programme plus three months of
    advertising"); it is what is paid to us at the start."""

    def test_the_whole_engagement_as_the_total_fails(self):
        deal = specific_deal()
        deal["investment"]["total_label"] = "Program plus three months of advertising"
        deal["investment"]["total_amount"] = "USD 10,500"
        self.assertTrue(any("investment.total_amount" in x for x in offer_fails(deal)))

    def test_under_two_payments_the_total_is_the_first(self):
        self.assertTrue(any("investment.total_amount" in x for x in offer_fails(two_payments(
            "USD 3,000 at the start and USD 3,000 45 days after the start.", total="USD 6,000"))))

    def test_the_first_payment_in_the_local_currency_passes(self):
        deal = specific_deal()
        deal["investment"]["total_amount"] = "SAR 22,500"
        self.assertEqual(offer_fails(deal), [])

    def test_a_total_left_to_fill_is_a_gap_not_a_fault(self):
        deal = specific_deal()
        deal["investment"]["total_amount"] = "FILL"
        self.assertEqual(offer_fails(deal), [])

    def test_the_total_label_and_amount_have_room_between_them(self):
        rule = re.search(r"\n  \.total \{(.*?)\}", TEMPLATE, re.S).group(1)
        self.assertIn("gap: 6mm", rule)


# -------------------------------------------------------------- defect 11 ---
class AdvertisingLineTests(unittest.TestCase):
    """"Ads" in the program row's description made it read as the advertising
    line, and the check warned "advertising line says USD 6,000"."""

    def test_the_program_row_mentioning_ads_is_not_the_advertising_line(self):
        deal = specific_deal()
        deal["investment"]["rows"][0]["detail"] = "Ads, funnel, call centre, sales training and reporting, three months."
        r = check(deal)
        self.assertFalse([w for w in r.warnings() if "advertising line says" in w], r.text())
        self.assertEqual(failing(r, "offer"), [])

    def test_a_line_named_otherwise_is_still_found_by_its_detail(self):
        deal = specific_deal()
        deal["investment"]["rows"][2]["item"] = "Media"
        deal["investment"]["rows"][2]["detail"] = "Advertising, paid by you directly to the platforms."
        self.assertEqual(failing(check(deal), "offer"), [])


# ------------------------------------------------------------- the template ---
@unittest.skipUnless(os.environ.get("SALES_RENDER_LIVE") == "1", "SALES_RENDER_LIVE=1 runs the real browser")
class LiveTemplateTests(unittest.TestCase):
    """The real template in this machine's browser."""

    def dom(self, deal: dict[str, Any]) -> str:
        with tempfile.TemporaryDirectory() as tmp:
            out = render.dom(build.build(deal, Path(tmp) / "p.html"))
        self.assertTrue(out)
        return validate.live_dom(out)

    def test_no_break_even_tiles_without_a_margin(self):
        deal = general_deal()
        deal["roi"]["avg_project_value"] = 1000000
        live = self.dom(deal)
        self.assertNotIn(">Break-even<", live)
        self.assertNotIn('<span class="v">0.0</span>', live)

    def test_the_tiles_still_come_with_a_value_and_a_margin(self):
        deal = specific_deal()
        deal["roi"]["target_projects_month"] = "6 to 12 signed"
        live = self.dom(deal)
        self.assertIn(">Break-even<", live)
        self.assertIn("The plan's target across the term", live)


if __name__ == "__main__":
    unittest.main()
