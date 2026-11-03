"""The command line: doctor names every key by name and never prints a value; pending reports its health row
when off, idle or after a run; the dry run pulls nothing; the cron manifest runs under flock."""
import contextlib
import io
import re
import unittest
from pathlib import Path

import mi as _pkg  # noqa: F401
from tests import fakes

ROOT = Path(__file__).resolve().parents[1]
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("mi_cli", ROOT / "mi.py")
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


def capture(fn, *a, **kw):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = fn(*a, **kw)
    return code, buf.getvalue()


class Doctor(unittest.TestCase):
    def test_green_with_every_key_and_no_value_printed(self):
        cfg = fakes.cfg()
        w = fakes.World()
        code, out = capture(cli.doctor, cfg, home=w.home, deps=w.deps())
        self.assertEqual(code, 0, out)
        self.assertIn("No blocker.", out)
        self.assertIn("MARKET_INTEL_APIFY_KEY is set", out)
        self.assertIn("market_intel is on, mode shadow", out)
        self.assertIn("the vps engine answers (sonnet): 'OK'", out)
        for secret in ("service-key-test", "apify-key-test", "sc-key-test"):
            self.assertNotIn(secret, out)

    def test_missing_keys_are_blockers_named_by_name(self):
        from mi import config as config_mod
        cfg = config_mod.load(config_mod.Keys(environ={"MARKET_INTEL_MODEL_PROVIDER": "cli"}, files=()), home=fakes.cfg().home)
        code, out = capture(cli.doctor, cfg)
        self.assertEqual(code, 1)
        for name in ("MARKET_INTEL_SUPABASE_URL is not set", "MARKET_INTEL_SUPABASE_KEY is not set",
                     "MARKET_INTEL_APIFY_KEY is not set", "CLAUDE_CODE_OAUTH_TOKEN is not set"):
            self.assertIn(name, out)
        self.assertIn("SCRAPECREATORS_API_KEY is not set: Meta ads fall back to Apify", out)

    def test_the_radar_key_is_used_with_a_warning(self):
        cfg = fakes.cfg(env={"MARKET_INTEL_APIFY_KEY": ""})
        cfg.keys.environ = {k: v for k, v in cfg.keys.environ.items() if k != "MARKET_INTEL_APIFY_KEY"} | {"APIFY_API_KEY": "radar-key"}
        w = fakes.World()
        code, out = capture(cli.doctor, cfg, home=w.home, deps=w.deps())
        self.assertIn("Research uses the radar's Apify key", out)
        self.assertNotIn("radar-key", out)


class Pending(unittest.TestCase):
    def test_off_idle_and_a_run_each_leave_one_health_row(self):
        cfg = fakes.cfg()
        home = fakes.FakeHome(on=False)
        code, out = capture(cli.pending, cfg, home)
        self.assertEqual((code, home.health_rows[-1]["note"]), (0, "Market research is off."))
        w = fakes.World()
        code, out = capture(cli.pending, cfg, w.home, deps_factory=lambda key: w.deps())
        self.assertEqual(code, 0, out)
        self.assertTrue(w.home.health_rows[-1]["ok"])
        self.assertTrue(w.home.health_rows[-1]["note"].startswith("Research finished in shadow"))
        self.assertEqual(w.home.health_rows[-1]["detail"]["state"], "done")
        code, out = capture(cli.pending, cfg, w.home, deps_factory=lambda key: w.deps())
        self.assertEqual(w.home.health_rows[-1]["note"], "Nothing to research.")
        self.assertEqual(w.home.scans, 2)

    def test_the_dry_runs_write_nothing(self):
        cfg = fakes.cfg()
        home = fakes.FakeHome()
        code, out = capture(cli.pending, cfg, home, dry_run=True)
        self.assertIn("Dry run: nothing was claimed, pulled or written.", out)
        code, out = capture(cli.dry_run, cfg, home, fakes.TASK)
        self.assertEqual(code, 0)
        self.assertIn("Country: KW (the card).", out)
        self.assertRegex(out, r"Estimated at most USD \d+\.\d\d for this run; the run cap is USD 2\.00\.")
        self.assertIn("Dry run: nothing was pulled, stored or sent.", out)
        self.assertEqual((home.health_rows, home.progress_calls, home.scans), ([], [], 0))

    def test_backfill_queues_with_who_and_why(self):
        home = fakes.FakeHome()
        code, out = capture(cli.backfill, fakes.cfg(), home, fakes.TASK, "The October client had no report")
        self.assertEqual(code, 0)
        self.assertEqual(home.enqueued[0][2], "backfill")
        self.assertIn("It runs when market research is on.", out)

    def test_a_real_run_command_points_at_the_queue(self):
        from unittest import mock
        c = fakes.cfg()
        with mock.patch.object(cli.config_mod, "load", lambda: c):
            code, out = capture(cli.main, ["run", "--task", "taskMiCedar1"])
        self.assertEqual(code, 2)
        self.assertIn("backfill --task", out)


