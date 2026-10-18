import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("guard", Path(__file__).with_name("check-vercel-project.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class ProjectGuardTest(unittest.TestCase):
    expected = {"projectId": "real", "orgId": "our-team", "projectName": "mahara-media-buyer", "domain": "cockpit.maharamedia.com"}

    def test_exact_project_and_team(self):
        guard.verify({"projectId": "real", "orgId": "our-team"}, self.expected)

    def test_similar_name_does_not_authorize_another_project(self):
        with self.assertRaisesRegex(ValueError, "Wrong Vercel project"):
            guard.verify({"projectId": "duplicate", "orgId": "our-team", "projectName": "media-buyer-cockpit"}, self.expected)

    def test_wrong_team_or_missing_link_fields(self):
        for link in ({"projectId": "real", "orgId": "another"}, {}):
            with self.assertRaises(ValueError):
                guard.verify(link, self.expected)

    def deployment(self):
        return {"id": "dpl_candidate", "url": "candidate.vercel.app", "projectId": "real", "ownerId": "our-team", "readyState": "READY", "target": "production", "meta": {"gitCommitSha": "a" * 40}}

    def test_exact_ready_production_source(self):
        guard.verify_deployment(self.deployment(), self.expected, "a" * 40)

    def test_wrong_deployment_evidence_fails_closed(self):
        for field, value in (("projectId", "duplicate"), ("ownerId", "another"), ("readyState", "BUILDING"), ("target", "preview"), ("id", ""), ("meta", {}), ("meta", {"gitCommitSha": "b" * 40})):
            with self.subTest(field=field), self.assertRaises(ValueError):
                deployment = self.deployment()
                deployment[field] = value
                guard.verify_deployment(deployment, self.expected, "a" * 40)

    def test_alias_changed_during_plan_fails_closed(self):
        before = self.deployment()
        after = dict(before, id="dpl_other")
        with self.assertRaises(ValueError):
            guard.verify_unchanged_origin(before, after, self.expected)
        with self.assertRaises(ValueError):
            guard.verify_unchanged_origin(before, dict(before, ownerId="another"), self.expected)

    def test_actual_portal_entry_must_match_candidate(self):
        fresh = '<script type="module" src="/client-success/assets/index-fresh.js"></script>'
        stale = '<script type="module" src="/client-success/assets/index-old.js"></script>'
        guard.verify_entries(fresh, fresh)
        for html in (stale, "<html>unavailable</html>"):
            with self.assertRaises(ValueError):
                guard.verify_entries(fresh, html)

    def candidate_plan(self):
        expected = dict(self.expected, scope="our-scope", origin="origin.vercel.app", domain="cockpit.example/client-success")
        candidate = self.deployment()
        origin = dict(candidate, id="dpl_previous")
        return expected, candidate, origin

    def test_default_plan_has_no_publication(self):
        expected, candidate, origin = self.candidate_plan()
        with patch.object(guard, "api", side_effect=[candidate, origin]), patch.object(guard.subprocess, "run", return_value=SimpleNamespace(returncode=0)), patch.object(guard, "vercel") as cli:
            guard.release_candidate("https://candidate.vercel.app", expected, "a" * 40)
            cli.assert_not_called()

    def test_promotion_verifies_exact_origin_and_actual_portal(self):
        expected, candidate, origin = self.candidate_plan()
        fresh = '<script src="/client-success/assets/index-fresh.js"></script>'
        with patch.object(guard, "api", side_effect=[candidate, origin, origin, candidate, candidate]), patch.object(guard.subprocess, "run", return_value=SimpleNamespace(returncode=0)), patch.object(guard, "vercel") as cli, patch.object(guard, "html", return_value=fresh) as fetch:
            guard.release_candidate("https://candidate.vercel.app", expected, "a" * 40, True)
            cli.assert_called_once_with(["promote", "candidate.vercel.app", "--yes"], expected)
            self.assertEqual(fetch.call_args_list[0].args[0], "https://origin.vercel.app/client-success/")
            self.assertEqual(fetch.call_args_list[1].args[0], "https://cockpit.example/client-success/")

    def test_changed_origin_stops_before_mutation(self):
        expected, candidate, origin = self.candidate_plan()
        with patch.object(guard, "api", side_effect=[candidate, origin, candidate]), patch.object(guard.subprocess, "run", return_value=SimpleNamespace(returncode=0)), patch.object(guard, "vercel") as cli, self.assertRaises(ValueError):
            guard.release_candidate("https://candidate.vercel.app", expected, "a" * 40, True)
        cli.assert_not_called()

    def test_failed_promotion_is_not_success(self):
        expected, candidate, origin = self.candidate_plan()
        with patch.object(guard, "api", side_effect=[candidate, origin, origin]), patch.object(guard.subprocess, "run", return_value=SimpleNamespace(returncode=0)), patch.object(guard, "vercel", side_effect=ValueError("promotion failed")), self.assertRaisesRegex(ValueError, "promotion failed"):
            guard.release_candidate("https://candidate.vercel.app", expected, "a" * 40, True)

    def test_stale_portal_after_promotion_fails(self):
        expected, candidate, origin = self.candidate_plan()
        fresh = '<script src="/client-success/assets/index-fresh.js"></script>'
        stale = '<script src="/client-success/assets/index-old.js"></script>'
        with patch.object(guard, "api", side_effect=[candidate, origin, origin] + [candidate] * 6), patch.object(guard.subprocess, "run", return_value=SimpleNamespace(returncode=0)), patch.object(guard, "vercel"), patch.object(guard, "html", side_effect=[fresh, stale] * 6), patch.object(guard.time, "sleep"), self.assertRaisesRegex(ValueError, "Production verification failed"):
            guard.release_candidate("https://candidate.vercel.app", expected, "a" * 40, True)

    def test_missing_configuration_does_not_publish(self):
        with patch.object(guard, "api") as read, self.assertRaises(ValueError):
            guard.release_candidate("https://candidate.vercel.app", None, "a" * 40, True)
        read.assert_not_called()

    def test_cli_timeout_never_discloses_token(self):
        with patch.object(guard.shutil, "which", return_value="vercel"), patch.dict(guard.os.environ, {"VERCEL_TOKEN": "private-test-secret"}), patch.object(guard.subprocess, "run", side_effect=guard.subprocess.TimeoutExpired(["vercel", "--token", "private-test-secret"], 90)), self.assertRaises(ValueError) as caught:
            guard.vercel(["promote", "candidate.vercel.app", "--yes"], dict(self.expected, scope="our-scope"))
        self.assertNotIn("private-test-secret", str(caught.exception))

    def test_unknown_current_source_stops_before_publication(self):
        expected, candidate, origin = self.candidate_plan()
        origin["meta"] = {"gitCommitSha": "HEAD"}
        with patch.object(guard, "api", side_effect=[candidate, origin]), patch.object(guard, "vercel") as cli, self.assertRaises(ValueError):
            guard.release_candidate("https://candidate.vercel.app", expected, "a" * 40, True)
        cli.assert_not_called()

    def test_concurrent_release_during_page_reads_cannot_report_candidate(self):
        expected, candidate, origin = self.candidate_plan()
        newer = dict(candidate, id="dpl_newer", meta={"gitCommitSha": "b" * 40})
        fresh = '<script src="/client-success/assets/index-newer.js"></script>'
        with patch.object(guard, "api", side_effect=[candidate, origin, origin] + [candidate, newer] * 6), patch.object(guard.subprocess, "run", return_value=SimpleNamespace(returncode=0)), patch.object(guard, "vercel"), patch.object(guard, "html", return_value=fresh), patch.object(guard.time, "sleep"), self.assertRaisesRegex(ValueError, "Production verification failed"):
            guard.release_candidate("https://candidate.vercel.app", expected, "a" * 40, True)


class RollbackTest(unittest.TestCase):
    """scripts/release.ps1 returns production to the deployment it recorded before a failed release."""
    expected = {"projectId": "real", "orgId": "our-team", "scope": "our-scope", "origin": "origin.vercel.app", "domain": "cockpit.example/sales"}

    def deployment(self, id_, **extra):
        return dict({"id": id_, "url": f"{id_}.vercel.app", "projectId": "real", "ownerId": "our-team", "readyState": "READY", "target": "production", "meta": {"gitCommitSha": "a" * 40}}, **extra)

    def test_current_reads_production_without_writing(self):
        with patch.object(guard, "api", return_value=self.deployment("dpl-now")), patch.object(guard, "vercel") as cli:
            self.assertEqual(guard.current_production(self.expected), {"id": "dpl-now", "url": "https://dpl-now.vercel.app", "sha": "a" * 40})
            cli.assert_not_called()

    def test_rollback_promotes_the_recorded_deployment_and_waits_for_it(self):
        old, new = self.deployment("dpl-old"), self.deployment("dpl-new")
        with patch.object(guard, "api", side_effect=[old, new, new, old]), patch.object(guard, "vercel") as cli, patch.object(guard.time, "sleep"):
            guard.rollback("https://dpl-old.vercel.app", self.expected)
            cli.assert_called_once_with(["promote", "dpl-old.vercel.app", "--yes"], self.expected)

    def test_rollback_not_needed_when_production_already_serves_it(self):
        old = self.deployment("dpl-old")
        with patch.object(guard, "api", side_effect=[old, old]), patch.object(guard, "vercel") as cli:
            guard.rollback("https://dpl-old.vercel.app", self.expected)
            cli.assert_not_called()

    def test_rollback_refuses_another_project_or_a_preview(self):
        for bad in (self.deployment("dpl-x", projectId="duplicate"), self.deployment("dpl-x", ownerId="another"), self.deployment("dpl-x", target="preview"), self.deployment("dpl-x", readyState="ERROR")):
            with self.subTest(bad=bad), patch.object(guard, "api", return_value=bad), patch.object(guard, "vercel") as cli, self.assertRaises(ValueError):
                guard.rollback("https://dpl-x.vercel.app", self.expected)
            cli.assert_not_called()

    def test_rollback_that_does_not_take_effect_fails(self):
        old, new = self.deployment("dpl-old"), self.deployment("dpl-new")
        with patch.object(guard, "api", side_effect=[old, new] + [new] * 6), patch.object(guard, "vercel"), patch.object(guard.time, "sleep"), self.assertRaisesRegex(ValueError, "did not take effect"):
            guard.rollback("https://dpl-old.vercel.app", self.expected)

    def test_rollback_needs_an_exact_deployment_url(self):
        with patch.object(guard, "api") as read, self.assertRaises(ValueError):
            guard.rollback("https://cockpit.maharamedia.com", self.expected)
        read.assert_not_called()


def run_git(cwd, *args):
    return subprocess.run(["git", "-c", "user.name=test", "-c", "user.email=test@example.com", *args],
                          cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class ProductionInHeadTest(unittest.TestCase):
    """2026-10-13: a ship from an older worktree could replace a newer production."""

    expected = {"projectId": "real", "orgId": "our-team", "scope": "our-scope", "origin": "cockpit.example", "domain": "cockpit.example"}

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        run_git(self.tmp, "init", "-q", "-b", "main")
        self.commit("start.txt", "start")
        self.start = run_git(self.tmp, "rev-parse", "HEAD")
        self.root = patch.object(guard, "ROOT", self.tmp)
        self.root.start()

    def tearDown(self):
        self.root.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def commit(self, name, text):
        (self.tmp / name).write_text(text + "\n")
        run_git(self.tmp, "add", name)
        run_git(self.tmp, "commit", "-q", "-m", text)
        return run_git(self.tmp, "rev-parse", "HEAD")

    def production(self, sha):
        return {"id": "dpl_live", "projectId": "real", "ownerId": "our-team", "meta": {"gitCommitSha": sha} if sha else {}}

    def check(self, production_sha, head):
        with patch.object(guard, "api", return_value=self.production(production_sha)):
            return guard.production_in_head(self.expected, head)

    def test_production_older_than_head_ships(self):
        head = self.commit("fix.txt", "screens survive a blip")
        self.assertIn("is contained in", self.check(self.start, head))

    def test_older_head_than_production_is_refused_and_names_the_commit(self):
        newer = self.commit("fix.txt", "screens survive a blip")
        with self.assertRaisesRegex(ValueError, "1 commit\\(s\\)") as caught:
            self.check(newer, self.start)
        self.assertIn("screens survive a blip", str(caught.exception))
        self.assertNotIsInstance(caught.exception, guard.UnknownProduction)

    def test_sideways_head_is_refused(self):
        live = self.commit("fix.txt", "screens survive a blip")
        run_git(self.tmp, "checkout", "-q", "-b", "other", self.start)
        head = self.commit("other.txt", "data view scan")
        with self.assertRaisesRegex(ValueError, "screens survive a blip"):
            self.check(live, head)

    def test_rebased_copy_of_production_ships(self):
        run_git(self.tmp, "checkout", "-q", "-b", "old", self.start)
        live = self.commit("fix.txt", "screens survive a blip")
        run_git(self.tmp, "checkout", "-q", "main")
        self.commit("other.txt", "data view scan")
        run_git(self.tmp, "cherry-pick", live)
        head = run_git(self.tmp, "rev-parse", "HEAD")
        self.assertIn("rebased names", self.check(live, head))

    def test_production_commit_missing_from_clone_is_refused(self):
        with self.assertRaisesRegex(ValueError, "does not have that commit") as caught:
            self.check("f" * 40, self.start)
        self.assertNotIsInstance(caught.exception, guard.UnknownProduction)

    def test_unknown_production_fails_closed(self):
        with self.assertRaises(guard.UnknownProduction):
            self.check(None, self.start)
        with patch.object(guard, "api", side_effect=ValueError("signed out")), self.assertRaises(guard.UnknownProduction):
            guard.production_in_head(self.expected, self.start)
        with patch.object(guard, "api", return_value=dict(self.production(self.start), ownerId="another")), self.assertRaises(guard.UnknownProduction):
            guard.production_in_head(self.expected, self.start)
        with patch.object(guard, "api") as read, self.assertRaises(guard.UnknownProduction):
            guard.production_in_head(None, self.start)
        read.assert_not_called()

    def run_main(self, env):
        argv = ["check-vercel-project.py", "apps/media-buyer-cockpit", "--production-in-head"]
        (self.tmp / "config").mkdir(exist_ok=True)
        (self.tmp / "config" / "vercel-projects.json").write_text(json.dumps({"apps/media-buyer-cockpit": self.expected}))
        with patch.object(guard.sys, "argv", argv), patch.dict(guard.os.environ, env), patch.object(guard, "api", side_effect=ValueError("signed out")), patch("builtins.print") as printed:
            guard.main()
        return " ".join(str(call.args[0]) for call in printed.call_args_list)

    def test_unknown_production_stops_the_ship_unless_overridden(self):
        with patch.dict(guard.os.environ, {}, clear=False):
            guard.os.environ.pop("ALLOW_UNKNOWN_PRODUCTION", None)
            with self.assertRaisesRegex(ValueError, "Refusing to ship without knowing"):
                self.run_main({})
        self.assertIn("without comparing it with production", self.run_main({"ALLOW_UNKNOWN_PRODUCTION": "yes"}))

    def test_override_never_covers_a_production_head_lacks(self):
        newer = self.commit("fix.txt", "screens survive a blip")
        run_git(self.tmp, "checkout", "-q", self.start)
        (self.tmp / "config").mkdir(exist_ok=True)
        (self.tmp / "config" / "vercel-projects.json").write_text(json.dumps({"apps/media-buyer-cockpit": self.expected}))
        argv = ["check-vercel-project.py", "apps/media-buyer-cockpit", "--production-in-head"]
        with patch.object(guard.sys, "argv", argv), patch.dict(guard.os.environ, {"ALLOW_UNKNOWN_PRODUCTION": "yes"}), patch.object(guard, "api", return_value=self.production(newer)), self.assertRaisesRegex(ValueError, "would take production backwards"):
            guard.main()


if __name__ == "__main__":
    unittest.main()
