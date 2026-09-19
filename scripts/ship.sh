#!/usr/bin/env bash
# Ship one cockpit (or all) the safe way: lint, typecheck, deploy the backend,
# build and deploy the site, then run the smoke check. Stops at the first
# failure so a broken build never replaces a working one.
#
#   scripts/ship.sh media-buyer | client-success | creative | video-editor | all
#
# Order matters when a bridge payload gains a field: ship the receiving app
# (client-success, creative) before the media buyer that sends it. "all" does.
set -euo pipefail
cd "$(dirname "$0")/.."

# Nothing ships if the copies of a shared page have drifted apart.
scripts/check-shared.sh || exit 1

# The Frame.io webhook is a public URL that writes to our notes, so its
# signature check is tested on every ship rather than when somebody
# remembers.
if [ -f apps/media-buyer-cockpit/scripts/frameio-webhook.test.ts ]; then
  (cd apps/media-buyer-cockpit && bun test scripts/frameio-webhook.test.ts >/dev/null 2>&1) \
    || { echo "the Frame.io webhook signature tests fail"; exit 1; }
fi

ship() {
  local app="$1" dir url
  case "$app" in
    media-buyer)     dir=apps/media-buyer-cockpit;       url=https://adorable-seahorse-418.convex.cloud ;;
    client-success)  dir=apps/client-success-cockpit;    url=https://impressive-dinosaur-375.convex.cloud ;;
    creative)        dir=apps/creative-director-cockpit; url=https://colorful-wombat-644.convex.cloud ;;
    # The fourth cockpit has no Convex: it reads Supabase straight from the
    # browser, so there is no backend to deploy, only a site.
    video-editor)    dir=apps/video-editor-cockpit;      url= ;;
    *) echo "unknown app: $app"; exit 2 ;;
  esac
  echo "== $app: lint"
  # The path is tested here, not inside the subshell, where it would be
  # resolved against the app directory instead of the repository root.
  local lint_dirs="src"
  [ -d "$dir/convex" ] && lint_dirs="convex src"
  # shellcheck disable=SC2086
  (cd "$dir" && bunx biome check $lint_dirs >/dev/null) || { echo "lint failed in $dir (run: cd $dir && bunx biome check --write $lint_dirs)"; exit 1; }
  echo "== $app: typecheck"
  (cd "$dir" && bun run typecheck)
  if [ -n "$url" ]; then
    echo "== $app: backend"
    (cd "$dir" && bunx convex deploy --yes --typecheck enable)
  fi
  echo "== $app: site"
  (cd "$dir" && VITE_CONVEX_URL="$url" bun run build)
  # The Vercel CLI prints JSON when not on a terminal and can exit 0 without a
  # production deployment (seen 2026-09-18: the creative site kept the old
  # bundle while the log showed one "}"), so the confirmation is checked, not
  # assumed.
  local out
  out=$(cd "$dir" && bunx vercel deploy --prod --yes 2>&1) || { echo "$out" | tail -20; echo "vercel deploy failed for $app"; exit 1; }
  echo "$out" | grep -E '"url"|readyState|target|Production|Aliased|rror' | head -8
  echo "$out" | grep -Eq '"readyState": *"READY"|Aliased +https|Production +https' || { echo "vercel did not confirm a production deployment for $app:"; echo "$out" | tail -20; exit 1; }
}

case "${1:-all}" in
  all) ship client-success; ship creative; ship media-buyer; ship video-editor ;;
  *)   ship "$1" ;;
esac

echo "== smoke check"
(cd apps/media-buyer-cockpit && bunx convex run --prod smoke:check | grep -E '"ok"|failures' | head -5)
echo "shipped."
