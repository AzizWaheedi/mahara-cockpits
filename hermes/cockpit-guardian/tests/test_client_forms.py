"""The waves 3-4 client forms checks (docs/forms/WAVE34-CONTRACT.md 6.2): each reads "not set up yet" as ok, never as
zero, reads views and tables (never the seat RPCs), and turns warn or fail by its own rule. Invented cards and clients."""
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

import checks as checks_mod
from checks import client_forms as cf
from guard.context import Context
from tests import fakes

NOT_THERE = ("cockpit_settings", "cockpit_sync_state", "cockpit_form_invites", "cockpit_form_invite_events",
             "cockpit_client_messages", "cockpit_form_token_opens", "cockpit_portal_presence", "cockpit_client_voice_v",
             "cockpit_requests", "cockpit_form_responses", "cockpit_forms", "cockpit_client_onboarding")
ALL = (cf.run_schedule, cf.run_expiry, cf.run_push, cf.run_links, cf.run_tokens, cf.run_presence, cf.run_voice, cf.run_low,
       cf.run_hooks, cf.run_legacy, cf.run_onboarding, cf.run_make_doors)


def ctx(tables=None, missing=()):
    db = fakes.FakeDb(tables or {}, missing=missing)
    return Context(fakes.config(Path(tempfile.gettempdir()) / "guardian-client-forms-test"), db, None, now=fakes.NOW), db


def run(fn, tables=None, missing=()):
    c, _ = ctx(tables, missing)
    return fn(c)


def state(key, minutes=10, ok=True, note="", **detail):
    return dict(key=key, ok=ok, note=note, detail=detail or None, last_run_at=fakes.ago(minutes), last_ok_at=fakes.ago(minutes))


def setting(key, value):
    return {"key": key, "value": value}


class Registered(unittest.TestCase):
    def test_the_twelve_checks_are_registered_after_the_waves_1_2_checks(self):
        ids = [c.id for c in checks_mod.all_checks("native")]
        mine = ["form-schedule", "invites-expiry", "invite-push", "invite-links", "token-limits", "presence", "voice-count",
                "low-score-open", "hook-failed", "legacy-24h", "onboarding-webhook", "forms-door-make"]
        for i in mine:
            self.assertIn(i, ids)
        self.assertGreater(ids.index("form-schedule"), ids.index("checks-waiting"))


class NotSetUpYet(unittest.TestCase):
    def test_before_the_deploy_every_check_reads_ok_and_says_why_never_zero(self):
        for fn in ALL:
            with self.subTest(check=fn.__name__):
                r = run(fn, {}, missing=NOT_THERE)
                self.assertEqual(r.status, "ok", r.summary)
                self.assertNotIn(" 0 ", f" {r.summary} ")
                self.assertIn("Not set up yet", r.summary)


class Schedule(unittest.TestCase):
    def test_off_is_ok_and_says_when_it_turns_on(self):
        r = run(cf.run_schedule, {"cockpit_settings": [setting("forms.schedule", {"on": False, "maxPerRun": 3})],
                                  "cockpit_sync_state": [state("form-schedule", ran=False)]})
        self.assertEqual(r.status, "ok")
        self.assertIn("off", r.summary)

    def test_on_and_older_than_26_hours_fails_and_a_recent_run_is_ok(self):
        on = setting("forms.schedule", {"on": True, "maxPerRun": 3})
        old = run(cf.run_schedule, {"cockpit_settings": [on], "cockpit_sync_state": [state("form-schedule", minutes=27 * 60)]})
        self.assertEqual(old.status, "fail")
        fresh = run(cf.run_schedule, {"cockpit_settings": [on], "cockpit_sync_state": [
            state("form-schedule", note="Sent 2 NPS and 1 onboarding survey.", issued={"nps": 2, "csat": 1}, skipped={"notLive": 0})]})
        self.assertEqual(fresh.status, "ok")
        self.assertIn("Sent 2 NPS", fresh.summary)
        never = run(cf.run_schedule, {"cockpit_settings": [on], "cockpit_sync_state": []})
        self.assertEqual(never.status, "fail")

    def test_a_run_that_sent_nothing_because_a_form_is_not_live_warns(self):
        r = run(cf.run_schedule, {"cockpit_settings": [setting("forms.schedule", {"on": True})], "cockpit_sync_state": [
            state("form-schedule", note="Sent 0 NPS and 0 onboarding surveys.", issued={"nps": 0, "csat": 0}, skipped={"notLive": 2})]})
        self.assertEqual(r.status, "warn")
        self.assertIn("not switched on for clients", r.summary)


