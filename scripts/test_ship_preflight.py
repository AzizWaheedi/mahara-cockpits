"""scripts/ship-preflight.sh lists every missing piece at once and never prints a key.

Each test builds a small repository with a local origin, copies the preflight
and scripts/prepare-worktree.sh into it, and puts a stub `vercel` first on PATH.
"""
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APPS = ["media-buyer-cockpit", "client-success-cockpit", "creative-director-cockpit", "video-editor-cockpit", "sales-cockpit"]
SECRET_NAMES = ("COCKPIT_AUTH_USE_COMPOSIO", "COCKPIT_MANAGEMENT_TOKEN", "SUPABASE_ACCESS_TOKEN", "supabase_token", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VERCEL_TOKEN")
REF = "abcdefghijklmnopqrst"


def find_bash():
    if sys.platform == "win32":
        for candidate in (r"C:\Program Files\Git\bin\bash.exe", r"C:\Program Files (x86)\Git\bin\bash.exe",
                          os.path.expandvars(r"%LOCALAPPDATA%\Programs\Git\bin\bash.exe")):
            if Path(candidate).is_file():
                return candidate
    found = shutil.which("bash")
    return found if found and "System32" not in found else None


def jwt(claims):
    body = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return "eyJhbGciOiJIUzI1NiJ9." + body + ".signature"


def git(cwd, *args):
    subprocess.run(["git", "-c", "user.name=test", "-c", "user.email=test@example.com", *args],
                   cwd=cwd, check=True, capture_output=True)


@unittest.skipIf(find_bash() is None, "bash is not available")
class ShipPreflightTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.repo = self.tmp / "work"
        (self.repo / "scripts").mkdir(parents=True)
        (self.repo / "config").mkdir()
        for name in ("ship-preflight.sh", "prepare-worktree.sh", "check-vercel-project.py"):
            shutil.copy(ROOT / "scripts" / name, self.repo / "scripts" / name)
        shutil.copy(ROOT / "config" / "vercel-projects.json", self.repo / "config" / "vercel-projects.json")
        for app in APPS:
            src = self.repo / "apps" / app / "src"
            src.mkdir(parents=True)
            (src / "env.ts").write_text("export const url = import.meta.env.VITE_SUPABASE_URL;\n")
        (self.repo / ".gitignore").write_text("node_modules/\n.vercel/\n_generated/\n")
        origin = self.tmp / "origin.git"
        git(self.tmp, "init", "-q", "--bare", origin.as_posix())
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "start")
        git(self.repo, "remote", "add", "origin", origin.as_posix())
        git(self.repo, "push", "-q", "origin", "main")
        self.stub = self.tmp / "bin"
        self.stub.mkdir()
        self.vercel(signed_in=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def vercel(self, signed_in, production="HEAD"):
        """A stub CLI: `vercel api` answers with the production deployment.

        `production` is the commit production serves ("HEAD" by default,
        None for a deployment that names no commit).
        """
        code = 0 if signed_in else 1
        config = json.loads((self.repo / "config" / "vercel-projects.json").read_text())["apps/client-success-cockpit"]
        sha = subprocess.run(["git", "rev-parse", production], cwd=self.repo, capture_output=True, text=True,
                             check=True).stdout.strip() if production else None
        deployment = {"id": "dpl_live", "projectId": config["projectId"], "ownerId": config["orgId"],
                      "meta": {"gitCommitSha": sha} if sha else {}}
        (self.stub / "deployment.json").write_text(json.dumps(deployment))
        stub = self.stub / "vercel"
        stub.write_text('#!/usr/bin/env bash\n[ "$1" = api ] && cat "$(dirname "$0")/deployment.json"\nexit %d\n' % code,
                        newline="\n")
        stub.chmod(0o755)
        # check-vercel-project.py looks for vercel.cmd first on Windows.
        (self.stub / "vercel.cmd").write_text('@echo off\r\nif "%%1"=="api" type "%%~dp0deployment.json"\r\nexit /b %d\r\n' % code,
                                              newline="")

    def run_preflight(self, **values):
        env = {k: v for k, v in os.environ.items() if k not in SECRET_NAMES}
        env["PATH"] = str(self.stub) + os.pathsep + env.get("PATH", "")
        env.update(values)
        done = subprocess.run([find_bash(), "scripts/ship-preflight.sh", "client-success"], cwd=self.repo,
                              env=env, capture_output=True, text=True, timeout=120)
        return done.returncode, done.stdout + done.stderr

    def ready_values(self, **claims):
        key = jwt({"role": "anon", "ref": REF, **claims})
        return {"COCKPIT_MANAGEMENT_TOKEN": "management-token-value",
                "VITE_SUPABASE_URL": "https://%s.supabase.co" % REF, "VITE_SUPABASE_ANON_KEY": key}

    def prepare(self):
        done = subprocess.run([find_bash(), "scripts/prepare-worktree.sh", "--apply"], cwd=self.repo,
                              capture_output=True, text=True, timeout=120)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_lists_every_missing_piece_at_once(self):
        (self.repo / "package.json").write_text("{}\n")
        code, out = self.run_preflight()
        self.assertEqual(code, 1, out)
        for expected in ("management token", "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not both set",
                         "dependencies in .", "Vercel link apps/client-success-cockpit/.vercel/project.json",
                         "prepare-worktree.sh --apply"):
            self.assertIn(expected, out)

    def test_prepared_worktree_with_values_is_ready(self):
        self.prepare()
        code, out = self.run_preflight(**self.ready_values())
        self.assertEqual(code, 0, out)
        self.assertIn("ready", out)
        self.assertNotIn("management-token-value", out)

    def test_explicit_composio_route_uses_no_dummy_management_token(self):
        self.prepare()
        executable = self.stub / "composio"
        executable.write_text("#!/usr/bin/env bash\nexit 0\n")
        executable.chmod(0o755)
        values = self.ready_values()
        del values["COCKPIT_MANAGEMENT_TOKEN"]
        code, out = self.run_preflight(COCKPIT_AUTH_USE_COMPOSIO="1", **values)
        self.assertEqual(code, 0, out)
        self.assertNotIn("management-token-value", out)

    def test_service_key_is_refused_without_printing_it(self):
        self.prepare()
        values = self.ready_values(role="service_role")
        code, out = self.run_preflight(**values)
        self.assertEqual(code, 1, out)
        self.assertIn("not anon", out)
        self.assertNotIn(values["VITE_SUPABASE_ANON_KEY"], out)

    def test_secret_key_format_is_refused(self):
        self.prepare()
        values = self.ready_values()
        values["VITE_SUPABASE_ANON_KEY"] = "sb_secret_" + "x" * 30
        code, out = self.run_preflight(**values)
        self.assertEqual(code, 1, out)
        self.assertIn("is a secret key", out)
        self.assertNotIn(values["VITE_SUPABASE_ANON_KEY"], out)

    def test_key_from_another_project_is_named(self):
        self.prepare()
        code, out = self.run_preflight(**self.ready_values(ref="zyxwvutsrqponmlkjihg"))
        self.assertEqual(code, 1, out)
        self.assertIn("belongs to project zyxwvutsrqponmlkjihg", out)

    def test_unpushed_commit_and_dirty_app_are_named(self):
        self.prepare()
        (self.repo / "apps" / "client-success-cockpit" / "src" / "new.ts").write_text("export {};\n")
        (self.repo / "notes.md").write_text("local\n")
        git(self.repo, "add", "notes.md")
        git(self.repo, "commit", "-q", "-m", "not pushed")
        code, out = self.run_preflight(**self.ready_values())
        self.assertEqual(code, 1, out)
        self.assertIn("is not on origin/main", out)
        self.assertIn("apps/client-success-cockpit has uncommitted changes", out)

    def test_older_worktree_than_production_is_refused(self):
        # 2026-10-13: a worktree from before the screen-blip fix could still
        # ship and take the fix off the site, because the comparison with
        # production was skipped on every ship.
        self.prepare()
        (self.repo / "fix.txt").write_text("fix\n")
        git(self.repo, "add", "fix.txt")
        git(self.repo, "commit", "-q", "-m", "screens survive a blip")
        git(self.repo, "push", "-q", "origin", "main")
        self.vercel(signed_in=True, production="HEAD")
        git(self.repo, "reset", "-q", "--hard", "HEAD~1")
        code, out = self.run_preflight(**self.ready_values())
        self.assertEqual(code, 1, out)
        self.assertIn("1 commit(s)", out)
        self.assertIn("screens survive a blip", out)

    def test_production_that_names_no_commit_stops_the_ship(self):
        self.prepare()
        self.vercel(signed_in=True, production=None)
        code, out = self.run_preflight(**self.ready_values())
        self.assertEqual(code, 1, out)
        self.assertIn("does not name the commit", out)
        self.assertIn("ALLOW_UNKNOWN_PRODUCTION=yes", out)

    def test_signed_out_vercel_is_named(self):
        self.prepare()
        self.vercel(signed_in=False)
        code, out = self.run_preflight(**self.ready_values())
        self.assertEqual(code, 1, out)
        self.assertIn("not signed in", out)

    def generated(self, root, full):
        folder = root / "apps" / "media-buyer-cockpit" / "convex" / "_generated"
        folder.mkdir(parents=True, exist_ok=True)
        if full:
            (folder / "api.js").write_text("export const api = {};\n")
        return folder

    def test_empty_generated_folder_is_not_a_copy(self):
        # 2026-10-12: an empty folder passed as present and the ship stopped
        # at the creative retention test.
        self.prepare()
        self.generated(self.repo, full=False)
        code, out = self.run_preflight(**self.ready_values())
        self.assertEqual(code, 1, out)
        self.assertIn("apps/media-buyer-cockpit/convex/_generated has no api.js", out)

    def test_full_copy_comes_from_another_worktree(self):
        other = self.tmp / "other"
        git(self.repo, "worktree", "add", "-q", other.as_posix())
        self.generated(other, full=True)
        empty = self.generated(self.repo, full=False)
        self.prepare()
        self.assertTrue((empty / "api.js").is_file())
        self.assertFalse((empty / "_generated").exists())


if __name__ == "__main__":
    unittest.main()
