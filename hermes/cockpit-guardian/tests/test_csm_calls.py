"""CSM sync checks catch a stopped source and a new stall inside an open incident."""
import tempfile
import unittest
from pathlib import Path

from checks import by_id, csm_calls
from guard import db as db_mod
from guard.model import FAIL, OK, UNKNOWN, WARN
from tests import fakes


def ctx(tables):
    return on(fakes.FakeDb(tables))


def on(db):
    return fakes.ctx(Path(tempfile.mkdtemp()), db=db, host=fakes.FakeHost(fakes.snapshot()))


class SqlNulls(fakes.FakeDb):
    """The fake database with SQL's nulls, as the read-only SQL door (MgmtDb) runs a filter: a comparison with null
    matches no row (task_id <> null is never true); only "is" tests for null."""

    name = "sql-nulls"

    def rows(self, table, select="*", where=(), order=None, limit=None):
        if any(value is None and op != "is" for _, op, value in where):
            return []
        return super().rows(table, select, where, order, limit)


class CsmCalls(unittest.TestCase):
    def test_checks_are_report_only(self):
        for check in csm_calls.CHECKS:
            self.assertIs(check.fix, None)
            self.assertIs(by_id()[check.id], check)

    def test_missing_health_fails_and_names_every_source(self):
        r = csm_calls.run_freshness(ctx({}))
        self.assertEqual(r.status, FAIL)
        self.assertEqual(len(r.items), len(csm_calls.CSM_KEYS))

    def test_a_new_failure_is_a_distinct_incident_item(self):
        rows = [{"key": k, "ok": True, "last_ok_at": fakes.ago(2), "note": "ok"}
                for k in csm_calls.CSM_KEYS]
        rows[0].update(ok=False, note="GoHighLevel denied this read")
        r = csm_calls.run_freshness(ctx({"cockpit_sync_state": rows}))
        self.assertEqual(r.status, FAIL)
        self.assertIn("csm-ghl-calls-failing", r.items)
        rows[1].update(last_ok_at=fakes.ago(80))
        r = csm_calls.run_freshness(ctx({"cockpit_sync_state": rows}))
        self.assertIn("csm-checkin-form-stale", r.items)

    def test_all_recent_health_passes(self):
        rows = [{"key": k, "ok": True, "last_ok_at": fakes.ago(2), "note": "ok"}
                for k in csm_calls.CSM_KEYS]
        self.assertEqual(csm_calls.run_freshness(ctx({"cockpit_sync_state": rows})).status, OK)

    def test_daily_line_reads_an_age_of_zero_as_fresh(self):
        # A good run written in the scan's own second is 0 min old; 0 was once read as "never ran".
        rows = [{"key": k, "ok": True, "last_ok_at": fakes.ago(0)} for k in csm_calls.CSM_KEYS]
        rows[1]["last_ok_at"] = fakes.ago(-0.5)
        r = csm_calls.run_daily_line(ctx({"cockpit_sync_state": rows}))
        self.assertEqual(r.status, OK, r.summary)
        self.assertIn("0 stale source(s)", r.summary)
        rows[0]["last_ok_at"] = None
        r = csm_calls.run_daily_line(ctx({"cockpit_sync_state": rows}))
        self.assertEqual(r.status, WARN)
        self.assertIn("csm-ghl-calls", r.summary)

    def test_missing_call_in_last_21_days_is_named(self):
        roster = [{"table_name": "clients", "data": {"name": "Client A", "taskId": "task-a", "bucket": "management"}},
                  {"table_name": "clients", "data": {"name": "Client B", "taskId": "task-b", "bucket": "onboarding"}}]
        r = csm_calls.run_coverage(ctx({"cockpit_csm_sources": roster,
                                        "cockpit_csm_calls": [{"task_id": "task-a", "starts_at": fakes.ago(30), "status": "held"}]}))
        self.assertEqual(r.status, WARN)
        self.assertIn("Client B", r.summary)

    def test_mismatched_calls_over_20_percent_warn(self):
        calls = [{"id": i, "task_id": None if i == 0 else "task-a", "source": "ghl_appointment",
                  "starts_at": fakes.ago(20), "status": "confirmed"} for i in range(4)]
        self.assertEqual(csm_calls.run_unmatched(ctx({"cockpit_csm_calls": calls})).status, WARN)


