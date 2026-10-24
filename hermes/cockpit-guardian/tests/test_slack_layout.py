"""The #health messages of 13 Oct 2026: Slack formatting, owner mentions, the 'Better' post, and the clients
the ad billing check no longer counts."""
import dataclasses
import unittest
from datetime import timedelta

from checks import ad_billing
from guard import alerts, report
from guard.model import fail, warn
from tests import fakes
from tests.test_ad_billing import context
from tests.test_engine import Box, Harness, KUWAIT_NIGHT

MUHAMMED = "<@U0AS90SHMH8>"


class Layout(unittest.TestCase):
    def test_an_opening_reads_as_slack_formatting(self):
        b = Box(fixable=False)
        h = Harness([b.check])
        b.result = fail("Demo has not run for 3 h.", since=fakes.NOW - timedelta(hours=3))
        h.scan()
        lines = h.posted[0].split("\n")
        self.assertEqual(lines[0], "🔴 *Broken: Demo job*")
        self.assertEqual(lines[1], "Demo has not run for 3 h.")
        self.assertEqual(lines[2], "*Do:* Read the demo log.")
        self.assertTrue(lines[3].startswith("_Owner: the CEO · since ") and lines[3].endswith(" · demo-check_"))
        self.assertEqual(len(lines), 4, "no 'tried: nothing' line when the guardian has no fix")
        for old in ("[guardian]", "What broke", "What a person must do", "What the guardian tried"):
            self.assertNotIn(old, h.posted[0])

    def test_a_fix_the_guardian_will_make_is_named(self):
        b = Box()
        h = Harness([b.check], mode="fix")
        b.result = fail("late", data={"stale": True})
        h.scan(fix=False)
        self.assertIn("\n*Guardian:* nothing yet; it will start one catch-up run of demo on its next run.\n", h.posted[0])

    def test_a_capped_fix_is_said_once(self):
        note = "its safe fix ran 3 times in 24 hours and the cause is still there, so the guardian stopped; a person must find the cause"
        inc = {"title": "VPS disk", "level": "fail", "detail": "The VPS disk is 86.3% full.", "owner": "the CEO",
               "check_id": "vps-disk", "fix_capped": True, "fix_note": note}
        text = alerts.worse_text(inc, None, fakes.NOW, "fix", [note])
        self.assertEqual(text.count("safe fix ran 3 times"), 1)
        self.assertNotIn("*Guardian:*", text)
        self.assertIn("*Changed:* " + note + ".", text)
        opened = alerts.opened_text(inc, None, fakes.NOW, "fix")
        self.assertIn("*Guardian:* " + note + ".", opened, "without a Changed line it still says what the guardian did")

    def test_the_systems_manager_is_tagged_in_owner_and_action(self):
        b = Box(fixable=False)
        b.check = dataclasses.replace(b.check, owner="the systems manager",
                                      action="Settle the balance; the systems manager owns the B2B sync.")
        h = Harness([b.check])
        b.result = warn("Meta says API access blocked.")
        h.scan()
        self.assertIn(f"*Do:* Settle the balance; {MUHAMMED} owns the B2B sync.", h.posted[0])
        self.assertIn(f"_Owner: {MUHAMMED} · since ", h.posted[0])

    def test_other_owners_stay_plain_text(self):
        b = Box(fixable=False)
        h = Harness([b.check])
        b.result = fail("late")
        h.scan()
        self.assertNotIn("<@", h.posted[0])

    def test_resolved_digest_reads_new_and_queued_old_messages(self):
        text = alerts.resolved_digest_text(["✅ *Resolved: Salma*\n_Open 65 min_", "[guardian] Resolved: Ask AI queue\nIt was open"])
        self.assertEqual(text, "✅ *Also resolved:* Salma; Ask AI queue.")

    def test_the_daily_summary_has_a_title_bold_sections_and_bullets(self):
        lines = report.slack_layout(["Cockpit guardian, 13 Oct 09:00 Kuwait time. Last scan under a minute ago in fix mode.", "",
                                     "Broken now (1):", "- Meta access (since 11 Oct): Settle it. (the CEO)", "",
                                     "Could not be checked (2): A, B.", "Healthy: 80 of 90 checks."])
        self.assertEqual(lines, ["*Cockpit guardian · 13 Oct 09:00 Kuwait time*", "_Last scan under a minute ago in fix mode._", "",
                                 "*Broken now (1)*", "• Meta access (since 11 Oct): Settle it. (the CEO)", "",
                                 "Could not be checked (2): A, B.", "_Healthy: 80 of 90 checks._"])


