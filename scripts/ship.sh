#!/usr/bin/env bash
# Ship one native Supabase cockpit (or all): lint, typecheck, build and deploy
# the site after the readiness checks pass. Native SQL and workers are released
# through the coordinated cutover procedure, never by deploying Convex.
#
#   scripts/ship.sh media-buyer | client-success | creative | video-editor | sales | all
#
# The coordinated cutover must prepare native schema and workers first.
# On Windows a person runs scripts/ship.ps1 <app>, which loads the token and
# build values. A fresh worktree first needs scripts/prepare-worktree.sh --apply.
set -euo pipefail
cd "$(dirname "$0")/.."

# Prefer installed Python over Windows' optional python3 Store alias.
py_bin="python"
command -v python >/dev/null 2>&1 || py_bin="python3"

# Everything this script needs, checked in seconds and listed at once before
# minutes of tests (2026-10-11: a fresh worktree failed five runs in a row,
# one missing piece at a time).
scripts/ship-preflight.sh "${1:-all}" || exit 1

# Authentication is shared by all five apps. Check live settings before publishing.
"$py_bin" -m unittest discover -s scripts -p test_check_cockpit_auth_config.py
"$py_bin" -m unittest discover -s scripts -p test_vercel_project_guard.py
"$py_bin" -m unittest discover -s scripts -p test_ship_preflight.py
(cd apps/media-buyer-cockpit && bun test scripts/cockpit-auth-flow.test.ts scripts/cockpit-auth-sql.test.ts)
(cd apps/media-buyer-cockpit && bun test scripts/cockpit-rpc-restore.test.ts scripts/creative-check.test.ts)
(cd apps/media-buyer-cockpit && bun test scripts/cockpit-auth-sdk.test.ts)
(cd apps/client-success-cockpit && bun test scripts/auth-password-ui.test.tsx)
"$py_bin" scripts/check-cockpit-auth-config.py

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
# The client decks: the engine's keys and stops (Esc never leaves the
# deck), the copy rules and banned pictures, every fallback and slide,
# prep's saves against the migration's own key list, the launch deck's
# order and stops, the example call's script, and adding files on the call.
# Every deck-*.test file runs (the visual pass added the Drive box, the
# example ads, the motion, the tray and the video slots' tests).
if [ -f apps/client-success-cockpit/scripts/deck-engine.test.ts ]; then
  (cd apps/client-success-cockpit && bun test scripts/deck-*.test.ts scripts/deck-*.test.tsx >/dev/null 2>&1) \
    || { echo "the client deck tests fail (cd apps/client-success-cockpit && bun test scripts/deck-)"; exit 1; }
fi
# Slack notices and the Blueprint drain (docs/forms/STAGE1-CONTRACT.md): the outbox's
# states and triggers, the sender's text and receipts, the drain's refusals. Wrong is a
# kickoff nobody hears about, a notice posted twice, or a press that never runs.
if [ -f apps/media-buyer-cockpit/scripts/slack-notices-supabase.test.ts ]; then
  # These suites set the same bounded limits for direct and readiness runs.
  (cd apps/media-buyer-cockpit && bun test scripts/slack-notices-supabase.test.ts scripts/blueprints-supabase.test.ts scripts/stage1-fit-supabase.test.ts >/dev/null 2>&1) \
    || { echo "the Slack notices or Brand Blueprint database tests fail (cd apps/media-buyer-cockpit && bun test scripts/slack-notices-supabase.test.ts scripts/blueprints-supabase.test.ts scripts/stage1-fit-supabase.test.ts)"; exit 1; }
  (bun test supabase/functions/cockpit-notices supabase/functions/cockpit-creative-api supabase/functions/cockpit-media-api/slack.test.ts supabase/functions/cockpit-media-api/workflows.test.ts >/dev/null 2>&1) \
    || { echo "the notices sender, Blueprint drain or Slack receipt tests fail"; exit 1; }
  (cd apps/client-success-cockpit && bun test scripts/form-status.test.ts scripts/form-panel.test.tsx scripts/notices-routing.test.tsx scripts/blueprint-csm-line.test.ts >/dev/null 2>&1) \
    || { echo "the kickoff trail or notices settings tests fail"; exit 1; }
  (cd apps/creative-director-cockpit && bun test scripts/blueprint.test.tsx scripts/blueprint-notices.test.tsx >/dev/null 2>&1) \
    || { echo "the creative director's Blueprint card tests fail"; exit 1; }
