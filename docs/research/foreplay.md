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

## Connected through Composio, 2026-09-19

Aziz connected it and added the editor, the creative director and the media
buyer to the team. Checked live.

**Seven tools are registered and answer**: the swipe file, an ad by id, ads
by brand, and four Spyder reads. **Boards, usage, discovery and brand
analytics are in Foreplay's REST API but not in the Composio toolkit**, so
the worker's own key is still what the mirror needs. Composio is the
assistant's door; the key is the cockpit's.

The account works and is empty, which is what a new account looks like. The
useful error came from Spyder: *"You are not subscribed to this page"*. That
names the next step exactly.

## The pages to subscribe in Spyder

Every client Page the Meta token can reach, with the Ad Library link Spyder
takes. Starred pages already have a winning ad on the board, so they are
worth subscribing first.

| Page | Ad Library link for Spyder |
|---|---|
| City Wood ★ | https://www.facebook.com/ads/library/?view_all_page_id=897705726763618 |
| Olivar Design ★ | https://www.facebook.com/ads/library/?view_all_page_id=1125105954024321 |
| Joe And Sera Interiors ★ | https://www.facebook.com/ads/library/?view_all_page_id=994381073767658 |
| Amheco | https://www.facebook.com/ads/library/?view_all_page_id=968223123034166 |
| Ardon | https://www.facebook.com/ads/library/?view_all_page_id=589378320933628 |
| Mass Design | https://www.facebook.com/ads/library/?view_all_page_id=664243990104297 |
| AIVE Designs  | https://www.facebook.com/ads/library/?view_all_page_id=1142527915610445 |
| Alkhalil Group | https://www.facebook.com/ads/library/?view_all_page_id=222784320921690 |
| Arch Home - بيت العمارة | https://www.facebook.com/ads/library/?view_all_page_id=1064333810100591 |
| Arcturus World | https://www.facebook.com/ads/library/?view_all_page_id=164284610092821 |
| Castello Industries Co. | https://www.facebook.com/ads/library/?view_all_page_id=912332345468258 |
| Design & Architect Studio | https://www.facebook.com/ads/library/?view_all_page_id=102624045167440 |
| Evan Home | https://www.facebook.com/ads/library/?view_all_page_id=1216166304916112 |
| JG Designs | https://www.facebook.com/ads/library/?view_all_page_id=1134052333120274 |
| Kesan Engineering | https://www.facebook.com/ads/library/?view_all_page_id=1091098027421795 |
| Kesan_engineer | https://www.facebook.com/ads/library/?view_all_page_id=112757315091134 |
| MaharaMedia | https://www.facebook.com/ads/library/?view_all_page_id=587094101153861 |
| Marble and More - ماربل آند مور | https://www.facebook.com/ads/library/?view_all_page_id=950773658117275 |
| Mohammad Aladwani Architects | https://www.facebook.com/ads/library/?view_all_page_id=101889371229734 |
| Overview Construction | https://www.facebook.com/ads/library/?view_all_page_id=1001079039765147 |
| Phoenix.Building | https://www.facebook.com/ads/library/?view_all_page_id=825704310625799 |
| Qatar uPVC Windows + Doors | https://www.facebook.com/ads/library/?view_all_page_id=112231963847120 |
| Repalo | https://www.facebook.com/ads/library/?view_all_page_id=118101257980222 |
| Rising Najd - نهوض نجد للمقاولات | https://www.facebook.com/ads/library/?view_all_page_id=1043926628806388 |
| Shamal khaleej | https://www.facebook.com/ads/library/?view_all_page_id=714995608369269 |
| The last step construction | https://www.facebook.com/ads/library/?view_all_page_id=1099300543260931 |
| Triple Edge | https://www.facebook.com/ads/library/?view_all_page_id=607417982447098 |
| atlantis.sa أتلانتس للتصميم والديكور | https://www.facebook.com/ads/library/?view_all_page_id=101053351568857 |
| أنظمة شمال الخليج  | https://www.facebook.com/ads/library/?view_all_page_id=1043495078856785 |
| النخبة المثالية للمشاريع المتكاملة | https://www.facebook.com/ads/library/?view_all_page_id=770050646194710 |
| اورب | https://www.facebook.com/ads/library/?view_all_page_id=411116355412660 |
| اوشن  | https://www.facebook.com/ads/library/?view_all_page_id=149136041609841 |
| اوشن تكييف | https://www.facebook.com/ads/library/?view_all_page_id=165293533340806 |
| ايليت ايكسيلانس | https://www.facebook.com/ads/library/?view_all_page_id=838248542715600 |
| ديزاين | https://www.facebook.com/ads/library/?view_all_page_id=164083210117844 |
| شاليهات فينيكس | https://www.facebook.com/ads/library/?view_all_page_id=325454820657906 |
| شركة العلا لتشييد المبانى  Al-Ola Building Construction Company | https://www.facebook.com/ads/library/?view_all_page_id=795733830298068 |
| شركة حول العمران للمقاولات | https://www.facebook.com/ads/library/?view_all_page_id=1149064044964024 |
| شركة عمق الحياة للهندسة | https://www.facebook.com/ads/library/?view_all_page_id=1089044817620442 |
| منشآت خالدة للإستشارات الهندسية | https://www.facebook.com/ads/library/?view_all_page_id=1215892868273680 |

