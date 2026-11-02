#!/usr/bin/env python3
"""Bakes the v4 film's grades once, so the film only moves graded files.

  python3 film/v4bake.py [--media ~/upsell-studio-video/website] [--only name,...]

VPS only. Every grade goes through `hyperframes media-treatment` (never a
CSS filter): each plate or clip is put alone in a tiny HyperFrames project,
graded there, and taken out again, a still with `snapshot`, a clip with
`render`. A plate whose grade never changes over its shot is then a plain
file the film pushes and drifts; the courtyard's lamps are a dissolve
between two bakes, the hook's plate cools by a dissolve between two bakes,
and the warm answer at 15.0 s hands over to the raw clip by a dissolve so
the site's hero (the raw frame 77) matches it.

Writes <media>/v4/baked/ and bake.json (source md5s, grades, sizes).
"""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOL = HERE.parent
NM = TOOL / "node_modules"
HF = NM / ".bin/hyperframes"

# The plan's grades (v4-final-PLAN.md section 3), in media-treatment's terms.
WARM = {
    "adjust": {"temperature": 0.24, "saturation": 0.06, "contrast": 0.06},
    "wheels": {"highlights": {"hue": 36, "amount": 0.10, "level": 0.0}, "shadows": {"hue": 222, "amount": 0.05, "level": 0.0}},
    "details": {"vignette": 0.20, "grain": 0.05},
}


def warm_plate(exposure):
    return {
        "adjust": {"exposure": exposure, "temperature": 0.24, "saturation": 0.06, "contrast": 0.06},
        "wheels": {"highlights": {"hue": 36, "amount": 0.10, "level": 0.0}, "shadows": {"hue": 222, "amount": 0.05, "level": 0.0}},
        "details": {"vignette": 0.32, "grain": 0.06},
        "effects": {"blur": 0.46},
    }


NIGHT = {"adjust": {"contrast": 0.04}, "details": {"vignette": 0.24, "grain": 0.05}}
GRADES = {
    "night": NIGHT,
    # The world outside the ad's window once it has become the phone's post:
    # out of focus and about 40% darker (A's plan), then cooling toward the gap.
    # media-treatment's blur at these settings softens lightly. Stronger
    # (0.62 to 1.0, and baking at half or quarter size) was tried on 26 Oct:
    # it glows, then ghosts in several taps, and small bakes coarsen the
    # grain; so the plates separate from what stands on them by exposure,
    # vignette and the screens' contact shadows instead.
    "night_soft": {"adjust": {"contrast": 0.04, "exposure": -0.72}, "details": {"vignette": 0.30, "grain": 0.05}, "effects": {"blur": 0.6}},
    "night_soft_cold": {"adjust": {"contrast": 0.04, "exposure": -0.78, "temperature": -0.25, "saturation": -0.2},
                        "details": {"vignette": 0.30, "grain": 0.05}, "effects": {"blur": 0.6}},
    # F4 asked for exposure +0.12 and shadows +0.20 so the stone reads in the
    # top half. At those values the panel seams still did not show (baked and
    # looked at, 26 Oct), so the lift goes to +0.22 / +0.38 with contrast
    # +0.12 and the defocus eased from 0.75 to 0.55: the seams and the stone's
    # pits read, the wall stays cold and dark. (+0.32 / +0.55 went grey.)
    "cold": {
        "adjust": {"exposure": 0.22, "temperature": -0.42, "saturation": -0.55, "contrast": 0.12, "shadows": 0.38},
        "wheels": {"shadows": {"hue": 215, "amount": 0.14, "level": 0.0}, "highlights": {"hue": 205, "amount": 0.06, "level": 0.0}},
        "details": {"vignette": 0.24, "grain": 0.06},
        "effects": {"blur": 0.55},
    },
    # The real error page: a camera's white balance in a cold room, no pixel moved.
    "screen_cold": {"adjust": {"exposure": -0.08, "temperature": -0.16}, "details": {"vignette": 0.06}},
    "warm": WARM,
    "warm_plate": warm_plate(-0.22),
    "warm_plate_lo": warm_plate(-0.38),
    "warm_plate_hi": warm_plate(-0.16),
}

