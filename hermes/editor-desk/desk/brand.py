"""Adding a line to a client's Do's & Don'ts.

Aziz, 2026-09-19: an editor should be able to update a client's do's and
don'ts from what they were told in revisions. That field is the one list
every cockpit reads, and it was written from onboarding calls over months.

So this appends, never replaces. An editor can add what they learned; they
cannot wipe the brand rules by pasting over them, and nothing anyone else
wrote is lost. The field's own shape is kept: a DO block and a DON'T block of
"- sentence (who, date)" lines, which is how the onboarding entries read.
"""
from __future__ import annotations

import re
from typing import Optional

DO = "DO"
DONT = "DON'T"
# The heading as it appears today, and the ways somebody might have typed it.
DONT_HEADS = ("don't", "dont", "don’t", "do not")


def _heading_at(line: str) -> Optional[str]:
    """Which block this line starts, if it starts one."""
    bare = line.strip().strip(":").strip()
    low = bare.lower()
    if low == "do":
        return DO
    if low in DONT_HEADS:
        return DONT
    return None


def entry(text: str, who: str, day: str) -> str:
    """One line in the field's own format."""
    body = " ".join(str(text or "").split())
    if not body:
        raise ValueError("there is nothing to add")
    body = body.lstrip("-").strip()
    who = " ".join(str(who or "").split()) or "the editor"
    return f"- {body} ({who}, {day})"


def add(existing: str, text: str, *, kind: str, who: str, day: str) -> str:
    """The field's new value, with the line added to the right block.

    A field with no headings gets them, so the first addition tidies rather
    than muddles. A block that exists is appended to at its end, not its top:
    these read chronologically.
    """
    if kind not in (DO, DONT):
        raise ValueError(f"{kind!r} is neither a do nor a don't")
    line = entry(text, who, day)
    current = (existing or "").rstrip()

    if not current.strip():
        other = DONT if kind == DO else DO
        blocks = {kind: [line], other: []}
        return f"{DO}\n" + "\n".join(blocks[DO]) + f"\n\n{DONT}\n" + "\n".join(blocks[DONT])

    lines = current.split("\n")
    # Where each block starts, and where it ends.
    heads: list[tuple[int, str]] = []
    for i, raw in enumerate(lines):
        h = _heading_at(raw)
        if h:
            heads.append((i, h))
    target = next((i for i, h in heads if h == kind), None)
    if target is None:
        # No such heading yet: start one at the end.
        return f"{current}\n\n{kind}\n{line}"

    # The block runs to the next heading, or to the end.
    nxt = next((i for i, _h in heads if i > target), len(lines))
    at = nxt
    # Step back over blank lines so the entry sits with its own block.
    while at > target + 1 and not lines[at - 1].strip():
        at -= 1
    lines.insert(at, line)
    return "\n".join(lines)


def already_there(existing: str, text: str) -> bool:
    """Has this already been said? Cheap guard against a double press."""
    body = " ".join(str(text or "").split()).lstrip("-").strip().lower()
    if not body:
        return False
    flat = re.sub(r"\s+", " ", (existing or "")).lower()
    return body in flat
