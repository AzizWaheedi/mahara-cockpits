"""The recruiting agent's shapes, which is where its two real bugs lived."""

import unittest
import urllib.parse
from datetime import datetime, timedelta, timezone

from radar.hiring import HEADHUNT_TRIES, _clamp, _list, answer_requests, due_requests, prompt_for


ROLE = {
    "key": "csm",
    "label": "Client success manager",
    "compensation": "Up to $6,000 a month.",
    "scorecard": ["Retention", "Clients on track"],
    "dailyResponsibilities": "Own a roster of GCC clients.",
    "postOn": "Indeed and LinkedIn.",
    "rampTime": "2 to 3 weeks.",
}


class Shapes(unittest.TestCase):
    def test_a_string_where_a_list_was_asked_for_is_not_split_into_letters(self):
        # A model answering with one string used to put "T; h; e" on the record.
        self.assertEqual(_list("The applicant has limited experience"),
                         ["The applicant has limited experience"])
        self.assertEqual(_list(["a", "b"]), ["a", "b"])
        self.assertEqual(_list(None), [])
        self.assertEqual(_list(["", "  "]), [])

    def test_a_score_is_always_between_zero_and_ten(self):
        self.assertEqual(_clamp(11), 10.0)
        self.assertEqual(_clamp(-3), 0.0)
        self.assertEqual(_clamp("6.4"), 6.4)
        self.assertEqual(_clamp(None), 0.0)
        self.assertEqual(_clamp("not a number"), 0.0)


class Prompt(unittest.TestCase):
    def test_it_never_hands_the_model_a_country(self):
        # GoHighLevel infers a country from the phone number. Passing it made
        # the agent report its own guess as a fault of the candidate.
        row = {"country": "KW", "years_experience": 4, "arabic": "Khaliji"}
        p = prompt_for(ROLE, row, "I live in Dammam.", [])
        self.assertNotIn("they are in KW", p)
        self.assertIn("do not assume it from anything else", p)
        self.assertIn("4 years of experience", p)
        self.assertIn("Khaliji", p)

    def test_the_scorecard_and_the_application_both_reach_the_model(self):
        p = prompt_for(ROLE, {"years_experience": None}, "My application.", [])
        self.assertIn("Retention; Clients on track", p)
        self.assertIn("My application.", p)
        self.assertIn("an unstated number of years", p)

    def test_lessons_for_this_role_only_are_carried(self):
        learned = [
            {"role": "csm", "agentScore": 4, "azizScore": 8, "agentReason": "thin", "azizNote": "he ran a roster"},
            {"role": "media-buyer", "agentScore": 9, "azizScore": 3, "agentReason": "no", "azizNote": "no"},
        ]
        p = prompt_for(ROLE, {"years_experience": 2}, "x", learned)
        self.assertIn("You said 4, he said 8", p)
        self.assertNotIn("You said 9", p)

    def test_no_em_dashes_reach_a_candidate_facing_prompt(self):
        p = prompt_for(ROLE, {"years_experience": 2}, "x", [])
        self.assertNotIn("—", p)


NOW = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)


class FakeMeta:
    """cockpit_hiring_meta, as much of PostgREST as answer_requests uses."""

    def __init__(self, rows):
        self.rows = {k: dict(v) for k, v in rows.items()}
        self.patches = []

    def select(self, table, params):
        assert table == "cockpit_hiring_meta"
        q = urllib.parse.parse_qs(params)
        prefix = urllib.parse.unquote(q["key"][0])[len("like."):].rstrip("*")
        return [{"key": k, "value": dict(v)} for k, v in sorted(self.rows.items()) if k.startswith(prefix)]

    def rest(self, method, path, *, json_body=None, prefer=None, **kw):
        assert method == "PATCH" and prefer == "return=representation"
        table, _, query = path.partition("?")
        assert table == "cockpit_hiring_meta"
        want = {}
        for part in query.split("&"):
            field, _, cond = part.partition("=")
            want[field] = urllib.parse.unquote(cond[len("eq."):])
        key = want.pop("key")
        row = self.rows.get(key)
        if row is None or any(str(row.get(f.split("->>")[1])) != v for f, v in want.items()):
            return 200, {}, []
        self.rows[key] = dict(json_body["value"])
        self.patches.append((key, dict(json_body["value"])))
        return 200, {}, [{"key": key}]


def ask(status="queued", minutes_ago=2, **more):
    return {"status": status, "requestedAt": (NOW - timedelta(minutes=minutes_ago)).isoformat().replace("+00:00", "Z"),
            "by": "aziz@maharamedia.com", "note": "", "attempts": 0, **more}


