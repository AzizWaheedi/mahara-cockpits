"""CSM sync checks catch a stopped source and a new stall inside an open incident."""
import re
import tempfile
import unittest
from pathlib import Path

from checks import all_checks as checks_all, by_id, csm_calls
from guard import db as db_mod
from guard.model import FAIL, OK, UNKNOWN, WARN
from guard.redact import clean, clean_obj
from tests import fakes


TYPEFORM = {"key": "checkin", "provider": "typeform", "provider_since": None, "updated_at": fakes.ago(1440)}


def ctx(tables):
    return on(fakes.FakeDb({"cockpit_forms": [TYPEFORM], **tables}))


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
        self.assertEqual(r.evidence, {"calls": 5, "unmatched": 1, "share": 0.2, "candidates": 4, "settled": 2,
                                      "candidates_without_notes_24h": None})
        calls.append(call(5, task_id=None))
        r = csm_calls.run_unmatched(ctx({"cockpit_csm_calls": calls}))
        self.assertEqual(r.status, WARN)
        self.assertIn("2 of 6 calls", r.summary)

    def test_only_candidates_and_settled_rows_leave_nothing_to_measure(self):
        calls = [call(1, task_id=None, candidate=True), call(2, task_id=None, settled_reason="onboarding")]
        r = csm_calls.run_unmatched(ctx({"cockpit_csm_calls": calls}))
        self.assertEqual(r.status, UNKNOWN)
        self.assertEqual(r.evidence, {"calls": 0, "candidates": 1, "settled": 1, "candidates_without_notes_24h": None})

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


def roster_row(name, task_id, parity=None, notes_from="store", published_min=10):
    """A client row as the native feed publishes it; every publish stamps source_snapshot_at with its cycle's time."""
    data = {"name": name, "taskId": task_id, "bucket": "management"}
    if notes_from:
        data["notesFrom"] = notes_from
    if parity is not None:
        data["notesParity"] = parity
    row = {"table_name": "clients", "data": data}
    if published_min is not None:
        row["source_snapshot_at"] = fakes.ago(published_min)
    return row


