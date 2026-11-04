"""The old answers of the client Typeforms into the cockpit, once (docs/forms/WAVE12-CONTRACT.md 4.4, deploy step
D-F4 for the termination survey, D-C2 for the pause request; docs/forms/WAVE34-CONTRACT.md 4.5.6, 4.7 and 4.8, steps
D-C5 for NPS and CSAT, D-C6 for onboarding, D-NCF for the New Client Form). Runs ON THE VPS, like forms_key.py, where
the keys live:

  ssh -o ControlMaster=auto -o ControlPath=/Users/abdulazizwaheedi/.ssh/cm-%r@%h-%p -o ControlPersist=20m -o ConnectTimeout=20 187.77.156.166 'python3 - exit_survey --dry' < scripts/dev/forms_legacy_backfill.py

  exit_survey [--dry]     the termination survey (knIe4eF3)
  pause_request [--dry]   the client's pause request (CTUjv6l3)
  nps [--dry]             the old NPS survey (fuPgs85S): legacy rows with no card, kept out of the NPS number (V17)
  csat [--dry]            the old onboarding survey (KbcbPA73): the same
  onboarding [--dry]      the client's onboarding form (KFRCXPFx), still live: stored submitted, Make keeps every effect
  new_client [--dry]      the New Client Form (BTzMwXiw), still live: recorded only; nothing here submits it
  kickoff --count         Stage 4's recorded inputs (docs/forms/WAVE56-CONTRACT.md 4.15.4): counts only of the
                          kickoff read model (forms.kickoff, by form id), the kickoff responses (pointer and native)
                          and the stored onboarding answers. No Typeform call, nothing written.

It reads every response of the form through Typeform's responses API (read only) and builds each one exactly as
forms-door does: the termination survey, the pause request, NPS and CSAT as legacyInput (no email or phone answer,
only the hidden client_name and onboarding_client_id, the card from the hidden id; never a card for NPS and CSAT),
posted to cockpit_form_record_legacy; onboarding as the onboarding sync's formEntry (onboardingCore.ts, ported below
and held to the same golden file as forms-door's test) and the New Client Form as legacyInput with its three hidden
ids and no raw phone (f322053a, dropped by its ref), posted to cockpit_form_record_make; then, as the door does
(docs/forms/WAVE56-CONTRACT.md 4.19), the sale's typed phone and email (tieKeys) go to cockpit_sale_tie_open alone,
which keeps only their digests. A sale tie that cannot be opened is counted, never printed, and the onboarding sync's
sweep opens it later. Always with backfill true, so no notice is queued for an old answer and a
response already stored is left as it is. --dry reads and counts and writes nothing. It prints counts only, never an
answer, a name, a token or a key:

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
# The forms stored as legacy records, and the two Make-owned live forms recorded only, as the forms registry names them.
LEGACY_FORMS = ("exit_survey", "pause_request", "nps", "csat")
MAKE_FORMS = ("onboarding", "new_client")
FORMS = LEGACY_FORMS + MAKE_FORMS
# The old NPS and CSAT rows are seeded native (20261102a) but keep their Typeform ids for this one read.
NATIVE_OK = ("nps", "csat")
# The forms whose old answers are never put on a card (V17).
NO_CARD = ("nps", "csat", "new_client")
PAGE = 1000
TIMEOUT = 30
TYPEFORM_ID = re.compile(r"^[A-Za-z0-9]{4,32}$")
TOKEN = re.compile(r"^[A-Za-z0-9]{8,64}$")
CARD_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
# Answer and field types that carry a person's email or phone: never stored (handler.ts CONTACT_TYPES).
CONTACT_TYPES = {"email", "phone_number", "contact_info"}
# The only hidden fields the two forms set (inventory 3.3, 3.4; handler.ts LEGACY_HIDDEN).
LEGACY_HIDDEN = ("client_name", "onboarding_client_id")
# The New Client Form's hidden fields (handler.ts NEW_CLIENT_HIDDEN; cockpit_sales_client_forms.hidden).
NEW_CLIENT_HIDDEN = ("contact_id", "closer", "setter")
# The New Client Form's own refs (handler.ts NEW_CLIENT_REF): the typed phone and email the sale tie reads, and the
# raw-phone short_text, never stored (handler.ts NEW_CLIENT_DROP_REFS).
NEW_CLIENT_PHONE_REF = "95a3901f-4130-454e-8e45-14c9a99dd096"
NEW_CLIENT_EMAIL_REF = "a6ea04df-7b41-4a9f-b92b-8b5347a585be"
NEW_CLIENT_DROP_REFS = ("f322053a-3b86-4e8c-8596-93d31a096679",)
ONBOARDING_FORM_ID = "KFRCXPFx"
ARABIC = re.compile(r"[\u0600-\u06ff]")
KEY_SHAPES = re.compile(r"sk-[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{8,}|tfp_[A-Za-z0-9_-]{8,}"
                        r"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
USAGE = ("Name the form: exit_survey, pause_request, nps, csat, onboarding or new_client, then --dry to read and "
         "count without writing; or kickoff --count for Stage 4's recorded inputs.")


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

    def __init__(self, env: dict, typeform: bool = True):
        self.url = str(env.get("SUPABASE_URL") or "").rstrip("/")
        self.service = str(env.get("SUPABASE_SERVICE_ROLE_KEY") or "")
        self.token = str(env.get("TYPEFORM_TOKEN") or "")
        if not self.url or not self.service:
            raise Stop("The native runtime file has no SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
        if typeform and not self.token:
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
            "taskId": card if form not in NO_CARD and isinstance(card, str) and CARD_ID.match(card) else None,
            "clientName": hidden.get("client_name"), "backfill": True}


# ---------------------------------------------------------------- onboarding, as the onboarding sync shapes it

def _text(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def questions_of(definition: Any) -> list:
    """The form's questions in order, groups opened up, statements left out (onboardingCore.ts questionsOf)."""
    out: list = []

    def walk(fields: Any) -> None:
        for f in fields if isinstance(fields, list) else []:
            if not isinstance(f, dict):
                continue
            props = f.get("properties") if isinstance(f.get("properties"), dict) else {}
            inner = props.get("fields")
            if isinstance(inner, list) and inner:
                walk(inner)
                continue
            if f.get("type") == "statement" or not f.get("ref"):
                continue
            out.append({"ref": str(f["ref"]), "title": "" if f.get("title") is None else str(f.get("title"))})

    walk(definition.get("fields") if isinstance(definition, dict) else None)
    return out


