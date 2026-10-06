"""The temp folders the tests make are removed when the run ends."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class TheTestsCleanUp(unittest.TestCase):
    def test_mkdtemp_lands_in_the_runs_own_folder(self) -> None:
        import tests

        made = tempfile.mkdtemp()
        self.assertTrue(made.startswith(tests.RUN_TMP + os.sep))
        # A path the doctor prints must never read as a secret key.
        self.assertNotIn("sk-", made)

    def test_the_runs_folder_is_gone_after_exit(self) -> None:
        code = (
            "import tests, tempfile, pathlib\n"
            "d = pathlib.Path(tempfile.mkdtemp()) / 'work'\n"
            "d.mkdir()\n"
            "(d / 'draft-1.html').write_text('x' * 1000)\n"
            "print(tests.RUN_TMP)\n"
        )
        out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, timeout=30, check=True)
        run_tmp = out.stdout.strip()
        self.assertTrue(run_tmp)
        self.assertFalse(Path(run_tmp).exists(), "the run's temp folder should be removed at exit")


if __name__ == "__main__":
    unittest.main()
