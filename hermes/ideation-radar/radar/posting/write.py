"""The words: a YouTube title, an SEO description with chapters, tags, an
Instagram caption with hashtags and a thumbnail line, from the transcript,
in Aziz's own Kuwaiti voice, briefed with what is winning on the Mahara
board right now.

Arabic copy in his voice stays on a frontier model (Aziz, 2026-09-18);
DeepSeek is the last resort, not the first."""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Callable, Optional

from .. import http
from ..config import Config, key
from ..understand import gemini_generate, parse_json

FUNNEL = "https://funnel.maharamedia.com/"
VOICE_PATH = Path(__file__).with_name("voice.md")
# Sections of the voice rules that are about delivering edits, teleprompter
# layout and worked examples: true for scripts, noise for a caption prompt.
VOICE_SKIP = ("## 8.", "## 12.", "## 13.", "## Update log")

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "language": {"type": "string"},
        "yt_title_options": {"type": "array", "items": {"type": "string"}},
        "yt_description": {"type": "string"},
        "chapters": {"type": "array", "items": {"type": "object", "properties": {"at_sec": {"type": "number"}, "title": {"type": "string"}}, "required": ["at_sec", "title"]}},
        "yt_tags": {"type": "array", "items": {"type": "string"}},
        "ig_caption": {"type": "string"},
        "ig_hashtags": {"type": "array", "items": {"type": "string"}},
        "cover_graphic": {"type": "string"},
        "thumb_text_options": {"type": "array", "items": {"type": "string"}},
        "cover_lines": {"type": "array", "items": {"type": "string"}},
        "notes": {"type": "string"},
    },
    "required": ["language", "yt_title_options", "yt_description", "chapters", "yt_tags", "ig_caption", "ig_hashtags", "thumb_text_options"],
}

# An image post has no transcript: the caption is written from Aziz's brief.
POST_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "language": {"type": "string"},
        "ig_caption": {"type": "string"},
        "ig_hashtags": {"type": "array", "items": {"type": "string"}},
        "notes": {"type": "string"},
    },
    "required": ["language", "ig_caption", "ig_hashtags"],
}


def kind_of(post: dict[str, Any], duration: float = 0.0) -> str:
    """reel, video or post. A video kind is what the row says; an unmarked
    long clip counts as a video."""
    k = str(post.get("kind") or "").strip()
    if k in ("reel", "video", "post"):
        return k
    return "video" if duration >= 180 else "reel"


def voice_rules() -> str:
    try:
        text = VOICE_PATH.read_text(encoding="utf-8")
    except OSError:
        return ""
    out: list[str] = []
    skipping = False
    for line in text.splitlines():
        if line.startswith("## "):
            skipping = any(line.startswith(s) for s in VOICE_SKIP)
        if not skipping:
            out.append(line)
    return "\n".join(out).strip()


