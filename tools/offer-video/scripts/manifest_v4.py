#!/usr/bin/env python3
"""Writes out/v4/manifest.json for the v4 website film: the cuts' facts, the
music previews, the baked grades, the Kling conforms, the trace's
registration, the copy sync, spend, and what is a placeholder.

  python3 scripts/manifest_v4.py --out <media>/out/v4
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--approvals", help="Reviewed licence, real-clip and Arabic evidence; never inferred from file presence")
a = ap.parse_args()
out = Path(a.out)
W = out.parent.parent
TOOL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOL / "film"))
from delivery import blockers_for, source_fingerprint
assets = json.loads((W / "final/manifest.json").read_text()) if (W / "final/manifest.json").exists() else {}


def load(p):
    p = Path(p)
    return json.loads(p.read_text()) if p.exists() else None


def min_frame_diff(p):
    """The smallest mean luma difference between neighbouring frames (0 = a repeat)."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-vf", "tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
                        "-f", "null", "-"], capture_output=True, text=True)
    vals = [float(x) for x in re.findall(r"YAVG=([\d.]+)", r.stdout + r.stderr)]
    return (round(min(vals), 3), len(vals) + 1) if vals else (None, None)


def hf_version():
    try:
        return subprocess.run([str(TOOL / "node_modules/.bin/hyperframes"), "--version"], capture_output=True, text=True).stdout.strip()
    except OSError:
        return None


REVIEW = json.loads((TOOL / "film/v4-review.json").read_text()) if (TOOL / "film/v4-review.json").exists() else {}
approval_path = Path(a.approvals) if a.approvals else W / "delivery-approvals.json"
approval = load(approval_path) or {}
current_source = source_fingerprint(TOOL)
blockers = []

cuts = {}
for lang in ("en", "ar"):
    f = load(out / f"facts-{lang}.json")
    if not f:
        continue
    b = load(out / f"build-{lang}.json") or {}
    chk = load(out / f"check-{lang}.json") or {}
    mus = load(out / f"facts-{lang}-music.json")
    cuts[lang] = {
        "main": f["main"], "clean": f["clean"], "proxy": f["proxy"],
        "poster": f"website-{lang}-poster.jpg", "captions_vtt": f"website-{lang}.vtt",
        "loudness_gain_db": f["gain_db"], "loudness_gain_source": f["gain_source"],
        "narrator": {"present": b.get("voice") is True, "slug": b.get("voice_slug"), "sha256": b.get("voice_sha256"), "copy_matches": b.get("voice_copy_matches") is True, "approvedVoiceId": approval.get("voices", {}).get(lang, {}).get("voiceId")},
        "closing": {"status": b.get("closing", "unknown"), "seconds": b.get("closing_seconds"), "sha256": b.get("closing_sha256"), "narrator_ends_at": b.get("narrator_ends_at")},
        "source_fingerprint": b.get("source_fingerprint"),
        "cues_from": b.get("cues_from"),
        "cue_anchors_s": b.get("anchors"),
        "geometry": b.get("geometry"),
        "hyperframes_check_ok": chk.get("ok"),
        "music_preview": None if not mus else {
            "file": mus["file"]["file"], "md5": mus["file"]["md5"], "bytes": mus["file"]["bytes"], "duration_s": mus["file"]["duration_s"],
            "lufs": mus["file"]["lufs"], "true_peak_dbtp": mus["file"]["true_peak_dbtp"], "gain_db": mus["gain_db"], "gain_source": mus["gain_source"],
            "licence": "UNLICENSED for clients: v3's HeyGen catalog bed (music/heygen-e43a0bf5.wav), licence for use outside HeyGen not confirmed. Internal listen only.",
        },
    }

    blockers.extend(f"{lang}: {reason}" for reason in blockers_for(lang, b, approval, current_source, f["main"].get("md5")))
    if chk.get("ok") is not True:
        blockers.append(f"{lang}: HyperFrames check has not passed")

bake = load(W / "v4/baked/bake.json") or {}
trace = load(W / "v4/work/trace/trace.json") or {}
k2_mci = W / "v4-dir-A/media/k2-mci30.mp4"
k2_125 = W / "final/kling/30fps/website-kling-2-hero-dolly-30fps.mp4"
mci = min_frame_diff(k2_mci)
r125 = min_frame_diff(k2_125)
for lang in ("en", "ar"):
    if lang not in cuts:
        blockers.append(f"{lang}: rendered cut is missing")
if (load(out / "copy-check.json") or {}).get("ok") is not True:
    blockers.append("current client copy check has not passed")
