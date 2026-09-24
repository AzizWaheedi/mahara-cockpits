"""The model, behind one small interface: OpenAI, Anthropic or OpenRouter.

The engine in Mahara-B2B called an OpenAI-shaped proxy to Claude on
Muhammed's account. That proxy is not ours, so the desk talks to a provider
directly with a key already on the VPS (Aziz, 2026-09-24: "the VPS" pays;
OpenAI by default, Anthropic or OpenRouter switched in by
SALES_MODEL_PROVIDER). Lead data never goes to DeepSeek: there is no DeepSeek
provider, and a DeepSeek model named through OpenRouter is refused.

Every call streams. Not for progress: streaming makes the socket timeout a
limit on silence between chunks rather than a budget for the whole answer,
and a draft legitimately takes six to eleven minutes. Where OpenAI will not
stream a model to an unverified organisation, the call is made once more
without streaming, with the same timeout on the whole answer.

Reasoning models are handled in three places: sampling temperature is not
sent to them (they refuse it), the answer is read from `content` with the
reasoning kept aside, and when `content` comes back empty the JSON is looked
for in the reasoning before the attempt is counted as failed.
"""
from __future__ import annotations

import json
import re
import socket
import time
from dataclasses import dataclass, field
from http.client import HTTPException
from typing import Any, Callable, Iterable, Optional

from . import http
from .config import DEFAULT_MODELS, PROVIDERS, Config
from .errors import NotNow

OPENAI_URL = "https://api.openai.com/v1"
OPENROUTER_URL = "https://openrouter.ai/api/v1"
ANTHROPIC_URL = "https://api.anthropic.com/v1"
ANTHROPIC_VERSION = "2023-06-01"
# Claude Opus 5 re-runs a request its safety classifier declines on another
# model, server side, when asked to. Proposals are ordinary business writing,
# so this should never fire; it is here so a false positive costs nothing.
ANTHROPIC_FALLBACK_BETA = "server-side-fallback-2026-07-01"
ANTHROPIC_MAX_TOKENS = 64000

KEY_NAMES = {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "openrouter": "OPENROUTER_API_KEY"}


class ModelUnreachable(NotNow):
    """The provider is not configured or will not talk to us at all.

    Its own type for the reason run_proposal.py gave: "the call could not be
    read" is a fair verdict when a model read a transcript and came back with
    nothing usable. It is a lie when nothing was ever asked.
    """


class ModelError(RuntimeError):
    """One attempt that failed: a timeout, an overloaded provider, a reply with no JSON."""


class NoJSON(ModelError):
    pass


@dataclass
class Reply:
    text: str = ""
    reasoning: str = ""
    finish: str = ""
    refusal: str = ""
    model: str = ""
    usage: dict[str, Any] = field(default_factory=dict)


def is_reasoning_model(model: str) -> bool:
    """OpenAI's reasoning families refuse `temperature`; so do the same models behind OpenRouter."""
    name = model.split("/", 1)[-1].lower()
    return bool(re.match(r"^(o\d|gpt-5)", name))


# ---- server-sent events -----------------------------------------------------

def sse_events(lines: Iterable[Any]) -> Iterable[tuple[Optional[str], str]]:
    """(event, data) pairs from a server-sent event stream. Comment lines,
    which OpenRouter sends as keepalives while a model thinks, are skipped."""
    event: Optional[str] = None
    data: list[str] = []
    for raw in lines:
        line = raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else str(raw)
        line = line.rstrip("\r\n")
        if not line:
            if data:
                yield event, "\n".join(data)
            event, data = None, []
            continue
        if line.startswith(":"):
            continue
        name, _, value = line.partition(":")
        if value.startswith(" "):
            value = value[1:]
        if name == "event":
            event = value
        elif name == "data":
            data.append(value)
    if data:
        yield event, "\n".join(data)