def question_title(raw: Any, hidden: dict) -> str:
    """A question's title as the CSM reads it (onboardingCore.ts questionTitle)."""
    t = re.sub(r"\{\{hidden:([A-Za-z0-9_]+)\}\}", lambda m: hidden.get(m.group(1)) or "\u2026", "" if raw is None else str(raw))
    t = re.sub(r"This question is required\.?", " ", t, flags=re.I)
    t = re.sub(r"\*{1,2}([^*]+)\*{1,2}", r"\1", t)
    parts = [p for p in (re.sub(r"\s+", " ", x).strip() for x in t.split("|")) if p]
    if len(parts) > 1:
        english = next((p for p in parts if re.search(r"[A-Za-z]", p) and not ARABIC.search(p)), None)
        t = english if english is not None else parts[0]
    t = re.sub(r"\s+", " ", t).strip()
    return t[:157].rstrip() + "\u2026" if len(t) > 160 else t


def onboarding_value(a: Any) -> str:
    """One answer as text (onboardingCore.ts answerValue)."""
    if not isinstance(a, dict):
        return ""
    kind = a.get("type")
    if kind in ("text", "email", "phone_number", "url", "file_url"):
        return _text(a.get(kind))
    if kind == "number":
        n = a.get("number")
        return "" if n is None else (str(int(n)) if isinstance(n, float) and n.is_integer() else str(n))
    if kind == "boolean":
        return "Yes" if a.get("boolean") else "No"
    if kind == "choice":
        c = a.get("choice") or {}
        return _text(c.get("label") if c.get("label") is not None else c.get("other"))
    if kind == "choices":
        c = a.get("choices") or {}
        items = [*(c.get("labels") or []), *([c["other"]] if c.get("other") else [])]
        return ", ".join(s for s in (str(x).strip() for x in items) if s)
    if kind == "date":
        return _text(a.get("date"))[:10]
    if kind == "payment":
        p = a.get("payment") or {}
        return str(p["amount"]) if p.get("amount") else ""
    return ""


def onboarding_answers(definition: Any, item: dict) -> list:
    """formEntry's answers: the form's order, titled, empty answers left out, each value at most 4,000 characters."""
    by_ref = {}
    for a in item.get("answers") or []:
        if isinstance(a, dict):
            by_ref[str((a.get("field") or {}).get("ref"))] = a
    given = item.get("hidden") if isinstance(item.get("hidden"), dict) else {}
    hidden = {k: "" if v is None else str(v) for k, v in given.items()}
    out = []
    for q in questions_of(definition):
        a = by_ref.get(q["ref"])
        if a is None:
            continue
        value = onboarding_value(a)
        if not value:
            continue
        out.append({"ref": q["ref"], "title": question_title(q["title"], hidden), "value": value[:4000]})
    return out


