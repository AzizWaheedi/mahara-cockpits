"""The old answers of the two client Typeforms into the cockpit, once (docs/forms/WAVE12-CONTRACT.md 4.4, deploy step
D-F4 for the termination survey, D-C2 for the pause request). Runs ON THE VPS, like forms_key.py, where the keys live:

  ssh -o ControlMaster=auto -o ControlPath=/Users/abdulazizwaheedi/.ssh/cm-%r@%h-%p -o ControlPersist=20m -o ConnectTimeout=20 187.77.156.166 'python3 - exit_survey --dry' < scripts/dev/forms_legacy_backfill.py

  exit_survey [--dry]     the termination survey (knIe4eF3)
  pause_request [--dry]   the client's pause request (CTUjv6l3)

It reads every response of the form through Typeform's responses API, builds each one exactly as forms-door does
(supabase/functions/forms-door/handler.ts legacyInput: no email or phone answer, only the hidden client_name and
onboarding_client_id, the card from the hidden id) and posts it to cockpit_form_record_legacy with backfill true, so
no notice is queued for a month-old survey and a response already stored is left as it is. --dry reads and counts and
writes nothing. It prints counts only, never an answer, a name, a token or a key:

  read 4, stored 4, already there 0, unmatched 1

Keys are read by name and never printed: TYPEFORM_TOKEN, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the native
runtime file (as forms_key.py reads them). Every Typeform call writes an intent receipt before it and a response or
unknown receipt after it into cockpit_csm_provider_health (provider typeform, run_key forms-backfill:{uuid}), and a call
whose intent receipt cannot be saved is not made. Self-contained on purpose: the VPS gets this one file on stdin.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Optional

NATIVE_CURRENT = "/home/hermes/cockpit-native-current"
NATIVE_STATE = "/home/hermes/.cockpit-native-state"
TYPEFORM = "https://api.typeform.com"
# The two forms stored as legacy records, each as the forms registry names it.
FORMS = ("exit_survey", "pause_request")
PAGE = 1000
TIMEOUT = 30
TYPEFORM_ID = re.compile(r"^[A-Za-z0-9]{4,32}$")
TOKEN = re.compile(r"^[A-Za-z0-9]{8,64}$")
CARD_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
# Answer and field types that carry a person's email or phone: never stored (handler.ts CONTACT_TYPES).
CONTACT_TYPES = {"email", "phone_number", "contact_info"}
# The only hidden fields the two forms set (inventory 3.3, 3.4; handler.ts LEGACY_HIDDEN).
LEGACY_HIDDEN = ("client_name", "onboarding_client_id")
KEY_SHAPES = re.compile(r"sk-[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{8,}|tfp_[A-Za-z0-9_-]{8,}"
                        r"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
USAGE = "Name the form: exit_survey or pause_request, then --dry to read and count without writing."


class Stop(Exception):
    """A plain sentence to print before exiting non-zero."""


class NoAnswer(Exception):
    """A request got no HTTP answer."""


def http(method: str, url: str, headers: dict, body: Any = None) -> tuple[int, str]:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            text = e.read().decode("utf-8", "replace")
        except Exception:  # noqa: BLE001 - the status is what counts
            text = ""
        return e.code, text
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise NoAnswer(type(e).__name__) from None


def runtime_file() -> dict:
    """The native runtime file of the current release, as hermes/csm-calls and forms_key.py read it."""
    release = pathlib.Path(NATIVE_CURRENT).resolve().name
    path = pathlib.Path(NATIVE_STATE) / f"runtime-{release}.json"
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        raise Stop("The native runtime file could not be read.") from None


class Run:
    """One run: the database door, the Typeform token, the receipts, and every key a message hides."""

    def __init__(self, env: dict):
        self.url = str(env.get("SUPABASE_URL") or "").rstrip("/")
        self.service = str(env.get("SUPABASE_SERVICE_ROLE_KEY") or "")
        self.token = str(env.get("TYPEFORM_TOKEN") or "")
        if not self.url or not self.service:
            raise Stop("The native runtime file has no SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
        if not self.token:
            raise Stop("The native runtime file has no TYPEFORM_TOKEN.")
        self.run_key = f"forms-backfill:{uuid.uuid4()}"
        self.missed = 0

    def redact(self, text: Any) -> str:
        s = str(text)
        for v in (self.service, self.token):
            if v:
                s = s.replace(v, "[key]")
        return KEY_SHAPES.sub("[key]", s)

    def supabase(self, method: str, path: str, body: Any = None, prefer: Optional[str] = None) -> tuple[int, str]:
        headers = {"apikey": self.service, "Authorization": "Bearer " + self.service,
                   "Content-Type": "application/json", "Accept": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        return http(method, self.url + path, headers, body)

    def receipt(self, method: str, resource: str, phase: str, status: Optional[int] = None) -> bool:
        row = {"provider": "typeform", "method": method, "resource": resource, "phase": phase,
               "http_status": status, "run_key": self.run_key, "action_id": None}
        try:
            code, _ = self.supabase("POST", "/rest/v1/cockpit_csm_provider_health", row, prefer="return=minimal")
        except NoAnswer:
            return False
        return 200 <= code < 300

    def typeform(self, path: str, resource: str) -> Any:
        """One Typeform GET between its two receipts, as parsed JSON."""
        if not self.receipt("GET", resource, "intent"):
            raise Stop(f"The receipt for GET {resource} could not be saved, so the call was not made. Nothing was written.")
        headers = {"Authorization": "Bearer " + self.token, "Accept": "application/json"}
        try:
            status, text = http("GET", TYPEFORM + path, headers)
        except NoAnswer:
            if not self.receipt("GET", resource, "unknown"):
                self.missed += 1
            raise Stop("Typeform did not answer. Run this again; nothing was written for the page that failed.") from None
        if not self.receipt("GET", resource, "response", status):
            self.missed += 1
        if status != 200:
            raise Stop(f"Typeform refused the read: HTTP {status}. Run this again once the token can read the form.")
        try:
            return json.loads(text)
        except ValueError:
            raise Stop("Typeform answered without JSON.") from None


# ---------------------------------------------------------------- the record, as forms-door builds it

def field_titles(definition: Any) -> dict:
    """Each field's title by ref and by id, groups included (hermes/csm-calls/match.ts fieldTitles)."""
    out: dict = {}

    def walk(fields: Any) -> None:
        for f in fields if isinstance(fields, list) else []:
            if not isinstance(f, dict):
                continue
            if f.get("ref"):
                out[f["ref"]] = str(f.get("title") or "")
            if f.get("id"):
                out[f["id"]] = str(f.get("title") or "")
            props = f.get("properties")
            if isinstance(props, dict):
                walk(props.get("fields"))

    walk(definition.get("fields") if isinstance(definition, dict) else None)
    return out


