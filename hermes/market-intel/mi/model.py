"""The engine, behind one small interface and a config switch (MARKET_INTEL_MODEL_PROVIDER), with no tools.

- `vps` (default): the Claude proxy on the VPS (127.0.0.1:3456, OpenAI-shaped, the CEO's own Claude sign-in, no
  key), which runs the Claude CLI; the sales desk's door, already watched by the guardian's claude_proxy check.
  Streaming, so the timeout is the longest silence, not a budget (a write takes 5 to 10 minutes).
- `cli`: `claude -p --output-format json` with every tool off, in an empty folder, the prompt on stdin;
  CLAUDE_CODE_OAUTH_TOKEN read by name from ~/.market-intel/env (a setup token on the CEO's own plan, never a
  teammate's), with ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN and ANTHROPIC_BASE_URL removed first so it can never
  fall back to API billing.

No provider can name a model outside Claude's (client data never goes to DeepSeek or any other vendor), and a
model name with a colon (a router variant) is refused. ModelUnreachable is an outage: the run goes back to the
queue and resumes later without pulling again. ModelError is one failed attempt.
"""
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import tempfile
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Optional

from . import http

ALLOWED = ("opus", "sonnet", "haiku", "claude-")
VPS_SIGN_IN = ("The Claude sign-in on the VPS has lapsed, so research waits. Sign Claude Code in again on the VPS "
               "(run claude, then /login); research resumes by itself.")
PROXY_ERROR = re.compile(r"^\[Error: (.*)\]$", re.S)
REMOVED_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL")


class ModelUnreachable(Exception):
    def __init__(self, sentence: str):
        super().__init__(sentence)
        self.sentence = sentence


class ModelError(Exception):
    pass


@dataclass
class Reply:
    text: str
    model: str
    usage: dict[str, Any] = field(default_factory=dict)


def check_model(model: str) -> None:
    m = str(model or "").strip().lower()
    if ":" in m or not m.startswith(ALLOWED):
        raise ModelUnreachable(f"{model or 'No model'} is not a model research may send a client's answers to. Set "
                               "MARKET_INTEL_MODEL_PICK and MARKET_INTEL_MODEL_WRITE to opus, sonnet or a claude- model.")


