import importlib.util
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


if __name__ == "__main__":
    unittest.main()
