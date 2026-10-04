"""The model, behind one small interface: the VPS's Claude, OpenAI, Anthropic or OpenRouter.

The engine in Mahara-B2B called an OpenAI-shaped proxy to Claude on
Muhammed's account. That proxy is not ours, so the desk talks to a provider
directly with a key already on the VPS (Aziz, 2026-09-24: "the VPS" pays;
OpenAI by default, Anthropic or OpenRouter switched in by
SALES_MODEL_PROVIDER). Since 2026-09-27 ("I want to use my VPS, not OpenAI")
`vps` is Aziz's own proxy to Claude Code on the VPS, with no key and no API
credit to run out. Lead data never goes to DeepSeek: there is no DeepSeek
provider, and every provider refuses a model outside the allowlist below, so
no setting can name DeepSeek, another vendor or a router's alias.

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
from .config import key as setting
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
# The Claude proxy on the VPS itself (SALES_MODEL_PROVIDER=vps). SALES_VPS_URL
# points elsewhere when the proxy moves.
VPS_URL = "http://127.0.0.1:3456/v1"
VPS_SIGN_IN = ("The Claude sign-in on the VPS has lapsed, so nothing can be drafted. Sign Claude Code in "
               "again on the VPS as aziz (run claude, then /login); drafting resumes by itself.")
VPS_SIGNED_OUT = "the Claude sign-in on the VPS has lapsed"

KEY_NAMES = {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "openrouter": "OPENROUTER_API_KEY",
             "vps": "the Claude sign-in on the VPS"}

# The models the desk may send anything to, by prefix: the frontier models it
# works on today (gpt-5 by default, gpt-4.1 the fallback the README names,
# OpenAI's o3 and o4, Claude), directly or through OpenRouter. Anything else
# is refused, so no setting can route a lead's words to another vendor, or to
# a router alias such as openrouter/auto that picks one by itself.
FRONTIER = ("gpt-5", "gpt-4.1", "o3", "o4", "claude-",
            "openai/gpt-5", "openai/gpt-4.1", "openai/o3", "openai/o4", "anthropic/claude-",
            # Claude Code's own names for Anthropic's models, which the VPS proxy takes.
            "opus", "sonnet")
# DeepSeek only for a job that never carries lead data (Kuwaiti and Saudi data
# law). Every job that asks a model today does: proposals, reviews and notes
# read call transcripts, the digest what prospects said, follow-ups a lead's
# messages and answers, research their name and company. So none may name it.
NO_LEAD_DATA_ONLY = ("deepseek-", "deepseek/deepseek-")


def model_allowed(model: str, *, lead_data: bool = True) -> bool:
    m = str(model or "").strip().lower()
    return m.startswith(FRONTIER) or (not lead_data and m.startswith(NO_LEAD_DATA_ONLY))


def check_model(model: str, *, lead_data: bool = True, setting: str = "the job's model setting") -> None:
    """A model outside the allowlist refused in one plain sentence, before anything is sent."""
    if model_allowed(model, lead_data=lead_data):
        return
    if "deepseek" in str(model or "").lower():
        raise ModelUnreachable(f"Lead data never goes to DeepSeek. Set {setting} to a model that is not DeepSeek's.")
    raise ModelUnreachable(f"{model or 'No model'} is not a model the desk may send a lead's words to. Set {setting} "
                           "to gpt-5, gpt-4.1, o3, o4 or a claude- model (openai/ or anthropic/ ones through OpenRouter).")


class ModelUnreachable(NotNow):
    """The provider is not configured or will not talk to us at all.

    Its own type for the reason run_proposal.py gave: "the call could not be
    read" is a fair verdict when a model read a transcript and came back with
    nothing usable. It is a lie when nothing was ever asked.

    `cause` is the same outage in a few words ("the Claude sign-in on the VPS
    has lapsed"), for the sentences that put two of them side by side: a
    proposal drafted through the fallback, and nothing able to answer.
    `closer`, when set, is the sentence for the proposal the closer is
    waiting on: what is happening and what to do, without the fix itself.
    """

    def __init__(self, message: str = "", *, cause: str = "", closer: str = "", every: bool = False,
                 others: str = ""):
        super().__init__(message)
        self.cause = cause or cause_of(message)
        self.closer = closer
        # The closer's sentence fits every proposal waiting, not only the one
        # that met it (nothing can answer), so the run's other drafts carry it too.
        self.every = every
        # For the run's other requests, when this one's sentence is about it alone.
        self.others = others


def cause_of(message: str) -> str:
    """A sentence's first clause, as the reason inside another sentence."""
    text = str(message or "").strip()
    for stop in (". ", ", so ", "; ", " ("):
        i = text.find(stop)
        if i > 0:
            text = text[:i]
    text = text.rstrip(".").strip()
    if len(text) > 1 and text[0].isupper() and text[1].islower():
        text = text[0].lower() + text[1:]
    return text or "it did not answer"


class ModelError(RuntimeError):
    """One attempt that failed: a timeout, an overloaded provider, a reply with no JSON."""


class NoJSON(ModelError):
    pass


class StreamRefused(ModelError):
    """An error the provider sent inside a stream it had already opened with a
    200, carrying an HTTP status of its own. OpenRouter reports an error that
    comes after it has started a stream (its keep-alive comments are a start)
    as `data: {"error": {"code": ..., "message": ...}}`; when that code is a
    status (402, 400) the provider turns it back into what the same status
    means as a response, so an account out of credit is an outage (the request
    waits) and not a failed try (four of which fail the request). A code that
    is not a status ("server_error") stays a failed try."""

    def __init__(self, status: int, message: str):
        super().__init__(f"the provider stopped mid-answer: {status}: {http.scrub(message)[:300]}")
        self.status, self.said = status, message


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


# The reasoning efforts OpenAI's families take. gpt-5 itself (and its mini and
# nano) takes minimal to high and refuses none and xhigh, which later gpt-5.x
# models take; o3 and o4 take low to high. SALES_REASONING_EFFORT is one
# setting for the primary and the fallback alike, so a value the model refuses
# is left out rather than sent; any other model gets it as set, and a refusal
# drops it (OpenAIShaped.complete).
_EFFORTS = (
    (re.compile(r"^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$"), ("minimal", "low", "medium", "high")),
    (re.compile(r"^o[34]"), ("low", "medium", "high")),
)


def effort_for(model: str, effort: str) -> str:
    """The reasoning effort to send this model: empty when it is not a reasoning
    model, or when it is one that refuses this value."""
    effort = str(effort or "").strip().lower()
    if not effort or not is_reasoning_model(model):
        return ""
    name = model.split("/", 1)[-1].lower()
    for pattern, allowed in _EFFORTS:
        if pattern.match(name):
            return effort if effort in allowed else ""
    return effort


def no_sampling(model: str) -> bool:
    """Claude models that refuse a sampling temperature: Opus 4.7 and later,
    Sonnet 5 and later, Fable and Mythos. Older Claude models take it."""
    m = str(model or "").strip().lower().split("/", 1)[-1].replace(".", "-")
    found = re.match(r"^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$", m)
    if not found:
        return False
    family, major, minor = found.group(1), int(found.group(2)), int(found.group(3) or 0)
    if family in ("fable", "mythos"):
        return True
    if family == "opus":
        return (major, minor) >= (4, 7)
    if family == "sonnet":
        return major >= 5
    return False


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
            code = str(err.get("code") if isinstance(err, dict) else "").strip()
            if code.isdigit() and 400 <= int(code) < 600:
                meta = err.get("metadata") if isinstance(err.get("metadata"), dict) else {}
                raise StreamRefused(int(code), f"{message} {meta.get('raw') or ''}".strip())
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

# A streamed failure behind the VPS proxy arrives with a 200, as the whole
# answer "[Error: <what Claude Code said>]".
PROXY_ERROR = re.compile(r"^\[Error: (.*)\]$", re.S)


def vps_reply(reply: Reply, asked: str) -> Reply:
    """The VPS proxy's answer, with its failures raised rather than kept as a
    draft. It sends no usage, so the day's ceiling counts an estimate of three
    characters a token, on the high side, rather than nothing."""
    m = PROXY_ERROR.match(reply.text)
    if m:
        said = m.group(1).strip()
        low = said.lower()
        if "oauth" in low or "authenticate" in low or "401" in low or "subscription access" in low:
            raise ModelUnreachable(VPS_SIGN_IN, cause=VPS_SIGNED_OUT)
        if any(w in low for w in ("usage limit", "hit your limit", "limit reached", "rate limit")):
            raise ModelUnreachable(f"The Claude plan on the VPS is at its usage limit ({http.scrub(said)[:160]}); "
                                   "drafting waits until it resets.",
                                   cause="the Claude plan on the VPS is at its usage limit")
        raise ModelError(f"the Claude proxy on the VPS failed: {http.scrub(said)[:300]}")
    if not reply.usage:
        reply.usage = estimate(asked, reply.text + reply.reasoning)
    return reply


def _classify(e: http.HttpError, provider: str, model: str, setting: str = "SALES_PROPOSAL_MODEL") -> Exception:
    """An HTTP failure as either an outage (the request waits) or a failed try.
    `setting` is the one that names this provider's model, so the fix names
    SALES_FALLBACK_MODEL for the fallback rather than the primary's setting."""
    body = e.body.decode("utf-8", "replace") if isinstance(e.body, (bytes, bytearray)) else str(e)
    if provider == "vps":
        low = body.lower()
        if e.status in (401, 403) or "oauth" in low or "authenticate" in low or "subscription access" in low:
            return ModelUnreachable(VPS_SIGN_IN, cause=VPS_SIGNED_OUT)
        if e.status == 0 and not e.timed_out:
            return ModelUnreachable("The Claude proxy on the VPS (127.0.0.1:3456) is not answering. Start it "
                                    "again; drafting waits until then.",
                                    cause="the Claude proxy on the VPS is not answering")
    if e.status in (401, 403):
        return ModelUnreachable(
            f"{provider} refused the key ({e.status}). Set {KEY_NAMES[provider]} again on the VPS; "
            "drafting waits until then.", cause=f"{provider} refused its key")
    if e.status == 404 or "model_not_found" in body or "does not exist" in body:
        return ModelUnreachable(
            f"The model {model} is not available to this {provider} key ({e.status}). Set "
            f"{setting} to one `desk.py doctor` lists; drafting waits until then.",
            cause=f"{model} is not available to the {provider} key")
    if e.status == 402 or "insufficient_quota" in body or "credit balance" in body:
        return ModelUnreachable(f"The {provider} account is out of credit ({e.status}). Top it up; drafting waits "
                                "until then.", cause=f"the {provider} account is out of credit")
    if e.status == 0 and not e.timed_out:
        return ModelUnreachable(f"{provider} could not be reached: {http.scrub(str(e))[:200]}",
                                cause=f"{provider} could not be reached")
    return ModelError(f"{provider} answered {e.status or 'nothing'}: {http.scrub(body or str(e))[:300]}")


class OpenAIShaped:
    """OpenAI's chat completions, and OpenRouter, which speaks the same shape."""

    def __init__(self, name: str, base: str, key: str, model: str, *, max_tokens: Optional[int] = None,
                 reasoning_effort: str = "", json_mode: bool = True, extra_headers: Optional[dict[str, str]] = None,
                 log: Optional[Callable[[str], None]] = None, lead_data: bool = True):
        check_model(model, lead_data=lead_data)
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
        # Claude Opus 4.7 and later refuse a sampling temperature, as the
        # AnthropicProvider says; through OpenRouter it is not sent to them
        # either, rather than learnt from a refusal (which can arrive inside
        # an opened stream, where it would cost the try).
        self.temperature_ok = not is_reasoning_model(model) and not (name != "vps" and no_sampling(model))
        # The setting that names this model, for the sentence when a provider
        # says it does not have it (SALES_FALLBACK_MODEL for the fallback).
        self.model_setting = "SALES_PROPOSAL_MODEL"

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
        effort = effort_for(self.model, self.reasoning_effort)
        if effort:
            body["reasoning_effort"] = effort
        if stream and self.name == "openai":
            body["stream_options"] = {"include_usage": True}
        return body

    def complete(self, system: str, user: str, *, temperature: Optional[float] = None, timeout: float = 900) -> Reply:
        url = f"{self.base}/chat/completions"
        # One try, and one more for each part of the shape a model may refuse:
        # streaming, temperature, response_format, reasoning_effort.
        for _ in range(5):
            stream = self.stream_ok
            body = self._body(system, user, temperature=temperature, stream=stream)
            try:
                if stream:
                    resp = http.open_stream(url, headers=self._headers(), json_body=body, timeout=timeout)
                    with resp:
                        try:
                            reply = read_openai_stream(resp)
                        except StreamRefused as refused:
                            # The status it would have answered with, handled as one.
                            raise http.HttpError(refused.status, refused.said, refused.said.encode("utf-8"),
                                                 url) from None
                else:
                    _, _, raw = http.request("POST", url, headers=self._headers(), json_body=body,
                                             timeout=timeout, retries=0)
                    reply = read_openai_body(raw)
                return vps_reply(reply, system + user) if self.name == "vps" else reply
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
                if e.status == 400 and "reasoning_effort" in text and effort_for(self.model, self.reasoning_effort):
                    self.log(f"{self.model} refused reasoning_effort={self.reasoning_effort}; asking without it")
                    self.reasoning_effort = ""
                    continue
                raise _classify(e, self.name, self.model, self.model_setting)
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
            raise _classify(e, self.name, self.model, self.model_setting)
        reply = read_openai_body(raw)
        if self.name == "vps":
            vps_reply(reply, "")
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
            raise _classify(e, self.name, self.model, self.model_setting)
        return sorted(str(m.get("id")) for m in (data or {}).get("data") or [] if isinstance(m, dict) and m.get("id"))

    def credit(self, timeout: float = 60) -> Optional[float]:
        """Dollars left on an OpenRouter account (bought less used), or None when it
        cannot be told. Not a model call. A key's own limit can have room while
        the account itself is spent, and then every paid call is refused (402)."""
        if self.name != "openrouter":
            return None
        try:
            data = http.get_json(f"{self.base}/credits", headers=self._headers(), timeout=timeout, retries=1)
            d = (data or {}).get("data") or {}
            return round(float(d["total_credits"]) - float(d["total_usage"]), 2)
        except (http.HttpError, OSError, KeyError, TypeError, ValueError):
            return None


class AnthropicProvider:
    """The Messages API. Sampling temperature is never sent: Claude Opus 4.7
    and later refuse it, and the drafts do not depend on it."""

    name = "anthropic"

    def __init__(self, key: str, model: str, *, max_tokens: Optional[int] = None,
                 log: Optional[Callable[[str], None]] = None, lead_data: bool = True):
        check_model(model, lead_data=lead_data)
        self.key = key
        self.model = model
        self.max_tokens = max_tokens or ANTHROPIC_MAX_TOKENS
        self.log = log or (lambda _m: None)
        self.model_setting = "SALES_PROPOSAL_MODEL"
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
                raise _classify(e, self.name, self.model, self.model_setting)
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
            raise _classify(e, self.name, self.model, self.model_setting)
        d = json.loads(raw.decode("utf-8") or "{}")
        return f"{d.get('model') or self.model} answered"

    def stream_check(self, timeout: float = 60) -> Optional[bool]:
        return True

    def models(self, timeout: float = 60) -> list[str]:
        try:
            data = http.get_json(f"{ANTHROPIC_URL}/models?limit=100", headers=self._headers(False), timeout=timeout, retries=1)
        except http.HttpError as e:
            raise _classify(e, self.name, self.model, self.model_setting)
        return sorted(str(m.get("id")) for m in (data or {}).get("data") or [] if isinstance(m, dict) and m.get("id"))


class BudgetSpent(NotNow):
    """Today's AI ceiling is reached: the job stops and its items wait for tomorrow, untouched."""


class SpendUnknown(NotNow):
    """Today's spend could not be read: no model is asked until it can be, because an unknown spend is not zero."""


@dataclass
class Meter:
    """What this process's model calls spend, against the desk's daily ceiling.

    `used_today` reads the tokens already spent today (all jobs, from the
    database) before the first call; while it cannot be read, no model is
    asked, since a ceiling counted from zero is no ceiling. `record` writes
    one row per call. A write that fails is warned about and never fails the
    job: the ceiling still counts what this process spent."""
    job: str
    cap: int
    used_today: Callable[[], int]
    record: Callable[[dict[str, Any]], None]
    spent: int = 0
    base: Optional[int] = None
    warn: Optional[Callable[[str], None]] = None

    def check(self) -> None:
        """Before a call: refused past the day's ceiling, or when today's spend cannot be read."""
        if self.base is None:
            try:
                self.base = int(self.used_today())
            except Exception as e:  # noqa: BLE001 - said in the refusal
                raise SpendUnknown(f"Today's AI spend could not be read ({http.scrub(str(e))[:160]}), so the "
                                   f"{self.job} job asks no model until it can: an unknown spend is not zero. It "
                                   "tries again on its next run.") from None
        if self.cap and self.base + self.spent >= self.cap:
            raise BudgetSpent(f"today's AI ceiling of {self.cap:,} tokens is reached ({self.base + self.spent:,} spent); "
                              "the desk's model calls start again after midnight Kuwait. If today is expected to need "
                              "more, raise SALES_AI_DAILY_TOKENS in ~/.sales-desk/env")

    def add(self, model: Optional[str], usage: dict[str, Any], *, provider: Optional[str] = None) -> None:
        """After a call: its tokens counted, and its row written, naming the
        provider and the model that answered (a fallback's are not the primary's)."""
        i, o, r, t = usage_tokens(usage or {})
        self.spent += t
        row: dict[str, Any] = {"job": self.job, "model": model, "input_tokens": i, "output_tokens": o,
                               "reasoning_tokens": r, "total_tokens": t}
        if provider:
            row["provider"] = provider
        try:
            self.record(row)
        except Exception as e:  # noqa: BLE001 - a missing usage row never costs the answer
            if self.warn:
                self.warn(f"{self.job}: the usage of a model call ({t:,} tokens) was not written, so the cockpit's "
                          f"AI counts miss it: {http.scrub(str(e))[:200]}")


_METER: Optional[Meter] = None


def meter(m: Optional[Meter]) -> None:
    """Meter every provider this process makes from now on (desk.py sets it per command)."""
    global _METER
    _METER = m


def current_meter() -> Optional[Meter]:
    """The meter desk.py set for this command, for a job that calls a model without a provider (research)."""
    return _METER


def metered(p: Any) -> Any:
    """A provider counted against the day's ceiling when desk.py has set a meter."""
    return Metered(p, _METER) if _METER is not None else p


def usage_tokens(usage: dict[str, Any]) -> tuple[int, int, int, int]:
    """(input, output, reasoning, total) from OpenAI's or Anthropic's usage shape."""
    i = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    o = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    details = usage.get("completion_tokens_details") or usage.get("output_tokens_details") or {}
    r = int((details or {}).get("reasoning_tokens") or 0)
    return i, o, r, int(usage.get("total_tokens") or (i + o))


class Metered:
    """A provider whose every call is counted and logged, and refused past the day's ceiling."""

    def __init__(self, inner: Any, m: Meter):
        self.inner, self.m = inner, m

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    def complete(self, system: str, user: str, *, temperature: Optional[float] = None, timeout: float = 900) -> Reply:
        self.m.check()
        reply = self.inner.complete(system, user, temperature=temperature, timeout=timeout)
        if not reply.usage:
            # A provider that sent no usage still spent tokens: three
            # characters a token, on the high side, as for the VPS proxy.
            reply.usage = estimate(system + user, reply.text + reply.reasoning)
        self.m.add(reply.model or getattr(self.inner, "model", None), reply.usage,
                   provider=getattr(self.inner, "name", None))
        return reply


def estimate(asked: str, answered: str) -> dict[str, int]:
    i, o = -(-len(asked) // 3), -(-len(answered) // 3)
    return {"prompt_tokens": i, "completion_tokens": o, "total_tokens": i + o}


def provider(cfg: Config, log: Optional[Callable[[str], None]] = None) -> Any:
    """The configured provider, metered when desk.py has set a meter, or ModelUnreachable in one plain sentence."""
    return metered(_provider(cfg, log))


def _provider(cfg: Config, log: Optional[Callable[[str], None]] = None) -> Any:
    """The configured provider, or ModelUnreachable in one plain sentence."""
    name = (cfg.provider or "vps").strip().lower()
    model = (cfg.model or "").strip() or DEFAULT_MODELS.get(name, "")
    if "deepseek" in name or "deepseek" in model.lower():
        raise ModelUnreachable("Lead data never goes to DeepSeek. Set SALES_MODEL_PROVIDER to openai, anthropic "
                               "or openrouter, and SALES_PROPOSAL_MODEL to a model that is not DeepSeek's.")
    check_model(model, setting="SALES_PROPOSAL_MODEL (or the job's own model setting)")
    if name not in PROVIDERS:
        raise ModelUnreachable(f"SALES_MODEL_PROVIDER is {name!r}; it has to be vps, openai, anthropic or openrouter.")
    return _build(name, model, cfg, log, setting_name="SALES_MODEL_PROVIDER")


def _build(name: str, model: str, cfg: Config, log: Optional[Callable[[str], None]], *, setting_name: str,
           max_tokens: Optional[int] = None, json_mode: Optional[bool] = None) -> Any:
    """One provider by name, with its key from the box."""
    max_tokens = max_tokens or cfg.max_tokens
    if name == "vps":
        # No key: the proxy speaks for the Claude plan Claude Code is signed in with.
        return OpenAIShaped("vps", setting("SALES_VPS_URL", "").strip() or VPS_URL, "vps", model,
                            max_tokens=max_tokens, json_mode=False, log=log)
    key = {"openai": cfg.openai_key, "anthropic": cfg.anthropic_key, "openrouter": cfg.openrouter_key}[name]
    if not key:
        hint = "" if name == "openai" else f", or set {setting_name} back to openai"
        raise ModelUnreachable(f"{KEY_NAMES[name]} is not set, so the {name} provider cannot draft. "
                               f"Set it in /opt/data/bibi/api-keys.env or ~/.sales-desk/env{hint}.",
                               cause=f"{KEY_NAMES[name]} is not set")
    if name == "anthropic":
        return AnthropicProvider(key, model, max_tokens=max_tokens, log=log)
    if name == "openrouter":
        return OpenAIShaped("openrouter", OPENROUTER_URL, key, model, max_tokens=max_tokens,
                            reasoning_effort=cfg.reasoning_effort, json_mode=False,
                            extra_headers={"HTTP-Referer": "https://cockpit.maharamedia.com", "X-Title": "Mahara sales desk"},
                            log=log)
    return OpenAIShaped("openai", OPENAI_URL, key, model, max_tokens=max_tokens,
                        reasoning_effort=cfg.reasoning_effort, json_mode=True if json_mode is None else json_mode,
                        log=log)


# ---- the fallback ---------------------------------------------------------------

# Claude Code's own names for Anthropic's models, as the VPS proxy lists them
# (GET 127.0.0.1:3456/v1/models on 2026-10-04 puts "opus" beside
# claude-opus-4-8 and opus-4.8, "sonnet" beside claude-sonnet-4-6). When the
# proxy's "opus" moves to a newer model, move it here too, or name the
# fallback's model outright with SALES_FALLBACK_MODEL.
CLAUDE_CODE_NAMES = {"opus": "claude-opus-4-8", "sonnet": "claude-sonnet-4-6", "haiku": "claude-haiku-4-5",
                     "fable": "claude-fable-5"}
# Each provider's model when the primary's has no counterpart there. OpenRouter
# lists anthropic/claude-opus-4.8 (GET openrouter.ai/api/v1/models, 2026-10-04).
FALLBACK_MODELS = {"openrouter": "anthropic/claude-opus-4.8", "anthropic": "claude-opus-4-8", "openai": "gpt-5",
                   "vps": "opus"}
_SHORT_CLAUDE = re.compile(r"^(opus|sonnet|haiku|fable)-(\d+)(?:[.-](\d{1,2}))?$")
_CLAUDE_VERSION = re.compile(r"^(claude-[a-z]+)-(\d+)(?:[.-](\d{1,2}))?(?:-\d{8})?$")


def closest_model(model: str, provider: str) -> str:
    """The primary's model as the fallback provider names it: Claude Code's
    "opus" is anthropic/claude-opus-4.8 through OpenRouter and claude-opus-4-8
    at Anthropic; gpt-5 is openai/gpt-5 through OpenRouter. A model the
    provider has no counterpart for gets the provider's own (FALLBACK_MODELS)."""
    m = str(model or "").strip().lower()
    m = m.split("/", 1)[1] if m.startswith(("anthropic/", "openai/")) else m
    m = CLAUDE_CODE_NAMES.get(m, m)
    short = _SHORT_CLAUDE.match(m)
    if short:
        m = f"claude-{short.group(1)}-{short.group(2)}" + (f"-{short.group(3)}" if short.group(3) else "")
    claude = _CLAUDE_VERSION.match(m)
    if claude:
        family, major, minor = claude.group(1), claude.group(2), claude.group(3)
        if provider == "openrouter":
            return f"anthropic/{family}-{major}" + (f".{minor}" if minor else "")
        if provider in ("anthropic", "vps"):
            return f"{family}-{major}" + (f"-{minor}" if minor else "")
    elif m.startswith(("gpt-", "o3", "o4")):
        if provider == "openrouter":
            return f"openai/{m}"
        if provider == "openai":
            return m
    return FALLBACK_MODELS.get(provider, "")


def fallback_model(cfg: Config, primary_model: Optional[str] = None) -> str:
    """SALES_FALLBACK_MODEL, else the primary's model as the fallback names it."""
    return (cfg.fallback_model or "").strip() or closest_model(primary_model or cfg.model, cfg.fallback)


def fallback_for(cfg: Config, job: str) -> bool:
    """Whether this job drafts through the fallback when the primary cannot answer."""
    name = (cfg.fallback or "none").strip().lower()
    return name not in ("", "none") and name != (cfg.provider or "vps").strip().lower() and job in cfg.fallback_jobs


def fallback_provider(cfg: Config, log: Optional[Callable[[str], None]] = None, *,
                      primary_model: Optional[str] = None, plain_text: bool = False) -> Any:
    """The fallback provider, metered like the primary, or ModelUnreachable in
    one sentence. A Claude model gets room for a whole deal (64,000 tokens, as
    from Anthropic directly): OpenRouter holds credit against the most a reply
    may be, so an unset limit is the model's whole output."""
    name = (cfg.fallback or "").strip().lower()
    if name not in PROVIDERS:
        raise ModelUnreachable(f"SALES_MODEL_FALLBACK is {name!r}; it has to be none, openrouter, openai, anthropic "
                               "or vps.")
    model = fallback_model(cfg, primary_model)
    check_model(model, setting="SALES_FALLBACK_MODEL")
    if not serves(name, model):
        # Caught here, in one sentence, rather than as a 404 an hour later
        # (SALES_MODEL_FALLBACK changed to openai with an OpenRouter model left
        # in SALES_FALLBACK_MODEL, say).
        mine = closest_model(primary_model or cfg.model, name)
        raise ModelUnreachable(f"SALES_FALLBACK_MODEL is {model}, which is not a model {name} serves under that name. "
                               f"Leave SALES_FALLBACK_MODEL empty to use {mine}, or set it to one of {name}'s.",
                               cause=f"SALES_FALLBACK_MODEL ({model}) is not a {name} model")
    room = ANTHROPIC_MAX_TOKENS if "claude-" in model.lower() else None
    p = _build(name, model, cfg, log, setting_name="SALES_MODEL_FALLBACK", max_tokens=room,
               json_mode=False if plain_text else None)
    p.model_setting = "SALES_FALLBACK_MODEL"
    return metered(p)


def serves(provider: str, model: str) -> bool:
    """Whether a provider takes this model under this name: OpenRouter's are
    vendor/model, OpenAI's and Anthropic's are bare, and the VPS proxy takes
    Claude's (claude-..., or Claude Code's opus and sonnet)."""
    m = str(model or "").strip().lower()
    claude = m.startswith(("claude-", "opus", "sonnet"))
    if provider == "openrouter":
        return "/" in m
    if provider == "openai":
        return "/" not in m and not claude
    if provider == "anthropic":
        return m.startswith("claude-")
    if provider == "vps":
        return "/" not in m and claude
    return False


def label(p: Any) -> str:
    return f"{getattr(p, 'name', '?')} ({getattr(p, 'model', '?')})"


class Failover:
    """A job's provider with the fallback behind it, for one run.

    The primary is asked first. When it cannot answer at all (ModelUnreachable:
    the sign-in lapsed, the proxy is down, the key is refused, no credit) before
    any of the current piece of work has gone through it, the run hands over to
    the fallback: once, for every call left in the run, and never back. Once a
    call of a piece of work has gone through a provider, that work stays on it:
    a draft is never finished by a model other than the one that started it,
    so a primary that stops partway sends the work back to wait, to start
    again from the beginning on the next run. When the fallback cannot answer
    either, the work waits with one sentence that names both. Without a
    fallback the primary's own sentence goes out unchanged, as before.

    A failed try (a timeout, a garbled answer) belongs to the provider that
    was asked, like an answer. The day's ceiling (BudgetSpent, SpendUnknown)
    is never a reason to switch: it counts every provider.
    """

    def __init__(self, primary: Callable[[], Any], fallback: Optional[Callable[[], Any]], *,
                 log: Optional[Callable[[str], None]] = None, job: str = "proposal", primary_label: str = "",
                 warn: Optional[Callable[[str], None]] = None):
        self._make_primary, self._make_fallback = primary, fallback
        self.log = log or (lambda _m: None)
        # The handover is a warning: the cron runs --quiet, which keeps only
        # warnings, and a paid fallback drafting in place of the VPS's plan is
        # the line someone reading the log needs to find.
        self.warn = warn or self.log
        self.job = job
        self.p: Any = None
        self.on_fallback = False
        # "vps (opus)": the primary as the sentences name it, said even when it could not be made.
        self.primary = primary_label
        self.down: Optional[ModelUnreachable] = None
        self.pinned = False
        # The one-token check (check()) is made once a run.
        self.checked = False

    def begin(self) -> "Failover":
        """A new piece of work (one proposal): it stays on whichever provider answers its first call."""
        self.pinned = False
        return self

    def ready(self) -> "Failover":
        """The provider in use, made; a primary that cannot even be made hands over at once."""
        if self.p is None:
            try:
                self.p = self._make_primary()
                self.primary = label(self.p)
            except ModelUnreachable as e:
                self._switch(e)
        return self

    def check(self, timeout: float = 60) -> "Failover":
        """ready(), and for the VPS proxy a one-token ping before any work is
        claimed. The proxy needs no key, so making it proves nothing: a lapsed
        sign-in shows only when a draft asks it, after the request was claimed
        and its call read from Fathom. A primary the ping finds unreachable
        hands over here, as one that cannot be made does, or waits with its
        sentence when there is no fallback. A ping that merely fails (a
        timeout, an odd answer) proves nothing either way and leaves the
        question to the draft. Once a run; never on the fallback."""
        self.ready()
        if self.checked or self.on_fallback:
            return self
        self.checked = True
        ping = getattr(self.p, "ping", None)
        if getattr(self.p, "name", "") != "vps" or not callable(ping):
            return self
        try:
            ping(timeout=timeout)
        except ModelUnreachable as e:
            self._switch(e)
        except Exception as e:  # noqa: BLE001 - not an outage: the draft finds out
            self.log(f"{self.primary}: the one-token check did not answer cleanly "
                     f"({http.scrub(str(e))[:160]}); the draft asks it anyway")
        return self

    def _switch(self, e: ModelUnreachable) -> None:
        if self._make_fallback is None:
            raise e
        try:
            fb = self._make_fallback()
        except ModelUnreachable as f:
            raise self._neither(e, f) from None
        self.down, self.p, self.on_fallback = e, fb, True
        self.primary = self.primary or "the primary model"
        self.warn(f"{self.primary} cannot answer ({e.cause}); this run uses {label(fb)} instead")

    def _neither(self, e: ModelUnreachable, f: ModelUnreachable) -> ModelUnreachable:
        if self.job == "proposal":
            closer = (f"No model can answer right now: {e.cause}, and {f.cause}. This proposal waits and drafts by "
                      "itself once either is fixed, so there is no need to ask again; if it is still waiting in an "
                      "hour, tell the CEO.")
        else:
            closer = (f"No model can answer right now: {e.cause}, and {f.cause}. The {self.job} job waits and carries "
                      "on by itself once either is fixed.")
        return ModelUnreachable(f"{closer} To fix it: {e} {f}"[:600], cause=f"{e.cause}, and {f.cause}",
                                closer=closer, every=True)

    @property
    def name(self) -> str:
        return self.ready().p.name

    @property
    def model(self) -> str:
        return self.ready().p.model

    def __getattr__(self, attr: str) -> Any:
        if attr.startswith("_") or attr in ("p", "down"):
            raise AttributeError(attr)
        return getattr(self.ready().p, attr)

    def complete(self, system: str, user: str, *, temperature: Optional[float] = None, timeout: float = 900) -> Reply:
        self.ready()
        try:
            reply = self.p.complete(system, user, temperature=temperature, timeout=timeout)
        except ModelUnreachable as e:
            if self.on_fallback:
                raise self._neither(self.down, e) if self.down is not None else e
            if self._make_fallback is None:
                raise
            if self.pinned:
                closer = (f"The model stopped answering partway through this draft ({e.cause}), so it starts again "
                          "from the beginning on the next run; there is no need to ask again.")
                raise ModelUnreachable(
                    f"{self.primary} stopped answering partway through ({e.cause}). Nothing it wrote is kept: this "
                    "waits and starts again from the beginning on the next run, through the fallback if "
                    f"{self.primary} is still down; there is no need to ask again. {e}"[:600],
                    cause=e.cause, closer=closer,
                    others=(f"Not started this run: {self.primary} stopped answering partway through another "
                            f"proposal ({e.cause}). It is tried on the next run, through the fallback if "
                            f"{self.primary} is still down.")) from None
            self._switch(e)
            return self.complete(system, user, temperature=temperature, timeout=timeout)
        except NotNow:
            raise
        except Exception:
            self.pinned = True
            raise
        self.pinned = True
        return reply

    def route(self) -> dict[str, Any]:
        """Which provider the work went through, and why when it was not the primary."""
        self.ready()
        out: dict[str, Any] = {"fallback": self.on_fallback}
        if self.on_fallback and self.down is not None:
            out.update(primary=self.primary, reason=self.down.cause, detail=str(self.down))
        return out


def route_of(p: Any, answered: str = "") -> dict[str, Any]:
    """What a proposal's validation keeps about the model: the provider and
    model that wrote it, and, when that was the fallback, the sentence."""
    out: dict[str, Any] = {"provider": getattr(p, "name", ""), "model": answered or getattr(p, "model", ""),
                           "fallback": False}
    info = p.route() if isinstance(p, Failover) else {}
    if info.get("fallback"):
        out.update(info)
        out["note"] = f"Drafted through {out['provider']} ({out['model']}) because {info['reason']}."
    return out


def for_job(cfg: Config, job: str, log: Optional[Callable[[str], None]] = None, *,
            primary: Optional[Callable[[], Any]] = None, plain_text: bool = False,
            warn: Optional[Callable[[str], None]] = None) -> Any:
    """A job's provider: the primary as it always was, or, for a job
    SALES_FALLBACK_JOBS names, a Failover with the fallback behind it. Made
    at once either way, so a provider neither of which can be made is refused
    where it always was."""
    make = primary or (lambda: provider(cfg, log))
    if not fallback_for(cfg, job):
        return make()
    model = cfg.model
    return Failover(make, lambda: fallback_provider(cfg, log, primary_model=model, plain_text=plain_text),
                    log=log, job=job, primary_label=f"{cfg.provider} ({model})", warn=warn).ready()


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
