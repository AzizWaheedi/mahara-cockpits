#!/usr/bin/env python3
"""Turn Aziz's call frameworks (Google Docs) into the sales cockpit's scripts.

The docs follow their own formatting rule, which is what makes them
machine-readable:

- Intro Call Framework (setter): "Highlighted text = what you say out loud.
  Regular text = context / internal notes." Branches are bold-italic lines
  that start with "If".
- Sales Call Framework (closer): "Highlighted text = say this verbatim.
  Bold text = say this (adapt to your style). Regular text = context for you.
  Italic text = internal notes, don't say out loud."

The input is the annotated text export of a document (one line per
paragraph, `[[HL:#color]]…[[/HL]]` for highlight, `**…**` bold, `_…_`
italic, `<HEADING_n>` for headings, `TAB <name>` between tabs), made by
`gdoc_fmt.py` from the Docs API. The output is one JSON document per
(script, language) with stages, blocks and exit checklists, plus the
objection and FAQ playbooks.

Usage: parse.py <annotated.txt> <key: intro|demo> <out_dir>
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HL = re.compile(r"\[\[HL:[^\]]*\]\](.*?)\[\[/HL\]\]", re.S)
STAGE = re.compile(r"^\s*(\d{1,2})\s*[·:.\-]\s*(.+?)\s*$")
SEPARATOR = re.compile(r"^[━─—=_\-\s]{8,}$")


def strip_marks(s: str) -> str:
    """Drop the bold/italic/highlight markers, keep the words."""
    s = HL.sub(lambda m: m.group(1), s)
    s = s.replace("**", "")
    s = re.sub(r"(?<!\w)_(.+?)_(?!\w)", r"\1", s)
    return re.sub(r"\s+", " ", s).strip()


def is_italic(raw: str) -> bool:
    t = raw.strip().replace("**", "")
    return len(t) > 2 and t.startswith("_") and t.endswith("_")


def is_bold(raw: str) -> bool:
    t = raw.strip()
    return len(t) > 4 and t.startswith("**") and t.endswith("**") and "[[HL" not in t


def branch_label(raw: str) -> str | None:
    """'If …:' lines, bold and/or italic, are the doc's branches."""
    t = strip_marks(raw)
    if not re.match(r"^(if|when|once|after they)\b", t, re.I):
        return None
    head, colon, _ = t.partition(":")
    # "If camera is off: Wait let me fix this…" carries the words after the
    # colon; a label on its own line ends with the colon. Either way the label
    # itself is short.
    if colon and len(head) <= 140:
        return t
    if not colon and len(t) <= 140:
        return t
    return None


def split_tabs(text: str) -> dict[str, list[str]]:
    tabs: dict[str, list[str]] = {}
    name = "main"
    for line in text.splitlines():
        m = re.match(r"^TAB (.+)$", line.strip())
        if m:
            name = m.group(1).strip()
            tabs[name] = []
            continue
        if line.strip().startswith("====="):
            continue
        tabs.setdefault(name, []).append(line)
    return tabs


