"""Thumbnails and covers from a real frame, in Aziz's personal-brand palette.

Midnight #122C4F, Ocean #5B88B2, Pearl #FBF9E4, Noir #000000 for the
headline, Fade #9CB1C7. Arabic in IBM Plex Sans Arabic, English in Inter.
Never the near-black and amber pair, and never a generated face: the frame
is Aziz as filmed. (master-context.md, "Visual identity".)

Pillow with libraqm shapes Arabic itself; without it the text is reshaped
and reordered by hand. Fonts are fetched once from Google Fonts' repository
into the radar home.
"""
from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any, Callable, Optional

from .. import http
from ..config import key

MIDNIGHT = (0x12, 0x2C, 0x4F)
OCEAN = (0x5B, 0x88, 0xB2)
PEARL = (0xFB, 0xF9, 0xE4)
NOIR = (0x00, 0x00, 0x00)
FADE = (0x9C, 0xB1, 0xC7)

FONT_FILES = {
    "arabic": ("IBMPlexSansArabic-Bold.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsansarabic/IBMPlexSansArabic-Bold.ttf"),
    "latin": ("Inter[opsz,wght].ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf"),
}
_ARABIC = re.compile(r"[\u0600-\u06FF]")


def is_arabic(text: str) -> bool:
    return bool(_ARABIC.search(text or ""))


def font_dir() -> Path:
    return Path(key("RADAR_HOME", str(Path.home() / ".ideation-radar"))).expanduser() / "fonts"


def ensure_fonts(log: Callable[[str], None] = lambda m: None) -> dict[str, Path]:
    d = font_dir()
    d.mkdir(parents=True, exist_ok=True)
    out: dict[str, Path] = {}
    for kind, (name, url) in FONT_FILES.items():
        p = d / name
        if not p.exists() or p.stat().st_size < 10_000:
            log(f"fetching font {name}")
            http.download(url, str(p), max_bytes=20 * 1024 * 1024, timeout=120)
        out[kind] = p
    return out


def _load_font(kind: str, size: int, fonts: dict[str, Path]):
    from PIL import ImageFont

    f = ImageFont.truetype(str(fonts[kind]), size)
    if kind == "latin":
        # A variable font: ask for the heavy weight, keep the optical size sane.
        try:
            axes = f.get_variation_axes()
            values = [a.get("default") for a in axes]
            for i, a in enumerate(axes):
                tag = str(a.get("name") or a.get("tag") or "")
                if "wght" in tag.lower() or "weight" in tag.lower():
                    values[i] = 800
                if "opsz" in tag.lower() or "optical" in tag.lower():
                    values[i] = min(a.get("maximum", 32), 32)
            f.set_variation_by_axes(values)
        except Exception:  # noqa: BLE001 - static fallback is fine
            pass
    return f


def _raqm() -> bool:
    try:
        from PIL import features

        return bool(features.check("raqm"))
    except Exception:  # noqa: BLE001
        return False


def _shape(text: str, rtl: bool) -> tuple[str, dict[str, Any]]:
    """What to hand Pillow: the raw text with raqm, else reshaped and reordered."""
    if not rtl:
        return text, {}
    if _raqm():
        return text, {"direction": "rtl", "language": "ar"}
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display

        return get_display(arabic_reshaper.reshape(text)), {}
    except Exception:  # noqa: BLE001
        return text, {}


def _width(draw, text: str, font, rtl: bool) -> float:
    shaped, kw = _shape(text, rtl)
    return float(draw.textlength(shaped, font=font, **kw))


def wrap(draw, text: str, font, max_w: float, rtl: bool) -> list[str]:
    words = [w for w in re.split(r"\s+", text.strip()) if w]
    lines: list[str] = []
    cur: list[str] = []
    for w in words:
        trial = " ".join(cur + [w])
        if cur and _width(draw, trial, font, rtl) > max_w:
            lines.append(" ".join(cur))
            cur = [w]
        else:
            cur.append(w)
    if cur:
        lines.append(" ".join(cur))
    return lines


def fit(draw, text: str, kind: str, fonts: dict[str, Path], max_w: float, max_h: float, *, start: int, floor: int, max_lines: int = 3):
    """The biggest size at which the text fits the box in at most max_lines."""
    size = start
    while size >= floor:
        font = _load_font(kind, size, fonts)
        lines = wrap(draw, text, font, max_w, kind == "arabic")
        line_h = size * 1.18
        if len(lines) <= max_lines and len(lines) * line_h <= max_h and all(_width(draw, ln, font, kind == "arabic") <= max_w for ln in lines):
            return font, lines, line_h
        size -= 6
    font = _load_font(kind, floor, fonts)
    return font, wrap(draw, text, font, max_w, kind == "arabic")[:max_lines], floor * 1.18


def draw_lines(draw, lines: list[str], font, *, x: float, y: float, w: float, line_h: float, rtl: bool, fill=NOIR) -> None:
    for i, ln in enumerate(lines):
        shaped, kw = _shape(ln, rtl)
        yy = y + i * line_h
        if rtl:
            draw.text((x + w, yy), shaped, font=font, fill=fill, anchor="ra", **kw)
        else:
            draw.text((x, yy), shaped, font=font, fill=fill, anchor="la", **kw)


def _fill(frame_path: Path, size: tuple[int, int], centering=(0.5, 0.35)):
    from PIL import Image, ImageOps

    img = Image.open(frame_path).convert("RGB")
    return ImageOps.fit(img, size, method=Image.LANCZOS, centering=centering)


