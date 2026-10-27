# Client Offer Studio: verification and release record

Updated 27 October 2026. The Website Offer Studio backend and public proposal site are live and verified, with seven catalog offers. Aziz approved the Arabic wording for decks and proposal pages on 27 October 2026. The guarded database, Edge and public-site release is complete. CSM frontend completion awaits the parallel Claude deployment, which Aziz asked this session to leave to Claude. Client video publication remains separate and pending; no client offer was sent during verification.

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

The manifest still returns `clientReady: false`. Missing or unverified: current licensed English take, Arabic narration/licence, real eight-second Aziz closes and final audiovisual review. The 27 October Arabic approval covers decks and proposal pages; it does not approve publication of this unfinished film. A read-only live check on 27 October confirms ElevenLabs is on the free tier with zero credits; both documented real-close paths are absent. Free-tier recordings cannot be made commercial by upgrading later, so a new licensed take is needed (ElevenLabs commercial-use policy). No narration synthesis, paid generation or Wistia upload occurred here. Posters, contact sheet and the 24.8/25.0/25.2 transition frames were visually checked. No phone-speaker listening approval is claimed.

Small local artifacts: `~/mahara-worktrees/hw-notes/upsell-studio/video/website/v4-r2/`. Masters: VPS `~/upsell-studio-video/website/out/v4-r2/`. Original v4 is preserved. See [VIDEO](VIDEO.md) and [CRITIC](CRITIC.md).

## Pre-release read-only evidence

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
2. Arabic wording for decks and proposal pages was explicitly approved by Aziz on 27 October 2026: [approval record](ARABIC-FOR-APPROVAL.md). Video licensing, real clips and publication remain separate. Blank prices/videos and `door_live=false` are not an overall exposure switch.
3. Apply guarded migrations u, v, w, x, then `20261027011000_upsell_monitor_web.sql`. This timestamp intentionally sorts after its `20261026n` dependency. Read back bodies, ACLs, catalog and receipts after each. Stop on guard drift.
4. Deploy `cockpit-csm-api` with its current JWT setting and `offer-door` with JWT verification off, after dry bundle validation. Preserve all current imports/functions. Use a dedicated random `OFFER_IP_SALT`; never replace the shared `IP_SALT`. Read back versions, JWT settings and health. Verify `Deno.resolveDns` availability on an approved public host; absent/partial/timed-out DNS fails closed.
5. Use unchanged `scripts/ship.sh client-success` in an isolated genuine VPS Git checkout of the exact pushed release SHA. Never use the dirty existing VPS clone or development mirror. Install required CLI/dependencies there, use the verified public cockpit anon key, and preserve all auth/main/production guards. `COCKPIT_SUPABASE_KEY` on the VPS is a service key and must never become a `VITE_*` value.
6. The static public offer site needs its own verified project/domain release. Exclude test/fixture/dev files. Confirm project/team ownership, exact source and served asset hashes, routing, CSP/noindex and public states. It cannot use the cockpit verifier's Vite-entry assumption. The dedicated mahara-offer project and offer.maharamedia.com DNS record are verified below.
7. Add/read back the new offer-door health endpoint in the shared reliability profile and run its relevant tests. The SQL receipt filter alone is not that profile change.
8. Publish videos and save `offer_website:demo` only after licence, current voice, Arabic, real-clip and final review requirements are met and the CEO approves upload. No client message sends are implicit.

Previous CSM production baseline, retained for rollback: project `prj_8U3cRoO4xw7Wl5xHjeVhJ56epntP`, team `team_CYujeiq6dPtfcUEHS14lcJuV`, READY production `dpl_5Fvr4S27TTtnqxayjtqT7TCt8gPA`. Re-read before any release; it may change while other agents work.


## Verified production progress, 27 October 2026

