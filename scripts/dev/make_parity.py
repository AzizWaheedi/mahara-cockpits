"""Stage 4's parity proof (docs/forms/WAVE56-CONTRACT.md 4.15.1, deploy step D-S4.0). Runs ON THE VPS, read only,
like forms_legacy_backfill.py, where the keys live:

  ssh ... 187.77.156.166 'python3 - kickoff' < scripts/dev/make_parity.py
  ssh ... 187.77.156.166 'python3 - onboarding --last 5' < scripts/dev/make_parity.py

  kickoff [--last N]      Make 12 (8925654), the last N runs (7 when not given)
  onboarding [--last N]   Make 13 (8922994), the last N runs (5 when not given)

For each run it reads the execution's module bundles from Make (GET /scenarios/{id}/logs, then each execution's
detail, with MAKE_API_KEY and a browser user agent), takes the Typeform answer Make's trigger received, asks the
cockpit for its plan of the same answer (cockpit_form_parity_plan, read only, writes nothing) and compares each
effect with the module that did it. One line per effect:

  kickoff run 1: handoff_comment equal
  kickoff run 1: card_fields differs: 924bba47
  kickoff run 1: card_fields intended: the Blueprint link points at the cockpit Blueprint

plus one line for Make 12's module [24] ("[24] search", or "[24] writes: {columns}", which stops D-S4.0 until the
write is its own effect). Pass = every effect equal or intended on every run. It prints field ids, column letters,
effect keys and run numbers only: never a person's id, an answer, a name, a phone number, a token or a key. Every
Make call writes an intent receipt before it and a response receipt after it into cockpit_csm_provider_health
(provider make, run_key make-parity:{uuid}); a call whose intent receipt cannot be saved is not made.
Self-contained on purpose: the VPS gets this one file on stdin.
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
RELAY_CONFIG = "/home/hermes/.forms-relay/config.env"
TIMEOUT = 30
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36")
SCENARIOS = {"kickoff": (8925654, 7), "onboarding": (8922994, 5)}
FIELD = {
    "status": "9368ca9e-3549-4320-84ff-9abd0a2901cb",
    "blueprint": "1b7a4a74-d0e7-4a7f-9218-59c80a738186",
    "map": "51f49cb1-9f76-48be-b639-c42ca552d20a",
    "profile": "7755485f-74a8-496c-85d8-562588e77944",
    "kickoff_link": "87d7d889-afea-42f8-9485-6f3ead5b857f",
    "service": "bab9a58b-15af-4b0d-8e20-b8e5a4bee2cc",
}
INTENDED = {
    "blueprint": "the Blueprint link points at the cockpit Blueprint",
    "service": "Make's switch() never matches a list (kickoff-path.md 2); the cockpit writes the first listed service",
    "task_name": "the request names the task {client} - {type label}",
    "kickoff_link": "the kickoff link opens the cockpit sheet, not a prefilled Typeform",
    "approval": "waits for the CSM's approval (2b rule)",
    "notice": "the cockpit's Stage 1 notice (Make posts none)",
    "new_mrr": "new (Q21)",
    "recap": "stays off (Q22)",
    "read_model": "the cockpit's own record (Make writes none)",
    "dedupe": "one task each per card (Make doubles them on a second submit)",
}
USAGE = "Name the form: kickoff or onboarding, then --last N for how many runs (7 and 5 when not given)."
KEY_SHAPES = re.compile(r"sk-[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{8,}|tfp_[A-Za-z0-9_-]{8,}"
                        r"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")


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
    release = pathlib.Path(NATIVE_CURRENT).resolve().name
    path = pathlib.Path(NATIVE_STATE) / f"runtime-{release}.json"
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        raise Stop("The native runtime file could not be read.") from None


def env_file(path: str) -> dict:
    out: dict = {}
    try:
        text = pathlib.Path(path).read_text()
    except OSError:
        return out
    for line in text.splitlines():
        m = re.match(r"^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$", line)
        if m and m.group(1) not in out:
            out[m.group(1)] = m.group(2).strip().strip("'\"")
    return out


# ---------------------------------------------------------------- pure: reading Make's bundles

def fold(text: Any) -> str:
    """Whitespace folded, the way 4.13.3 compares a text: runs of spaces and new lines are one space."""
    return re.sub(r"\s+", " ", str(text or "")).strip()


def modules_of(detail: Any) -> dict:
    """An execution's modules by id: {id: {"input": first input bundle, "output": first output bundle, "module": type}}.
    Tolerates the shapes Make's execution detail uses (modules, operations or log lists)."""
    items: list = []
    if isinstance(detail, dict):
        for key in ("modules", "operations", "log", "logs", "items"):
            v = detail.get(key)
            if isinstance(v, list):
                items = v
                break
        else:
            if isinstance(detail.get("response"), dict):
                return modules_of(detail["response"])
    elif isinstance(detail, list):
        items = detail
    out: dict = {}
    for it in items:
        if not isinstance(it, dict):
            continue
        mid = it.get("id", it.get("moduleId", it.get("module_id")))
        try:
            mid = int(mid)
        except (TypeError, ValueError):
            continue

        def first(v: Any) -> Any:
            if isinstance(v, list):
                return v[0] if v else {}
            return v if isinstance(v, dict) else {}

        entry = out.setdefault(mid, {"input": {}, "output": {}, "module": str(it.get("module") or it.get("type") or "")})
        if not entry["input"]:
            entry["input"] = first(it.get("input", it.get("inputBundle", it.get("mapper"))))
        if not entry["output"]:
            entry["output"] = first(it.get("output", it.get("outputBundle")))
    return out


