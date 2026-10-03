"""Nothing the guardian writes may carry a secret, a phone number or an email.

Every sentence that reaches Slack, a Supabase row, a brief or the log goes
through `clean`. Lead names cannot be recognised by pattern, so the guardian
never reads a name column in the first place; worker text is cut short.
"""
from __future__ import annotations

import re
from typing import Any

_KEEP_PREFIX = (
    re.compile(r"(?i)(bearer\s+)[^\s\"',)}\]]+"),
    re.compile(r"(?i)((?:x-api-key|x-cron-secret|apikey|api[_-]key|access_token|refresh_token|client_secret|"
               r"secret|password|token|authorization|key)\s*[=:]\s*[\"']?)[^\s\"'&,)}\]]+"),
)
_WHOLE = (
    re.compile(r"\b(?:sk|pk|rk|ck|xoxb|xoxp|xapp|ghp|gho|github_pat|sbp)[-_][A-Za-z0-9_\-*.]{6,}"),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{4,}"),
    re.compile(r"\b[A-Fa-f0-9]{40,}\b"),
)
_EMAIL = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
# A phone number: a leading + and 8 to 15 digits, or 8 to 15 digits in a row.
# Dates (2026-10-03) and times keep their separators and are left alone.
_PHONE = (
    re.compile(r"\+\d[\d\s\-]{6,17}\d"),
    re.compile(r"(?<![\w.])\d{8,15}(?![\w.])"),
)
_EM = re.compile("\\s*[\u2014\u2015]\\s*")
_EN = re.compile("\\s*[\u2012\u2013]\\s*")


def scrub(text: Any) -> str:
    """Keys out. Used on every error before it is kept anywhere."""
    out = str(text)
    for pattern in _KEEP_PREFIX:
        out = pattern.sub(lambda m: m.group(1) + "<hidden>", out)
    for pattern in _WHOLE:
        out = pattern.sub("<hidden>", out)
    return out


def plain(text: Any) -> str:
    """No em dashes in anything the guardian says (the house style)."""
    return _EN.sub("-", _EM.sub(", ", str(text)))


def clean(text: Any, limit: int = 300) -> str:
    """Keys, emails and phone numbers out, whitespace folded, cut to `limit`."""
    if text is None:
        return ""
    out = scrub(text)
    out = _EMAIL.sub("<email>", out)
    for pattern in _PHONE:
        out = pattern.sub("<number>", out)
    out = plain(" ".join(out.split()))
    if len(out) > limit:
        out = out[: max(0, limit - 3)].rstrip() + "..."
    return out


def first_line(text: Any, limit: int = 200) -> str:
    for line in str(text or "").splitlines():
        if line.strip():
            return clean(line, limit)
    return ""


def clean_obj(obj: Any, limit: int = 300, depth: int = 0) -> Any:
    """Evidence for a row or a brief: every string cleaned, depth and size bounded."""
    if depth > 4:
        return "..."
    if isinstance(obj, dict):
        return {str(k)[:60]: clean_obj(v, limit, depth + 1) for k, v in list(obj.items())[:40]}
    if isinstance(obj, (list, tuple)):
        return [clean_obj(v, limit, depth + 1) for v in list(obj)[:40]]
    if isinstance(obj, str):
        return clean(obj, limit)
    return obj


_JSON_MESSAGE = re.compile(r'"(?:message|description|error_description)"\s*:\s*"([^"]{1,200})"')
_JSON_CODE = re.compile(r'"code"\s*:\s*"?(\w{1,20})"?')


def brief_error(text: Any, limit: int = 160) -> str:
    """A provider error in a few words: the part before its JSON body, then the
    body's message. 'Meta 400: {"error":{"message":"API access blocked.",...}}'
    becomes 'Meta 400: API access blocked. (code 200)'."""
    raw = str(text or "")
    m = _JSON_MESSAGE.search(raw)
    if not m:
        return clean(raw, limit)
    head = raw.split("{", 1)[0].strip().rstrip(":").strip()
    code = _JSON_CODE.search(raw)
    tail = f" (code {code.group(1)})" if code and code.group(1) not in head else ""
    msg = m.group(1).strip()
    return clean(f"{head}: {msg}{tail}" if head else f"{msg}{tail}", limit)
