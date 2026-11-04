#!/bin/bash
# Every test file on its own (a failure names its file), then the asset checks.
set -u
cd "$(dirname "$0")"
fail=0
for f in palette grade prompts higgsfield export icons manifest assets alt-copy; do
  echo "== $f.test.ts"
  bun test "./$f.test.ts" || fail=1
done
[ "$fail" = 0 ] && echo "check: all passed." || { echo "check: something failed (see above)."; exit 1; }
