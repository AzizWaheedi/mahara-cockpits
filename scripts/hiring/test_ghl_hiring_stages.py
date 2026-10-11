"""The stage rename script, against a fake hiring sub-account. No network.

  python3 -m unittest scripts/hiring/test_ghl_hiring_stages.py
"""
import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ghl_hiring_stages as g  # noqa: E402


def board(pid, name, one="One to one interview"):
    names = ["Application", "Disqualified", "Loom request", "Group interview", one,
             "Job offer", "Bench", "Hired", "Fired", "Churn"]
    return {
        "id": pid,
        "name": name,
        "stages": [
            {"id": f"{pid}-s{i}", "name": n, "position": i, "showInFunnel": i in (0, 2, 3, 4, 5, 7),
             "showInPieChart": i in (0, 2, 3, 4, 5, 7), "stageWinProbability": i * 10}
            for i, n in enumerate(names)
        ],
    }


OPEN_HOURS = [{"daysOfTheWeek": [d], "hours": [{"openHour": 10, "openMinute": 0, "closeHour": 18, "closeMinute": 0}]} for d in (6, 0, 1, 2, 3, 4)]


class FakeGhl:
    """The parts of the hiring sub-account the script reads and writes."""

    def __init__(self, renamed=False):
        one = "One-to-one interview" if renamed else "One to one interview"
        self.pipelines = [board(f"p{i}", n, one) for i, n in enumerate(g.PIPELINES)]
        self.pipelines.append(board("px", "Somebody else's board"))
        self.fields = [{"id": "f4", "name": "Score 4, one-to-one" if renamed else "Score 4, one to one",
                        "fieldKey": "contact.score_onetoone"}]
        self.calendar = {"id": "c1", "name": "One-to-one interview" if renamed else "One to one interview",
                         "description": f"Book your {'one-to-one' if renamed else 'one to one'}. It is held on Zoom.",
                         "slotDuration": 30, "teamMembers": [{"userId": "u"}], "openHours": OPEN_HOURS}
        self.values = [
            {"id": "v1", "name": "Call centre agent - Test project", "fieldKey": "{{ custom_values.cc_test }}",
             "value": f"A fifteen minute live block after the {'one-to-one' if renamed else 'one to one'}: a speed test."},
            {"id": "v2", "name": "Hiring - Owner name", "fieldKey": "{{ custom_values.owner }}", "value": "Aziz"},
        ]
        self.puts = []
        self.drop_id_on_put = False

    def get(self, path, version="2021-07-28"):
        if path.startswith("/opportunities/pipelines?"):
            return 200, {"pipelines": copy.deepcopy(self.pipelines)}
        if path.startswith("/locations/loc/customFields"):
            return 200, {"customFields": copy.deepcopy(self.fields)}
        if path == "/locations/loc/customValues":
            return 200, {"customValues": copy.deepcopy(self.values)}
        if path.startswith("/calendars/?"):
            return 200, {"calendars": [copy.deepcopy(self.calendar)]}
        if path == "/calendars/c1":
            return 200, {"calendar": copy.deepcopy(self.calendar)}
        return 404, "unrouted " + path

    def put(self, path, body, version="2021-07-28"):
        self.puts.append((path, copy.deepcopy(body)))
        if path.startswith("/opportunities/pipelines/"):
            pid = path.rsplit("/", 1)[1]
            p = next(x for x in self.pipelines if x["id"] == pid)
            stages = copy.deepcopy(body["stages"])
            if self.drop_id_on_put:
                stages[4]["id"] = "brand-new-id"
            p["name"], p["stages"] = body["name"], stages
            return 200, {"succeded": True}
        if path.startswith("/locations/loc/customFields/"):
            self.fields[0]["name"] = body["name"]
            return 200, {}
        if path.startswith("/locations/loc/customValues/"):
            v = next(x for x in self.values if x["id"] == path.rsplit("/", 1)[1])
            v.update(body)
            return 200, {}
        if path == "/calendars/c1":
            # As HighLevel did on 2026-10-11: a PUT without openHours leaves none.
            self.calendar.update(body)
            if "openHours" not in body:
                self.calendar["openHours"] = {}
            return 200, {}
        return 404, "unrouted"


