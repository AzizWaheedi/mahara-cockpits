#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# flock owns the descriptor for this process lifetime; there is no stale PID-file deletion.
exec 9>"${MEDIA_NATIVE_LOCK_FILE:-/tmp/mahara-media-native.lock}"
flock -n 9 || exit 0
export MEDIA_NATIVE_FLOCK=1
exec bun hermes/media-native/worker.ts "$@"
