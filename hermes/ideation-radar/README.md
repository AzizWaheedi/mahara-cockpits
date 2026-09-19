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

Since 2026-09-18 (Aziz: "flag trends, better Arabic transcripts, Instagram
discovery without handles, the small polishes"):

- Trends: every active row of the last two weeks gets a short format
  descriptor ("before after renovation reveal with text overlay"), the
  descriptors are embedded and clustered, and the same format from three
  accounts or more becomes a trend (`trend_id`, `trend_label`, `trend_n` on
  the rows, a Trends tab and a Trend chip on the board, a block in the
  digest). `radar/trends.py`; the scan runs it after storing, `radar.py
  trends` runs it by hand.
- Speech: ElevenLabs Scribe transcribes first, Groq Whisper second
  (`RADAR_SPEECH_PROVIDER`), and Gemini watches the video with that
  transcript in hand; when both heard speech the speech model's words are
  kept. `radar.py speechtest <url>...` compares the three on real clips.
  Checked on ten TikTok clips from the board on 2026-09-18: Scribe won three
  of the four clips a judge model could score, Gemini one, Whisper none;
  Scribe kept Egyptian dialect and English code switching ("shower rain")
  and returned nothing for the three silent CGI clips where Whisper invented
  "Thank you", the classic hallucination on silence. Gemini's own quota ran
  out during the test (429), which is the reason the chain does not rely
  on it for speech.
- Keyword search targets (Instagram, kind `search`): the search actor lists
  accounts for a keyword such as "ديكور الكويت"; the public ones with 2,000
  followers or more and a reel in the last 90 days get a profile scan like
  hashtag authors, and every account that yields a baseline joins the
  watchlist by itself (source `search`, tag `via:search`), not to be tried
  again for 90 days. `radar.py watchlist add instagram "ديكور الكويت" --kind search`.
- Storyboards: three frames (start, middle, end) side by side replace the
  single still whenever the clip can be fetched; captures reuse their own
  download. Stored as `<platform>/<post_id>.story.jpg`.
- The digest goes to a list of recipients (`RADAR_SLACK_CHANNEL` comma
  separated: Aziz and Sabry).

Since 2026-09-18, later (Aziz: "put a link to any social media", "manually
run a scrape of the Facebook Ads Library", "add our people to the
watchlist", "paid ads that have been running for a long time"):

- On-demand scrapes from the cockpit, through ScrapeCreators
  (`radar/sources/scrapecreators.py`, key `SCRAPECREATORS_API_KEY`, one
  credit per request, credits never expire; USD 47 buys 25,000). The board's
  Scrape box writes a row to `ideation_requests`; the pending cron (every
  two minutes) runs it (`radar/requests.py`, `radar.py requests` by hand):
  - a page (Instagram, TikTok, YouTube, Facebook, Snapchat): about thirty
    recent videos, the ones that beat the page's own normal proposed under
    the locked rule, else its best by views; the account joins the
    watchlist (Instagram, TikTok, Snapchat); the brand's current Meta ads
    are pulled when its Ad Library page matches the handle. About 5 credits.
  - an ad library pull (Meta by page name, Instagram handle, page id or
    keyword; Google by advertiser), one country, active ads only, ranked by
    running days: proposed from 7 days, "study" from 21, "reverse engineer"
    from 60 (`RADAR_ADS_MIN_DAYS`, `_STUDY_DAYS`, `_REVERSE_DAYS`,
    `RADAR_ADS_COUNTRY` KW). About 3 credits. Google ad details are never
    requested (25 credits each); Google rows are image and text only.
- Ads are rows on the board: platform `meta_ads` or `google_ads`, key
  `meta_ads:<ad_archive_id>`, `running_days`, `ad_started_at`,
  `ad_platforms`, `advertiser`, `ad_format`, the Ad Library link as `url`.
  Keeping a Meta ad captures it like any post (fresh media through the
  vendor, then Scribe and Gemini). A YouTube or Facebook video is captured
  from the vendor's transcript plus a text breakdown, no download.
- The watchlist is editable on the board (accounts, hashtags, Instagram
  keyword searches; source `cockpit`), and the creative cockpit's scripting
  database rows and a client's ads carry "Save to Ideation" (origin
  `library`, industry ours, the client on the row, script and numbers when
  the archive has them).
- Checked 2026-09-18 with the research note in the shared context: Meta's
  and Google's libraries are public for Kuwait; TikTok's public library
  covers Europe only and its Creative Center needs a session; Snapchat has
  no commercial library outside Europe. Their organic pages still scrape.

The rule it applies is the one Aziz locked on 2026-05-15: 3x to 5x the
baseline is worth studying, 5x and above is reverse engineered immediately,
below 3x is noise. The baseline is the median of the account's last 30 posts
after these exclusions, recorded with every baseline: the candidate post
itself (leave one out), pinned posts, posts under seven days old (their
counts are still growing), posts of another kind (video against video). At
least eight settled posts are needed for a tier; eight to fourteen is "low"
confidence. The baseline is floored per platform (1,000 views on Instagram
and TikTok, 300 on Snapchat) so a 300-view account does not produce a 10x
from one 3,000-view post, and a floored baseline says so. Nothing under 24
hours is scored; a score before day seven is provisional (checkpoint 24h or
72h), day seven locks it, 30 days catches TikTok late bloomers. A candidate
is proposed only when it also clears a gate: three times the floor in views,
or an engagement rate of 2 percent by views. Each proposal carries a robust
z-score (median and MAD on log views) and reach (views over followers), and
the list ranks reverse-engineer first, then reach, then multiplier, so a tiny
account never outranks a big one. A tiny account that spikes is also flagged
`packaging_only`: it proves packaging, not audience. Sources: 1of10,
ViewStats, vidIQ, OutlierKit, Handler, NIST 1.3.5.17; checked 2026-09-17.

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
| `SCRAPECREATORS_API_KEY` | on-demand page and ad library scrapes from the cockpit (`radar/requests.py`); credits at app.scrapecreators.com |
| `ELEVENLABS_API_KEY` | speech transcription, first choice (Scribe; `ELEVENLABS_API_KEY_V2` in the Hermes key file is a key id, not a key) |
| `GROQ_API_KEY` | speech transcription fallback |
| `OPENAI_API_KEY` | frame vision fallback when Gemini is unavailable |
| `DEEPSEEK_API_KEY` | text breakdown fallback |
| `RADAR_SUPABASE_URL`, `RADAR_SUPABASE_KEY` | the home: the Creative Triage project URL and its service role key (the generic `SUPABASE_URL` in the Hermes key file points at another project, so these are read by their own names) |
| `COCKPIT_IDEATION_URL`, `COCKPIT_IDEATION_TOKEN` | optional mirror into a cockpit door; not used |
| `SLACK_BOT_TOKEN`, `RADAR_SLACK_CHANNEL` | a digest per scan, posted even when nothing was found; one channel or user id, or a comma separated list (Aziz `U09305KE2KS`, Sabry `U0B2SHGS1JA`) |

Settings (all optional): `RADAR_HOME` (default `~/.ideation-radar`),
`RADAR_THRESHOLD` 3, `RADAR_REVERSE_THRESHOLD` 5, `RADAR_SAMPLE` 30,
`RADAR_MIN_N` 8, `RADAR_MIN_AGE_HOURS` 24 (score nothing younger),
`RADAR_MATURE_HOURS` 168 (the tier locks), `RADAR_BASELINE_MIN_AGE_HOURS` 168
(baseline posts must be this old), `RADAR_WINDOW_DAYS` 30,
`RADAR_FLOOR_INSTAGRAM` 1000, `RADAR_FLOOR_TIKTOK` 1000, `RADAR_FLOOR_SNAPCHAT` 300,
`RADAR_MIN_ENGAGEMENT` 0.02, `RADAR_MIN_FOLLOWERS` 2000, `RADAR_HASHTAG_MIN_VIEWS`
10000, `RADAR_HASHTAG_MIN_ENGAGEMENT` 300 (likes plus comments; used instead of
views for a hashtag hit that carries no view count, as Instagram tag pages hide
reel plays from a logged-out fetch; the author's profile scan then supplies real
views), `RADAR_HASHTAG_TOP_K` 10 (authors fetched per hashtag),
`RADAR_HASHTAG_PROFILE_CAP` 20 (per scan), `RADAR_GEMINI_RESOLUTION`
`MEDIA_RESOLUTION_HIGH` (reads small Arabic text cards),
`RADAR_ACTOR_INSTAGRAM` `apify~instagram-scraper` (profiles, single posts and,
by default, hashtags through an explore/tags URL), `RADAR_ACTOR_INSTAGRAM_HASHTAG`
(empty; set `apify~instagram-hashtag-scraper` to use the dedicated actor),
`RADAR_ACTOR_TIKTOK` `clockworks~free-tiktok-scraper` (hashtags and single posts; the
same Clockworks engine and fields as the flagship `tiktok-scraper` at USD 0.002
a result on Starter with no run fee),
`RADAR_ACTOR_TIKTOK_PROFILE` `clockworks~tiktok-profile-scraper` (account scans,
cheaper per row), `RADAR_ACTOR_SNAPCHAT` `tri_angle~snapchat-scraper`
(profiles; the most run Snapchat actor, USD 0.002 a profile), `RADAR_ACTOR_SNAPCHAT_POST`
`tri_angle~snapchat-spotlight-scraper` (a pasted Spotlight link, USD 0.0015),
`RADAR_TIKTOK_MEDIA_STORE` `ideation-radar-media` (the Apify key-value store
that receives a TikTok video for a capture; TikTok media links exist only
through that paid add-on, about USD 0.001 a video), `RADAR_TIKTOK_SUBTITLES`
`DOWNLOAD_SUBTITLES`, `RADAR_SINK` `cockpit` (or `supabase`, or `both` for a deliberate
mirror; one authoritative store is the rule), `RADAR_APIFY_CONCURRENCY` 4,
`RADAR_APIFY_MAX_RUNS` 150 per scan, `RADAR_GEMINI_MODEL` `gemini-3.6-flash` (Google closed 2.5 Flash to new keys on
2026-09-17; `doctor` asks the model one word to prove the key can use it),
`RADAR_TEXT_PROVIDER` `gemini,deepseek,openai`, `RADAR_MAX_DURATION_SEC` 600.

Since 2026-09-18: `RADAR_SEARCH_LIMIT` 20 (accounts listed per keyword),
`RADAR_SEARCH_TOP_K` 8 (profiles scanned per keyword per scan),
`RADAR_SEARCH_PROFILE_CAP` 15 (per scan), `RADAR_SEARCH_RETRY_DAYS` 90,
`RADAR_SEARCH_AUTOWATCH` 1 (accounts with a baseline join the watchlist),
`RADAR_TREND_WINDOW_DAYS` 14, `RADAR_TREND_MIN_AUTHORS` 3,
`RADAR_TREND_SIMILARITY` 0.82 (cosine on the descriptor embeddings),
`RADAR_TREND_MAX_DESCRIBE` 40 (descriptors per run), `RADAR_EMBED_MODEL`
`gemini-embedding-001` with `RADAR_EMBED_DIMS` 256 (`RADAR_OPENAI_EMBED_MODEL`
`text-embedding-3-small` as the fallback), `RADAR_SPEECH_PROVIDER`
`elevenlabs,groq`, `RADAR_ELEVENLABS_STT_MODEL` `scribe_v1`,
`RADAR_ACTOR_INSTAGRAM_SEARCH` `apify~instagram-search-scraper`.

### Three boards, one radar (2026-09-19)

`industry` on the watchlist and on every post is one of three: `ours` (the
clients' construction and design industry, Sabry's board), `mahara`
(Mahara's own competitors and teachers, the CEO cockpit's board) and
`other`. The shared Ideation pages leave `mahara` out unless it is chosen;
the CEO tab pins it. `radar.py watchlist add youtube @handle --industry
mahara` (or a channel link, or a `UC…` id) watches a YouTube channel:
long-form only, the newest thirty videos through `RADAR_ACTOR_YOUTUBE`
(default `streamers~youtube-channel-scraper`, about a tenth of a cent per
video), baseline and 3x/5x rule as everywhere else, floor
`RADAR_FLOOR_YOUTUBE` (default 500 views). The editor desk's Foreplay sync
reads the `#mahara_b2b` board (`FOREPLAY_MAHARA_BOX`) every run and files
its saves under `mahara`, next to the client drop box.

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

Plain cron on the VPS host, as the `hermes` user (verified on 2026-09-17: that
user has Python 3.12, ffmpeg 6.1 and can read the key files). The Supabase
pair and the Slack channel live in `~/.ideation-radar/env` (mode 600), the
code is the repo clone at `~/mahara-cockpits` which the first line refreshes
every Saturday so a pushed fix takes effect at the next run. Every job runs
under a lock so two scans never overlap, and each writes to `cron.log`.
Weekly scan on Saturday 07:07 Kuwait, links pasted in the cockpit every 5
minutes:

```
0 4 * * 6   cd $HOME/mahara-cockpits && git pull -q --ff-only >> $HOME/.ideation-radar/out/cron.log 2>&1
7 4 * * 6   flock -n $HOME/.ideation-radar/scan.lock    bash -c 'set -a; . $HOME/.ideation-radar/env; set +a; cd $HOME/mahara-cockpits/hermes/ideation-radar && python3 radar.py --quiet scan' >> $HOME/.ideation-radar/out/cron.log 2>&1
*/5 * * * * flock -n $HOME/.ideation-radar/pending.lock bash -c 'set -a; . $HOME/.ideation-radar/env; set +a; cd $HOME/mahara-cockpits/hermes/ideation-radar && python3 radar.py --quiet pending' >> $HOME/.ideation-radar/out/cron.log 2>&1
```

`~/.ideation-radar/env` holds `RADAR_SUPABASE_URL`, `RADAR_SUPABASE_KEY` and
`RADAR_SLACK_CHANNEL` (Aziz's Slack user id, so the digest arrives as a DM
like the cockpit alerts). The creative cockpit's smoke check watches the
result: a scan older than eight days or a pasted link waiting over an hour
sends the Slack DM and files the fix job (RUNBOOK.md, "Ideation radar").
After any outage, `python3 radar.py resend` pushes the last scan's proposals
and every captured idea from the local files again; every write is an upsert.

Weekly, not daily: at the Starter rates checked on 2026-09-17 (Instagram
about USD 2.30 per 1,000 rows, TikTok profiles USD 1.00 per 1,000, TikTok
hashtags USD 1.70 per 1,000) a scan of 40 Instagram and 40 TikTok accounts
plus 20 hashtags costs roughly USD 6 to 8, so weekly fits the USD 29 monthly
Apify credit and daily would exhaust it in a week. The old Content Radar
daemon (personal brand watchlist, `/home/aziz/.openclaw`) still runs daily on
the same Apify key; retire it or budget for both.

Hermes's own scheduler can run the same commands in `--no-agent --script`
mode, which keeps working when the model credentials are down (the pattern the
Work Gate and CSM Morning Sheet jobs use), but note it runs inside the Hermes
container, which has its own filesystem: clone the repo there and point the
script path at that clone.

A scan takes roughly the slowest actor run times the number of batches
(`RADAR_APIFY_CONCURRENCY`), typically 10 to 25 minutes for 100 targets. A
capture takes 1 to 4 minutes: the Apify fetch, the download, the model call.

## What a scan writes

- `out/candidates-YYYY-MM-DD.jsonl`: one line per new proposal, the shape
  the cockpit receives (post fields plus `multiplier`, `tier`, `baseline_views`,
  `packaging_only`, `industry`, `tags`, `origin: "scan"`, `status: "proposed"`).
- `out/latest.json`: the whole last report, per target.
- `state.json`: baselines, every post seen with up to 12 view checkpoints,
  proposal status, the last 60 scan records with Apify cost. Written
  atomically. A dry run never touches it.
- Slack digest (when configured), even on a zero day: silence is never
  ambiguous. Since 2026-09-18 it also lists the trends of the fortnight and
  the accounts a keyword search found and now watches.
- Trends, after the rows are stored: `format_label`, `hook_kind`, `topic`,
  `format_vec` on every active row of the window, `trend_*` on the members
  of a trend; the report carries `trends` and `watch_added`.
- Storyboards in the `ideation-stills` bucket for the proposals whose clip
  could be fetched (five minutes of budget per scan), the thumbnail otherwise.

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
`multiplier` and `tier` against the stored baseline. `method.transcribe`
names who heard the words: `elevenlabs:scribe_v1`, `groq:whisper-large-v3`
or `gemini:<model>` when only the video model listened; the capture's
storyboard is built from its own download.

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

## The home: Supabase

Aziz, 2026-09-17: the ideation data lives in Supabase. The tables were created
the same day in the Creative Triage project (`bldgtotkfmhoxmlzowdx`, the
migration plan's "Mahara Core"), all with row security on and no policies,
so only the service key can read or write them:

- `public.ideation_posts`: one row per post, key `platform:postId`
  (`pasted:…` until the radar resolves a pasted link); the scan's proposals,
  the captured transcripts and breakdowns, and the creative director's
  decisions (kept, dismissed, notes) all on the same row.
- `public.ideation_watchlist`: the accounts and hashtags to scan, editable
  from the cockpit later; `radar.py watchlist push` seeds it from the JSON
  file, `watchlist add|remove|list` work on it directly.
- `public.ideation_scans`: one row per scan with counts, cost and warnings.
- `public.ideation_requests`: the cockpit's scrape requests (kind `profile`
  or `ads`, input, params, status queued, running, done or failed, result or
  error), claimed by the pending cron; three failures stay failed.
- Storage bucket `ideation-stills` (private): the cockpit's own copy of each
  post's thumbnail, signed for six hours when the page loads.

Keys by name: the worker reads `RADAR_SUPABASE_URL` and `RADAR_SUPABASE_KEY`
(the service role key; put them in the Hermes key file or a `600` env file
sourced by the cron line). The two cockpits read `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` on their Convex deployments and never send the
key to the browser. Rules the writer follows: a proposal never overwrites a
decision, a captured idea takes over the pasted row it answers, a queued link
is leased for 30 minutes and fails after four tries with the reason.

The DDL that was applied, for reference and for a second environment:

```sql
create table if not exists public.ideation_posts (
  key text primary key,
  platform text not null,
  post_id text,
  url text not null,
  origin text not null default 'scan',
  status text not null default 'proposed',
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  author_handle text, author_name text, author_followers bigint,
  posted_at timestamptz, views bigint, likes bigint, comments bigint, shares bigint, saves bigint,
  caption text, duration_sec numeric, thumb_url text, media_url text,
  target_key text, industry text not null default 'other', tags jsonb not null default '[]'::jsonb,
  baseline_views numeric, baseline_raw numeric, baseline_floored boolean, baseline_n integer,
  baseline_confidence text, baseline_method text, baseline_rules jsonb,
  multiplier numeric, tier text, engagement_rate numeric, reach_rate numeric, robust_z numeric,
  packaging_only boolean, provisional boolean, checkpoint text, scanned_at timestamptz,
  captured_at timestamptz, language text, dialect text, has_speech boolean, voice text,
  transcript text, on_screen_text jsonb not null default '[]'::jsonb, format text, hook jsonb,
  beats jsonb not null default '[]'::jsonb, cta text, why_it_works text, transferable text,
  adaptations jsonb not null default '[]'::jsonb, music text, method jsonb, confidence jsonb,
  warnings jsonb not null default '[]'::jsonb, error text,
  pasted_by text, pasted_by_name text, pasted_at timestamptz, note text,
  saved_by text, saved_by_name text, saved_at timestamptz, saved_note text,
  dismissed_by text, dismissed_at timestamptz, fetching_at timestamptz, attempts integer not null default 0,
  still_path text, still_at timestamptz, still_error text,
  -- 2026-09-18: trends (radar/trends.py)
  format_label text, hook_kind text, topic text, format_vec jsonb,
  trend_id text, trend_label text, trend_n integer, trend_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists ideation_posts_status_at_idx on public.ideation_posts (status, at desc);
create index if not exists ideation_posts_platform_at_idx on public.ideation_posts (platform, at desc);
create index if not exists ideation_posts_trend_idx on public.ideation_posts (trend_id, at desc) where trend_id is not null;
create table if not exists public.ideation_watchlist (
  key text primary key, platform text not null, kind text not null default 'account', value text not null,
  industry text not null default 'other', tags jsonb not null default '[]'::jsonb, active boolean not null default true,
  note text, source text not null default 'manual', added_by text, added_at timestamptz not null default now(),
  last_scanned_at timestamptz, last_status text, baseline_views numeric, baseline_n integer, followers bigint,
  updated_at timestamptz not null default now()
);
create table if not exists public.ideation_requests (
  id text primary key, kind text not null, platform text, input text not null,
  params jsonb not null default '{}'::jsonb, status text not null default 'queued',
  requested_by text, requested_by_name text, created_at timestamptz not null default now(),
  started_at timestamptz, finished_at timestamptz, attempts integer not null default 0,
  result jsonb, error text, updated_at timestamptz not null default now()
);
create index if not exists ideation_requests_status_idx on public.ideation_requests (status, created_at);
-- 2026-09-18, ads and our own ads on ideation_posts:
--   ad_id text, ad_page_id text, advertiser text, ad_started_at timestamptz, ad_last_seen_at timestamptz,
--   running_days integer, ad_platforms jsonb, ad_format text, ad_active boolean, source_request text,
--   client text, spend numeric, leads integer, cpl numeric
create table if not exists public.ideation_scans (
  id bigserial primary key, at timestamptz not null default now(),
  targets integer, scanned integer, failed integer, skipped integer, posts integer,
  candidates_total integer, candidates_new integer, apify_runs integer,
  usage_usd numeric, duration_sec numeric, dry_run boolean,
  warnings jsonb not null default '[]'::jsonb, per_target jsonb not null default '[]'::jsonb, sinks jsonb
);
alter table public.ideation_posts enable row level security;
alter table public.ideation_watchlist enable row level security;
alter table public.ideation_scans enable row level security;
alter table public.ideation_requests enable row level security;
revoke all on table public.ideation_posts, public.ideation_watchlist, public.ideation_scans from anon, authenticated;
```

The cockpit door (`COCKPIT_IDEATION_URL`/`TOKEN`, `RADAR_SINK=cockpit`) is
kept only as a mirror option; nothing needs it now.

## Costs

Every Apify run is billed; the runner records `usageTotalUsd` per run and the
scan digest totals it. List prices checked on 2026-09-17 (Starter plan): an
Instagram row USD 0.0023, a TikTok row USD 0.002, a Snapchat profile USD
0.002 plus USD 0.001 a run, a Spotlight link USD 0.0015, a TikTok video
download USD 0.001. A weekly scan of 40 Instagram and 40 TikTok accounts, 20
Snapchat accounts and 20 hashtags is roughly USD 6 to 9; a capture is well
under one cent of Apify plus a fraction of a cent of Gemini 3.6 Flash for a
30-second clip. Apify is on the Starter plan with a USD 29 monthly credit,
0.49 used on 2026-09-17, shared with the old Content Radar daemon. Fill the
real numbers from the Apify and Google AI consoles after the first month.

## Legal posture (for Aziz to confirm)

Every platform's terms ban automated collection, and Snapchat's also ban
downloading content. The exposure is contractual (blocking, account bans),
not criminal, per the hiQ and Bright Data rulings; the safe posture the
research recommends is: scrape logged out through the vendor only, never with
staff accounts, keep the data internal, never send an item to a client, keep
only the still, the transcript, the metrics and the link (the video file is
deleted after the model call unless `--keep-media` is passed), store only the
creator's handle and follower count, and delete on request.

## Before trusting the numbers: five cheap runs

Research on 2026-09-17 verified the actor prices and field names from the
actors' own pages, but nobody has run them on Gulf accounts yet. Each of
these costs cents; run them from the VPS and read the raw items in
`out/dry/latest.json`:

1. `radar.py scan --dry-run --only <one Instagram account>`: does the profile
   run return 30 posts with `videoPlayCount`, and does the weekly "details"
   run return `followersCount` (a third-party actor reported that Instagram
   cut logged-out follower counts on 2 September 2026)?
2. `radar.py scan --dry-run --only <one Instagram hashtag>`: are hashtag
   posts "top" or "recent"? The actor's README says recent.
3. `radar.py scan --dry-run --only <one TikTok account>`: `playCount`,
   `authorMeta.fans` and `createTimeISO` present, `mediaUrls` empty (expected
   without the download add-on).
4. `radar.py capture <one TikTok link> --dry-run`: the download add-on
   returns a link in `mediaUrls`, subtitles arrive, Gemini reads the clip.
5. `radar.py scan --dry-run --only <one Snapchat account>`: how many
   spotlights have a visible view count (on four of five Gulf contractor
   profiles tested by hand, most were hidden).

Then a 20-clip Kuwaiti bake-off (10 spoken, 10 silent motion graphics)
judged by Sabry before the transcription model is locked: no vendor
publishes Gulf-dialect accuracy.

## Known limits

- Snapchat: Spotlight clips only. Stories have no public view count anywhere,
  subscriber counts show as "0" (hidden) on most Gulf business profiles, only
  the latest 18 or 19 Spotlights are exposed without login, and most clips on
  Gulf contractor profiles had a hidden view count in the 2026-09-17 check. So
  the Snapchat scan flags the few clips that broke out; it does not compute a
  clean per-account baseline. Hashtags need another actor and are not wired.
- Instagram follower counts come from a separate "details" run per account,
  refreshed weekly, so the first scan costs about two runs per Instagram
  account. Hashtag hits on Instagram carry no follower count, so their reach
  cannot be judged until the author's profile is fetched.
- Trends are as good as the descriptors: a proposal the radar never watched
  is labelled from its caption and storyboard only, so two videos of the
  same format with unlike captions can miss each other, and the threshold
  (`RADAR_TREND_SIMILARITY`) trades that against false trends. A trend needs
  three distinct accounts inside 14 days; two is a coincidence.
- The Gemini key has a daily quota. A burst of calls (the speech test plus
  the first trend run on 2026-09-18) exhausted it with "exceeded your
  current quota" (429) and "high demand" (503). Everything degrades rather
  than stops: captures use Scribe plus OpenAI frames plus DeepSeek and say
  so in `method`, trend descriptors use OpenAI, embeddings use OpenAI (a
  vector carries its provider, so vectors from the two spaces never
  compare). Billing on the Google AI Studio project removes the ceiling.
- ElevenLabs Scribe on the key's plan: the Hermes key is on the free plan
  (checked 2026-09-18), where speech to text is metered separately from
  the character quota. If Scribe starts answering 402 or 429, the chain
  drops to Whisper by itself and `method.transcribe` says so; upgrade the
  plan or set `RADAR_SPEECH_PROVIDER=groq`.
- Keyword search finds accounts, not posts: the search actor lists at most
  20 accounts per keyword with their latest posts, and only public accounts
  with 2,000 followers or more and a recent reel are scanned. Junk that
  slips through is one `radar.py watchlist remove instagram <handle>` away
  (auto-added rows carry source `search`).
- Instagram hashtags do not discover authors. Checked with paid runs on
  2026-09-17: both `apify~instagram-scraper` (explore/tags URL) and
  `apify~instagram-hashtag-scraper` return the tag's recent stream only, posts
  minutes old, mostly photos and carousels, zero likes, no view counts; the
  "details" result type returns statistics only, no top posts. The engagement
  floor (`RADAR_HASHTAG_MIN_ENGAGEMENT`) is kept for the day an actor returns
  top posts. Until then Instagram proposals come from watched accounts, whose
  profile scans carry reel plays. TikTok hashtags work as designed.
- The video model reads on-screen Arabic well but transcripts of dialect
  speech can mishear words: the idea carries a confidence and the transcript
  should never be quoted as fact without listening.
- CDN media links from the platforms expire within hours or days. The idea
  keeps the link for reference; the cockpit stores its own still.
