#!/usr/bin/env python3
"""Salma: drain the social jobs queue.

Two of the three job kinds are plain model calls and run here. The third,
`generate`, needs Higgsfield's MCP, which a script cannot speak -- it is
left for the openclaw agent session that can, and this says so rather than
pretending.

Nothing here publishes. There are no GoHighLevel credentials in this
process and there should never be.

Environment: DESK_SUPABASE_URL, DESK_SUPABASE_KEY, DEEPSEEK_API_KEY,
ANTHROPIC_API_KEY. Read by name, never printed.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
KINDS = ("plan", "caption", "generate")
MAX_ATTEMPTS = 3


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def note(line: str) -> None:
    """The daily log. Written as it happens, not at the end -- a run that
    dies halfway should still say what it had done."""
    path = os.path.join(HERE, "memory", f"{today()}.md")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a") as f:
        f.write(f"- {now()} {line}\n")
    print(line, flush=True)


# ---------------------------------------------------------------------------
# Supabase


class Store:
    def __init__(self) -> None:
        self.base = os.environ["DESK_SUPABASE_URL"].rstrip("/")
        self.key = os.environ["DESK_SUPABASE_KEY"]

    def _call(self, method: str, path: str, body=None, prefer: str = ""):
        data = json.dumps(body).encode() if body is not None else None
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Accept": "application/json",
        }
        if data:
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer
        req = urllib.request.Request(
            f"{self.base}/rest/v1/{path}", data=data, method=method, headers=headers
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode()
        return json.loads(text) if text else None

    def get(self, path):
        return self._call("GET", path) or []

    def patch(self, path, body, prefer="return=minimal"):
        return self._call("PATCH", path, body, prefer)

    def post(self, path, body, prefer="return=minimal"):
        return self._call("POST", path, body, prefer)

    def claim(self, job_id: str, attempts: int):
        """Only the run whose update still saw `queued` proceeds. Two of us
        generating the same month is money."""
        got = self._call(
            "PATCH",
            f"social_jobs?id=eq.{urllib.parse.quote(job_id)}&status=eq.queued",
            {
                "status": "running",
                "started_at": now(),
                "attempts": attempts,
                "updated_at": now(),
            },
            "return=representation",
        )
        return bool(got)

    def done(self, job_id: str, result: dict) -> None:
        self.patch(
            f"social_jobs?id=eq.{urllib.parse.quote(job_id)}",
            {"status": "done", "result": result, "finished_at": now(), "updated_at": now()},
        )

    def failed(self, job_id: str, why: str) -> None:
        self.patch(
            f"social_jobs?id=eq.{urllib.parse.quote(job_id)}",
            {"status": "failed", "error": why[:500], "finished_at": now(), "updated_at": now()},
        )


# ---------------------------------------------------------------------------
# Models. The routing is Aziz's standing rule: grind on DeepSeek, judgment
# and Arabic client copy stay frontier.


def deepseek(system: str, user: str, *, max_tokens: int = 4000) -> str:
    key = os.environ.get("DEEPSEEK_API_KEY")
    if not key:
        raise RuntimeError("DEEPSEEK_API_KEY is not set")
    body = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.7,
    }
    req = urllib.request.Request(
        "https://api.deepseek.com/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        out = json.load(r)
    return out["choices"][0]["message"]["content"]


def frontier(system: str, user: str, *, max_tokens: int = 2000) -> tuple[str, str]:
    """Captions. A client's dialect is judgment, not extraction, so this
    never goes to the cheap model.

    Anthropic first, OpenAI if that key is missing. Which one wrote it is
    returned and recorded on the job: nobody should have to guess what
    produced a client's Arabic. The "never OpenAI" house rule is about
    images, not text.
    """
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        body = {
            "model": "claude-sonnet-4-6",
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(body).encode(),
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=180) as r:
            out = json.load(r)
        return "".join(b.get("text", "") for b in out.get("content", [])), "claude-sonnet-4-6"

    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError(
            "No frontier key: set ANTHROPIC_API_KEY (preferred) or OPENAI_API_KEY. "
            "Captions do not go to the cheap model."
        )
    body = {
        "model": "gpt-4.1",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        out = json.load(r)
    return out["choices"][0]["message"]["content"], "gpt-4.1"


def strip_dashes(text: str) -> str:
    """No em-dashes. House rule, and the models put them in anyway.

    Replacing the character alone leaves "العميل,لو" with no space after
    the comma, which is visible in the client's own feed. So the spacing
    around it is repaired too, in both scripts.
    """
    import re as _re

    out = _re.sub(r"\s*[\u2014\u2013]\s*", ", ", text)
    out = _re.sub(r"(?<=\S)\s+--\s+(?=\S)", ", ", out)
    # A comma with no space after it reads as a typo in Arabic and English.
    out = _re.sub(r",(?=[^\s,.)\]\d])", ", ", out)
    return _re.sub(r"\s+([,.])", r"\1", out).strip()


def only_json(text: str):
    """Models put prose around JSON. Take the outermost array or object."""
    for open_c, close_c in (("[", "]"), ("{", "}")):
        i, j = text.find(open_c), text.rfind(close_c)
        if i != -1 and j > i:
            try:
                return json.loads(text[i : j + 1])
            except json.JSONDecodeError:
                continue
    raise ValueError(f"no JSON in the model's answer: {text[:200]}")


# ---------------------------------------------------------------------------
# What a client is


def brand_of(sb: Store, client_task_id: str) -> dict:
    q = urllib.parse.quote(client_task_id)
    client = sb.get(f"editor_clients?select=*&task_id=eq.{q}&limit=1")
    social = sb.get(f"social_clients?select=*&client_task_id=eq.{q}&limit=1")
    bank = sb.get(
        f"social_bank?select=kind,text,pillar&client_task_id=eq.{q}&active=is.true&limit=60"
    )
    return {
        "client": client[0] if client else {},
        "social": social[0] if social else {},
        "bank": bank,
    }


def brief(b: dict) -> str:
    c, s, bank = b["client"], b["social"], b["bank"]
    parts = [f"CLIENT: {c.get('name') or 'unknown'}"]
    if c.get("website"):
        parts.append(f"WEBSITE: {c['website']}")
    if s.get("dialect"):
        parts.append(f"DIALECT: {s['dialect']} (never Kuwaiti unless that is the dialect)")
    for label, key in (("BRAND DNA", "brand_dna"), ("OFFER", "offer"), ("DO'S AND DON'TS", "dos_donts")):
        if c.get(key):
            parts.append(f"{label}:\n{str(c[key])[:3000]}")
    asked = [x["text"] for x in bank if x.get("kind") == "question"][:20]
    objections = [x["text"] for x in bank if x.get("kind") == "objection"][:15]
    corrections = [x["text"] for x in bank if x.get("kind") == "correction"][:20]
    if asked:
        parts.append("WHAT THEIR AUDIENCE ACTUALLY ASKS:\n- " + "\n- ".join(asked))
    if objections:
        parts.append("OBJECTIONS:\n- " + "\n- ".join(objections))
    if corrections:
        parts.append(
            "CORRECTIONS ALREADY MADE ON THIS CLIENT -- do not repeat these:\n- "
            + "\n- ".join(corrections)
        )
    return "\n\n".join(parts)


PILLAR_BRIEF = {
    "portfolio": "the project shown like a spec: what was built, in what, to what standard. Needs a real project.",
    "craft": "the material, close. A joint, a grain, a fold. About competence, not scale.",
    "education": "a question their audience actually asked, answered plainly. The question must come from the list above.",
}

PLAN_SYSTEM = """You write monthly social plans for Gulf construction and design businesses.

