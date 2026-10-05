"""The reference deals the drafter copies, checked against today's rules
(desk/references.py), and the three forms the VPS's general.json used on
4 October 2026 that the validator let through or only warned about.

The synthetic tests run against fakes.TEST_OFFER, so an edit to offer.json
does not break them. LiveReferenceTests runs the real check against the real
offer.json over the references on this machine: on the VPS that is
~/.sales-desk/reference (or SALES_REFERENCE_DIR), and it fails the suite when
one of them breaks a rule. Elsewhere there are none, and it is skipped.

    python3 -m unittest tests.test_references
"""
from __future__ import annotations

import contextlib
import copy
import importlib.util
import io
import json
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import offer, prompt, references, validate  # noqa: E402
from desk.config import ROOT  # noqa: E402
from tests.fakes import TEST_OFFER, blind_deal, general_deal, specific_deal  # noqa: E402

LIVE = Path(os.environ.get("SALES_REFERENCE_DIR") or Path.home() / ".sales-desk" / "reference").expanduser()


def faulty(deal: dict) -> dict:
    """The 4 October faults, in the words they took, on a synthetic deal."""
    deal = copy.deepcopy(deal)
    deal["investment"]["rows"][1] = {
        "item": "Payment structure", "amount": "2 x USD 3,000",
        "detail": "Half at the start, half when your first contract signs through the system."}
    deal["investment_close"] = "Thirty qualified meetings across the three months, or we keep working at no further fee."
    deal["terms"] = deal["terms"] + [
        "Thirty qualified meetings across the term, or we continue at no further fee until you have them.",
        "The second USD 3,000 falls due when your first contract signs through the system, not before."]
    deal["solution_targets"][0] = {"v": "30", "k": "Qualified meetings across the three months, guaranteed"}
    return deal


def write(folder: Path, name: str, deal) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_text(deal if isinstance(deal, str) else json.dumps(deal), encoding="utf-8")


def rows(deal: dict, choice=None) -> dict[str, list[dict]]:
    """The validator's rows by check, under TEST_OFFER and the closer's choice."""
    res = validate.validate(deal, None, resolved=offer.resolve(TEST_OFFER, choice), offer=TEST_OFFER,
                            today=date(2099, 1, 1))
    out: dict[str, list[dict]] = {}
    for r in res.rows:
        out.setdefault(r["check"], []).append(r)
    return out


def failed(deal: dict, check: str, choice=None) -> bool:
    return any(r["status"] == validate.FAIL for r in rows(deal, choice).get(check, []))


