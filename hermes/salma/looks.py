"""How a client's pictures carry words, and how a picture is made to move.

Aziz, 2026-09-24. Two skills in mahara-context say what the looks are:
`clickable-carousels` (bold teaching covers, after Marketing Harry) and
`architecture-showcase` (project posts, after @imperium.uae and
@dusk.arch). A client has one look:

- bold: GPT Image draws the words into the picture itself, because the
  words are part of the idea (a headline on a wall of sand). Arabic came
  out letter-perfect in 7 of 8 tests; every picture is read back anyway.
- showcase: the picture is drawn clean and the words are set here, in
  Amiri and Cormorant Garamond with real Arabic shaping (raqm), on a layer.
  They cannot be misspelt, a typo is fixed without drawing again, and the
  same layer sits still on top of a moving picture.
- plain: pictures only, the way Salma drew before words existed.

Nothing here calls the network. salma.py does that and hands the bytes in.
"""
from __future__ import annotations

import io
import os
import re
import unicodedata

LOOKS = ("bold", "showcase", "plain")
DEFAULT_LOOK = "bold"

FONT_DIR = os.environ.get("SALMA_FONT_DIR") or os.path.expanduser("~/.local/share/fonts/salma")
AMIRI_BOLD = "Amiri-Bold.ttf"
AMIRI = "Amiri-Regular.ttf"
CORMORANT = "CormorantGaramond-Variable.ttf"

# Warm white, as the villa test drew it (251, 238, 227), a touch softer;
# and near-black for a picture that is bright where the words sit.
INK = (246, 239, 230)
INK_DARK = (22, 20, 18)


def tone_of(picture: bytes | None, size: tuple[int, int]) -> str:
    """Light words on a dark picture, dark words on a bright one: judged on
    the band where the title sits, the way a designer would squint at it."""
    if not picture:
        return "light"
    from PIL import Image, ImageOps, ImageStat

    img = ImageOps.fit(Image.open(io.BytesIO(picture)).convert("L"), size)
    w, h = size
    band = img.crop((int(0.1 * w), 0, int(0.9 * w), int(0.3 * h)))
    return "dark" if ImageStat.Stat(band).mean[0] > 150 else "light"


def look_of(client: dict | None) -> str:
    look = str((client or {}).get("look") or "").strip().lower()
    return look if look in LOOKS else DEFAULT_LOOK


# ---------------------------------------------------------------------------
# Reading the words back

_ARABIC = re.compile(r"[؀-ۿ]")
_MARKS = re.compile(r"[ـ‌-‏‪-‮⁦-⁩]")  # tatweel, joiners, bidi
_PUNCT = re.compile(r"[\s\"'«»“”‘’`.,،؛;:!?؟…()\[\]{}\-_·•|/\\]+")


def has_arabic(text: str) -> bool:
    return bool(_ARABIC.search(text or ""))


def fold(text: str) -> str:
    """The letters as drawn, for comparing: no spacing, punctuation, tatweel
    or direction marks, Latin lower-cased. Harakat stay: a shadda where two
    letters should be is exactly the slip the read-back exists to catch."""
    t = unicodedata.normalize("NFC", text or "")
    # Readers write the Persian kaf and yeh for the Arabic ones; on the
    # picture they are the same letter.
    t = t.replace("\u06a9", "\u0643").replace("\u06cc", "\u064a")
    t = _MARKS.sub("", t)
    t = _PUNCT.sub("", t)
    return t.lower()


def words_match(expected: list[str], seen: str) -> tuple[bool, list[str]]:
    """Whether every expected line is on the picture, letter for letter.
    Returns the lines that are not."""
    got = fold(seen)
    missing = [line for line in expected if fold(line) and fold(line) not in got]
    return (not missing), missing


# ---------------------------------------------------------------------------
# The words a slide carries

def slide_lines(words: dict | None) -> list[str]:
    """What must be readable on the picture, in order."""
    w = words or {}
    out = [str(w.get(k) or "").strip() for k in ("headline", "title", "line")]
    return [x for x in out if x]