fi
# Requests and task alerts (docs/requests/CONTRACT.md): the request types and their
# routing, the writer's queue rows, the task mirror and its alerts, the screens. Wrong is
# a ticket that lands on the wrong team or nowhere, a task alert nobody gets, or one
# that floods a bell.
if [ -f apps/media-buyer-cockpit/scripts/requests-supabase.test.ts ]; then
  (cd apps/media-buyer-cockpit && bun test scripts/requests-supabase.test.ts scripts/request-types-seed.test.ts scripts/request-routes-supabase.test.ts scripts/task-alerts-supabase.test.ts scripts/requests-fit-supabase.test.ts scripts/tasks-core.test.ts scripts/your-tasks.test.tsx scripts/requests-core.test.ts scripts/request-form.test.tsx scripts/requests-page.test.tsx scripts/requests-settings.test.tsx scripts/request-held-gate-supabase.test.ts scripts/clickup-cron-spread-supabase.test.ts >/dev/null 2>&1) \
    || { echo "the requests or task alerts tests fail (cd apps/media-buyer-cockpit && bun test scripts/requests-supabase.test.ts scripts/request-types-seed.test.ts scripts/request-routes-supabase.test.ts scripts/task-alerts-supabase.test.ts scripts/requests-fit-supabase.test.ts scripts/tasks-core.test.ts scripts/your-tasks.test.tsx scripts/requests-core.test.ts scripts/request-form.test.tsx scripts/requests-page.test.tsx scripts/requests-settings.test.tsx scripts/request-held-gate-supabase.test.ts scripts/clickup-cron-spread-supabase.test.ts)"; exit 1; }
  (bun test supabase/functions/clickup-writeback supabase/functions/cockpit-tasks supabase/functions/comment-watch/watch.test.ts supabase/functions/_shared/clickupRetry.test.ts supabase/functions/cockpit-media-api/tools.test.ts supabase/functions/cockpit-csm-api/tools.test.ts supabase/functions/cockpit-ceo-api/tools.test.ts supabase/functions/onboarding-sync >/dev/null 2>&1) \
    || { echo "the requests writer, task mirror, comment watch or ClickUp pacing function tests fail (bun test supabase/functions/clickup-writeback supabase/functions/cockpit-tasks supabase/functions/comment-watch/watch.test.ts supabase/functions/_shared/clickupRetry.test.ts supabase/functions/cockpit-media-api/tools.test.ts supabase/functions/cockpit-csm-api/tools.test.ts supabase/functions/cockpit-ceo-api/tools.test.ts supabase/functions/onboarding-sync)"; exit 1; }
  # ClickUp Business (docs/requests/CLICKUP-DOWNGRADE.md): no link to the old ticket form, and the
  # guardian's calls-a-minute check for the token the cockpit shares with the VPS workers.
  (cd apps/creative-director-cockpit && bun test scripts/key-links.test.ts >/dev/null 2>&1) \
    || { echo "the creative director's key links tests fail (cd apps/creative-director-cockpit && bun test scripts/key-links.test.ts)"; exit 1; }
  (cd hermes/cockpit-guardian && "$py_bin" -m unittest tests.test_clickup_budget >/dev/null 2>&1) \
    || { echo "the guardian's ClickUp budget check tests fail (cd hermes/cockpit-guardian && python3 -m unittest tests.test_clickup_budget)"; exit 1; }
