#!/usr/bin/env python3
"""Stage proxies and small review files on the VPS. Never erase an old handoff.
--to is a new staging directory for download; --vps-copy is an optional new
VPS archive for masters. Never download --out or --vps-copy to the Mac.
"""
import argparse
import platform
import shutil
import tempfile
from pathlib import Path
from PIL import Image
import finish

PROXY_LIMIT = 6_000_000


def jpg_under(src, dst, limit=400_000):
    with Image.open(src) as original:
        im = original.convert("RGB")
        for quality in (90, 86, 82, 78, 74, 70, 66, 62):
            im.save(dst, quality=quality, optimize=True, progressive=True)
            if Path(dst).stat().st_size <= limit:
                return quality
    raise ValueError(f"{Path(src).name} cannot meet the small-file limit")


def small_files(out):
    files = []
    for lang in ("en", "ar"):
        proxy = out / f"website-{lang}-960.mp4"
        if not proxy.exists() or proxy.stat().st_size > PROXY_LIMIT:
            raise ValueError(f"{proxy.name}: a proxy of at most 6 MB is required")
        video = next(s for s in finish.probe(proxy)["streams"] if s["codec_type"] == "video")
        if (video["width"], video["height"]) != (960, 540):
            raise ValueError(f"{proxy.name}: expected a 960x540 proxy, never a master")
        files.extend([proxy, out / f"website-{lang}.vtt"])
    files.append(out / "manifest.json")
    for file in files:
        if not file.exists():
            raise ValueError(f"Missing {file.name}")
    return files


def main():
    if platform.system() == "Darwin":
        raise SystemExit("Stage on the VPS. Never encode or copy masters on the Mac.")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--to", required=True)
    ap.add_argument("--vps-copy")
    a = ap.parse_args()
    out, to = Path(a.out).expanduser().resolve(), Path(a.to).expanduser().resolve()
    if to.exists():
        raise SystemExit("Handoff destination exists. Choose a new directory; previous files are preserved.")
    files = small_files(out)
    to.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="offer-handoff-", dir=to.parent))
    try:
        for file in files:
            shutil.copyfile(file, stage / file.name)
        for lang in ("en", "ar"):
            jpg_under(out / f"website-{lang}-poster.jpg", stage / f"website-{lang}-poster.jpg")
        sheet = out / "contact-sheet.png"
        jpg_under(sheet if sheet.exists() else out / "contact-sheet.jpg", stage / "contact-sheet.jpg", limit=900_000)
        stage.rename(to)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    if a.vps_copy:
        archive = Path(a.vps_copy).expanduser().resolve()
        if archive.exists():
            raise SystemExit("VPS archive exists and was preserved. Small handoff is ready.")
        archive.mkdir(parents=True)
        for file in out.iterdir():
            if file.suffix in (".mp4", ".jpg", ".png", ".vtt", ".json") and not file.name.startswith("raw-"):
                shutil.copyfile(file, archive / file.name)
    for file in sorted(to.iterdir()):
        print(f"{file.stat().st_size:>10}  {file.name}")


if __name__ == "__main__":
    main()
