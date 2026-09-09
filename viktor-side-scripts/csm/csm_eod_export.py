"""Push a CSM end-of-day filed in the app to the two places the team already reads it.

Aziz keeps people accountable from two surfaces that predate the app:

  * `#eods-csms`, where a bot posts the EOD as a formatted message the moment it is
    submitted, and
  * the EOD Reports spreadsheet, "Account Manager" tab, one row per submission.

Both must keep working exactly as they do today, so this module reproduces the Admin Bot
message layout character for character and appends to the sheet in its existing column
order. The sheet is append only. Nothing here ever updates or clears an existing row,
because that sheet is his record of who has and has not filed.
"""

from __future__ import annotations

import datetime
from urllib.parse import quote

from sdk.tools.pd_google_sheets import pd_google_sheets_proxy_post
from sdk.tools.slack_admin_tools import coworker_send_slack_message

EOD_SHEET = "1EhPp7x0jZfV8dNjUvmuWv_alNvduMGpe_COjUAB13bw"
EOD_TAB = "Account Manager"
"""The CSM's own tab. The Media Buyer tab belongs to the other cockpit."""

EOD_CHANNEL = "C09RQS2TFST"  # #eods-csms

SLACK_IDS = {
    "abdulelah@maharamedia.com": "U0BTM5F4U0K",
    "abdu@maharamedia.com": "U0BTM5F4U0K",
    "aziz@maharamedia.com": "U09305KE2KS",
}
"""So the channel post mentions the person, the way the old bot did [slack, 2026-09-05]."""

COLUMNS = [
    "Submitted At",
    "Name",
    "Response ID",
    "Date For",
    "Stress",
    "Energy",
    "Call Summary",
    "Daily Expectations Done",
    "Defcon 3 Touchpoints",
    "Fathom Summaries Sent",
    "New Signups / Pre-Onboarding",
]
"""Columns A to K of the Account Manager tab, read from the live sheet [2026-09-05].

His sheet has exactly these eleven, and it is his record of who filed and who did not, so the
export writes eleven and stops. Writing the churn ledger and the roll up into columns L to Q
would silently widen his sheet, which he asked me not to touch. Those answers still reach him:
they are in the app and in the #eods-csms message. Order is positional, never reorder this."""

EXTRA_IN_MESSAGE_ONLY = [
    "Clients Lost",
    "Upsells",
    "Google Reviews",
    "Referrals",
    "1% Improvements",
    "Roll Up",
]
"""Answers deliberately kept out of the sheet, so nobody re-adds them by accident."""


def _kuwait_now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=3)


def _score(value: str | None) -> str:
    """The app stores a plain 1 to 10; older rows carried "Energy 4"."""
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    return digits or ""


def _name(row: dict) -> str:
    """Who filed it. The email local part is the only identity the app holds."""
    email = str(row.get("email") or "")
    local = email.split("@")[0] if email else ""
    return local.replace(".", " ").title() or "CSM"


def sheet_row(row: dict) -> list[str]:
    """One EOD as the seventeen cells the Account Manager tab expects."""
    a = row.get("answers") or {}
    submitted = datetime.datetime.fromtimestamp(
        (row.get("at") or 0) / 1000, datetime.timezone.utc
    ) + datetime.timedelta(hours=3)
    return [
        submitted.strftime("%Y-%m-%d %H:%M:%S"),
        _name(row),
        str(row.get("_id") or ""),
        str(row.get("day") or ""),
        _score(row.get("stress")),
        _score(row.get("energy")),
        str(a.get("callSummary") or ""),
        str(a.get("expectations") or ""),
        str(a.get("touchpoints") or ""),
        str(a.get("fathom") or ""),
        str(a.get("newSignups") or ""),
        # Stops at column K on purpose. See EXTRA_IN_MESSAGE_ONLY.
    ]


def slack_text(row: dict) -> str:
    """The EOD in the exact shape #eods-csms has always shown it."""
    a = row.get("answers") or {}
    day = str(row.get("day") or _kuwait_now().date().isoformat())
    try:
        pretty = datetime.date.fromisoformat(day).strftime("%d-%m-%Y")
    except ValueError:
        pretty = day
    lines = [
        "*CLIENT SUCCESS EOD*",
        f"*Date - {pretty}",
        "",
        f"*Name - {_name(row)}*",
        *(
            [f"Submitted by: <@{SLACK_IDS[str(row.get('email') or '').lower()]}>"]
            if str(row.get("email") or "").lower() in SLACK_IDS
            else []
        ),
        "",
        "*HEALTH*",
        f"Stress Level - {_score(row.get('stress'))}",
        f"Energy - {_score(row.get('energy'))}",
        "",
        "*CALL SUMMARY*",
        str(a.get("callSummary") or "").strip() or "None logged",
        "",
        "*ADMIN TASKS*",
        f"Daily Expected Tasks - {a.get('expectations') or ''}",
        f"Touchpoints - {a.get('touchpoints') or ''}",
        f"Fathom Call - {a.get('fathom') or ''}",
        f"New Clients - {a.get('newSignups') or ''}",
        "",
        "*KPI METRICS*",
        f"Client Lost - {a.get('lost') or 'N'}",
        f"Upsells - {a.get('upsells') or ''}",
        f"Reviews - {a.get('reviews') or ''}",
        f"Referrals - {a.get('referrals') or ''}",
        "",
        "*ADDITIONAL NOTES*",
        "1% improvement -",
        str(a.get("onePercent") or "").strip() or "None for today",
        "Daily Roll up -",
        str(a.get("rollup") or "").strip(),
    ]
    return "\n".join(lines)


async def append_to_sheet(row: dict) -> None:
    """Append one row. Append only, so his accountability history stays untouched."""
    rng = quote(f"{EOD_TAB}!A1")
    url = (
        f"https://sheets.googleapis.com/v4/spreadsheets/{EOD_SHEET}/values/{rng}:append"
        "?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS"
    )
    result = await pd_google_sheets_proxy_post(
        url=url, json_body={"values": [sheet_row(row)]}
    )
    text = str(result)
    if '"status_code": 200' not in text and "'status_code': 200" not in text:
        raise RuntimeError(f"sheet append failed: {text[:200]}")


async def post_to_channel(row: dict) -> None:
    """Post it where the team reads it, in the layout they already know."""
    await coworker_send_slack_message(
        channel_id=EOD_CHANNEL,
        do_send=True,
        blocks=[{"type": "section", "text": {"type": "mrkdwn", "text": slack_text(row)}}],
    )


async def export_eod(row: dict) -> None:
    """Sheet first, then Slack. If the sheet fails the row stays pending and retries, so a
    retry can never post the same message to the channel twice."""
    await append_to_sheet(row)
    await post_to_channel(row)
