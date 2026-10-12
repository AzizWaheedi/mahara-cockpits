#!/usr/bin/env bash
set -euo pipefail
: "${VIDEO_REVIEW_CONFIG:?Set the private config path}"
: "${VIDEO_REVIEW_STATE:?Set the private state path}"
cd "$(dirname "$0")"
exec timeout 110 python3 worker.py --config "$VIDEO_REVIEW_CONFIG" --state-dir "$VIDEO_REVIEW_STATE" "$@"