def read_openai_stream(lines: Iterable[Any]) -> Reply:
    text: list[str] = []
    reasoning: list[str] = []
    refusal: list[str] = []
    out = Reply()
    for _event, data in sse_events(lines):
        if data.strip() == "[DONE]":
            break
        try:
            chunk = json.loads(data)
        except ValueError:
            continue
        if not isinstance(chunk, dict):
            continue
        if chunk.get("error"):
            err = chunk["error"]
            message = err.get("message") if isinstance(err, dict) else err
            raise ModelError(f"the provider stopped mid-answer: {http.scrub(str(message))[:300]}")
        out.model = chunk.get("model") or out.model
        if chunk.get("usage"):
            out.usage = chunk["usage"]
        for choice in chunk.get("choices") or []:
            delta = choice.get("delta") or {}
            if isinstance(delta.get("content"), str):
                text.append(delta["content"])
            for k in ("reasoning", "reasoning_content"):
                if isinstance(delta.get(k), str):
                    reasoning.append(delta[k])
            if isinstance(delta.get("refusal"), str):
                refusal.append(delta["refusal"])
            if choice.get("finish_reason"):
                out.finish = choice["finish_reason"]
    out.text, out.reasoning, out.refusal = "".join(text).strip(), "".join(reasoning), "".join(refusal).strip()
    return out


