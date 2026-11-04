# Offer video: the website film

The one-minute demo film for the website offer, in English and Gulf Arabic
(16:9, 60.0 s). Everything here runs on the VPS (`hermes@187.77.156.166`),
never on the Mac. Spec: `hw-notes/upsell-studio/CONTRACT.md` section 8 and
`video/website-script.md`.

| Step | Command (from `tools/offer-video` on the VPS) | Writes |
|---|---|---|
| Install | `npm install`, then `npx hyperframes browser ensure` (needs `unzip`; `~/upsell-build/bin/unzip` is a Python stand-in) | `node_modules` |
| Kling at 30 fps | done by `film/build.py` on first use (cached in `<media>/final/kling/30fps/`) | two 4.03 s clips |
| Site hero | `ffmpeg -i <media>/final/kling/30fps/website-kling-2-hero-dolly-30fps.mp4 -vf "select=eq(n\,77)" -frames:v 1 -c:v libwebp -quality 92 <media>/site-src/hero-k2-30fps-f77.webp` | the dolly's last shown frame |
| Demo firm's site | `python3 demo-site/build.py --hero <media>/site-src/hero-k2-30fps-f77.webp --out <media>/site` | six pages per language |
| Captures | `node capture/capture.mjs --site <media>/site --out <media>/capture/v2 --chrome <full Chrome> --playwright <CS cockpit playwright>` | PNGs + `boxes.json` |
| Voice placement | `python3 ~/upsell-studio-video/bin/voice.py <lang> <slug> <voice id>` (synthesizes only lines with no MP3) | `voice/<lang>/<slug>/timing.json` + WAV |
| Film project | `python3 film/build.py --lang en\|ar [--clean] [--poster] [--bed off\|heygen] --out <dir>` | a HyperFrames project per cut |
| Render all | `bash scripts/render.sh v3 en ar` (English first: a cut with no narrator takes its gain) | `<media>/out/v3/` |
| Copy check | `cd apps/media-buyer-cockpit && bun ../../tools/offer-video/scripts/copy-check.ts <copy.json>...` | `{ok, checked, problems}` |
| Contract checks (`bun run check`) | `python3 scripts/check.py --out <media>/out/v4 --hf <media>/v4/hf` | `{ok, checks}`: length, format, loudness, poster, captions, copy, forbidden words |
| v4 direction B proof ("Drawing set") | `bash scripts/dirb-stills.sh en ar` (film/dirb.py: the five proof shots at their film times; its trace is now the registered v4 one) | `<media>/v4-dir-B/` (plan: hw-notes `video/website/v4-dir-B/PLAN.md`) |
| **v4** captures | `node capture/capture.mjs --site <media>/site --out <media>/capture/v3 --chrome <full Chrome> --playwright <CS cockpit playwright>` (adds services, about and the full projects page) | `<media>/capture/v3/` |
| **v4** trace registration | `python3 scripts/trace_fit.py --clip <media>/final/kling/30fps/website-kling-2-hero-dolly-30fps.mp4 --out <media>/v4/work/trace` (`trace_check.py` is the first audit) | `trace.json`, overlay JPGs; the result lives in `film/dirb.py` (`FACADE`, `HATCH`, `DOLLY_FIT`) |
| **v4** grades, baked once | `python3 film/v4bake.py` (`--only name,...`; `--record` rewrites `bake.json` from the files) | `<media>/v4/baked/` |
| **v4** film project | `python3 film/v4a.py --lang en\|ar [--clean] [--poster] [--bed off\|heygen] --out <dir> [--range 15,25]` | a HyperFrames project per cut |
| **v4** render all | `bash scripts/render-v4.sh en ar` (builds and checks both cuts, runs the copy check, renders, masters, posters, music previews, contact sheet, manifest, `scripts/check.py`) | `<media>/out/v4/` |

`<media>` is `~/upsell-studio-video/website` (set `OFFER_VIDEO_MEDIA` to move it).