class Invites(unittest.TestCase):
    def test_an_open_invite_26_hours_past_its_expiry_warns_and_a_fresh_one_does_not(self):
        late = {"id": "i1", "form_key": "nps", "state": "open", "expires_at": fakes.ago(27 * 60)}
        fresh = {"id": "i2", "form_key": "nps", "state": "open", "expires_at": fakes.ago(60)}
        self.assertEqual(run(cf.run_expiry, {"cockpit_form_invites": [fresh]}).status, "ok")
        r = run(cf.run_expiry, {"cockpit_form_invites": [late, fresh]})
        self.assertEqual(r.status, "warn")
        self.assertEqual(r.items, ["i1"])

    def test_a_phone_alert_sending_for_over_15_minutes_warns(self):
        self.assertEqual(run(cf.run_push, {"cockpit_form_invites": [{"id": "i", "push_state": "sending", "updated_at": fakes.ago(5)}]}).status, "ok")
        self.assertEqual(run(cf.run_push, {"cockpit_form_invites": [{"id": "i", "push_state": "sending", "updated_at": fakes.ago(20)}]}).status, "warn")

    def test_links_warn_on_unknown_and_on_a_draft_older_than_48_hours(self):
        unknown = {"id": "m1", "kind": "form_invite", "state": "unknown", "created_at": fakes.ago(10)}
        old = {"id": "m2", "kind": "form_invite", "state": "draft", "created_at": fakes.ago(49 * 60)}
        new = {"id": "m3", "kind": "form_invite", "state": "draft", "created_at": fakes.ago(60)}
        recap = {"id": "m4", "kind": "recap_checkin", "state": "unknown", "created_at": fakes.ago(10)}
        self.assertEqual(run(cf.run_links, {"cockpit_client_messages": [new, recap]}).status, "ok")
        r = run(cf.run_links, {"cockpit_client_messages": [old]})
        self.assertEqual(r.status, "warn")
        self.assertIn("1 form link waits for a CSM's approval", r.summary)
        self.assertIn("unknown", run(cf.run_links, {"cockpit_client_messages": [unknown, old]}).summary)

    def test_more_than_50_limited_opens_in_an_hour_warns(self):
        rows = [{"id": n, "outcome": "limited", "at": fakes.ago(5)} for n in range(51)]
        self.assertEqual(run(cf.run_tokens, {"cockpit_form_token_opens": rows[:50]}).status, "ok")
        self.assertEqual(run(cf.run_tokens, {"cockpit_form_token_opens": rows}).status, "warn")

    def test_presence_is_ok_while_off_and_warns_when_stale_while_on(self):
        off = setting("forms.client", {"live": [], "presence": False})
        self.assertEqual(run(cf.run_presence, {"cockpit_settings": [off], "cockpit_portal_presence": []}).status, "ok")
        on = setting("forms.client", {"live": ["nps"], "presence": True})
        self.assertEqual(run(cf.run_presence, {"cockpit_settings": [on], "cockpit_portal_presence": [
            {"location_id": "locA", "pushed_at": fakes.ago(40)}]}).status, "warn")
        self.assertEqual(run(cf.run_presence, {"cockpit_settings": [on], "cockpit_portal_presence": [
            {"location_id": "locA", "pushed_at": fakes.ago(4)}]}).status, "ok")


class Voice(unittest.TestCase):
    def tables(self, answers, events, invites):
        return {"cockpit_client_voice_v": answers, "cockpit_form_invite_events": events, "cockpit_form_invites": invites}

    def test_voice_count_reads_the_view_and_the_tables_never_a_seat_rpc_and_warns_when_cards_differ(self):
        answers = [{"clickup_task_id": t, "form_key": "nps", "submitted_at": fakes.ago(60)} for t in ("A", "A", "B")]
        events = [{"invite_id": i, "event": "answered", "at": fakes.ago(60)} for i in ("i1", "i2", "i3", "ic")]
        invites = [{"id": "i1", "task_id": "A", "form_key": "nps", "origin": "schedule"},
                   {"id": "i2", "task_id": "A", "form_key": "nps", "origin": "csm"},
                   {"id": "i3", "task_id": "B", "form_key": "nps", "origin": "schedule"},
                   {"id": "ic", "task_id": "86eywg1cq", "form_key": "nps", "origin": "canary"}]
        c, db = ctx(self.tables(answers, events, invites))
        r = cf.run_voice(c)
        self.assertEqual(r.status, "ok", r.summary)
        self.assertEqual(set(db.reads), {"cockpit_client_voice_v", "cockpit_form_invite_events", "cockpit_form_invites"})
        r = run(cf.run_voice, self.tables(answers + [{"clickup_task_id": "C", "form_key": "nps", "submitted_at": fakes.ago(60)}],
                                          events, invites))
        self.assertEqual(r.status, "warn")
        self.assertEqual(r.evidence, {"cards_with_answer": 3, "cards_with_answered_invite": 2})

    def test_low_score_open_warns_after_a_business_day_with_no_ticket_and_clears_with_one_raised_after_the_answer(self):
        # NOW is Saturday 17:00 Kuwait. An answer on Wednesday 10:00 has waited more than a business day.
        answered = (fakes.NOW - timedelta(days=3, hours=7)).isoformat()
        low = {"response_id": "r1", "clickup_task_id": "A", "client_name": "Acme Interiors", "form_key": "nps", "score": 5,
               "submitted_at": answered}
        fine = {"response_id": "r2", "clickup_task_id": "B", "client_name": "Beta Build", "form_key": "nps", "score": 9,
                "submitted_at": answered}
        base = {"cockpit_settings": [setting("voice.low_score", {"max": 6})], "cockpit_client_voice_v": [low, fine]}
        r = run(cf.run_low, {**base, "cockpit_requests": []})
        self.assertEqual(r.status, "warn")
        self.assertIn("Acme Interiors", r.summary)
        self.assertNotIn("Beta Build", r.summary)
        before = {"client_task_id": "A", "created_at": (fakes.NOW - timedelta(days=5)).isoformat(), "state": "delivered",
                  "type_key": "client_low_score"}
        self.assertEqual(run(cf.run_low, {**base, "cockpit_requests": [before]}).status, "warn")
        after = {**before, "created_at": fakes.ago(60)}
        self.assertEqual(run(cf.run_low, {**base, "cockpit_requests": [after]}).status, "ok")
        cancelled = {**after, "state": "cancelled"}
        self.assertEqual(run(cf.run_low, {**base, "cockpit_requests": [cancelled]}).status, "warn")

    def test_a_low_score_inside_a_business_day_waits_and_the_weekend_does_not_count(self):
        # Thursday 16:00 Kuwait to Saturday 17:00: Thursday's last hours only, under a business day.
        thursday = (fakes.NOW - timedelta(days=2, hours=1)).isoformat()
        low = {"response_id": "r1", "clickup_task_id": "A", "client_name": "Acme", "form_key": "csat", "score": 3,
               "submitted_at": thursday}
        r = run(cf.run_low, {"cockpit_settings": [setting("voice.low_score", {"max": 6})], "cockpit_client_voice_v": [low],
                             "cockpit_requests": []})
        self.assertEqual(r.status, "ok", r.summary)

    def test_hook_failed_warns_on_one_event(self):
        ev = {"id": 1, "invite_id": "i1", "event": "hook_failed", "at": fakes.ago(60), "detail": {"hook": "cockpit_form_hook_nps", "sqlstate": "55000"}}
        r = run(cf.run_hooks, {"cockpit_form_invite_events": [ev]})
        self.assertEqual(r.status, "warn")
        self.assertEqual(r.summary, "1 client answer was stored but a follow-up step failed (cockpit_form_hook_nps). Re-run it from the runbook.")
        self.assertEqual(run(cf.run_hooks, {"cockpit_form_invite_events": []}).status, "ok")


