"""The waves 1-2 forms and billing checks (docs/forms/WAVE12-CONTRACT.md 6.2): each reads "not set up yet" as ok,
never as zero, and turns warn or fail by its own rule."""
import tempfile
import unittest
from pathlib import Path

import checks as checks_mod
from checks import forms_billing as fb
from guard.context import Context
from tests import fakes

NOT_THERE = ("cockpit_extensions_v", "cockpit_settings", "cockpit_form_responses", "cockpit_churn_departures",
             "cockpit_manual_payments", "cockpit_clickup_writeback_queue")


def ctx(tables=None, missing=()):
    return Context(fakes.config(Path(tempfile.gettempdir()) / "guardian-forms-billing-test"),
                   fakes.FakeDb(tables or {}, missing=missing), None, now=fakes.NOW)


def state(key, minutes=10, ok=True, note="", **detail):
    return dict(key=key, ok=ok, note=note, detail=detail or None, last_run_at=fakes.ago(minutes), last_ok_at=fakes.ago(minutes))


ALL = (fb.run_writeback, fb.run_doctor, fb.run_daily, fb.run_doors, fb.run_unmatched, fb.run_register,
       fb.run_extensions, fb.run_mrr, fb.run_checks)


class Registered(unittest.TestCase):
    def test_the_nine_checks_are_registered_after_task_assignments(self):
        ids = [c.id for c in checks_mod.all_checks("native")]
        mine = ["billing-writeback", "billing-doctor", "billing-daily", "forms-door-exit", "notice-unmatched",
                "register-vs-card", "extension-vs-card", "mrr-differs", "checks-waiting"]
        for i in mine:
            self.assertIn(i, ids)
        self.assertGreater(ids.index("billing-writeback"), ids.index("video-review-flow"))


class NotSetUpYet(unittest.TestCase):
    def test_before_the_deploy_every_check_reads_ok_and_says_why(self):
        c = ctx({"cockpit_sync_state": [], "cockpit_billing_accounts": []}, missing=NOT_THERE)
        for run in ALL:
            with self.subTest(check=run.__name__):
                r = run(c)
                self.assertEqual(r.status, "ok", r.summary)
                self.assertNotIn(" 0 ", f" {r.summary} ")
        self.assertIn("Not set up yet", fb.run_writeback(c).summary)
        self.assertIn("Not set up yet", fb.run_extensions(c).summary)


class Writeback(unittest.TestCase):
    def tables(self, held=0, items=()):
        return {"cockpit_sync_state": [state("clickup-writeback:billing", mode="apply_limited", kinds=["churn"], heldOpenKind=held)],
                "cockpit_clickup_writeback_queue": list(items)}

    def item(self, state_, minutes, kind="churn"):
        return dict(id=f"i-{state_}-{minutes}", kind="billing", state=state_, task_id="86eywg1cq", updated_at=fakes.ago(minutes),
                    error="ClickUp refused the field (400).", payload={"kind": kind})

    def test_clean(self):
        self.assertEqual(fb.run_writeback(ctx(self.tables())).status, "ok")

    def test_a_held_edit_of_an_open_kind_warns_with_the_review_sentence(self):
        r = fb.run_writeback(ctx(self.tables(held=2)))
        self.assertEqual(r.status, "warn")
        self.assertIn("2 held edits of an open kind wait for the review: release or close each one", r.summary)

    def test_a_retrying_item_older_than_30_minutes_fails_a_younger_one_does_not(self):
        self.assertEqual(fb.run_writeback(ctx(self.tables(items=[self.item("retry", 20)]))).status, "ok")
        for s in ("retry", "unknown", "failed"):
            r = fb.run_writeback(ctx(self.tables(items=[self.item(s, 45)])))
            self.assertEqual(r.status, "fail", s)
            self.assertIn("churn", r.summary)

    def test_an_unread_held_count_is_not_zero(self):
        r = fb.run_writeback(ctx({"cockpit_sync_state": [state("clickup-writeback:billing", mode="dry_run", kinds=[], heldOpenKind=None)],
                                  "cockpit_clickup_writeback_queue": []}))
        self.assertEqual(r.status, "ok")
        self.assertIn("could not be read", r.summary)


class Doctor(unittest.TestCase):
    def test_gap_warns_old_read_fails(self):
        gap = "The will-not-continue checkbox (9cfdb353) is not on Clients - Mahara, so it was not written."
        self.assertEqual(fb.run_doctor(ctx({"cockpit_sync_state": [state("clickup-writeback:billing-doctor", gaps=[])]})).status, "ok")
        r = fb.run_doctor(ctx({"cockpit_sync_state": [state("clickup-writeback:billing-doctor", gaps=[gap])]}))
        self.assertEqual(r.status, "warn")
        self.assertIn("9cfdb353", r.summary)
        self.assertEqual(fb.run_doctor(ctx({"cockpit_sync_state": [state("clickup-writeback:billing-doctor", minutes=27 * 60, gaps=[])]})).status, "fail")