class NotesParity(unittest.TestCase):
    """docs/forms/STAGE2B-CONTRACT.md 4.4: csm-notes-parity reads the notes the native feed takes from the store."""

    def parity(self, state, days_clean=2.5, **kw):
        return {"state": state, "at": fakes.ago(60), "cleanSince": fakes.ago(days_clean * 1440), **kw}

    def test_the_check_is_registered_report_only_with_three_confirmations(self):
        check = by_id()["csm-notes-parity"]
        self.assertIs(check.fix, None)
        self.assertEqual((check.area, check.severity, check.confirm, check.owner),
                         ("workers", "medium", 3, "the tech lead"))

    def test_before_n4_no_row_carries_notes_from(self):
        r = csm_calls.run_notes_parity(ctx({"cockpit_csm_sources": [roster_row("Client A", "task-a", notes_from=None)]}))
        self.assertEqual(r.status, OK)
        self.assertEqual(r.summary, "The native feed still reads the 1-1 notes from Typeform: release N4 is not live.")

    def test_an_empty_roster_could_not_compare_and_never_reads_ok(self):
        # Missing is never zero, and an ok here would clear an open parity incident.
        r = csm_calls.run_notes_parity(ctx({}))
        self.assertEqual(r.status, UNKNOWN)
        self.assertEqual(r.summary, "The client roster lists no client, so the 1-1 notes cannot be compared.")
        self.assertEqual(r.evidence, {"clients": 0})
        self.assertNotIn("not live", r.summary)
        self.assertIn("No client row at all: unknown", by_id()["csm-notes-parity"].threshold)

    def test_every_client_matching_counts_the_clean_days(self):
        rows = [roster_row("Client A", "task-a", self.parity("same")),
                roster_row("Client B", "task-b", self.parity("explained", why="fresh")),
                roster_row("Client C", "task-c", self.parity("explained", why="manual")),
                roster_row("Client D", "task-d", self.parity("none"))]
        r = csm_calls.run_notes_parity(ctx({"cockpit_csm_sources": rows}))
        self.assertEqual(r.status, OK)
        self.assertEqual(r.summary, "Day 2 of 7: the 1-1 notes read from the store match Typeform for 3 clients "
                                    "(2 explained by timing or a hand match).")
        self.assertEqual((r.evidence["same"], r.evidence["explained"], r.evidence["none"]), (1, 2, 1))

    def test_the_first_cycle_reads_day_0_and_the_count_stops_at_7(self):
        r = csm_calls.run_notes_parity(ctx({"cockpit_csm_sources": [roster_row("Client A", "task-a", self.parity("same", 0))]}))
        self.assertTrue(r.summary.startswith("Day 0 of 7:"), r.summary)
        r = csm_calls.run_notes_parity(ctx({"cockpit_csm_sources": [roster_row("Client A", "task-a", self.parity("same", 12))]}))
        self.assertTrue(r.summary.startswith("Day 7 of 7:"), r.summary)

    def test_any_differing_client_warns_with_its_name_and_fields(self):
        rows = [roster_row("Client A", "task-a", self.parity("same", 0)),
                roster_row("Client B", "task-b", self.parity("differs", 0, fields=["notes", "lastNoteOn"])),
                roster_row("Client C", "task-c", self.parity("differs", 0, fields=["defcon"]))]
        r = csm_calls.run_notes_parity(ctx({"cockpit_csm_sources": rows}))
        self.assertEqual(r.status, WARN)
        self.assertEqual(r.summary, "For 2 clients the 1-1 notes read from the store differ from Typeform: Client B, "
                                    "Client C (the note's day, DEFCON, the commitments).")
        self.assertEqual(r.items, ["clientb", "clientc"])
        self.assertIn("roll release N4 back", r.action)
        self.assertIn("hermes/csm-calls/RUNBOOK.md", r.action)

    def test_a_different_newest_form_with_equal_fields_still_warns(self):
        rows = [roster_row("Client B", "task-b", self.parity("differs", 0, fields=[]))]
        r = csm_calls.run_notes_parity(ctx({"cockpit_csm_sources": rows}))
        self.assertEqual(r.status, WARN)
        self.assertIn("(a different newest form)", r.summary)

    def test_native_turns_the_comparison_off(self):
        rows = [roster_row("Client A", "task-a", self.parity("off")), roster_row("Client B", "task-b", self.parity("off"))]
        r = csm_calls.run_notes_parity(ctx({"cockpit_csm_sources": rows}))
        self.assertEqual(r.status, OK)
        self.assertEqual(r.summary, "The 1-1 notes are native; the Typeform comparison is off.")

    def test_a_feed_that_stopped_publishing_is_not_a_notes_difference(self):
        # G6 counts every csm-notes-parity warn or fail incident of 7 days, and native-source-producer already fails
        # after 90 min without a publication. A feed outage (here three days, and the 55 minutes that would have opened
        # an incident at confirm 3) must not warn here, or an outage unrelated to the notes would restart G6's 7 days.
        for published_min in (3 * 1440, 600, 55, 46):
            rows = [roster_row("Client A", "task-a", self.parity("same", 8), published_min=published_min)]
            r = csm_calls.run_notes_parity(ctx({"cockpit_csm_sources": rows}))
            self.assertEqual(r.status, OK, published_min)
            self.assertEqual(r.summary, "Day 7 of 7: the 1-1 notes read from the store match Typeform for 1 clients "
                                        "(0 explained by timing or a hand match).")
            self.assertFalse(r.items)
            self.assertEqual(r.evidence["publishedAt"], fakes.ago(published_min))

    def test_a_missing_publish_time_is_evidence_not_a_reading(self):
        rows = [roster_row("Client A", "task-a", self.parity("same", 3), published_min=None)]
        r = csm_calls.run_notes_parity(ctx({"cockpit_csm_sources": rows}))
        self.assertEqual(r.status, OK)
        self.assertTrue(r.summary.startswith("Day 3 of 7:"), r.summary)
        self.assertIsNone(r.evidence["publishedAt"])
        rows = [roster_row("Client A", "task-a", self.parity("same", 8), published_min=2 * 1440),
                roster_row("Client B", "task-b", self.parity("same", 8), published_min=5)]
        self.assertEqual(csm_calls.run_notes_parity(ctx({"cockpit_csm_sources": rows})).evidence["publishedAt"],
                         fakes.ago(5))

    def test_only_a_differing_client_warns_however_old_the_feed(self):
        rows = [roster_row("Client A", "task-a", self.parity("same", 0), published_min=600),
                roster_row("Client B", "task-b", self.parity("differs", 0, fields=["defcon"]), published_min=600)]
        r = csm_calls.run_notes_parity(ctx({"cockpit_csm_sources": rows}))
        self.assertEqual(r.status, WARN)
        self.assertEqual(r.summary, "For 1 clients the 1-1 notes read from the store differ from Typeform: Client B "
                                    "(DEFCON).")
        self.assertEqual((r.items, r.evidence["differing"]), (["clientb"], ["Client B"]))
        rows = [roster_row("Client A", "task-a", self.parity("off"), published_min=3 * 1440)]
        self.assertEqual(csm_calls.run_notes_parity(ctx({"cockpit_csm_sources": rows})).summary,
                         "The 1-1 notes are native; the Typeform comparison is off.")

    def test_the_check_has_the_contract_s_four_readings_and_no_feed_threshold(self):
        check = by_id()["csm-notes-parity"]
        self.assertFalse(hasattr(csm_calls, "PARITY_FEED_MAX_MIN"))
        self.assertNotRegex(check.threshold, r"\d+ ?min")
        self.assertIn("native-source-producer", check.threshold)

    def test_the_check_reads_the_publish_time_with_the_rows(self):
        seen = []

        class Spy(fakes.FakeDb):
            def rows(self, table, select="*", where=(), order=None, limit=None):
                seen.append((table, select))
                return super().rows(table, select, where, order, limit)

        csm_calls.run_notes_parity(on(Spy({"cockpit_csm_sources": [roster_row("Client A", "task-a", self.parity("same"))]})))
        self.assertEqual(seen, [("cockpit_csm_sources", "data,source_snapshot_at")])