def read_openai_body(body: bytes) -> Reply:
    d = json.loads(body.decode("utf-8"))
    choice = (d.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    content = msg.get("content")
    if isinstance(content, list):
        content = "".join(str(p.get("text") or "") for p in content if isinstance(p, dict))
    return Reply(
        text=str(content or "").strip(),
        reasoning=str(msg.get("reasoning") or msg.get("reasoning_content") or ""),
        finish=str(choice.get("finish_reason") or ""),
        refusal=str(msg.get("refusal") or "").strip(),
        model=str(d.get("model") or ""),
        usage=d.get("usage") or {},
    )


def read_anthropic_stream(lines: Iterable[Any]) -> Reply:
    text: list[str] = []
    thinking: list[str] = []
    out = Reply()
    for event, data in sse_events(lines):
        try:
            ev = json.loads(data)
        except ValueError:
            continue
        kind = ev.get("type") or event
        if kind == "error":
            err = ev.get("error") or {}
            raise ModelError(f"Anthropic stopped mid-answer: {err.get('type')}: {http.scrub(str(err.get('message')))[:300]}")
        if kind == "message_start":
            msg = ev.get("message") or {}
            out.model = msg.get("model") or out.model
            out.usage.update(msg.get("usage") or {})
        elif kind == "content_block_start":
            block = ev.get("content_block") or {}
            if block.get("type") == "fallback":
                # The first model declined and another took over: what the
                # first one wrote is not part of the answer.
                text, thinking = [], []
        elif kind == "content_block_delta":
            delta = ev.get("delta") or {}
            if delta.get("type") == "text_delta":
                text.append(str(delta.get("text") or ""))
            elif delta.get("type") == "thinking_delta":
                thinking.append(str(delta.get("thinking") or ""))
        elif kind == "message_delta":
            out.finish = (ev.get("delta") or {}).get("stop_reason") or out.finish
            out.usage.update(ev.get("usage") or {})
        elif kind == "message_stop":
            break
    out.text, out.reasoning = "".join(text).strip(), "".join(thinking)
    if out.finish == "refusal":
        out.refusal = "the model declined to answer"
    return out


# ---- getting the JSON out ---------------------------------------------------

_THINK = re.compile(r"<(think|thinking|reasoning)>.*?</\1>", re.S | re.I)
_OPEN_THINK = re.compile(r"^\s*<(think|thinking|reasoning)>", re.I)


def strip_reasoning(text: str) -> str:
    """Some models behind OpenRouter think out loud inside the answer."""
    text = _THINK.sub("", text or "")
    if _OPEN_THINK.match(text):
        # Never closed: whatever comes before the first brace is thinking.
        i = text.find("{")
        text = text[i:] if i != -1 else ""
    return text.strip()


def unfence(text: str) -> str:
    """The drafter is told to return bare JSON and occasionally dresses it."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text.strip("`")
        if "```" in text:
            text = text.rsplit("```", 1)[0]
    return text.strip()


def objects(text: str) -> list[tuple[int, int, dict[str, Any]]]:
    """Every top-level JSON object that decodes in the text, as (start, end, value).
    Decoding, not brace counting, so a brace inside a string cannot mislead it."""
    dec = json.JSONDecoder()
    out: list[tuple[int, int, dict[str, Any]]] = []
    i = text.find("{")
    while i != -1:
        try:
            value, end = dec.raw_decode(text, i)
        except ValueError:
            i = text.find("{", i + 1)
            continue
        if isinstance(value, dict):
            out.append((i, end, value))
            i = text.find("{", end)
        else:
            i = text.find("{", i + 1)
    return out


def as_json(text: str, reasoning: str = "", *, expect: Optional[Callable[[dict[str, Any]], bool]] = None,
            log: Optional[Callable[[str], None]] = None) -> dict[str, Any]:
    """Parse the answer, tolerating what models wrap around it.

    Strict first, because a clean answer should stay the normal path. Then the
    outermost braces, which is run_proposal.py's rule: the deal is one JSON
    object, so its first { and last } are its edges no matter what was said
    either side. Then the largest object that decodes anywhere in the answer.
    Last, when the answer itself is empty, the last object in the reasoning.
    `expect` says what the object has to look like, so a fragment of a reply
    that was cut off is never taken for the whole.
    """
    ok = expect or (lambda _d: True)
    note = log or (lambda _m: None)
    clean = unfence(strip_reasoning(text))
    try:
        value = json.loads(clean)
        if isinstance(value, dict) and ok(value):
            return value
    except ValueError:
        pass
    start, end = clean.find("{"), clean.rfind("}")
    if start != -1 and end > start:
        try:
            value = json.loads(clean[start : end + 1])
            if isinstance(value, dict) and ok(value):
                note(f"took the JSON object out of {len(clean) - (end + 1 - start)} characters of wrapping")
                return value
        except ValueError:
            pass
    for _s, _e, value in sorted(objects(clean), key=lambda o: o[1] - o[0], reverse=True):
        if ok(value):
            note("took the largest JSON object out of the answer")
            return value
    if reasoning and not clean:
        for _s, _e, value in reversed(objects(strip_reasoning(reasoning) or reasoning)):
            if ok(value):
                note("the answer was empty; took the JSON object from the reasoning")
                return value
    raise NoJSON("no JSON object in the reply; it began: %r" % (text or reasoning)[:200])


# ---- providers ----------------------------------------------------------------

def _classify(e: http.HttpError, provider: str, model: str) -> Exception:
    """An HTTP failure as either an outage (the request waits) or a failed try."""
    body = e.body.decode("utf-8", "replace") if isinstance(e.body, (bytes, bytearray)) else str(e)
    if e.status in (401, 403):
        return ModelUnreachable(
            f"{provider} refused the key ({e.status}). Set {KEY_NAMES[provider]} again on the VPS; "
            "drafting waits until then.")
    if e.status == 404 or "model_not_found" in body or "does not exist" in body:
        return ModelUnreachable(
            f"The model {model} is not available to this {provider} key ({e.status}). Set "
            "SALES_PROPOSAL_MODEL to one `desk.py doctor` lists; drafting waits until then.")
    if e.status == 402 or "insufficient_quota" in body or "credit balance" in body:
        return ModelUnreachable(f"The {provider} account is out of credit ({e.status}). Top it up; drafting waits until then.")
    if e.status == 0 and not e.timed_out:
        return ModelUnreachable(f"{provider} could not be reached: {http.scrub(str(e))[:200]}")
    return ModelError(f"{provider} answered {e.status or 'nothing'}: {http.scrub(body or str(e))[:300]}")


class OpenAIShaped:
    """OpenAI's chat completions, and OpenRouter, which speaks the same shape."""

    def __init__(self, name: str, base: str, key: str, model: str, *, max_tokens: Optional[int] = None,
                 reasoning_effort: str = "", json_mode: bool = True, extra_headers: Optional[dict[str, str]] = None,
                 log: Optional[Callable[[str], None]] = None):
        self.name = name
        self.base = base.rstrip("/")
        self.key = key
        self.model = model
        self.max_tokens = max_tokens
        self.reasoning_effort = reasoning_effort
        self.json_mode = json_mode
        self.extra_headers = extra_headers or {}
        self.log = log or (lambda _m: None)
        self.stream_ok = True
        self.temperature_ok = not is_reasoning_model(model)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.key}", **self.extra_headers}

    def _body(self, system: str, user: str, *, temperature: Optional[float], stream: bool) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "stream": stream,
        }
        if temperature is not None and self.temperature_ok:
            body["temperature"] = temperature
        if self.json_mode:
            body["response_format"] = {"type": "json_object"}
        if self.max_tokens:
            body["max_completion_tokens" if self.name == "openai" else "max_tokens"] = self.max_tokens
        if self.reasoning_effort and is_reasoning_model(self.model):
            body["reasoning_effort"] = self.reasoning_effort
        if stream and self.name == "openai":
            body["stream_options"] = {"include_usage": True}
        return body

    def complete(self, system: str, user: str, *, temperature: Optional[float] = None, timeout: float = 900) -> Reply:
        url = f"{self.base}/chat/completions"
        for _ in range(3):
            stream = self.stream_ok
            body = self._body(system, user, temperature=temperature, stream=stream)
            try:
                if stream:
                    resp = http.open_stream(url, headers=self._headers(), json_body=body, timeout=timeout)
                    with resp:
                        return read_openai_stream(resp)
                _, _, raw = http.request("POST", url, headers=self._headers(), json_body=body,
                                         timeout=timeout, retries=0)
                return read_openai_body(raw)
            except http.HttpError as e:
                text = (e.body or b"").decode("utf-8", "replace").lower()
                if e.status == 400 and stream and "stream" in text and ("verif" in text or "not supported" in text):
                    self.log(f"{self.name} will not stream {self.model} to this key; asking without streaming")
                    self.stream_ok = False
                    continue
                if e.status == 400 and "temperature" in text and self.temperature_ok and temperature is not None:
                    self.log(f"{self.model} takes no temperature; asking without it")
                    self.temperature_ok = False
                    continue
                if e.status == 400 and "response_format" in text and self.json_mode:
                    self.json_mode = False
                    continue
                raise _classify(e, self.name, self.model)
            except (socket.timeout, TimeoutError) as e:
                raise ModelError(f"no answer from {self.name} for {int(timeout)} seconds ({type(e).__name__})")
            except (OSError, HTTPException) as e:
                raise ModelError(f"the connection to {self.name} broke mid-answer: {type(e).__name__}: {e}")
        raise ModelError(f"{self.name} kept refusing the request's shape")

    def ping(self, timeout: float = 60) -> str:
        """One token, to prove the key and the model answer."""
        body = {"model": self.model, "messages": [{"role": "user", "content": "Say OK."}]}
        body["max_completion_tokens" if self.name == "openai" else "max_tokens"] = 1
        try:
            _, _, raw = http.request("POST", f"{self.base}/chat/completions", headers=self._headers(),
                                     json_body=body, timeout=timeout, retries=1)
        except http.HttpError as e:
            text = (e.body or b"").decode("utf-8", "replace").lower()
            if e.status == 400 and ("max_tokens" in text or "max_completion_tokens" in text or "output limit" in text):
                return f"{self.model} answered (one token is too few for a full reply, which is expected)"
            raise _classify(e, self.name, self.model)
        reply = read_openai_body(raw)
        return f"{reply.model or self.model} answered"

    def stream_check(self, timeout: float = 60) -> Optional[bool]:
        """Whether this key may stream this model. None when it could not be told."""
        body = self._body("Reply with the JSON object {\"ok\": true}.", "ok", temperature=None, stream=True)
        body["max_completion_tokens" if self.name == "openai" else "max_tokens"] = 16
        try:
            resp = http.open_stream(f"{self.base}/chat/completions", headers=self._headers(), json_body=body, timeout=timeout)
            with resp:
                read_openai_stream(resp)
            return True
        except http.HttpError as e:
            text = (e.body or b"").decode("utf-8", "replace").lower()
            if e.status == 400 and "stream" in text:
                return False
            return None
        except (OSError, ModelError):
            return None

    def models(self, timeout: float = 60) -> list[str]:
        headers = self._headers() if self.name == "openai" else {}
        try:
            data = http.get_json(f"{self.base}/models", headers=headers, timeout=timeout, retries=1)
        except http.HttpError as e:
            raise _classify(e, self.name, self.model)
        return sorted(str(m.get("id")) for m in (data or {}).get("data") or [] if isinstance(m, dict) and m.get("id"))


