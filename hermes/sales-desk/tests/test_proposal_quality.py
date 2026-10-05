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
from tests.test_desk import PROP, check, failing, resolved, with_offer  # noqa: E402

TEMPLATE = (ROOT / "proposal-template.html").read_text(encoding="utf-8")


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

    def test_the_tile_label_is_a_target(self):
        # No period of its own: the value carries it ("2 to 4 a month").
        self.assertTrue('beTarget: "The plan\'s target",' in TEMPLATE, "the English label")
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
        # A long label never pushes the amount onto two lines ("USD" over "10,500").
        amount = re.search(r"\n  \.total \.v \{(.*?)\}", TEMPLATE, re.S).group(1)
        self.assertIn("white-space: nowrap", amount)


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


# --------------------------------------------------------------- defect 7 ---
def run_engine(replies: list[Any], over: list[list[int]], **kw: Any):
    from desk import engine
    from tests.fakes import FakeProvider, FakeRenderer
    from tests.test_desk import cfg_in
    tmp = tempfile.mkdtemp()
    cfg = cfg_in(tmp)
    p = FakeProvider(replies)
    call = engine.Call(transcript_text=fakes.transcript(), client_company="Mirage Test Contracting")
    out = engine.run(call, lang="en", resolved=resolved(), offer=TEST_OFFER, p=p, cfg=cfg, log=lambda _m: None,
                     workdir=Path(tmp) / "work", renderer=FakeRenderer(over=over), **kw)
    return out, p


def margin_mode_deal(currency: str = "USD") -> dict[str, Any]:
    deal = general_deal()
    deal["roi"].update({"local_currency": "USD", "usd_rate": 1, "avg_project_value": 450000})
    deal["arithmetic"] = {"mode": "margin", "currency": currency, "project_value": 450000, "months": 3,
                          "title": "What it takes to pay for itself", "verdict": "One project covers it."}
    return deal


class UnstatedCurrencyTests(unittest.TestCase):
    """The call's floor of 1M was taken for dollars; the client never named a
    currency, and in dirhams the share of a project is off by 3.7 times."""

    def triage(self, currency: str) -> dict[str, Any]:
        found = fakes.triage_answer(margin=None)
        found["avg_project_value"]["currency"] = currency
        return found

    def test_triage_may_answer_unstated(self):
        from desk import prompt
        self.assertIn('"unstated"', prompt.TRIAGE_SYSTEM)
        self.assertIn("never assume", prompt.TRIAGE_SYSTEM)

    def test_an_unstated_currency_is_a_blank_for_the_closer(self):
        out, p = run_engine([self.triage("unstated"), margin_mode_deal()], over=[[]])
        self.assertEqual(out.deal["arithmetic"]["currency"], "FILL")
        self.assertIn("arithmetic.currency", out.result.fill_fields)
        self.assertEqual(out.result.status(), "needs_input")
        self.assertIn("never named a currency", p.calls[1]["user"])
        self.assertFalse([w for w in out.result.warnings() if w.startswith("currency")])

    def test_a_named_currency_is_left_alone(self):
        out, p = run_engine([self.triage("USD"), margin_mode_deal()], over=[[]])
        self.assertEqual(out.deal["arithmetic"]["currency"], "USD")
        self.assertNotIn("never named a currency", p.calls[1]["user"])

    def test_the_closer_s_currency_brings_its_rate_on_the_rebuild(self):
        from desk import engine
        from tests.fakes import FakeRenderer
        deal = margin_mode_deal("AED")
        with tempfile.TemporaryDirectory() as tmp:
            result, _dom = engine.rebuild(deal, resolved=resolved(), offer=TEST_OFFER,
                                          html_path=Path(tmp) / "v2.html", renderer=FakeRenderer())
        self.assertEqual((deal["roi"]["local_currency"], deal["roi"]["usd_rate"]), ("AED", 3.6725))
        self.assertFalse(failing(result, "arithmetic"), result.text())

    def test_a_page_in_one_currency_and_a_rate_for_another_fails(self):
        r = check(margin_mode_deal("AED"))
        self.assertTrue(any("AED" in x and "usd_rate" in x for x in failing(r, "arithmetic")), r.text())


