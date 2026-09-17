# Ideation radar

Finds outlier short videos on Instagram, TikTok and Snapchat for the creative
director, and turns a pasted link into a transcript and a breakdown he can
ideate from. Two commands do the work, on a schedule, with no model agent in
the loop:

- `scan`: for every account and hashtag on the watchlist, fetch the last 30
  posts through Apify, compute the account's normal (a trimmed median of views),
  flag posts at 3x or more, and propose the new ones.
- `capture <url>`: fetch one post's metadata and video, watch it with a video
  model (speech and on-screen text, because half of Gulf ads are silent motion
  graphics), and save the structured breakdown: hook, beats, format, language
  and dialect, why it works, how a construction or design firm could use it.

The rule it applies is the one Aziz locked on 2026-05-15: 3x to 5x the
baseline is worth studying, 5x and above is reverse engineered immediately,
below 3x is noise. The baseline is the trimmed median of the account's last
30 posts, excluding pinned posts and anything younger than 48 hours (a fresh
post has not collected its views yet). A tiny account that spikes is flagged
`packaging_only`: it proves packaging, not audience.

## Why this shape

- **Deterministic, standard library only.** It runs on the VPS's system
  Python 3.12 with nothing to install, and it keeps running when the Hermes
  model credentials are down (on 2026-09-17 every model-backed Hermes job
  was failing while the script-mode jobs kept working). Hermes can schedule it
  in `--no-agent` script mode, or plain cron can.
- **Apify first** for Instagram and TikTok (Aziz, 2026-05-15: direct scraping
  from the VPS is blocked; always use Apify). The actor ids, their inputs and
  their output field names live in `radar/platforms/*.py` and in
  environment overrides, so a renamed actor field is a one-line change and a
  missing field degrades to a warning, never a crash.
- **Video model first, fallbacks after.** Gemini reads frames and audio in one
  call and returns the structured breakdown. Without a Gemini key, or when the
  call fails, it falls back to Groq Whisper for speech plus sampled frames
  read by an image model for on-screen text, then a text model for the
  breakdown. Every idea records which method produced which field and a
  confidence, so nothing is shown as more certain than it is.
- **Every result is written locally first** (JSONL under the output folder),
  then to the cockpit bridge and optionally to a Supabase table. A remote
  store being down never loses a scan.

## Files

```
radar.py                  the command line
radar/config.py           every knob and every key name
radar/urls.py             pasted link -> (platform, post id, canonical url)
radar/outliers.py         trimmed median baseline, multiplier, tiers, age gate
radar/scan.py             the scheduled scan
radar/capture.py          one link -> idea
radar/understand.py       Gemini video, Whisper, frame vision, text fallback
radar/apify.py            actor runs with bounded concurrency and cost counting
radar/platforms/          instagram.py, tiktok.py, snapchat.py adapters
radar/sinks.py            jsonl, cockpit bridge, Supabase, Slack digest
radar/state.py            durable state (seen posts, baselines, scan log)
tests/                    python3 -m unittest discover -s tests -t .
```

## Keys and settings

Read by name from the environment, then from `/opt/data/bibi/api-keys.env`
and `/opt/data/.env` (the Hermes key files). Never printed.

| Name | Needed for |
|---|---|
| `APIFY_API_KEY` | scans and captures (required) |
| `GOOGLE_AI_API_KEY` | video understanding (preferred) |
| `GROQ_API_KEY` | speech transcription fallback |
| `OPENAI_API_KEY` | frame vision fallback when Gemini is unavailable |
| `DEEPSEEK_API_KEY` | text breakdown fallback |
| `COCKPIT_IDEATION_URL`, `COCKPIT_IDEATION_TOKEN` | the creative director cockpit's dedicated `/ideation` door (`https://colorful-wombat-644.convex.site/ideation`, token `IDEATION_TOKEN` on that deployment): pushes proposals and ideas, pulls links pasted there |
| `RADAR_SUPABASE_URL`, `RADAR_SUPABASE_KEY`, `RADAR_SUPABASE_TABLE` | optional Supabase table; opt-in only (the generic `SUPABASE_URL` in the Hermes key file points at another project) |
| `SLACK_BOT_TOKEN`, `RADAR_SLACK_CHANNEL` | a digest line per scan, posted even when nothing was found |