class ReferenceCheckTests(unittest.TestCase):
    def test_a_clean_reference_of_each_variant_passes(self):
        for deal in (general_deal(), specific_deal(), blind_deal()):
            self.assertEqual(references.problems_in(deal, TEST_OFFER), [], deal.get("variant") or "specific")

    def test_the_4_october_faults_fail_the_reference(self):
        problems = references.problems_in(faulty(general_deal()), TEST_OFFER)
        names = [p.split(":", 1)[0] for p in problems]
        self.assertIn("offer", names)
        self.assertIn("guarantee", names)
        self.assertTrue(any("investment.rows[1]" in p for p in problems))

    def test_a_reference_is_judged_on_the_day_it_was_written(self):
        # shape_of hands the drafter today's date, so its own may have passed.
        old = general_deal(date="5 September 2026", valid_until="30 September 2026")
        self.assertEqual(references.problems_in(old, TEST_OFFER), [])
        self.assertEqual(references.written_on(old), date(2026, 9, 5))
        self.assertEqual(references.written_on(general_deal(date="٥ سبتمبر ٢٠٢٦")), date(2026, 9, 5))

    def test_a_placeholder_fails_because_the_drafter_would_copy_it(self):
        deal = general_deal()
        deal["roi"]["target_projects_month"] = "FILL"
        self.assertEqual(references.Verdict("x", "general", references.problems_in(deal, TEST_OFFER)).checks,
                         ["placeholders"])

    def test_an_old_price_fails_although_the_validator_only_warns(self):
        deal = general_deal()
        deal["investment"]["rows"][0]["amount"] = "USD 5,000"
        deal["investment"]["rows"][1]["amount"] = "USD 5,000"
        # The total is left at what is paid at the start: a total that is not
        # the first payment fails the validator outright (5 October 2026).
        self.assertFalse(failed(deal, "offer"))
        self.assertIn("offer", references.Verdict("x", "general", references.problems_in(deal, TEST_OFFER)).checks)

    def test_every_file_in_the_folder_gets_a_verdict(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(Path(tmp), "general.json", general_deal())
            write(Path(tmp), "specific.json", faulty(specific_deal()))
            write(Path(tmp), "broken.json", "{ not json")
            got = {v.file: v for v in references.check(Path(tmp), TEST_OFFER)}
            self.assertEqual(sorted(got), ["broken.json", "general.json", "specific.json"])
            self.assertTrue(got["general.json"].ok)
            self.assertEqual(got["specific.json"].checks, ["offer", "guarantee"])
            self.assertEqual((got["broken.json"].variant, got["broken.json"].checks), ("unreadable", ["read"]))
            self.assertEqual(references.check(Path(tmp) / "none", TEST_OFFER), [])

    def test_the_doctor_line_names_files_and_checks_and_never_the_client(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(Path(tmp), "general.json", faulty(general_deal()))
            ok, line = references.doctor_row(Path(tmp), TEST_OFFER)
            self.assertIs(ok, False)
            self.assertIn("general.json (general) breaks today's rules: offer, guarantee", line)
            self.assertIn("replace it with a corrected copy", line)
            self.assertIn("no specific or blind reference, so those drafts copy general.json's shape", line)
            self.assertNotIn("Mirage Test Contracting", line)
            self.assertNotIn("3,000", line)
            self.assertNotIn("—", line)
            write(Path(tmp), "general.json", general_deal())
            write(Path(tmp), "specific.json", specific_deal())
            ok, line = references.doctor_row(Path(tmp), TEST_OFFER)
            self.assertIs(ok, True)
            self.assertIn("general.json (general), specific.json (specific) pass today's rules", line)
            self.assertIn("no blind reference", line)
        ok, line = references.doctor_row(Path(tmp) / "gone", TEST_OFFER)
        self.assertIsNone(ok)
        self.assertIn("extract_reference.py makes one", line)

    def test_doctor_shows_a_broken_reference_without_blocking(self):
        spec = importlib.util.spec_from_file_location("desk_cli_refs", ROOT / "desk.py")
        cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cli)
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"SALES_DESK_HOME": tmp}):
            os.environ.pop("SALES_MODEL_PROVIDER", None)
            os.environ.pop("SALES_REFERENCE_DIR", None)
            write(Path(tmp) / "reference", "general.json", faulty(general_deal()))
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                cli.main(["doctor", "--offline"])
        out = buf.getvalue()
        line = next(x for x in out.splitlines() if "reference deals" in x)
        self.assertTrue(line.startswith("-- "), line)
        self.assertIn("general.json (general) breaks today's rules", line)
        self.assertNotIn("breaks today's rules", out.split("blocked:")[-1] if "blocked:" in out else "")


class MissedFormTests(unittest.TestCase):
    """The three forms the reference used that the validator let through."""

    def test_the_second_instalment_by_amount_is_a_split(self):
        deal = general_deal()
        deal["terms"] = deal["terms"] + ["The second USD 3,000 falls due when your first contract signs."]
        self.assertTrue(failed(deal, "offer"))
        # Under two payments it fails too since 5 October 2026, for tying the
        # second payment to the first contract: payments fall due on dates.
        self.assertTrue(any("first contract" in r["detail"] for r in rows(deal, {"payment": "two_payments"})["offer"]))

    def test_continuing_at_no_further_fee_is_free_work_even_with_the_guarantee(self):
        deal = general_deal()
        deal["terms"] = deal["terms"] + [
            "Thirty qualified meetings across the term, or we continue at no further fee until you have them."]
        self.assertTrue(failed(deal, "guarantee"))
        self.assertTrue(failed(deal, "guarantee", {"guarantee": True}))
        self.assertIn("promises results", rows(deal, {"guarantee": True})["guarantee"][0]["detail"])

    def test_meetings_then_guaranteed_is_a_result_promised(self):
        deal = general_deal()
        deal["solution_targets"][0] = {"v": "30", "k": "Qualified meetings across the three months, guaranteed"}
        self.assertTrue(failed(deal, "guarantee"))
        self.assertTrue(failed(deal, "guarantee", {"guarantee": True}))

    def test_the_same_lines_in_an_arabic_draft(self):
        for line in ("ثلاثون اجتماعًا مؤهَّلاً خلال الثلاثة شهور، أو نستمر دون رسوم إضافية حتى تكتمل.",
                     "اجتماع مؤهَّل خلال الثلاثة شهور، مضمونة",
                     "Qualified showroom visits across the three months, guaranteed"):
            self.assertTrue(validate.promises_results(validate._plain(line)), line)
        self.assertFalse(validate.promises_results(validate._plain("اجتماع مؤهَّل خلال الثلاثة شهور، وهو الهدف")))

    def test_what_still_passes(self):
        for line in ("Thirty qualified meetings across the term is the target we work to, not a promise.",
                     "Meetings are not guaranteed, and nothing here says otherwise.",
                     "The program fee is paid in full at the start, and the USD 500 deposit comes off it.",
                     "We continue to report every week, and the ad account stays yours."):
            self.assertFalse(validate.promises_results(line), line)
        deal = general_deal()
        deal["terms"] = deal["terms"] + ["The program fee is paid in full at the start, and the USD 500 deposit "
                                         "comes off it."]
        self.assertFalse(failed(deal, "offer"))


