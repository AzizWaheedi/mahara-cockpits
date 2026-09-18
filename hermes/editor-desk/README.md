# Editor desk

Everything around the edit, nothing inside it.

Aziz, 2026-09-18: *"generation and actual cutting and editing keep it to them,
just the rest to make them more efficient."* So this worker finds an editor's
footage, reads it, transcribes it with word timings, maps the shots, checks the
cut that comes back, and delivers it. It builds no timeline, generates no clip
and burns in no caption. The cut belongs to the editor.

The jobs stay in ClickUp. The desk reads the Video Pipeline, writes what it
learned back as a comment, and touches exactly two fields: the Edited Video
Link and the status. Nothing is posted to any platform.

## What it does

| Command | What happens |
|---|---|
| `doctor` | every key, binary, disk and service, with the blocker named |
| `sync` | the ClickUp Video Pipeline into `editor_jobs`, plus the client card behind each job: the tag on a video card is the client, and Clients - Mahara is where the brand work lives |
| `prepare` | for each video in the job's Drive folder: read it, transcribe the speech with word timings, find the shot boundaries, take a three-frame storyboard, note where each script line was said, then say whether the job is ready to start or what is blocking it |
| `check` | read a cut the editor uploaded: shape, length, loudness, and the export's own transcript against the approved script, so a missing line is caught before the client sees it |
| `deliver` | write the Edited Video Link and move the card to client review |
| `requests` | carry out what the cockpit asked for: deliver, check, comment, rescan |
| `notes` | pull the card's comments in as timestamped notes |
| `jobs` | what is open, who owns it, and what is blocking each one |

## The brief is on the client card, not the video card

Aziz, 2026-09-18: *"the tag on the task is the client and aligns with the
clients board in clickup with all the docs."*

Every one of the six live video cards has an empty description, so the desk
was reporting "no brief" on all of them and it was reporting the wrong thing.
What an editor needs is on the client's card on Clients - Mahara (`901816559981`),
the same spine the other three cockpits read: the Do's and Don'ts, the Brand
DNA document and the Offer Cheat Sheet. Measured on 2026-09-18, the five open
jobs carry between 569 and 1,404 characters of do's and don'ts, about 10,000
of Brand DNA and between 8,500 and 23,700 of offer sheet each.

The join is the tag, and the matching is deliberately plain: a name becomes a
small set of forms (itself, without a trailing company word, its first word,
and with the spaces squeezed out) and two names match when their sets overlap.
So a card tagged `alkhalil` finds the company called `Alkhalil`. Exact name
wins first, a generic word like "design" never carries a match on its own, and
when the match is wrong it is visible on the job rather than buried in a score.

A client card that cannot be found never blocks a job. It is a note on the
job, because an editor with footage and a script can still cut.

One trap worth recording: a ClickUp dropdown's value is an index, and index 0
is a real choice. Reading it as falsy is how a first probe decided two live
clients had no Client Status and lost them.

## Why a transcript is the point

An editor opening a forty minute Gulf Arabic shoot scrubs it to find the three
usable minutes. With word timings they search text and jump to the second.
ElevenLabs Scribe reads Gulf Arabic best of the three engines we tested on
2026-09-18 (ten clips from the ideation board: Scribe won three of the four a
judge could score, Gemini one, Whisper none, and Whisper invented "Thank you"
on silent clips). Groq Whisper is the fallback; the order is
`DESK_SPEECH_PROVIDER`.

Scribe costs about USD 0.22 an hour of audio, so a forty minute shoot is about
fifteen cents.

## Install on the VPS

```bash
ssh 187.77.156.166                      # as hermes
cd ~/mahara-cockpits && git pull -q --ff-only
mkdir -p ~/.editor-desk && chmod 700 ~/.editor-desk
cat > ~/.editor-desk/env <<'EOF'
DESK_SUPABASE_URL=https://bldgtotkfmhoxmlzowdx.supabase.co
DESK_SUPABASE_KEY=<the service role key>
EOF
chmod 600 ~/.editor-desk/env
cd hermes/editor-desk
set -a; . ~/.editor-desk/env; set +a
# once: the private bucket the storyboards go into
curl -s -X POST "$DESK_SUPABASE_URL/storage/v1/bucket" \
  -H "Authorization: Bearer $DESK_SUPABASE_KEY" -H "apikey: $DESK_SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id":"editor-stills","name":"editor-stills","public":false}'
python3 desk.py doctor
```

Everything else is already on the box by name: `CLICKUP_API_KEY`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (full Drive
scope, checked 2026-09-18), `ELEVENLABS_API_KEY`, `GROQ_API_KEY`.

### Cron

```
2,32 * * * *  flock -n $HOME/.editor-desk/sync.lock    bash -c "set -a; . $HOME/.editor-desk/env; set +a; cd $HOME/mahara-cockpits/hermes/editor-desk && python3 desk.py --quiet sync"   >> $HOME/.editor-desk/out/cron.log 2>&1
7,37 * * * *  flock -n $HOME/.editor-desk/prepare.lock bash -c "set -a; . $HOME/.editor-desk/env; set +a; cd $HOME/mahara-cockpits/hermes/editor-desk && python3 desk.py --quiet prepare" >> $HOME/.editor-desk/out/cron.log 2>&1
*/3 * * * *   flock -n $HOME/.editor-desk/requests.lock bash -c "set -a; . $HOME/.editor-desk/env; set +a; cd $HOME/mahara-cockpits/hermes/editor-desk && python3 desk.py --quiet requests" >> $HOME/.editor-desk/out/cron.log 2>&1
17 * * * *    flock -n $HOME/.editor-desk/notes.lock   bash -c "set -a; . $HOME/.editor-desk/env; set +a; cd $HOME/mahara-cockpits/hermes/editor-desk && python3 desk.py --quiet notes"   >> $HOME/.editor-desk/out/cron.log 2>&1
```

