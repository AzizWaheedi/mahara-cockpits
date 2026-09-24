#!/usr/bin/env python3
"""Salma: drain the social jobs queue.

Ideas, captions, pictures, Reel covers and the accounts list are made here;
due posts go out from here too, but only for clients someone has switched
on (`publish_due`). There are no GoHighLevel credentials in this process
and there should never be.

Environment: DESK_SUPABASE_URL, DESK_SUPABASE_KEY, DEEPSEEK_API_KEY,
ANTHROPIC_API_KEY, META_ACCESS_TOKEN, HF_KEY (or the file named by
HF_KEY_FILE). Read by name, never printed.
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
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import looks  # noqa: E402 - the words and the motion, beside this file

KINDS = ("fill", "plan", "caption", "generate", "cover", "accounts", "words", "motion")
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

Return JSON only: {"instagram":"...","facebook":"..."}

instagram: the Instagram caption. The hook in the first line, because only
  the first lines show before "more". Short paragraphs.
facebook: the same message for the client's Facebook Page. It may run a
  little longer and read more like a conversation. No hashtag block.

When you are given what is said in the video, the caption is about that:
what the person in it actually says, not a guess at it."""


def do_caption(sb: Store, job: dict) -> dict:
    """The Instagram and Facebook captions, from the brand and, when the
    post has a video, from what is actually said in it."""
    post_id = str(job.get("post_id") or "")
    found = sb.get(f"social_posts?select=*&id=eq.{urllib.parse.quote(post_id)}&limit=1")
    if not found:
        raise ValueError("that post is gone")
    post = found[0]
    b = brand_of(sb, str(post.get("client_task_id")))
    dialect = str(b["social"].get("dialect") or "")

    spoken = post_transcript(sb, post)
    ask = (
        f"{brief(b)}\n\nPILLAR: {post.get('pillar')}\nTOPIC: {post.get('topic')}\n"
        f"DIRECTION: {post.get('caption_direction')}"
        + (f"\n\nWHAT IS SAID IN THE VIDEO:\n{spoken[:6000]}" if spoken else "")
    )

    def attempt(extra: str = "") -> tuple[str, str, str]:
        answer, used = frontier(CAPTION_SYSTEM, ask + extra)
        parsed = only_json(answer)
        ig = str(parsed.get("instagram") or parsed.get("caption") or "").strip()
        fb = str(parsed.get("facebook") or "").strip() or ig
        return ig, fb, used

    ig, fb, model = attempt()
    if not ig:
        raise ValueError("the model returned no caption")

    # The language, checked rather than trusted. When the brand sheet and
    # the topic are both in English the model follows them and forgets the
    # dialect -- it did, for a Qatari client, on the first live run. One
    # retry with the instruction made impossible to miss; a second English
    # caption is an error on the post, never English published to an
    # Arabic audience.
    if wants_arabic(dialect) and min(arabic_share(ig), arabic_share(fb)) < 0.5:
        note(f"  {post_id}: came back in the wrong language, asking again")
        ig, fb, model = attempt(f"\n\nWrite both captions in Arabic, in {dialect}. Not English.")
        if min(arabic_share(ig), arabic_share(fb)) < 0.5:
            raise ValueError(
                f"the caption came back in English twice; this client writes in {dialect}"
            )

    ig_clean = strip_codes(strip_dashes(ig))
    fb_clean = strip_codes(strip_dashes(fb))
    if (ig_clean, fb_clean) != (ig, fb):
        note(f"  {post_id}: stripped an em-dash or a code the model put in anyway")
    sb.patch(
        f"social_posts?id=eq.{urllib.parse.quote(post_id)}",
        {"caption": ig_clean[:2200], "caption_facebook": fb_clean[:5000],
         "updated_at": now()},
    )
    return {"post": post_id, "instagram": len(ig_clean), "facebook": len(fb_clean),
            "from_video": bool(spoken), "model": model}


def post_transcript(sb: Store, post: dict) -> str:
    """What is said in the post's first video, transcribed once and kept.

    The radar's speech chain is borrowed rather than rebuilt: it pulls the
    audio out, tries ElevenLabs, falls back to Groq, and says plainly when
    nobody could listen.
    """
    if post.get("transcript"):
        return str(post["transcript"])
    video = next((m for m in (post.get("media") or []) if m.get("kind") == "video"), None)
    if not video:
        return ""
    import shutil
    import tempfile
    from pathlib import Path

    from radar import speech
    from radar.config import Config

    workdir = Path(tempfile.mkdtemp(prefix="salma-video-"))
    try:
        path = download(str(video["url"]), workdir / "video")
        out = speech.transcribe(Config.from_env(), path, workdir, note)
        text = str(out.get("text") or "").strip()
    except Exception as e:  # noqa: BLE001 - a caption without it beats no caption
        note(f"  {post.get('id')}: could not transcribe the video ({type(e).__name__})")
        return ""
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    if text:
        sb.patch(f"social_posts?id=eq.{urllib.parse.quote(str(post['id']))}",
                 {"transcript": text[:20000]})
    return text


def download(url: str, dest) -> "Path":
    """Stream a file to disk. A reel can be hundreds of megabytes."""
    from pathlib import Path

    dest = Path(dest)
    req = urllib.request.Request(url, headers={"User-Agent": "Mahara social desk"})
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as fh:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
    return dest


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


# Pictures come from Higgsfield by one of two roads, one at a time
# (`images_via`):
#
# - Its API, with a key (HF_KEY, "id:secret"). Aziz, 2026-09-24: "Try this
#   API key instead." Higgsfield ended the CLI's session on its first use
#   after every fresh sign-in (2026-09-23); a key does not lapse that way.
#   The API pays from its own wallet (open.higgsfield.ai/billing), never the
#   app's subscription credits, and an empty one is said on screen. Nano
#   Banana Pro is switched off on it ("model_disabled"), and Aziz chose GPT
#   Image anyway ("It's better", same day): GPT Image 2.5 Sunburst, through
#   Higgsfield's Marketing Studio route, which reads references from links.
#   Of the three GPT Image routes drawn from one demo prompt, Sunburst kept
#   the camera square to the wall as asked; Flare bent the skirting line and
#   the 2.0 route took twice as long (2026-09-24).
# - Its CLI on this machine, signed in as Aziz: his subscription credits and
#   Nano Banana Pro. Used when there is no key, or when SALMA_IMAGES=cli.
#   The posting desk drives the same CLI for covers, so its caller is
#   borrowed rather than rewritten: that is where the result_url lesson
#   lives (the CLI's JSON lists the uploaded reference before the result,
#   and reading the first URL once handed back the input as the output).
#   The posting desk's covers of Aziz stay on the CLI whatever this says:
#   his face is only ever composited by Nano Banana Pro.
_RADAR = [
    "/home/hermes/mahara-cockpits/hermes/ideation-radar",
    os.path.join(HERE, "..", "ideation-radar"),
]
for _p in _RADAR:
    if os.path.isdir(_p) and _p not in sys.path:
        sys.path.insert(0, _p)

# 4:5 unless the post says otherwise: Instagram's tallest shape that its
# publishing API accepts, and the one that holds the screen longest. Every
# slide of a carousel shares the post's shape.
ASPECT = "4:5"

# The shapes a post can take, as Instagram's composer offers them: what the
# model is asked to draw, the exact size delivered, and the words the
# prompt writer composes for. The model has no 1.91:1, so landscape is
# drawn 16:9 and trimmed to it from the centre.
SHAPES = {
    "1:1": ("1:1", (1080, 1080), "square, 1:1"),
    "4:5": ("4:5", (1080, 1350), "portrait, 4:5"),
    "3:4": ("3:4", (1080, 1440), "tall portrait, 3:4"),
    "1.91:1": ("16:9", (1080, 566), "wide landscape, 1.91:1"),
}
REEL_COVER = (1080, 1920)


SIGNED_OUT = (
    "Higgsfield is signed out on the server, so no pictures or covers can be "
    "made. Sign it in again, then ask for the picture again."
)


class NoCredits(RuntimeError):
    """The Higgsfield account is out of credits.

    Its own type because it is not a fault and retrying will not fix it:
    whoever reads the queue needs to top up, not investigate.
    """


HF_API = "https://api.higgsfield.ai"
HF_API_MODEL = "marketing-studio/image/sunburst"
HF_KEY_FILE = os.environ.get("HF_KEY_FILE") or os.path.expanduser("~/.higgsfield-api.env")
# The shapes the API model draws. It has no 4:5, so 4:5 is drawn 3:4 and
# fit_jpeg trims the difference from top and bottom, as 1.91:1 is from 16:9.
HF_API_ASPECTS = ("1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9")
HF_API_DRAW = {"4:5": "3:4"}
HF_POLL_S = 4.0
HF_WAIT_S = 480
# The API has no free way to ask for its balance: a real picture is the only
# question that gets "not_enough_credits" back. The last answer is kept here
# so the health line can say so between pictures.
HF_WALLET_FILE = os.path.expanduser("~/.salma-higgsfield-wallet.json")

WALLET_EMPTY = (
    "Higgsfield's API wallet is empty. Top it up at open.higgsfield.ai/billing "
    "(the app's own credits do not pay for the API), then ask for the picture again."
)
KEY_REFUSED = (
    "Higgsfield refused the API key. Make a new one at open.higgsfield.ai/api-keys "
    "and put it on the server."
)
NSFW = (
    "Higgsfield's safety check refused this picture. Change the topic or the "
    "reference pictures, then draw it again."
)


def hf_key() -> str:
    """The API key by name: HF_KEY in the environment, else the file kept for it."""
    key = os.environ.get("HF_KEY", "").strip()
    if key:
        return key
    try:
        with open(HF_KEY_FILE) as fh:
            for line in fh:
                if line.startswith("HF_KEY="):
                    return line.split("=", 1)[1].strip().strip("'\"")
    except OSError:
        pass
    return ""


def images_via() -> str:
    """"api" when there is a key, unless SALMA_IMAGES=cli asks for the CLI."""
    asked = os.environ.get("SALMA_IMAGES", "").strip().lower()
    if asked in ("api", "cli"):
        return asked
    return "api" if hf_key() else "cli"