CUTOVER_MIN = 10 * 1440   # the switch-over, ten days before the tests' clock


def native(minutes_ago=CUTOVER_MIN):
    return {"key": "checkin", "provider": "native", "provider_since": fakes.ago(minutes_ago), "updated_at": fakes.ago(1)}


def candidate(rid, hours_ago=30, **kw):
    return {"id": f"fathom:{rid}", "source": "fathom", "source_id": rid, "candidate": True, "starts_at": fakes.ago(hours_ago * 60),
            "status": "held", "settled_reason": None, "task_id": None, "host_email": "recorder@example.invalid",
            "title": "An invented title", **kw}


class Spy(fakes.FakeDb):
    """Remembers each read's table and columns, for the checks that promise what they never read."""

    def __init__(self, tables):
        super().__init__(tables)
        self.selects = []

    def rows(self, table, select="*", where=(), order=None, limit=None):
        self.selects.append((table, select))
        return super().rows(table, select, where, order, limit)


class ImpromptuNotes(unittest.TestCase):
    """docs/forms/STAGE2B-CONTRACT.md 4.10: an impromptu call needs a client and notes, or to be set aside."""

    def run_it(self, calls, form=None):
        return csm_calls.run_impromptu(on(fakes.FakeDb({"cockpit_forms": [form or native()], "cockpit_csm_calls": calls})))

    def test_the_check_is_as_the_contract_says(self):
        c = by_id()["csm-impromptu-notes"]
        self.assertEqual((c.area, c.name, c.severity, c.confirm, c.owner, c.fix),
                         ("workers", "Impromptu calls get a client", "medium", 2, "the CSM lead", None))
        self.assertEqual(c.means, "Every impromptu call the CSM records gets a client and 1-1 notes, or is set aside as "
                                  "not a 1-1 call.")

    def test_before_the_cut_over_nothing_is_read_or_counted(self):
        db = Spy({"cockpit_forms": [TYPEFORM], "cockpit_csm_calls": [candidate("197103123")]})
        r = csm_calls.run_impromptu(on(db))
        self.assertEqual(r.status, OK)
        self.assertEqual(r.summary, "Counted from the switch-over to 1-1 notes in the cockpit; not switched yet.")
        self.assertEqual(r.evidence["candidates_without_notes_24h"], None)
        self.assertNotIn("cockpit_csm_calls", [t for t, _ in db.selects])

    def test_a_registry_without_the_checkin_row_is_not_read_as_not_switched(self):
        with self.assertRaises(csm_calls.SourceError):
            csm_calls.run_impromptu(on(fakes.FakeDb({"cockpit_csm_calls": [candidate("197103123")]})))

    def test_none_left_reads_ok(self):
        r = self.run_it([])
        self.assertEqual(r.status, OK)
        self.assertEqual(r.summary, "0 impromptu calls since the switch-over all have 1-1 notes or a client.")
        self.assertEqual(r.evidence["candidates_without_notes_24h"], 0)

    def test_what_is_left_out(self):
        uncounted = [
            candidate("1", hours_ago=23),                                     # under a day: still time
            candidate("2", hours_ago=CUTOVER_MIN / 60 + 1),                   # before the switch-over
            candidate("3", status="gone"),                                    # the recording is gone
            candidate("4", settled_reason="not_client"),                      # set aside as not a 1-1 call
            candidate("5", candidate=False),                                  # placed, or its notes attached it
            candidate("6", source="ghl_appointment"),                         # not a recording
        ]
        r = self.run_it(uncounted)
        self.assertEqual(r.status, OK, r.summary)
        self.assertEqual(r.evidence["candidates_without_notes_24h"], 0)

    def test_a_candidate_over_a_day_old_warns_with_its_day_and_id(self):
        r = self.run_it([candidate("197103123", hours_ago=26)])
        self.assertEqual(r.status, WARN)
        # The tests' clock is 3 Oct 17:00 Kuwait; 26 hours before it is 2 Oct.
        self.assertEqual(r.summary, "1 impromptu call older than a day has no client and no 1-1 notes: 2 Oct. Put each on its "
                                    "client and write its notes, or mark it Not a 1-1 call.")
        self.assertEqual(r.items, ["fathom_197103123"])
        self.assertEqual(r.action, "Open Today: each impromptu call has Place it and Not a 1-1 call.")

    def test_a_recording_id_survives_what_the_store_does_to_items_and_evidence(self):
        # guard/store.py runs clean() on items and clean_obj() on evidence: a bare 9-digit id reads as a phone number.
        r = self.run_it([candidate("197103123"), candidate("197103124")])
        self.assertEqual(sorted({clean(i, 120) for i in r.items}), ["fathom_197103123", "fathom_197103124"])
        self.assertEqual(clean_obj(r.evidence)["recordingIds"], ["fathom_197103123", "fathom_197103124"])

    def test_many_read_oldest_first_with_ten_ids_at_most_and_nothing_private(self):
        calls = [candidate(str(197103100 + i), hours_ago=26 + 24 * (i % 3)) for i in range(12)]
        db = Spy({"cockpit_forms": [native()], "cockpit_csm_calls": calls})
        r = csm_calls.run_impromptu(on(db))
        self.assertEqual(r.status, WARN)
        self.assertTrue(r.summary.startswith("12 impromptu calls older than a day have no client and no 1-1 notes: "
                                             "30 Sep, 1 Oct, 2 Oct."), r.summary)
        self.assertEqual(len(r.items), 12)
        self.assertEqual(set(r.evidence), {"cutoverAt", "candidates_without_notes_24h", "oldestDay", "recordingIds"})
        self.assertEqual(r.evidence["oldestDay"], "2026-09-30")
        self.assertEqual(len(r.evidence["recordingIds"]), 10)
        said = str(r.evidence) + r.summary
        self.assertNotIn("example.invalid", said)
        self.assertNotIn("invented title", said)
        self.assertIn(("cockpit_csm_calls", "id,source_id,starts_at,status,settled_reason"), db.selects)
        self.assertNotIn("cockpit_form_responses", [t for t, _ in db.selects])

    def test_the_share_check_carries_the_count_and_keeps_its_own_reading(self):
        calls = [call(i) for i in range(4)] + [candidate("197103123", hours_ago=26, task_id=None)]
        r = csm_calls.run_unmatched(on(fakes.FakeDb({"cockpit_forms": [native()], "cockpit_csm_calls": calls})))
        self.assertEqual(r.status, OK)
        self.assertEqual(r.evidence["candidates_without_notes_24h"], 1)
        self.assertEqual(csm_calls.run_unmatched(ctx({"cockpit_csm_calls": calls})).evidence["candidates_without_notes_24h"], None)
        only = [candidate("197103123", hours_ago=26)]
        r = csm_calls.run_unmatched(on(fakes.FakeDb({"cockpit_forms": [native()], "cockpit_csm_calls": only})))
        self.assertEqual(r.status, UNKNOWN)
        self.assertEqual(r.evidence["candidates_without_notes_24h"], 1)