Settings (all optional): `RADAR_HOME` (default `~/.ideation-radar`),
`RADAR_THRESHOLD` 3, `RADAR_REVERSE_THRESHOLD` 5, `RADAR_SAMPLE` 30,
`RADAR_TRIM` 0.1, `RADAR_MIN_N` 5, `RADAR_MIN_AGE_HOURS` 48,
`RADAR_WINDOW_DAYS` 30, `RADAR_MIN_FOLLOWERS` 2000,
`RADAR_ACTOR_INSTAGRAM` `apify~instagram-scraper`,
`RADAR_ACTOR_INSTAGRAM_HASHTAG` `apify~instagram-hashtag-scraper`,
`RADAR_ACTOR_TIKTOK` `clockworks~tiktok-scraper`, `RADAR_ACTOR_SNAPCHAT`
(empty: Snapchat scans off), `RADAR_APIFY_CONCURRENCY` 4,
`RADAR_APIFY_MAX_RUNS` 150 per scan, `RADAR_GEMINI_MODEL` `gemini-2.5-flash`,
`RADAR_TEXT_PROVIDER` `gemini,deepseek,openai`, `RADAR_MAX_DURATION_SEC` 600.

## Install on the VPS

```bash
# as the user that will run the cron (the host has python3 3.12 and ffmpeg 6.1)
git clone https://github.com/AzizWaheedi/mahara-cockpits.git ~/mahara-cockpits   # or pull
cd ~/mahara-cockpits/hermes/ideation-radar
mkdir -p ~/.ideation-radar && cp watchlist.example.json ~/.ideation-radar/watchlist.json
python3 radar.py doctor            # every key by name, ffmpeg, Apify login, Gemini model, bridge, Slack
python3 radar.py scan --dry-run    # first scan writes only to ~/.ideation-radar/out/dry/
python3 radar.py scan              # real scan: state, JSONL, bridge, Slack
python3 radar.py capture "https://www.instagram.com/reel/..." --by sabry@maharamedia.com --industry ours
```

`doctor` exits non-zero on a blocker (no Apify key or Apify refuses the token).
Run it once after every key change.

### Schedule

Hermes, script mode (survives model outages; the pattern the Work Gate and
CSM Morning Sheet jobs use):

```
hermes cron add --name "Ideation radar scan" --schedule "7 4 * * *" --no-agent \
  --script "cd ~/mahara-cockpits/hermes/ideation-radar && python3 radar.py --quiet scan"
hermes cron add --name "Ideation radar captures" --schedule "*/5 * * * *" --no-agent \
  --script "cd ~/mahara-cockpits/hermes/ideation-radar && python3 radar.py --quiet pending"
```

Or plain cron on the host (07:07 Kuwait for the scan, every 5 minutes for
links pasted in the cockpit):

```
7 4 * * *   cd $HOME/mahara-cockpits/hermes/ideation-radar && python3 radar.py --quiet scan >> $HOME/.ideation-radar/out/cron.log 2>&1
*/5 * * * * cd $HOME/mahara-cockpits/hermes/ideation-radar && python3 radar.py --quiet pending >> $HOME/.ideation-radar/out/cron.log 2>&1
```

A scan of 100 accounts takes roughly as long as the slowest actor run times
the number of batches (`RADAR_APIFY_CONCURRENCY`), typically 10 to 25
minutes. A capture takes 1 to 4 minutes: the Apify fetch, the download, the
model call.

## What a scan writes

- `out/candidates-YYYY-MM-DD.jsonl`: one line per new proposal, the shape
  the cockpit receives (post fields plus `multiplier`, `tier`, `baseline_views`,
  `packaging_only`, `industry`, `tags`, `origin: "scan"`, `status: "proposed"`).
- `out/latest.json`: the whole last report, per target.
- `state.json`: baselines, every post seen with up to 12 view checkpoints,
  proposal status, the last 60 scan records with Apify cost. Written
  atomically. A dry run never touches it.
- Slack digest (when configured), even on a zero day: silence is never
  ambiguous.

Failure rules: an empty or failed fetch keeps the previous baseline and is
counted as a failure for that target; a target that returns under half its
usual number of posts is reported; a run cap (`RADAR_APIFY_MAX_RUNS`) stops a
runaway scan; the scan never proposes the same post twice.

## What a capture writes

