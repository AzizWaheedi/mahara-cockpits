#!/usr/bin/env python3
"""Writes out/<version>/manifest.json for the website film from the facts the
render left behind and the asset manifest (art, Kling, voice, spend)."""
import argparse
import json
import subprocess
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--version", required=True)
a = ap.parse_args()
out = Path(a.out)
W = out.parent.parent
TOOL = Path(__file__).resolve().parent.parent
assets = json.loads((W / "final/manifest.json").read_text()) if (W / "final/manifest.json").exists() else {}


def load(name):
    p = out / name
    return json.loads(p.read_text()) if p.exists() else None


def hf_version():
    try:
        return subprocess.run([str(TOOL / "node_modules/.bin/hyperframes"), "--version"], capture_output=True, text=True).stdout.strip()
    except OSError:
        return None


# What the frame-by-frame review of each version found and changed, and what it kept.
REVIEW = {
    "v2": {
        "fixed_from_v1": [
            "P0 every revision cloud and leader jumped on in one frame instead of drawing over 640 ms (GSAP rounded the px dash offset): autoRound off",
            "P0 the Arabic WhatsApp label was on screen 0.10 s: the phone leads its word and holds through the form word (about 0.8 s Arabic, 1.2 s English)",
            "P0 no music bed: one HeyGen catalog track, first full bar on 15.0 s, near silence under the gap, ducked under the narrator, 1.5 s fade under the lockup",
            "P0 the English audio stream ran 60.1 s: trimmed to 60.0",
            "P1 the search field read small in a black phone: the push now goes to 2.4x so the typed name reads at about 46 px",
            "P1 the gap held one small page still for 8.6 s: the page now fills the middle large and settles to the start side (one move) just before 'this'",
            "P1 the gap leader started before the cloud reached it: it now leaves the cloud after the cloud passes its side",
            "P1 the return card read as a wireframe (two empty boxes): each line now sits beside its picture (the hero project; the site's home) with a blank rule for their numbers",
            "P2 the placeholder close card held dead still for 7 s: a 2.5% push over its length",
        ],
        "kept_on_purpose": [
            "line_unread on the typed firm name: it types letter by letter on the voice, as the script asks",
            "line_unread on 'The page doesn't open' (about 0.9 s): it lands after the cloud on 'this' and the beat cuts at 15.0; the words repeat what the page says",
            "line_unread on 'Tracking, tied to your ads' (about 1.1 s): the same words stay in the title block to 35 s",
            "text_below_floor inside the phone and the site captures: real UI at real size",
            "Hallmark gate 47 (re-drawn phone frame): the contract asks for the deck's own Phone frame and the Example ad inside it",
        ],
        "not_checked": "Sound was measured (loudness, true peak, the bed's level against the voice), not heard. The music bed was chosen by its description and its loudness curve.",
    },
    "v3": {
        "fixed_from_v2": [
            "music: the HeyGen catalog bed is OFF (contract section 8: only an ElevenLabs bed on a plan with commercial use, else room tone only; the account is still on the free plan). BED=heygen brings it back for an internal listen only, now with ratio 2, attack 80 ms, release 1 s ducking and, without a narrator, -14 to -9 dB over 1.5 s from 14.0 s",
            "Arabic close card: Aziz's teleprompter words, «فريق نجاح العملاء بيمشي معاكم فيها، خطوة خطوة.» (his '..' pause shown as a comma, as in the captions); lines.json ar-5c matches",
            "captions end 0.15 s before the beat their speech ends in: Arabic «يدور على اسمكم.» now ends 4.85 s, «هذا اللي يلقاه.» 14.85 s (no caption over the error page or the villa)",
            "the 'Example' / «مثال» tag now runs to 52 s, over the 45 to 52 s card that shows the demo firm's project and home page; still off the close card and the lockup",
            "both Kling clips re-timed from 24 to 30 fps (setpts=N/(30*TB), 1.25x, 4.03 s each, cached in final/kling/30fps): no repeated frame every fifth frame in the hook ad or the 15.0 to 17.6 s dolly; the demo site's hero is now frame 77 of the 30 fps dolly, so the clip still lands on it without a jump",
            "Rev B inside the 90% safe frame: cloud 12 px out from the well, B on the cloud's top corner; teal measured at x 96 to 1146 (English) and 773 to 1823 (Arabic), y 56 to 803; posters retaken at 33.5 s",
            "Rev A cloud fitted from the capture's new second-line box: the halo now ends 20 px above 'Check if there is a typo...' (English) and 14 px above the shadda in «تحقّق» (Arabic), measured on the 14.95 s frames",
            "page changes show one page at a time: projects and project wipe in fully opaque (0.4 s expo.out, from the right in English, the left in Arabic); the language switch is a cut; the well fades out before a phone comes in, and the phone is gone before the contact page or the finished home comes up",
            "'The page doesn't open' / «الصفحة ما تفتح»: a plain 0.2 s fade at the cloud's start + 0.2 s (no blur); its leader runs from the note and meets the cloud just after the cloud passes; on screen about 1.1 s (English) and 1.2 s (Arabic)",
            "hook: one plain result row under the search field (the firm's name, hosh.example in grey, no search engine's look) from 4.5 s, tapped at 4.85 s, before the 5.0 s cut to the page it opens; Enter moves to 4.4 s",
            "English beat 3 breathes: lines re-placed with 0.45 s between them inside beat 3 (no new synthesis, 0 characters), so the captions no longer switch before 'properly.' and 'tracking.' end",
            "the English caption file carries the narrator's closing line (52.55 to 55.10 s); the burned captions leave it to the card",
            "demo firm's Arabic site in written Gulf register: «من أول رسمة إلى التسليم.» (not «حتى»: Plex Arabic's تى ligature reads as «حق» at headline size), «شاهدوا مشاريعنا», «أخبرونا عن مشروعكم», «يأخذ»; site rebuilt and recaptured (capture/v2)",
        ],
        "kept_on_purpose": [
            "line_unread on the typed firm name: it types letter by letter on the voice, as the script asks",
            "line_unread on 'Tracking, tied to your ads' (about 1.1 s): the same words stay in the title block to 35 s",
            "text_below_floor inside the phone and the site captures: real UI at real size",
            "the phone frame is still drawn in CSS (Hallmark gate 47): the contract asks for the deck's own Phone frame; a vendor PNG frame or a real phone capture is the CEO's call, and the deck's Phone component would change with it",
        ],
        "waits_on_the_ceo": [
            "ElevenLabs Starter or above: then voice Mohamed (KJe6YIQ4MHI94EGaDZC7) for Arabic into voice/ar/mohamed (the film reads its word times: ANCHOR_WORDS['ar'] in film/build.py) and re-voice George for English (en-3d at speed 1.08 is set in the voice step); and, if its terms cover commercial music, a 60 s ElevenLabs bed",
            "his real closing clip at ~/upsell-build/media/real/aziz-close-{en,ar}.mp4 (teleprompter in video/website-script.md), trimmed to 8.0 s and graded with media-treatment, face untouched; then closing becomes 'real'",
            "a person listens on a phone speaker before any send",
        ],
        "not_checked": "Sound was measured, not heard. With the bed off the English cut is the voice, room tone and two effects; the Arabic cut is room tone and two effects at the English cut's gain.",
    },
}

