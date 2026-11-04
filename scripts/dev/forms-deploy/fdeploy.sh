#!/bin/bash
# fdeploy.sh <slug> <rev> [--dry] [--verify-jwt on|off]
# Deploys an Edge Function from a pushed git revision with every outside file it imports (fn_extras.py), through
# scripts/dev/deploy_composio.py. ALWAYS pass --verify-jwt with the value the "live before" line prints: the deploy
# otherwise sets the platform default (on), which broke cockpit-notices for a minute on 2026-11-01.
# Before deploying a function other sessions touch, compare its updated_at with branch commit times: a function can be
# live from an unmerged branch (cockpit-media-api, 2026-11-01).
cd "$(git rev-parse --show-toplevel)" || exit 1
slug=$1; rev=$2; shift 2
ex=($(python3 scripts/dev/fn_extras.py . "$slug"))
if [ ${#ex[@]} -gt 0 ]; then exec python3 scripts/dev/deploy_composio.py "$slug" --rev "$rev" "$@" --extra "${ex[@]}"; else exec python3 scripts/dev/deploy_composio.py "$slug" --rev "$rev" "$@"; fi
