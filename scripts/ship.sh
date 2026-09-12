#!/usr/bin/env bash
# Ship one cockpit (or all) the safe way: lint, typecheck, deploy the backend,
# build and deploy the site, then run the smoke check. Stops at the first
# failure so a broken build never replaces a working one.
#
#   scripts/ship.sh media-buyer | client-success | creative | all
#
# Order matters when a bridge payload gains a field: ship the receiving app
# (client-success, creative) before the media buyer that sends it. "all" does.
set -euo pipefail
cd "$(dirname "$0")/.."

ship() {
  local app="$1" dir url
  case "$app" in
    media-buyer)     dir=apps/media-buyer-cockpit;       url=https://adorable-seahorse-418.convex.cloud ;;
    client-success)  dir=apps/client-success-cockpit;    url=https://impressive-dinosaur-375.convex.cloud ;;
    creative)        dir=apps/creative-director-cockpit; url=https://colorful-wombat-644.convex.cloud ;;
    *) echo "unknown app: $app"; exit 2 ;;
  esac
  echo "== $app: lint"
  (cd "$dir" && bunx biome check convex src >/dev/null) || { echo "lint failed in $dir (run: cd $dir && bunx biome check --write convex src)"; exit 1; }
  echo "== $app: typecheck"
  (cd "$dir" && bun run typecheck)
  echo "== $app: backend"
  (cd "$dir" && bunx convex deploy --yes --typecheck enable)
  echo "== $app: site"
  (cd "$dir" && VITE_CONVEX_URL="$url" bun run build && bunx vercel deploy --prod --yes | tail -1)
}

case "${1:-all}" in
  all) ship client-success; ship creative; ship media-buyer ;;
  *)   ship "$1" ;;
esac

echo "== smoke check"
(cd apps/media-buyer-cockpit && bunx convex run --prod smoke:check | grep -E '"ok"|failures' | head -5)
echo "shipped."
