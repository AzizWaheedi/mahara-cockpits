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