class Daily(unittest.TestCase):
    def test_off_is_ok_on_and_stale_fails(self):
        off = {"cockpit_settings": [dict(key="billing.daily", value={"on": False})], "cockpit_sync_state": []}
        self.assertEqual(fb.run_daily(ctx(off)).status, "ok")
        on = {"cockpit_settings": [dict(key="billing.daily", value={"on": True})]}
        self.assertEqual(fb.run_daily(ctx({**on, "cockpit_sync_state": [state("billing-daily", minutes=60, note="0 cleared")]})).status, "ok")
        self.assertEqual(fb.run_daily(ctx({**on, "cockpit_sync_state": [state("billing-daily", minutes=27 * 60)]})).status, "fail")
        self.assertEqual(fb.run_daily(ctx({**on, "cockpit_sync_state": []})).status, "fail")


class Doors(unittest.TestCase):
    def door(self, form, days, outcome="stored", registered=True):
        return state(f"forms-door:{form}", minutes=days * 1440, registered=registered, outcome=outcome,
                     lastDelivery=fakes.ago(days * 1440))

    def test_both_forms_are_read_quiet_warns_failed_fails(self):
        self.assertEqual(fb.run_doors(ctx({"cockpit_sync_state": [self.door("exit_survey", 2), self.door("pause_request", 3)]})).status, "ok")
        quiet = fb.run_doors(ctx({"cockpit_sync_state": [self.door("exit_survey", 2), self.door("pause_request", 22)]}))
        self.assertEqual(quiet.status, "warn")
        self.assertIn("pause request", quiet.summary)
        self.assertIn("A quiet form is normal", quiet.summary)
        failed = fb.run_doors(ctx({"cockpit_sync_state": [self.door("exit_survey", 1, outcome="failed")]}))
        self.assertEqual(failed.status, "fail")
        self.assertIn("termination survey", failed.summary)

    def test_an_unregistered_door_is_not_set_up(self):
        r = fb.run_doors(ctx({"cockpit_sync_state": [self.door("exit_survey", 40, registered=False)]}))
        self.assertEqual(r.status, "ok")
        self.assertIn("Not set up yet", r.summary)


class Unmatched(unittest.TestCase):
    def row(self, i, days, form="exit_survey", task=None, answered=False, name="Invented Contracting"):
        return dict(id=f"r{i}", form_key=form, state="legacy", task_id=task, hidden={"client_name": name},
                    answer_meta={"answered": {"answer": "staying"}} if answered else {}, submitted_at=fakes.ago(days * 1440))

    def test_two_days_unmatched_warns_with_the_form_name_matched_or_answered_do_not(self):
        r = fb.run_unmatched(ctx({"cockpit_form_responses": [self.row(1, 3)]}))
        self.assertEqual(r.status, "warn")
        self.assertEqual(r.summary, "A termination survey from Invented Contracting is not matched to a card: a CSM picks the card on the churn tracker.")
        p = fb.run_unmatched(ctx({"cockpit_form_responses": [self.row(2, 3, form="pause_request", name="")]}))
        self.assertIn("A pause request from a client who gave no name", p.summary)
        for rows in ([self.row(3, 1)], [self.row(4, 5, task="86eyjkdc8")], [self.row(5, 5, answered=True)]):
            self.assertEqual(fb.run_unmatched(ctx({"cockpit_form_responses": rows})).status, "ok")


class Register(unittest.TestCase):
    def tables(self, status="Stopped", churn_date="2026-10-01", delivered_min=180):
        return {
            "cockpit_churn_departures": [dict(id=20, client="Atlantis", clickup_task_id="86eyjkdc8", left_on="2026-10-01",
                                              confirmed_at=fakes.ago(300), billing_event_id=900, removed_at=None)],
            "cockpit_clickup_writeback_queue": [dict(kind="billing", source_id="900", state="delivered", delivered_at=fakes.ago(delivered_min))],
            "cockpit_billing_accounts": [dict(clickup_task_id="86eyjkdc8", client_status=status, churn_date=churn_date)],
        }

    def test_card_matches(self):
        self.assertEqual(fb.run_register(ctx(self.tables())).status, "ok")

    def test_not_stopped_or_a_moved_churn_date_warns_two_hours_after_delivery(self):
        r = fb.run_register(ctx(self.tables(status="Paused")))
        self.assertEqual(r.status, "warn")
        self.assertIn("not Stopped", r.summary)
        d = fb.run_register(ctx(self.tables(churn_date="2026-10-03")))
        self.assertEqual(d.status, "warn")
        self.assertIn("Churn Date reads 2026-10-03, the register 2026-10-01", d.summary)
        self.assertEqual(fb.run_register(ctx(self.tables(status="Paused", delivered_min=60))).status, "ok")