def run(ghl, **kw):
    lines = []
    code = g.run(ghl.get, ghl.put, "loc", say=lines.append, **{"apply": False, "undo": False, "calendar": False, **kw})
    return code, "\n".join(lines)


class Pure(unittest.TestCase):
    def test_only_the_one_name_changes_and_every_id_and_setting_is_kept(self):
        p = board("p", "Media buyer")
        out = g.stage_body(p, g.OLD_STAGE, g.NEW_STAGE)
        self.assertEqual([s["id"] for s in out], [s["id"] for s in p["stages"]])
        self.assertEqual(out[4]["name"], "One-to-one interview")
        for before, after in zip(p["stages"], out):
            for k in ("position", "showInFunnel", "showInPieChart", "stageWinProbability"):
                self.assertEqual(before[k], after[k])
        changed = [i for i, (x, y) in enumerate(zip(p["stages"], out)) if x["name"] != y["name"]]
        self.assertEqual(changed, [4])

    def test_a_board_without_the_old_name_is_left_alone(self):
        self.assertIsNone(g.stage_body(board("p", "x", "One-to-one interview"), g.OLD_STAGE, g.NEW_STAGE))

    def test_a_stage_with_no_id_stops_before_anything_is_written(self):
        p = board("p", "x")
        del p["stages"][2]["id"]
        with self.assertRaises(ValueError):
            g.stage_body(p, g.OLD_STAGE, g.NEW_STAGE)

    def test_the_read_back_catches_a_new_column_a_wrong_name_or_a_moved_setting(self):
        before = board("p", "x")
        after = copy.deepcopy(before)
        after["stages"][4]["name"] = g.NEW_STAGE
        self.assertEqual(g.check_stages(before, after, g.OLD_STAGE, g.NEW_STAGE), [])
        bad = copy.deepcopy(after)
        bad["stages"][4]["id"] = "new"
        self.assertTrue(any("ids changed" in x for x in g.check_stages(before, bad, g.OLD_STAGE, g.NEW_STAGE)))
        bad = copy.deepcopy(after)
        bad["stages"][1]["name"] = "Rejected"
        self.assertTrue(g.check_stages(before, bad, g.OLD_STAGE, g.NEW_STAGE))
        bad = copy.deepcopy(after)
        bad["stages"][0]["stageWinProbability"] = 99
        self.assertTrue(g.check_stages(before, bad, g.OLD_STAGE, g.NEW_STAGE))

    def test_fix_text_changes_only_the_exact_phrases_and_undoes_them(self):
        self.assertEqual(g.fix_text("x after the one to one: y"), "x after the one-to-one: y")
        self.assertEqual(g.fix_text("Book your one to one. It is held on Zoom."), "Book your one-to-one. It is held on Zoom.")
        self.assertIsNone(g.fix_text("a one to one with me"), "only the recorded phrases")
        self.assertIsNone(g.fix_text(None))
        self.assertEqual(g.fix_text("after the one-to-one", undo=True), "after the one to one")

    def test_calendar_drift_ignores_the_name_and_timestamps(self):
        self.assertEqual(g.calendar_drift({"name": "a", "x": 1, "updatedAt": 1}, {"name": "b", "x": 1, "updatedAt": 2}), [])
        self.assertEqual(g.calendar_drift({"x": 1}, {"x": 2}), ["x"])