def call(i, task_id="task-a", **kw):
    return {"id": i, "task_id": task_id, "source": "fathom", "starts_at": fakes.ago(60 * 24), "status": "held",
            "candidate": False, "settled_reason": None, **kw}


def webhook_state(**detail):
    return {"key": "fathom-webhook", "note": "Last delivery stored at 17:00", "detail": detail}


def cs_recording(rid, minutes_ago=180, summary="An invented summary.", shared_with="all_teams", team="Customer Success"):
    """A stored meeting first seen minutes_ago; with a summary and shared with a team, Fathom's webhook fires for it."""
    return {"recording_id": rid, "recorder_team": team, "first_seen_at": fakes.ago(minutes_ago), "summary": summary,
            "raw": {"recording_id": rid, "shared_with": shared_with}}


class OneOneNotes(unittest.TestCase):
    """docs/forms/STAGE2-CONTRACT.md section 9: candidates, the check-in kind and the Fathom webhook."""

    def test_candidates_and_settled_rows_stay_out_of_the_unmatched_share(self):
        calls = [call(i) for i in range(4)] + [call(4, task_id=None)]
        calls += [call(10 + i, task_id=None, candidate=True) for i in range(4)]
        calls += [call(20, task_id=None, settled_reason="part_of_call"), call(21, task_id=None, settled_reason="not_client")]
        r = csm_calls.run_unmatched(ctx({"cockpit_csm_calls": calls}))
        # 1 of 5 is on the line, not over it; counted with the candidates it would be 5 of 9.
        self.assertEqual(r.status, OK, r.summary)
        self.assertIn("1 of 5 calls", r.summary)
        self.assertEqual(r.evidence, {"calls": 5, "unmatched": 1, "share": 0.2, "candidates": 4, "settled": 2})
        calls.append(call(5, task_id=None))
        r = csm_calls.run_unmatched(ctx({"cockpit_csm_calls": calls}))
        self.assertEqual(r.status, WARN)
        self.assertIn("2 of 6 calls", r.summary)

    def test_only_candidates_and_settled_rows_leave_nothing_to_measure(self):
        calls = [call(1, task_id=None, candidate=True), call(2, task_id=None, settled_reason="onboarding")]
        r = csm_calls.run_unmatched(ctx({"cockpit_csm_calls": calls}))
        self.assertEqual(r.status, UNKNOWN)
        self.assertEqual(r.evidence, {"calls": 0, "candidates": 1, "settled": 1})

    def test_the_checkin_form_check_reads_the_kind(self):
        def run(forms):
            return csm_calls.run_checkin_form(ctx({"cockpit_csm_call_forms": forms}))

        native = {"form_id": "cockpit-checkin", "form_kind": "checkin", "submitted_at": fakes.ago(60)}
        typeform = {"form_id": "fRokTITH", "form_kind": "checkin", "submitted_at": fakes.ago(60)}
        onboarding = {"form_id": "KFRCXPFx", "form_kind": "onboarding", "submitted_at": fakes.ago(60)}
        self.assertEqual(run([native]).status, OK)
        self.assertEqual(run([typeform]).status, OK)
        self.assertEqual(run([onboarding]).status, FAIL)
        self.assertEqual(run([dict(native, submitted_at=fakes.ago(8 * 1440)), onboarding]).status, WARN)
        self.assertIn("form_kind checkin", by_id()["csm-checkin-form"].reads)

    def test_the_webhook_check_warns_when_registered_and_silent(self):
        state = [webhook_state(registered=True, webhookIdLast4="9876")]
        meetings = [cs_recording("196100001")]
        r = csm_calls.run_fathom_webhook(ctx({"cockpit_sync_state": state, "cockpit_fathom_meetings": meetings}))
        self.assertEqual(r.status, WARN)
        self.assertEqual(r.summary, "The Fathom webhook stored no delivery in 24 h, while 1 Customer Success recording "
                                    "with a summary, shared with a team, reached the store by the 15-minute read or "
                                    "the pull.")
        failed = [{"webhook_id": "msg_a", "outcome": "failed", "last_at": fakes.ago(170)},
                  {"webhook_id": "msg_b", "outcome": "ignored", "last_at": fakes.ago(10)}]
        r = csm_calls.run_fathom_webhook(ctx({"cockpit_sync_state": state, "cockpit_fathom_meetings": meetings,
                                              "cockpit_fathom_webhook_deliveries": failed}))
        self.assertEqual(r.status, WARN)
        self.assertTrue(r.summary.endswith(" 1 delivery failed in that time."), r.summary)
        self.assertEqual((r.evidence["failed24h"], r.evidence["ignored24h"], r.evidence["stored24h"]), (1, 1, 0))
        # A stored delivery older than 24 hours does not count.
        old = [{"webhook_id": "msg_c", "outcome": "stored", "last_at": fakes.ago(25 * 60)}]
        r = csm_calls.run_fathom_webhook(ctx({"cockpit_sync_state": state, "cockpit_fathom_meetings": meetings,
                                              "cockpit_fathom_webhook_deliveries": old}))
        self.assertEqual(r.status, WARN)

    def test_the_webhook_check_passes_when_delivering_or_when_nothing_is_due(self):
        meetings = [cs_recording("196100001"), cs_recording("196100002", minutes_ago=30, team="Sales")]
        stored = [{"webhook_id": "msg_a", "outcome": "stored", "last_at": fakes.ago(175)}]

        def run(state, deliveries=()):
            return csm_calls.run_fathom_webhook(ctx({"cockpit_sync_state": state, "cockpit_fathom_meetings": meetings,
                                                     "cockpit_fathom_webhook_deliveries": list(deliveries)}))

        r = run([webhook_state(registered=True)], stored)
        self.assertEqual(r.status, OK)
        self.assertEqual(r.summary, "The Fathom webhook stored 1 delivery in 24 h; 1 Customer Success recording with a "
                                    "summary, shared with a team, reached the store.")
        # Registered and no Customer Success recording in 24 h: nothing was due.
        quiet = csm_calls.run_fathom_webhook(ctx({"cockpit_sync_state": [webhook_state(registered=True)]}))
        self.assertEqual(quiet.status, OK)
        # The database's text form of the flag counts too.
        self.assertEqual(run([webhook_state(registered="true")]).status, WARN)
        # Not registered: the note never names the pull when the notes open, which runs only once the Fathom key is
        # saved; the guardian cannot read the vault (cockpit_forms_keys has no grant), so with B7 open it would be false.
        for state in ([webhook_state(registered=False)], [webhook_state()], [{"key": "fathom-webhook", "detail": None}], []):
            r = run(state)
            self.assertEqual(r.status, OK, state)
            self.assertEqual(r.summary, "Not registered yet: calls arrive by the 15-minute read.")
            self.assertEqual(r.evidence, {"registered": False})
        r = run([webhook_state(registered=False, unregisteredAt="2026-10-03T10:00:00+00:00")])
        self.assertEqual(r.status, OK)
        self.assertEqual(r.summary, "Unregistered at 3 Oct 13:00 Kuwait time: calls arrive by the 15-minute read.")

    def test_the_webhook_check_counts_only_the_recordings_fathom_pushes(self):
        """A7 item 8: Fathom's webhook fires only once a summary is ready and only for a recording shared with a team,
        so a day of short or unshared Customer Success calls is nothing to deliver."""
        state = [webhook_state(registered=True)]
        quiet = [cs_recording("196100011", summary=None),       # short: no summary, or a team meeting's stripped one
                 cs_recording("196100012", summary="  "),
                 cs_recording("196100013", shared_with="no_teams"),
                 cs_recording("196100014", minutes_ago=25 * 60)]  # first seen over 24 h ago
        r = csm_calls.run_fathom_webhook(ctx({"cockpit_sync_state": state, "cockpit_fathom_meetings": quiet}))
        self.assertEqual(r.status, OK, r.summary)
        self.assertEqual(r.summary, "The Fathom webhook stored 0 deliveries in 24 h; 0 Customer Success recordings with a "
                                    "summary, shared with a team, reached the store.")
        self.assertEqual((r.evidence["csRecordings24h"], r.evidence["due24h"]), (3, 0))
        # One summarised recording shared with a team (or with no shared_with in its raw: only no_teams is left out) is due.
        for pushed in (cs_recording("196100015"), dict(cs_recording("196100016"), raw={"recording_id": "196100016"})):
            r = csm_calls.run_fathom_webhook(ctx({"cockpit_sync_state": state, "cockpit_fathom_meetings": quiet + [pushed]}))
            self.assertEqual(r.status, WARN, pushed)
            self.assertIn(" 1 Customer Success recording with a summary, shared with a team, reached", r.summary)
            self.assertEqual((r.evidence["csRecordings24h"], r.evidence["due24h"]), (4, 1))

    def test_the_webhook_check_is_described_as_the_contract_says(self):
        c = by_id()["csm-fathom-webhook"]
        self.assertEqual((c.area, c.name, c.severity, c.owner, c.confirm), ("workers", "Fathom webhook delivers", "low",
                                                                             "the tech lead", 2))
        self.assertEqual(c.means, "Fathom pushes each Customer Success recording to the cockpit within minutes of the call.")
        self.assertEqual(c.threshold, "Registered, a Customer Success recording first seen in the last 24 h that holds a "
                                      "summary and is shared with a team, and no stored delivery in 24 h: warn.")
        self.assertIn("detail.registered", c.reads)
        for word in ("first seen in 24 h", "hold a summary", "shared_with is not no_teams"):
            self.assertIn(word, c.reads)
        self.assertTrue(c.action.startswith("The poll still runs every 15 minutes."))
        self.assertIs(c.fix, None)


