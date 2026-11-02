#!/usr/bin/env bash
# Keys from the guard's and the current native release's private runtime files; switches only
# from ~/.client-messages/switches.env (read by worker.ts itself). Never print a file or a value.
set -euo pipefail
cd /home/hermes/client-messages-current
native="$(readlink -f /home/hermes/cockpit-native-current)"
release="$(basename "$native")"
env_files="/home/hermes/.ad-billing-guard/runtime.json:/home/hermes/.cockpit-native-state/runtime-${release}.json"
if [[ -r /opt/data/bibi/api-keys.env ]]; then
  env_files="${env_files}:/opt/data/bibi/api-keys.env"
fi
export CLIENT_MESSAGES_ENV_FILES="$env_files"
exec "$native/tools/bun" hermes/client-messages/worker.ts "$@"
