# Upsell studio: the Edge Function code

The on-demand checks, the uploads and the client page's door. No screen is built here, so there is no design plan; the words below are what a client success manager (CSM) reads when something is refused, and they follow the copy rules (plain, active, no em dashes, each says what to do next).

Nothing here is deployed. Ship deploys `cockpit-csm-api` (with these files) and `offer-door` after migrations u, v and w are applied, and only after the native monitor's skip for client sites (section 7, item 1) is applied too.

| file | what it holds |
|---|---|
| `supabase/functions/cockpit-csm-api/tools.ts` | `webTools` appended after the last export (section 1) |
| `supabase/functions/cockpit-csm-api/upsell.ts` | the router: `UPSELL_OPERATIONS`, `runUpsell`, `UpsellError`, the site check and video check operations |
| `supabase/functions/cockpit-csm-api/upsellSite.ts` | site classification, page title, logo candidates |
| `supabase/functions/cockpit-csm-api/upsellVideo.ts` | the anonymous video check |
| `supabase/functions/cockpit-csm-api/upsellLogo.ts` | logo byte checks, the metadata strip, logo find and pick |
| `supabase/functions/cockpit-csm-api/upsellFiles.ts` | the capture upload chain |
| `supabase/functions/cockpit-csm-api/index.ts` | one import and one 6-line dispatch block after the launch ads block |
| `supabase/functions/offer-door/*` | the door (section 6, and its own README). Named without "upsell": a client's browser can show its address during a video link's redirect |

Tests, each run alone on the VPS (no network, mocked fetch, RPCs and Storage):

```
vrun.sh . 'bun test supabase/functions/cockpit-csm-api/upsell.test.ts'        # 25: webTools and the router
vrun.sh . 'bun test supabase/functions/cockpit-csm-api/upsellSite.test.ts'    # 21: page fixtures, logo candidates
vrun.sh . 'bun test supabase/functions/cockpit-csm-api/upsellVideo.test.ts'   # 26: the link rule against the SQL parser (PGlite), each provider, Drive, posters
vrun.sh . 'bun test supabase/functions/cockpit-csm-api/upsellLogo.test.ts'    # 20: bytes, strip, pick order, find (and which "none" it read)
vrun.sh . 'bun test supabase/functions/cockpit-csm-api/upsellFiles.test.ts'   # 9: reserve, ready, list sweep, remove
vrun.sh . 'bun test supabase/functions/offer-door/door.test.ts'               # 12: routes, codes, origins, links
vrun.sh . 'bun test supabase/functions/offer-door/handler.test.ts'            # 18: the door end to end
```

The SQL side of each call (the gate, the hourly cap, the verdict, the captures, the door functions) is pinned by the db builder's PGlite tests (`apps/media-buyer-cockpit/scripts/upsell-*-supabase.test.ts`). The video link rule is the one place the Edge code repeats SQL: `upsellVideo.test.ts` loads `cockpit_csm_deck_video_parse` from its migration into PGlite and asserts that it and `parseVideoLink` give the same three links, or the same sentence, on 61 pasted links (32 accepted shapes and 29 refusals, every sentence the parser has).

Type check and lint (VPS): the CS cockpit's `tsc` in strict mode with `noUnusedLocals` over `cockpit-csm-api/index.ts`, every test file here and `offer-door/index.ts`, and its Biome with the recommended rules over every file listed above (`hw-notes/upsell-studio/scratch/edge-tsc.sh` and `edge-biome.sh`).

## 0. Every operation

`POST cockpit-csm-api {operation, args, requestId?}`. `index.ts` checks the sign-in (`auth.getUser`), then `runUpsell`:

- The input is checked with zod first; a bad request is refused with a sentence before any call.
- Every RPC runs as the signed-in seat, so the database decides: `cockpit_csm_client_gate` for a client, and for the video check (which names no client) `cockpit_upsell_catalog_read`, whose first line is `cockpit_csm_actor()`: a client success seat or the CEO. A 42501 becomes a 403, a 40001 a 409, any other refusal a 400 with the database's own sentence. A missing function (PostgREST `PGRST2xx`, or `42883`) is a 503: "Offers are not set up on the server yet. Tell the CEO."
- A bad request reads "Open this from the client's page and try again." (a capture operation: "Choose a client and one of its captures."), or the field's own sentence where there is one. A capture over 20,000 pixels on a side: "The picture is over 20,000 pixels on a side. Crop it to the part that shows the gap, then add it again." (a size that is not a whole number from 1: "The picture's size could not be read. Add it again."); a file name over 400 characters: "The file name is too long. Rename the file, then add it again." A video link is taken up to 2,000 characters so the parser's own "That link is too long. Copy the video's share link." speaks for anything over 500; past 2,000 the same sentence comes from the request check.
- The service key is used only for Storage (signing uploads, reading an object's size and type, deleting bytes, `cockpit_upsell_file_purged`) and for receipts in `cockpit_csm_provider_health`.
- Every outside read goes through `webTools`. A receipt that cannot be saved stops the call before it leaves (503): "The cockpit could not log this check, so nothing was read or changed. Try again in a minute. If it keeps happening, tell the CEO."

| operation | args | returns |
|---|---|---|
| `upsell.siteCheck` | `{taskId, url?}` | `{checks:[{url, source, status, httpStatus, finalUrl, title, note, recorded}], verdict, logoCandidates:[{url, kind, width?, height?}], note}` |
| `upsell.videoCheck` | `{url}` | `{ok, provider, url, embedUrl, title, durationSeconds, posterUrl, refusal?}` |
| `upsell.logoFind` | `{taskId}` | `{candidates:[{source:'verified'\|'upload'\|'site', url, adId?, width?, height?}], note}` |
| `upsell.logoPick` | `{taskId, url}` + `requestId` (required: "A request id is required to save a logo.") | the launch tray row (`LaunchAd`, kind `logo`, ready) plus `url`, a one-hour read link |
| `upsellFiles.reserve` | `{taskId, kind:'capture', mime, bytes, width?, height?, fileName?, capturedOn, searchedAs?}` + `requestId` (required) | `{id, path, status, uploadUrl, token}`; `uploadUrl` null when the file is already ready, or `uploaded: true` after a lost answer |
| `upsellFiles.ready` | `{taskId, id}` | the capture row plus `url` and `expiresIn` (3600) |
| `upsellFiles.list` | `{taskId}` | `{rows:[capture row + url], expiresIn: 3600, signedAt}`; then sweeps |
| `upsellFiles.remove` | `{taskId, id}` | the capture row (status removed) plus `deleted` |

The front end (deck builder's `src/present/offer/sources.ts`) parses these shapes. `note` fields are plain sentences for the CSM; they are null when there is nothing to say.

## 1. `webTools` (tools.ts)

`webTools(health, request = fetch, resolve?)` gives `get(url, {purpose, maxBytes, timeoutMs, accept?, referer?})` and returns `{status, finalUrl, headers, body, redirects, truncated}`. It throws `WebError(message, kind, url)` with `kind` one of `refused`, `dns`, `tls`, `timeout`, `network`, `redirects`.

- **What may be read.** https on the default port; http (port 80) only for a site. Refused before anything leaves, with no receipt: user info, another port, an IP address written as a number (any form the URL parser turns into one, such as `2130706433` or `0x7f.1`), an IPv6 literal, a single-label host, `localhost` and `*.localhost`, `*.local`, `*.internal`, `*.lan`, `*.home`, `*.corp`, `*.intranet`, `*.arpa`, the reserved `*.test`, `*.invalid` and `*.example`, and any `metadata.*` host.
- **Each hop again.** At most 5 redirects, each checked by the same rule. A logo, oEmbed or thumbnail read may not be sent down to http; a site may.
- **DNS.** `upsell.ts` passes `Deno.resolveDns` (both A and AAAA). A host that resolves to a private, loopback, link-local, shared (100.64/10), documentation, multicast or mapped private address is refused after its intent receipt; a name with no records is `dns`. A missing resolver, a partial/failed lookup or a DNS deadline stops the read before fetch, with an unknown receipt. The router reports a 503 service problem, not a failing client-site verdict. The same check runs before every redirect hop and HTTP retry. Supabase runtime DNS support still needs a deployed readback (section 7, item 3).
- **Bytes and time.** The body is read a chunk at a time up to `maxBytes`, then cut (`truncated: true`). One deadline covers every hop and the body.
- **A site on file as http** is read as https first; the http address is read when https fails its certificate, cannot connect, or answers an error.
- **Sent as an anonymous visitor.** No cookies, `credentials: 'omit'`, `redirect: 'manual'`, the agent `Mozilla/5.0 (compatible; MaharaSiteCheck/1.0; +https://maharamedia.com)`, and a `Referer` only when asked (Vimeo, below).
- **Receipts.** `cockpit_csm_provider_health` rows `{provider:'web', method:'GET', resource:'<purpose>:<host>', phase, http_status?}`: `intent` before each hop, then `response` with the status, or `unknown` when nothing came back. Host only, never a path or a query.
- **Errors sorted.** Deno's and Bun's error texts (and their `code` and `cause`) sort into `dns`, `tls`, `timeout` or `network`.

## 2. The site check (`upsell.siteCheck`, upsellSite.ts)

1. `cockpit_csm_offer_sources(taskId, 'website')` as the seat: the gate, and the addresses on file (`site.urls`: card, onboarding form, prep). The verdict function itself is internal, so this is the seat's way to the addresses.
2. The address given (if any) goes first, with the source it has on file, else `prep`; then the others. Addresses are compared without scheme, `www.` or a trailing slash, so one site on the card and the form is checked once. At most 3 a run.
3. A value that is not a web address ("N/A", "no site yet", a mailto) is not read and not recorded; it comes back as `refused` with "\"N/A\" is not a web address. Fix it on the card or in prep." A bare `example.com` is read as `https://example.com`.
4. An Instagram address is never fetched: it is `instagram`.
5. The hourly cap is read before anything leaves: `site.checks` from step 1 (the verdict keeps the latest ten) counted inside the last hour. With 6 there, the answer is `{checks: [], verdict, logoCandidates: [], note: "Checked 6 times this hour. Try again later."}` with no outside read and no receipt; with fewer, at most `6 - recent` addresses are read (still at most 3).
6. Each result is recorded with `cockpit_client_site_check_record` as the seat, which counts again on its side (a typed address not on file is not in `site.checks`). Its cap after a recorded check returns what was checked, unrecorded, with that sentence in `note`; its cap on the first check is the answer.
7. The logo candidates come from the first page that opened.

How a page is read (12 s, 1.5 MB), first match wins:

| status | when |
|---|---|
| `instagram` | the address, or where it ends, is Instagram |
| `parked` | the page carries a parking lander or a for-sale notice: Sedo, ParkingCrew, Bodis, GoDaddy's `parking-lander` and "parked free, courtesy of GoDaddy", Dan, Afternic, HugeDomains, "this domain is for sale", "buy this domain" |
| `expired` | a builder's expired or unpublished notice: "website expired", "site was not published", "isn't connected to a website yet" (Wix), "account suspended", "this store is unavailable" |
| `redirect_offsite` | it ended on another domain that is a link page, a profile or a home page, not a site: Linktree, Beacons, Facebook, TikTok, X or Twitter, Snapchat, WhatsApp, YouTube, GoDaddy, Namecheap, Wix's or Squarespace's own home page (whatever that page answered) |
| `refused` (turned away) | a 401, 403, 406 or 429, a `cf-mitigated: challenge` header, or a bot check's own page (Cloudflare's challenge, DDoS-Guard), on any status: "The site turned the automatic check away (HTTP 403). Open it in a browser and take a capture." A bot check that answers below 400 does not quote its status: "The site showed a bot check instead of its page. Open it in a browser and take a capture." The check saw nothing, so it counts for neither verdict: a site behind a firewall is never called broken and never called working. Cloudflare's detections script on an ordinary page is not a bot check. |
| `http_error` | any other status of 300 or more |
| `empty` | a host's default page (cPanel, nginx, Apache, IIS, "Index of /"), a short page whose title or main heading is "coming soon" or "under construction" (English or Arabic), or a page with no text and no picture or script |
| `ok` (another domain) | it ended on another registrable domain that opened, such as `acme.com` to `acme.com.kw` or a rebrand: "The address sends visitors to www.acme.com.kw, which opened." (`www.acme.com.kw` and `acme.com.kw` count as one site) |
| `ok` | anything else that answered 2xx |
| `dns`, `tls`, `timeout` | from `webTools` |
| `http_error` | the connection failed ("The site could not be reached."), or more than 5 redirects ("The address redirects more than 5 times, so the check never reached a page. Open it in a browser and take a capture.") |
| `refused` (not read) | `webTools` would not read the address on file: its own sentence plus "Fix it on the card or in prep." A later hop it would not follow on another host is `redirect_offsite`; on the same host (another port, an address that cannot be read) it is `refused` with "Open it in a browser and take a capture." |

The words on the page win over its status, so a parked page answering 200 is parked and a Wix page answering 404 is unpublished. `finalUrl` is kept without its query or fragment (they can carry tokens). The title is one clean line, at most 200 characters, entities decoded, in the page's own charset (an Arabic page in windows-1256 reads as Arabic).

**Logo candidates** (at most 8, best first): pictures inside `<header>` and pictures named "logo", the Apple touch icon, `og:image`, then the icons. SVG, ICO, GIF and the other kinds the pick refuses are skipped, `data:` pictures too, and so is an icon or touch icon whose declared `sizes` is under 64 pixels a side (the pick refuses it). An `<img>` is not judged by its `width`, which is the size it is drawn at. An http picture is asked for over https.

## 3. The video check (`upsell.videoCheck`, upsellVideo.ts)

1. The seat first: `cockpit_upsell_catalog_read()` as the seat, whose first line is `cockpit_csm_actor()` (client success seats and the CEO only, so nobody else can make the function read outside; 42501 is a 403, and before migration u it is the 503 sentence). Then the link: `parseVideoLink`, the decks' own `cockpit_csm_deck_video_parse` line for line (only the five providers, in their canonical form, with the parser's own sentences). The SQL parser is granted to nobody (20261020120000 revokes it from `PUBLIC`, `anon`, `authenticated` and `service_role`; live ACL on 26 Oct `{postgres=X/postgres}`), so the seat cannot call it; the port is kept equal to it by the PGlite comparison, and the database parses the link again when a proposal saves it (`cockpit_upsell_proposal_content_ok`) and when it freezes it on send. A refusal comes back as `{ok:false, refusal: <the parser's sentence>}` with nothing read.
2. One anonymous read:
   - YouTube, Vimeo, Loom and Wistia oEmbed (the same endpoints as the deck import worker). 401 or 403: "This video is private. Set it to anyone with the link." Two departures from contract 5.x's single sentence, so the CSM is never sent to a setting that is already right: YouTube's 401 or 403 (it answers 401 for a public or unlisted video whose owner turned embedding off, which cannot play in the page's frame either) reads "This YouTube video is private or does not allow embedding. Set it to Unlisted and turn on Allow embedding."; any provider's 404 reads "This video was not found. It may be private or deleted. Set it to anyone with the link, or paste another link." Drive keeps the private sentence for all three.
   - Vimeo is asked with `https://offer.maharamedia.com/` as the referring page. A `domain_status_code` of 403 means the video is locked to other sites: "This Vimeo video plays only on certain sites. Add offer.maharamedia.com to its allowed domains."
   - Google Drive: `drive.google.com/thumbnail?id=…&sz=w640` (with the resource key when the link has one), with no cookies. A redirect to `accounts.google.com`, or 401, 403 or 404, is private. A picture is ok.
   - Anything else (a 5xx, a page that is not JSON, no connection): "YouTube did not answer just now, so the link is not checked. Try again in a minute." Never called private.
3. `title`: one line, no control or direction marks, at most 40 characters at a word end (the proposal's limit). `durationSeconds`: rounded, 1 to 10,800, else null.
4. `posterUrl`: the oEmbed thumbnail only when it is on the decks' four poster hosts and matches the table's own rule (a Loom GIF becomes its JPEG still), and one small read says it is a JPEG, PNG or WebP. Otherwise null; the video still passes.

## 4. Logos (upsellLogo.ts)

**Find** (`upsell.logoFind`), in this order:
1. The verified logo: `cockpit_csm_deck_sources(taskId).logo` (the decks' own read, gated), by the public bucket's address.
2. The launch tray's ready `logo` rows (`cockpit_csm_launch_ads_read`), with one-hour links signed by the seat (the bucket's read policy decides) and their `adId`.
3. Pictures on the client's own site: the first two addresses on file that open, read as in section 2. At most 6.

Each "none" is said only when it was read:
- A ready tray logo Storage did not sign (the whole call failed, or that one object): "One logo in the launch tray could not be opened just now. Try again." ("2 logos ..."), even when other candidates are shown. The failed signing leaves its receipt.
- Nothing anywhere, by what was read: no address on file, "No logo found: none verified, none in the launch tray, and no website on file. Upload one, or leave the logo off."; an address on file that did not open (parked, expired, dns, a timeout), "... and their site did not open. ..."; a site that opened with no usable picture, "No logo found: none verified, none in the launch tray and none on their site. Upload one, or leave the logo off."
- An answer about their site that cannot be read is a 502 ("The server did not return this client's site. Try again."), never "no website on file".

The proposal uses `logo.adId: null` for the verified logo and the row's `adId` for a tray logo, so those two need no pick.

**Pick** (`upsell.logoPick`) is for a picture on the client's site:
1. Allowed when the picture is on a domain on file, or when the client's page names it (builders keep pictures on their own hosts: Wix, Squarespace, Shopify). Anything else: "Pick a picture found on the client's own site. The verified logo and the launch tray's logos need no saving."
2. Read once (10 s, at most 2 MB plus one byte), then checked from its bytes, whatever its name or header says:
   - PNG, JPEG or WebP. SVG ("That logo is an SVG drawing. Pick a PNG, JPG or WebP picture."), GIF, an animated WebP (`ANIM`, `ANMF` or the header's animation flag) and APNG (`acTL`) are refused.
   - At most 2 MB; 64 by 64 to 4000 by 4000 pixels, read from the PNG header, the JPEG frame header or the WebP header (VP8X, VP8L or VP8).
   - A cut or broken file is refused, never guessed.
3. Stripped: JPEG APP1 (EXIF and XMP), APP13 (IPTC) and comments; PNG `eXIf`, `tEXt`, `iTXt` and `zTXt`; WebP `EXIF` and `XMP ` chunks, with the extended header's EXIF and XMP flags cleared and the RIFF size fixed. Every other byte stays as it was, and the stripped file must read as the same picture. An EXIF rotation is lost with the rest; logos rarely carry one.
4. The tray's own chain, keyed by the request the cockpit sends (required): `cockpit_csm_launch_ad_reserve` as the seat (kind `logo`, the stripped size and type, `logo-<host>.<ext>` as its name), a non-upserting signed upload with the service key, `uploadToSignedUrl`, Storage's size and type read back and compared, then `cockpit_csm_launch_ad_accept` as the seat (which checks Storage again and audits). The same request id after a save returns the saved row with no second upload.
5. It never writes `cockpit_client_logos`. Marking a logo verified stays the CEO's step.

## 5. Captures (upsellFiles.ts)

Copied from `launchAds.ts` and cut to one kind, not imported (contract decision 2).

- **Reserve**: `cockpit_upsell_file_reserve` as the seat (it checks "searched as" through the client copy check), then a non-upserting upload link signed with the service key. The browser PUTs the picture. A retry after a lost answer finds the object and says `uploaded: true`.
- **Ready**: `cockpit_upsell_file_accept` as the seat checks Storage's own size and type in the same transaction that turns the row ready (audited), then the seat signs a one-hour read link.
- **List**: `cockpit_upsell_files_read`, each row's path checked against `<taskId>/<id>.<ext>`, one-hour links signed by the seat (the bucket's read policy is `cockpit_upsell_object_allowed`). Then the sweep: `cockpit_upsell_files_stale` as the seat, the bytes deleted with the service key (only paths inside this client's folder), and `cockpit_upsell_file_purged` with the service key. A failed sweep never fails the list; its receipt shows on the health page.
- **Remove**: `cockpit_upsell_file_remove` as the seat (the row stays for the audit), then the bytes go at once, or on the next sweep.

Captions and "searched as" changes go straight from the browser to `cockpit_upsell_file_update` (browser-callable, gated, copy-checked); no Edge operation is needed for them.

## 6. The door (`supabase/functions/offer-door`)

Routes, limits, secrets, headers and the deploy command are in its README. The rules that matter for the rest of the build:

- **What the page gets** from `GET /p/{code}`: `{state, proposal, contact:{whatsapp}}`. `proposal` is `cockpit_upsell_public_json`'s PublicProposal with each `{bucket, path}` replaced by `{url}`: `logo` becomes `{url, alt}` or null, each `found` item `{url, caption, capturedOn, searchedAs}` (a capture without a link is left out). A video whose player is not one of the five the page may frame, or whose poster is not on the poster hosts, is left out. `contact.whatsapp` is 8 to 15 digits or null.
- **Links last 600 s.** The verified logos' bucket is public, so its address is plain. The other two buckets are signed with the service key.
- **No client data in any URL the door makes.** `/v` sends a person to the saved video's own page (checked: https, one of the five providers' page hosts) or to the offer site with `?gone=1`, `?busy=1`, `?error=1`, or nothing for a link preview. A signed picture link carries the picture's storage path, which starts with the ClickUp task id (section 7, item 4).
- **Counting.** The database counts. The door never counts a link preview, a crawler, a HEAD or a bad code (no database read at all), and passes a live preview token on so the database does not count the open. A play or Yes press whose body carries a live preview token (`pv`) is not sent to the database at all, so a CSM previewing the page never marks it played or pressed. The offer page must send its `pv` with every event when its address has one (a request to the proposal builder, section 7, item 5).
- **A client's video link lands on a page whenever the function runs.** `/v` is opened from WhatsApp on the client's phone, so a closed door (a missing secret) or anything that throws sends them to `/?error=1` on the offer site, never a text or JSON error. A platform failure before the handler runs (a boot error, a worker limit, the function not deployed) is Supabase's own answer, which is why the function's name, visible in that moment, carries no "upsell". The missing secret's name goes to the status row, the log and `/health`.
- **The page's errors have one shape.** `/p` answers `{state: "error", proposal: null, contact: null}` for a closed door (503), a database that did not answer (502) and anything that throws (500), always with the page's CORS header; an event that is not recorded answers `{error: "Not recorded."}`. Secret names and the function's name never reach the client's browser.
- **The address kept** is a 64-hex sha256 of `OFFER_IP_SALT`, a door-only label and the caller's network (an IPv4 address or an IPv6 /64), as `cockpit_upsell_views.ip_hash` requires. The rate limits key on sales-live's own 32-hex `ipHash`.
- **Status rows**: `cockpit_upsell_door_status` per route, on a change or at most once a minute, so "Opens unknown" shows when the door stops working.

## 7. Open points

Item 1 blocks the deploy of the upsell operations.

1. **Migration written, application pending: native monitor observations.** `20261027011000_upsell_monitor_web.sql` is rebased on the live base definition read on 26 October, md5 `6610301bdcef1ddcc4bd1ee284cef9ea`. A body/ACL guard stops on drift. It preserves the live owner-only base and leaves the service-role wrapper unchanged. Site/logo/thumbnail observations and oEmbed 401/403/404 no longer become outage checks; NULL-safe filtering keeps oEmbed unknown, NULL status, 429 and 500 visible. The fictional PGlite test covers all three ledgers and requires unchanged other checks. No receipts are rewritten. Apply and verify before deploying the Edge reads.
2. **On main**, `tools.ts` already ends with `slackTools` (22542426 and after). The `webTools` block appends below `SlackTools` unchanged; git will show it as an append conflict at the end of the file, resolved by keeping both. `index.ts` and the sales-live files are the same on main as on this branch.
3. **Deployment verification: `Deno.resolveDns` on Supabase's Edge Runtime.** Current code fails closed if DNS is unavailable, incomplete or exceeds the overall deadline. Literal IPs and private names are always refused, even without a resolver. Verify an approved public test host after deploy before enabling these reads. This is still an availability uncertainty, not a permissive fallback. The platform's fetch performs its own connection lookup, so these preflight checks are not IP pinning or a general guarantee against DNS rebinding; use an egress-controlled fetch service if connection-level enforcement is required.
4. **Signed picture links carry `<taskId>/<id>.<ext>`.** The ClickUp task id grants nothing, but if it should not reach a client's browser, the captures' storage path would need another folder key (a db change) or the door would have to serve the bytes itself. The 10 verified logos on file (read 26 Oct) all fit the door's path rule, and their bucket is public.
5. **The offer page** (proposal builder) should read the door's three front-page flags, each to its own sentence: `?gone=1` to `states.videoGone` (a new key, since the client tapped a video link, not a proposal link: English "This video link has ended. Message your account manager for a new one.", the Arabic written fresh under `aziz-kuwaiti-voice` and added to ARABIC-FOR-APPROVAL.md, and `videoGone` added to contract 5.7's key list), `?busy=1` to `states.busy` and `?error=1` to `states.error` (a closed `/v` lands on `?error=1`), may send events as `text/plain` to avoid a preflight (the door answers a preflight either way), and must include the page's `pv` in every event body when its address has one, so a preview is never counted.
6. **The cockpit's logo pick** (deck builder's `src/present/offer/sources.ts`) must send a `requestId` (a fresh UUID per pick, kept for its retries); a pick without one is refused. Uploads (`upsellFiles.reserve`) need one too.
7. **The door's new name reaches the contract and the offer site (needs from the orchestrator).** The function is `offer-door` (it was `upsell-door`), so contract 5.5 and 5.6, the proposal builder's `sites/offer/vercel.json` when it is written (`/v/:code` to `https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/offer-door/v/:code`) and the page's door base URL (`.../functions/v1/offer-door`) change with it, and so do the deploy command and the reliability monitor's profile entry at ship. The database's own names (`cockpit_upsell_door_*`, `cockpit_upsell_views`) are service-key only and never reach a browser, so they stay. The captures' bucket name `cockpit-upsell-files` does sit inside the signed picture links the page loads (a db-owned name; renaming it is a db change if a picture opened on its own should not show it).

## Continuation checks, 26 October

The authenticated video-parser wrapper discussed in earlier handoffs is superseded: the existing TypeScript port is compared against the SQL parser on 61 inputs in `upsellVideo.test.ts`; saves and send-time snapshots also parse in SQL. No redundant wrapper RPC is added.

New `upsell.test.ts` cases cover absent/null/throwing/hanging DNS, incomplete A/AAAA answers, redirect revalidation and a 503 without a recorded failing-site verdict. Existing private literal refusals remain before receipts and fetch. The added checks are queued for the coordinated VPS run; this note does not claim they have passed.