★ = already has a winning ad on the board

## The drop box

Aziz, 2026-09-19: *"any ads that get added to the Foreplay folder for that
get added to the ideation section as well... even if they save it on their
phone."*

**Make a board in Foreplay called `Ideation`.** Anything anyone drops into
it, from any device, reaches the shared ideation board within twenty
minutes. The media buyer, the creative director and the editor all feed the
same place, and nobody forwards a link.

Three rules keep it from becoming a nuisance. Only ads the board has never
seen are forwarded, so something the creative director dismissed does not
come back every twenty minutes just because it is still sitting in the
Foreplay folder. An ad with no link is skipped rather than failing the
batch. And only the drop box is read ad by ad, because that is what costs
credits; everything else comes from the incremental swipe file.

The board name is `FOREPLAY_DROP_BOX` on the worker, defaulting to
`Ideation`. A forwarded ad shows as **saved** on the ideation page with how
long it ran, never as a radar tier, so a human's pick is never mistaken for
a machine's score.

## Our own copy, which is the part no vendor can take

Measured 2026-09-19: **19 of our 29 winning ads have already stopped.** A
stopped commercial ad is gone from the Meta Ad Library, so Foreplay, Spyder
and every other tool that reads it can never fetch those 19. They were never
reachable that way.

They are reachable through the Page token, and **23 of the 29 are now in our
own `ad-videos` bucket**, 110 MB, downloaded while the links still worked.
`desk.py archive` runs nightly and the cockpit plays our copy first, the
public Facebook embed second, and Meta's expiring preview last.

So: Foreplay is the net from today forward. The archive is the backlog and
the guarantee.

## What the MCP actually holds, checked live

Twenty-one tools, not the seven I first found. My earlier probe guessed at
slug names and guessed wrong; `composio search` returns the real list.
Boards, usage, discovery and Spyder brands are all there.

Two things that were open are now settled:

**Their media is their own.** A Discovery ad's `video` comes from
`r2.foreplay.co`, Cloudflare R2, and the thumbnail from their Google Cloud
bucket. Nothing points at an fbcdn link. So a saved ad really does outlive
the Meta link, which is the claim the whole choice rested on.

**The account is fresh and untouched**: 10,000 credits, none used, no
boards, no Spyder brands, nothing saved. The period runs to 19 October.

## Discovery, measured rather than guessed

Both my earlier reports were wrong in opposite directions. It is not useless
for the Gulf, and it is not rich either.

| Arabic search | Ads | With a video file |
|---|---|---|
| everything | 25 | 12 |
| تصميم داخلي | 25 | 19 |
| real estate | 25 | 8 |
| مقاولات | 14 | 6 |
| villa | 0 | 0 |

Across five queries there were **25 distinct Arabic ads with 8 playable
files, and seven of those eight are the same advertiser**. Dubai real estate
and one interior studio. Nothing in construction or engineering.

So Discovery is not where the value is for us, and I did not seed the
ideation board from it: eight ads from two advertisers would be noise on a
board Sabry reads. The value is Spyder on our own clients, the team's own
saves, and the fact that Foreplay keeps the file.

## One key, either kind

The worker now takes **either** `FOREPLAY_API_KEY` or `COMPOSIO_API_KEY`.
With the Composio key it calls the same endpoints through the toolkit Aziz
already connected, so there is no second vendor secret to manage; with the
Foreplay key it calls Foreplay directly, which is one hop instead of two and
wins when both are set. Seven tests cover the routing, the unwrapping and
the endpoints Composio does not carry. `doctor` says which one is in use.

## Still needed, and it is only one thing

**One key on the worker**, either a Foreplay API key or a Composio API key.
The Composio connection Aziz made is authed to his laptop, not to the VPS,
so the cron needs a key of its own. Nothing runs until there is one, and the
swipe file page says so rather than looking broken.

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
