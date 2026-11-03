"""The kickoff items check (docs/forms/WAVE56-CONTRACT.md 4.20; 20261103d): it reads the doctor's view (never a seat
RPC), says "not set up yet" as ok and never as zero (only when the error is about the view itself), passes on the
doctor's own sentences, warns on a problem and fails when Yes can no longer reach the submit or the doctor itself cannot
run. Invented counts; the doctor holds no client data."""
import tempfile
import unittest
from pathlib import Path

import checks as checks_mod
from checks import kickoff_items as ki
from guard.context import Context, SourceError
from guard.db import _read_error
from guard.engine import run_checks
from tests import fakes

VIEW = "cockpit_kickoff_items_doctor_v"
ON = ["funded_card", "mahara_os", "whatsapp_sync"]
TYPE_OFF = ("WhatsApp sync: WhatsApp connection issue is turned off in Requests settings, so the item shows as turned off. "
            "Turn the type on, or turn the item off.")
OPTION = ("Mahara OS access: the kickoff no longer asks \"Mahara OS Access Status\" with the answer Tech Issue, so the item "
          "is never offered. Update the item list (20261103d's catalogue).")
SUBMIT = ("cockpit_request_submit no longer has the 8 arguments or the client_page source that Yes calls, so Yes fails. "
          "Re-read it and fix 20261103d on a branch.")
SETTING_MISSING = ("forms.kickoff_items: the setting is missing, so every kickoff item is off. Set it with "
                   "cockpit_kickoff_items_switch: the items to keep on, or {} to stop them all.")
SETTING_BAD = ("forms.kickoff_items: the setting is not a list of items, so every kickoff item is off. Set it with "
               "cockpit_kickoff_items_switch: the items to keep on, or {} to stop them all.")


def report(problems=(), notes=(), on=ON, offered=5, cards=3, **extra):
    rep = {"ok": not problems, "problems": list(problems), "notes": list(notes), "on": list(on),
           "counts": {"cards": cards, "offered": offered, "typeOff": 0, "reopened": 0, "raised": 0, "declined": 0,
                      "oldestUndecidedDays": 30},
           "checkedAt": fakes.ago(1)}
    rep.update(extra)
    return {VIEW: [{"report": rep}]}


def ctx_for(db):
    return Context(fakes.config(Path(tempfile.gettempdir()) / "guardian-kickoff-items-test"), db, None, now=fakes.NOW)


def run(tables=None, missing=()):
    db = fakes.FakeDb(tables or {}, missing=missing)
    return ki.run_doctor(ctx_for(db)), db


class Answers(fakes.FakeDb):
    """The view read answers an error, built the way guard.db builds it from PostgREST's status and body."""

    def __init__(self, status, body):
        super().__init__({})
        self.error = _read_error(VIEW, status, body)

    def rows(self, table, select="*", where=(), order=None, limit=None):
        self._guard()
        self.reads.append(table)
        raise self.error


def run_error(status, body):
    db = Answers(status, body)
    return ki.run_doctor(ctx_for(db)), db


# PostgREST's bodies (invented values, real shapes). 42883 and 42703 come from inside the doctor at read time.
FN_GONE = ('{"code":"42883","details":null,"hint":"No function matches the given name and argument types. You might '
           'need to add explicit type casts.","message":"function public.cockpit_form_stage4_fields(unknown) does not exist"}')
COLUMN_GONE = '{"code":"42703","details":null,"hint":null,"message":"column r.import_left_at does not exist"}'
OTHER_RELATION = '{"code":"42P01","details":null,"hint":null,"message":"relation \\"public.cockpit_request_types\\" does not exist"}'
VIEW_RELATION = '{"code":"42P01","details":null,"hint":null,"message":"relation \\"public.cockpit_kickoff_items_doctor_v\\" does not exist"}'
VIEW_NOT_CACHED = ('{"code":"PGRST205","details":null,"hint":"Perhaps you meant the table \'public.cockpit_kickoff_item_answers\'",'
                   '"message":"Could not find the table \'public.cockpit_kickoff_items_doctor_v\' in the schema cache"}')
NO_GRANT = '{"code":"42501","details":null,"hint":null,"message":"permission denied for view cockpit_kickoff_items_doctor_v"}'


class Registered(unittest.TestCase):
    def test_the_check_is_in_the_scan_after_the_waves_5_6_checks_with_its_fields(self):
        ids = [c.id for c in checks_mod.all_checks("native")]
        self.assertIn("kickoff-items", ids)
        self.assertGreater(ids.index("kickoff-items"), ids.index("relay"))
        c = checks_mod.by_id()["kickoff-items"]
        self.assertEqual((c.area, c.severity, c.owner, c.confirm, c.clear), ("data", "medium", "the systems manager", 1, 1))
        self.assertIn(VIEW, c.reads)
        self.assertIn("RUNBOOK.md, Kickoff items as requests", c.action)


