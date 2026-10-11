#!/usr/bin/env bash
# The native release changes independently: load the named keys from the current
# release's private runtime file at every tick. Never print the file or a value.
set -euo pipefail
cd /home/hermes/csm-calls-current
native="$(readlink -f /home/hermes/cockpit-native-current)"
release="$(basename "$native")"
env_files="/home/hermes/.cockpit-native-state/runtime-${release}.json"
if [[ -r /opt/data/bibi/api-keys.env ]]; then
  env_files="${env_files}:/opt/data/bibi/api-keys.env"
fi
export CSM_CALLS_ENV_FILES="$env_files"
exec "$native/tools/bun" hermes/csm-calls/worker.ts "$@"
