# Client Offer Studio: verification and release record

Updated 27 October 2026. This is the Website pilot, with seven catalog offers. It is implemented for internal review. No production migration, Edge deploy, site deploy, video upload or client send has occurred in this continuation.

## Scope and source

- Worktree: `~/mahara-worktrees/billing-pending`, branch `upsell-studio`.
- Starting source: `054c5992fbd99ebc8918fb7e9ffe180a50179736`.
- Latest main integrated: `3f9f5c41fe569f9d6c8f93aad05bef318ef3dda9`. The two conflicts preserve Blueprint closed/wrap visibility with OfferNotes, and preserve both Slack and web helpers. Initial implementation commit: `5a20ae8b`.
- Preserved approved requirements: [PLAN](PLAN.md), [CONTRACT](CONTRACT.md).
- Tracking: [Complete Client Offer Studio website pilot](https://app.clickup.com/t/z8xmdvknga).
- Not in scope: sales AI drafting, payments, outbound messages, a second offer deck, changed eligibility policy, new voice subscriptions or synthetic Aziz media.

The build includes the Website presentation and private prep/notes, catalog/list prices, per-client pricing with logged below-list reasons, proposal editing with exact public-page preview, optional client logo, checked videos, scoped capture uploads, public access codes and audit records. SEO/GEO remains locked unless the CEO unlocks it. Empty list prices remain empty. Existing decks and other cockpit sessions are preserved.

## How we know it works

All compilation, tests, browser screenshots and video rendering run on the VPS, never the low-disk Mac. Every test record is fictional. No test sends a message, launches an ad, creates a client task, or modifies a real client.

Verified on the continuation source:

| Check | Result |
| --- | --- |
| Database tests across seven offer suites | 113 passed, 0 failed; includes repeat migration application, roles, source integrity, upload caps, sent snapshots, expiry and schema parity |
| CSM API, public door, public page and existing WhatsApp-probe tests | 162 passed, 0 failed |
| Proposal browser scenarios | 71 passed: EN/AR at 320/375/390/414/768/1280 px, five states, editor viewports, retry/save/language changes and eight long-text stress cases with actual glyph-bound checks |
| Shared copies and exact public-preview asset parity | Passed |
| Offline Edge bundles, current merged source | Both cockpit-csm-api and offer-door passed with the reviewed import-map rewrite and deployment flags |
| Offer-art typecheck and nine test files | Passed |
| Video Python regressions | 14 passed |
| Local-render dependency checks | Passed; only exact unused Docker/transcription/synthesis checks are exempted |

Post-main integration passed 662 UI tests across 31 files plus 29 Blueprint-host tests (691 total), full app build, shared checks, 162 API/public/existing WhatsApp-probe tests, icon/asset checks and all 14 Python regressions. The seven-fixture EN/AR deck matrix passed 648 measured canvas shots, plus private views and players, with no overlap, wrapping, overflow or browser errors. The source merge was reviewed separately for lost Blueprint, prep, route and permission behavior.

The final public-page audit fixed long-word wrapping in headings, client/CSM names and scope rows. Its follow-up passed all 29 proposal unit tests, another full CSM build, and 71 browser scenarios. The stress checks measure text rectangles against both containers and viewport, so page-edge clipping cannot hide overflow. Public-preview CSS is byte-identical to the canonical site. These counts are separate named suites, not a claim that every application feature was tested. Passing the mock/local suite does not verify provider deployment.

Offline bundles are recorded at VPS `~/upsell-build/offer-edge-bundles-1asvth73/results.json`: cockpit-csm-api has 24 modules, 212850 bytes, SHA256 `031979cb4ab289eae00c2f62014eedb3b057a8b5addaddac57e9a05920077842`; offer-door has 6 modules, 24859 bytes, SHA256 `5ec7bcd7f317946684fce9ac8a8fe986f4bdbaca7f95343fb6c994cb75b0759a`. The source manifests match the merged worktree. This is an offline compile, not a deployment receipt.

Evidence remains on the VPS under `~/upsell-build/media/{final-checks,acceptance-checks,postmerge-checks,proposal-final,shots}`. The development mirror is not a release checkout: it excludes `.git` and uses a placeholder browser key.

## Internal review

While the SSH tunnel and VPS preview are running:

- Prep: `http://127.0.0.1:5319/client-success/offer-harness.html?fixture=full&lang=en&view=prep`
- Deck: same URL with `view=present` and `lang=ar` or `en`.
- Money: same URL with `view=offers&role=ceo`.
- Proposal builder: `http://127.0.0.1:5319/client-success/proposal-harness.html?view=builder&lang=en`.

These URLs use fictional records and provider stubs. They are not hosted production URLs. The underlying server is VPS port 5311. The tunnel is local port 5319.

## Video evidence

The fresh isolated `v4-r2` render passed internal-preview checks. Both masters are H.264 1920x1080, 30 fps, 60.0 seconds with AAC/faststart. 180 client-copy strings passed. English measures -15.1 LUFS/-1.3 dBTP; Arabic has no narrator and measures -28.0 LUFS with room tone/effects. Both small review proxies are below 3 MB.

The manifest still returns `clientReady: false`. Missing or unverified: current licensed English take, Arabic narration/licence, real eight-second Aziz closes, CEO Arabic approval and final audiovisual review. A read-only live check on 27 October confirms ElevenLabs is on the free tier with zero credits; both documented real-close paths are absent. Free-tier recordings cannot be made commercial by upgrading later, so a new licensed take is needed (ElevenLabs commercial-use policy). No narration synthesis, paid generation or Wistia upload occurred here. Posters, contact sheet and the 24.8/25.0/25.2 transition frames were visually checked. No phone-speaker listening approval is claimed.

Small local artifacts: `~/mahara-worktrees/hw-notes/upsell-studio/video/website/v4-r2/`. Masters: VPS `~/upsell-studio-video/website/out/v4-r2/`. Original v4 is preserved. See [VIDEO](VIDEO.md) and [CRITIC](CRITIC.md).

## Live read-only evidence

Creative Triage project `bldgtotkfmhoxmlzowdx`:

- Current roster: 55 clients, 20 Active, complete snapshot and fresh source state. No duplicate/malformed task IDs found.
- 54 of 55 fail at least one of the eight checks reproduced from existing data. This is not a complete eligibility verdict: new win ticks and offer history were not queried because those tables are not deployed.
- Among Active clients: stale happiness 13, not happy 14, pause required 8, raised on last call 6, red 13, renewal window 4, too new 5. Reasons overlap.
- Six clients have sheet win evidence. Missing evidence is unknown in this dry run, not proof of no win.
- No eligibility rules were loosened. The optional generic-problem-word change and renewal-default change remain CEO decisions.

Live replaced-function fingerprints matched the guards when read on 26 October. Re-read immediately before applying:

| Function | Current MD5 |
| --- | --- |
| cockpit_csm_deck_prep_save | e6b8e4d80bd8dd30498ebc1b5ab92859 |
| cockpit_csm_deck_video_clear | df961267904ba26d2bb9e425fae40d92 |
| cockpit_csm_deck_video_save | eeaf74c7b6fd1ec12db44e26d59c6848 |
| cockpit_csm_deck_video_slots | 9f670ba72f102080504a1a348d5c9309 |
| cockpit_csm_deck_videos_read | e645051690f2f32543e4da89beecb890 |
| cockpit_native_monitor_base | 6610301bdcef1ddcc4bd1ee284cef9ea |

Rollback definitions are in the private Mac `~/.cache/mahara-ship/rollback/` directory, with the `before-offer-studio-20261026.sql` suffix. Before release, retain owners, ACLs and constraints too. These files restore replaced definitions, not every new table; never drop real client data as a rollback.

## Release sequence and boundaries

1. Verification, reviewer fixes and latest-main integration are complete for internal review. Save the merge checkpoint and push the branch with a reviewable PR, without moving the shared checkout HEAD. Do not infer Arabic approval from implementation approval.
2. Arabic copy needs the CEO's explicit batch approval before it reaches clients: [approval sheet](ARABIC-FOR-APPROVAL.md). Blank prices/videos and `door_live=false` are not an overall exposure switch. Keep review protected until approval or implement a real exposure boundary. Do not use those defaults as evidence of isolation.
3. Apply guarded migrations u, v, w, x, then `20261027011000_upsell_monitor_web.sql`. This timestamp intentionally sorts after its `20261026n` dependency. Read back bodies, ACLs, catalog and receipts after each. Stop on guard drift.
4. Deploy `cockpit-csm-api` with its current JWT setting and `offer-door` with JWT verification off, after dry bundle validation. Preserve all current imports/functions. Use a dedicated random `OFFER_IP_SALT`; never replace the shared `IP_SALT`. Read back versions, JWT settings and health. Verify `Deno.resolveDns` availability on an approved public host; absent/partial/timed-out DNS fails closed.
5. Use unchanged `scripts/ship.sh client-success` in an isolated genuine VPS Git checkout of the exact pushed release SHA. Never use the dirty existing VPS clone or development mirror. Install required CLI/dependencies there, use the verified public cockpit anon key, and preserve all auth/main/production guards. `COCKPIT_SUPABASE_KEY` on the VPS is a service key and must never become a `VITE_*` value.
6. The static public offer site needs its own verified project/domain release. Exclude test/fixture/dev files. Confirm project/team ownership, exact source and served asset hashes, routing, CSP/noindex and public states. It cannot use the cockpit verifier's Vite-entry assumption. No offer project or DNS record has been created here.
7. Add/read back the new offer-door health endpoint in the shared reliability profile and run its relevant tests. The SQL receipt filter alone is not that profile change.
8. Publish videos and save `offer_website:demo` only after licence, current voice, Arabic, real-clip and final review requirements are met and the CEO approves upload. No client message sends are implicit.

Current CSM deployment observed read-only: project `prj_8U3cRoO4xw7Wl5xHjeVhJ56epntP`, team `team_CYujeiq6dPtfcUEHS14lcJuV`, READY production `dpl_5Fvr4S27TTtnqxayjtqT7TCt8gPA`. Re-read before any release; it may change while other agents work.
