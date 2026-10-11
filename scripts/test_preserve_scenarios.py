#!/usr/bin/env python3
"""Tests for scripts/verify-preserved.py and the cutover simulations in scripts/preserve_scenarios.py.

    python3 scripts/test_preserve_scenarios.py

Offline: every scenario replays a recording built from docs/preserve/ (no key, no network). Needs git with the
restore tag's commit (e166a0b) and the old cutover branch's commit (1bccb34) in this clone.
"""
from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import preserve_scenarios as ps  # noqa: E402

VP = ps.VP
SMAN = json.loads(VP.SB_MANIFEST.read_text(encoding="utf-8"))
VMAN = json.loads(VP.VPS_MANIFEST.read_text(encoding="utf-8"))
BASE = ps.perfect_tape(SMAN, VMAN)
CTX = ps.Ctx(SMAN, VMAN, "origin/main")
SCEN = {sid: fn for sid, _, fn in ps.SCENARIOS}


def replay(sid: str = "") -> dict:
    t = copy.deepcopy(BASE)
    if sid:
        SCEN[sid](t, CTX)
    return ps.run(t, "backups", "origin/main")


def lines(out: dict) -> dict:
    """check -> (status, detail, explained) for the lines that fail the run."""
    return {r["check"]: (r["status"], r["detail"]) for r in ps.problems(out)}


def failing(out: dict, status: str, needle: str) -> bool:
    return any(st == status and needle in check for check, (st, _) in lines(out).items())


class Baseline(unittest.TestCase):
    def test_the_records_agree_with_themselves(self):
        out = replay()
        self.assertEqual(lines(out), {})
        self.assertEqual(out["verdict"], "INCOMPLETE")   # only the bucket, left out offline

    def test_every_check_family_is_present(self):
        checks = {r["check"] for r in replay()["checks"]}
        for want in ("Edge Function sales-api source", "CRON_SECRET pairs with the vault's cockpit_sync_secret",
                     "function secrets set again after the inventory", "status row sales-desk/rooms",
                     "VPS workers' Supabase project (DESK_SUPABASE_URL)", "live sales bundle: its Supabase project",
                     "origin/main contains the restore point e166a0b", f"tag {VP.TAG} on origin"):
            self.assertIn(want, checks)


