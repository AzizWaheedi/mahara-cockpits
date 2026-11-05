"""The production upload must never be retried on an ambiguous CLI result."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("vercel-upload-once.sh")


class UploadOnceTest(unittest.TestCase):
    def run_upload(self, fail):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cli = root / "vercel"
            cli.write_text(
                '#!/usr/bin/env bash\n'
                'printf "call\\n" >> "$FAKE_TRACE"\n'
                'printf "%s\\n" "$@" > "$FAKE_ARGS"\n'
                'if [ "$FAKE_FAIL" = "yes" ]; then\n'
                '  echo "ETIMEDOUT private-test-detail" >&2\n'
                '  exit 1\n'
                'fi\n'
                'echo "Production https://synthetic.vercel.app"\n',
                encoding="utf-8",
            )
            cli.chmod(0o700)
            env = dict(os.environ, PATH=f"{tmp}:{os.environ.get('PATH', '')}",
                       FAKE_TRACE=str(root / "trace"), FAKE_ARGS=str(root / "args"),
                       FAKE_FAIL="yes" if fail else "no")
            args = ["--prod", "--yes", "--force", "--archive", "tgz", "--build-env", "SYNTHETIC=value"]
            result = subprocess.run(["bash", str(SCRIPT), *args], env=env,
                                    capture_output=True, text=True, timeout=10)
            return result, (root / "trace").read_text().splitlines(), (root / "args").read_text().splitlines(), args

    def test_success_forwards_arguments_and_output_once(self):
        result, calls, seen, args = self.run_upload(False)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(calls, ["call"])
        self.assertEqual(seen, ["deploy", *args])
        self.assertIn("Production https://synthetic.vercel.app", result.stdout)

    def test_ambiguous_failure_stops_without_retry_or_private_output(self):
        result, calls, seen, args = self.run_upload(True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, ["call"])
        self.assertEqual(seen, ["deploy", *args])
        self.assertIn("may already have reached production", result.stderr)
        self.assertIn("before retrying", result.stderr)
        self.assertNotIn("private-test-detail", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