def late_form(token, minutes_ago, task_id=None, typed=None):
    return {"token": token, "form_id": "fRokTITH", "form_kind": "checkin_late", "task_id": task_id, "typed_client": typed,
            "submitted_at": fakes.ago(minutes_ago), "answers": {"notes": "An invented answer"}}


class LateTypeformNotes(unittest.TestCase):
    """docs/forms/STAGE2B-CONTRACT.md 4.9: csm-checkin-form warns about 1-1 notes sent in Typeform after the switch-over."""

    FRESH = {"form_id": "cockpit-checkin", "form_kind": "checkin", "submitted_at": fakes.ago(60)}
    BOARD = [{"table_name": "clients", "data": {"taskId": "task-a", "name": "City Wood", "bucket": "management"}}]

    def run_it(self, forms, form=None):
        return csm_calls.run_checkin_form(on(fakes.FakeDb({
            "cockpit_forms": [form or native()], "cockpit_csm_call_forms": forms, "cockpit_csm_sources": self.BOARD})))

    def test_a_late_form_warns_with_the_contract_s_sentence(self):
        r = self.run_it([self.FRESH, late_form("tokenAAAA", 90, task_id="task-a"), late_form("tokenBBBB", 2000, typed="Typed Co")])
        self.assertEqual(r.status, WARN)
        # 90 minutes before the tests' clock is 3 Oct 15:30 Kuwait.
        self.assertEqual(r.summary, "2 1-1 notes arrived in Typeform after the switch-over, newest 3 Oct 15:30 Kuwait time: City "
                                    "Wood, Typed Co. Re-enter them in the 1-1 notes in the cockpit and check that fRokTITH is "
                                    "closed.")
        self.assertEqual(sorted(r.items), ["tokenAAAA", "tokenBBBB"])
        self.assertEqual(r.evidence["late"], 2)
        self.assertNotIn("invented answer", str(r.evidence))

    def test_one_late_form_reads_in_the_singular_and_a_form_naming_no_client_says_so(self):
        r = self.run_it([self.FRESH, late_form("tokenAAAA", 90)])
        self.assertTrue(r.summary.startswith("1 1-1 note arrived in Typeform after the switch-over"), r.summary)
        self.assertIn("no client named", r.summary)

    def test_only_the_last_14_days_after_the_cut_over_count(self):
        old = late_form("tokenOLD1", 15 * 1440, task_id="task-a")
        since_long_ago = native(30 * 1440)
        r = self.run_it([self.FRESH, old], since_long_ago)
        self.assertEqual(r.status, OK, r.summary)
        self.assertEqual(r.evidence["late"], 0)
        # A second switch-over: what came before it is not late under it.
        r = self.run_it([self.FRESH, late_form("tokenOLD2", 2 * 1440)], native(1440))
        self.assertEqual(r.status, OK, r.summary)

    def test_before_the_cut_over_the_late_rows_are_not_read(self):
        db = Spy({"cockpit_forms": [TYPEFORM], "cockpit_csm_call_forms": [self.FRESH, late_form("tokenAAAA", 90)]})
        r = csm_calls.run_checkin_form(on(db))
        self.assertEqual(r.status, OK)
        self.assertEqual(r.evidence["late"], None)
        self.assertEqual([s for t, s in db.selects if t == "cockpit_csm_call_forms"], ["submitted_at"])

    def test_freshness_keeps_reading_checkin_only(self):
        stale = dict(self.FRESH, submitted_at=fakes.ago(8 * 1440))
        r = self.run_it([stale, late_form("tokenAAAA", 90)])
        self.assertEqual(r.status, WARN)
        self.assertIn("after the switch-over", r.summary)
        self.assertIn("came in 8.0 days ago", r.summary)
        self.assertEqual(self.run_it([late_form("tokenAAAA", 90)]).status, FAIL)
        self.assertEqual(self.run_it([stale]).status, WARN)
        self.assertNotIn("switch-over", self.run_it([stale]).summary)