class Scenarios(unittest.TestCase):
    """Each cutover action fails the run, on the line that names it."""

    def test_a1_checkout_cleaned(self):
        out = replay("a1")
        self.assertTrue(failing(out, "MISSING", "hermes/sales-desk files"))
        self.assertTrue(failing(out, "MISSING", "hermes/cockpit-guardian files"))
        self.assertTrue(failing(out, "CHANGED", "guardian last scan"))
        self.assertTrue(failing(out, "CHANGED", "status row sales-desk/rooms"))

    def test_a2_reset_to_main_passes(self):
        self.assertEqual(lines(replay("a2")), {})

    def test_b1_crontab_from_before_live_calls(self):
        out = replay("b1")
        for n in (62, 63, 64):
            self.assertTrue(failing(out, "MISSING", f"crontab line {n} "), n)
        self.assertFalse(failing(out, "MISSING", "crontab line 59 "))

    def test_b2_crontab_from_september(self):
        out = replay("b2")
        for n in (44, 53, 59, 62):
            self.assertTrue(failing(out, "MISSING", f"crontab line {n} "), n)

    def test_c1_sales_api_from_the_old_branch(self):
        out = replay("c1")
        status, detail = lines(out)["Edge Function sales-api source"]
        self.assertEqual(status, "MISSING")
        for m in ("rooms.ts", "roomlogic.ts", "liveio.ts", "followupAgent.ts", "sendrules.ts"):
            self.assertIn(m, detail)
        # The version went up, so the function line alone would have passed it.
        edge = next(r for r in out["checks"] if r["check"] == "Edge Function sales-api (ours)")
        self.assertTrue(edge["explained"])

    def test_c2_cockpit_from_the_old_branch(self):
        self.assertTrue(failing(replay("c2"), "MISSING", "the room screens' words"))

    def test_d_sales_live_with_the_jwt_check_on(self):
        out = replay("d")
        self.assertIn("verify_jwt True", lines(out)["Edge Function sales-live (ours)"][1])

    def test_e1_old_migration_rerun_is_not_explained(self):
        self.assertTrue(failing(replay("e1"), "CHANGED", "function cockpit_sales_setter_deals"))

    def test_e5_old_sql_copied_into_a_new_migration_is_not_explained(self):
        out = replay("e5")
        detail = next(d for c, (s, d) in lines(out).items() if "cockpit_sales_setter_deals" in c)
        self.assertIn("puts back the older definition from 20260927a_sales_setter_pay.sql", detail)

    def test_e6_a_deliberate_change_is_explained(self):
        out = replay("e6")
        self.assertEqual(lines(out), {})
        line = next(r for r in out["checks"] if "cockpit_sales_setter_deals" in r["check"])
        self.assertIn("20261010b_cutover_sales.sql", line["why"])

    def test_k_a_cutover_migration_on_main_explains_its_change(self):
        if not ps.git("ls-tree", "--name-only", "origin/main", "--", ps.AUTH_CONTRACT).strip():
            self.skipTest("origin/main in this clone does not hold 20261007b yet (git fetch origin)")
        out = replay("k")
        self.assertEqual(lines(out), {})
        line = next(r for r in out["checks"] if r["check"] == "function cockpit_get_my_access()")
        self.assertIn("20261007b_cockpit_auth_contract.sql", line["why"])
        self.assertIn("the live body is that file's", line["why"])

    def test_l_a_hand_edit_is_not_explained_by_a_migration_that_mentions_it(self):
        if not ps.git("ls-tree", "--name-only", "origin/main", "--", ps.AUTH_CONTRACT).strip():
            self.skipTest("origin/main in this clone does not hold 20261007b yet (git fetch origin)")
        status, detail = lines(replay("l"))["function cockpit_get_my_access()"]
        self.assertEqual(status, "CHANGED")
        self.assertIn("defines it, but the live body is not its", detail)

    def test_e2_guard_trigger_dropped(self):
        self.assertIn("trigger cockpit_sales_settings_guard gone",
                      lines(replay("e2"))["table cockpit_sales_settings (dependency)"][1])

    def test_e3_settings_from_an_older_copy(self):
        out = replay("e3")
        for key in ("followups", "rooms", "live", "b2b_sources"):
            self.assertIn("put back from an older copy", lines(out)[f"settings {key}"][1])

    def test_e4_rows_lost(self):
        self.assertIn("fewer than the 11", lines(replay("e4"))["table cockpit_sales_alerts (created)"][1])

    def test_f1_secrets_reset(self):
        out = replay("f1")
        self.assertIn("they differ", lines(out)["CRON_SECRET pairs with the vault's cockpit_sync_secret"][1])
        self.assertIn("IP_SALT", lines(out)["function secrets set again after the inventory"][1])

    def test_f2_secrets_wiped(self):
        self.assertTrue(failing(replay("f2"), "MISSING", "function secret names"))

    def test_g_env_rewritten(self):
        self.assertIn("SALES_MODEL_FALLBACK", lines(replay("g"))["env ~/.sales-desk/env"][1])

    def test_h_reference_deals_deleted(self):
        self.assertTrue(failing(replay("h"), "MISSING", "reference deals"))

    def test_i1_guardian_folder_removed(self):
        out = replay("i1")
        self.assertTrue(failing(out, "MISSING", "hermes/cockpit-guardian files"))

    def test_i2_guardian_state_folder_removed(self):
        detail = lines(replay("i2"))["guardian last scan"][1]
        self.assertIn("mkdir -m 700 ~/.cockpit-guardian", detail)

    def test_j1_new_project(self):
        out = replay("j1")
        self.assertIn(ps.NEW_PROJECT, lines(out)["VPS workers' Supabase project (DESK_SUPABASE_URL)"][1])
        self.assertIn(ps.NEW_PROJECT, lines(out)["live sales bundle: its Supabase project"][1])

    def test_j2_restore_to_october_4(self):
        out = replay("j2")
        self.assertIn("columns gone: provider", lines(out)["table cockpit_sales_ai_usage (altered)"][1])
        self.assertTrue(failing(out, "CHANGED", "function cockpit_sales_watchdog"))

    def test_j3_restore_to_october_2(self):
        out = replay("j3")
        self.assertTrue(failing(out, "MISSING", "table cockpit_sales_rooms (created)"))
        self.assertTrue(failing(out, "MISSING", "pg_cron mahara-sales-rooms-sweep"))

    def test_c3_old_branch_as_one_bundle_is_still_missing(self):
        status, detail = lines(replay("c3"))["Edge Function sales-api source"]
        self.assertEqual(status, "MISSING")
        for m in ("rooms.ts", "roomlogic.ts", "liveio.ts", "followupAgent.ts", "sendrules.ts"):
            self.assertIn(m, detail)
        self.assertNotIn("clients.ts", detail)   # in the bundle by bun's path comment

    def test_o_main_as_one_bundle_is_explained_never_missing(self):
        out = replay("o")
        self.assertEqual(lines(out), {})
        line = next(r for r in out["checks"] if r["check"] == "Edge Function sales-api source")
        self.assertEqual((line["status"], line["explained"]), ("CHANGED", True))
        self.assertIn("deployed as one bundle (index.ts)", line["detail"])

    def test_m_guardian_fix_mode_line_is_explained(self):
        out = replay("m")
        self.assertEqual(lines(out), {})
        line = next(r for r in out["checks"] if r["check"].startswith("crontab line 59 "))
        self.assertEqual((line["status"], line["explained"]), ("CHANGED", True))
        self.assertIn("--mode fix", line["detail"])
        self.assertIn("fix them immediately", line["why"])

    def test_m_a_different_guardian_line_is_still_missing(self):
        t = copy.deepcopy(BASE)
        rec = next(l for l in VMAN["crontab"]["lines"] if l.get("changed_on_purpose") and l["kind"] == "job")
        other = rec["text"].replace("--mode report-only --quiet run", "--mode fix run")
        t["vps"]["crontab"]["lines"] = [ps.cron_row(other) if l["sha"] == rec["sha256"] else l
                                        for l in t["vps"]["crontab"]["lines"]]
        self.assertTrue(failing(ps.run(t, "backups", "origin/main"), "MISSING", "crontab line 59 "))

    def test_n_hiring_not_switched_on_reads_missing(self):
        out = replay("n")
        got = lines(out)
        for want in ("hiring table cockpit_hiring_runs", "hiring table cockpit_hiring_provider_health",
                     "hiring table cockpit_hiring_sends", "hiring function cockpit_hiring_claim_run",
                     "hiring pg_cron mahara-hiring-mirror", "hiring pg_cron mahara-hiring-engine",
                     "hiring pg_cron mahara-hiring-intake", "hiring function secret names"):
            self.assertEqual(got[want][0], "MISSING", want)
        self.assertIn("GHL_HIRING_PIT", got["hiring function secret names"][1])
        self.assertNotIn("HIRING_SEND_ENABLED", got["hiring function secret names"][1])
        self.assertEqual(got["hiring freshness cockpit_hiring_candidates.synced_at"][0], "CHANGED")
        self.assertNotIn("hiring Edge Function hiring-sync", got)     # deployed on 2026-10-09

    def test_hiring_rows_lost_or_a_meta_key_gone_reads_missing(self):
        out = replay()
        ok = {r["check"]: r["status"] for r in out["checks"]}
        self.assertEqual(ok["hiring rows cockpit_hiring_candidates"], VP.OK)
        self.assertEqual(ok["hiring keys cockpit_hiring_meta"], VP.OK)
        t = copy.deepcopy(BASE)
        t["sql rows hiring:cockpit_hiring_candidates"] = [{"n": 12}]
        t["sql keys hiring:cockpit_hiring_meta"] = [{"key": "roles"}]
        got = lines(ps.run(t, "backups", "origin/main"))
        status, detail = got["hiring rows cockpit_hiring_candidates"]
        self.assertEqual(status, "MISSING")
        self.assertIn("fewer than the 255 recorded on 2026-10-11", detail)
        status, detail = got["hiring keys cockpit_hiring_meta"]
        self.assertEqual(status, "MISSING")
        self.assertIn("intake:oW8CWRhi", detail)
        self.assertNotIn("roles", detail.split(": ", 1)[1].split(", "))

    def test_hiring_cron_lines_on_the_vps_are_held(self):
        hiring = [l for l in VMAN["crontab"]["lines"] if l["kind"] == "job" and
                  any(h in l["text"] for h in VP.HIRING_CRON)]
        self.assertEqual(len(hiring), 2)
        t = copy.deepcopy(BASE)
        ps.drop_cron(t, CTX, tuple(l["n"] for l in hiring))
        got = lines(ps.run(t, "backups", "origin/main"))
        for l in hiring:
            label = next(k for k in got if k.startswith(f"crontab line {l['n']} "))
            self.assertEqual(got[label][0], "MISSING", label)
            self.assertIn("radar.py --quiet", label)

    def test_hiring_ceo_policy_dropped_or_a_browser_grant_is_changed(self):
        t = copy.deepcopy(BASE)
        for r in t["sql hiring"]:
            if r["name"] == "cockpit_hiring_candidates":
                r["policies"] = []
            if r["name"] == "cockpit_hiring_runs":
                r["browser"] = True
        got = lines(ps.run(t, "backups", "origin/main"))
        self.assertIn("its CEO read policy is gone", got["hiring table cockpit_hiring_candidates"][1])
        self.assertIn("a browser role can read it", got["hiring table cockpit_hiring_runs"][1])

    def test_hiring_jwt_check_flipped_is_changed(self):
        t = copy.deepcopy(BASE)
        for f in t["api functions"]:
            if f["slug"] == "hiring-sync":
                f["verify_jwt"] = True
        self.assertIn("must be False", lines(ps.run(t, "backups", "origin/main"))["hiring Edge Function hiring-sync"][1])

    def test_every_scenario_but_the_passing_ones_fails_the_run(self):
        for sid, _, _ in ps.SCENARIOS:
            if sid in ("k", "l"):
                continue  # need origin/main to hold 20261007b; their own tests say so
            caught = bool(lines(replay(sid)))
            self.assertEqual(caught, sid not in ps.PASSING, sid)


