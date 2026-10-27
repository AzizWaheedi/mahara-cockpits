# Upsell studio: the website video

The one-minute demo film for the website offer, in English and Gulf Arabic (16:9, 60.0 s), intended for a client call or follow-up after approval. Current version `v4-r2` is an internal review only, with `clientReady: false`. Built under CONTRACT.md section 3.7 and the video spec in section 8; the v4 design (26 Oct 2026) follows `hw-notes/upsell-studio/video/website/v4-final-PLAN.md`. Code: `tools/offer-video/` (README there). Everything renders on the VPS.

## Design plan (v4)

- **Tokens, from the deck, nothing new.** Deep Space `#091333` (ground, shadow tint, the schedule's fill at 90%), Deep `#060d24` (halos under lines, the 74% wash under the drawing), Ink `#f2f6fa` (type, the drawing), Teal `#00cfc8` (ours: Rev B, the reveal's leading rules, the fittings' leaders), Amber `#f5b84b` (yours to supply: Rev A, beat 4's kicker, callouts and two-week stamp, the "your numbers" fields; under 5% of any frame).
- **Type.** English in Geist (600 at 96 px for the type layer, 500 at 40 px for callouts, Geist Mono 28 px for labels of record, 400 at 40 px for captions). Arabic in IBM Plex Sans Arabic one step larger (102 to 120 px, 42 px, labels of record in Plex 30 px, captions 42 px), Arabic-Indic digits, revision letters Latin. At most five sizes a frame, no em dash on screen.
- **Layout.** A start side and an end side. A screen stands on one side at 70% or more of the frame's height, turned 4 to 6 degrees toward the open side; the words live in a column on the other side inside the 80% title-safe box (x 192 to 1728, y 108 to 972), sized from the fonts' measured widths. The caption band (y 880 to 972) stays clear of labels and lines.
- **Signature.** 15.0 s: the cold wall cuts to the villa as a drawing on the dark, and the warm render floods in through it in the order it was drawn.

## How it runs

| step | command (from `tools/offer-video` on the VPS) |
|---|---|
| captures | `node capture/capture.mjs --site <media>/site --out <media>/capture/v3 ...` |
| trace registration | `python3 scripts/trace_fit.py --clip <k2 30 fps> --out <media>/v4/work/trace` |
| grades, baked once | `python3 film/v4bake.py` |
| render both cuts | `OFFER_VIDEO_VERSION=v4-r2 bash scripts/render-v4.sh en ar` (refuses an existing output version) |
| internal checks | `python3 scripts/check.py --mode internal-preview --out <media>/out/v4-r2 --hf <media>/v4-r2/hf` |

Current outputs: VPS `~/upsell-studio-video/website/out/v4-r2/` (masters, clean pair, posters, VTTs, contact sheet, manifest); no music preview was generated for this version. The earlier `out/v4` remains historical review material. Mac handoff: `hw-notes/upsell-studio/video/website/v4-r2/`, containing only 960×540 proxies (≤6 MB), small posters, VTTs, manifest and contact sheet. Masters remain on the VPS.

## Decisions taken in v4 (the CEO hears these after)

