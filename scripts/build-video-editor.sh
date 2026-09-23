#!/usr/bin/env bash
# Git deployments of mahara-video-editor clone this repository and run
# `bun run build` at the root. The app still builds in its own folder;
# Vercel publishes the root `dist/` (output directory `dist`).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

cd "$root/apps/video-editor-cockpit"

# The committed bun.lock is lockfileVersion 2, which Bun 1.4 writes.
# Vercel leaves Bun 1.3.x on PATH (Functions `bunVersion` 1.4 is opt-in
# and does not change this). 1.3 exits 1 on a frozen install:
# "Unknown lockfile version" then "lockfile had changes, but lockfile is frozen".
# Root `bun install` still succeeds, because that package has no lockfile.
bun_version="$(bun --version 2>/dev/null || echo 0.0.0)"
bun_major="${bun_version%%.*}"
bun_minor="${bun_version#*.}"
bun_minor="${bun_minor%%.*}"
if [ "${bun_major:-0}" -gt 1 ] 2>/dev/null || { [ "${bun_major:-0}" -eq 1 ] && [ "${bun_minor:-0}" -ge 4 ]; }; then
  bun install --frozen-lockfile
  bun run build
else
  echo "bun ${bun_version} cannot read lockfileVersion 2; installing with bun@1.4.2"
  npm exec --yes --package=bun@1.4.2 -- bun install --frozen-lockfile
  npm exec --yes --package=bun@1.4.2 -- bun run build
fi

rm -rf "$root/dist"
cp -a dist "$root/dist"
