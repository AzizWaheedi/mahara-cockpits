"""Read a short video: what is said, what is on screen, how it is built.

Why a video model first: the 2026-09-06 transcription pass on Mahara's own
ads found half of them silent, motion graphics with Arabic text on screen.
Speech to text alone reports those as empty. Gemini reads the frames and the
audio in one call and returns the structured breakdown directly. When no
Gemini key is available, or the call fails, the fallback is Groq Whisper for
the speech plus sampled frames read by an image model for the on-screen
text, then a text model for the breakdown. Every path records which method
produced each field and a confidence so nothing is presented as more certain
than it is.
"""
from __future__ import annotations

import base64
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Callable, Optional

from . import http, media
from .config import Config
from .speech import groq_transcribe, transcribe  # noqa: F401 - groq_transcribe kept importable from here

GEMINI = "https://generativelanguage.googleapis.com"

FORMATS = [
    "talking_head", "motion_graphics", "b_roll_voiceover", "ugc", "before_after",
    "screen_recording", "carousel", "interview", "skit", "other",
]
BEATS = ["hook", "problem", "mechanism", "proof", "offer", "cta", "other"]

# Gemini response_schema (OpenAPI subset) and the same shape for the text models.
EXTRACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "language": {"type": "string", "enum": ["ar", "en", "mixed", "none"]},
        "dialect": {"type": "string", "nullable": True},
        "has_speech": {"type": "boolean"},
        "voice": {"type": "string", "enum": ["voiceover", "text on screen", "both", "silent"]},
        "transcript": {"type": "string"},
        "on_screen_text": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"at_sec": {"type": "number"}, "text": {"type": "string"}},
                "required": ["at_sec", "text"],
            },
        },
        "format": {"type": "string", "enum": FORMATS},
        "hook": {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "type": {"type": "string"},
                "ends_at_sec": {"type": "number", "nullable": True},
            },
            "required": ["text", "type"],
        },
        "beats": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "beat": {"type": "string", "enum": BEATS},
                    "from_sec": {"type": "number", "nullable": True},
                    "to_sec": {"type": "number", "nullable": True},
                    "summary": {"type": "string"},
                },
                "required": ["beat", "summary"],
            },
        },
        "cta": {"type": "string", "nullable": True},
        "music": {"type": "string", "nullable": True},
        "why_it_works": {"type": "string"},
        "transferable": {"type": "string"},
        "adaptations": {"type": "array", "items": {"type": "string"}},
        "confidence": {
            "type": "object",
            "properties": {
                "transcript": {"type": "string", "enum": ["high", "medium", "low"]},
                "on_screen_text": {"type": "string", "enum": ["high", "medium", "low"]},
            },
            "required": ["transcript", "on_screen_text"],
        },
        "warnings": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "language", "has_speech", "voice", "transcript", "on_screen_text", "format",
        "hook", "beats", "why_it_works", "transferable", "adaptations", "confidence",
    ],
}


def _meta_lines(meta: dict[str, Any]) -> str:
    lines = []
    for k in ("platform", "author_handle", "author_name", "posted_at", "duration_sec", "views", "likes", "comments", "shares"):
        v = meta.get(k)
        if v not in (None, ""):
            lines.append(f"{k}: {v}")
    cap = (meta.get("caption") or "").strip()
    if cap:
        lines.append("caption (NOT the script, do not copy it as the transcript):\n" + cap[:1500])
    return "\n".join(lines)


def speech_block(speech: Optional[dict[str, Any]]) -> str:
    if not speech or not speech.get("text"):
        return ""
    return f"""
A dedicated speech model ({speech.get('method')}) already transcribed the audio; detected language: {speech.get('language') or 'unknown'}. Treat it as the spoken words: keep its dialect and wording, fix only what you can clearly hear differently, and if the audio is music with no speech say so in warnings instead of copying lyrics as a transcript.
Speech transcript:
{str(speech.get('text'))[:8000]}
"""


