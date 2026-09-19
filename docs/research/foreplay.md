# Foreplay: how we use it

Aziz chose Foreplay on 2026-09-19. This is what its API actually is, what we
built against it, and what is still needed.

## What the API is, verified from their own spec

`https://public.api.foreplay.co/openapi.json`, version 0.26.2b, read 2026-09-19.

**Twenty-two endpoints, every one a GET.** Bearer auth. There is no way to
push an ad in: saving happens in their Chrome extension, or by pointing
Spyder at a brand's Ad Library page. Plan around that rather than against it.

The ones that matter to us:

| Endpoint | Why |
|---|---|
| `/api/boards`, `/api/board/ads` | a board per client, which is how agencies use it |
| `/api/swipefile/ads` | everything saved, with filters |
| `/api/spyder/brands`, `/api/spyder/brand/ads` | brands tracked automatically, daily |
| `/api/brand/analytics` | how long a brand's ads have been running |
| `/api/usage` | credits left |

An ad comes back with 34 fields. Two are worth more than the rest:

- **`running_duration`** — days on air. The strongest single signal that an
  ad is working, and the one thing the Meta Ad Library stops telling you the
  moment an ad ends.
- **`timestamped_transcription`** — what was said and when. That is what a
  script is actually built from, and it is the thing our own footage cannot
  give us, because most of it is silent.

Also useful here: `languages` and `market_target`, so Arabic and Gulf ads can
be filtered rather than hunted for.

## The MCP endpoint

`https://public.api.foreplay.co/mcp`, live, bearer auth (a bare request
answers `401 Missing bearer access token`). It is the same read-only surface,
shaped for an assistant.

`.mcp.json` at the repo root wires it up. It reads `FOREPLAY_API_KEY` from
the environment, so no key is committed:

```bash
export FOREPLAY_API_KEY=...   # then restart Claude Code
```

What it is for: writing scripts. An assistant can search the discovery
library, read a client's board and pull the timestamped transcript of an ad
that worked, without anybody copying anything between tabs. This is the half
of Foreplay that suits the way Sabry and Karim work.

## What we built

`hermes/editor-desk/desk/foreplay.py` mirrors the boards and the swipe file
into `foreplay_ads` in Supabase, and the editor cockpit reads that at
`/editor/swipe`, sorted by days on air.

Mirroring rather than calling live buys three things: the cockpit needs no
Foreplay key in the browser, the board still reads when Foreplay is down, and
if the subscription ever lapses the ads we already saw are still ours.
**MagicBrief, which was bigger and funded, shut down on 31 July 2026 without
saying publicly what happened to customers' saved libraries.** That is the
reason no vendor is the system of record here.

Run it with `python3 desk.py foreplay`; `doctor` reports whether the key is
set. Six tests cover the mapping, including the null-heavy shape their schema
actually returns.

## The API is metered, and that changes the sync

**One ad returned is one credit. The plan includes 10,000 a month, 20,000 on
annual, granted upfront.** A nightly sync that re-read a 1,000-ad library
would spend 30,000 a month against a 10,000 allowance, so the first version
of this was wrong and was rewritten before it ever ran.

What it does now: reads the balance first and refuses below a 500-credit
floor, asks for the most recently saved ads first, and stops the moment a
page holds nothing new. On a normal week that is one page. `--full` walks
the whole library and is for the first run only. Seven tests hold those
guards, including the case where the balance cannot be read at all, which
must not be treated as "none left".

## What the reviews say, and the two corrections that matter

Read 2026-09-19 across G2 (127 reviews, 4.8), Trustpilot and Reddit.

**Permanence is confirmed by their own FAQ**, which is the thing that
mattered: *"Even if the ad library link of the ad you saved expires it will
be available in your Swipe File forever."* Per-ad download of the video, and
board-level bulk download as a ZIP. No report anywhere of a saved video
disappearing or a thumbnail breaking. That is the claim we needed to hold.

**The cost is lower than I first said, if Spyder is the point.** I quoted
about $1,400 a month for 30 clients. That assumed Lens, their analytics
product, for every client. If what you want is Spyder watching your clients'
Ad Library pages, **Agency covers 50 Spyder brands at $389 a month on annual
billing** and 30 clients fits inside it. Lens is the expensive axis at $50
per brand beyond ten, and we already have the performance numbers.

Smaller things worth knowing: the trial now takes a card, although the
pricing page still says otherwise; the commonest complaint on G2 is simply
"expensive", seven mentions; the Chrome extension occasionally stops for a
few minutes; and the discovery feed carries low-quality ads that cannot be
filtered out.