fi
# The 1-1 notes in the cockpit (docs/forms/STAGE2-CONTRACT.md): the forms backend, the Fathom
# intake, the shadow planner, the matcher, the drafts and the window. Wrong is notes on the wrong
# call or card, a second record of one call, or a shadow run that reaches a card.
if [ -f apps/media-buyer-cockpit/scripts/forms-core-supabase.test.ts ]; then
  (cd apps/media-buyer-cockpit && bun test scripts/forms-core-supabase.test.ts scripts/fathom-intake-supabase.test.ts scripts/checkin-plans-supabase.test.ts scripts/checkin-replay.test.ts scripts/forms-connections.test.tsx >/dev/null 2>&1) \
    || { echo "the 1-1 notes database or replay tests fail (cd apps/media-buyer-cockpit && bun test scripts/forms-core-supabase.test.ts scripts/fathom-intake-supabase.test.ts scripts/checkin-plans-supabase.test.ts scripts/checkin-replay.test.ts scripts/forms-connections.test.tsx)"; exit 1; }
  (bun test hermes/csm-calls/callMatch.test.ts hermes/csm-calls/fathomRules.test.ts hermes/csm-calls/lib.test.ts hermes/csm-calls/sources.test.ts hermes/csm-calls/match.test.ts hermes/csm-calls/rollback.test.ts supabase/functions/cockpit-forms-api/door.test.ts supabase/functions/cockpit-forms-api/calls.test.ts supabase/functions/cockpit-forms-api/drafts.test.ts supabase/functions/cockpit-forms-api/prompts.test.ts supabase/functions/cockpit-forms-api/recapRules.test.ts supabase/functions/cockpit-forms-api/transcript.test.ts supabase/functions/cockpit-forms-api/doctor.test.ts supabase/functions/cockpit-forms-api/typeform.test.ts supabase/functions/fathom-webhook/verify.test.ts supabase/functions/fathom-webhook/handler.test.ts supabase/functions/cockpit-media-api/model.test.ts >/dev/null 2>&1) \
    || { echo "the 1-1 notes intake, matcher or drafts tests fail (bun test hermes/csm-calls/callMatch.test.ts hermes/csm-calls/fathomRules.test.ts hermes/csm-calls/lib.test.ts hermes/csm-calls/sources.test.ts hermes/csm-calls/match.test.ts hermes/csm-calls/rollback.test.ts supabase/functions/cockpit-forms-api/door.test.ts supabase/functions/cockpit-forms-api/calls.test.ts supabase/functions/cockpit-forms-api/drafts.test.ts supabase/functions/cockpit-forms-api/prompts.test.ts supabase/functions/cockpit-forms-api/recapRules.test.ts supabase/functions/cockpit-forms-api/transcript.test.ts supabase/functions/cockpit-forms-api/doctor.test.ts supabase/functions/cockpit-forms-api/typeform.test.ts supabase/functions/fathom-webhook/verify.test.ts supabase/functions/fathom-webhook/handler.test.ts supabase/functions/cockpit-media-api/model.test.ts)"; exit 1; }
  (cd apps/client-success-cockpit && bun test scripts/checkin-form.test.ts scripts/field-saver.test.ts scripts/checkin-trail.test.ts scripts/checkin-window.test.tsx scripts/after-calls.test.tsx scripts/forms-button.test.tsx scripts/client-calls.test.tsx >/dev/null 2>&1) \
    || { echo "the 1-1 notes window tests fail (cd apps/client-success-cockpit && bun test scripts/checkin-form.test.ts scripts/field-saver.test.ts scripts/checkin-trail.test.ts scripts/checkin-window.test.tsx scripts/after-calls.test.tsx scripts/forms-button.test.tsx scripts/client-calls.test.tsx)"; exit 1; }
