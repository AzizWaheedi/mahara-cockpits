#!/usr/bin/env python3
"""scripts/dev/forms_gates.py on canned rows (docs/forms/STAGE2B-CONTRACT.md section 8, "The gate report"):
nothing is read live, every report folder is a temporary one, and every value is invented. Python 3.9, as on
this Mac: cd scripts/dev && python3 -m unittest test_forms_gates"""
from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import forms_gates as fg  # noqa: E402

FAILING = "test." + "failing"

# The live state on 2026-10-29 (the contract's section 10 and its D0 read, read only).
TODAY = {
    "G1": [{"id": "C09SVG6FHGU", "private": True, "state": "ok"}],
    "G2": [{"anthropic": "connected", "runs": 0}],
    "G4": [{"migrations": [], "rows": []}],
    "G5": [],
    "G6": [{"clients": 55, "store": 0, "differs": 0, "off": 0, "days": None, "seven": False, "fresh": True, "incidents": 0}],
    "G7": [],
    "G9": [{"runs": 0}],
    "G10": [{"done": 0}],
}
STEMS = ["registry", "clickup_writeback", "checkin_notices", "client_messages", "dispatch", "late_typeform", "records", "move_recording"]
LETTERS = "stuvwxyz"
# Every measured part green, as the main session would read it before the hour.
READY = {
    "G1": [{"id": "C09SVG6FHGU", "private": "true", "state": "ok"}],
    "G2": [{"anthropic": "connected", "runs": "3"}],
    "G4": [{
        "migrations": json.dumps([f"20261029{l}_forms_{s}" for l, s in zip(LETTERS, STEMS)]),
        "rows": [{"key": k, "ok": True} for k in ("client-messages", "clickup-writeback:forms", "forms-effects-kick")],
    }],
    "G5": [{"ok": True, "note": "same number (last 4 1234 on both)"}],
    "G6": [{"clients": 19, "store": 19, "differs": 0, "off": 0, "days": 8, "seven": True, "fresh": True, "incidents": 0}],
    "G7": [{"kind": "kickoff", "n": 1}, {"kind": "blueprint.close", "n": "2"}],
    "G9": [{"runs": 4}],
    "G10": [{"done": 1}],
}


def reader(rows: dict, seen: list | None = None):
    """Answers each gate's query from its canned rows, by the gate comment on its first line."""

    def read(query: str):
        if seen is not None:
            seen.append(query)
        tag = query.split("\n", 1)[0].removeprefix("-- forms-gates:")
        if tag not in rows:
            raise KeyError(tag)
        return json.loads(json.dumps(rows[tag]))

    return read


