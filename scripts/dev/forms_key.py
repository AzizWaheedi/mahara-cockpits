"""The 1-1 notes keys and the Fathom webhook (docs/forms/STAGE2-CONTRACT.md 4.5 and 4.6). Runs ON THE VPS,
where the keys live:

  ssh -o ControlMaster=auto -o ControlPath=/Users/abdulazizwaheedi/.ssh/cm-%r@%h-%p -o ControlPersist=20m -o ConnectTimeout=20 187.77.156.166 'python3 - <command>' < scripts/dev/forms_key.py

  status              each key's state, last 4 and when it was saved (never a secret)
  doctor              the cockpit-forms-api doctor, as JSON (it holds no secret)
  fathom              test FATHOM_API_KEY from /opt/data/bibi/api-keys.env, then save it
  deepseek            test DEEPSEEK_API_KEY from the same file, then save it
  register-webhook    register fathom-webhook with Fathom and save the secret it answers with
  probe-webhook       send fathom-webhook one wrongly signed and one signed test delivery
  unregister-webhook  delete the webhook in Fathom and mark the registration off

  Since Stage 2b (docs/forms/STAGE2B-CONTRACT.md 4.8), the kickoff form's signed Typeform webhook to forms-door.
  <form> is kickoff, the only form with a cockpit webhook in 2b (Z58); any other exits 2:
  typeform-secret <form>      make a signing key (32 random bytes, base64url) and save it; never printed
  register-typeform <form>    read the form's webhooks, put the cockpit one, read it back, mark the key connected
  probe-typeform <form>       send forms-door one unsigned and one signed probe (401, then 200)
  unregister-typeform <form>  delete the cockpit webhook in Typeform, read back, mark the registration off

fathom, deepseek, register-webhook and unregister-webhook change the CEO's keys or his Fathom account, so
the CEO runs them, or someone with his permission (contract A3). status, doctor and probe-webhook change
nothing in Fathom. register-typeform and unregister-typeform change only the cockpit webhook of the kickoff
form (B3, which the 2b contract gives the session at deploy step D17, Z22); every other webhook of the form is
read before and after and never touched.

The Fathom key is the api-keys.env copy, not the one in the native runtime file that hermes/csm-calls
reads (the two values differ, and heavy reads are 10 a minute per key); the webhook is registered and
deleted with it too. The Supabase service key comes from the native runtime file. Keys go server to server
and are never printed: every message replaces them with [key]. Every Fathom and DeepSeek call writes an
intent receipt before it and a response or unknown receipt after it into cockpit_csm_provider_health
(run_key forms-key:{uuid}), and a call whose intent receipt cannot be saved is not made. The calls to our
own functions (probe-webhook, doctor) write none: the doctor writes its own. Every Typeform call does the same
under provider typeform (Y55), with TYPEFORM_TOKEN read by name from the native runtime file; the probes of
forms-door, our own function, write none.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

ENV_FILE = "/opt/data/bibi/api-keys.env"
NATIVE_CURRENT = "/home/hermes/cockpit-native-current"
NATIVE_STATE = "/home/hermes/.cockpit-native-state"
SUPABASE = "https://bldgtotkfmhoxmlzowdx.supabase.co"
FATHOM = "https://api.fathom.ai/external/v1"
TYPEFORM = "https://api.typeform.com"
# The one form with a cockpit Typeform webhook in 2b (Z58), its signing key's provider, and the webhook's tag.
TYPEFORM_FORMS = {"kickoff": "typeform_kickoff"}
ONLY_KICKOFF = "Only the kickoff form has a cockpit webhook in 2b."
TYPEFORM_ID = re.compile(r"^[A-Za-z0-9]{4,32}$")
WEBHOOK_TAG = "cockpit"
DEEPSEEK_MODELS = "https://api.deepseek.com/models"
CS_TEAM = "Customer Success"
PROVIDERS = ("fathom", "fathom_webhook", "deepseek", "anthropic")
TIMEOUT = 30
KUWAIT = timezone(timedelta(hours=3))
# Anything shaped like a key is hidden too, whoever's it is (a webhook secret, an sk- key, a JWT, a new Supabase key).
KEY_SHAPES = re.compile(r"whsec_[A-Za-z0-9+/=_-]{8,}|sk-[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{8,}|tfp_[A-Za-z0-9_-]{8,}"
                        r"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
# A Probe team meeting: fathom-webhook settles it ignored before anything of it is stored (contract 4.4 step 6).
PROBE_MEETING = {"recording_id": "000000001", "title": "Webhook probe", "shared_with": "all_teams",
                 "recorded_by": {"name": "Webhook probe", "email": "probe@tests.invalid", "team": "Probe"}}


class Stop(Exception):
    """A plain sentence to print before exiting non-zero."""


class NoReceipt(Stop):
    """An intent receipt could not be saved, so its call was not made."""


class NoAnswer(Exception):
    """A request got no HTTP answer: a timeout, a refused connection, a name that did not resolve."""


def http(method: str, url: str, headers: dict, body: Any = None) -> tuple[int, str]:
    """One request. An HTTP error comes back as its status; no answer at all raises NoAnswer."""
    data = None if body is None else body if isinstance(body, bytes) else json.dumps(body).encode()
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


class Run:
    """One run: the database door, the receipts of the provider calls and the keys every message hides."""

    def __init__(self, url: str, service: str):
        self.url = url.rstrip("/")
        self.service = service
        self.run_key = f"forms-key:{uuid.uuid4()}"
        self.hidden = [service]
        self.missed = 0  # response or unknown receipts that could not be saved

    def hide(self, *values: Any) -> None:
        for v in values:
            if isinstance(v, str) and len(v) >= 8 and v not in self.hidden:
                self.hidden.append(v)

    def redact(self, text: Any) -> str:
        s = str(text)
        for v in sorted(self.hidden, key=len, reverse=True):
            s = s.replace(v, "[key]")
        return KEY_SHAPES.sub("[key]", s)

    def say(self, text: str) -> None:
        print(self.redact(text))

    def supabase(self, method: str, path: str, body: Any = None, prefer: Optional[str] = None) -> tuple[int, str]:
        headers = {"apikey": self.service, "Authorization": "Bearer " + self.service,
                   "Content-Type": "application/json", "Accept": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        return http(method, self.url + path, headers, body)

    def rpc(self, name: str, args: dict) -> tuple[int, Any]:
        """A service RPC: (status, parsed body). Status 0 when the database did not answer."""
        try:
            status, text = self.supabase("POST", "/rest/v1/rpc/" + name, args)
        except NoAnswer:
            return 0, None
        try:
            return status, json.loads(text) if text else None
        except ValueError:
            return status, None

    def receipt(self, provider: str, method: str, resource: str, phase: str, status: Optional[int] = None) -> bool:
        row = {"provider": provider, "method": method, "resource": resource, "phase": phase,
               "http_status": status, "run_key": self.run_key, "action_id": None}
        try:
            code, _ = self.supabase("POST", "/rest/v1/cockpit_csm_provider_health", row, prefer="return=minimal")
        except NoAnswer:
            return False
        return 200 <= code < 300

    def call(self, provider: str, method: str, url: str, resource: str, headers: dict,
             body: Any = None) -> tuple[int, str]:
        """One Fathom or DeepSeek call between its two receipts. Status 0: no answer (an unknown receipt)."""
        if not self.receipt(provider, method, resource, "intent"):
            raise NoReceipt(f"The receipt for {method} {resource} could not be saved, so the call was not made.")
        try:
            status, text = http(method, url, headers, body)
        except NoAnswer:
            if not self.receipt(provider, method, resource, "unknown"):
                self.missed += 1
            return 0, ""
        if not self.receipt(provider, method, resource, "response", status):
            self.missed += 1
        return status, text


# ---------------------------------------------------------------- helpers

def read_env() -> dict:
    env = {}
    with open(ENV_FILE, errors="ignore") as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k.replace("export ", "").strip()] = v.strip().strip('"').strip("'")
    return env


def runtime_file() -> dict:
    """The current native release's private runtime file (keys by name)."""
    cur = pathlib.Path(NATIVE_CURRENT)
    path = pathlib.Path(NATIVE_STATE) / f"runtime-{cur.resolve().name}.json"
    try:
        rt = json.loads(path.read_text())
    except (OSError, ValueError):
        raise Stop("The native runtime file could not be read, so the Supabase service key is unknown.") from None
    return rt if isinstance(rt, dict) else {}