`out/ideas.jsonl` gets one line per capture, status `captured` or `failed`
with the reason, in the `Idea` shape (`radar/models.py`): metadata and
metrics at capture time, `language`, `dialect`, `has_speech`, `voice`
(voiceover, text on screen, both, silent), `transcript` verbatim in the
original language, `on_screen_text` with seconds, `format`, `hook` (text and
type), `beats` (hook, problem, mechanism, proof, offer, cta), `cta`,
`why_it_works`, `transferable`, `adaptations`, `method`, `confidence`,
`warnings`. When the author is on the watchlist the idea also carries its
`multiplier` and `tier` against the stored baseline.

## The cockpit door

The creative director cockpit gets a dedicated `POST /ideation` route with
its own bearer token (`IDEATION_TOKEN` on that deployment), separate from the
general `/bridge` door whose token can rewrite every mirrored table. The
route accepts `{fn, args}` and answers `{ok, data}` like the bridge. Four
functions:

| fn | args | what it does |
|---|---|---|
| `storeIdeationCandidates` | `{rows}` up to 40 | upsert proposals by `key` (platform:post id); never deletes; keeps a row's cockpit status (saved, dismissed) if already set |
| `storeIdeationIdeas` | `{rows}` up to 40 | upsert captured ideas by `key`; a row may carry `cockpit_id` to match a link pasted in the cockpit |
| `ideationPending` | `{limit}` | links pasted in the cockpit that are still `queued`: `[{id, url, savedBy, note, industry, tags}]`; marks them `fetching` |
| `ideationPing` | `{}` | returns `{ok: true}`; used by `doctor` |

`capture` marks a pasted link `failed` with the reason instead of leaving a
spinner, so the tab can show why.

## Supabase (optional, for the move off Convex)

```sql
create table if not exists public.ideation_posts (
  key text primary key,
  platform text not null,
  post_id text not null,
  url text not null,
  origin text not null,            -- scan | manual
  status text not null,            -- proposed | captured | failed | saved | dismissed
  author_handle text, author_name text, author_followers bigint,
  posted_at timestamptz, views bigint, likes bigint, comments bigint, shares bigint, saves bigint,
  caption text, duration_sec numeric, thumb_url text, media_url text,
  industry text, tags jsonb default '[]', saved_by text, note text,
  target_key text, baseline_views numeric, baseline_n int, baseline_method text,
  multiplier numeric, tier text, engagement_rate numeric, packaging_only boolean,
  scanned_at timestamptz, captured_at timestamptz,
  language text, dialect text, has_speech boolean, voice text,
  transcript text, on_screen_text jsonb default '[]', format text, hook jsonb, beats jsonb default '[]',
  cta text, why_it_works text, transferable text, adaptations jsonb default '[]', music text,
  method jsonb, confidence jsonb, warnings jsonb default '[]', error text,
  cockpit_id text,
  updated_at timestamptz default now()
);
create index if not exists ideation_posts_status_idx on public.ideation_posts (status, scanned_at desc);
create index if not exists ideation_posts_platform_idx on public.ideation_posts (platform, captured_at desc);
alter table public.ideation_posts enable row level security;   -- service role writes; add read policies for the cockpit
```

The script upserts with `on_conflict=key`. Keep the table out of anonymous
reach: the 2026-09-17 migration plan already flagged views and tables in the
Creative Triage project with anonymous grants.

## Costs

Every Apify run is billed; the runner records `usageTotalUsd` per run and the
scan digest totals it. Model calls are billed per token or minute of audio.
Fill the actual numbers from the Apify console and the Google AI console
after the first week; the research notes in the shared context repo carry
the published list prices at the time of writing.

## Known limits

- Snapchat has no verified Apify actor. Profile scans are off until
  `RADAR_ACTOR_SNAPCHAT` is set to one; a pasted Spotlight or story link is
  read from the public page and carries a warning about missing counts.
- Instagram follower counts come from a separate "details" run per account,
  refreshed weekly, so the first scan costs about two runs per Instagram
  account.
- The video model reads on-screen Arabic well but transcripts of dialect
  speech can mishear words: the idea carries a confidence and the transcript
  should never be quoted as fact without listening.
- CDN media links from the platforms expire within hours or days. The idea
  keeps the link for reference; the cockpit stores its own still.