class AnthropicProvider:
    """The Messages API. Sampling temperature is never sent: Claude Opus 4.7
    and later refuse it, and the drafts do not depend on it."""

    name = "anthropic"

    def __init__(self, key: str, model: str, *, max_tokens: Optional[int] = None,
                 log: Optional[Callable[[str], None]] = None):
        self.key = key
        self.model = model
        self.max_tokens = max_tokens or ANTHROPIC_MAX_TOKENS
        self.log = log or (lambda _m: None)
        self.fallbacks_ok = model.startswith(("claude-opus-5", "claude-fable-5"))

    def _headers(self, beta: bool) -> dict[str, str]:
        h = {"x-api-key": self.key, "anthropic-version": ANTHROPIC_VERSION}
        if beta:
            h["anthropic-beta"] = ANTHROPIC_FALLBACK_BETA
        return h

    def complete(self, system: str, user: str, *, temperature: Optional[float] = None, timeout: float = 900) -> Reply:
        for _ in range(2):
            body: dict[str, Any] = {
                "model": self.model,
                "max_tokens": self.max_tokens,
                "system": system,
                "messages": [{"role": "user", "content": user}],
                "stream": True,
            }
            beta = self.fallbacks_ok
            if beta:
                body["fallbacks"] = "default"
            try:
                resp = http.open_stream(f"{ANTHROPIC_URL}/messages", headers=self._headers(beta),
                                        json_body=body, timeout=timeout)
                with resp:
                    return read_anthropic_stream(resp)
            except http.HttpError as e:
                text = (e.body or b"").decode("utf-8", "replace").lower()
                if e.status == 400 and beta and "fallback" in text:
                    self.log("anthropic refused the fallbacks option on this account; asking without it")
                    self.fallbacks_ok = False
                    continue
                raise _classify(e, self.name, self.model)
            except (socket.timeout, TimeoutError) as e:
                raise ModelError(f"no answer from anthropic for {int(timeout)} seconds ({type(e).__name__})")
            except (OSError, HTTPException) as e:
                raise ModelError(f"the connection to anthropic broke mid-answer: {type(e).__name__}: {e}")
        raise ModelError("anthropic kept refusing the request's shape")

    def ping(self, timeout: float = 60) -> str:
        body = {"model": self.model, "max_tokens": 1, "messages": [{"role": "user", "content": "Say OK."}]}
        try:
            _, _, raw = http.request("POST", f"{ANTHROPIC_URL}/messages", headers=self._headers(False),
                                     json_body=body, timeout=timeout, retries=1)
        except http.HttpError as e:
            raise _classify(e, self.name, self.model)
        d = json.loads(raw.decode("utf-8") or "{}")
        return f"{d.get('model') or self.model} answered"

    def stream_check(self, timeout: float = 60) -> Optional[bool]:
        return True

    def models(self, timeout: float = 60) -> list[str]:
        try:
            data = http.get_json(f"{ANTHROPIC_URL}/models?limit=100", headers=self._headers(False), timeout=timeout, retries=1)
        except http.HttpError as e:
            raise _classify(e, self.name, self.model)
        return sorted(str(m.get("id")) for m in (data or {}).get("data") or [] if isinstance(m, dict) and m.get("id"))


