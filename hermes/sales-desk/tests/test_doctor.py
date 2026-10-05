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


class Asked:
    """A provider as the doctor sees it, keeping every call and its timeout."""

    def __init__(self, name: str, model_name: str, ping: object = None):
        self.name, self.model, self._ping, self.calls = name, model_name, ping, []

    def ping(self, timeout: float = 60) -> str:
        self.calls.append(("ping", timeout))
        if isinstance(self._ping, BaseException):
            raise self._ping
        return f"{self.model} answered"

    def models(self, timeout: float = 60) -> list:
        self.calls.append(("models", timeout))
        return [self.model]

    def credit(self, timeout: float = 60) -> float:
        self.calls.append(("credit", timeout))
        return 9.5


class HourlyModelRows(unittest.TestCase):
    """model_rows (the fallback's doctor lines) under the hourly doctor: one
    token each, the primary's answer kept for the model's own status row, and
    one miss said as not known rather than a block."""

    def rows(self, primary, fallback, *, cron, fb="openrouter", primary_fn=None):
        from tests.test_desk import cfg_in, fakes_logger
        cli = load_cli()
        with tempfile.TemporaryDirectory() as tmp:
            cfg = cfg_in(tmp)
            cfg.provider, cfg.model, cfg.fallback = "vps", "opus", fb
            seen: dict = {}
            out = cli.model_rows(cfg, fakes_logger(), online=True, cron=cron, seen=seen,
                                 primary=primary_fn or (lambda c, l: primary), fallback=lambda c, l, **kw: fallback)
        return {r["check"]: r for r in out}, [r["detail"] for r in out if r["required"] and r["ok"] is False], seen

    def test_the_hourly_run_asks_each_model_one_token_and_no_list(self):
        p, f = Asked("vps", "opus"), Asked("openrouter", "anthropic/claude-opus-4.8")
        rows, blockers, seen = self.rows(p, f, cron=True)
        self.assertEqual(p.calls, [("ping", 30)])
        self.assertEqual([c for c in f.calls if c[0] != "credit"], [("ping", 30)])  # the credit is still read
        self.assertNotIn("model listed", rows)
        self.assertNotIn("fallback listed", rows)
        self.assertTrue(rows["fallback credit"]["ok"])
        self.assertEqual(blockers, [])
        self.assertEqual(seen["probe"], (True, "opus answered", False))

    def test_the_full_doctor_still_lists_both(self):
        p, f = Asked("vps", "opus"), Asked("openrouter", "anthropic/claude-opus-4.8")
        rows, _, _ = self.rows(p, f, cron=False)
        self.assertEqual(p.calls, [("ping", 60), ("models", 60)])
        self.assertTrue(rows["model listed"]["ok"])
        self.assertTrue(rows["fallback listed"]["ok"])

    def test_one_miss_without_a_fallback_is_not_known_and_no_block(self):
        miss = http.HttpError(0, "TimeoutError: timed out", b"", "http://127.0.0.1:3456")
        rows, blockers, seen = self.rows(Asked("vps", "opus", ping=miss), None, cron=True, fb="none")
        self.assertEqual(blockers, [])
        self.assertIsNone(rows["model answers"]["ok"])
        self.assertTrue(rows["model answers"]["required"])  # said under "not known" on the doctor's row
        self.assertEqual(seen["probe"][0::2], (False, False))  # one miss, no outage

    def test_an_outage_without_a_fallback_blocks_and_is_an_outage(self):
        from desk import model
        lapsed = model._classify(http.HttpError(500, "proxy_error", LAPSED), "vps", "opus")
        rows, blockers, seen = self.rows(Asked("vps", "opus", ping=lapsed), None, cron=True, fb="none")
        self.assertEqual(blockers, [VPS_SIGN_IN])
        self.assertEqual(seen["probe"], (False, VPS_SIGN_IN, True))

    def test_no_key_at_all_is_an_outage_on_the_model_row(self):
        from desk.errors import NotNow

        def gone(c, l):
            raise NotNow("OPENAI_API_KEY is not set.")
        rows, _, seen = self.rows(None, None, cron=True, fb="none", primary_fn=gone)
        self.assertFalse(rows["model key"]["ok"])
        self.assertEqual(seen["probe"], (False, "OPENAI_API_KEY is not set.", True))

    def test_a_fallback_that_times_out_is_down_and_the_lapsed_primary_then_blocks(self):
        from desk import model
        lapsed = model._classify(http.HttpError(500, "proxy_error", LAPSED), "vps", "opus")
        miss = http.HttpError(0, "TimeoutError: timed out", b"", "https://openrouter.ai")
        rows, blockers, _ = self.rows(Asked("vps", "opus", ping=lapsed),
                                      Asked("openrouter", "anthropic/claude-opus-4.8", ping=miss), cron=True)
        self.assertFalse(rows["fallback answers"]["ok"])
        self.assertFalse(rows["drafting"]["ok"])
        self.assertEqual(len(blockers), 1)


