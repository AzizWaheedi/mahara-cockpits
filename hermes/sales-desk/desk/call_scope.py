"""Call purpose, independent of the prospect's current customer status."""
from __future__ import annotations

from typing import Any

from . import http


def purpose_of(value: dict[str, Any], transcript: str) -> dict[str, str]:
    """Require a quote from this transcript before accepting client-service classification."""
    purpose = str(value.get("call_purpose") or "unknown").strip().lower()
    evidence = str(value.get("call_purpose_evidence") or "").strip()[:500]
    normalize = lambda text: " ".join(text.casefold().split())
    if purpose not in ("sales", "client_service", "internal", "unknown"):
        purpose = "unknown"
    if purpose in ("client_service", "internal") and (len(evidence) < 15 or normalize(evidence) not in normalize(transcript)):
        purpose, evidence = "unknown", ""
    return {"call_purpose": purpose, "call_purpose_evidence": evidence}


def visible_notes(sb: Any, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Retained notes do not make a hidden or missing recording a sales call.

    Read failures propagate: a digest must not publish an unfiltered fallback.
    The database also excludes client-service notes from authenticated reads.
    """
    visible: set[str] = set()
    ids = list(dict.fromkeys(str(r["recording_id"]) for r in rows))
    for start in range(0, len(ids), 100):
        chunk = ",".join('"' + rid.replace('"', '') + '"' for rid in ids[start:start + 100])
        found = sb.select("cockpit_sales_recordings",
                          f"select=recording_id&recording_id=in.({http.quote(chunk)})&hidden_reason=is.null")
        visible.update(str(r["recording_id"]) for r in found)
    return [r for r in rows if str(r["recording_id"]) in visible
            and (r.get("notes") or {}).get("call_purpose") not in ("client_service", "internal")]
