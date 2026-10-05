"""The adversarial review of the proposal fixes of 5 October 2026: the new
checks run over B2B's fourteen drafts and the morning's three, and over
sentences written to slip past them or to trip them. Each class is one way a
check misfired or was got round. Run from hermes/sales-desk:

    python3 -m unittest tests.test_proposal_review
"""
from __future__ import annotations

import os
import re
import tempfile
import unittest
from pathlib import Path
from typing import Any

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import offer, prompt, validate  # noqa: E402
from desk.config import ROOT  # noqa: E402
from tests import fakes  # noqa: E402
from tests.fakes import general_deal, specific_deal  # noqa: E402
from tests.test_desk import check, failing, resolved, with_offer  # noqa: E402
from tests.test_proposal_quality import FiguresKeptTests, MeasuredRenderer, run_engine  # noqa: E402

TEMPLATE = (ROOT / "proposal-template.html").read_text(encoding="utf-8")


def warned(result: validate.Result, name: str) -> list[str]:
    return [r["detail"] for r in result.rows if r["check"] == name and r["status"] == "WARN"]


def promises(line: str) -> bool:
    return validate.promises_results(validate._plain(line))


# ------------------------------------------------------------ number words ---
class NumberWordsThatAreNoCountTests(unittest.TestCase):
    """"Each one" in a note read as the figure 1, MSA's eleven and twelve as
    10, a housing unit as one, and the first end of "225 to 252 thousand" as
    225."""

    def test_one_with_no_count_in_it(self):
        for text in ("each one a site visit and a quote", "no one signed", "the one channel you cannot turn up",
                     "a one-off fee", "كل واحد منهم دفع كفالة"):
            self.assertEqual(validate.figures_in(text), [], text)
        for text, want in (("only one signed", [1]), ("one project signed", [1]), ("twenty-one meetings", [21]),
                           ("واحد فقط", [1])):
            self.assertEqual(validate.figures_in(text), want, text)

    def test_modern_standard_eleven_and_twelve(self):
        self.assertEqual(validate.figures_in("أحد عشر مشروعاً"), [11])
        self.assertEqual(validate.figures_in("اثنا عشر شهراً"), [12])
        self.assertEqual(validate.figures_in("اثنتي عشرة صفقة"), [12])

    def test_a_unit_is_not_one(self):
        self.assertEqual(validate.figures_in("٢٠ وحدة سكنية"), [20])

    def test_a_range_shares_its_scale(self):
        self.assertEqual(validate.figures_in("USD 225 to 252 thousand"), [225000, 252000])
        self.assertEqual(validate.figures_in("٢٢٥ إلى ٢٥٢ ألف دولار"), [225000, 252000])
        self.assertEqual(validate.figures_in("USD 2 to 3 million"), [2000000, 3000000])
        # A smaller second end is its own figure: USD 500 to 1M is not 500 million.
        self.assertEqual(validate.figures_in("USD 500 to 1M"), [500, 1000000])

    def test_halves_and_quarters_of_a_scale(self):
        for text, want in (("half a million riyals", [500000]), ("a million and a half", [1500000]),
                           ("a quarter of a million", [250000]), ("مليون ونص", [1500000]), ("نص مليون", [500000]),
                           ("ربع مليون", [250000]), ("half the fee", [])):
            self.assertEqual(validate.figures_in(text), want, text)

    def test_half_a_million_in_the_copy_is_the_client_s_500_000(self):
        deal = specific_deal(headline="Half a million riyals a year walks out of the door")
        words = fakes.transcript() + "\nClient: We lose about 500,000 riyals a year that way."
        self.assertFalse(failing(check(deal, text=words), "prose"), check(deal, text=words).text())

    def test_the_record_s_range_written_with_one_scale_passes_the_proof_check(self):
        deal = general_deal()
        deal["proof"] = [{"v": "USD 225 to 252 thousand", "k": "Signed from USD 3,000 a month of advertising."}]
        self.assertFalse(failing(check(deal), "proof"), check(deal).text())


# ---------------------------------------------------------------- the funnel ---
def funnel_deal(*stages: dict[str, Any]) -> dict[str, Any]:
    deal = general_deal()
    deal["funnel"] = {"title": "Last year", "note": "Every figure is yours.", "stages": list(stages)}
    return deal


