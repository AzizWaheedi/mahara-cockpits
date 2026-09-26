"""Exercise ship.sh's real build invocation with a local fake bun; no deploys."""
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BASH = next((str(p) for p in [Path('C:/Program Files/Git/bin/bash.exe')]
             if p.is_file()), shutil.which('bash'))


@unittest.skipUnless(BASH, 'Bash is required for the shipping script')
class BuildEnvironment(unittest.TestCase):
    def run_build(self, settings, status=0):
        source = (ROOT / 'scripts/ship.sh').read_text(encoding='utf-8')
        invocation = re.search(r'^\s*(\(cd "\$dir" && .*sup_env.*bun run build\))$', source, re.M)
        self.assertIsNotNone(invocation, 'Test must execute the actual Supabase build line')
        with tempfile.TemporaryDirectory(prefix='ship environment ') as directory:
            temp = Path(directory)
            fake = temp / 'bun'
            fake.write_text('#!/usr/bin/env bash\n'
                            'test "${VITE_CONVEX_URL+x}" = x && test -z "$VITE_CONVEX_URL" || exit 91\n'
                            'printf "%s\\n" "${VITE_SUPABASE_URL-unset}" "${VITE_SUPABASE_ANON_KEY-unset}" "$@" > "$PROBE_OUT"\n'
                            'exit "$PROBE_STATUS"\n', encoding='utf-8')
            fake.chmod(0o755)
            env = os.environ.copy()
            for key in ('VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_CONVEX_URL'):
                env.pop(key, None)
            env.update(settings)
            env.update(PROBE_OUT=(temp/'received.txt').as_posix(), PROBE_STATUS=str(status))
            script = 'set -eu\n'
            script += 'dir=' + shlex.quote(temp.as_posix()) + '\nbin=$(cd "$dir" && pwd)\nexport PATH="$bin:$PATH"\n'
            script += 'sup_env=()\n'
            script += '[ -n "${VITE_SUPABASE_URL:-}" ] && sup_env+=(VITE_SUPABASE_URL="$VITE_SUPABASE_URL")\n'
            script += '[ -n "${VITE_SUPABASE_ANON_KEY:-}" ] && sup_env+=(VITE_SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY")\n'
            script += invocation.group(1) + '\n'
            result = subprocess.run([BASH, '-c', script], env=env, capture_output=True, text=True, timeout=20)
            received = (temp/'received.txt').read_text(encoding='utf-8').splitlines() if (temp/'received.txt').exists() else []
            return result, received

    def test_missing_optional_variables(self):
        result, received = self.run_build({})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(received, ['unset', 'unset', 'run', 'build'])

    def test_variables_preserve_spaces_and_convex_is_empty(self):
        result, received = self.run_build({'VITE_SUPABASE_URL': 'https://fixture.invalid', 'VITE_SUPABASE_ANON_KEY': 'public fixture key'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(received, ['https://fixture.invalid', 'public fixture key', 'run', 'build'])

    def test_failed_build_propagates(self):
        result, _ = self.run_build({'VITE_SUPABASE_URL': 'https://fixture.invalid'}, 37)
        self.assertEqual(result.returncode, 37, result.stderr)


if __name__ == '__main__':
    unittest.main()
