"""The loop: dedupe, confirmation, unknown, folding, report-only, the fix rules, alerts and the state file."""
import json
import os
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from tests import fakes
from guard import alerts, engine
from guard.model import FAIL, OK, UNKNOWN, WARN, Check, Fix, FixOutcome, Result, fail, ok, unknown
from guard.store import Store

KUWAIT_NIGHT = fakes.NOW.replace(hour=22)            # 01:00 Kuwait, Sunday
FRIDAY_NOON = fakes.NOW - timedelta(days=1)          # Friday 17:00 Kuwait


class Box:
    """A check whose reading the test sets, and a fix that counts its calls."""

    def __init__(self, cid="demo-check", *, fixable=True, confirm=1, urgent=False, quiet=None, alert=True, max_attempts=5):
        self.result = ok("fine")
        self.applied = 0
        self.outcome = FixOutcome(True, "started one catch-up run")
        fix = Fix(name="catch-up:demo", describe="start one catch-up run of demo", apply=self._apply,
                  max_attempts=max_attempts) if fixable else None
        self.check = Check(id=cid, area="test", name="Demo job", means="Demo runs.", severity="high", reads="a row",
                           threshold="old: fail", run=lambda ctx: self.result, fix=fix, confirm=confirm, urgent=urgent,
                           quiet_because=quiet, alert=alert, action="Read the demo log.")

    def _apply(self, ctx, result):
        self.applied += 1
        return self.outcome


class Harness:
    def __init__(self, checks, *, mode="report-only", db=None, dry_run=False, remote=False, posted=None):
        self.tmp = Path(tempfile.mkdtemp())
        self.checks = checks
        self.mode = mode
        self.db = db if db is not None else fakes.FakeDb({"cockpit_guardian_incidents": []})
        self.store = Store(self.tmp / "state.json", self.db, write_db=not dry_run)
        self.store.load()
        self.dry_run = dry_run
        self.remote = remote
        self.posted = posted if posted is not None else []
        self.snap = fakes.snapshot()

    def scan(self, now=fakes.NOW, fix=True):
        c = fakes.ctx(self.tmp, db=self.db, host=fakes.FakeHost(self.snap, remote=self.remote), now=now, mode=self.mode,
                      dry_run=self.dry_run, remote=self.remote, state=self.store.state)
        slack = alerts.Slack("xoxb-test", "C1", post=lambda body: self.posted.append(body["text"]))
        out = engine.scan(c, self.store, self.checks, alerts.Outbox(slack, dry_run=self.dry_run), fix=fix)
        self.store.save()
        return out


class Dedupe(unittest.TestCase):
    def test_one_incident_per_check_however_many_scans(self):
        b = Box()
        h = Harness([b.check])
        b.result = fail("Demo has not run for 3 h.")
        first = h.scan()
        h.scan(fakes.NOW + timedelta(minutes=5))
        h.scan(fakes.NOW + timedelta(minutes=10))
        self.assertEqual(len(first.opened), 1)
        self.assertEqual(list(h.store.open), ["demo-check"])
        self.assertEqual(h.store.open["demo-check"]["seen"], 3)
        self.assertEqual(len(h.posted), 1, h.posted)

    def test_confirm_waits_for_bad_readings_in_a_row(self):
        b = Box(confirm=3)
        h = Harness([b.check])
        b.result = fail("low memory")
        h.scan()
        h.scan(fakes.NOW + timedelta(minutes=5))
        self.assertEqual(h.store.open, {})
        b.result = ok("fine")
        h.scan(fakes.NOW + timedelta(minutes=10))
        b.result = fail("low memory")
        h.scan(fakes.NOW + timedelta(minutes=15))
        h.scan(fakes.NOW + timedelta(minutes=20))
        self.assertEqual(h.store.open, {})
        h.scan(fakes.NOW + timedelta(minutes=25))
        self.assertIn("demo-check", h.store.open)

    def test_resolve_names_what_fixed_it(self):
        b = Box()
        h = Harness([b.check], mode="fix")
        b.result = fail("late", data={"stale": True})
        h.scan()
        self.assertEqual(b.applied, 1)
        b.result = ok("fine")
        out = h.scan(fakes.NOW + timedelta(minutes=5))
        self.assertEqual(len(out.resolved), 1)
        self.assertIn("catch-up:demo", out.resolved[0]["resolved_by"])
        self.assertTrue(any(t.startswith("[guardian] Resolved: Demo job") for t in h.posted))

    def test_cleared_by_itself(self):
        b = Box(fixable=False)
        h = Harness([b.check])
        b.result = fail("late")
        h.scan()
        b.result = ok("fine")
        out = h.scan(fakes.NOW + timedelta(minutes=5))
        self.assertIn("without the guardian", out.resolved[0]["resolved_by"])


