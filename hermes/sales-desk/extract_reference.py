#!/usr/bin/env python3
"""Lift a finished proposal's deal out of its HTML, to use as the drafter's reference.

    python3 extract_reference.py <proposal.html> <out.json>

The deal sits in the document between the /* @data-start */ and
/* @data-end */ markers as `const PROPOSAL = {...};`. A built document holds
it as JSON; the template itself holds a JavaScript object (bare keys,
comments, trailing commas), and this reads both.

What comes out is a real client's proposal, so it goes on the VPS and never
into git: ~/.sales-desk/reference/<variant>.json, mode 600, where the desk
finds it by the variant it is. Two things are taken out on the way, because
the drafter would copy them: the `quotes` block, which no longer renders and
fails the gate, and embedded images, which are kilobytes of base64.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

DATA_BLOCK = re.compile(r"/\* @data-start \*/(.*?)/\* @data-end \*/", re.DOTALL)
IDENT = re.compile(r"[A-Za-z_$][\w$]*")


def strip_comments(src: str) -> str:
    """Remove // and /* */ comments, leaving anything inside a string alone."""
    out: list[str] = []
    i, n, quote = 0, len(src), ""
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(src[i + 1])
                i += 2
                continue
            if c == quote:
                quote = ""
            i += 1
            continue
        if c in "\"'`":
            quote = c
            out.append(c)
            i += 1
            continue
        if src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j == -1 else j
            continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            i = n if j == -1 else j + 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def js_to_json(src: str) -> str:
    """A JavaScript object literal as JSON: keys quoted, single-quoted strings
    turned double, trailing commas dropped, undefined as null."""
    src = strip_comments(src)
    out: list[str] = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in "\"'":
            j, buf = i + 1, []
            while j < n and src[j] != c:
                if src[j] == "\\" and j + 1 < n:
                    pair = src[j:j + 2]
                    buf.append("'" if pair == "\\'" else pair)
                    j += 2
                    continue
                buf.append('\\"' if (src[j] == '"' and c == "'") else src[j])
                j += 1
            out.append('"' + "".join(buf) + '"')
            i = j + 1
            continue
        m = IDENT.match(src, i)
        if m:
            word = m.group(0)
            k = m.end()
            while k < n and src[k].isspace():
                k += 1
            if k < n and src[k] == ":" and word not in ("true", "false", "null"):
                out.append('"' + word + '"')
            else:
                out.append("null" if word == "undefined" else word)
            i = m.end()
            continue
        if c == ",":
            k = i + 1
            while k < n and src[k].isspace():
                k += 1
            if k < n and src[k] in "}]":
                i += 1
                continue
        out.append(c)
        i += 1
    return "".join(out)


def extract(html_text: str) -> dict[str, Any]:
    m = DATA_BLOCK.search(html_text)
    if not m:
        raise ValueError("there is no /* @data-start */ ... /* @data-end */ block in that file")
    block = m.group(1)
    start, end = block.find("{"), block.rfind("}")
    if start == -1 or end < start:
        raise ValueError("the data block holds no object")
    body = block[start:end + 1]
    try:
        deal = json.loads(body)
    except ValueError:
        deal = json.loads(js_to_json(body))
    if not isinstance(deal, dict):
        raise ValueError("the data block is not an object")
    return deal


def _no_embedded_files(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _no_embedded_files(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_no_embedded_files(v) for v in value]
    if isinstance(value, str) and value.startswith("data:"):
        return None
    return value


def clean(deal: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    notes = []
    if deal.get("quotes"):
        notes.append(f"dropped quotes ({len(deal['quotes'])}): the block no longer renders and fails the gate")
    deal = {k: v for k, v in deal.items() if k != "quotes"}
    embedded = sum(1 for v in json.dumps(deal).split('"data:')[1:])
    if embedded:
        notes.append(f"dropped {embedded} embedded image(s)")
    return _no_embedded_files(deal), notes


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    src, dst = Path(argv[0]), Path(argv[1])
    try:
        deal = extract(src.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"{src}: {e}", file=sys.stderr)
        return 1
    deal, notes = clean(deal)
    variant = str(deal.get("variant") or "specific").lower()
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(deal, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        os.chmod(dst, 0o600)
    except OSError:
        pass
    print(f"wrote {dst}: a {variant} proposal, {len(deal)} keys")
    for note in notes:
        print(f"  {note}")
    if dst.stem.lower() != variant:
        print(f"  the desk finds a reference by its variant first: ~/.sales-desk/reference/{variant}.json")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
