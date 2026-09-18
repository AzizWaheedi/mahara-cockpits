"""Speech to text, in the order that reads Gulf Arabic best.

Aziz, 2026-09-17: "use better Arabic transcripts". ElevenLabs Scribe is the
first choice when its key is present (it is strong on Arabic dialects in
ElevenLabs's own benchmarks and returns per-word timestamps), Groq Whisper
large-v3 is the second. The order is a setting (RADAR_SPEECH_PROVIDER) so
the 10-clip comparison (`radar.py speechtest`) can flip it without a deploy.

Every result carries the provider in "method" so the cockpit can show who
transcribed what, and nothing here raises for a missing key: a provider
without a key is skipped and the next one is tried.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Optional

from . import http, media
from .config import Config

ELEVENLABS_STT = "https://api.elevenlabs.io/v1/speech-to-text"


def elevenlabs_transcribe(cfg: Config, path: Path, *, language: Optional[str] = None) -> dict[str, Any]:
    """One Scribe call. Returns text, detected language, its probability and sentence-ish segments."""
    with open(path, "rb") as fh:
        blob = fh.read()
    fields = {
        "model_id": cfg.elevenlabs_stt_model,
        "tag_audio_events": "false",
        "timestamps_granularity": "word",
        "diarize": "false",
    }
    if language:
        fields["language_code"] = language
    mime = "audio/mpeg" if path.suffix == ".mp3" else "video/mp4"
    out = http.post_multipart(
        ELEVENLABS_STT,
        fields,
        {"file": (path.name, blob, mime)},
        headers={"xi-api-key": cfg.elevenlabs_key},
        timeout=300,
        retries=1,
    )
    if not isinstance(out, dict):
        raise http.HttpError(0, "ElevenLabs returned no JSON")
    text = str(out.get("text") or "").strip()
    return {
        "text": text,
        "language": out.get("language_code"),
        "language_probability": out.get("language_probability"),
        "segments": _segments(out.get("words") or []),
    }


def _segments(words: list[dict[str, Any]], *, gap: float = 0.8, max_words: int = 14) -> list[dict[str, Any]]:
    """Group Scribe's words into short lines on pauses, so a reader can follow the beat."""
    out: list[dict[str, Any]] = []
    cur: list[str] = []
    start = end = None
    for w in words:
        if not isinstance(w, dict) or w.get("type") not in (None, "word"):
            continue
        t = str(w.get("text") or "").strip()
        if not t:
            continue
        ws, we = w.get("start"), w.get("end")
        if cur and ((isinstance(ws, (int, float)) and isinstance(end, (int, float)) and ws - end > gap) or len(cur) >= max_words):
            out.append({"start": start, "end": end, "text": " ".join(cur)})
            cur, start = [], None
        if start is None:
            start = ws
        cur.append(t)
        end = we if isinstance(we, (int, float)) else end
    if cur:
        out.append({"start": start, "end": end, "text": " ".join(cur)})
    return out[:200]


def groq_transcribe(cfg: Config, path: Path, *, language: Optional[str] = None) -> dict[str, Any]:
    with open(path, "rb") as fh:
        blob = fh.read()
    fields = {"model": cfg.groq_model, "response_format": "verbose_json", "temperature": "0"}
    if language:
        fields["language"] = language
    out = http.post_multipart(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        fields,
        {"file": (path.name, blob, "audio/mpeg" if path.suffix == ".mp3" else "video/mp4")},
        headers={"Authorization": f"Bearer {cfg.groq_key}"},
        timeout=300,
        retries=1,
    )
    return {
        "text": (out or {}).get("text", "").strip(),
        "language": (out or {}).get("language"),
        "segments": [{"start": s.get("start"), "end": s.get("end"), "text": s.get("text")} for s in (out or {}).get("segments", [])][:200],
    }


def providers(cfg: Config) -> list[str]:
    return [p.strip().lower() for p in cfg.speech_providers.split(",") if p.strip()]


def transcribe(cfg: Config, video_path: Path, workdir: Path, log: Callable[[str], None], *, has_audio: Optional[bool] = None, order: Optional[list[str]] = None) -> dict[str, Any]:
    """The speech chain. Returns {"text", "language", "method", "segments", "warnings", "confidence"}.

    An empty text with method "none" means nobody could listen (no key, no
    audio track or every provider failed); the warnings say which.
    """
    result: dict[str, Any] = {"text": "", "language": None, "method": "none", "segments": [], "warnings": [], "confidence": "low"}
    if has_audio is False:
        result["warnings"].append("no audio track")
        return result
    order = order or providers(cfg)
    available = [p for p in order if (p == "elevenlabs" and cfg.elevenlabs_key) or (p == "groq" and cfg.groq_key)]
    if not available:
        result["warnings"].append("no speech transcription key available")
        return result
    audio = media.extract_audio(video_path, workdir / "audio.mp3") or video_path
    for p in available:
        try:
            if p == "elevenlabs":
                tr = elevenlabs_transcribe(cfg, audio)
                method = f"elevenlabs:{cfg.elevenlabs_stt_model}"
                prob = tr.get("language_probability")
                conf = "high" if isinstance(prob, (int, float)) and prob >= 0.8 else "medium"
            else:
                tr = groq_transcribe(cfg, audio)
                method = f"groq:{cfg.groq_model}"
                conf = "medium"
            result.update({"text": tr.get("text", ""), "language": tr.get("language"), "method": method, "segments": tr.get("segments", []), "confidence": conf})
            log(f"{p} transcript {len(result['text'])} chars lang={result['language']}")
            return result
        except (http.HttpError, ValueError, KeyError, OSError) as e:
            msg = http.scrub(str(e))[:200]
            result["warnings"].append(f"{p} transcription failed: {msg}")
            log(f"{p} failed: {msg}")
    return result