class Doors(unittest.TestCase):
    def test_legacy_warns_only_for_a_form_that_is_native_now(self):
        rows = [{"id": "x1", "form_key": "exit_survey", "state": "legacy", "source": "typeform_webhook", "submitted_at": fakes.ago(30)}]
        typeform = {"cockpit_forms": [{"key": "exit_survey", "provider": "typeform"}], "cockpit_form_responses": rows}
        self.assertEqual(run(cf.run_legacy, typeform).status, "ok")
        native = {"cockpit_forms": [{"key": "exit_survey", "provider": "native"}], "cockpit_form_responses": rows}
        r = run(cf.run_legacy, native)
        self.assertEqual(r.status, "warn")
        self.assertIn("The termination survey came through the old link 1 time today", r.summary)

    def test_onboarding_webhook_compares_for_14_days_then_says_so(self):
        reg = (fakes.NOW - timedelta(days=2)).isoformat()
        door = state("forms-door:onboarding", registered=True, registeredAt=reg)
        poll_only = {"clickup_task_id": "A", "forms": {"onboarding": {"response_id": "tokA0001", "submitted_at": fakes.ago(90)}}}
        both = {"clickup_task_id": "B", "forms": {"onboarding": {"response_id": "tokB0001", "submitted_at": fakes.ago(90)}}}
        recent = {"clickup_task_id": "C", "forms": {"onboarding": {"response_id": "tokC0001", "submitted_at": fakes.ago(5)}}}
        tables = {"cockpit_sync_state": [door], "cockpit_client_onboarding": [poll_only, both, recent],
                  "cockpit_form_responses": [{"external_id": "tokB0001", "form_key": "onboarding", "submitted_at": fakes.ago(90)}]}
        r = run(cf.run_onboarding, tables)
        self.assertEqual(r.status, "warn")
        self.assertEqual(r.items, ["A"])
        old = state("forms-door:onboarding", registered=True, registeredAt=(fakes.NOW - timedelta(days=15)).isoformat())
        r = run(cf.run_onboarding, {**tables, "cockpit_sync_state": [old]})
        self.assertEqual(r.status, "ok")
        self.assertIn("compared with the 10-minute read for 14 days", r.summary)

    def test_the_make_doors_fail_on_a_failed_delivery_and_a_quiet_form_is_normal(self):
        quiet = run(cf.run_make_doors, {"cockpit_sync_state": [state("forms-door:onboarding", registered=True, outcome="recorded")]})
        self.assertEqual(quiet.status, "ok")
        self.assertIn("quiet form is normal", quiet.summary)
        bad = run(cf.run_make_doors, {"cockpit_sync_state": [
            state("forms-door:new_client", ok=False, registered=True, outcome="failed", reason="The store refused the response (22023).")]})
        self.assertEqual(bad.status, "fail")
        self.assertIn("New Client Form", bad.summary)


if __name__ == "__main__":
    unittest.main()
