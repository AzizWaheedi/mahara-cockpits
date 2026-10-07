import importlib.util
import pathlib
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name("check-cockpit-auth-config.py")
SPEC = importlib.util.spec_from_file_location("auth_config", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


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


if __name__ == "__main__":
    unittest.main()
