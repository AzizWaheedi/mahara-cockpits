"""Build a client proposal from the template plus a deal. (Ported from
Mahara-B2B proposals/build.py.)

Reads proposal-template.html, replaces the block between the @data-start and
@data-end markers with the deal, and writes one self-contained HTML file: a
closer opens it on their own laptop with nothing next to it, so every image
travels inside the file. The PDF is render.pdf's business.
"""
from __future__ import annotations

import base64
import copy
import io
import json
import mimetypes
import re
from pathlib import Path
from typing import Any

from .config import ROOT

TEMPLATE = ROOT / "proposal-template.html"
ASSETS = ROOT / "assets"
DATA_BLOCK = re.compile(r"/\* @data-start \*/.*?/\* @data-end \*/", re.DOTALL)
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}


class BuildError(RuntimeError):
    pass


def inline_images(value: Any, base: Path = ROOT) -> Any:
    """Replace image paths with data URIs so the built file stands alone.

    Only files under assets/ are ever read. The deal is written by a model
    from a stranger's call, and a path it made up must not be able to lift any
    other file on the box into a document that leaves it.
    """
    if isinstance(value, dict):
        return {k: inline_images(v, base) for k, v in value.items()}
    if isinstance(value, list):
        return [inline_images(v, base) for v in value]
    if isinstance(value, str) and Path(value).suffix.lower() in IMAGE_SUFFIXES and not value.startswith("data:"):
        path = (base / value).resolve()
        try:
            path.relative_to(ASSETS.resolve())
        except ValueError:
            return value
        if not path.is_file():
            return value
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return "data:%s;base64,%s" % (mime, base64.b64encode(path.read_bytes()).decode())
    return value


def qr_data_uri(url: str) -> Any:
    """A scannable code for a video or booking link, generated here rather than
    fetched: the document has to work from a laptop with no network. Needs
    segno; without it the QR stays a labelled frame."""
    try:
        import segno
    except ImportError:
        return None
    buf = io.BytesIO()
    segno.make(url, error="m").save(buf, kind="png", scale=10, border=1, dark="#091333", light="#ffffff")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def html(deal: dict[str, Any], *, standalone: bool = True, template: Path = TEMPLATE) -> str:
    data = copy.deepcopy(deal)
    media = data.get("media")
    # Only a real link becomes a code. A FILL placeholder stays a labelled
    # frame, the same way a missing photo does.
    if (isinstance(media, dict) and not media.get("image")
            and str(media.get("url") or "").startswith(("http://", "https://"))):
        uri = qr_data_uri(media["url"])
        if uri:
            media["image"] = uri
    if standalone:
        data = inline_images(data)
    source = Path(template).read_text(encoding="utf-8")
    if not DATA_BLOCK.search(source):
        raise BuildError("Could not find the @data-start / @data-end markers in the template.")
    # "<" is written as its escape, so nothing the model wrote can close the
    # script element it sits in. It is still the same JSON to anything reading it.
    payload = json.dumps(data, ensure_ascii=False, indent=2).replace("<", "\\u003c")
    block = "/* @data-start */\nconst PROPOSAL = " + payload + ";\n/* @data-end */"
    return DATA_BLOCK.sub(lambda _m: block, source, count=1)


def build(deal: dict[str, Any], out_html: Path, *, standalone: bool = True) -> Path:
    out_html = Path(out_html)
    out_html.parent.mkdir(parents=True, exist_ok=True)
    out_html.write_text(html(deal, standalone=standalone), encoding="utf-8")
    return out_html


def data_of(html_text: str) -> dict[str, Any]:
    """The deal inside a built document, the inverse of html()."""
    m = DATA_BLOCK.search(html_text)
    if not m:
        raise BuildError("no @data-start / @data-end block in that file")
    body = m.group(0)
    start, end = body.find("{"), body.rfind("}")
    return json.loads(body[start : end + 1])
