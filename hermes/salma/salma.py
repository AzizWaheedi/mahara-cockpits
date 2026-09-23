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
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
KINDS = ("fill", "plan", "caption", "generate")
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


def wants_arabic(dialect: str) -> bool:
    d = dialect.lower()
    return any(w in d for w in (
        "arab", "gulf", "khaleeji", "saudi", "najdi", "hijazi", "kuwait",
        "qatar", "emirat", "bahrain", "oman", "levant", "egypt",
    ))


def arabic_share(text: str) -> float:
    """How much of the writing is Arabic script, ignoring digits and marks."""
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if "\u0600" <= c <= "\u06ff") / len(letters)


HEX_CODE = re.compile(r"\s*#(?=[0-9A-Fa-f]*\d)[0-9A-Fa-f]{6}\b")


def strip_codes(text: str) -> str:
    """Remove colour codes that leaked from the brand sheet into the copy,
    and the empty brackets they leave behind when they were in brackets."""
    out = HEX_CODE.sub("", text)
    out = re.sub(r"\s*[(\[]\s*[)\]]", "", out)
    return re.sub(r"[ \t]{2,}", " ", out)


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
    return {
        "client": client[0] if client else {},
        "social": social[0] if social else {},
    }


def brief(b: dict) -> str:
    c, s = b["client"], b["social"]
    parts = [f"CLIENT: {c.get('name') or 'unknown'}"]
    if c.get("website"):
        parts.append(f"WEBSITE: {c['website']}")
    if s.get("dialect"):
        parts.append(f"DIALECT: {s['dialect']} (never Kuwaiti unless that is the dialect)")
    for label, key in (("BRAND DNA", "brand_dna"), ("OFFER", "offer"), ("DO'S AND DON'TS", "dos_donts")):
        if c.get(key):
            parts.append(f"{label}:\n{str(c[key])[:3000]}")
    return "\n\n".join(parts)


# The three that came out of the live analysis, with what each is for. A
# client may use its own names instead: then the name is the brief, and
# the model is told to read it rather than be handed a definition.
PILLAR_BRIEF = {
    "portfolio": "the project shown like a spec: what was built, in what, to what standard. Needs a real project.",
    "craft": "the material, close. A joint, a grain, a fold. About competence, not scale.",
    "education": "a question this client's own customers ask before they buy, answered plainly. Take it from the offer and the brand, not from general industry advice.",
}


def pillar_line(name: str, n: int) -> str:
    known = PILLAR_BRIEF.get(name)
    return f"- {n} x {name.upper()}: " + (
        known or f"whatever '{name}' means for this client -- take the name literally."
    )

PLAN_SYSTEM = """You write monthly social plans for Gulf construction and design businesses.

You return a written plan only. No captions, no image prompts, no hashtags.

Rules that are not negotiable:
- A topic must be specific enough to disagree with. "Kitchen post" is not a
  topic. "Why the toe-kick gap is where cheap joinery shows" is.
- An Education topic must answer a question this client's own customers
  ask before they buy. Work it out from their offer and their do's and
  don'ts; it is in there. Never reach for general industry advice, and
  never invent a question they have not been asked.
- Never invent a client fact: no prices, no lead times, no materials they
  have not mentioned, no awards.
- Never repeat anything in the corrections list.

Return JSON only:
{"posts":[{"pillar":"<one of the pillars given below>","topic":"...","slides":1-6,
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

    # The mix carries the client's own pillar names; it is the source of
    # truth for what this month wants, not our default three.
    mix = {k: int(v or 0) for k, v in (batch.get("mix") or {}).items() if int(v or 0) > 0}
    total = sum(mix.values())
    if not total:
        raise ValueError("that month has no pillar mix set")

    b = brand_of(sb, client_task_id)
    if not b["client"]:
        raise ValueError("no client card for that id, so there is no brand to write to")

    wanted = "\n".join(pillar_line(p, n) for p, n in mix.items())
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
        if pillar not in mix:
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
  brief does not give you. That includes technical detail that merely
  sounds right: an alloy grade, a coating system, a country of origin, a
  test, a standard, "checked on site". If the brand sheet does not state
  it, it is not true for this client, however plausible. Describe what the
  reader can see instead.
- The call to action must match what is actually in the image.
- Sound like the business, not like a brand consultant.
- Never say the picture is a photo of a real project, a real site or a
  real client's home ("this is a photo from our project in ..."). The
  picture may be generated, and a caption that claims otherwise is a
  false statement on the client's own account. Talk about the work, the
  detail, the idea -- not about where the picture was taken.
- Never name a place, a project or a client that the brief does not.
- Nothing internal in the copy: no hex colour codes, no pillar names, no
  reference numbers. The brand sheet is for you, not for the reader.

Return JSON only: {"caption":"...","cta":"..."}"""