def hf_api(method: str, url: str, body: dict | None = None) -> tuple[int, object]:
    """One call to Higgsfield's API: the status and the JSON (or text) it sent."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Key {hf_key()}", "Content-Type": "application/json",
        "User-Agent": "Mahara social desk"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            code, raw = r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        code, raw = e.code, e.read().decode("utf-8", "replace")
    try:
        return code, json.loads(raw or "{}")
    except ValueError:
        return code, raw[:300]


def remember_wallet(state: str) -> None:
    try:
        with open(HF_WALLET_FILE, "w") as fh:
            json.dump({"state": state, "at": now()}, fh)
    except OSError:
        pass


def wallet_state() -> str:
    try:
        with open(HF_WALLET_FILE) as fh:
            return str(json.load(fh).get("state") or "")
    except (OSError, ValueError):
        return ""


def hf_refusal(code: int, said: object) -> Exception:
    """Higgsfield's no, as a sentence a person can act on."""
    detail = said.get("detail") if isinstance(said, dict) else said
    text = detail if isinstance(detail, str) else json.dumps(detail)[:200]
    if text == "not_enough_credits":
        remember_wallet("empty")
        return NoCredits(WALLET_EMPTY)
    if code == 401:
        return RuntimeError(KEY_REFUSED)
    if text in ("model_disabled", "model_not_found"):
        return RuntimeError(f"Higgsfield has switched {HF_API_MODEL} off for this key ({text}).")
    return RuntimeError(f"Higgsfield said no ({code}): {text[:200]}")


def hf_api_image(prompt: str, refs: list[str], aspect: str) -> bytes:
    """One picture through the API key, as JPEG bytes, as the model drew it.

    `refs` are public links (our own bucket); the API fetches them itself.
    A refusal is never retried here: an empty wallet or a refused key is a
    person's job, and the sentence says which.
    """
    body: dict = {"prompt": prompt[:3000], "resolution": "2k", "quality": "high",
                  "aspect_ratio": HF_API_DRAW.get(aspect, aspect)}
    if refs:
        body["image_urls"] = refs[:6]
    st = hf_api_run(HF_API_MODEL, body, what="picture")
    images = st.get("images") or []
    url = images[0].get("url") if images and isinstance(images[0], dict) else None
    if not url:
        raise RuntimeError("Higgsfield finished but sent no picture back")
    data = fetch_bytes(str(url))
    if len(data) < 10_000:
        raise RuntimeError("Higgsfield returned an empty file")
    remember_wallet("ok")
    return as_jpeg(data)


def hf_api_run(model: str, body: dict, *, what: str = "picture", wait_s: int | None = None) -> dict:
    """Submit to the API and wait for the finished request, or say why not."""
    if not hf_key():
        raise RuntimeError("Pictures need Higgsfield, and the server has no HF_KEY.")
    code, sub = hf_api("POST", f"{HF_API}/{model}", body)
    if code >= 400 or not isinstance(sub, dict) or not sub.get("request_id"):
        raise hf_refusal(code, sub)
    status_url = str(sub.get("status_url") or f"{HF_API}/requests/{sub['request_id']}/status")
    wait = wait_s or HF_WAIT_S
    deadline = time.time() + wait
    while True:
        time.sleep(HF_POLL_S)
        try:
            code, st = hf_api("GET", status_url)
        except urllib.error.URLError:
            code, st = 0, None  # a blip while it draws is not a failed picture
        status = st.get("status") if isinstance(st, dict) else None
        if status == "completed":
            return st
        if status == "nsfw":
            raise RuntimeError(NSFW)
        if status == "failed":
            why = st.get("error") or st.get("detail") or "no reason given"
            raise RuntimeError(f"Higgsfield could not make the {what}: {str(why)[:200]}")
        if status == "canceled":
            raise RuntimeError(f"The {what} was cancelled at Higgsfield. Ask for it again.")
        if 400 <= code < 500:
            raise hf_refusal(code, st)
        if time.time() > deadline:
            try:
                hf_api("POST", str(sub.get("cancel_url") or status_url.replace("/status", "/cancel")))
            except Exception:  # noqa: BLE001 - the sentence below matters more
                pass
            raise RuntimeError(f"Higgsfield took longer than {wait // 60} minutes on this {what}. "
                               "Ask for it again.")


# The picture that moves a little. Kling 3.0 Standard held a locked camera,
# did a slow dolly-in and a man walking along a pool, and never touched the
# words, because they are not in what it is given (2026-09-24). Seedance
# drifted and darkened; the same first and last frame made Kling freeze.
HF_VIDEO_MODEL = "kling-video/v3.0/std/image-to-video"


def hf_api_video(prompt: str, image_url: str, *, seconds: int = 5) -> bytes:
    """A few seconds of the picture moving, as MP4 bytes, no sound."""
    st = hf_api_run(HF_VIDEO_MODEL, {"image_url": image_url, "prompt": prompt[:2400],
                                     "duration": seconds, "sound": "off"},
                    what="video", wait_s=900)
    url = None
    for k in ("video", "videos", "images"):
        v = st.get(k)
        if isinstance(v, dict) and v.get("url"):
            url = v["url"]
        elif isinstance(v, list) and v and isinstance(v[0], dict) and v[0].get("url"):
            url = v[0]["url"]
        if url:
            break
    if not url:
        raise RuntimeError("Higgsfield finished but sent no video back")
    data = fetch_bytes(str(url))
    if len(data) < 50_000:
        raise RuntimeError("Higgsfield returned an empty video")
    remember_wallet("ok")
    return data


def hf_image(prompt: str, refs: list[str] | None = None, aspect: str = ASPECT) -> bytes:
    """One picture as JPEG bytes, as the model drew it.

    `refs` are links to pictures the model takes its look from: the
    client's own photos, examples somebody attached to the post, or the
    video frame a cover is made from. The caller fits the result to its
    exact size with `fit_jpeg`.
    """
    links = [str(r) for r in (refs or []) if str(r).startswith(("http://", "https://"))][:6]
    if images_via() == "api":
        return hf_api_image(prompt, links, aspect)
    import shutil
    import tempfile

    workdir = tempfile.mkdtemp(prefix="salma-refs-")
    try:
        return hf_cli_image(prompt, fetch_refs(links, workdir), aspect)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def hf_cli_image(prompt: str, refs: list[str], aspect: str) -> bytes:
    """One picture through the CLI; `refs` are local files."""
    import subprocess

    from radar.posting import higgsfield as hf

    ok, why = hf.available()
    if not ok:
        # Signed out is the common case -- the CLI's session lapses -- and
        # the one a person can fix, so it says so in words, on the post.
        if "signed in" in why.lower() or "login" in why.lower():
            raise RuntimeError(SIGNED_OUT)
        raise RuntimeError(f"Higgsfield is not usable here: {why}")
    cmd = [
        hf.cli_path() or "higgsfield", "generate", "create", hf.MODEL,
        "--aspect-ratio", aspect,
        "--resolution", "2k",
        "--prompt", prompt[:3000],
        "--wait", "--wait-timeout", hf.WAIT_TIMEOUT,
        "--json",
    ]
    for r in refs[:6]:
        cmd += ["--image-references", r]
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
        if "session expired" in tail.lower() or "auth login" in tail.lower():
            # The tool's own words ride along: "no response received" and
            # "session expired" both end in the same hint, and only the first
            # line says which one it was.
            first = next((ln.strip() for ln in out.splitlines() if ln.strip().lower().startswith("error")), "")
            raise RuntimeError(f"{SIGNED_OUT} (Higgsfield said: {first[:160]})" if first else SIGNED_OUT)
        raise RuntimeError(f"Higgsfield failed: {tail}")
    urls = hf._result_urls(out)
    if not urls:
        raise RuntimeError("Higgsfield finished but printed no result link")
    data = fetch_bytes(urls[0])
    if len(data) < 10_000:
        raise RuntimeError("Higgsfield returned an empty file")
    return as_jpeg(data)


def fit_jpeg(data: bytes, size: tuple[int, int]) -> bytes:
    """The picture at exactly `size`, trimmed from the centre, as a JPEG.

    Instagram shows a post at 1080 wide in its shape; delivering exactly
    that means what was reviewed is what goes out, not a crop Instagram
    chooses later.
    """
    import io

    from PIL import Image, ImageOps

    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    img = ImageOps.fit(img, size, Image.LANCZOS, centering=(0.5, 0.5))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=90, optimize=True)
    return out.getvalue()


def as_jpeg(data: bytes) -> bytes:
    """The bytes as a JPEG, whatever came back, without reframing it."""
    import io

    from PIL import Image

    img = Image.open(io.BytesIO(data)).convert("RGB")
    out = io.BytesIO()
    img.save(out, "JPEG", quality=90, optimize=True)
    return out.getvalue()


def fetch_refs(urls: list[str], workdir: str) -> list[str]:
    """Download reference pictures to files, since the CLI takes paths."""
    paths = []
    for i, u in enumerate(urls[:6]):
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "Mahara social desk"})
            with urllib.request.urlopen(req, timeout=60) as r:
                blob = r.read()
            if len(blob) < 1000:
                continue
            path = os.path.join(workdir, f"ref-{i}.jpg")
            with open(path, "wb") as fh:
                fh.write(as_jpeg(blob))
            paths.append(path)
        except Exception as e:  # noqa: BLE001 - one bad reference must not stop the picture
            note(f"  a reference could not be read, left out: {type(e).__name__}")
    return paths


def keep_image(sb: Store, blob: bytes, post_id: str, n: int | str) -> str:
    """Copy the image into our own bucket and hand back a public URL.

    Higgsfield's URLs are theirs and need not outlive the job. GoHighLevel
    fetches media when it publishes, which can be days later, so a post
    pointing at somebody else's temporary URL is a picture that vanishes
    between approval and posting.
    """
    import uuid

    safe = post_id.replace(":", "_").replace("/", "_")
    # A new name for every drawing. The same name, overwritten, kept the
    # old picture on screen for an hour: storage serves these with a
    # cache lifetime, and "New picture" appeared to do nothing.
    return keep_blob("social-images", f"{safe}/{n}-{uuid.uuid4().hex[:8]}.jpg", blob, "image/jpeg")


def keep_blob(bucket: str, path: str, blob: bytes, content_type: str) -> str:
    """Put a file in one of our public buckets and hand back its link."""
    base = os.environ["DESK_SUPABASE_URL"].rstrip("/")
    key = os.environ["DESK_SUPABASE_KEY"]
    put = urllib.request.Request(
        f"{base}/storage/v1/object/{bucket}/{path}",
        data=blob, method="POST",
        headers={"Authorization": f"Bearer {key}", "apikey": key,
                 "Content-Type": content_type, "x-upsert": "true"},
    )
    urllib.request.urlopen(put, timeout=300).read()
    return f"{base}/storage/v1/object/public/{bucket}/{path}"


