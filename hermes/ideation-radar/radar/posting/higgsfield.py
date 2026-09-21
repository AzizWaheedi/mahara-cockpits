"""Reel covers through Higgsfield, the way Aziz wants every banner made
(handover of 2026-09-13, "banner-agent-prompt.md"): a photo compositing
job on nano_banana_pro that cuts Aziz out of a real frame unchanged and
sets the two-line Arabic headline over the house background. Never a
hand composite, never another generator: when Higgsfield is not signed
in, out of credits or failing, the cover stays empty and the post says why.

The CLI on the machine holds the sign-in (`higgsfield auth login`, stored
under ~/.higgsfield). This module shells out to it, waits for the job,
downloads the result and hands back JPEG bytes for the bucket."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import urllib.request
from pathlib import Path
from typing import Any, Callable, Optional

MODEL = "nano_banana_pro"
WAIT_TIMEOUT = "8m"

# The prompt skeleton from the handover, verbatim apart from the bracketed
# parts. The compositing language is what keeps his face real.
PROMPT = """This is a PHOTO COMPOSITING task, not an image generation task. Treat the man in the reference photo as a fixed photographic asset. Cut him out from his background exactly as photographed and paste him unchanged into a new vertical layout. Do not generate, redraw, restyle, smooth, retouch or reinterpret any part of him. Preserve the original photographic grain, skin texture, lighting on his face, his exact facial features, moustache, hair, pose, watch and clothing at 100 percent fidelity. He must look like a real photo cutout pasted onto a designed background.

Remove everything in front of him and around him: no desk, no table, no microphone, no microphone stand, no cables, no book, no sculpture, no lamp, no plants, no shelves. He floats cleanly on the background, cut off at the chest with a soft fade at the bottom edge.

LAYOUT: vertical frame, the man on the {side} side occupying the lower {side} portion, scaled large.

BACKGROUND: deep navy blue #050b1f to #0d1f42 gradient with a faint dark blue grid texture and a soft teal glow low behind him. Nothing else.

TEXT: across the top, centered, bold Arabic headline in heavy rounded Arabic sans-serif with generous line spacing. Line one in solid white: {line1}.{line2_clause} Arabic must be perfectly connected right to left script, letter accurate. No quotation marks, no guillemets, no brackets, no arrows, no punctuation.

GRAPHIC ELEMENT: {graphic}. Keep this graphic small, subtle and low contrast so the headline and the man remain dominant.

No logos, no borders, no watermarks, no captions, no additional text."""

DEFAULT_GRAPHIC = "one small minimal neon teal line-art visual that argues the video's point, such as one upward arrow rising cleanly from a baseline next to three faint dim grey arrows trailing downward and fading out"

_URL = re.compile(r"https?://[^\s\"'<>]+")


def clean_line(s: str) -> str:
    """A headline line as the model must paint it: bare words, no marks."""
    return re.sub(r"[«»\"'“”‘’\[\]()<>→←↑↓|]+", " ", str(s or "")).replace("—", " ").strip()


def cli_path() -> Optional[str]:
    """The higgsfield command: on the PATH, or the user install under ~/.local/bin (cron has a short PATH)."""
    found = shutil.which("higgsfield")
    if found:
        return found
    local = Path.home() / ".local" / "bin" / "higgsfield"
    return str(local) if local.exists() else None


def available() -> tuple[bool, str]:
    """Whether this machine can generate: the CLI on the path and a sign-in on disk."""
    if not cli_path():
        return False, "the higgsfield command is not installed on this machine"
    homes = [Path.home() / ".config" / "higgsfield", Path.home() / ".higgsfield"]
    if not any((h / "credentials.json").exists() for h in homes):
        return False, "Higgsfield is not signed in on this machine (higgsfield auth login)"
    return True, ""


def compose_prompt(lines: list[str], *, graphic: Optional[str] = None, side: str = "right") -> str:
    l1 = clean_line(lines[0] if lines else "")
    l2 = clean_line(lines[1] if len(lines) > 1 else "")
    g = clean_line(graphic or "") or DEFAULT_GRAPHIC
    # One line on the cover is allowed: the teal sentence is left out rather
    # than sent empty, which the model would paint as a stray mark.
    line2_clause = f" Line two directly beneath in bright teal #00CFC8 with a soft neon glow: {l2}." if l2 else ""
    return PROMPT.format(side="left" if side == "left" else "right", line1=l1, line2_clause=line2_clause, graphic=g)


_RESULT_KEYS = ("output_url", "image_url", "download_url", "min_result_url")
# The CLI's JSON lists the uploaded reference under params.input_images[].url
# before result_url. Reading the first "url" handed back the raw frame as the
# cover once (2026-09-21), so anything under these keys is never a result.
_INPUT_KEYS = ("params", "input_images", "input_image", "image_references", "references", "inputs")


def _result_urls(stdout: str) -> list[str]:
    """The result links the CLI printed, best first: result_url, then the other result keys, never an input."""
    text = stdout.strip()
    try:
        data: Any = json.loads(text)
    except Exception:
        data = None
    ranked: list[tuple[int, str]] = []

    def walk(x: Any) -> None:
        if isinstance(x, dict):
            for k, v in x.items():
                key = k.lower()
                if key in _INPUT_KEYS:
                    continue
                if isinstance(v, str) and _URL.match(v):
                    if key == "result_url":
                        ranked.append((0, v))
                    elif key in _RESULT_KEYS:
                        ranked.append((1, v))
                    elif key in ("url", "uri"):
                        ranked.append((2, v))
                else:
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    if data is not None:
        walk(data)
    urls = [u for _, u in sorted(ranked, key=lambda t: t[0])]
    if not urls:
        for m in _URL.finditer(text):
            u = m.group(0).rstrip(".,;)")
            if re.search(r"\.(png|jpe?g|webp)(\?|$)", u, re.I) or "cloudfront" in u or "higgsfield" in u:
                urls.append(u)
    seen: set[str] = set()
    out: list[str] = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def generate_cover(frame_path: Path, lines: list[str], *, graphic: Optional[str] = None, side: str = "right", log: Callable[[str], None] = lambda m: None, timeout: float = 600) -> bytes:
    """The cover as JPEG bytes, or an exception that says why Higgsfield could not."""
    ok, why = available()
    if not ok:
        raise RuntimeError(f"Higgsfield blocked: {why}")
    prompt = compose_prompt(lines, graphic=graphic, side=side)
    cmd = [
        cli_path() or "higgsfield", "generate", "create", MODEL,
        "--image-references", str(frame_path),
        "--aspect-ratio", "9:16",
        "--resolution", "2k",
        "--prompt", prompt,
        "--wait", "--wait-timeout", WAIT_TIMEOUT,
        "--json",
    ]
    log(f"higgsfield: {MODEL}, lines {lines[:2]}")
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False, stdin=subprocess.DEVNULL)
    out = (res.stdout or "") + "\n" + (res.stderr or "")
    if res.returncode != 0:
        tail = re.sub(r"\s+", " ", out).strip()[-300:]
        raise RuntimeError(f"Higgsfield blocked: the generation failed ({tail})")
    urls = _result_urls(out)
    if not urls:
        raise RuntimeError("Higgsfield blocked: the job finished but printed no result link")
    req = urllib.request.Request(urls[0], headers={"User-Agent": "Mahara posting desk"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    if len(data) < 10_000:
        raise RuntimeError("Higgsfield blocked: the result file is empty")
    from . import thumbs
    return thumbs.instagram_image(data)
