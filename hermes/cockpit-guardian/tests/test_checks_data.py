"""Thresholds of the checks that read Creative Triage, the CEO sections included."""
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from tests import fakes
import checks as checks_mod
from checks import client_messages, edge_functions, pg_cron, queues, sections, supabase, syncs, whatsapp, worker_status
from guard import engine
from guard.context import SourceError
from guard.model import FAIL, NOT_DEPLOYED, OK, PAUSED, UNKNOWN, WARN, Result

SIGNED_OUT = "The Claude sign-in on the VPS has lapsed, so nothing can be drafted. run claude, then /login"


# The requests writer and the task mirror (docs/requests/CONTRACT.md section 7).
# The request writer's rows and, since Stage 2b, the 1-1 notes machinery's: every run_jobs key added after 2a.
REQUEST_JOBS = ("clickup-writeback:requests", "task-mirror:delta", "task-mirror:seats", "clickup-writeback:forms",
                "forms-effects-kick", "csm-forms-record")


def make(tables=None, **kw):
    tmp = Path(tempfile.mkdtemp())
    db = kw.pop("db", None) or fakes.FakeDb(tables or {})
    return fakes.ctx(tmp, db=db, host=fakes.FakeHost(fakes.snapshot()), **kw)


def desk(job, ok=True, minutes=1, detail="fine"):
    return {"worker": "sales-desk", "job": job, "ok": ok, "detail": detail, "at": fakes.ago(minutes)}


class SalesDesk(unittest.TestCase):
    def test_limits_per_job(self):
        cases = [("requests", 14, OK), ("requests", 16, FAIL), ("recordings", 74, OK), ("recordings", 76, FAIL),
                 ("digest", 25 * 60, OK), ("digest", 27 * 60, FAIL)]
        for job, minutes, want in cases:
            r = worker_status.desk_check(job)(make({"cockpit_sales_worker_status": [desk(job, minutes=minutes)]}))
            self.assertEqual(r.status, want, (job, minutes))

    def test_stale_copy_job_carries_the_stale_flag(self):
        r = worker_status.desk_check("recordings")(make({"cockpit_sales_worker_status": [desk("recordings", minutes=200)]}))
        self.assertTrue(r.data.get("stale"))

    def test_failed_for_the_signin_points_at_the_signin_incident(self):
        r = worker_status.desk_check("followups")(make({"cockpit_sales_worker_status": [desk("followups", False, 3, SIGNED_OUT)]}))
        self.assertEqual(r.status, FAIL)
        self.assertEqual(r.caused_by, "claude-signin")

    def test_missing_row_is_unknown_never_ok(self):
        self.assertEqual(worker_status.desk_check("notes")(make({"cockpit_sales_worker_status": []})).status, UNKNOWN)

    def test_desk_rows_and_the_mirror_are_never_muted_for_convex(self):
        ids = [c for c in worker_status.CHECKS if c.id.startswith("desk-") and c.id in
               {f"desk-{j}" for j in worker_status.DESK_LIMITS}]
        self.assertEqual(len(ids), len(worker_status.DESK_LIMITS))
        mirror = next(c for c in syncs.CHECKS if c.id == "sales-mirror")
        self.assertTrue(all(c.quiet_because is None for c in ids + [mirror]))

    def test_only_copy_jobs_have_a_catch_up_fix(self):
        fixed = {c.id for c in worker_status.CHECKS if c.fix and c.id.startswith("desk-") and c.id != "desk-doctor"}
        self.assertEqual(fixed, {"desk-recordings", "desk-calls-vault", "desk-maqsam-calls"})

    def test_doctor_row_matters_only_once_the_watchdog_exists(self):
        rows = {"cockpit_sales_worker_status": [desk("doctor", False, 9000, "blocked")]}
        self.assertEqual(worker_status.run_desk_doctor(make(rows, db=fakes.FakeDb(rows, missing=("cockpit_sales_alerts",)))).status, OK)
        self.assertEqual(worker_status.run_desk_doctor(make(rows)).status, WARN)


class Salma(unittest.TestCase):
    def rows(self, **over):
        names = ["alerts", "captions", "higgsfield", "meta", "planning", "publishing", "video", "words"]
        rows = [{"check_name": n, "ok": True, "detail": None, "checked_at": fakes.ago(2)} for n in names]
        for r in rows:
            r.update(over.get(r["check_name"], {}))
        return {"social_worker_status": rows}

    def test_ok_stale_and_failing(self):
        self.assertEqual(worker_status.run_salma(make(self.rows())).status, OK)
        stale = self.rows()
        for r in stale["social_worker_status"]:
            r["checked_at"] = fakes.ago(20)
        self.assertEqual(worker_status.run_salma(make(stale)).status, FAIL)
        r = worker_status.run_salma(make(self.rows(higgsfield={"ok": False, "detail": "403 not_enough_credits"})))
        self.assertEqual(r.status, FAIL)
        self.assertIn("open.higgsfield.ai", r.action)

    def test_captions_paused_by_signin_is_folded(self):
        r = worker_status.run_salma(make(self.rows(captions={"ok": False, "detail": SIGNED_OUT})))
        self.assertEqual(r.caused_by, "claude-signin")

    def at(self, value):
        rows = self.rows()
        for r in rows["social_worker_status"]:
            r["checked_at"] = value
        return rows

    def test_a_row_from_this_second_is_fresh(self):
        # 24 Oct 2026: Salma wrote in the scan's own second, the age was 0.0, and 0.0 was read as
        # missing: "Salma has not reported for 694444.4 days" with all 8 checks ok.
        r = worker_status.run_salma(make(self.at(fakes.ago(0))))
        self.assertEqual(r.status, OK, r.summary)
        self.assertEqual(r.evidence["freshest_min"], 0.0)

    def test_a_clock_just_ahead_is_fresh(self):
        r = worker_status.run_salma(make(self.at(fakes.ago(-0.5))))
        self.assertEqual(r.status, OK, r.summary)

    def test_only_a_missing_time_is_missing(self):
        rows = self.at(None)
        r = worker_status.run_salma(make(rows))
        self.assertEqual(r.status, FAIL)
        self.assertIn("an unknown time", r.summary)
        self.assertIsNone(r.evidence["freshest_min"])
        rows["social_worker_status"][0]["checked_at"] = fakes.ago(0)
        self.assertEqual(worker_status.run_salma(make(rows)).status, OK)