def keep_named(sb: Store, blob: bytes, post_id: str, stem: str, ext: str) -> str:
    """A layer (PNG) or a video (MP4) made for a post, under a fresh name."""
    import uuid

    safe = post_id.replace(":", "_").replace("/", "_")
    name = f"{safe}/{stem}-{uuid.uuid4().hex[:8]}.{ext}"
    if ext == "mp4":
        return keep_blob("social-media", f"salma/{name}", blob, "video/mp4")
    return keep_blob("social-images", name, blob, "image/png" if ext == "png" else "image/jpeg")


# ---------------------------------------------------------------------------
# Words on the pictures (Aziz, 2026-09-24). The three looks are in looks.py:
# bold draws the words in and reads them back; showcase sets them in type
# over a clean picture; plain has none.

WORDS_BOLD_SYSTEM = """You write the words that sit on each slide of a scroll-stopping Instagram
carousel for a Gulf business, in the client's dialect. The picture is drawn
around them afterwards.

Return JSON only: {"slides":[{"headline":"...","line":"...","accent":"..."}]}

- One entry per slide asked for, in order.
- The cover (slide 1): "headline" is the hook, two to six words that make
  somebody stop: a blunt claim, a warning, a promise, or the question they
  already ask. "accent" is the one word of the headline that hurts or
  promises, copied exactly, or empty. "line" is empty or up to six words.
- Middle slides: one point each. "headline" six words or fewer; "line" up
  to nine words that pays it off.
- The last slide of a carousel of three or more asks for one thing: save
  it, share it, or send a message. In the dialect.
- Short beats long: long Arabic lines are where letters go wrong in the
  picture.
- Never a fact, price, number, award, place or material the brief does not
  give. Nothing internal: no colour codes, no pillar names.
- Arabic punctuation (؟ ،), ".." for a pause, no em dashes, no emoji, no
  hashtags, no quotation marks. Spell it right, hamza included (إطار, not
  اطار): these words are printed on the client's picture."""

WORDS_SHOWCASE_SYSTEM = """You write the words that sit on the pictures of an architecture, interiors
or design-and-build firm's Instagram post. A portfolio, not an advert:
elegant and short. They are set in type over the picture afterwards.

Return JSON only: {"slides":[{"title":"...","line":"..."}],"cta":"..."}

- One entry per slide asked for, in order.
- The cover (slide 1): "title" names the project or the idea in two to
  four words; "line" says what and where in six words or fewer. The line
  may be in English capitals when the brand writes that way
  ("VILLA AL SIDRA · DOHA"), otherwise the dialect.
- Other slides: "title" empty; "line" one sentence of nine words or fewer
  that explains this slide: the idea, a material, a detail, a decision.
- "cta" is the footer's offer in three or four words of the dialect (a
  free consultation, a site visit) only when the brief offers one; else
  empty.
- Never invent a project name, a place, an award, a client, a number or a
  material. If the brief names no project, name the idea instead.
- No emoji, no hashtags, no quotation marks, no em dashes. Spell it right,
  hamza included (إطار, not اطار): the words are set in type as written."""

SCENE_BOLD_SYSTEM = """You describe the picture for each slide of a bold Instagram carousel for a
Gulf construction and design business. The words of each slide are given;
they are set into the picture separately, so never describe any text.

- The cover: one striking visual that carries the headline's idea: a
  metaphor made physical, a comparison, or a face with a clear emotion.
  One focal point, high contrast.
- Other slides: the same world, light and palette as the cover, one clear
  subject each.
- Leave the top 40% of the frame calm (a plain wall, sky, a dark or light
  ground) for the words.
- People are allowed as anonymous stand-ins (an engineer on a site, a
  family at home), never a real or named person and never presented as the
  client's own staff. Prefer the client's own photographs, listed below,
  when one fits.
- Use the brand's colours by name, never by code.

Return JSON only: {"prompts":["slide 1 picture","slide 2 picture", ...]}"""

SCENE_SHOWCASE_SYSTEM = """You describe photorealistic architectural visualisation for an
architecture, interiors or design-and-build firm's Instagram post, one
picture per slide. No text appears in any picture.

- Exteriors: blue hour or dusk, warm interior light through glass,
  reflections in water or wet stone, eye level, symmetrical one-point
  perspective, a wide lens; the building in the lower two thirds and open
  sky in the upper third.
- Interiors: one strong colour story (walnut, burgundy and brass; sand,
  linen and oak), soft directional light, styled objects, cinematic.
- Keep the upper third calm for the title and the bottom edge calm for a
  thin footer.
- People only small, for scale, never the subject.
- A carousel is one project: the same building, materials and light on
  every slide; slides after the cover show the idea, a material, a detail.
- Never present a concept as a real, named project the brief does not give.

Return JSON only: {"prompts":["slide 1 picture","slide 2 picture", ...]}"""

MOTION_SYSTEM = """You direct a five-second shot made from one still picture, for an Instagram
Reel. Words are laid over it afterwards; never mention text.

Return JSON only: {"camera":"...","motion":"...","person":"..."}

- camera: one slow, smooth move that suits this picture: a gentle dolly-in
  toward the subject, a slow sideways drift, a slow push toward a detail.
  Never fast, never a zoom-out, never a cut.
- motion: one or two natural movements that belong in this picture (palm
  fronds sway, water ripples, curtains stir, clouds drift, light shifts).
- person: empty, or one small anonymous person doing something quiet that
  belongs (walking along a pool's edge, crossing a room), only when the
  picture has room for it; never a close-up, never a face.
- The building, its lines, materials and light stay exactly as they are."""

RECOMPOSE_PROMPT = (
    "Recompose this exact scene as a tall vertical 9:16 frame: extend the sky above and the "
    "foreground below as needed. Keep the building, the room, the materials, the light and every "
    "detail exactly as they are. No text, no letters, no logos."
)

READ_PROMPT = (
    "Transcribe every piece of text drawn in this image exactly as it appears, letter by letter, "
    "one line of the image per line. Do not correct spelling, do not complete or tidy words, do "
    "not translate. If a letter's dots are missing, doubled or moved, or a mark sits where a "
    "letter should be, write exactly what is drawn. Reply with the text only. If there is no "
    "text, reply with nothing."
)


def vision_read(jpeg: bytes) -> str:
    """What a vision model reads on the picture, letter by letter, without
    being told what it should say: a reader that knows the answer reads it."""
    import base64

    b64 = base64.b64encode(jpeg).decode()
    last: Exception | None = None
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        content = [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
            {"type": "text", "text": READ_PROMPT},
        ]
        models = [m for m in (os.environ.get("READBACK_MODEL"), "claude-sonnet-5", "claude-sonnet-4-6") if m]
        for model in dict.fromkeys(models):
            body = {"model": model, "max_tokens": 600, "messages": [{"role": "user", "content": content}]}
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages", data=json.dumps(body).encode(),
                headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                         "Content-Type": "application/json"},
            )
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    out = json.load(r)
                return "".join(b.get("text", "") for b in out.get("content", []))
            except urllib.error.HTTPError as e:
                last = e
                if e.code in (400, 404):  # a model this key does not have: the next one
                    continue
                raise
    # The captions' fallback, the same here: this server has OpenAI only
    # (2026-09-24). Text, not pictures, so the images house rule stands.
    # gpt-5.5 read a correct line correctly where gpt-4.1, gpt-4o and gpt-5.4
    # misread it. None of them, blind or shown the intended words, saw the
    # one real slip (a doubled letter's missing dots): this finds missing or
    # wrong words, not a lost dot, and the screen says so.
    okey = os.environ.get("OPENAI_API_KEY")
    if okey:
        body = {
            "model": os.environ.get("READBACK_OPENAI_MODEL") or "gpt-5.5",
            "max_completion_tokens": 4000,
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": READ_PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"}},
            ]}],
        }
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions", data=json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {okey}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            out = json.load(r)
        return str(out["choices"][0]["message"]["content"] or "")
    if last:
        raise RuntimeError(f"No vision model would read the picture ({last})")
    raise RuntimeError("Reading the words back needs ANTHROPIC_API_KEY or OPENAI_API_KEY on the server.")


def read_back(jpeg: bytes, words: dict | None) -> dict:
    """Whether the words on the picture are the words asked for. A reader
    that fails is said, never taken for a pass."""
    expected = looks.slide_lines(words)
    if not expected:
        return {"ok": True}
    try:
        seen = vision_read(jpeg)
    except Exception as e:  # noqa: BLE001 - the picture stands; the check is what is missing
        return {"ok": None, "error": str(e)[:200]}
    ok, missing = looks.words_match(expected, seen)
    return {"ok": ok, "missing": missing, "seen": seen.strip()[:300]}


def handle_of(b: dict) -> str:
    u = str(b["social"].get("ig_username") or "").strip().lstrip("@")
    return f"@{u}" if u else ""


def client_line(b: dict) -> str:
    name = str(b["client"].get("name") or "").strip()
    return f"{name}, a Gulf construction and design business" if name else \
        "a Gulf construction and design business"