def parse_framework(lines: list[str], style: str) -> dict:
    """style: 'intro' (bold = note) or 'demo' (bold = say in your words)."""
    doc: dict = {"title": None, "intro": [], "stages": []}
    stage: dict | None = None
    section: dict | None = None  # a non-numbered H2 such as Pre-Call Check
    branch: str | None = None
    pending_bullets: list[str] = []

    def target() -> dict:
        return stage if stage is not None else (section if section is not None else {"blocks": doc["intro"]})

    def flush_bullets(as_checklist: bool) -> None:
        nonlocal pending_bullets
        if not pending_bullets:
            return
        t = target()
        if as_checklist and stage is not None:
            stage["checklist"].extend(pending_bullets)
        else:
            t.setdefault("blocks", []).append({"type": "list", "items": pending_bullets, "branch": branch})
        pending_bullets = []

    def add(block: dict) -> None:
        flush_bullets(False)
        t = target()
        if branch and block["type"] in ("say", "adapt", "note"):
            block["branch"] = branch
        t.setdefault("blocks", []).append(block)

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            continue
        if SEPARATOR.match(strip_marks(line)) or line.strip().startswith("━"):
            flush_bullets(True)
            branch = None
            continue
        h = re.match(r"^<HEADING_(\d)>\s*(.*)$", line)
        if h:
            level, body = int(h.group(1)), h.group(2)
            words = strip_marks(body)
            if level == 1:
                doc["title"] = doc["title"] or words
                continue
            if level == 2:
                flush_bullets(True)
                branch = None
                m = STAGE.match(words)
                if m:
                    stage = {"no": int(m.group(1)), "title": m.group(2).strip(), "goal": None,
                             "minutes": None, "blocks": [], "checklist": []}
                    doc["stages"].append(stage)
                    section = None
                elif words:
                    stage = None
                    section = {"title": words, "blocks": []}
                    doc.setdefault("sections", []).append(section)
                continue
            # H3: a sub-step. Some carry a spoken line inside the heading.
            if HL.search(body):
                add({"type": "say", "text": strip_marks(body)})
                continue
            if not words:
                continue
            flush_bullets(False)
            branch = None
            lab = branch_label(body)
            if lab and lab.endswith(":"):
                branch = lab.rstrip(":")
                continue
            add({"type": "step", "text": words.rstrip(":")})
            continue

        words = strip_marks(line)
        if not words:
            continue
        # GOAL / TIME lines of a stage.
        g = re.match(r"^GOAL\s*:\s*(.+)$", words, re.I)
        if g and stage is not None and not stage["goal"]:
            stage["goal"] = g.group(1).strip()
            continue
        t = re.match(r"^TIME\s*:\s*(\d+)(?:\s*[–-]\s*(\d+))?\s*min", words, re.I)
        if t and stage is not None:
            stage["minutes"] = int(t.group(2) or t.group(1))
            continue
        # Bullets.
        if re.match(r"^\s*[-•*]\s+", line) and "[[HL" not in line:
            pending_bullets.append(re.sub(r"^[-•*]\s+", "", words))
            continue
        flush_bullets(False)
        # Spoken, word for word.
        if HL.search(line):
            said = " ".join(strip_marks(m) for m in HL.findall(line))
            rest = strip_marks(HL.sub("", line))
            lab = branch_label(rest) if rest else None
            if lab:
                branch = lab.rstrip(":")
            add({"type": "say", "text": said})
            continue
        # Branch labels.
        lab = branch_label(line)
        if lab and (is_bold(line) or is_italic(line) or line.strip().startswith("**") or style == "demo"):
            head, _, tail = lab.partition(":")
            if is_italic(line):
                # An internal note that happens to start with "If": keep it a note
                # under its own label.
                branch = head.strip() if tail.strip() else lab.rstrip(":")
                if tail.strip():
                    add({"type": "note", "text": tail.strip()})
                continue
            branch = head.strip() if tail.strip() else lab.rstrip(":")
            if tail.strip():
                add({"type": "adapt" if style == "demo" else "note", "text": tail.strip()})
            continue
        if is_italic(line):
            add({"type": "note", "text": words})
            continue
        if is_bold(line):
            if style == "demo" and words.endswith(":") and len(words) < 70:
                # "Projects & Pricing:" is a sub-step of the stage, and the
                # main path starts again under it.
                branch = None
                add({"type": "step", "text": words.rstrip(":")})
                continue
            add({"type": "adapt" if style == "demo" else "note", "text": words})
            continue
        if style == "demo":
            # The closer's framework writes most spoken lines as plain text
            # (only 19 English paragraphs are highlighted). A plain line with
            # no "If" label is the main path again.
            branch = None
            add({"type": "adapt", "text": words})
            continue
        add({"type": "note", "text": words})
    flush_bullets(True)
    return doc


