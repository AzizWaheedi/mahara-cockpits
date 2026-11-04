"""Small, pure delivery rules shared by the film, manifest and checker."""
import hashlib
import json
from pathlib import Path

CLOSE_START = 52.0
CLOSE_SECONDS = 8.0


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def source_fingerprint(tool):
    """Only inputs that alter the generated film, not docs or delivery scripts."""
    files = ["film/v4a.py", "film/build.py", "film/dirb.py", "film/lines.json", "film/measure.mjs", "film/delivery.py"]
    return hashlib.sha256(json.dumps({name: sha256(Path(tool) / name) for name in files}, sort_keys=True).encode()).hexdigest()


def extra_cues(lang, timing):
    """The additional v4 cues use their own language's recorded word clock."""
    specs = {
        "en": {"thirty": ("en-2a", 6, "thirty", 6.95), "arabic": ("en-3b", 5, "Arabic", 18.75), "return_projects": ("en-5a", 2, "projects", 45.75)},
        "ar": {"thirty": ("ar-2a", 3, "ثلاثين", 6.95), "arabic": ("ar-3b", 3, "بالعربي", 18.75), "return_projects": ("ar-5a", 1, "مشروع", 45.75)},
    }
    lines = {line["id"]: line for line in timing["lines"]} if timing else None
    result = {}
    for cue, (line_id, index, word, fallback) in specs[lang].items():
        if lines is None:
            result[cue] = fallback
            continue
        try:
            entry = lines[line_id]["words"][index]
        except (KeyError, IndexError) as error:
            raise ValueError(f"{line_id}: missing word timing for {cue}; recheck this language's narration") from error
        if entry["w"].strip(".,،…؟?!") != word:
            raise ValueError(f"{line_id}: cue {cue} expects {word}; update the cue after reviewing the changed line")
        result[cue] = float(entry["start"])
    return result


def evidence_ok(record):
    return isinstance(record, dict) and bool(record.get("reviewedBy")) and bool(record.get("reviewedAt"))


def blockers_for(lang, build, approval, current_fingerprint, main_md5):
    """No caller can turn a preview into client-ready with a mode flag alone."""
    blockers = []
    if build.get("source_fingerprint") != current_fingerprint:
        blockers.append("render is stale or lacks a source fingerprint")
    if not build.get("voice"):
        blockers.append("narrator is missing")
    voice = approval.get("voices", {}).get(lang, {})
    if not (evidence_ok(voice) and voice.get("commercial") is True and voice.get("licenseEvidence") and voice.get("fileSha256") and voice.get("scriptSha256") and voice.get("fileSha256") == build.get("voice_sha256") and voice.get("scriptSha256") == build.get("script_sha256")):
        blockers.append("commercial voice licence and current-script approval are not recorded for this exact take")
    if build.get("voice_copy_matches") is not True:
        blockers.append("recorded narration differs from the current script")
    closing = approval.get("closing", {}).get(lang, {})
    if build.get("closing") != "real":
        blockers.append("Aziz's real closing clip is missing")
    elif not (evidence_ok(closing) and closing.get("real") is True and closing.get("approved") is True and closing.get("fileSha256") and closing.get("fileSha256") == build.get("closing_sha256") and build.get("closing_seconds") == CLOSE_SECONDS and build.get("narrator_ends_at") == CLOSE_START):
        blockers.append("the exact eight-second real closing clip needs review")
    if build.get("bed", {}).get("mode") not in ("off", "room-tone"):
        blockers.append("music is not cleared by this delivery pipeline; use room tone")
    if lang == "ar":
        arabic = approval.get("arabic", {})
        if not (evidence_ok(arabic) and arabic.get("approved") is True and arabic.get("scriptSha256") and arabic.get("scriptSha256") == build.get("script_sha256")):
            blockers.append("CEO Arabic approval is missing for this script")
    review = approval.get("review", {}).get(lang, {})
    if not (evidence_ok(review) and review.get("visual") is True and review.get("phoneSpeaker") is True and review.get("fileMd5") and review.get("fileMd5") == main_md5):
        blockers.append("final picture and phone-speaker review are missing for this render")
    return blockers
