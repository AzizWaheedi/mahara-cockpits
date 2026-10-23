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
# import lines and compares everything below them, ignoring LF/CRLF differences.
set -uo pipefail
cd "$(dirname "$0")/.."

CD=apps/creative-director-cockpit
MB=apps/media-buyer-cockpit
ED=apps/video-editor-cockpit
SA=apps/sales-cockpit

fails=0

# Everything below the import block, which is the part that must match.
body() {
  awk '
    { sub(/\r$/, "") }
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

# What a client is told about their ads (no leads, no cost per lead, what we
# did in their words) reads the same from the media buyer and from the CSM.
same clientUpdate "$MB/src/lib/clientUpdate.ts" "apps/client-success-cockpit/src/lib/clientUpdate.ts"

# A lost lead's note shows what the agent typed, never the power dialer's
# system lines, the same way for the media buyer and for the CSM.
same lostNotes "$MB/convex/lostNotes.ts" "apps/client-success-cockpit/src/lib/lostNotes.ts"

# The Projections screen: the client success cockpit owns the data and its
# own tab, and the Sunday meeting's page in the media buyer shows the same
# parts. One set of words and shapes, one set of parts.
same projectionsView "apps/client-success-cockpit/src/lib/projectionsView.ts" "$MB/src/lib/projectionsView.ts"
same projectionsCore "apps/client-success-cockpit/src/lib/projectionsCore.ts" "$MB/src/lib/projectionsCore.ts"
same projectionsSchema "apps/client-success-cockpit/src/lib/projectionsSchema.ts" "$MB/src/lib/projectionsSchema.ts"
same projectionsModel "apps/client-success-cockpit/src/lib/projectionsModel.ts" "$MB/src/lib/projectionsModel.ts"
same ProjectionsKit "apps/client-success-cockpit/src/components/projections/ProjectionsKit.tsx" "$MB/src/components/projections/ProjectionsKit.tsx"

# A client's reporting period (what a pick means, what it holds, what it is
# compared with) is the same on the Client performance page and in the Google
# Doc report the media buyer backend writes from it.
same reportPeriod "apps/client-success-cockpit/src/lib/reportPeriod.ts" "$MB/src/lib/reportPeriod.ts"

# Search (Ctrl/Cmd + K, and the lists that filter by name) forgives the same
# way in every cockpit: Arabic letter forms folded, one typo allowed.
same search.ts "apps/client-success-cockpit/src/lib/search.ts" "$MB/src/lib/search.ts"
same search.ts "apps/client-success-cockpit/src/lib/search.ts" "$ED/src/lib/search.ts"
same search.ts "apps/client-success-cockpit/src/lib/search.ts" "$CD/src/lib/search.ts"
same search.ts "apps/client-success-cockpit/src/lib/search.ts" "$SA/src/lib/search.ts"

# Each cockpit's mark, its SOP link and the Clarity tag are the same file in
# all five apps.
for f in cockpits.ts clarity.ts; do
  for app in "$MB" "$CD" "$ED" "$SA"; do
    same "$f" "apps/client-success-cockpit/src/lib/$f" "$app/src/lib/$f"
  done
done

# The two Supabase cockpits' search box sits in the same dependency-free
# dialog: Escape, a click outside, focus kept inside and handed back.
same dialog.tsx "$ED/src/components/ui/dialog.tsx" "$SA/src/components/ui/dialog.tsx"

# The swipe file's backend is the same in the two Convex cockpits, bar the
# role each one checks.
same convex/foreplay.ts "$CD/convex/foreplay.ts" "$MB/convex/foreplay.ts"

# Client billing: one set of rules (what is late, what an extension does to
# a date, which ClickUp field is which) and one screen, in the CEO cockpit
# and the client success cockpit. The two differ only in how each app's
# actions are wired to the screen (ceo/BillingTab.tsx, pages/BillingPage.tsx).
CS=apps/client-success-cockpit

# The official KPI gates: $15 a lead, $60 a booking, the client show rate
# line and its aim. The client success cockpit judges on the same numbers
# (Aziz, 2026-10-13) and holds its own copy, since an app cannot import from
# another. Neither copy may import anything, so the whole file is compared:
# the cockpit-ceo-api and cockpit-csm-api Edge Functions bundle them.
same kpi.ts "$MB/src/lib/kpi.ts" "$CS/src/lib/kpi.ts"
for f in "$MB/src/lib/kpi.ts" "$CS/src/lib/kpi.ts"; do
  if [ -f "$f" ] && grep -qE '^(import |export .* from )' "$f"; then
    echo "IMPORTS  $f must stay import-free: two Edge Functions bundle it"
    fails=$((fails + 1))
  fi
done

# One client's call centre: the contract of cockpit_client_calls, the verdict
# ("is this a call centre issue or not?") and how its numbers read, the same
# for client success and the media buyer (Aziz, 2026-10-13). Byte for byte,
# imports included: it may import only zod and the gates in ./kpi.ts.
same callCentre.ts "$MB/src/lib/callCentre.ts" "$CS/src/lib/callCentre.ts"
if [ -f "$MB/src/lib/callCentre.ts" ] && [ -f "$CS/src/lib/callCentre.ts" ] \
  && ! cmp -s "$MB/src/lib/callCentre.ts" "$CS/src/lib/callCentre.ts"; then
  echo "DRIFTED  callCentre.ts imports: the two copies must be byte for byte"
  fails=$((fails + 1))
fi
for f in "$MB/src/lib/callCentre.ts" "$CS/src/lib/callCentre.ts"; do
  if [ -f "$f" ] && grep -oE "(from|import) +[\"'][^\"']+[\"']" "$f" \
    | grep -vE "[\"'](zod|\./kpi\.ts)[\"']$" >/dev/null; then
    echo "IMPORTS  $f may import only zod and ./kpi.ts"
    fails=$((fails + 1))
  fi
done

# Playing a call centre recording through cockpit-call-recording: the same
# file in both cockpits, with no imports.
same callRecording.ts "$MB/src/lib/callRecording.ts" "$CS/src/lib/callRecording.ts"
for f in "$MB/src/lib/callRecording.ts" "$CS/src/lib/callRecording.ts"; do
  if [ -f "$f" ] && grep -qE "^import " "$f"; then
    echo "IMPORTS  $f may import nothing"
    fails=$((fails + 1))
  fi
done

# The client decks (CSM decks, 2026-10-19) copy the sales deck's generic
# parts: the photo-book layout, the figure rules, the figure itself, the
# platform marks and their artwork. The pitch deck is not refactored, so the
# copies are pinned byte for byte, imports included; everything else in
# src/present is the client success cockpit's own.
for f in layout.ts figure.ts fig.tsx platforms.tsx; do
  same "deck $f" "$SA/src/deck/$f" "$CS/src/present/$f"
  if [ -f "$SA/src/deck/$f" ] && [ -f "$CS/src/present/$f" ] \
    && ! cmp -s "$SA/src/deck/$f" "$CS/src/present/$f"; then
    echo "DRIFTED  deck $f: the two copies must be byte for byte"
    fails=$((fails + 1))
  fi
done
for f in "$SA"/src/deck/assets/brands/*.webp; do
  b=$(basename "$f")
  if ! cmp -s "$f" "$CS/src/present/assets/brands/$b"; then
    echo "DRIFTED  deck brand mark $b: copy $f to $CS/src/present/assets/brands/"
    fails=$((fails + 1))
  fi
done
# The launch deck reuses only these pictures from the sales deck (CONTENT.md
# data map, DESIGN.md 16.1): the masked Mahara OS screens (Demo workspace).
# Byte for byte, so a re-masked screen reaches both.
for b in portal-overview-en portal-overview-ar portal-calls-en portal-calls-ar \
         portal-outcome-en portal-outcome-ar; do
  if ! cmp -s "$SA/src/deck/assets/$b.webp" "$CS/src/present/assets/portal/$b.webp"; then
    echo "DRIFTED  deck picture $b.webp: copy $SA/src/deck/assets/$b.webp to $CS/src/present/assets/portal/"
    fails=$((fails + 1))
  fi
done
# meeting-table.webp is no longer copied: the journey's "You meet" stop
# draws the meeting's two outcomes instead of a stock render (2026-10-20).

same askAiClient.ts "$MB/src/lib/askAiClient.ts" "$CS/src/lib/askAiClient.ts"
same askAiClient.ts "$MB/src/lib/askAiClient.ts" "$CD/src/lib/askAiClient.ts"
same personalEod.ts "$MB/src/lib/personalEod.ts" "$CS/src/lib/personalEod.ts"
same personalEod.ts "$MB/src/lib/personalEod.ts" "$CD/src/lib/personalEod.ts"
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

# Authorization is byte-identical, including imports and session configuration.
for app in apps/client-success-cockpit apps/creative-director-cockpit apps/video-editor-cockpit apps/sales-cockpit; do
  if ! cmp -s "$MB/src/auth/supabaseAccess.ts" "$app/src/auth/supabaseAccess.ts"; then
    echo "DRIFTED  supabaseAccess.ts: $app"
    fails=$((fails + 1))
  fi
done

# Client-reported appointment comments and ratings are identical in all three desks.
for f in src/lib/appointmentFeedback.ts src/components/AppointmentFeedback.tsx; do
  same "$f" "$MB/$f" "apps/client-success-cockpit/$f"
  same "$f" "$MB/$f" "$CD/$f"
done

# Pending payments in Billing (2026-10-23): the section, the rule that turns
# the read into parts and figures, and the sheet's own rule it leans on are
# the same in the CEO cockpit and the client success cockpit.
for f in src/components/billing/PendingPayments.tsx src/lib/billingBalances.ts src/lib/billingCore.ts; do
  same "$f" "$MB/$f" "$CS/$f"
done

if [ "$fails" -ne 0 ]; then
  echo
  echo "$fails shared file(s) have drifted. Copy the good one over the others:"
  echo "  cp $CD/<file> $MB/<file>   and   cp $CD/<file> $ED/<file>"
  exit 1
fi

echo "shared files are in step."
