#!/usr/bin/env python3
"""The music preview of one cut: the review cut's picture with v3's HeyGen
catalog bed mixed under its sound. NOT FOR CLIENTS: the bed's licence for use
outside HeyGen is unconfirmed (contract section 8 allows only an ElevenLabs
bed on a plan with commercial use).

  python3 scripts/music_preview.py --lang en --out <dir> [--gain-from <dir>/facts-en-music.json]

Reads raw-<lang>.mp4 (the render before mastering) and website-<lang>.mp4
(the mastered review cut) from --out; writes website-<lang>-music-preview.mp4
and facts-<lang>-music.json. The bed is placed and ducked exactly as v3's
BED=heygen (film/build.py make_bed): first full bar on 15.0 s, near silence
under the gap, sidechained under the narrator, 1.5 s fade at the end. The
picture is copied from the review cut, so nothing renders again.
"""
import argparse
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "film"))
sys.path.insert(0, str(HERE))
import build as v3  # noqa: E402
import finish  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--media", default=str(Path.home() / "upsell-studio-video/website"))
    ap.add_argument("--gain-from")
    a = ap.parse_args()
    out = Path(a.out)
    media = Path(a.media)
    tmp = Path(tempfile.mkdtemp())
    raw = out / f"raw-{a.lang}.mp4"
    # The narrator alone, for the sidechain (as v3 made it).
    slug = v3.VOICE_SLUG[a.lang]
    vo = media / f"voice/{a.lang}/{slug}/website-vo-{a.lang}-{slug}.wav"
    vo48 = None
    if vo.exists():
        vo48 = tmp / "vo.wav"
        finish.run(["ffmpeg", "-y", "-v", "error", "-i", str(vo), "-ar", "48000", "-ac", "2", str(vo48)])
    placement = v3.make_bed(media, tmp, vo48)
    mix = tmp / "mix.wav"
    finish.run(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-i", str(tmp / "bed.wav"), "-filter_complex",
                "[0:a]aresample=48000,aformat=channel_layouts=stereo[a];[1:a]aresample=48000,aformat=channel_layouts=stereo[b];"
                "[a][b]amix=inputs=2:normalize=0:duration=first[o]", "-map", "[o]", "-t", "60", str(mix)])
    gain = None
    if a.gain_from:
        gain = json.loads(Path(a.gain_from).read_text())["gain_db"]
    if gain is None:
        first = finish.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(mix), "-af",
                            "loudnorm=I=-15:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], capture=True)
        m = json.loads(first[first.rfind("{"):first.rfind("}") + 1])
        af = ("loudnorm=I=-15:TP=-1.5:LRA=11:linear=true:"
              f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:"
              f"measured_thresh={m['input_thresh']}:offset={m['target_offset']}")
        gain = -15.0 - float(m["input_i"])
        src = "own two-pass loudnorm"
    else:
        af = f"volume={gain:.2f}dB,alimiter=limit=0.84:level=false"
        src = f"the English preview's gain ({a.gain_from})"
    dst = out / f"website-{a.lang}-music-preview.mp4"
    finish.run(["ffmpeg", "-y", "-v", "error", "-i", str(out / f"website-{a.lang}.mp4"), "-i", str(mix), "-map", "0:v", "-map", "1:a",
                "-t", "60", "-c:v", "copy", "-af", af + ",aresample=48000,atrim=end=59.99,asetpts=N/SR/TB", *finish.AUDIO,
                "-movflags", "+faststart", str(dst)])
    f = finish.facts(dst)
    res = {"lang": a.lang, "gain_db": round(gain, 2), "gain_source": src, "bed": {"track": v3.BED, **placement},
           "licence": "NOT CONFIRMED for client distribution (HeyGen catalog track, 'Astral Generated Music'); internal listen only",
           "file": f}
    (out / f"facts-{a.lang}-music.json").write_text(json.dumps(res, indent=1))
    print(json.dumps({"file": dst.name, "lufs": f["lufs"], "true_peak_dbtp": f["true_peak_dbtp"], "duration_s": f["duration_s"]}))


if __name__ == "__main__":
    main()
