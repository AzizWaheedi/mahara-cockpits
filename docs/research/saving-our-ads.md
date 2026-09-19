# Keeping a copy of our own ads

Measured 2026-09-19, on our own accounts. Aziz asked whether there is a more
reliable way than Meta's ad preview, which expires within hours and only
renders for a browser already signed in to the ad account.

## What Meta will and will not give us

Four routes were tried against real winning ads.

| Route | Result |
|---|---|
| `GET /{video-id}?fields=source` with the ad-account system token | **Refused.** The field simply is not returned. |
| `GET /act_{id}/advideos?fields=source` | Returns `source`, but **the ad's video is not in that list**: a reel is published by the Page, not uploaded to the account. |
| `GET /{page-id}/videos?fields=source` | Returns nothing. |
| **`GET /{video-id}?fields=source` with that Page's own access token** | **Works.** Real `video/mp4`, downloads with a Range request. |

The system token reaches **41 client Pages** through `me/accounts`, and each
carries a page access token. That is the key: the video belongs to the Page,
so the Page's token is the one Meta answers for.

### Coverage today

Across the 29 ads in `winner_ads`:

| | |
|---|---|
| File downloadable | 22 |
| Refused by both tokens | 6 |
| No video on the creative | 1 |

The six are two clients, RM Designs and Safad Consulting, whose Pages are not
among the 41. Getting page access for those two closes the gap.

## What is live now

`winner_ads.watch_url` holds Facebook's ordinary video embed, resolved once
from the video's `permalink_url`. Unlike the ads preview it renders for
anybody and does not expire, and 22 of the 29 have one. That is good enough
to watch an ad, and it costs nothing, but it is still a link to somebody
else's server.

## What would actually be permanent

Two things, in order of value:

1. **Record the Drive file id against the ad id when the cockpit launches an
   ad.** Karim cut the video; the master is already in the client's Drive
   folder at full quality. Nothing external can break that. The only missing
   piece is the join, written at launch.
2. **A nightly sweep** for ads that did not come through the cockpit:
   ad → creative → `video_id` → Page token → `source` → download the bytes
   immediately. The signed URL expires, so never store the link.

Storage is not a consideration: 30 clients × 50 winners a year × ~20 MB is
about 30 GB a year.

## The vendors, briefly

Checked 2026-09-19. **Not one of them archives your own ads automatically**;
they are built for watching competitors.

- **adslibrary.ai** (the one Aziz named). Real and working. $19 for one
  member and one tracked advertiser, $49 for three members and 20
  advertisers, $99 for 100 advertisers, 30% off annually. Chrome extension,
  bulk download, folders, share links, active-status tracking. **No API**
  (`/api` is 404, no docs or api subdomain), no trial, no refunds, no named
  company, registrant in China, and its terms explicitly contemplate
  "service discontinuation". Good value, not something to depend on.
- **Foreplay** is the one practitioners name. About $99 a month for three
  seats, but covering 30 clients pushes it near $1,400. Its API is read-only,
  so ads cannot be pushed in.
- **MagicBrief shut down on 31 July 2026** after Canva bought it, without
  saying publicly what happened to customers' saved libraries. That is the
  argument against any vendor being the system of record.
- **Sensor Tower / Pathmatics**: $30k-$115k a year, panel-based, would rarely
  see a Gulf client's ads at all.

## Unrelated, but found on the way

Our Meta code is pinned to **Graph v21.0, which expires 21 January 2027**.
When a version expires Meta serves the next one silently, so this fails
quietly rather than loudly. It affects the media buyer cockpit and the
side scripts, not only the editor desk.
