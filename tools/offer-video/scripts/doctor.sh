#!/bin/bash
# Says in plain sentences what the website film needs and does not have.
set -uo pipefail
[ "$(uname -s)" != Darwin ] || { echo "doctor: video work runs on the VPS, never the Mac."; exit 1; }
TOOL=$(cd "$(dirname "$0")/.." && pwd)
W=${OFFER_VIDEO_MEDIA:-$HOME/upsell-studio-video/website}
fail=0
say() { echo "doctor: $*"; fail=1; }
for binary in ffmpeg ffprobe node python3 bun unzip; do
  command -v "$binary" > /dev/null || say "$binary is not installed or is missing from PATH."
done
free_gb=$(df -BG --output=avail "$W" | tail -1 | tr -dc 0-9)
[ "${free_gb:-0}" -ge 5 ] || say "Under 5 GB free on the VPS (${free_gb} GB)."
[ -x "$TOOL/node_modules/.bin/hyperframes" ] || say "HyperFrames is not installed: run npm install in tools/offer-video."
"$TOOL/node_modules/.bin/hyperframes" browser path > /dev/null 2>&1 || say "HyperFrames has no Chrome: run npx hyperframes browser ensure (needs unzip on PATH)."
doctor_json=$(mktemp)
trap 'rm -f "$doctor_json"' EXIT
# CLI doctor includes optional Docker/local synthesis in global .ok. This
# pipeline uses local Chromium and FFmpeg, never --docker or synthesis.
doctor_status=0
"$TOOL/node_modules/.bin/hyperframes" doctor --json > "$doctor_json" 2>/dev/null || doctor_status=$?
# Some CLI versions exit 1 for global .ok=false. Only 0/1 plus a valid local
# dependency report are accepted; command errors/signals still fail closed.
python3 "$TOOL/scripts/local_render_doctor.py" "$doctor_json" "$doctor_status" || say "HyperFrames local-render dependencies are not ready."
for f in final/kling/website-kling-1-phone-ad-4x5.mp4 final/kling/website-kling-2-hero-dolly.mp4 final/art/website-bg-1.jpg \
         final/art/website-hero-16x9.jpg brand/mahara-lockup-dark-full.png brand/favicon.png capture/v3/boxes.json \
         voice/en/george/timing.json voice/en/george/website-vo-en-george.wav; do
  [ -f "$W/$f" ] || say "Missing $W/$f."
done
[ "${BED:-off}" = off ] || [ -f "$W/music/heygen-e43a0bf5.wav" ] || say "Missing $W/music/heygen-e43a0bf5.wav (only for BED=heygen)."
[ -f "$W/voice/ar/mohamed/timing.json" ] || echo "doctor: no Arabic narrator yet (voice/ar/mohamed): the Arabic cut renders silent, cues on the script's windows."
[ -f "$HOME/upsell-build/media/real/aziz-close-en.mp4" ] || echo "doctor: no real closing clip yet: 52 to 60 s stays the placeholder card."
KEYS=/opt/data/bibi/api-keys.env
for k in ELEVENLABS_API_KEY HIGGSFIELD_ID HIGGSFIELD_SECRET; do
  grep -q "^$k=" "$KEYS" 2> /dev/null || echo "doctor: $k is not in $KEYS (only needed to re-voice or redraw)."
done
[ "$fail" = 0 ] && echo "doctor: ready to render." || exit 1
