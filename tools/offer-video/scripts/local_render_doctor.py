"""Fail-closed HyperFrames doctor profile for this local Chromium/FFmpeg render.

Pinned CLI 0.8.203 reports optional Docker, transcription and synthesis tools
in its global `ok`. They are not used by render-v4.sh (no --docker, tts,
transcribe or music-generation commands). Every other reported failure blocks.
"""
import json
import sys
from pathlib import Path


REQUIRED = frozenset({
    "Node.js", "CPU", "Memory", "Disk", "Frames cache", "Archive extractor",
    "Settings lock", "Environment", "FFmpeg", "FFprobe", "Chrome",
})
OPTIONAL_UNUSED = frozenset({
    "Docker", "Docker running", "whisper-cpp", "TTS (Kokoro)", "BGM (MusicGen)",
})


def local_render_readiness(report, command_status=0):
    """Return check names only; never echo environment/settings report details."""
    failures = []
    optional = []
    seen = set()
    if type(command_status) is not int or command_status not in (0, 1):
        return {"ok": False, "profile": "local-render", "failures": ["Unexpected doctor command exit status"], "optionalUnavailable": []}
    if not isinstance(report, dict) or not isinstance(report.get("ok"), bool) or not isinstance(report.get("checks"), list):
        return {"ok": False, "profile": "local-render", "failures": ["Malformed doctor report"], "optionalUnavailable": []}
    for check in report["checks"]:
        if not isinstance(check, dict) or not isinstance(check.get("name"), str) or not check["name"]:
            failures.append("Malformed doctor check")
            continue
        name = check["name"]
        if name in seen:
            failures.append(f"Duplicate check: {name}")
        seen.add(name)
        if not isinstance(check.get("ok"), bool):
            failures.append(f"Malformed result: {name}")
        elif check["ok"] is not True:
            if name in OPTIONAL_UNUSED:
                optional.append(name)
            else:
                failures.append(name)
    failures.extend(f"Missing check: {name}" for name in sorted(REQUIRED - seen))
    return {"ok": not failures, "profile": "local-render", "failures": failures, "optionalUnavailable": optional}


def main():
    try:
        if len(sys.argv) not in (2, 3):
            raise ValueError("Expected doctor JSON path and optional command exit status")
        command_status = int(sys.argv[2]) if len(sys.argv) == 3 else 0
        result = local_render_readiness(json.loads(Path(sys.argv[1]).read_text()), command_status)
    except (OSError, ValueError):
        result = {"ok": False, "profile": "local-render", "failures": ["Doctor JSON could not be read"], "optionalUnavailable": []}
    print(json.dumps(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
