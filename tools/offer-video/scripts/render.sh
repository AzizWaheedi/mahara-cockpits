#!/bin/bash
# Renders the website film on the VPS (never on the Mac):
#   bash scripts/render.sh v3 [en] [ar]     (BED=heygen for an internal listen only)
# Per cut: build the main, clean and poster projects, gate on `hyperframes
# check`, render both at delivery quality, master them (scripts/finish.py),
# take the poster at 33.5 s, then one contact sheet and the manifest.
set -euo pipefail
V=${1:?the version, for example v1}; shift
LANGS=${*:-en ar}
TOOL=$(cd "$(dirname "$0")/.." && pwd)
W=${OFFER_VIDEO_MEDIA:-$HOME/upsell-studio-video/website}
HF=$TOOL/node_modules/.bin/hyperframes
OUT=$W/out/$V
mkdir -p "$OUT"
bash "$TOOL/scripts/doctor.sh"
for L in $LANGS; do
  python3 "$TOOL/film/build.py" --lang "$L" --bed "${BED:-off}" --out "$W/hf/$L"
  python3 "$TOOL/film/build.py" --lang "$L" --bed "${BED:-off}" --clean --out "$W/hf/$L-clean"
  python3 "$TOOL/film/build.py" --lang "$L" --bed "${BED:-off}" --clean --poster --out "$W/hf/$L-poster"
  (cd "$W/hf/$L" && "$HF" check --json > "$OUT/check-$L.json" 2>/dev/null) || { echo "The $L cut failed its check: read $OUT/check-$L.json"; exit 1; }
  (cd "$W/hf/$L" && "$HF" render --quality delivery --output "$OUT/raw-$L.mp4" > "$OUT/render-$L.log" 2>&1)
  (cd "$W/hf/$L-clean" && "$HF" render --quality delivery --output "$OUT/raw-$L-clean.mp4" > "$OUT/render-$L-clean.log" 2>&1)
  (cd "$W/hf/$L-poster" && rm -rf .hyperframes/artifacts/snapshots && "$HF" snapshot --at 33.5 > /dev/null 2>&1 \
    && ffmpeg -y -v error -i .hyperframes/artifacts/snapshots/*/frame-00-at-33.5s.png -q:v 2 "$OUT/website-$L-poster.jpg")
  cp "$W/hf/$L/website-$L.vtt" "$OUT/"
  cp "$W/hf/$L/copy.json" "$OUT/copy-$L.json"
  cp "$W/hf/$L/build.json" "$OUT/build-$L.json"
  # A voiced cut is set to -15 LUFS on its own. A cut with no narrator yet
  # (Arabic until Mohamed is voiced) holds only room tone and two effects:
  # it takes the English cut's gain, so its quiet parts stay quiet.
  if python3 -c "import json,sys; sys.exit(0 if json.load(open('$W/hf/$L/build.json'))['voice'] else 1)"; then
    python3 "$TOOL/scripts/finish.py" --lang "$L" --out "$OUT"
  elif [ -f "$OUT/facts-en.json" ]; then
    python3 "$TOOL/scripts/finish.py" --lang "$L" --out "$OUT" --gain-from "$OUT/facts-en.json"
  else
    echo "The $L cut has no narrator: render English first in the same version so it can take that gain."; exit 1
  fi
done
# The contact sheet: 2.5, 10, 25, 40, 50 and 56 s of each cut.
FR=$(mktemp -d)
for L in en ar; do
  [ -f "$OUT/website-$L.mp4" ] || continue
  for T in 2.5 10 25 40 50 56; do
    ffmpeg -v error -y -ss "$T" -i "$OUT/website-$L.mp4" -frames:v 1 "$FR/$L-$(printf %04.1f "$T").png"
  done
done
python3 "$TOOL/scripts/sheet.py" "$OUT/contact-sheet.png" --cols 6 --width 480 $(ls "$FR"/*.png | sort)
rm -rf "$FR"
python3 "$TOOL/scripts/manifest.py" --out "$OUT" --version "$V"
echo "rendered: $OUT"
