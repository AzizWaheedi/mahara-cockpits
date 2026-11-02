"""The waves 5-6 checks (docs/forms/WAVE56-CONTRACT.md 6.2): each reads "not set up yet" as ok, never as zero, reads
tables and views (never the seat RPCs or the owner-only functions), and turns warn or fail by its own rule. Invented
cards, clients and amounts. fakes.NOW is Saturday 3 Oct 2026, 17:00 Kuwait."""
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

import checks as checks_mod
from checks import wins_cash as wc
from guard.context import Context
from tests import fakes

NOT_THERE = ("cockpit_settings", "cockpit_sync_state", "cockpit_ltv_held", "cockpit_billing_events",
             "cockpit_clickup_writeback_queue", "cockpit_billing_accounts", "cockpit_manual_payments",
             "cockpit_payment_ties", "cockpit_client_payments", "cockpit_agent_keys", "cockpit_agent_calls",
             "cockpit_win_tie_proposals", "cockpit_csm_wins", "cockpit_csm_win_events", "cockpit_pay_proposal_decisions",
             "cockpit_payment_receipts", "cockpit_billing_inbox", "cockpit_retire_items_v", "cockpit_form_responses",
             "cockpit_forms", "cockpit_form_effects", "cockpit_form_relay_outbox")
ALL = (wc.run_ltv_daily, wc.run_ltv_drift, wc.run_ltv_second_source, wc.run_agent_separation, wc.run_win_ties,
       wc.run_win_unpaid, wc.run_pay_proposals, wc.run_receipts, wc.run_agent_door, wc.run_retire,
       wc.run_stage4_legacy, wc.run_stage4_effects, wc.run_relay)
MINE = ["ltv-daily", "ltv-drift", "ltv-second-source", "agent-separation", "win-ties-open", "win-unpaid-accepted",
        "pay-proposals", "receipts-unchecked", "agent-door", "retire-quiet", "stage4-legacy", "stage4-effects", "relay"]


def run(fn, tables=None, missing=()):
    db = fakes.FakeDb(tables or {}, missing=missing)
    c = Context(fakes.config(Path(tempfile.gettempdir()) / "guardian-wins-cash-test"), db, None, now=fakes.NOW)
    return fn(c)


def setting(key, value, minutes_ago=60 * 24 * 30):
    return {"key": key, "value": value, "updated_at": fakes.ago(minutes_ago)}


def day(days_ago):
    return (fakes.NOW + timedelta(hours=3) - timedelta(days=days_ago)).date().isoformat()


def ltv_event(eid, task, target, checked, baseline_day="2026-09-01", as_of=None):
    return {"id": eid, "clickup_task_id": task, "kind": "ltv", "source": "system", "to_value": str(target),
            "at": fakes.ago(60 * 24 * 3),
            "detail": {"sum": checked, "rows": 2, "as_of": as_of or day(3), "baseline": 1000, "baseline_day": baseline_day,
                       "checked_usd": checked}}


class Registered(unittest.TestCase):
    def test_the_thirteen_checks_are_registered_after_the_client_forms_checks(self):
        ids = [c.id for c in checks_mod.all_checks("native")]
        for i in MINE:
            self.assertIn(i, ids)
        self.assertGreater(ids.index("ltv-daily"), ids.index("forms-door-make"))
        self.assertEqual(len(wc.CHECKS), 13)


