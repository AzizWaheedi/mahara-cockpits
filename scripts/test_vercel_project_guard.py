import importlib.util
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
