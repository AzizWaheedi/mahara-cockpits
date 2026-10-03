"""`desk.py deploy-check` (and `deploy check`): keys by name, the tables,
columns, function and settings the code needs, every switch off, the status
rows and the crontab; each missing piece says what it means; nothing is
changed and no key value is printed.

The database is the in-memory PostgREST behind a catalog that answers as
PostgREST does for a missing table (404), a missing column (400, 42703) and a
function asked with GET (read only).

    python3 -m unittest tests.test_deploy_check -v
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import unittest
import urllib.parse
from typing import Any, Optional
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import deploycheck, http  # noqa: E402
from desk.http import HttpError  # noqa: E402
from tests import fakes  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_desk import load_cli  # noqa: E402

KEYS = {
    "DESK_SUPABASE_URL": "https://example.supabase.co", "DESK_SUPABASE_KEY": "service-VALUE-never-printed",
    "ZOOM_ACCOUNT_ID": "zoom-acct-VALUE", "ZOOM_CLIENT_ID": "zoom-client-VALUE", "ZOOM_CLIENT_SECRET": "zoom-secret-VALUE",
    "GOOGLE_CAL_CLIENT_ID": "gcal-id-VALUE", "GOOGLE_CAL_CLIENT_SECRET": "gcal-secret-VALUE",
    "GOOGLE_CAL_REFRESH_TOKEN": "gcal-refresh-VALUE", "SALES_ROOMS_CALENDAR_ID": "rooms@group.calendar.example.test",
    "SLACK_SALES_BOT_TOKEN": "xoxb-VALUE-never-printed", "GHL_B2B_API_KEY": "ghl-VALUE-never-printed",
}
ALL_NAMES = tuple(KEYS) + ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "SALES_GHL_TOKEN")

CRONTAB = "\n".join([
    "# sales desk",
    '* * * * *    flock -w 10 $HOME/.sales-desk/rooms.lock bash -c "cd x && python3 desk.py --quiet rooms --for 57"',
    '*/10 * * * * flock -n $HOME/.sales-desk/room-hosts.lock bash -c "python3 desk.py --quiet rooms --check-hosts"',
    '5 * * * *    flock -n $HOME/.sales-desk/doctor.lock bash -c "python3 desk.py --quiet doctor --cron"',
    '7,37 * * * * flock -n $HOME/.sales-desk/followups.lock bash -c "python3 desk.py --quiet followups"',
    '*/5 * * * *  flock -n $HOME/.sales-desk/waves.lock bash -c "python3 desk.py --quiet waves"',
])

ROOMS_AS_SHIPPED = {"enabled": False, "test_only": True, "providers": {"zoom": False, "meet": False},
                    "send": {"whatsapp_text": False, "whatsapp_template": False, "email": False},
                    "count_on_join": False, "short_link": False, "fallback": {"auto_on_miss": False}}
LIVE_AS_SHIPPED = {"enabled": False, "slack": False, "kinds": {"demo": False, "intro": False}}


class Catalog:
    """PostgREST over the fake: a table or column the catalog lacks answers
    as PostgREST does, and anything but a GET fails the test."""

    def __init__(self) -> None:
        self.pg = FakePostgrest()
        self.schema: dict[str, set[str]] = {t: set(cols) for t, (_w, cols) in deploycheck.TABLES.items()}
        for table, (cols, _meaning) in deploycheck.DELTA.items():
            self.schema[table] |= set(cols)
        self.schema["cockpit_sales_rooms"].add(deploycheck.HARDENING_COLUMN)  # 20261003d applied
        for table in self.schema:
            self.pg.tables.setdefault(table, {})
            fakes.PK.setdefault(table, ("id",))
        self.functions = {deploycheck.LEASE_FN}
        self.asked: list[tuple[str, str]] = []
        self.refuse_key = False
        self.pg.put("cockpit_sales_settings", {"key": "rooms", "value": json.loads(json.dumps(ROOMS_AS_SHIPPED))})
        self.pg.put("cockpit_sales_settings", {"key": "live", "value": json.loads(json.dumps(LIVE_AS_SHIPPED))})
        self.pg.put("cockpit_sales_settings", {"key": "followups", "value": {"enabled": True}})
        self.pg.put("cockpit_sales_settings", {"key": "whatsapp_guard", "value": {"connector_off": False}})
        for job in ("rooms", "room-hosts", "doctor", "followups", "waves"):
            self.pg.put("cockpit_sales_worker_status", {"worker": "sales-desk", "job": job, "ok": True,
                                                        "detail": "Working.", "at": "2026-10-03T10:00:00Z"})
        self.pg.put("cockpit_sales_worker_status", {"worker": "sales-api", "job": "sweep", "ok": True,
                                                    "detail": "swept", "at": "2026-10-03T10:00:00Z"})

    def setting(self, name: str) -> dict[str, Any]:
        return self.pg.one("cockpit_sales_settings", key=name)["value"]

    def __call__(self, method: str, url: str, **kw: Any):
        self.asked.append((method, url))
        if method != "GET":
            raise AssertionError(f"the deploy check wrote: {method} {url}")
        if "supabase.co" not in url:
            raise AssertionError(f"the deploy check reached outside the database: {url}")
        if self.refuse_key:
            raise HttpError(401, '{"message":"Invalid API key"}', b'{"message":"Invalid API key"}', url)
        parts = urllib.parse.urlsplit(url)
        table = parts.path[len("/rest/v1/"):]
        if table.startswith("rpc/"):
            name = table[4:]
            if name not in self.functions:
                body = json.dumps({"code": "PGRST202", "message": f"Could not find the function public.{name}"})
                raise HttpError(404, body, body.encode(), url)
            body = json.dumps({"code": "25006", "message": "cannot execute UPDATE in a read-only transaction"})
            raise HttpError(405, body, body.encode(), url)
        if table not in self.schema:
            body = json.dumps({"code": "PGRST205", "message": f"Could not find the table 'public.{table}'"})
            raise HttpError(404, body, body.encode(), url)
        params = dict(urllib.parse.parse_qsl(parts.query))
        wanted = [c for c in params.get("select", "*").split(",") if c != "*"]
        gone = [c for c in wanted if c not in self.schema[table]]
        if gone:
            body = json.dumps({"code": "42703", "message": f"column {table}.{gone[0]} does not exist"})
            raise HttpError(400, body, body.encode(), url)
        return self.pg(method, url, **kw)


def run(argv: list[str], db: Catalog, keys: Optional[dict[str, str]] = None, crontab: Any = (CRONTAB, "")):
    cli = load_cli()
    out = io.StringIO()
    with tempfile.TemporaryDirectory() as tmp:
        env = {**(KEYS if keys is None else keys), "SALES_DESK_HOME": os.path.join(tmp, "desk-home")}
        with mock.patch.dict(os.environ, env), mock.patch.object(http, "request", db), \
                mock.patch.object(deploycheck, "read_crontab", return_value=crontab), contextlib.redirect_stdout(out):
            for name in ALL_NAMES:
                if name not in env:
                    os.environ.pop(name, None)
            code = cli.main(argv)
        made = os.path.exists(os.path.join(tmp, "desk-home"))
    return code, out.getvalue(), made


def line(out: str, check: str) -> str:
    return next((ln for ln in out.splitlines() if ln[4:].startswith(check)), "")


class DeployCheck(unittest.TestCase):
    def test_a_ready_box_with_every_switch_off_passes_and_changes_nothing(self):
        db = Catalog()
        code, out, made = run(["deploy-check"], db)
        self.assertEqual(code, 0, out)
        self.assertIn("Ready: every table, column, function and setting the desk needs is there, and every switch "
                      "is off.", out)
        self.assertFalse(made)                                  # not even the desk's own folder
        self.assertTrue(all(m == "GET" for m, _u in db.asked))  # GETs only: no status row either
        for value in KEYS.values():
            if "VALUE" in value:
                self.assertNotIn(value, out)
        self.assertTrue(line(out, "rooms.enabled").startswith("OK "))
        self.assertIn("OK  cockpit_sales_room_event_lease", out)
        self.assertIn("installed", line(out, "rooms "))

    def test_the_two_word_form_is_the_same_command(self):
        code, out, _ = run(["deploy", "check"], Catalog())
        self.assertEqual(code, 0)
        self.assertIn("Deploy check: live calls and the follow-up agent on this box. Nothing is changed.", out)

    def test_json_lists_every_check_and_the_blockers(self):
        db = Catalog()
        db.setting("rooms")["enabled"] = True
        code, out, _ = run(["--json", "deploy-check"], db)
        data = json.loads(out)
        self.assertEqual(code, 1)
        self.assertTrue(any(c["check"] == "rooms.enabled" and c["ok"] is False for c in data["checks"]))
        self.assertEqual(len(data["blockers"]), 1)

    def test_a_switch_that_is_on_fails_the_check_and_says_what_it_means(self):
        db = Catalog()
        db.setting("rooms")["enabled"] = True
        db.setting("rooms")["providers"]["zoom"] = True
        db.setting("live")["slack"] = True
        db.setting("rooms")["test_only"] = False
        code, out, _ = run(["deploy-check"], db)
        self.assertEqual(code, 1)
        self.assertIn("--  rooms.enabled", out)
        self.assertIn("on: video rooms are live for every rep. Set it to false until the CEO says go",
                      line(out, "rooms.enabled"))
        self.assertIn("rooms are not kept to the test contacts. Set it to true", line(out, "rooms.test_only"))
        self.assertTrue(line(out, "live.slack").startswith("-- "))
        self.assertIn("Not ready: 4 pieces are missing or switched on:", out)

    def test_missing_keys_say_what_cannot_happen_and_block_only_when_their_switch_is_on(self):
        keys = {k: v for k, v in KEYS.items() if not k.startswith(("ZOOM_", "GOOGLE_CAL_", "SLACK_", "SALES_ROOMS"))}
        db = Catalog()
        code, out, _ = run(["deploy-check"], db, keys=keys)
        self.assertEqual(code, 0, out)
        self.assertIn("?? ", line(out, "Zoom keys"))
        self.assertIn("Zoom rooms cannot be made", line(out, "Zoom keys"))
        self.assertIn("before rooms.providers.zoom is switched on", line(out, "Zoom keys"))
        self.assertIn("Meet rooms cannot be made", line(out, "Google keys"))
        self.assertIn("Slack replies to App Home presses cannot be sent", line(out, "SLACK_SALES_BOT_TOKEN"))
        self.assertIn("not set (recommended)", line(out, "SALES_ROOMS_CALENDAR_ID"))
        self.assertIn("lines marked ?? say what to set before switching something on", out)
        # Switched on without its key: now it blocks.
        db.setting("live")["slack"] = True
        db.setting("rooms")["providers"]["zoom"] = True
        code, out, _ = run(["deploy-check"], db, keys=keys)
        self.assertEqual(code, 1)
        self.assertTrue(line(out, "Zoom keys").startswith("-- "))
        self.assertTrue(line(out, "SLACK_SALES_BOT_TOKEN").startswith("-- "))

    def test_only_the_drive_sign_in_is_said_as_a_doctor_check(self):
        keys = {k: v for k, v in KEYS.items() if not k.startswith("GOOGLE_CAL_")}
        keys.update({"GOOGLE_CLIENT_ID": "g-VALUE", "GOOGLE_CLIENT_SECRET": "g-VALUE", "GOOGLE_REFRESH_TOKEN": "g-VALUE"})
        _code, out, _ = run(["deploy-check"], Catalog(), keys=keys)
        self.assertIn("may have been given for Drive only", line(out, "Google keys"))

    def test_without_the_database_pair_nothing_is_asked_and_it_says_why(self):
        keys = {k: v for k, v in KEYS.items() if not k.startswith("DESK_SUPABASE")}
        db = Catalog()
        code, out, _ = run(["deploy-check"], db, keys=keys)
        self.assertEqual(code, 1)
        self.assertEqual(db.asked, [])
        self.assertIn("nothing in the database can be read or written", line(out, "DESK_SUPABASE_URL, DESK_SUPABASE_KEY"))

    def test_a_missing_migration_names_itself(self):
        db = Catalog()
        for table in ("cockpit_sales_followup_waves", "cockpit_sales_followup_wave_members",
                      "cockpit_sales_followup_meta", "cockpit_sales_followup_stops"):
            del db.schema[table]
        code, out, _ = run(["deploy-check"], db)
        self.assertEqual(code, 1)
        self.assertIn("not there", line(out, "cockpit_sales_followup_waves "))
        self.assertIn("apply 20261003c_sales_followup_agent.sql", line(out, "cockpit_sales_followup_waves "))

    def test_missing_columns_are_named_one_by_one(self):
        db = Catalog()
        db.schema["cockpit_sales_followup_wave_members"] -= {"next_try_at", "closed_at", "arm"}
        db.schema["cockpit_sales_rooms"] -= {"link_claimed_at", "link_unconfirmed_at"}
        code, out, _ = run(["deploy-check"], db)
        self.assertEqual(code, 1)
        members = line(out, "cockpit_sales_followup_wave_members")
        self.assertIn("without arm", members)
        self.assertIn("apply 20261003c_sales_followup_agent.sql again", members)
        delta = line(out, "contract-v2 columns: rooms")
        self.assertTrue(delta.startswith("-- "))
        self.assertIn("not there (link_claimed_at, link_unconfirmed_at)", delta)
        self.assertIn("no lead gets a room link", delta)
        self.assertIn("not there (next_try_at, closed_at)", line(out, "contract-v2 columns: followup_wave_members"))
        self.assertTrue(line(out, "contract-v2 columns: followup_waves").startswith("OK "))
        self.assertTrue(line(out, "wave member state closed").startswith("?? "))

    def test_a_missing_lease_function_blocks(self):
        db = Catalog()
        db.functions = set()
        code, out, _ = run(["deploy-check"], db)
        self.assertEqual(code, 1)
        self.assertIn("cannot take an event with the lease", line(out, "cockpit_sales_room_event_lease"))

    def test_a_running_wave_means_the_agent_is_live(self):
        db = Catalog()
        db.pg.put("cockpit_sales_followup_waves", {"id": "w1", "pool": "never_booked", "state": "running"})
        code, out, _ = run(["deploy-check"], db)
        self.assertEqual(code, 1)
        self.assertIn("1 running or paused (never_booked): the follow-up agent is live", line(out, "backlog waves"))

    def test_missing_settings_and_unset_switches(self):
        db = Catalog()
        del db.pg.tables["cockpit_sales_settings"][("live",)]
        code, out, _ = run(["deploy-check"], db)
        self.assertEqual(code, 1)
        self.assertIn("apply 20261003a_sales_rooms.sql", line(out, "setting live"))
        self.assertIn("not set up yet, so off", line(out, "live.enabled"))

    def test_a_refused_key_is_said_and_stops_the_database_lines(self):
        db = Catalog()
        db.refuse_key = True
        code, out, _ = run(["deploy-check"], db)
        self.assertEqual(code, 1)
        self.assertIn("DESK_SUPABASE_KEY is not the service key", out)

    def test_cron_lines_and_status_rows_are_said_never_counted_as_there(self):
        db = Catalog()
        self.assertIsNone(db.pg.one("cockpit_sales_worker_status", worker="sales-desk", job="slack"))
        crontab = "\n".join(ln for ln in CRONTAB.splitlines() if "rooms" not in ln)
        code, out, _ = run(["deploy-check"], db, crontab=(crontab, ""))
        self.assertEqual(code, 0)
        self.assertIn("no line (flock -w 10 and desk.py --quiet rooms --for 57): the room worker does not run",
                      line(out, "rooms "))
        self.assertTrue(line(out, "room-hosts").startswith("?? "))
        self.assertIn("has never reported", line(out, "sales-desk/slack"))
        self.assertIn("reported", line(out, "sales-desk/rooms"))
        _code, out, _ = run(["deploy-check"], db, crontab=(None, "no crontab for hermes"))
        self.assertIn("not read: no crontab for hermes", line(out, "crontab"))

    def test_a_status_row_past_its_threshold_is_said_as_stale_not_ok(self):
        from datetime import datetime, timezone
        from desk.supabase import Supabase
        db = Catalog()
        now = datetime(2026, 10, 3, 10, 1, 0, tzinfo=timezone.utc)   # rows at 10:00:00
        report = deploycheck.Report()
        with mock.patch.object(http, "request", db):
            deploycheck.check_status_rows(report, Supabase("https://example.supabase.co", "k", timeout=10), now)
        rows = {r["check"]: r for r in report.rows}
        self.assertTrue(rows["sales-desk/rooms"]["ok"])                # 60 s: inside its 90 s
        self.assertTrue(rows["sales-desk/waves"]["ok"])
        later = datetime(2026, 10, 3, 10, 2, 0, tzinfo=timezone.utc)
        report = deploycheck.Report()
        with mock.patch.object(http, "request", db):
            deploycheck.check_status_rows(report, Supabase("https://example.supabase.co", "k", timeout=10), later)
        rows = {r["check"]: r for r in report.rows}
        self.assertIsNone(rows["sales-desk/rooms"]["ok"])
        self.assertIn("later than its 90 s: it may have stopped", rows["sales-desk/rooms"]["detail"])
        self.assertTrue(rows["sales-desk/doctor"]["ok"])

    def test_the_real_crontab_reader_never_raises(self):
        with mock.patch.object(deploycheck.subprocess, "run", side_effect=FileNotFoundError("crontab")):
            text, why = deploycheck.read_crontab()
        self.assertIsNone(text)
        self.assertIn("could not be run here", why)


if __name__ == "__main__":
    unittest.main()