def parse_playbook(lines: list[str]) -> dict:
    """Objections and FAQs: each H2/H3 titled OBJECTION/FAQ or 'NN · "…"' opens an entry."""
    out = {"objections": [], "faqs": []}
    cur: dict | None = None
    kind = "objections"
    for raw in lines:
        line = raw.rstrip()
        if not line.strip() or line.strip().startswith("━"):
            continue
        h = re.match(r"^<HEADING_(\d)>\s*(.*)$", line)
        words = strip_marks(h.group(2) if h else line)
        if h and not words:
            continue
        if h:
            up = words.upper()
            if "FREQUENTLY ASKED" in up:
                kind = "faqs"
                cur = None
                continue
            if up.startswith("OBJECTIONS") or up.startswith("HOW TO USE"):
                cur = None
                continue
            m = re.match(r"^(?:OBJECTION\s*\d+\s*[·:.]|FAQ\s*\d+\s*[·:.]|\d{1,2}\s*[·.:])\s*(.+)$", words, re.I)
            if m:
                cur = {"title": m.group(1).strip(), "blocks": []}
                out[kind].append(cur)
                continue
            if cur is not None:
                if HL.search(h.group(2)):
                    cur["blocks"].append({"type": "say", "text": words})
                else:
                    cur["blocks"].append({"type": "step", "text": words.rstrip(":")})
            continue
        if cur is None:
            continue
        if HL.search(line):
            cur["blocks"].append({"type": "say", "text": " ".join(strip_marks(m) for m in HL.findall(line))})
        elif re.match(r"^\s*[-•*]\s+", line):
            cur["blocks"].append({"type": "list", "items": [re.sub(r"^[-•*]\s+", "", words)]})
        elif is_italic(line):
            cur["blocks"].append({"type": "note", "text": words})
        elif branch_label(line) and (is_bold(line) or is_italic(line)):
            cur["blocks"].append({"type": "step", "text": words.rstrip(":")})
        elif is_bold(line):
            cur["blocks"].append({"type": "adapt", "text": words})
        else:
            cur["blocks"].append({"type": "note", "text": words})
    # Merge runs of single-item lists.
    for kind_list in out.values():
        for e in kind_list:
            merged: list[dict] = []
            for b in e["blocks"]:
                if b["type"] == "list" and merged and merged[-1]["type"] == "list":
                    merged[-1]["items"].extend(b["items"])
                else:
                    merged.append(b)
            e["blocks"] = merged
    return out


def main() -> None:
    src, key, out_dir = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    tabs = split_tabs(Path(src).read_text())
    out_dir.mkdir(parents=True, exist_ok=True)
    style = "demo" if key == "demo" else "intro"
    frames = {"en": None, "ar": None}
    books = {"en": None, "ar": None}
    for name, lines in tabs.items():
        low = name.lower()
        lang = "ar" if ("arabic" in low or low.endswith(" ar")) else "en"
        if "objection" in low or "faq" in low:
            books[lang] = parse_playbook(lines)
        elif "pitch" in low:
            continue
        elif "english" in low or "arabic" in low:
            frames[lang] = parse_framework(lines, style)
    for lang in ("en", "ar"):
        if not frames[lang]:
            continue
        doc = frames[lang]
        doc.update(books[lang] or {"objections": [], "faqs": []})
        doc["key"], doc["lang"] = key, lang
        (out_dir / f"{key}.{lang}.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1))
        says = sum(1 for s in doc["stages"] for b in s["blocks"] if b["type"] == "say")
        branches = len({(s["no"], b.get("branch")) for s in doc["stages"] for b in s["blocks"] if b.get("branch")})
        print(f"{key}.{lang}: {len(doc['stages'])} stages, {says} spoken lines, {branches} branches, "
              f"{sum(len(s['checklist']) for s in doc['stages'])} checklist items, "
              f"{len(doc['objections'])} objections, {len(doc['faqs'])} FAQs")


if __name__ == "__main__":
    main()
