#!/bin/zsh
# The live-calls test matrix; one line per step with its exit code. Usage: zsh scripts/dev/matrix.sh (MATRIX_ROOT, MATRIX_LOGS override the paths).
R=${MATRIX_ROOT:-$(git -C "${0:A:h}" rev-parse --show-toplevel)}
L=${MATRIX_LOGS:-${TMPDIR:-/tmp}/mahara-matrix-logs}
mkdir -p $L
step() { local name=$1; shift; local dir=$1; shift; (cd $dir && "$@") > $L/$name.log 2>&1; echo "$name exit=$?"; }
step api $R bun test supabase/functions/sales-api
step live $R bun test supabase/functions/sales-live sites/call-link
step ui $R/apps/sales-cockpit bun test src
step tsc $R/apps/sales-cockpit npx tsc -b
step biome $R/apps/sales-cockpit bunx biome check src
step desk $R/hermes/sales-desk python3 -m unittest discover -s tests -t .
step dbchecks $R python3 supabase/migrations/tests/run_checks.py
step dbadv $R python3 supabase/migrations/tests/run_adversarial.py
for f in api live ui; do echo "$f: $(grep -E '^ *[0-9]+ (pass|fail)$|^Ran ' $L/$f.log | tr '\n' ' ')"; done
echo "biome: $(tail -3 $L/biome.log | tr '\n' ' ')"
echo "desk: $(grep -E '^Ran |^OK|^FAILED' $L/desk.log | tr '\n' ' ')"
echo "dbchecks: $(grep -E 'passed,|Nothing persisted|persisted' $L/dbchecks.log | tr '\n' ' ')"
echo "dbadv: $(grep -E 'passed,|Nothing persisted|persisted' $L/dbadv.log | tr '\n' ' ')"
