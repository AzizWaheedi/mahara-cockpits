"""The 35 old Four Rs Typeform wins into the wins ledger as void history, once (docs/forms/WAVE56-CONTRACT.md 4.2.4,
4.7, deploy step D-W; plan Q16). Runs ON THE VPS, where the Typeform token lives:

  ssh ... 187.77.156.166 'python3 - --dry' < scripts/dev/wins_backfill.py
  ssh ... 187.77.156.166 'python3 - --out /home/hermes/forms-w56/wins-import.json' < scripts/dev/wins_backfill.py

It reads every response of the five Four Rs forms through Typeform's responses API (read only) and maps each one to
an import row for the owner-only cockpit_csm_win_import(jsonb) of 20261102h:

  ETEynRgb  Client Review          review
  bAmbMKM2  Referral               referral
  cKItPZVI  Backend upsell         upsell_backend
  VP3zmaj2  Website upsell         upsell_website
  IVHO9BMC  SMM upsell             upsell_smm

Each row carries importedFrom (typeform:<form>:<response>), the win kind, the Kuwait day it was submitted, the
ClickUp id when the response has one (hidden field or a typed answer), the typed business name, a proof link and a
quoted price when the answers carry them. The card is decided in SQL, not here: the ClickUp id when it is on the
billing sheet, else the business name folded (case and spacing) with exactly one hit; a row with neither is skipped
there and counted as "no card". Every win imported is void ("imported, pre-cockpit"): it pays nothing, posts no
notice, writes no card comment and no form response.

  --dry              read and count only; prints counts per form, never a name, an answer, a token or a key
  --out FILE         also write {"rows": [...]} to FILE and the owner SQL that imports it to FILE.sql (for the deploy
                     to run through the Composio Supabase connection, then delete both files)
  --from-dir DIR     read <form>.definition.json and <form>.responses.json from DIR instead of Typeform (tests and
                     a saved read)

Expected counts (11.2-k): 4, 8, 8, 12 and 3 = 35. A different count is reported, never forced. The token is read by
name and never printed: TYPEFORM_API_TOKEN from the environment, else TYPEFORM_TOKEN from the native runtime file (as
forms_legacy_backfill.py reads it). A live read writes an intent receipt before each Typeform call and a response or
unknown receipt after it into cockpit_csm_provider_health (provider typeform, run_key wins-backfill:{uuid}); a call
whose intent receipt cannot be saved is not made. Python 3.9, standard library only.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request
import uuid
from typing import Any, Callable, Optional

FORMS = {
    "ETEynRgb": "review",
    "bAmbMKM2": "referral",
    "cKItPZVI": "upsell_backend",
    "VP3zmaj2": "upsell_website",
    "IVHO9BMC": "upsell_smm",
}
EXPECTED = {"ETEynRgb": 4, "bAmbMKM2": 8, "cKItPZVI": 8, "VP3zmaj2": 12, "IVHO9BMC": 3}
TYPEFORM = "https://api.typeform.com"
NATIVE_CURRENT = "/home/hermes/cockpit-native-current"
NATIVE_STATE = "/home/hermes/.cockpit-native-state"
TIMEOUT = 15
PAGE = 1000
KUWAIT = dt.timezone(dt.timedelta(hours=3))
CARD_ID = re.compile(r"^[A-Za-z0-9_-]{5,40}$")
RESPONSE_ID = re.compile(r"^[A-Za-z0-9_-]{1,120}$")
HIDDEN_CARD = ("clickup_id", "clickupid", "task_id", "taskid", "clickup", "client_id", "onboarding_client_id")
HIDDEN_NAME = ("business_name", "client_name", "company", "business")
NAME_TITLE = re.compile(r"business|company|client|brand|اسم الشركة|اسم النشاط|اسم العميل", re.I)
CARD_TITLE = re.compile(r"clickup|task id|card id", re.I)
PRICE_TITLE = re.compile(r"price|amount|value|usd|\$|fee|cost|السعر|المبلغ", re.I)
PROOF_TITLE = re.compile(r"link|url|proof|screenshot|review|video|رابط", re.I)
KEY_SHAPES = re.compile(r"tfp_[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")


class Stop(Exception):
    """A plain sentence to print before exiting non-zero."""


# ---------------------------------------------------------------- reading Typeform (live) or a saved read

def runtime_file() -> dict:
    """The native runtime file of the current release (forms_legacy_backfill.py's reader)."""
    release = pathlib.Path(NATIVE_CURRENT).resolve().name
    path = pathlib.Path(NATIVE_STATE) / f"runtime-{release}.json"
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def http(method: str, url: str, headers: dict, body: Any = None) -> tuple:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError):
        return None, ""