class Folder:
    """A temporary checkout root (with the plans test) and a replay folder."""

    def __init__(self, marked: int = 0, replay: dict | None = None, shadow: dict | None = None):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name) / "repo"
        self.replay = Path(self.dir.name) / "replay"
        plans = self.root / fg.PLANS_TEST
        plans.parent.mkdir(parents=True)
        lines = ['test("a case", () => {});'] + [f'{FAILING}("open before 2b: case {i}", () => {{}});' for i in range(marked)]
        plans.write_text("\n".join(lines) + "\n", encoding="utf-8")
        self.replay.mkdir()
        if replay is not None:
            (self.replay / "replay-report.json").write_text(json.dumps(replay), encoding="utf-8")
        if shadow is not None:
            (self.replay / "shadow-report.json").write_text(json.dumps(shadow), encoding="utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.dir.cleanup()


def replay_report(count: int, of: int = 10) -> dict:
    return {"report": "checkin-replay", "mode": "live", "passes": [
        {"check": "a to-do comment planned, or skipped only where the recording has no stored action item", "count": of, "of": of, "pass": True},
        {"check": "every to-do comment difference explained", "count": count, "of": of, "pass": count == of},
    ], "responses": [{} for _ in range(of)]}


def shadow_run(*verdicts: dict, pick: str = "same", planned: bool = True) -> dict:
    return {"planned": planned, "pick": {"effect": "pick", "verdict": pick}, "effects": list(verdicts)}


SAME = {"effect": "happiness", "verdict": "same"}
EXPLAINED = {"effect": "todo_comment", "verdict": "differs", "explained": True}
UNEXPLAINED = {"effect": "todo_comment", "verdict": "differs"}


def lines(rows: dict, folder: Folder, confirmed=()) -> list:
    return [g.line() for g in fg.gates(reader(rows), folder.root, folder.replay, confirmed)]


class Reads(unittest.TestCase):
    def test_every_query_is_one_select_behind_its_gate_comment(self):
        self.assertEqual(sorted(fg.QUERIES, key=lambda g: int(g[1:])), ["G1", "G2", "G4", "G5", "G6", "G7", "G9", "G10"])
        for gate, query in fg.QUERIES.items():
            head, body = query.split("\n", 1)
            self.assertEqual(head, f"-- forms-gates:{gate}")
            self.assertTrue(body.startswith("select "), gate)
            self.assertNotIn(";", body)
            for word in ("insert", "update ", "delete", "truncate", "alter ", "create ", "grant ", "drop ", "set_config"):
                self.assertNotIn(word, body.lower(), f"{gate}: {word}")

    def test_the_section_10_checks_are_the_queries(self):
        self.assertIn("where id = 'C09SVG6FHGU'", fg.QUERIES["G1"])
        self.assertIn("provider = 'anthropic'", fg.QUERIES["G2"])
        self.assertIn("key = 'client-messages-g5'", fg.QUERIES["G5"])
        self.assertIn("check_id = 'csm-notes-parity' and last_seen_at > now() - interval '7 days'", fg.QUERIES["G6"])
        self.assertIn("coalesce(max(source_snapshot_at) > now() - interval '1 hour', false) as fresh", fg.QUERIES["G6"])
        self.assertIn("kind in ('kickoff', 'blueprint.close', 'blueprint.media')", fg.QUERIES["G7"])
        self.assertIn("'csm' = any(m.roles) and not 'admin' = any(m.roles) and not 'ceo' = any(m.roles)", fg.QUERIES["G9"])
        self.assertIn("kind = 'blueprintClose' and state = 'done'", fg.QUERIES["G10"])

    def test_the_guard_sends_only_read_only_selects_through_the_reader(self):
        sent = []
        read = fg.guarded(lambda path, payload: sent.append((path, payload)) or [{"ok": True}])
        self.assertEqual(read(fg.QUERIES["G5"]), [{"ok": True}])
        self.assertEqual(sent, [("database/query", {"read_only": True, "query": fg.QUERIES["G5"]})])
        for bad in ("update public.cockpit_forms set provider = 'native'", "-- forms-gates:G1\nselect 1; delete from x", "with x as (select 1) select * from x"):
            with self.assertRaises(ValueError):
                read(bad)
        self.assertEqual(len(sent), 1)
        with self.assertRaises(ValueError):
            fg.guarded(lambda path, payload: {"error": "no"})(fg.QUERIES["G5"])


class Today(unittest.TestCase):
    def test_the_live_state_of_2026_10_29_one_line_per_gate(self):
        with Folder(marked=12) as f:
            self.assertEqual(lines(TODAY, f), [
                "G1 green",
                "G2 waiting on people: 0 of 3 shadow runs with the grade, DEFCON and priority, and recap drafts ready",
                "G3 waiting: no replay report yet (checkin-replay.ts --live, 4.13)",
                "G4 waiting: 0 of 8 2b migrations applied",
                "G5 waiting: no WhatsApp phone check yet (D16)",
                "G6 waiting: N4 is not live: the native feed still reads the 1-1 notes from Typeform",
                "G7 waiting on people: a kickoff notice and a Brand Blueprint notice posted from a real client event",
                "G8 waiting on people: the CEO's answer to B6 (check-in calendar auto-confirm) goes in the session note",
                "G9 waiting on people: 0 of 3 CSM shadow runs",
                "G10 waiting on people: no native Brand Blueprint close has settled done yet",
                "G11 waiting: 12 lines in checkin-plans-supabase.test.ts still mark a case as failing",
                "G12 green: decided in Stage 2a (A7.17)",
                "G13 green: decided in Stage 2a (A7.18)",
            ])
            self.assertEqual(fg.exit_code(fg.gates(reader(TODAY), f.root, f.replay)), 1)


class Ready(unittest.TestCase):
    def test_every_gate_green_only_with_the_session_notes_confirmations(self):
        clean = [shadow_run(SAME, EXPLAINED) for _ in range(5)]
        with Folder(replay=replay_report(10), shadow={"responses": clean}) as f:
            result = fg.gates(reader(READY), f.root, f.replay, ["G2", "G3", "G8", "G9", "G10"])
            self.assertEqual([g.line() for g in result][:11], [f"G{n} green" for n in range(1, 12)])
            self.assertEqual(fg.exit_code(result), 0)
            # Without the note, each human part still waits on people, with what it waits for.
            unconfirmed = {g.gate: g for g in fg.gates(reader(READY), f.root, f.replay)}
            for gate in ("G2", "G3", "G8", "G9", "G10"):
                self.assertEqual(unconfirmed[gate].state, "people", gate)
            self.assertIn("approval of the DEFCON and priority text", unconfirmed["G2"].detail)
            self.assertEqual(unconfirmed["G9"].line(), "G9 waiting on people: 4 of 3 CSM shadow runs; the CEO's reading goes in the session note")
            self.assertIn("A1", unconfirmed["G10"].detail)

    def test_a_confirmation_never_turns_a_measured_gap_green(self):
        with Folder() as f:
            got = {g.gate: g.line() for g in fg.gates(reader(TODAY), f.root, f.replay, ["G2", "G3", "G9", "G10"])}
            self.assertEqual(got["G2"], "G2 waiting on people: 0 of 3 shadow runs with the grade, DEFCON and priority, and recap drafts ready")
            self.assertEqual(got["G9"], "G9 waiting on people: 0 of 3 CSM shadow runs")
            self.assertTrue(got["G10"].startswith("G10 waiting on people: no native"))


class EachGate(unittest.TestCase):
    def gate(self, gate: str, rows: dict, folder: Folder | None = None, confirmed=()):
        with (folder or Folder()) as f:
            return {g.gate: g for g in fg.gates(reader({**TODAY, **rows}), f.root, f.replay, confirmed)}[gate].line()

    def test_g1_the_grades_channel(self):
        self.assertEqual(self.gate("G1", {"G1": []}), "G1 waiting: #client-call-feedback is not in the cockpit's Slack channels yet")
        self.assertEqual(self.gate("G1", {"G1": [{"id": "C09SVG6FHGU", "private": False, "state": "ok"}]}),
                         "G1 waiting: #client-call-feedback must be private and ok in Notices and routing")

    def test_g2_the_anthropic_key(self):
        self.assertEqual(self.gate("G2", {"G2": [{"anthropic": "off", "runs": 9}]}),
                         "G2 waiting: the Anthropic key is not connected (CEO > Connections)")
        self.assertEqual(self.gate("G2", {"G2": [{"anthropic": None, "runs": 0}]}),
                         "G2 waiting: the Anthropic key is not connected (CEO > Connections)")

    def test_g3_the_replay_then_five_shadow_runs(self):
        self.assertEqual(self.gate("G3", {}, Folder(replay=replay_report(7))), "G3 waiting: the replay explains 7 of 10 to-do comment differences")
        runs = [shadow_run(SAME, EXPLAINED), shadow_run(SAME), shadow_run(UNEXPLAINED), shadow_run(SAME, pick="missing"), shadow_run(SAME, planned=False)]
        self.assertEqual(self.gate("G3", {}, Folder(replay=replay_report(10), shadow={"responses": runs})),
                         "G3 waiting on people: 3 of 5 shadow runs compared with Make (checkin-replay.ts --shadow)")
        five = [shadow_run(SAME, EXPLAINED)] * 4 + [shadow_run(UNEXPLAINED)]
        self.assertEqual(self.gate("G3", {}, Folder(replay=replay_report(10), shadow={"responses": five})),
                         "G3 waiting on people: 5 shadow runs compared; 1 run with a difference to explain; the session note confirms the five runs")
        clean = [shadow_run(SAME, EXPLAINED)] * 5
        self.assertEqual(self.gate("G3", {}, Folder(replay=replay_report(10), shadow={"responses": clean})),
                         "G3 waiting on people: 5 shadow runs compared; the session note confirms the five runs")
        self.assertEqual(self.gate("G3", {}, Folder(replay=replay_report(10), shadow={"responses": five}), ["G3"]), "G3 green")
        # A report without the 2b pass (written before the They owe fix) explains nothing.
        old = {"passes": [{"check": "the grade notice planned", "count": 10, "of": 10, "pass": True}], "responses": [{}] * 10}
        self.assertEqual(self.gate("G3", {}, Folder(replay=old)), "G3 waiting: the replay explains 0 of 10 to-do comment differences")

    def test_g4_the_eight_migrations_then_the_deploys_health_rows(self):
        six = [f"20261029{l}_forms_{s}" for l, s in zip(LETTERS[:6], STEMS[:6])]
        self.assertEqual(self.gate("G4", {"G4": [{"migrations": six, "rows": []}]}), "G4 waiting: 6 of 8 2b migrations applied")
        # The letter rule may move the block to the next free date and letters.
        moved = [f"20261030{l}_forms_{s}" for l, s in zip("abcdefgh", STEMS)]
        self.assertEqual(self.gate("G4", {"G4": [{"migrations": moved, "rows": [{"key": "forms-effects-kick", "ok": True}]}]}),
                         "G4 waiting: no health row yet for clickup-writeback:forms, client-messages")
        rows = [{"key": k, "ok": k != "client-messages"} for k in fg.DEPLOY_ROWS]
        self.assertEqual(self.gate("G4", {"G4": [{"migrations": moved, "rows": rows}]}), "G4 waiting: not ok: client-messages")

    def test_g5_the_whatsapp_phone_check(self):
        self.assertEqual(self.gate("G5", {"G5": [{"ok": False, "note": "not proven"}]}),
                         "G5 waiting: the WhatsApp phone check does not read same number; B5 goes to the CEO")
        self.assertEqual(self.gate("G5", {"G5": [{"ok": True, "note": "same number"}]}), "G5 green")

    def test_g6_seven_clean_days_of_n4(self):
        base = {"clients": 19, "store": 19, "differs": 0, "off": 0, "incidents": 0, "seven": False, "fresh": True}
        self.assertEqual(self.gate("G6", {"G6": [{**base, "days": 3}]}), "G6 waiting: day 3 of 7")
        self.assertEqual(self.gate("G6", {"G6": [{**base, "days": "0"}]}), "G6 waiting: day 0 of 7")
        self.assertEqual(self.gate("G6", {"G6": [{**base, "days": 7, "seven": True}]}), "G6 green")
        self.assertEqual(self.gate("G6", {"G6": [{**base, "days": 9, "differs": 2}]}),
                         "G6 waiting: 2 clients read differently from Typeform; the 7 days restart when they agree")
        self.assertEqual(self.gate("G6", {"G6": [{**base, "days": 9, "seven": True, "incidents": 1}]}),
                         "G6 waiting: 1 csm-notes-parity incident in the last 7 days")
        self.assertEqual(self.gate("G6", {"G6": [{**base, "off": 19, "days": None}]}),
                         "G6 green: the 1-1 notes are native; the Typeform comparison is off")

    def test_g6_a_feed_that_stopped_publishing_holds_the_days(self):
        # cleanSince only moves when a cycle publishes: without this, a stopped feed's days would run on uncompared.
        stale = "G6 waiting: the native feed has not published for over an hour; hours without a comparison do not count"
        base = {"clients": 19, "store": 19, "differs": 0, "off": 0, "incidents": 0, "days": 9, "seven": True}
        for fresh in (False, "f", "false", None):
            self.assertEqual(self.gate("G6", {"G6": [{**base, "fresh": fresh}]}), stale, fresh)
        # A row that carries no freshness at all is missing, never fresh.
        self.assertEqual(self.gate("G6", {"G6": [base]}), stale)
        for fresh in (True, "t", "true"):
            self.assertEqual(self.gate("G6", {"G6": [{**base, "fresh": fresh}]}), "G6 green", fresh)
        # A stopped feed is named before an older difference or incident; the next read names those once it publishes.
        self.assertEqual(self.gate("G6", {"G6": [{**base, "fresh": False, "differs": 2}]}), stale)
        self.assertEqual(self.gate("G6", {"G6": [{**base, "fresh": False, "incidents": 1}]}), stale)
        self.assertEqual(self.gate("G6", {"G6": [{**base, "fresh": False, "days": None, "seven": False}]}), stale)
        # Earlier states keep their own lines: N4 not live, a client off the store, or the notes already native.
        self.assertEqual(self.gate("G6", {"G6": [{**base, "fresh": False, "store": 0}]}),
                         "G6 waiting: N4 is not live: the native feed still reads the 1-1 notes from Typeform")
        self.assertEqual(self.gate("G6", {"G6": [{**base, "fresh": False, "store": 18}]}),
                         "G6 waiting: 1 of 19 clients do not read their 1-1 notes from the store")
        self.assertEqual(self.gate("G6", {"G6": [{**base, "fresh": False, "off": 19}]}),
                         "G6 green: the 1-1 notes are native; the Typeform comparison is off")

    def test_g6_every_client_reads_the_store(self):
        # Section 10: "every client `store`". One store row among 55 is not N4 live for every client.
        clean = {"differs": 0, "off": 0, "incidents": 0, "days": 8, "seven": True, "fresh": True}
        self.assertEqual(self.gate("G6", {"G6": [{**clean, "clients": 55, "store": 1}]}),
                         "G6 waiting: 54 of 55 clients do not read their 1-1 notes from the store")
        self.assertEqual(self.gate("G6", {"G6": [{**clean, "clients": "19", "store": "18"}]}),
                         "G6 waiting: 1 of 19 clients do not read their 1-1 notes from the store")
        # Even with the comparison off everywhere, a row not on the store holds the gate.
        self.assertEqual(self.gate("G6", {"G6": [{**clean, "clients": 19, "store": 18, "off": 19}]}),
                         "G6 waiting: 1 of 19 clients do not read their 1-1 notes from the store")
        self.assertEqual(self.gate("G6", {"G6": [{**clean, "clients": 19, "store": 19}]}), "G6 green")

    def test_g6_no_client_rows_is_unknown_never_green(self):
        clean = {"store": 0, "differs": 0, "off": 0, "incidents": 0, "days": None, "seven": False, "fresh": True}
        for clients in (0, "0"):
            with Folder() as f:
                result = {g.gate: g for g in fg.gates(reader({**TODAY, "G6": [{**clean, "clients": clients}]}), f.root, f.replay)}
            self.assertEqual(result["G6"].line(), "G6 unknown: the read failed (ReadFailed); missing is never zero")
            self.assertEqual(fg.exit_code(list(result.values())), 2)
        # Called directly, the gate raises rather than answering.
        with self.assertRaises(fg.ReadFailed):
            fg.g6(reader({"G6": [{**clean, "clients": 0, "store": 0, "off": 0, "days": 8, "seven": True}]}))

    def test_g7_a_real_kickoff_and_blueprint_notice(self):
        self.assertEqual(self.gate("G7", {"G7": [{"kind": "kickoff", "n": 2}]}),
                         "G7 waiting on people: a Brand Blueprint notice posted from a real client event")
        self.assertEqual(self.gate("G7", {"G7": [{"kind": "kickoff", "n": 1}, {"kind": "blueprint.media", "n": 1}]}), "G7 green")

    def test_g8_is_the_ceos_answer(self):
        self.assertEqual(self.gate("G8", {}, confirmed=["G8"]), "G8 green")

    def test_g11_counts_the_marked_cases(self):
        self.assertEqual(self.gate("G11", {}, Folder(marked=1)), "G11 waiting: 1 line in checkin-plans-supabase.test.ts still mark a case as failing")
        self.assertEqual(self.gate("G11", {}, Folder(marked=0)), "G11 green")

    def test_g11_in_this_checkout_build_12_left_no_marked_case(self):
        self.assertEqual(fg.g11(fg.ROOT).line(), "G11 green")


class Failures(unittest.TestCase):
    def test_a_failed_read_is_unknown_never_zero(self):
        def broken(query: str):
            if query.startswith("-- forms-gates:G6"):
                raise RuntimeError("a connection error naming nothing")
            return reader(TODAY)(query)

        with Folder() as f:
            result = {g.gate: g for g in fg.gates(broken, f.root, f.replay)}
            self.assertEqual(result["G6"].line(), "G6 unknown: the read failed (RuntimeError); missing is never zero")
            self.assertEqual(result["G1"].line(), "G1 green")
            self.assertEqual(fg.exit_code(list(result.values())), 2)

    def test_a_count_that_is_not_a_number_is_unknown(self):
        with Folder() as f:
            result = {g.gate: g for g in fg.gates(reader({**TODAY, "G9": [{"runs": None}], "G2": [{"anthropic": "connected"}]}), f.root, f.replay)}
            self.assertEqual(result["G9"].state, "unknown")
            self.assertEqual(result["G2"].state, "unknown")

    def test_two_rows_where_one_is_expected_is_unknown(self):
        with Folder() as f:
            result = {g.gate: g for g in fg.gates(reader({**TODAY, "G10": [{"done": 1}, {"done": 2}]}), f.root, f.replay)}
            self.assertEqual(result["G10"].state, "unknown")


class CommandLine(unittest.TestCase):
    def test_prints_thirteen_lines_and_no_address_name_or_secret(self):
        seen = []
        with Folder(replay=replay_report(10)) as f, mock.patch.object(fg, "ROOT", f.root):
            out = io.StringIO()
            with redirect_stdout(out):
                code = fg.main(["--replay-dir", str(f.replay), "--confirmed", "G8"], read=reader(TODAY, seen))
        printed = out.getvalue().splitlines()
        self.assertEqual(code, 1)
        self.assertEqual([l.split(" ", 1)[0] for l in printed], [f"G{n}" for n in range(1, 14)])
        self.assertIn("G8 green", printed)
        self.assertEqual(len(seen), 8)
        text = out.getvalue()
        for forbidden in ("@", "http", "eyJ", "token", "C09SVG6FHGU"):
            self.assertNotIn(forbidden, text)

    def test_a_reader_that_cannot_start_says_what_to_do(self):
        out = io.StringIO()
        with mock.patch.object(fg, "live_reader", side_effect=ValueError("no token")), redirect_stdout(out):
            code = fg.main([])
        self.assertEqual(code, 2)
        self.assertEqual(out.getvalue().strip(), "The gate report cannot read the database (ValueError). Set COCKPIT_MANAGEMENT_TOKEN or pass --env-file, or connect Composio's Supabase.")

    def test_several_confirmations_in_one_flag(self):
        with Folder(replay=replay_report(10), shadow={"responses": [shadow_run(SAME)] * 5}) as f, mock.patch.object(fg, "ROOT", f.root):
            out = io.StringIO()
            with redirect_stdout(out):
                code = fg.main(["--replay-dir", str(f.replay), "--confirmed", "G2", "G3", "G8", "--confirmed", "G9", "G10"], read=reader(READY))
        self.assertEqual(code, 0)
        self.assertEqual(out.getvalue().splitlines()[:11], [f"G{n} green" for n in range(1, 12)])

    def test_only_the_human_gates_can_be_confirmed(self):
        with self.assertRaises(SystemExit), redirect_stdout(io.StringIO()), mock.patch("sys.stderr", io.StringIO()):
            fg.main(["--confirmed", "G6"], read=reader(TODAY))

    def test_this_file_and_the_report_hold_no_marker(self):
        for path in (Path(fg.__file__), Path(__file__)):
            self.assertNotIn(FAILING, path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
