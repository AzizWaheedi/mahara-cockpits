"""Appending a row to the EOD Reports spreadsheet.

Aziz keeps one sheet as the accountability record for every role, a tab per
role, and the Typeform for each role writes into its own tab. The cockpit's
end of day has to be indistinguishable from the form's: the same tab, the
same columns, in the tab's own order.

Only ever append. A cell that already has something in it is somebody's
filing and is never written over. The columns are read off the tab's live
header row rather than hard-coded, so a column added on the sheet does not
silently shift every value one to the left.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

from . import http

API = "https://sheets.googleapis.com/v4/spreadsheets"

# Aziz's EOD Reports sheet, one tab per role.
EOD_SHEET = "1EhPp7x0jZfV8dNjUvmuWv_alNvduMGpe_COjUAB13bw"
EOD_TAB = "Video Editors"


def _q(value: str) -> str:
    return http.quote(value)


def header(token: str, sheet: str, tab: str, timeout: float = 60) -> list[str]:
    """The tab's own column names, left to right."""
    out = http.get_json(
        f"{API}/{sheet}/values/{_q(chr(39) + tab + chr(39) + '!1:1')}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=timeout,
    )
    rows = (out or {}).get("values") or []
    return [str(c).strip() for c in (rows[0] if rows else [])]


def append(token: str, sheet: str, tab: str, values: list[Any], timeout: float = 60) -> dict[str, Any]:
    n = max(1, len(values))
    end = chr(ord("A") + min(25, n - 1))
    rng = f"'{tab}'!A:{end}"
    out = http.post_json(
        f"{API}/{sheet}/values/{_q(rng)}:append"
        "?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",
        {"values": [values]},
        headers={"Authorization": f"Bearer {token}"},
        timeout=timeout,
    )
    return out if isinstance(out, dict) else {}


# The cockpit's answer keys, mapped onto the column names the tab uses. A
# column the sheet has and this does not know about is left empty rather than
# guessed at.
EOD_COLUMNS: dict[str, str] = {
    "submitted at": "_submitted_at",
    "name": "name",
    "response id": "_response_id",
    "date for": "_date_for",
    "videos completed": "completed",
    "in progress / pending": "in_progress",
    "revisions handled": "revisions",
    "blockers": "blockers",
    "recommendations": "recommendations",
    "tomorrow's plan": "tomorrow",
    "day summary": "summary",
}


def eod_row(columns: list[str], answers: dict[str, Any]) -> list[Any]:
    """One row in the tab's own order, whatever that order happens to be."""
    out: list[Any] = []
    for name in columns:
        key = EOD_COLUMNS.get(name.strip().lower())
        out.append("" if key is None else str(answers.get(key, "") or ""))
    return out


def file_eod(
    token: str,
    answers: dict[str, Any],
    log: Callable[[str], None],
    *,
    sheet: str = EOD_SHEET,
    tab: str = EOD_TAB,
    header_fn: Optional[Callable[..., list[str]]] = None,
    append_fn: Optional[Callable[..., dict[str, Any]]] = None,
) -> dict[str, Any]:
    cols = (header_fn or header)(token, sheet, tab)
    if not cols:
        raise ValueError(f"the '{tab}' tab has no header row to write under")
    row = eod_row(cols, answers)
    (append_fn or append)(token, sheet, tab, row)
    log(f"end of day filed to '{tab}' ({len(row)} columns)")
    return {"tab": tab, "columns": len(row)}
