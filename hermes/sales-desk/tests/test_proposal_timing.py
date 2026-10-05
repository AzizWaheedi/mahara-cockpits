"""The days to the first meeting, from the proof runs of 5 October 2026
(recording 180273419 on the wording branch): page 5's target tile said 15
days from signature, and page 7's third step said "Days 7 to 10" and that the
first meetings "land within ten days", as certain. PATTERNS.md gives 10 to 15.
Three fixes, one class each: a timing stated as certain for a result fails
the outcome check, the days to the first meeting are told the same way on
every page, and the drafter is told the timeline as the aim. Run from
hermes/sales-desk:

    python3 -m unittest tests.test_proposal_timing
"""
from __future__ import annotations

import os
import unittest
from typing import Any

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import engine, prompt, validate  # noqa: E402
from tests.fakes import general_deal  # noqa: E402
from tests.test_desk import check, failing  # noqa: E402

SKILL = " ".join(prompt.SKILL_FILE.read_text(encoding="utf-8").split())
PATTERNS = " ".join(prompt.PATTERNS_FILE.read_text(encoding="utf-8").split())

DAYS_TILE = {"v": "15", "k": "Days from signature to your first meeting"}
DAYS_TILE_AR = {"v": "15", "k": "يوم من التوقيع إلى أول اجتماع"}


def timeline_deal(*, tile: Any = None, when: str = "Days 7 to 15",
                  body: str = "Campaigns, funnel and filtering built. First meetings land in your calendar.",
                  lang: str = "en") -> dict[str, Any]:
    """The general reference's pages 5 and 7: a target tile for the days to
    the first meeting, and a third step to start that says when they land."""
    deal = general_deal(lang=lang)
    deal["solution_targets"][2] = dict(tile if tile is not None else DAYS_TILE)
    deal["start_steps"][2] = {"when": when, "title": "Build, then launch", "body": body}
    return deal


def with_line(line: str, key: str = "body", lang: str = "en") -> dict[str, Any]:
    """A deal whose third step's body (or another field) says `line`."""
    deal = general_deal(lang=lang)
    if key == "body":
        deal["start_steps"][2]["body"] = line
    elif key == "title":
        deal["start_steps"][2]["title"] = line
    elif key == "terms":
        deal["terms"].append(line)
    else:
        deal[key] = line
    return deal


def timed(deal: dict[str, Any]) -> list[str]:
    return [f for f in failing(check(deal, text=None), "guarantee") if "timing" in f]


def timeline(deal: dict[str, Any], status: str = "FAIL") -> list[str]:
    return [r["detail"] for r in check(deal, text=None).rows if r["check"] == "timeline" and r["status"] == status]


