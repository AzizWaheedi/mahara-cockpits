# All-offer films: picture and timing contract

## Visual system

1920 × 1080, 30 fps. Keep the reviewed series palette: navy `#091333`, pale `#e8edf4`, white `#f2f6fa`, teal `#00cfc8`, blue `#506179`. Geist and IBM Plex Sans Arabic are bundled. Type carries essential meaning at 96–108 px, counters at 180–280 px; persistent example labels use 75px within x192–1728 and y682–777. They intentionally overlay the illustration near its bottom, away from headlines and captions. Standard headlines begin at y108 without a clipping height, with two-line space reserved before diagrams begin at y360. Exact-script captions use 75 px inside x192–1728 and y804–972. Main scene content ends by y790 so captions never compete with facts. Full-bleed images are intentional, text remains within the title-safe area. RTL text, flow and reveal edges are explicit.

Signature: one useful object travels through each film, with a change caused by the narration. Website page cropping, branch growth, dossier indexing, publishing sequence, viewfinder framing, actual presenter video, and recruitment milestones are seven different picture languages within one brand.

Every scene has a visible object or text at frame zero. Do not fade essential text out before its successor. The closing logo is visible from the first closing frame; it settles over 0.25 seconds, then rests. One final sentence, no duplicate terms or promotional add-ons.

## Voice is the clock

`--timing <timing.json>` consumes the audio agent's schemaVersion1 object: `kind`, `language`, `scriptSha256`, `audioFile`, `audioSha256`, `duration`, `segments[{id,start,end,text}]`, optional `words[{start,end,text}]`, and explicit `copyApproved`, `commercialEvidenceRecorded`, `transcriptChecked`, `subjectiveListen` fields. Script hash means the exact selected language text hash. Audio is a bounded relative file beside the timing manifest, verified byte-for-byte. Segment IDs/text must equal the approved script; timings must be finite, ordered and within audio duration. No guessed final timings.

The builder creates a separate composition per spoken segment, uses actual cues for scene boundaries and matched word times for excerpt changes/captions when available. Wordless layout preparation is explicitly `--layout-only`, has approximate timing and no audio, and remains internal. A narrated take without exact word coverage is refused before assembly; use the explicitly silent layout mode until observed alignment is available. It never invents word timings and calls them verified. Full exact-script VTT and SRT files include the closing words, even when the on-screen closing already carries them. Every output remains `clientReady:false` until transcript verification, audio measurement, current-source frame/phone/seam review and provider verification are recorded. The user has already authorized publication and approved the exact scripts and logo ending. Subjective and phone-speaker listening remain truthful metadata, never an invented result or a new user-approval requirement.

## Hand-selected story beats

| Offer | Picture progression | Facts that cannot disappear |
|---|---|---|
| Website | Project → site → bilingual pages/projects/contact → shared link → three inputs → launch and care → logo | Up to six pages, both languages, WhatsApp/form/tracking, monthly care |
| Second campaign | Two service branches → own ads/words/form → parallel support → service photography → approval/start/monthly terms → logo | Second service is separate; approval precedes launch; no spend figure |
| Search | Search question → ninety-day dossier → service/question pages → monthly report/no-site branch → ownership/care → logo | No-site inclusion, ownership, day91 care, no promised ranking/AI mention |
| Social | Project image → material library → posts/stories calendar → agreed first month → conditional reels → call/report → logo | More than twenty posts, weekly stories, reels conditional, no enquiry promise |
| Filming | Project frame → full day/site → wide/detail/team/optional owner shot list → footage handoff → conditional three-month aim → site/date/payment → logo | All footage belongs to client, owner optional, three months is an aim |
| Presenter | Real examples → dialect/owner distinction →5+1+2 breakdown → five campaign/three retained → script approval/review → logo | Eight total, presenter never owner, three long videos retained |
| Closer | Role brief → own tools/line → role/interview/scripts → month1 then coaching → desk/line/prices → placement/monthly/replacement → logo | Three-month minimum,90-day replacement scope, readiness before search |

## Media and motion

Use offline copies of reviewed example architecture, existing Hosh captures, the genuine Mahara logo, and three supplied presenter clips with their provenance. Original presenter audio stays muted. Known actors may use validated excerpt starts/portraits; their company folder labels never identify the person. Illustration labels stay present wherever examples could be read as results. No synthetic person, new paid imagery, counterfeit analytics, search results or testimonials.

Registry reference remains the reviewed `page-slide` reveal principle. Use brief reading-edge reveals, purposeful page moves and staged factual diagrams. Titles stay still after landing. No arbitrary loops, empty video placeholders, repeated fade-up lists, tiny twenty-image mosaics, generic property backgrounds on every service, long static terms holds or dark empty framing. No unlicensed music is added.

## Verification and limits