class ComposioDoor(unittest.TestCase):
    """--via composio: the same reads through `composio execute`, names and booleans only in the recording."""

    def setUp(self):
        # A replay elsewhere leaves VP.TAPE answering from its recording: these read "live" (the fake CLI).
        real, VP.TAPE = VP.TAPE, VP.Tape()
        self.addCleanup(setattr, VP, "TAPE", real)

    def door(self, answers):
        calls = []

        def run(argv, **kw):
            slug, path = argv[2], argv[4][1:]
            args = json.loads(Path(path).read_text())
            calls.append((slug, args))
            out = answers[slug](args) if callable(answers[slug]) else answers[slug]
            return ps.subprocess.CompletedProcess(argv, 0, json.dumps(out).encode(), b"")
        return calls, run

    def test_the_four_tools_keep_names_and_flags_only(self):
        from unittest import mock
        bundle = ("ESZIP2.3 source/index.ts ---SUPABASE-ESZIP-VERSION-ESZIP--- "
                  "// supabase/functions/sales-api/clients.ts\nfunction hungSend(){} const ROOM_STATES=[]; "
                  "function makeLiveIO(){} function makeFollowupAgent(){} const LEAD_ZONES={};")
        answers = {
            "SUPABASE_BETA_RUN_SQL_QUERY": lambda a: {"successful": True, "data": {"details": {
                "command": "SELECT", "result": [{"d": "e" * 64}] if "vault" in a["query"] else [{"n": 1}]}}},
            "SUPABASE_LIST_FUNCTIONS": {"successful": True, "data": {"details": [
                {"slug": "hiring-sync", "status": "ACTIVE", "version": 4, "verify_jwt": False, "id": "x",
                 "entrypoint_path": "file:///tmp/x"}]}},
            "SUPABASE_LIST_SECRETS": {"successful": True, "data": {"details": [
                {"name": "CRON_SECRET", "value": "e" * 64, "updated_at": "2026-10-01T00:00:00Z"}]}},
            "SUPABASE_GET_FUNCTION_BODY": {"successful": True, "data": {"details": bundle}},
        }
        calls, run = self.door(answers)
        tape = VP.Tape("record")
        real, VP.TAPE = VP.TAPE, tape
        try:
            with mock.patch.object(VP.shutil, "which", return_value="/usr/bin/composio"), \
                    mock.patch.object(VP.subprocess, "run", side_effect=run):
                m = VP.ComposioMgmt("bldgtotkfmhoxmlzowdx")
                self.assertEqual(m.sql("select 1", "one"), [{"n": 1}])
                self.assertEqual(m.functions()[0]["slug"], "hiring-sync")
                self.assertNotIn("entrypoint_path", m.functions()[0])
                self.assertEqual(m.secrets(), [{"name": "CRON_SECRET", "updated_at": "2026-10-01T00:00:00Z"}])
                self.assertEqual(m.cron_secret_pair(), {"function_secret": True, "vault_secret": True, "same": True})
                src = m.function_files("sales-api")
        finally:
            VP.TAPE = real
        self.assertEqual(src["files"], {"index.ts": None})
        self.assertTrue(all(src["found"][n] for n in ("rooms.ts", "roomlogic.ts", "liveio.ts", "followupAgent.ts",
                                                      "sendrules.ts", "clients.ts")))
        self.assertFalse(src["found"]["dialer.ts"])
        reads = [a for s_, a in calls if s_ == "SUPABASE_BETA_RUN_SQL_QUERY"]
        self.assertTrue(reads[0]["read_only"])                       # every SELECT read-only
        self.assertFalse(reads[-1]["read_only"])                     # the vault digest: owner role, read-only txn
        self.assertTrue(reads[-1]["query"].startswith("set transaction read only;"))
        text = json.dumps(tape.data)
        self.assertNotIn("e" * 64, text)
        self.assertNotIn("hungSend", text)                           # no code in the recording

    def test_a_stored_answer_is_read_and_deleted(self):
        from unittest import mock
        import tempfile
        folder = Path(tempfile.mkdtemp()) / "adhoc_test"
        folder.mkdir()
        stored = folder / "out.json"
        stored.write_text(json.dumps({"successful": True, "data": {"details": [{"name": "A", "value": "z" * 64}]}}))
        _, run = self.door({"SUPABASE_LIST_SECRETS": {"successful": True, "storedInFile": True,
                                                      "outputFilePath": str(stored)}})
        with mock.patch.object(VP.shutil, "which", return_value="/usr/bin/composio"), \
                mock.patch.object(VP.subprocess, "run", side_effect=run):
            self.assertEqual(VP.ComposioMgmt("bldgtotkfmhoxmlzowdx").secrets(), [{"name": "A", "updated_at": None}])
        self.assertFalse(stored.exists())
        self.assertFalse(folder.exists())

    def test_a_failed_tool_is_a_source_error_never_a_pass(self):
        from unittest import mock
        _, run = self.door({"SUPABASE_LIST_FUNCTIONS": {"successful": False, "error": "connection expired"}})
        with mock.patch.object(VP.shutil, "which", return_value="/usr/bin/composio"), \
                mock.patch.object(VP.subprocess, "run", side_effect=run):
            with self.assertRaises(VP.SourceError):
                VP.ComposioMgmt("bldgtotkfmhoxmlzowdx").functions()

    def test_eszip_names(self):
        text = "ESZIP2.3 \x00source/index.ts\x01source/door.ts ---SUPABASE-ESZIP-VERSION-ESZIP--- source/fake.ts"
        self.assertEqual(VP.eszip_names(text), ["door.ts", "index.ts"])

    def test_markers_match_the_guardians(self):
        import ast
        src = (VP.ROOT / "hermes" / "cockpit-guardian" / "checks" / "live_calls.py").read_text()
        node = next(n for n in ast.parse(src).body if isinstance(n, ast.Assign)
                    and getattr(n.targets[0], "id", "") == "LIVE_MARKERS")
        self.assertEqual(ast.literal_eval(node.value), VP.LIVE_MARKERS)


