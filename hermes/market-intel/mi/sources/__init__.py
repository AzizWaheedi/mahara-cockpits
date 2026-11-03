"""Source adapters: each builds an actor input and reads the actor's items into evidence drafts and facts.

Actor outputs drift between versions, so every field is read through `first()` with the known spellings; a
renamed field degrades to a warning ("Maps place: no rating field"), never a crash. Adapters copy only the keys
they name, so a reviewer's name, a page's email or a listing's phone never reaches the evidence.
"""
from __future__ import annotations

import re
import unicodedata
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Optional

ARABIC_DIACRITICS = re.compile(r"[ً-ٰٟـ]")
STOP = {"co", "company", "llc", "est", "the", "and", "for", "of", "w.l.l", "wll", "group", "شركة", "مؤسسة", "لل", "و"}


def first(item: Any, *keys: str, default: Any = None) -> Any:
    for k in keys:
        cur: Any = item
        ok = True
        for part in k.split("."):
            if isinstance(cur, dict) and part in cur and cur[part] is not None:
                cur = cur[part]
            elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
                cur = cur[int(part)]
            else:
                ok = False
                break
        if ok and cur is not None and cur != "":
            return cur
    return default


def to_int(v: Any) -> Optional[int]:
    if v is None or v == "" or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip().replace(",", "")
    mult = 1
    if s[-1:].upper() in ("K", "M", "B"):
        mult = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}[s[-1].upper()]
        s = s[:-1]
    try:
        return int(float(s) * mult)
    except ValueError:
        return None


def to_float(v: Any) -> Optional[float]:
    if v is None or v == "" or isinstance(v, bool):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def iso(v: Any) -> Optional[str]:
    """ISO text, epoch seconds or milliseconds, as UTC ISO; None when unreadable."""
    if v in (None, "", 0):
        return None
    try:
        if isinstance(v, (int, float)):
            secs = float(v) / 1000.0 if v > 10_000_000_000 else float(v)
            t = datetime.fromtimestamp(secs, tz=timezone.utc)
        else:
            s = str(v).strip().replace("Z", "+00:00")
            t = datetime.fromisoformat(s[:32])
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
        return t.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    except (ValueError, OverflowError, OSError):
        return None


def days_between(start: Optional[str], end: Optional[str], now: datetime) -> Optional[int]:
    s = iso(start)
    if not s:
        return None
    e = iso(end) or now.isoformat()
    try:
        d = datetime.fromisoformat(e.replace("Z", "+00:00")) - datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return max(0, d.days)


def norm_name(name: Any) -> str:
    s = unicodedata.normalize("NFKC", str(name or "")).lower()
    s = ARABIC_DIACRITICS.sub("", s)
    s = re.sub(r"[أإآ]", "ا", s).replace("ة", "ه").replace("ى", "ي")
    s = re.sub(r"[^\w\s]", " ", s)
    return " ".join(t for t in s.split() if t not in STOP)


def name_match(a: Any, b: Any) -> bool:
    """Two business names are the same when one holds the other or most of their words are shared."""
    x, y = norm_name(a), norm_name(b)
    if not x or not y:
        return False
    if x in y or y in x:
        return True
    tx, ty = set(x.split()), set(y.split())
    return len(tx & ty) / max(1, min(len(tx), len(ty))) >= 0.6


def domain(url: Any) -> Optional[str]:
    s = str(url or "").strip()
    if not s:
        return None
    if "://" not in s:
        s = "https://" + s
    try:
        host = urllib.parse.urlsplit(s).hostname or ""
    except ValueError:
        return None
    host = host.lower()
    host = host[4:] if host.startswith("www.") else host
    return host or None


SOCIAL_HOSTS = ("instagram.com", "facebook.com", "fb.com", "tiktok.com", "snapchat.com", "linktr.ee", "wa.me",
                "whatsapp.com", "youtube.com", "x.com", "twitter.com", "linkedin.com", "google.com", "goo.gl")


def is_social(url: Any) -> bool:
    d = domain(url) or ""
    return any(d == h or d.endswith("." + h) for h in SOCIAL_HOSTS)


_HANDLE = {
    "instagram": re.compile(r"instagram\.com/(?!p/|reel/|explore/|stories/)([A-Za-z0-9_.]{2,30})", re.I),
    "tiktok": re.compile(r"tiktok\.com/@([A-Za-z0-9_.]{2,30})", re.I),
    "snapchat": re.compile(r"snapchat\.com/(?:add|@)/?([A-Za-z0-9_.-]{2,30})", re.I),
    "facebook": re.compile(r"facebook\.com/(?!sharer|share|tr\?|plugins|dialog)([A-Za-z0-9_.-]{2,80})", re.I),
}


def handle(platform: str, text: Any) -> Optional[str]:
    """The first profile handle of `platform` named in a link or a bio."""
    m = _HANDLE[platform].search(str(text or ""))
    if not m:
        return None
    h = m.group(1).strip("./")
    return None if h.lower() in ("profile.php", "pages", "people", "home", "groups") else h


def https(url: Any) -> Optional[str]:
    s = str(url or "").strip()
    return s if s.startswith("https://") or s.startswith("http://") else None
