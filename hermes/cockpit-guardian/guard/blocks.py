"""Slack Block Kit for every #health message (13 Oct 2026, Muhammed: laid out like PULSE's client health post).

The alert texts stay the mrkdwn they were: Slack shows that text in notifications, and the tests read it. This turns
their fixed shape into blocks: a large title, sections split by dividers, and the owner and time line small and grey.
The same converter lives in mahara-context tools/reliability-monitor/monitor.py; change both together."""
from __future__ import annotations

import re
from typing import Any, Optional

MAX_BLOCKS = 50                                   # Slack's limit per message
SECTION_MAX = 2900                                # Slack allows 3000 characters in a section
HEADLINE = re.compile(r"^(\S+) \*(.+)\*$")        # "🔴 *Broken: Demo job*"
QUIET = ("✅", "⏰")                              # resolutions and reminders get no large title
LABELS = {"*Do:*": "*What to do*", "*Guardian:*": "*What the guardian did*"}


def _plain(text: str) -> str:
    return re.sub(r"<[@#!][^>]*>", "", text).replace("*", "").strip()[:150]


def _context(text: str) -> dict[str, Any]:
    return {"type": "context", "elements": [{"type": "mrkdwn", "text": text[:3000]}]}


def _sections(text: str) -> list[dict[str, Any]]:
    out = []
    while text:
        cut = len(text) if len(text) <= SECTION_MAX else (text.rfind("\n", 0, SECTION_MAX) if "\n" in text[:SECTION_MAX] else SECTION_MAX)
        out.append({"type": "section", "text": {"type": "mrkdwn", "text": text[:cut]}})
        text = text[cut:].lstrip("\n")
    return out


def _divider(blocks: list[dict[str, Any]]) -> None:
    if blocks and blocks[-1]["type"] != "divider":
        blocks.append({"type": "divider"})


def to_blocks(text: str, headline: Optional[bool] = None) -> Optional[list[dict[str, Any]]]:
    """Blocks for one message, or None when it would pass Slack's 50-block limit (the text then goes alone)."""
    lines = text.split("\n")
    first = lines[0]
    m = HEADLINE.match(first)
    whole_bold = len(first) > 2 and first.startswith("*") and first.endswith("*")
    big = headline if headline is not None else ((bool(m) and not first.startswith(QUIET)) or whole_bold)
    blocks: list[dict[str, Any]] = []
    if big:
        title = f"{m.group(1)} {m.group(2)}" if m else first.strip("*").rstrip(":")
        blocks.append({"type": "header", "text": {"type": "plain_text", "text": _plain(title), "emoji": True}})
    else:
        blocks += _sections(first)
    group: list[str] = []

    def flush() -> None:
        if group:
            blocks.extend(_sections("\n".join(group)))
            group.clear()

    for line in lines[1:]:
        label = next((k for k in LABELS if line.startswith(k)), None)
        if not line.strip():
            flush()
            _divider(blocks)
        elif line.startswith("*Changed:*"):
            flush()
            change = line[len("*Changed:*"):].strip()
            blocks.append(_context(change[:1].upper() + change[1:]))
        elif label:
            flush()
            if label == "*Do:*":
                _divider(blocks)
            blocks.extend(_sections(f"{LABELS[label]}\n{line[len(label):].strip()}"))
        elif len(line) > 2 and line.startswith("_") and line.endswith("_"):
            flush()
            if len(blocks) > 2:
                _divider(blocks)
            blocks.append(_context(line[1:-1]))
        else:
            group.append(line)
    flush()
    while blocks and blocks[-1]["type"] == "divider":
        blocks.pop()
    return blocks if len(blocks) <= MAX_BLOCKS else None