# ----------------------------------------------------- (a) timing as certain ---
class TimedOutcomeTests(unittest.TestCase):
    """180273419's page 7 said the first meetings "land within ten days":
    a date for a result, stated as certain, which neither the outcome check
    nor the echoes check caught."""

    def test_the_proved_line_fails_naming_the_field(self):
        found = timed(with_line("Campaigns, funnel and filtering built. First meetings land within ten days."))
        self.assertTrue(any("start_steps[2].body" in f for f in found), found)

    def test_other_english_forms_fail(self):
        for line, key in (("You will have meetings by day 10.", "body"),
                          ("Within ten days, the first meetings land in your calendar.", "body"),
                          ("First meetings within 10 days of launch", "title"),
                          ("Leads start arriving within a week of launch.", "body"),
                          ("Your first meetings are booked within 15 days.", "body"),
                          ("We book your first meetings within ten days of signing.", "body"),
                          ("First meetings land 10 to 15 days after signing.", "body"),
                          ("You'll see your first enquiries in the first week.", "body"),
                          ("First meetings in your calendar by the tenth day.", "subhead"),
                          ("First meetings land within ten days of launch.", "terms"),
                          ("Meetings booked inside two weeks", "headline"),
                          ("No more than 15 days to your first meeting.", "solution_close"),
                          ("First meetings: within 10 days of signing.", "body"),
                          ("The funnel was rebuilt, and now first meetings land within 10 days.", "body"),
                          ("We launch on day 7 and you have meetings within days 10 to 15.", "body")):
            self.assertTrue(timed(with_line(line, key)), line)

    def test_the_arabic_forms_fail(self):
        for line in ("أول الاجتماعات تصل خلال عشرة أيام.",
                     "تصلكم أول الاجتماعات خلال ١٠ أيام من التوقيع.",
                     "سيكون لديكم اجتماعات بحلول اليوم العاشر.",
                     "راح تبدأ المواعيد توصل خلال أسبوع.",
                     "أول الاجتماعات في تقويمكم من اليوم 10.",
                     "15 يوما من التوقيع إلى أول اجتماع."):
            self.assertTrue(timed(with_line(line, lang="ar")), line)

    def test_worded_as_a_target_or_an_aim_it_passes(self):
        for line in ("Launch on day 7. First meetings aimed for between days 10 and 15.",
                     "Launch on day 7, first meetings aimed for between days 10 and 15.",
                     "The target is first meetings within 15 days of signing.",
                     "We aim for your first meetings within ten days.",
                     "First meetings within 10 to 15 days is the aim, not a promise.",
                     "Our goal: first meetings in your calendar within 15 days."):
            self.assertEqual(timed(with_line(line)), [], line)
        for line in ("نهدف إلى أول الاجتماعات بين اليوم 10 و15.",
                     "الهدف أن تصل أول الاجتماعات خلال 15 يوما من التوقيع."):
            self.assertEqual(timed(with_line(line, lang="ar")), [], line)

    def test_timings_that_are_not_a_result_pass(self):
        for line in ("Onboarding follows within two days.",
                     "The formal agreement follows within one working day.",
                     "Every enquiry called within 30 minutes.",
                     "Campaigns go live on day 7.",
                     "Campaigns, funnel and filtering built. First meetings land in your calendar.",
                     "If no meetings land within 15 days, we review the funnel with you.",
                     "First meetings may land within ten days; the aim is fifteen.",
                     "Leads that arrive get a call within the hour.",
                     "Clients typically see their first meetings within two weeks.",
                     "A contractor in the same trade had his first meetings within nine days.",
                     "Our first meeting with your team is within two days of signing.",
                     "Leads arriving in the first month are called within minutes.",
                     "Your first report arrives within 7 days.",
                     "Launch on day 7, and first meetings land in your calendar."):
            self.assertEqual(timed(with_line(line)), [], line)
        self.assertEqual(timed(with_line("الانبوردينج خلال يوم إلى يومين.", lang="ar")), [])

    def test_the_target_tile_is_not_read(self):
        """Page 5 prints solution_targets under its "Target" label."""
        deal = timeline_deal(tile={"v": "15", "k": "Days until first meetings land in your calendar"})
        self.assertEqual(timed(deal), [])

    def test_the_references_shape_passes(self):
        self.assertEqual(timed(timeline_deal()), [])
        self.assertEqual(timed(timeline_deal(tile=DAYS_TILE_AR, when="من اليوم 7 إلى 15",
                                             body="بناء الحملات وتدريب الفريق. أول الاجتماعات تصل في تقويمكم.",
                                             lang="ar")), [])

    def test_it_is_repaired_as_the_aim(self):
        self.assertIn("guarantee", engine.REPAIRABLE)
        problem = timed(with_line("First meetings land within ten days."))[0]
        text = prompt.repair_user(general_deal(), ["guarantee: " + problem])
        self.assertIn("A timing for a result stated as certain is reworded as the aim, not removed", text)
        # Not the absolute outcome's "fewer" advice, and not told to remove it.
        self.assertNotIn("fewer small jobs arrive", text)
        self.assertNotIn("Remove a promise rather than rewording it.", text)