class FunnelPoolsTests(unittest.TestCase):
    """Code gave a stage a pool of its own, and so dropped a correct "lost
    here", whenever the note above held any figure: what "each one" of a
    stage's quotes cost, or how many days the enquiries came in over."""

    def stamped(self, deal: dict[str, Any]) -> dict[str, Any]:
        from desk import engine
        engine.stamp(deal, variant="general", resolved=resolved(), lang="en")
        return deal

    def assert_loss_kept(self, deal: dict[str, Any]) -> None:
        self.stamped(deal)
        self.assertFalse(any("pool" in s for s in deal["funnel"]["stages"] if isinstance(s, dict)))
        self.assertTrue(validate.funnel_losses(deal["funnel"]))
        self.assertFalse(warned(check(deal), "funnel"))

    def test_each_one_is_no_count(self):
        self.assert_loss_kept(funnel_deal(
            {"label": "Quotes sent", "value": 40, "display": "40", "note": "each one a site visit and a drawing"},
            {"label": "Won", "value": 4, "display": "4", "note": "your own figure"}))

    def test_a_period_is_no_count(self):
        self.assert_loss_kept(funnel_deal(
            {"label": "Enquiries", "value": 20, "display": "20", "note": "across three days"},
            {"label": "Replied", "value": 2, "display": "2", "note": "the rest went quiet"}))

    def test_where_they_came_from_is_no_contradiction(self):
        self.assert_loss_kept(funnel_deal(
            {"label": "Enquiries", "value": 40, "display": "40", "note": "12 from Google, 28 from Instagram"},
            {"label": "Meetings", "value": 10, "display": "10", "note": "held"}))

    def test_what_became_of_them_still_separates(self):
        deal = self.stamped(funnel_deal(
            {"label": "Meetings held", "value": 14, "display": "14", "note": "five signed, nine did not"},
            {"label": "Projects signed", "value": 8, "display": "8", "note": "across the year"}))
        self.assertTrue(deal["funnel"]["stages"][1].get("pool"))

    def test_a_stage_that_is_not_an_object_crashes_nothing(self):
        deal = funnel_deal("Enquiries: 40",
                           {"label": "Meetings held", "value": 14, "display": "14", "note": "five signed, nine did not"},
                           {"label": "Projects signed", "value": 7, "display": "7", "note": "in eight months"})
        self.stamped(deal)
        self.assertTrue(deal["funnel"]["stages"][2].get("pool"))


# ----------------------------------------------------------------- the counts ---
class CountsThatAreNotTheSameCountTests(unittest.TestCase):
    """Four of B2B's drafts warned "the same count is told two ways" on counts
    that were never the same thing."""

    def deal(self, **over: Any) -> dict[str, Any]:
        deal = general_deal()
        deal["gap_points"] = [{"v": "6", "k": "Projects signed in eight months, all through people you know"}]
        deal["funnel"] = {"title": "This year", "note": "Referrals only.", "stages": [
            {"label": "Meetings held", "value": 14, "display": "14", "note": "since January"},
            {"label": "Projects signed", "value": 6, "display": "6", "note": "in eight months"}]}
        deal.update(over)
        return deal

    def test_a_noun_the_tile_does_not_count(self):
        # "Three signed" is the label's own count, not the 70 kitchens quoted.
        deal = self.deal()
        deal["gap_points"] = [{"v": "70", "k": "Kitchens quoted since March. Three signed"}]
        deal["funnel"]["stages"][1].update({"value": 3, "display": "3"})
        self.assertFalse(warned(check(deal), "figures"), check(deal).text())
        # Nor are the projects the channels would bring.
        deal = self.deal()
        deal["gap_points"] = [{"v": "0", "k": "Channels sending you projects that you own"}]
        deal["tree"]["goal_note"] = "Three projects came through referrals this year."
        self.assertFalse(warned(check(deal), "figures"), check(deal).text())

    def test_the_goal_a_rate_and_a_plan_are_not_counts(self):
        deal = self.deal()
        deal["tree"]["goal"] = "Seven projects signed a year, at USD 1 to 2 million each"
        deal["tree"]["goal_note"] = "One signed a quarter today. Two signed a quarter is what you want."
        deal["tree"]["note"] = "You need 4 signed to break even."
        self.assertFalse(warned(check(deal), "figures"), check(deal).text())

    def test_last_year_is_another_count(self):
        deal = self.deal()
        deal["funnel"]["stages"][1].update({"value": 3, "display": "3", "note": "your own figure for last year"})
        self.assertFalse(warned(check(deal), "figures"), check(deal).text())

    def test_money_beside_signed_is_no_count(self):
        deal = self.deal()
        deal["tree"]["goal_note"] = "Six hundred thousand signed this year."
        self.assertFalse(warned(check(deal), "figures"), check(deal).text())

    def test_the_morning_s_contradiction_still_warns(self):
        deal = self.deal()
        deal["tree"]["goal_note"] = "Two signed in eight months, short of the year you planned."
        got = warned(check(deal), "figures")
        self.assertTrue(got and "gap_points[0]" in got[0] and "tree.goal_note" in got[0], got)