def clean_words(raw: dict | None, look: str) -> dict:
    """Keep the keys a look uses, trimmed. The words are client copy and
    arrive from a model or a person, so nothing else rides along."""
    keys = {"bold": ("headline", "line", "accent"),
            "showcase": ("title", "line", "cta", "handle")}.get(look, ())
    out = {}
    for k in keys:
        v = re.sub(r"\s+", " ", str((raw or {}).get(k) or "")).strip()
        v = re.sub(r"\s*[—–]\s*", " ", v)  # no em dashes, house rule
        if v:
            out[k] = v[:120]
    if look == "bold" and out.get("accent") and out["accent"] not in out.get("headline", ""):
        out.pop("accent")
    return out


# ---------------------------------------------------------------------------
# Prompts

def bold_prompt(scene: str, words: dict, *, client_line: str, handle: str = "",
                cover_anchor: bool = False, role: str = "cover") -> str:
    """The picture with its words drawn in, as the clickable-carousels
    skill writes it: exact words in quotes, where they sit, nothing else."""
    head = words.get("headline", "")
    line = words.get("line", "")
    accent = words.get("accent", "")
    arabic = has_arabic(head + line)
    script = ("right to left, perfectly connected Arabic script, every letter and every dot "
              "exactly as given" if arabic else "spelled exactly as given")
    face = "Arabic sans-serif" if arabic else "sans-serif"
    parts = [
        f"Instagram carousel {'cover' if role == 'cover' else 'slide'} for {client_line}. "
        "Editorial, high-contrast, scroll-stopping: one huge headline and one striking visual, "
        "nothing else competing.",
        f"Scene: {scene}",
        f"Text, exactly as written: {script}, no other words.",
        f'- Top 40% of the frame, centred, huge heavy {face} in near-black or white, '
        f'whichever reads best on the scene: "{head}"'
        + (f', with only the word "{accent}" in one loud accent colour.' if accent else "."),
    ]
    if line:
        parts.append(f'- Directly beneath it, much smaller, same colour: "{line}"')
    if handle:
        parts.append(f'- Very top edge: a hairline rule with the tiny Latin handle "{handle}" '
                     "at the left end.")
    parts.append("Keep every word well inside the frame, away from the edges.")
    if cover_anchor:
        parts.append("Image 1 is this carousel's cover: the same palette, light and type as "
                     "Image 1; change only the scene and the words.")
    parts.append("No logos, no watermarks, no extra text, no duplicate text.")
    return "\n".join(parts)


def showcase_prompt(scene: str, *, cover_anchor: bool = False) -> str:
    """A clean render: the words are set afterwards, so none are drawn."""
    tail = (" Image 1 is this project's cover: the same building, materials, palette and light."
            if cover_anchor else "")
    return (f"{scene}{tail}\nKeep the upper third calm for a title and the bottom edge calm for "
            "a thin footer. No text, no letters, no logos, no signage, no watermarks.")


def motion_prompt(shot: dict) -> str:
    """Kling's prompt for a still that moves a little. The words are laid
    on afterwards, so they are never mentioned."""
    camera = str(shot.get("camera") or "").strip() or "A slow, smooth, steady dolly-in"
    person = str(shot.get("person") or "").strip()
    motion = str(shot.get("motion") or "").strip()
    bits = [camera.rstrip(".") + "."]
    if person:
        bits.append(person.rstrip(".") + ".")
    if motion:
        bits.append(motion.rstrip(".") + ".")
    bits.append("The architecture, straight lines, materials and lighting stay exactly as they "
                "are; nothing morphs or warps. No text.")
    return " ".join(bits)


# ---------------------------------------------------------------------------
# Setting the words (showcase)

def _font(name: str, size: int, weight: str | None = None):
    from PIL import ImageFont

    path = os.path.join(FONT_DIR, name)
    if not os.path.exists(path):
        raise RuntimeError(
            f"The font {name} is missing on the server ({FONT_DIR}), so words cannot be set.")
    raqm = ImageFont.Layout.RAQM if _raqm() else ImageFont.Layout.BASIC
    f = ImageFont.truetype(path, size, layout_engine=raqm)
    if weight:
        try:
            f.set_variation_by_name(weight)
        except Exception:  # noqa: BLE001 - a static face has no named weights
            pass
    return f


def _raqm() -> bool:
    try:
        from PIL import features

        return bool(features.check("raqm"))
    except Exception:  # noqa: BLE001
        return False


def fonts_ready() -> tuple[bool, str]:
    missing = [n for n in (AMIRI_BOLD, AMIRI, CORMORANT) if not os.path.exists(os.path.join(FONT_DIR, n))]
    if missing:
        return False, f"missing fonts in {FONT_DIR}: {', '.join(missing)}"
    if not _raqm():
        return False, "Pillow here has no raqm, so Arabic letters would not join"
    return True, ""


