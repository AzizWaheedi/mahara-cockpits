"""Sites, keys and the Hermes monitors."""
import tempfile
import unittest
from pathlib import Path

from tests import fakes
from checks import hermes_monitors, keys, sites
from guard.model import FAIL, OK, UNKNOWN, WARN

DB = b"https://bldgtotkfmhoxmlzowdx.supabase.co"


def make(snap=None, web=None, **kw):
    tmp = Path(tempfile.mkdtemp())
    return fakes.ctx(tmp, host=fakes.FakeHost(snap or fakes.snapshot()), web=web, **kw)


def page(title, script="/sales/assets/index-abc.js"):
    return fakes.resp(200, f'<html><head><title>{title}</title><script type="module" src="{script}"></script></head></html>')


class Sites(unittest.TestCase):
    url = "https://cockpit.maharamedia.com/sales/"

    def run_sales(self, web):
        return sites.page_check(self.url, "Sales · Mahara", r"/assets/index-[^/]+\.js$", True)(make(web=web))

    def test_healthy(self):
        web = fakes.FakeWeb({"https://cockpit.maharamedia.com/sales/assets/": fakes.resp(200, b"x" + DB + b"y"),
                             self.url: page("Sales · Mahara")})
        self.assertEqual(self.run_sales(web).status, OK)

    def test_wrong_title(self):
        web = fakes.FakeWeb({self.url: page("404: NOT_FOUND")})
        r = self.run_sales(web)
        self.assertEqual(r.status, FAIL)
        self.assertIn("title", r.summary)

    def test_script_missing(self):
        web = fakes.FakeWeb({"https://cockpit.maharamedia.com/sales/assets/": fakes.resp(404), self.url: page("Sales · Mahara")})
        self.assertEqual(self.run_sales(web).status, FAIL)

    def test_built_without_the_database_address(self):
        web = fakes.FakeWeb({"https://cockpit.maharamedia.com/sales/assets/": fakes.resp(200, b"no address here"),
                             self.url: page("Sales · Mahara")})
        r = self.run_sales(web)
        self.assertEqual(r.status, FAIL)
        self.assertIn("VITE_SUPABASE_URL", r.action)

    def test_page_down(self):
        self.assertEqual(self.run_sales(fakes.FakeWeb({self.url: fakes.resp(502)})).status, FAIL)

    def test_webinar(self):
        base = "https://webinar.maharamedia.com"
        good = fakes.FakeWeb({base + "/mm-track.js": fakes.resp(200, "js"), base + "/live": fakes.resp(200, "<title>x</title>"),
                              base + "/": fakes.resp(200, "<title>t</title>")})
        self.assertEqual(sites.run_webinar(make(web=good)).status, OK)
        bad = fakes.FakeWeb({base + "/mm-track.js": fakes.resp(200), base + "/live": fakes.resp(404), base + "/": fakes.resp(200, "<title>t</title>")})
        r = sites.run_webinar(make(web=bad))
        self.assertEqual(r.status, FAIL)
        self.assertIn("/live", r.summary)


class Keys(unittest.TestCase):
    def test_all_set(self):
        self.assertEqual(keys.run_names(make()).status, OK)

    def test_missing_and_empty_name_the_file_never_a_value(self):
        snap = fakes.snapshot()
        snap["env_keys"]["/opt/data/bibi/api-keys.env"]["DEEPSEEK_API_KEY"] = "empty"
        del snap["env_keys"]["/opt/data/bibi/api-keys.env"]["COMPOSIO_API_KEY"]
        r = keys.run_names(make(snap))
        self.assertEqual(r.status, FAIL)
        self.assertIn("COMPOSIO_API_KEY is missing from /opt/data/bibi/api-keys.env", r.summary)
        self.assertIn("DEEPSEEK_API_KEY is empty", r.summary)

    def test_empty_anthropic_key_is_only_a_note_while_the_desk_uses_the_vps(self):
        snap = fakes.snapshot()
        snap["env_keys"]["/opt/data/bibi/api-keys.env"]["ANTHROPIC_API_KEY"] = "empty"
        r = keys.run_names(make(snap))
        self.assertEqual(r.status, OK)
        self.assertIn("ANTHROPIC_API_KEY", r.summary)
        snap["settings"] = {"SALES_MODEL_PROVIDER": "anthropic"}
        self.assertEqual(keys.run_names(make(snap)).status, FAIL)

    def test_loose_modes_warn(self):
        snap = fakes.snapshot()
        snap["files"]["~/.editor-desk/env"]["mode"] = "644"
        self.assertEqual(keys.run_modes(make(snap)).status, WARN)
        self.assertEqual(keys.run_modes(make()).status, OK)

    def test_probes_are_coverage_gaps_off_the_box(self):
        r = keys.run_slack(make(remote=True, keys={"SLACK_BOT_TOKEN": "xoxb-1"}))
        self.assertEqual(r.status, UNKNOWN)
        self.assertTrue(r.coverage_gap)

    def test_slack_and_deepseek_probes(self):
        web = fakes.FakeWeb({"https://slack.com/api/auth.test": fakes.resp(200, {"ok": False, "error": "invalid_auth"}),
                             "https://api.deepseek.com/user/balance": fakes.resp(200, {"is_available": True, "balance_infos": [{"total_balance": "1.10"}]})})
        c = make(web=web, keys={"SLACK_BOT_TOKEN": "xoxb-1", "DEEPSEEK_API_KEY": "sk-1"})
        r = keys.run_slack(c)
        self.assertEqual(r.status, FAIL)
        self.assertEqual(keys.run_deepseek(c).status, FAIL)


class Monitors(unittest.TestCase):
    def test_ticking_with_incidents_warns_and_is_quiet(self):
        snap = fakes.snapshot()
        snap["monitors"]["mahara-cockpits"]["incidents"] = {"cockpit-sources": {"summary": "2 data sources failing: bridge_fix, bridge_wadraft"}}
        r = hermes_monitors.monitor_check("mahara-cockpits", "cockpits")(make(snap))
        self.assertEqual(r.status, WARN)

    def test_stopped_monitor_fails(self):
        snap = fakes.snapshot()
        snap["monitors"]["public-sites"]["at"] = fakes.ago(10)
        self.assertEqual(hermes_monitors.monitor_check("public-sites", "public sites")(make(snap)).status, FAIL)

    def test_backup(self):
        snap = fakes.snapshot()
        snap["monitors"]["public-sites"]["incidents"] = {"backup-vps": {"summary": "Last VPS backup reached GitHub 151h41m ago", "opened": 1790610299.0}}
        snap["hermes_jobs"] = [{"name": "Nightly Backup", "enabled": True, "last_status": "error", "last_error": "Script exited with code 1"}]
        r = hermes_monitors.run_backup(make(snap))
        self.assertEqual(r.status, FAIL)
        self.assertIn("code 1", r.summary)
        self.assertEqual(hermes_monitors.run_backup(make()).status, OK)

    def test_failing_hermes_job(self):
        snap = fakes.snapshot(hermes_jobs=[{"name": "Nightly Backup", "enabled": True, "last_status": "error", "last_error": "exit 1"},
                                           {"name": "Universal cron incident fixer", "enabled": False, "last_status": "ok"}])
        self.assertEqual(hermes_monitors.run_jobs(make(snap)).status, WARN)


if __name__ == "__main__":
    unittest.main()