def write_words(b: dict, post: dict, look: str, slots: list[dict]) -> tuple[list[dict], str]:
    """The words for the slides that have none yet, in the client's dialect.

    Client copy, so the frontier model writes it, never the cheap one.
    Words already on a slide are kept: somebody may have fixed them.
    """
    dialect = str(b["social"].get("dialect") or "")
    want = [s for s in slots if not s.get("keep")]
    if not want:
        return [dict(s["keep"]) for s in slots], ""
    system = WORDS_BOLD_SYSTEM if look == "bold" else WORDS_SHOWCASE_SYSTEM
    kept = [f"slide {s['n']}: {json.dumps(s['keep'], ensure_ascii=False)}" for s in slots if s.get("keep")]
    ask = (
        f"{brief(b)}\n\nDIALECT: {dialect or 'the brand language'}\n"
        f"PILLAR: {post.get('pillar')}\nTOPIC: {post.get('topic')}\n"
        f"DIRECTION: {post.get('caption_direction')}\n"
        f"SLIDES IN THE POST: {slots[0].get('of') or len(slots)}\n"
        f"WRITE THE WORDS FOR SLIDES: {', '.join(str(s['n']) for s in want)}"
        + ("\nALREADY ON THE OTHER SLIDES (do not repeat them):\n" + "\n".join(kept) if kept else "")
    )
    head_key = "headline" if look == "bold" else "title"

    def attempt(extra: str = "") -> tuple[list, str]:
        answer, _ = frontier(system, ask + extra, max_tokens=900)
        parsed = only_json(answer)
        got = parsed.get("slides") if isinstance(parsed, dict) else parsed
        if not isinstance(got, list) or len(got) < len(want):
            raise ValueError("the words came back short of the slides asked for")
        cta = str(parsed.get("cta") or "").strip() if isinstance(parsed, dict) else ""
        return [looks.clean_words(g if isinstance(g, dict) else {}, look) for g in got[:len(want)]], cta

    got, cta = attempt()
    # Arabic when the client writes Arabic: checked, as the captions are.
    heads = " ".join(g.get(head_key) or g.get("line") or "" for g in got)
    if wants_arabic(dialect) and heads and arabic_share(heads) < 0.5:
        got, cta = attempt(f"\n\nWrite the words in Arabic, in {dialect}. Not English.")
        heads = " ".join(g.get(head_key) or g.get("line") or "" for g in got)
        if arabic_share(heads) < 0.5:
            raise ValueError(f"the words came back in English twice; this client writes in {dialect}")
    new = iter(got)
    out = [dict(s["keep"]) if s.get("keep") else next(new) for s in slots]
    return out, strip_dashes(cta)[:60] if cta else ""


def write_scenes(b: dict, post: dict, look: str, words: list, have: str, frame: str,
                 others: list[str]) -> list[str]:
    """What each picture shows. The cheap model's job: it is description,
    not client copy, and the words are already fixed."""
    count = len(words)
    system = {"bold": SCENE_BOLD_SYSTEM, "showcase": SCENE_SHOWCASE_SYSTEM}.get(look, PROMPT_SYSTEM)
    lines = []
    for i, w in enumerate(words, 1):
        said = " / ".join(looks.slide_lines(w)) if w else ""
        lines.append(f"slide {i}: {said or '(no words)'}")
    context = ("\n\nTHE POST'S OTHER SLIDES ALREADY SHOW:\n- " + "\n- ".join(others[:9])
               + "\nThis belongs to the same shoot and must not repeat any of them.") if others else ""
    answer = deepseek(
        system,
        f"{brief(b)}\n\nTHE CLIENT'S OWN PHOTOGRAPHS AVAILABLE TO COMPOSITE:\n{have}"
        f"\n\nPILLAR: {post.get('pillar')}\nTOPIC: {post.get('topic')}\n"
        f"CAPTION DIRECTION: {post.get('caption_direction')}\n"
        f"FRAME: {frame}. Compose every picture for exactly this shape.\n"
        f"THE WORDS OF EACH SLIDE:\n" + "\n".join(lines) + context
        + f"\n\nReturn exactly {count} prompt(s).",
    )
    parsed = only_json(answer)
    prompts = parsed.get("prompts") if isinstance(parsed, dict) else parsed
    if not isinstance(prompts, list) or not prompts:
        raise ValueError("the model returned no picture descriptions")
    prompts = [strip_codes(str(p).strip()) for p in prompts if str(p).strip()][:count]
    if len(prompts) < count:
        raise ValueError(f"asked for {count} picture descriptions, got {len(prompts)}")
    return prompts


def draw_slot(sb: Store, b: dict, post_id: str, look: str, words: dict | None, scene: str,
              refs: list[str], draw_as: str, size: tuple[int, int], *, n: int,
              anchor: str | None, cta: str) -> dict:
    """One picture of the post, in the client's look, as the item stored."""
    use_refs = ([anchor] if anchor else []) + [r for r in refs if r != anchor]
    if look == "bold" and words:
        prompt = looks.bold_prompt(scene, words, client_line=client_line(b), handle=handle_of(b),
                                   cover_anchor=bool(anchor), role="cover" if n == 1 else "slide")
        best: tuple[bytes, dict] | None = None
        for attempt in (1, 2):
            jpeg = fit_jpeg(hf_image(prompt, use_refs, aspect=draw_as), size)
            check = read_back(jpeg, words)
            best = (jpeg, check)
            if check.get("ok") is not False:
                break
            note(f"  {post_id} slide {n}: the words read back wrong "
                 f"({', '.join(check.get('missing') or [])})"
                 + (", drawing it once more" if attempt == 1 else ", kept and flagged"))
        jpeg, check = best  # type: ignore[misc]
        return {"kind": "image", "url": keep_image(sb, jpeg, post_id, n), "source": "ai",
                "look": "bold", "words": words, "readback": check}
    if look == "showcase":
        clean = fit_jpeg(hf_image(looks.showcase_prompt(scene, cover_anchor=bool(anchor)),
                                  use_refs, aspect=draw_as), size)
        clean_url = keep_image(sb, clean, post_id, f"{n}-clean")
        item = {"kind": "image", "url": clean_url, "source": "ai", "look": "showcase",
                "clean": clean_url}
        if words:
            full = dict(words)
            if cta and not full.get("cta"):
                full["cta"] = cta
            if handle_of(b) and not full.get("handle"):
                full["handle"] = handle_of(b)
            layer = looks.render_layer(full, size, backdrop=clean)
            item.update(words=full, layer=keep_named(sb, layer, post_id, f"{n}-words", "png"),
                        url=keep_image(sb, looks.compose(clean, layer, size), post_id, n))
        return item
    jpeg = fit_jpeg(hf_image(scene, refs, aspect=draw_as), size)
    return {"kind": "image", "url": keep_image(sb, jpeg, post_id, n), "source": "ai"}


def do_generate(sb: Store, job: dict) -> dict:
    """The AI pictures on a post: all of them, one again, or one more.

    `params.index` redraws the picture at that place in the post,
    `params.add` puts one more on the end, and neither redraws every AI
    picture the post has (or draws its slides, the first time). Uploaded
    items are never touched: they are somebody's own work, and "New
    picture" must not quietly throw a client's photo away.

    The frontier model writes the words (client copy), DeepSeek describes
    the pictures around them, Higgsfield draws them. The cover is drawn
    first and every other slide takes its look from it, so a carousel
    reads as one piece. Words a person fixed on a slide are kept.
    """
    post_id = str(job.get("post_id") or "")
    params = job.get("params") or {}
    found = sb.get(f"social_posts?select=*&id=eq.{urllib.parse.quote(post_id)}&limit=1")
    if not found:
        raise ValueError("that post is gone")
    post = found[0]
    client_task_id = str(post.get("client_task_id"))
    b = brand_of(sb, client_task_id)
    look = looks.look_of(b["social"])

    media = list(post.get("media") or [])
    drawn = [m for m in media if m.get("source") == "ai"]
    index = params.get("index")
    add = bool(params.get("add"))
    target = ""
    if index is not None:
        index = int(index)
        if index >= len(media) or media[index].get("source") != "ai":
            raise ValueError("there is no AI picture at that place to draw again")
        target = str(media[index].get("url"))
        slots = [{"n": index + 1, "keep": media[index].get("words")}]
    elif add:
        if len(media) >= 10:
            raise ValueError("the post already has ten items, the most Instagram takes")
        slots = [{"n": len(media) + 1, "keep": None}]
    else:
        own = len(media) - len(drawn)
        count = max(1, min(10, len(drawn) or max(1, int(post.get("slides") or 1) - own)))
        at = [i for i, m in enumerate(media) if m.get("source") == "ai"]
        slots = [{"n": i + 1, "keep": media[i].get("words")} for i in at][:count]
        while len(slots) < count:
            slots.append({"n": len(media) + len(slots) - len(at) + 1, "keep": None})
    total = max([len(media)] + [s["n"] for s in slots])
    for s in slots:
        s["of"] = total

    assets = sb.get(
        f"social_assets?select=kind,caption,url,path&client_task_id="
        f"{urllib.parse.quote('eq.' + client_task_id)}&active=is.true&limit=20"
    )
    have = ", ".join(
        f"{a.get('kind')}: {a.get('caption') or a.get('url') or a.get('path')}"
        for a in assets
    ) or "none on file"
    aspect = str(post.get("aspect") or ASPECT)
    draw_as, size, frame = SHAPES.get(aspect, SHAPES[ASPECT])

    words: list = [None] * len(slots)
    cta = ""
    if look != "plain":
        words, cta = write_words(b, post, look, slots)
    single = index is not None or add
    others = [str(x) for x in (post.get("prompts") or []) if str(x).strip()] if single else []
    scenes = write_scenes(b, post, look, words, have, frame, others)

    refs = [str(u) for u in (post.get("refs") or [])][:6]
    # The cover is Image 1 for every other slide. When only a later slide
    # is drawn, the post's own cover is the anchor.
    cover = media[0] if media and media[0].get("source") == "ai" else None
    anchor = None
    if cover and look != "plain" and not (index == 0):
        anchor = cover.get("clean") or cover.get("url") if look == "showcase" else cover.get("url")
    items: list[dict] = []
    for k, s in enumerate(slots):
        try:
            item = draw_slot(sb, b, post_id, look, words[k], scenes[k], refs, draw_as, size,
                             n=s["n"], anchor=None if s["n"] == 1 else anchor, cta=cta)
        except NoCredits:
            # Whatever was drawn before the credits ran out is kept, so
            # topping up and running again costs only the rest.
            if items:
                place_drawn(sb, post_id, items, scenes, index=index, target=target, add=add,
                            done=False)
            raise
        items.append(item)
        if s["n"] == 1 and look != "plain":
            anchor = item.get("clean") or item.get("url") if look == "showcase" else item.get("url")
    place_drawn(sb, post_id, items, scenes, index=index, target=target, add=add, done=True)
    flagged = [s["n"] for s, it in zip(slots, items) if (it.get("readback") or {}).get("ok") is False]
    return {"post": post_id, "look": look, "prompts": len(scenes), "images": len(items),
            "references": len(refs), "aspect": aspect, "words_flagged": flagged,
            "mode": "one" if index is not None else "add" if add else "all"}