# name: (source under <media>, kind, grade, size or seconds)
STILLS = {
    "bg1-cold.jpg": ("final/art/website-bg-1.png", "cold", (2304, 1296)),
    "court-warm.jpg": ("final/art/website-hero-alt-courtyard.png", "warm_plate", (2112, 1188)),
    "bg3-warm.jpg": ("final/art/website-bg-3-spare.png", "warm_plate", (2208, 1242)),
    "bg2-warm-lo.jpg": ("final/art/website-bg-2.png", "warm_plate_lo", (2208, 1242)),
    "bg2-warm-hi.jpg": ("final/art/website-bg-2.png", "warm_plate_hi", (2208, 1242)),
    "err-en-cold.png": ("capture/v3/err-en.png", "screen_cold", (2400, 1500)),
    "err-ar-cold.png": ("capture/v3/err-ar.png", "screen_cold", (2400, 1500)),
}
CLIPS = {
    # Kling 2 at its own speed (A's motion-interpolated 30 fps conform, no
    # repeated frame), held 0.5 s on its last frame so the hook can dissolve
    # into the gap.
    # (source, grade, hold s, from s, scale; scale < 1 bakes small and scales up)
    "k2-night.mp4": ("v4-dir-A/media/k2-mci30.mp4", "night", 0.5, 0.0, 1.0),
    "k2-soft.mp4": ("v4-dir-A/media/k2-mci30.mp4", "night_soft", 0.5, 0.0, 1.0),
    # Only the stretch the search plays over (from 2.5 s of the clip): the
    # blur is slow per frame on the VPS's software GPU.
    "k2-soft-cold.mp4": ("v4-dir-A/media/k2-mci30.mp4", "night_soft_cold", 0.5, 2.5, 1.0),
    # Kling 2 at 1.25x (v3's 30 fps conform), frame 0 is the traced frame.
    "k2-warm.mp4": ("final/kling/30fps/website-kling-2-hero-dolly-30fps.mp4", "warm", 0.0, 0.0, 1.0),
}
CLIP_FROM = {name: v[3] for name, v in CLIPS.items()}


def sh(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def probe_dur(p):
    out = sh(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)]).stdout
    return float(out.strip())


def project(dirp, w, h, dur, media_html):
    if dirp.exists():
        shutil.rmtree(dirp)
    (dirp / "assets").mkdir(parents=True)
    shutil.copy(NM / "hyperframes/dist/vendor/npm/gsap@3.15.0/dist/gsap.min.js", dirp / "assets/gsap.min.js")
    (dirp / "index.html").write_text(f"""<!doctype html>
<html><head><meta charset="UTF-8" /><meta name="viewport" content="width={w}, height={h}" />
<script src="assets/gsap.min.js"></script>
<style>*{{margin:0;padding:0}}html,body{{width:{w}px;height:{h}px;overflow:hidden;background:#000}}</style></head>
<body><div id="root" data-composition-id="main" data-start="0" data-duration="{dur}" data-width="{w}" data-height="{h}">
{media_html}
</div><script>const tl = gsap.timeline({{ paused: true }}); window.__timelines["main"] = tl;</script></body></html>
""")


def grade(dirp, grade_name):
    r = subprocess.run([str(HF), "media-treatment", "--project", str(dirp), "--file", "index.html", "--selector", "#src",
                        "--grading", json.dumps(GRADES[grade_name]), "--apply", "--json"], capture_output=True, text=True)
    if r.returncode != 0 or '"ok": false' in r.stdout:
        raise SystemExit(f"grade {grade_name} failed in {dirp}: {r.stdout[-800:]} {r.stderr[-800:]}")


def bake_still(media, work, out, name, src, grade_name, size, scale=1.0):
    """scale < 1 bakes at that fraction of the size and scales the result up:
    media-treatment's blur is then wider against the frame, the way a lens
    defocus is, without its multi-tap ghosting at high settings."""
    W_, H_ = size
    w, h = int(W_ * scale), int(H_ * scale)
    d = work / name.split(".")[0]
    project(d, w, h, 1, f'<img id="src" src="assets/src{Path(src).suffix}" style="position:absolute;left:0;top:0;width:{w}px;height:{h}px;object-fit:cover">')
    shutil.copy(media / src, d / f"assets/src{Path(src).suffix}")
    grade(d, grade_name)
    snap = d / "snap"
    sh([str(HF), "snapshot", str(d), "--at", "0.5", "--no-end", "-o", str(snap), "--timeout", "120000"], cwd=d)
    png = sorted(snap.glob("*.png"))[0]
    dst = out / name
    if name.endswith(".jpg"):
        sh(["ffmpeg", "-y", "-v", "error", "-i", str(png), "-vf", f"scale={W_}:{H_}:flags=lanczos", "-q:v", "2", str(dst)])
    else:
        sh(["ffmpeg", "-y", "-v", "error", "-i", str(png), "-vf", f"scale={W_}:{H_}:flags=lanczos", str(dst)])
    return {"file": name, "source": src, "source_md5": md5(media / src), "grade": grade_name, "settings": GRADES[grade_name],
            "size": f"{W_}x{H_}", "baked_at_scale": scale, "md5": md5(dst)}


