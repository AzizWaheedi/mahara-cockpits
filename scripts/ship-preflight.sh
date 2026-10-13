#!/usr/bin/env bash
# Everything scripts/ship.sh needs, checked in seconds and listed at once
# before any test runs. On 2026-10-11 a ship from a fresh worktree stopped
# five times, each after minutes of tests, on one missing piece at a time:
# the management token, dependencies, generated types, the build values and
# a Vercel link.
#
#   scripts/ship-preflight.sh media-buyer | client-success | creative | video-editor | sales | all
#
# It checks that each secret is set and never prints one.
set -uo pipefail
cd "$(dirname "$0")/.."

target="${1:-all}"
case "$target" in
  media-buyer)    dirs=(apps/media-buyer-cockpit) ;;
  client-success) dirs=(apps/client-success-cockpit) ;;
  creative)       dirs=(apps/creative-director-cockpit) ;;
  video-editor)   dirs=(apps/video-editor-cockpit) ;;
  sales)          dirs=(apps/sales-cockpit) ;;
  all) dirs=(apps/client-success-cockpit apps/creative-director-cockpit apps/media-buyer-cockpit
             apps/video-editor-cockpit apps/sales-cockpit) ;;
  *) echo "unknown app: $target"; exit 2 ;;
esac

problems=()

py_bin="python"
command -v python >/dev/null 2>&1 || py_bin="python3"
for tool in git bun node curl "$py_bin"; do
  command -v "$tool" >/dev/null 2>&1 || problems+=("$tool is not installed or not on PATH")
done

# The read-only auth check reads the management token from the environment.
if [ -z "${COCKPIT_MANAGEMENT_TOKEN:-}${SUPABASE_ACCESS_TOKEN:-}${supabase_token:-}" ]; then
  # check-cockpit-auth-config.py already supports the authorized Composio
  # connection. Its live verification still runs before any deployment.
  if [ "${COCKPIT_AUTH_USE_COMPOSIO:-}" = "1" ]; then
    command -v composio >/dev/null 2>&1 || problems+=("Composio auth verification selected, but its CLI is not available")
  else
    problems+=("No Supabase management token (COCKPIT_MANAGEMENT_TOKEN) is set. Use scripts/ship.ps1 or set COCKPIT_AUTH_USE_COMPOSIO=1 for the existing connected Composio verification")
  fi
fi

# Every app reads Supabase in the browser, and the readiness check builds all
# five, so every ship needs the address and anon key at build time. The key
# ends up in the public bundle: a service key there opens every table.
if [ -z "${VITE_SUPABASE_URL:-}" ] || [ -z "${VITE_SUPABASE_ANON_KEY:-}" ]; then
  problems+=("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not both set. scripts/ship.ps1 loads them from an app .env.local")
else
  key_problem=$("$py_bin" - <<'PY'
import base64, json, os, re
url = os.environ["VITE_SUPABASE_URL"].rstrip("/")
key = os.environ["VITE_SUPABASE_ANON_KEY"]
m = re.fullmatch(r"https://([a-z0-9]{20})\.supabase\.co", url)
if not m:
    print("VITE_SUPABASE_URL is not a Supabase project address (https://<project ref>.supabase.co)")
elif key.startswith("sb_secret_"):
    print("VITE_SUPABASE_ANON_KEY is a secret key. Use the project's anon (publishable) key")
elif key.startswith("sb_publishable_"):
    pass
else:
    try:
        part = key.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    except Exception:
        claims = None
    if not isinstance(claims, dict):
        print("VITE_SUPABASE_ANON_KEY is not a Supabase key")
    elif claims.get("role") != "anon":
        print("VITE_SUPABASE_ANON_KEY has role %r, not anon. Use the project's anon key" % claims.get("role"))
    elif claims.get("ref") and claims["ref"] != m.group(1):
        print("VITE_SUPABASE_ANON_KEY belongs to project %s, but VITE_SUPABASE_URL is project %s" % (claims["ref"], m.group(1)))
PY
)
  [ -n "$key_problem" ] && problems+=("$key_problem")
fi

# Dependencies, generated types and Vercel links: one command adds them all.
prep_hint=""
if ! prep=$(scripts/prepare-worktree.sh 2>&1); then
  prep_hint=1
  while IFS= read -r line; do
    case "$line" in
      "  - "*) problems+=("${line#  - }") ;;
    esac
  done <<<"$prep"
fi

vercel_problem=""
if ! command -v vercel >/dev/null 2>&1; then
  vercel_problem="The Vercel CLI is not installed. Install it (npm i -g vercel) and run vercel login"
elif ! vercel whoami ${VERCEL_TOKEN:+--token "$VERCEL_TOKEN"} >/dev/null 2>&1; then
  vercel_problem="The Vercel CLI is not signed in. Run vercel login"
fi
[ -n "$vercel_problem" ] && problems+=("$vercel_problem")

# The deploy refuses a commit GitHub main does not have, or an app folder
# that differs from it (scripts/require-github-main.sh). Say so now.
if git fetch --quiet origin main 2>/dev/null; then
  if ! git merge-base --is-ancestor HEAD origin/main; then
    problems+=("$(git rev-parse --short HEAD) is not on origin/main. Push it to main, or rebase onto origin/main and push")
  elif [ -z "$vercel_problem" ]; then
    # The deploy also refuses a commit that lacks what production serves, so
    # an older worktree cannot take a newer fix off the site (2026-10-13).
    for d in "${dirs[@]}"; do
      out=$("$py_bin" scripts/check-vercel-project.py "$d" --production-in-head 2>&1) || problems+=("$d: $out")
    done
  fi
else
  problems+=("Could not fetch origin main to check that this commit is on GitHub")
fi
for d in "${dirs[@]}"; do
  [ -n "$(git status --porcelain -- "$d")" ] && problems+=("$d has uncommitted changes. Commit and push them, or put them aside")
done

if [ ${#problems[@]} -eq 0 ]; then
  echo "Ship preflight for $target: ready."
  exit 0
fi
echo "Ship preflight for $target: ${#problems[@]} to fix before scripts/ship.sh can run."
printf '  - %s\n' "${problems[@]}"
[ -n "$prep_hint" ] && echo "scripts/prepare-worktree.sh --apply adds the missing dependencies, generated types and Vercel links."
exit 1
