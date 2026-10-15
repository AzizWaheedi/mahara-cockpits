"""The end of day outbox reading (W8): what 2026-10-12 to 10-14 needed it to say.

The media buyer's 10-11 EOD failed on channel_not_found at 01:50 on 10-12. The
old reading warned at 09:00, told a person to invite the bot to #eods-salesreps
for a not_in_channel error, and resolved itself at 01:30 on 10-13 (24 hours
after the row was made) while the EOD was still not in Slack.
"""
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from tests import fakes
from tests.test_engine import Box, Harness, KUWAIT_NIGHT
import checks as checks_mod
from checks import pg_cron, queues
from guard.model import FAIL, OK, WARN

JOBS = {"cron_jobs": [{"jobname": "mahara-eod-retry", "active": True}]}


def make(rows, probe=JOBS):
    db = fakes.FakeDb({"eod_outbox": rows}, probe=probe)
    return fakes.ctx(Path(tempfile.mkdtemp()), db=db, host=fakes.FakeHost(fakes.snapshot()))


def row(**kw):
    base = {"id": 3, "role": "media_buyer", "day": "2026-10-11", "person": "Somebody Private", "channel": "C0AQ2LD0PL1",
            "tab": "Media Buyer", "sheet_started_at": None, "status": "failed", "attempts": 5, "error": "RuntimeError: slack: channel_not_found", "sheet_error": None,
            "slack_ts": None, "sheet_at": fakes.ago(30), "reconciliation_needed": False, "reconcile_reason": None,
            "created_at": fakes.ago(30)}
    base.update(kw)
    return base