Before assembly: source syntax and narrow unit tests covering approval, exact excerpt membership, timing validation, audio hashes, captions, allseven story maps, required media, and fail-closed paths. After the cockpit ship: one EN/AR pair checked and visually reviewed before the full set. Inspect every main cue, text bounds at full size,360px phone sheets, all seams, words/audio alignment and loudness/true peak. Record whether subjective and phone-speaker listening actually occurred; keep those flags false when it did not. Preserve each output version. A prior layout-v2/v3 image never verifies this new builder.

Not in scope: changes to production app code, old Website v4, the approved scripts, subscriptions, provider configuration or publishing.

## First UGC pair commands

These commands are prepared, not executed. Run only after the release/host compute hold is cleared and the audio reviewer provides both exact observed timing paths. Use only the existing three actor clips and local narration. Export `UGC_EN_TIMING` and `UGC_AR_TIMING` to those real files first. The raw films are internal QA artifacts, not finished masters. Never run the old 60-second `render-v4.sh`, `finish.py` or Website `check.py` on these variable-duration films.

```bash
set -euo pipefail
REPO=/home/hermes/upsell-build/releases/offer-studio-all-presentations
TOOL="$REPO/tools/offer-video"
HF=/home/hermes/upsell-build/repo/tools/offer-video/node_modules/.bin/hyperframes
DEPS=/home/hermes/upsell-build/repo/tools/offer-video/node_modules
MEDIA=/home/hermes/upsell-studio-video/website
ACTORS=/home/hermes/upsell-studio-video/all-offers/approved-presenter-examples
PILOT=/home/hermes/upsell-studio-video/all-offers/pilot-ugc-v1
: "${UGC_EN_TIMING:?Set the reviewed English timing.json path}"
: "${UGC_AR_TIMING:?Set the reviewed Arabic timing.json path}"
test -f "$UGC_EN_TIMING" && test -f "$UGC_AR_TIMING"
test ! -e "$PILOT"
python3 -c 'import shutil; assert shutil.disk_usage("/home/hermes").free >= 5*1024**3, "Need at least 5 GiB free"'
mkdir "$PILOT"
status=0
"$HF" doctor --json > "$PILOT/doctor.json" || status=$?
python3 "$TOOL/scripts/local_render_doctor.py" "$PILOT/doctor.json" "$status"
for L in en ar; do
  if [ "$L" = en ]; then TIMING="$UGC_EN_TIMING"; else TIMING="$UGC_AR_TIMING"; fi
  python3 "$TOOL/film/offer_series.py" --kind ugc --lang "$L" \
    --timing "$TIMING" --deps "$DEPS" --media "$MEDIA" --actors "$ACTORS" \
    --out "$PILOT/$L"
  TIMES=$(python3 - "$PILOT/$L/build.json" <<'CUES'
import json,sys
b=json.load(open(sys.argv[1])); points={0,max(0,b["duration"]-1/30)}
for beat in b["beats"]:
    a,z=beat["start"],beat["end"]
    points.update([a,min(a+.3,(a+z)/2),(a+z)/2,max(a,z-1/30)])
print(",".join(f"{t:.3f}" for t in sorted(points)))
CUES
  )
  nice -n 15 "$HF" check "$PILOT/$L" --json --at "$TIMES" --at-transitions \
    > "$PILOT/check-$L.json"
  nice -n 15 "$HF" snapshot "$PILOT/$L" --review --json \
    --output "$PILOT/review-$L" > "$PILOT/snapshot-$L.json"
done
```

Inspect current-source EN and AR beat/phone/seam sheets before proceeding. Resolve real findings; do not discard checks or describe old layouts as current. Then render one language at a time with one browser worker:

```bash
for L in en ar; do
  nice -n 15 "$HF" render "$PILOT/$L" --quality delivery --fps 30 \
    --workers 1 --max-concurrent-renders 1 --strict --no-best-effort \
    --output "$PILOT/raw-$L.mp4" > "$PILOT/render-$L.log" 2>&1
  ffprobe -v error -show_format -show_streams -of json "$PILOT/raw-$L.mp4" \
    > "$PILOT/raw-$L-facts.json"
  nice -n 15 ffmpeg -hide_banner -nostats -i "$PILOT/raw-$L.mp4" \
    -af ebur128=peak=true -f null - > /dev/null 2> "$PILOT/raw-$L-loudness.log"
  TIMES=$(python3 - "$PILOT/$L/build.json" <<'CUES'
import json,sys
b=json.load(open(sys.argv[1]))
print(",".join(f'{(x["start"]+x["end"])/2:.3f}' for x in b["beats"]))
CUES
  )
  python3 "$TOOL/scripts/sheet.py" "$PILOT/rendered-phone-$L.jpg" \
    --cols 3 --width 360 --video "$PILOT/raw-$L.mp4" --at "$TIMES"
done
```

Final audio mastering and manifest packaging must use measured real durations from each build, not 60 seconds. Publication is already authorized; readiness still depends on actual transcript, audio/frame/phone/seam QA and provider verification. Listening flags record the truth.