You return a written plan only. No captions, no image prompts, no hashtags.

Rules that are not negotiable:
- A topic must be specific enough to disagree with. "Kitchen post" is not a
  topic. "Why the toe-kick gap is where cheap joinery shows" is.
- An Education topic must come from the client's own list of what their
  audience asks. If the list does not cover the number asked for, return
  fewer and say so in `shortfall`. Never invent a question.
- Never invent a client fact: no prices, no lead times, no materials they
  have not mentioned, no awards.
- Never repeat anything in the corrections list.

Return JSON only:
{"posts":[{"pillar":"portfolio|craft|education","topic":"...","slides":1-6,
"caption_direction":"one sentence on the angle the caption should take"}],
"shortfall":"empty string, or what you could not fill and why"}"""


def do_plan(sb: Store, job: dict) -> dict:
    batch_id = str(job.get("batch_id") or "")
    client_task_id = str(job.get("client_task_id") or "")
    if not batch_id or not client_task_id:
        raise ValueError("a plan job needs a batch and a client")

    found = sb.get(f"social_batches?select=*&id=eq.{urllib.parse.quote(batch_id)}&limit=1")
    if not found:
        raise ValueError("that month is not set up")
    batch = found[0]
    if batch.get("status") not in ("planning", "planned"):
        raise ValueError(f"that month is already {batch.get('status')}; a plan would not match it")

    mix = batch.get("mix") or {}
    total = sum(int(mix.get(p) or 0) for p in PILLAR_BRIEF)
    if not total:
        raise ValueError("that month has no pillar mix set")

    b = brand_of(sb, client_task_id)
    if not b["client"]:
        raise ValueError("no client card for that id, so there is no brand to write to")

    wanted = "\n".join(
        f"- {n} x {p.upper()}: {PILLAR_BRIEF[p]}"
        for p in PILLAR_BRIEF
        if (n := int(mix.get(p) or 0))
    )
    answer = deepseek(
        PLAN_SYSTEM,
        f"{brief(b)}\n\nTHIS MONTH ({batch.get('month')}) NEEDS:\n{wanted}\n\n"
        f"Return exactly {total} posts unless the Education questions run out.",
    )
    parsed = only_json(answer)
    posts = parsed.get("posts") if isinstance(parsed, dict) else parsed
    if not isinstance(posts, list) or not posts:
        raise ValueError("the model returned no posts")

    rows = []
    for i, p in enumerate(posts):
        pillar = str(p.get("pillar", "")).lower()
        if pillar not in PILLAR_BRIEF:
            continue
        rows.append({
            "id": f"{batch_id}:{i + 1}",
            "batch_id": batch_id,
            "client_task_id": client_task_id,
            "n": i + 1,
            "pillar": pillar,
            "topic": str(p.get("topic") or "")[:300],
            "slides": max(1, min(10, int(p.get("slides") or 1))),
            "caption_direction": str(p.get("caption_direction") or "")[:2000],
            "status": "planned",
            "at": now(),
            "updated_at": now(),
        })
    if not rows:
        raise ValueError("nothing the model returned was a usable post")

    sb.post("social_posts?on_conflict=id", rows, "resolution=merge-duplicates,return=minimal")
    # The batch moves to `planned` because a plan now exists. It does not
    # move past that: approving is a decision and decisions are not ours.
    sb.patch(
        f"social_batches?id=eq.{urllib.parse.quote(batch_id)}",
        {"status": "planned", "planned_at": now(), "updated_at": now()},
    )
    shortfall = str((parsed or {}).get("shortfall") or "") if isinstance(parsed, dict) else ""
    if shortfall:
        note(f"  {client_task_id}: shortfall -- {shortfall[:160]}")
    return {"posts": len(rows), "asked_for": total, "shortfall": shortfall}


CAPTION_SYSTEM = """You write social captions for Gulf construction and design businesses.

