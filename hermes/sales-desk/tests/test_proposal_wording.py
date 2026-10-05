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

    def test_the_same_figures_over_another_period_are_no_repeat(self):
        deal = volume_page("2 to 4 a month", "2 to 4 over three months")
        self.assertFalse(failing(check(deal, text=None), "rate"))
        for rate, target in (("3 since January", "3 over three months"),
                             ("3 over the last three months", "3 over three months"),
                             ("٣ منذ بداية السنة", "٣ خلال الأشهر الثلاثة")):
            result = check(volume_page(rate, target), text=None)
            self.assertFalse(failing(result, "rate"), (rate, target))
            self.assertTrue(rows(result, "rate", "PASS"), (rate, target))

    def test_the_same_figures_per_the_same_period_only_warn(self):
        """The target's row is labelled additional projects, so "2 a month"
        twice can be true: a fail sent a true rate to the repair round, which
        could only write FILL over it."""
        result = check(volume_page("2 a month", "2 a month"), text=None)
        self.assertFalse(failing(result, "rate"))
        found = rows(result, "rate", "WARN")
        self.assertTrue(any('"2 more a month"' in f for f in found), found)
        self.assertFalse([e for e in result.errors() if e.startswith("rate")])

    def test_a_rate_told_over_the_term_or_over_nothing_fails(self):
        for rate, target in (("2 to 4 over the term", "2 to 4 more over three months"),
                             ("2 to 4", "2 to 4"),
                             ("2 to 4 projects", "2 to 4 over three months")):
            self.assertTrue(failing(check(volume_page(rate, target), text=None), "rate"), (rate, target))

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
                     "Nothing below your ticket ever reaches you.",
                     "You won’t miss an enquiry again."):
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
                     "Small jobs are filtered out before they reach you.",
                     "Meetings are never booked without a budget check."):
            self.assertEqual(absolute(with_fix(line)), [], line)
        for line in ("لا نشارك بياناتك مع أحد أبدا.", "كل استفسار يتصل به فريقنا خلال 5 إلى 30 دقيقة."):
            self.assertEqual(absolute(with_fix(line, lang="ar")), [], line)

    def test_forms_that_slipped_through_fail(self):
        for line in ("Every lead we send you is qualified.",
                     "Every lead that reaches you is qualified.",
                     "Only qualified buyers reach your calendar.",
                     "You only meet serious buyers.",
                     "100% qualified leads, every month.",
                     "Zero wasted meetings.",
                     "You will never waste time on small jobs again.",
                     "So small jobs don't reach you.",
                     "A calendar that stays full, always.",
                     "Every meeting you take is with a serious buyer.",
                     "You will never again meet a client who cannot afford you.",
                     "Small jobs are filtered out completely, so none reach you.",
                     "No small job ever reaches your diary."):
            self.assertTrue(absolute(with_fix(line)), line)
        for line in ("ما راح توصلك الأعمال الصغيرة.",
                     "جميع العملاء مؤهلون.",
                     "فقط العملاء الجادون يصلونك.",
                     "عملاء مؤهلون ١٠٠٪.",
                     "جدولك مليان دايما.",
                     "كل العملاء المحتملين مؤهلين."):
            self.assertTrue(absolute(with_fix(line, lang="ar")), line)

    def test_what_we_do_a_condition_or_a_comparison_passes(self):
        for line in ("We never miss a follow-up: every enquiry gets three calls.",
                     "Our team will not let a small job through to your diary.",
                     "A weekly report that never arrives late.",
                     "Meetings are never booked if the budget is under your ticket.",
                     "Nothing ever reaches you without a budget check.",
                     "Enquiries that never reach the showroom today get a call in minutes.",
                     "Leads that don't show up get a second call within the hour.",
                     "If they do not arrive, we keep working until they do.",
                     "It costs no more per month than one junior hire.",
                     "Your team takes no more calls than today, only better ones.",
                     "No more fees after the first payment.",
                     "Every call is hot-transferred to your sales line.",
                     "Every lead is ready in your CRM within the hour.",
                     "Every enquiry is worth a reply, so we answer all of them.",
                     "We always confirm meetings booked for the next day by WhatsApp.",
                     "We always run full-funnel campaigns on two platforms.",
                     "Spend is capped and always on budget.",
                     "No-shows are never missed: each one gets a call the same day.",
                     "Only qualified meetings are booked by our setters.",
                     "100% of your ad budget goes to the platforms."):
            self.assertEqual(absolute(with_fix(line)), [], line)
        for line in ("لا مزيد من الرسوم بعد الدفعة الأولى.", "فريقنا لن يفوت أي مكالمة."):
            self.assertEqual(absolute(with_fix(line, lang="ar")), [], line)

    def test_the_cover_and_the_investment_rows_are_read(self):
        """The headline is the outcome the client wants, and the investment
        rows say what we sell; both left the check blind to a promise."""
        found = absolute(with_fix("A diary that is always full of serious buyers", key="headline"))
        self.assertTrue(any("headline" in f for f in found), found)
        deal = general_deal()
        deal["investment"]["rows"][0]["detail"] = "Setters who make sure only serious buyers reach you."
        found = absolute(deal)
        self.assertTrue(any("investment.rows[0].detail" in f for f in found), found)

    def test_the_diagnosis_pages_may_say_never(self):
        deal = general_deal(subhead="Referrals keep you busy, and the large villas never arrive.")
        deal["tree"]["branches"][0]["note"] = "The big developers never reach you."
        self.assertEqual(absolute(deal), [])

    def test_it_is_repaired_by_rewording(self):
        self.assertIn("guarantee", engine.REPAIRABLE)
        text = prompt.repair_user(general_deal(), ["guarantee: solution[1].fix states an outcome as certain"])
        self.assertIn("fewer", text)
        # Not told to remove the same line it is told to reword.
        self.assertNotIn("Remove a promise rather than rewording it.", text)
        self.assertIn("the one exception", text)
        plain = prompt.repair_user(general_deal(), ["guarantee: the document promises results in terms[0]"])
        self.assertIn("Remove a promise rather than rewording it.", plain)

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

    def test_a_gross_margin_beside_a_missing_net_one_still_warns(self):
        """A clause saying the net margin was not given is not a line saying
        no margin was given, however the net is named."""
        for line in ("You gave a gross margin of 25 percent, and no figure for the margin after overheads.",
                     "A gross margin of twenty-five percent, and you did not give the margin after costs.",
                     "هامش إجمالي خمسة وعشرين في المئة، ولم تذكر الهامش الصافي.",
                     "هامش ربح إجمالي ٪٢٥ على كل مشروع.",
                     "A gross margin of about 25 on every job."):
            self.assertTrue(gross_warned(margin_line(roi__margin_note=line)), line)

    def test_gross_revenue_is_no_margin(self):
        for line in ("Gross revenue grew 30 percent last year.",
                     "You did not give a margin; gross sales grew 30 percent.",
                     "A margin of 4 projects a quarter, gross."):
            self.assertEqual(gross_warned(margin_line(roi__margin_note=line)), [], line)


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

    def test_a_share_inside_a_fifth_says_margin_mode_would_carry_it(self):
        # SAR 39,375 against SAR 450,000 is 8.75 percent.
        found = arithmetic_rows(volume_deal())
        self.assertTrue(any("8.75% of one project at the bottom value, inside a fifth" in d for d in found), found)

    def test_a_share_margin_mode_warns_on_is_not_said_to_carry(self):
        """USD 10,500 against USD 40,000 is 26.25 percent: inside one third,
        and margin mode warns on it, so the note may not say it would carry."""
        found = arithmetic_rows(volume_page("3 since January", "2 to 4 over three months", project_value_low=40000))
        self.assertTrue(any("26.2% of one project" in d and "margin mode would warn" in d for d in found), found)
        self.assertFalse(any("would also carry it" in d for d in found), found)

    def test_margin_mode_fails_above_one_third_not_above_33(self):
        """Margin mode's line says "more than a third"; at 33.12 percent it
        is not, and the volume note calls that share inside one third."""
        from tests.test_proposal_quality import margin_mode_deal
        deal = margin_mode_deal()
        deal["arithmetic"]["project_value"] = 31700
        rep = validate.Report()
        validate.check_arithmetic(deal, rep)
        self.assertEqual([r["status"] for r in rep.rows], ["WARN"], rep.rows)
        deal["arithmetic"]["project_value"] = 30000
        rep = validate.Report()
        validate.check_arithmetic(deal, rep)
        self.assertEqual([r["status"] for r in rep.rows], ["FAIL"], rep.rows)
        self.assertIn("mode volume counts projects", rep.rows[0]["detail"])


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


# --------------------------------------------------------------- finding 6 ---
class VariantReasonTests(unittest.TestCase):
    """176954619's draft notes said the margin was not given, then that it was
    gross, on a page that counted that gross margin."""

    def test_a_gross_margin_given_is_no_net_margin_not_no_margin(self):
        found = fakes.triage_answer(is_net=False)
        found["net_margin"]["note"] = "gross, 20 to 30 percent"
        variant, why = engine.choose_variant(found, "a call")
        self.assertEqual(variant, "general")
        self.assertEqual(why, "project value given, no net margin: gross, 20 to 30 percent")

    def test_no_margin_at_all_says_never_stated(self):
        _v, why = engine.choose_variant(fakes.triage_answer(margin=None), "a call")
        self.assertEqual(why, "project value given, no net margin: never stated")

if __name__ == "__main__":
    unittest.main()