class Unknowns(unittest.TestCase):
    def test_unknown_opens_after_three_scans(self):
        b = Box()
        h = Harness([b.check])
        b.result = unknown("Could not be checked: the table answered 500.")
        h.scan()
        h.scan(fakes.NOW + timedelta(minutes=5))
        self.assertEqual(h.store.open, {})
        h.scan(fakes.NOW + timedelta(minutes=10))
        self.assertEqual(h.store.open["demo-check"]["level"], UNKNOWN)

    def test_coverage_gap_never_opens(self):
        b = Box()
        h = Harness([b.check])
        b.result = unknown("needs SUPABASE_ACCESS_TOKEN", coverage_gap=True)
        for i in range(5):
            h.scan(fakes.NOW + timedelta(minutes=5 * i))
        self.assertEqual(h.store.open, {})

    def test_unknown_never_resolves_an_open_incident(self):
        b = Box()
        h = Harness([b.check])
        b.result = fail("late")
        h.scan()
        b.result = unknown("source down")
        h.scan(fakes.NOW + timedelta(minutes=5))
        self.assertIn("demo-check", h.store.open)
        self.assertEqual(h.store.open["demo-check"]["level"], FAIL)

    def test_a_crashing_check_is_unknown_and_the_scan_goes_on(self):
        boom = Check(id="boom-check", area="t", name="Boom", means="m", severity="low", reads="r", threshold="t",
                     run=lambda ctx: 1 / 0)
        b = Box()
        b.result = ok("fine")
        out = Harness([boom, b.check]).scan()
        self.assertEqual(out.findings[0].result.status, UNKNOWN)
        self.assertIn("ZeroDivisionError", out.findings[0].result.summary)
        self.assertEqual(out.findings[1].result.status, OK)


class Folding(unittest.TestCase):
    def test_child_of_a_failing_parent_opens_nothing(self):
        parent, child = Box("claude-signin", fixable=False), Box("desk-followups", fixable=False)
        h = Harness([parent.check, child.check])
        parent.result = fail("signed out")
        child.result = fail("followups failed", caused_by="claude-signin")
        h.scan()
        self.assertEqual(list(h.store.open), ["claude-signin"])

    def test_child_opens_when_the_parent_is_fine(self):
        parent, child = Box("claude-signin", fixable=False), Box("desk-followups", fixable=False)
        h = Harness([parent.check, child.check])
        child.result = fail("followups failed", caused_by="claude-signin")
        h.scan()
        self.assertIn("desk-followups", h.store.open)


class FixRules(unittest.TestCase):
    def test_report_only_never_fixes(self):
        b = Box()
        h = Harness([b.check], mode="report-only")
        b.result = fail("late", data={"stale": True})
        out = h.scan()
        for i in range(1, 30):
            h.scan(fakes.NOW + timedelta(hours=i))
        self.assertEqual(b.applied, 0)
        self.assertTrue(any(f.startswith("would start one catch-up run") for f in out.fixes))
        self.assertIn("report-only mode, so it did not start one catch-up run", h.posted[0])

    def test_dry_run_and_remote_never_fix_even_in_fix_mode(self):
        for kw in ({"dry_run": True}, {"remote": True}):
            b = Box()
            h = Harness([b.check], mode="fix", **kw)
            b.result = fail("late")
            h.scan()
            self.assertEqual(b.applied, 0, kw)

    def test_once_per_incident_per_hour_then_backoff(self):
        b = Box()
        b.outcome = FixOutcome(False, "the job is still late")
        h = Harness([b.check], mode="fix")
        b.result = fail("late")
        h.scan()
        h.scan(fakes.NOW + timedelta(minutes=30))
        self.assertEqual(b.applied, 1)
        h.scan(fakes.NOW + timedelta(minutes=61))
        self.assertEqual(b.applied, 2)
        h.scan(fakes.NOW + timedelta(minutes=61 + 90))       # second wait is 2 h
        self.assertEqual(b.applied, 2)
        h.scan(fakes.NOW + timedelta(minutes=61 + 121))
        self.assertEqual(b.applied, 3)
        attempts = h.store.open["demo-check"]["fix_attempts"]
        self.assertEqual(len(attempts), 3)
        self.assertTrue(all(a["fix"] == "catch-up:demo" for a in attempts))

    def test_gives_up_after_max_attempts(self):
        b = Box(max_attempts=2)
        b.outcome = FixOutcome(False, "no")
        h = Harness([b.check], mode="fix")
        b.result = fail("late")
        for hours in range(0, 60, 1):
            h.scan(fakes.NOW + timedelta(hours=hours))
        self.assertEqual(b.applied, 2)
        self.assertIn("gave up", h.store.open["demo-check"]["fix_note"])

    def test_a_new_incident_gets_a_fresh_hour(self):
        b = Box()
        h = Harness([b.check], mode="fix")
        b.result = fail("late")
        h.scan()
        b.result = ok("fine")
        h.scan(fakes.NOW + timedelta(minutes=5))
        b.result = fail("late again")
        h.scan(fakes.NOW + timedelta(minutes=10))
        self.assertEqual(b.applied, 2)

    def test_waits_while_the_reliability_fixer_just_acted(self):
        b = Box()
        h = Harness([b.check], mode="fix")
        h.snap["fixer"] = {"mtime": int(fakes.NOW.timestamp()) - 300}
        b.result = fail("late")
        out = h.scan()
        self.assertEqual(b.applied, 0)
        self.assertTrue(any("reliability fixer" in n for n in out.notes))

    def test_a_fix_that_raises_is_recorded_not_raised(self):
        b = Box()
        b.check.fix.apply = lambda ctx, res: (_ for _ in ()).throw(RuntimeError("disk full"))
        h = Harness([b.check], mode="fix")
        b.result = fail("late")
        h.scan()
        att = h.store.open["demo-check"]["fix_attempts"][0]
        self.assertFalse(att["ok"])
        self.assertIn("disk full", att["detail"])