def place_drawn(sb: Store, post_id: str, images: list, prompts: list[str], *,
                index, target: str, add: bool, done: bool) -> None:
    """Put freshly drawn pictures where they belong on the post.

    Read the post again first: a picture takes minutes, and somebody may
    have uploaded, removed or reordered items meanwhile. Writing back the
    list read at the start would undo what they did. `images` are the new
    items (or bare links, from before items carried words).
    """
    new_items = [x if isinstance(x, dict) else {"kind": "image", "url": x, "source": "ai"}
                 for x in images]
    q = urllib.parse.quote(post_id)
    fresh = sb.get(f"social_posts?select=media,prompts&id=eq.{q}&limit=1")
    if not fresh:
        return
    items = list(fresh[0].get("media") or [])
    body: dict = {"updated_at": now()}
    if index is not None:
        at = next((i for i, m in enumerate(items) if m.get("url") == target), None)
        if at is not None and new_items:
            items[at] = new_items[0]
    elif add:
        if new_items and len(items) < 10:
            items.append(new_items[0])
            body["prompts"] = list(fresh[0].get("prompts") or []) + prompts[:1]
    else:
        # In place: a drawn picture replaces the drawn picture at its spot,
        # so a carousel somebody arranged around their own photos keeps its
        # order. Old ones with no replacement yet stay until there is one.
        new = iter(new_items)
        out = []
        for m in items:
            if m.get("source") == "ai":
                out.append(next(new, None) or m)
            else:
                out.append(m)
        out.extend(new)
        items = out[:10]
        body["prompts"] = prompts
    body["media"] = items
    body["images"] = [m["url"] for m in items if m.get("kind") == "image"]
    if done:
        body["status"] = "generated" if items else "generating"
    sb.patch(f"social_posts?id=eq.{q}", body)


def replace_item(sb: Store, post_id: str, old_url: str, new: dict) -> bool:
    """Swap one item for another, found by its link in the post as it is now."""
    q = urllib.parse.quote(post_id)
    fresh = sb.get(f"social_posts?select=media&id=eq.{q}&limit=1")
    items = list(fresh[0].get("media") or []) if fresh else []
    at = next((i for i, m in enumerate(items) if m.get("url") == old_url), None)
    if at is None:
        return False
    items[at] = new
    sb.patch(f"social_posts?id=eq.{q}", {
        "media": items, "images": [m["url"] for m in items if m.get("kind") == "image"],
        "updated_at": now()})
    return True


def do_words(sb: Store, job: dict) -> dict:
    """Set the words on one picture, or write them first (`params.write`).

    The showcase look's type over the picture without words: a typo fixed
    by a person is set again here in a second, with no drawing. A bold
    picture has its words drawn in, so new words there mean drawing that
    slide again. An upload is never redrawn: its words are always set in
    type, because a client's own photo is not the model's to repaint.
    """
    post_id = str(job.get("post_id") or "")
    params = job.get("params") or {}
    index = int(params.get("index") or 0)
    found = sb.get(f"social_posts?select=*&id=eq.{urllib.parse.quote(post_id)}&limit=1")
    if not found:
        raise ValueError("that post is gone")
    post = found[0]
    media = list(post.get("media") or [])
    if index >= len(media) or media[index].get("kind") != "image":
        raise ValueError("there is no picture at that place to put words on")
    item = media[index]
    b = brand_of(sb, str(post.get("client_task_id")))
    if item.get("source") == "ai" and item.get("look") == "bold":
        return do_generate(sb, {**job, "kind": "generate", "params": {"index": index}})
    _, size, _ = SHAPES.get(str(post.get("aspect") or ASPECT), SHAPES[ASPECT])
    words = dict(item.get("words") or {})
    if params.get("write") or not looks.slide_lines(words):
        got, cta = write_words(b, post, "showcase", [{"n": index + 1, "of": len(media), "keep": None}])
        words = {**got[0], **({"cta": cta} if cta else {})}
    if handle_of(b) and not words.get("handle"):
        words["handle"] = handle_of(b)
    words = looks.clean_words(words, "showcase")
    clean_url = str(item.get("clean") or item["url"])
    clean = fetch_bytes(clean_url)
    layer = looks.render_layer(words, size, backdrop=clean)
    new = {**item, "clean": clean_url, "words": words, "look": "showcase",
           "layer": keep_named(sb, layer, post_id, f"{index + 1}-words", "png"),
           "url": keep_image(sb, looks.compose(clean, layer, size), post_id, f"{index + 1}-w")}
    new.pop("readback", None)
    placed = replace_item(sb, post_id, str(item["url"]), new)
    return {"post": post_id, "index": index, "words": looks.slide_lines(words), "placed": placed}


def plan_shot(b: dict, post: dict, index: int) -> dict:
    """The camera move, the natural motion and maybe a person, for this picture."""
    prompts = [str(x) for x in (post.get("prompts") or [])]
    scene = prompts[index] if index < len(prompts) else ""
    try:
        parsed = only_json(deepseek(
            MOTION_SYSTEM,
            f"{brief(b)[:1500]}\n\nTOPIC: {post.get('topic')}\nTHE PICTURE: {scene or post.get('topic')}",
            max_tokens=400))
    except Exception:  # noqa: BLE001 - a gentle dolly-in is always a fair shot
        parsed = {}
    shot = {k: str((parsed or {}).get(k) or "")[:300] for k in ("camera", "motion", "person")}
    return shot


def do_motion(sb: Store, job: dict) -> dict:
    """A picture on the post, moving a little.

    Aziz, 2026-09-24: "turning an image to video in just a moving fashion
    ... without changing the text", then "zoom in a bit or move around ...
    maybe a person walking". Kling animates the picture WITHOUT its words;
    the words go back on top as a still layer, so no camera move can bend a
    letter. One picture alone becomes a Reel at 9:16 (an AI picture is
    recomposed tall first; a client's own photo is padded on a blur of
    itself, never invented around). In a carousel it keeps the post's shape.
    """
    import shutil
    import subprocess
    import tempfile
    from pathlib import Path

    post_id = str(job.get("post_id") or "")
    index = int((job.get("params") or {}).get("index") or 0)
    found = sb.get(f"social_posts?select=*&id=eq.{urllib.parse.quote(post_id)}&limit=1")
    if not found:
        raise ValueError("that post is gone")
    post = found[0]
    media = list(post.get("media") or [])
    if index >= len(media) or media[index].get("kind") != "image":
        raise ValueError("only a picture can be made to move")
    item = media[index]
    if item.get("look") == "bold" and item.get("words"):
        raise ValueError(
            "The words on this picture are drawn into it, so it cannot move without bending them. "
            "Move a picture from the project look, or one without words.")
    b = brand_of(sb, str(post.get("client_task_id")))
    reel = len(media) == 1
    aspect = str(post.get("aspect") or ASPECT)
    size = REEL_COVER if reel else SHAPES.get(aspect, SHAPES[ASPECT])[1]
    source = str(item.get("clean") or item["url"])
    pad = False
    backdrop: bytes | None = None
    if reel and item.get("source") == "ai":
        backdrop = fit_jpeg(hf_image(RECOMPOSE_PROMPT, [source], aspect="9:16"), size)
        source = keep_image(sb, backdrop, post_id, f"{index + 1}-tall")
    elif reel:
        pad = True
    shot = plan_shot(b, post, index)
    video = hf_api_video(looks.motion_prompt(shot), source)
    words = item.get("words") or None
    work = Path(tempfile.mkdtemp(prefix="salma-motion-"))
    try:
        (work / "in.mp4").write_bytes(video)
        layer = None
        if words:
            if backdrop is None:
                backdrop = fetch_bytes(source)
            (work / "words.png").write_bytes(looks.render_layer(words, size, backdrop=backdrop))
            layer = str(work / "words.png")
        out = work / "out.mp4"
        res = subprocess.run(looks.ffmpeg_args(str(work / "in.mp4"), layer, str(out), size, pad=pad),
                             capture_output=True, text=True, timeout=600, check=False)
        if res.returncode != 0 or not out.exists():
            raise RuntimeError(f"ffmpeg could not put the video together: {res.stderr.strip()[-240:]}")
        cover = work / "cover.jpg"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "0.2", "-i", str(out), "-frames:v", "1",
                        "-q:v", "2", str(cover)], capture_output=True, timeout=120, check=True)
        mp4_url = keep_named(sb, out.read_bytes(), post_id, f"{index + 1}-moving", "mp4")
        cover_url = keep_image(sb, as_jpeg(cover.read_bytes()), post_id, f"{index + 1}-cover")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    new = {"kind": "video", "url": mp4_url, "source": "ai", "cover": cover_url,
           "from": str(item["url"]), "clean": source, "motion": shot}
    if words:
        new.update(words=words, look=item.get("look") or "showcase")
    placed = replace_item(sb, post_id, str(item["url"]), new)
    return {"post": post_id, "index": index, "reel": reel, "shot": shot, "placed": placed}



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


COVER_PROMPT = """This is a PHOTO COMPOSITING task, not an image generation task.
The reference is a frame from the client's own video. Treat everything in it
as a fixed photographic asset: every person, face, building, room, product
and material stays exactly as filmed. Do not redraw, restyle, retouch,
smooth or replace any of it. A face that is not the real person's is how a
client is lost.

Make a vertical 9:16 cover for the video from that frame: reframe it to fill
the tall frame, add a soft dark gradient behind the text so it reads, and
set this headline in the upper middle of the frame, centred, in a heavy
clean sans serif, white, letter accurate{rtl}. Keep the headline well clear
of the top and bottom fifth of the frame: the profile grid crops those away.
{headline}

No other text, no logos, no borders, no watermarks, no punctuation marks."""

HEADLINE_SYSTEM = """You write the cover headline for a client's short video.
At most six words. A hook that makes somebody stop scrolling, about what the
video actually shows or says. No punctuation, no emoji, no hashtags, nothing
the brief or the transcript does not support.
Return JSON only: {"headline":"..."}"""


def video_duration(path) -> float:
    import subprocess

    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, timeout=60, check=False,
    )
    try:
        return float(out.stdout.strip() or 0)
    except ValueError:
        return 0.0


def sharpness(path) -> float:
    """How much edge detail a frame has: motion blur and fades score low."""
    from PIL import Image, ImageFilter, ImageStat

    img = Image.open(path).convert("L")
    w, h = img.size
    img = img.resize((320, max(1, int(320 * h / max(1, w)))))
    return float(ImageStat.Stat(img.filter(ImageFilter.FIND_EDGES)).var[0])


