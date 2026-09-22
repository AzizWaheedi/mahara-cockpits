#!/usr/bin/env bash
# Git deployments of mahara-video-editor clone this repository and run
# `bun run build` at the root. The app still builds in its own folder;
# Vercel publishes the root `dist/` (output directory `dist`).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

cd "$root/apps/video-editor-cockpit"
bun install --frozen-lockfile
bun run build

rm -rf "$root/dist"
cp -a dist "$root/dist"
