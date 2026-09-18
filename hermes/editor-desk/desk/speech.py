"""Speech to text, in the order that reads Gulf Arabic best.

ElevenLabs Scribe first: on ten Gulf clips from the ideation board on
2026-09-18 it beat Whisper and Gemini, kept the dialect and the English words
mixed into it, and returned nothing on silent clips where Whisper invented
"Thank you". Groq Whisper is the fallback. The order is a setting, so it can
be changed without a deploy.

The transcript is the whole point of the desk: an editor searching text
instead of scrubbing a forty minute shoot.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Optional

from . import http
from .config import Config

ELEVENLABS_STT = "https://api.elevenlabs.io/v1/speech-to-text"
GROQ_STT = "https://api.groq.com/openai/v1/audio/transcriptions"


def _segments(words: list[dict[str, Any]], *, gap: float = 0.8, max_words: int = 14) -> list[dict[str, Any]]:
    """Group words into short lines on pauses, so a person can read along."""
    out: list[dict[str, Any]] = []
    cur: list[str] = []
    start = end = None
    for w in words:
        if not isinstance(w, dict) or w.get("type") not in (None, "word"):
            continue
        text = str(w.get("text") or "").strip()
        if not text:
            continue
        ws, we = w.get("start"), w.get("end")
        if cur and ((isinstance(ws, (int, float)) and isinstance(end, (int, float)) and ws - end > gap) or len(cur) >= max_words):
            out.append({"start": start, "end": end, "text": " ".join(cur)})
            cur, start = [], None
        if start is None:
            start = ws
        cur.append(text)
        if isinstance(we, (int, float)):
            end = we
    if cur:
        out.append({"start": start, "end": end, "text": " ".join(cur)})
    return out[:2000]


def elevenlabs(cfg: Config, path: Path, *, language: Optional[str] = None) -> dict[str, Any]:
    fields = {
        "model_id": cfg.elevenlabs_stt_model,
        "tag_audio_events": "false",
        "timestamps_granularity": "word",
        "diarize": "false",
    }
    if language:
        fields["language_code"] = language
    out = http.post_multipart(
        ELEVENLABS_STT,
        fields,
        {"file": (path.name, path.read_bytes(), "audio/mpeg" if path.suffix == ".mp3" else "video/mp4")},
        headers={"xi-api-key": cfg.elevenlabs_key},
        timeout=1800,
        retries=1,
    )
    if not isinstance(out, dict):
        raise http.HttpError(0, "ElevenLabs returned no JSON")
    raw_words = [w for w in (out.get("words") or []) if isinstance(w, dict)]
    prob = out.get("language_probability")
    return {
        "text": str(out.get("text") or "").strip(),
        "language": out.get("language_code"),
        "confidence": "high" if isinstance(prob, (int, float)) and prob >= 0.8 else "medium",
        "words": [
            {"t": round(float(w["start"]), 2), "e": round(float(w.get("end", w["start"])), 2), "w": str(w.get("text") or "")}
            for w in raw_words
            if w.get("type") in (None, "word") and isinstance(w.get("start"), (int, float)) and str(w.get("text") or "").strip()
        ][:20000],
        "segments": _segments(raw_words),
        "method": f"elevenlabs:{cfg.elevenlabs_stt_model}",
    }


def groq(cfg: Config, path: Path, *, language: Optional[str] = None) -> dict[str, Any]:
    fields = {"model": "whisper-large-v3", "response_format": "verbose_json", "temperature": "0"}
    if language:
        fields["language"] = language
    out = http.post_multipart(
        GROQ_STT,
        fields,
        {"file": (path.name, path.read_bytes(), "audio/mpeg" if path.suffix == ".mp3" else "video/mp4")},
        headers={"Authorization": f"Bearer {cfg.groq_key}"},
        timeout=1800,
        retries=1,
    )
    segs = [s for s in (out or {}).get("segments", []) if isinstance(s, dict)]
    return {
        "text": str((out or {}).get("text") or "").strip(),
        "language": (out or {}).get("language"),
        "confidence": "medium",
        "words": [],
        "segments": [{"start": s.get("start"), "end": s.get("end"), "text": str(s.get("text") or "").strip()} for s in segs][:2000],
        "method": "groq:whisper-large-v3",
    }


def providers(cfg: Config) -> list[str]:
    return [p.strip().lower() for p in cfg.speech_providers.split(",") if p.strip()]


def transcribe(
    cfg: Config,
    audio: Path,
    log: Callable[[str], None],
    *,
    has_audio: Optional[bool] = None,
    language: Optional[str] = None,
) -> dict[str, Any]:
    """The chain. An empty result with method "none" means nobody could listen,
    and the warnings say why, which is never the same as "nobody spoke"."""
    result: dict[str, Any] = {
        "text": "", "language": None, "confidence": "low", "words": [],
        "segments": [], "method": "none", "warnings": [],
    }
    if has_audio is False:
        result["warnings"].append("no audio track on this file")
        return result
    available = [p for p in providers(cfg) if (p == "elevenlabs" and cfg.elevenlabs_key) or (p == "groq" and cfg.groq_key)]
    if not available:
        result["warnings"].append("no speech key available (ELEVENLABS_API_KEY or GROQ_API_KEY)")
        return result
    for name in available:
        try:
            out = elevenlabs(cfg, audio, language=language) if name == "elevenlabs" else groq(cfg, audio, language=language)
            out["warnings"] = result["warnings"]
            log(f"{name}: {len(out['text'])} characters, language {out.get('language')}")
            return out
        except (http.HttpError, ValueError, KeyError, OSError) as e:
            msg = http.scrub(str(e))[:200]
            result["warnings"].append(f"{name} could not transcribe this: {msg}")
            log(f"{name} failed: {msg}")
    return result


def find_lines(script: str, words: list[dict[str, Any]], *, min_run: int = 3) -> list[dict[str, Any]]:
    """Where each line of the script was actually said.

    A plain run-of-words match, deliberately: it is explainable, it costs
    nothing, and a wrong guess is visible to the editor rather than hidden
    inside a model's confidence. Returns one hit per line with its second, so
    the cockpit can jump there. It marks material; it never selects it.
    """
    if not script.strip() or not words:
        return []
    def norm(s: Any) -> list[str]:
        # Arabic letters count as alphanumeric to Python, so this keeps them
        # and drops the punctuation that differs between a script and speech.
        return "".join(ch if (ch.isalnum() or ch.isspace()) else " " for ch in str(s).lower()).split()
    stream = [(norm(w.get("w", ""))[:1] or [""])[0] for w in words]
    hits: list[dict[str, Any]] = []
    for raw_line in [l.strip() for l in script.splitlines() if l.strip()]:
        target = norm(raw_line)
        if len(target) < min_run:
            continue
        best_at: Optional[int] = None
        best_len = 0
        for i in range(len(stream)):
            run = 0
            while run < len(target) and i + run < len(stream) and stream[i + run] == target[run]:
                run += 1
            if run > best_len:
                best_len, best_at = run, i
        if best_at is not None and best_len >= min_run:
            start = words[best_at]
            end = words[min(best_at + best_len - 1, len(words) - 1)]
            hits.append({
                "line": raw_line[:300],
                "at_sec": start.get("t"),
                "to_sec": end.get("e", end.get("t")),
                "matched": best_len,
                "of": len(target),
                "confidence": "high" if best_len >= max(min_run, int(len(target) * 0.7)) else "partial",
            })
    return hits[:200]
