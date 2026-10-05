"""What the three drafts on the reviewed code still let through (5 October
2026): the arithmetic page's words leaving its table, words saying no
currency was named on a page the closer then prices, the deposit coming off a
"first" payment when there is one, and a grid draft with no gap tiles. Run
from hermes/sales-desk:

    python3 -m unittest tests.test_proposal_judge
"""
from __future__ import annotations

import copy
import os
import tempfile
import unittest
from pathlib import Path
from typing import Any

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import engine, offer, prompt, references, validate  # noqa: E402
from tests import fakes  # noqa: E402
from tests.fakes import TEST_OFFER, FakeRenderer, general_deal  # noqa: E402
from tests.test_desk import check, failing, resolved  # noqa: E402
from tests.test_proposal_quality import run_engine  # noqa: E402


def margin_page(value: int, verdict: str, *, gross: Any = None, close: str = "", intro: str = "",
                note: str = "") -> dict[str, Any]:
    """A margin-mode page in dollars: our USD 6,000 fee and USD 1,500 a month of
    advertising, so the whole engagement is USD 10,500."""
    deal = general_deal()
    deal["roi"].update({"local_currency": "USD", "usd_rate": 1})
    deal["arithmetic"] = {"mode": "margin", "currency": "USD", "months": 3, "project_value": value,
                          "title": "What it takes to pay for itself", "verdict": verdict, "close": close,
                          "intro": intro, "note": note, "total_label": "The whole engagement, three months"}
    if gross is not None:
        deal["arithmetic"]["gross_margin"] = gross
    return deal


def verdict_of(deal: dict[str, Any]) -> list[str]:
    rep = validate.Report()
    validate.check_verdict(deal, rep)
    return [r["detail"] for r in rep.rows if r["status"] == validate.FAIL]


