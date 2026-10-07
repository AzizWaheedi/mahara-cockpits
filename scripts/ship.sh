#!/usr/bin/env bash
# Ship one native Supabase cockpit (or all): lint, typecheck, build and deploy
# the site, then verify release evidence. Native SQL and workers are released
# through the coordinated cutover procedure, never by deploying Convex.
#
#   scripts/ship.sh media-buyer | client-success | creative | video-editor | sales | all
#
# The coordinated cutover must prepare native schema and workers first.
set -euo pipefail
cd "$(dirname "$0")/.."

# Prefer installed Python over Windows' optional python3 Store alias.
py_bin="python"
command -v python >/dev/null 2>&1 || py_bin="python3"

# Nothing ships if the copies of a shared page have drifted apart.
scripts/check-shared.sh || exit 1
# The guard that keeps a backend deploy from removing someone else's
# functions (convex-removals.ts, below) is itself tested first.
bun test scripts/convex-removals.test.ts >/dev/null 2>&1 \
  || { echo "the deploy guard's tests fail (bun test scripts/convex-removals.test.ts)"; exit 1; }

# New-client onboarding stores location OAuth credentials alongside legacy
# private integration tokens. Both must stay visible to the cockpit feeds.
(cd apps/media-buyer-cockpit && bun test scripts/ghl-credential.test.ts >/dev/null 2>&1) \
  || { echo "the GHL credential compatibility tests fail"; exit 1; }

(cd apps/media-buyer-cockpit && bun test scripts/client-sheet-report.test.ts scripts/ceo-outcome-identity.test.ts scripts/creative-stat-isolation.test.ts >/dev/null 2>&1) \
  || { echo "the reporting identity and worksheet tests fail"; exit 1; }

(cd apps/creative-director-cockpit && bun test scripts/client-stat-retention.test.ts >/dev/null 2>&1) \
  || { echo "the creative statistics retention tests fail"; exit 1; }

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

# Billing: who is late, what a step on the ladder is, what an amount may be.
# Wrong either way is a client chased who paid, or a real payment refused.
if [ -f apps/media-buyer-cockpit/scripts/billing.test.ts ]; then
  (cd apps/media-buyer-cockpit && bun test scripts/billing.test.ts >/dev/null 2>&1) \
    || { echo "the billing rules tests fail"; exit 1; }
fi

# Team meetings: what a change does to a Google Calendar series, who hears
# about it, and what a spin writes. Wrong is a meeting moved on everyone's
# calendar, or an invite sent for a part changed quietly.
if [ -f apps/media-buyer-cockpit/scripts/team.test.ts ]; then
  (cd apps/media-buyer-cockpit && bun test scripts/team.test.ts >/dev/null 2>&1) \
    || { echo "the team meetings rules tests fail"; exit 1; }
fi
# The Projections rules (renewal window, the re-sell cap, the booked call's
# title, actuals that are never a stand-in zero).
if [ -f apps/client-success-cockpit/scripts/projections.test.ts ]; then
  (cd apps/client-success-cockpit && bun test scripts/projections.test.ts >/dev/null 2>&1) \
    || { echo "the projections rules tests fail"; exit 1; }
fi
if [ -f apps/client-success-cockpit/scripts/check-in.test.ts ]; then
  (cd apps/client-success-cockpit && bun test scripts/check-in.test.ts >/dev/null 2>&1) \
    || { echo "the client check-in booking tests fail"; exit 1; }
fi
if [ -f hermes/team-sync/test_sync.py ]; then
  (cd hermes/team-sync && "$py_bin" -m unittest test_sync >/dev/null 2>&1) \
    || { echo "the team calendar sync tests fail"; exit 1; }
fi

# Next month's plan: a cost per lead turns ad spend into leads and every
# count follows from the rates. Wrong is a plan whose targets do not add up.
if [ -f apps/media-buyer-cockpit/scripts/goals-model.test.ts ]; then
  (cd apps/media-buyer-cockpit && bun test scripts/goals-model.test.ts scripts/costs-model.test.ts >/dev/null 2>&1) \
    || { echo "the goals and costs model tests fail"; exit 1; }