# ------------------------------------------------------------- the promises ---
class PromisesTests(unittest.TestCase):
    """A number of meetings stated as what we deliver slipped through when it
    was not "built to"; the client's own firm "built to deliver projects"
    failed as a promise of ours."""

    def test_the_ways_round_the_rule_are_promises(self):
        for line in ("The program is designed to deliver thirty qualified meetings across the three months.",
                     "This program delivers thirty qualified meetings across the three months.",
                     "We will deliver 30 qualified meetings.",
                     "You will get thirty qualified meetings across the three months.",
                     "Expect thirty qualified meetings across the term.",
                     "The program is set up to deliver 30 meetings.",
                     # The old offer's own sentence, turned round.
                     "Thirty qualified meetings across the three months is what the program is built to deliver.",
                     "The floor of what this program is built to add is several times the engagement.",
                     "It is built to bring you new projects every month."):
            self.assertTrue(promises(line), line)

    def test_the_arabic_ways_round_it(self):
        for line in ("نضمن لك ٣٠ اجتماعاً.",
                     "سنوفر لك ٣٠ اجتماعاً مؤهلاً خلال ثلاثة أشهر.",
                     "يقدم البرنامج ثلاثين اجتماعاً مؤهلاً.",
                     "ستحصل على ٣٠ اجتماعاً مؤهلاً.",
                     "البرنامج مصمم ليحقق ثلاثين اجتماعاً مؤهلاً خلال ثلاثة أشهر."):
            self.assertTrue(promises(line), line)

    def test_what_is_no_promise(self):
        for line in ("Your team is built to deliver projects on time.",
                     "Your firm was built to deliver projects of this size.",
                     "The site is built to deliver fast pages to your clients.",
                     "We delivered 35 meetings for a contractor in Riyadh.",
                     "A campaign spending USD 500 produced 104 enquiries, 35 meetings and three signed deals.",
                     "We book qualified meetings into your calendar and confirm each one.",
                     "You will need 2 projects to break even.",
                     "We bring the meetings; you close them.",
                     "Thirty qualified meetings across the term is the target we work to, not a promise.",
                     "الهدف ثلاثون اجتماعاً مؤهلاً خلال ثلاثة أشهر.",
                     "شركتك مصممة لتنفيذ ٣ مشاريع في الشهر."):
            self.assertFalse(promises(line), line)

    def test_a_good_draft_describing_the_client_passes_the_guarantee_check(self):
        deal = general_deal()
        deal["tree"]["note"] = "Your team is built to deliver projects of this size; reaching the client is the gap."
        self.assertFalse(failing(check(deal), "guarantee"), check(deal).text())


# ------------------------------------------------------------- the payments ---
def tied(line: str) -> bool:
    return validate.tied_to_a_result(line)


class PaymentTiedTests(unittest.TestCase):
    """The check read a whole field at once, so "paid in full at the start"
    and "your first project's campaign" in the next sentence failed; and a
    payment that waits "once you close your first deal" passed."""

    def test_a_first_project_in_another_sentence_or_another_sense(self):
        for line in ("USD 6,000 paid in full at the start. We begin with your first project's campaign in week one.",
                     "The fee is paid at the start, and the work on your first project brief begins that week.",
                     "USD 3,000 after the start, and your first project begins in week two.",
                     "Paid in full at the start. The program pays for itself with the first project.",
                     "يُدفع المبلغ كاملاً عند البدء، ونبدأ مع أول مشروع لديك.",
                     "No payment ever waits on a first contract; both fall due on dates.",
                     # A date from the kickoff, not a result.
                     "USD 3,000 at the start and USD 3,000 thirty days after your first meeting with us."):
            self.assertFalse(tied(line), line)

    def test_the_ways_round_it_are_caught(self):
        for line in ("The balance falls due once you close your first deal.",
                     "The other USD 3,000 is payable after your first win.",
                     "The remaining USD 3,000 waits until a contract is signed.",
                     "USD 3,000 now and USD 3,000 once the first meetings are booked.",
                     "USD 3,000 now and USD 3,000 after we deliver the first ten meetings.",
                     "الدفعة الثانية عند توقيع العقد الأول.",
                     "الباقي مع أول عقد."):
            self.assertTrue(tied(line), line)

    def test_a_good_price_page_passes(self):
        deal = with_offer(specific_deal(), {"payment": "pif"})
        deal["investment"]["note"] = "Paid in full at the start. We begin with your first project's campaign in week one."
        self.assertEqual(failing(check(deal), "offer"), [])