fi
# The 1-1 notes cut-over machinery, built and deployed dark (docs/forms/STAGE2B-CONTRACT.md section 8):
# the registry and owner gate, the effect dispatch, the ClickUp forms job, the check-in notices, the
# WhatsApp recap sender, kickoff records, late Typeform forms, moving a recording, the brief's short
# to-dos and They owe. Wrong is a client message or card write before the switch-over, a delivery
# sent twice, or notes lost on submit. The live replay, the guardian's and the Python unit tests and
# stage2b-ownership.test.ts run outside this script (section 8).
if [ -f apps/media-buyer-cockpit/scripts/forms-dispatch-supabase.test.ts ]; then
  # bun passes a run whose named file is missing, so every 2b test file is checked first: missing is never zero.
  for suite in apps/media-buyer-cockpit/scripts/forms-registry-supabase.test.ts apps/media-buyer-cockpit/scripts/forms-dispatch-supabase.test.ts apps/media-buyer-cockpit/scripts/late-typeform-supabase.test.ts apps/media-buyer-cockpit/scripts/forms-record-supabase.test.ts apps/media-buyer-cockpit/scripts/forms-move-supabase.test.ts apps/media-buyer-cockpit/scripts/forms-writeback-supabase.test.ts apps/media-buyer-cockpit/scripts/checkin-notices-supabase.test.ts apps/media-buyer-cockpit/scripts/client-messages-supabase.test.ts apps/media-buyer-cockpit/scripts/stage2b-fit-supabase.test.ts supabase/functions/clickup-writeback/forms.test.ts supabase/functions/cockpit-forms-api/effects.test.ts supabase/functions/cockpit-forms-api/messages.test.ts hermes/client-messages/core.test.ts hermes/client-messages/whapi.test.ts hermes/client-messages/ledger.test.ts hermes/client-messages/oldSenders.test.ts hermes/client-messages/worker.test.ts hermes/client-messages/g5.test.ts supabase/functions/forms-door/handler.test.ts apps/client-success-cockpit/scripts/client-messages.test.tsx apps/client-success-cockpit/scripts/design-tokens.test.ts; do
    [ -f "$suite" ] || { echo "the 1-1 notes test file $suite is missing (docs/forms/STAGE2B-CONTRACT.md section 8)"; exit 1; }
  done
  (cd apps/media-buyer-cockpit && bun test scripts/forms-registry-supabase.test.ts scripts/forms-dispatch-supabase.test.ts scripts/late-typeform-supabase.test.ts scripts/forms-record-supabase.test.ts scripts/forms-move-supabase.test.ts >/dev/null 2>&1) \
    || { echo "the 1-1 notes registry, dispatch, late form, record or move database tests fail (cd apps/media-buyer-cockpit && bun test scripts/forms-registry-supabase.test.ts scripts/forms-dispatch-supabase.test.ts scripts/late-typeform-supabase.test.ts scripts/forms-record-supabase.test.ts scripts/forms-move-supabase.test.ts)"; exit 1; }
  (cd apps/media-buyer-cockpit && bun test scripts/forms-core-supabase.test.ts scripts/fathom-intake-supabase.test.ts scripts/stage2a-writers.test.ts >/dev/null 2>&1) \
    || { echo "the Stage 2a forms database or writers tests fail after 2b (cd apps/media-buyer-cockpit && bun test scripts/forms-core-supabase.test.ts scripts/fathom-intake-supabase.test.ts scripts/stage2a-writers.test.ts)"; exit 1; }
  # requests-supabase.test.ts and supabase/functions/clickup-writeback, the rest of section 8's writers line, run once, in the requests block above.
  (cd apps/media-buyer-cockpit && bun test scripts/forms-writeback-supabase.test.ts >/dev/null 2>&1) \
    || { echo "the ClickUp forms writer database tests fail (cd apps/media-buyer-cockpit && bun test scripts/forms-writeback-supabase.test.ts)"; exit 1; }
  (bun test supabase/functions/cockpit-forms-api/door.test.ts supabase/functions/cockpit-forms-api/effects.test.ts supabase/functions/cockpit-forms-api/messages.test.ts supabase/functions/cockpit-forms-api/recapRules.test.ts supabase/functions/cockpit-forms-api/calls.test.ts supabase/functions/cockpit-forms-api/doctor.test.ts supabase/functions/cockpit-forms-api/prompts.test.ts supabase/functions/cockpit-forms-api/transcript.test.ts supabase/functions/cockpit-forms-api/typeform.test.ts >/dev/null 2>&1) \
    || { echo "the 1-1 notes door, effects, messages or recap rules tests fail (bun test supabase/functions/cockpit-forms-api/door.test.ts supabase/functions/cockpit-forms-api/effects.test.ts supabase/functions/cockpit-forms-api/messages.test.ts supabase/functions/cockpit-forms-api/recapRules.test.ts supabase/functions/cockpit-forms-api/calls.test.ts supabase/functions/cockpit-forms-api/doctor.test.ts supabase/functions/cockpit-forms-api/prompts.test.ts supabase/functions/cockpit-forms-api/transcript.test.ts supabase/functions/cockpit-forms-api/typeform.test.ts)"; exit 1; }
  (bun test supabase/functions/cockpit-forms-api/drafts.test.ts >/dev/null 2>&1) \
    || { echo "the 1-1 notes drafts and They owe tests fail (bun test supabase/functions/cockpit-forms-api/drafts.test.ts)"; exit 1; }
  (bun test supabase/functions/cockpit-csm-api/projections.test.ts >/dev/null 2>&1) \
    || { echo "the Log a call date tests fail (bun test supabase/functions/cockpit-csm-api/projections.test.ts)"; exit 1; }
  (cd apps/client-success-cockpit && bun test scripts/csm-act-route.test.ts scripts/check-in.test.ts scripts/csm-read-model.test.ts >/dev/null 2>&1) \
    || { echo "the CSM act, check-in or read model tests fail (cd apps/client-success-cockpit && bun test scripts/csm-act-route.test.ts scripts/check-in.test.ts scripts/csm-read-model.test.ts)"; exit 1; }
  (bun test supabase/functions/cockpit-board-api >/dev/null 2>&1) \
    || { echo "the board API tests fail after the cockpit-csm-api change (bun test supabase/functions/cockpit-board-api)"; exit 1; }
  for fn in clickup-writeback cockpit-forms-api cockpit-csm-api; do
    extras=$("$py_bin" scripts/dev/fn_extras.py . "$fn") \
      || { echo "the import list of $fn cannot be read ($py_bin scripts/dev/fn_extras.py . $fn)"; exit 1; }
    for extra in $extras; do
      [ -f "$extra" ] || { echo "$fn imports $extra, which does not exist ($py_bin scripts/dev/fn_extras.py . $fn)"; exit 1; }
    done
  done
  extras=$("$py_bin" scripts/dev/fn_extras.py . forms-door) \
    || { echo "the import list of forms-door cannot be read ($py_bin scripts/dev/fn_extras.py . forms-door)"; exit 1; }
  [ "$extras" = "hermes/csm-calls/callMatch.ts hermes/csm-calls/match.ts supabase/functions/_shared/clickupRetry.ts supabase/functions/cockpit-ceo-api/tools.ts supabase/functions/cockpit-hours-sync/db.ts supabase/functions/team-onboarding-intake/signature.ts" ] \
    || { echo "forms-door imports other files than its six extras ($py_bin scripts/dev/fn_extras.py . forms-door)"; exit 1; }
  (cd apps/media-buyer-cockpit && bun test scripts/checkin-notices-supabase.test.ts scripts/client-messages-supabase.test.ts scripts/slack-notices-supabase.test.ts >/dev/null 2>&1) \
    || { echo "the check-in notices or client messages database tests fail (cd apps/media-buyer-cockpit && bun test scripts/checkin-notices-supabase.test.ts scripts/client-messages-supabase.test.ts scripts/slack-notices-supabase.test.ts)"; exit 1; }
  # E5 (contract 4.2): the Slack notices suite cannot load the 2a base, so the proof that 20261029u leaves Stage 1 as it was is checkin-notices-supabase.test.ts's body-diff case, run above.
  (bun test supabase/functions/cockpit-notices >/dev/null 2>&1) \
    || { echo "the notices sender tests fail (bun test supabase/functions/cockpit-notices)"; exit 1; }
  (bun test hermes/client-messages >/dev/null 2>&1) \
    || { echo "the WhatsApp recap sender tests fail (bun test hermes/client-messages)"; exit 1; }
  # native-feed.test.ts runs the importer with `python`. A Mac with only python3 gets a one-line
  # `python` for this run alone, in a temporary folder removed after. It points at the newest
  # python3.11 or later found, because 3.9's fromisoformat refuses Postgres times with 4 or 5
  # fraction digits, which fails the importer's freshness check about one run in ten.
  py_shim=""
  if ! command -v python >/dev/null 2>&1; then
    native_py=$(command -v "$py_bin")
    for cand in python3.13 python3.12 python3.11; do
      if command -v "$cand" >/dev/null 2>&1; then native_py=$(command -v "$cand"); break; fi
    done
    py_shim=$(mktemp -d)
    printf '#!/bin/sh\nexec "%s" "$@"\n' "$native_py" >"$py_shim/python"
    chmod +x "$py_shim/python"
  fi
  native_ok=1
  (PATH="${py_shim:+$py_shim:}$PATH" bun test hermes/cockpit-sync/csm-checkin-task.test.ts hermes/cockpit-sync/csmProducer.test.ts scripts/native-feed.test.ts >/dev/null 2>&1) || native_ok=0
  [ -z "$py_shim" ] || rm -rf "$py_shim"
  [ "$native_ok" = 1 ] \
    || { echo "the native feed's 1-1 notes tests fail (bun test hermes/cockpit-sync/csm-checkin-task.test.ts hermes/cockpit-sync/csmProducer.test.ts scripts/native-feed.test.ts)"; exit 1; }
  (bun test hermes/csm-calls/sources.test.ts hermes/csm-calls/lib.test.ts hermes/csm-calls/match.test.ts hermes/csm-calls/callMatch.test.ts hermes/csm-calls/fathomRules.test.ts hermes/csm-calls/eods.test.ts hermes/csm-calls/rollback.test.ts >/dev/null 2>&1) \
    || { echo "the CSM calls worker tests fail (bun test hermes/csm-calls/sources.test.ts hermes/csm-calls/lib.test.ts hermes/csm-calls/match.test.ts hermes/csm-calls/callMatch.test.ts hermes/csm-calls/fathomRules.test.ts hermes/csm-calls/eods.test.ts hermes/csm-calls/rollback.test.ts)"; exit 1; }
  (bun test supabase/functions/forms-door >/dev/null 2>&1) \
    || { echo "the kickoff webhook tests fail (bun test supabase/functions/forms-door)"; exit 1; }
  (cd apps/client-success-cockpit && bun test scripts/after-calls.test.tsx scripts/client-messages.test.tsx scripts/checkin-window.test.tsx scripts/csm-page.test.tsx scripts/notices-routing.test.tsx scripts/forms-button.test.tsx scripts/design-tokens.test.ts scripts/checkin-trail.test.ts scripts/form-panel.test.tsx scripts/form-contract.test.ts scripts/checkin-form.test.ts >/dev/null 2>&1) \
    || { echo "the 1-1 notes screens tests fail (cd apps/client-success-cockpit && bun test scripts/after-calls.test.tsx scripts/client-messages.test.tsx scripts/checkin-window.test.tsx scripts/csm-page.test.tsx scripts/notices-routing.test.tsx scripts/forms-button.test.tsx scripts/design-tokens.test.ts scripts/checkin-trail.test.ts scripts/form-panel.test.tsx scripts/form-contract.test.ts scripts/checkin-form.test.ts)"; exit 1; }
  (cd apps/client-success-cockpit && bun test scripts/client-brief.test.ts >/dev/null 2>&1) \
    || { echo "the client brief tests fail (cd apps/client-success-cockpit && bun test scripts/client-brief.test.ts)"; exit 1; }
  (cd apps/media-buyer-cockpit && bun test scripts/checkin-plans-supabase.test.ts scripts/checkin-replay.test.ts scripts/stage2b-fit-supabase.test.ts >/dev/null 2>&1) \
    || { echo "the 1-1 notes plans, replay or 2b fit tests fail (cd apps/media-buyer-cockpit && bun test scripts/checkin-plans-supabase.test.ts scripts/checkin-replay.test.ts scripts/stage2b-fit-supabase.test.ts)"; exit 1; }
  # bun counts a failing marked case as a pass, so G11 reads the file (the pattern never names the marker whole).
  [ "$(grep -c 'test[.]failing' apps/media-buyer-cockpit/scripts/checkin-plans-supabase.test.ts || true)" = "0" ] \
    || { echo "a case in checkin-plans-supabase.test.ts is still marked failing (grep -c 'test[.]failing' apps/media-buyer-cockpit/scripts/checkin-plans-supabase.test.ts)"; exit 1; }
  bash -n scripts/ship.sh \
    || { echo "scripts/ship.sh does not parse (bash -n scripts/ship.sh)"; exit 1; }
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
  (cd apps/media-buyer-cockpit && bun test scripts/goals-model.test.ts scripts/goals-sheet.test.ts scripts/costs-model.test.ts >/dev/null 2>&1) \
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


  # A cockpit that reads Supabase in the browser needs its public address
  # and anon key at build time, and the Vercel projects for client success,
  # creative and media buyer do not hold them. Without them in the
  # environment the build passes and the page cannot sign in (2026-10-08:
  # creative went out that way and was rolled back four minutes later).
  # Sales checks this itself in vite.config.ts.
  if grep -rq "VITE_SUPABASE_URL" "$dir/src" \
     && ! grep -q "supabaseEnvProblem" "$dir/vite.config.ts" 2>/dev/null \
     && { [ -z "${VITE_SUPABASE_URL:-}" ] || [ -z "${VITE_SUPABASE_ANON_KEY:-}" ]; }; then
    echo "$app reads Supabase in the browser: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (the anon key, never the service key) and ship again"
    exit 1
  fi

  # The CLI upload stamps local HEAD and does not check GitHub. Refuse a
  # commit main does not have, a dirty app directory, or a production this
  # commit does not contain (2026-09-22, cockpit.maharamedia.com on 7efca15f;
  # 2026-10-13, the production comparison had been skipped on every ship).
  echo "== $app: source is on GitHub main"
  scripts/require-github-main.sh "$dir"
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
  # Deploy and verify through the same installed CLI. An ephemeral bunx
  # deployment cannot be verified by the Python guard's installed client.
  command -v vercel >/dev/null 2>&1 || { echo "Install and sign in to the Vercel CLI before publishing."; exit 1; }
  local -a vercel_cli=(vercel)
  if (cd "$dir" && "${vercel_cli[@]}" whoami ${tok[@]+"${tok[@]}"} >/dev/null 2>&1); then
    # Without the app's link the CLI makes a new project named after the
    # folder and deploys there; the site keeps the old bundle (2026-10-05, a
    # fresh worktree made client-success-cockpit beside mahara-client-success).
    [ -f "$dir/.vercel/project.json" ] || { echo "$dir is not linked to a Vercel project (.vercel/project.json missing): copy it from a linked checkout"; exit 1; }
    # An archived upload avoids the per-file fetch failures observed during
    # the native branch preview run. It does not change the deployment target.
    out=$(cd "$dir" && "${vercel_cli[@]}" deploy --prod --yes --force --archive tgz ${build_env[@]+"${build_env[@]}"} ${tok[@]+"${tok[@]}"} 2>&1) || { echo "$out" | tail -20; echo "vercel deploy failed for $app"; exit 1; }
  else
    # Publication needs the same scoped CLI for ownership reads, promotion
    # and read-back. Stop before uploading when those checks are unavailable.
    echo "Vercel CLI access is required to publish and verify production. Sign in and rerun scripts/ship.sh."
    exit 1
  fi
  echo "$out" | grep -E '"url"|readyState|target|Production|Aliased|rror' | head -8
  echo "$out" | grep -Eq '"readyState": *"READY"|Aliased +https|Production +https|"status": *"ok"' || { echo "vercel did not confirm a production deployment for $app:"; echo "$out" | tail -20; exit 1; }

  # READY can still be STAGED when autoAssignCustomDomains is disabled.
  # Verify the exact build, promote it, and require the actual cockpit route
  # to serve its entry. A team-suffixed alias alone is not publication.
  local candidate
  candidate=$(printf '%s\n' "$out" | grep -E 'Production +https|"readyState": *"READY"' | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | head -1 || true)
  [ -n "$candidate" ] || { echo "No exact candidate deployment URL returned for $app"; exit 1; }
  "$py_bin" scripts/check-vercel-project.py "$dir" --deployment "$candidate" --promote

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

# The readiness checks (structure, imports, shared files, typechecks and
# builds of all five apps, the offline test suites) run before anything is
# uploaded, so a failure stops the deploy. Until 2026-10-12 they ran after
# it, in release mode, where the missing cutover evidence failed every
# routine ship once production had already changed.
echo "== readiness (local checks)"
# Complete builds and offline suites need a finite allowance on shared hosts.
"$py_bin" scripts/verify-cutover-readiness.py --mode local --timeout 600

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
# Release evidence binds one commit and comes only from the coordinated
# cutover procedure (docs/CUTOVER-ACCEPTANCE.md). Check it when it exists.
if [ -f evidence/cutover-acceptance.json ]; then
  "$py_bin" scripts/verify-cutover-readiness.py --mode release
else
  echo "no cutover evidence recorded (evidence/cutover-acceptance.json); the local readiness checks passed before the deploy"
fi
echo "shipped."
