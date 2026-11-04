#!/bin/bash
# Renders the v4 website film on the VPS (never on the Mac):
#   bash scripts/render-v4.sh [en] [ar]        (English first: the silent Arabic cut takes its gain)
# Needs the baked grades (python3 film/v4bake.py) and capture/v3.
# Per cut: build the main, clean and poster projects, gate on `hyperframes
# check`, render main and clean at delivery quality, master them
# (scripts/finish.py), take the poster at 33.5 s, then the music preview
# (v3's unlicensed bed, internal only). Then one contact sheet, the manifest
# and the contract checks.
set -euo pipefail
[ "$(uname -s)" != Darwin ] || { echo "render-v4: use the VPS, never the Mac."; exit 1; }
LANGS=${*:-en ar}
TOOL=$(cd "$(dirname "$0")/.." && pwd)
W=${OFFER_VIDEO_MEDIA:-$HOME/upsell-studio-video/website}
HF=$TOOL/node_modules/.bin/hyperframes
VERSION=${OFFER_VIDEO_VERSION:-v4-r2}
[[ "$VERSION" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "Choose a simple version name."; exit 1; }
OUT=$W/out/$VERSION
P=$W/$VERSION/hf
[ ! -e "$OUT" ] || { echo "render-v4: $OUT already exists. Choose a new OFFER_VIDEO_VERSION; current renders are preserved."; exit 1; }
bash "$TOOL/scripts/doctor.sh"
for f in k2-night.mp4 k2-soft.mp4 k2-soft-cold.mp4 k2-warm.mp4 bg1-cold.jpg court-warm.jpg bg3-warm.jpg bg2-warm-lo.jpg bg2-warm-hi.jpg; do
  [ -f "$W/v4/baked/$f" ] || { echo "render-v4: $f is not baked yet: run python3 film/v4bake.py"; exit 1; }
done
# Reserve a version only after all dependency/media preflight checks pass.
mkdir -p "$(dirname "$OUT")"
mkdir "$OUT"
mkdir -p "$P"
# 1. Build every project, gate each cut on `hyperframes check`, then every
#    word both cuts show or say on the client copy check, before any render.
COPIES=""
for L in $LANGS; do
  python3 "$TOOL/film/v4a.py" --lang "$L" --out "$P/$L"
  python3 "$TOOL/film/v4a.py" --lang "$L" --clean --out "$P/$L-clean"
  python3 "$TOOL/film/v4a.py" --lang "$L" --clean --poster --out "$P/$L-poster"
  (cd "$P/$L" && "$HF" check --json > "$OUT/check-$L.json" 2>/dev/null) || { echo "The $L cut failed its check: read $OUT/check-$L.json"; exit 1; }
  COPIES="$COPIES $P/$L/copy.json"
done
(cd "$TOOL/../../apps/media-buyer-cockpit" && PATH="$HOME/upsell-build/bin:$PATH" bun "$TOOL/scripts/copy-check.ts" $COPIES > "$OUT/copy-check.json") \
  || { echo "The copy check failed: read $OUT/copy-check.json"; exit 1; }
# 2. Render, master, poster, music preview.
for L in $LANGS; do
  (cd "$P/$L" && "$HF" render --quality delivery --output "$OUT/raw-$L.mp4" > "$OUT/render-$L.log" 2>&1)
  (cd "$P/$L-clean" && "$HF" render --quality delivery --output "$OUT/raw-$L-clean.mp4" > "$OUT/render-$L-clean.log" 2>&1)
  (cd "$P/$L-poster" && rm -rf .hyperframes/artifacts/snapshots && "$HF" snapshot --at 33.5 --no-end > /dev/null 2>&1 \
    && ffmpeg -y -v error -i .hyperframes/artifacts/snapshots/*/frame-00-at-33.5s.png -q:v 2 "$OUT/website-$L-poster.jpg")
  cp "$P/$L/website-$L.vtt" "$OUT/"
  cp "$P/$L/copy.json" "$OUT/copy-$L.json"
  cp "$P/$L/build.json" "$OUT/build-$L.json"
  if python3 -c "import json,sys; sys.exit(0 if json.load(open('$P/$L/build.json'))['voice'] else 1)"; then
    python3 "$TOOL/scripts/finish.py" --lang "$L" --out "$OUT"
    if [ "${INTERNAL_MUSIC_PREVIEW:-0}" = 1 ]; then python3 "$TOOL/scripts/music_preview.py" --lang "$L" --out "$OUT"; fi
  elif [ -f "$OUT/facts-en.json" ]; then
    python3 "$TOOL/scripts/finish.py" --lang "$L" --out "$OUT" --gain-from "$OUT/facts-en.json"
    if [ "${INTERNAL_MUSIC_PREVIEW:-0}" = 1 ]; then python3 "$TOOL/scripts/music_preview.py" --lang "$L" --out "$OUT" --gain-from "$OUT/facts-en-music.json"; fi
  else
    echo "The $L cut has no narrator: render English first in the same version so it can take that gain."; exit 1
  fi
done
# The contact sheet: 1.5, 10, 15.5, 25, 40, 48 and 56 s of each cut.
FR=$(mktemp -d)
for L in en ar; do
  [ -f "$OUT/website-$L.mp4" ] || continue
  for T in 1.5 10 15.5 25 40 48 56; do
    ffmpeg -v error -y -ss "$T" -i "$OUT/website-$L.mp4" -frames:v 1 "$FR/$L-$(printf %04.1f "$T").png"
  done
done
python3 "$TOOL/scripts/sheet.py" "$OUT/contact-sheet.png" --cols 7 --width 480 $(ls "$FR"/*.png | sort)
rm -rf "$FR"
python3 "$TOOL/scripts/manifest_v4.py" --out "$OUT"
python3 "$TOOL/scripts/check.py" --mode internal-preview --out "$OUT" --hf "$P" > "$OUT/check-contract.json" || { echo "contract checks failed: read $OUT/check-contract.json"; exit 1; }
echo "Internal preview rendered: $OUT. Client delivery still requires check --mode client-ready."