def _stage(frame_path: Path, W: int, H: int, rtl: bool):
    """The frame on a 16:9 stage.

    A landscape frame fills it, kept high so a head is never cut. A portrait
    frame (a reel) is never stretched or cropped to a strip: it stands whole
    at full height on the side the text leaves free, over a blurred, darkened
    copy of itself, the way a broadcast pillarboxes a phone clip.
    """
    from PIL import Image, ImageFilter, ImageOps

    src = Image.open(frame_path).convert("RGB")
    if src.height <= src.width:
        return ImageOps.fit(src, (W, H), method=Image.LANCZOS, centering=(0.35 if rtl else 0.65, 0.28))
    stage = ImageOps.fit(src, (W, H), method=Image.LANCZOS, centering=(0.5, 0.3)).filter(ImageFilter.GaussianBlur(26))
    stage = Image.blend(stage, Image.new("RGB", (W, H), MIDNIGHT), 0.55)
    scale = H / src.height
    portrait = src.resize((max(1, int(src.width * scale)), H), Image.LANCZOS)
    free_w = W - int(W * 0.47)
    x = (0 if rtl else W - free_w) + max(0, (free_w - portrait.width) // 2)
    stage.paste(portrait, (x, 0))
    return stage


def _to_jpeg(img, *, max_bytes: int = 1_900_000) -> bytes:
    for q in (92, 86, 80, 74, 68, 60):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
        if buf.tell() <= max_bytes:
            return buf.getvalue()
    return buf.getvalue()


def render_youtube(frame_path: Path, text: str, *, fonts: Optional[dict[str, Path]] = None, log: Callable[[str], None] = lambda m: None) -> bytes:
    """1280x720. The frame fills; a Midnight field takes one side; the line
    sits in Noir on a Pearl block with an Ocean rule. Right-handed for
    Arabic, left-handed for English."""
    from PIL import Image, ImageDraw

    fonts = fonts or ensure_fonts(log)
    W, H = 1280, 720
    rtl = is_arabic(text)
    img = _stage(frame_path, W, H, rtl)
    field_w = int(W * 0.47)
    # A soft field so the frame is still Aziz, not a wallpaper.
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    x0 = W - field_w if rtl else 0
    od.rectangle([x0, 0, x0 + field_w, H], fill=MIDNIGHT + (226,))
    fade_w = 110
    for i in range(fade_w):
        a = int(226 * (1 - i / fade_w))
        xx = (x0 - 1 - i) if rtl else (x0 + field_w + i)
        od.line([(xx, 0), (xx, H)], fill=MIDNIGHT + (a,))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)
    pad = 48
    box_x = x0 + pad
    box_w = field_w - 2 * pad
    kind = "arabic" if rtl else "latin"
    font, lines, line_h = fit(draw, text, kind, fonts, box_w - 2 * 28, H * 0.62, start=118, floor=56, max_lines=3)
    text_h = len(lines) * line_h
    block_h = int(text_h + 2 * 28)
    block_y = int((H - block_h) / 2)
    draw.rectangle([box_x, block_y, box_x + box_w, block_y + block_h], fill=PEARL)
    # The rule on the outer edge, the one small gesture in Ocean.
    if rtl:
        draw.rectangle([box_x + box_w - 8, block_y, box_x + box_w, block_y + block_h], fill=OCEAN)
    else:
        draw.rectangle([box_x, block_y, box_x + 8, block_y + block_h], fill=OCEAN)
    inner_x = box_x + 28 + (0 if rtl else 8)
    inner_w = box_w - 2 * 28 - 8
    draw_lines(draw, lines, font, x=inner_x, y=block_y + 28 - line_h * 0.08, w=inner_w, line_h=line_h, rtl=rtl)
    return _to_jpeg(img)


def render_cover(frame_path: Path, text: str, *, fonts: Optional[dict[str, Path]] = None, log: Callable[[str], None] = lambda m: None) -> bytes:
    """1080x1920 reel cover: the frame, a Midnight fall-off at the foot and
    the line on a Pearl block in the lower third, where the grid crops least."""
    from PIL import Image, ImageDraw

    fonts = fonts or ensure_fonts(log)
    W, H = 1080, 1920
    rtl = is_arabic(text)
    img = _fill(frame_path, (W, H), centering=(0.5, 0.3)).convert("RGBA")
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    top = int(H * 0.52)
    for yy in range(top, H):
        a = int(210 * ((yy - top) / (H - top)) ** 1.4)
        od.line([(0, yy), (W, yy)], fill=MIDNIGHT + (a,))
    img = Image.alpha_composite(img, overlay).convert("RGB")
    draw = ImageDraw.Draw(img)
    pad = 72
    box_w = W - 2 * pad
    kind = "arabic" if rtl else "latin"
    font, lines, line_h = fit(draw, text, kind, fonts, box_w - 2 * 36, H * 0.22, start=132, floor=64, max_lines=3)
    block_h = int(len(lines) * line_h + 2 * 36)
    block_y = int(H * 0.72 - block_h / 2)
    draw.rectangle([pad, block_y, pad + box_w, block_y + block_h], fill=PEARL)
    draw.rectangle([pad, block_y + block_h - 10, pad + box_w, block_y + block_h], fill=OCEAN)
    draw_lines(draw, lines, font, x=pad + 36, y=block_y + 36 - line_h * 0.08, w=box_w - 2 * 36, line_h=line_h, rtl=rtl)
    return _to_jpeg(img, max_bytes=7_500_000)


def sharpness(path: Path) -> float:
    """How much edge there is: a still, focused face scores high, a motion-blurred pan low."""
    from PIL import Image, ImageFilter, ImageStat

    img = Image.open(path).convert("L")
    img.thumbnail((400, 400))
    edges = img.filter(ImageFilter.FIND_EDGES)
    return float(ImageStat.Stat(edges).stddev[0])
