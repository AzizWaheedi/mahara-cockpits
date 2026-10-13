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

    def test_the_daily_summary_has_bold_sections_and_bullets(self):
        lines = report.slack_layout(["Cockpit guardian, 13 Oct 09:00 Kuwait time. Last scan under a minute ago in fix mode.", "",
                                     "Broken now (1):", "- Meta access (since 11 Oct): Settle it. (the CEO)", "",
                                     "Could not be checked (2): A, B.", "Healthy: 80 of 90 checks."])
        self.assertEqual(lines, ["*Cockpit guardian, 13 Oct 09:00 Kuwait time. Last scan under a minute ago in fix mode*", "",
                                 "*Broken now (1):*", "• Meta access (since 11 Oct): Settle it. (the CEO)", "",
                                 "Could not be checked (2): A, B.", "*Healthy: 80 of 90 checks.*"])


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
        bound = {'client_task_id': 'one', 'enabled': True, 'manual_cutover_verified': True}
        roster = [{'client_task_id': 'one'}, {'client_task_id': '86ex4j8f3'}]
        self.assertEqual(ad_billing.run(context(roster=roster, bindings=[bound])).status, 'ok')

    def test_any_other_unbound_client_still_warns(self):
        roster = [{'client_task_id': '86ex4j8f3'}, {'client_task_id': 'two'}]
        result = ad_billing.run(context(roster=roster))
        self.assertEqual((result.status, result.evidence), ('warn', {'missing_clients': 1}))


if __name__ == "__main__":
    unittest.main()
