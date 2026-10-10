import contextlib
import importlib.util
import io
import json
import os
import pathlib
import re
import subprocess
import tempfile
import unittest
import urllib.error
from unittest import mock

SCRIPT = pathlib.Path(__file__).with_name("check-cockpit-auth-config.py")
SPEC = importlib.util.spec_from_file_location("auth_config", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
ROOT = pathlib.Path(__file__).resolve().parents[1]
TOKEN_NAMES = ("COCKPIT_MANAGEMENT_TOKEN", "SUPABASE_ACCESS_TOKEN", "supabase_token")
SECRET = "sbp_test_token_that_must_never_be_printed"
MIGRATIONS = ROOT / "supabase/migrations"

def good_config():
    return dict(site_url="https://cockpit.maharamedia.com/", uri_allow_list="https://cockpit.maharamedia.com/",
                disable_signup=False, external_email_enabled=True, mailer_autoconfirm=False,
                mailer_otp_length=6, smtp_host="smtp.resend.com", smtp_user="resend",
                smtp_admin_email="cockpit@notify.maharamedia.com", rate_limit_email_sent=30,
                mailer_templates_magic_link_content="{{ .Token }}", mailer_templates_confirmation_content="{{ .Token }}",
                mailer_templates_recovery_content="{{ .Token }}")


class AuthConfigurationTests(unittest.TestCase):
    def test_browser_rpc_inventory_catches_missing_migrations(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            src = root / "apps" / "fixture" / "src"
            src.mkdir(parents=True)
            (src / "actual.ts").write_text('client.rpc("cockpit_missing", {}); client.rpc(\n"cockpit_present", {});')
            (src / "isolated.test.ts").write_text('client.rpc("cockpit_test_only", {});')
            (src / "dev").mkdir()
            (src / "dev" / "fixture.ts").write_text('client.rpc("cockpit_dev_only", {});')
            expected = MODULE.browser_rpc_names(root)
            self.assertEqual(expected, {"cockpit_missing", "cockpit_present"})
            self.assertEqual(MODULE.missing_backend_rpcs(expected, ["cockpit_present"]), ["cockpit_missing"])
            self.assertEqual(MODULE.missing_backend_rpcs(expected, list(expected)), [])

    def test_backend_catalog_requires_a_real_array(self):
        with self.assertRaises(ValueError):
            MODULE.missing_backend_rpcs({"cockpit_present"}, "cockpit_present")

    def test_server_and_worker_contracts_are_checked_without_fixtures(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            server = root / "supabase/functions/fixture"
            server.mkdir(parents=True)
            (server / "index.ts").write_text('client.rpc("cockpit_server", {});')
            worker = root / "hermes/worker"
            worker.mkdir(parents=True)
            (worker / "worker.ts").write_text('callRpc(driver.tools, "cockpit_worker", {}); rpc(env,"cockpit_sync",{});')
            (worker / "worker.test.ts").write_text('rpc(env,"cockpit_fixture",{});')
            (worker / "scripts").mkdir()
            (worker / "scripts/run.py").write_text('call(f"{rest}/rpc/cockpit_python", args)')
            (worker / "node_modules").mkdir()
            (worker / "node_modules/fake.ts").write_text('rpc(env,"cockpit_dependency",{});')
            self.assertEqual(MODULE.production_rpc_names(root), {"cockpit_server", "cockpit_worker", "cockpit_sync", "cockpit_python"})

    def test_valid_configuration_passes(self):
        self.assertEqual(MODULE.check_config(good_config()), [])

    def test_each_migration_regression_is_rejected(self):
        for key, broken in dict(site_url="https://mahara-video-editor.vercel.app", uri_allow_list="",
                                disable_signup=True, external_email_enabled=False, mailer_autoconfirm=True,
                                mailer_otp_length=8, smtp_host=None, smtp_user=None, smtp_admin_email=None,
                                rate_limit_email_sent=2, mailer_templates_magic_link_content="{{ .ConfirmationURL }}",
                                mailer_templates_confirmation_content="", mailer_templates_recovery_content="{{ .ConfirmationURL }}").items():
            with self.subTest(key=key):
                config = good_config()
                config[key] = broken
                self.assertTrue(MODULE.check_config(config))

    def test_recovery_template_does_not_offer_an_unhandled_link(self):
        config = good_config()
        config["mailer_templates_recovery_content"] += " {{ .ConfirmationURL }}"
        self.assertTrue(MODULE.check_config(config))

    def test_configuration_errors_do_not_disclose_provider_values(self):
        config = good_config()
        config["site_url"] = "private-value"
        config["smtp_pass"] = "secret-value"
        message = " ".join(MODULE.check_config(config))
        self.assertNotIn("secret-value", message)
        self.assertNotIn("private-value", message)


def live_rows(query, drift=False):
    """Fake production answers built from the migration files' own function bodies."""
    if "cockpit_get_my_access()" in query:
        return [{"definition": (MIGRATIONS / "20261007b_cockpit_auth_contract.sql").read_text(encoding="utf-8"),
                 "secure": True, "anon_allowed": drift, "authenticated_allowed": True, "directory_rls": True}]
    if "jsonb_agg" in query:
        return [{"functions": sorted(MODULE.production_rpc_names(ROOT))}]
    if "cockpit_has_active_seat" in query:
        rows = []
        for name, file in (("cockpit_has_active_seat", "20261007d_cockpit_team_rpc_restore.sql"),
                           ("cockpit_team_guard_write", "20261007g_cockpit_team_role_guard.sql"),
                           ("cockpit_log_decision", "20261007f_cockpit_write_contract.sql")):
            source = (MIGRATIONS / file).read_text(encoding="utf-8")
            definition = re.search(r"create or replace function public\." + name + r"\([\s\S]*?\$\$;", source, re.I)[0]
            rows.append({"proname": name, "definition": definition, "anon_allowed": False})
        return rows
    raise AssertionError("unexpected query: " + query)


class FakeComposio:
    """Records every argv and answers like the real CLI: exit 0 even on a 404."""

    def __init__(self, auth=None, sql_ok=True, code=0, stdout=None, drift=False):
        self.calls = []
        self.auth = good_config() if auth is None else auth
        self.sql_ok, self.code, self.stdout, self.drift = sql_ok, code, stdout, drift

    def __call__(self, argv, **kwargs):
        self.calls.append((list(argv), kwargs))
        if self.stdout is not None:
            out = self.stdout
        elif argv[1] == "proxy":
            out = json.dumps(self.auth if argv[2].endswith("/config/auth") else {"message": "Cannot GET " + argv[2]})
        elif self.sql_ok:
            query = json.loads(argv[argv.index("-d") + 1])["query"]
            out = json.dumps({"successful": True, "data": {"command": "SELECT", "result": live_rows(query, self.drift)}, "error": None})
        else:
            out = json.dumps({"successful": False, "data": {"message": "SQL query failed with status 400"}, "error": "failed"})
        return subprocess.CompletedProcess(argv, self.code, out, "")

    def kinds(self, kind):
        return [(argv, kwargs) for argv, kwargs in self.calls if argv[1] == kind]


class FakeToken:
    """Stands in for the management API: answers, or raises the HTTP error it was given."""

    def __init__(self, error=None):
        self.calls, self.error = [], error

    def __call__(self, token, path, payload=None):
        self.calls.append((token, path, payload))
        if isinstance(self.error, Exception):
            raise self.error
        if self.error:
            raise urllib.error.HTTPError(MODULE.MANAGEMENT + path, self.error, "refused", {}, None)
        return good_config() if path == "config/auth" else live_rows(payload["query"])


def environment(token=None):
    values = {key: value for key, value in os.environ.items() if key not in TOKEN_NAMES}
    if token:
        values["COCKPIT_MANAGEMENT_TOKEN"] = token
    return mock.patch.dict(os.environ, values, clear=True)


def run_main(argv=(), token=None, fetch=None, run=None, which=lambda name: "/usr/local/bin/composio"):
    out = io.StringIO()
    with environment(token), contextlib.redirect_stdout(out):
        code = MODULE.main(list(argv), fetch=fetch or FakeToken(), run=run or FakeComposio(), which=which)
    return code, json.loads(out.getvalue()), out.getvalue()


class ComposioFallbackTests(unittest.TestCase):
    def assert_read_only_calls(self, composio):
        self.assertTrue(composio.calls)
        for argv, kwargs in composio.calls:
            self.assertEqual(kwargs.get("stdin"), subprocess.DEVNULL)
            self.assertEqual(kwargs.get("timeout"), 90)
            self.assertNotIn(SECRET, " ".join(argv))
        for argv, _ in composio.kinds("proxy"):
            self.assertEqual(argv[1:2] + argv[3:], ["proxy", "--toolkit", "supabase"])
            self.assertTrue(argv[2].startswith("https://api.supabase.com/v1/projects/bldgtotkfmhoxmlzowdx/"))
            for flag in ("-X", "--method", "-d", "--data", "-H", "--header"):
                self.assertNotIn(flag, argv)
        for argv, _ in composio.kinds("execute"):
            self.assertEqual(argv[1:4], ["execute", "SUPABASE_BETA_RUN_SQL_QUERY", "-d"])
            data = json.loads(argv[4])
            self.assertIs(data["read_only"], True)
            self.assertEqual(data["ref"], "bldgtotkfmhoxmlzowdx")
            self.assertRegex(data["query"], r"^select ")

    def test_no_token_reads_through_composio_and_passes(self):
        composio, token = FakeComposio(), FakeToken()
        code, result, _ = run_main(run=composio, fetch=token)
        self.assertEqual((code, result), (0, {"status": "ok", "production_verified": True, "via": "composio", "failures": []}))
        self.assertEqual(token.calls, [])
        self.assertEqual(len(composio.kinds("proxy")), 1)
        self.assertEqual(len(composio.kinds("execute")), 3)
        self.assert_read_only_calls(composio)

    def test_a_rejected_token_falls_back_without_leaking_it(self):
        for status in (401, 403):
            with self.subTest(status=status):
                composio, token = FakeComposio(), FakeToken(status)
                code, result, printed = run_main(token=SECRET, run=composio, fetch=token)
                self.assertEqual((code, result["status"], result["via"]), (0, "ok", "composio"))
                self.assertEqual([path for _, path, _ in token.calls], ["config/auth"])
                self.assertNotIn(SECRET, printed)
                self.assert_read_only_calls(composio)

    def test_other_token_failures_never_fall_back(self):
        for error in (500, 404, urllib.error.URLError("offline")):
            with self.subTest(error=error):
                composio = FakeComposio()
                code, result, printed = run_main(token=SECRET, run=composio, fetch=FakeToken(error))
                self.assertEqual((code, result["status"], result["production_verified"]), (1, "failed", False))
                self.assertEqual(composio.calls, [])
                self.assertNotIn(SECRET, printed)

    def test_a_working_token_is_used_as_before(self):
        composio, token = FakeComposio(), FakeToken()
        code, result, printed = run_main(token=SECRET, run=composio, fetch=token)
        self.assertEqual((code, result["status"], result["via"]), (0, "ok", "token"))
        self.assertEqual(composio.calls, [])
        self.assertEqual([path for _, path, _ in token.calls], ["config/auth"] + ["database/query"] * 3)
        self.assertTrue(all(payload["read_only"] for _, path, payload in token.calls if path == "database/query"))
        self.assertNotIn(SECRET, printed)

    def test_choosing_a_transport_skips_the_other(self):
        code, result, _ = run_main(["--via", "composio"], token=SECRET, fetch=FakeToken(AssertionError("token used")))
        self.assertEqual((code, result["via"]), (0, "composio"))
        composio = FakeComposio()
        code, result, printed = run_main(["--via", "token"], token=SECRET, run=composio, fetch=FakeToken(401))
        self.assertEqual((code, result["status"]), (1, "failed"))
        self.assertIn("401", result["message"])
        self.assertEqual(composio.calls, [])
        self.assertNotIn(SECRET, printed)
        code, result, _ = run_main(["--via", "token"], run=composio)
        self.assertEqual((code, result["message"]), (1, MODULE.NO_TOKEN))

    def test_a_proxy_404_body_fails(self):
        composio = FakeComposio(auth={"message": "Cannot GET /v1/projects/bldgtotkfmhoxmlzowdx/config/auth"})
        code, result, _ = run_main(run=composio)
        self.assertEqual((code, result["status"], result["via"]), (1, "failed", "composio"))
        self.assertIn("site_url", result["message"])
        self.assertEqual(composio.kinds("execute"), [])

    def test_an_unsuccessful_sql_read_fails(self):
        code, result, _ = run_main(run=FakeComposio(sql_ok=False))
        self.assertEqual((code, result["status"], result["production_verified"]), (1, "failed", False))
        self.assertEqual(result["message"], "Composio's read-only SQL read failed")

    def test_a_failing_or_garbled_cli_fails(self):
        for composio in (FakeComposio(code=1), FakeComposio(stdout="Error: not linked")):
            with self.subTest(code=composio.code):
                code, result, _ = run_main(run=composio)
                self.assertEqual((code, result["status"], result["via"]), (1, "failed", "composio"))

    def test_a_notice_before_the_json_is_tolerated(self):
        self.assertEqual(MODULE.parse_json("Update available: 0.4.2\n{\"a\": [1]}"), {"a": [1]})

    def test_live_drift_read_through_composio_is_reported(self):
        code, result, _ = run_main(run=FakeComposio(drift=True))
        self.assertEqual((code, result["via"]), (1, "composio"))
        self.assertEqual(result["failures"], ["Directory access security or grants changed"])

    def test_only_one_select_runs(self):
        for query in ("delete from cockpit_members", "update cockpit_members set role='ceo'",
                      "with gone as (delete from cockpit_members returning *) select * from gone",
                      "select 1; drop table cockpit_members", "select * into copy_of_members from cockpit_members",
                      "select 1 for update", "  insert into x values (1)", "selectx from y", ""):
            with self.subTest(query=query):
                composio, token = FakeComposio(), FakeToken()
                with self.assertRaises(ValueError):
                    MODULE.ComposioReader("/usr/local/bin/composio", composio).sql(query)
                with self.assertRaises(ValueError):
                    MODULE.TokenReader(SECRET, token).sql(query)
                self.assertEqual((composio.calls, token.calls), ([], []))
        self.assertEqual(MODULE.select_only("select 1;"), "select 1;")

    def test_a_missing_cli_says_what_to_do(self):
        code, result, _ = run_main(which=lambda name: None)
        self.assertEqual(code, 1)
        self.assertEqual(result["message"], "No working management token and no Composio CLI. Install composio and link Supabase, or set COCKPIT_MANAGEMENT_TOKEN.")
        code, result, printed = run_main(token=SECRET, fetch=FakeToken(401), which=lambda name: None)
        self.assertEqual(result["message"], MODULE.NO_COMPOSIO)
        self.assertNotIn(SECRET, printed)

    def test_a_slow_cli_times_out_cleanly(self):
        def slow(argv, **kwargs):
            raise subprocess.TimeoutExpired(argv, kwargs["timeout"])
        code, result, _ = run_main(run=slow)
        self.assertEqual((code, result["status"]), (1, "failed"))
        self.assertIn("90 seconds", result["message"])

    def test_the_offline_fixture_mode_is_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = pathlib.Path(folder) / "auth.json"
            fixture.write_text(json.dumps(good_config()))
            composio, token = FakeComposio(), FakeToken()
            code, result, _ = run_main(["--config-file", str(fixture)], run=composio, fetch=token)
        self.assertEqual((code, result), (0, {"status": "ok", "production_verified": False, "failures": []}))
        self.assertEqual((composio.calls, token.calls), ([], []))


if __name__ == "__main__":
    unittest.main()