# ------------------------------------------------- (b) one figure everywhere ---
class TimelineConsistencyTests(unittest.TestCase):
    """The tile said 15 days and the step said days 7 to 10: two dates for the
    same first meeting, on pages the client reads one after the other."""

    def test_the_proved_pair_fails_naming_both_fields(self):
        deal = timeline_deal(when="Days 7 to 10",
                             body="Campaigns and funnel built. First meetings aimed for within ten days.")
        found = timeline(deal)
        self.assertTrue(found, check(deal, text=None).rows)
        self.assertTrue(any("solution_targets[2]" in f and "start_steps[2]" in f and "15" in f and "10" in f
                            for f in found), found)

    def test_the_step_window_alone_counts(self):
        """No figure in the body: the step's own window says when they land."""
        self.assertTrue(timeline(timeline_deal(when="Days 7 to 10")))

    def test_the_same_last_day_passes(self):
        self.assertEqual(timeline(timeline_deal()), [])
        self.assertTrue(timeline(timeline_deal(), status="PASS"))
        self.assertEqual(timeline(timeline_deal(tile={"v": "10 to 15", "k": DAYS_TILE["k"]})), [])
        self.assertEqual(timeline(timeline_deal(
            when="Day 7", body="Launch. First meetings aimed for between days 10 and 15.")), [])

    def test_the_arabic_pair_fails(self):
        deal = timeline_deal(tile=DAYS_TILE_AR, when="من اليوم 7 إلى 10",
                             body="بناء الحملات وتدريب الفريق. أول الاجتماعات تصل في تقويمكم.", lang="ar")
        self.assertTrue(timeline(deal))
        same = timeline_deal(tile=DAYS_TILE_AR, when="من اليوم 7 إلى 15",
                             body="بناء الحملات وتدريب الفريق. أول الاجتماعات تصل في تقويمكم.", lang="ar")
        self.assertEqual(timeline(same), [])

    def test_any_other_field_that_states_them_is_read(self):
        deal = timeline_deal()
        deal["terms"].append("First meetings are aimed for within 20 days of signing.")
        found = timeline(deal)
        self.assertTrue(any("terms[" in f and "20" in f for f in found), found)

    def test_days_to_your_first_meeting_in_a_sentence_are_read(self):
        deal = timeline_deal()
        deal["solution_close"] = "Launch on day 7, and the aim is 10 days to your first meeting."
        found = timeline(deal)
        self.assertTrue(any("solution_close says 10" in f for f in found), found)

    def test_another_clock_is_not_compared(self):
        """A week from launch and fifteen days from signature can both be true."""
        deal = timeline_deal(body="Built and live. First meetings aimed for within a week of launch.")
        self.assertEqual(timeline(deal), [])

    def test_weeks_are_read_as_days(self):
        self.assertEqual(timeline(timeline_deal(
            when="", body="First meetings aimed for within two weeks of signing.")), [])
        self.assertTrue(timeline(timeline_deal(when="", body="First meetings aimed for within a week of signing.")))

    def test_a_tile_counting_something_else_is_not_read(self):
        deal = timeline_deal(tile={"v": "90", "k": "Days to a second line that runs on its own numbers"})
        self.assertEqual(timeline(deal), [])
        self.assertEqual(timeline(deal, status="PASS"), [])

    def test_it_is_a_fail_the_repair_round_can_fix(self):
        self.assertIn("timeline", engine.REPAIRABLE)
        problem = timeline(timeline_deal(when="Days 7 to 10"))[0]
        text = prompt.repair_user(general_deal(), ["timeline: " + problem])
        self.assertIn("The days to the first meeting are one figure on every page", text)
        self.assertNotIn("The days to the first meeting are one figure",
                         prompt.repair_user(general_deal(), ["echoes: headline repeats subhead"]))