class Alerts(unittest.TestCase):
    def test_wording(self):
        b = Box()
        h = Harness([b.check])
        b.result = fail("Demo has not run for 3 h — call +965 9999 8888 or ali@example.com; Bearer sk-abcdefghijk",
                        since=fakes.NOW - timedelta(hours=3))
        h.scan()
        text = h.posted[0]
        self.assertTrue(text.startswith("[guardian] Broken: Demo job"))
        for part in ("What broke:", "Since:", "What the guardian tried:", "What a person must do (the CEO): Read the demo log."):
            self.assertIn(part, text)
        self.assertIn("Kuwait time (3.0 h)", text)
        for bad in ("—", "9999", "ali@example.com", "sk-abcdefghijk"):
            self.assertNotIn(bad, text)

    def test_quiet_hours_hold_non_urgent_until_morning(self):
        b = Box()
        h = Harness([b.check])
        b.result = fail("late")
        h.scan(KUWAIT_NIGHT)
        self.assertEqual(h.posted, [])
        self.assertIn("09:00", h.store.open["demo-check"]["alert_note"])
        h.scan(KUWAIT_NIGHT + timedelta(hours=9))      # 10:00 Kuwait, Sunday
        self.assertEqual(len(h.posted), 1)

    def test_friday_holds_too(self):
        self.assertFalse(alerts.in_hours(FRIDAY_NOON))
        self.assertTrue(alerts.in_hours(fakes.NOW))

    def test_urgent_goes_at_night(self):
        b = Box(urgent=True)
        h = Harness([b.check])
        b.result = fail("No CEO section refreshed for 50 min")
        h.scan(KUWAIT_NIGHT)
        self.assertEqual(len(h.posted), 1)

    def test_six_hour_throttle_holds_a_flapping_check(self):
        b = Box(fixable=False)
        h = Harness([b.check])
        b.result = fail("late")
        h.scan()
        b.result = ok("fine")
        h.scan(fakes.NOW + timedelta(minutes=5))
        b.result = fail("late again")
        h.scan(fakes.NOW + timedelta(minutes=10))
        self.assertEqual(len(h.posted), 2)        # opened + resolved; the reopen is held
        self.assertIn("flaps", h.store.open["demo-check"]["alert_note"])
        h.scan(fakes.NOW + timedelta(hours=3))        # 20:00 Kuwait, still inside the 6 hours
        self.assertEqual(len(h.posted), 2)
        h.scan(fakes.NOW + timedelta(hours=18))       # 11:00 Kuwait the next day
        self.assertEqual(len(h.posted), 3)

    def test_resolved_message_only_when_the_open_one_went(self):
        b = Box(fixable=False)
        h = Harness([b.check])
        b.result = fail("late")
        h.scan(KUWAIT_NIGHT)
        b.result = ok("fine")
        h.scan(KUWAIT_NIGHT + timedelta(minutes=5))
        h.scan(KUWAIT_NIGHT + timedelta(hours=9))
        self.assertEqual(h.posted, [])

    def test_a_failure_is_loud_even_where_convex_once_alerted(self):
        sections = Box("ceo-sections", fixable=False, urgent=True)
        desk = Box("desk-recordings", fixable=False, quiet="convex")
        mirror = Box("sales-mirror", fixable=False, quiet="convex-sales-watch")
        h = Harness([sections.check, desk.check, mirror.check])
        desk.result = fail("recordings late")
        mirror.result = fail("mirror stale")
        h.scan()
        self.assertEqual(len(h.posted), 2)
        self.assertIsNone(engine.covered(desk.check, {"ceo-sections": ok("fine"), "convex-ceo-sections": ok("fine")}))

    def test_summary_only_checks_never_post(self):
        b = Box(alert=False)
        h = Harness([b.check])
        b.result = Result(WARN, "old copy")
        h.scan()
        self.assertEqual(h.posted, [])
        self.assertIn("demo-check", h.store.open)

    def test_dry_run_posts_nothing_and_writes_no_rows(self):
        b = Box()
        db = fakes.FakeDb({"cockpit_guardian_incidents": []})
        h = Harness([b.check], dry_run=True, db=db)
        b.result = fail("late")
        out = h.scan()
        self.assertEqual(h.posted, [])
        self.assertEqual(len(out.would_post), 1)
        self.assertEqual(db.writes, [])