def do_cover(sb: Store, job: dict) -> dict:
    """A cover for one of the post's videos, made from its sharpest frame."""
    import shutil
    import tempfile
    from pathlib import Path

    from radar.posting import prepare

    post_id = str(job.get("post_id") or "")
    index = int((job.get("params") or {}).get("index") or 0)
    found = sb.get(f"social_posts?select=*&id=eq.{urllib.parse.quote(post_id)}&limit=1")
    if not found:
        raise ValueError("that post is gone")
    post = found[0]
    media = list(post.get("media") or [])
    if index >= len(media) or media[index].get("kind") != "video":
        raise ValueError("there is no video at that place in the post")

    workdir = Path(tempfile.mkdtemp(prefix="salma-cover-"))
    try:
        video = download(str(media[index]["url"]), workdir / "video")
        frames = []
        for i, ts in enumerate(prepare.frame_times(video_duration(video), 6)):
            out = workdir / f"frame-{i}.jpg"
            if prepare.grab(video, ts, out, max_w=1440):
                frames.append(out)
        if not frames:
            raise ValueError("no frame could be read from that video")
        frame = max(frames, key=sharpness)

        b = brand_of(sb, str(post.get("client_task_id")))
        dialect = str(b["social"].get("dialect") or "")
        spoken = post_transcript(sb, post)
        # Client copy on the client's own account, often Arabic: frontier,
        # like the captions, never the cheap model.
        answer, _ = frontier(
            HEADLINE_SYSTEM,
            f"{brief(b)}\n\nDIALECT: {dialect or 'the brand language'}\n"
            f"TOPIC: {post.get('topic')}"
            + (f"\nWHAT IS SAID: {spoken[:3000]}" if spoken else ""),
            max_tokens=300,
        )
        parsed = only_json(answer)
        headline = strip_codes(strip_dashes(str(parsed.get("headline") or ""))).strip()
        headline = re.sub(r"[.,!?؟،:;\"'«»()]", "", headline)[:60]
        if not headline:
            raise ValueError("no headline came back for the cover")

        rtl = ", as perfectly connected right to left Arabic script" if wants_arabic(dialect) else ""
        # The frame goes up to our own bucket first: the API reads its
        # references from links, and the CLI fetches the same link.
        frame_url = keep_image(sb, as_jpeg(frame.read_bytes()), post_id, f"frame-{index}")
        blob = fit_jpeg(
            hf_image(COVER_PROMPT.format(headline=headline, rtl=rtl),
                     [frame_url], aspect="9:16"),
            REEL_COVER,
        )
        url = keep_image(sb, blob, post_id, f"cover-{index}")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    # Read the post again: someone may have moved or removed items while
    # the cover was drawing. The cover follows its video to wherever it is
    # now, and a video taken off the post meanwhile gets nothing.
    fresh = sb.get(f"social_posts?select=media&id=eq.{urllib.parse.quote(post_id)}&limit=1")
    items = list(fresh[0].get("media") or []) if fresh else []
    at = next((i for i, m in enumerate(items) if m.get("url") == media[index]["url"]), None)
    if at is not None:
        items[at] = {**items[at], "cover": url}
        sb.patch(f"social_posts?id=eq.{urllib.parse.quote(post_id)}",
                 {"media": items, "updated_at": now()})
    return {"post": post_id, "index": index, "headline": headline,
            "placed": at is not None}


# ---------------------------------------------------------------------------
# The accounts clients post from.
#
# The ads system token ("Claude", META_ACCESS_TOKEN) manages the client
# Pages and the Instagram accounts linked to them. This keeps that list in
# social_meta_pages, where Settings offers it, with one fact beside each
# Page that names its owner better than any spelling: which clients' ad
# accounts advertise with it. The link itself is always a person's choice.

GRAPH = "https://graph.facebook.com/v21.0"