def answer_value(a: dict) -> Any:
    """One answer's value in one shape (match.ts answerValue)."""
    kind = a.get("type")
    if kind == "text":
        return a.get("text")
    if kind == "choice":
        c = a.get("choice") or {}
        return c.get("label") if c.get("label") is not None else c.get("other")
    if kind == "choices":
        c = a.get("choices") or {}
        return [*(c.get("labels") or []), *([c["other"]] if c.get("other") else [])]
    if kind in ("number", "boolean", "email", "url", "date", "phone_number", "file_url", "payment"):
        return a.get(kind)
    return None


def legacy_input(form: str, item: dict, titles: dict) -> dict:
    """cockpit_form_record_legacy's input for one response (handler.ts legacyInput, backfill true)."""
    fields = []
    for a in item.get("answers") or []:
        if not isinstance(a, dict):
            continue
        field = a.get("field") if isinstance(a.get("field"), dict) else {}
        if str(a.get("type") or "") in CONTACT_TYPES or str(field.get("type") or "") in CONTACT_TYPES:
            continue
        ref = field.get("ref") or field.get("id")
        fields.append({"ref": ref, "type": field.get("type") or a.get("type"),
                       "title": titles.get(field.get("ref")) or titles.get(field.get("id")), "value": answer_value(a)})
    given = item.get("hidden") if isinstance(item.get("hidden"), dict) else {}
    hidden = {}
    for k in LEGACY_HIDDEN:
        v = given.get(k).strip() if isinstance(given.get(k), str) else ""
        if v:
            hidden[k] = v
    card = hidden.get("onboarding_client_id")
    return {"formKey": form, "externalId": str(item.get("token") or item.get("response_id") or ""),
            "submittedAt": str(item.get("submitted_at") or ""), "answers": {"fields": fields}, "hidden": hidden,
            "taskId": card if isinstance(card, str) and CARD_ID.match(card) else None,
            "clientName": hidden.get("client_name"), "backfill": True}


# ---------------------------------------------------------------- the run

