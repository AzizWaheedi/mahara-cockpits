"""Nothing the guardian writes may carry a secret, a phone number or an email.

Every sentence that reaches Slack, a Supabase row, a brief or the log goes
through `clean`. Lead names cannot be recognised by pattern, so the guardian
never reads a name column in the first place; worker text is cut short.
"""
from __future__ import annotations

import re
from typing import Any, Iterable

# A key's name followed by its value: the name stays, the value goes. Quoted
# names ("token": "...", {'apikey': '...'}) and a scheme word after the name
# (Authorization: Basic ..., api_key=Bearer ...) are covered.
_NAMES = (r"x-api-key|x-cron-secret|apikey|api[_-]key|access[_-]?token|refresh[_-]?token|client[_-]?secret|"
          r"secret|password|passwd|token|authorization|key")
_KEEP_PREFIX = (
    re.compile(r"(?i)(\b(?:bearer|basic)\s+)[^\s\"',)}\]]+"),
    re.compile(r"(?i)([\"']?(?:" + _NAMES + r")[\"']?\s*[=:]\s*[\"']?(?:(?:bearer|basic|token)\s+)?)"
               r"[^\s\"'&,)}\]]+"),
)
_WHOLE = (
    re.compile(r"\b(?:sk|pk|rk|ck|xoxb|xoxp|xoxa|xoxs|xapp|ghp|gho|ghu|ghs|github_pat|sbp)[-_][A-Za-z0-9_\-*.]{6,}"),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{4,}"),
    re.compile(r"\b[A-Fa-f0-9]{40,}\b"),
    re.compile(r"\bpit-[0-9a-f-]{20,}"),                       # HighLevel private integration tokens
    re.compile(r"\bsb_(?:secret|publishable)_\S+"),           # Supabase's new keys
    re.compile(r"\bAIza[\w-]{20,}"),                           # Google API keys
    re.compile(r"\bEAA[A-Za-z0-9]{20,}"),                       # Meta access tokens
    re.compile(r"/bot\d+:[\w-]{20,}"),                         # Telegram bot URLs
    re.compile(r"hooks\.slack\.com/services/\S+"),            # Slack webhook URLs
)
_URL_PASSWORD = re.compile(r"(://[^/\s:@]+:)[^@\s]+@")         # postgres://user:password@host
_EMAIL = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
# A phone number: a leading + and 8 to 15 digits, or 8 to 15 digits in a row.
# Dates (2026-10-03) and times keep their separators and are left alone.
_PHONE = (
    re.compile(r"\+\d[\d\s\-]{6,17}\d"),
    re.compile(r"(?<![\w.])\d{8,15}(?![\w.])"),
)
_EM = re.compile("\\s*[\u2014\u2015]\\s*")
_EN = re.compile("\\s*[\u2012\u2013]\\s*")

# ---- redaction by value --------------------------------------------------------
# Patterns cannot know every provider's key shape, so every value of 8 or more
# characters in the key files (and every secret-named variable in the
# environment) is registered at start-up and hidden wherever it appears, whole
# or as any 12-character piece of it.
WINDOW = 12
MIN_VALUE = 8
_values: set[str] = set()
_short: list[str] = []
_windows: set[str] = set()
SECRET_NAME = re.compile(r"(?i)KEY|TOKEN|SECRET|PASS|PWD|AUTH|CRED|PRIVATE|WEBHOOK|DSN|COOKIE|SESSION|SIGNING")
_PLAIN_VALUE = re.compile(r"^(?:true|false|yes|no|on|off|none|null|\d{1,7}|[a-z]+(?:[-_][a-z]+)*)$", re.I)


def secretish(name: str, value: str) -> bool:
    """Whether a key file's value should be hidden wherever it appears. Paths, plain
    words and plain URLs are not secrets; a URL is when its name says so (a webhook)
    or it carries a password."""
    v = (value or "").strip()
    if len(v) < MIN_VALUE:
        return False
    if v.startswith(("/", "~", "./")) and not SECRET_NAME.search(name or ""):
        return False
    if _PLAIN_VALUE.match(v):
        return False
    if re.match(r"(?i)^https?://", v) and not SECRET_NAME.search(name or "") and not _URL_PASSWORD.search(v) \
            and "?" not in v:
        return False
    return True


def register_values(values: Iterable[str]) -> int:
    """Hide these values (and every 12-character piece of them) from now on. Returns how many."""
    n = 0
    for v in values:
        v = (v or "").strip()
        if len(v) < MIN_VALUE or v in _values:
            continue
        _values.add(v)
        n += 1
        if len(v) < WINDOW:
            _short.append(v)
        else:
            for i in range(len(v) - WINDOW + 1):
                _windows.add(v[i:i + WINDOW])
    _short.sort(key=len, reverse=True)
    return n


def reset_values() -> None:
    _values.clear()
    _short.clear()
    _windows.clear()


def _by_value(text: str) -> str:
    if not _values:
        return text
    for v in _short:
        if v in text:
            text = text.replace(v, "<hidden>")
    if len(text) < WINDOW or not _windows:
        return text
    hide = [False] * len(text)
    for i in range(len(text) - WINDOW + 1):
        if text[i:i + WINDOW] in _windows:
            for j in range(i, i + WINDOW):
                hide[j] = True
    if not any(hide):
        return text
    out, i = [], 0
    while i < len(text):
        if hide[i]:
            while i < len(text) and hide[i]:
                i += 1
            out.append("<hidden>")
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def leaks(text: Any) -> bool:
    """Whether `text` holds a registered key value, whole or a 12-character piece of it.
    Used before anything leaves the box that the redactor does not rewrite (a git diff)."""
    t = str(text or "")
    if not _values or not t:
        return False
    if any(v in t for v in _short):
        return True
    return any(t[i:i + WINDOW] in _windows for i in range(len(t) - WINDOW + 1))


def scrub(text: Any) -> str:
    """Keys out. Used on every error before it is kept anywhere."""
    out = _by_value(str(text))
    out = _URL_PASSWORD.sub(lambda m: m.group(1) + "<hidden>@", out)
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