# ------------------------------------------------ an adversarial pass ---
class OrdinaryTimingWordingTests(unittest.TestCase):
    """Timings of ours that are no result, found by the adversarial pass of
    5 October 2026: the date of another clause, our own meetings with the
    client's team, our own paperwork, and the result as the subject or the
    object of what we do."""

    def test_they_pass_the_outcome_check(self):
        for line in ("Campaigns go live on day 7.",
                     "We aim for first meetings between days 10 and 15.",
                     "Within ten days of launch we review the numbers.",
                     "Within ten days of launch we review the numbers and first meetings land in your calendar.",
                     "Within 7 days of signing we launch, and first meetings land in your calendar.",
                     "Results are reviewed weekly, starting on day 14.",
                     "Reporting on results starts in week 1.",
                     "We review the first leads within ten days of launch.",
                     "You will receive the contract within one working day.",
                     "The contract is signed within a day.",
                     "Contract signed by the end of the week.",
                     "The project starts within two days of the deposit.",
                     "Weekly review meetings start in week 3.",
                     "The first onboarding meeting is within two days.",
                     "Our first meeting with your team is on day 2.",
                     "No meetings land before launch on day 7.",
                     "First meetings land in your calendar, each confirmed within 2 days.",
                     "Your onboarding appointment is booked within two days.",
                     "Expect weekly reports on leads within 7 days.",
                     "Results from day 30 onwards are reviewed with you.",
                     "Our target: first meetings by day 15."):
            self.assertEqual(timed(with_line(line)), [], line)
        for line in ("أول اجتماع مع فريقكم خلال يومين.",
                     "اجتماع الانبوردينج خلال يومين من التوقيع.",
                     "خلال عشرة أيام من الإطلاق نراجع الأرقام معكم.",
                     "خلال 7 أيام نطلق الحملات، وتصل أول الاجتماعات إلى تقويمكم.",
                     "نحجز لكم موعدا للانبوردينج خلال يومين.",
                     "والاستفسارات من اليوم 7 نتصل بها خلال دقائق.",
                     "الانبوردينج خلال يوم إلى يومين."):
            self.assertEqual(timed(with_line(line, lang="ar")), [], line)
        # "No more than" is still the promise.
        self.assertTrue(timed(with_line("No more than 15 days to your first meeting.", "solution_close")))


class PromisesThatSlippedTests(unittest.TestCase):
    """Dates for a result the first version let through."""

    def test_the_english_forms_fail(self):
        for line in ("First meetings guaranteed within 10 days.",
                     "Expect meetings within 10 days of launch.",
                     "Expect leads within a week.",
                     "You can expect meetings within 10 days.",
                     "Your calendar fills within 10 days.",
                     "15 meetings within 30 days.",
                     "Fifteen booked meetings in your first month.",
                     "Launch on day 7, meetings on day 10.",
                     "Meetings from day 10.",
                     "Meetings start in the second week.",
                     # 174685535's page 7 dates its visits by the calendar.
                     "First qualified visits land in the showrooms ahead of National Day.",
                     "First meetings land before the end of the month.",
                     # Targeting an audience is no aim.
                     "Targeted campaigns bring your first meetings within 10 days.",
                     "We target villa owners and first meetings land within 10 days."):
            self.assertTrue(timed(with_line(line)), line)

    def test_the_arabic_forms_fail(self):
        for line in ("أول الاجتماعات خلال عشرة أيام.",
                     "أول الاجتماعات خلال 10 أيام من الإطلاق.",
                     "أول اجتماع بحلول اليوم 15.",
                     "أول الاجتماعات خلال يومين.",
                     "اجتماعات مضمونة خلال 10 أيام.",
                     "نحجز لكم أول الاجتماعات خلال 10 أيام.",
                     "بنحجز لكم مواعيد خلال أسبوع.",
                     "سنحجز لكم 15 اجتماعا خلال 30 يوما.",
                     "توقعوا أول الاجتماعات خلال أسبوعين.",
                     "الاجتماعات من اليوم 10.",
                     "الإطلاق في اليوم 7، والاجتماعات من اليوم 10.",
                     "تبدأ الاجتماعات في الأسبوع الثاني.",
                     "أول الزيارات تصل قبل اليوم الوطني.",
                     "حملات مستهدفة، وتصل أول الاجتماعات خلال عشرة أيام."):
            self.assertTrue(timed(with_line(line, lang="ar")), line)