class Blocks(unittest.TestCase):
    """What Slack draws: a large title, sections between dividers, the owner line small and grey (like PULSE)."""

    def sent(self, text):
        bodies = []
        alerts.Slack("xoxb-test", "C1", post=lambda body: bodies.append(body)).send(text)
        return bodies[0]

    def kinds(self, blocks):
        return [b["type"] for b in blocks]

    def test_an_opening(self):
        b = Box(fixable=False)
        b.check = dataclasses.replace(b.check, owner="the systems manager")
        h = Harness([b.check])
        b.result = fail("Demo has not run for 3 h.")
        h.scan()
        body = self.sent(h.posted[0])
        self.assertEqual(body["text"], h.posted[0], "the text stays as the notification")
        blocks = body["blocks"]
        self.assertEqual(self.kinds(blocks), ["header", "section", "divider", "section", "divider", "context"])
        self.assertEqual(blocks[0]["text"], {"type": "plain_text", "text": "🔴 Broken: Demo job", "emoji": True})
        self.assertEqual(blocks[3]["text"]["text"], "*What to do*\nRead the demo log.")
        self.assertIn(MUHAMMED, blocks[5]["elements"][0]["text"])

    def test_a_change_sits_small_under_the_title(self):
        text = alerts.worse_text({"title": "Demo job", "level": "fail", "detail": "late", "owner": "the CEO", "check_id": "demo"},
                                 None, fakes.NOW, "fix", ["it went from warning to broken"])
        blocks = self.sent(text)["blocks"]
        self.assertEqual(self.kinds(blocks)[:3], ["header", "context", "section"])
        self.assertEqual(blocks[1]["elements"][0]["text"], "It went from warning to broken.")

    def test_a_resolution_is_quiet(self):
        text = alerts.resolved_text({"title": "Salma", "first_seen_at": fakes.ago(65), "resolved_by": "it cleared by itself"}, fakes.NOW)
        self.assertEqual(self.kinds(self.sent(text)["blocks"]), ["section", "context"])

    def test_the_daily_summary(self):
        text = "\n".join(report.slack_layout(["Cockpit guardian, 13 Oct 09:00 Kuwait time. Last scan 2 min ago in fix mode.", "",
                                               "Broken now (1):", "- Meta access: Settle it. (the systems manager)", "",
                                               "Watching (2):", "- A: do a.", "- B: do b.", "", "Healthy: 80 of 90 checks."]))
        blocks = self.sent(text)["blocks"]
        self.assertEqual(self.kinds(blocks), ["header", "context", "divider", "section", "divider", "section", "divider", "context"])
        self.assertEqual(blocks[0]["text"]["text"], "Cockpit guardian · 13 Oct 09:00 Kuwait time")
        self.assertEqual(blocks[5]["text"]["text"], "*Watching (2)*\n• A: do a.\n• B: do b.")

    def test_a_long_summary_is_cut_at_a_line_and_keeps_its_footer(self):
        items = ["- Item %d: %s" % (i, " ".join(["do this"] * 12)) for i in range(80)]
        text = report.slack_fit(report.slack_layout(["Cockpit guardian, 13 Oct 09:00 Kuwait time. Last scan 2 min ago in fix mode.", "",
                                                     "Watching (80):"] + items + ["", "Healthy: 80 of 90 checks."]))
        self.assertLessEqual(len(text), report.SLACK_MAX)
        self.assertEqual(self.sent(text)["text"], text, "Slack.send no longer cuts it a second time")
        lines = text.split("\n")
        self.assertEqual(lines[-3:], ["_Cut short. Run guardian.py report on the VPS for the rest._", "", "_Healthy: 80 of 90 checks._"])
        self.assertTrue(lines[-4].startswith("• Item ") and lines[-4].endswith("do this"), "whole lines only")
        self.assertEqual(self.kinds(self.sent(text)["blocks"])[-3:], ["context", "divider", "context"])

    def test_a_layout_slack_refuses_still_sends_the_alert_as_text(self):
        bodies = []
        answers = iter(["Slack answered 200 invalid_blocks", None])
        slack = alerts.Slack("xoxb-test", "C1", post=lambda body: bodies.append(body) or next(answers))
        self.assertIsNone(slack.send("🔴 *Broken: Demo job*\nlate"))
        self.assertEqual(["blocks" in b for b in bodies], [True, False])
        self.assertEqual(bodies[1]["text"], "🔴 *Broken: Demo job*\nlate")

    def test_other_slack_errors_are_not_retried(self):
        bodies = []
        slack = alerts.Slack("xoxb-test", "C1", post=lambda body: bodies.append(body) or "Slack answered 200 channel_not_found")
        self.assertEqual(slack.send("🔴 *Broken: Demo job*\nlate"), "Slack answered 200 channel_not_found")
        self.assertEqual(len(bodies), 1)

    def test_no_empty_blocks(self):
        from guard import blocks as bk
        out = bk.to_blocks("*<@U0AS90SHMH8>*\n*Changed:*\n_ _\nlate")
        self.assertNotEqual(out[0]["type"], "header", "a title that is only a mention stays a section")
        for b in out:
            for t in [b.get("text", {}).get("text")] + [e["text"] for e in b.get("elements", [])]:
                self.assertTrue(t is None or t.strip(), b)

    def test_slack_limits(self):
        from guard import blocks as bk
        long = bk.to_blocks("🔴 *" + "x" * 300 + "*\n" + "\n".join("line %d %s" % (i, "y" * 80) for i in range(60)))
        self.assertLessEqual(len(long[0]["text"]["text"]), 150)
        self.assertTrue(all(len(b["text"]["text"]) <= 3000 for b in long if b["type"] == "section"))
        self.assertIsNone(bk.to_blocks("*T*\n" + "\n\n".join("p%d" % i for i in range(40))), "over 50 blocks: text only")


