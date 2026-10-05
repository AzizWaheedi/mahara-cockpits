"""The contact's name on the cover, from the proof run of recording 176954619
on 5 October 2026: the surname printed in lower case, copied from the Fathom
speaker label (the live draft had it capitalised). A name taken from a
speaker label is put in title case where the deal is stamped; particles and
Arabic script stay as they are, a name with capitals inside is left alone,
and a name the closer typed is never changed. Run from hermes/sales-desk:

    python3 -m unittest tests.test_contact_name
"""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from typing import Any, Optional

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import engine, prompt  # noqa: E402
from tests import fakes  # noqa: E402
from tests.fakes import TEST_OFFER, FakeProvider, FakeRenderer, general_deal  # noqa: E402
from tests.test_desk import cfg_in, resolved  # noqa: E402


def call_with(label: str) -> str:
    """The synthetic call, with the client's turns under `label`."""
    return fakes.transcript().replace("Fahad Sample:", label + ":")


def drafted(contact: str, label: str, *, crm: Optional[str] = None, fills: Optional[dict[str, Any]] = None,
            prior: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """The deal the engine keeps when the drafter wrote `contact` for a call
    whose client speaks under `label`."""
    deal = general_deal(client_contact=contact)
    tmp = tempfile.mkdtemp()
    call = engine.Call(transcript_text=call_with(label), client_company="Mirage Test Contracting", client_name=crm)
    out = engine.run(call, lang="en", resolved=resolved(), offer=TEST_OFFER,
                     p=FakeProvider([fakes.triage_answer(margin=None), deal]), cfg=cfg_in(tmp),
                     log=lambda _m: None, workdir=Path(tmp) / "work", renderer=FakeRenderer(over=[[]]),
                     fills=fills, prior=prior)
    return out.deal


class TitleCaseTests(unittest.TestCase):

    def test_lower_case_words_are_capitalised(self):
        self.assertEqual(engine.name_in_title_case("fahad sample"), "Fahad Sample")
        self.assertEqual(engine.name_in_title_case("Fahad sample"), "Fahad Sample")
        self.assertEqual(engine.name_in_title_case("FAHAD SAMPLE"), "Fahad Sample")

    def test_particles_stay_as_they_are(self):
        self.assertEqual(engine.name_in_title_case("mohammed bin salman"), "Mohammed bin Salman")
        self.assertEqual(engine.name_in_title_case("ahmed al-harbi"), "Ahmed al-Harbi")
        self.assertEqual(engine.name_in_title_case("Ahmed Al Harbi"), "Ahmed Al Harbi")
        self.assertEqual(engine.name_in_title_case("ahmed al harbi"), "Ahmed al Harbi")
        self.assertEqual(engine.name_in_title_case("maria de la cruz"), "Maria de la Cruz")
        self.assertEqual(engine.name_in_title_case("abdul rahman ibn khalid"), "Abdul Rahman ibn Khalid")

    def test_a_kunya_is_a_name(self):
        self.assertEqual(engine.name_in_title_case("abu khalid"), "Abu Khalid")
        self.assertEqual(engine.name_in_title_case("umm faisal"), "Umm Faisal")

    def test_capitals_inside_a_word_and_arabic_script_are_kept(self):
        self.assertEqual(engine.name_in_title_case("Fahad AlSaud"), "Fahad AlSaud")
        self.assertEqual(engine.name_in_title_case("sara McLean"), "Sara McLean")
        self.assertEqual(engine.name_in_title_case("أحمد الحربي"), "أحمد الحربي")
        self.assertEqual(engine.name_in_title_case("ahmed الحربي"), "Ahmed الحربي")
        self.assertEqual(engine.name_in_title_case("o'neil"), "O'Neil")
        self.assertEqual(engine.name_in_title_case("eng. fahad sample"), "Eng. Fahad Sample")


class NameFromALabelTests(unittest.TestCase):

    def test_the_proved_case_is_capitalised(self):
        """The drafter copied the label "Fahad sample" onto the cover."""
        self.assertEqual(drafted("Fahad sample", "Fahad sample")["client_contact"], "Fahad Sample")
        self.assertEqual(drafted("fahad sample", "fahad sample")["client_contact"], "Fahad Sample")

    def test_part_of_a_label_is_from_it_too(self):
        self.assertEqual(drafted("fahad sample", "fahad sample (Mirage)")["client_contact"], "Fahad Sample")
        self.assertEqual(drafted("fahad", "fahad sample")["client_contact"], "Fahad")

    def test_the_crm_spelling_wins_when_it_has_capitals(self):
        deal = drafted("fahad mcsample", "fahad mcsample", crm="Fahad McSample")
        self.assertEqual(deal["client_contact"], "Fahad McSample")

    def test_a_name_from_no_label_is_left_as_written(self):
        self.assertEqual(drafted("fahad other", "Fahad Sample")["client_contact"], "fahad other")
        self.assertEqual(drafted("FILL", "fahad sample")["client_contact"], "FILL")

    def test_arabic_script_is_left_as_it_is(self):
        self.assertEqual(drafted("فهد سامبل", "فهد سامبل")["client_contact"], "فهد سامبل")

    def test_a_name_the_closer_typed_is_never_changed(self):
        prior = general_deal(client_contact="FILL")
        deal = drafted("FILL", "fahad sample", fills={"client_contact": "fahad sample"}, prior=prior)
        self.assertEqual(deal["client_contact"], "fahad sample")
        # Even when the drafter wrote the label where the closer had typed.
        deal = drafted("fahad sample", "fahad sample", fills={"client_contact": "fahad sample"}, prior=prior)
        self.assertEqual(deal["client_contact"], "fahad sample")

    def test_every_round_keeps_it(self):
        """stamp runs on the tightening and repair rounds too."""
        deal = general_deal(client_contact="fahad sample")
        engine.stamp(deal, variant="general", resolved=resolved(), lang="en", speakers=["fahad sample"])
        self.assertEqual(deal["client_contact"], "Fahad Sample")
        typed = general_deal(client_contact="fahad sample")
        engine.stamp(typed, variant="general", resolved=resolved(), lang="en", speakers=["fahad sample"],
                     closer_figures={"client_contact": "fahad sample"})
        self.assertEqual(typed["client_contact"], "fahad sample")

    def test_the_drafter_copies_the_label_and_code_capitalises_it(self):
        skill = " ".join(prompt.SKILL_FILE.read_text(encoding="utf-8").split())
        self.assertIn("a name copied from a speaker label is put in title case by code", skill)

    def test_the_labels_are_read_from_the_call(self):
        labels = engine.speaker_labels(call_with("fahad sample"))
        self.assertIn("fahad sample", labels)
        self.assertIn("Karim Example", labels)


if __name__ == "__main__":
    unittest.main()