def answer_value(a: dict) -> Any:
    """A Typeform answer's value as the cockpit stores it (forms_legacy_backfill.answer_value's rules)."""
    t = a.get("type")
    if t == "choice":
        return (a.get("choice") or {}).get("label") or (a.get("choice") or {}).get("other")
    if t == "choices":
        c = a.get("choices") or {}
        labels = list(c.get("labels") or [])
        if c.get("other"):
            labels.append(c["other"])
        return ", ".join(labels)
    if t in ("text", "email", "url", "number", "boolean", "date", "phone_number", "file_url"):
        return a.get(t)
    return a.get(t) if t else None


def typeform_input(trigger: dict) -> dict:
    """The trigger bundle (Make's Typeform watch) as the parity plan's input: hidden, answers [{ref, title, value}]."""
    r = trigger.get("form_response") if isinstance(trigger.get("form_response"), dict) else trigger
    titles: dict = {}
    for f in ((r.get("definition") or {}).get("fields") or []):
        if isinstance(f, dict) and f.get("ref"):
            titles[f["ref"]] = f.get("title")
    answers = []
    for a in r.get("answers") or []:
        if not isinstance(a, dict):
            continue
        ref = (a.get("field") or {}).get("ref")
        value = answer_value(a)
        if ref and value not in (None, ""):
            answers.append({"ref": ref, "title": titles.get(ref, ""), "value": value if isinstance(value, str) else str(value)})
    hidden = r.get("hidden") if isinstance(r.get("hidden"), dict) else {}
    return {"taskId": hidden.get("onboarding_client_id"), "client": hidden.get("legal_name") or hidden.get("client_name"),
            "submittedAt": r.get("submitted_at"), "token": r.get("token"), "hidden": hidden, "answers": answers,
            "cardOnSheet": True}


def custom_fields(bundle: dict) -> dict:
    """A ClickUp module's custom field writes by field id, whatever shape the mapper uses."""
    out: dict = {}
    for key in ("customFields", "custom_fields", "fields"):
        v = bundle.get(key)
        if isinstance(v, list):
            for f in v:
                if isinstance(f, dict) and (f.get("id") or f.get("field_id")):
                    out[str(f.get("id") or f.get("field_id"))] = f.get("value")
        elif isinstance(v, dict):
            out.update({str(k): val for k, val in v.items()})
    for k, v in bundle.items():
        m = re.match(r"^(?:customField_|cf_)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$", str(k))
        if m:
            out.setdefault(m.group(1), v)
    return out


def option_name(field_options: dict, field_id: str, value: Any) -> Optional[str]:
    """A dropdown's value (option id, orderindex or name) as its option name."""
    opts = field_options.get(field_id) or []
    for o in opts:
        if str(o.get("id")) == str(value) or str(o.get("orderindex")) == str(value) or str(o.get("name")) == str(value):
            return str(o.get("name"))
    return None


def text_of(bundle: dict, *keys: str) -> Optional[str]:
    for k in keys:
        if isinstance(bundle.get(k), str):
            return bundle[k]
    return None


def flat_modules(flow: Any) -> list:
    """Every module of a blueprint's flow, routes included."""
    out: list = []
    for m in flow or []:
        if not isinstance(m, dict):
            continue
        out.append(m)
        for route in m.get("routes") or []:
            out.extend(flat_modules((route or {}).get("flow")))
    return out