- Feature PR [#81](https://github.com/AzizWaheedi/mahara-cockpits/pull/81) merged as `ef2262a1d6e65545334682b7d5750f76f6d889d3`. Packaging PR [#82](https://github.com/AzizWaheedi/mahara-cockpits/pull/82) excludes three internal art review files. The public site shipped from `4b1ddd2fd693b9453a6c7a6fb0bf4abc71c9b609`; its application and Edge code is unchanged from the verified feature tree. CSM frontend confirmation remains pending below.
- Five guarded migrations applied sequentially through Composio, with independent readback: provider versions `20261027131223`, `20261027131335`, `20261027131420`, `20261027131526`, `20261027131615`. Final verification matched 97 function bodies and grants, nine private RLS tables, the private scoped image bucket, seven bilingual catalog entries, and the unchanged existing auth/write contracts.
- `cockpit-csm-api` is ACTIVE v30 with JWT verification on. `offer-door` is ACTIVE v1 with JWT verification off as specified for its public code-based routes. Downloaded live sources match the submitted VPS bundles by AST comparison. The dedicated `OFFER_IP_SALT` was added; all 43 prior secret digests remain unchanged. The secret refresh advanced existing function versions without changing their code or JWT settings.
- Live DNS resolution passed for both A and AAAA records through a fixed-host, JWT-protected diagnostic. The temporary function was removed and absence verified. Seven safe live API/CORS/authentication checks passed, without using a valid client access code.
- Public site: [offer.maharamedia.com](https://offer.maharamedia.com), project `prj_iECnTxKIZdZYenwtKocIYIjc3xpp` in the existing team, READY production deployment `dpl_3MLgRh6oH5pTQhZC7EdZ37esrqmL`. GoDaddy and Vercel independently confirm its project-specific CNAME. The 18-file upload excludes tests, fixtures, dev code and internal review material. Twenty-one HTTP checks cover exact asset hashes, generic metadata, CSP/noindex/no-referrer/no-store, excluded files, redirects and CORS. Ten browser checks cover English/Arabic closed states and layout. The expired state used an explicitly intercepted fictional response against deployed assets, not a real expired client proposal.
- CSM frontend: this session did not deploy it. The first guarded attempt stopped before upload on three existing test/environment failures. A dedicated release-only Python environment fixed the missing interpreter and dependencies; native-feed 22/22 and EOD 14/14 then passed. AskAI's 15 tests passed after isolating environment credentials, its fallback key file and outbound HTTP. [PR #83](https://github.com/AzizWaheedi/mahara-cockpits/pull/83), head `148917e084154ed6163ad46c91530a2b9ab211f6` from parent `4b1ddd2`, merged as `e8fb7c597e136f0f006118f02e610bec2fa6bc70`. Production code and guards are unchanged. The parallel task-management changes on main are preserved. Aziz confirmed on 27 October that Claude is also deploying CSM and asked this session to let that deployment finish; our separate upload was cancelled. Verify the resulting canonical deployment and Offers screen before marking the software release complete.
- After domain and public-page checks, `door_live=true` was enabled through the unchanged audited CEO settings RPC. Independent readback and receipt `9bf23d5b-5175-4994-bb4f-e854f2f0bb44` confirm false to true with the correct actor. All prices remain blank, WhatsApp number absent, and validity 30 days. No eligibility or renewal rule was loosened.
- Reliability monitoring is live through the existing public-sites job. Context commit `fb8d053273c7d40e998014973421f572e02169c7` adds the route health check; 14 scoped tests passed. The natural 10:31:27 UTC tick was healthy with no incident, no output messages and no stderr. Existing checks, schedule and channels remain in place.
- Private rollback/evidence lives at `~/.cache/mahara-ship/rollback/offer-studio-20261027`. Frontend receipts are on the VPS under `~/upsell-build/releases/receipts/4b1ddd2fd693b9453a6c7a6fb0bf4abc71c9b609/`. No provider credentials, private actor IDs or source exports belong in Git. The temporary read-only auth bridge was removed at 10:59:14 UTC: both recorded processes stopped, both loopback ports closed, and local/remote capability files and bridge directories removed. Source checkouts and release receipts remain intact.
