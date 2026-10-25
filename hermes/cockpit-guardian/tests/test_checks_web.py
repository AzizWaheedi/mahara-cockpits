"""Sites, keys and the Hermes monitors."""
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from tests import fakes
from checks import hermes_monitors, keys, sites
from guard.context import SourceError
from guard.model import FAIL, OK, UNKNOWN, WARN, iso

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

    def test_deadman_blind_when_beats_are_refused(self):
        snap = fakes.snapshot()
        for m in ("dialer", "portal"):
            snap["monitors"][m]["beat_last_ok"] = fakes.NOW.timestamp() - 3.5 * 3600
            snap["monitors"][m]["beat_failures"] = 195
        r = hermes_monitors.run_deadman(make(snap))
        self.assertEqual(r.status, WARN)
        self.assertEqual(sorted(r.items), ["dialer", "portal"])
        self.assertIn("blind", r.summary)
        self.assertIn("1,000", r.summary)

    def test_deadman_warns_ahead_when_the_beats_cannot_fit_the_free_plan(self):
        r = hermes_monitors.run_deadman(make())  # four monitors beating, all fresh: 1,440 writes a day
        self.assertEqual(r.status, WARN)
        self.assertIn("later today", r.summary)

    def test_deadman_ok_within_the_budget(self):
        snap = fakes.snapshot()
        for m in ("dialer", "portal"):
            del snap["monitors"][m]
        self.assertEqual(hermes_monitors.run_deadman(make(snap)).status, OK)

    def test_deadman_unknown_without_heartbeat_readings(self):
        snap = fakes.snapshot()
        for m in snap["monitors"].values():
            m.pop("beat_last_ok", None)
        with self.assertRaises(SourceError):  # the engine reads it as unknown, never as healthy
            hermes_monitors.run_deadman(make(snap))

    def deadman_after(self, every, extra=(), state=None, scans=5):
        """Scans 5 min apart, as the guardian runs, over monitors beating every `every` min (a dict: per monitor)."""
        snap = fakes.snapshot()
        for name in extra:
            snap["monitors"][name] = dict(snap["monitors"]["portal"])
        state = {} if state is None else state
        base = fakes.NOW.timestamp() - 30
        for i in range(scans):
            for name, m in snap["monitors"].items():
                e = every.get(name, every["*"]) if isinstance(every, dict) else every
                m["beat_last_ok"] = base + e * 60 * ((5 * i) // e)
            r = hermes_monitors.run_deadman(make(snap, state=state, now=fakes.NOW + timedelta(minutes=5 * i)))
        return r

    def test_deadman_clears_once_the_10_minute_release_is_seen(self):
        # 24 Oct 2026 release: 5 monitors x 144 beats + the worker's watcher key about 48 times = 768 a day.
        r = self.deadman_after(10, extra=("media-api",))
        self.assertEqual(r.status, OK, r.summary)
        self.assertEqual(r.evidence["kv_writes_a_day"], 5 * 144 + 48)
        self.assertEqual(set(r.evidence["beat_every_min"].values()), {10.0})

    def test_deadman_still_warns_before_the_release(self):
        r = self.deadman_after(5, extra=("media-api",))
        self.assertEqual(r.status, WARN)
        self.assertEqual(r.evidence["kv_writes_a_day"], 6 * 288)
        # One monitor still on 5 min: the worker is not trusted to be on its 30-minute watcher either.
        r = self.deadman_after({"*": 10, "dialer": 5})
        self.assertEqual(r.status, WARN)
        self.assertEqual(r.evidence["kv_writes_a_day"], 3 * 144 + 288 + 288)

    def test_a_refused_evening_does_not_hide_the_cadence(self):
        t0 = fakes.NOW - timedelta(hours=10, minutes=10)
        state = {"history": {"beats": {"portal": [iso(t0), iso(t0 + timedelta(minutes=5)), iso(t0 + timedelta(hours=10))]}}}
        snap = fakes.snapshot()
        snap["monitors"]["portal"]["beat_last_ok"] = (t0 + timedelta(hours=10, minutes=5)).timestamp()
        self.assertEqual(hermes_monitors.beat_every_min(make(snap, state=state), snap["monitors"])["portal"], 5.0)

    def deadman_scans(self, dialer_beats, until):
        """A scan every 5 min up to `until`. The dialer beats at the given minutes, the other monitors every 10."""
        snap = fakes.snapshot()
        snap["monitors"]["media-api"] = dict(snap["monitors"]["portal"])
        state, base, out = {}, fakes.NOW.timestamp(), []
        for scan in range(5, until + 1, 5):
            for name, m in snap["monitors"].items():
                times = dialer_beats if name == "dialer" else range(1, until + 1, 10)
                m["beat_last_ok"] = base + 60 * [t for t in times if t <= scan][-1]
            out.append((scan, hermes_monitors.run_deadman(make(snap, state=state, now=fakes.NOW + timedelta(minutes=scan)))))
        return out

    def test_an_extra_beat_does_not_set_the_cadence(self):
        # A monitor beats at once when its incidents open or close. Dialer, 25 Oct 2026: open 11:32, closed 11:35.
        for beats in ([1, 11, 21, 28, 38, 48, 58], [1, 11, 21, 28, 31, 41, 51, 61]):
            for scan, r in self.deadman_scans(beats, until=65):
                if scan >= 15:  # two beats seen
                    self.assertEqual(r.status, OK, f"{beats} at minute {scan}: {r.summary}")
                    self.assertEqual(r.evidence["beat_every_min"]["dialer"], 10.0)
                    self.assertEqual(r.evidence["kv_writes_a_day"], 5 * 144 + 48)

    def test_the_guardians_own_beat_is_counted_when_on(self):
        state = {"beat": {"at": iso(fakes.NOW), "ok_at": iso(fakes.NOW)}}
        r = self.deadman_after(10, extra=("media-api",), state=state)
        self.assertEqual(r.status, WARN)
        self.assertEqual(r.evidence["kv_writes_a_day"], 5 * 144 + 48 + 288)
        state["beat"]["off"] = True
        self.assertEqual(self.deadman_after(10, extra=("media-api",), state=state).status, OK)

    def test_failing_hermes_job(self):
        snap = fakes.snapshot(hermes_jobs=[{"name": "Nightly Backup", "enabled": True, "last_status": "error", "last_error": "exit 1"},
                                           {"name": "Universal cron incident fixer", "enabled": False, "last_status": "ok"}])
        self.assertEqual(hermes_monitors.run_jobs(make(snap)).status, WARN)


if __name__ == "__main__":
    unittest.main()