def video_prompt(meta: dict[str, Any], speech: Optional[dict[str, Any]] = None) -> str:
    return f"""You are reading a short social video for the creative director of Mahara Media, a growth partner for construction, architecture and interior design firms in the Gulf. He collects posts that performed far above their account's normal, from his industry and from unrelated ones, to ideate from.

Watch the frames AND listen to the audio. Many Gulf videos are silent motion graphics with Arabic text on screen; those are not empty, read the text.

Return ONLY JSON matching the schema. Rules:
- transcript: the spoken words verbatim in their original language and dialect, in order. Never translate. If nobody speaks, transcript is an empty string and has_speech is false.
- on_screen_text: every distinct text overlay in order with the second it appears; keep the original language; skip watermarks and the platform's own UI.
- voice: "voiceover" if only speech carries the message, "text on screen" if only text does, "both", or "silent" when there is neither.
- language: the language of the message; dialect: for Arabic name the dialect if you can tell (Kuwaiti, Saudi Najdi, Hejazi, Emirati, Egyptian, Levantine, MSA), else null.
- format: pick the closest.
- hook: the first thing that stops the scroll, quoted exactly (spoken or on screen) with a short type label such as "question", "bold claim", "pattern interrupt", "before after", "number", "story open", "callout".
- beats: the structure in order using the beat names; a reel usually has 3 to 6.
- cta: what the viewer is asked to do, or null.
- why_it_works: 2 to 4 sentences on what makes it perform: the hook mechanics, pacing, emotional trigger, specificity, visual contrast.
- transferable: 2 to 4 sentences on how a construction, design or contracting firm in the Gulf could use the same mechanism, honestly, even when the source is another industry.
- adaptations: 3 to 5 concrete ideas, each one line, hook first, written in English; no invented numbers, no client names.
- confidence: how sure you are about the transcript and the on-screen text.
- warnings: anything a reader should know (partial audio, cut off video, unreadable text, music only).
- No em dashes anywhere. Do not invent anything that is not in the video.

Known metadata:
{_meta_lines(meta)}
{speech_block(speech)}"""


# ---------------------------------------------------------------------------
# Gemini


def gemini_upload(cfg: Config, path: Path, mime: str, display_name: str) -> dict[str, Any]:
    size = os.path.getsize(path)
    start_url = f"{GEMINI}/upload/v1beta/files?key={cfg.gemini_key}"
    _, headers, _ = http.request(
        "POST",
        start_url,
        headers={
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": str(size),
            "X-Goog-Upload-Header-Content-Type": mime,
        },
        json_body={"file": {"display_name": display_name}},
        timeout=60,
        retries=2,
    )
    upload_url = None
    for k, v in headers.items():
        if k.lower() == "x-goog-upload-url":
            upload_url = v
    if not upload_url:
        raise http.HttpError(0, "Gemini upload: no upload URL in response")
    with open(path, "rb") as fh:
        blob = fh.read()
    _, _, body = http.request(
        "POST",
        upload_url,
        headers={
            "Content-Length": str(size),
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize",
        },
        data=blob,
        timeout=600,
        retries=1,
    )
    return json.loads(body.decode("utf-8"))["file"]


def gemini_wait_active(cfg: Config, name: str, *, timeout_sec: float = 300, sleep: Callable[[float], None] = time.sleep) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_sec
    while True:
        # The file's name already reads "files/<id>".
        info = http.get_json(f"{GEMINI}/v1beta/{name.lstrip('/')}?key={cfg.gemini_key}", timeout=30)
        state = info.get("state")
        if state == "ACTIVE":
            return info
        if state == "FAILED":
            raise http.HttpError(0, f"Gemini file processing failed: {info.get('error')}")
        if time.monotonic() > deadline:
            raise http.HttpError(0, "Gemini file processing timed out")
        sleep(3)


def gemini_delete(cfg: Config, name: str) -> None:
    try:
        http.request("DELETE", f"{GEMINI}/v1beta/{name.lstrip('/')}?key={cfg.gemini_key}", timeout=30, retries=0)
    except http.HttpError:
        pass