class Webinar(unittest.TestCase):
    def pulls(self, source, rows):
        return {"cockpit_webinar_pulls": [{"source": source, "ok": ok, "detail": d, "started_at": fakes.ago(m),
                                           "finished_at": fakes.ago(m)} for ok, d, m in rows]}

    def test_zoom(self):
        self.assertEqual(worker_status.webinar_check("zoom", "Zoom", 180)(make(self.pulls("zoom", [(True, None, 30)]))).status, OK)
        r = worker_status.webinar_check("zoom", "Zoom", 180)(make(self.pulls("zoom", [(True, None, 100)])))
        self.assertEqual(r.status, FAIL)
        self.assertTrue(r.data.get("stale"))

    def test_survey_failing_for_days(self):
        rows = [(False, "Composio gave no MCP session (HTTP 200)", 37 + 60 * i) for i in range(30)]
        r = worker_status.webinar_check("typeform", "survey", 1440)(make(self.pulls("typeform", rows)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("Composio", r.summary)
        self.assertFalse(r.data.get("stale"))

    def test_objections_paused_is_paused(self):
        rows = [(False, "Objection tagging paused: approve a transcript provider before sending lead data.", 37)]
        r = worker_status.webinar_check("objections", "objections", 1440)(make(self.pulls("objections", rows)))
        self.assertEqual(r.status, PAUSED)


class Tap(unittest.TestCase):
    def test_tap(self):
        row = {"key": "tap-charges-sync", "ok": False, "note": "Charges not found 1249", "last_run_at": fakes.ago(5),
               "last_ok_at": fakes.ago(8500)}
        r = worker_status.run_tap(make({"cockpit_sync_state": [row]}))
        self.assertEqual(r.status, FAIL)
        self.assertIn("window with no charges", r.summary)
        self.assertIn("No payment is lost", r.summary)
        # Fixed on main in 0a71aec (2026-10-07): seen again, the deployed function lacks that fix.
        self.assertIn("0a71aec", r.action)
        self.assertIn("Redeploy tap-charges-sync from main", r.action)
        self.assertNotIn("may be", r.summary)
        row.update(ok=True, last_ok_at=fakes.ago(10))
        self.assertEqual(worker_status.run_tap(make({"cockpit_sync_state": [row]})).status, OK)


class Mirror(unittest.TestCase):
    def runs(self, specs):
        return {"cockpit_sales_mirror_runs": [{"id": 100 - i, "started_at": fakes.ago(m), "finished_at": fakes.ago(m),
                                               "ok": ok, "error": e} for i, (ok, e, m) in enumerate(specs)]}

    def test_mirror(self):
        self.assertEqual(syncs.run_mirror(make(self.runs([(True, None, 2)]))).status, OK)
        self.assertEqual(syncs.run_mirror(make(self.runs([(True, None, 16)]))).status, FAIL)
        three = self.runs([(False, "contracts: 503", 1), (False, "contracts: 503", 4), (False, "contracts: 503", 7), (True, None, 10)])
        self.assertEqual(syncs.run_mirror(make(three)).status, FAIL)
        two = self.runs([(False, "contracts: 503", 1), (False, "x", 4), (True, None, 7)])
        self.assertEqual(syncs.run_mirror(make(two)).status, OK)

    def test_drop_refusal(self):
        r = syncs.run_mirror_drop(make(self.runs([(False, "cockpit_sales_leads: B2B's read had 2 rows and 40 of the copy's were missing from it; nothing was dropped", 1)])))
        self.assertEqual(r.status, FAIL)

    def test_locks(self):
        t = {"cockpit_sales_locks": [{"name": "mirror", "holder": "x", "held_until": fakes.ago(-3)}]}
        self.assertEqual(syncs.run_locks(make(t)).status, OK)
        t["cockpit_sales_locks"][0]["held_until"] = fakes.ago(-40)
        self.assertEqual(syncs.run_locks(make(t)).status, WARN)


class Meta(unittest.TestCase):
    def test_blocked_from_two_signals_is_one_reading(self):
        section = {"key": "machine", "ok": True, "computed_at": fakes.ago(5), "error": None,
                   "payload": {"feeds": [{"name": "Meta ads", "ok": False, "lastSuccessAt": 1790957718411,
                                          "error": 'Meta 400: {"error":{"message":"API access blocked.","type":"OAuthException","code":200}}'}]}}
        jobs = [{"client_id": str(i), "last_sync_status": "error", "last_error": "meta: API access blocked."} for i in range(52)]
        r = syncs.run_meta(make({"cockpit_sections": [section], "sync_jobs": jobs}))
        self.assertEqual(r.status, FAIL)
        self.assertIn("52 of 52", r.summary)
        self.assertIn("API access blocked. (code 200)", r.summary)
        self.assertNotIn("{", r.summary)

    def test_clear(self):
        section = {"key": "machine", "ok": True, "computed_at": fakes.ago(5), "payload": {"feeds": [{"name": "Meta ads", "ok": True}]}}
        self.assertEqual(syncs.run_meta(make({"cockpit_sections": [section], "sync_jobs": []})).status, OK)


class B2B(unittest.TestCase):
    def test_sources(self):
        v = {"read_at": fakes.ago(2), "sources": [
            {"source": "fathom_calls", "last_sync_status": "success", "last_synced_at": fakes.ago(30)},
            {"source": "assets_web", "last_sync_status": "success", "last_synced_at": fakes.ago(6.5 * 1440)},
            {"source": "old", "last_sync_status": "running", "last_synced_at": None}]}
        self.assertEqual(syncs.run_b2b(make({"cockpit_sales_settings": [{"key": "b2b_sources", "value": v}]})).status, OK)
        v["sources"].append({"source": "maqsam_log", "last_sync_status": "error", "last_error": "403"})
        self.assertEqual(syncs.run_b2b(make({"cockpit_sales_settings": [{"key": "b2b_sources", "value": v}]})).status, WARN)

    def run_meta_row(self, status, age_min):
        v = {"read_at": fakes.ago(2), "sources": [
            {"source": "meta", "last_sync_status": status, "last_synced_at": fakes.ago(age_min), "last_error": None}]}
        return syncs.run_b2b(make({"cockpit_sales_settings": [{"key": "b2b_sources", "value": v}]}))

    def test_running_is_a_sync_in_progress(self):
        # The mirror reads B2B while meta-sync is mid-run: status running, last success 15 min ago.
        self.assertEqual(self.run_meta_row("running", 15).status, OK)

    def test_stuck_run_warns_by_age(self):
        r = self.run_meta_row("running", 75)
        self.assertEqual(r.status, WARN)
        self.assertIn("meta (", r.summary)
        self.assertEqual(self.run_meta_row("success", 75).status, WARN)


class Sections(unittest.TestCase):
    def sections(self, minutes, n=14, broken=()):
        return {"cockpit_sections": [{"key": f"s{i}", "ok": f"s{i}" not in broken, "error": "x" if f"s{i}" in broken else None,
                                      "computed_at": fakes.ago(minutes)} for i in range(n)]}

    def test_sections(self):
        self.assertEqual(sections.run_sections(make(self.sections(3))).status, OK)
        stale = sections.run_sections(make(self.sections(50)))
        self.assertEqual(stale.status, FAIL)
        self.assertIn("CEO refresh worker", stale.summary)
        self.assertNotIn("convex", (stale.summary + stale.action).lower())
        self.assertEqual(sections.run_sections(make(self.sections(3, broken=("s2",)))).status, WARN)
        self.assertEqual(sections.run_sections(make(self.sections(3, n=12))).status, WARN)

    def test_stale_sections_are_urgent_and_no_check_mentions_convex(self):
        self.assertTrue(next(c for c in sections.CHECKS if c.id == "ceo-sections").urgent)
        self.assertEqual([c.id for c in sections.CHECKS], ["ceo-sections", "native-jobs", "native-sources", "ask-ai-queue"])
        for c in sections.CHECKS:
            self.assertIsNone(c.quiet_because)
            self.assertNotIn("convex", " ".join([c.name, c.means, c.reads, c.action, c.owner]).lower())

    def machine(self, **payload):
        return {"cockpit_sections": [{"key": "machine", "ok": True, "error": None, "computed_at": fakes.ago(3), "payload": payload}]}

    def test_jobs(self):
        from checks.sections import run_jobs
        keys = ("ai-watch-tick", "billing-sync", "ceo-extensions-auto", "clickup-writeback:log",
                "clickup-writeback:kpi", "clickup-writeback:dosdonts", "comment-watch", "hiring-sync:engine",
                "hiring-sync:intake", "hiring-sync:mirror", "hours-kick", "hours-watch", "hubstaff-sync", "onboarding-sync",
                "tap-charges-sync", "timetastic-sync", "tracking-audit", "csm-ghl-calls", "csm-checkin-form",
                "csm-forms-history", "csm-fathom", "csm-meta-activities", "csm-media-changes", "csm-reconcile",
                "lead-sync-watch") + REQUEST_JOBS
        rows = [{"key": k, "ok": True, "last_ok_at": fakes.ago(1)} for k in keys]
        self.assertEqual(run_jobs(make({"cockpit_sync_state": rows})).status, OK)
        rows[0]["last_ok_at"] = fakes.ago(60)
        self.assertEqual(run_jobs(make({"cockpit_sync_state": rows})).status, FAIL)
        rows[0]["last_ok_at"] = fakes.ago(1)
        rows[1]["ok"] = False
        self.assertIn("billing-sync", run_jobs(make({"cockpit_sync_state": rows})).items)

    def test_hours_watch_is_watched_at_15_minutes(self):
        # The Hubstaff watch runs every 5 minutes; its freshness row is late after 15.
        from checks.sections import run_jobs
        keys = ("ai-watch-tick", "billing-sync", "ceo-extensions-auto", "clickup-writeback:log",
                "clickup-writeback:kpi", "clickup-writeback:dosdonts", "comment-watch", "hiring-sync:engine",
                "hiring-sync:intake", "hiring-sync:mirror", "hours-kick", "hubstaff-sync", "onboarding-sync",
                "tap-charges-sync", "timetastic-sync", "tracking-audit", "csm-ghl-calls", "csm-checkin-form",
                "csm-forms-history", "csm-fathom", "csm-meta-activities", "csm-media-changes", "csm-reconcile",
                "lead-sync-watch") + REQUEST_JOBS
        rows = [{"key": k, "ok": True, "last_ok_at": fakes.ago(1)} for k in keys]
        missing = run_jobs(make({"cockpit_sync_state": rows}))
        self.assertEqual(missing.status, FAIL)
        self.assertEqual(missing.items, ["hours-watch"])
        rows.append({"key": "hours-watch", "ok": True, "last_ok_at": fakes.ago(14)})
        self.assertEqual(run_jobs(make({"cockpit_sync_state": rows})).status, OK)
        rows[-1]["last_ok_at"] = fakes.ago(16)
        self.assertEqual(run_jobs(make({"cockpit_sync_state": rows})).items, ["hours-watch"])
        rows[-1].update(last_ok_at=fakes.ago(1), ok=False)
        self.assertEqual(run_jobs(make({"cockpit_sync_state": rows})).items, ["hours-watch"])

    def test_lead_sync_watch_is_watched_at_45_minutes(self):
        # The Facebook-vs-CRM watch runs every 15 minutes; three missed runs is late.
        from checks.sections import run_jobs
        rows = [{"key": k, "ok": True, "last_ok_at": fakes.ago(1)} for k in (
            "ai-watch-tick", "billing-sync", "ceo-extensions-auto", "clickup-writeback:log",
            "clickup-writeback:kpi", "clickup-writeback:dosdonts", "comment-watch", "hiring-sync:engine",
            "hiring-sync:intake", "hiring-sync:mirror", "hours-kick", "hours-watch", "hubstaff-sync", "onboarding-sync",
            "tap-charges-sync", "timetastic-sync", "tracking-audit", "csm-ghl-calls", "csm-checkin-form",
            "csm-forms-history", "csm-fathom", "csm-meta-activities", "csm-media-changes", "csm-reconcile") + REQUEST_JOBS]
        self.assertEqual(run_jobs(make({"cockpit_sync_state": rows})).items, ["lead-sync-watch"])
        rows.append({"key": "lead-sync-watch", "ok": True, "last_ok_at": fakes.ago(44)})
        self.assertEqual(run_jobs(make({"cockpit_sync_state": rows})).status, OK)
        rows[-1]["last_ok_at"] = fakes.ago(46)
        self.assertEqual(run_jobs(make({"cockpit_sync_state": rows})).items, ["lead-sync-watch"])

    JOBS = ("ai-watch-tick", "billing-sync", "ceo-extensions-auto", "clickup-writeback:log", "clickup-writeback:kpi",
            "clickup-writeback:dosdonts", "comment-watch", "hiring-sync:engine", "hiring-sync:intake",
            "hiring-sync:mirror", "hours-kick", "hours-watch", "hubstaff-sync", "onboarding-sync", "tap-charges-sync",
            "timetastic-sync", "tracking-audit", "csm-ghl-calls", "csm-checkin-form", "csm-forms-history", "csm-fathom",
            "csm-meta-activities", "csm-media-changes", "csm-reconcile", "lead-sync-watch") + REQUEST_JOBS

    def writebacks_at(self, now, kpi, dosdonts):
        rows = [{"key": k, "ok": True, "last_ok_at": (now - timedelta(minutes=1)).isoformat()} for k in self.JOBS]
        for r in rows:
            r["last_ok_at"] = {"clickup-writeback:kpi": kpi, "clickup-writeback:dosdonts": dosdonts}.get(r["key"], r["last_ok_at"])
        return sections.run_jobs(make({"cockpit_sync_state": rows}, now=now))

    def test_clickup_writebacks_are_not_late_at_night(self):
        # They run hourly 03:00-18:59 UTC only; the night is not 8 hours late (19, 20 and 21 Oct 2026).
        utc = lambda d, h, m: datetime(2026, 10, d, h, m, tzinfo=timezone.utc)
        last_kpi, last_dd = utc(24, 18, 5).isoformat(), utc(24, 18, 35).isoformat()
        self.assertEqual(self.writebacks_at(utc(24, 19, 25), last_kpi, last_dd).status, OK)   # 22:25 Kuwait
        self.assertEqual(self.writebacks_at(utc(25, 2, 55), last_kpi, last_dd).status, OK)    # 05:55 Kuwait
        # The morning runs are missed: 55 + 100 and 25 + 100 scheduled minutes.
        self.assertEqual(self.writebacks_at(utc(25, 4, 40), last_kpi, last_dd).items,
                         ["clickup-writeback:kpi", "clickup-writeback:dosdonts"])
        # Inside the hours nothing changes: kpi missed its 11:05 run, dosdonts did not.
        r = self.writebacks_at(utc(24, 11, 40), utc(24, 10, 5).isoformat(), utc(24, 10, 35).isoformat())
        self.assertEqual(r.items, ["clickup-writeback:kpi"])
        self.assertEqual(self.writebacks_at(utc(24, 19, 25), None, last_dd).items, ["clickup-writeback:kpi"])

    def test_scheduled_minutes_cross_midnight(self):
        since = datetime(2026, 10, 24, 18, 35, tzinfo=timezone.utc)
        self.assertEqual(sections.scheduled_minutes(since, since + timedelta(hours=8, minutes=35), 3, 19), 35)
        self.assertEqual(sections.scheduled_minutes(since, since + timedelta(days=2), 3, 19), 25 + 16 * 60 + 15 * 60 + 35)
        self.assertEqual(sections.scheduled_minutes(since, since - timedelta(minutes=1), 3, 19), 0)

    def test_old_machine_section_cannot_vouch(self):
        t = {"cockpit_sections": [{"key": "machine", "computed_at": fakes.ago(90), "payload": {"jobs": []}}]}
        self.assertEqual(sections.run_jobs(make(t)).status, FAIL)

    def test_old_machine_section_points_at_ceo_sections(self):
        # ceo-sections reads the same row, so it already has the incident; the readers fold into it.
        t = {"cockpit_sections": [{"key": "machine", "ok": True, "computed_at": fakes.ago(60),
                                   "payload": {"sources": [{"source": "meta", "ok": True}], "hermes": {}}}]}
        readers = [c for c in sections.CHECKS if c.id in ("native-sources", "ask-ai-queue")]
        found = engine.run_checks(make(t), readers)
        self.assertEqual([(f.result.status, f.result.caused_by) for f in found], [(UNKNOWN, "ceo-sections")] * 2)
        self.assertIn("machine section is 60 min old", found[0].result.summary)

    def test_sources(self):
        p = self.machine(sources=[{"source": "sheets", "ok": False, "lastError": "HTTP 404"}, {"source": "meta", "ok": True}])
        r = sections.run_sources(make(p))
        self.assertEqual(r.status, FAIL)
        self.assertIn("sheets", r.summary)

    def test_hermes_failures_rising(self):
        state = {"history": {"hermes_failed": [[fakes.ago(65), 2300]]}}
        r = sections.run_ask_ai_queue(make(self.machine(hermes={"queued": 0, "failed": 2312, "lastDoneAt": fakes.NOW.timestamp() * 1000}), state=state))
        self.assertEqual(r.status, WARN)
        stuck = self.machine(hermes={"queued": 3, "failed": 1, "lastDoneAt": fakes.NOW.timestamp() * 1000 - 30 * 60_000})
        self.assertEqual(sections.run_ask_ai_queue(make(stuck, state={})).status, FAIL)


REPO = Path(__file__).resolve().parents[3]


def _between(text, start, end):
    i = text.index(start)
    return text[i:text.index(end, i + len(start))]


@unittest.skipUnless((REPO / "docs/hours-watch/SPEC.md").exists(), "needs the cockpit repository, not a VPS copy")
class HubstaffWatchDocs(unittest.TestCase):
    """The runbook and the sources map say what the Hubstaff watch really does (SPEC final round)."""

    def setUp(self):
        self.runbook = _between((REPO / "RUNBOOK.md").read_text(), "## Hubstaff watch\n", "\n## Hiring")
        sources = (REPO / "apps/media-buyer-cockpit/src/pages/ceo/SOURCES.md").read_text()
        self.row = next(l for l in sources.splitlines() if l.startswith("| **Hubstaff watch**"))
        self.migration = (REPO / "supabase/migrations/20261013d_cockpit_hours_watch.sql").read_text()

    def test_lease_matches_the_migration(self):
        self.assertIn("interval '6 minutes'", _between(self.migration, "cockpit_hours_watch_lease_claim", "$$;"))
        self.assertIn("6-minute lease", self.runbook)
        self.assertNotIn("4-minute", self.runbook)

    def test_review_note_is_not_in_the_audit_log(self):
        self.assertIn("'hasNote'", self.migration)
        self.assertIn("(`hasNote`), never its text", self.runbook)
        self.assertNotIn("in the audit log (`hours.watch.review`)", self.runbook)

    def test_openai_key_first_through_the_repo_script(self):
        cmd = "ssh -i ~/.ssh/faris-key hermes@187.77.156.166 'python3 - openai' < scripts/dev/hours_watch_key.py"
        self.assertIn(cmd, (REPO / "scripts/dev/hours_watch_key.py").read_text())
        self.assertIn(cmd, self.runbook)
        self.assertIn("must show `openai` `connected`", self.runbook)
        self.assertNotIn("put_ai_key.py", self.runbook)
        self.assertNotIn("Google AI, else OpenAI", self.runbook)
        self.assertIn("OpenAI first", self.row)
        self.assertNotIn("Google AI else OpenAI", self.row)

    def test_ceo_mention_and_channel_membership(self):
        self.assertIn("<@U09305KE2KS>", self.runbook)
        self.assertIn("is a member of #team-management", self.runbook)
        self.assertIn("Add the CEO to #team-management", self.runbook)
        self.assertIn("Mention me in each alert", self.runbook)
        self.assertIn("mentioning the CEO", self.row)

    def test_false_alarm_row_covers_break_leave_and_schedule(self):
        row = next(l for l in self.runbook.splitlines() if l.startswith("| A false alarm"))
        for words in ("**Lunch break**", "On a break since 13:00", "60 + 15 minutes", "Part-day leave",
                      "Morning = shift start to its midpoint", "**No schedule**", "No schedule set",
                      "before the shift starts"):
            self.assertIn(words, row)
        for words in ("lunch break", "Part-day leave", "before the shift starts", "no schedule is not watched"):
            self.assertIn(words, self.row)

    def test_guardian_cap_is_the_one_the_runbook_names(self):
        import inspect
        self.assertIn('"hours-watch": 15', inspect.getsource(sections.run_jobs))
        self.assertIn('`"hours-watch": 15`', self.runbook)
        self.assertNotIn("Add `hours-watch` to the guardian", self.runbook)


class PgCron(unittest.TestCase):
    def probe(self, **over):
        jobs = [{"jobid": i, "jobname": n, "schedule": "* * * * *", "active": True} for i, n in enumerate(pg_cron.EXPECTED_JOBS)]
        p = {"cron_jobs": jobs, "cron_runs": [], "http_1h": {"200": 30}, "auth_roles": {}}
        p.update(over)
        return p

    def test_jobs(self):
        self.assertEqual(pg_cron.run_jobs(make(db=fakes.FakeDb(probe=self.probe()))).status, OK)
        p = self.probe()
        p["cron_jobs"] = p["cron_jobs"][1:]
        p["cron_jobs"][0]["active"] = False
        r = pg_cron.run_jobs(make(db=fakes.FakeDb(probe=p)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("missing", r.summary)
        self.assertIn("switched off", r.summary)

    def test_runs_read_the_answers_not_just_succeeded(self):
        self.assertEqual(pg_cron.run_runs(make(db=fakes.FakeDb(probe=self.probe()))).status, OK)
        self.assertEqual(pg_cron.run_runs(make(db=fakes.FakeDb(probe=self.probe(http_1h={"200": 9, "500": 1})))).status, FAIL)
        self.assertEqual(pg_cron.run_runs(make(db=fakes.FakeDb(probe=self.probe(http_1h={"timeout": 2})))).status, FAIL)
        c = make(db=fakes.FakeDb(probe=self.probe(http_1h={"200": 29, "missing_function": 2})))
        c.results["live-function"] = Result(NOT_DEPLOYED, "sales-live is not deployed yet")
        c.results["live-settings"] = Result(PAUSED, "switched off")
        r = pg_cron.run_runs(c)
        self.assertEqual(r.status, OK)          # sales-live not deployed yet is the function checks' to say
        self.assertIn("not deployed", r.summary)
        runs = [{"jobid": 0, "runs_24h": 48, "failed_24h": 2, "last_error": "job startup timeout"}]
        self.assertEqual(pg_cron.run_runs(make(db=fakes.FakeDb(probe=self.probe(cron_runs=runs)))).status, WARN)

    def test_probe_missing_names_the_migration(self):
        with self.assertRaises(SourceError) as e:
            pg_cron.run_jobs(make(db=fakes.FakeDb(probe=None)))
        self.assertIn("20261003e", str(e.exception))


    def test_auth_roles(self):
        r = pg_cron.run_auth_roles(make(db=fakes.FakeDb(probe=self.probe(auth_roles={"mahara_dialer_identity": 2}))))
        self.assertEqual(r.status, WARN)
        self.assertIn("2 with mahara_dialer_identity", r.summary)
        self.assertEqual(pg_cron.run_auth_roles(make(db=fakes.FakeDb(probe=self.probe()))).status, OK)


class EdgeFunctions(unittest.TestCase):
    def listed(self):
        return [{"slug": s, "status": "ACTIVE", "verify_jwt": j} for s, j in edge_functions.EXPECTED.items()]

    def test_list(self):
        self.assertEqual(edge_functions.run_functions(make(db=fakes.FakeDb(functions=self.listed()))).status, OK)
        bad = self.listed()
        bad[0]["verify_jwt"] = False
        bad[1]["status"] = "THROTTLED"
        r = edge_functions.run_functions(make(db=fakes.FakeDb(functions=bad[:-1])))
        self.assertEqual(r.status, FAIL)
        self.assertIn("verify_jwt", r.summary)
        self.assertIn("missing", r.summary)

    def test_sales_live_is_expected_with_verify_jwt_off(self):
        self.assertIs(edge_functions.EXPECTED.get("sales-live"), False)
        signed = [dict(f, verify_jwt=True) if f["slug"] == "sales-live" else f for f in self.listed()]
        r = edge_functions.run_functions(make(db=fakes.FakeDb(functions=signed)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("sales-live has verify_jwt True", r.summary)
        gone = [f for f in self.listed() if f["slug"] != "sales-live"]
        r = edge_functions.run_functions(make(db=fakes.FakeDb(functions=gone)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("sales-live is missing", r.summary)

    def test_the_1_1_notes_functions_are_expected(self):
        """docs/forms/STAGE2-CONTRACT.md section 9: cockpit-forms-api signed in, fathom-webhook signed by Fathom."""
        self.assertIs(edge_functions.EXPECTED["cockpit-forms-api"], True)
        self.assertIs(edge_functions.EXPECTED["fathom-webhook"], False)
        jwt_on = [dict(f, verify_jwt=True) if f["slug"] == "fathom-webhook" else f for f in self.listed()]
        r = edge_functions.run_functions(make(db=fakes.FakeDb(functions=jwt_on)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("fathom-webhook has verify_jwt True (should be False)", r.summary)
        gone = [f for f in self.listed() if f["slug"] != "cockpit-forms-api"]
        r = edge_functions.run_functions(make(db=fakes.FakeDb(functions=gone)))
        self.assertIn("cockpit-forms-api is missing", r.summary)
        self.assertIn("cockpit-forms-api", checks_mod.by_id()["edge-functions"].means)

    def test_without_token_only_sales_api_is_checked(self):
        web = fakes.FakeWeb({"https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-api": fakes.resp(401)})
        r = edge_functions.run_functions(make(web=web))
        self.assertEqual(r.status, UNKNOWN)
        self.assertTrue(r.coverage_gap)
        self.assertEqual(web.calls, ["https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-api"])


class SupabaseHealth(unittest.TestCase):
    def test_down_is_fail_not_unknown(self):
        r = supabase.run_health(make(db=fakes.FakeDb(down=True)))
        self.assertEqual(r.status, FAIL)

    def test_service_unhealthy(self):
        db = fakes.FakeDb(health=[{"name": "db", "status": "ACTIVE_HEALTHY"}, {"name": "rest", "status": "UNHEALTHY"}])
        self.assertEqual(supabase.run_health(make(db=db)).status, FAIL)
        self.assertEqual(supabase.run_health(make()).status, OK)

    def test_needs_fifteen_minutes_and_resends_the_radar_after(self):
        c = supabase.CHECKS[0]
        self.assertEqual(c.confirm_minutes, 15)
        self.assertEqual(c.on_resolve.name, "radar-resend")


class WhatsApp(unittest.TestCase):
    def test_connector(self):
        def t(v):
            return make({"cockpit_sales_settings": [{"key": "whatsapp_guard", "value": v}]})
        r = whatsapp.run_doubles(t({"templates_per_day": 250}))
        self.assertEqual(r.status, UNKNOWN)
        self.assertTrue(r.coverage_gap)
        r = whatsapp.run_doubles(t({"connector_off": False, "single_copy_ok_at": None}))
        self.assertEqual(r.status, WARN)
        self.assertIn("may go out twice", r.summary)
        self.assertEqual(whatsapp.run_doubles(t({"connector_off": True})).status, WARN)
        self.assertEqual(whatsapp.run_doubles(t({"connector_off": True, "single_copy_ok_at": "2026-10-04T09:00:00Z"})).status, OK)

    def test_wallet_and_refusals(self):
        msgs = [{"id": "1", "channel": "whatsapp", "state": "failed", "error": "Insufficient funds in wallet", "created_at": fakes.ago(30)},
                {"id": "2", "channel": "whatsapp", "state": "failed", "error": "(#131049) marketing cap", "created_at": fakes.ago(40)},
                {"id": "3", "channel": "whatsapp", "state": "failed", "error": "old", "created_at": fakes.ago(3000)}]
        c = make({"cockpit_sales_messages": msgs})
        self.assertEqual(whatsapp.run_wallet(c).status, FAIL)
        r = whatsapp.run_refusals(c)
        self.assertEqual(r.status, WARN)
        self.assertIn("131049", r.summary)


class Queues(unittest.TestCase):
    def test_stuck_social_job(self):
        q = next(x for x in queues.QUEUES if x.id == "queue-social-jobs")
        rows = {"social_jobs": [{"id": "generate:86eywazcu:2026-09:1", "status": "running", "updated_at": fakes.ago(7.2 * 1440)},
                                {"id": "b", "status": "done", "updated_at": fakes.ago(9000)}]}
        r = queues.queue_check(q)(make(rows))
        self.assertEqual(r.status, WARN)
        self.assertIn("1 Salma job(s)", r.summary)
        rows["social_jobs"][0]["updated_at"] = fakes.ago(30)
        self.assertEqual(queues.queue_check(q)(make(rows)).status, OK)


def notice(state, minutes, **kw):
    return {"id": f"n-{state}-{minutes}", "kind": "kickoff", "state": state, "created_at": fakes.ago(minutes), **kw}


def press(state, minutes, kind="blueprintClose", **kw):
    return {"id": f"p-{kind}-{state}-{minutes}", "kind": kind, "state": state, "client_name": "Sample client",
            "created_at": fakes.ago(minutes), **kw}


class StageOneQueues(unittest.TestCase):
    """docs/forms/STAGE1-CONTRACT.md section 7: the Slack notices and the Brand Blueprint presses."""

    def q(self, qid):
        return next(x for x in queues.QUEUES if x.id == qid)

    def run_q(self, qid, tables):
        db = fakes.FakeDb(tables)
        return queues.queue_check(self.q(qid))(make(db=db)), db

    def test_the_rows_read_the_state_column_and_their_errors(self):
        for qid, table in (("queue-slack-notices", "cockpit_slack_notices"),
                           ("queue-creative-blueprint", "cockpit_creative_outbox"),
                           ("queue-creative-reconcile", "cockpit_creative_outbox")):
            q = self.q(qid)
            self.assertEqual((q.table, q.status_col, q.owner), (table, "state", "the tech lead"), qid)
            self.assertIn(table, queues.WITH_ERROR)
            c = checks_mod.by_id()[qid]
            self.assertIn("where state in", c.reads)
        self.assertEqual(self.q("queue-slack-notices").states, ("queued", "sending", "unknown"))
        self.assertEqual(self.q("queue-slack-notices").kind_col, "kind")
        self.assertNotIn("kickoff.updated", self.q("queue-slack-notices").kinds)
        self.assertIn("RUNBOOK, Slack notices", self.q("queue-slack-notices").action)
        self.assertIn("RUNBOOK, Brand Blueprint press drain", self.q("queue-creative-blueprint").action)

    def test_a_notice_waits_30_minutes_because_a_kickoff_waits_20_for_make(self):
        q = self.q("queue-slack-notices")
        self.assertEqual(q.limit_min, 30)
        r, _ = self.run_q("queue-slack-notices", {"cockpit_slack_notices": [notice("queued", 19), notice("sending", 2)]})
        self.assertEqual(r.status, OK)
        self.assertIn("2 open", r.summary)

    def test_a_notice_past_30_minutes_warns_with_its_state_and_error(self):
        rows = {"cockpit_slack_notices": [
            notice("unknown", 45, error="Slack did not confirm the post; it is not sent again in case it arrived."),
            notice("queued", 5), notice("posted", 300), notice("skipped", 400)]}
        r, _ = self.run_q("queue-slack-notices", rows)
        self.assertEqual(r.status, WARN)
        self.assertIn("1 Slack notice(s) waited past 30 min; the oldest is unknown for 45 min", r.summary)
        self.assertIn("Slack did not confirm the post", r.summary)
        self.assertEqual(r.evidence["oldest"]["status"], "unknown")
        self.assertEqual(r.items, ["waiting"])

    def test_a_failed_notice_in_24_hours_warns_by_its_finish_time(self):
        rows = {"cockpit_slack_notices": [
            notice("failed", 60, finished_at=fakes.ago(50),
                   error="Slack says mahara-club-bot is not in #csm-general. Invite it there."),
            notice("failed", 3000, finished_at=fakes.ago(2990), error="an old one")]}
        r, _ = self.run_q("queue-slack-notices", rows)
        self.assertEqual(r.status, WARN)
        self.assertIn("1 Slack notice(s) failed in the last 24 h", r.summary)
        self.assertIn("mahara-club-bot is not in #csm-general", r.summary)
        self.assertNotIn("an old one", r.summary)
        self.assertEqual(r.items, ["failed"])

    def test_a_late_kickoffs_reply_waiting_for_the_comment_is_read_by_its_next_turn(self):
        # The reply is requeued every 10 minutes while the card lacks its Kickoff Handoff comment: old by
        # created_at, never late by next_attempt_at. The main row leaves it out.
        waiting = notice("queued", 600, kind="kickoff.updated", next_attempt_at=fakes.ago(-8),
                         error="Waiting for the card's Kickoff Handoff comment before saying the card is updated.")
        r, _ = self.run_q("queue-slack-notices", {"cockpit_slack_notices": [waiting]})
        self.assertEqual(r.status, OK)
        r, _ = self.run_q("queue-slack-notice-replies", {"cockpit_slack_notices": [waiting]})
        self.assertEqual(r.status, OK)
        # The sender stopped picking it up: its turn passed 40 minutes ago.
        stuck = {**waiting, "next_attempt_at": fakes.ago(40)}
        r, _ = self.run_q("queue-slack-notice-replies", {"cockpit_slack_notices": [stuck, notice("queued", 600)]})
        self.assertEqual(r.status, WARN)
        self.assertIn("1 Kickoff card updated reply(s) waited past 30 min; the oldest is queued for 40 min", r.summary)
        # An unknown reply still needs a person, and a failed one warns too.
        r, _ = self.run_q("queue-slack-notice-replies", {"cockpit_slack_notices": [
            notice("failed", 90, kind="kickoff.updated", finished_at=fakes.ago(30), error="Slack refused it (x)."),
            notice("failed", 90, finished_at=fakes.ago(30), error="a kickoff's own failure")]})
        self.assertEqual(r.status, WARN)
        self.assertNotIn("a kickoff's own failure", r.summary)

    def test_a_blueprint_press_stuck_sending_warns(self):
        # A run stopped after its claim leaves the press sending: no notice, no retry, the card spinning.
        q = self.q("queue-creative-blueprint")
        self.assertEqual(q.states, ("pending", "sending"))
        r, _ = self.run_q("queue-creative-blueprint", {"cockpit_creative_outbox": [press("sending", 3)]})
        self.assertEqual(r.status, OK)
        r, _ = self.run_q("queue-creative-blueprint", {"cockpit_creative_outbox": [press("sending", 240)]})
        self.assertEqual(r.status, WARN)
        self.assertIn("the oldest is sending for 4.0 h", r.summary)
        self.assertIn("settle it by hand", q.action)

    def test_a_blueprint_press_pending_past_10_minutes_warns(self):
        r, _ = self.run_q("queue-creative-blueprint", {"cockpit_creative_outbox": [press("pending", 8)]})
        self.assertEqual(r.status, OK)
        r, _ = self.run_q("queue-creative-blueprint", {"cockpit_creative_outbox": [
            press("pending", 14, kind="blueprintLaunch", error="The card already has two open launch tasks.")]})
        self.assertEqual(r.status, WARN)
        self.assertIn("1 Brand Blueprint press(s) waited past 10 min; the oldest is pending for 14 min", r.summary)
        self.assertIn("two open launch tasks", r.summary)

    def test_the_kind_filter_leaves_other_outbox_rows_out(self):
        q = self.q("queue-creative-blueprint")
        self.assertEqual(q.kinds, ("blueprintLaunch", "blueprintClose", "blueprintOffer"))
        self.assertEqual(q.scope(), [("kind", "in", ["blueprintLaunch", "blueprintClose", "blueprintOffer"])])
        others = [press("pending", 300, kind="touch"), press("failed", 60, kind="fieldWrite", settled_at=fakes.ago(30)),
                  press("reconcile", 90, kind="fieldWrite")]
        for qid in ("queue-creative-blueprint", "queue-creative-reconcile"):
            r, _ = self.run_q(qid, {"cockpit_creative_outbox": others})
            self.assertEqual(r.status, OK, qid)
        self.assertEqual(self.q("queue-social-jobs").scope(), [])

    def test_a_failed_press_in_24_hours_warns_by_its_settle_time(self):
        rows = {"cockpit_creative_outbox": [
            press("failed", 50, kind="blueprintOffer", settled_at=fakes.ago(20),
                  error="This press did not finish within 30 minutes. Press again."),
            press("failed", 50, kind="fieldWrite", settled_at=fakes.ago(20), error="not a Blueprint press")]}
        r, _ = self.run_q("queue-creative-blueprint", rows)
        self.assertEqual(r.status, WARN)
        self.assertIn("1 Brand Blueprint press(s) failed in the last 24 h", r.summary)
        self.assertIn("did not finish within 30 minutes", r.summary)
        self.assertNotIn("not a Blueprint press", r.summary)

    def test_any_press_in_reconcile_warns_at_once(self):
        q = self.q("queue-creative-reconcile")
        self.assertEqual((q.states, q.limit_min, q.failed_col), (("reconcile",), 0, None))
        r, _ = self.run_q("queue-creative-reconcile", {"cockpit_creative_outbox": []})
        self.assertEqual(r.status, OK)
        self.assertEqual(r.summary, "No Brand Blueprint press needing a look is open.")
        r, _ = self.run_q("queue-creative-reconcile", {"cockpit_creative_outbox": [
            press("reconcile", 3, error="The card read back a different Onboarding Map.")]})
        self.assertEqual(r.status, WARN)
        self.assertIn("1 Brand Blueprint press needing a look(s) are open; the oldest is reconcile for 3 min", r.summary)
        self.assertIn("different Onboarding Map", r.summary)
        c = checks_mod.by_id()["queue-creative-reconcile"]
        self.assertEqual(c.threshold, "Any open row: warn.")
        self.assertNotIn("under a minute", c.means + c.threshold)

    def test_no_client_name_is_read_or_shown(self):
        r, _ = self.run_q("queue-creative-blueprint", {"cockpit_creative_outbox": [press("pending", 14)]})
        self.assertNotIn("Sample client", r.summary)
        self.assertNotIn("client_name", str(r.evidence))
        self.assertNotIn("client_name", checks_mod.by_id()["queue-creative-blueprint"].reads)

    def test_the_other_queues_still_read_status(self):
        for q in queues.QUEUES:
            if q.table not in ("cockpit_slack_notices", "cockpit_creative_outbox", "cockpit_clickup_writeback_queue",
                               "cockpit_form_effects", "cockpit_client_messages"):
                self.assertEqual((q.status_col, q.kind_col, q.kinds), ("status", None, ()), q.id)

    def test_the_sender_and_the_drain_are_expected(self):
        self.assertIs(edge_functions.EXPECTED["cockpit-notices"], False)
        self.assertIs(edge_functions.EXPECTED["cockpit-creative-api"], True)
        self.assertIn("mahara-slack-notices", pg_cron.EXPECTED_JOBS)
        self.assertIn("mahara-creative-drain", pg_cron.EXPECTED_JOBS)


def queued(state, minutes, kind="request", **kw):
    return {"id": f"q-{kind}-{state}-{minutes}", "kind": kind, "state": state, "created_at": fakes.ago(minutes), **kw}


class RequestsAndTaskMirror(unittest.TestCase):
    """docs/requests/CONTRACT.md section 7: the requests writer's queue rows and the task mirror's jobs."""

    def q(self):
        return next(x for x in queues.QUEUES if x.id == "queue-clickup-requests")

    def run_q(self, rows):
        db = fakes.FakeDb({"cockpit_clickup_writeback_queue": rows})
        return queues.queue_check(self.q())(make(db=db)), db

    def test_the_row_reads_only_requests_and_task_changes_by_state(self):
        q = self.q()
        self.assertEqual((q.table, q.status_col, q.kind_col, q.kinds, q.limit_min, q.time_col, q.failed_col, q.owner),
                         ("cockpit_clickup_writeback_queue", "state", "kind", ("request", "task_action"), 15, "created_at",
                          "updated_at", "the tech lead"))
        self.assertEqual(q.states, ("queued", "sending", "retry", "unknown"))
        self.assertIn("cockpit_clickup_writeback_queue", queues.WITH_ERROR)
        self.assertIn("requests_doctor", q.action)
        self.assertIn("RUNBOOK, Requests writer", q.action)
        self.assertIn("kind in (request, task_action)", checks_mod.by_id()["queue-clickup-requests"].reads)

    def test_a_request_waiting_past_15_minutes_warns_and_the_log_jobs_kinds_are_left_alone(self):
        r, _ = self.run_q([queued("queued", 2, kind="task_action"), queued("retry", 9),
                           queued("queued", 400, kind="decision")])
        self.assertEqual(r.status, OK)
        r, _ = self.run_q([queued("unknown", 40, error="ClickUp did not answer; look for its Cockpit ref."), queued("queued", 3)])
        self.assertEqual(r.status, WARN)
        self.assertIn("1 request or task change bound for ClickUp(s) waited past 15 min; the oldest is unknown", r.summary)
        self.assertIn("look for its Cockpit ref", r.summary)

    def test_a_held_request_waits_on_purpose_until_requests_open(self):
        """CONTRACT 2.8: an editor's request filed before requests open stays queued and goes by itself later."""
        rows = [queued("queued", 400), queued("retry", 9)]

        def run(mode):
            state = [] if mode is None else [{"key": "clickup-writeback:requests", "detail": {"mode": mode}}]
            db = fakes.FakeDb({"cockpit_clickup_writeback_queue": rows, "cockpit_sync_state": state})
            return queues.queue_check(self.q())(make(db=db))

        for mode in (None, "dry_run", "apply_limited", "unknown"):
            r = run(mode)
            self.assertEqual(r.status, OK, mode)
            self.assertIn("1 held until requests open.", r.summary)
            self.assertEqual(r.evidence["held"], 1)
        r = run("apply")
        self.assertEqual(r.status, WARN)
        self.assertIn("the oldest is queued", r.summary)
        self.assertEqual(r.evidence["held"], 0)
        # A row the writer holds (sending, retry, unknown) counts whatever the mode.
        db = fakes.FakeDb({"cockpit_clickup_writeback_queue": [queued("unknown", 40)],
                           "cockpit_sync_state": [{"key": "clickup-writeback:requests", "detail": {"mode": "dry_run"}}]})
        self.assertEqual(queues.queue_check(self.q())(make(db=db)).status, WARN)
        self.assertIn("queued rows count only while cockpit_sync_state clickup-writeback:requests has mode apply",
                      checks_mod.by_id()["queue-clickup-requests"].reads)

    def test_a_failed_request_in_24_hours_warns(self):
        r, _ = self.run_q([queued("failed", 90, updated_at=fakes.ago(60), error="clickup rejected the request (400)")])
        self.assertEqual(r.status, WARN)
        self.assertIn("failed in the last 24 h", r.summary)
        self.assertIn("clickup rejected the request (400)", r.summary)

    def test_the_jobs_and_the_function_are_expected(self):
        for job in ("mahara-clickup-writeback-requests", "mahara-task-mirror", "mahara-task-mirror-seats"):
            self.assertIn(job, pg_cron.EXPECTED_JOBS)
        self.assertIs(edge_functions.EXPECTED["cockpit-tasks"], False)
        import inspect
        src = inspect.getsource(sections.run_jobs)
        for line in ('"clickup-writeback:requests": 10', '"task-mirror:delta": 10', '"task-mirror:seats": 90'):
            self.assertIn(line, src)

    def test_a_late_task_mirror_fails_the_jobs_check(self):
        keys = TestSectionsJobKeys.ALL
        rows = [{"key": k, "ok": True, "last_ok_at": fakes.ago(1)} for k in keys]
        self.assertEqual(sections.run_jobs(make({"cockpit_sync_state": rows})).status, OK)
        for r in rows:
            if r["key"] == "task-mirror:delta":
                r["last_ok_at"] = fakes.ago(11)
            if r["key"] == "task-mirror:seats":
                r["last_ok_at"] = fakes.ago(80)
        self.assertEqual(sections.run_jobs(make({"cockpit_sync_state": rows})).items, ["task-mirror:delta"])
        rows = [r for r in rows if r["key"] != "clickup-writeback:requests"]
        self.assertIn("clickup-writeback:requests", sections.run_jobs(make({"cockpit_sync_state": rows})).items)


class OneOneNotesReadings(unittest.TestCase):
    """docs/forms/STAGE2-CONTRACT.md section 9: the three CSM readings the 1-1 notes change, through the registry."""

    def reading(self, check_id, tables):
        registry = {"cockpit_forms": [{"key": "checkin", "provider": "typeform", "provider_since": None}]}
        return checks_mod.by_id()[check_id].run(make({**registry, **tables}))

    def test_candidates_and_settled_rows_do_not_count_as_unmatched(self):
        def row(i, task_id=None, **kw):
            return {"id": i, "task_id": task_id, "source": "fathom", "starts_at": fakes.ago(120), "candidate": False,
                    "settled_reason": None, **kw}

        calls = [row(i, task_id="task-a") for i in range(5)]
        calls += [row(10 + i, candidate=True) for i in range(6)] + [row(20, settled_reason="blueprint")]
        r = self.reading("csm-calls-unmatched", {"cockpit_csm_calls": calls})
        self.assertEqual(r.status, OK, r.summary)
        self.assertEqual((r.evidence["unmatched"], r.evidence["candidates"], r.evidence["settled"]), (0, 6, 1))

    def test_the_form_check_passes_on_a_cockpit_checkin_row(self):
        forms = [{"form_id": "cockpit-checkin", "form_kind": "checkin", "submitted_at": fakes.ago(90)},
                 {"form_id": "fRokTITH", "form_kind": "checkin", "submitted_at": fakes.ago(12 * 1440)}]
        r = self.reading("csm-checkin-form", {"cockpit_csm_call_forms": forms})
        self.assertEqual(r.status, OK)
        self.assertIn("1.5 h ago", r.summary)

    def test_the_webhook_check_warns_and_passes_by_its_registration(self):
        meetings = [{"recording_id": "196100001", "recorder_team": "Customer Success", "first_seen_at": fakes.ago(60),
                     "summary": "An invented summary.", "raw": {"shared_with": "all_teams"}}]

        def run(detail, deliveries=(), stored=meetings):
            state = [{"key": "fathom-webhook", "note": "Registered webhook ending 9876", "detail": detail}]
            return self.reading("csm-fathom-webhook", {"cockpit_sync_state": state, "cockpit_fathom_meetings": stored,
                                                       "cockpit_fathom_webhook_deliveries": list(deliveries)})

        self.assertEqual(run({"registered": True}).status, WARN)
        delivered = [{"webhook_id": "msg_a", "outcome": "stored", "last_at": fakes.ago(55)}]
        self.assertEqual(run({"registered": True}, delivered).status, OK)
        # After a rollback unregisters it, nothing is expected.
        self.assertEqual(run({"registered": False, "unregisteredAt": fakes.ago(30)}).status, OK)
        self.assertEqual(self.reading("csm-fathom-webhook", {"cockpit_fathom_meetings": meetings}).status, OK)
        # A7 item 8: a day of short (no summary) or unshared calls is nothing Fathom pushes, so it no longer warns.
        short = dict(meetings[0], recording_id="196100002", summary=None)
        unshared = dict(meetings[0], recording_id="196100003", raw={"shared_with": "no_teams"})
        r = run({"registered": True}, stored=[short, unshared])
        self.assertEqual(r.status, OK, r.summary)
        self.assertEqual((r.evidence["csRecordings24h"], r.evidence["due24h"]), (2, 0))
        self.assertEqual(run({"registered": True}, stored=[short, unshared] + meetings).status, WARN)


class TestSectionsJobKeys:
    ALL = ("ai-watch-tick", "billing-sync", "ceo-extensions-auto", "clickup-writeback:log", "clickup-writeback:kpi",
           "clickup-writeback:dosdonts", "comment-watch", "hiring-sync:engine", "hiring-sync:intake",
           "hiring-sync:mirror", "hours-kick", "hours-watch", "hubstaff-sync", "onboarding-sync", "tap-charges-sync",
           "timetastic-sync", "tracking-audit", "csm-ghl-calls", "csm-checkin-form", "csm-forms-history", "csm-fathom",
           "csm-meta-activities", "csm-media-changes", "csm-reconcile", "lead-sync-watch") + REQUEST_JOBS


if __name__ == "__main__":
    unittest.main()


# ---- Stage 2b: the 1-1 notes queues and the WhatsApp recap sender (docs/forms/STAGE2B-CONTRACT.md section 6) ----


def form_row(state, minutes, task_id="86eywg1cq", **kw):
    return {"id": f"f-{state}-{minutes}-{task_id}", "kind": "form", "state": state, "task_id": task_id,
            "created_at": fakes.ago(minutes), **kw}


def effect(state, minutes, delivery="clickup_queue", **kw):
    return {"id": f"e-{delivery}-{state}-{minutes}", "delivery": delivery, "state": state, "created_at": fakes.ago(minutes),
            "updated_at": fakes.ago(minutes), **kw}


def message(state, minutes, **kw):
    return {"id": f"m-{state}-{minutes}", "kind": "recap_checkin", "state": state, "updated_at": fakes.ago(minutes),
            "body": "An invented recap that must never be read.", **kw}


class StageTwoBQueues(unittest.TestCase):
    def q(self, qid):
        return next(x for x in queues.QUEUES if x.id == qid)

    def run_q(self, qid, tables):
        db = fakes.FakeDb(tables)
        return queues.queue_check(self.q(qid))(make(db=db)), db

    def test_the_five_rows_as_the_contract_writes_them(self):
        f = self.q("queue-clickup-forms")
        self.assertEqual((f.table, f.label, f.states, f.time_col, f.limit_min, f.owner, f.status_col, f.kind_col, f.kinds,
                          f.failed_col, f.held_unless, f.held_label, f.limited),
                         ("cockpit_clickup_writeback_queue", "1-1 notes write bound for ClickUp",
                          ("queued", "sending", "retry", "unknown"), "created_at", 15, "the tech lead", "state", "kind",
                          ("form",), "updated_at", ("clickup-writeback:forms", "mode", "apply"),
                          "until the 1-1 notes writer opens", ("apply_limited", "onlyCards", "task_id")))
        self.assertIn("forms_doctor", f.action)
        self.assertIn("Cockpit ref F-", f.action)
        e = self.q("queue-form-effects")
        self.assertEqual((e.table, e.states, e.time_col, e.limit_min, e.kind_col, e.kinds, e.status_col, e.failed_col),
                         ("cockpit_form_effects", ("planned", "queued", "unknown"), "created_at", 30, "delivery",
                          ("clickup_queue", "slack_notice", "sql"), "state", "updated_at"))
        self.assertEqual(e.action, "Read the effect's reason in the 1-1 notes trail; the dispatch sweep runs every minute "
                                   "(RUNBOOK, 1-1 notes dispatch).")
        r = self.q("queue-form-recap")
        self.assertEqual((r.table, r.states, r.kinds, r.limit_min, r.kind_col), ("cockpit_form_effects", ("planned", "unknown"),
                                                                                  ("client_message",), 30, "delivery"))
        m = self.q("queue-client-messages")
        self.assertEqual((m.table, m.states, m.time_col, m.limit_min, m.failed_col, m.status_col),
                         ("cockpit_client_messages", ("approved", "claimed", "sending"), "updated_at", 15, "updated_at", "state"))
        self.assertEqual(m.action, "Run the client-messages doctor on the VPS (RUNBOOK, Client messages).")
        u = self.q("queue-client-messages-unknown")
        self.assertEqual((u.states, u.limit_min), (("unknown",), 0))
        self.assertEqual(u.action, "Look in the client's WhatsApp group for the message, then record seen_in_group or "
                                   "not_sent; the cockpit never sends it twice (RUNBOOK, Client messages).")
        for qid in ("queue-clickup-forms", "queue-form-effects", "queue-form-recap", "queue-client-messages",
                    "queue-client-messages-unknown"):
            self.assertIs(checks_mod.by_id()[qid].fix, None)
        self.assertIn("checkin.grade", queues.NOTICE_KINDS)
        self.assertIn("checkin.recap_late", queues.NOTICE_KINDS)
        self.assertEqual(queues.ERROR_COLUMN, {"cockpit_client_messages": "reason", "cockpit_form_effects": "reason"})

    def test_the_requests_row_still_reads_as_before(self):
        q = self.q("queue-clickup-requests")
        self.assertEqual((q.held_label, q.limited), ("until requests open", None))

    def test_a_forms_row_is_held_until_the_writer_opens_and_live_for_the_canary_card_when_limited(self):
        rows = [form_row("queued", 400, "86eywg1cq"), form_row("queued", 300, "86ewvnqh5"), form_row("retry", 9)]

        def run(detail):
            state = [] if detail is None else [{"key": "clickup-writeback:forms", "detail": detail}]
            db = fakes.FakeDb({"cockpit_clickup_writeback_queue": rows, "cockpit_sync_state": state})
            return queues.queue_check(self.q("queue-clickup-forms"))(make(db=db))

        for detail in (None, {"mode": "dry_run"}, {"mode": "unknown"}):
            r = run(detail)
            self.assertEqual(r.status, OK, detail)
            self.assertIn("2 held until the 1-1 notes writer opens.", r.summary)
            self.assertEqual(r.evidence["held"], 2)
        # Limited to the canary card: its old queued row is live (and warns), the other card's is held.
        r = run({"mode": "apply_limited", "onlyCards": ["86eywg1cq"]})
        self.assertEqual(r.status, WARN)
        self.assertEqual(r.evidence["held"], 1)
        self.assertEqual(r.evidence["oldest"]["id"], "f-queued-400-86eywg1cq")
        # Limited to another card: both queued rows are held.
        r = run({"mode": "apply_limited", "onlyCards": ["86eother"]})
        self.assertEqual((r.status, r.evidence["held"]), (OK, 2))
        r = run({"mode": "apply_limited", "onlyCards": "86eywg1cq"})
        self.assertEqual((r.status, r.evidence["held"]), (OK, 2))
        # Open: every queued row counts.
        r = run({"mode": "apply", "onlyCards": []})
        self.assertEqual((r.status, r.evidence["held"]), (WARN, 0))
        self.assertIn("the oldest is queued", r.summary)
        # Rows of other kinds are not this row's.
        db = fakes.FakeDb({"cockpit_clickup_writeback_queue": [queued("unknown", 400)], "cockpit_sync_state": []})
        self.assertEqual(queues.queue_check(self.q("queue-clickup-forms"))(make(db=db)).status, OK)
        self.assertIn("or apply_limited for the rows whose task_id is in its onlyCards",
                      checks_mod.by_id()["queue-clickup-forms"].reads)

    def test_an_unknown_forms_row_warns_whatever_the_mode(self):
        db = fakes.FakeDb({"cockpit_clickup_writeback_queue": [form_row("unknown", 30, error="ClickUp did not answer.")],
                           "cockpit_sync_state": [{"key": "clickup-writeback:forms", "detail": {"mode": "dry_run"}}]})
        r = queues.queue_check(self.q("queue-clickup-forms"))(make(db=db))
        self.assertEqual(r.status, WARN)
        self.assertIn("ClickUp did not answer.", r.summary)

    def test_effects_read_their_reason_and_leave_the_recap_out(self):
        rows = {"cockpit_form_effects": [effect("planned", 45, reason="Waiting for the grade.", delivery="slack_notice"),
                                         effect("queued", 600, delivery="client_message", reason="Waiting on a person."),
                                         effect("delivered", 900)]}
        r, _ = self.run_q("queue-form-effects", rows)
        self.assertEqual(r.status, WARN)
        self.assertIn("1 1-1 notes effect(s) waited past 30 min; the oldest is planned for 45 min", r.summary)
        self.assertIn("Waiting for the grade.", r.summary)
        # A queued recap waits on a person by design (Z36): the recap row counts only planned and unknown.
        r, _ = self.run_q("queue-form-recap", rows)
        self.assertEqual(r.status, OK)
        rows["cockpit_form_effects"].append(effect("unknown", 50, delivery="client_message", reason="WhatsApp did not confirm."))
        r, _ = self.run_q("queue-form-recap", rows)
        self.assertEqual(r.status, WARN)
        self.assertIn("WhatsApp did not confirm.", r.summary)

    def test_a_failed_effect_in_24_hours_warns_by_its_reason(self):
        rows = {"cockpit_form_effects": [effect("failed", 90, updated_at=fakes.ago(30), reason="No grade: the grader did not answer.")]}
        r, _ = self.run_q("queue-form-effects", rows)
        self.assertEqual(r.status, WARN)
        self.assertIn("No grade: the grader did not answer.", r.summary)

    def test_messages_read_their_reason_never_their_body(self):
        rows = {"cockpit_client_messages": [message("approved", 20, reason="Approved by csm."), message("draft", 900)]}
        r, db = self.run_q("queue-client-messages", rows)
        self.assertEqual(r.status, WARN)
        self.assertIn("1 client WhatsApp message(s) waited past 15 min; the oldest is approved for 20 min", r.summary)
        self.assertNotIn("invented recap", r.summary + str(r.evidence))
        r, _ = self.run_q("queue-client-messages-unknown", {"cockpit_client_messages": [message("unknown", 2,
                          reason="The sender stopped while sending. Look in the group before anything else.")]})
        self.assertEqual(r.status, WARN)
        self.assertIn("1 WhatsApp message with an unknown outcome(s) are open", r.summary)
        self.assertIn("Look in the group before anything else.", r.summary)
        r, _ = self.run_q("queue-client-messages-unknown", {"cockpit_client_messages": []})
        self.assertEqual(r.summary, "No WhatsApp message with an unknown outcome is open.")
        for qid in ("queue-client-messages", "queue-client-messages-unknown"):
            self.assertNotIn("body", checks_mod.by_id()[qid].reads)

    def test_the_door_is_expected_with_verify_jwt_off(self):
        self.assertIs(edge_functions.EXPECTED["forms-door"], False)
        listed = [{"slug": s, "status": "ACTIVE", "verify_jwt": j} for s, j in edge_functions.EXPECTED.items()]
        gone = [f for f in listed if f["slug"] != "forms-door"]
        r = edge_functions.run_functions(make(db=fakes.FakeDb(functions=gone)))
        self.assertEqual(r.status, FAIL)
        self.assertIn("forms-door is missing", r.summary)


def sender(minutes=1, ok=True, note="Nothing approved to send. Sending is off until the switch-over.", **detail):
    return {"key": "client-messages", "ok": ok, "note": note, "last_run_at": fakes.ago(minutes),
            "last_ok_at": fakes.ago(minutes), "detail": {"mode": "dry", "kinds": ["recap_checkin"], "onlyCards": [],
                                                          "approved": 0, **detail}}


class ClientMessagesChecks(unittest.TestCase):
    def test_registered_report_only(self):
        for cid in ("client-messages", "client-messages-read-back", "client-messages-read-back-stopped",
                    "client-messages-g5"):
            c = checks_mod.by_id()[cid]
            self.assertIs(c.fix, None)
            self.assertEqual(c.owner, "the tech lead")
        self.assertIs(checks_mod.by_id()["client-messages-g5"].alert, False)

    def test_no_row_reads_ok_before_d14(self):
        r = client_messages.run_sender(make({}))
        self.assertEqual(r.status, OK)
        self.assertEqual(r.summary, "Not installed yet: the client messages cron starts at deploy D14.")

    def test_modes(self):
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender()]}))
        self.assertEqual((r.status, r.summary), (OK, "Dry: sending is off until the switch-over."))
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender(mode="apply", onlyCards=["86eywg1cq"])]}))
        self.assertEqual((r.status, r.summary), (OK, "Sending is open only for the test card."))
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender(mode="apply")]}))
        self.assertEqual((r.status, r.summary), (OK, "Sending is open for every client."))
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender(mode="apply_limited")]}))
        self.assertEqual(r.status, WARN)

    def test_a_dry_run_writes_no_hold_and_the_check_never_claims_to_read_one(self):
        # As hermes/client-messages writes a dry run with approved recaps, whatever the old senders say: ok true and
        # held null. The old senders' state is in the doctor and the run's plan.
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender(
            note="2 approved to send. Sending is off until the switch-over.", approved=2, held=None)]}))
        self.assertEqual((r.status, r.summary), (OK, "Dry: sending is off until the switch-over."))
        threshold = checks_mod.by_id()["client-messages"].threshold
        self.assertIn("detail.held, written only in apply mode", threshold)
        self.assertNotIn("detail.held, either mode", threshold)
        readme = (Path(__file__).resolve().parents[1] / "README.md").read_text(encoding="utf-8")
        self.assertIn(threshold, readme)

    def test_a_hold_reads_as_held_never_as_a_failed_run(self):
        # As hermes/client-messages writes a hold, only in apply mode: ok false, the sentence in detail.held and as the note.
        hold = "The old senders could not be read (no answer), so the recaps wait."
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender(
            ok=False, note=hold, mode="apply", approved=2, held=hold)]}))
        self.assertEqual(r.status, WARN)
        self.assertEqual(r.summary, f"2 approved recaps held: {hold}")
        self.assertNotIn("failed its last run", r.summary)
        self.assertEqual(r.evidence["held"], hold)
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender(
            ok=False, note="Client Data's group column moved.", mode="apply", approved=1, held="Client Data's group column moved.")]}))
        self.assertEqual(r.summary, "1 approved recap held: Client Data's group column moved.")
        # A held flag without its sentence falls back to the note; a count that is not a number is never read as 0.
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender(
            ok=False, note="Make's recap sender is still on.", mode="apply", approved=None, held=True)]}))
        self.assertEqual(r.summary, "The approved recaps are held: Make's recap sender is still on.")
        # No hold: ok false is a failed run.
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender(
            ok=False, note="Client Data could not be read, so nothing was sent: no answer.", mode="apply", approved=1, held=None)]}))
        self.assertEqual(r.status, FAIL)
        self.assertIn("failed its last run: Client Data could not be read", r.summary)

    def test_stale_after_ten_minutes_and_a_failed_run_fails(self):
        self.assertEqual(client_messages.run_sender(make({"cockpit_sync_state": [sender(minutes=9)]})).status, OK)
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender(minutes=11)]}))
        self.assertEqual(r.status, FAIL)
        self.assertIn("has not run for 11 min (limit 10 min)", r.summary)
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender(ok=False, note="Supabase GET failed (503)")]}))
        self.assertEqual(r.status, FAIL)
        self.assertIn("failed its last run: Supabase GET failed (503)", r.summary)

    def test_a_provider_answer_the_ledger_lost_warns_in_either_mode_never_as_ok(self):
        # As hermes/client-messages writes it: the run stays ok, the count is in detail.receiptsMissing and the note
        # ends with RECEIPTS_LOST.
        lost = ("Sent 1 recap. The health ledger is missing the answer to 1 provider call that had already left. "
                "Check that the database takes provider receipts (RUNBOOK, Client messages).")
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender(
            note=lost, mode="apply", approved=1, sent=1, receiptsMissing=1)]}))
        self.assertEqual(r.status, WARN)
        self.assertEqual(r.summary, "1 provider call left without its answer saved in the health ledger.")
        self.assertEqual(r.action, "Check that the database takes provider receipts, then run the client-messages "
                                   "doctor (hermes/client-messages/RUNBOOK.md).")
        self.assertEqual(r.evidence["receiptsMissing"], 1)
        # A dry run calls providers too (Client Data, ClickUp), and a test-card run is no exception.
        for mode, cards in (("dry", []), ("apply", ["86eywg1cq"])):
            with self.subTest(mode=mode, cards=cards):
                r = client_messages.run_sender(make({"cockpit_sync_state": [sender(
                    mode=mode, onlyCards=cards, receiptsMissing=3)]}))
                self.assertEqual(r.status, WARN)
                self.assertEqual(r.summary, "3 provider calls left without their answers saved in the health ledger.")
        # The next run that saves every answer reads 0 and clears it.
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender(mode="apply", receiptsMissing=0)]}))
        self.assertEqual((r.status, r.summary), (OK, "Sending is open for every client."))
        self.assertEqual(r.evidence["receiptsMissing"], 0)
        # No count (a sender from before receiptsMissing) or one that is not a whole number is not read, never as
        # lost and never as 0.
        for odd in (None, True, "2", 1.5, -1):
            with self.subTest(receiptsMissing=odd):
                r = client_messages.run_sender(make({"cockpit_sync_state": [sender(receiptsMissing=odd)]}))
                self.assertEqual((r.status, r.summary), (OK, "Dry: sending is off until the switch-over."))
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender()]}))
        self.assertNotIn("receiptsMissing", r.evidence)
        # A hold and a failed run still read as themselves first.
        hold = "Make's recap sender is still on."
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender(
            ok=False, note=hold, mode="apply", approved=1, held=hold, receiptsMissing=2)]}))
        self.assertEqual((r.status, r.summary), (WARN, f"1 approved recap held: {hold}"))
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender(
            ok=False, note="Supabase GET failed (503)", mode="apply", receiptsMissing=2)]}))
        self.assertEqual(r.status, FAIL)
        self.assertIn("failed its last run", r.summary)
        # A stale row is stale, whatever its last run lost.
        r = client_messages.run_sender(make({"cockpit_sync_state": [sender(minutes=11, receiptsMissing=2)]}))
        self.assertEqual(r.status, FAIL)
        self.assertIn("has not run for 11 min", r.summary)
        self.assertIn("detail.receiptsMissing", checks_mod.by_id()["client-messages"].reads)

    def test_a_sent_recap_with_no_read_back_after_an_hour_warns(self):
        rows = [{"id": "m1", "state": "sent", "sent_at": fakes.ago(90), "read_back_at": None, "body": "never read"},
                {"id": "m2", "state": "sent", "sent_at": fakes.ago(30), "read_back_at": None},
                {"id": "m3", "state": "sent", "sent_at": fakes.ago(300), "read_back_at": fakes.ago(299)}]
        r = client_messages.run_read_back(make({"cockpit_client_messages": rows}))
        self.assertEqual(r.status, WARN)
        self.assertIn("1 sent recap not read back after 60 min", r.summary)
        self.assertEqual(r.items, ["m1"])
        self.assertNotIn("never read", r.summary + str(r.evidence))
        self.assertEqual(client_messages.run_read_back(make({"cockpit_client_messages": rows[1:]})).status, OK)

    @staticmethod
    def unread(mid, hours):
        return {"id": mid, "state": "sent", "sent_at": fakes.ago(hours * 60), "read_back_at": None, "body": "never read"}

    def test_the_read_back_warning_stops_where_the_sender_stops(self):
        # The sender reads back only sent_at > now() - 24 hours (20261029v): past that only a person's seen_in_group
        # closes the row, so one old row must not keep this check amber for good, nor hide a new one behind it.
        old = self.unread("m-old", 25)
        r = client_messages.run_read_back(make({"cockpit_client_messages": [old]}))
        self.assertEqual((r.status, r.evidence), (OK, {"unread": 0}))
        self.assertEqual(r.summary, "Every recap sent 60 min to 24 h ago was read back in its group.")
        # A row of 23 hours still warns, in its own words, and alone beside the old row.
        r = client_messages.run_read_back(make({"cockpit_client_messages": [old, self.unread("m-new", 23)]}))
        self.assertEqual((r.status, r.items), (WARN, ["m-new"]))
        self.assertIn("1 sent recap not read back after 60 min", r.summary)
        self.assertEqual(r.action, "Look in the client's WhatsApp group for the recap; the sender keeps reading back for "
                                   "24 hours and never sends it again. If it is there, record seen_in_group "
                                   "(hermes/client-messages/RUNBOOK.md, Recording what a person saw).")
        self.assertEqual(checks_mod.by_id()["client-messages-read-back"].action, r.action)
        # The limit is the sender's: exactly 24 hours old is no longer read back.
        r = client_messages.run_read_back(make({"cockpit_client_messages": [self.unread("m-edge", 24)]}))
        self.assertEqual(r.status, OK)

    def test_a_recap_the_sender_stopped_reading_back_is_reported_for_one_day(self):
        c = checks_mod.by_id()["client-messages-read-back-stopped"]
        self.assertEqual((c.severity, c.alert, c.fix, c.owner), ("low", False, None, "the tech lead"))
        for hours in (24, 25, 47.9):
            with self.subTest(hours=hours):
                r = client_messages.run_read_back_stopped(make({"cockpit_client_messages": [self.unread("m-old", hours)]}))
                self.assertEqual((r.status, r.items), (WARN, ["m-old"]))
                self.assertIn("1 sent recap not read back in 24 h, and the sender has stopped trying", r.summary)
                self.assertEqual(r.action, "Look in the client's WhatsApp group for the recap; if it is there, record "
                                           "seen_in_group (hermes/client-messages/RUNBOOK.md, Recording what a person "
                                           "saw). It is never sent again. This reading clears by itself after a day.")
                self.assertEqual(c.action, r.action)
                self.assertNotIn("never read", r.summary + str(r.evidence))
        # Not its business: still inside the sender's 24 hours, read back, or not a sent row.
        rows = [self.unread("m-new", 23), {**self.unread("m-read", 30), "read_back_at": fakes.ago(30 * 60 - 1)},
                {**self.unread("m-unknown", 30), "state": "unknown"}]
        r = client_messages.run_read_back_stopped(make({"cockpit_client_messages": rows}))
        self.assertEqual((r.status, r.summary), (OK, "No recap ran out of its 24 h read-back in the last day."))
        self.assertEqual(r.evidence, {"stopped": 0, "older": 0})

    def test_a_persons_seen_in_group_closes_the_row_in_both_checks(self):
        # cockpit_client_message_fix writes read_back_at with read_back {by: person} (20261029v); the sender's answer does too.
        for hours, run in ((23, client_messages.run_read_back), (30, client_messages.run_read_back_stopped)):
            with self.subTest(hours=hours):
                row = self.unread("m-seen", hours)
                self.assertEqual(run(make({"cockpit_client_messages": [row]})).status, WARN)
                seen = {**row, "read_back_at": fakes.ago(5), "read_back": {"by": "person"}}
                self.assertEqual(run(make({"cockpit_client_messages": [seen]})).status, OK)

    def test_a_recap_past_the_day_is_counted_never_read_as_read_back(self):
        one = [self.unread("m-1", 49)]
        r = client_messages.run_read_back_stopped(make({"cockpit_client_messages": one}))
        self.assertEqual(r.status, OK)
        self.assertEqual(r.summary, "No recap ran out of its 24 h read-back in the last day. 1 older recap was never read back.")
        self.assertEqual(r.evidence, {"stopped": 0, "older": 1})
        two = [*one, self.unread("m-2", 200), self.unread("m-3", 30)]
        r = client_messages.run_read_back_stopped(make({"cockpit_client_messages": two}))
        self.assertEqual((r.status, r.items, r.evidence), (WARN, ["m-3"], {"stopped": 1, "older": 2}))
        r = client_messages.run_read_back_stopped(make({"cockpit_client_messages": two[:2]}))
        self.assertIn("2 older recaps were never read back.", r.summary)

    def test_g5_warns_until_it_reads_same_number(self):
        self.assertEqual(client_messages.run_g5(make({})).status, WARN)
        g5 = {"key": "client-messages-g5", "ok": False, "note": "not proven", "last_run_at": fakes.ago(5)}
        r = client_messages.run_g5(make({"cockpit_sync_state": [g5]}))
        self.assertEqual(r.status, WARN)
        self.assertIn("not proven", r.summary)
        r = client_messages.run_g5(make({"cockpit_sync_state": [{**g5, "ok": True, "note": "same number"}]}))
        self.assertEqual(r.status, OK)


