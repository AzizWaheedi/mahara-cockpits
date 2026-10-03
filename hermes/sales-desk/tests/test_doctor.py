"""The hourly doctor and the honest status rows: a one-token model probe,
nothing rendered, every broken check a row, the model's row saying since
when it stopped answering; the follow-ups row false when the model is down
even with nothing to draft; test runs writing no row at all.

    python3 -m unittest tests.test_doctor
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import unittest
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, render  # noqa: E402
from desk.model import VPS_SIGN_IN  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_desk import load_cli  # noqa: E402

LAPSED = b'{"error":{"message":"Failed to authenticate. API Error: 401 OAuth access token has expired."}}'


class World:
    """Every service the doctor and the follow-ups job ask, answered in
    memory: the database, Fathom, HighLevel and the Claude proxy (answering,
    or with its sign-in lapsed). Each call is kept."""

    def __init__(self, pg: FakePostgrest, model_ok: bool = True):
        self.pg, self.model_ok, self.asked = pg, model_ok, []

    def __call__(self, method, url, **kw):
        self.asked.append((method, url))
        if "supabase.co" in url:
            return self.pg(method, url, **kw)
        if "api.fathom.ai" in url:
            return 200, {}, json.dumps({"items": [{"id": 1}]}).encode()
        if "leadconnectorhq" in url:
            return 200, {}, json.dumps({"conversations": []}).encode()
        if "127.0.0.1:3456" in url:
            if url.endswith("/models"):
                return 200, {}, json.dumps({"data": [{"id": "opus"}]}).encode()
            if self.model_ok == "slow":
                raise http.HttpError(0, "TimeoutError: timed out", b"", url)
            if not self.model_ok:
                raise http.HttpError(500, "proxy_error", LAPSED, url)
            return 200, {}, json.dumps({"model": "opus", "choices": [{"message": {"content": "OK"}}]}).encode()
        raise AssertionError(f"not modelled: {method} {url}")


def env(tmp: str) -> dict:
    return {"SALES_DESK_HOME": tmp, "DESK_SUPABASE_URL": "https://example.supabase.co",
            "DESK_SUPABASE_KEY": "service-test", "FATHOM_API_KEY": "fathom-test", "GHL_B2B_API_KEY": "ghl-test",
            "SALES_MODEL_PROVIDER": "vps"}


def run_cli(argv, world, tmp):
    cli = load_cli()
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.dict(os.environ, env(tmp)), mock.patch.object(http, "request", world), \
            mock.patch.object(render, "dom", side_effect=AssertionError("rendered")), \
            mock.patch.object(render, "engine", return_value="playwright"), \
            contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        for name in ("MAQSAM_ACCESS_KEY", "MAQSAM_SECRET", "OPENAI_API_KEY"):
            os.environ.pop(name, None)
        code = cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def row(pg, job):
    return pg.one("cockpit_sales_worker_status", worker="sales-desk", job=job)


class HourlyDoctor(unittest.TestCase):
    def test_a_ready_desk_says_nothing_writes_both_rows_and_asks_the_model_one_token(self):
        pg = FakePostgrest()
        world = World(pg)
        with tempfile.TemporaryDirectory() as tmp:
            code, out, _ = run_cli(["--quiet", "doctor", "--cron"], world, tmp)
        self.assertEqual((code, out), (0, ""))
        self.assertEqual((row(pg, "doctor")["ok"], row(pg, "doctor")["detail"]), (True, "ready"))
        self.assertEqual((row(pg, "model")["ok"], row(pg, "model")["detail"]), (True, "opus answered"))
        proxy = [(m, u) for m, u in world.asked if "3456" in u]
        self.assertEqual(proxy, [("POST", "http://127.0.0.1:3456/v1/chat/completions")])  # no model list, no stream test
        body_asks = [u for m, u in world.asked if "supabase.co" in u and "cockpit_sales_followup_stops" in u]
        self.assertTrue(body_asks)  # the agent's own tables are looked at too

    def test_the_full_doctor_still_lists_the_models(self):
        pg = FakePostgrest()
        world = World(pg)
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(render, "dom", return_value="<p>ok</p>"):
            cli = load_cli()
            with mock.patch.dict(os.environ, env(tmp)), mock.patch.object(http, "request", world), \
                    mock.patch.object(render, "engine", return_value="none"), contextlib.redirect_stdout(io.StringIO()):
                cli.main(["doctor"])
        self.assertIn(("GET", "http://127.0.0.1:3456/v1/models"), world.asked)

    def test_a_lapsed_sign_in_blocks_says_so_and_keeps_since_when(self):
        pg = FakePostgrest()
        world = World(pg, model_ok=False)
        with tempfile.TemporaryDirectory() as tmp:
            code, out, _ = run_cli(["--quiet", "doctor", "--cron"], world, tmp)
        self.assertEqual(code, 1)
        self.assertIn(VPS_SIGN_IN, out)  # a blocked cron run is printed for the log
        self.assertFalse(row(pg, "doctor")["ok"])
        self.assertIn("blocked: " + VPS_SIGN_IN, row(pg, "doctor")["detail"])
        model = row(pg, "model")
        self.assertFalse(model["ok"])
        self.assertRegex(model["detail"], r"Not answering since \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$")
        # An hour later it is still down: the first time is kept.
        model["detail"] = model["detail"].rsplit("since", 1)[0] + "since 2026-09-27 08:12 UTC"
        with tempfile.TemporaryDirectory() as tmp:
            run_cli(["--quiet", "doctor", "--cron"], world, tmp)
        self.assertTrue(row(pg, "model")["detail"].endswith("since 2026-09-27 08:12 UTC"))
        # Back up: the row says so and forgets the time.
        world.model_ok = True
        with tempfile.TemporaryDirectory() as tmp:
            run_cli(["--quiet", "doctor", "--cron"], world, tmp)
        self.assertEqual((row(pg, "model")["ok"], row(pg, "doctor")["ok"]), (True, True))

    def test_a_check_that_breaks_is_a_row_and_the_rows_are_still_written(self):
        pg = FakePostgrest()
        world = World(pg)
        cli = load_cli()
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, env(tmp)), \
                mock.patch.object(http, "request", world), mock.patch.object(render, "engine", return_value="none"), \
                mock.patch.object(cli.Supabase, "people", side_effect=RuntimeError("boom")), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            code = cli.main(["doctor", "--cron"])
        self.assertEqual(code, 0)
        self.assertIn("reps in Fathom     the check itself failed: boom", out.getvalue())
        self.assertTrue(row(pg, "doctor")["ok"])

    def test_missing_agent_tables_gate_and_openers_are_said_not_counted(self):
        pg = FakePostgrest()
        del pg.tables["cockpit_sales_followup_waves"]
        world = World(pg)
        with tempfile.TemporaryDirectory() as tmp:
            _, out, _ = run_cli(["doctor", "--cron"], world, tmp)
        self.assertIn("agent tables       not there yet (migration 20261003c): cockpit_sales_followup_waves", out)
        self.assertIn("whatsapp gate      WhatsApp sends from the desk are off until the WA Connector is off", out)
        self.assertIn("opener templates   not set up: opener_ar, opener_en", out)


class HonestFollowupsRow(unittest.TestCase):
    def test_with_the_sign_in_lapsed_the_row_is_false_even_with_nothing_to_draft(self):
        pg = FakePostgrest()
        pg.put("cockpit_sales_settings", {"key": "followups", "value": {"enabled": True, "quiet": {"from": 24, "to": 0}}})
        world = World(pg, model_ok=False)
        with tempfile.TemporaryDirectory() as tmp:
            code, out, _ = run_cli(["--quiet", "followups"], world, tmp)
        self.assertEqual(code, 1)
        r = row(pg, "followups")
        self.assertFalse(r["ok"])
        self.assertTrue(r["detail"].startswith("No drafts can be written: " + VPS_SIGN_IN.rstrip(".")), r["detail"])
        self.assertIn("No lead is due right now", r["detail"])
        self.assertFalse(row(pg, "model")["ok"])
        self.assertEqual(pg.rows("cockpit_sales_followups"), [])

    def test_a_probe_that_only_timed_out_does_not_stop_the_drafting(self):
        pg = FakePostgrest()
        pg.put("cockpit_sales_settings", {"key": "followups", "value": {"enabled": True, "quiet": {"from": 24, "to": 0}}})
        world = World(pg, model_ok="slow")
        with tempfile.TemporaryDirectory() as tmp:
            code, _, err = run_cli(["--quiet", "followups"], world, tmp)
        self.assertEqual(code, 0)
        self.assertTrue(row(pg, "followups")["ok"])
        self.assertFalse(row(pg, "model")["ok"])
        self.assertIn("drafting is tried all the same", err)

    def test_a_test_run_writes_no_status_row(self):
        pg = FakePostgrest()
        pg.put("cockpit_sales_leads", {"contact_id": "real", "tags": ["roas-qualified"], "name": "Omar"})
        world = World(pg)
        with tempfile.TemporaryDirectory() as tmp:
            code, out, _ = run_cli(["followups", "--contact", "real", "--segment", "no_show"], world, tmp)
        self.assertEqual(code, 1)
        self.assertIn("Test run: real is not tagged cockpit-test", out)
        self.assertEqual([r["job"] for r in pg.rows("cockpit_sales_worker_status")], [])

    def test_the_waves_job_writes_its_row_and_pools_write_nothing(self):
        pg = FakePostgrest()
        world = World(pg)
        with tempfile.TemporaryDirectory() as tmp:
            code, _, _ = run_cli(["--quiet", "waves"], world, tmp)
        self.assertEqual(code, 0)
        self.assertEqual((row(pg, "waves")["ok"], row(pg, "waves")["detail"]), (True, "No wave is running"))
        pg.tables["cockpit_sales_worker_status"].clear()
        pg.calls.clear()
        pg.put("cockpit_sales_leads", {"contact_id": "n1", "tags": ["roas-qualified"], "lead_created_at": "2026-09-01T00:00:00Z"})
        with tempfile.TemporaryDirectory() as tmp:
            code, out, _ = run_cli(["waves", "--pools"], world, tmp)
        self.assertEqual(code, 0)
        self.assertIn("leads who never booked: 1 leads", out)
        self.assertEqual(pg.writes(), [])


if __name__ == "__main__":
    unittest.main()
