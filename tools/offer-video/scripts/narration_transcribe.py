#!/usr/bin/env python3
"""Bounded offline transcription evidence. Never grants publication readiness.

Run only on the coordinated VPS using the pinned, pre-downloaded ASR runtime.
No provider calls, model downloads, synthesis, source changes or video render occur.
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import importlib.metadata
import json
import math
import subprocess
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

MODEL_ID = "Systran/faster-whisper-small"
MODEL_REVISION = "536b0662742c02347bc0e980a01041f333bce120"
PACKAGE_VERSION = "1.2.1"
MODEL_FILES = {
    "config.json": "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828",
    "model.bin": "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671",
    "tokenizer.json": "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab",
    "vocabulary.txt": "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913",
}


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_model(model: Path) -> None:
    for name, expected in MODEL_FILES.items():
        path = model / name
        if not path.is_file() or sha(path) != expected:
            raise ValueError(f"Pinned model file mismatch: {name}")


def text_sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalized(text: str) -> str:
    # Punctuation/case/Arabic diacritics may differ in ASR. Do not equate words,
    # convert digits to words, or normalize dialect: those require real review.
    return "".join(c.casefold() for c in text if unicodedata.category(c)[0] in ("L", "N"))


def compare_words(script: str, words: list[dict]) -> dict:
    expected = script.split()
    actual = [str(w["text"]).strip() for w in words]
    a, b = [normalized(t) for t in expected], [normalized(t) for t in actual]
    matcher = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    changes = []
    matched = 0
    for operation, i, j, x, y in matcher.get_opcodes():
        if operation == "equal":
            matched += j - i
            continue
        changes.append({"operation": operation, "expectedRange": [i, j],
                        "observedRange": [x, y], "expected": expected[i:j],
                        "observed": actual[x:y],
                        "start": words[x]["start"] if x < len(words) else None,
                        "end": words[y-1]["end"] if y > x else None})
    return {"expectedTokens": len(expected), "observedTokens": len(actual),
            "normalizedExactTokens": matched,
            "normalizedExactSequence": not changes,
            "differences": changes, "transcriptChecked": False,
            "clientReady": False,
            "limit": "ASR evidence only. Exact output is not a listening or semantic review. Differences may be recognition errors or spoken errors."}


def finite_duration(value) -> float:
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or not 1 <= value <= 300):
        raise ValueError("Audio duration must be a finite number within 1–300 seconds")
    return float(value)


def validate_words(words: list[dict], duration: float) -> None:
    duration = finite_duration(duration)
    previous_start = 0.0
    if not words:
        raise ValueError("No timestamped words were produced")
    for word in words:
        start, end = word.get("start"), word.get("end")
        if any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n)
               for n in (start, end)):
            raise ValueError("Non-finite word timestamp")
        if start < previous_start or start < 0 or end < start or end > duration + 0.05:
            raise ValueError("Word timestamp falls outside the audio or is unordered")
        if not isinstance(word.get("text"), str) or not word["text"].strip():
            raise ValueError("Empty observed word")
        previous_start = start


def preflight(audio: Path, script: Path, receipt_path: Path, language: str) -> tuple[str, dict, float]:
    if audio.suffix.lower() not in (".wav", ".mp3", ".m4a") or not audio.is_file():
        raise ValueError("Use an existing task audio export")
    if not 100 < audio.stat().st_size < 50_000_000:
        raise ValueError("Audio exceeds the bounded transcription size")
    text = script.read_text(encoding="utf-8").strip()
    receipt = json.loads(receipt_path.read_text())
    if receipt.get("audioSha256") != sha(audio) or receipt.get("textSha256") != text_sha(text):
        raise ValueError("Audio/script receipt binding failed")
    if receipt.get("language") != language:
        raise ValueError("Requested language disagrees with the recorded take")
    if receipt.get("purpose") not in ("audition", "full-narration"):
        raise ValueError("Take purpose is not explicit")
    output = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries",
        "format=duration:stream=codec_type", "-of", "json", str(audio)], timeout=10)
    probe = json.loads(output)
    raw_duration = probe["format"]["duration"]
    if isinstance(raw_duration, bool):
        raise ValueError("Audio duration must be a finite number")
    duration = finite_duration(float(raw_duration))
    if probe["streams"] != [{"codec_type": "audio"}]:
        raise ValueError("Expected one bounded audio stream")
    return text, receipt, duration


def decode_samples(audio: Path, duration: float):
    # Decode with the already-required FFmpeg. New PyAV releases removed the
    # metadata_errors argument used by faster-whisper's file decoder. Passing
    # actual 16 kHz PCM keeps inference independent of that incompatible wrapper.
    import numpy as np
    pcm = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(audio),
        "-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"], timeout=30)
    samples = np.frombuffer(pcm, dtype=np.float32)
    if not samples.size or not np.isfinite(samples).all():
        raise ValueError("Audio decode returned empty or non-finite samples")
    if abs(samples.size / 16000 - duration) > .1:
        raise ValueError("Decoded PCM duration differs from the source")
    return samples


def transcribe(args) -> dict:
    output = args.out.resolve()
    if output.exists():
        raise ValueError("Output already exists; preserve evidence and use a new version")
    text, receipt, duration = preflight(args.audio, args.script, args.receipt, args.language)
    if importlib.metadata.version("faster-whisper") != PACKAGE_VERSION:
        raise ValueError("Unexpected faster-whisper version")
    model = args.model.resolve()
    verify_model(model)
    from faster_whisper import WhisperModel
    recognizer = WhisperModel(str(model), device="cpu", compute_type="int8",
        cpu_threads=args.cpu_threads, num_workers=1, local_files_only=True)
    samples = decode_samples(args.audio, duration)
    segments, info = recognizer.transcribe(samples, language=args.language,
        beam_size=5, word_timestamps=True, condition_on_previous_text=False,
        vad_filter=False, initial_prompt=None)
    observed, words = [], []
    for segment in segments:
        row = {"id": segment.id, "start": segment.start, "end": segment.end,
               "text": segment.text, "avgLogprob": segment.avg_logprob,
               "noSpeechProbability": segment.no_speech_prob}
        observed.append(row)
        for word in segment.words or []:
            words.append({"start": word.start, "end": word.end,
                          "text": word.word.strip(), "probability": word.probability})
    validate_words(words, duration)
    result = {"schemaVersion": 1, "recordedAt": datetime.now(timezone.utc).isoformat(),
        "audioSha256": receipt["audioSha256"], "scriptSha256": receipt["textSha256"],
        "language": args.language, "duration": duration,
        "engine": {"package": "faster-whisper", "version": PACKAGE_VERSION,
            "model": MODEL_ID, "revision": MODEL_REVISION, "device": "cpu",
            "computeType": "int8", "cpuThreads": args.cpu_threads, "workers": 1,
            "beamSize": 5, "wordTimestamps": True, "localFilesOnly": True,
            "conditionOnPreviousText": False, "initialPrompt": None,
            "modelFileHashes": MODEL_FILES},
        "recognitionLanguage": info.language, "segments": observed, "words": words,
        "comparison": compare_words(text, words), "clientReady": False}
    output.mkdir(parents=True, exist_ok=False)
    (output / "asr.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    (output / "observed.txt").write_text("\n".join(s["text"].strip() for s in observed) + "\n")
    return {"ok": True, "output": str(output), "observedWords": len(words),
            "differenceGroups": len(result["comparison"]["differences"]), "clientReady": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--script", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--language", choices=("en", "ar"), required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--cpu-threads", type=int, choices=(1, 2), default=1)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(transcribe(args)))


if __name__ == "__main__":
    main()