fi
# The webinar room: attendance, the retention curve, the pitches. Wrong is a
# pitch that looks like it lost the room, or a show rate that counts the team.
if [ -f apps/media-buyer-cockpit/scripts/webinar.test.ts ]; then
  (cd apps/media-buyer-cockpit && bun test scripts/webinar.test.ts scripts/webinar-targets.test.ts scripts/webinar-supabase-targets.test.ts scripts/webinar-target-access.test.ts scripts/webinar-ingestion.test.ts scripts/reporting-view-access.test.ts >/dev/null 2>&1) \
    || { echo "the webinar room tests fail"; exit 1; }
fi

node scripts/webinar-schedule.mjs check
node --test scripts/webinar-schedule.test.mjs >/dev/null \
  || { echo "the webinar schedule tests fail"; exit 1; }
ship() {
  local app="$1"
  local SITE dir
  case "$app" in
    media-buyer)     dir=apps/media-buyer-cockpit;       SITE=https://cockpit.maharamedia.com ;;
    client-success)  dir=apps/client-success-cockpit;    SITE=https://cockpit.maharamedia.com/client-success ;;
    creative)        dir=apps/creative-director-cockpit; SITE=https://cockpit.maharamedia.com/creative ;;
    video-editor)    dir=apps/video-editor-cockpit;      SITE=https://cockpit.maharamedia.com/editor ;;
    sales)           dir=apps/sales-cockpit;             SITE=https://cockpit.maharamedia.com/sales ;;
    *) echo "unknown app: $app"; exit 2 ;;
  esac


  # The CLI upload stamps local HEAD and does not check GitHub. Refuse a
  # commit main does not have, a dirty app directory, or a production SHA
  # this clone cannot see (2026-09-22, cockpit.maharamedia.com on 7efca15f).
  echo "== $app: source is on GitHub main"
  scripts/require-github-main.sh "$dir" "$SITE"
  # So the Composio path, which ship calls only after this, does not fetch
  # and decide again. A direct run of that script still checks.
  export GITHUB_MAIN_OK=1
  echo "== $app: lint"
  # The path is tested here, not inside the subshell, where it would be
  # resolved against the app directory instead of the repository root.
  local lint_dirs="src"
  # shellcheck disable=SC2086
  (cd "$dir" && bunx biome check --line-ending=auto $lint_dirs >/dev/null) || { echo "lint failed in $dir (run: cd $dir && bunx biome check --line-ending=auto --write $lint_dirs)"; exit 1; }
  echo "== $app: typecheck"
  (cd "$dir" && bun run tsc --project tsconfig.app.json --noEmit && bun run tsc --project tsconfig.node.json --noEmit)
  if [ "$app" = "sales" ]; then
    echo "== sales: tests"
    (cd "$dir" && bun test src)
  fi
  echo "== $app: backend (native Supabase; schema and workers must already be verified)"
  # What the site serves right now, so the check after the deploy compares
  # the page against itself rather than against a local build. Vercel builds
  # from the uploaded source with its own environment, so the entry chunk's
  # hash is legitimately different from the one built here and comparing the
  # two reported a stale deploy on every ship (2026-09-22).
  local was
  was=$(curl -fsS -m 20 -H 'Cache-Control: no-cache' "$SITE/?cb=$RANDOM" 2>/dev/null \
        | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
  echo "== $app: site"
  local -a sup_env=()
  [ -n "${VITE_SUPABASE_URL:-}" ] && sup_env+=(VITE_SUPABASE_URL="$VITE_SUPABASE_URL")
  [ -n "${VITE_SUPABASE_ANON_KEY:-}" ] && sup_env+=(VITE_SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY")
  (cd "$dir" && env VITE_CONVEX_URL="" ${sup_env[@]+"${sup_env[@]}"} bun run build)
  # Remote Vercel builds need the same public native configuration as the
  # local build. Never pass a service-role key through VITE_* variables.
  local -a build_env=(--build-env VITE_CONVEX_URL=)
  local setting
  for setting in ${sup_env[@]+"${sup_env[@]}"}; do
    build_env+=(--build-env "$setting")
  done
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
  # VERCEL_TOKEN=... in the environment uses the CLI without a login (the
  # durable token lives on the hermes VPS; never paste it in chat or a file).
  # (the ${tok[@]+...} form: an empty array is "unbound" to the bash 3.2 that
  # macOS ships, and set -u would stop the ship here)
  local -a tok=()
  [ -n "${VERCEL_TOKEN:-}" ] && tok=(--token "$VERCEL_TOKEN")
  # An installed Vercel CLI may be signed in while bunx downloads a newer,
  # logged-out copy. Use the installed CLI first; bunx remains the fallback.
  local -a vercel_cli=(bunx vercel)
  command -v vercel >/dev/null 2>&1 && vercel_cli=(vercel)
  if (cd "$dir" && "${vercel_cli[@]}" whoami ${tok[@]+"${tok[@]}"} >/dev/null 2>&1); then
    # Without the app's link the CLI makes a new project named after the
    # folder and deploys there; the site keeps the old bundle (2026-10-05, a
    # fresh worktree made client-success-cockpit beside mahara-client-success).
    # The Composio path refuses the same way.
    [ -f "$dir/.vercel/project.json" ] || { echo "$dir is not linked to a Vercel project (.vercel/project.json missing): copy it from a linked checkout"; exit 1; }
    # An archived upload avoids the per-file fetch failures observed during
    # the native branch preview run. It does not change the deployment target.
    out=$(cd "$dir" && "${vercel_cli[@]}" deploy --prod --yes --force --archive tgz ${build_env[@]+"${build_env[@]}"} ${tok[@]+"${tok[@]}"} 2>&1) || { echo "$out" | tail -20; echo "vercel deploy failed for $app"; exit 1; }
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
  # Read the live page a few times before believing it. Checked straight
  # after a deploy it returns the previous bundle from the CDN, which
  # once made a perfectly good deploy look stale (2026-09-20).
  local live
  live=""
  for _ in 1 2 3 4 5 6; do
    live=$(curl -fsS -m 30 -H 'Cache-Control: no-cache' "$SITE/?cb=$RANDOM" 2>/dev/null \
           | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
    [ -n "$live" ] && [ "$live" != "$was" ] && break
    sleep 5
  done
  if [ -z "$live" ]; then
    echo "  could not read $SITE to confirm the bundle"
  elif [ -z "$was" ]; then
    echo "  live bundle: $live (nothing to compare it with)"
  elif [ "$live" = "$was" ]; then
    # Only a warning: a deploy that changes the backend alone, or a rebuild
    # of identical source, legitimately leaves the same bundle in place.
    echo "  live bundle unchanged: $live — check that the change was in the site"
  else
    echo "  live bundle: $live (was $was)"
  fi

  # A Supabase-only app opens on a blank page without its project address
  # in the bundle, and nothing above notices (2026-09-24: the sales app
  # went out with Vercel ciphertext in both variables). Read the bundle.
  # Read it a few times: straight after a deploy the page can name the new
  # bundle a few seconds before the proxy serves it (seen 2026-09-24).
  if [ -n "$live" ] && grep -q '^VITE_SUPABASE_URL=' "$dir/.env.example" 2>/dev/null; then
    local carries=""
    # Read the whole response: grep -q closes early and makes curl fail
    # with a broken pipe under pipefail even when the native URL is present.
    for _ in 1 2 3 4 5 6; do
      if curl -fsS -m 30 "$SITE/assets/$live" 2>/dev/null | grep 'https://[a-z0-9]\{20\}\.supabase\.co' >/dev/null; then
        carries=1
        break
      fi
      sleep 5
    done
    if [ -n "$carries" ]; then
      echo "  the live bundle carries its Supabase address"
    else
      echo "the live bundle for $app has no Supabase address, so the page opens blank: check VITE_SUPABASE_URL on its Vercel project"
      exit 1
    fi
  fi
}

case "${1:-all}" in
  all) ship client-success; ship creative; ship media-buyer; ship video-editor; ship sales ;;
  *)   ship "$1" ;;
esac

echo "== smoke check"
if [ "${1:-all}" = "sales" ]; then
  curl -fsS -m 30 -o /dev/null https://mahara-sales.vercel.app/sales/
  curl -fsS -m 30 -o /dev/null https://cockpit.maharamedia.com/sales/
  echo "sales origin and portal route respond."
fi
"$py_bin" scripts/verify-cutover-readiness.py
echo "shipped."