**On the other two.** Motion locks you into three months, needs one workspace
per client with no report spanning them, exports GIFs rather than video, and
documents that age or geo restricted ads never appear in Brand Intel, which
is a live risk for Gulf advertisers. Atria has a run of billing complaints on
Trustpilot, five of seven reviews at one star, mostly about being upgraded
and charged during a trial.

## What it is good at here, and what it is not

Checked 2026-09-19 against their own FAQ and their OpenAPI spec.

**Their Discovery library is not a crawl.** Foreplay's own words: *"Ads added
to the Foreplay inspiration library are those saved from other users on the
platform... it only displays winning ads that have been saved by our users."*
Their users are overwhelmingly American and European direct-to-consumer
brands, so searching it for Gulf construction and engineering ads will
return very little. There is also **no country filter** anywhere in the
discovery API: the parameters are language, niche, format, platform, market
target and dates, and `country` appears only as a breakdown on your own
connected account. Arabic is in the language list, which helps, but Arabic is
not the same as Kuwait.

**Spyder is a different mechanism and it is the one we want.** It tracks a
named brand by reading the Meta Ad Library for that page, so it works for any
advertiser we can name. Our own 30 clients are exactly that: named. We are
not discovering anybody, we are watching people we already know.

So the shape of the purchase is: **Spyder, boards and permanence, not
Discovery and not Lens.** That is also the cheap half.

**And we already have the better tool for Gulf discovery.** The ideation
radar reads the Meta Ad Library and ScrapeCreators directly, which is where
Gulf commercial ads actually are. The Ad Library web interface covers all six
GCC countries with Arabic keyword search; Foreplay's own library does not
reach them.

## The API is on the cheapest tier, so the plan costs less again

Verified from their own spec and pricing on 2026-09-19: **the REST API and
the MCP server are included on every plan, Basic at $59 a month included.**
Everything built here runs on that tier. Agency at $389 annual is only
needed if Spyder is watching all 30 clients; the integration itself is not
what forces the tier.

Also worth knowing before paying anything: **Motion's Creative Research,
which includes a swipe file, is free forever with no card.** Their $750 tier
is the analytics, which we do not need because the media buyer cockpit
already has the numbers. It costs nothing to try the free half first.

## The one thing that does not work for us

**Their transcription is English in practice.** The API exposes
`full_transcription` and `timestamped_transcription` and the language filter
does list Arabic, but their own feedback board carries an unresolved report
that a French video was transcribed into English automatically. For an
agency whose ads are Gulf Arabic, do not plan on their transcripts.

We are not short of transcription anyway. The desk already runs ElevenLabs
Scribe, which beat Whisper on our own Gulf clips on 2026-09-18. Worth knowing
for later: the Open Universal Arabic ASR Leaderboard puts Whisper large-v3 at
about 60% word error on Khaliji and about 91% on code-switched Arabic and
English, which is our actual case, and Cohere Transcribe Arabic scores
materially better. That is a candidate to test against Scribe, not a reason
to change a working chain.

## Why the mirror is not paranoia

MagicBrief shut down on 31 July 2026 and its own FAQ said a bulk export was
**not available**: *"Inspire collections may contain content that you did not
create or that you do not own. For this reason, a bulk export option is not
available."* Around 3,000 teams lost their libraries with no way to take them
out. That is the precise failure our copy prevents.

## Still needed, and it is only one thing

**A Foreplay account and an API key.** There is no key on the VPS or in any
deployment. Nothing here runs until there is one, and the swipe file page
says so rather than looking broken.

On the plan: seats are not the constraint, brands are. Basic has no Lens at
all, Workflow covers 1, Agency 10, and 30 clients needs Enterprise. If the
point is Spyder watching our own clients' Ad Library pages, Agency on annual
billing is the tier with unlimited Spyder brands.

## Two things to settle in the trial

1. **Is `video` a Foreplay URL or a Facebook one?** Their FAQ says a saved ad
   stays "forever, even if they get taken down", and their frontend loads
   from Google Cloud Storage, which is consistent. Not proof. Save one ad,
   look at the URL, and we will know whether the mirror should copy the file
   too.
2. **Does Spyder still auto-save a brand's ads daily?** The mechanism is
   evidenced by a 2023 tutorial and a 2024 update, not by current docs. If it
   does, pointing it at our own 30 clients turns "remember to save the winner
   before it disappears" into something passive.