# ------------------------------------------------------- the page's words ---
class VerdictAgainstTheTableTests(unittest.TestCase):
    """180273419 set the fee alone beside one project and said it paid "many
    times over" with no margin; 176954619 said "if you keep a fifth" where the
    table needs 35.0 percent. Both passed every check."""

    def test_the_fee_alone_as_the_engagement_fails(self):
        deal = margin_page(1_000_000, "Set the USD 6,000 engagement beside one project at your minimum ticket. "
                                      "One signed project pays for the whole three months if you keep 1.05 "
                                      "percent of it.")
        found = verdict_of(deal)
        self.assertTrue(any("6,000, our fee alone" in f and "10,500" in f for f in found), found)

    def test_many_times_over_with_no_margin_fails(self):
        deal = margin_page(1_000_000, "<strong>One signed project pays for the whole three months many times "
                                      "over.</strong>")
        found = verdict_of(deal)
        self.assertTrue(any("many times over" in f and "no margin" in f for f in found), found)
        self.assertTrue(any("outright" in f for f in found), found)

    def test_a_share_kept_below_the_table_s_fails(self):
        deal = margin_page(30_000, "One signed project covers the whole three months if you keep a fifth of its "
                                   "value.", gross=20)
        found = verdict_of(deal)
        self.assertTrue(any("a fifth" in f and "35.0%" in f for f in found), found)
        self.assertTrue(any("1.75 projects" in f for f in found), found)

    def test_one_project_said_to_cover_when_the_gross_count_is_more_fails(self):
        deal = margin_page(30_000, "One signed project covers the three months if you keep 35 percent of it.",
                           gross=20)
        self.assertTrue(any("1.75 projects" in f for f in verdict_of(deal)))
        deal["arithmetic"]["verdict"] += " At the 20 percent gross margin you gave, that is 1.75 projects."
        self.assertEqual(verdict_of(deal), [])

    def test_the_reference_s_own_words_pass(self):
        deal = margin_page(1_000_000, "One signed project covers the whole three months if you keep a little over "
                                      "<strong>one percent</strong> of it. Counted at the 20 percent gross margin "
                                      "you gave, it is 0.05 of one project.", gross=20,
                           close="That is one project, at the bottom of your range, against a target of seven.",
                           intro="You gave the project value and a gross margin of 20 percent.",
                           note="Your own figure, taken at the bottom. Nothing is charged on the work you sign.")
        self.assertEqual(verdict_of(deal), [])
        self.assertFalse(failing(check(deal), "verdict"))

    def test_the_table_s_share_and_a_fee_named_beside_the_advertising_pass(self):
        deal = margin_page(30_000, "One signed project covers the three months if you keep 35 percent of it.",
                           gross=40, intro="Our fee is USD 6,000, and the advertising USD 1,500 a month.",
                           note="Our fee of USD 6,000 is one part of the engagement.")
        self.assertEqual(verdict_of(deal), [])

    def test_the_fee_in_a_conclusion_fails_even_named_as_the_fee(self):
        deal = margin_page(1_000_000, "One project covers our USD 6,000 fee if you keep a sliver of it.")
        self.assertTrue(any("our fee alone" in f for f in verdict_of(deal)))

    def test_a_multiple_the_gross_margin_bears_out_passes(self):
        deal = margin_page(1_000_000, "Counted at the 20 percent gross margin you gave, one project covers the "
                                      "engagement many times over.", gross=20)
        self.assertEqual(verdict_of(deal), [])
        deal = margin_page(100_000, "At your 20 percent gross margin it pays for itself twice over.", gross=20)
        self.assertTrue(any("twice over" in f for f in verdict_of(deal)), verdict_of(deal))

    def test_a_grid_multiple_is_held_to_its_best_cell(self):
        deal = general_deal()
        deal["arithmetic"]["close"] = "At the largest size, one signed project covers the engagement ten times over."
        self.assertEqual(verdict_of(deal), [])
        deal["arithmetic"]["close"] = "At the largest size, one project covers the engagement twenty times over."
        self.assertTrue(verdict_of(deal))

    def test_the_grid_reference_s_words_pass(self):
        deal = general_deal()
        deal["arithmetic"].update({
            "verdict": "Find your project size and your margin. The cell is how many signed projects pay for the "
                       "whole three months.",
            "close": "Below one, a single signed project pays for the whole engagement.",
            "note": "The whole engagement is SAR 39,375 across three months: our fee and the advertising."})
        self.assertEqual(verdict_of(deal), [])

    def test_the_verdict_is_repaired_and_never_with_fill(self):
        self.assertIn("verdict", engine.REPAIRABLE)
        text = prompt.repair_user(general_deal(), ["verdict: arithmetic.verdict sets 6,000, our fee alone"])
        self.assertIn("never FILL", text)
        self.assertNotIn("its table prints", prompt.repair_user(general_deal(), ["guarantee: a promise"]))

    def test_the_repair_round_mends_the_words(self):
        bad = margin_page(450_000, "Set the USD 6,000 engagement beside one project. One project pays for the "
                                   "three months many times over.")
        good = copy.deepcopy(bad)
        good["arithmetic"]["verdict"] = "One project covers the whole three months if you keep 2.33 percent of it."
        found = fakes.triage_answer(margin=None)
        out, p = run_engine([found, bad, good], over=[[]])
        self.assertEqual(len(p.calls), 3)
        self.assertIn("The checker found these problems", p.calls[2]["user"])
        self.assertIn("- verdict:", p.calls[2]["user"])
        self.assertFalse(failing(out.result, "verdict"), out.result.text())
        self.assertIn("2.33 percent", out.deal["arithmetic"]["verdict"])