class FollowupsProbeWithAFallback(unittest.TestCase):
    """The follow-ups job's one token when SALES_FALLBACK_JOBS names it (the
    merge of the fallback and the honest model row): a primary that is down
    hands over and drafting goes on, while the model's row still says the
    primary is down; nothing to hand over to stops the drafting."""

    def lapsed(self):
        from desk import model
        return model._classify(http.HttpError(500, "proxy_error", LAPSED), "vps", "opus")

    def failover(self, primary, fallback):
        from desk import model
        return model.Failover(lambda: primary, fallback, job="followups", primary_label="vps (opus)").ready()

    def test_a_lapsed_primary_hands_over_and_does_not_stop_the_drafting(self):
        cli = load_cli()
        gpt = Asked("openai", "gpt-5")
        p = self.failover(Asked("vps", "opus", ping=self.lapsed()), lambda: gpt)
        ok, said, outage, down = cli.job_probe(p, 30)
        self.assertEqual((ok, said, outage, down), (False, VPS_SIGN_IN, True, None))
        self.assertTrue(p.on_fallback)
        self.assertEqual(p.name, "openai")
        self.assertEqual(gpt.calls, [])  # the fallback is not pinged: the drafts ask it

    def test_with_nothing_to_hand_over_to_the_drafting_stops_naming_both(self):
        from desk import model
        cli = load_cli()

        def no_fallback():
            raise model.ModelUnreachable("OPENAI_API_KEY is not set.", cause="no OpenAI key")
        p = self.failover(Asked("vps", "opus", ping=self.lapsed()), no_fallback)
        ok, said, outage, down = cli.job_probe(p, 30)
        self.assertEqual((ok, said, outage), (False, VPS_SIGN_IN, True))
        self.assertIn("No model can answer right now", down)

    def test_a_primary_that_could_not_be_made_is_said_down_and_never_pinged(self):
        from desk import model
        cli = load_cli()
        gpt = Asked("openai", "gpt-5")

        def gone():
            raise model.ModelUnreachable("ANTHROPIC_API_KEY is not set.", cause="no Anthropic key")
        p = model.Failover(gone, lambda: gpt, job="followups").ready()
        ok, said, outage, down = cli.job_probe(p, 30)
        self.assertEqual((ok, said, outage, down), (False, "ANTHROPIC_API_KEY is not set.", True, None))
        self.assertEqual(gpt.calls, [])  # a green "gpt-5 answered" would hide the primary's outage

    def test_one_miss_is_said_and_stays_on_the_primary(self):
        cli = load_cli()
        miss = http.HttpError(0, "TimeoutError: timed out", b"", "http://127.0.0.1:3456")
        p = self.failover(Asked("vps", "opus", ping=miss), lambda: Asked("openai", "gpt-5"))
        ok, _, outage, down = cli.job_probe(p, 30)
        self.assertEqual((ok, outage, down), (False, False, None))
        self.assertFalse(p.on_fallback)

    def test_a_plain_provider_keeps_todays_rule(self):
        cli = load_cli()
        self.assertEqual(cli.job_probe(Asked("vps", "opus", ping=self.lapsed()), 30),
                         (False, VPS_SIGN_IN, True, VPS_SIGN_IN))
        self.assertEqual(cli.job_probe(Asked("vps", "opus"), 30), (True, "opus answered", False, None))


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
        # One miss is said and is no outage: the watchdog would blame a lapsed sign-in.
        self.assertTrue(row(pg, "model")["ok"])
        self.assertIn("one miss is not an outage", row(pg, "model")["detail"])
        self.assertIn("drafting is tried all the same", err)
        # A second miss in a row is: the row turns false and says since when.
        with tempfile.TemporaryDirectory() as tmp:
            run_cli(["--quiet", "followups"], world, tmp)
        self.assertFalse(row(pg, "model")["ok"])
        self.assertRegex(row(pg, "model")["detail"], r"Not answering since \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$")
        # It answers again: green, and the next single miss is one miss again.
        world.model_ok = True
        with tempfile.TemporaryDirectory() as tmp:
            run_cli(["--quiet", "followups"], world, tmp)
        self.assertEqual(row(pg, "model")["detail"], "opus answered")

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