def provider(cfg: Config, log: Optional[Callable[[str], None]] = None) -> Any:
    """The configured provider, or ModelUnreachable in one plain sentence."""
    name = (cfg.provider or "openai").strip().lower()
    model = (cfg.model or "").strip() or DEFAULT_MODELS.get(name, "")
    if "deepseek" in name or "deepseek" in model.lower():
        raise ModelUnreachable("Lead data never goes to DeepSeek. Set SALES_MODEL_PROVIDER to openai, anthropic "
                               "or openrouter, and SALES_PROPOSAL_MODEL to a model that is not DeepSeek's.")
    if name not in PROVIDERS:
        raise ModelUnreachable(f"SALES_MODEL_PROVIDER is {name!r}; it has to be openai, anthropic or openrouter.")
    key = {"openai": cfg.openai_key, "anthropic": cfg.anthropic_key, "openrouter": cfg.openrouter_key}[name]
    if not key:
        hint = "" if name == "openai" else ", or set SALES_MODEL_PROVIDER back to openai"
        raise ModelUnreachable(f"{KEY_NAMES[name]} is not set, so the {name} provider cannot draft. "
                               f"Set it in /opt/data/bibi/api-keys.env or ~/.sales-desk/env{hint}.")
    if name == "anthropic":
        return AnthropicProvider(key, model, max_tokens=cfg.max_tokens, log=log)
    if name == "openrouter":
        return OpenAIShaped("openrouter", OPENROUTER_URL, key, model, max_tokens=cfg.max_tokens,
                            reasoning_effort=cfg.reasoning_effort, json_mode=False,
                            extra_headers={"HTTP-Referer": "https://cockpit.maharamedia.com", "X-Title": "Mahara sales desk"},
                            log=log)
    return OpenAIShaped("openai", OPENAI_URL, key, model, max_tokens=cfg.max_tokens,
                        reasoning_effort=cfg.reasoning_effort, json_mode=True, log=log)