class NotSetUpYet(unittest.TestCase):
    def test_before_the_deploy_every_check_reads_ok_and_says_why_never_zero(self):
        for fn in ALL:
            with self.subTest(check=fn.__name__):
                r = run(fn, {}, missing=NOT_THERE)
                self.assertEqual(r.status, "ok", r.summary)
                self.assertNotIn(" 0 ", f" {r.summary} ")
                self.assertIn("Not set up yet", r.summary)

    def test_seeded_but_dark_every_check_is_ok_and_says_what_turns_it_on(self):
        tables = {"cockpit_settings": [setting("billing.ltv", {"on": False, "maxDeltaUsd": 5000}),
                                       setting("billing.agent", {"separated": False}),
                                       setting("pay.proposals", {"on": False}),
                                       setting("forms.stage4", {"kickoff": False, "onboarding": False})],
                  "cockpit_agent_keys": [], "cockpit_agent_calls": []}
        self.assertIn("off", run(wc.run_ltv_daily, tables).summary)
        self.assertIn("no login of its own yet", run(wc.run_agent_separation, tables).summary)
        self.assertIn("off", run(wc.run_pay_proposals, tables).summary)
        self.assertIn("Neither", run(wc.run_stage4_legacy, tables).summary)
        r = run(wc.run_agent_door, tables)
        self.assertEqual(r.status, "ok")
        self.assertIn("refuses everything", r.summary)


class LtvDaily(unittest.TestCase):
    on = setting("billing.ltv", {"on": True, "maxDeltaUsd": 5000})

    ltv_ok = {"key": "billing-ltv", "ok": True, "note": "LTV: 2 written, 0 held for the CEO, 4 missing a baseline.",
              "last_run_at": fakes.ago(60)}

    def test_on_and_no_run_in_26_hours_fails_and_a_fresh_run_is_ok(self):
        stale = {"key": "billing-daily", "ok": True, "note": "Ran.", "last_run_at": fakes.ago(27 * 60)}
        self.assertEqual(run(wc.run_ltv_daily, {"cockpit_settings": [self.on], "cockpit_sync_state": [stale, self.ltv_ok],
                                                "cockpit_ltv_held": []}).status, "fail")
        self.assertEqual(run(wc.run_ltv_daily, {"cockpit_settings": [self.on], "cockpit_sync_state": []}).status, "fail")
        fresh = {**stale, "last_run_at": fakes.ago(60), "note": "LTV: 2 written, 0 held for the CEO, 4 missing a baseline."}
        r = run(wc.run_ltv_daily, {"cockpit_settings": [self.on], "cockpit_sync_state": [fresh, self.ltv_ok],
                                   "cockpit_ltv_held": []})
        self.assertEqual(r.status, "ok")
        self.assertIn("LTV: 2 written", r.summary)

    def test_a_jump_held_more_than_3_days_warns(self):
        fresh = {"key": "billing-daily", "ok": True, "note": "Ran.", "last_run_at": fakes.ago(60)}
        held = [{"id": 1, "task_id": "taskA1", "first_held_on": day(4), "released_at": None},
                {"id": 2, "task_id": "taskB1", "first_held_on": day(1), "released_at": None}]
        r = run(wc.run_ltv_daily, {"cockpit_settings": [self.on], "cockpit_sync_state": [fresh, self.ltv_ok],
                                   "cockpit_ltv_held": held})
        self.assertEqual(r.status, "warn")
        self.assertEqual(r.items, ["taskA1"])

    # Pre-deploy review C10: the morning run catches an LTV error and still reports billing-daily ok, so the
    # writer's own row (billing-ltv) is what says whether lifetime value was written.
    def test_a_writer_error_or_refusal_fails_quoting_the_writer_note_though_the_morning_run_is_ok(self):
        daily = {"key": "billing-daily", "ok": True, "last_run_at": fakes.ago(60),
                 "note": "Ran for 2026-10-03: 0 extensions cleared, 0 late records opened, 0 closed. LTV: not written (error)."}
        for note in ("LTV: not written (error). division by zero",
                     "LTV: not written. The money section is older than a day; refresh it first."):
            with self.subTest(note=note):
                ltv = {"key": "billing-ltv", "ok": False, "note": note, "last_run_at": fakes.ago(60)}
                r = run(wc.run_ltv_daily, {"cockpit_settings": [self.on], "cockpit_sync_state": [daily, ltv],
                                           "cockpit_ltv_held": []})
                self.assertEqual(r.status, "fail", r.summary)
                self.assertIn(note, r.summary)

    def test_a_writer_row_missing_or_older_than_26_hours_fails_unless_the_writer_was_just_turned_on(self):
        daily = {"key": "billing-daily", "ok": True, "note": "Ran.", "last_run_at": fakes.ago(60)}
        r = run(wc.run_ltv_daily, {"cockpit_settings": [self.on], "cockpit_sync_state": [daily], "cockpit_ltv_held": []})
        self.assertEqual(r.status, "fail", r.summary)
        self.assertIn("billing-ltv", r.summary)
        old = {**self.ltv_ok, "last_run_at": fakes.ago(27 * 60), "note": "LTV: 1 written, 0 held for the CEO, 0 missing a baseline."}
        r = run(wc.run_ltv_daily, {"cockpit_settings": [self.on], "cockpit_sync_state": [daily, old], "cockpit_ltv_held": []})
        self.assertEqual(r.status, "fail", r.summary)
        self.assertIn("LTV: 1 written", r.summary)
        # Turned on two hours ago: the first writer run is still due, so no row yet (or an old one) is not a failure.
        just_on = setting("billing.ltv", {"on": True, "maxDeltaUsd": 5000}, minutes_ago=120)
        for rows in ([daily], [daily, old]):
            r = run(wc.run_ltv_daily, {"cockpit_settings": [just_on], "cockpit_sync_state": rows, "cockpit_ltv_held": []})
            self.assertEqual(r.status, "ok", r.summary)
            self.assertIn("first", r.summary)
        # A writer error is a failure even on the first morning.
        bad = {**self.ltv_ok, "ok": False, "note": "LTV: not written (error). boom"}
        r = run(wc.run_ltv_daily, {"cockpit_settings": [just_on], "cockpit_sync_state": [daily, bad], "cockpit_ltv_held": []})
        self.assertEqual(r.status, "fail", r.summary)


