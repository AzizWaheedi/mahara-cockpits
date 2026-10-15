#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${AD_BILLING_CONFIG:?Set the path to the private runtime JSON file}"
: "${AD_BILLING_STATE_DIR:?Set a private writable directory for the lock}"
umask 077
mkdir -p "$AD_BILLING_STATE_DIR"
exec flock -n "$AD_BILLING_STATE_DIR/worker.lock" timeout 540 node worker.mjs --poll --config "$AD_BILLING_CONFIG"