class ArithmeticGapTests(unittest.TestCase):
    """A margin-mode reference (B2B's 175209069) shows the drafter one project
    value. For a call that never gave one, the drafter writes FILL there, and
    the check used to divide by it and crash."""

    def margin(self, value) -> dict:
        deal = general_deal()
        deal["arithmetic"] = {k: v for k, v in deal["arithmetic"].items() if k != "project_values"}
        deal["arithmetic"].update(mode="margin", project_value=value)
        return deal

    def run_check(self, deal: dict) -> validate.Result:
        return validate.validate(deal, None, resolved=offer.resolve(TEST_OFFER), offer=TEST_OFFER,
                                 today=date(2099, 1, 1))

    def test_a_fill_waits_for_the_closer_instead_of_crashing(self):
        res = self.run_check(self.margin("FILL"))
        row = next(r for r in res.rows if r["check"] == "arithmetic")
        self.assertEqual((row["status"], row["send"]), (validate.WARN, validate.FAIL))
        self.assertIn("arithmetic.project_value, still FILL", row["detail"])
        self.assertEqual(res.status(), "needs_input")
        self.assertIn("arithmetic.project_value", res.fill_fields)
        # The template draws no page for Number("FILL"), so none is expected.
        self.assertEqual(validate.expected_sheets(self.margin("FILL")), 6)

    def test_the_filled_figure_computes(self):
        res = self.run_check(self.margin(1000000))
        self.assertEqual(next(r for r in res.rows if r["check"] == "arithmetic")["status"], validate.PASS)
        self.assertEqual(validate.expected_sheets(self.margin(1000000)), 7)

    def test_words_where_a_figure_belongs_fail_the_draft(self):
        for value in ("1,000,000", "about a million"):
            res = self.run_check(self.margin(value))
            row = next(r for r in res.rows if r["check"] == "arithmetic")
            self.assertEqual(row["status"], validate.FAIL, value)
            self.assertIn("digits only", row["detail"])

    def test_a_fill_in_the_grid_is_a_gap_too(self):
        deal = general_deal()
        deal["arithmetic"]["project_values"] = [200000, "FILL", 1000000]
        row = next(r for r in self.run_check(deal).rows if r["check"] == "arithmetic")
        self.assertEqual(row["status"], validate.WARN)
        self.assertIn("arithmetic.project_values[1]", row["detail"])

    def test_the_sheet_count_follows_the_template_mode_by_mode(self):
        deal = general_deal()
        deal["arithmetic"] = {"mode": "threshold", "margins": [10, 20], "currency": "SAR"}
        self.assertEqual(validate.expected_sheets(deal), 7)
        deal["arithmetic"] = {"project_value": 450000, "currency": "SAR"}   # no mode: renderDoc draws nothing
        self.assertEqual(validate.expected_sheets(deal), 6)


def page(sheets: int, over: int = 0) -> str:
    """A rendered page the way check_render reads one: sheets, some overflowing."""
    return ('<section class="sheet over"></section>' * over
            + '<section class="sheet"></section>' * (sheets - over))