class LtvDrift(unittest.TestCase):
    def tables(self, shown, delivered_minutes):
        return {"cockpit_billing_events": [ltv_event(10, "taskA1", 4000, 3000)],
                "cockpit_clickup_writeback_queue": [{"dedupe_key": "billing:10", "state": "delivered",
                                                     "delivered_at": fakes.ago(delivered_minutes)}],
                "cockpit_billing_accounts": [{"clickup_task_id": "taskA1", "client_name": "Acme", "ltv_field_usd": shown}]}

    def test_a_card_that_differs_two_days_after_delivery_warns(self):
        r = run(wc.run_ltv_drift, self.tables(3500, 60 * 24 * 3))
        self.assertEqual(r.status, "warn")
        self.assertEqual(r.items, ["taskA1"])
        self.assertIn("1 card shows a different LTV than the cockpit wrote", r.summary)

    def test_the_same_value_or_a_fresh_delivery_is_ok_and_an_old_apply_event_is_not_read(self):
        self.assertEqual(run(wc.run_ltv_drift, self.tables(4000, 60 * 24 * 3)).status, "ok")
        self.assertEqual(run(wc.run_ltv_drift, self.tables(3500, 60 * 24)).status, "ok")
        apply = {"id": 9, "clickup_task_id": "taskA1", "kind": "ltv", "source": "system", "to_value": "1", "at": fakes.ago(9),
                 "detail": {"sum": 1}}
        r = run(wc.run_ltv_drift, {"cockpit_billing_events": [apply]})
        self.assertEqual(r.status, "ok")
        self.assertIn("has not written a lifetime value yet", r.summary)