def do_caption(sb: Store, job: dict) -> dict:
    post_id = str(job.get("post_id") or "")
    found = sb.get(f"social_posts?select=*&id=eq.{urllib.parse.quote(post_id)}&limit=1")
    if not found:
        raise ValueError("that post is gone")
    post = found[0]
    b = brand_of(sb, str(post.get("client_task_id")))
    dialect = str(b["social"].get("dialect") or "")
    ask = (
        f"{brief(b)}\n\nPILLAR: {post.get('pillar')}\nTOPIC: {post.get('topic')}\n"
        f"DIRECTION: {post.get('caption_direction')}"
    )
    answer, model = frontier(CAPTION_SYSTEM, ask)
    caption = str(only_json(answer).get("caption") or "").strip()
    if not caption:
        raise ValueError("the model returned no caption")

    # The language, checked rather than trusted. When the brand sheet and
    # the topic are both in English the model follows them and forgets the
    # dialect -- it did, for a Qatari client, on the first live run. One
    # retry with the instruction made impossible to miss; a second English
    # caption is an error on the post, never an English caption published
    # to an Arabic audience.
    if wants_arabic(dialect) and arabic_share(caption) < 0.5:
        note(f"  {post_id}: came back in the wrong language, asking again")
        answer, model = frontier(
            CAPTION_SYSTEM,
            ask + f"\n\nWrite the caption in Arabic, in {dialect}. Not English.",
        )
        caption = str(only_json(answer).get("caption") or "").strip()
        if arabic_share(caption) < 0.5:
            raise ValueError(
                f"the caption came back in English twice; this client writes in {dialect}"
            )
    cleaned = strip_codes(strip_dashes(caption))
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

Framing follows the pillar. These three are common and have settled
conventions; a client may use its own names instead, and then the pillar
name itself is the instruction -- read it and frame accordingly.
- portfolio: the project as an object. Wide or three-quarter, architectural,
  even light, room in frame for a caption block.
- craft: close. One joint, one edge, one material. Shallow depth, raking
  light so the surface reads.
- education: a clean, high-contrast frame with deliberate empty space for
  text to sit over.