- **The demo firm** is Hosh Design & Build (حوش للتصميم والبناء) at `hosh.example`, tagged "Example" on every frame it is in. Its site uses Mahara's own example scenes and the art set's hero; it shows no phone number or email.
- **The error page** must come from a full Chrome in new headless mode: the Playwright headless shell draws Chrome's error page blank. Chrome for Testing 152 sits in `~/upsell-studio-video/chrome`. Arabic is Chrome's own, via `LANGUAGE=ar`.
- **The voice is the clock.** Each cue lands on one spoken word (`ANCHOR_WORDS` in `film/build.py`, checked against the voice's own words) and each caption on its line's speech, ending 0.15 s before the beat it ends in. English reads `voice/en/george/timing.json`. Arabic reads `voice/ar/mohamed/timing.json` as soon as it exists: run `voice.py ar mohamed KJe6YIQ4MHI94EGaDZC7` once the ElevenLabs plan is Starter or above (the free plan refuses library voices), then re-render. Until then its cues sit on the script's windows and the cut is silent apart from room tone. Lines in beat 3 are placed 0.45 s apart; `en-3d` is set to speed 1.08 for the next synthesis.
- **Aziz's close** (52 to 60 s) is a still card until his real clip exists (`~/upsell-build/media/real/aziz-close-{en,ar}.mp4`, teleprompter in `video/website-script.md`); the Arabic card carries his teleprompter words. The manifest says `closing: "placeholder"`.
- **Music is off** (contract section 8: an ElevenLabs bed only on a plan with commercial use, otherwise room tone only). `BED=heygen bash scripts/render.sh ...` puts the HeyGen catalog track back (`<media>/music/heygen-e43a0bf5.wav`) for an internal listen only: its licence for use outside HeyGen is not confirmed. Room tone and two bundled effects (Pixabay licence) are always in.
- **Kling clips** are re-timed from 24 to 30 fps (1.25x) so no frame repeats; the site's hero is the dolly's frame 77 at 30 fps so the clip lands on it.
- **The Example tag** runs to 52 s, over every frame with the demo firm in it, and stays off the close card and the lockup.
- Grades: v3 graded nothing again. v4 grades the art once more, on purpose (the cold gap and the warm answer carry the story with the sound off): every grade goes through `hyperframes media-treatment` in `film/v4bake.py`, which bakes it into a file, so the film only moves graded files. The error page gets a camera white balance only (`screen_cold`); one line in `GRADES` puts it back to pure white.

## Local-render preflight

`scripts/doctor.sh` uses the `local-render` profile in `scripts/local_render_doctor.py`, not the global HyperFrames `ok` flag. The pinned CLI's doctor includes Docker and optional transcription/synthesis tools in that flag. Its `doctor-browser` reference specifies that Docker is required only for `render --docker`; this pipeline uses local Chromium and FFmpeg and makes no transcription or synthesis call.

Node.js, CPU, memory, disk, frames cache, archive extraction, settings lock, environment, FFmpeg, FFprobe and Chrome must all appear and pass. Missing, malformed, duplicate and unknown failed checks block rendering. `/dev/shm` failures also block when reported. Only the exact unused names `Docker`, `Docker running`, `whisper-cpp`, `TTS (Kokoro)` and `BGM (MusicGen)` are exempt. The shell independently requires Python, Bun, Node, FFmpeg/FFprobe, `unzip`, at least 5 GB free on the media filesystem, the installed browser and the required media files. Keep `~/upsell-build/bin` on PATH for the reviewed extractor.

No service is started or package installed by preflight. Doctor command exit statuses 0 and 1 are accepted only with a valid JSON report that passes the local profile; unexpected exits and malformed reports block. The version's output/project directories are created only after dependency and baked-media checks pass. An existing output version still causes refusal; preserve any earlier failed attempt explicitly before retrying. Focused parser tests are included in `python3 -m unittest discover -s scripts -p '*_test.py'`, run centrally on the VPS.

## Existing v4 direction (26 Oct 2026)

Plan: hw-notes `video/website/v4-final-PLAN.md` (direction A, "Architectural film", with direction B's grafts). Decisions and departures: `docs/upsell-studio/VIDEO.md`.

- **The picture.** 0 to 1.6 s the Kling dolly full frame is the ad (crop marks round its 4:5 window, the world dimmed to 62%); it shrinks into a frameless phone post, then the firm's name is typed large over the darkened, cooling dolly. 5 to 15 s the real error page stands on the cold stone wall with a dimension line for "30 seconds" and Rev A in amber. 15.0 s the villa is a drawing on a 74% wash and the warm render floods in through it (`film/dirb.py`'s registered trace, `DOLLY_FIT`), then it shrinks into the home page's hero, the page into the first of six sheets, the sheets re-issue in the other language on "English", and sheet 2 grows into the projects screen. Beat 4 is the finished home on the interior plate with three amber callouts and "2 weeks"; 45 to 52 s a drawn bill of quantities with "your numbers" fields; 52 to 60 s a 16:9 slot for the CEO's clip on the courtyard.
- **Words** sit inside the 80% title-safe box (x 192 to 1728, y 108 to 972), measured with the film's own fonts (`film/measure.mjs`); screens, plates, sheets and marks use the 90% box.
- **Copy.** `film/lines.json` follows `content/websiteVideo.ts`; en-2a and en-3e keep a `voiced` field while the draft voice still says the old words, and `ANCHOR_WORDS` reads the voiced index for them.
- **Sound** as v3 (room tone, key ticks, one click on the cursor's tap at the language switch). `website-<lang>-music-preview.mp4` carries v3's HeyGen bed for an internal listen only (licence unconfirmed).


## Delivery repairs after the Claude handoff

The source now reserves the full 52 to 60 second slot for Aziz's real footage, requires at least eight seconds and recorded audio, and stops narrator audio at 52 seconds. The end lockup stays below the real clip, so it does not replace its eighth second. The existing placeholder still ends with the original full-frame lockup. No design recut, generation, synthesis or upload was performed in this repair.

The additional v4 word cues now read the correct language: Arabic thirty / Arabic / projects use ar-2a, ar-3b and ar-5a. Missing or changed recorded words fail clearly. The base film's language-specific cues remain in place.

`bun run render` now uses the v4 script, defaults to a new `v4-r2` output directory, and refuses to overwrite any existing version. Set `OFFER_VIDEO_VERSION` to another new name for a later pass. Existing `out/v4` output remains preserved. The render's last check is explicitly `internal-preview`; this does not grant client readiness. Unlicensed music previews are optional through `INTERNAL_MUSIC_PREVIEW=1`, not generated by default and not required for delivery. No new music is created.

Every new build records the film source fingerprint, script hash, exact voice hash, exact real-clip hash, whether the recorded transcript matches the script, and the narrator end time. `manifest_v4.py` derives its status from those facts and actual review evidence. It no longer assumes English is always a free-plan draft, Arabic is always missing, or the close is always a placeholder. Old renders lack these facts and fail the current-source check. They must never be relabelled as newly verified.

Run after a fresh render on the VPS:

```
bun run test
python3 scripts/manifest_v4.py --out ~/upsell-studio-video/website/out/v4-r2
python3 scripts/check.py --mode internal-preview --out ~/upsell-studio-video/website/out/v4-r2 --hf ~/upsell-studio-video/website/v4-r2/hf
python3 scripts/check.py --mode client-ready --out ~/upsell-studio-video/website/out/v4-r2 --hf ~/upsell-studio-video/website/v4-r2/hf
```

The last command must fail until the real requirements are met. `delivery-approvals.example.json` documents the evidence shape; it is deliberately unapproved. Actual reviewed evidence belongs in the media root's `delivery-approvals.json` or the explicit `--approvals` file. Voice permission binds to the exact take and script, real closing approval to the source clip, Arabic approval to the script, and picture/phone-speaker review to each delivered master. A paid account alone does not clear an earlier free-plan take.

The checker defaults to `client-ready`. It checks actual master MD5/size against measured facts, source freshness, exact eight-second close, lack of narrator overlap, media format, sound, caption geometry, copy and manifest. `internal-preview` retains technical checks and reports delivery blockers rather than hiding them. No synthetic Aziz voice or face can satisfy the real-clip gate.

`handoff_v4.py --out <version> --to <new-small-staging-dir>` runs only on the VPS. It copies 960×540 proxies of at most 6,000,000 bytes, VTTs, bounded posters, a bounded contact sheet and manifest. It refuses an existing destination. Master and music-preview MP4s never enter the small handoff. `--vps-copy` is an optional new VPS-only archive, not a download source.

Source-stage verification: fixes and focused regression tests are written. The shared render was still running while these edits were made, so no mirror sync, build, unit test, render, audio analysis or new screenshot was run in this step. The previous render does not verify this new source. New final visual and audio checks remain required.