class LtvSecondSource(unittest.TestCase):
    def tables(self, checked_usd):
        return {"cockpit_billing_events": [ltv_event(10, "taskA1", 4000, checked_usd, baseline_day="2026-09-01",
                                                     as_of="2026-09-30")],
                "cockpit_manual_payments": [
                    {"id": "m1", "clickup_task_id": "taskA1", "day": "2026-09-05", "amount_usd": 1000, "check_state": "checked",
                     "deleted_at": None, "kind": "payment"},
                    {"id": "m2", "clickup_task_id": "taskA1", "day": "2026-08-20", "amount_usd": 999, "check_state": "checked",
                     "deleted_at": None, "kind": "payment"}],
                "cockpit_payment_ties": [{"payment_id": "whop:p1", "clickup_task_id": "taskA1", "cleared_at": None},
                                         {"payment_id": "whop:p2", "clickup_task_id": "taskB1", "cleared_at": None}],
                "cockpit_client_payments": [
                    {"payment_id": "whop:p1", "day": "2026-09-10", "usd": 2000, "rail": "whop", "active": True, "checked": True},
                    {"payment_id": "whop:p2", "day": "2026-09-10", "usd": 5000, "rail": "whop", "active": True, "checked": True},
                    {"payment_id": "whop:p3", "day": "2026-10-02", "usd": 7000, "rail": "whop", "active": True, "checked": True}]}

    def test_a_floor_above_the_cockpit_sum_by_more_than_a_dollar_warns(self):
        r = run(wc.run_ltv_second_source, self.tables(2500))
        self.assertEqual(r.status, "warn")
        self.assertEqual(r.items, ["taskA1"])
        self.assertIn("$500.00", r.summary)
        self.assertIn("payments tied straight to the card exceed the cockpit's LTV sum", r.summary)

    def test_a_sum_at_or_above_the_floor_is_ok(self):
        self.assertEqual(run(wc.run_ltv_second_source, self.tables(3000)).status, "ok")
        self.assertEqual(run(wc.run_ltv_second_source, self.tables(2999.5)).status, "ok")


class AgentSeparation(unittest.TestCase):
    def test_a_login_without_separation_warns_and_with_it_is_ok(self):
        key = [{"id": 1, "agent": "billing_agent", "revoked_at": None}]
        r = run(wc.run_agent_separation, {"cockpit_settings": [setting("billing.agent", {"separated": False})],
                                          "cockpit_agent_keys": key})
        self.assertEqual(r.status, "warn")
        self.assertIn("The billing agent can still read the old key on the server.", r.summary)
        self.assertEqual(run(wc.run_agent_separation, {"cockpit_settings": [setting("billing.agent", {"separated": True})],
                                                       "cockpit_agent_keys": key}).status, "ok")


class Wins(unittest.TestCase):
    def test_a_tie_open_more_than_3_days_warns(self):
        rows = [{"id": 1, "win_id": "w1", "state": "open", "proposed_at": fakes.ago(60 * 24 * 4)},
                {"id": 2, "win_id": "w2", "state": "open", "proposed_at": fakes.ago(60)}]
        r = run(wc.run_win_ties, {"cockpit_win_tie_proposals": rows})
        self.assertEqual((r.status, r.items), ("warn", ["1"]))
        self.assertEqual(run(wc.run_win_ties, {"cockpit_win_tie_proposals": rows[1:]}).status, "ok")

    def test_an_upsell_accepted_45_days_ago_with_no_tie_warns(self):
        wins = [{"id": "w1", "task_id": "taskA1", "stage": "signed"}, {"id": "w2", "task_id": "taskB1", "stage": "signed"}]
        events = [{"win_id": "w1", "event": "accepted", "at": fakes.ago(60 * 24 * 46)},
                  {"win_id": "w2", "event": "accepted", "at": fakes.ago(60 * 24 * 10)}]
        r = run(wc.run_win_unpaid, {"cockpit_csm_wins": wins, "cockpit_csm_win_events": events})
        self.assertEqual((r.status, r.items), ("warn", ["w1"]))
        self.assertIn("1 accepted upsell has no payment tied", r.summary)

    def test_pay_proposals_on_the_3rd_warn_on_a_flat_win_of_last_month_with_no_decision(self):
        wins = [{"id": "w1", "kind": "review", "stage": "logged", "won_on": "2026-09-10"},
                {"id": "w2", "kind": "renewal", "stage": "logged", "won_on": "2026-09-12", "agreement_url": None},
                {"id": "w3", "kind": "podcast", "stage": "void", "won_on": "2026-09-12"},
                {"id": "w4", "kind": "video_testimonial", "stage": "logged", "won_on": "2026-08-12"}]
        on = setting("pay.proposals", {"on": True})
        r = run(wc.run_pay_proposals, {"cockpit_settings": [on], "cockpit_csm_wins": wins, "cockpit_pay_proposal_decisions": []})
        self.assertEqual((r.status, r.items), ("warn", ["w1"]))
        self.assertIn("2026-09", r.summary)
        done = [{"key": "win:w1:google_reviews:2026-09", "decision": "confirmed"}]
        self.assertEqual(run(wc.run_pay_proposals, {"cockpit_settings": [on], "cockpit_csm_wins": wins,
                                                    "cockpit_pay_proposal_decisions": done}).status, "ok")