def form_id(run: Run, form: str) -> str:
    """The registry's Typeform id for the form, which must still be filled in Typeform."""
    try:
        status, text = run.supabase("GET", f"/rest/v1/cockpit_forms?select=provider,typeform_id&key=eq.{form}")
        rows = json.loads(text) if status == 200 else None
    except (NoAnswer, ValueError):
        rows = None
    row = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None
    if row is None:
        raise Stop(f"The {form} row of the forms registry could not be read. Apply 20261101l first.")
    fid = str(row.get("typeform_id") or "")
    if row.get("provider") != "typeform" or not TYPEFORM_ID.match(fid):
        raise Stop(f"The {form} form is no longer filled in Typeform, so there is nothing to read from it.")
    return fid


def responses(run: Run, fid: str) -> list:
    """Every completed response of the form, newest first, a page of 1,000 at a time."""
    out: list = []
    before = None
    while True:
        query = {"page_size": PAGE, "completed": "true"}
        if before:
            query["before"] = before
        page = run.typeform(f"/forms/{fid}/responses?{urllib.parse.urlencode(query)}", "api.typeform.com/forms/:id/responses")
        items = page.get("items") if isinstance(page, dict) else None
        if not isinstance(items, list):
            raise Stop("Typeform answered the responses read without a list.")
        out.extend(i for i in items if isinstance(i, dict))
        if len(items) < PAGE:
            return out
        before = items[-1].get("token")
        if not before:
            return out


def card_ids(run: Run) -> set:
    """The cards on the billing sheet, for --dry's unmatched count (the database keeps a card only when it is there)."""
    try:
        status, text = run.supabase("GET", "/rest/v1/cockpit_billing_accounts?select=clickup_task_id")
        rows = json.loads(text) if status == 200 else None
    except (NoAnswer, ValueError):
        rows = None
    if not isinstance(rows, list):
        raise Stop("The billing sheet's cards could not be read, so the unmatched count would be a guess. Nothing was written.")
    return {r.get("clickup_task_id") for r in rows if isinstance(r, dict)}


def backfill(run: Run, form: str, dry: bool) -> int:
    fid = form_id(run, form)
    definition = run.typeform(f"/forms/{fid}", "api.typeform.com/forms/:id")
    titles = field_titles(definition)
    items = responses(run, fid)
    records = [legacy_input(form, item, titles) for item in items]
    bad = [r for r in records if not TOKEN.match(r["externalId"]) or not r["submittedAt"]]
    records = [r for r in records if r not in bad]
    if dry:
        cards = card_ids(run)
        unmatched = sum(1 for r in records if r["taskId"] not in cards)
        print(f"read {len(items)}, would store up to {len(records)}, unmatched {unmatched}"
              + (f", unreadable {len(bad)}" if bad else "") + " (dry run: nothing written)")
        return 0
    stored = repeat = unmatched = 0
    failed: list = []
    for r in records:
        try:
            status, text = run.supabase("POST", "/rest/v1/rpc/cockpit_form_record_legacy", {"p": r})
            out = json.loads(text) if text else None
        except NoAnswer:
            status, out = 0, None
        except ValueError:
            out = None
        if status != 200 or not isinstance(out, dict) or not isinstance(out.get("inserted"), bool):
            # The database's error code only: its message can hold a value from the answers.
            code = out.get("code") if isinstance(out, dict) and isinstance(out.get("code"), str) else f"HTTP {status}"
            failed.append(code)
            continue
        if out["inserted"]:
            stored += 1
        else:
            repeat += 1
        if not out.get("taskId"):
            unmatched += 1
    line = f"read {len(items)}, stored {stored}, already there {repeat}, unmatched {unmatched}"
    if bad:
        line += f", unreadable {len(bad)}"
    if failed:
        line += f", not stored {len(failed)} ({', '.join(sorted(set(failed)))})"
    print(line)
    return 1 if failed or bad else 0


def main(argv: Optional[list] = None) -> int:
    args = sys.argv[1:] if argv is None else list(argv)
    form = args[0] if args else ""
    flags = args[1:]
    if form not in FORMS or any(f != "--dry" for f in flags):
        print(USAGE)
        return 2
    run = None
    try:
        run = Run(runtime_file())
        code = backfill(run, form, "--dry" in flags)
    except Stop as e:
        print(run.redact(e) if run else KEY_SHAPES.sub("[key]", str(e)))
        code = 1
    except Exception as e:  # noqa: BLE001 - one plain line, never a traceback that could hold a value
        text = f"{form} backfill stopped: {type(e).__name__}"
        print(run.redact(text) if run else text)
        code = 1
    if run and run.missed:
        print(f"{run.missed} receipt(s) after a Typeform call could not be saved; cockpit_csm_provider_health is missing them.")
        code = code or 1
    return code


if __name__ == "__main__":
    sys.exit(main())