class FormsMachineryIsWatched(unittest.TestCase):
    """Round 1 of the 2b review: the 1-1 notes machinery's cron job and health rows had no watch, so a stopped forms
    cron would read as nothing wrong until a row queued after the cut-over."""

    def rows(self, **ages):
        return [{"key": k, "ok": True, "last_ok_at": fakes.ago(ages.get(k.replace(":", "_").replace("-", "_"), 1))}
                for k in TestSectionsJobKeys.ALL]

    def test_the_forms_cron_job_is_expected(self):
        self.assertIn("mahara-clickup-writeback-forms", pg_cron.EXPECTED_JOBS)
        jobs = [{"jobid": i, "jobname": n, "schedule": "* * * * *", "active": n != "mahara-clickup-writeback-forms"}
                for i, n in enumerate(pg_cron.EXPECTED_JOBS)]
        r = pg_cron.run_jobs(make(db=fakes.FakeDb(probe={"cron_jobs": jobs})))
        self.assertEqual(r.status, FAIL)
        self.assertEqual(r.items, ["mahara-clickup-writeback-forms"])

    def test_each_forms_row_is_watched_and_a_missing_one_is_late_never_zero(self):
        for key in ("clickup-writeback:forms", "forms-effects-kick", "csm-forms-record"):
            rows = [r for r in self.rows() if r["key"] != key]
            self.assertEqual(sections.run_jobs(make({"cockpit_sync_state": rows})).items, [key])

    def test_an_idle_forms_writer_reporting_every_ten_minutes_is_not_late(self):
        # cockpit_clickup_forms_kick (20261029t) posts an idle run only once the last report is over ten minutes old, so
        # the row can be 11 minutes old between healthy reports (D5's read-back waits 11 minutes for the same reason).
        self.assertEqual(sections.run_jobs(make({"cockpit_sync_state": self.rows(clickup_writeback_forms=12)})).status, OK)
        late = sections.run_jobs(make({"cockpit_sync_state": self.rows(clickup_writeback_forms=16)}))
        self.assertEqual(late.items, ["clickup-writeback:forms"])

    def test_the_dispatch_kick_runs_every_minute_and_the_record_every_15(self):
        self.assertEqual(sections.run_jobs(make({"cockpit_sync_state": self.rows(forms_effects_kick=11)})).items,
                         ["forms-effects-kick"])
        self.assertEqual(sections.run_jobs(make({"cockpit_sync_state": self.rows(csm_forms_record=44)})).status, OK)
        self.assertEqual(sections.run_jobs(make({"cockpit_sync_state": self.rows(csm_forms_record=46)})).items,
                         ["csm-forms-record"])

    def test_a_dispatch_that_fails_reads_failed(self):
        rows = self.rows()
        next(r for r in rows if r["key"] == "forms-effects-kick")["ok"] = False
        self.assertEqual(sections.run_jobs(make({"cockpit_sync_state": rows})).items, ["forms-effects-kick"])

    def test_the_readme_lists_every_stage_2b_row(self):
        readme = (Path(__file__).resolve().parents[1] / "README.md").read_text(encoding="utf-8")
        for check_id in ("queue-clickup-forms", "queue-form-effects", "queue-form-recap", "queue-client-messages",
                         "queue-client-messages-unknown", "client-messages", "client-messages-read-back",
                         "client-messages-g5", "csm-impromptu-notes", "forms-kickoff-webhook", "csm-checkin-form"):
            self.assertIn(f"| `{check_id}` |", readme)