class LiveReader:
    """Typeform reads between their health-ledger receipts. Keys are held here and never printed."""

    def __init__(self, env: dict, runtime: dict):
        self.token = str(env.get("TYPEFORM_API_TOKEN") or runtime.get("TYPEFORM_TOKEN") or "")
        self.url = str(runtime.get("SUPABASE_URL") or env.get("COCKPIT_SUPABASE_URL") or "").rstrip("/")
        self.service = str(runtime.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("COCKPIT_SUPABASE_KEY") or "")
        if not self.token:
            raise Stop("No Typeform token: set TYPEFORM_API_TOKEN, or run this on the VPS where the native runtime file has it.")
        if not self.url or not self.service:
            raise Stop("No Supabase door for the health ledger receipts, so no Typeform call is made.")
        self.run_key = f"wins-backfill:{uuid.uuid4()}"

    def receipt(self, resource: str, phase: str, status: Optional[int] = None) -> bool:
        row = {"provider": "typeform", "method": "GET", "resource": resource, "phase": phase, "http_status": status,
               "run_key": self.run_key, "action_id": None}
        headers = {"apikey": self.service, "Authorization": "Bearer " + self.service, "Content-Type": "application/json",
                   "Prefer": "return=minimal"}
        code, _ = http("POST", self.url + "/rest/v1/cockpit_csm_provider_health", headers, row)
        return code is not None and 200 <= code < 300

    def get(self, path: str, resource: str) -> Any:
        if not self.receipt(resource, "intent"):
            raise Stop(f"The receipt for GET {resource} could not be saved, so the call was not made. Nothing was written.")
        status, text = http("GET", TYPEFORM + path, {"Authorization": "Bearer " + self.token, "Accept": "application/json"})
        self.receipt(resource, "unknown" if status is None else "response", status)
        if status is None:
            raise Stop("Typeform did not answer. Run this again; nothing was written.")
        if status != 200:
            raise Stop(f"Typeform refused the read: HTTP {status}.")
        try:
            return json.loads(text)
        except ValueError:
            raise Stop("Typeform answered without JSON.") from None

    def definition(self, form: str) -> dict:
        return self.get(f"/forms/{form}", f"forms/{form}")

    def responses(self, form: str) -> list:
        items: list = []
        before = None
        while True:
            q = f"?page_size={PAGE}&completed=true" + (f"&before={before}" if before else "")
            page = self.get(f"/forms/{form}/responses{q}", f"forms/{form}/responses")
            got = page.get("items") if isinstance(page, dict) else None
            if not isinstance(got, list) or not got:
                break
            items.extend(got)
            if len(got) < PAGE:
                break
            before = got[-1].get("token")
        return items


class DirReader:
    """A saved read: <form>.definition.json and <form>.responses.json ({"items": [...]})."""

    def __init__(self, folder: str):
        self.folder = pathlib.Path(folder)

    def _load(self, name: str) -> Any:
        try:
            return json.loads((self.folder / name).read_text())
        except (OSError, ValueError):
            raise Stop(f"{name} could not be read from the saved folder.") from None

    def definition(self, form: str) -> dict:
        return self._load(f"{form}.definition.json")

    def responses(self, form: str) -> list:
        data = self._load(f"{form}.responses.json")
        return data.get("items", []) if isinstance(data, dict) else data


# ---------------------------------------------------------------- mapping one response to one import row

def field_titles(definition: Any) -> dict:
    """Each field's title by ref and by id, groups included."""
    out: dict = {}

    def walk(fields: Any) -> None:
        for f in fields if isinstance(fields, list) else []:
            if not isinstance(f, dict):
                continue
            for k in ("ref", "id"):
                if f.get(k):
                    out[f[k]] = str(f.get("title") or "")
            props = f.get("properties")
            if isinstance(props, dict):
                walk(props.get("fields"))

    walk(definition.get("fields") if isinstance(definition, dict) else None)
    return out


def answer_value(a: dict) -> Any:
    kind = a.get("type")
    if kind == "text":
        return a.get("text")
    if kind == "choice":
        c = a.get("choice") or {}
        return c.get("label") if c.get("label") is not None else c.get("other")
    if kind in ("number", "url", "file_url", "date", "boolean"):
        return a.get(kind)
    return None


def kuwait_day(stamp: Any) -> Optional[str]:
    try:
        when = dt.datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=dt.timezone.utc)
    return when.astimezone(KUWAIT).date().isoformat()


def clean(text: Any, limit: int) -> Optional[str]:
    s = re.sub(r"\s+", " ", str(text or "")).strip()
    return s[:limit] or None