cuts = {}
for lang in ("en", "ar"):
    f = load(f"facts-{lang}.json")
    if not f:
        continue
    b = load(f"build-{lang}.json") or {}
    chk = load(f"check-{lang}.json") or {}
    cuts[lang] = {
        "main": f["main"], "clean": f["clean"], "proxy": f["proxy"],
        "poster": f"website-{lang}-poster.jpg", "captions_vtt": f"website-{lang}.vtt",
        "loudness_gain_db": f["gain_db"], "loudness_gain_source": f["gain_source"],
        "narrator": ("English draft, George (ElevenLabs JBFqnCBsd6RMkjVDRZzb, eleven_v4, free plan: not for clients)" if lang == "en"
                     else f"voice/{lang}/{b.get('voice_slug')}") if b.get("voice")
        else "none yet: no Gulf voice on the ElevenLabs free plan (Mohamed waits on Starter); captions carry the words, cues sit on the script's windows",
        "cues_from": b.get("cues_from"),
        "cue_anchors_s": b.get("anchors"),
        "hyperframes_check_ok": chk.get("ok"),
    }

copy = load("copy-check.json")
bed = (load("build-en.json") or load("build-ar.json") or {}).get("bed")
bed_on = bool(bed) and bed.get("mode") not in (None, "off")
cands = W / "music/candidates.json"
picked = None
if bed_on and cands.exists():
    picked = next((c for c in json.loads(cands.read_text()) if c["id"] == bed["track"]["id"]), None)
