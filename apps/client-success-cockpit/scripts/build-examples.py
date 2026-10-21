#!/usr/bin/python3
"""
The example ads' pictures (docs/csm-decks/DESIGN.md 22.4.1), built once
from Mahara's own Higgsfield run and committed as WebP:

    /usr/bin/python3 scripts/build-examples.py <originals dir> <scratch dir> [scene ...]

<originals dir> holds <scene>-feed.jpg (3:4) and <scene>-story.jpg (9:16)
for the eighteen scenes (the six of 2026-10-21 grouped by the five main
services, DESIGN 22.14). Named scenes build only those, so a new scene
never re-encodes the files already committed. Each is opened by its bytes, not its name (the .jpg
originals are PNG data). The feed is centre-cropped to 4:5 and the story to
exactly 9:16, resized with Lanczos and saved with method=6 at the highest
quality of 82, 78, 74, 70, 66, 62, 58, 54 that lands at or under 220 KB
(tiles: at or under 24 KB, from 72; the landscape's fine leaves need the low
end). A file still over budget at the lowest quality keeps it
(scripts/deck-examples.test.ts fails any file over 340 KB, tiles over 24 KB).

The tiles of L3's field: <theme>-a is the whole feed picture at 216 x 270,
<theme>-b a close detail of it (TILE_B_FOCUS), so the field mixes wide shots
and details and no frame repeats. A 24-tile contact sheet (the twelve -a
over the twelve -b) goes to <scratch dir> for a person to check before the
files are committed (the named scenes only, when scenes are named). Pillow is this Mac's (11.3.0, libwebp 1.5.0), not a
repository dependency; the originals stay out of the repository.
"""

import io
import sys
from pathlib import Path

from PIL import Image

THEMES = [
    "kitchen",
    "living",
    "majlis",
    "villa",
    "construction",
    "bathroom",
    "pool",
    "landscape",
    "bedroom",
    "office",
    "facade",
    "stairs",
    # 2026-10-21: the five main services' own scenes (SERVICE-MAP, DESIGN 22.14).
    "construction2",
    "construction3",
    "fitout2",
    "fitout3",
    "designbuild",
    "architecture2",
]

# (x, y, w) as fractions of the 4:5 feed crop; each box is 4:5 too, so its
# height is w of the crop's height. Chosen by eye on a gridded contact sheet
# (DESIGN 22.4.1).
TILE_B_FOCUS = {
    "kitchen": (0.40, 0.02, 0.45),
    "living": (0.22, 0.48, 0.45),
    "majlis": (0.30, 0.00, 0.45),
    "villa": (0.22, 0.28, 0.45),
    "construction": (0.18, 0.55, 0.45),
    "bathroom": (0.00, 0.42, 0.45),
    "pool": (0.55, 0.06, 0.45),
    "landscape": (0.55, 0.12, 0.45),
    "bedroom": (0.42, 0.36, 0.45),
    "office": (0.02, 0.30, 0.45),
    "facade": (0.25, 0.36, 0.45),
    "stairs": (0.35, 0.00, 0.45),
    "construction2": (0.40, 0.08, 0.45),
    "construction3": (0.50, 0.18, 0.45),
    "fitout2": (0.38, 0.18, 0.45),
    "fitout3": (0.50, 0.48, 0.45),
    "designbuild": (0.40, 0.30, 0.45),
    "architecture2": (0.38, 0.05, 0.45),
}

BIG = (1080, 1350)
STORY = (1080, 1920)
TILE = (216, 270)
BIG_BUDGET = 220 * 1024
TILE_BUDGET = 24 * 1024
BIG_Q = [82, 78, 74, 70, 66, 62, 58, 54]
TILE_Q = [72, 68, 64, 60, 56, 52, 48, 44, 40]


def open_bytes(path: Path) -> Image.Image:
    """Open by content, whatever the extension says."""
    img = Image.open(io.BytesIO(path.read_bytes()))
    img.load()
    return img.convert("RGB")


def centre_crop(img: Image.Image, ratio: float) -> Image.Image:
    """The largest box of width / height == ratio, centred."""
    w, h = img.size
    if w / h > ratio:
        nw = round(h * ratio)
        x = (w - nw) // 2
        return img.crop((x, 0, x + nw, h))
    nh = round(w / ratio)
    y = (h - nh) // 2
    return img.crop((0, y, w, y + nh))


def encode(img: Image.Image, budget: int, qualities: list[int]) -> tuple[bytes, int]:
    data = b""
    q = qualities[-1]
    for q in qualities:
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=q, method=6)
        data = buf.getvalue()
        if len(data) <= budget:
            return data, q
    return data, q


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    src = Path(sys.argv[1])
    scratch = Path(sys.argv[2])
    named = sys.argv[3:]
    unknown = [x for x in named if x not in THEMES]
    if unknown:
        print(f"Not a scene: {', '.join(unknown)}")
        return 2
    scenes = named or THEMES
    out = Path(__file__).resolve().parent.parent / "src/present/assets/examples"
    (out / "tile").mkdir(parents=True, exist_ok=True)
    scratch.mkdir(parents=True, exist_ok=True)
    tiles_a: list[Image.Image] = []
    tiles_b: list[Image.Image] = []
    for theme in scenes:
        feed = centre_crop(open_bytes(src / f"{theme}-feed.jpg"), 4 / 5)
        story = centre_crop(open_bytes(src / f"{theme}-story.jpg"), 9 / 16)
        jobs = [
            (f"{theme}-feed.webp", feed.resize(BIG, Image.LANCZOS), BIG_BUDGET, BIG_Q),
            (f"{theme}-story.webp", story.resize(STORY, Image.LANCZOS), BIG_BUDGET, BIG_Q),
        ]
        a = feed.resize(TILE, Image.LANCZOS)
        fw, fh = feed.size
        x, y, w = TILE_B_FOCUS[theme]
        box = (round(x * fw), round(y * fh), round((x + w) * fw), round((y + w) * fh))
        b = feed.crop(box).resize(TILE, Image.LANCZOS)
        tiles_a.append(a)
        tiles_b.append(b)
        jobs.append((f"tile/{theme}-a.webp", a, TILE_BUDGET, TILE_Q))
        jobs.append((f"tile/{theme}-b.webp", b, TILE_BUDGET, TILE_Q))
        for name, img, budget, qs in jobs:
            data, q = encode(img, budget, qs)
            (out / name).write_bytes(data)
            flag = "" if len(data) <= budget else "  (over budget)"
            print(f"{name:32} q{q:<3} {len(data) / 1024:7.1f} KB{flag}")
    n = len(tiles_a)
    sheet = Image.new("RGB", (TILE[0] * n + (n + 1) * 8, TILE[1] * 2 + 3 * 8), (9, 19, 51))
    for i, (a, b) in enumerate(zip(tiles_a, tiles_b)):
        sheet.paste(a, (8 + i * (TILE[0] + 8), 8))
        sheet.paste(b, (8 + i * (TILE[0] + 8), 16 + TILE[1]))
    sheet.save(scratch / "examples-contact.jpg", quality=88)
    print(f"contact sheet: {scratch / 'examples-contact.jpg'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