def runtime() -> tuple[str, str]:
    """SUPABASE_URL and the service key from the current native release's runtime file."""
    rt = runtime_file()
    service = rt.get("SUPABASE_SERVICE_ROLE_KEY")
    if not service:
        raise Stop("The native runtime file has no SUPABASE_SERVICE_ROLE_KEY.")
    return (rt.get("SUPABASE_URL") or SUPABASE).rstrip("/"), service


def env_key(run: Run, name: str) -> str:
    try:
        key = read_env().get(name, "")
    except OSError:
        raise Stop(f"{ENV_FILE} could not be read on this server.") from None
    if not key:
        raise Stop(f"{name} is empty on this server.")
    run.hide(key)
    return key


def ending(v: Any) -> str:
    return str(v or "")[-4:] or "????"


def plural(n: int, word: str) -> str:
    return f"{n} {word}" + ("" if n == 1 else "s")


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


_TIME = re.compile(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$")


def kuwait(v: Any) -> str:
    """A database time as Kuwait time ("2026-10-28 12:34 Kuwait time"); Python 3.9 reads only some ISO forms."""
    m = _TIME.match(str(v or "").strip())
    if not m:
        return "an unknown time"
    day, hm, sec, frac, tz = m.groups()
    tz = tz or "Z"
    tz = "+00:00" if tz == "Z" else (tz + ":00" if len(tz) == 3 else tz if ":" in tz else tz[:3] + ":" + tz[3:])
    t = datetime.fromisoformat(f"{day}T{hm}:{sec or '00'}.{(frac or '0')[:6].ljust(6, '0')}{tz}")
    return t.astimezone(KUWAIT).strftime("%Y-%m-%d %H:%M") + " Kuwait time"


def items_of(text: str, key: str = "items") -> Optional[list]:
    try:
        body = json.loads(text)
    except ValueError:
        return None
    items = body.get(key) if isinstance(body, dict) else None
    return [i for i in items if isinstance(i, dict)] if isinstance(items, list) else None


def db_error(status: int, body: Any) -> str:
    if status == 0:
        return "the database did not answer"
    if isinstance(body, dict) and isinstance(body.get("message"), str):
        return f"HTTP {status}: {body['message'][:240]}"
    return f"HTTP {status}"


def mark_error(status: int, body: Any) -> str:
    if status == 200 and isinstance(body, dict) and isinstance(body.get("note"), str):
        return body["note"]
    return db_error(status, body)


def answered(status: Optional[int]) -> str:
    if status is None:
        return "not sent, because its receipt could not be saved"
    return "no answer" if status == 0 else f"HTTP {status}"


def registered(meta: Any) -> bool:
    meta = meta if isinstance(meta, dict) else {}
    return bool(str(meta.get("webhookId") or "").strip()) and not meta.get("unregisteredAt")


def webhook_key(run: Run) -> Optional[dict]:
    status, key = run.rpc("cockpit_forms_key_get", {"p_provider": "fathom_webhook"})
    if status != 200:
        raise Stop(f"The webhook key could not be read ({db_error(status, key)}).")
    if not isinstance(key, dict):
        return None
    run.hide(key.get("secret"))
    return key


def webhook_body(url: str) -> dict:
    """The registration of contract 4.6: the team's shared recordings, never the CEO's private ones."""
    return {"destination_url": url + "/functions/v1/fathom-webhook",
            "triggered_for": ["shared_team_recordings"],
            "include_transcript": True, "include_summary": True, "include_action_items": True,
            "include_crm_matches": False}


def sign(secret: str, msg_id: str, timestamp: str, body: str) -> str:
    """The Standard Webhooks signature fathom-webhook checks: base64 HMAC-SHA256 keyed with the base64 after whsec_."""
    b64 = secret[len("whsec_"):].replace("-", "+").replace("_", "/")
    key = base64.b64decode(b64 + "=" * (-len(b64) % 4))
    mac = hmac.new(key, f"{msg_id}.{timestamp}.{body}".encode(), hashlib.sha256).digest()
    return "v1," + base64.b64encode(mac).decode()


def fathom_headers(key: str) -> dict:
    return {"X-Api-Key": key, "Accept": "application/json", "Content-Type": "application/json"}


def delete_webhook(run: Run, key: str, webhook_id: str) -> tuple[int, str]:
    return run.call("fathom", "DELETE", f"{FATHOM}/webhooks/{urllib.parse.quote(webhook_id, safe='')}",
                    "api.fathom.ai/external/v1/webhooks/:id", fathom_headers(key))


def save(run: Run, p: dict) -> tuple[int, Any]:
    return run.rpc("cockpit_forms_key_put", {"p": p})


# ---------------------------------------------------------------- the kickoff form's Typeform webhook (2b, 4.8)

def typeform_token(run: Run) -> str:
    """TYPEFORM_TOKEN from the native runtime file, as hermes/csm-calls reads it; never printed."""
    key = str(runtime_file().get("TYPEFORM_TOKEN") or "")
    if not key:
        raise Stop("The native runtime file has no TYPEFORM_TOKEN.")
    run.hide(key)
    return key


def typeform_headers(key: str) -> dict:
    return {"Authorization": "Bearer " + key, "Accept": "application/json", "Content-Type": "application/json"}


def door_url(run: Run, form: str) -> str:
    return f"{run.url}/functions/v1/forms-door/typeform/{form}"


def form_row(run: Run, form: str) -> dict:
    """The form's row of the forms registry."""
    try:
        status, text = run.supabase("GET", f"/rest/v1/cockpit_forms?select=provider,typeform_id&key=eq.{form}")
        rows = json.loads(text) if status == 200 else None
    except (NoAnswer, ValueError):
        rows = None
    row = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None
    if row is None:
        raise Stop(f"The {form} row of the forms registry could not be read.")
    return row


def typeform_form_id(run: Run, form: str) -> str:
    """The registry's Typeform id for a form to register, which must still be filled in Typeform (forms-door refuses otherwise)."""
    row = form_row(run, form)
    form_id = str(row.get("typeform_id") or "")
    if row.get("provider") != "typeform" or not TYPEFORM_ID.match(form_id):
        raise Stop(f"The {form} form is no longer filled in Typeform, so it gets no cockpit webhook.")
    return form_id


def registered_form_id(run: Run, form: str, meta: dict) -> str:
    """The Typeform form to remove the webhook from: the one register-typeform saved on the key, else the registry's id.
    The form need not still be filled in Typeform: once it moves, the door answers 404 and the webhook most needs removing."""
    saved = str(meta.get("formId") or "")
    if TYPEFORM_ID.match(saved):
        return saved
    form_id = str(form_row(run, form).get("typeform_id") or "")
    if not TYPEFORM_ID.match(form_id):
        raise Stop(f"Neither the {form} signing key nor the forms registry names a Typeform form. Nothing was changed. "
                   "Look for the cockpit webhook in Typeform's settings and delete it there.")
    return form_id


def typeform_key(run: Run, form: str) -> Optional[dict]:
    status, key = run.rpc("cockpit_forms_key_get", {"p_provider": TYPEFORM_FORMS[form]})
    if status != 200:
        raise Stop(f"The {form} signing key could not be read ({db_error(status, key)}).")
    if not isinstance(key, dict):
        return None
    run.hide(key.get("secret"))
    return key


def read_back_failed(done: str, kept: str, command: str, form: str) -> str:
    """What a failed read says once the write has gone: the write stands, whatever the read did."""
    return (f"The webhook was {done} on Typeform but could not be read back, so {kept}. "
            f"Read the {form} form's webhooks in Typeform, then run {command} {form} again.")


def typeform_hooks(run: Run, key: str, form_id: str, failed: str = "Nothing was changed.") -> list:
    """The form's webhooks (GET /forms/{id}/webhooks), receipted. A failed read stops and ends with `failed`: the read
    before a write leaves it at nothing changed, and the read-back after one passes what that write left behind."""
    try:
        status, text = run.call("typeform", "GET", f"{TYPEFORM}/forms/{form_id}/webhooks", "api.typeform.com/forms/:id/webhooks",
                                typeform_headers(key))
    except NoReceipt as e:
        raise Stop(f"{e} {failed}") from None
    if status == 0:
        raise Stop(f"Typeform did not answer the webhooks read. {failed}")
    if status != 200:
        raise Stop(f"typeform refused the webhooks read: HTTP {status}. {failed}")
    items = items_of(text)
    if items is None:
        raise Stop(f"Typeform answered the webhooks read without a list. {failed}")
    return items


def others_of(hooks: list) -> list:
    """Every webhook but the cockpit one, as (tag, url, enabled), to prove it was not touched."""
    return sorted((str(h.get("tag") or ""), str(h.get("url") or ""), bool(h.get("enabled")))
                  for h in hooks if h.get("tag") != WEBHOOK_TAG)


def cockpit_hook(hooks: list) -> Optional[dict]:
    return next((h for h in hooks if h.get("tag") == WEBHOOK_TAG), None)


def typeform_sign(secret: str, body: str) -> str:
    """The Typeform-Signature forms-door checks: "sha256=" + base64 HMAC-SHA256 of the raw body."""
    return "sha256=" + base64.b64encode(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()).decode()


def post_door(url: str, body: str, headers: dict) -> tuple[int, Any]:
    """One request to forms-door (our own function: no receipt). Status 0 when it did not answer."""
    try:
        status, text = http("POST", url, {"Content-Type": "application/json", **headers}, body.encode())
    except NoAnswer:
        return 0, None
    try:
        return status, json.loads(text) if text else None
    except ValueError:
        return status, None


# ---------------------------------------------------------------- commands

def cmd_status(run: Run) -> int:
    for provider in PROVIDERS:
        status, key = run.rpc("cockpit_forms_key_get", {"p_provider": provider})
        if status != 200:
            raise Stop(f"The keys could not be read ({db_error(status, key)}).")
        if not isinstance(key, dict):
            run.say(f"{provider}: not saved")
            continue
        run.hide(key.get("secret"))
        line = (f"{provider}: {key.get('state') or 'unknown'}, key ending ····{ending(key.get('last4'))}, "
                f"saved {kuwait(key.get('savedAt'))}")
        if provider == "fathom_webhook":
            line += ", registered" if registered(key.get("meta")) else ", not registered"
        run.say(line)
    # The Typeform signing keys, as cockpit_forms_keys_status lists them under typeform (Z57): that function is for
    # the CEO's signed-in seat only, so this reads the same fields through the service RPC and the forms-door sync row.
    # A sync row that could not be read says so and exits 1: it never reads as "no delivery yet".
    unread = 0
    for form, provider in TYPEFORM_FORMS.items():
        status, key = run.rpc("cockpit_forms_key_get", {"p_provider": provider})
        if status != 200:
            raise Stop(f"The keys could not be read ({db_error(status, key)}).")
        if not isinstance(key, dict):
            run.say(f"typeform {form}: not saved")
            continue
        run.hide(key.get("secret"))
        why = None
        try:
            code, text = run.supabase("GET", f"/rest/v1/cockpit_sync_state?select=detail&key=eq.forms-door:{form}")
            rows = json.loads(text) if code == 200 else None
            if code != 200:
                why = f"HTTP {code}"
            elif not isinstance(rows, list):
                why = "an answer without a list"
        except NoAnswer:
            why = "no answer"
        except ValueError:
            why = "an answer that was not JSON"
        if why:
            unread += 1
            last = f"its last delivery could not be read ({why})"
        else:
            detail = rows[0].get("detail") if rows and isinstance(rows[0], dict) else None
            detail = detail if isinstance(detail, dict) else {}
            last = (f"last delivery {kuwait(detail.get('lastDelivery'))} ({detail.get('outcome') or 'no outcome'})"
                    if detail.get("lastDelivery") else "no delivery yet")
        run.say(f"typeform {form}: {key.get('state') or 'unknown'}, key ending ····{ending(key.get('last4'))}, "
                f"saved {kuwait(key.get('savedAt'))}, {'registered' if registered(key.get('meta')) else 'not registered'}, {last}")
    return 1 if unread else 0


def cmd_doctor(run: Run) -> int:
    try:
        status, text = run.supabase("POST", "/functions/v1/cockpit-forms-api", {"op": "doctor"})
    except NoAnswer:
        raise Stop("cockpit-forms-api did not answer.") from None
    try:
        body = json.loads(text)
    except ValueError:
        raise Stop(f"cockpit-forms-api answered HTTP {status} without JSON.") from None
    run.say(json.dumps(body, indent=2, ensure_ascii=False))
    return 0 if status == 200 and isinstance(body, dict) and body.get("ok") is True else 1


def cmd_fathom(run: Run) -> int:
    key = env_key(run, "FATHOM_API_KEY")
    headers = fathom_headers(key)
    # 200 only for an account admin: the key must reach every recording the team shares.
    status, text = run.call("fathom", "GET", f"{FATHOM}/users?status=active", "api.fathom.ai/external/v1/users", headers)
    if status == 0:
        raise Stop("Fathom could not be reached. Nothing was saved.")
    if status != 200:
        raise Stop(f"fathom refused the key: HTTP {status}. Nothing was saved.")
    users = items_of(text)
    if users is None:
        raise Stop("Fathom answered the users read without a list. Nothing was saved.")
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
    # teams[] keeps its brackets: without them Fathom drops the filter and answers with the CEO's private meetings.
    query = f"teams[]={urllib.parse.quote(CS_TEAM)}&created_after={urllib.parse.quote(since)}"
    status, text = run.call("fathom", "GET", f"{FATHOM}/meetings?{query}", "api.fathom.ai/external/v1/meetings", headers)
    if status == 0:
        raise Stop("Fathom could not be reached. Nothing was saved.")
    if status != 200:
        raise Stop(f"fathom refused the Customer Success meetings read: HTTP {status}. Nothing was saved.")
    items = items_of(text)
    if items is None or any((i.get("recorded_by") or {}).get("team") != CS_TEAM for i in items):
        raise Stop("Fathom's team filter answered with meetings outside Customer Success, so the key was not saved.")
    status, out = save(run, {"provider": "fathom", "secret": key, "savedBy": "server", "state": "connected",
                             "stateNote": "Saved from the server's api-keys.env.",
                             "meta": {"users": len(users), "adminOk": True, "csFilterOk": True}})
    if status != 200 or not isinstance(out, dict) or not out.get("ok"):
        raise Stop(f"The key was not saved ({db_error(status, out)}).")
    run.say(f"fathom: the key works ({plural(len(users), 'active user')}). Saved, key ending ····{ending(out.get('last4'))}")
    return 0


def cmd_deepseek(run: Run) -> int:
    key = env_key(run, "DEEPSEEK_API_KEY")
    status, text = run.call("deepseek", "GET", DEEPSEEK_MODELS, "api.deepseek.com",
                            {"Authorization": "Bearer " + key, "Accept": "application/json"})
    if status == 0:
        raise Stop("DeepSeek could not be reached. Nothing was saved.")
    if status != 200:
        raise Stop(f"deepseek refused the key: HTTP {status}. Nothing was saved.")
    models = items_of(text, "data") or []
    if "deepseek-flash" not in {m.get("id") for m in models}:
        raise Stop("DeepSeek does not list deepseek-flash for this key. Nothing was saved.")
    status, out = save(run, {"provider": "deepseek", "secret": key, "savedBy": "server", "state": "connected",
                             "stateNote": "Saved from the server's api-keys.env."})
    if status != 200 or not isinstance(out, dict) or not out.get("ok"):
        raise Stop(f"The key was not saved ({db_error(status, out)}).")
    run.say(f"deepseek: the key works. Saved, key ending ····{ending(out.get('last4'))}")
    return 0


def cmd_register(run: Run) -> int:
    current = webhook_key(run)
    meta = (current or {}).get("meta")
    if registered(meta):
        raise Stop(f"A webhook is already registered (id ending {ending(meta.get('webhookId'))}). "
                   "Run unregister-webhook first.")
    key = env_key(run, "FATHOM_API_KEY")
    body = webhook_body(run.url)
    status, text = run.call("fathom", "POST", f"{FATHOM}/webhooks", "api.fathom.ai/external/v1/webhooks",
                            fathom_headers(key), body)
    if status == 0:
        raise Stop("Fathom did not answer. Check Fathom's settings for a new webhook to this function before you "
                   "run this again.")
    if not 200 <= status < 300:
        raise Stop(f"Fathom refused the webhook: HTTP {status}. Nothing was registered.")
    try:
        answer = json.loads(text) if text else {}
    except ValueError:
        answer = {}
    answer = answer if isinstance(answer, dict) else {}
    webhook_id = str(answer.get("id") or "").strip()
    if not webhook_id:
        raise Stop("Fathom answered without the webhook id. Check Fathom's settings for a new webhook to this function.")
    secret = answer.get("secret") if isinstance(answer.get("secret"), str) else ""
    run.hide(secret)
    if not secret:
        failed = "Fathom answered without the webhook secret"
    else:
        meta = {"webhookId": webhook_id,
                "triggeredFor": answer.get("triggered_for") or body["triggered_for"],
                "includes": {"transcript": answer.get("include_transcript", body["include_transcript"]),
                             "summary": answer.get("include_summary", body["include_summary"]),
                             "actionItems": answer.get("include_action_items", body["include_action_items"]),
                             "crmMatches": answer.get("include_crm_matches", body["include_crm_matches"])},
                "destination": answer.get("url") or answer.get("destination_url") or body["destination_url"],
                "createdAt": answer.get("created_at") or now_iso()}
        saved, out = save(run, {"provider": "fathom_webhook", "secret": secret, "savedBy": "server",
                                "state": "unchecked", "meta": meta})
        if saved == 200 and isinstance(out, dict) and out.get("ok"):
            run.say(f"Webhook registered, id ending {ending(webhook_id)}.")
            return 0
        failed = f"The webhook secret was not saved ({db_error(saved, out)})"
    # A webhook whose secret is not saved can never deliver, and Fathom has no list call to find it later.
    try:
        gone, _ = delete_webhook(run, key, webhook_id)
    except NoReceipt:
        gone = None
    run.say(f"{failed}. Fathom's answer to deleting the webhook: {answered(gone)}.")
    if gone is None or not (200 <= gone < 300 or gone == 404):
        run.say(f"Delete the webhook ending {ending(webhook_id)} in Fathom's settings, then run this again.")
    return 1


def post_delivery(url: str, msg_id: str, timestamp: str, body: str, signature: str) -> int:
    """One test delivery, as Fathom sends it (no JWT, no apikey). Our own function: no receipt."""
    headers = {"Content-Type": "application/json", "webhook-id": msg_id, "webhook-timestamp": timestamp,
               "webhook-signature": signature}
    try:
        status, _ = http("POST", url, headers, body.encode())
    except NoAnswer:
        return 0
    return status


def cmd_probe(run: Run) -> int:
    current = webhook_key(run)
    secret = (current or {}).get("secret")
    if not isinstance(secret, str) or not secret:
        raise Stop("No webhook secret is saved. Run register-webhook first.")
    url = run.url + "/functions/v1/fathom-webhook"
    body = json.dumps(PROBE_MEETING)
    timestamp = str(int(time.time()))
    wrong = "v1," + base64.b64encode(os.urandom(32)).decode()
    first = post_delivery(url, "probe_" + uuid.uuid4().hex, timestamp, body, wrong)
    run.say(f"Wrong signature: {answered(first)} (expected HTTP 401).")
    msg_id = "probe_" + uuid.uuid4().hex
    second = post_delivery(url, msg_id, timestamp, body, sign(secret, msg_id, timestamp, body))
    try:
        code, text = run.supabase("GET", "/rest/v1/cockpit_fathom_webhook_deliveries?select=outcome,reason"
                                  f"&webhook_id=eq.{urllib.parse.quote(msg_id)}")
        rows = json.loads(text) if code == 200 else []
    except (NoAnswer, ValueError):
        rows = []
    outcome = rows[0].get("outcome") if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None
    run.say(f"Signed Probe delivery: {answered(second)} (expected HTTP 200), delivery {outcome or 'not found'} "
            "(expected ignored).")
    if first != 401 or second != 200 or outcome != "ignored":
        raise Stop("The webhook probe did not pass, so the webhook key was not marked connected.")
    status, out = run.rpc("cockpit_forms_key_mark", {"p": {
        "provider": "fathom_webhook", "state": "connected", "savedAt": current.get("savedAt"),
        "note": "Probed from the server: a wrong signature is refused and a signed delivery is recorded."}})
    if status != 200 or not isinstance(out, dict) or not out.get("ok"):
        raise Stop(f"The webhook key was not marked connected ({mark_error(status, out)}).")
    run.say("The webhook key is marked connected.")
    return 0


def cmd_unregister(run: Run) -> int:
    current = webhook_key(run)
    meta = (current or {}).get("meta")
    meta = meta if isinstance(meta, dict) else {}
    webhook_id = str(meta.get("webhookId") or "").strip()
    if not webhook_id:
        raise Stop("No webhook is registered, so there is nothing to delete.")
    if meta.get("unregisteredAt"):
        run.say(f"The webhook ending {ending(webhook_id)} was already unregistered at {kuwait(meta['unregisteredAt'])}.")
        return 0
    key = env_key(run, "FATHOM_API_KEY")
    status, _ = delete_webhook(run, key, webhook_id)
    run.say(f"Fathom's answer to deleting the webhook: {answered(status)}{' (already gone)' if status == 404 else ''}.")
    if not (200 <= status < 300 or status == 404):
        raise Stop("Fathom did not delete the webhook, so the registration was not marked off.")
    # Marking it refused with unregisteredAt turns cockpit_sync_state fathom-webhook detail.registered false,
    # so the guardian stops expecting deliveries.
    status, out = run.rpc("cockpit_forms_key_mark", {"p": {
        "provider": "fathom_webhook", "state": "refused", "note": "Unregistered by the build session.",
        "meta": {"unregisteredAt": now_iso()}, "savedAt": current.get("savedAt")}})
    if status != 200 or not isinstance(out, dict) or not out.get("ok"):
        raise Stop(f"Fathom deleted the webhook, but the registration was not marked off ({mark_error(status, out)}). "
                   "Run unregister-webhook again.")
    run.say(f"Webhook ending {ending(webhook_id)} unregistered.")
    return 0


def cmd_typeform_secret(run: Run, form: str) -> int:
    current = typeform_key(run, form)
    meta = (current or {}).get("meta")
    if registered(meta):
        raise Stop(f"The cockpit webhook of the {form} form is registered with the saved key. Run unregister-typeform "
                   f"{form} first, then typeform-secret and register-typeform again.")
    secret = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")
    run.hide(secret)
    status, out = save(run, {"provider": TYPEFORM_FORMS[form], "secret": secret, "savedBy": "server", "state": "unchecked",
                             "stateNote": f"Made on the server for the {form} form's Typeform webhook.",
                             "meta": {"form": form, "tag": WEBHOOK_TAG}})
    if status != 200 or not isinstance(out, dict) or not out.get("ok"):
        raise Stop(f"The signing key was not saved ({db_error(status, out)}).")
    run.say(f"typeform {form}: a new signing key is saved, ending ····{ending(out.get('last4'))}. "
            f"Next: register-typeform {form}.")
    return 0


def cmd_register_typeform(run: Run, form: str) -> int:
    form_id = typeform_form_id(run, form)
    current = typeform_key(run, form)
    secret = (current or {}).get("secret")
    if not isinstance(secret, str) or not secret:
        raise Stop(f"No signing key is saved for the {form} form. Run typeform-secret {form} first.")
    key = typeform_token(run)
    before = typeform_hooks(run, key, form_id)
    url = door_url(run, form)
    body = {"url": url, "enabled": True, "secret": secret, "verify_ssl": True, "event_types": {"form_response": True}}
    status, text = run.call("typeform", "PUT", f"{TYPEFORM}/forms/{form_id}/webhooks/{WEBHOOK_TAG}",
                            "api.typeform.com/forms/:id/webhooks/:tag", typeform_headers(key), body)
    if status == 0:
        raise Stop(f"Typeform did not answer. Read the {form} form's webhooks in Typeform before you run this again.")
    if not 200 <= status < 300:
        raise Stop(f"typeform refused the webhook: HTTP {status}. Nothing was registered.")
    try:
        answer = json.loads(text) if text else {}
    except ValueError:
        answer = {}
    answer = answer if isinstance(answer, dict) else {}
    after = typeform_hooks(run, key, form_id, read_back_failed("put", "the key was not marked connected", "register-typeform", form))
    hook = cockpit_hook(after)
    if not hook or hook.get("url") != url or hook.get("enabled") is not True:
        raise Stop(f"Typeform's list does not show the cockpit webhook enabled to forms-door. Read the {form} form's "
                   "webhooks in Typeform; the key was not marked connected.")
    if others_of(after) != others_of(before):
        raise Stop(f"The {form} form's other webhooks changed while this ran. Read them in Typeform; the key was not "
                   "marked connected.")
    webhook_id = str(hook.get("id") or answer.get("id") or WEBHOOK_TAG)
    status, out = run.rpc("cockpit_forms_key_mark", {"p": {
        "provider": TYPEFORM_FORMS[form], "state": "connected", "savedAt": current.get("savedAt"),
        "note": f"Registered on Typeform from the server: tag {WEBHOOK_TAG}, read back enabled.",
        "meta": {"webhookId": webhook_id, "tag": WEBHOOK_TAG, "formId": form_id, "destination": url,
                 "registeredAt": now_iso(), "unregisteredAt": None}}})
    if status != 200 or not isinstance(out, dict) or not out.get("ok"):
        raise Stop(f"The webhook is on Typeform, but the key was not marked connected ({mark_error(status, out)}). "
                   f"Run register-typeform {form} again.")
    n = len(others_of(after))
    run.say(f"Typeform webhook {WEBHOOK_TAG} registered on {form_id}, read back enabled; "
            f"{plural(n, 'other webhook')} of the form unchanged. Next: probe-typeform {form}.")
    return 0


def cmd_probe_typeform(run: Run, form: str) -> int:
    current = typeform_key(run, form)
    secret = (current or {}).get("secret")
    if not isinstance(secret, str) or not secret:
        raise Stop(f"No signing key is saved for the {form} form. Run typeform-secret {form} first.")
    url = door_url(run, form)
    body = json.dumps({"event_type": "probe", "probe": True})
    first, _ = post_door(url, body, {"x-forms-door-probe": "1"})
    run.say(f"Unsigned probe: {answered(first)} (expected HTTP 401).")
    second, answer = post_door(url, body, {"x-forms-door-probe": "1", "Typeform-Signature": typeform_sign(secret, body)})
    probed = isinstance(answer, dict) and answer.get("probe") is True
    run.say(f"Signed probe: {answered(second)}{' with the probe answer' if probed else ''} (expected HTTP 200).")
    if first != 401 or second != 200 or not probed:
        raise Stop("The forms-door probe did not pass.")
    run.say(f"forms-door checks the {form} form's signature.")
    return 0


def cmd_unregister_typeform(run: Run, form: str) -> int:
    current = typeform_key(run, form)
    meta = (current or {}).get("meta")
    meta = meta if isinstance(meta, dict) else {}
    form_id = registered_form_id(run, form, meta)
    key = typeform_token(run)
    before = typeform_hooks(run, key, form_id)
    if cockpit_hook(before) is None and not registered(meta):
        run.say(f"No cockpit webhook is registered on the {form} form, so there is nothing to delete.")
        return 0
    if cockpit_hook(before) is not None:
        status, _ = run.call("typeform", "DELETE", f"{TYPEFORM}/forms/{form_id}/webhooks/{WEBHOOK_TAG}",
                             "api.typeform.com/forms/:id/webhooks/:tag", typeform_headers(key))
        run.say(f"Typeform's answer to deleting the webhook: {answered(status)}{' (already gone)' if status == 404 else ''}.")
        if not (200 <= status < 300 or status == 404):
            raise Stop("Typeform did not delete the webhook, so the registration was not marked off.")
        after = typeform_hooks(run, key, form_id,
                               read_back_failed("deleted", "the registration was not marked off", "unregister-typeform", form))
        if cockpit_hook(after) is not None:
            raise Stop("Typeform still lists the cockpit webhook, so the registration was not marked off.")
        if others_of(after) != others_of(before):
            run.say(f"The {form} form's other webhooks changed while this ran; read them in Typeform.")
    if current is None:
        run.say("No signing key is saved, so there is no registration to mark off.")
        return 0
    # Marking it refused with unregisteredAt turns forms-door:kickoff detail.registered false, so the guardian stops
    # expecting deliveries.
    status, out = run.rpc("cockpit_forms_key_mark", {"p": {
        "provider": TYPEFORM_FORMS[form], "state": "refused", "note": "Unregistered from the server.",
        "meta": {"unregisteredAt": now_iso()}, "savedAt": current.get("savedAt")}})
    if status != 200 or not isinstance(out, dict) or not out.get("ok"):
        raise Stop(f"Typeform has no cockpit webhook, but the registration was not marked off ({mark_error(status, out)}). "
                   f"Run unregister-typeform {form} again.")
    run.say(f"The cockpit webhook of the {form} form is unregistered.")
    return 0


COMMANDS = {"status": cmd_status, "doctor": cmd_doctor, "fathom": cmd_fathom, "deepseek": cmd_deepseek,
            "register-webhook": cmd_register, "probe-webhook": cmd_probe, "unregister-webhook": cmd_unregister}
# The commands that take a form; only kickoff has a cockpit webhook in 2b (Z58).
FORM_COMMANDS = {"typeform-secret": cmd_typeform_secret, "register-typeform": cmd_register_typeform,
                 "probe-typeform": cmd_probe_typeform, "unregister-typeform": cmd_unregister_typeform}


def main(argv: Optional[list] = None) -> int:
    args = sys.argv[1:] if argv is None else list(argv)
    name = args[0] if args else ""
    if name not in COMMANDS and name not in FORM_COMMANDS:
        print("Name one command: " + ", ".join([*COMMANDS, *(f"{c} <form>" for c in FORM_COMMANDS)]) + ".")
        return 2
    form = args[1] if len(args) > 1 else ""
    if name in FORM_COMMANDS and form not in TYPEFORM_FORMS:
        print(ONLY_KICKOFF)
        return 2
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    run = None
    try:
        url, service = runtime()
        run = Run(url, service)
        code = FORM_COMMANDS[name](run, form) if name in FORM_COMMANDS else COMMANDS[name](run)
    except Stop as e:
        print(run.redact(e) if run else KEY_SHAPES.sub("[key]", str(e)))
        code = 1
    except Exception as e:  # noqa: BLE001 - one plain line, never a traceback that could hold a value
        text = f"{name} stopped: {type(e).__name__}: {e}"
        print(run.redact(text) if run else KEY_SHAPES.sub("[key]", text))
        code = 1
    if run and run.missed:
        print(f"{plural(run.missed, 'receipt')} after a provider call could not be saved; "
              "cockpit_csm_provider_health is missing them.")
        code = code or 1
    return code


if __name__ == "__main__":
    sys.exit(main())