class Headhunts(unittest.TestCase):
    def run_it(self, sb, hunt, **kw):
        return answer_requests(None, lambda *_: None, sb=sb, now=NOW, hunt=hunt, **kw)

    def test_a_queued_ask_is_claimed_answered_and_marked_done(self):
        sb = FakeMeta({"headhunt-request:csm": ask(note="Kuwait"), "headhunt:csm": {"old": True}, "engine": {}})
        seen = []

        def hunt(cfg, role, note, log):
            seen.append((role, note, sb.rows["headhunt-request:csm"]["status"]))
            return {"ok": True, "model": "deepseek:x"}

        out = self.run_it(sb, hunt)
        self.assertEqual(seen, [("csm", "Kuwait", "running")], "running while the model writes")
        self.assertEqual(out, [{"role": "csm", "attempts": 1, "status": "done"}])
        row = sb.rows["headhunt-request:csm"]
        self.assertEqual(row["status"], "done")
        self.assertEqual(row["model"], "deepseek:x")
        self.assertEqual(row["attempts"], 1)
        self.assertIn("answeredAt", row)

    def test_one_ask_per_run_oldest_first(self):
        sb = FakeMeta({"headhunt-request:csm": ask(minutes_ago=1), "headhunt-request:video-editor": ask(minutes_ago=9)})
        roles = []
        self.run_it(sb, lambda c, r, n, l: roles.append(r) or {"ok": True})
        self.assertEqual(roles, ["video-editor"])
        self.assertEqual(sb.rows["headhunt-request:csm"]["status"], "queued")

    def test_done_failed_and_freshly_running_asks_are_left_alone(self):
        rows = {
            "headhunt-request:a": ask("done"),
            "headhunt-request:b": ask("failed"),
            "headhunt-request:c": ask("running", startedAt=(NOW - timedelta(minutes=5)).isoformat()),
        }
        self.assertEqual(due_requests([{"key": k, "value": v} for k, v in rows.items()], NOW), [])

    def test_a_hung_run_is_picked_up_again(self):
        hung = ask("running", minutes_ago=50, attempts=1, startedAt=(NOW - timedelta(minutes=45)).isoformat())
        sb = FakeMeta({"headhunt-request:csm": hung})
        out = self.run_it(sb, lambda *a: {"ok": True, "model": "m"})
        self.assertEqual(out[0]["attempts"], 2)
        self.assertEqual(sb.rows["headhunt-request:csm"]["status"], "done")

    def test_a_model_failure_goes_back_in_the_queue_until_the_third_try(self):
        sb = FakeMeta({"headhunt-request:csm": ask()})

        def boom(*a):
            raise RuntimeError("no model wrote the copy: 503")

        for n in range(1, HEADHUNT_TRIES + 1):
            out = self.run_it(sb, boom)
            self.assertEqual(out[0]["attempts"], n)
        row = sb.rows["headhunt-request:csm"]
        self.assertEqual(row["status"], "failed")
        self.assertIn("no model wrote the copy", row["error"])
        self.assertEqual(self.run_it(sb, boom), [], "a failed ask waits for the CEO to ask again")

    def test_an_unknown_role_fails_at_once(self):
        sb = FakeMeta({"headhunt-request:astronaut": ask()})
        self.run_it(sb, lambda *a: {"ok": False, "error": "No role called astronaut."})
        self.assertEqual(sb.rows["headhunt-request:astronaut"]["status"], "failed")
        self.assertEqual(sb.rows["headhunt-request:astronaut"]["error"], "No role called astronaut.")

    def test_an_ask_another_run_already_took_is_not_answered_twice(self):
        sb = FakeMeta({"headhunt-request:csm": ask()})
        stale_read = sb.select("cockpit_hiring_meta", "key=like.headhunt-request%3A*")
        sb.rows["headhunt-request:csm"]["status"] = "running"
        sb.rows["headhunt-request:csm"]["startedAt"] = NOW.isoformat()
        sb.select = lambda *a: stale_read
        called = []
        out = self.run_it(sb, lambda *a: called.append(1) or {"ok": True})
        self.assertEqual(out[0]["status"], "taken")
        self.assertEqual(called, [])

    def test_a_dry_run_names_the_ask_and_changes_nothing(self):
        sb = FakeMeta({"headhunt-request:csm": ask()})
        out = self.run_it(sb, lambda *a: self.fail("no model call in a dry run"), dry_run=True)
        self.assertEqual(out, [{"role": "csm", "attempts": 1, "status": "would answer"}])
        self.assertEqual(sb.patches, [])


if __name__ == "__main__":
    unittest.main()
