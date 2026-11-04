"""Offline tests for check-assistant-guides.py.

The fake repo is not a git repo, so the non-blocking NOTE is skipped.
"""
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name("check-assistant-guides.py")
APP = "fixture-cockpit"

SIDEBAR = 'const items = [{ label: "Today" }, { label: "Ads" }, { label: "Sales" }];\n'
ROUTES = 'path="/dashboard" path="/ads/:id" path="/login" path="*"\n'
PAGE = 'export function X() { return <button>New creative</button>; }\n'


def make_guide(words=1600, extra=""):
    text = 'Today Ads /dashboard /ads "New creative" ' + extra
    filler = " ".join(["text"] * max(0, words - len(text.split())))
    return (text + " " + filler).strip() + "\n"


class GuideCheckTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        app = self.root / "apps" / APP
        for rel, body in (
            ("src/components/AppSidebar.tsx", SIDEBAR),
            ("src/auth/authenticated/AuthenticatedAppRoutes.tsx", ROUTES),
            ("src/pages/X.tsx", PAGE),
        ):
            path = app / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8")
        self.app = app

    def write_guide(self, text):
        (self.app / "assistant-guide.md").write_text(text, encoding="utf-8")

    def run_check(self):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(self.root), APP],
            capture_output=True, text=True,
        )

    def test_a_guide_that_matches_the_code_passes(self):
        self.write_guide(make_guide())
        done = self.run_check()
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_a_missing_menu_label_fails(self):
        self.write_guide(make_guide().replace(" Ads ", " ").replace("/ads", "/panel"))
        done = self.run_check()
        self.assertEqual(done.returncode, 1)
        self.assertIn("menu label not in guide: Ads", done.stdout)

    def test_a_missing_page_address_fails(self):
        self.write_guide(make_guide().replace("/dashboard ", " "))
        done = self.run_check()
        self.assertEqual(done.returncode, 1)
        self.assertIn("page address not in guide: /dashboard", done.stdout)

    def test_a_longer_address_does_not_cover_ads(self):
        self.write_guide(make_guide().replace("/ads ", "/adsx "))
        done = self.run_check()
        self.assertEqual(done.returncode, 1)
        self.assertIn("page address not in guide: /ads", done.stdout)

    def test_an_invented_quoted_button_fails(self):
        self.write_guide(make_guide(extra='"Made up button" '))
        done = self.run_check()
        self.assertEqual(done.returncode, 1)
        self.assertIn("Made up button", done.stdout)

    def test_an_em_dash_fails(self):
        self.write_guide(make_guide(extra="\u2014 "))
        done = self.run_check()
        self.assertEqual(done.returncode, 1)
        self.assertIn("em dash", done.stdout)

    def test_a_short_guide_fails(self):
        self.write_guide(make_guide(words=1000))
        done = self.run_check()
        self.assertEqual(done.returncode, 1)
        self.assertIn("1000 words", done.stdout)

    def test_the_switcher_label_sales_is_not_required(self):
        self.write_guide(make_guide().replace("Today Ads", "Today"))
        done = self.run_check()
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertNotIn("Sales", done.stdout)


if __name__ == "__main__":
    unittest.main()