def call_json(p: Any, system: str, user: str, *, temperature: Optional[float], attempts: int, timeout: float,
              expect: Callable[[dict[str, Any]], bool], log: Callable[[str], None], what: str,
              pause: float = 5.0, beat: Optional[Callable[[], None]] = None) -> tuple[dict[str, Any], Reply]:
    """One model call, asked again when a try fails, the way run_proposal.py
    asked the proxy: short and flat pauses, because a failed try is a stalled
    or garbled answer rather than a rate limit. An outage is not retried: every
    remaining try would fail the same way."""
    last: Optional[Exception] = None
    for attempt in range(1, attempts + 1):
        started = time.time()
        if beat is not None:
            beat()
        try:
            reply = p.complete(system, user, temperature=temperature, timeout=timeout)
            if reply.refusal and not reply.text:
                raise ModelError(f"the model declined: {reply.refusal[:200]}")
            if reply.finish in ("length", "max_tokens") and not reply.text and not reply.reasoning:
                raise ModelError("the answer ran out of room before any of it was written")
            value = as_json(reply.text, reply.reasoning, expect=expect, log=log)
            if attempt > 1:
                log(f"    {what} attempt {attempt} succeeded in {time.time() - started:.0f}s")
            return value, reply
        except NotNow:
            raise
        except (ModelError, http.HttpError, ValueError) as e:
            last = e
            log(f"    {what} attempt {attempt}/{attempts} failed after {time.time() - started:.0f}s: {http.scrub(str(e))[:240]}")
            if attempt < attempts and pause:
                time.sleep(pause)
    raise ModelError(f"the {what} call failed {attempts} times: {http.scrub(str(last))[:300]}")