class EodOutbox(unittest.TestCase):
    def test_a_failed_media_buyer_eod_is_broken_at_any_hour_and_names_its_channel(self):
        r = queues.run_eod_outbox(make([row()]))
        self.assertEqual(r.status, FAIL)
        self.assertTrue(r.urgent)
        self.assertIn("media buyer EOD for 2026-10-11 is not in #media-eods", r.summary)
        self.assertIn("channel_not_found", r.summary)
        self.assertIn("#media-eods", r.action)
        self.assertIn("mahara-club-bot", r.action)
        self.assertNotIn("#eods-salesreps", r.action)
        self.assertEqual(r.items, ["media_buyer 2026-10-11 (row 3)"])

    def test_it_never_reads_or_says_the_persons_name(self):
        db = fakes.FakeDb({"eod_outbox": [row()]}, probe=JOBS)
        ctx = fakes.ctx(Path(tempfile.mkdtemp()), db=db, host=fakes.FakeHost(fakes.snapshot()))
        r = queues.run_eod_outbox(ctx)
        self.assertNotIn("person", queues.EOD_COLUMNS.split(","))
        self.assertNotIn("Somebody", r.summary + r.action + repr(r.evidence))

    def test_it_stays_broken_past_24_hours_while_the_eod_is_not_posted(self):
        r = queues.run_eod_outbox(make([row(created_at=fakes.ago(25 * 60))]))
        self.assertEqual(r.status, FAIL)
        self.assertIn("tried again hourly until", r.summary)
        gone = queues.run_eod_outbox(make([row(created_at=fakes.ago(8 * 24 * 60))]))
        self.assertEqual(gone.status, OK)

    def test_a_row_the_hourly_retry_queued_again_does_not_flap_to_waiting(self):
        r = queues.run_eod_outbox(make([row(status="queued", attempts=4, created_at=fakes.ago(26 * 60))]))
        self.assertEqual(r.status, FAIL)

    def test_a_first_refusal_the_next_run_may_clear_is_not_an_incident(self):
        first = row(status="queued", attempts=1, error="RuntimeError: slack: ratelimited", created_at=fakes.ago(6))
        self.assertEqual(queues.run_eod_outbox(make([first])).status, OK)
        self.assertEqual(queues.run_eod_outbox(make([dict(first, created_at=fakes.ago(20))])).status, FAIL)

    def test_a_row_with_no_answer_from_the_worker_warns_after_15_minutes(self):
        fresh = row(status="queued", attempts=0, error=None, sheet_at=None)
        self.assertEqual(queues.run_eod_outbox(make([dict(fresh, created_at=fakes.ago(10))])).status, OK)
        r = queues.run_eod_outbox(make([dict(fresh, created_at=fakes.ago(20))]))
        self.assertEqual(r.status, WARN)
        self.assertIn("eodout.log", r.action)

    def test_posted_but_not_in_the_sheet_is_broken_but_not_urgent(self):
        r = queues.run_eod_outbox(make([row(slack_ts="1.2", sheet_at=None, error=None, sheet_error="HTTP Error 403")]))
        self.assertEqual(r.status, FAIL)
        self.assertFalse(r.urgent)
        self.assertIn("is not in the EOD sheet", r.summary)
        # Look before sending again: the live worker cannot tell a timed-out append from a refused one.
        self.assertIn("Look for it in the 'Media Buyer' tab first", r.action)
        self.assertIn("If it is missing", r.action)
        self.assertIn("cockpit_requeue_eod_outbox(3)", r.action)
        self.assertLess(r.action.index("Look for it"), r.action.index("cockpit_requeue_eod_outbox"))
        started = queues.run_eod_outbox(make([row(slack_ts="1.2", sheet_at=None, error=None, sheet_started_at=fakes.ago(20))]))
        self.assertIn("look in the 'Media Buyer' tab", started.action)
        self.assertNotIn("cockpit_requeue_eod_outbox", started.action)

    def test_the_action_follows_slacks_answer(self):
        auth = queues.run_eod_outbox(make([row(error="KnownNotSent: slack: invalid_auth")]))
        self.assertIn("SLACK_BOT_TOKEN", auth.action)
        cut = queues.run_eod_outbox(make([row(reconciliation_needed=True, error="Slack ambiguous")]))
        self.assertIn("look in #media-eods", cut.action)
        other = queues.run_eod_outbox(make([row(error="ValueError: boom")]))
        self.assertIn("~/.eodout.log", other.action)
        sales = queues.run_eod_outbox(make([row(role="sales_closer", channel="C0AF5PJEAUX")]))
        self.assertIn("#eods-salesreps", sales.action)
        win = queues.run_eod_outbox(make([row(role="csm-win", channel="#eods-csms")]))
        self.assertFalse(win.urgent)

    def test_it_says_when_the_hourly_retry_is_not_scheduled(self):
        r = queues.run_eod_outbox(make([row()], probe={"cron_jobs": [{"jobname": "mahara-sales-mirror", "active": True}]}))
        self.assertIn("is not scheduled: apply 20261015190100", r.action)
        self.assertNotIn("tried again hourly", r.summary)

    def test_the_pg_cron_jobs_check_fails_when_the_hourly_retry_is_missing_or_off(self):
        self.assertIn(queues.EOD_RETRY_JOB, pg_cron.EXPECTED_JOBS)
        every = [{"jobid": i, "jobname": n, "schedule": "* * * * *", "active": True}
                 for i, n in enumerate(pg_cron.EXPECTED_JOBS)]

        def jobs(rows):
            db = fakes.FakeDb(probe={"cron_jobs": rows, "cron_runs": [], "http_1h": {}})
            return pg_cron.run_jobs(fakes.ctx(Path(tempfile.mkdtemp()), db=db))

        self.assertEqual(jobs(every).status, OK)
        gone = jobs([j for j in every if j["jobname"] != queues.EOD_RETRY_JOB])
        self.assertEqual((gone.status, gone.items), (FAIL, [queues.EOD_RETRY_JOB]))
        off = jobs([dict(j, active=False) if j["jobname"] == queues.EOD_RETRY_JOB else j for j in every])
        self.assertEqual((off.status, off.items), (FAIL, [queues.EOD_RETRY_JOB]))

    def test_the_check_is_medium_and_an_urgent_reading_posts_at_night(self):
        check = checks_mod.by_id()["queue-eod-outbox"]
        self.assertEqual((check.severity, check.catalogue), ("medium", "W8"))
        b = Box(fixable=False)
        h = Harness([b.check])
        b.result = queues.run_eod_outbox(make([row()]))
        h.scan(KUWAIT_NIGHT)
        self.assertEqual(len(h.posted), 1)


if __name__ == "__main__":
    unittest.main()
