#!/usr/bin/env bash
# hermes/forms-relay (RUNBOOK.md here). Keys from the current native release's private runtime file; the switch only
# from ~/.forms-relay/switches.env and the sheet and dispatch settings only from ~/.forms-relay/config.env (read by
# worker.ts itself). One run at a time under flock; never print a file or a value.
#   cron: */2 * * * * /home/hermes/forms-relay-current/hermes/forms-relay/run.sh run >> /home/hermes/.forms-relay/run.log 2>&1
set -euo pipefail
exec 9>/home/hermes/.forms-relay/run.lock
flock -n 9 || { echo '{"ok":true,"note":"Another relay run is still going; this one waits for the next."}'; exit 0; }
cd /home/hermes/forms-relay-current
native="$(readlink -f /home/hermes/cockpit-native-current)"
release="$(basename "$native")"
export FORMS_RELAY_ENV_FILES="/home/hermes/.cockpit-native-state/runtime-${release}.json:/home/hermes/.forms-relay/keys.env"
exec "$native/tools/bun" hermes/forms-relay/worker.ts "$@"
