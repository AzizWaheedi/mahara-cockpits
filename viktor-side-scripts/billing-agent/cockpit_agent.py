#!/usr/bin/env python3
"""The billing agent's client for its own cockpit door (docs/forms/WAVE56-CONTRACT.md 3.4, AG).

Standard library only. The agent (the billing skill on the VPS) writes and reads through the
cockpit's billing-agent Edge Function with a key of its own, never with a Supabase key:

    from cockpit_agent import door, read, Refused
    door("chase", {"taskId": "86ab...", "step": "D+3 reminder", "note": "Sent on WhatsApp"})
    door("payment", {"taskId": "86ab...", "paidOn": "2026-11-02", "amount": 650, "currency": "KWD",
                     "method": "bank_transfer", "reference": "FT123", "evidenceUrl": "https://..."})
    read("chases")

Environment, read by name and never printed, logged or passed as an argument:
    MAHARA_AGENT_KEY   the agent's key (mak_ and 43 base64url characters)
    COCKPIT_URL        https://<project>.supabase.co (the door is ${COCKPIT_URL}/functions/v1/billing-agent)

Each call carries a fresh request id (pass the same one to retry safely: the cockpit answers a
repeated id with its first result), waits at most 15 seconds, and a refusal raises Refused with
the cockpit's own sentence, unchanged. No op writes ClickUp, LTV, a next payment date or a
manual payment: those go through the cockpit's rails.

    python3 cockpit_agent.py doctor     key present, door reachable, read ladder ok (exit 0, else 1)
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid
from typing import Any, Callable

KEY_NAME = "MAHARA_AGENT_KEY"
URL_NAME = "COCKPIT_URL"
TIMEOUT_S = 15
KEY_SHAPE = re.compile(r"^mak_[A-Za-z0-9_-]{43}$")
URL_SHAPE = re.compile(r"^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/?$")
WRITE_OPS = ("chase", "invoice", "payment", "note")
READS = ("accounts", "ladder", "balances", "inbox", "chases")


class Refused(Exception):
    """The cockpit refused the call; str() is its sentence, unchanged."""

    def __init__(self, sentence: str, status: int | None = None, outcome: str | None = None):
        super().__init__(sentence)
        self.sentence = sentence
        self.status = status
        self.outcome = outcome


class NotSetUp(Exception):
    """The agent's key or the cockpit address is missing; never names the key's value."""


def _env(name: str, environ: dict[str, str] | None = None) -> str:
    return (environ if environ is not None else os.environ).get(name, "").strip()


def _key(environ: dict[str, str] | None = None) -> str:
    key = _env(KEY_NAME, environ)
    if not key:
        raise NotSetUp(f"{KEY_NAME} is not set. The systems manager puts the agent's key in its own env file.")
    if not KEY_SHAPE.match(key):
        raise NotSetUp(f"{KEY_NAME} is not an agent key (mak_ and 43 characters). Ask for a new one.")
    return key


def _door_url(environ: dict[str, str] | None = None) -> str:
    base = _env(URL_NAME, environ)
    if not base or not URL_SHAPE.match(base):
        raise NotSetUp(f"{URL_NAME} is not set to the cockpit's https address.")
    return base.rstrip("/") + "/functions/v1/billing-agent"


Opener = Callable[..., Any]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect: urllib would re-send the POST as a GET to the Location host with the
    Authorization header (the agent's key) copied over."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def _post(payload: dict[str, Any], environ: dict[str, str] | None = None, opener: Opener | None = None) -> dict[str, Any]:
    key = _key(environ)
    req = urllib.request.Request(
        _door_url(environ),
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "application/json"},
    )
    open_ = opener or _OPENER.open
    try:
        with open_(req, timeout=TIMEOUT_S) as res:
            body = res.read().decode("utf-8")
            status = getattr(res, "status", 200)
    except urllib.error.HTTPError as e:  # a refusal: the cockpit's sentence is in the body
        if 300 <= e.code < 400:
            raise Refused(f"The cockpit's door answered with a redirect; check {URL_NAME}.", status=e.code) from None
        status = e.code
        body = e.read().decode("utf-8", "replace") if e.fp else ""
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise Refused(f"The cockpit's door did not answer ({type(e).__name__}). Try again with the same request id.") from None
    try:
        data = json.loads(body) if body else {}
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    if 300 <= status < 400:
        raise Refused(f"The cockpit's door answered with a redirect; check {URL_NAME}.", status=status)
    if status == 200 and data.get("ok") is True:
        return data
    sentence = data.get("error") if isinstance(data.get("error"), str) else None
    if sentence is None:
        sentence = "The cockpit refused the agent's key." if status == 401 else f"The cockpit answered {status}."
    raise Refused(sentence, status=status, outcome=data.get("outcome") if isinstance(data.get("outcome"), str) else None)


def door(op: str, body: dict[str, Any], request_id: str | None = None, *, environ: dict[str, str] | None = None,
         opener: Opener | None = None) -> dict[str, Any]:
    """One write (chase, invoice, payment or note). Returns the cockpit's answer {ok, outcome, result, requestId}."""
    if op not in WRITE_OPS:
        raise ValueError(f"The agent writes {', '.join(WRITE_OPS)}, not {op}.")
    if not isinstance(body, dict):
        raise ValueError("Send the body as a dict.")
    return _post({"op": op, "body": body, "requestId": request_id or str(uuid.uuid4())}, environ, opener)


def read(what: str, args: dict[str, Any] | None = None, request_id: str | None = None, *,
         environ: dict[str, str] | None = None, opener: Opener | None = None) -> Any:
    """One read (accounts, ladder, balances, inbox or chases). Returns its result."""
    if what not in READS:
        raise ValueError(f"The agent reads {', '.join(READS)}, not {what}.")
    out = _post({"what": what, "args": args or {}, "requestId": request_id or str(uuid.uuid4())}, environ, opener)
    return out.get("result")


def doctor(*, environ: dict[str, str] | None = None, opener: Opener | None = None, out=sys.stdout) -> int:
    """Key present, door reachable, read ladder ok. Plain lines; never the key."""
    ok = True
    try:
        _key(environ)
        print("Key: set.", file=out)
    except NotSetUp as e:
        print(f"Key: {e}", file=out)
        ok = False
    try:
        _door_url(environ)
        print("Cockpit address: set.", file=out)
    except NotSetUp as e:
        print(f"Cockpit address: {e}", file=out)
        ok = False
    if not ok:
        print("Not ready: fix the lines above.", file=out)
        return 1
    try:
        ladder = read("ladder", environ=environ, opener=opener)
    except Refused as e:
        print(f"Door: {e.sentence}", file=out)
        return 1
    if not isinstance(ladder, dict) or "pauseReviewDay" not in ladder:
        print("Door: answered, but the ladder read was not what the cockpit sends.", file=out)
        return 1
    print(f"Door: ok. Ladder: pause review on day {ladder['pauseReviewDay']}, cancel review on day {ladder.get('cancelReviewDay')}.", file=out)
    return 0


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[1] == "doctor":
        return doctor()
    if len(argv) == 3 and argv[1] == "read" and argv[2] in READS:
        try:
            print(json.dumps(read(argv[2]), ensure_ascii=False, indent=2))
            return 0
        except (Refused, NotSetUp) as e:
            print(str(e), file=sys.stderr)
            return 1
    print("Usage: cockpit_agent.py doctor | read <accounts|ladder|balances|inbox|chases>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