def line_24(blueprint: Any) -> str:
    """Make 12 [24]: a search (fine), or a write of some columns (D-S4.0 stops until it is its own effect)."""
    bp = blueprint.get("response", {}).get("blueprint", blueprint) if isinstance(blueprint, dict) else {}
    mod = next((m for m in flat_modules(bp.get("flow")) if m.get("id") == 24), None)
    if mod is None:
        return "[24] not found in the blueprint"
    kind = str(mod.get("module") or "")
    if re.search(r"(filterRows|searchRows|search|getRange|listRows|getCell)", kind, re.I):
        return "[24] search"
    values = (mod.get("mapper") or {}).get("values")
    cols = sorted(str(k) for k in values) if isinstance(values, dict) else sorted(str(k) for k in (mod.get("mapper") or {}))
    return f"[24] writes: {', '.join(cols)}"


def col_index(letter: str) -> int:
    n = 0
    for c in letter:
        n = n * 26 + (ord(c) - 64)
    return n - 1


def relay_row(config: dict, payload: dict) -> dict:
    """The Client Data row the relay writes, by column letter (hermes/forms-relay/relay.ts rowValues)."""
    try:
        columns = json.loads(config.get("CLIENT_DATA_COLUMNS") or "{}")
    except ValueError:
        return {}
    answers = payload.get("answers") or {}
    out: dict = {}
    for letter, source in columns.items():
        if source == "task":
            v = payload.get("taskId")
        elif source == "client":
            v = payload.get("client")
        elif source == "submittedAt":
            v = payload.get("submittedAt")
        elif source.startswith("answer:"):
            v = answers.get(source[7:])
        elif source.startswith("const:"):
            v = source[6:]
        else:
            v = ""
        out[letter.upper()] = "" if v is None else str(v)
    return out


def compare_kickoff(plan: list, mods: dict, ctx: dict) -> list:
    """One (effect, verdict) per effect of Make 12; verdict is equal, differs: {what} or intended: {why}."""
    fx = {e["key"]: e for e in plan}
    out = []
    p = lambda k: (fx.get(k) or {}).get("plan") or {}  # noqa: E731

    def need(mid: int) -> Optional[dict]:
        return mods.get(mid, {}).get("input") or None

    m11 = need(11)
    out.append(("handoff_comment", "differs: module [11] not in the run" if m11 is None
                else "equal" if fold(text_of(m11, "comment_text", "commentText", "comment")) == fold(p("handoff_comment").get("comment_text"))
                else "differs: text"))
    m20 = need(20)
    status = text_of(m20 or {}, "status") or ""
    out.append(("native_status", "differs: module [20] not in the run" if m20 is None
                else "equal" if status.strip().lower() == "in progress" else "differs: status"))
    m21 = need(21)
    if m21 is None:
        out.append(("card_fields", "differs: module [21] not in the run"))
    else:
        made = custom_fields(m21)
        diffs = []
        for f in p("card_fields").get("fields") or []:
            fid = f["fieldId"]
            if fid == FIELD["blueprint"]:
                continue
            want = f.get("optionName")
            got = option_name(ctx.get("options", {}), fid, made.get(fid)) if fid in made else None
            if fid == FIELD["service"] and got is None:
                continue  # intended below
            if got != want:
                diffs.append(fid[:8])
        for fid, value in made.items():
            if fid in (FIELD["blueprint"], FIELD["service"]) or value in (None, ""):
                continue
            if not any(f["fieldId"] == fid for f in p("card_fields").get("fields") or []):
                diffs.append(fid[:8])
        out.append(("card_fields", f"differs: {', '.join(sorted(set(diffs)))}" if diffs else "equal"))
        out.append(("card_fields", f"intended: {INTENDED['blueprint']}"))
        if any(f["fieldId"] == FIELD["service"] for f in p("card_fields").get("fields") or []):
            out.append(("card_fields", f"intended: {INTENDED['service']}"))
    targets = ctx.get("targets", {}).get("client_onboarding") or []
    m17, m22 = need(17), need(22)
    if m17 is None or m22 is None:
        out.append(("onboarding_tasks", "differs: module [17] or [22] not in the run"))
    elif not targets:
        out.append(("onboarding_tasks", "differs: the client_onboarding request type is not set up"))
    else:
        made = {(str(m.get("list_id") or m.get("listId") or m.get("list") or ""), str(m.get("template_id") or m.get("templateId") or m.get("template") or ""))
                for m in (m17, m22)}
        want = {(str(t.get("list_id") or ""), str(t.get("template_id") or "")) for t in targets}
        out.append(("onboarding_tasks", "equal" if made == want else "differs: lists or templates"))
        out.append(("onboarding_tasks", f"intended: {INTENDED['task_name']}; {INTENDED['dedupe']}"))
    m27 = need(27) or need(26)
    url = (custom_fields(m27).get(FIELD["map"]) if m27 else None) or (text_of(m27 or {}, "value") if m27 else None)
    want_map = p("map_phase4").get("value")
    out.append(("map_phase4", "differs: module [26]/[27] not in the run" if m27 is None
                else "differs: the phase 4 map link is not set up" if not want_map
                else "equal" if str(url or "").strip() == want_map else "differs: value"))
    m25 = need(25)
    body = p("phase4_whatsapp").get("body")
    if m25 is None:
        out.append(("phase4_whatsapp", "intended: Make sent nothing this run (no group on Client Data)"))
    elif not body:
        out.append(("phase4_whatsapp", "differs: the phase 4 text is not set up"))
    else:
        out.append(("phase4_whatsapp", f"intended: {INTENDED['approval']}" if fold(text_of(m25, "body", "text", "message")) == fold(body)
                    else "differs: text"))
    out.append(("kickoff_notice", f"intended: {INTENDED['notice']}"))
    out.append(("new_mrr", f"intended: {INTENDED['new_mrr']}"))
    out.append(("recap", f"intended: {INTENDED['recap']}"))
    return out