def gemini_generate(cfg: Config, model: str, parts: list[dict[str, Any]], schema: Optional[dict[str, Any]], *, temperature: float = 0.2, resolution: Optional[str] = None) -> tuple[Any, dict[str, Any]]:
    body: dict[str, Any] = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"temperature": temperature, "response_mime_type": "application/json"},
    }
    if schema:
        body["generationConfig"]["response_schema"] = schema
    if resolution:
        body["generationConfig"]["mediaResolution"] = resolution
    out = http.post_json(f"{GEMINI}/v1beta/models/{model}:generateContent?key={cfg.gemini_key}", body, timeout=600, retries=2)
    cands = out.get("candidates") or []
    if not cands:
        raise http.HttpError(0, f"Gemini returned no candidates: {str(out)[:300]}")
    text = "".join(p.get("text", "") for p in cands[0].get("content", {}).get("parts", []))
    return parse_json(text), out.get("usageMetadata") or {}


def merge_speech(result: dict[str, Any], speech: Optional[dict[str, Any]]) -> dict[str, Any]:
    """The speech model's words win over the video model's when both heard speech."""
    if not speech or not speech.get("text"):
        return result
    if result.get("has_speech") is False and not result.get("transcript"):
        result["warnings"] = list(result.get("warnings") or []) + [f"the speech model heard words the video model called silent (maybe lyrics): {str(speech['text'])[:80]}"]
        return result
    result["transcript"] = str(speech["text"])[:12000]
    result["has_speech"] = True
    method = result.setdefault("method", {})
    method["transcribe"] = speech.get("method") or method.get("transcribe")
    conf = result.setdefault("confidence", {})
    conf["transcript"] = speech.get("confidence") or conf.get("transcript") or "medium"
    if speech.get("segments"):
        result["transcript_segments"] = speech["segments"][:200]
    return result


