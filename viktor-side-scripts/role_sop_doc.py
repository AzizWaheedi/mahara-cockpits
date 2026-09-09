"""Build a branded role SOP Google Doc from a list of (text, kind) segments.

kind: h1 | h2 | h3 | meta | body | bullet. Styling and page setup are reused from
skills/csm_daily_workflow/scripts/csm_report_doc.py so every Mahara doc matches
Aziz's standard (Inter, H1/H2 navy #091333, H3 cyan #00CFC8).

Usage: import build_sop_doc(title, segments) -> doc id.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "skills" / "csm_daily_workflow" / "scripts"))

from csm_report_doc import append_text, set_document_style  # noqa: E402
from sdk.tools.pd_google_docs import pd_google_docs_create_document  # noqa: E402


async def build_sop_doc(title: str, segments: list[tuple[str, str]]) -> str:
    doc = await pd_google_docs_create_document(title=title)
    content = doc.get("content", doc) if isinstance(doc, dict) else doc
    if isinstance(content, str):
        content = json.loads(content)
    doc_id = content.get("documentId")
    if not doc_id:
        raise RuntimeError(f"no documentId in create response: {str(doc)[:400]}")
    await set_document_style(doc_id)
    # Append in chunks so a single batchUpdate never gets too large.
    chunk: list[tuple[str, str]] = []
    for seg in segments:
        chunk.append(seg)
        if len(chunk) >= 40:
            await append_text(doc_id, chunk, rtl=False)
            chunk = []
    if chunk:
        await append_text(doc_id, chunk, rtl=False)
    return doc_id