def compare_onboarding(plan: list, mods: dict, ctx: dict) -> list:
    fx = {e["key"]: e for e in plan}
    out = []
    p = lambda k: (fx.get(k) or {}).get("plan") or {}  # noqa: E731

    def need(mid: int) -> Optional[dict]:
        return mods.get(mid, {}).get("input") or None

    relay = ctx.get("relay", {})
    m25 = need(25)
    if m25 is None:
        out.append(("github_dispatch", "differs: module [25] not in the run"))
    else:
        raw = m25.get("data") or m25.get("body") or "{}"
        try:
            made = json.loads(raw) if isinstance(raw, str) else raw
        except ValueError:
            made = {}
        payload = p("github_dispatch").get("payload") or {}
        want = {"event_type": relay.get("DISPATCH_EVENT") or "market_intel",
                "client_payload": {relay.get("DISPATCH_NAME_KEY", ""): str(payload.get("client") or ""),
                                   relay.get("DISPATCH_ID_KEY", ""): str(payload.get("taskId") or "")}}
        out.append(("github_dispatch", "equal" if made == want else "differs: dispatch body"))
    m29 = need(29)
    if m29 is None:
        out.append(("profile_fields", "differs: module [29] not in the run"))
    else:
        made = custom_fields(m29)
        profile = next((f.get("value") for f in p("profile_fields").get("fields") or [] if f["fieldId"] == FIELD["profile"]), None)
        out.append(("profile_fields", "equal" if fold(made.get(FIELD["profile"])) == fold(profile) else "differs: 7755485f"))
        out.append(("profile_fields", f"intended: {INTENDED['kickoff_link']}"))
    m47 = need(47)
    out.append(("raw_answers_comment", "differs: module [47] not in the run" if m47 is None
                else "equal" if fold(text_of(m47, "comment_text", "commentText", "comment")) == fold(p("raw_answers_comment").get("comment_text"))
                else "differs: text"))
    m31 = need(31)
    if m31 is None:
        out.append(("client_data_row", "differs: module [31] not in the run"))
    else:
        values = m31.get("values") if isinstance(m31.get("values"), dict) else {}
        made = {}
        for k, v in values.items():
            letter = k if re.match(r"^[A-Z]{1,2}$", str(k)) else (chr(65 + int(k)) if str(k).isdigit() and int(k) < 26 else str(k))
            made[letter] = "" if v is None else str(v)
        want = relay_row(relay, p("client_data_row").get("payload") or {})
        diff = sorted({k for k in set(made) | set(want) if made.get(k, "") != want.get(k, "")})
        out.append(("client_data_row", f"differs: columns {', '.join(diff)}" if diff else "equal"))
    m50 = need(50) or need(49)
    url = (custom_fields(m50).get(FIELD["map"]) if m50 else None) or (text_of(m50 or {}, "value") if m50 else None)
    want_map = p("map_phase3").get("value")
    out.append(("map_phase3", "differs: module [49]/[50] not in the run" if m50 is None
                else "differs: the phase 3 map link is not set up" if not want_map
                else "equal" if str(url or "").strip() == want_map else "differs: value"))
    m48 = need(48)
    body = p("phase3_whatsapp").get("body")
    if m48 is None:
        out.append(("phase3_whatsapp", "intended: Make sent nothing this run (no group on Client Data)"))
    elif not body:
        out.append(("phase3_whatsapp", "differs: the phase 3 text is not set up"))
    else:
        out.append(("phase3_whatsapp", f"intended: {INTENDED['approval']}" if fold(text_of(m48, "body", "text", "message")) == fold(body)
                    else "differs: text"))
    m46 = need(46)
    targets = ctx.get("targets", {}).get("brand_dna") or []
    if m46 is None:
        out.append(("brand_dna_task", "differs: module [46] not in the run"))
    elif not targets:
        out.append(("brand_dna_task", "differs: the brand_dna request type is not set up"))
    else:
        made = (str(m46.get("list_id") or m46.get("listId") or m46.get("list") or ""), str(m46.get("template_id") or m46.get("templateId") or m46.get("template") or ""))
        want = (str(targets[0].get("list_id") or ""), str(targets[0].get("template_id") or ""))
        out.append(("brand_dna_task", "equal" if made == want else "differs: list or template"))
        out.append(("brand_dna_task", f"intended: {INTENDED['task_name']}; {INTENDED['dedupe']}"))
    out.append(("read_model", f"intended: {INTENDED['read_model']}"))
    return out