Return JSON only: {"prompts":["slide 1 prompt","slide 2 prompt", ...]}"""


# Images come from Higgsfield through its CLI on this machine, signed in
# with Aziz's own account -- his subscription credits, not the metered
# API wallet, which was empty. The posting desk already drives the CLI
# for covers, so its caller is borrowed rather than rewritten: that is
# where the result_url lesson lives (the CLI's JSON lists the uploaded
# reference before the result, and reading the first URL once handed
# back the input as the output), and where the conversion to what
# Instagram accepts lives. One Higgsfield caller, fixed in one place.
_RADAR = [
    "/home/hermes/mahara-cockpits/hermes/ideation-radar",
    os.path.join(HERE, "..", "ideation-radar"),
]
for _p in _RADAR:
    if os.path.isdir(_p) and _p not in sys.path:
        sys.path.insert(0, _p)

# 4:5, Instagram's tallest feed shape and the one that holds the screen
# longest. Every slide of a carousel shares it.
ASPECT = "4:5"


class NoCredits(RuntimeError):
    """The Higgsfield account is out of credits.

    Its own type because it is not a fault and retrying will not fix it:
    whoever reads the queue needs to top up, not investigate.
    """


def hf_image(prompt: str) -> bytes:
    """One finished image as Instagram-ready JPEG bytes."""
    import subprocess

    from radar.posting import higgsfield as hf
    from radar.posting import thumbs

    ok, why = hf.available()
    if not ok:
        raise RuntimeError(f"Higgsfield is not usable here: {why}")
    cmd = [
        hf.cli_path() or "higgsfield", "generate", "create", hf.MODEL,
        "--aspect-ratio", ASPECT,
        "--resolution", "2k",
        "--prompt", prompt[:3000],
        "--wait", "--wait-timeout", hf.WAIT_TIMEOUT,
        "--json",
    ]
    res = subprocess.run(
        cmd, capture_output=True, text=True, timeout=660, check=False,
        stdin=subprocess.DEVNULL,
    )
    out = (res.stdout or "") + "\n" + (res.stderr or "")
    if res.returncode != 0:
        tail = re.sub(r"\s+", " ", out).strip()[-300:]
        if "credit" in tail.lower():
            raise NoCredits(
                "Higgsfield is out of credits. Top up, then make the picture again."
            )
        raise RuntimeError(f"Higgsfield failed: {tail}")
    urls = hf._result_urls(out)
    if not urls:
        raise RuntimeError("Higgsfield finished but printed no result link")
    req = urllib.request.Request(urls[0], headers={"User-Agent": "Mahara social desk"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    if len(data) < 10_000:
        raise RuntimeError("Higgsfield returned an empty file")
    return thumbs.instagram_image(data)


def keep_image(sb: Store, blob: bytes, post_id: str, n: int) -> str:
    """Copy the image into our own bucket and hand back a public URL.

    Higgsfield's URLs are theirs and need not outlive the job. GoHighLevel
    fetches media when it publishes, which can be days later, so a post
    pointing at somebody else's temporary URL is a picture that vanishes
    between approval and posting.
    """
    safe = post_id.replace(":", "_").replace("/", "_")
    path = f"{safe}/{n}.jpg"
    base = os.environ["DESK_SUPABASE_URL"].rstrip("/")
    key = os.environ["DESK_SUPABASE_KEY"]
    put = urllib.request.Request(
        f"{base}/storage/v1/object/social-images/{path}",
        data=blob, method="POST",
        headers={"Authorization": f"Bearer {key}", "apikey": key,
                 "Content-Type": "image/jpeg", "x-upsert": "true"},
    )
    urllib.request.urlopen(put, timeout=120).read()
    return f"{base}/storage/v1/object/public/social-images/{path}"


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

    # Then the pictures, 4:5, the same for every slide of a carousel.
    images: list[str] = []
    for i, prompt in enumerate(prompts, 1):
        try:
            images.append(keep_image(sb, hf_image(prompt), post_id, i))
        except NoCredits:
            # The prompts are already saved, so topping up and re-running
            # costs nothing but the images. Say so plainly rather than
            # burying it in a stack trace.
            if images:
                sb.patch(f"social_posts?id=eq.{urllib.parse.quote(post_id)}",
                         {"images": images, "updated_at": now()})
            raise
    sb.patch(
        f"social_posts?id=eq.{urllib.parse.quote(post_id)}",
        {"images": images, "status": "generated" if images else "generating",
         "updated_at": now()},
    )
    return {"post": post_id, "prompts": len(prompts), "images": len(images)}



FILL_SYSTEM = """You fill empty days on a Gulf construction and design
business's Instagram calendar. Each slot has a date and a pillar.

Return JSON only: {"posts":[{"topic":"...","slides":1-6,"caption_direction":"..."}]}
One entry per slot, in the order given.

Not negotiable:
- A topic must be specific enough to disagree with. "Kitchen post" is not a
  topic. "Why the toe-kick gap is where cheap joinery shows" is.
- Everything comes from this client's brand and offer. Never general
  industry advice, never a claim, price, date or material they have not
  given you.
- slides is 1 for a single strong image; more only when the idea is a
  sequence (a process, a before and after, a set of details).
- caption_direction is one or two sentences on what the caption should do,
  for the copywriter who writes it next.
- Vary the angle across the slots. Two posts in a month on the same idea is
  a wasted post.