class Extensions(unittest.TestCase):
    def tables(self, weeks_card=2, granted_min=2 * 1440, daily=False, extra_card=None):
        cards = [dict(clickup_task_id="86ewvnqj5", client_name="Liwan", extension_weeks=weeks_card)]
        if extra_card:
            cards.append(extra_card)
        return {"cockpit_extensions_v": [dict(grant_id=1, clickup_task_id="86ewvnqj5", client_name="Liwan", granted_at=fakes.ago(granted_min),
                                              weeks=2, until="2026-10-17", state="live")],
                "cockpit_billing_accounts": cards,
                "cockpit_settings": [dict(key="billing.daily", value={"on": daily})]}

    def test_match_mismatch_and_the_grace_day(self):
        self.assertEqual(fb.run_extensions(ctx(self.tables())).status, "ok")
        r = fb.run_extensions(ctx(self.tables(weeks_card=None)))
        self.assertEqual(r.status, "warn")
        self.assertIn("the grant says 2 weeks, the card nothing", r.summary)
        self.assertEqual(fb.run_extensions(ctx(self.tables(weeks_card=None, granted_min=60))).status, "ok")

    def test_weeks_left_on_a_card_with_no_grant_warn_only_while_the_daily_step_is_on(self):
        stale = dict(clickup_task_id="86eymcqdq", client_name="Marble", extension_weeks=2)
        self.assertEqual(fb.run_extensions(ctx(self.tables(extra_card=stale))).status, "ok")
        r = fb.run_extensions(ctx(self.tables(extra_card=stale, daily=True)))
        self.assertEqual(r.status, "warn")
        self.assertIn("Marble: the card still reads 2 weeks with no grant running", r.summary)


class Mrr(unittest.TestCase):
    def tables(self, mrr=2000, sugg=2000, rail=None, money_min=60):
        payload = {"mrrCheck": {"rows": [{"taskId": "86ewvnqgz", "railMonthlyUsd": rail}] if rail is not None else []}}
        return {"cockpit_settings": [dict(key="billing.mrr_tolerance", value={"pct": 10})],
                "cockpit_billing_accounts": [
                    dict(clickup_task_id="86ewvnqgz", client_name="Safad", client_status="Active", payment_plan="Monthly", mrr_usd=mrr, next_payment_usd=sugg),
                    dict(clickup_task_id="86eother1", client_name="PIF", client_status="Active", payment_plan="Paid in full (90 days)", mrr_usd=9999, next_payment_usd=1),
                    dict(clickup_task_id="86eother2", client_name="No MRR", client_status="Active", payment_plan="Monthly", mrr_usd=None, next_payment_usd=700)],
                "cockpit_sections": [dict(key="money", ok=True, error=None, computed_at=fakes.ago(money_min), payload=payload)]}

    def test_within_tolerance_is_ok_and_a_missing_mrr_is_counted_apart_never_zero(self):
        r = fb.run_mrr(ctx(self.tables(rail=1900)))
        self.assertEqual(r.status, "ok")
        self.assertEqual(r.evidence, {"differ": 0, "missing": 1})

    def test_differs_from_the_suggestion_or_the_money_in_warns(self):
        s = fb.run_mrr(ctx(self.tables(sugg=1300)))
        self.assertEqual(s.status, "warn")
        self.assertIn("Safad: card $2,000, suggested $1,300", s.summary)
        m = fb.run_mrr(ctx(self.tables(rail=1500)))
        self.assertIn("Safad: card $2,000, money in $1,500", m.summary)

    def test_a_stale_money_refresh_does_not_compare_rail_cash_and_says_so(self):
        r = fb.run_mrr(ctx(self.tables(rail=1500, money_min=40 * 60)))
        self.assertEqual(r.status, "ok")
        self.assertIn("Rail cash was not compared", r.summary)

    def test_two_days_running_is_the_checks_own_confirm(self):
        check = next(c for c in fb.CHECKS if c.id == "mrr-differs")
        self.assertEqual(check.confirm_minutes, 2 * 24 * 60)


class ChecksWaiting(unittest.TestCase):
    def test_a_logged_row_older_than_a_week_warns(self):
        rows = [dict(id="a", client_name="Alalia", amount_usd=3494.88, added_at=fakes.ago(8 * 1440), check_state="logged", deleted_at=None),
                dict(id="b", client_name="Recent", amount_usd=100, added_at=fakes.ago(1440), check_state="logged", deleted_at=None)]
        r = fb.run_checks(ctx({"cockpit_manual_payments": rows}))
        self.assertEqual(r.status, "warn")
        self.assertIn("1 hand-logged payment has waited over 7 days", r.summary)
        self.assertIn("Alalia", r.summary)
        self.assertEqual(fb.run_checks(ctx({"cockpit_manual_payments": rows[1:]})).status, "ok")


if __name__ == "__main__":
    unittest.main()
