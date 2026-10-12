import copy
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import urllib.error

import worker as w

LID = "901816723190"
NOW = 1791816000000


def task(tid="t1", people=(1,), **extra):
    return {"id": tid, "name": "Review launch plan", "list": {"id": LID}, "parent": None,
            "status": {"type": "open"}, "assignees": [{"id": x, "email": f"u{x}@example.test", "username": f"User {x}"} for x in people], **extra}


class Fake:
    def __init__(self):
        self.rows = {key: [] for key in w.ROUTES}
        self.current, self.posts, self.receipts, self.since = {}, [], {}, []
        self.fail_list = None
        self.send_error = None

    def tasks(self, lid, since=None):
        self.since.append((lid, since))
        if self.fail_list == lid:
            raise ValueError("Source unavailable")
        return copy.deepcopy(self.rows[lid])

    def task(self, tid):
        return copy.deepcopy(self.current[tid])

    def users(self):
        return {f"u{x}@example.test": f"U00{x}" for x in (1, 2, 3)}

    def send(self, payload):
        self.posts.append(payload)
        if self.send_error:
            raise self.send_error
        return "1791816000.001"

    def find_receipt(self, channel, event, since):
        return self.receipts.get(event)


class Worker(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = w.open_db(Path(self.tmp.name)/"ledger.sqlite3", True)
        self.api = Fake()
        w.poll(self.db, self.api, bootstrap=True, now=NOW)

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def observe(self, t):
        self.api.rows[LID] = [t]
        self.api.current[t["id"]] = t
        return w.poll(self.db, self.api, now=NOW+60000)

    def state(self):
        return dict(self.db.execute("select state,count(*) from deliveries group by state").fetchall())

    def test_exact_six_routes_sales_excluded(self):
        self.assertEqual(len(w.ROUTES), 6)
        self.assertEqual(w.ROUTES["901816723196"][1], "C0C8DLZGTMZ")
        self.assertEqual(w.ROUTES["901818016338"][1], "C0AE8G5MT7Y")
        self.assertNotIn("C09SVD1SCMA", [r[1] for r in w.ROUTES.values()])

    def test_baseline_never_queues_old_assignments(self):
        with tempfile.TemporaryDirectory() as path:
            db = w.open_db(Path(path)/"db", True)
            self.api.rows[LID] = [task()]
            report = w.poll(db, self.api, bootstrap=True, apply=True, now=NOW)
            self.assertEqual(report["states"], {})
            self.assertEqual(self.api.posts, [])
            with self.assertRaises(RuntimeError): w.poll(db, self.api, bootstrap=True, now=NOW)
            db.close()

    def test_new_task_mentions_assignees_once_with_one_link(self):
        t = task(people=(1, 2))
        self.observe(t)
        w.dispatch(self.db, self.api, NOW+60000)
        self.observe(t)
        w.dispatch(self.db, self.api, NOW+120000)
        self.assertEqual(self.state(), {"accepted": 1})
        self.assertEqual(len(self.api.posts), 1)
        self.assertIn("<@U001>", self.api.posts[0]["text"])
        self.assertIn("<@U002>", self.api.posts[0]["text"])
        self.assertEqual(self.api.posts[0]["blocks"][3]["elements"][0]["url"], "https://app.clickup.com/t/t1")

    def test_unassigned_then_assigned(self):
        self.observe(task(people=()))
        self.assertEqual(self.state(), {})
        self.observe(task())
        self.assertEqual(self.state(), {"queued": 1})

    def test_reassignment_mentions_only_new_person(self):
        self.observe(task()); w.dispatch(self.db, self.api, NOW+60000)
        self.observe(task(people=(1, 2))); w.dispatch(self.db, self.api, NOW+120000)
        self.assertIn("<@U002>", self.api.posts[-1]["text"])
        self.assertNotIn("<@U001>", self.api.posts[-1]["text"])
        self.assertEqual(len(self.api.posts), 2)

    def test_rename_due_date_status_comments_do_not_realert(self):
        self.observe(task()); w.dispatch(self.db, self.api, NOW+60000)
        self.observe(task(name="Updated name", due_date=str(NOW), status={"type": "custom"}))
        w.dispatch(self.db, self.api, NOW+120000)
        self.assertEqual(len(self.api.posts), 1)

    def test_closing_and_reopening_does_not_reassign(self):
        self.observe(task()); w.dispatch(self.db, self.api, NOW+60000)
        self.observe(task(status={"type": "closed"})); self.observe(task())
        w.dispatch(self.db, self.api, NOW+120000)
        self.assertEqual(len(self.api.posts), 1)

    def test_subtasks_closed_archived_and_missing_status_never_queue(self):
        for extra in ({"parent": "parent1"}, {"status": {"type": "closed"}}, {"archived": True}, {"status": {}}):
            t = task(tid="id"+str(len(extra))+str(len(self.api.current)), **extra)
            self.observe(t)
        self.assertEqual(self.state(), {})

    def test_missing_parent_and_mismatched_list_preserve_cursor(self):
        for t in (task(list={"id": "unapproved"}), {k:v for k,v in task().items() if k != "parent"}):
            report = self.observe(t)
            self.assertFalse(report["healthy"])
            self.assertEqual(report["lists"][LID], NOW)
            self.assertEqual(report["states"], {})

    def test_deleted_assignment_before_send_is_skipped(self):
        self.observe(task())
        self.api.current["t1"] = task(people=())
        w.dispatch(self.db, self.api, NOW+60000)
        self.assertEqual(self.state(), {"skipped": 1})
        self.assertEqual(self.api.posts, [])

    def test_closed_moved_or_converted_before_send_is_skipped(self):
        for n, extra in enumerate(({"status": {"type": "closed"}}, {"parent": "parent"}, {"list": {"id": "different"}})):
            self.observe(task(tid=f"t{n}"))
            self.api.current[f"t{n}"] = task(tid=f"t{n}", **extra)
        w.dispatch(self.db, self.api, NOW+60000)
        self.assertEqual(self.state(), {"skipped": 3})

    def test_ambiguous_post_never_replayed_and_receipt_can_reconcile(self):
        self.observe(task()); self.api.send_error = w.ProviderError("Slack", "Timeout", ambiguous=True)
        w.dispatch(self.db, self.api, NOW+60000)
        w.dispatch(self.db, self.api, NOW+120000)
        self.assertEqual(len(self.api.posts), 1)
        self.assertEqual(self.state(), {"unknown": 1})
        event = self.api.posts[0]["client_msg_id"]
        self.api.receipts[event] = "1791816000.001"
        w.dispatch(self.db, self.api, NOW+180000)
        self.assertEqual(self.state(), {"accepted": 1})
        self.assertEqual(len(self.api.posts), 1)

    def test_process_stopped_during_post_is_not_retried(self):
        self.observe(task())
        with self.db: self.db.execute("update deliveries set state='sending'")
        w.dispatch(self.db, self.api, NOW+60000)
        self.assertEqual(self.state(), {"unknown": 1})
        self.assertEqual(self.api.posts, [])

    def test_explicit_rate_limit_has_bounded_retry(self):
        self.observe(task()); self.api.send_error = w.ProviderError("Slack", "rate_limited", retry=True)
        w.dispatch(self.db, self.api, NOW+60000)
        w.dispatch(self.db, self.api, NOW+60001)
        self.assertEqual(len(self.api.posts), 1)
        self.api.send_error = None
        w.dispatch(self.db, self.api, NOW+180001)
        self.assertEqual(self.state(), {"accepted": 1})

    def test_failure_in_one_list_does_not_advance_it_or_block_other_lists(self):
        self.api.fail_list = LID
        other = "901818016338"
        self.api.rows[other] = [task(list={"id": other})]
        report = w.poll(self.db, self.api, now=NOW+60000)
        self.assertFalse(report["healthy"])
        self.assertEqual(report["lists"][LID], NOW)
        self.assertEqual(report["lists"][other], NOW+60000)
        self.assertEqual(report["states"], {"queued": 1})

    def test_apply_off_keeps_outbox_but_sends_nothing(self):
        self.api.rows[LID] = [task()]
        w.poll(self.db, self.api, apply=False, now=NOW+60000)
        self.assertEqual(self.state(), {"queued": 1}); self.assertEqual(self.api.posts, [])

    def test_missing_ledger_and_route_change_fail_closed(self):
        with self.assertRaises(RuntimeError): w.open_db(Path(self.tmp.name)/"missing")
        with self.db: self.db.execute("update meta set value='different' where key='routes'")
        with self.assertRaises(RuntimeError): w.open_db(Path(self.tmp.name)/"ledger.sqlite3")

    def test_unknown_identity_never_guesses_or_injects_a_mention(self):
        t = task(people=(99,), name="<!channel> <@U999>")
        t["assignees"][0]["username"] = "<!here>"
        self.observe(t); w.dispatch(self.db, self.api, NOW+60000)
        text = self.api.posts[0]["text"]
        self.assertNotIn("<!channel>", text); self.assertNotIn("<!here>", text)
        self.assertIn("Slack mention unavailable", text)
        self.assertEqual(w.status(self.db)["unmapped"], 1)

    def test_due_date_and_time_are_explicit(self):
        self.observe(task(due_date=str(NOW), due_date_time=True)); w.dispatch(self.db, self.api, NOW+60000)
        self.assertIn("Kuwait time", self.api.posts[0]["text"])

    def video(self, assigned=(), editors=(), tid="video1"):
        t = task(tid=tid, people=assigned, list={"id": w.VIDEO_LIST}, custom_fields=[
            {"id": w.EDITOR_FIELD, "type": "users", "value": [{"id": x, "email": f"u{x}@example.test", "username": f"User {x}"} for x in editors]}])
        self.api.rows[w.VIDEO_LIST] = [t]; self.api.current[tid] = t
        w.poll(self.db, self.api, now=NOW+60000)
        return t

    def test_unassigned_new_video_alerts_without_channel_ping(self):
        self.video(); w.dispatch(self.db, self.api, NOW+60000)
        self.assertEqual(len(self.api.posts), 1)
        self.assertEqual(self.api.posts[0]["channel"], "C0BJF7RR09Y")
        self.assertIn("Editor not assigned yet", self.api.posts[0]["text"])
        self.assertNotIn("<!", self.api.posts[0]["text"])
        self.video(); w.dispatch(self.db, self.api, NOW+120000)
        self.assertEqual(len(self.api.posts), 1)

    def test_video_custom_editor_and_assignee_deduplicate(self):
        self.video(assigned=(1,), editors=(1, 2)); w.dispatch(self.db, self.api, NOW+60000)
        self.assertEqual(self.api.posts[0]["text"].count("<@U001>"), 1)
        self.assertIn("<@U002>", self.api.posts[0]["text"])

    def test_video_created_and_quick_assignment_coalesce(self):
        self.video(); self.video(editors=(1,)); w.dispatch(self.db, self.api, NOW+60000)
        self.assertEqual(len(self.api.posts), 1)
        self.assertIn("<@U001>", self.api.posts[0]["text"])
        self.assertEqual(self.state(), {"accepted": 1})

    def test_video_assignment_after_initial_post_mentions_editor(self):
        self.video(); w.dispatch(self.db, self.api, NOW+60000)
        self.video(editors=(2,)); w.dispatch(self.db, self.api, NOW+120000)
        self.assertEqual(len(self.api.posts), 2)
        self.assertIn("<@U002>", self.api.posts[1]["text"])

    def test_video_subtask_and_missing_editor_field_do_not_notify(self):
        t = task(tid="v1", people=(), list={"id": w.VIDEO_LIST}, parent="v0", custom_fields=[{"id": w.EDITOR_FIELD, "type": "users"}])
        self.api.rows[w.VIDEO_LIST] = [t]; w.poll(self.db, self.api, now=NOW+60000)
        self.assertEqual(self.state(), {})
        t.pop("custom_fields"); report = w.poll(self.db, self.api, now=NOW+120000)
        self.assertFalse(report["healthy"])


class APIContract(unittest.TestCase):
    def test_paginated_tasks_and_overlap(self):
        api = w.API({}); calls = []
        def request(provider, path):
            calls.append(path)
            return {"tasks": [task(tid=f"t{len(calls)}")], "last_page": len(calls) == 2}
        api.request = request
        self.assertEqual(len(api.tasks(LID, NOW)), 2)
        self.assertIn("subtasks=false", calls[0]); self.assertIn("include_timl=false", calls[0])
        self.assertIn("date_updated_gt="+str(NOW-w.OVERLAP_MS), calls[0])

    def test_incomplete_pagination_fails(self):
        api = w.API({}); api.request = lambda *_: {"tasks": [], "last_page": False}
        with self.assertRaises(ValueError): api.tasks(LID)

    def test_user_identity_exact_unique_email_only(self):
        api = w.API({}); api.request = lambda *_: {"members": [
            {"id": "U1", "profile": {"email": "ONE@EXAMPLE.TEST"}},
            {"id": "U2", "profile": {"email": "same@example.test"}},
            {"id": "U3", "profile": {"email": "same@example.test"}},
            {"id": "U4", "deleted": True, "profile": {"email": "gone@example.test"}},
        ]}
        self.assertEqual(api.users(), {"one@example.test": "U1"})

    def test_send_requires_matching_channel_receipt(self):
        api = w.API({}); api.request = lambda *_: {"ok": True, "ts": "123.000", "channel": "wrong"}
        with self.assertRaises(w.ProviderError) as e: api.send({"channel": "C1"})
        self.assertTrue(e.exception.ambiguous)

    def test_5xx_timeout_and_200_without_receipt_are_ambiguous(self):
        for error in (TimeoutError(), urllib.error.HTTPError("https://slack.com", 503, "Unavailable", {}, None)):
            def opener(*_, **__): raise error
            api = w.API({"SLACK_BOT_TOKEN": "synthetic"}, opener)
            with self.assertRaises(w.ProviderError) as e: api.send({"channel": "C1"})
            self.assertTrue(e.exception.ambiguous)

    def test_reconciliation_finds_fallback_reference(self):
        api = w.API({}); api.request = lambda *_: {"ok": True, "messages": [{"text": "TA-event1", "ts": "123.000"}]}
        self.assertEqual(api.find_receipt("C1", "event1", NOW), "123.000")


if __name__ == "__main__": unittest.main()
