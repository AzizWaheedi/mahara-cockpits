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

    def make_app(self, app, files):
        """Write a second fixture app and return its folder."""
        folder = self.root / "apps" / app
        for rel, body in files.items():
            path = folder / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8")
        return folder

    def run_check(self, app=APP):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(self.root), app],
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

    def test_a_listed_app_reads_its_own_menu_and_routes(self):
        app = "sales-cockpit"
        folder = self.make_app(app, {
            "src/components/Sidebar.tsx": 'const items = [{ label: "Board" }];\n',
            "src/components/MacOSDock.tsx": "export const dock = [];\n",
            "src/App.tsx": 'path="/board" path="/login"\n',
            # The old pair is present and would fail if it were read instead.
            "src/components/AppSidebar.tsx": 'const items = [{ label: "Wrong" }];\n',
            "src/auth/authenticated/AuthenticatedAppRoutes.tsx": 'path="/wrong"\n',
        })
        guide = "Board /board " + " ".join(["text"] * 1600)
        (folder / "assistant-guide.md").write_text(guide + "\n", encoding="utf-8")
        done = self.run_check(app)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_an_unlisted_app_uses_the_default_files(self):
        app = "unlisted-cockpit"
        folder = self.make_app(app, {
            "src/components/AppSidebar.tsx": 'const items = [{ label: "Fallback" }];\n',
            "src/auth/authenticated/AuthenticatedAppRoutes.tsx": 'path="/fallback"\n',
            # A file the sales pair would read, and would fail on.
            "src/App.tsx": 'path="/other"\n',
        })
        guide = "Fallback /fallback " + " ".join(["text"] * 1600)
        (folder / "assistant-guide.md").write_text(guide + "\n", encoding="utf-8")
        done = self.run_check(app)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_review_routes_are_skipped(self):
        routes = (self.app / "src/auth/authenticated/AuthenticatedAppRoutes.tsx")
        routes.write_text(
            ROUTES.strip() + ' path="/review/:id"\n', encoding="utf-8"
        )
        self.write_guide(make_guide())
        done = self.run_check()
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertNotIn("/review", done.stdout)


if __name__ == "__main__":
    unittest.main()