class AfterARun(unittest.TestCase):
    def setUp(self):
        from mi import pipeline
        self.cfg = fakes.cfg()
        self.w = fakes.World()
        pipeline.run_once(self.cfg, self.w.deps(), self.w.home.claim("worker-test"))

    def test_resend_renders_again_from_the_stored_rows_with_no_pull_and_no_model(self):
        folder = self.cfg.runs_dir / fakes.RUN
        before = (folder / "report.en.md").read_text()
        for name in ("report.en.md", "report.ar.md", "report.answers.md", "docs-requests.json"):
            (folder / name).unlink()
        calls, started = list(self.w.engine.calls), list(self.w.started)
        code, out = capture(cli.resend, self.cfg, self.w.home, fakes.RUN)
        self.assertEqual(code, 0, out)
        self.assertIn("Nothing was sent: publishing comes with MI-3.", out)
        self.assertEqual((folder / "report.en.md").read_text(), before)
        self.assertEqual((self.w.engine.calls, self.w.started), (calls, started))

    def test_resend_reads_the_evidence_in_the_runs_own_order(self):
        # The database sorts eid as text (E1, E10, E2 ...); the facts need E9 before E10 (a second source after
        # the first), or a range of two differing sources would print as one number.
        from mi import pipeline
        from mi.evidence import Pack
        from mi.facts import display
        from mi.supabase import Home

        def row(n, **body):
            return {"eid": f"E{n}", "kind": "ig_profile" if body else "form", "subject": "client", "url": None,
                    "retrieved_at": "2026-11-02T10:00:00Z", "source": "test", "usd": 0, "body": body, "sha256": "a" * 64}
        rows = [row(n) for n in range(1, 9)] + [row(9, handle="cedar.invented", followers=1000),
                                                 row(10, handle="cedar.invented", followers=1100, secondSource=True)]

        class Db:
            def select(self, table, params):
                assert "order=eid" in params
                return sorted(rows, key=lambda r: r["eid"])          # text order, as PostgREST returns it

        got = Home(Db()).evidence(fakes.RUN)
        self.assertEqual([r["eid"] for r in got], [f"E{n}" for n in range(1, 11)])
        pack = Pack([{"eid": e["eid"], "kind": e["kind"], "subject": e["subject"], "url": e["url"],
                      "retrievedAt": e["retrieved_at"], "source": e["source"], "usd": 0, "body": e["body"],
                      "sha256": e["sha256"]} for e in got])
        fact = pipeline.compute_facts(pack, []).get("client", "ig.followers")
        self.assertEqual((display("ig.followers", fact), fact["note"]), ("1,000 to 1,100", "two sources differ"))

    def test_shadow_lists_the_months_runs_and_spend(self):
        code, out = capture(cli.shadow, self.cfg, self.w.home)
        self.assertEqual(code, 0)
        self.assertIn("This month: 1 run(s) (1 done)", out)
        self.assertIn("Research finished in shadow: 6 competitors", out)


class Cron(unittest.TestCase):
    def test_the_manifest_runs_pending_and_prune_under_flock_from_the_env_file(self):
        lines = [l for l in (ROOT / "crontab.manifest").read_text().splitlines() if l.strip() and not l.startswith("#")]
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("*/2 * * * *"))
        for l in lines:
            self.assertIn("flock -n $HOME/.market-intel/", l)
            self.assertIn(". $HOME/.market-intel/env", l)
            self.assertNotRegex(l, r"(KEY|TOKEN)=")
        self.assertIn("mi.py --quiet pending", lines[0])
        self.assertIn("mi.py --quiet prune", lines[1])


if __name__ == "__main__":
    unittest.main()