- Nothing internal in a topic: no hex colour codes, no reference numbers.
  Say "the bronze finish", not the code for it. The topic becomes the
  caption, and a customer does not read in hex."""


def do_fill(sb: Store, job: dict) -> dict:
    """Put a finished draft on each empty day it was given.

    This is the whole month in one step: no mix to set, no plan to approve
    before anything happens. The cockpit picks the empty days and a pillar
    for each; this writes the idea, then queues the caption and the
    pictures for every post at once, so the calendar fills in front of
    whoever pressed the button rather than waiting on three more.
    """
    batch_id = str(job.get("batch_id") or "")
    client_task_id = str(job.get("client_task_id") or "")
    slots = list((job.get("params") or {}).get("slots") or [])
    if not batch_id or not client_task_id:
        raise ValueError("a fill job needs a month and a client")
    if not slots:
        raise ValueError("there were no empty days to fill")

    b = brand_of(sb, client_task_id)
    if not b["client"]:
        raise ValueError("no client card for that id, so there is no brand to write to")

    wanted = "\n".join(
        f"{i + 1}. {s_['day']} -- pillar: {s_['pillar']}"
        + (f" ({PILLAR_BRIEF[s_['pillar']]})" if s_["pillar"] in PILLAR_BRIEF else "")
        for i, s_ in enumerate(slots)
    )
    parsed = only_json(deepseek(
        FILL_SYSTEM,
        f"{brief(b)}\n\nTHE SLOTS TO FILL:\n{wanted}",
    ))
    ideas = parsed.get("posts") if isinstance(parsed, dict) else parsed
    if not isinstance(ideas, list) or not ideas:
        raise ValueError("the model returned no posts")

    taken = sb.get(
        f"social_posts?select=n&batch_id=eq.{urllib.parse.quote(batch_id)}&order=n.desc&limit=1"
    )
    n = int(taken[0]["n"]) if taken else 0

    rows, ids = [], []
    for slot, idea in zip(slots, ideas):
        topic = str((idea or {}).get("topic") or "").strip()
        if not topic:
            continue
        n += 1
        pid = f"{batch_id}:{n}"
        ids.append(pid)
        rows.append({
            "id": pid,
            "batch_id": batch_id,
            "client_task_id": client_task_id,
            "n": n,
            "pillar": slot["pillar"],
            "topic": topic[:300],
            "slides": max(1, min(10, int((idea or {}).get("slides") or 1))),
            "caption_direction": str((idea or {}).get("caption_direction") or "")[:2000],
            # Straight to approved: a person pressing "Fill the month" is
            # the decision the plan-approval step used to ask for.
            "status": "approved",
            "scheduled_at": f"{slot['day']}T07:00:00Z",
            "at": now(),
            "updated_at": now(),
        })
    if not rows:
        raise ValueError("nothing the model returned was a usable post")
    sb.post("social_posts?on_conflict=id", rows, "resolution=merge-duplicates,return=minimal")

    # Caption and pictures for every new post, queued together so they run
    # as soon as the drainer is free rather than one button at a time.
    jobs = []
    for pid in ids:
        for kind in ("caption", "generate"):
            jobs.append({
                "id": f"{kind}:{pid}",
                "kind": kind,
                "client_task_id": client_task_id,
                "batch_id": batch_id,
                "post_id": pid,
                "status": "queued",
                "attempts": 0,
                "requested_by": job.get("requested_by") or "fill",
            })
    sb.post("social_jobs?on_conflict=id", jobs, "resolution=merge-duplicates,return=minimal")
    return {"posts": len(rows), "queued": len(jobs)}


def on_post(sb: Store, post_id: str, error: str | None) -> None:
    """Record a job's outcome where the calendar can see it."""
    try:
        sb.patch(
            f"social_posts?id=eq.{urllib.parse.quote(post_id)}",
            {"error": error, "updated_at": now()},
        )
    except Exception:  # noqa: BLE001 - the job result is already recorded
        pass


HANDLERS = {"fill": do_fill, "plan": do_plan, "caption": do_caption, "generate": do_generate}


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    sb = Store()
    queued = sb.get(
        f"social_jobs?select=*&status=eq.queued&attempts=lt.{MAX_ATTEMPTS}"
        "&order=created_at.asc&limit=200"
    )
    # Fast work first. A month fill queues a caption and a picture for
    # every post at once; in arrival order each two-minute render would
    # hold up the next post's ten-second caption, and the calendar would
    # sit empty of words while the first image drew.
    speed = {"fill": 0, "plan": 1, "caption": 2, "generate": 3}
    queued.sort(key=lambda j: speed.get(str(j.get("kind")), 9))
    # Images take minutes each, so fewer of them per run; everything else
    # is quick enough to clear in one pass.
    jobs, renders = [], 0
    for j in queued:
        if str(j.get("kind")) == "generate":
            if renders >= limit:
                continue
            renders += 1
        jobs.append(j)
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
            if job.get("post_id"):
                on_post(sb, str(job["post_id"]), None)
        except Exception as e:  # noqa: BLE001 - one bad job must not stop the rest
            why = f"{type(e).__name__}: {e}"
            sb.failed(jid, why)
            failed += 1
            note(f"  {kind} {jid} FAILED: {why[:200]}")
            # On the post as well as the job. The calendar reads posts,
            # and a render that failed on credits otherwise sits on its
            # day as "drafting" forever with nobody told why.
            if job.get("post_id"):
                on_post(sb, str(job["post_id"]), str(e)[:300] or why[:300])
    note(f"done {done}, failed {failed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