def _pick(given: Any, keys: tuple) -> dict:
    given = given if isinstance(given, dict) else {}
    out = {}
    for k in keys:
        v = given.get(k).strip() if isinstance(given.get(k), str) else ""
        if v:
            out[k] = v
    return out


def tie_keys_of(item: dict) -> dict:
    """The sale's typed phone (95a3901f, phone_number) and email (a6ea04df, email), by ref and type only (handler.ts
    tieKeysOf): each a trimmed string or None. Only cockpit_sale_tie_open receives them."""
    def typed(ref: str, kind: str) -> Optional[str]:
        for a in item.get("answers") or []:
            if not isinstance(a, dict) or a.get("type") != kind:
                continue
            field = a.get("field") if isinstance(a.get("field"), dict) else {}
            if field.get("ref") != ref:
                continue
            v = a.get(kind)
            return v.strip() if isinstance(v, str) and v.strip() and len(v) <= 320 else None
        return None
    return {"phone": typed(NEW_CLIENT_PHONE_REF, "phone_number"), "email": typed(NEW_CLIENT_EMAIL_REF, "email")}


def make_input(form: str, item: dict, titles: dict, definition: Any) -> dict:
    """cockpit_form_record_make's input for one response (handler.ts makeInput, backfill true). The New Client Form's
    carries tieKeys beside it, which record_of takes off before the record is posted."""
    base = {"formKey": form, "externalId": str(item.get("token") or item.get("response_id") or ""),
            "submittedAt": str(item.get("submitted_at") or ""), "backfill": True}
    if form == "onboarding":
        hidden = _pick(item.get("hidden"), ("client_name", "onboarding_client_id"))
        card = hidden.get("onboarding_client_id")
        return {**base, "answers": {"fields": onboarding_answers(definition, item)}, "hidden": hidden,
                "taskId": card if isinstance(card, str) and CARD_ID.match(card) else None}
    kept = [a for a in item.get("answers") or []
            if not (isinstance(a, dict) and isinstance(a.get("field"), dict) and a["field"].get("ref") in NEW_CLIENT_DROP_REFS)]
    legacy = legacy_input(form, {**item, "answers": kept}, titles)
    return {**base, "answers": legacy["answers"], "hidden": _pick(item.get("hidden"), NEW_CLIENT_HIDDEN), "taskId": None,
            "tieKeys": tie_keys_of(item)}


def record_of(record: dict) -> dict:
    """The record RPC's input alone: make_input less the sale tie's keys (handler.ts recordOf)."""
    return {k: v for k, v in record.items() if k != "tieKeys"}


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
    filled = row.get("provider") == "typeform" or (form in NATIVE_OK and row.get("provider") == "native")
    if not filled or not TYPEFORM_ID.match(fid):
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


def card_ids(run: Run, onboarding: bool = False) -> set:
    """The cards on the billing sheet (and, for onboarding, the onboarding read model), for --dry's unmatched count
    (the database keeps a card only when it mirrors it)."""
    ids: set = set()
    for path in ["/rest/v1/cockpit_billing_accounts?select=clickup_task_id",
                 *(["/rest/v1/cockpit_client_onboarding?select=clickup_task_id"] if onboarding else [])]:
        try:
            status, text = run.supabase("GET", path)
            rows = json.loads(text) if status == 200 else None
        except (NoAnswer, ValueError):
            rows = None
        if not isinstance(rows, list):
            raise Stop("The mirrored cards could not be read, so the unmatched count would be a guess. Nothing was written.")
        ids |= {r.get("clickup_task_id") for r in rows if isinstance(r, dict)}
    return ids