def estimate_usage(asked: str, answered: str) -> dict[str, int]:
    """Neither door reports tokens reliably, so usage is estimated at three characters a token (high side)."""
    return {"inputTokensEst": len(asked) // 3, "outputTokensEst": len(answered) // 3}


def _classify_said(said: str) -> Exception:
    low = said.lower()
    if any(w in low for w in ("oauth", "authenticate", "401", "subscription access", "login", "not logged in")):
        return ModelUnreachable(VPS_SIGN_IN)
    if any(w in low for w in ("usage limit", "hit your limit", "limit reached", "rate limit")):
        return ModelUnreachable("The Claude plan on the VPS is at its usage limit, so research waits until it resets.")
    return ModelError(f"the Claude engine failed: {http.scrub(said)[:300]}")


def read_sse(lines: Iterable[bytes]) -> str:
    out: list[str] = []
    for raw in lines:
        line = raw.decode("utf-8", "replace").strip() if isinstance(raw, bytes) else str(raw).strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            break
        try:
            obj = json.loads(data)
        except ValueError:
            continue
        if isinstance(obj, dict) and obj.get("error"):
            err = obj["error"]
            raise _classify_said(str(err.get("message") if isinstance(err, dict) else err))
        for ch in obj.get("choices") or []:
            piece = ((ch or {}).get("delta") or {}).get("content") or ((ch or {}).get("message") or {}).get("content")
            if piece:
                out.append(piece)
    return "".join(out)


class VpsEngine:
    name = "vps"

    def __init__(self, base: str, ledger: Any, *, open_stream: Optional[Callable[..., Any]] = None):
        self.base = base.rstrip("/")
        self.ledger = ledger
        self.open_stream = open_stream or http.open_stream

    def complete(self, system: str, user: str, *, model: str, timeout: float) -> Reply:
        check_model(model)
        url = f"{self.base}/chat/completions"
        body = {"model": model, "stream": True,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}

        def go() -> str:
            resp = self.open_stream(url, headers={"Authorization": "Bearer vps"}, json_body=body, timeout=timeout)
            with resp:
                return read_sse(resp)

        try:
            text = self.ledger.call("claude", "POST", url, go)
        except http.HttpError as e:
            if e.status == 0:
                raise ModelUnreachable("The Claude proxy on the VPS (127.0.0.1:3456) is not answering. Start it "
                                       "again; research resumes by itself.") from None
            raise _classify_said(e.body.decode("utf-8", "replace") if e.body else str(e)) from None
        except (socket.timeout, TimeoutError):
            raise ModelError(f"no answer from the Claude proxy for {int(timeout)} seconds") from None
        m = PROXY_ERROR.match(text.strip())
        if m:
            raise _classify_said(m.group(1))
        if not text.strip():
            raise ModelError("the Claude proxy answered with nothing")
        return Reply(text=text, model=model, usage=estimate_usage(system + user, text))

    def ping(self, model: str, timeout: float = 120) -> str:
        return self.complete("Answer with one word.", "Say OK.", model=model, timeout=timeout).text.strip()[:20]


class CliEngine:
    name = "cli"

    def __init__(self, binary: str, token: str, ledger: Any, *, run: Optional[Callable[..., Any]] = None):
        self.binary = binary
        self.token = token
        self.ledger = ledger
        self._run = run or subprocess.run

    def argv(self, system: str, model: str) -> list[str]:
        # Every built-in tool off, no MCP servers, one answer.
        return [self.binary, "-p", "--output-format", "json", "--model", model, "--system-prompt", system,
                "--tools", "", "--strict-mcp-config", "--max-turns", "1"]

    def env(self) -> dict[str, str]:
        env = {k: v for k, v in os.environ.items() if k not in REMOVED_ENV}
        env["CLAUDE_CODE_OAUTH_TOKEN"] = self.token
        return env

    def complete(self, system: str, user: str, *, model: str, timeout: float) -> Reply:
        check_model(model)
        if not self.token:
            raise ModelUnreachable("CLAUDE_CODE_OAUTH_TOKEN is not in ~/.market-intel/env, so the cli engine cannot "
                                   "sign in. Run claude setup-token as the CEO and add it, or use the vps engine.")

        def go() -> Any:
            with tempfile.TemporaryDirectory(prefix="mi-claude-") as cwd:
                return self._run(self.argv(system, model), input=user, capture_output=True, text=True,
                                 timeout=timeout, env=self.env(), cwd=cwd)

        try:
            proc = self.ledger.call("claude", "POST", "cli:claude -p", go)
        except FileNotFoundError:
            raise ModelUnreachable(f"The Claude CLI ({self.binary}) is not installed for this user.") from None
        except subprocess.TimeoutExpired:
            raise ModelError(f"the Claude CLI gave no answer in {int(timeout)} seconds") from None
        try:
            out = json.loads(proc.stdout or "{}")
        except ValueError:
            raise _classify_said((proc.stderr or proc.stdout or "no output")[:400]) from None
        if proc.returncode != 0 or out.get("is_error"):
            raise _classify_said(str(out.get("result") or proc.stderr or "the CLI failed")[:400])
        text = str(out.get("result") or "")
        if not text.strip():
            raise ModelError("the Claude CLI answered with nothing")
        usage = out.get("usage") if isinstance(out.get("usage"), dict) else estimate_usage(system + user, text)
        if isinstance(out.get("total_cost_usd"), (int, float)):
            usage = {**usage, "planUsdEquivalent": out["total_cost_usd"]}
        return Reply(text=text, model=model, usage=usage)

    def ping(self, model: str, timeout: float = 120) -> str:
        return self.complete("Answer with one word.", "Say OK.", model=model, timeout=timeout).text.strip()[:20]


def engine(cfg: Any, ledger: Any) -> Any:
    name = cfg.provider
    if name == "vps":
        return VpsEngine(cfg.vps_url, ledger)
    if name == "cli":
        return CliEngine(cfg.claude_bin, cfg.keys.get("CLAUDE_CODE_OAUTH_TOKEN"), ledger)
    if name == "anthropic":
        raise ModelUnreachable("MARKET_INTEL_MODEL_PROVIDER=anthropic is not built in this release (it spends API "
                               "money). Use vps or cli.")
    raise ModelUnreachable(f"MARKET_INTEL_MODEL_PROVIDER is {name!r}; it has to be vps or cli.")


def unfence(text: str) -> str:
    t = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", t, re.S)
    return m.group(1) if m else t


def as_json(text: str) -> dict[str, Any]:
    """The answer's JSON object: the whole text, else the first balanced {...} in it."""
    t = unfence(text)
    try:
        obj = json.loads(t)
        if isinstance(obj, dict):
            return obj
    except ValueError:
        pass
    # The JSON decoder itself reads from each "{" in turn (strings, escapes and nesting as JSON defines them), so
    # the first object that parses whole is the answer, never an inner one.
    dec = json.JSONDecoder()
    start = t.find("{")
    while start >= 0:
        try:
            obj, _ = dec.raw_decode(t, start)
            if isinstance(obj, dict):
                return obj
        except ValueError:
            pass
        start = t.find("{", start + 1)
    raise ModelError("the answer held no JSON object")


def call_json(eng: Any, system: str, user: str, *, model: str, timeout: float, attempts: int = 2,
              usage: Optional[dict[str, Any]] = None, label: str = "call") -> dict[str, Any]:
    last: Optional[Exception] = None
    for _ in range(max(1, attempts)):
        try:
            reply = eng.complete(system, user, model=model, timeout=timeout)
            obj = as_json(reply.text)
            if usage is not None:
                usage[label] = {"model": model, **(reply.usage or {})}
            return obj
        except ModelError as e:
            last = e
    raise ModelError(f"{label}: {last}")