class Better(unittest.TestCase):
    def setUp(self):
        self.b = Box(fixable=False, urgent=True)
        self.h = Harness([self.b.check])
        self.b.result = warn("some sections are old")
        self.h.scan()
        self.b.result = fail("every section is old")
        self.h.scan(KUWAIT_NIGHT)
        self.assertTrue(self.h.posted[1].startswith("🔴 *Worse: Demo job*"))

    def test_broken_turning_back_into_a_warning_is_posted(self):
        self.b.result = warn("some sections are old")
        self.h.scan(KUWAIT_NIGHT + timedelta(hours=8))   # 09:00 Kuwait, past the 6-hour hold
        self.assertEqual(len(self.h.posted), 3)
        self.assertTrue(self.h.posted[2].startswith("🟠 *Better: Demo job*\n*Changed:* it went from broken to warning.\n"))
        self.b.result = fail("every section is old")
        self.h.scan(KUWAIT_NIGHT + timedelta(hours=8, minutes=5))
        self.assertTrue(self.h.posted[3].startswith("🔴 *Worse: Demo job*"), "the level it was last posted at moved down")

    def test_better_waits_for_the_hold_like_any_repeat(self):
        self.b.result = warn("some sections are old")
        self.h.scan(KUWAIT_NIGHT + timedelta(hours=1))
        self.assertEqual(len(self.h.posted), 2)


class AdBillingCoverage(unittest.TestCase):
    def test_a_client_without_meta_access_is_not_a_coverage_gap(self):
        bound = {'client_task_id': 'one', 'enabled': True, 'manual_cutover_verified': True, 'last_good_at': fakes.ago(1)}
        roster = [{'client_task_id': 'one'}, {'client_task_id': '86ex4j8f3'}]
        self.assertEqual(ad_billing.run(context(roster=roster, bindings=[bound])).status, 'ok')

    def test_a_run_that_finished_during_the_scan_is_fresh(self):
        bound = [{'client_task_id': 'one', 'enabled': True, 'manual_cutover_verified': True, 'last_good_at': fakes.ago(1)}]
        self.assertEqual(ad_billing.run(context(age=-0.5, roster=[{'client_task_id': 'one'}], bindings=bound)).status, 'ok')
        self.assertEqual(ad_billing.run(context(age=-6)).status, 'fail', 'a finish far ahead of the clock is still wrong')

    def test_any_other_unbound_client_still_warns(self):
        roster = [{'client_task_id': '86ex4j8f3'}, {'client_task_id': 'two'}]
        result = ad_billing.run(context(roster=roster))
        self.assertEqual((result.status, result.evidence), ('warn', {'missing_clients': 1}))


if __name__ == "__main__":
    unittest.main()