1. **Rev A is amber in the film** (PREMIUM-PASS and the brief). CONTRACT 5.8 says ink for the deck; the deck is unchanged. One line in `film/v4a.py` (the cloud's stroke) puts the film back to ink.
2. **Amber means "yours to supply"**: the Rev A cloud and leader, beat 4's kicker, callouts and two-week stamp, and the two "your numbers" fields. Nothing else is amber.
3. **The art is graded again**, through `hyperframes media-treatment` only, baked once by `film/v4bake.py`. v3's "do not grade again" note is withdrawn for v4: the cold and warm story needs it.
4. **The error page gets a camera white balance** (`screen_cold`: exposure -0.08, temperature -0.16, vignette 0.06). Its words, layout and pixel positions are untouched; the manifest says so. One line in `GRADES` puts it back to pure white.
5. **Text sits in the 80% title-safe box**: type layer, callouts, kicker, labels of record, the Example tag and captions. Screens, plates, sheets, crop marks, the reveal's grid bubbles and leader ends use the 90% box.
6. **The phone has no drawn frame or notch**: the real 390 px capture with 46 px corners (Hallmark gate 47). The hook's feed post stays v3's HTML rows (no capture of a social feed exists).
7. **Kling 1 (the phone-ad crop) is not used.** The hook plays Kling 2 at its own speed (motion-interpolated to 30 fps); 15.0 s plays v3's 1.25x conform, whose frame 0 the trace is drawn on.
8. **Real things never flip, soft things may.** In Arabic the defocused plates behind screens flip; the hook film, the Kling clips, the traced drawing and every capture never flip.
9. **The six-page sitemap is the six pages themselves**, as six sheets (contract section 8 asks for "the six-page sitemap drawn as a drawing's title block"; the sheets show the same six pages, read with the sound off, and are not a list).
10. **The Example tag moves into the schedule from 45 to 52 s**, so it is never doubled.

### Further calls made while building (26 Oct)

- **The trace is registered, not B's 20 px-grid original.** `scripts/trace_fit.py` moved every coordinate onto the edge it was drawn on in frame 0, cut the stubs to 16 px overruns (the far wing's canopy now stops at x 1691, not in the palms), remeasured the walkway (its right edge reaches 1421 at the foot, not 1358) and fitted the dolly per frame. Every traced segment that sits on an edge is within 2 px at frames 0 and 15; at 30 and 39 the two that miss (2.5 to 3 px, the far-left wall and a pool edge) are already masked away by the reveal. The overlay plays the fitted transform (`dirb.DOLLY_FIT`), which matches B's 1.008 and 1.018 and then grows faster (1.028 at frame 39 against B's 1.0205). The fallback (hold frame 0) was not needed.
- **No walkway joints.** Frame 0 shows none above y 860, and the two it shows sit in the caption band, so the drawing carries none rather than lines on nothing.
- **The cold wall is lifted further than the plan's numbers** (F4): at exposure +0.12 and shadows +0.20 the panel seams still did not show, so the grade is +0.22 and +0.38 with contrast +0.12 and the defocus eased to 0.55.
- **Defocus stays light.** media-treatment's blur glows below about 0.7 and ghosts in several taps above 0.8; baking small and scaling up coarsens the grain. The plates behind screens separate by exposure, vignette and the screens' contact shadows instead.
- **The Arabic window leaves at 1.6 s**, not on the script window's "ad" (1.1 s), so the crop marks land first. Its cues move to Mohamed's word times when he is voiced.
- **"30 seconds" is a dimension** in the error page's plane, along its end edge (B's idea), words horizontal in the end column; the label of record sits above the dimension's lower extension line.
- **Rev B's triangle sits beside the cloud's end edge**, in the open column; above the cloud it would leave the 90% box.
- **"Six pages" lands as "pages" is said** (0.2 s after "six"), once the home page has shrunk out of the column; the shrink itself leads "six" by 0.15 s.

### Departures from the contract