class Receipts(unittest.TestCase):
    def test_a_receipt_waiting_more_than_2_working_days_warns(self):
        pay = [{"id": "m1", "check_state": "logged", "deleted_at": None, "added_at": fakes.ago(60 * 24 * 6)},
               {"id": "m2", "check_state": "logged", "deleted_at": None, "added_at": fakes.ago(60)},
               {"id": "m3", "check_state": "logged", "deleted_at": None, "added_at": fakes.ago(60 * 24 * 6)}]
        receipts = [{"manual_payment_id": "m1", "added_at": fakes.ago(60 * 24 * 6)},
                    {"manual_payment_id": "m2", "added_at": fakes.ago(60)}]
        inbox = [{"id": 5, "source": "portal", "response_id": "r3", "ledger_id": "m3", "status": "ingested",
                  "logged_at": fakes.ago(60 * 24 * 1)}]
        r = run(wc.run_receipts, {"cockpit_payment_receipts": receipts, "cockpit_billing_inbox": inbox, "cockpit_manual_payments": pay})
        self.assertEqual((r.status, r.items), ("warn", ["m1"]))
        ok = run(wc.run_receipts, {"cockpit_payment_receipts": receipts[1:], "cockpit_billing_inbox": inbox,
                                   "cockpit_manual_payments": pay})
        self.assertEqual(ok.status, "ok")

    def test_working_days_skip_friday_and_saturday(self):
        # Thursday 1 Oct 17:00 Kuwait to Saturday 3 Oct 17:00: no working day passed.
        self.assertEqual(wc._business_days(fakes.NOW - timedelta(days=2), fakes.NOW), 0)
        self.assertEqual(wc._business_days(fakes.NOW - timedelta(days=6), fakes.NOW), 4)  # Mon to Thu


class AgentDoor(unittest.TestCase):
    key = [{"id": 1, "revoked_at": None}]

    def test_more_than_10_refusals_in_an_hour_fails(self):
        calls = [{"id": i, "at": fakes.ago(5), "outcome": "refused"} for i in range(11)]
        self.assertEqual(run(wc.run_agent_door, {"cockpit_agent_keys": self.key, "cockpit_agent_calls": calls}).status, "fail")
        self.assertEqual(run(wc.run_agent_door, {"cockpit_agent_keys": self.key, "cockpit_agent_calls": calls[:10]}).status, "ok")

    def test_a_key_and_no_call_in_48_hours_warns(self):
        r = run(wc.run_agent_door, {"cockpit_agent_keys": self.key, "cockpit_agent_calls": []})
        self.assertEqual(r.status, "warn")
        self.assertIn("doctor", r.summary)


