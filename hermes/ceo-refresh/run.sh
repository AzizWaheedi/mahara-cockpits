#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
lock_path="${CEO_REFRESH_LOCK_PATH:-/run/lock/mahara-ceo-refresh.lock}"
exec flock -n "$lock_path" bun worker.ts "$@"