class NotSetUpYet(unittest.TestCase):
    def test_before_the_deploy_it_reads_ok_and_says_why_never_zero(self):
        r, db = run({}, missing=(VIEW,))
        self.assertEqual(r.status, "ok", r.summary)
        self.assertIn("Not set up yet", r.summary)
        self.assertNotIn(" 0 ", f" {r.summary} ")
        self.assertEqual(db.reads, [VIEW])

    def test_only_an_error_about_the_view_itself_reads_as_not_set_up_yet(self):
        for status, body in ((404, VIEW_NOT_CACHED), (404, VIEW_RELATION)):
            r, _ = run_error(status, body)
            self.assertEqual((r.status, r.summary), ("ok", "Not set up yet: kickoff items as requests are not deployed (20261103d)."),
                             body)

    def test_an_empty_answer_warns_that_it_could_not_be_read(self):
        r, _ = run({VIEW: []})
        self.assertEqual(r.status, "warn")
        self.assertIn("answered no report", r.summary)
        r, _ = run({VIEW: [{"report": "not an object"}]})
        self.assertEqual(r.status, "warn")


class Readings(unittest.TestCase):
    def test_ok_says_how_many_items_are_on_and_how_many_wait(self):
        r, _ = run(report())
        self.assertEqual(r.status, "ok")
        self.assertEqual(r.summary, "3 kickoff items on, each raisable in one tap. 5 items on 3 cards wait for a Yes or No.")
        r, _ = run(report(offered=0, cards=0))
        self.assertEqual(r.summary, "3 kickoff items on, each raisable in one tap. No kickoff item waits for a Yes or No.")
        r, _ = run(report(offered=1, cards=1, notes=["A note from the doctor."]))
        self.assertEqual(r.summary, "3 kickoff items on, each raisable in one tap. 1 item on 1 card waits for a Yes or No. "
                                    "A note from the doctor.")

    def test_every_item_off_is_said_not_counted(self):
        r, _ = run(report(on=[], notes=["Every kickoff item is off (forms.kickoff_items), so none is offered."]))
        self.assertEqual((r.status, r.summary), ("ok", "Every kickoff item is turned off (forms.kickoff_items), so none is offered."))

    def test_missing_counts_are_never_zero(self):
        rows = report()
        rows[VIEW][0]["report"]["counts"] = {}
        r, _ = run(rows)
        self.assertEqual(r.status, "warn")
        self.assertIn("gave no counts", r.summary)

    def test_a_problem_warns_in_the_doctors_own_words_and_names_the_items(self):
        r, _ = run(report(problems=[TYPE_OFF, OPTION]))
        self.assertEqual(r.status, "warn")
        self.assertEqual(r.summary, f"{TYPE_OFF} {OPTION}")
        self.assertEqual(r.items, ["WhatsApp sync", "Mahara OS access"])

    def test_a_submit_yes_cannot_reach_fails(self):
        r, _ = run(report(problems=[TYPE_OFF, SUBMIT]))
        self.assertEqual(r.status, "fail")
        self.assertEqual(r.items, ["WhatsApp sync", "submit"])
        self.assertIn("Yes fails", r.summary)

    def test_a_missing_or_malformed_switch_warns_every_item_off_never_ok(self):
        # The switch fails closed (20261103d): the doctor answers on [] with the setting as a problem.
        for sentence in (SETTING_MISSING, SETTING_BAD):
            r, _ = run(report(problems=[sentence], on=[], offered=0, cards=0))
            self.assertEqual(r.status, "warn", sentence)
            self.assertEqual(r.summary, sentence)
            self.assertEqual(r.items, ["forms.kickoff_items"])
        r, _ = run(report(problems=[SETTING_BAD, SUBMIT], on=[]))
        self.assertEqual((r.status, r.items), ("fail", ["forms.kickoff_items", "submit"]))


class DoctorCannotRun(unittest.TestCase):
    """Once the view is there, an error from inside the doctor is a fail with its sentence, never "Not set up yet"."""

    def test_a_function_the_doctor_calls_gone_fails_and_is_never_ok(self):
        r, db = run_error(404, FN_GONE)
        self.assertEqual(r.status, "fail", r.summary)
        self.assertNotIn("Not set up yet", r.summary)
        self.assertTrue(r.summary.startswith("The kickoff items doctor could not run: "), r.summary)
        self.assertIn("could not run: function public.cockpit_form_stage4_fields(unknown)... (code 42883).", r.summary)
        self.assertIn("RUNBOOK.md, Kickoff items as requests", r.summary)
        self.assertEqual(r.items, ["doctor"])
        self.assertEqual(db.reads, [VIEW])

    def test_a_column_or_another_relation_gone_and_a_missing_grant_fail_too(self):
        for status, body, code in ((400, COLUMN_GONE, "42703"), (404, OTHER_RELATION, "42P01"), (403, NO_GRANT, "42501")):
            r, _ = run_error(status, body)
            self.assertEqual(r.status, "fail", body)
            self.assertIn(f"(code {code})", r.summary)
            self.assertNotIn("Not set up yet", r.summary)
        r, _ = run_error(404, OTHER_RELATION)
        self.assertIn('could not run: relation "public.cockpit_request_types" does not exist (code 42P01).', r.summary)

    def test_the_scan_reports_the_fail_not_could_not_be_checked(self):
        db = Answers(404, FN_GONE)
        [finding] = run_checks(ctx_for(db), [checks_mod.by_id()["kickoff-items"]])
        self.assertEqual(finding.result.status, "fail")

    def test_an_outage_is_still_could_not_be_checked_not_a_fail(self):
        db = fakes.FakeDb({}, down=True)
        with self.assertRaises(SourceError):
            ki.run_doctor(ctx_for(db))
        db = Answers(503, '{"message":"upstream timeout"}')
        with self.assertRaises(SourceError):
            ki.run_doctor(ctx_for(db))


if __name__ == "__main__":
    unittest.main()