def map_response(form: str, response: dict, titles: dict) -> Optional[dict]:
    """One response as an import row, or None when it has no id or no day (counted as unreadable)."""
    rid = str(response.get("response_id") or response.get("token") or "")
    day = kuwait_day(response.get("submitted_at") or response.get("landed_at"))
    if not RESPONSE_ID.match(rid) or not day:
        return None
    hidden = response.get("hidden") if isinstance(response.get("hidden"), dict) else {}
    card = next((str(hidden[k]).strip() for k in HIDDEN_CARD if CARD_ID.match(str(hidden.get(k) or "").strip())), None)
    name = next((clean(hidden[k], 200) for k in HIDDEN_NAME if clean(hidden.get(k), 200)), None)
    proof = None
    price = None
    for a in response.get("answers") or []:
        if not isinstance(a, dict):
            continue
        f = a.get("field") or {}
        title = titles.get(f.get("ref")) or titles.get(f.get("id")) or ""
        value = answer_value(a)
        if value is None:
            continue
        if a.get("type") == "text" and CARD_TITLE.search(title) and not card and CARD_ID.match(str(value).strip()):
            card = str(value).strip()
        elif a.get("type") in ("text", "choice") and NAME_TITLE.search(title) and not name:
            name = clean(value, 200)
        elif a.get("type") in ("url", "file_url") or (a.get("type") == "text" and PROOF_TITLE.search(title)):
            text = str(value).strip()
            if not proof and re.match(r"^https://\S+$", text) and len(text) <= 1000:
                proof = text
        elif a.get("type") == "number" and PRICE_TITLE.search(title) and price is None:
            try:
                n = float(value)
            except (TypeError, ValueError):
                n = 0
            price = round(n, 2) if 0 < n <= 1_000_000 else None
    row = {"importedFrom": f"typeform:{form}:{rid}", "kind": FORMS[form], "wonOn": day, "clickupId": card,
           "businessName": name, "proofUrl": proof, "quotedUsd": price,
           "note": "Imported from the old Typeform (pre-cockpit history)."}
    return row


def read_all(reader: Any) -> tuple:
    """Every form's rows and counts; counts only ever hold numbers."""
    rows: list = []
    counts: dict = {}
    for form in FORMS:
        titles = field_titles(reader.definition(form))
        items = reader.responses(form)
        mapped = [map_response(form, r, titles) for r in items if isinstance(r, dict)]
        good = [m for m in mapped if m]
        rows.extend(good)
        counts[form] = {
            "read": len(items),
            "card id": sum(1 for m in good if m["clickupId"]),
            "name only": sum(1 for m in good if not m["clickupId"] and m["businessName"]),
            "neither": sum(1 for m in good if not m["clickupId"] and not m["businessName"]),
            "unreadable": len(mapped) - len(good),
        }
    return rows, counts


def count_lines(counts: dict) -> list:
    lines = []
    for form, c in counts.items():
        expected = EXPECTED[form]
        note = "" if c["read"] == expected else f"; differs from the expected {expected}"
        lines.append(f"{form} {FORMS[form]}: read {c['read']}{note}; {c['card id']} with a card id, {c['name only']} with a "
                     f"business name only, {c['neither']} with neither (no card), {c['unreadable']} unreadable")
    total = sum(c["read"] for c in counts.values())
    lines.append(f"total read {total}" + ("" if total == sum(EXPECTED.values()) else f"; differs from the expected {sum(EXPECTED.values())}"))
    return lines


def import_sql(payload: dict) -> str:
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    if "$wins$" in body:
        raise Stop("An answer holds the SQL quote marker; import it by hand.")
    return f"SELECT public.cockpit_csm_win_import($wins${body}$wins$::jsonb);\n"


def main(argv: list, env: Optional[dict] = None, out: Callable[[str], None] = print, live: Optional[Callable[[], Any]] = None) -> int:
    env = os.environ if env is None else env
    args = list(argv)
    dry = "--dry" in args
    target = args[args.index("--out") + 1] if "--out" in args and args.index("--out") + 1 < len(args) else None
    folder = args[args.index("--from-dir") + 1] if "--from-dir" in args and args.index("--from-dir") + 1 < len(args) else None
    if not dry and not target:
        out("Say --dry to count, or --out FILE to write the import for the deploy.")
        return 2
    try:
        reader = DirReader(folder) if folder else (live() if live else LiveReader(env, runtime_file()))
        rows, counts = read_all(reader)
        for line in count_lines(counts):
            out(line)
        if dry:
            out("dry run: nothing written")
            return 0
        payload = {"rows": rows}
        path = pathlib.Path(target)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=1))
        pathlib.Path(str(path) + ".sql").write_text(import_sql(payload))
        os.chmod(path, 0o600)
        os.chmod(str(path) + ".sql", 0o600)
        out(f"wrote {len(rows)} rows to {path} and the owner SQL to {path}.sql; run the SQL as the owner, then delete both files")
        return 0
    except Stop as e:
        out(KEY_SHAPES.sub("[key]", str(e)))
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
