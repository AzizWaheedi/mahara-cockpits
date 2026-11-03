"""The sale tie's check (20261103g, contract 4.19): "not set up yet" before the deploy, never zero; each reading of
design 2.11 by its own rule; ids, states and counts only. Every sale, card and token is invented."""
import tempfile
import unittest
from pathlib import Path

import checks as checks_mod
from checks import sale_ties as st
from guard.context import Context
from tests import fakes

NOT_THERE = ("cockpit_sale_ties", "cockpit_settings")


def ctx(tables=None, missing=()):
    return Context(fakes.config(Path(tempfile.gettempdir()) / "guardian-sale-ties-test"),
                   fakes.FakeDb(tables or {}, missing=missing), None, now=fakes.NOW)


def setting(on=True):
    return {"key": "forms.sale_tie", "value": {"on": on, "fill": False, "salesLink": False}}


def sale(token, minutes=60 * 24 * 5, source="typeform_sync"):
    return {"external_id": token, "source": source, "state": "submitted", "mode": "live", "form_key": "new_client",
            "submitted_at": fakes.ago(minutes), "created_at": fakes.ago(minutes)}


def tie(token, state="tied", card="taskCedar01", by="phone", minutes=60 * 24 * 4, billing=None):
    return {"id": hash(token) % 1000, "response_id": token, "state": state, "clickup_task_id": card if state == "tied" else None,
            "matched_by": by if state == "tied" else None, "billing_task_id": billing, "set_by": "system:onboarding-sync",
            "set_at": fakes.ago(minutes), "cleared_at": None}


def deal(token, minutes=60 * 24 * 5):
    return {"response_id": token, "submitted_at": fakes.ago(minutes)}


class Registered(unittest.TestCase):
    def test_the_check_is_registered_once(self):
        ids = [c.id for c in checks_mod.all_checks("native")]
        self.assertEqual(ids.count("sale-ties"), 1)
        self.assertIn(st, checks_mod.MODULES)


class NotSetUpYet(unittest.TestCase):
    def test_before_the_deploy_it_reads_ok_and_says_why_never_zero(self):
        for missing in (NOT_THERE, ("cockpit_sale_ties",), ("cockpit_settings",)):
            r = st.run_sale_ties(ctx({"cockpit_settings": [setting()]}, missing=missing))
            self.assertEqual(r.status, "ok", r.summary)
            self.assertIn("Not set up yet", r.summary)
            self.assertNotIn(" 0 ", f" {r.summary} ")

    def test_off_says_the_rows_wait_with_digests_only(self):
        r = st.run_sale_ties(ctx({"cockpit_settings": [setting(on=False)],
                                  "cockpit_sale_ties": [tie("ncfwait00001", state="waiting", minutes=600)],
                                  "cockpit_form_responses": [sale("ncfwait00001", minutes=600)]}))
        self.assertEqual(r.status, "ok", r.summary)
        self.assertEqual(r.summary, "Sale ties are off: 1 sale stored, 1 row waiting with digests only, nothing tied.")


