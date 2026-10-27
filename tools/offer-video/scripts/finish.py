#!/usr/bin/env python3
"""Masters one cut after HyperFrames renders it, and writes its facts.

  python3 scripts/finish.py --lang en --out <dir> [--gain-from <dir>/facts-en.json]

From raw-<lang>.mp4 and raw-<lang>-clean.mp4 in --out it writes:
  website-<lang>.mp4 / website-<lang>-clean.mp4  H.264 High yuv420p 30 fps,
      AAC-LC 48 kHz stereo 192 kbps, +faststart, loudness -15 LUFS, true peak
      at or under -1 dBTP (two-pass loudnorm; --gain-from applies another
      cut's gain instead, for a cut with nothing but effects);
  website-<lang>-960.mp4                          960x540 proxy (6 MB at most);
  facts-<lang>.json                               durations, codecs, loudness, md5s.
"""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


def run(cmd, capture=False):
    r = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return r.stderr if capture else r.stdout


def probe(p):
    return json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(p)]))


def loudness(p):
    err = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(p), "-af", "ebur128=peak=true", "-f", "null", "-"], capture=True)
    tail = err[err.rfind("Summary:"):]
    i = float(re.search(r"I:\s+(-?[\d.]+|-inf) LUFS", tail).group(1))
    tp = float(re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", tail).group(1))
    return i, tp


def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


VIDEO = ["-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "30", "-crf", "16", "-preset", "slow"]
AUDIO = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]


def master(raw, out, gain_db=None):
    if gain_db is None:
        first = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(raw), "-af",
                     "loudnorm=I=-15:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], capture=True)
        m = json.loads(first[first.rfind("{"):first.rfind("}") + 1])
        af = ("loudnorm=I=-15:TP=-1.5:LRA=11:linear=true:"
              f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:"
              f"measured_thresh={m['input_thresh']}:offset={m['target_offset']}:print_format=summary")
        gain = -15.0 - float(m["input_i"])
    else:
        gain = gain_db
        af = f"volume={gain:.2f}dB,alimiter=limit=0.84:level=false"
    v = next(st for st in probe(raw)["streams"] if st["codec_type"] == "video")
    ok = (v["codec_name"], v.get("profile"), v["pix_fmt"], v["r_frame_rate"]) == ("h264", "High", "yuv420p", "30/1")
    video = ["-c:v", "copy"] if ok else VIDEO
    # -t 60 and the trim keep the AAC priming from stretching the audio past 60.0 s.
    run(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-t", "60", *video, "-af", af + ",aresample=48000,atrim=end=59.99,asetpts=N/SR/TB", *AUDIO,
         "-movflags", "+faststart", str(out)])
    return gain


def proxy(src, out):
    run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vf", "scale=960:540", "-c:v", "libx264", "-profile:v", "high",
         "-pix_fmt", "yuv420p", "-crf", "27", "-preset", "slow", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", str(out)])
    if out.stat().st_size > 6_000_000:
        run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vf", "scale=960:540", "-c:v", "libx264", "-b:v", "650k",
             "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "80k", "-movflags", "+faststart", str(out)])
    if out.stat().st_size > 6_000_000:
        raise ValueError("Proxy still exceeds 6 MB; do not copy it to the Mac.")


def facts(p):
    d = probe(p)
    v = next(s for s in d["streams"] if s["codec_type"] == "video")
    a = next((s for s in d["streams"] if s["codec_type"] == "audio"), None)
    i, tp = loudness(p)
    return {
        "file": p.name, "md5": md5(p), "bytes": p.stat().st_size,
        "duration_s": round(float(d["format"]["duration"]), 3),
        "video": {"codec": v["codec_name"], "profile": v.get("profile"), "pix_fmt": v["pix_fmt"],
                  "size": f"{v['width']}x{v['height']}", "fps": v["r_frame_rate"]},
        "audio": None if a is None else {"codec": a["codec_name"], "profile": a.get("profile"),
                                         "rate": a["sample_rate"], "channels": a["channels"],
                                         "kbps": round(int(a.get("bit_rate", 0)) / 1000)},
        "lufs": i, "true_peak_dbtp": tp,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--gain-from")
    a = ap.parse_args()
    out = Path(a.out)
    gain = None
    if a.gain_from:
        gain = json.loads(Path(a.gain_from).read_text())["gain_db"]
    res = {"lang": a.lang}
    g = master(out / f"raw-{a.lang}.mp4", out / f"website-{a.lang}.mp4", gain)
    master(out / f"raw-{a.lang}-clean.mp4", out / f"website-{a.lang}-clean.mp4", g)
    res["gain_db"] = round(g, 2)
    res["gain_source"] = "own two-pass loudnorm" if gain is None else f"the voiced cut's gain ({a.gain_from})"
    proxy(out / f"website-{a.lang}.mp4", out / f"website-{a.lang}-960.mp4")
    res["main"] = facts(out / f"website-{a.lang}.mp4")
    res["clean"] = facts(out / f"website-{a.lang}-clean.mp4")
    res["proxy"] = {"file": f"website-{a.lang}-960.mp4", "bytes": (out / f"website-{a.lang}-960.mp4").stat().st_size}
    (out / f"facts-{a.lang}.json").write_text(json.dumps(res, indent=1))
    print(json.dumps({k: res[k] for k in ("gain_db",)} | {
        "main": {k: res["main"][k] for k in ("duration_s", "lufs", "true_peak_dbtp")},
        "clean": {k: res["clean"][k] for k in ("duration_s", "lufs", "true_peak_dbtp")},
        "proxy_mb": round(res["proxy"]["bytes"] / 1048576, 2)}))


if __name__ == "__main__":
    main()