class Run(unittest.TestCase):
    def test_the_default_is_a_dry_run_that_writes_nothing(self):
        ghl = FakeGhl()
        code, out = run(ghl, calendar=True)
        self.assertEqual(code, 0)
        self.assertEqual(ghl.puts, [])
        self.assertIn("DRY RUN", out)
        self.assertEqual(out.count("'One to one interview' -> 'One-to-one interview', 10 stages"), 6)
        self.assertNotIn("Somebody else", out)

    def test_apply_renames_six_boards_and_the_field_and_reads_them_back(self):
        ghl = FakeGhl()
        code, out = run(ghl, apply=True)
        self.assertEqual(code, 0, out)
        pipeline_puts = [p for p in ghl.puts if p[0].startswith("/opportunities/pipelines/")]
        self.assertEqual(len(pipeline_puts), 6)
        for _, body in pipeline_puts:
            self.assertEqual(set(body), {"name", "stages"}, "a pipeline PUT refuses locationId")
            self.assertTrue(all(s.get("id") for s in body["stages"]))
        self.assertEqual(ghl.fields[0]["name"], "Score 4, one-to-one")
        self.assertEqual(ghl.values[0]["value"], "A fifteen minute live block after the one-to-one: a speed test.")
        self.assertEqual((ghl.values[0]["name"], ghl.values[0]["fieldKey"]),
                         ("Call centre agent - Test project", "{{ custom_values.cc_test }}"))
        self.assertEqual(ghl.values[1]["value"], "Aziz")
        self.assertEqual([b for p, b in ghl.puts if "/customValues/" in p],
                         [{"name": "Call centre agent - Test project",
                           "value": "A fifteen minute live block after the one-to-one: a speed test."}])
        self.assertEqual(ghl.calendar["name"], "One to one interview", "the calendar waits for --calendar")
        self.assertIn("one to one", ghl.calendar["description"])
        self.assertNotIn("px", [p[0].rsplit("/", 1)[1] for p in pipeline_puts], "only the hiring boards")

    def test_a_second_apply_changes_nothing(self):
        ghl = FakeGhl(renamed=True)
        code, out = run(ghl, apply=True, calendar=True)
        self.assertEqual(code, 0, out)
        self.assertEqual(ghl.puts, [])
        self.assertEqual(out.count("already 'One-to-one interview'"), 6)

    def test_calendar_rename_with_its_flag(self):
        ghl = FakeGhl()
        code, out = run(ghl, apply=True, calendar=True)
        self.assertEqual(code, 0, out)
        self.assertEqual(ghl.calendar["name"], "One-to-one interview")
        self.assertEqual(ghl.calendar["description"], "Book your one-to-one. It is held on Zoom.")
        self.assertEqual(ghl.calendar["teamMembers"], [{"userId": "u"}])

    def test_a_renamed_calendar_still_gets_its_description(self):
        ghl = FakeGhl()
        ghl.calendar["name"] = "One-to-one interview"
        code, out = run(ghl, apply=True, calendar=True)
        self.assertEqual(code, 0, out)
        cal_puts = [b for p, b in ghl.puts if p == "/calendars/c1"]
        self.assertEqual(cal_puts, [{"description": "Book your one-to-one. It is held on Zoom.", "openHours": OPEN_HOURS}])
        self.assertEqual(ghl.calendar["openHours"], OPEN_HOURS)

    def test_a_calendar_whose_hours_cannot_be_read_is_left_alone(self):
        ghl = FakeGhl()
        ghl.calendar["openHours"] = {}
        code, out = run(ghl, apply=True, calendar=True)
        self.assertEqual(code, 1, out)
        self.assertIn("its open hours could not be read first", out)
        self.assertEqual([p for p, _ in ghl.puts if p == "/calendars/c1"], [])

    def test_undo_puts_the_old_names_back(self):
        ghl = FakeGhl(renamed=True)
        code, out = run(ghl, apply=True, undo=True, calendar=True)
        self.assertEqual(code, 0, out)
        names = {s["name"] for p in ghl.pipelines[:6] for s in p["stages"]}
        self.assertIn("One to one interview", names)
        self.assertNotIn("One-to-one interview", names)
        self.assertEqual(ghl.fields[0]["name"], "Score 4, one to one")
        self.assertEqual(ghl.calendar["name"], "One to one interview")
        self.assertEqual(ghl.calendar["description"], "Book your one to one. It is held on Zoom.")
        self.assertIn("after the one to one:", ghl.values[0]["value"])

    def test_a_write_that_changes_an_id_is_reported_and_fails_the_run(self):
        ghl = FakeGhl()
        ghl.drop_id_on_put = True
        code, out = run(ghl, apply=True)
        self.assertEqual(code, 1)
        self.assertIn("stage ids changed", out)

    def test_no_key_is_ever_printed(self):
        ghl = FakeGhl()
        _, out = run(ghl, apply=True, calendar=True)
        self.assertNotIn("pit-", out)


if __name__ == "__main__":
    unittest.main()