class TimelineOtherThingsTests(unittest.TestCase):
    """The timeline check held two figures against each other that count
    different things: our meeting with the client's team, a launch day, the
    window's opening day, a remedy's trigger, another client's record."""

    def test_our_own_meetings_are_not_the_first_meeting(self):
        for body in ("Formal agreement, then our first meeting with your team within two days.",
                     "The first onboarding meeting is within two days.",
                     "Your first kick-off meeting is on day 2."):
            deal = timeline_deal()
            deal["start_steps"][1]["body"] = body
            self.assertEqual(timeline(deal), [], body)
        deal = timeline_deal()
        deal["terms"].append("The first review meeting is held on day 30.")
        deal["program"][3]["note"] = "Weekly meetings start in week 3"
        self.assertEqual(timeline(deal), [])
        self.assertEqual(timed(deal), [])
        self.assertEqual(timeline(timeline_deal(tile={"v": "2", "k": "Days to the first onboarding meeting"})), [])
        deal = timeline_deal(tile=DAYS_TILE_AR, when="من اليوم 7 إلى 15",
                             body="بناء الحملات وتدريب الفريق. أول الاجتماعات تصل في تقويمكم.", lang="ar")
        deal["start_steps"][1]["body"] = "أول اجتماع مع فريقكم خلال يومين."
        self.assertEqual(timeline(deal), [])

    def test_a_launch_step_the_meetings_follow_is_not_their_window(self):
        for title, body in (("Launch", "Campaigns go live; first meetings follow."),
                            ("Campaigns live", "The first meetings follow from there.")):
            self.assertEqual(timeline(timeline_deal(when="Day 7", body=body)), [], body)
        # Their own date is still read.
        self.assertTrue(timeline(timeline_deal(when="Day 7",
                                               body="Campaigns go live. First meetings follow within ten days.")))

    def test_the_window_s_opening_day_is_no_last_day(self):
        self.assertEqual(timeline(timeline_deal(body="Launch on day 7; first meetings aimed for from day 10.")), [])

    def test_the_clock_is_read_in_the_timing_s_own_sentence(self):
        deal = timeline_deal(when="", body="Campaigns, funnel and filtering built. First meetings aimed for within "
                                           "8 days of the ads and the funnel going live.")
        self.assertEqual(timeline(deal), [])

    def test_a_condition_a_negation_and_a_record_are_not_read(self):
        for key, line in (("terms", "If the first meetings have not landed by day 21, we rebuild the funnel with you."),
                          ("terms", "No first meetings are booked before launch on day 7."),
                          ("solution_close", "A contractor in the same trade had his first meetings within nine days.")):
            deal = timeline_deal()
            if key == "terms":
                deal["terms"].append(line)
            else:
                deal[key] = line
            self.assertEqual(timeline(deal), [], line)

    def test_another_clause_s_date_is_not_read(self):
        deal = timeline_deal(body="First meetings land in your calendar, each confirmed within 2 days.")
        self.assertEqual(timeline(deal), [])

    def test_a_week_by_number_is_the_whole_week(self):
        """Week 3 is days 15 to 21, so it says what 15 days says; week 1 does not."""
        self.assertEqual(timeline(timeline_deal(when="Weeks 2 to 3")), [])
        self.assertEqual(timeline(timeline_deal(when="Week 2")), [])
        self.assertTrue(timeline(timeline_deal(when="Week 1")))
        self.assertTrue(timeline(timeline_deal(when="", body="First meetings aimed for in the first week.")))


# ------------------------------------------------------- (c) the drafter ---
class TimelineInstructionTests(unittest.TestCase):

    def test_the_skill_takes_the_timeline_from_patterns_as_the_aim(self):
        self.assertIn("The timeline comes from PATTERNS.md", SKILL)
        self.assertIn("launch on day 7, first meetings aimed for between days 10 and 15", SKILL)
        self.assertIn("never \"land within ten days\"", SKILL)

    def test_patterns_states_it_as_the_aim(self):
        self.assertIn("launch aimed for day 7", PATTERNS)
        self.assertIn("first meetings aimed for between days 10 and 15", PATTERNS)
        self.assertNotIn("meetings landing within", PATTERNS)
        # PATTERNS is the drafter's own reading: it passes the outcome check.
        for line in PATTERNS.split(". "):
            if "Timeline" in line:
                self.assertFalse(validate.timed_outcomes_in(line), line)


if __name__ == "__main__":
    unittest.main()