# --------------------------------------------------------------- defect 8 ---
def volume_deal(**arith: Any) -> dict[str, Any]:
    deal = general_deal()
    deal["roi"].update({"local_currency": "SAR", "usd_rate": 3.75})
    deal["arithmetic"] = {"mode": "volume", "currency": "SAR", "months": 3, "project_value_low": 450000,
                          "project_value_high": 600000, "target_additional_low": 2, "target_additional_high": 4,
                          "rate_display": "two a month", "target_display": "2 to 4 over three months",
                          "title": "What it takes to pay for itself", "verdict": "The engagement is covered.",
                          **arith}
    return deal


class ArithmeticTests(unittest.TestCase):
    """The arithmetic page ignored a gross margin the client gave, a grid
    call copied the margin-mode reference, and 0.35 printed as 0.3."""

    def write_refs(self, folder: Path, grid: bool = True) -> None:
        import json
        margin = general_deal()
        margin["arithmetic"] = {"mode": "margin", "project_value": 1000000, "currency": "USD"}
        (folder / "general.json").write_text(json.dumps(margin), encoding="utf-8")
        (folder / "specific.json").write_text(json.dumps(specific_deal()), encoding="utf-8")
        if grid:
            (folder / "general-grid.json").write_text(json.dumps(general_deal()), encoding="utf-8")

    def test_a_call_with_no_project_value_copies_the_grid_reference(self):
        from desk import prompt
        with tempfile.TemporaryDirectory() as tmp:
            self.write_refs(Path(tmp))
            _d, info = prompt.load_reference(Path(tmp), "general", lambda _m: None, project_value=False)
            self.assertEqual(info["file"], "general-grid.json")
            _d, info = prompt.load_reference(Path(tmp), "general", lambda _m: None, project_value=True)
            self.assertEqual(info["file"], "general.json")
            _d, info = prompt.load_reference(Path(tmp), "general", lambda _m: None)
            self.assertEqual(info["file"], "general.json")

    def test_without_the_grid_file_a_grid_shaped_general_reference_is_preferred(self):
        import json
        from desk import prompt
        with tempfile.TemporaryDirectory() as tmp:
            self.write_refs(Path(tmp), grid=False)
            (Path(tmp) / "old-general.json").write_text(json.dumps(general_deal()), encoding="utf-8")
            _d, info = prompt.load_reference(Path(tmp), "general", lambda _m: None, project_value=False)
            self.assertEqual(info["file"], "old-general.json")

    def test_the_engine_says_whether_the_call_gave_a_value(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.write_refs(Path(tmp))
            out, _p = run_engine([fakes.triage_answer(value=None, margin=None), general_deal()], over=[[]],
                                 reference_dir=Path(tmp))
            self.assertEqual(out.reference["file"], "general-grid.json")

    def test_values_under_ten_keep_two_decimals(self):
        self.assertEqual([validate.dec(v) for v in (0.35, 0.3, 1.05, 1.75, 2.5, 12.34, 0)],
                         ["0.35", "0.3", "1.05", "1.75", "2.5", "12.3", "0.0"])
        self.assertTrue("const dec = " in TEMPLATE, "the template's dec")
        deal = margin_mode_deal()
        deal["arithmetic"]["project_value"] = 1000000
        deal["roi"]["avg_project_value"] = 1000000
        detail = [x["detail"] for x in check(deal, text=None).rows if x["check"] == "arithmetic"]
        self.assertTrue(any("1.05%" in d for d in detail), detail)

    def test_a_gross_margin_counts_the_projects_at_it(self):
        deal = volume_deal(gross_margin=20)
        rows = [x for x in check(deal, text=None).rows if x["check"] == "arithmetic"]
        self.assertTrue(any("20% gross" in x["detail"] for x in rows), rows)
        # 39,375 / (450,000 x 20%) = 0.44 of a project
        self.assertTrue(any("0.44" in x["detail"] for x in rows), rows)

    def test_a_verdict_that_talks_around_the_margin_warns(self):
        deal = volume_deal(verdict="The floor is several times the engagement before you count a cent of margin.")
        self.assertTrue(any("margin" in w for w in warned(check(deal, text=None), "arithmetic")))

    def test_a_gross_margin_the_page_leaves_out_warns(self):
        deal = volume_deal()
        deal["roi"]["margin_note"] = "You gave 20 to 30 percent, before admin and general expenses, so it is gross."
        self.assertTrue(any("gross" in w for w in warned(check(deal, text=None), "arithmetic")))
        deal["arithmetic"]["gross_margin"] = 20
        self.assertFalse(any("gross" in w for w in warned(check(deal, text=None), "arithmetic")))

    def test_the_gross_margin_is_the_client_s_figure_and_checked(self):
        deal = volume_deal(gross_margin=27)
        self.assertTrue(any("arithmetic.gross_margin=27" in w for w in warned(check(deal), "evidence counts")))


# --------------------------------------------------------------- defect 9 ---
class MeasuredRenderer:
    """The fake browser, saying by how many pixels each overflowing sheet is over."""

    def __init__(self, over: list[list[int]], px: int):
        from tests.fakes import FakeRenderer
        self.inner = FakeRenderer(over=over)
        self.px = px

    def dom(self, html_path: Path):
        out = self.inner.dom(html_path)
        return out.replace('class="sheet over"', f'class="sheet over" data-over-px="{self.px}"') if out else out

    def pdf(self, html_path: Path, out_path: Path) -> bool:
        return self.inner.pdf(html_path, out_path)

    def engine(self) -> str:
        return "fake browser"


class TighteningTests(unittest.TestCase):
    """A sheet 8 px over lost two of its five solution steps and a target
    tile: the drafter was never told by how much, and the rounds cut half."""

    def test_a_few_pixels_over_asks_for_two_or_three_lines_and_every_item_kept(self):
        from desk import prompt
        for round_no in (1, 2, 3):
            text = prompt.tighten_user(general_deal(), [5], round_no, px={5: 8})
            self.assertIn("8 px", text)
            self.assertIn("two or three lines", text)
            self.assertIn("keep every list item", text)
            self.assertNotIn("about a third", text)
            self.assertNotIn("about half", text)

    def test_a_long_overflow_still_asks_for_more(self):
        from desk import prompt
        text = prompt.tighten_user(general_deal(), [5], 2, px={5: 160})
        self.assertIn("160 px", text)
        self.assertIn("about a third", text)

    def test_the_proof_is_named_on_the_page_it_is_printed_on(self):
        from desk import prompt
        deal = general_deal()  # proof_on is "investment" unless it says otherwise
        self.assertIn("proof", prompt.blocks_on(deal, 6))
        self.assertNotIn("proof", prompt.blocks_on(deal, 5))
        deal["proof_on"] = "solution"
        self.assertIn("proof", prompt.blocks_on(deal, 5))
        self.assertNotIn("proof", prompt.blocks_on(deal, 6))
        self.assertIn("proof", prompt.SHEET_BLOCKS[6])
        self.assertNotIn("proof", prompt.SHEET_BLOCKS[5])

    def test_the_sheets_follow_the_pages_the_deal_has(self):
        from desk import prompt
        deal = general_deal()
        deal["arithmetic"]["inline"] = True  # no arithmetic sheet: the solution is sheet 4
        self.assertIn("solution", prompt.blocks_on(deal, 4))
        self.assertIn("arithmetic", prompt.blocks_on(deal, 5))

    def test_the_engine_passes_the_pixels(self):
        tmp = tempfile.mkdtemp()
        from desk import engine
        from tests.fakes import FakeProvider
        from tests.test_desk import cfg_in
        cfg = cfg_in(tmp)
        p = FakeProvider([fakes.triage_answer(), specific_deal(), specific_deal(subhead="Shorter.")])
        call = engine.Call(transcript_text=fakes.transcript(), client_company="Mirage Test Contracting")
        out = engine.run(call, lang="en", resolved=resolved(), offer=TEST_OFFER, p=p, cfg=cfg, log=lambda _m: None,
                         workdir=Path(tmp) / "work", renderer=MeasuredRenderer([[5], []], 8))
        self.assertTrue("8 px" in p.calls[2]["user"], "8 px in the tighten message")
        self.assertEqual(out.overflow_last, [])

    def test_a_shorter_version_that_drops_a_step_or_a_target_is_not_taken(self):
        short_steps = specific_deal(subhead="Shorter.")
        short_steps["solution"] = short_steps["solution"][:3]
        short_targets = specific_deal(subhead="Shorter.")
        short_targets["solution_targets"] = short_targets["solution_targets"][:2]
        good = specific_deal(subhead="Short and whole.")
        out, _p = run_engine([fakes.triage_answer(), specific_deal(), short_steps, short_targets, good],
                             over=[[5], []])
        self.assertEqual(out.deal["subhead"], "Short and whole.")
        self.assertEqual(len(out.deal["solution"]), 5)
        self.assertEqual(len(out.deal["solution_targets"]), 3)
        self.assertEqual(out.overflow_last, [])


# -------------------------------------------------------------- defect 10 ---
def funnel_deal(*stages: dict[str, Any]) -> dict[str, Any]:
    deal = general_deal()
    deal["funnel"] = {"title": "The year so far", "note": "Every figure is yours.", "stages": list(stages)}
    return deal


class FunnelTests(unittest.TestCase):
    """A text value wrapped into four bold lines, a stage drew an empty box,
    and "lost here" contradicted the stage's own note."""

    def test_words_in_value_fail_the_schema(self):
        for bad in ("a handful", "8 to 10", None, True):
            deal = funnel_deal({"label": "Enquiries", "value": bad, "display": "a handful", "note": "referrals"},
                               {"label": "Meetings", "value": 14, "display": "14", "note": "held"})
            got = failing(check(deal), "schema funnel")
            self.assertTrue(any("funnel.stages[0].value" in x for x in got), (bad, got))

    def test_a_number_in_value_and_words_in_display_pass(self):
        deal = funnel_deal({"label": "Enquiries", "value": 0, "display": "a handful, all referrals", "note": "x"},
                           {"label": "Meetings", "value": "14", "display": "14", "note": "held"})
        self.assertFalse(failing(check(deal), "schema funnel"))

    def test_a_value_left_to_fill_is_a_gap(self):
        deal = funnel_deal({"label": "Enquiries", "value": "FILL", "display": "FILL", "note": "a month"},
                           {"label": "Meetings", "value": 14, "display": "14", "note": "held"})
        r = check(deal)
        self.assertFalse(failing(r, "schema funnel"))
        self.assertEqual(r.status(), "needs_input")

    def test_a_loss_the_note_contradicts_warns(self):
        deal = funnel_deal({"label": "Meetings held", "value": 14, "display": "14",
                            "note": "four reached a signature, ten did not"},
                           {"label": "Projects signed", "value": 6, "display": "6", "note": "in eight months"})
        got = warned(check(deal), "funnel")
        self.assertTrue(got and "funnel.stages[1]" in got[0] and "pool" in got[0], got)

    def test_code_gives_the_contradicted_stage_its_own_pool(self):
        from desk import engine
        deal = funnel_deal({"label": "Meetings held", "value": 14, "display": "14",
                            "note": "four reached a signature, ten did not"},
                           {"label": "Projects signed", "value": 6, "display": "6", "note": "in eight months"})
        engine.stamp(deal, variant="general", resolved=resolved(), lang="en")
        self.assertTrue(deal["funnel"]["stages"][1].get("pool"))
        self.assertFalse(validate.funnel_losses(deal["funnel"]))
        self.assertFalse(warned(check(deal), "funnel"))
        whole = general_deal()  # 40, 12, 2 in one month: nothing to separate
        engine.stamp(whole, variant="general", resolved=resolved(), lang="en")
        self.assertFalse(any("pool" in s for s in whole["funnel"]["stages"]))

    def test_a_stage_from_another_pool_is_not_a_loss(self):
        deal = funnel_deal({"label": "Meetings held", "value": 14, "display": "14",
                            "note": "four reached a signature, ten did not"},
                           {"label": "Projects signed", "value": 6, "display": "6", "note": "in eight months",
                            "pool": "the year"})
        self.assertFalse(warned(check(deal), "funnel"))


# -------------------------------------------------------------- defect 12 ---
class CosmeticTests(unittest.TestCase):
    """"Your average project" over a minimum ticket, and the driver tree's
    last items sitting on the exhibit's bottom rule."""

    def test_the_margin_page_says_project_value_and_takes_the_deal_s_own_label(self):
        self.assertTrue('beYourProject: "Your project value"' in TEMPLATE, "the English label")
        self.assertTrue("a.project_label ? esc(a.project_label) : L.beYourProject" in TEMPLATE,
                        "the deal's own label wins")

    def test_the_tree_keeps_clear_of_the_rule_under_it(self):
        rule = re.search(r"\n  \.tree \{(.*?)\}", TEMPLATE, re.S).group(1)
        self.assertIn("padding-bottom", rule)

    def test_a_drafter_with_no_reference_is_shown_the_new_keys(self):
        from desk import prompt
        shape = prompt.outline(resolved())
        for key in ("gross_margin", "project_label", "pool"):
            self.assertIn(f'"{key}"', shape)
        self.assertNotIn('"2 to 4"', shape)


# ------------------------------------------------------- the code review ---
class FiguresKeptTests(unittest.TestCase):
    """A rebuild that finally failed said "The draft failed four times", and
    Draft again started a fresh draft that dropped the closer's figures."""

    from tests.test_desk import QueueTests as _Q
    setUp = _Q.setUp
    queue = _Q.queue
    worker = _Q.worker
    filled = _Q.filled

    def rebuild_request(self, **row: Any) -> None:
        self.queue("req-5", "p-9", params={"proposal_id": "p-9", "rebuild": True, "lang": "en"}, **row)

    def test_a_rebuild_that_fails_for_good_says_the_figures_are_kept(self):
        self.filled(deal=with_closer_figures(specific_deal()))
        self.rebuild_request(attempts=3)
        with mock.patch.object(self.sb, "upload", side_effect=RuntimeError("storage said no")):
            self.worker(provider=fakes.never, fathom_client=fakes.never).run()
        p = self.pg.one(PROP, id="p-9")
        self.assertEqual(p["status"], "failed")
        self.assertNotIn("The draft failed four times", p["error"])
        self.assertIn("your figures", p["error"])
        self.assertIn("Draft again", p["error"])
        self.assertIn("storage said no", p["error"])

    def test_a_rebuild_the_worker_dropped_four_times_says_so_too(self):
        from datetime import datetime, timedelta, timezone
        old = (datetime.now(timezone.utc) - timedelta(minutes=45)).replace(microsecond=0).isoformat()
        self.filled(deal=with_closer_figures(specific_deal()))
        self.rebuild_request(status="running", claimed_at=old.replace("+00:00", "Z"), claimed_by="dead-box",
                             attempts=4, error="timed out")
        self.worker().reap()
        p = self.pg.one(PROP, id="p-9")
        self.assertEqual(p["status"], "failed")
        self.assertIn("your figures", p["error"])

    def test_a_rebuild_the_checker_fails_keeps_the_figures_and_says_how(self):
        deal = with_closer_figures(specific_deal())
        deal["terms"].append("If we do not deliver 30 qualified appointments in 90 days, we work for free.")
        self.filled(deal=deal)
        self.rebuild_request()
        self.worker(provider=fakes.never, fathom_client=fakes.never).run()
        p = self.pg.one(PROP, id="p-9")
        self.assertEqual(p["status"], "failed")
        self.assertIn("your figures", p["error"])
        self.assertIn("draft again", p["error"].lower())

    def test_a_fresh_draft_takes_the_closer_s_figures_back(self):
        from tests.fakes import FakeProvider
        drafted = specific_deal()
        drafted["cost"]["close"] = "FILL"
        drafted["gap_points"][0]["v"] = "FILL"
        figures = {"cost.close": "You pay it every month already.", "gap_points.0.v": "7,700",
                   "funnel.stages.9.note": "a blank the new draft does not have"}
        self.queue(params={"lang": "en", "proposal_id": "p-1", "offer": {"payment": "pif", "guarantee": False},
                           "fills": figures})
        prov = FakeProvider([fakes.triage_answer(), drafted])
        self.worker(provider=lambda c, l: prov).run()
        p = self.pg.one(PROP, id="p-1")
        self.assertEqual(p["deal"]["cost"]["close"], "You pay it every month already.")
        self.assertEqual(p["deal"]["gap_points"][0]["v"], 7700)  # a whole FILL takes a number, as proposal.fill does
        self.assertEqual(p["deal"]["closer_figures"], figures)
        self.assertEqual(p["status"], "ready", p["validation"]["report"])
        notes = " ".join(p["validation"]["notes"])
        self.assertIn("2 of the figures you typed", notes)
        self.assertIn("funnel.stages.9.note", notes)

    def test_the_closer_s_figures_are_not_read_as_copy(self):
        deal = with_closer_figures(specific_deal(lang="ar"))
        deal["closer_figures"]["headline"] = "FILL is what it said before"
        self.assertFalse([p for p, _t in validate.content_strings(deal) if p.startswith("closer_figures")])
        self.assertNotIn("closer_figures", " ".join(check(deal).fill_fields))


def with_closer_figures(deal: dict[str, Any]) -> dict[str, Any]:
    deal = with_offer(deal, {"payment": "pif"})
    deal["closer_figures"] = {"cost.close": "Typed by the closer in English."}
    return deal


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
        self.assertFalse(">Break-even<" in live, ">Break-even<")
        self.assertFalse('<span class="v">0.0</span>' in live, '<span class="v">0.0</span>')

    def test_small_shares_keep_two_decimals_and_gross_is_labelled(self):
        deal = margin_mode_deal()
        deal["arithmetic"]["project_value"] = 1000000
        deal["roi"]["avg_project_value"] = 1000000
        self.assertTrue("1.05%" in self.dom(deal), "1.05%")
        live = self.dom(volume_deal(gross_margin=20))
        self.assertTrue("0.44 of one project" in live, "0.44 of one project")
        self.assertTrue("gross" in live, "gross")

    def test_an_overflowing_sheet_says_by_how_much(self):
        deal = specific_deal()
        deal["solution"] = deal["solution"] * 3
        live = self.dom(deal)
        m = re.search(r'class="sheet[^"]*\bover\b[^"]*"[^>]*data-over-px="(\d+)"', live)
        self.assertTrue(m, "an over sheet with data-over-px")
        self.assertGreater(int(m.group(1)), 0)

    def stage_html(self, live: str) -> list[str]:
        return re.findall(r'<div class="fstage.*?</div>\s*</div>', live, re.S)

    def test_the_funnel_draws_losses_only_within_one_pool_of_figures(self):
        live = self.dom(funnel_deal(
            {"label": "Enquiries", "value": 0, "display": "a handful, all referrals", "note": "January to June"},
            {"label": "Meetings held", "value": 14, "display": "14", "note": "four reached a signature"},
            {"label": "Projects signed", "value": 6, "display": "6", "note": "in eight months", "pool": "year"}))
        self.assertFalse("lost here" in live, "no loss across pools")
        self.assertTrue('class="val words"' in live, "words drawn as words")
        first = live[live.index("Enquiries"):live.index("Meetings held")]
        self.assertFalse('class="track"' in first, "no empty box for a stage with no figure")

    def test_a_range_is_not_subtracted_and_figures_still_are(self):
        live = self.dom(funnel_deal(
            {"label": "Leads last month", "value": 67, "display": "67", "note": "from Google Ads"},
            {"label": "Related to a real project", "value": 10, "display": "8 to 10", "note": "the rest were not"},
            {"label": "Signed", "value": 0, "display": "0", "note": "none in two months"}))
        self.assertEqual(live.count("lost here"), 0, "neither the range nor the drop after it is computed")
        live = self.dom(general_deal())  # 40, 12, 2 from one month
        self.assertEqual(live.count("lost here"), 2, "one month's funnel still shows its losses")

    def test_a_minimum_ticket_is_called_what_it_is(self):
        deal = margin_mode_deal()
        deal["arithmetic"]["project_label"] = "Your minimum ticket"
        live = self.dom(deal)
        self.assertTrue("Your minimum ticket" in live, "the deal's label")
        live = self.dom(margin_mode_deal())
        self.assertTrue("Your project value" in live and "Your average project" not in live, "the neutral label")

    def test_the_tiles_still_come_with_a_value_and_a_margin(self):
        deal = specific_deal()
        deal["roi"]["target_projects_month"] = "6 to 12 signed"
        live = self.dom(deal)
        self.assertTrue(">Break-even<" in live, ">Break-even<")
        self.assertTrue("The plan's target" in live, "The plan's target")


if __name__ == "__main__":
    unittest.main()