def _dir(text: str) -> dict:
    return {"direction": "rtl", "language": "ar"} if has_arabic(text) else {}


def _width(font, text: str, tracking: float = 0.0) -> float:
    if tracking and not has_arabic(text):
        return sum(font.getlength(ch) for ch in text) + tracking * max(0, len(text) - 1)
    return font.getlength(text, **_dir(text))


def _draw(d, xy, text: str, font, *, anchor: str, tracking: float = 0.0, fill=INK) -> None:
    """Draw a line; Latin may be tracked (letter by letter), Arabic never is:
    spacing Arabic letters apart breaks the joins."""
    if not tracking or has_arabic(text):
        d.text(xy, text, font=font, fill=fill, anchor=anchor, **_dir(text))
        return
    total = _width(font, text, tracking)
    x, y = xy
    if anchor[0] == "m":
        x -= total / 2
    elif anchor[0] == "r":
        x -= total
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill, anchor="l" + anchor[1])
        x += font.getlength(ch) + tracking


def _fit(name: str, text: str, size: int, max_w: float, *, weight=None, tracking_em: float = 0.0):
    """The largest size up to `size` at which the line fits `max_w`."""
    s = size
    while s > 12:
        f = _font(name, s, weight)
        if _width(f, text, tracking_em * s) <= max_w:
            return f, tracking_em * s
        s = int(s * 0.92)
    f = _font(name, s, weight)
    return f, tracking_em * s


def _wrap(name: str, text: str, size: int, max_w: float, lines: int = 2, weight=None):
    """Up to `lines` lines by whole words; the size shrinks when it must."""
    words = text.split()
    s = size
    while s > 12:
        f = _font(name, s, weight)
        out, cur = [], ""
        for w in words:
            trial = f"{cur} {w}".strip()
            if _width(f, trial) <= max_w or not cur:
                cur = trial
            else:
                out.append(cur)
                cur = w
        if cur:
            out.append(cur)
        if len(out) <= lines and all(_width(f, x) <= max_w for x in out):
            return f, out
        s = int(s * 0.92)
    return _font(name, s, weight), [text]


def _ramp(w: int, h: int, top: float, bottom: float, strength: float):
    """A soft dark fade behind the words: `top` of the frame from above,
    `bottom` of it from below. An eased ramp, never a visible band."""
    from PIL import Image

    col = Image.new("L", (1, h), 0)
    px = col.load()
    for y in range(h):
        a = 0.0
        t = y / h
        if t < top:
            a = max(a, (1 - t / top) ** 1.6)
        if t > 1 - bottom:
            a = max(a, ((t - (1 - bottom)) / bottom) ** 1.6)
        px[0, y] = int(255 * strength * a)
    return col.resize((w, h))


