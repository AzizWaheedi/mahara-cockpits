#!/usr/bin/env bash
# One production upload only. A failed CLI response does not prove that
# Vercel failed to receive or publish the deployment.
set -uo pipefail

if out=$(vercel deploy "$@" 2>&1); then
  printf '%s\n' "$out"
  exit 0
fi

echo "Vercel did not confirm the upload. It may already have reached production." >&2
echo "Inspect the current production alias and deployment status before retrying." >&2
exit 1