def understand_with_gemini_video(cfg: Config, video_path: Path, meta: dict[str, Any], log: Callable[[str], None], speech: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    mime = "video/mp4"
    log(f"gemini upload {video_path.name} ({os.path.getsize(video_path)} bytes)")
    file = gemini_upload(cfg, video_path, mime, video_path.name)
    name = file["name"]
    try:
        active = gemini_wait_active(cfg, name)
        uri = active.get("uri") or file.get("uri")
        parts = [{"file_data": {"mime_type": mime, "file_uri": uri}}, {"text": video_prompt(meta, speech)}]
        result, usage = gemini_generate(cfg, cfg.gemini_model, parts, EXTRACTION_SCHEMA, resolution=cfg.gemini_resolution or None)
        log(f"gemini video ok tokens={usage.get('totalTokenCount')}")
        result = normalise_result(result)
        result["method"] = {"transcribe": f"gemini:{cfg.gemini_model}", "on_screen": f"gemini:{cfg.gemini_model}", "breakdown": f"gemini:{cfg.gemini_model}"}
        result["usage"] = {"gemini_tokens": usage.get("totalTokenCount")}
        result = merge_speech(result, speech)
        if speech and speech.get("warnings"):
            result["warnings"] = list(result.get("warnings") or []) + list(speech["warnings"])
        return result
    finally:
        gemini_delete(cfg, name)


# ---------------------------------------------------------------------------
# Fallbacks: Groq Whisper, frame vision, text breakdown


def _b64(path: Path) -> str:
    with open(path, "rb") as fh:
        return base64.b64encode(fh.read()).decode("ascii")


FRAME_PROMPT = """These are frames sampled from one short social video, in time order; each is labelled with its second. Read every piece of text overlaid on the video (any language, keep it verbatim, Arabic stays Arabic). Ignore the platform's own interface, usernames, watermarks and captions under the video. Return ONLY JSON: {"on_screen_text":[{"at_sec": <number>, "text": "<text>"}], "visual_notes": "<one or two sentences on what is shown: people, product, before/after, motion graphics>"}. Merge the same overlay seen in consecutive frames into one entry at its first second. No em dashes."""


def frames_on_screen_text(cfg: Config, frames: list[tuple[float, Path]], log: Callable[[str], None]) -> tuple[list[dict[str, Any]], str, str]:
    """Returns (on_screen_text, visual_notes, method)."""
    if not frames:
        return [], "", "none"
    if cfg.gemini_key:
        parts: list[dict[str, Any]] = [{"text": FRAME_PROMPT}]
        for ts, p in frames:
            parts.append({"text": f"frame at {ts}s:"})
            parts.append({"inline_data": {"mime_type": "image/jpeg", "data": _b64(p)}})
        try:
            result, usage = gemini_generate(cfg, cfg.gemini_text_model, parts, None)
            log(f"gemini frames ok tokens={usage.get('totalTokenCount')}")
            return list(result.get("on_screen_text") or []), str(result.get("visual_notes") or ""), f"gemini:{cfg.gemini_text_model}"
        except (http.HttpError, ValueError) as e:
            log(f"gemini frames failed: {e}")
    if cfg.openai_key:
        content: list[dict[str, Any]] = [{"type": "text", "text": FRAME_PROMPT}]
        for ts, p in frames:
            content.append({"type": "text", "text": f"frame at {ts}s:"})
            content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{_b64(p)}", "detail": "low"}})
        out = http.post_json(
            "https://api.openai.com/v1/chat/completions",
            {"model": cfg.openai_vision_model, "messages": [{"role": "user", "content": content}], "response_format": {"type": "json_object"}, "temperature": 0.1},
            headers={"Authorization": f"Bearer {cfg.openai_key}"},
            timeout=300,
            retries=1,
        )
        result = parse_json(out["choices"][0]["message"]["content"])
        return list(result.get("on_screen_text") or []), str(result.get("visual_notes") or ""), f"openai:{cfg.openai_vision_model}"
    return [], "", "none"


def text_prompt(meta: dict[str, Any], transcript: str, on_screen: list[dict[str, Any]], visual_notes: str, has_audio: Optional[bool]) -> str:
    osd = "\n".join(f"[{o.get('at_sec')}s] {o.get('text')}" for o in on_screen) or "(none read)"
    return f"""You are analysing a short social video for the creative director of Mahara Media, a growth partner for construction, architecture and interior design firms in the Gulf. You cannot watch it; you have the spoken transcript, the text read from sampled frames, visual notes and the metadata.

Spoken transcript (verbatim, may be empty when nobody speaks):
{transcript or '(no speech)'}

Text on screen:
{osd}

Visual notes: {visual_notes or '(none)'}
Audio track present: {has_audio}

Known metadata:
{_meta_lines(meta)}

Return ONLY JSON with exactly these keys: language ("ar"|"en"|"mixed"|"none"), dialect (string or null), has_speech (boolean), voice ("voiceover"|"text on screen"|"both"|"silent"), transcript (copy the spoken transcript verbatim, never translate), on_screen_text (copy the list as given, [{{"at_sec": number, "text": string}}]), format (one of {', '.join(FORMATS)}), hook {{"text": exact opening line, "type": short label, "ends_at_sec": number or null}}, beats (list of {{"beat": one of {', '.join(BEATS)}, "from_sec": number or null, "to_sec": number or null, "summary": string}}), cta (string or null), music (string or null), why_it_works (2 to 4 sentences), transferable (2 to 4 sentences on how a Gulf construction or design firm could use the mechanism), adaptations (3 to 5 one-line ideas, hook first, English, no invented numbers), confidence {{"transcript": "high"|"medium"|"low", "on_screen_text": "high"|"medium"|"low"}}, warnings (list of strings). No em dashes. Invent nothing."""


def text_model_json(cfg: Config, prompt: str, log: Callable[[str], None]) -> tuple[dict[str, Any], str]:
    order = [p.strip() for p in os.environ.get("RADAR_TEXT_PROVIDER", "gemini,deepseek,openai").split(",") if p.strip()]
    last: Optional[Exception] = None
    for provider in order:
        try:
            if provider == "gemini" and cfg.gemini_key:
                result, usage = gemini_generate(cfg, cfg.gemini_text_model, [{"text": prompt}], EXTRACTION_SCHEMA, temperature=0.2)
                log(f"gemini text ok tokens={usage.get('totalTokenCount')}")
                return result, f"gemini:{cfg.gemini_text_model}"
            if provider == "deepseek" and cfg.deepseek_key:
                out = http.post_json(
                    "https://api.deepseek.com/chat/completions",
                    {"model": cfg.deepseek_model, "messages": [{"role": "user", "content": prompt}], "response_format": {"type": "json_object"}, "temperature": 0.2, "max_tokens": 4000},
                    headers={"Authorization": f"Bearer {cfg.deepseek_key}"},
                    timeout=300,
                    retries=1,
                )
                msg = out["choices"][0]["message"]
                text = msg.get("content") or msg.get("reasoning_content") or ""
                return parse_json(text), f"deepseek:{cfg.deepseek_model}"
            if provider == "openai" and cfg.openai_key:
                out = http.post_json(
                    "https://api.openai.com/v1/chat/completions",
                    {"model": cfg.openai_vision_model, "messages": [{"role": "user", "content": prompt}], "response_format": {"type": "json_object"}, "temperature": 0.2},
                    headers={"Authorization": f"Bearer {cfg.openai_key}"},
                    timeout=300,
                    retries=1,
                )
                return parse_json(out["choices"][0]["message"]["content"]), f"openai:{cfg.openai_vision_model}"
        except (http.HttpError, ValueError, KeyError) as e:
            last = e
            log(f"text model {provider} failed: {e}")
    raise http.HttpError(0, f"no text model available: {last}")


def understand_with_fallback(cfg: Config, video_path: Path, meta: dict[str, Any], workdir: Path, log: Callable[[str], None], speech: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    warnings: list[str] = []
    info = media.probe(video_path)
    if speech is None:
        speech = transcribe(cfg, video_path, workdir, log, has_audio=info.get("has_audio"))
    transcript = str(speech.get("text") or "")
    lang = speech.get("language")
    method: dict[str, Any] = {"transcribe": speech.get("method") or "none", "on_screen": "none", "breakdown": "none"}
    warnings += list(speech.get("warnings") or [])
    frames = media.extract_frames(video_path, workdir / "frames", every_sec=cfg.frame_every_sec, max_frames=cfg.max_frames, duration=info.get("duration_sec"))
    on_screen, visual_notes, vision_method = frames_on_screen_text(cfg, frames, log)
    method["on_screen"] = vision_method
    if not frames:
        warnings.append("no frames extracted (ffmpeg missing?), on-screen text not read")
    result, breakdown_method = text_model_json(cfg, text_prompt(meta, transcript, on_screen, visual_notes, info.get("has_audio")), log)
    method["breakdown"] = breakdown_method
    result = normalise_result(result)
    if transcript and not result.get("transcript"):
        result["transcript"] = transcript
    if on_screen and not result.get("on_screen_text"):
        result["on_screen_text"] = on_screen
    if lang and not result.get("language"):
        result["language"] = "ar" if str(lang).startswith("ar") else ("en" if str(lang).startswith("en") else result.get("language"))
    result["warnings"] = list(result.get("warnings") or []) + warnings
    result["method"] = method
    if transcript:
        result["confidence"]["transcript"] = speech.get("confidence") or result["confidence"].get("transcript") or "medium"
        if speech.get("segments"):
            result["transcript_segments"] = speech["segments"][:200]
    return result


def understand(cfg: Config, video_path: Path, meta: dict[str, Any], workdir: Path, log: Callable[[str], None]) -> dict[str, Any]:
    """The speech chain first (ElevenLabs Scribe, then Whisper), then Gemini watches
    the video with that transcript in hand; the frames-plus-text chain when Gemini fails."""
    info = media.probe(video_path)
    speech = transcribe(cfg, video_path, workdir, log, has_audio=info.get("has_audio"))
    if cfg.gemini_key:
        try:
            return understand_with_gemini_video(cfg, video_path, meta, log, speech=speech)
        except (http.HttpError, ValueError, KeyError) as e:
            log(f"gemini video failed, falling back: {e}")
            out = understand_with_fallback(cfg, video_path, meta, workdir, log, speech=speech)
            out["warnings"] = list(out.get("warnings") or []) + [f"video model failed, used fallback: {http.scrub(str(e))[:160]}"]
            return out
    return understand_with_fallback(cfg, video_path, meta, workdir, log, speech=speech)


# ---------------------------------------------------------------------------


def parse_json(text: str) -> Any:
    """Tolerant JSON: strips code fences and takes the outermost object."""
    if text is None:
        raise ValueError("empty model reply")
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t)
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        start, end = t.find("{"), t.rfind("}")
        if start >= 0 and end > start:
            return json.loads(t[start : end + 1])
        raise ValueError(f"model did not return JSON: {t[:120]}")


def normalise_result(r: Any) -> dict[str, Any]:
    if not isinstance(r, dict):
        raise ValueError("model result is not an object")
    out: dict[str, Any] = dict(r)
    out["transcript"] = str(out.get("transcript") or "")[:12000]
    ost = []
    for o in out.get("on_screen_text") or []:
        if isinstance(o, dict) and o.get("text"):
            try:
                at = float(o.get("at_sec") or 0)
            except (TypeError, ValueError):
                at = 0.0
            ost.append({"at_sec": round(at, 1), "text": str(o["text"])[:500]})
    out["on_screen_text"] = ost[:200]
    out["language"] = out.get("language") if out.get("language") in ("ar", "en", "mixed", "none") else ("none" if not out["transcript"] and not ost else "mixed")
    out["has_speech"] = bool(out.get("has_speech")) if out.get("has_speech") is not None else bool(out["transcript"])
    voice = out.get("voice")
    if voice not in ("voiceover", "text on screen", "both", "silent"):
        voice = "both" if out["transcript"] and ost else "voiceover" if out["transcript"] else "text on screen" if ost else "silent"
    out["voice"] = voice
    out["format"] = out.get("format") if out.get("format") in FORMATS else "other"
    hook = out.get("hook") if isinstance(out.get("hook"), dict) else {}
    out["hook"] = {"text": str(hook.get("text") or "")[:400], "type": str(hook.get("type") or "")[:60], "ends_at_sec": hook.get("ends_at_sec")}
    beats = []
    for b in out.get("beats") or []:
        if isinstance(b, dict) and b.get("summary"):
            beats.append({"beat": b.get("beat") if b.get("beat") in BEATS else "other", "from_sec": b.get("from_sec"), "to_sec": b.get("to_sec"), "summary": str(b["summary"])[:400]})
    out["beats"] = beats[:12]
    out["adaptations"] = [str(a)[:300] for a in (out.get("adaptations") or []) if a][:8]
    out["why_it_works"] = str(out.get("why_it_works") or "")[:2000]
    out["transferable"] = str(out.get("transferable") or "")[:2000]
    conf = out.get("confidence") if isinstance(out.get("confidence"), dict) else {}
    out["confidence"] = {"transcript": conf.get("transcript") if conf.get("transcript") in ("high", "medium", "low") else "low", "on_screen_text": conf.get("on_screen_text") if conf.get("on_screen_text") in ("high", "medium", "low") else "low"}
    out["warnings"] = [str(w)[:300] for w in (out.get("warnings") or [])][:20]
    for k in ("cta", "music", "dialect"):
        v = out.get(k)
        out[k] = str(v)[:300] if v else None
    return out