def render_layer(words: dict, size: tuple[int, int], backdrop: bytes | None = None) -> bytes:
    """The showcase words as a transparent PNG at exactly `size`.

    Title in Amiri Bold, centred in the upper third; the line under it (in
    widely spaced Cormorant capitals when it is Latin, Amiri when Arabic);
    a footer like a drawing's title block: a hairline, the offer on the
    right, the handle on the left. A soft fade behind both keeps them
    legible on a bright sky or a white wall.
    """
    from PIL import Image, ImageDraw

    w, h = size
    title = str(words.get("title") or "").strip()
    line = str(words.get("line") or "").strip()
    cta = str(words.get("cta") or "").strip()
    handle = str(words.get("handle") or "").strip()
    # Every Instagram shape is 1080 wide, so sizes follow the width -- except
    # a wide frame (1.91:1), where they follow the height or the title
    # would fill the middle of the picture.
    unit = w * min(1.0, (h / w) / 0.8)
    margin = 0.055 * w
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    has_top = bool(title or line)
    has_foot = bool(cta or handle)
    dark = tone_of(backdrop, size) == "dark"
    ink = INK_DARK if dark else INK
    fade = _ramp(w, h, 0.40 if has_top else 0.0001, 0.20 if has_foot else 0.0001,
                 0.50 if dark else 0.55)
    # A dark veil behind light words, a light one behind dark words.
    shade = Image.new("RGBA", (w, h), (250, 247, 242, 255) if dark else (0, 0, 0, 255))
    shade.putalpha(fade)
    layer.alpha_composite(shade)
    d = ImageDraw.Draw(layer)

    # The top: title and line, or a line alone as a heading.
    tall = h > w * 1.5  # a Reel: the title can be bigger, the frame is long
    y = 0.085 * h if h > w * 1.1 else 0.075 * h
    if title:
        f, _ = _fit(AMIRI_BOLD, title, int((0.135 if tall else 0.115) * unit), w - 2 * margin * 1.5)
        _draw(d, (w / 2, y), title, f, anchor="ma", fill=ink)
        y += (f.getbbox(title, **_dir(title))[3]) + 0.018 * h
    if line:
        if has_arabic(line):
            f, rows = _wrap(AMIRI if title else AMIRI_BOLD, line,
                            int((0.042 if title else 0.062) * unit), w - 2 * margin * 1.5)
            for r in rows:
                _draw(d, (w / 2, y), r, f, anchor="ma", fill=ink)
                y += f.size * 1.35
        else:
            caps = line.upper()
            f, track = _fit(CORMORANT, caps, int((0.034 if tall else 0.031) * unit), w - 2 * margin * 1.5,
                            weight=b"SemiBold", tracking_em=0.32)
            _draw(d, (w / 2, y), caps, f, anchor="ma", tracking=track, fill=ink)

    # The footer, like the title block of a drawing sheet.
    if has_foot:
        base = h - 0.045 * h if h > w * 1.1 else h - 0.05 * h
        rule_y = base - 0.058 * unit
        d.line([(margin, rule_y), (w - margin, rule_y)], fill=ink + (110,), width=max(1, round(w / 1080)))
        if cta:
            f, _ = _fit(AMIRI, cta, int(0.031 * unit), (w - 2 * margin) * 0.6)
            _draw(d, (w - margin, base), cta, f, anchor="rs", fill=ink)
        if handle:
            f, track = _fit(CORMORANT, handle, int(0.029 * unit), (w - 2 * margin) * 0.38,
                            weight=b"Medium", tracking_em=0.06)
            _draw(d, (margin, base), handle, f, anchor="ls", tracking=track, fill=ink)
    out = io.BytesIO()
    layer.save(out, "PNG", optimize=True)
    return out.getvalue()


def compose(picture: bytes, layer_png: bytes | None, size: tuple[int, int]) -> bytes:
    """The picture trimmed to `size` from the centre, the words on top, as a JPEG."""
    from PIL import Image, ImageOps

    img = ImageOps.exif_transpose(Image.open(io.BytesIO(picture))).convert("RGB")
    img = ImageOps.fit(img, size, Image.LANCZOS, centering=(0.5, 0.5)).convert("RGBA")
    if layer_png:
        top = Image.open(io.BytesIO(layer_png)).convert("RGBA")
        if top.size != size:
            top = top.resize(size, Image.LANCZOS)
        img.alpha_composite(top)
    out = io.BytesIO()
    img.convert("RGB").save(out, "JPEG", quality=90, optimize=True)
    return out.getvalue()


# ---------------------------------------------------------------------------
# Motion: the video under the words

def ffmpeg_args(video: str, layer: str | None, out: str, size: tuple[int, int], *,
                pad: bool = False) -> list[str]:
    """Fill `size` from the model's video (trim, or pad on a blurred copy of
    itself when `pad`, for a photo that must not be invented around), then
    the words layer, then H.264 that Instagram takes."""
    w, h = size
    if pad:
        base = (f"[0:v]split[a][b];[a]scale={w}:{h}:force_original_aspect_ratio=increase:"
                f"flags=lanczos,crop={w}:{h},gblur=sigma=40,eq=brightness=-0.08[bg];"
                f"[b]scale={w}:{h}:force_original_aspect_ratio=decrease:flags=lanczos[fg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]")
    else:
        base = (f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,"
                f"crop={w}:{h},setsar=1[v]")
    graph = base + (";[v][1:v]overlay=0:0:format=auto,format=yuv420p[o]" if layer
                    else ";[v]format=yuv420p[o]")
    args = ["ffmpeg", "-v", "error", "-y", "-i", video]
    if layer:
        args += ["-i", layer]
    return args + ["-filter_complex", graph, "-map", "[o]", "-c:v", "libx264", "-preset", "slow",
                   "-crf", "18", "-r", "24", "-movflags", "+faststart", "-an", out]