def backfill(run: Run, form: str, dry: bool) -> int:
    fid = form_id(run, form)
    definition = run.typeform(f"/forms/{fid}", "api.typeform.com/forms/:id")
    titles = field_titles(definition)
    items = responses(run, fid)
    make = form in MAKE_FORMS
    records = [make_input(form, item, titles, definition) if make else legacy_input(form, item, titles) for item in items]
    bad = [r for r in records if not TOKEN.match(r["externalId"]) or not r["submittedAt"]]
    records = [r for r in records if r not in bad]
    rpc = "cockpit_form_record_make" if make else "cockpit_form_record_legacy"
    if dry:
        if form in NO_CARD:
            unmatched = len(records)
        else:
            cards = card_ids(run, onboarding=form == "onboarding")
            unmatched = sum(1 for r in records if r["taskId"] not in cards)
        print(f"read {len(items)}, would store up to {len(records)}, unmatched {unmatched}"
              + (f", unreadable {len(bad)}" if bad else "") + " (dry run: nothing written)")
        return 0
    stored = repeat = unmatched = filled = tie_missed = 0
    failed: list = []
    for r in records:
        try:
            status, text = run.supabase("POST", f"/rest/v1/rpc/{rpc}", {"p": record_of(r)})
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
        if out.get("readModel") == "written":
            filled += 1
        if form == "new_client" and not open_tie(run, r):
            tie_missed += 1
    line = f"read {len(items)}, stored {stored}, already there {repeat}, unmatched {unmatched}"
    if form == "onboarding":
        line += f", read model filled {filled}"
    if tie_missed:
        line += f", sale ties not opened {tie_missed} (the onboarding sync's sweep opens them)"
    if bad:
        line += f", unreadable {len(bad)}"
    if failed:
        line += f", not stored {len(failed)} ({', '.join(sorted(set(failed)))})"
    print(line)
    return 1 if failed or bad else 0


def open_tie(run: Run, record: dict) -> bool:
    """The sale tie after a stored New Client Form (4.19), as the door does: the sale's two typed keys go to
    cockpit_sale_tie_open alone. False when it could not be opened (nothing printed: its answer can hold a value)."""
    p = {"externalId": record["externalId"], "submittedAt": record["submittedAt"], "tieKeys": record.get("tieKeys") or {}}
    try:
        status, text = run.supabase("POST", "/rest/v1/rpc/cockpit_sale_tie_open", {"p": p})
        out = json.loads(text) if text else None
    except (NoAnswer, ValueError):
        return False
    return status == 200 and isinstance(out, dict) and out.get("ok") is True


def rows_of(run: Run, path: str, what: str) -> list:
    """One PostgREST read as a list, or a Stop that says what could not be counted (missing is never zero)."""
    try:
        status, text = run.supabase("GET", path)
        rows = json.loads(text) if status == 200 else None
    except (NoAnswer, ValueError):
        rows = None
    if not isinstance(rows, list):
        raise Stop(f"{what} could not be read, so it is not counted. Nothing was written.")
    return [r for r in rows if isinstance(r, dict)]


def kickoff_counts(run: Run) -> int:
    """Stage 4's recorded inputs, counts only (4.15.4): never an answer, a card or a name."""
    model = rows_of(run, "/rest/v1/cockpit_client_onboarding?select=kickoff:forms->kickoff->>form_id,"
                         "onboarding:forms->onboarding->>form_id", "The client record")
    responses_ = rows_of(run, "/rest/v1/cockpit_form_responses?select=form_key,form_version,state"
                              "&form_key=in.(kickoff,onboarding)", "The stored answers")
    by_form: dict = {}
    for r in model:
        if r.get("kickoff"):
            by_form[r["kickoff"]] = by_form.get(r["kickoff"], 0) + 1
    kick = [r for r in responses_ if r.get("form_key") == "kickoff"]
    onb = [r for r in responses_ if r.get("form_key") == "onboarding"]
    pointer = sum(1 for r in kick if r.get("form_version") == 1)
    native = sum(1 for r in kick if isinstance(r.get("form_version"), int) and r["form_version"] >= 2)
    onb_model = sum(1 for r in model if r.get("onboarding"))
    forms = ", ".join(f"{k} {by_form[k]}" for k in sorted(by_form))
    print(f"kickoff read model {sum(by_form.values())}" + (f" ({forms})" if forms else "")
          + f", kickoff responses {len(kick)} (pointer {pointer}, native {native})"
          + f", onboarding answers {len(onb)} (legacy {sum(1 for r in onb if r.get('state') == 'legacy')})"
          + f", onboarding read model {onb_model} (counts only: nothing written)")
    return 0


def main(argv: Optional[list] = None) -> int:
    args = sys.argv[1:] if argv is None else list(argv)
    form = args[0] if args else ""
    flags = args[1:]
    count_mode = form == "kickoff" and flags == ["--count"]
    if not count_mode and (form not in FORMS or any(f != "--dry" for f in flags)):
        print(USAGE)
        return 2
    run = None
    try:
        run = Run(runtime_file(), typeform=not count_mode)
        code = kickoff_counts(run) if count_mode else backfill(run, form, "--dry" in flags)
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
