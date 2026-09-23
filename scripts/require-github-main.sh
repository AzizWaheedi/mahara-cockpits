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
# ALLOW_UNPUSHED_SHIP=yes skips the refusal. It is the hole this script
# exists to close, so it prints the local SHA and the live SHA and then
# stops protecting you.
set -euo pipefail
cd "$(dirname "$0")/.."
dir="${1:?usage: scripts/require-github-main.sh <app dir> [site url]}"
[ -d "$dir" ] || { echo "no such app directory: $dir"; exit 2; }

case "$dir" in
  apps/media-buyer-cockpit)      default_site=https://cockpit.maharamedia.com ;;
  apps/client-success-cockpit)   default_site=https://cockpit.maharamedia.com/client-success ;;
  apps/creative-director-cockpit) default_site=https://cockpit.maharamedia.com/creative ;;
  apps/video-editor-cockpit)     default_site=https://cockpit.maharamedia.com/editor ;;
  *) default_site="" ;;
esac
site="${2:-$default_site}"

# The entry bundle of a Vite deploy on Vercel carries the commit the CLI
# stamped. Read that, not the Vercel API, so the check needs no token.
live_sha=""
if [ -n "$site" ]; then
  html=$(curl -fsS -m 20 -H 'Cache-Control: no-cache' "$site/?cb=$RANDOM") \
    || { echo "refusing to ship: could not read $site"; exit 1; }
  js_path=$(printf '%s' "$html" | grep -oE 'src="[^"]*index-[A-Za-z0-9_-]+\.js"' | head -1 | sed -E 's/^src="([^"]+)".*/\1/' || true)
  if [ -n "$js_path" ]; then
    case "$js_path" in
      http*) js_url="$js_path" ;;
      /*)    js_url="https://cockpit.maharamedia.com$js_path" ;;
      *)     js_url="${site%/}/$js_path" ;;
    esac
    js=$(curl -fsS -m 40 "$js_url") || { echo "refusing to ship: could not read $js_url"; exit 1; }
    live_sha=$(printf '%s' "$js" | grep -oE 'VITE_VERCEL_GIT_COMMIT_SHA:"[0-9a-f]{40}"' | head -1 | sed -E 's/.*"([0-9a-f]{40})".*/\1/' || true)
  fi
fi

head_sha=$(git rev-parse HEAD)
if [ "${ALLOW_UNPUSHED_SHIP:-}" = "yes" ]; then
  echo "ALLOW_UNPUSHED_SHIP=yes — shipping $(git rev-parse --short "$head_sha") with no check that GitHub has it."
  [ -n "$live_sha" ] && echo "  production is currently $live_sha. This can replace it."
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

if [ -n "$live_sha" ]; then
  if ! git cat-file -e "${live_sha}^{commit}" 2>/dev/null; then
    echo "refusing to ship $dir: production is $live_sha, and this clone does not have that commit."
    echo "It was uploaded from another checkout and never pushed (media buyer, 2026-09-22: db78d278, then 7efca15f, both still absent from GitHub)."
    echo "Push it from the machine that shipped it — Aziz Waheedi's clone, reflog around those SHAs — before deploying again."
    echo "Deploying GitHub main from here would replace that production with an older tree."
    exit 1
  fi
  if ! git merge-base --is-ancestor "$live_sha" "$head_sha"; then
    # A rebase gives the same commits new names: production built from the
    # old name is still contained in HEAD when every commit it has beyond
    # the fork point is in HEAD as the same patch (git cherry marks those
    # "-", and a commit HEAD really lacks "+"). 2026-09-23: production was
    # 7efca15, rebased onto main as 7a7668e with an identical patch.
    base=$(git merge-base "$live_sha" "$head_sha")
    lacking=$(git cherry "$head_sha" "$live_sha" "$base" | grep -c '^+' || true)
    if [ "$lacking" -ne 0 ]; then
      echo "refusing to ship $dir: production is $(git rev-parse --short "$live_sha"), which is not an ancestor of $(git rev-parse --short "$head_sha")."
      echo "It has $lacking commit(s) this tree does not have, by name or by patch:"
      git cherry -v "$head_sha" "$live_sha" "$base" | grep '^+' | sed 's/^/  /'
      echo "This deploy would move production sideways or backwards."
      exit 1
    fi
    echo "ship source: $(git rev-parse --short "$head_sha") is on origin/main; production $(git rev-parse --short "$live_sha") is in it under rebased names (every patch the same); $dir is clean"
  else
    echo "ship source: $(git rev-parse --short "$head_sha") is on origin/main; production $(git rev-parse --short "$live_sha") is contained in it; $dir is clean"
  fi
else
  echo "ship source: $(git rev-parse --short "$head_sha") is on origin/main and $dir is clean"
  echo "  (the live page did not name a commit, so this did not compare against production)"
fi