class StateFallback(unittest.TestCase):
    def test_supabase_down_keeps_the_incident_in_the_state_file_and_sends_it_later(self):
        b = Box()
        db = fakes.FakeDb({"cockpit_guardian_incidents": []}, down=True)
        h = Harness([b.check], db=db)
        b.result = fail("late")
        out = h.scan()
        self.assertEqual(len(out.opened), 1)
        self.assertTrue(any("wait in the state file" in n for n in out.notes))
        saved = json.loads((h.tmp / "state.json").read_text())
        self.assertIn("demo-check", saved["open"])
        self.assertEqual(len(saved["pending_db"]), 1)
        self.assertEqual(oct(os.stat(h.tmp / "state.json").st_mode & 0o777), "0o600")
        db.down = False
        h.scan(fakes.NOW + timedelta(minutes=5))
        self.assertEqual(h.store.state["pending_db"], [])
        self.assertTrue(db.writes and db.writes[-1][1]["check_id"] == "demo-check")

    def test_lost_state_file_recovers_open_incidents_from_supabase(self):
        b = Box()
        db = fakes.FakeDb({"cockpit_guardian_incidents": []})
        h = Harness([b.check], db=db)
        b.result = fail("late")
        h.scan()
        row = db.writes[-1][1]
        db.tables["cockpit_guardian_incidents"] = [row]
        (h.tmp / "state.json").unlink()
        fresh = Store(h.tmp / "state.json", db)
        fresh.load()
        self.assertEqual(fresh.open["demo-check"]["id"], row["id"])

    def test_damaged_state_file_is_kept_aside(self):
        tmp = Path(tempfile.mkdtemp())
        (tmp / "state.json").write_text("{not json")
        s = Store(tmp / "state.json", None)
        s.load()
        self.assertEqual(s.open, {})
        self.assertTrue((tmp / "state.json.damaged").exists())

    def test_rows_are_written_resolved_before_open(self):
        b = Box()
        db = fakes.FakeDb({"cockpit_guardian_incidents": []})
        h = Harness([b.check], db=db)
        b.result = fail("late")
        h.scan()
        b.result = ok("fine")
        h.scan(fakes.NOW + timedelta(minutes=5))
        statuses = [w[1]["status"] for w in db.writes]
        self.assertEqual(statuses[-1], "resolved")


class Retired(unittest.TestCase):
    def test_an_incident_under_a_retired_id_closes_once_without_a_message(self):
        old, new = Box("convex-deployments", fixable=False), Box("ceo-sections", fixable=False)
        db = fakes.FakeDb({"cockpit_guardian_incidents": []})
        h = Harness([old.check], db=db)
        old.result = fail("adorable-seahorse-418 answers 503")
        h.scan()
        self.assertEqual(len(h.posted), 1)
        h.store.state["streaks"]["hermes-ask-ai"] = {"bad": 2, "unknown": 0, "ok": 0}
        h.checks = [new.check]
        out = h.scan(fakes.NOW + timedelta(minutes=5))
        self.assertEqual(h.store.open, {})
        self.assertEqual([(i["check_id"], i["folded_into"]) for i in out.resolved], [("convex-deployments", "retired")])
        self.assertIn("Convex is paused", out.resolved[0]["resolved_by"])
        self.assertEqual(len(h.posted), 1)
        self.assertNotIn("hermes-ask-ai", h.store.state["streaks"])
        self.assertEqual(db.writes[-1][1]["check_id"], "convex-deployments")
        self.assertEqual(db.writes[-1][1]["status"], "resolved")
        again = h.scan(fakes.NOW + timedelta(minutes=10))
        self.assertEqual(again.resolved, [])

    def test_a_registered_check_is_never_retired(self):
        b = Box("hermes-ask-ai", fixable=False)
        h = Harness([b.check])
        b.result = fail("stuck")
        h.scan()
        h.scan(fakes.NOW + timedelta(minutes=5))
        self.assertIn("hermes-ask-ai", h.store.open)


if __name__ == "__main__":
    unittest.main()