# ------------------------------------------------------- the gross margin grid ---
class GrossMarginGridTests(unittest.TestCase):
    """A grid page with the client's gross margin and no margins of its own is
    drawn at that margin; the check read it at 10 and 20. And a grid with
    margins of its own labelled every column gross."""

    def test_the_check_divides_by_the_margin_the_page_prints(self):
        deal = general_deal()
        deal["arithmetic"].pop("margins")
        deal["arithmetic"]["gross_margin"] = 40
        rows = [r["detail"] for r in check(deal, text=None).rows if r["check"] == "arithmetic"]
        self.assertTrue(any("1 margins" in r for r in rows), rows)

    def test_only_the_client_s_margin_is_labelled_gross(self):
        self.assertIn("gm && m === gm ? `<th>${L.beAtGross}", TEMPLATE)

    def test_a_gross_margin_typed_in_arabic_digits_is_a_number_on_the_page(self):
        self.assertRegex(TEMPLATE, r"const gmRaw = Number\(String\(a\.gross_margin \?\? \"\"\)\.replace\(/\[\\u0660-\\u0669\]/g")

    def test_the_volume_page_s_unit_is_arabic_on_an_arabic_page(self):
        self.assertNotIn('"of one project" : "projects"', TEMPLATE)
        arabic = re.search(r'ar: \{.*?beOfOne: "([^"]*)"', TEMPLATE, re.S)
        self.assertTrue(arabic)
        self.assertIn("مشروع", arabic.group(1).encode().decode("unicode_escape"))


# ----------------------------------------------------------- the target tile ---
class TargetTileTests(unittest.TestCase):
    """The tile read "2 to 4 a month" over "The plan's target across the
    term" (specific.json's own value). The value carries its period."""

    def test_the_label_names_no_period(self):
        self.assertIn('beTarget: "The plan\'s target",', TEMPLATE)
        self.assertNotIn("across the term\",", TEMPLATE.split("ar: {")[0].split("beTarget")[1][:60])
        self.assertIn('target_projects_month: "The plan\'s target, with its period (2 to 4 a month)"', TEMPLATE)
        self.assertIn("with its period", prompt.outline(resolved()))


# ------------------------------------------------------------ the reference ---
class ReferenceFiguresTests(unittest.TestCase):
    """general.json's gross margin of 20 went to every general draft as the
    shape to copy, so a call with no margin could be counted at another
    client's."""

    def test_the_reference_s_margin_is_an_instruction(self):
        ref = general_deal()
        ref["arithmetic"].update({"gross_margin": 20, "project_label": "Your minimum ticket"})
        shape = prompt.shape_of(ref)
        self.assertTrue(str(shape["arithmetic"]["gross_margin"]).startswith("<"))
        self.assertTrue(str(shape["arithmetic"]["project_label"]).startswith("<"))
        self.assertEqual(ref["arithmetic"]["gross_margin"], 20, "the reference itself is untouched")

    def test_an_instruction_copied_as_it_stands_is_dropped(self):
        from desk import engine
        deal = general_deal()
        deal["arithmetic"].update({"gross_margin": prompt.GROSS_MARGIN_SHAPE, "project_label": prompt.PROJECT_LABEL_SHAPE})
        engine.stamp(deal, variant="general", resolved=resolved(), lang="en")
        self.assertNotIn("gross_margin", deal["arithmetic"])
        self.assertNotIn("project_label", deal["arithmetic"])
        self.assertFalse(failing(check(deal), "arithmetic"))


