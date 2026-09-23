"""The recruiting agent's shapes, which is where its two real bugs lived."""

import unittest

from radar.hiring import _clamp, _list, prompt_for


ROLE = {
    "key": "csm",
    "label": "Client success manager",
    "compensation": "Up to $6,000 a month.",
    "scorecard": ["Retention", "Clients on track"],
    "dailyResponsibilities": "Own a roster of GCC clients.",
    "postOn": "Indeed and LinkedIn.",
    "rampTime": "2 to 3 weeks.",
}


class Shapes(unittest.TestCase):
    def test_a_string_where_a_list_was_asked_for_is_not_split_into_letters(self):
        # A model answering with one string used to put "T; h; e" on the record.
        self.assertEqual(_list("The applicant has limited experience"),
                         ["The applicant has limited experience"])
        self.assertEqual(_list(["a", "b"]), ["a", "b"])
        self.assertEqual(_list(None), [])
        self.assertEqual(_list(["", "  "]), [])

    def test_a_score_is_always_between_zero_and_ten(self):
        self.assertEqual(_clamp(11), 10.0)
        self.assertEqual(_clamp(-3), 0.0)
        self.assertEqual(_clamp("6.4"), 6.4)
        self.assertEqual(_clamp(None), 0.0)
        self.assertEqual(_clamp("not a number"), 0.0)


class Prompt(unittest.TestCase):
    def test_it_never_hands_the_model_a_country(self):
        # GoHighLevel infers a country from the phone number. Passing it made
        # the agent report its own guess as a fault of the candidate.
        row = {"country": "KW", "years_experience": 4, "arabic": "Khaliji"}
        p = prompt_for(ROLE, row, "I live in Dammam.", [])
        self.assertNotIn("they are in KW", p)
        self.assertIn("do not assume it from anything else", p)
        self.assertIn("4 years of experience", p)
        self.assertIn("Khaliji", p)

    def test_the_scorecard_and_the_application_both_reach_the_model(self):
        p = prompt_for(ROLE, {"years_experience": None}, "My application.", [])
        self.assertIn("Retention; Clients on track", p)
        self.assertIn("My application.", p)
        self.assertIn("an unstated number of years", p)

    def test_lessons_for_this_role_only_are_carried(self):
        learned = [
            {"role": "csm", "agentScore": 4, "azizScore": 8, "agentReason": "thin", "azizNote": "he ran a roster"},
            {"role": "media-buyer", "agentScore": 9, "azizScore": 3, "agentReason": "no", "azizNote": "no"},
        ]
        p = prompt_for(ROLE, {"years_experience": 2}, "x", learned)
        self.assertIn("You said 4, he said 8", p)
        self.assertNotIn("You said 9", p)

    def test_no_em_dashes_reach_a_candidate_facing_prompt(self):
        p = prompt_for(ROLE, {"years_experience": 2}, "x", [])
        self.assertNotIn("—", p)


if __name__ == "__main__":
    unittest.main()
