#!/usr/bin/env python3
"""Tile PNG or video frames into one labelled contact sheet.

  python3 scripts/sheet.py OUT.jpg --cols 4 --width 480 [--video V --at 2.5,10,...] [PNG ...]
"""
import argparse
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("pngs", nargs="*")
ap.add_argument("--cols", type=int, default=4)
ap.add_argument("--width", type=int, default=480)
ap.add_argument("--video")
ap.add_argument("--at")
a = ap.parse_intermixed_args()
items = []
tmp = Path(tempfile.mkdtemp())
if a.video:
    for t in a.at.split(","):
        p = tmp / f"f{float(t):07.2f}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", t, "-i", a.video, "-frames:v", "1", str(p)], check=True)
        items.append((p, f"{float(t):.2f}s"))
for p in a.pngs:
    items.append((Path(p), Path(p).stem))
w = a.width
h = w * 9 // 16
rows = (len(items) + a.cols - 1) // a.cols
sheet = Image.new("RGB", (a.cols * (w + 8) + 8, rows * (h + 30) + 8), (20, 20, 24))
d = ImageDraw.Draw(sheet)
for i, (p, label) in enumerate(items):
    im = Image.open(p).convert("RGB").resize((w, h))
    x, y = 8 + (i % a.cols) * (w + 8), 8 + (i // a.cols) * (h + 30)
    sheet.paste(im, (x, y))
    d.text((x + 4, y + h + 6), label, fill=(220, 220, 220))
sheet.save(a.out, quality=85)
print(a.out, sheet.size)