class Readings(unittest.TestCase):
    def tables(self, **over):
        base = {"cockpit_settings": [setting()],
                "cockpit_sale_ties": [tie("ncfcedar001"), tie("ncfpine0001", by="phone_email"), tie("ncfbay00001", by="email"),
                                      tie("ncfoak00001", by="person")],
                "cockpit_form_responses": [sale("ncfcedar001"), sale("ncfpine0001"), sale("ncfbay00001"), sale("ncfoak00001")],
                "cockpit_sales_deals": [deal("ncfcedar001"), deal("ncfpine0001"), deal("ncfbay00001"), deal("ncfoak00001")],
                "cockpit_sync_state": [{"key": "forms-door:new_client", "detail": {"tie": "ok"}}]}
        base.update(over)
        return base

    def test_all_tied_is_ok_with_the_ceo_line(self):
        r = st.run_sale_ties(ctx(self.tables()))
        self.assertEqual(r.status, "ok", r.summary)
        self.assertEqual(r.summary, "4 sales: 4 on their card (2 by phone, 1 by email, 1 by a person), 0 waiting for a person.")
        self.assertEqual(r.evidence["secondSource"], {"b2b": 4, "stored": 4})

    def test_a_delivered_sale_with_no_row_after_15_minutes_warns(self):
        t = self.tables()
        t["cockpit_form_responses"] = t["cockpit_form_responses"] + [sale("ncfnew00001", minutes=30, source="typeform_webhook"),
                                                                      sale("ncfnew00002", minutes=5, source="typeform_webhook")]
        r = st.run_sale_ties(ctx(t))
        self.assertEqual(r.status, "warn", r.summary)
        self.assertIn("1 sale delivered over 15 minutes ago has no tie row", r.summary)
        self.assertEqual(r.items, ["no-row:ncfnew00001"])

    def test_the_doors_mark_warns_while_a_delivered_sale_has_no_row(self):
        failed = [{"key": "forms-door:new_client", "detail": {"tie": "failed", "tieAt": "2026-10-03T13:00:00+00:00"}}]
        t = self.tables(cockpit_sync_state=failed)
        t["cockpit_form_responses"] = t["cockpit_form_responses"] + [sale("ncfnew00003", minutes=3, source="typeform_webhook")]
        r = st.run_sale_ties(ctx(t))
        self.assertEqual(r.status, "warn")
        self.assertIn("The door could not open a sale's tie at 2026-10-03 13:00 UTC", r.summary)
        self.assertEqual(r.items, ["door-failed"])

    def test_the_doors_mark_is_quiet_once_the_sweep_opened_the_row(self):
        # The mark clears only at the next delivery, and real sales are rare: a fixed failure must not warn for days.
        failed = [{"key": "forms-door:new_client", "detail": {"tie": "failed", "tieAt": "2026-10-03T13:00:00+00:00"}}]
        t = self.tables(cockpit_sync_state=failed)
        t["cockpit_form_responses"] = t["cockpit_form_responses"] + [sale("ncfnew00004", minutes=60 * 24, source="typeform_webhook")]
        t["cockpit_sale_ties"] = t["cockpit_sale_ties"] + [tie("ncfnew00004")]
        t["cockpit_sales_deals"] = t["cockpit_sales_deals"] + [deal("ncfnew00004", minutes=60 * 24)]
        r = st.run_sale_ties(ctx(t))
        self.assertEqual(r.status, "ok", r.summary)
        self.assertNotIn("door could not open", r.summary)

    def test_waiting_over_two_hours_and_a_person_over_three_days_warn_while_on(self):
        t = self.tables()
        t["cockpit_sale_ties"] = t["cockpit_sale_ties"] + [tie("ncfwait00001", state="waiting", minutes=180),
                                                           tie("ncfamb00001", state="ambiguous", minutes=60 * 24 * 4),
                                                           tie("ncfamb00002", state="conflict", minutes=60 * 24)]
        t["cockpit_form_responses"] = t["cockpit_form_responses"] + [sale("ncfwait00001", minutes=180), sale("ncfamb00001"),
                                                                      sale("ncfamb00002")]
        r = st.run_sale_ties(ctx(t))
        self.assertEqual(r.status, "warn")
        self.assertIn("1 sale has waited over 2 hours for its card", r.summary)
        self.assertIn("1 sale has waited over 3 days for a person under Sales not on a card", r.summary)
        self.assertEqual(r.items, ["waiting:ncfwait00001", "person:ncfamb00001"])
        self.assertEqual(r.evidence["forPerson"], 2)
        # Off: nothing waits on the system or a person yet.
        t["cockpit_settings"] = [setting(on=False)]
        self.assertEqual(st.run_sale_ties(ctx(t)).status, "ok")

    def test_the_second_source_warns_on_a_b2b_sale_the_cockpit_does_not_store(self):
        t = self.tables()
        t["cockpit_sales_deals"] = t["cockpit_sales_deals"] + [deal("ncfmiss0001"), deal("ncfyoung001", minutes=20),
                                                               deal("ncfold00001", minutes=60 * 24 * 40)]
        r = st.run_sale_ties(ctx(t))
        self.assertEqual(r.status, "warn")
        self.assertIn("B2B has 5 sales in the last 30 days and the cockpit stores 4: 1 sale is missing", r.summary)
        self.assertEqual(r.items, ["missing:ncfmiss0001"])

    def test_billing_disagreements_are_information(self):
        t = self.tables()
        t["cockpit_sale_ties"] = [tie("ncfcedar001", billing="taskOther01")] + t["cockpit_sale_ties"][1:]
        r = st.run_sale_ties(ctx(t))
        self.assertEqual(r.status, "ok")
        self.assertIn("Billing ties 1 of them to another card (information).", r.summary)
        self.assertEqual(r.evidence["billingDisagrees"], 1)

    def test_it_reads_no_digest_or_contact_column(self):
        c = ctx(self.tables())
        st.run_sale_ties(c)
        self.assertIn("cockpit_sale_ties", c.db.reads)
        import inspect
        import re
        selects = re.findall(r'_maybe\(ctx, "([a-z_]+)",\s*"([^"]+)"', inspect.getsource(st))
        self.assertEqual({t for t, _ in selects}, {"cockpit_settings", "cockpit_sale_ties", "cockpit_form_responses",
                                                   "cockpit_sync_state", "cockpit_sales_deals"})
        for _, cols in selects:
            for column in cols.split(","):
                self.assertNotIn(column, ("phone_key", "email_key", "phone8", "email", "note", "answers", "hidden"))

if __name__ == "__main__":
    unittest.main()
