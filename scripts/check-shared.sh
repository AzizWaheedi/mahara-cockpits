#!/usr/bin/env bash
# The files that must stay the same in more than one cockpit.
#
# Four apps, no shared package: the ideation board, the swipe file and the
# Foreplay helpers are the same code copied into each one. Copying is fine
# -- it is how these apps have always shared -- but nothing stops a change
# landing in one copy and not the others, and then the cockpits drift apart
# again. This is what stops it. ship.sh runs it before anything is built.
#
# Two copies may differ only in their imports, because the Convex cockpits
# reach Supabase through an action holding the service key and the editor
# talks to PostgREST with the editor's own session. So the comparison drops
# import lines and compares everything below them.
set -uo pipefail
cd "$(dirname "$0")/.."

CD=apps/creative-director-cockpit
MB=apps/media-buyer-cockpit
ED=apps/video-editor-cockpit

fails=0

# Everything below the import block, which is the part that must match.
body() {
  awk '
    !started && (/^import / || /^} from / || /^  [A-Za-z{}]/ && importing) { importing = 1; next }
    /^$/ && importing { next }
    { started = 1; print }
  ' "$1"
}

same() {
  local what="$1" a="$2" b="$3"
  if [ ! -f "$a" ] || [ ! -f "$b" ]; then
    echo "MISSING  $what: $a or $b does not exist"; fails=$((fails + 1)); return
  fi
  if ! diff -q <(body "$a") <(body "$b") >/dev/null; then
    echo "DRIFTED  $what"
    echo "         $a"
    echo "         $b"
    diff <(body "$a") <(body "$b") | head -20 | sed 's/^/         /'
    fails=$((fails + 1))
  fi
}

# The two pages and the Foreplay helpers: the same in all three.
for f in src/pages/IdeationPage.tsx src/pages/SwipePage.tsx \
         src/components/Foreplay.tsx src/lib/foreplay.ts; do
  same "$f" "$CD/$f" "$MB/$f"
  same "$f" "$CD/$f" "$ED/$f"
done

# One ad becomes one ideation row the same way everywhere, or a press of
# "Send to ideation" and the next sync overwrite each other.
same adAsIdea "$CD/convex/adAsIdea.ts" "$MB/convex/adAsIdea.ts"
same adAsIdea "$CD/convex/adAsIdea.ts" "$ED/src/lib/adAsIdea.ts"

# The swipe file's backend is the same in the two Convex cockpits, bar the
# role each one checks.
same convex/foreplay.ts "$CD/convex/foreplay.ts" "$MB/convex/foreplay.ts"

# Client billing: one set of rules (what is late, what an extension does to
# a date, which ClickUp field is which) and one screen, in the CEO cockpit
# and the client success cockpit. The two differ only in how each app's
# actions are wired to the screen (ceo/BillingTab.tsx, pages/BillingPage.tsx).
CS=apps/client-success-cockpit
same convex/billingCore.ts "$MB/convex/billingCore.ts" "$CS/convex/billingCore.ts"
same BillingSheet.tsx "$MB/src/components/billing/BillingSheet.tsx" \
  "$CS/src/components/billing/BillingSheet.tsx"

# The Python worker writes that same row. Its field list is pinned by a test
# (IdeaRowShapeTests); this checks the list the test pins is the list the
# TypeScript pins, which is the half a Python test cannot see.
py=$(grep -A6 '#: Kept identical to IDEA_FIELDS' hermes/editor-desk/tests/test_desk.py \
     | grep -o '"[a-z_]*"' | tr -d '"' | sort | tr '\n' ' ')
ts=$(sed -n '/^export const IDEA_FIELDS/,/] as const/p' "$CD/convex/adAsIdea.ts" \
     | grep -o '"[a-z_]*"' | tr -d '"' | sort | tr '\n' ' ')
if [ "$py" != "$ts" ]; then
  echo "DRIFTED  the ideation row's fields"
  echo "         python: $py"
  echo "         typescript: $ts"
  fails=$((fails + 1))
fi

# One formatter, or two versions reformat the shared pages differently and
# pull the copies apart on the next write.
pins=$(grep -h '"@biomejs/biome"' apps/*/package.json | sed 's/.*: *"//;s/".*//' | sort -u)
if [ "$(echo "$pins" | wc -l)" -ne 1 ] || echo "$pins" | grep -q '[\^~]'; then
  echo "DRIFTED  @biomejs/biome is not pinned to one exact version across the apps:"
  echo "$pins" | sed 's/^/         /'
  fails=$((fails + 1))
fi

if [ "$fails" -ne 0 ]; then
  echo
  echo "$fails shared file(s) have drifted. Copy the good one over the others:"
  echo "  cp $CD/<file> $MB/<file>   and   cp $CD/<file> $ED/<file>"
  exit 1
fi

echo "shared files are in step."