class Pieces(unittest.TestCase):
    def test_print_cron_all_is_the_recorded_crontab_byte_for_byte(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            VP.print_cron(VMAN, True)
        self.assertEqual(hashlib.sha256(buf.getvalue().encode()).hexdigest(), VMAN["crontab"]["sha256"])

    def test_print_cron_ours_is_sixteen_lines(self):
        # 14 sales desk and guardian lines, and since 2026-10-11 the two hiring lines (radar hiring, radar pending).
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            VP.print_cron(VMAN, False)
        out = buf.getvalue().splitlines()
        self.assertEqual(len(out), 16)
        self.assertEqual(sum(any(h in x for h in VP.HIRING_CRON) for x in out), 2)

    def test_parse_utc(self):
        a = VP.parse_utc("2026-10-07T11:43:35.766487+00:00")
        self.assertEqual(VP.parse_utc("2026-10-07 14:43:35.766487+03"), a)
        self.assertEqual(VP.parse_utc("2026-10-07T11:43:35.7664Z"), VP.parse_utc("2026-10-07 11:43:35.766400+00"))
        self.assertIsNone(VP.parse_utc("yesterday"))

    def test_parse_multipart_keeps_file_names_and_bytes(self):
        raw = (b'--XyZ\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{"a":1}\r\n'
               b'--XyZ\r\nContent-Disposition: form-data; name="file"; filename="source/rooms.ts"\r\n\r\nexport 1\r\n'
               b'--XyZ--\r\n')
        self.assertEqual(VP.parse_multipart('multipart/form-data; boundary=XyZ', raw), {"rooms.ts": b"export 1"})

    def test_count_rules(self):
        self.assertIsNone(VP.count_problem({"role": "dependency", "row_count": 100}, 95))
        self.assertIsNotNone(VP.count_problem({"role": "dependency", "row_count": 100}, 85))
        self.assertIsNotNone(VP.count_problem({"role": "created", "row_count": 11}, 10))
        self.assertIsNone(VP.count_problem({"role": "created", "row_count": 11}, 12))

    def test_the_recording_never_holds_a_secret_value(self):
        self.assertEqual({k for s in BASE["api secrets"] for k in s}, {"name", "updated_at"})
        self.assertEqual(set(BASE["pair cron_secret"]), {"function_secret", "vault_secret", "same"})

    def test_a_live_recording_keeps_names_and_flags_only(self):
        class FakeMgmt(VP.Mgmt):
            def __init__(self):
                self.ref, self._token = "x", ""

            def call(self, method, path, body=None, timeout=120):
                if path == "/secrets":
                    return [{"name": "CRON_SECRET", "value": "d" * 64, "updated_at": "2026-10-01T00:00:00Z"}]
                return [{"d": "d" * 64}]
        tape = VP.Tape("record")
        real, VP.TAPE = VP.TAPE, tape
        try:
            m = FakeMgmt()
            self.assertEqual(m.secrets(), [{"name": "CRON_SECRET", "updated_at": "2026-10-01T00:00:00Z"}])
            self.assertEqual(m.cron_secret_pair(), {"function_secret": True, "vault_secret": True, "same": True})
        finally:
            VP.TAPE = real
        self.assertNotIn("d" * 64, json.dumps(tape.data))


if __name__ == "__main__":
    unittest.main()
