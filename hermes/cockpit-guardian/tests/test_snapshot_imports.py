"""The snapshot script must run as a plain file from its own folder.

python3 guard/vps_snapshot.py puts guard/ first on sys.path, where guard/http.py
once stood in for the standard http package, so urllib.request failed to import
and every VPS check went blind on the first install (2026-10-03).
"""
import base64
import json
import subprocess
import sys
import unittest
from pathlib import Path

GUARD = Path(__file__).resolve().parent.parent / "guard"


class SnapshotRunsAsAFile(unittest.TestCase):
    def test_runs_from_its_own_folder_without_shadowing_http(self):
        spec = base64.b64encode(json.dumps({}).encode()).decode()
        p = subprocess.run([sys.executable, str(GUARD / "vps_snapshot.py"), spec],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, cwd=str(GUARD))
        err = p.stderr.decode("utf-8", "replace")
        self.assertNotIn("ImportError", err)
        self.assertNotIn("from .redact import", err)
        self.assertEqual(p.returncode, 0, err[-400:])
        self.assertIsInstance(json.loads(p.stdout.decode("utf-8", "replace")), dict)


if __name__ == "__main__":
    unittest.main()