def graph_get(path: str, token: str | None = None, **params) -> dict:
    token = token or os.environ.get("META_ACCESS_TOKEN")
    if not token:
        raise RuntimeError("META_ACCESS_TOKEN is not set, so Meta cannot be reached")
    q = urllib.parse.urlencode({**params, "access_token": token})
    req = urllib.request.Request(f"{GRAPH}/{path}?{q}", headers={"User-Agent": "Mahara social desk"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        # Meta's own sentence, never the URL: the URL carries the token.
        try:
            why = json.load(e).get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001
            why = ""
        raise RuntimeError(f"Meta refused {path.split('?')[0]}: {why or e.code}") from None


def graph_post(path: str, token: str | None = None, **params) -> dict:
    token = token or os.environ.get("META_ACCESS_TOKEN")
    if not token:
        raise RuntimeError("META_ACCESS_TOKEN is not set, so Meta cannot be reached")
    data = urllib.parse.urlencode({**params, "access_token": token}).encode()
    req = urllib.request.Request(f"{GRAPH}/{path}", data=data, method="POST",
                                 headers={"User-Agent": "Mahara social desk"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            why = json.load(e).get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001
            why = ""
        raise RuntimeError(f"Meta refused {path.split('/')[-1]}: {why or e.code}") from None


def graph_all(path: str, **params) -> list[dict]:
    out: list[dict] = []
    data = graph_get(path, **params)
    while True:
        out += data.get("data") or []
        nxt = (data.get("paging") or {}).get("next")
        if not nxt or len(out) >= 2000:
            return out
        with urllib.request.urlopen(nxt, timeout=60) as r:
            data = json.load(r)


def plain(name) -> str:
    return re.sub(r"\s+", " ", str(name or "")).strip().lower()


def do_accounts(sb: Store, job: dict) -> dict:
    """Refresh the Pages and Instagram accounts the ads token can post to."""
    started = now()
    pages = graph_all(
        "me/accounts",
        fields="id,name,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
        limit=100,
    )
    ad_accounts = graph_all("me/adaccounts", fields="id,name", limit=200)
    by_name: dict[str, str] = {}
    for a in ad_accounts:
        by_name.setdefault(plain(a.get("name")), str(a["id"]))

    # ClickUp client -> ad account (by name, as GoHighLevel's sync keeps it)
    # -> the Pages that ad account advertises with.
    clients = sb.get(
        "ghl_clients?select=clickup_id,meta_ad_account"
        "&meta_ad_account=not.is.null&clickup_id=not.is.null&limit=500"
    )
    advertised: dict[str, set[str]] = {}
    matched = 0
    for c in clients:
        act = by_name.get(plain(c.get("meta_ad_account")))
        if not act:
            continue
        matched += 1
        try:
            for pg in graph_all(f"{act}/promote_pages", fields="id", limit=100):
                advertised.setdefault(str(pg["id"]), set()).add(str(c["clickup_id"]))
        except Exception as e:  # noqa: BLE001 - one closed ad account must not stop the list
            note(f"  could not read the Pages one ad account promotes: {str(e)[:120]}")

    rows = []
    for pg in pages:
        ig = pg.get("instagram_business_account") or {}
        rows.append({
            "page_id": str(pg["id"]),
            "name": str(pg.get("name") or pg["id"]),
            "picture_url": ((pg.get("picture") or {}).get("data") or {}).get("url"),
            "ig_user_id": ig.get("id"),
            "ig_username": ig.get("username"),
            "ig_name": ig.get("name"),
            "ig_picture_url": ig.get("profile_picture_url"),
            "ad_clients": sorted(advertised.get(str(pg["id"]), set())),
            "seen_at": started,
        })
    if not rows:
        raise RuntimeError("Meta returned no Pages for the ads token; nothing was changed")
    sb.post("social_meta_pages?on_conflict=page_id", rows,
            prefer="resolution=merge-duplicates,return=minimal")
    # A Page the token no longer manages is never offered again.
    sb._call("DELETE", f"social_meta_pages?seen_at=lt.{urllib.parse.quote(started)}",
             None, "return=minimal")
    return {
        "pages": len(rows),
        "with_instagram": sum(1 for r in rows if r["ig_user_id"]),
        "ad_accounts": len(ad_accounts),
        "clients_matched_to_ad_accounts": matched,
        "pages_with_a_client": sum(1 for r in rows if r["ad_clients"]),
    }


def queue_daily_accounts(sb: Store) -> None:
    """Once a day, and never in a loop when Meta is refusing."""
    latest = sb.get("social_meta_pages?select=seen_at&order=seen_at.desc&limit=1")
    if latest:
        from datetime import datetime, timedelta

        seen = datetime.fromisoformat(str(latest[0]["seen_at"]).replace("Z", "+00:00"))
        if datetime.now(timezone.utc) - seen < timedelta(hours=20):
            return
    job = sb.get("social_jobs?select=status,updated_at&id=eq.accounts&limit=1")
    if job:
        from datetime import datetime, timedelta

        st = str(job[0].get("status"))
        at = datetime.fromisoformat(str(job[0]["updated_at"]).replace("Z", "+00:00"))
        if st in ("queued", "running"):
            return
        if st == "failed" and datetime.now(timezone.utc) - at < timedelta(hours=6):
            return
    sb.post("social_jobs?on_conflict=id", [{
        "id": "accounts", "kind": "accounts", "params": {}, "status": "queued",
        "attempts": 0, "error": None, "result": None, "requested_by": "salma-daily",
        "updated_at": now(),
    }], prefer="resolution=merge-duplicates,return=minimal")


# ---------------------------------------------------------------------------
# Posting.
#
# Aziz, 2026-09-23: nothing posts until a client is sold and switched on. A
# client posts only when `publishing` is on, and only posts due after the
# moment it was switched on, so turning a client on never sends last week's
# posts. SOCIAL_PUBLISHING=off in the environment stops every client at once.
#
# What goes out is what was approved: a client who must sign off gets only
# posts with client_status 'approved' (a trigger resets that the moment a
# post is edited), a client who does not gets any finished post.

API_SHAPES = ("1:1", "4:5", "1.91:1")  # what Meta's publishing API takes


def publish_decision(post: dict, client: dict | None, now_iso: str) -> tuple[bool, str]:
    """Whether a post goes out now, and in words why not when it cannot.

    An empty reason means "not yet, and nothing to say" (not due, client not
    switched on); a sentence is shown on the post.
    """
    if not client or not client.get("active") or not client.get("publishing"):
        return False, ""
    due = str(post.get("scheduled_at") or "")
    if not due or due[:19] > now_iso[:19]:
        return False, ""
    since = str(client.get("publishing_since") or "")
    if since and due[:19] < since[:19]:
        return False, ""
    items = post.get("media") or [{"kind": "image", "url": u} for u in (post.get("images") or [])]
    if not items or not str(post.get("caption") or "").strip():
        return False, "Not finished: it has no pictures or no caption, so it did not go out."
    if not client.get("auto_approve") and post.get("client_status") != "approved":
        return False, "The client has not approved it, so it did not go out."
    return True, ""


def targets_of(post: dict, client: dict) -> tuple[list[str], list[str]]:
    """The platforms it goes to, and a sentence for each that it cannot."""
    wanted = [p for p in (post.get("platforms") or client.get("platforms") or ["instagram", "facebook"])
              if p in (client.get("platforms") or ["instagram", "facebook"])]
    go, why = [], []
    if "instagram" in wanted:
        if not client.get("ig_user_id"):
            why.append("Instagram: the client's Page has no Instagram account linked.")
        elif (post.get("aspect") or ASPECT) not in API_SHAPES and not reel_of(post):
            why.append("Instagram: 3:4 goes out by hand, Meta's publishing refuses it.")
        else:
            go.append("instagram")
    if "facebook" in wanted:
        if not client.get("fb_page_id"):
            why.append("Facebook: the client is not linked to a Page.")
        else:
            go.append("facebook")
    return go, why


def items_of(post: dict) -> list[dict]:
    return post.get("media") or [{"kind": "image", "url": u, "source": "ai"} for u in (post.get("images") or [])]


def reel_of(post: dict) -> bool:
    items = items_of(post)
    return len(items) == 1 and items[0].get("kind") == "video"


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mahara social desk"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


class Prepared:
    """Pictures made ready once per post, shared by both platforms."""

    def __init__(self, sb: Store, post: dict):
        self.sb, self.post, self.urls = sb, post, {}

    def image(self, n: int, url: str) -> str:
        if n not in self.urls:
            _, size, _ = SHAPES.get(self.post.get("aspect") or ASPECT, SHAPES[ASPECT])
            self.urls[n] = keep_image(self.sb, fit_jpeg(fetch_bytes(url), size),
                                      str(self.post["id"]), f"out-{n}")
        return self.urls[n]


def ig_wait(container: str, minutes: int = 10) -> None:
    """Instagram processes a container (a video can take minutes) before it posts."""
    deadline = time.time() + minutes * 60
    while True:
        st = graph_get(container, fields="status_code,status")
        code = str(st.get("status_code") or "")
        if code == "FINISHED":
            return
        if code in ("ERROR", "EXPIRED"):
            raise RuntimeError(f"Instagram could not take it: {st.get('status') or code}")
        if time.time() > deadline:
            raise RuntimeError("Instagram was still processing it after ten minutes")
        time.sleep(6)


def ig_publish(prep: Prepared, client: dict) -> dict:
    post, ig = prep.post, str(client["ig_user_id"])
    items = items_of(post)[:10]
    caption = str(post.get("caption") or "").strip()[:2200]
    if len(items) == 1:
        it = items[0]
        if it.get("kind") == "video":
            params = {"media_type": "REELS", "video_url": it["url"], "caption": caption,
                      "share_to_feed": "true"}
            if it.get("cover"):
                params["cover_url"] = it["cover"]
        else:
            params = {"image_url": prep.image(0, it["url"]), "caption": caption}
        container = graph_post(f"{ig}/media", **params)["id"]
    else:
        children = []
        for n, it in enumerate(items):
            if it.get("kind") == "video":
                c = graph_post(f"{ig}/media", media_type="VIDEO", video_url=it["url"],
                               is_carousel_item="true")
            else:
                c = graph_post(f"{ig}/media", image_url=prep.image(n, it["url"]),
                               is_carousel_item="true")
            children.append(str(c["id"]))
        for c in children:
            ig_wait(c)
        container = graph_post(f"{ig}/media", media_type="CAROUSEL",
                               children=",".join(children), caption=caption)["id"]
    ig_wait(str(container))
    media_id = str(graph_post(f"{ig}/media_publish", creation_id=container)["id"])
    try:
        permalink = graph_get(media_id, fields="permalink").get("permalink")
    except Exception:  # noqa: BLE001 - posted is what matters
        permalink = None
    return {"id": media_id, "permalink": permalink, "at": now()}


def page_token(page_id: str) -> str:
    tok = graph_get(page_id, fields="access_token").get("access_token")
    if not tok:
        raise RuntimeError(
            "Meta gave no Page token. Add pages_manage_posts to the Claude system user "
            "in Business Manager, then it posts to Facebook too."
        )
    return str(tok)


def fb_publish(prep: Prepared, client: dict) -> dict:
    post, page = prep.post, str(client["fb_page_id"])
    tok = page_token(page)
    items = items_of(post)[:10]
    text = str(post.get("caption_facebook") or post.get("caption") or "").strip()[:5000]
    images = [(n, it) for n, it in enumerate(items) if it.get("kind") != "video"]
    videos = [it for it in items if it.get("kind") == "video"]
    if videos and (images or len(videos) > 1):
        raise RuntimeError(
            "Facebook takes photos or one video in a post, not both; this one went out on Instagram only."
        )
    if videos:
        out = graph_post(f"{page}/videos", token=tok, file_url=videos[0]["url"], description=text)
    elif len(images) == 1:
        n, it = images[0]
        out = graph_post(f"{page}/photos", token=tok, url=prep.image(n, it["url"]), message=text)
    else:
        ids = [graph_post(f"{page}/photos", token=tok, url=prep.image(n, it["url"]),
                          published="false")["id"] for n, it in images]
        out = graph_post(f"{page}/feed", token=tok, message=text,
                         attached_media=json.dumps([{"media_fbid": i} for i in ids]))
    return {"id": str(out.get("post_id") or out.get("id")), "at": now()}


def publish_post(sb: Store, post: dict, client: dict) -> dict:
    """Post it everywhere it goes. Each platform is recorded the moment it
    succeeds, so a retry never posts the same thing twice."""
    q = urllib.parse.quote(str(post["id"]))
    done = dict(post.get("published") or {})
    go, errors = targets_of(post, client)
    prep = Prepared(sb, post)
    for platform in go:
        if platform in done:
            continue
        try:
            done[platform] = (ig_publish if platform == "instagram" else fb_publish)(prep, client)
            sb.patch(f"social_posts?id=eq.{q}", {"published": done, "updated_at": now()})
            note(f"  posted {post['id']} to {platform}")
        except Exception as e:  # noqa: BLE001 - the other platform still goes
            errors.append(f"{platform.capitalize()}: {str(e)[:220]}")
    body: dict = {"published": done, "publish_error": " ".join(errors)[:600] or None,
                  "updated_at": now()}
    if errors:
        alert_once(sb, post, "failed:" + short_hash(body["publish_error"] or ""),
                   f"{who_posts(client)}'s post for {when_of(post)} did not go out: "
                   f"{body['publish_error']}")
    if done:
        body.update(status="published", published_at=now())
    elif errors:
        body["publish_attempts"] = int(post.get("publish_attempts") or 0) + 1
    sb.patch(f"social_posts?id=eq.{q}", body)
    return {"post": post["id"], "posted": sorted(done), "errors": errors}


def publishing_on() -> bool:
    return os.environ.get("SOCIAL_PUBLISHING", "on").strip().lower() not in ("off", "0", "false", "no")


def publish_due(sb: Store) -> None:
    """Post what is due for the clients switched on. A few a minute at most."""
    if not publishing_on():
        return
    clients = {str(c["client_task_id"]): c for c in
               sb.get("social_clients?select=*&publishing=is.true&active=is.true")}
    if not clients:
        return
    ids = ",".join(f'"{k}"' for k in clients)
    now_iso = now()
    due = sb.get(
        f"social_posts?select=*&client_task_id=in.({urllib.parse.quote(ids)})"
        f"&status=neq.published&scheduled_at=lte.{urllib.parse.quote(now_iso)}"
        "&publish_attempts=lt.3&order=scheduled_at.asc&limit=5"
    )
    for post in due:
        client = clients.get(str(post.get("client_task_id")))
        ok, why = publish_decision(post, client, now_iso)
        if not ok:
            if why and post.get("publish_error") != why:
                sb.patch(f"social_posts?id=eq.{urllib.parse.quote(str(post['id']))}",
                         {"publish_error": why, "updated_at": now()})
            if why:
                alert_once(sb, post, "due:" + short_hash(why),
                           f"{who_posts(client)}'s post for {when_of(post)} is due and did not go "
                           f"out: {why}")
            continue
        note(f"  {json.dumps(publish_post(sb, post, client))[:300]}")


CALENDAR_URL = "https://cockpit.maharamedia.com/creative/social"


def short_hash(text: str) -> str:
    import hashlib

    return hashlib.sha1(text.encode()).hexdigest()[:10]


def who_posts(client: dict | None) -> str:
    c = client or {}
    return str(c.get("ig_username") and "@" + str(c["ig_username"]) or c.get("fb_page_name")
               or c.get("client_task_id") or "A client")


def when_of(post: dict) -> str:
    raw = str(post.get("scheduled_at") or "")
    try:
        from datetime import timedelta

        at = datetime.fromisoformat(raw.replace("Z", "+00:00")) + timedelta(hours=3)
        return at.strftime("%a %d %b, %H:%M") + " Gulf time"
    except ValueError:
        return raw or "its day"


def slack_alert(text: str) -> bool:
    """One line to the team's Slack. Same bot as the review watcher; the
    channel is SOCIAL_SLACK_CHANNEL, or the health channel until one is set."""
    token = os.environ.get("SLACK_BOT_TOKEN")
    channel = os.environ.get("SOCIAL_SLACK_CHANNEL") or os.environ.get("SLACK_HEALTH_CHANNEL")
    if not token or not channel:
        note("no Slack token or channel for social alerts; the post shows it regardless")
        return False
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=json.dumps({"channel": channel, "text": text}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            out = json.load(r)
        if not out.get("ok"):
            note(f"slack refused the alert: {out.get('error')}")
        return bool(out.get("ok"))
    except Exception as e:  # noqa: BLE001 - the post carries the error anyway
        note(f"slack alert failed: {type(e).__name__}")
        return False


def alert_once(sb: Store, post: dict, key: str, text: str) -> None:
    """Tell the team once per post and reason, never every minute."""
    sent = dict(post.get("alerts") or {})
    if sent.get(key):
        return
    if slack_alert(f":warning: Social: {text}\n{CALENDAR_URL}"):
        sent[key] = now()
        post["alerts"] = sent
        sb.patch(f"social_posts?id=eq.{urllib.parse.quote(str(post['id']))}",
                 {"alerts": sent})


def heads_up_due(sb: Store) -> None:
    """Three hours before a post is due, say so if it will not go out, while
    there is still time to approve or finish it."""
    if not publishing_on():
        return
    from datetime import timedelta

    clients = {str(c["client_task_id"]): c for c in
               sb.get("social_clients?select=*&publishing=is.true&active=is.true")}
    if not clients:
        return
    ids = ",".join(f'"{k}"' for k in clients)
    soon = (datetime.now(timezone.utc) + timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
    upcoming = sb.get(
        f"social_posts?select=*&client_task_id=in.({urllib.parse.quote(ids)})"
        f"&status=neq.published&scheduled_at=gt.{urllib.parse.quote(now())}"
        f"&scheduled_at=lte.{urllib.parse.quote(soon)}&limit=50"
    )
    for post in upcoming:
        client = clients.get(str(post.get("client_task_id")))
        ok, why = publish_decision(post, client, str(post.get("scheduled_at")))
        if not ok and why:
            alert_once(sb, post, "soon:" + short_hash(why),
                       f"{who_posts(client)}'s post for {when_of(post)} will not go out as it is: "
                       f"{why}")


def results_due(sb: Store) -> None:
    """Bring the numbers back onto posts that went out in the last month."""
    from datetime import timedelta

    since = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    stale = (datetime.now(timezone.utc) - timedelta(hours=20)).strftime("%Y-%m-%dT%H:%M:%SZ")
    posts = sb.get(
        "social_posts?select=id,client_task_id,published,results&status=eq.published"
        f"&published_at=gte.{since}&or=(results_at.is.null,results_at.lt.{stale})&limit=10"
    )
    for post in posts:
        out = dict(post.get("results") or {})
        pub = post.get("published") or {}
        ig = (pub.get("instagram") or {}).get("id")
        if ig:
            try:
                basic = graph_get(ig, fields="like_count,comments_count")
                row = {"likes": basic.get("like_count"), "comments": basic.get("comments_count")}
                try:
                    ins = graph_get(f"{ig}/insights", metric="reach,saved,shares")
                    for m in ins.get("data") or []:
                        row[m.get("name")] = ((m.get("values") or [{}])[0]).get("value")
                except Exception:  # noqa: BLE001 - reach needs more rights than likes
                    pass
                out["instagram"] = row
            except Exception as e:  # noqa: BLE001
                note(f"  results for {post['id']} on Instagram: {str(e)[:120]}")
        sb.patch(f"social_posts?id=eq.{urllib.parse.quote(str(post['id']))}",
                 {"results": out, "results_at": now()})


def higgsfield_health() -> tuple[bool, str]:
    """Whether pictures can be drawn, asked rather than assumed."""
    paused = "Pictures and covers are paused: "
    if images_via() == "api":
        if not hf_key():
            return False, paused + "the server has no Higgsfield API key (HF_KEY)."
        # Free, and it checks the key: a wrong one is answered 401.
        try:
            code, _ = hf_api("GET", f"{HF_API}/models?size=1")
        except urllib.error.URLError as e:
            return False, paused + f"Higgsfield could not be reached ({type(e).__name__})."
        if code == 401:
            return False, paused + KEY_REFUSED
        if code >= 400:
            return False, paused + f"Higgsfield answered {code} when asked for its models."
        if wallet_state() == "empty":
            return False, paused + WALLET_EMPTY
        return True, ""

    import subprocess

    from radar.posting import higgsfield as hf

    # A credentials file on disk can hold a session Higgsfield has already
    # ended ("Session expired" on the first request, 2026-09-23), so the
    # check makes one free request of its own.
    ok, _ = hf.available()
    if not ok:
        return False, paused + "Higgsfield is signed out on the server. Sign it in again."
    res = subprocess.run([hf.cli_path() or "higgsfield", "account", "status"],
                         capture_output=True, text=True, timeout=60, check=False,
                         stdin=subprocess.DEVNULL)
    if res.returncode == 0:
        return True, ""
    said = next((ln.strip() for ln in (res.stdout + res.stderr).splitlines()
                 if ln.strip().lower().startswith("error")), "")
    return False, (paused + "Higgsfield refused the server's sign-in"
                   + (f" ({said[:100]})" if said else "") + ". Sign it in again.")


def health_checks() -> list[tuple[str, bool, str]]:
    """What this worker needs, checked, each with a sentence for the screen."""
    import shutil

    out = []
    ok, detail = higgsfield_health()
    out.append(("higgsfield", ok, detail))
    try:
        graph_get("me", fields="id")
        out.append(("meta", True, ""))
    except Exception as e:  # noqa: BLE001
        out.append(("meta", False, f"Meta is refusing the ads token, so nothing can post: {str(e)[:120]}"))
    frontier_ok = bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("OPENAI_API_KEY"))
    out.append(("captions", frontier_ok, "" if frontier_ok else
                "Captions are paused: the server has no ANTHROPIC_API_KEY or OPENAI_API_KEY."))
    ds = bool(os.environ.get("DEEPSEEK_API_KEY"))
    out.append(("planning", ds, "" if ds else
                "Filling the month is paused: the server has no DEEPSEEK_API_KEY."))
    fonts_ok, fonts_why = looks.fonts_ready()
    out.append(("words", fonts_ok, "" if fonts_ok else
                f"Words on project pictures are paused: {fonts_why}."))
    slack_ok = bool(os.environ.get("SLACK_BOT_TOKEN") and (
        os.environ.get("SOCIAL_SLACK_CHANNEL") or os.environ.get("SLACK_HEALTH_CHANNEL")))
    out.append(("alerts", slack_ok, "" if slack_ok else
                "A post that fails to go out only shows on the calendar: the server has no Slack "
                "token or channel for social alerts."))
    ff = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
    out.append(("video", ff, "" if ff else
                "Video covers and moving pictures are paused: ffmpeg is not installed on the server."))
    out.append(("publishing", publishing_on(), "" if publishing_on() else
                "Posting is stopped for every client (SOCIAL_PUBLISHING=off on the server)."))
    return out


def write_health(sb: Store) -> None:
    rows = [{"check_name": n, "ok": ok, "detail": d or None, "checked_at": now()}
            for n, ok, d in health_checks()]
    sb.post("social_worker_status?on_conflict=check_name", rows,
            prefer="resolution=merge-duplicates,return=minimal")


def doctor() -> int:
    bad = 0
    for n, ok, d in health_checks():
        print(f"{'ok  ' if ok else 'FAIL'} {n}{'' if ok else ': ' + d}")
        bad += 0 if ok else 1
    return 1 if bad else 0


def on_post(sb: Store, post_id: str, error: str | None, job_id: str = "") -> None:
    """Record a job's outcome where the calendar can see it.

    A success clears the post's error only when no other job on it has
    failed: a caption rewritten after the picture ran out of credits must
    not hide that the picture is still missing.
    """
    q = urllib.parse.quote(post_id)
    try:
        if error is None:
            still = sb.get(
                f"social_jobs?select=error&post_id=eq.{q}&status=eq.failed"
                f"&id=neq.{urllib.parse.quote(job_id)}&order=updated_at.desc&limit=1"
            )
            if still:
                error = re.sub(r"^[A-Za-z]+Error: ", "", str(still[0].get("error") or ""))[:300] or None
        sb.patch(f"social_posts?id=eq.{q}", {"error": error, "updated_at": now()})
    except Exception:  # noqa: BLE001 - the job result is already recorded
        pass


HANDLERS = {"fill": do_fill, "plan": do_plan, "caption": do_caption,
            "generate": do_generate, "cover": do_cover, "accounts": do_accounts,
            "words": do_words, "motion": do_motion}


def sweeps(sb: Store) -> None:
    """The work nobody queues: posting what is due, the numbers, the health
    rows. Each is fenced off, so one failing never stops the queue."""
    minute = datetime.now(timezone.utc).minute
    try:
        publish_due(sb)
    except Exception as e:  # noqa: BLE001
        note(f"posting sweep failed: {type(e).__name__}: {str(e)[:200]}")
    if minute % 15 == 0:
        try:
            results_due(sb)
        except Exception as e:  # noqa: BLE001
            note(f"results sweep failed: {type(e).__name__}: {str(e)[:200]}")
    if minute % 10 == 5:
        try:
            heads_up_due(sb)
        except Exception as e:  # noqa: BLE001
            note(f"heads-up sweep failed: {type(e).__name__}: {str(e)[:200]}")
    if minute % 10 == 0:
        try:
            write_health(sb)
        except Exception as e:  # noqa: BLE001
            note(f"health check failed: {type(e).__name__}: {str(e)[:200]}")


def main() -> int:
    if sys.argv[1:] == ["doctor"]:
        return doctor()
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    sb = Store()
    try:
        queue_daily_accounts(sb)
    except Exception as e:  # noqa: BLE001 - the queue below matters more
        note(f"could not check the Pages list's age: {type(e).__name__}")
    sweeps(sb)
    queued = sb.get(
        f"social_jobs?select=*&status=eq.queued&attempts=lt.{MAX_ATTEMPTS}"
        "&order=created_at.asc&limit=200"
    )
    # Fast work first. A month fill queues a caption and a picture for
    # every post at once; in arrival order each two-minute render would
    # hold up the next post's ten-second caption, and the calendar would
    # sit empty of words while the first image drew.
    speed = {"accounts": 0, "fill": 0, "plan": 1, "caption": 2, "words": 2, "cover": 3,
             "generate": 3, "motion": 4}
    queued.sort(key=lambda j: speed.get(str(j.get("kind")), 9))
    # Images take minutes each, so fewer of them per run; everything else
    # is quick enough to clear in one pass.
    jobs, renders = [], 0
    for j in queued:
        if str(j.get("kind")) in ("generate", "cover", "motion"):
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
                on_post(sb, str(job["post_id"]), None, jid)
        except Exception as e:  # noqa: BLE001 - one bad job must not stop the rest
            why = f"{type(e).__name__}: {e}"
            sb.failed(jid, why)
            failed += 1
            note(f"  {kind} {jid} FAILED: {why[:200]}")
            # On the post as well as the job. The calendar reads posts,
            # and a render that failed on credits otherwise sits on its
            # day as "drafting" forever with nobody told why.
            if job.get("post_id"):
                on_post(sb, str(job["post_id"]), str(e)[:300] or why[:300], jid)
    note(f"done {done}, failed {failed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