# ------------------------------------------------------- the currency words ---
class NoCurrencyWordsTests(unittest.TestCase):
    """180273419: the intro said no currency was named; the closer filled AED,
    the page printed AED, and the gate said ready."""

    def test_saying_no_currency_was_named_fails(self):
        for line in ("You named no net margin and no currency, so this page assumes neither.",
                     "You gave a minimum ticket and named no currency.",
                     "Do the division once the currency is settled.",
                     "The currency was not named on the call.",
                     "لم تذكر أي عملة في الاتصال.",
                     "الأرقام بدون ذكر العملة."):
            deal = margin_page(1_000_000, "One project covers it if you keep 1.05 percent of it.", intro=line)
            self.assertTrue(failing(check(deal), "currency"), line)

    def test_a_currency_named_in_the_words_passes(self):
        for line in ("Priced in dirhams, the currency you named.", "The currency is AED.",
                     "Every figure here is in the currency you work in."):
            deal = margin_page(1_000_000, "One project covers it if you keep 1.05 percent of it.", intro=line)
            self.assertFalse(failing(check(deal), "currency"), line)

    def test_the_filled_currency_no_longer_rebuilds_as_ready(self):
        deal = margin_page(1_000_000, "One project covers the three months if you keep 1.05 percent of it.",
                           intro="You named no currency, so this page assumes none.")
        deal["arithmetic"]["currency"] = "AED"
        with tempfile.TemporaryDirectory() as tmp:
            result, _dom = engine.rebuild(deal, resolved=resolved(), offer=TEST_OFFER,
                                          html_path=Path(tmp) / "v2.html", renderer=FakeRenderer())
        self.assertEqual(deal["roi"]["local_currency"], "AED")
        self.assertTrue(failing(result, "currency"), result.text())
        self.assertNotEqual(result.status(), "ready")

    def test_the_drafter_is_told_not_to_write_it(self):
        self.assertIn("Do not write that no currency was named", prompt.UNSTATED_CURRENCY)


# ------------------------------------------------------------- the deposit ---
class DepositPaidInFullTests(unittest.TestCase):
    """Every reference says the deposit "comes off the first payment"; paid in
    full there is one payment, and three drafts copied the line."""

    def test_the_offer_block_names_the_payment_it_comes_off(self):
        self.assertIn("comes off the payment at the start", offer.prompt_block(resolved()))
        self.assertNotIn("first payment", offer.prompt_block(resolved()))
        two = resolved({"payment": "two_payments"})
        self.assertGreater(len(two["instalments"]), 1)
        self.assertIn("comes off the first payment", offer.prompt_block(two))

    def test_the_reference_s_label_is_an_instruction_when_paid_in_full(self):
        ref = general_deal(deposit_label="Reserves the start date, and comes off the first payment")
        info = {"file": "general.json", "variant": "general", "matched": True}
        full = prompt.system_for("general", resolved(), TEST_OFFER, ref, info)
        self.assertNotIn("comes off the first payment", full)
        self.assertIn(prompt.DEPOSIT_IN_FULL_SHAPE, full)
        split = prompt.system_for("general", resolved({"payment": "two_payments"}), TEST_OFFER, ref, info)
        self.assertIn("comes off the first payment", split)

    def test_a_first_payment_paid_in_full_warns_and_a_reference_is_not_failed_for_it(self):
        deal = general_deal(deposit_label="Reserves the start date, and comes off the first payment")
        r = check(deal)
        self.assertTrue([x for x in r.rows if x["check"] == "deposit" and x["status"] == "WARN"], r.text())
        self.assertFalse([p for p in references.problems_in(deal, TEST_OFFER) if p.startswith("deposit")])
        deal["deposit_label"] = "Reserves the start date, and comes off the payment at the start"
        self.assertFalse([x for x in check(deal).rows if x["check"] == "deposit"])


# ---------------------------------------------------------- the gap tiles ---
class GridReferenceGapTilesTests(unittest.TestCase):
    """general-grid.json has no gap_points, so 175832813's gap page was the
    funnel alone, about 430 px blank."""

    def test_a_general_reference_without_tiles_asks_for_them(self):
        ref = general_deal()
        ref.pop("gap_points", None)
        ref["gap_title"] = "Where the work comes from"
        shape = prompt.shape_of(ref)
        keys = list(shape)
        self.assertEqual(keys[keys.index("gap_title") + 1], "gap_points")
        self.assertEqual(shape["gap_points"], prompt.GAP_POINTS_SHAPE)

    def test_a_reference_s_own_tiles_and_other_variants_are_left_alone(self):
        ref = general_deal(gap_points=[{"v": "40", "k": "enquiries a month"}])
        self.assertEqual(prompt.shape_of(ref)["gap_points"], [{"v": "40", "k": "enquiries a month"}])
        blind = fakes.blind_deal()
        self.assertNotIn("gap_points", prompt.shape_of(blind))


if __name__ == "__main__":
    unittest.main()