# --------------------------------------------------------- the typed currency ---
class TypedCurrencyTests(unittest.TestCase):
    """A closer filling the currency the call never named types "dirhams" or
    "ريال", not AED or SAR: the rebuild left the engagement in dollars under
    that name, and the field could not be filled again."""

    def deal(self, typed: str) -> dict[str, Any]:
        deal = general_deal()
        deal["roi"].update({"local_currency": "USD", "usd_rate": 1, "avg_project_value": 1000000})
        deal["arithmetic"] = {"mode": "margin", "currency": typed, "project_value": 1000000, "months": 3,
                              "title": "What it takes to pay for itself", "verdict": "One project covers it."}
        return deal

    def test_a_currency_typed_as_a_name_is_priced_in(self):
        from desk import engine
        for typed, code in (("dirhams", "AED"), ("ريال", "SAR"), ("sar", "SAR"), ("Qatari riyal", "QAR"),
                            ("Saudi Riyal (SAR)", "SAR")):
            deal = self.deal(typed)
            engine.follow_currency(deal)
            self.assertEqual(deal["arithmetic"]["currency"], code, typed)
            self.assertEqual(deal["roi"]["local_currency"], code, typed)
            self.assertEqual(deal["roi"]["usd_rate"], validate.USD_PEGS[code], typed)

    def test_one_the_page_cannot_price_in_is_a_blank_again(self):
        from desk import engine
        for typed in ("pounds", "dinar"):
            deal = self.deal(typed)
            engine.follow_currency(deal)
            self.assertEqual(deal["arithmetic"]["currency"], "FILL", typed)
            self.assertEqual(deal["roi"]["usd_rate"], 1, typed)


# -------------------------------------------------------------- the repair ---
class ProofRepairTests(unittest.TestCase):
    """The repair round tells the drafter to write FILL for a figure the call
    never gave; a proof figure is ours and comes from the record."""

    def test_a_proof_repair_copies_from_the_record(self):
        text = prompt.repair_user(general_deal(), ["proof: 1 figure(s) in the proof are not in our record"])
        self.assertIn("never FILL", text)
        self.assertIn("PATTERNS.md", text)
        self.assertNotIn("never FILL", prompt.repair_user(general_deal(), ["guarantee: a promise"]))


# ------------------------------------------------------------- tightening ---
class TighteningKeepsWhatIsSignedTests(unittest.TestCase):
    """Only the steps and the targets were held: a shorter version that
    dropped a term or a line of the price was taken."""

    def test_a_shorter_version_without_a_term_or_a_price_line_is_not_taken(self):
        no_term = specific_deal(subhead="Shorter.")
        no_term["terms"] = no_term["terms"][:1]
        no_row = specific_deal(subhead="Shorter still.")
        no_row["investment"]["rows"] = no_row["investment"]["rows"][:3]
        good = specific_deal(subhead="Short and whole.")
        out, _p = run_engine([fakes.triage_answer(), specific_deal(), no_term, no_row, good], over=[[5], []])
        self.assertEqual(out.deal["subhead"], "Short and whole.")
        self.assertEqual(len(out.deal["terms"]), 2)
        self.assertEqual(len(out.deal["investment"]["rows"]), 4)

    def test_a_few_lines_over_keeps_every_proof_too(self):
        from desk import engine
        from tests.fakes import FakeProvider
        from tests.test_desk import cfg_in
        no_proof = specific_deal(subhead="Shorter.")
        no_proof["proof"] = no_proof["proof"][:2]
        good = specific_deal(subhead="Short and whole.")
        tmp = tempfile.mkdtemp()
        p = FakeProvider([fakes.triage_answer(), specific_deal(), no_proof, good])
        call = engine.Call(transcript_text=fakes.transcript(), client_company="Mirage Test Contracting")
        out = engine.run(call, lang="en", resolved=resolved(), offer=fakes.TEST_OFFER, p=p, cfg=cfg_in(tmp),
                         log=lambda _m: None, workdir=Path(tmp) / "work", renderer=MeasuredRenderer([[5], []], 8))
        self.assertEqual(out.deal["subhead"], "Short and whole.")
        self.assertEqual(len(out.deal["proof"]), 3)

    def test_a_long_overflow_may_drop_a_proof(self):
        from desk import engine
        before = specific_deal()
        after = specific_deal()
        after["proof"] = after["proof"][:2]
        self.assertEqual(engine.lost_items(before, after, small=False), [])
        self.assertEqual(engine.lost_items(before, after, small=True), ["proof"])


