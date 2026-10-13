"""The New Client Form's questions, from Typeform into the cockpit.

Aziz, 2026-10-02: the closer fills the New Client Form in the cockpit, as
easily as possible, and it starts the same Make scenario it starts today.

The form stays Typeform's own. B2B's closed_deals is read from the responses
Typeform stores (its typeform-sync, every 15 minutes), and the form's webhook
feeds Make's "10. Closer Form to Onboarding (MAIN)", a HighLevel workflow and
Cortana. So the cockpit embeds the real form rather than imitating it, and
Typeform's terms allow nothing else. Typeform cannot fill a visible question
in advance, only hidden fields, so the cockpit puts what it already knows
beside the form, question by question, ready to copy.

This writes the form's questions into the cockpit setting `client_form`, so
that list follows the live form. A question added in Typeform shows up within
ten minutes. A question whose answer the cockpit knows is matched by its ref,
which Typeform keeps when a title changes.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from . import http
from .supabase import Supabase

FORM_ID = "BTzMwXiw"
SETTING_KEY = "client_form"
WORKER = "sales-desk"
API = "https://api.typeform.com"
EVERY = timedelta(minutes=10)
SOURCE = "hermes/sales-desk desk/clientform.py, from Typeform's form definition"


def read_form(token: str, form_id: str = FORM_ID) -> dict[str, Any]:
    """The form as Typeform's API describes it."""
    if not token:
        raise ValueError("TYPEFORM_API_TOKEN is not set, so the New Client Form's questions cannot be read.")
    out = http.get_json(f"{API}/forms/{form_id}", headers={"Authorization": f"Bearer {token}"}, timeout=40)
    if not isinstance(out, dict) or not out.get("fields"):
        raise ValueError("Typeform answered without the form's questions.")
    return out


def _question(f: dict[str, Any]) -> dict[str, Any]:
    props = f.get("properties") or {}
    q: dict[str, Any] = {
        "ref": str(f.get("ref") or f.get("id") or ""),
        "title": str(f.get("title") or "").strip(),
        "type": str(f.get("type") or ""),
        "required": bool((f.get("validations") or {}).get("required")),
    }
    choices = [str(c.get("label") or "").strip() for c in props.get("choices") or [] if c.get("label")]
    if choices:
        q["choices"] = choices
    if props.get("description"):
        q["description"] = str(props["description"]).strip()
    return q


def setting_from(form: dict[str, Any], now: str) -> dict[str, Any]:
    """The cockpit's copy of the form: its screens in order, each with its
    questions; a question outside any group is a screen of its own."""
    screens: list[dict[str, Any]] = []
    for f in form.get("fields") or []:
        kind = str(f.get("type") or "")
        if kind in ("group", "inline_group"):
            inner = (f.get("properties") or {}).get("fields") or []
            screens.append({"title": str(f.get("title") or "").strip(),
                            "questions": [_question(x) for x in inner if x.get("type") != "statement"]})
        elif kind != "statement":
            screens.append({"title": "", "questions": [_question(f)]})
    links = form.get("_links") or {}
    return {
        "form_id": str(form.get("id") or FORM_ID),
        "title": str(form.get("title") or "New Client Form"),
        "url": str(links.get("display") or f"https://form.typeform.com/to/{FORM_ID}"),
        "hidden": [str(h) for h in form.get("hidden") or []],
        "screens": screens,
        "form_updated_at": form.get("last_updated_at"),
        "synced_at": now,
        "source": SOURCE,
    }


def _when(value: Any) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def sync_client_form(sb: Supabase, token: str, log: Callable[[str], None], *, force: bool = False,
                     now: Optional[datetime] = None,
                     reader: Callable[[str], dict[str, Any]] = read_form) -> bool:
    """The form's questions into the `client_form` setting, at most every ten
    minutes unless forced. True when it was written."""
    now = now or datetime.now(timezone.utc)
    have = sb.setting(SETTING_KEY) or {}
    last = _when(have.get("synced_at")) if isinstance(have, dict) else None
    if not force and last and now - last < EVERY:
        return False
    want = setting_from(reader(token), now.isoformat(timespec="seconds").replace("+00:00", "Z"))
    if not want["screens"]:
        raise ValueError("The New Client Form came back with no questions; the cockpit keeps the last copy.")
    sb.store_setting(SETTING_KEY, want, WORKER)
    changed = not isinstance(have, dict) or {k: v for k, v in have.items() if k != "synced_at"} != \
        {k: v for k, v in want.items() if k != "synced_at"}
    count = sum(len(s["questions"]) for s in want["screens"])
    if changed:
        log(f"client form: the cockpit now has the New Client Form's {count} questions "
            f"(form changed {want['form_updated_at'] or 'at an unknown time'})")
    return True