- **5.8 (deck tokens): Rev A amber, not ink** (decision 1).
- **8 (the spec's "what" beat): six sheets, not a title block** (decision 9); the film retains its drawn bill of quantities (Item, Description, Quantity; "your numbers" fields; no price column). This was the original v4 choice while the deck was being built. The website deck now exists; the film was not recut to replace its schedule with a new deck capture.
- **8 (the hook): Kling 2, not the deck's `Phone` frame**: the ad is the film's own frame, cut to 4:5; the phone in 1B is frameless.

## Copy

`film/lines.json` follows `content/websiteVideo.ts` (the 26 Oct copy repair): en-2a "decides whether they get in touch, or quietly go cold", en-3e "Send the link before a first meeting, so they see your work before they meet you.", ar-2b «هو اللي يقرر إذا بيتواصل معكم، ولا بيختفي بهدوء.», ar-3e «وترسلون الرابط قبل أول اجتماع…». The English draft voice still says the old two lines: they keep a `voiced` field, the cues read the voiced words and the captions show the approved ones; the manifest lists the mismatch as a reason not to send. New on-screen words passed `cockpit_client_copy_problems` (180 strings, no problem).

## For the CSM

After client-delivery approval, share on Zoom with "Optimize for video clip" and "Share sound" on. The design specifies at least 28 px for required client text at 1080p. The current internal preview is not cleared for client use.

## Waits on the CEO

1. **ElevenLabs Starter or above.** Then the English re-voice (the two approved lines) and Mohamed's Arabic narration (`voice.py ar mohamed KJe6YIQ4MHI94EGaDZC7`, then `bash scripts/render-v4.sh en ar`), and a licensed music bed if wanted.
2. **His 8 s close** in both languages, recorded on his own camera, at `~/upsell-build/media/real/aziz-close-{en,ar}.mp4` (teleprompter in `video/website-script.md`). The film then plays it in the slot; never an AI Aziz.
3. **For his eye on the first cut** (each has a one-line way back): Rev A in amber; the white balance on the error page; the frameless phone; six sheets instead of the six-row title block; English captions showing the approved lines while the draft voice says the old ones.


## Codex delivery repair, 26 Oct 2026

The original v4 render is preserved as the prior internal preview. The fresh `v4-r2` render includes these source fixes without changing the selected visual direction:

- Arabic-specific extra word cues remove three English-only timing lookups.
- A real closing clip uses all eight seconds, 52 to 60, with its own audio. Narrator audio is trimmed and its timeline stops at 52, so the placeholder line cannot play over Aziz. The final lockup appears below the clip. No synthetic face or voice is used.
- Build hashes and measured facts drive the manifest. Client readiness requires evidence for the exact licensed voice take, current script, real clip, approved Arabic and final picture/phone-speaker review. A preview never becomes ready merely because a file exists.
- `check.py` defaults to `client-ready`; `--mode internal-preview` is explicit and reports blockers. The old hardcoded missing-Arabic/free-plan/placeholder claims have been replaced by derived state.
- The handoff is proxy-only and refuses existing destinations. No prior review folder is deleted. Unlicensed music previews are optional internal material and are no longer required or generated by default.

The source edits, manifest schema, evidence shape and focused regression tests are complete. The orchestrator reports all 14 Python tests and the local-render doctor passing, followed by a successful isolated `v4-r2` render and internal check. The received manifest, contact sheet and posters were inspected on 27 Oct; evidence and limitations are below. Commercial narration, Arabic CEO approval and Aziz's real closing clips remain delivery dependencies. See `tools/offer-video/README.md` for commands and evidence fields.

### Local-render doctor repair

The first isolated `v4-r2` attempt stopped at preflight because HyperFrames' global doctor included an inactive Docker daemon. The CLI reference documents Docker as required only for `render --docker`. This pipeline uses local Chromium/FFmpeg. A dedicated parser now requires all local renderer/resource checks and ignores only exact unused Docker/transcription/synthesis entries; unknown failures remain blocking. It also rejects missing, malformed or duplicate results. Python, Bun, archive extraction and media-filesystem free space remain independently checked. No Docker service is started.

Output directories are now created after dependency and baked-media checks, so a failed preflight does not reserve a new version. Existing failed-attempt output was left for the orchestrator to preserve explicitly. Doctor statuses 0/1 are accepted only with a valid report passing the local profile; unexpected exits and malformed JSON fail. The orchestrator reports the parser tests, preflight and resumed render passed.

## v4-r2 evidence and still-image review, 27 Oct 2026

The orchestrator reports `check.py --mode internal-preview` returned `ok: true`, `clientReady: false`. The local handoff manifest was read directly: both HyperFrames checks are true, the copy check has 180 strings and no problems, and all four master entries are 60.0 s, 1920×1080, 30 fps, H.264 High/yuv420p with AAC-LC 48 kHz stereo. These are recorded master measurements; this reviewer did not download or decode the masters on the Mac.

| Recorded output | LUFS | True peak, dBTP |
| --- | ---: | ---: |
| English main | -15.1 | -1.3 |
| English clean | -15.2 | -1.4 |
| Arabic main | -28.0 | -1.0 |
| Arabic clean | -28.0 | -1.0 |

Arabic currently has room tone/effects without a narrator; its lower loudness is not evidence of completed narration. Both cuts retain the placeholder close. `music_preview` is null in both cuts. The locally received English and Arabic proxies are 2,953,215 and 2,856,069 bytes respectively, matching the manifest and staying below 6 MB.

Visual inspection covered `contact-sheet.jpg` (seven samples per language: 1.5, 10, 15.5, 25, 40, 48 and 56 s) and both full-size posters. The samples show the architectural hook, failed-site view, traced reveal, site/form, required assets, empty project comparison and placeholder close. The posters show the shared architectural imagery, teal revision cloud, visible Example/مثال labels and mirrored Arabic layout. Their main titles are readable, Arabic letters are connected, and no obvious poster text clipping was seen.

Three additional VPS-derived English frames at 24.8, 25.0 and 25.2 s resolve the apparent overlap in the sheet: the mobile home is opaque at 24.8, fading over the form at 25.0, then gone at 25.2. This is a brief transition, not a persistent double exposure; no fix was requested. This sampled review does not verify every frame, full-motion pacing, all small screen text or phone-size reading. Audio was measured, not listened to on phone speakers. No numeric design score or final audiovisual approval is claimed.

The manifest still blocks client delivery for the English take's unrecorded commercial/current-script approval and old narration, missing Arabic narration/licence/script approval, missing real Aziz close in both languages, and missing final picture/phone-speaker approval. This review does not change those gates or approve the Arabic text. No new synthesis, generation, music or publication occurred in this verification step.