class Retire(unittest.TestCase):
    items = [{"id": "make:8063994", "kind": "make", "external_id": "8063994", "name": "Monday-era ticketing", "state": "off",
              "ready": True},
             {"id": "typeform:knIe4eF3", "kind": "typeform", "external_id": "knIe4eF3", "name": "Termination",
              "state": "closed", "ready": False},
             {"id": "make:8925654", "kind": "make", "external_id": "8925654", "name": "Kickoff effects", "state": "on",
              "ready": False}]

    def test_ready_items_are_listed_and_ok(self):
        r = run(wc.run_retire, {"cockpit_retire_items_v": self.items, "cockpit_form_responses": [], "cockpit_forms": []})
        self.assertEqual((r.status, r.items), ("ok", ["make:8063994"]))
        self.assertIn("ready to archive", r.summary)

    def test_a_retired_typeform_answered_in_24_hours_warns(self):
        legacy = [{"id": "r1", "form_key": "pause_request", "state": "legacy", "submitted_at": fakes.ago(60)}]
        forms = [{"key": "pause_request", "typeform_id": "knIe4eF3"}]
        r = run(wc.run_retire, {"cockpit_retire_items_v": self.items, "cockpit_form_responses": legacy, "cockpit_forms": forms})
        self.assertEqual((r.status, r.items), ("warn", ["typeform:knIe4eF3"]))


class Stage4(unittest.TestCase):
    def test_a_legacy_kickoff_after_the_switch_warns(self):
        s = setting("forms.stage4", {"kickoff": True, "onboarding": False}, minutes_ago=60 * 24)
        rows = [{"id": "r1", "form_key": "kickoff", "state": "legacy", "created_at": fakes.ago(60)},
                {"id": "r0", "form_key": "kickoff", "state": "legacy", "created_at": fakes.ago(60 * 24 * 3)}]
        r = run(wc.run_stage4_legacy, {"cockpit_settings": [s], "cockpit_form_responses": rows})
        self.assertEqual((r.status, r.items), ("warn", ["r1"]))

    def test_a_failed_step_warns_and_a_native_answer_with_no_steps_fails(self):
        s = setting("forms.stage4", {"kickoff": True, "onboarding": False})
        effects = [{"id": 1, "response_id": "r1", "form_key": "kickoff", "effect_key": "card_fields", "state": "failed"}]
        responses = [{"id": "r1", "form_key": "kickoff", "form_version": 2, "state": "submitted", "submitted_at": fakes.ago(90)}]
        r = run(wc.run_stage4_effects, {"cockpit_settings": [s], "cockpit_form_effects": effects, "cockpit_form_responses": responses})
        self.assertEqual((r.status, r.items), ("warn", ["1"]))
        bare = responses + [{"id": "r2", "form_key": "kickoff", "form_version": 2, "state": "submitted", "submitted_at": fakes.ago(40)},
                            {"id": "r3", "form_key": "kickoff", "form_version": 2, "state": "submitted", "submitted_at": fakes.ago(5)},
                            {"id": "r4", "form_key": "kickoff", "form_version": 1, "state": "submitted", "submitted_at": fakes.ago(90)}]
        f = run(wc.run_stage4_effects, {"cockpit_settings": [s], "cockpit_form_effects": effects, "cockpit_form_responses": bare})
        self.assertEqual((f.status, f.items), ("fail", ["r2"]))

    def test_the_relay_warns_on_unknown_and_on_a_long_claim(self):
        self.assertEqual(run(wc.run_relay, {"cockpit_form_relay_outbox": []}).status, "ok")
        r = run(wc.run_relay, {"cockpit_form_relay_outbox": [{"id": 1, "state": "unknown", "updated_at": fakes.ago(1)}]})
        self.assertEqual((r.status, r.items), ("warn", ["1"]))
        c = run(wc.run_relay, {"cockpit_form_relay_outbox": [{"id": 2, "state": "claimed", "updated_at": fakes.ago(20)},
                                                             {"id": 3, "state": "claimed", "updated_at": fakes.ago(5)}]})
        self.assertEqual((c.status, c.items), ("warn", ["2"]))


if __name__ == "__main__":
    unittest.main()