music = {
    "mode": "none: room tone only",
    "why": "Contract section 8 allows only an ElevenLabs music bed made on a plan whose terms cover commercial use, and otherwise no music. The ElevenLabs account is on the free plan (read 26 Oct 2026), so these cuts carry no music.",
    "room_tone": "brown noise, 45 Hz to 360 Hz, -40 dB, a little lower under the gap (5 to 15 s), 1.5 s fade at the end",
    "set_aside": "one HeyGen catalog track (music/heygen-e43a0bf5.wav), licence for use outside HeyGen unconfirmed: BED=heygen renders it for an internal listen only",
} if not bed_on else {
    "source": "HeyGen audio catalog (the media-use skill's music path), GET https://api.heygen.com/v3/audio/sounds?type=music, read with HEYGEN_API_KEY by name; five candidates downloaded on 26 Oct 2026, one used",
    "track": picked,
    "placement": bed,
    "licence": "NOT CONFIRMED for client distribution: HeyGen labels these tracks 'Astral Generated Music' and its public terms say nothing specific about using catalog music outside HeyGen. Confirm with HeyGen (or swap in a track with a written licence) before any client send.",
    "why_not_others": "ElevenLabs music is refused on the free plan (no commercial use); Higgsfield's catalog has no standalone music model (sonilo is for its game pipeline only).",
}
closing_note = {
    "en": "52 to 59 s is a still card: the Mahara mark and 'Your account manager will walk you through it.', read by the English narrator (who never poses as Aziz).",
    "ar": "52 to 59 s is a still card: the Mahara mark and Aziz's teleprompter words «فريق نجاح العملاء بيمشي معاكم فيها، خطوة خطوة.», silent until the Arabic narrator exists.",
}
blockers = [
    "closing is a placeholder (Aziz's real clip is not recorded yet)",
    "the English narrator was voiced on the ElevenLabs free plan (no commercial licence)",
    "the Arabic cut has no narrator yet (Mohamed needs ElevenLabs Starter or above)",
    "nobody has listened to either cut on a phone speaker yet",
]
if bed_on:
    blockers.append("the music bed's licence for use outside HeyGen is not confirmed")
manifest = {
    "what": "Website offer demo film, English and Arabic 16:9 cuts",
    "version": a.version,
    "closing": "placeholder",
    "closing_note": closing_note,
    "not_for_clients_because": blockers,
    "demo_firm": assets.get("demo_firm"),
    "cuts": cuts,
    "format": "1920x1080, 30 fps, H.264 High yuv420p, AAC-LC 48 kHz stereo 192 kbps, +faststart",
    "music": music,
    "sound_effects": "key ticks (key-press) and one click (click-soft) from HyperFrames' bundled set, Pixabay Content License (commercial use, no attribution needed)",
    "captures": {
        "error_page": "Chrome 152 (Chrome for Testing, new headless) on the VPS, http://hosh.example/, LANGUAGE=en-US and LANGUAGE=ar, 800x500 at 3x",
        "demo_site": "tools/offer-video/demo-site, captured with Playwright from file:// at 1440x1024 (2x) and 390x845 (3x) into capture/v2; no contact details anywhere; its hero is frame 77 of the 30 fps Kling dolly",
        "kling": "both clips re-timed 24 to 30 fps (setpts=N/(30*TB), 1.25x, 4.03 s) so no frame repeats; the grade baked into them is not applied again",
        "deck_card": "drawn in the film (the deck harness's offer deck is not built yet on 26 Oct): two lines, each beside its picture (the hero project; the demo site's home), an empty rule where their own numbers go, no figures",
    },
    "tools": {"hyperframes": hf_version(), "geist": "1.8.2", "ibm_plex_sans_arabic": "@fontsource 5.3.0", "ibm_plex_sans": "@fontsource 5.3.0 (demo site only)", "gsap": "3.15.0 (HyperFrames vendor copy)"},
    "art_and_kling": {"art": assets.get("art"), "kling": assets.get("kling"), "grade": assets.get("grade")},
    "copy_check": copy,
    "spend_this_step": {"elevenlabs_characters": 0, "higgsfield_images": 0, "higgsfield_videos": 0, "heygen": 0}
    if a.version != "v2" else {"elevenlabs_characters": 0, "higgsfield_images": 0, "higgsfield_videos": 0,
                               "heygen": "2 catalog searches and 5 track downloads; the key's remaining quota reads 0 and nothing was refused, so no credits were spent"},
    "review": REVIEW.get(a.version),
    "spend_pilot_total": assets.get("spend"),
}
(out / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
print(f"manifest: {out / 'manifest.json'}")
