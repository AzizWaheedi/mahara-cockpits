"""The report, rendered by code: the same three tabs as today's "Market Intelligence Report" (Arabic, English,
Onboarding Answers), the card field's value and the one comment. In MI-1 nothing is sent: the tabs are written
to the run folder as text and as the Docs batchUpdate requests MI-3 will send (each request carries its tab's
id), and the field and comment are written to outputs.json marked not sent.

Numbers come from the facts table, each with its evidence id and date; a missing one renders "[ ]". The
client's own answers carry the form date; the positioning and plan sections carry the recommendation label.
The Onboarding Answers tab never holds the five contact answers (they never leave the database).
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Optional

from .config import MARKET_RESEARCH_FIELD
from .facts import Facts, display
from .prompts import SECTIONS

TITLE_EN = "Market Intelligence Report"
TABS = ("t.0", "t.en", "t.answers")       # Arabic first, as today's report (t.0 is the first tab)
COCKPIT = "https://cockpit.maharamedia.com/client-success/clients/{task}/research"
EN_LABELS = {"clientClaim": "the client's answer in the onboarding form of {date}",
             "recommendation": "Recommendation, not an approved offer", "notChecked": "Not checked",
             "sources": "Sources", "evidence": "Evidence"}


def day(iso: Optional[str]) -> str:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return "[ ]"


def fill(text: str, metrics: list[dict[str, Any]], facts: Facts, lang: str) -> str:
    out = text
    for m in metrics:
        f = facts.get(m.get("of", ""), m.get("metric", ""))
        val = display(m.get("metric", ""), f, lang)
        if f:
            val += f" [{', '.join(f['eids'])}, {day(f.get('retrievedAt'))}" + \
                   (f"; {f['note']}" if f.get("note") in ("two sources differ",) else "") + "]"
        out = out.replace("{" + str(m.get("ref")) + "}", val)
    return re.sub(r"\{m\d{1,2}\}", "[ ]", out)


def blocks(findings: dict[str, Any], *, lang: str, facts: Facts, pack: Any, form_date: str, presence: dict[str, Any],
           not_checked: list[str], client_name: str) -> list[tuple[str, str]]:
    """[(style, text)]: TITLE, HEADING_2, NORMAL. The same list feeds the text file and the Docs requests."""
    labels = EN_LABELS if lang == "en" else (findings.get("labels") or {})
    out: list[tuple[str, str]] = [("TITLE", f"{TITLE_EN}: {client_name}")]
    titles = {k: t for k, t, _ in SECTIONS}
    for i, s in enumerate(findings.get("sections") or [], 1):
        title = titles[s["key"]] if lang == "en" else str(s.get("title") or titles[s["key"]])
        out.append(("HEADING_2", f"{i:02d} {title}"))
        for c in s.get("claims") or []:
            text = fill(str(c.get("text") or ""), c.get("metrics") or [], facts, lang)
            ev = [e for e in c.get("evidence") or []]
            tail = f" [{', '.join(ev)}]" if ev else ""
            if c.get("kind") == "client_claim":
                tail += f" ({str(labels.get('clientClaim', '')).replace('{date}', day(form_date))})"
            if c.get("kind") == "recommendation":
                tail += f" ({labels.get('recommendation', '')})"
            out.append(("NORMAL", text + tail))
        if s["key"] == "limits":
            gaps = [ch for ch, p in presence.items() if (p or {}).get("state") == "not_checked"]
            for ch in gaps:
                out.append(("NORMAL", f"{labels.get('notChecked', '')}: {ch.replace('_', ' / ')}"
                                      + (f" ({presence[ch].get('why')})" if lang == "en" and presence[ch].get("why") else "")))
            if lang == "en":
                for sentence in not_checked:
                    out.append(("NORMAL", sentence))
            out.append(("HEADING_2", str(labels.get("sources", ""))))
            for e in pack.items:
                if e.get("url"):
                    out.append(("NORMAL", f"{e['eid']} {e['kind']} {e['url']} ({day(e['retrievedAt'])}, {e['source']})"))
    return out


def answers_blocks(tab: list[dict[str, Any]], form_date: str, client_name: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = [("TITLE", f"Onboarding Answers: {client_name}"),
                                  ("NORMAL", f"Submitted {day(form_date)}. Contact details are on the client card.")]
    for row in tab:
        out.append(("HEADING_3", str(row.get("title") or row.get("ref"))))
        out.append(("NORMAL", str(row.get("value") or "")))
    return out


def text_of(bl: list[tuple[str, str]]) -> str:
    marks = {"TITLE": "# ", "HEADING_2": "## ", "HEADING_3": "### ", "NORMAL": ""}
    return "\n\n".join(marks[s] + t for s, t in bl) + "\n"


def utf16_len(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def docs_requests(tab_id: str, bl: list[tuple[str, str]], *, rtl: bool = False) -> list[dict[str, Any]]:
    """One tab's batchUpdate requests: the whole text inserted once at index 1, then each paragraph styled.
    Docs counts indexes in UTF-16 code units, so they are counted that way here."""
    text = "".join(t + "\n" for _, t in bl)
    reqs: list[dict[str, Any]] = [{"insertText": {"location": {"tabId": tab_id, "index": 1}, "text": text}}]
    idx = 1
    for style, t in bl:
        end = idx + utf16_len(t) + 1
        para: dict[str, Any] = {"namedStyleType": style}
        fields = "namedStyleType"
        if rtl:
            para["direction"] = "RIGHT_TO_LEFT"
            fields += ",direction"
        reqs.append({"updateParagraphStyle": {"range": {"tabId": tab_id, "startIndex": idx, "endIndex": end},
                                              "paragraphStyle": para, "fields": fields}})
        idx = end
    return reqs


def outputs(*, task_id: str, run_id: str, mode: str, competitors_n: int, sources_n: int,
            doc_url: Optional[str] = None) -> dict[str, Any]:
    """The card field and the comment, as they would be sent. In shadow both are marked not sent."""
    marker = f"Cockpit ref MI-{run_id.replace('-', '')[:8]}"
    doc = doc_url or "(no Doc: shadow mode)"
    comment = (f"Market research is ready: {doc}. {competitors_n} competitors, {sources_n} sources. "
               f"Cockpit: {COCKPIT.format(task=task_id)}.\n{marker}")
    shadow = mode == "shadow" or not doc_url
    return {"field": {"id": MARKET_RESEARCH_FIELD, "value": doc_url, "state": "not_due",
                      "sent": False, "why": "Shadow mode: no Doc is made and the card is not written." if shadow else ""},
            "comment": {"text": comment, "marker": marker, "notifyAll": False, "sent": False}}
