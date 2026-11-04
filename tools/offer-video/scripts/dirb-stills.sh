#!/usr/bin/env bash
# v4, art direction B ("Drawing set"): build the proof projects, grade them
# with media-treatment (never CSS filters), lint, and snapshot the five key
# frames per language. VPS only.
#
#   bash scripts/dirb-stills.sh [en] [ar]
#
# Writes ~/upsell-studio-video/website/v4-dir-B/{proj-<lang>,snap-<lang>,stills}/
set -euo pipefail
TOOL="$(cd "$(dirname "$0")/.." && pwd)"
HF="$TOOL/node_modules/.bin/hyperframes"
OUT="${OFFER_VIDEO_MEDIA:-$HOME/upsell-studio-video/website}/v4-dir-B"
TIMES="${TIMES:-1.5,10,15.5,40.3,48.6}"
LANGS=("$@"); [ ${#LANGS[@]} -eq 0 ] && LANGS=(en ar)
mkdir -p "$OUT/stills"

grade() { # file selector json
  "$HF" media-treatment --project "$P" --file "$1" --selector "$2" --grading "$3" --apply --json >/dev/null
}

for L in "${LANGS[@]}"; do
  P="$OUT/proj-$L"
  python3 "$TOOL/film/dirb.py" --lang "$L" --out "$P"
  # The gap is cold: desaturated, cooler, darker, out of focus. The capture is
  # only cooled a little (it is their real page).
  grade compositions/gap.html "#g-plate" '{"adjust":{"exposure":-0.3,"contrast":-0.1,"temperature":-0.45,"saturation":-0.5},"effects":{"blur":0.75}}'
  grade compositions/gap.html "#g-cap" '{"adjust":{"temperature":-0.12,"saturation":-0.3}}'
  # The answer is warm.
  grade compositions/turn.html "#tu-k2" '{"adjust":{"exposure":0.06,"temperature":0.24,"vibrance":0.12}}'
  # The plates behind the screens: soft, a little darker, warm.
  grade compositions/need.html "#n-plate" '{"adjust":{"exposure":-0.35,"temperature":0.1},"effects":{"blur":0.85}}'
  grade compositions/ret.html "#r-plate" '{"adjust":{"exposure":-0.3,"temperature":0.12},"effects":{"blur":0.85}}'
  ( cd "$P" && "$HF" lint ) || true
  rm -rf "$OUT/snap-$L"
  ( cd "$P" && "$HF" snapshot "$P" --at "$TIMES" --no-end -o "$OUT/snap-$L" --timeout 120000 --json ) > "$OUT/snap-$L.json"
done

python3 - "$OUT" "$TIMES" "${LANGS[@]}" <<'EOF'
import sys, glob, os
from PIL import Image, ImageDraw
out, times, langs = sys.argv[1], sys.argv[2].split(","), sys.argv[3:]
names = {"1.5": "1.5", "10": "10", "15.5": "15.5", "40.3": "40", "48.6": "48"}
for L in langs:
    for t in times:
        src = sorted(glob.glob(f"{out}/snap-{L}/*{t}s*.png")) or sorted(glob.glob(f"{out}/snap-{L}/*{t.replace('.', '_')}*.png"))
        if not src:
            print("missing", L, t); continue
        im = Image.open(src[0]).convert("RGB")
        if im.size != (1920, 1080):
            im = im.resize((1920, 1080), Image.LANCZOS)
        dst = f"{out}/stills/{L}-{names.get(t, t)}.jpg"
        for q in (88, 84, 80, 76, 72, 68, 64):
            im.save(dst, quality=q, optimize=True, progressive=True)
            if os.path.getsize(dst) < 400_000:
                break
        print(dst, os.path.getsize(dst), "q", q)
# contact sheet: English on top, Arabic under it, five frames each
tw, th, pad, lab = 768, 432, 16, 36
order = [names[t] for t in times]
sheet = Image.new("RGB", (pad + len(order) * (tw + pad), pad + 2 * (th + lab + pad)), (9, 19, 51))
d = ImageDraw.Draw(sheet)
for r, L in enumerate(["en", "ar"]):
    for c, n in enumerate(order):
        p = f"{out}/stills/{L}-{n}.jpg"
        if not os.path.exists(p):
            continue
        x, y = pad + c * (tw + pad), pad + r * (th + lab + pad)
        sheet.paste(Image.open(p).resize((tw, th), Image.LANCZOS), (x, y))
        d.text((x, y + th + 8), f"{L}  {n} s", fill=(242, 246, 250))
sheet.save(f"{out}/stills/contact-sheet.jpg", quality=86, optimize=True)
print(f"{out}/stills/contact-sheet.jpg", os.path.getsize(f"{out}/stills/contact-sheet.jpg"))
EOF