class RenderedReferenceTests(unittest.TestCase):
    """Online, doctor renders each reference as validate --send does. On
    5 October 2026 B2B's 180273419, its offer lines corrected, passed every
    rule and still overflowed a sheet under today's template."""

    def test_a_reference_that_overflows_a_sheet_breaks_the_rules(self):
        deal = general_deal()
        n = validate.expected_sheets(deal)
        self.assertEqual(references.problems_in(deal, TEST_OFFER, page(n)), [])
        problems = references.problems_in(deal, TEST_OFFER, page(n, over=1))
        self.assertEqual([p.split(":", 1)[0] for p in problems], ["render"])
        self.assertIn("overflow A4", problems[0])
        self.assertIn("render", references.problems_in(deal, TEST_OFFER, page(n - 1))[0])

    def test_each_file_is_rendered_and_says_so(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(Path(tmp), "general.json", general_deal())
            write(Path(tmp), "specific.json", specific_deal())
            seen = []

            def fits(deal):
                seen.append(references.variant_of(deal))
                return page(validate.expected_sheets(deal))

            got = references.check(Path(tmp), TEST_OFFER, fits)
            self.assertEqual(seen, ["general", "specific"])
            self.assertTrue(all(v.ok and v.rendered for v in got))
            ok, line = references.doctor_row(Path(tmp), TEST_OFFER, fits)
            self.assertIs(ok, True)
            self.assertIn("general.json (general), specific.json (specific) pass today's rules, and fit A4 when "
                          "rendered", line)

            ok, line = references.doctor_row(Path(tmp), TEST_OFFER,
                                              lambda deal: page(validate.expected_sheets(deal), over=1))
            self.assertIs(ok, False)
            self.assertIn("general.json (general) breaks today's rules: render", line)
            self.assertIn("specific.json (specific) breaks today's rules: render", line)

    def test_unrendered_pages_are_said_to_be_unchecked(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(Path(tmp), "general.json", general_deal())
            ok, line = references.doctor_row(Path(tmp), TEST_OFFER)
            self.assertIs(ok, True)
            self.assertIn("pages not rendered here: doctor without --offline renders them", line)

            def broken(_deal):
                raise RuntimeError("the browser died")

            got = references.check(Path(tmp), TEST_OFFER, broken)
            self.assertTrue(got[0].ok)
            self.assertFalse(got[0].rendered)
            ok, line = references.doctor_row(Path(tmp), TEST_OFFER, lambda _deal: None)
            self.assertIs(ok, True)
            self.assertIn("the browser could not render general.json, so overflow there is unchecked", line)
            self.assertNotIn("—", line)

    def test_doctor_renders_a_reference_through_the_template(self):
        spec = importlib.util.spec_from_file_location("desk_cli_refs_dom", ROOT / "desk.py")
        cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cli)
        built = {}

        def dom(html_path):
            built["html"] = Path(html_path).read_text(encoding="utf-8")
            return page(7)

        with mock.patch.object(cli.render_mod, "dom", dom):
            self.assertEqual(cli._reference_dom(general_deal()), page(7))
        self.assertIn("const PROPOSAL = ", built["html"])
        self.assertIn('"variant": "general"', built["html"])


class ShapeDateTests(unittest.TestCase):
    def test_the_drafter_is_given_todays_date_not_the_references(self):
        ref = general_deal(date="5 September 2026", valid_until="30 September 2026")
        shape = prompt.shape_of(ref, today=date(2026, 10, 4))
        self.assertIn("4 October 2026", shape["date"])
        self.assertIn("18 October 2026", shape["valid_until"])
        text = json.dumps(shape)
        self.assertNotIn("September", text)
        self.assertNotIn("FILL", shape["date"] + shape["valid_until"])
        # system_for reads the clock: today's date, whatever day the tests run.
        self.assertIn(prompt.day_words(date.today()), prompt.system_for(
            "general", offer.resolve(TEST_OFFER), TEST_OFFER, ref,
            {"file": "general.json", "variant": "general", "matched": True}))

    def test_the_outline_carries_todays_date_too(self):
        out = json.loads(prompt.outline(offer.resolve(TEST_OFFER), today=date(2026, 10, 4)))
        self.assertIn("4 October 2026", out["date"])
        self.assertIn("18 October 2026", out["valid_until"])


@unittest.skipUnless(LIVE.is_dir() and any(LIVE.glob("*.json")),
                     f"no reference deals in {LIVE}; they live on the VPS only")
class LiveReferenceTests(unittest.TestCase):
    def test_every_reference_on_this_machine_passes_todays_rules(self):
        bad = [f"{v.file} ({v.variant}): {', '.join(v.checks)}" for v in references.check(LIVE) if not v.ok]
        self.assertEqual(bad, [], "a reference breaks today's rules, and every draft copies it; "
                                  "python3 desk.py validate FILE --send names each field")


if __name__ == "__main__":
    unittest.main()
