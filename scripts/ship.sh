#!/usr/bin/env bash
# Ship one cockpit (or all) the safe way: lint, typecheck, deploy the backend,
# build and deploy the site, then run the smoke check. Stops at the first
# failure so a broken build never replaces a working one.
#
#   scripts/ship.sh media-buyer | client-success | creative | video-editor | sales | all
#
# Order matters when a bridge payload gains a field: ship the receiving app
# (client-success, creative) before the media buyer that sends it. "all" does.
set -euo pipefail
cd "$(dirname "$0")/.."

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
  (cd hermes/team-sync && python3 -m unittest test_sync >/dev/null 2>&1) \
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
  (cd apps/media-buyer-cockpit && bun test scripts/webinar.test.ts scripts/webinar-targets.test.ts scripts/webinar-target-actions.test.ts scripts/webinar-ingestion.test.ts scripts/reporting-view-access.test.ts >/dev/null 2>&1) \
    || { echo "the webinar room tests fail"; exit 1; }
fi
node scripts/webinar-schedule.mjs check
node --test scripts/webinar-schedule.test.mjs >/dev/null \
  || { echo "the webinar schedule tests fail"; exit 1; }
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
    # The fifth is built the same way: Supabase from the browser, no Convex.
    sales)           dir=apps/sales-cockpit;             url=; SITE=https://cockpit.maharamedia.com/sales ;;
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
  [ -d "$dir/convex" ] && lint_dirs="convex src"
  # shellcheck disable=SC2086
  (cd "$dir" && bunx biome check --line-ending=auto $lint_dirs >/dev/null) || { echo "lint failed in $dir (run: cd $dir && bunx biome check --line-ending=auto --write $lint_dirs)"; exit 1; }
  echo "== $app: typecheck"
  (cd "$dir" && bun run typecheck)
  if [ "$app" = "sales" ]; then
    echo "== sales: tests"
    (cd "$dir" && bun test src)
  fi
  if [ -n "$url" ]; then
    echo "== $app: backend"
    # A deploy replaces every function in the deployment with this clone's,
    # so work another agent shipped from a branch would vanish with it
    # (2026-10-05: the check-in booking's functions and index). Stop and
    # name it instead; merge that work first, or SHIP_ALLOW_REMOVE=... when
    # the removal is meant.
    bun scripts/convex-removals.ts "$dir" || exit 1
    (cd "$dir" && bunx convex deploy --yes --typecheck enable)
  fi
  # What the site serves right now, so the check after the deploy compares
  # the page against itself rather than against a local build. Vercel builds
  # from the uploaded source with its own environment, so the entry chunk's
  # hash is legitimately different from the one built here and comparing the
  # two reported a stale deploy on every ship (2026-09-22).
  local was
  was=$(curl -fsS -m 20 -H 'Cache-Control: no-cache' "$SITE/?cb=$RANDOM" 2>/dev/null \
        | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
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
    out=$(cd "$dir" && "${vercel_cli[@]}" deploy --prod --yes --force ${tok[@]+"${tok[@]}"} 2>&1) || { echo "$out" | tail -20; echo "vercel deploy failed for $app"; exit 1; }
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
    for _ in 1 2 3 4 5 6; do
      if curl -fsS -m 30 "$SITE/assets/$live" 2>/dev/null | grep -q 'https://[a-z0-9]\{20\}\.supabase\.co'; then
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
  # Sales has no Convex backend; check its origin and portal route directly.
  curl -fsS -m 30 -o /dev/null https://mahara-sales.vercel.app/sales/
  curl -fsS -m 30 -o /dev/null https://cockpit.maharamedia.com/sales/
  echo "sales origin and portal route respond."
elif [ "${SHIP_SMOKE_READ_ONLY:-}" = 1 ]; then
  # A migration release must not send the failure alert to Slack without a
  # separately approved outward action. The local query checks the live page.
  (cd apps/media-buyer-cockpit && bunx convex run --prod smoke:local | grep -E '"ok"|failures' | head -5)
else
  (cd apps/media-buyer-cockpit && bunx convex run --prod smoke:check | grep -E '"ok"|failures' | head -5)
fi
echo "shipped."