class KickoffWebhook(unittest.TestCase):
    """docs/forms/STAGE2B-CONTRACT.md section 6: forms-kickoff-webhook, low, confirm 2."""

    def state(self, registered_min=7 * 1440, **detail):
        return {"key": "forms-door:kickoff", "note": "The kickoff webhook is registered.",
                "detail": {"registered": True, "registeredAt": fakes.ago(registered_min), "lastDelivery": fakes.ago(5),
                           "outcome": "recorded", **detail}}

    def kickoff(self, i, minutes_ago, source="typeform_sync", form_key="kickoff"):
        return {"id": f"response-{i}", "form_key": form_key, "source": source, "submitted_at": fakes.ago(minutes_ago),
                "hidden": {"onboarding_client_id": "task-a"}, "answers": {"token": "tokenAAAA"}}

    def run_it(self, state, responses):
        db = Spy({"cockpit_sync_state": [state] if state else [], "cockpit_form_responses": responses})
        return csm_calls.run_kickoff_webhook(on(db)), db

    def test_the_check_is_as_the_contract_says(self):
        c = by_id()["forms-kickoff-webhook"]
        self.assertEqual((c.severity, c.confirm, c.fix), ("low", 2, None))

    def test_not_registered_reads_ok_and_reads_no_response(self):
        for state in (None, {"key": "forms-door:kickoff", "note": "n", "detail": {"registered": False}}):
            r, db = self.run_it(state, [self.kickoff(1, 90)])
            self.assertEqual(r.status, OK)
            self.assertEqual(r.summary, "Not registered yet: kickoffs arrive by the 15-minute read.")
            self.assertNotIn("cockpit_form_responses", [t for t, _ in db.selects])

    def test_a_kickoff_the_read_stored_warns(self):
        r, db = self.run_it(self.state(), [self.kickoff(1, 90), self.kickoff(2, 120)])
        self.assertEqual(r.status, WARN)
        self.assertEqual(r.summary, "Typeform's webhook missed 2 kickoffs in 24 h; the 15-minute read stored them.")
        self.assertEqual(sorted(r.items), ["response-1", "response-2"])
        self.assertIn(("cockpit_form_responses", "id,submitted_at"), db.selects)

    def test_what_is_not_a_missed_kickoff(self):
        for row in (self.kickoff(1, 90, source="typeform_webhook"),       # the webhook stored it
                    self.kickoff(2, 20),                                  # under 30 minutes: the read may have won by a hair
                    self.kickoff(3, 25 * 60),                             # over 24 hours
                    self.kickoff(4, 90, form_key="checkin")):             # not a kickoff
            r, _ = self.run_it(self.state(), [row])
            self.assertEqual(r.status, OK, row)
        self.assertEqual(self.run_it(self.state(), [])[0].summary, "Typeform's webhook missed no kickoff in 24 h.")

    def test_kickoffs_stored_before_registering_came_by_the_read_on_purpose(self):
        r, _ = self.run_it(self.state(registered_min=60), [self.kickoff(1, 90)])
        self.assertEqual(r.status, OK, r.summary)
        r, _ = self.run_it(self.state(registered_min=100), [self.kickoff(1, 90)])
        self.assertEqual(r.status, WARN)
        self.assertEqual(r.summary, "Typeform's webhook missed 1 kickoff in 24 h; the 15-minute read stored it.")

    def test_a_registration_with_no_time_counts_the_whole_24_hours(self):
        state = self.state()
        del state["detail"]["registeredAt"]
        self.assertEqual(self.run_it(state, [self.kickoff(1, 90)])[0].status, WARN)

    def test_csm_forms_record_is_watched(self):
        self.assertEqual(csm_calls.CSM_KEYS["csm-forms-record"],
                         (45, "kickoff and Blueprint records in the forms tables"))
        rows = [{"key": k, "ok": True, "last_ok_at": fakes.ago(2), "note": "ok"} for k in csm_calls.CSM_KEYS]
        self.assertEqual(csm_calls.run_freshness(ctx({"cockpit_sync_state": rows})).status, OK)
        late = [dict(r, last_ok_at=fakes.ago(50)) if r["key"] == "csm-forms-record" else r for r in rows]
        r = csm_calls.run_freshness(ctx({"cockpit_sync_state": late}))
        self.assertEqual((r.status, r.items), (FAIL, ["csm-forms-record-stale"]))
        absent = [r for r in rows if r["key"] != "csm-forms-record"]
        self.assertEqual(csm_calls.run_freshness(ctx({"cockpit_sync_state": absent})).items, ["csm-forms-record-never-run"])

    @staticmethod
    def synced(**detail):
        rows = [{"key": k, "ok": True, "last_ok_at": fakes.ago(2), "note": "ok", "detail": {}} for k in csm_calls.CSM_KEYS]
        for r in rows:
            if r["key"] == "csm-forms-record":
                r["detail"] = detail
                r["note"] = "Forms tables: 8 rows could not be recorded; the next read tries again."
        return rows

    def test_rows_the_sweep_could_not_record_warn_while_the_row_stays_ok(self):
        # The sweep counts per-row failures and the worker keeps the row ok (Z15). Before this, 8 refused rows on every
        # run read "All 9 CSM call sources synced on time."
        r = csm_calls.run_freshness(ctx({"cockpit_sync_state": self.synced(errors=8)}))
        self.assertEqual((r.status, r.items), (WARN, ["csm-forms-record-errors"]))
        self.assertEqual(r.summary, "CSM call sync: 8 kickoff or Blueprint rows were not recorded in the forms tables on "
                                    "the last read; every source synced on time.")
        self.assertEqual(r.evidence["csm-forms-record"]["errors"], 8)
        self.assertIn("Kickoff and Blueprint records", r.action)
        self.assertIn("Nothing was sent", r.action)
        one = csm_calls.run_freshness(ctx({"cockpit_sync_state": self.synced(errors=1)}))
        self.assertIn("1 kickoff or Blueprint row was not recorded", one.summary)

    def test_the_warning_names_the_sweeps_first_code_and_nothing_else(self):
        r = csm_calls.run_freshness(ctx({"cockpit_sync_state": self.synced(errors=2, firstError="23505")}))
        self.assertIn("on the last read (first error 23505);", r.summary)
        for odd in ("duplicate key for a client", 23505, None, ""):
            with self.subTest(firstError=odd):
                r = csm_calls.run_freshness(ctx({"cockpit_sync_state": self.synced(errors=2, firstError=odd)}))
                self.assertEqual(r.status, WARN)
                self.assertNotIn("first error", r.summary)
                self.assertNotIn("duplicate", r.summary)

    def test_no_errors_or_a_count_that_is_not_one_reads_as_synced(self):
        for detail in ({"errors": 0}, {}, {"errors": None}, {"errors": True}, {"errors": "8"}, {"errors": 1.5}, {"errors": -1}):
            with self.subTest(detail=detail):
                r = csm_calls.run_freshness(ctx({"cockpit_sync_state": self.synced(**detail)}))
                self.assertEqual((r.status, r.summary), (OK, f"All {len(csm_calls.CSM_KEYS)} CSM call sources synced on time."))
        rows = self.synced()
        next(x for x in rows if x["key"] == "csm-forms-record")["detail"] = "not an object"
        self.assertEqual(csm_calls.run_freshness(ctx({"cockpit_sync_state": rows})).status, OK)

    def test_a_failed_source_still_fails_and_the_errors_are_named_beside_it(self):
        rows = self.synced(errors=3)
        next(x for x in rows if x["key"] == "csm-fathom").update(ok=False, note="Fathom failed (503)")
        r = csm_calls.run_freshness(ctx({"cockpit_sync_state": rows}))
        self.assertEqual((r.status, r.items), (FAIL, ["csm-fathom-failing", "csm-forms-record-errors"]))
        self.assertIn("3 kickoff or Blueprint rows were not recorded", r.summary)
        # A record row that failed reads as failed: its old count is not read.
        rows = self.synced(errors=3)
        next(x for x in rows if x["key"] == "csm-forms-record").update(ok=False, note="Supabase failed (404)")
        r = csm_calls.run_freshness(ctx({"cockpit_sync_state": rows}))
        self.assertEqual((r.status, r.items), (FAIL, ["csm-forms-record-failing"]))
        self.assertNotIn("not recorded", r.summary)


class ReadmeOrder(unittest.TestCase):
    """The README's table says it is generated from guardian.py checks --json; __init__.py says order is the report's."""

    def test_stage_2b_rows_read_in_the_order_the_code_reports_them(self):
        text = (Path(__file__).resolve().parents[1] / "README.md").read_text(encoding="utf8")
        listed = [m.group(1) for m in re.finditer(r"^\| `([a-z0-9-]+)` \|", text, re.M)]
        code = [c.id for c in checks_all()]
        want = ["csm-checkin-form", "csm-notes-parity", "csm-fathom-webhook", "csm-impromptu-notes", "forms-kickoff-webhook",
                "client-messages", "client-messages-read-back", "client-messages-read-back-stopped", "client-messages-g5"]
        self.assertEqual([c for c in code if c in want], want)
        self.assertEqual([c for c in listed if c in want], want)