closing_states = {c["closing"]["status"] for c in cuts.values()}
manifest = {
    "schemaVersion": 1,
    "what": "Website offer demo film, English and Arabic 16:9 cuts",
    "version": out.name,
    "plan": "hw-notes/upsell-studio/video/website/v4-final-PLAN.md: direction A (architectural film) with direction B's grafts",
    "closing": next(iter(closing_states)) if len(closing_states) == 1 else "mixed",
    "clientReady": not blockers,
    "source_fingerprint": current_source,
    "closing_note": {
        "en": "The real clip uses the full 52 to 60 s slot with its own audio; narrator audio ends at 52. A missing clip keeps the text placeholder and stays blocked for clients.",
        "ar": "The Arabic cut uses its own real clip and recorded word clock. Missing narration or real footage remains explicitly blocked.",
    },
    "not_for_clients_because": blockers,
    "music_previews_not_for_clients_because": "website-<lang>-music-preview.mp4 carry v3's HeyGen catalog bed, whose licence for use outside HeyGen is not confirmed; contract section 8 allows only an ElevenLabs bed on a plan with commercial use",
    "demo_firm": assets.get("demo_firm"),
    "cuts": cuts,
    "format": "1920x1080, 30 fps, H.264 High yuv420p, AAC-LC 48 kHz stereo 192 kbps, +faststart",
    "music": {
        "review_cuts": {lang: (load(out / f"build-{lang}.json") or {}).get("bed") for lang in cuts},
        "room_tone": "brown noise, 45 Hz to 360 Hz, -40 dB, a little lower under the gap (5 to 15 s), 1.5 s fade at the end",
        "music_previews": "v3's HeyGen catalog track placed and ducked as v3's BED=heygen, mixed under the review cut's own sound (picture copied, not re-rendered): UNLICENSED, internal listen only",
    },
    "sound_effects": "key ticks (key-press) under the typing and one click (click-soft) on the cursor's tap at the language switch (english - 0.14 s), from HyperFrames' bundled set, Pixabay Content License",
    "copy_sync": {
        "source": "content/websiteVideo.ts WEBSITE_VIDEO (the 26 Oct copy repair: no booking or turn-up language)",
        "changed": {"en-2a": "decides whether they get in touch, or quietly go cold", "en-3e": "Send the link before a first meeting, so they see your work before they meet you.",
                    "ar-2b": "هو اللي يقرر إذا بيتواصل معكم، ولا بيختفي بهدوء.", "ar-3e": "وترسلون الرابط قبل أول اجتماع…"},
        "voiced_field": "Legacy voiced text is allowed only for internal previews; voice_copy_matches compares the actual timing transcript with the current script.",
        "anchors": "en link = word 2 of the approved line (word 1 of the voiced one); en before = word 13, the second 'they'; ar link = «الرابط» (ar-3e word 1)",
    },
    "captures": {
        "error_page": "Chrome 152 (Chrome for Testing, new headless) on the VPS, http://hosh.example/, LANGUAGE=en-US and LANGUAGE=ar, 800x500 at 3x (capture/v3, the same pixels as v2)",
        "demo_site": "tools/offer-video/demo-site captured with Playwright at 1440x1024 (2x) and 390x845 (3x) into capture/v3: v2's pages plus services, about and the full projects page (the six sheets and the scroll)",
        "white_balance_on_the_error_page": "screen_cold (exposure -0.08, temperature -0.16, vignette 0.06) through media-treatment: a camera's white balance in a cold room; the page's words, layout and pixel positions are untouched. One line in GRADES (film/v4bake.py) puts it back to pure white.",
    },
    "grades": {
        "how": "film/v4bake.py: each plate or clip alone in a one-element HyperFrames project, graded with `hyperframes media-treatment`, taken out with snapshot (stills) or render (clips); the film then only moves the baked files. Dissolves between two bakes stand in for changing grades (the hook cooling, the courtyard's lamps, the warm-to-raw hand-over at 17.0 s).",
        "files": bake,
    },
    "kling_conforms": {
        "hook": {"file": "v4-dir-A/media/k2-mci30.mp4", "how": "Kling 2 motion-interpolated to 30 fps at its own speed (ffmpeg minterpolate mi_mode=mci), held 0.5 s on its last frame in the bake",
                 "min_frame_difference": mci[0], "frames": mci[1]},
        "answer_at_15s": {"file": "final/kling/30fps/website-kling-2-hero-dolly-30fps.mp4", "how": "v3's re-time to 30 fps (setpts=N/(30*TB), 1.25x), frame 0 at 15.0 s; the site's hero is its frame 77",
                          "min_frame_difference": r125[0], "frames": r125[1]},
        "kling_1": "not used in v4 (the hook's post shows the hero dolly through the window it was cut from)",
    },
    "trace_registration": {
        "source": "direction B's hand trace (film/dirb.py FACADE, HATCH), registered by scripts/trace_fit.py on 26 Oct",
        "dolly_fit": trace.get("curve"),
        "residuals": {f: {k: v for k, v in r.items() if k != "worst"} for f, r in (trace.get("residuals") or {}).items()},
        "stubs_and_hand_calls": trace.get("stubs"),
        "joints": "none drawn: the walkway shows no joint above y 860 in frame 0; the two it shows sit in the caption band",
        "result": "within 2 px for every traced segment that sits on an edge at frames 0 and 15; at 30 and 39 the only misses (2.5 to 3 px: the far-left wall and a pool edge) are already masked away by the reveal. The fallback (hold frame 0) was not needed.",
    },
    "tools": {"hyperframes": hf_version(), "geist": "1.8.2", "ibm_plex_sans_arabic": "@fontsource 5.3.0", "gsap": "3.15.0 (HyperFrames vendor copy)",
              "film": "tools/offer-video/film/v4a.py (+ v4bake.py, measure.mjs, dirb.py's registered trace; build.py for the copy, clock, captions and sound)"},
    "art_and_kling": {"art": assets.get("art"), "kling": assets.get("kling")},
    "copy_check": load(out / "copy-check.json"),
    "spend_this_step": {"elevenlabs_characters": 0, "higgsfield_images": 0, "higgsfield_videos": 0, "heygen": 0},
    "spend_pilot_total": assets.get("spend"),
    "review": {"prior_direction_review": REVIEW, "delivery_evidence": approval.get("review", {}), "arabic_evidence": approval.get("arabic")},
}
(out / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
print(f"manifest: {out / 'manifest.json'}")