class CallEvidence(unittest.TestCase):
    """csm-call-evidence: held bookings on a client in 7 days, and how many carry a recording or a 1-1 form."""

    @staticmethod
    def tables():
        held = [{"id": i, "source": "ghl_appointment", "task_id": "task-a", "status": "held",
                 "starts_at": fakes.ago(60 * 24), "ends_at": None} for i in (1, 2, 3)]
        # A booking on no client is not measured, even with a form linked to it.
        held.append({"id": 4, "source": "ghl_appointment", "task_id": None, "status": "confirmed",
                     "starts_at": fakes.ago(60 * 24), "ends_at": None})
        recorded = [{"id": 9, "source": "fathom", "task_id": "task-a", "linked_call_id": 1, "starts_at": fakes.ago(60 * 24)}]
        forms = [{"token": "tok-a", "linked_call_id": 2, "submitted_at": fakes.ago(60 * 23)},
                 {"token": "tok-b", "linked_call_id": 4, "submitted_at": fakes.ago(60 * 23)}]
        return {"cockpit_csm_calls": held + recorded, "cockpit_csm_call_forms": forms}

    def test_held_bookings_on_a_client_are_measured_whichever_door_reads_them(self):
        """It once filtered ("task_id", "neq", None): the read-only SQL door sends that as task_id <> null, which matches
        no row, so every read-only run from the Mac said "No held call in the last 7 days to measure."."""
        for db in (fakes.FakeDb(self.tables()), SqlNulls(self.tables())):
            r = csm_calls.run_evidence(on(db))
            self.assertEqual(r.status, WARN, (db.name, r.summary))
            self.assertEqual(r.summary, "Only 2 of 3 held calls in the last 7 days (67%) have a recording or a 1-1 form, "
                                        "under the 70% line.")
            self.assertEqual(r.evidence, {"held": 3, "with_evidence": 2, "share": 0.667})

    def test_the_sql_door_is_sent_no_comparison_with_null(self):
        sent = []

        class Mgmt(db_mod.Mgmt):
            def __init__(self):
                pass

            def sql(self, query):
                sent.append(query)
                return []

        r = csm_calls.run_evidence(on(db_mod.MgmtDb(Mgmt())))
        self.assertEqual(r.status, UNKNOWN)
        self.assertEqual(r.summary, "No held call in the last 7 days to measure.")
        self.assertEqual(len(sent), 1)
        self.assertTrue(sent[0].startswith("select id, task_id, status, ends_at, starts_at from public.cockpit_csm_calls "
                                           "where source = 'ghl_appointment' and "), sent[0])
        self.assertNotRegex(sent[0], r"(=|<>|<|>)\s*null")