- Write in the client's dialect. Never Kuwaiti unless that is their dialect.
- No em-dashes. Ever.
- No invented specifics: no price, no lead time, no material or award the
  brief does not give you.
- The call to action must match what is actually in the image.
- Sound like the business, not like a brand consultant.

Return JSON only: {"caption":"...","cta":"..."}"""


def do_caption(sb: Store, job: dict) -> dict:
    post_id = str(job.get("post_id") or "")
    found = sb.get(f"social_posts?select=*&id=eq.{urllib.parse.quote(post_id)}&limit=1")
    if not found:
        raise ValueError("that post is gone")
    post = found[0]
    b = brand_of(sb, str(post.get("client_task_id")))
    answer, model = frontier(
        CAPTION_SYSTEM,
        f"{brief(b)}\n\nPILLAR: {post.get('pillar')}\nTOPIC: {post.get('topic')}\n"
        f"DIRECTION: {post.get('caption_direction')}",
    )
    parsed = only_json(answer)
    caption = str(parsed.get("caption") or "").strip()
    if not caption:
        raise ValueError("the model returned no caption")
    cleaned = strip_dashes(caption)
    if cleaned != caption:
        note(f"  {post_id}: stripped an em-dash the model put in anyway")
        caption = cleaned
    sb.patch(
        f"social_posts?id=eq.{urllib.parse.quote(post_id)}",
        {"caption": caption[:4000], "updated_at": now()},
    )
    return {"post": post_id, "characters": len(caption), "model": model}


PROMPT_SYSTEM = """You write image prompts for a Gulf construction and design
business's social posts. One prompt per slide.

House rules, not preferences:
- **Never describe a generated human face.** If a person is needed, the
  prompt says to composite the client's own supplied photograph. A
  generated face on a real client's account is how you lose the client.
