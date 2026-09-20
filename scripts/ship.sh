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

# What GHL's statuses mean and when posts go out: wrong either way is a
# client's month published at the wrong time or marked live when it is not.
if [ -f apps/creative-director-cockpit/scripts/social.test.ts ]; then
  (cd apps/creative-director-cockpit && bun test scripts/social.test.ts >/dev/null 2>&1) \
    || { echo "the social planner tests fail"; exit 1; }
fi

ship() {
  local app="$1"
  local SITE dir url
  case "$app" in
    media-buyer)     dir=apps/media-buyer-cockpit;       url=https://adorable-seahorse-418.convex.cloud; SITE=https://cockpit.maharamedia.com ;;
    client-success)  dir=apps/client-success-cockpit;    url=https://impressive-dinosaur-375.convex.cloud; SITE=https://cockpit.maharamedia.com/client-success ;;
    creative)        dir=apps/creative-director-cockpit; url=https://colorful-wombat-644.convex.cloud; SITE=https://cockpit.maharamedia.com/creative ;;
    # The fourth cockpit has no Convex: it reads Supabase straight from the
    # browser, so there is no backend to deploy, only a site.
    video-editor)    dir=apps/video-editor-cockpit;      url=; SITE=https://cockpit.maharamedia.com/editor ;;
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
  # --force skips Vercel's build cache. Without it (2026-09-20) a deploy
  # reported "Production ... Ready", promote said 409 already-production,
  # and the alias still served the previous bundle -- Vercel had restored
  # the old build output from cache, so the deployment was genuinely stale
  # rather than merely mis-aliased.
  if (cd "$dir" && bunx vercel whoami >/dev/null 2>&1); then
    out=$(cd "$dir" && bunx vercel deploy --prod --yes --force 2>&1) || { echo "$out" | tail -20; echo "vercel deploy failed for $app"; exit 1; }
  else
    # No Vercel login on this Mac (2026-09-20): the same source goes up
    # through Composio's Vercel connection instead. `bunx vercel login`
    # in the app folder brings the CLI path back.
    echo "  no Vercel CLI login; deploying through Composio"
    out=$(scripts/vercel-deploy-composio.sh "$dir" 2>&1) || { echo "$out" | tail -20; echo "vercel deploy through composio failed for $app"; exit 1; }
  fi
  echo "$out" | grep -E '"url"|readyState|target|Production|Aliased|rror' | head -8
  echo "$out" | grep -Eq '"readyState": *"READY"|Aliased +https|Production +https|"status": *"ok"' || { echo "vercel did not confirm a production deployment for $app:"; echo "$out" | tail -20; exit 1; }

  # And then check the site, because every signal above can say yes while
  # the bundle people load is last week's.
  local want live
  want=$(basename "$(ls -t "$dir"/dist/assets/index-*.js 2>/dev/null | head -1)" 2>/dev/null)
  live=$(curl -fsS -m 30 "$SITE/?cb=$RANDOM" 2>/dev/null | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
  if [ -n "$live" ]; then
    echo "  live bundle: $live (built locally: ${want:-unknown})"
  else
    echo "  could not read $SITE to confirm the bundle"
  fi
}

case "${1:-all}" in
  all) ship client-success; ship creative; ship media-buyer; ship video-editor ;;
  *)   ship "$1" ;;
esac

echo "== smoke check"
(cd apps/media-buyer-cockpit && bunx convex run --prod smoke:check | grep -E '"ok"|failures' | head -5)
echo "shipped."