Sync every half hour, prepare every half hour offset from it, notes hourly,
and the cockpit's queue every three minutes so a person pressing "send to
client review" does not wait. Each under its own lock, so a long read never
overlaps itself.

## Settings

Read by name from the environment, then `/opt/data/bibi/api-keys.env` and
`/opt/data/.env`. Never printed.

`DESK_HOME` (default `~/.editor-desk`), `DESK_MAX_FILES` 12 per job,
`DESK_MAX_FILE_BYTES` 3 GB, `DESK_MAX_TRANSCRIBE_SEC` 5400 (90 minutes),
`DESK_MAX_JOBS` 3 per run, `DESK_SCENE_THRESHOLD` 0.35, `DESK_STILLS` 3,
`DESK_HOOK_WINDOW` 3, `DESK_LOUDNESS_TARGET` -14 with tolerance 3,
`DESK_RATIO_TOLERANCE` 0.02, `DESK_REQUIRE_SCRIPT` 0,
`DESK_SPEECH_PROVIDER` `elevenlabs,groq`, `DESK_CLICKUP_WRITEBACK` 1.

## The home: Supabase

Four tables in the Creative Triage project (`bldgtotkfmhoxmlzowdx`), row
security on with no policies, so only the service key reaches them.

- `editor_jobs`: one row per ClickUp card plus what the worker learned
  (`state` new, stale, ready, blocked, delivered; `ready`; `missing`, the plain
  sentences shown to a person).
- `editor_assets`: one row per video, with `transcript`, `words` (word
  timings), `scenes`, `script_hits`, `preview_url` and `still_path`.
- `editor_versions`: one row per uploaded cut with its `checks` report.
- `editor_notes`: timestamped feedback, from the cockpit or pulled from ClickUp.
- `editor_clients`: one row per company on Clients - Mahara, with its brand
  documents read in as text.
- `editor_requests`: what the cockpit asked for and what became of it.
- `editor_people`: who may open the cockpit. Row security everywhere is a
  single policy calling `public.is_editor()`, which is true only for an active
  address in this table, so the browser's anon key reads nothing on its own.

Storage bucket `editor-stills` holds the three-frame storyboards. No proxies
are stored anywhere: Drive already plays video in its own preview frame, so the
cockpit embeds that and the desk moves no bytes it does not have to.

## Rules it follows

- Jobs live in ClickUp. The desk mirrors them and writes back only the edited
  link, the status and comments.
- Checks are advice with a reason, never a gate.
- Nothing is corrected in place. Loudness is measured and reported; the file
  the editor made is the file that ships.
- Every step is bounded: files per job, bytes per file, minutes transcribed,
  jobs per run, and a disk floor so a download can never fill the box.
- A file already read is skipped unless `--force`. A failure is recorded with
  its reason and retried, up to four attempts.
- Keys by name, never printed; every error is scrubbed before it is logged,
  stored or posted to a card.

## What the footage actually is here, measured 2026-09-18

The first real run across all five open jobs found something worth knowing
before anyone expects too much of the transcript. Mahara's footage is mostly
silent: architectural animations, site b-roll and phone clips over music.

| Job | Files | Total |
|---|---|---|
| ardon | 11 | 4.8 min |
| castello industries | 4 | 1.4 min |
| qatar technology | 4 | 1.2 min |
| marble and more | 0 | nothing in the folder |
| alkhalil | 0 | nothing in the folder |

The longest clip, an 84 second commercial building animation, contains music
and no speech. Both engines were run against it through the same code path:
Scribe returned nothing, which is correct, and Whisper returned
`🎵 🎵 © BF-WATCH TV 2021 Thank you. Thank you.`, which is the invented-text
failure this order was chosen to avoid.

So on this corpus the transcript is not the win the research promised; it
will pay on interviews and testimonials when they are shot. What pays today
is the readiness check (two of five open jobs have no footage at all in the
linked folder, which an editor would otherwise discover by opening the job),
the shot map, and the storyboards.

## Known limits

- The ClickUp field ids are pinned in `desk/config.py` (read live 2026-09-18).
  Renaming a field on the board is safe; deleting one is reported by `doctor`.
- Google's OAuth refresh token is the Drive path. If it is ever revoked, every
  job turns blocked with "the footage link could not be opened" and `doctor`
  says so on the `google token` line.
- A file over 3 GB is recorded with its reason and not downloaded. The editor
  opens it in their own app; the desk is not the place to move a 20 GB rush.
- Only the first 90 minutes of a long file are transcribed, and the note says
  so on the asset.
- Shot boundaries come from ffmpeg's scene score, which is a hint for
  navigation, not a cut list. It is never exported as one.
- The script matcher is a plain run of words. It is explainable and its
  mistakes are visible, which is the point; it marks material and never
  selects it.

## The cockpit

`apps/video-editor-cockpit` is the screen for all of this. It reads Supabase
directly with the anon key and holds no other credential: anything that has to
touch ClickUp or Drive is written to `editor_requests` and drained here by
`desk.py requests`. A request is claimed with a conditional update before it is
acted on, so the same delivery is never written twice, and a failure records
its reason and stops after four tries.

## Tests

```bash
cd hermes/editor-desk && python3 -m unittest discover -s tests -t .
```

Forty-one tests, no network: the board parser, the readiness rules, the script
matcher, the export checks, and the client matcher, the request
queue, and the prepare flow against a fake Drive, Supabase and ClickUp,
including the second run that downloads nothing twice, the oversized file that
is recorded rather than fetched, and the delivery that must never be written
to the board twice.