# --------------------------------------------------------- the closer's figures ---
class FiguresOnTheSameLineTests(unittest.TestCase):
    """Draft again put the closer's figures back by position, so a fresh
    draft that ordered its tiles differently printed "6" signed on the tile
    that now said meetings a month."""

    setUp = FiguresKeptTests.setUp
    queue = FiguresKeptTests.queue
    worker = FiguresKeptTests.worker
    filled = FiguresKeptTests.filled

    def test_a_figure_goes_back_only_onto_the_line_it_was_typed_on(self):
        from desk import engine
        prior = specific_deal()
        prior["gap_points"][2]["v"] = "6"
        fresh = specific_deal()
        fresh["gap_points"] = [fresh["gap_points"][2], fresh["gap_points"][0], fresh["gap_points"][1]]
        fresh["gap_points"][2]["v"] = "FILL"  # now "Meetings a month"
        fresh["gap_points"][0]["v"] = "FILL"  # now "Projects signed a month"
        fresh["cost"]["close"] = "FILL"
        put, nowhere = engine.apply_fills(fresh, {"gap_points.2.v": "6", "cost.close": "Every month."}, prior)
        self.assertEqual(put, ["cost.close"])
        self.assertEqual(nowhere, ["gap_points.2.v"])
        self.assertEqual(fresh["gap_points"][2]["v"], "FILL")
        # The same line, still there: it goes back.
        same = specific_deal()
        same["gap_points"][2]["v"] = "FILL"
        self.assertEqual(engine.apply_fills(same, {"gap_points.2.v": "6"}, prior)[0], ["gap_points.2.v"])

    def test_the_worker_compares_against_the_version_the_closer_filled(self):
        from tests.fakes import FakeProvider
        prior = with_offer(specific_deal(), {"payment": "pif"})
        prior["gap_points"][0]["v"] = "40"
        self.filled(pid="p-1", deal=prior, status="failed")
        drafted = specific_deal()
        drafted["gap_points"] = [{"v": "FILL", "k": "Meetings a month"}] + drafted["gap_points"][1:]
        self.queue(params={"lang": "en", "proposal_id": "p-1", "offer": {"payment": "pif", "guarantee": False},
                           "fills": {"gap_points.0.v": "40"}})
        prov = FakeProvider([fakes.triage_answer(), drafted])
        self.worker(provider=lambda c, l: prov).run()
        from tests.test_desk import PROP
        p = self.pg.one(PROP, id="p-1")
        self.assertEqual(p["deal"]["gap_points"][0]["v"], "FILL")
        self.assertIn("gap_points.0.v", " ".join(p["validation"]["notes"]))


# ------------------------------------------------------------- the template ---
@unittest.skipUnless(os.environ.get("SALES_RENDER_LIVE") == "1", "SALES_RENDER_LIVE=1 runs the real browser")
class LiveTemplateReviewTests(unittest.TestCase):
    """The template's side of the review, in this machine's browser."""

    def dom(self, deal: dict[str, Any]) -> str:
        from desk import build, render
        with tempfile.TemporaryDirectory() as tmp:
            out = render.dom(build.build(deal, Path(tmp) / "p.html"))
        self.assertTrue(out)
        return validate.live_dom(out)

    def test_only_the_client_s_margin_is_labelled_gross_in_a_grid(self):
        deal = general_deal()
        deal["arithmetic"].update({"margins": [10, 25], "gross_margin": 25})
        live = self.dom(deal)
        self.assertIn("At 25 percent gross", live)
        self.assertNotIn("At 10 percent gross", live)
        self.assertIn("At 10 percent net", live)

    def test_a_grid_with_only_a_gross_margin_is_drawn_at_it(self):
        deal = general_deal()
        deal["arithmetic"].pop("margins")
        deal["arithmetic"]["gross_margin"] = "٤٠"
        live = self.dom(deal)
        self.assertIn("At 40 percent gross", live)

    def test_the_volume_unit_is_arabic_on_an_arabic_page(self):
        from tests.test_proposal_quality import volume_deal
        deal = volume_deal(gross_margin=20)
        deal["lang"] = "ar"
        live = self.dom(deal)
        self.assertNotIn("of one project", live)
        self.assertIn("من مشروع واحد", live)
        self.assertIn("450,000 إلى 600,000", live)
        self.assertNotIn("450,000 to 600,000", live)

    def test_the_funnel_s_loss_is_arabic_on_an_arabic_page(self):
        live = self.dom(general_deal(lang="ar"))  # 40, 12, 2: two losses drawn
        self.assertNotIn("lost here", live)
        self.assertEqual(live.count("تسرّب هنا"), 2)
        self.assertEqual(self.dom(general_deal()).count("lost here"), 2)

    def test_the_target_tile_takes_its_period_from_the_value(self):
        deal = specific_deal()
        deal["roi"]["target_projects_month"] = "2 to 4 a month"
        live = self.dom(deal)
        self.assertIn("2 to 4 a month", live)
        self.assertNotIn("across the term", live)


if __name__ == "__main__":
    unittest.main()
