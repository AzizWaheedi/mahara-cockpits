#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${TASK_ALERT_CONFIG:?Set the private configuration path}"
: "${TASK_ALERT_STATE:?Set the private state directory}"
cd "$(dirname "$0")"
exec timeout 110 python3 worker.py --config "$TASK_ALERT_CONFIG" --state-dir "$TASK_ALERT_STATE" "$@"