# ---------------------------------------------------------------- the run

class Run:
    def __init__(self, env: dict):
        self.url = str(env.get("SUPABASE_URL") or "").rstrip("/")
        self.service = str(env.get("SUPABASE_SERVICE_ROLE_KEY") or "")
        self.make_key = str(env.get("MAKE_API_KEY") or "")
        self.zone = str(env.get("MAKE_ZONE") or "eu2.make.com").replace("https://", "").strip("/")
        if not self.url or not self.service:
            raise Stop("The native runtime file has no SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
        if not self.make_key:
            raise Stop("The native runtime file has no MAKE_API_KEY.")
        if not self.zone.endswith("make.com"):
            raise Stop("MAKE_ZONE is not a make.com zone.")
        self.run_key = f"make-parity:{uuid.uuid4()}"
        self.missed = 0

    def redact(self, text: Any) -> str:
        s = str(text)
        for v in (self.service, self.make_key):
            if v:
                s = s.replace(v, "[key]")
        return KEY_SHAPES.sub("[key]", s)

    def supabase(self, method: str, path: str, body: Any = None, prefer: Optional[str] = None) -> tuple[int, str]:
        headers = {"apikey": self.service, "Authorization": "Bearer " + self.service,
                   "Content-Type": "application/json", "Accept": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        return http(method, self.url + path, headers, body)

    def receipt(self, resource: str, phase: str, status: Optional[int] = None) -> bool:
        row = {"provider": "make", "method": "GET", "resource": resource, "phase": phase, "http_status": status,
               "run_key": self.run_key, "action_id": None}
        try:
            code, _ = self.supabase("POST", "/rest/v1/cockpit_csm_provider_health", row, prefer="return=minimal")
        except NoAnswer:
            return False
        return 200 <= code < 300

    def make(self, path: str, resource: str) -> Any:
        if not self.receipt(resource, "intent"):
            raise Stop(f"The receipt for GET {resource} could not be saved, so the call was not made.")
        headers = {"Authorization": "Token " + self.make_key, "Accept": "application/json", "User-Agent": UA}
        try:
            status, text = http("GET", f"https://{self.zone}/api/v2{path}", headers)
        except NoAnswer:
            if not self.receipt(resource, "unknown"):
                self.missed += 1
            raise Stop("Make did not answer. Run this again.") from None
        if not self.receipt(resource, "response", status):
            self.missed += 1
        if status != 200:
            raise Stop(f"Make refused the read: HTTP {status}.")
        try:
            return json.loads(text)
        except ValueError:
            raise Stop("Make answered without JSON.") from None

    def rows(self, path: str, what: str) -> list:
        try:
            status, text = self.supabase("GET", path)
            rows = json.loads(text) if status == 200 else None
        except (NoAnswer, ValueError):
            rows = None
        if not isinstance(rows, list):
            raise Stop(f"{what} could not be read, so nothing is compared.")
        return rows

    def plan(self, form: str, inp: dict) -> list:
        try:
            status, text = self.supabase("POST", "/rest/v1/rpc/cockpit_form_parity_plan", {"p_form_key": form, "p_input": inp})
            out = json.loads(text) if text else None
        except (NoAnswer, ValueError):
            status, out = 0, None
        if status != 200 or not isinstance(out, dict) or not isinstance(out.get("effects"), list):
            raise Stop(f"The cockpit's parity plan could not be read (HTTP {status}). Apply 20261102j first.")
        return out["effects"]


def context(run: Run) -> dict:
    """What the comparisons read from the cockpit: dropdown options, the request types' targets, the relay's settings."""
    options = {}
    for f in run.rows("/rest/v1/cockpit_clickup_fields?select=field_id,options", "The ClickUp field map"):
        if isinstance(f, dict) and isinstance(f.get("options"), list):
            options[str(f.get("field_id"))] = f["options"]
    targets = {}
    for t in run.rows("/rest/v1/cockpit_request_types?select=key,targets&key=in.(client_onboarding,brand_dna)", "The request types"):
        if isinstance(t, dict):
            targets[str(t.get("key"))] = t.get("targets") or []
    return {"options": options, "targets": targets, "relay": env_file(RELAY_CONFIG)}


def parity(run: Run, form: str, last: int) -> int:
    scenario, _ = SCENARIOS[form]
    logs = run.make(f"/scenarios/{scenario}/logs?pg%5Blimit%5D={max(last * 3, 10)}&pg%5BsortDir%5D=desc",
                    "make.com/api/v2/scenarios/:id/logs")
    items = logs.get("scenarioLogs") or logs.get("logs") or logs.get("items") or [] if isinstance(logs, dict) else []
    runs = [i for i in items if isinstance(i, dict) and i.get("status") in (1, "success")][:last]
    if not runs:
        raise Stop(f"Make lists no successful run of {scenario} to compare.")
    ctx = context(run)
    if form == "kickoff":
        bp = run.make(f"/scenarios/{scenario}/blueprint", "make.com/api/v2/scenarios/:id/blueprint")
        print(f"kickoff {line_24(bp)}")
    failures = 0
    for n, item in enumerate(runs, start=1):
        eid = item.get("imtId") or item.get("id") or item.get("executionId")
        detail = run.make(f"/scenarios/{scenario}/logs/{urllib.parse.quote(str(eid))}", "make.com/api/v2/scenarios/:id/logs/:id")
        mods = modules_of(detail)
        trigger = mods.get(1, {}).get("output") or {}
        if not trigger:
            print(f"{form} run {n}: trigger differs: the Typeform answer is not in the run")
            failures += 1
            continue
        plan = run.plan(form, typeform_input(trigger))
        lines = compare_kickoff(plan, mods, ctx) if form == "kickoff" else compare_onboarding(plan, mods, ctx)
        for key, verdict in lines:
            print(f"{form} run {n}: {key} {verdict}")
            if verdict.startswith("differs"):
                failures += 1
    print(f"{'PASS' if not failures else 'FAIL'}: {len(runs)} {'run' if len(runs) == 1 else 'runs'} of {scenario}, "
          f"{failures} {'difference' if failures == 1 else 'differences'}.")
    return 0 if not failures else 1


def main(argv: Optional[list] = None) -> int:
    args = sys.argv[1:] if argv is None else list(argv)
    form = args[0] if args else ""
    rest = args[1:]
    last = SCENARIOS.get(form, (0, 0))[1]
    if form not in SCENARIOS or (rest and (len(rest) != 2 or rest[0] != "--last" or not rest[1].isdigit() or not 1 <= int(rest[1]) <= 30)):
        print(USAGE)
        return 2
    if rest:
        last = int(rest[1])
    run = None
    try:
        run = Run(runtime_file())
        code = parity(run, form, last)
    except Stop as e:
        print(run.redact(e) if run else KEY_SHAPES.sub("[key]", str(e)))
        code = 1
    except Exception as e:  # noqa: BLE001 - one plain line, never a traceback that could hold a value
        print(f"make parity stopped: {type(e).__name__}")
        code = 1
    if run and run.missed:
        print(f"{run.missed} receipt(s) after a Make call could not be saved.")
        code = code or 1
    return code


if __name__ == "__main__":
    sys.exit(main())