def bake_clip(media, work, out, name, src, grade_name, hold, from_s=0.0, scale=1.0):
    d = work / name.split(".")[0]
    srcp = media / src
    padded = work / f"{name}.src.mp4"
    vf = f"tpad=stop_mode=clone:stop_duration={hold}" if hold else "null"
    sh(["ffmpeg", "-y", "-v", "error", "-ss", f"{from_s:.3f}", "-i", str(srcp), "-vf", vf, "-r", "30", "-c:v", "libx264", "-crf", "10", "-preset", "slow",
        "-pix_fmt", "yuv420p", "-an", str(padded)])
    dur = round(probe_dur(padded) - 0.001, 3)
    frames = int(dur * 30 + 1e-6)
    dur = frames / 30
    bw, bh = int(1920 * scale), int(1080 * scale)
    project(d, bw, bh, dur, f'<video id="src" class="clip" muted playsinline src="assets/src.mp4" data-start="0" data-duration="{dur:.4f}" '
                             f'data-track-index="0" style="position:absolute;left:0;top:0;width:{bw}px;height:{bh}px;object-fit:cover"></video>')
    if scale != 1.0:
        sh(["ffmpeg", "-y", "-v", "error", "-i", str(padded), "-vf", f"scale={bw}:{bh}:flags=lanczos", "-c:v", "libx264", "-crf", "10",
            "-pix_fmt", "yuv420p", "-an", str(d / "assets/src.mp4")])
    else:
        shutil.copy(padded, d / "assets/src.mp4")
    grade(d, grade_name)
    dst = out / name
    raw = dst if scale == 1.0 else work / f"{name}.half.mp4"
    sh([str(HF), "render", str(d), "--quality", "delivery", "--crf", "12", "--video-frame-format", "png", "--output", str(raw)], cwd=d)
    if scale != 1.0:
        sh(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-vf", "scale=1920:1080:flags=lanczos", "-c:v", "libx264", "-crf", "12",
            "-preset", "slow", "-pix_fmt", "yuv420p", "-an", str(dst)])
    return {"file": name, "source": src, "source_md5": md5(srcp), "grade": grade_name, "settings": GRADES[grade_name],
            "from_s": from_s, "baked_at_scale": scale, "hold_last_frame_s": hold, "duration_s": round(probe_dur(dst), 3), "md5": md5(dst)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--media", default=str(Path.home() / "upsell-studio-video/website"))
    ap.add_argument("--only", default="")
    ap.add_argument("--record", action="store_true", help="write bake.json for the files already baked, baking nothing")
    a = ap.parse_args()
    media = Path(a.media)
    out = media / "v4/baked"
    work = media / "v4/work/bake"
    out.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    only = set(filter(None, a.only.split(",")))
    log_p = out / "bake.json"
    log = json.loads(log_p.read_text()) if log_p.exists() else {}
    if a.record:
        for name, (src, g, size) in STILLS.items():
            if (out / name).exists():
                log[name] = {"file": name, "source": src, "source_md5": md5(media / src), "grade": g, "settings": GRADES[g],
                             "size": f"{size[0]}x{size[1]}", "md5": md5(out / name)}
        for name, (src, g, hold, from_s, _sc) in CLIPS.items():
            if (out / name).exists():
                log[name] = {"file": name, "source": src, "source_md5": md5(media / src), "grade": g, "settings": GRADES[g],
                             "from_s": from_s, "hold_last_frame_s": hold, "duration_s": round(probe_dur(out / name), 3), "md5": md5(out / name)}
        log_p.write_text(json.dumps(log, indent=1))
        print("recorded", sorted(log))
        return
    for name, (src, g, size) in STILLS.items():
        if only and name not in only:
            continue
        log[name] = bake_still(media, work, out, name, src, g, size)
        print("baked", name)
        log_p.write_text(json.dumps(log, indent=1))
    for name, (src, g, hold, from_s, sc) in CLIPS.items():
        if only and name not in only:
            continue
        log[name] = bake_clip(media, work, out, name, src, g, hold, from_s, sc)
        print("baked", name, log[name]["duration_s"], flush=True)
        log_p.write_text(json.dumps(log, indent=1))
    log_p.write_text(json.dumps(log, indent=1))


if __name__ == "__main__":
    main()