- Use the brand's own colours where they are given.
- No text in the image unless the slide is meant to carry text, and then
  say only where it sits, never what it says. Generated lettering is
  unreliable and the caption carries the words.
- Describe what is in frame, the light, and the framing. Not the mood.
- A carousel is one shoot: the same place, the same light, the same
  materials across every slide.

Framing by pillar:
- portfolio: the project as an object. Wide or three-quarter, architectural,
  even light, room in frame for a caption block.
- craft: close. One joint, one edge, one material. Shallow depth, raking
  light so the surface reads.
- education: a clean, high-contrast frame with deliberate empty space for
  text to sit over.

Return JSON only: {"prompts":["slide 1 prompt","slide 2 prompt", ...]}"""


def do_generate(sb: Store, job: dict) -> dict:
    """Turn an approved plan into image prompts.

    Not into images. Higgsfield is reached either through its MCP, which
    this process cannot speak, or through its metered API, which is not
    wired. Either way the prompt is the part worth getting right and the
    part worth reviewing: a wrong prompt is cheap to spot in text and
    expensive to spot in a picture.

    So this writes the prompts and stops. Whoever makes the pictures --
    a person pasting them into Higgsfield today, an API call later --
    works from the same text.
    """
    post_id = str(job.get("post_id") or "")
    found = sb.get(f"social_posts?select=*&id=eq.{urllib.parse.quote(post_id)}&limit=1")
    if not found:
        raise ValueError("that post is gone")
    post = found[0]
    client_task_id = str(post.get("client_task_id"))
    b = brand_of(sb, client_task_id)

    assets = sb.get(
        f"social_assets?select=kind,caption,url,path&client_task_id="
        f"{urllib.parse.quote('eq.' + client_task_id)}&active=is.true&limit=20"
    )
    have = ", ".join(
        f"{a.get('kind')}: {a.get('caption') or a.get('url') or a.get('path')}"
        for a in assets
    ) or "none on file"

    slides = max(1, min(10, int(post.get("slides") or 1)))
    answer = deepseek(
        PROMPT_SYSTEM,
        f"{brief(b)}\n\nTHE CLIENT'S OWN PHOTOGRAPHS AVAILABLE TO COMPOSITE:\n{have}"
        f"\n\nPILLAR: {post.get('pillar')}\nTOPIC: {post.get('topic')}\n"
        f"CAPTION DIRECTION: {post.get('caption_direction')}\n"
        f"SLIDES: {slides}\n\nReturn exactly {slides} prompt(s).",
    )
    parsed = only_json(answer)
    prompts = parsed.get("prompts") if isinstance(parsed, dict) else parsed
    if not isinstance(prompts, list) or not prompts:
        raise ValueError("the model returned no prompts")
    prompts = [str(p).strip() for p in prompts if str(p).strip()][:slides]

    sb.patch(
        f"social_posts?id=eq.{urllib.parse.quote(post_id)}",
        {"prompts": prompts, "updated_at": now()},
    )
    if len(prompts) < slides:
        note(f"  {post_id}: {len(prompts)} prompts for {slides} slides")
    return {"post": post_id, "prompts": len(prompts), "slides": slides,
            "images": "still to be made from these"}


HANDLERS = {"plan": do_plan, "caption": do_caption, "generate": do_generate}


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    sb = Store()
    jobs = sb.get(
        f"social_jobs?select=*&status=eq.queued&attempts=lt.{MAX_ATTEMPTS}"
        f"&order=created_at.asc&limit={limit}"
    )
    if not jobs:
        return 0
    note(f"woke to {len(jobs)} job(s)")
    done = failed = 0
    for job in jobs:
        jid = str(job.get("id"))
        kind = str(job.get("kind") or "")
        if kind not in KINDS:
            sb.failed(jid, f"{kind!r} is not something Salma knows how to do")
            failed += 1
            continue
        if not sb.claim(jid, int(job.get("attempts") or 0) + 1):
            continue
        try:
            result = HANDLERS[kind](sb, job)
            sb.done(jid, result)
            done += 1
            note(f"  {kind} {jid}: {json.dumps(result)[:160]}")
        except Exception as e:  # noqa: BLE001 - one bad job must not stop the rest
            why = f"{type(e).__name__}: {e}"
            sb.failed(jid, why)
            failed += 1
            note(f"  {kind} {jid} FAILED: {why[:200]}")
    note(f"done {done}, failed {failed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
