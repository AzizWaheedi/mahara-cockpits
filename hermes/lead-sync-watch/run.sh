#!/usr/bin/env bash
# Loads the named keys at every tick from the current native release's private runtime file
# (its SLACK_BOT_TOKEN is maharaclubbot, a member of #tech-general), then api-keys.env for
# anything missing. Never prints a file or a value.
set -euo pipefail
cd /home/hermes/lead-sync-watch-current
native="$(readlink -f /home/hermes/cockpit-native-current)"
release="$(basename "$native")"
env_files="/home/hermes/.cockpit-native-state/runtime-${release}.json"
if [[ -r /opt/data/bibi/api-keys.env ]]; then
  env_files="${env_files}:/opt/data/bibi/api-keys.env"
fi
export LEAD_SYNC_ENV_FILES="$env_files"
exec "$native/tools/bun" hermes/lead-sync-watch/worker.ts "$@"