def mmss(sec: float) -> str:
    s = max(0, int(round(sec)))
    h, rem = divmod(s, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def transcript_lines(transcript: dict[str, Any], *, limit_chars: int = 24000) -> str:
    segs = transcript.get("segments") or []
    lines = []
    for s in segs:
        if not isinstance(s, dict) or not s.get("text"):
            continue
        st = s.get("start")
        stamp = mmss(float(st)) if isinstance(st, (int, float)) else "--:--"
        lines.append(f"[{stamp}] {s['text']}")
    text = "\n".join(lines) if lines else str(transcript.get("text") or "")
    return text[:limit_chars]


def outlier_lines(outliers: list[dict[str, Any]]) -> str:
    out = []
    for o in outliers[:12]:
        hook = (o.get("hook") or {}).get("text") if isinstance(o.get("hook"), dict) else None
        title = (o.get("caption") or "").split("\n")[0][:120]
        mult = o.get("multiplier")
        m = f"{float(mult):.1f}x" if isinstance(mult, (int, float)) else ""
        who = o.get("author_handle") or ""
        bits = [b for b in (m, f"@{who}" if who else "", title, f"hook: {hook}" if hook else "", f"({o.get('hook_kind')})" if o.get("hook_kind") else "") if b]
        out.append("- " + " ".join(bits))
    return "\n".join(out)


INTRO = "You write the packaging for Aziz Waheedi's own channels: YouTube @maharamedia (Arabic, Kuwaiti, business and marketing for founders in the Gulf) and Instagram @mahara_media. Aziz founded Mahara Media, the Kuwait agency that gets construction, design and fit-out companies their big projects."


def prompt_for(post: dict[str, Any], transcript: dict[str, Any], info: dict[str, Any], outliers: list[dict[str, Any]]) -> str:
    duration = float(info.get("duration_sec") or 0)
    kind = kind_of(post, duration)
    working = str(post.get("title_working") or "").strip()
    lang = str(transcript.get("language") or "").lower()
    arabic = lang.startswith("ar") or not lang
    voice = f"Write everything in {'spoken Kuwaiti Arabic, exactly per the voice rules below' if arabic else 'plain English, in the same tone the voice rules describe'}. The transcript below is the only source of what the video says; never add claims it does not make."
    if kind == "reel":
        parts = [
            INTRO,
            f"The video is a short vertical reel, {mmss(duration)} long, for Instagram Reels and YouTube Shorts." + (f' Aziz\'s working title for it: "{working}".' if working else ""),
            voice,
            "",
            "What to return (JSON per the schema):",
            "- cover_lines: the two lines of the cover, at the top of the frame beside Aziz: line one is the winning idea, at most four words (it is set bold white); line two is what it beats, at most four words (it is set in glowing teal). Plain spoken phrasing over clever verbs (say 'أحسن من', not 'يكسر'). Arabic-Indic numerals. No symbols, arrows, quotes, guillemets or brackets inside the lines: right-to-left breaks them, say it in words.",
            "- thumb_text_options: three to five alternative covers, each written as one string `line one | line two` with the same rules; put the recommended one first.",
            "- cover_graphic: one sentence in English describing one small minimal neon teal line-art visual that argues the video's point (for example: one upward arrow rising cleanly from a baseline next to three faint dim grey arrows trailing downward and fading out). Small, subtle, low contrast.",
            "- ig_caption: short. A hook line first, drawn from the video's actual argument; then a few punchy lines, mixing very short lines with one longer one; '..' for pauses; no hashtags in the caption itself. No em-dashes anywhere. No guillemets or quotation marks: write quoted words bare. A call to action only if the video itself has one, and then the same call to action it speaks; a video with no call to action gets no call to action. Say 'دولار', never the dollar sign.",
            "- ig_hashtags: exactly five hashtags with the # sign, specific to the topic and the audience.",
            "- yt_title_options: three titles for the Short, under 60 characters each, specific, no lies. Arabic-Indic numerals inside Arabic.",
            "- yt_description: two to four short lines that say what the Short is about, then a call to action, then three to five hashtags on the last line including #Shorts.",
            "- yt_tags: eight to twelve search tags, a mix of Arabic and English, no hashes.",
            "- chapters: an empty list. A Short has no chapters.",
            "- language: the language you wrote in (ar or en).",
            "- notes: one line for Aziz on the angle you chose and why.",
            "",
            "Proof and numbers: only the approved figures in the voice rules; for new work the Mahara proof is 'أكثر من ٧٠ شركة بالخليج', and the 76 or 80 million dollar figure is retired: say 'مشاريع كبيرة' instead. Anything else gets a bracketed placeholder rather than a guess. No em-dashes anywhere, in any field.",
        ]
    else:
        parts = [
            INTRO,
            f"The video is a long-form YouTube video, {mmss(duration)} long." + (f' Aziz\'s working title for it: "{working}".' if working else ""),
            voice,
            "",
            "What to return (JSON per the schema):",
            "- yt_title_options: three YouTube titles with different angles (the outcome, the question, the contrarian take). Under 60 characters each, specific, no lies. Arabic-Indic numerals inside Arabic.",
            "- thumb_text_options: three thumbnail lines of two to five words, the emotional core of the video, not the title repeated. They are set in bold black on a cream block over a frame of Aziz's face.",
            "- yt_description: the first two lines are the hook and stand alone (they show before 'more'); then three to five short lines on what the video covers, with the words people would search for used naturally; then one call to action" + (f" (for Mahara and client-facing content: {FUNNEL}; for personal-brand content: subscribe and the next video)") + "; then, only if the video is two minutes or longer, a 'Chapters' block as lines of `MM:SS title`, first one at 00:00; then five to eight hashtags on the last line.",
            "- chapters: the same chapters as objects {at_sec, title}, taken from where the transcript actually changes subject; empty for a video under two minutes.",
            "- yt_tags: ten to fifteen search tags, a mix of Arabic and English, no hashes.",
            "- ig_caption: in case the video is also shared on Instagram: the first line is the hook and fits before the fold (under 125 characters); then three to six short lines; then one call to action. No hashtags in the caption itself.",
            "- ig_hashtags: eight to twelve hashtags with the # sign, mixing Arabic and English, specific to the topic and the audience.",
            "- language: the language you wrote in (ar or en).",
            "- notes: one line for Aziz on the angle you chose and why.",
            "",
            "Proof and numbers: only the approved figures in the voice rules; anything else gets a bracketed placeholder rather than a guess.",
        ]
    if outliers:
        parts += ["", "What is winning on YouTube right now for the accounts Mahara learns from, as inspiration for the angle (never copy a title):", outlier_lines(outliers)]
    rules = voice_rules()
    if rules:
        parts += ["", "=== Aziz's voice rules (follow every one that applies) ===", rules]
    parts += ["", "=== Transcript with timestamps ===", transcript_lines(transcript) or "(no speech was heard; write from the working title only and say so in notes)"]
    return "\n".join(parts)


def model_json(cfg: Config, prompt: str, schema: dict[str, Any], log: Callable[[str], None]) -> tuple[dict[str, Any], str]:
    order = [p.strip() for p in key("POSTING_TEXT_PROVIDER", os.environ.get("POSTING_TEXT_PROVIDER", "gemini,openai,deepseek")).split(",") if p.strip()]
    last: Optional[Exception] = None
    for provider in order:
        try:
            if provider == "gemini" and cfg.gemini_key:
                result, usage = gemini_generate(cfg, key("POSTING_GEMINI_MODEL", cfg.gemini_text_model), [{"text": prompt}], schema, temperature=0.5)
                log(f"gemini copy ok tokens={usage.get('totalTokenCount')}")
                return result, f"gemini:{key('POSTING_GEMINI_MODEL', cfg.gemini_text_model)}"
            if provider == "openai" and cfg.openai_key:
                model = key("POSTING_OPENAI_MODEL", "gpt-4o")
                out = http.post_json(
                    "https://api.openai.com/v1/chat/completions",
                    {"model": model, "messages": [{"role": "system", "content": "Answer with one JSON object matching the fields the user lists. No prose outside the JSON."}, {"role": "user", "content": prompt}], "response_format": {"type": "json_object"}, "temperature": 0.5},
                    headers={"Authorization": f"Bearer {cfg.openai_key}"},
                    timeout=300,
                    retries=1,
                )
                return parse_json(out["choices"][0]["message"]["content"]), f"openai:{model}"
            if provider == "deepseek" and cfg.deepseek_key:
                out = http.post_json(
                    "https://api.deepseek.com/chat/completions",
                    {"model": cfg.deepseek_model, "messages": [{"role": "user", "content": prompt + "\n\nAnswer with one JSON object only."}], "response_format": {"type": "json_object"}, "temperature": 0.5, "max_tokens": cfg.deepseek_max_tokens},
                    headers={"Authorization": f"Bearer {cfg.deepseek_key}"},
                    timeout=300,
                    retries=1,
                )
                msg = out["choices"][0]["message"]
                return parse_json(msg.get("content") or msg.get("reasoning_content") or ""), f"deepseek:{cfg.deepseek_model}"
        except (http.HttpError, ValueError, KeyError) as e:
            last = e
            log(f"copy model {provider} failed: {http.scrub(str(e))[:160]}")
    raise http.HttpError(0, f"no model wrote the copy: {last}")


def _strs(v: Any, *, limit: int, each: int) -> list[str]:
    out: list[str] = []
    for x in v if isinstance(v, list) else []:
        s = re.sub(r"\s+", " ", str(x or "")).strip()
        if s and s[:each] not in out:
            out.append(s[:each])
    return out[:limit]


def _cover_pair(text: str) -> Optional[str]:
    """`setup | punch`, each side one to five words, or None."""
    parts = [re.sub(r"\s+", " ", p).strip() for p in str(text or "").split("|")]
    parts = [p for p in parts if p]
    if not parts:
        return None
    if len(parts) == 1:
        parts = [" ".join(parts[0].split()[: max(1, (len(parts[0].split()) + 1) // 2)]), " ".join(parts[0].split()[max(1, (len(parts[0].split()) + 1) // 2):])]
        parts = [p for p in parts if p]
    parts = parts[:2]
    if any(len(p.split()) > 5 or len(p) > 34 for p in parts):
        return None
    return " | ".join(parts)


def normalise(result: dict[str, Any], duration: float, kind: str = "video") -> dict[str, Any]:
    """Only well-formed fields reach the row; the model's slips do not become the post."""
    r = result if isinstance(result, dict) else {}
    titles = _strs(r.get("yt_title_options"), limit=3, each=100)
    if kind == "reel":
        # A reel's line is a pair, setup | punch; the model's cover_lines lead.
        pairs: list[str] = []
        lead = _cover_pair(" | ".join(_strs(r.get("cover_lines"), limit=2, each=40)))
        for cand in [lead] + [_cover_pair(t) for t in _strs(r.get("thumb_text_options"), limit=4, each=80)]:
            if cand and cand not in pairs:
                pairs.append(cand)
        thumbs = pairs[:3]
    else:
        thumbs = [t for t in _strs(r.get("thumb_text_options"), limit=3, each=48) if 1 <= len(t.split()) <= 6]
    chapters: list[dict[str, Any]] = []
    if duration >= 120 and kind == "video":
        seen: set[int] = set()
        for c in r.get("chapters") if isinstance(r.get("chapters"), list) else []:
            if not isinstance(c, dict):
                continue
            try:
                at = int(round(float(c.get("at_sec"))))
            except (TypeError, ValueError):
                continue
            title = re.sub(r"\s+", " ", str(c.get("title") or "")).strip()[:70]
            if not title or at < 0 or at >= duration or at in seen:
                continue
            seen.add(at)
            chapters.append({"at_sec": at, "title": title})
        chapters.sort(key=lambda c: c["at_sec"])
        if chapters and chapters[0]["at_sec"] != 0:
            chapters.insert(0, {"at_sec": 0, "title": chapters[0]["title"]}) if chapters[0]["at_sec"] > 10 else chapters.__setitem__(0, {"at_sec": 0, "title": chapters[0]["title"]})
        if len(chapters) < 3:
            chapters = []
    tags = [t.lstrip("#") for t in _strs(r.get("yt_tags"), limit=15, each=30)]
    hashtags = []
    for h in _strs(r.get("ig_hashtags"), limit=5, each=40):
        h = "#" + re.sub(r"[^\w؀-ۿ]", "", h.lstrip("#"))
        if len(h) > 1 and h not in hashtags:
            hashtags.append(h)
    description = str(r.get("yt_description") or "").strip()[:4800]
    if chapters and "00:00" not in description:
        description += "\n\n" + "\n".join(f"{mmss(c['at_sec'])} {c['title']}" for c in chapters)
    lang = str(r.get("language") or "").strip().lower()[:5] or None
    return {
        "language": lang,
        "yt_title_options": titles,
        "yt_title": titles[0] if titles else None,
        "yt_description": description or None,
        "chapters": chapters,
        "yt_tags": tags,
        "ig_caption": tidy_caption(str(r.get("ig_caption") or ""))[:2200] or None,
        "ig_hashtags": hashtags,
        "thumb_text_options": thumbs,
        "thumb_text": thumbs[0] if thumbs else None,
        "notes": str(r.get("notes") or "").strip()[:400] or None,
    }


def tidy_caption(text: str) -> str:
    """Aziz's caption rules applied after the model: no em-dashes (a pause is
    '..'), no guillemets or straight quotes around words, no dollar signs."""
    t = str(text or "")
    t = t.replace("—", "..").replace("–", "..").replace("«", "").replace("»", "")
    t = re.sub(r"[“”\"]", "", t)
    t = t.replace("$", " دولار ")
    return re.sub(r"[ \t]{2,}", " ", t).strip()


def compose(cfg: Config, log: Callable[[str], None], post: dict[str, Any], transcript: dict[str, Any], info: dict[str, Any], outliers: list[dict[str, Any]]) -> tuple[dict[str, Any], str]:
    duration = float(info.get("duration_sec") or 0)
    prompt = prompt_for(post, transcript, info, outliers)
    raw, method = model_json(cfg, prompt, SCHEMA, log)
    return normalise(raw, duration, kind_of(post, duration)), method


def post_prompt(post: dict[str, Any]) -> str:
    """The caption for an image post, from Aziz's brief."""
    brief = str(post.get("brief") or "").strip()
    working = str(post.get("title_working") or "").strip()
    images = post.get("images") if isinstance(post.get("images"), list) else []
    arabic = is_arabic_text(brief or working)
    parts = [
        INTRO,
        f"This is an Instagram post of {len(images) or 1} image{'s' if (len(images) or 1) != 1 else ''}" + (f' titled "{working}"' if working else "") + ". Aziz's brief, in his words, is the only source of what it says:",
        brief or "(no brief; write from the title alone and say so in notes)",
        "",
        f"Write in {'spoken Kuwaiti Arabic, exactly per the voice rules below' if arabic else 'plain English, in the same tone the voice rules describe'}. Never add claims the brief does not make.",
        "",
        "What to return (JSON per the schema):",
        "- ig_caption: the first line is the hook and fits before the fold (under 125 characters); then two to six short lines; then one call to action. No hashtags in the caption itself.",
        "- ig_hashtags: eight to twelve hashtags with the # sign, mixing Arabic and English, specific to the topic and the audience.",
        "- language: the language you wrote in (ar or en).",
        "- notes: one line for Aziz on the angle you chose and why.",
        "",
        "Proof and numbers: only the approved figures in the voice rules; anything else gets a bracketed placeholder rather than a guess.",
    ]
    rules = voice_rules()
    if rules:
        parts += ["", "=== Aziz's voice rules (follow every one that applies) ===", rules]
    return "\n".join(parts)


_ARABIC_RE = re.compile(r"[\u0600-\u06FF]")


def is_arabic_text(text: str) -> bool:
    return bool(_ARABIC_RE.search(text or ""))


def normalise_post(result: dict[str, Any]) -> dict[str, Any]:
    r = result if isinstance(result, dict) else {}
    hashtags: list[str] = []
    for h in _strs(r.get("ig_hashtags"), limit=5, each=40):
        h = "#" + re.sub(r"[^\w؀-ۿ]", "", h.lstrip("#"))
        if len(h) > 1 and h not in hashtags:
            hashtags.append(h)
    lang = str(r.get("language") or "").strip().lower()[:5] or None
    return {
        "language": lang,
        "ig_caption": tidy_caption(str(r.get("ig_caption") or ""))[:2200] or None,
        "ig_hashtags": hashtags,
        "notes": str(r.get("notes") or "").strip()[:400] or None,
    }


def compose_post(cfg: Config, log: Callable[[str], None], post: dict[str, Any]) -> tuple[dict[str, Any], str]:
    raw, method = model_json(cfg, post_prompt(post), POST_SCHEMA, log)
    return normalise_post(raw), method
