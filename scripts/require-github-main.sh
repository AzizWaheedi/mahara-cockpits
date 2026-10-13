#!/usr/bin/env bash
# Production may only be uploaded from a commit GitHub already has on main,
# and only when that commit is what the working tree will actually send.
#
#   scripts/require-github-main.sh apps/media-buyer-cockpit [public site url]
#
# `vercel deploy --prod` (and the Composio path) uploads the working tree and
# stamps whatever HEAD the local clone has. It does not ask GitHub whether
# that object exists. On 2026-09-22 that put cockpit.maharamedia.com on
# 7efca15fb6631c767489ffb343d858fa703186b8 ("A person is a page, not a panel,
# and next month is one screen"), which is not in AzizWaheedi/mahara-cockpits.
# The deploy before it, db78d278dfafaccc3cadbad4c7bdea62ccd988bf, is the same
# kind of miss. Both were CLI deploys (source "cli") by aziz-6097, ref main,
# repo mahara-cockpits. GitHub's push log has no force-push that would have
# deleted them: they were never pushed.
#
# Production must also be contained in what is shipped. Its commit comes from
# Vercel's record of the live deployment (check-vercel-project.py
# --production-in-head), read before anything is uploaded. Until 2026-10-13
# this script read it from a stamp in the live bundle, which no cockpit
# bundle carries any more, so the comparison was skipped on every ship with
# only a note. An unread production commit now stops the ship.
#
# ALLOW_UNPUSHED_SHIP=yes skips every refusal here. It is the hole this script
# exists to close, so it says so and then stops protecting you.
# ALLOW_UNKNOWN_PRODUCTION=yes only lets the ship continue when production's
# commit cannot be read; a production with commits HEAD lacks still stops it.
set -euo pipefail
cd "$(dirname "$0")/.."
dir="${1:?usage: scripts/require-github-main.sh <app dir>}"
[ -d "$dir" ] || { echo "no such app directory: $dir"; exit 2; }
py_bin="python"
command -v python >/dev/null 2>&1 || py_bin="python3"
"$py_bin" scripts/check-vercel-project.py "$dir"

head_sha=$(git rev-parse HEAD)
if [ "${ALLOW_UNPUSHED_SHIP:-}" = "yes" ]; then
  echo "ALLOW_UNPUSHED_SHIP=yes — shipping $(git rev-parse --short "$head_sha") with no check that GitHub has it or that it contains production."
  exit 0
fi

git fetch --quiet origin main
if ! git merge-base --is-ancestor "$head_sha" origin/main; then
  echo "refusing to ship: $(git rev-parse --short "$head_sha") is not on origin/main."
  echo "Push it to GitHub main first. The Vercel CLI stamps the local commit even when GitHub has never seen it, and that SHA is then what production reports."
  exit 1
fi

# Ignored files (node_modules, dist, .env, convex/_generated) are not the
# commit. Anything else in the app directory is uploaded, and the GitHub SHA
# would no longer describe the bytes.
dirty=$(git status --porcelain -- "$dir" || true)
if [ -n "$dirty" ]; then
  echo "refusing to ship: $dir does not match $(git rev-parse --short "$head_sha")"
  echo "$dirty"
  echo "Commit and push that, or put it aside. A dirty tree is deployed under the last commit's name."
  exit 1
fi

# Before upload: production's commit must be in HEAD, by name or by patch.
"$py_bin" scripts/check-vercel-project.py "$dir" --production-in-head
echo "ship source: $(git rev-parse --short "$head_sha") is on origin/main and $dir is clean"
