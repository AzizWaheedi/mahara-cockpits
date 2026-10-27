# All seven offer presentations, 27 October 2026

Public proposals, backend and the seven-deck Client Success release are verified live. The later quick-pitch design pass is tracked separately in QUICK-PITCH.md.

## What changes

Money > Offers now has seven read-only pitch deck previews, separate from the proposal builder. Client-specific presentations retain private preparation, presenter notes, language selection, client eligibility and recorded pitch outcomes. Each offer keeps its own route, price cadence and video slot. Website keeps its existing content; six additional offer decks use the approved bilingual catalogue words.

The UGC deck and new proposals include one real example from each of Aziz's three Drive folders. Wistia Offer Studio folder `jy1g745r43` contains ready media `qlwysqfu2g`, `btp2dokvjr`, `nix1oq0h3a`. Anonymous playback was checked for all three. Their provider-verified full-resolution portrait stills replace blurred swatches. Players load only on a click. Existing issued proposals retain their frozen examples.

Public proposals, closed states, internal previews and deck footers use the genuine Mahara image lockup. Printed proposals use its light-surface version. Proposal srcdoc remains inert, with no events, links or provider frames.

Readiness is per offer. Only Website and Google/AI search need fresh captures. Closer placement needs a named recruiter in private preparation before presentation recording, a new pitch or proposal issuance. Existing prices, SEO lock, eligibility and custom fulfillment holds remain. Only the exact obsolete pilot/UGC seeded holds are cleared. No real client offer was created, sent or accepted during testing.

## Verification

- Public rendering, playback boundaries, brand hashes and inert preview: 30 tests, 143 assertions.
- Proposal builder: 27 tests, including each offer's preparation link and save/conflict recovery.
- Backend: 65 tests, 1,201 assertions across readiness, eligibility, proposals and public parity.
- Browser presentation matrix: 475 measured stops, no layout/runtime failures. Seven hub previews navigate, switch language and close without additional RPCs.
- Public-page matrix: 42 cases across seven offers, English/Arabic and 390/820/1440 widths; correct offer identity, no overflow, real logo and 1080x1920 UGC posters.
- Independent review found and repaired wrong-Website navigation and stale video-setting reloads across offer changes. Additional route/deep-link and mounted race regressions cover them.
- The normal repository ship checks still run before production. No guard bypass or auth bridge is used.

## Release sequence

Commit and merge the isolated `codex/offer-studio-all-presentations` branch. Recheck live function/catalog drift, apply `20261027115820_offer_presentations_readiness.sql` as a recorded transactional migration, then read back functions, grants and catalogue changes. Run unchanged `scripts/ship.sh client-success` using existing direct credentials and verified public cockpit build configuration. Publish only the static offer-site asset allowlist to the existing `mahara-offer` project, and verify canonical assets/headers and authenticated Money > Offers. Do not change shared checkout HEAD.

## Narration remains a separate deliverable

Aziz suggested his existing Nabarati subscription instead of buying ElevenLabs. Six internal Arabic/English auditions were generated using 2,133 existing points. No new subscription was purchased. Aziz approved all seven bilingual scripts and the genuine Mahara logo ending on 27 October 2026, against review-sheet SHA256 `1270fc4f0efeaaedf6d2ce1dee859158699167bcba46a7e3136e4750d0fb768d`. This explicitly replaces the former real Aziz closing-footage requirement. All fourteen full narrations were generated. Eight takes are saved and imported; six remain in Nabarati awaiting export. Aziz asked to stop downloads, so exports, retries and alternate routes are held. Work can continue only with the eight saved takes. Final films, captions, playback and slot mappings still require verification. Silent internal picture layouts are not final videos. Do not point client video slots to an unfinished or unlicensed cut.

## Verified receipts

- Feature PR: [87](https://github.com/AzizWaheedi/mahara-cockpits/pull/87), merge `2c7693642124b15ee44721863f9a2970b3984cc0`.
- Exact-title and fixture-isolation regression correction: [88](https://github.com/AzizWaheedi/mahara-cockpits/pull/88), merge `dd6684f807ff64cfb9910c84d8f4c0c21b2d46dd`. Five test files only; 260 named tests and 3,507 assertions pass. Concurrent Media Buyer PR86 remains in history.
- Import organization correction: [89](https://github.com/AzizWaheedi/mahara-cockpits/pull/89), merge `85a87abaa3c3ad1933f786ace0dab3dae67d87af`. Twenty feature files, imports and whitespace only. The exact CSM Biome check passes across 390 files with zero errors; independent AST and diff review verified unchanged bodies and bindings. The prior frozen guard run passed fresh builds/typechecks for all five apps and all 105 offline suites before stopping at these import diagnostics.
- Public proposal deployment: `dpl_BwyDtuAZKQtzwgKoss14QQFgHBM5`, READY, source `2c7693642124b15ee44721863f9a2970b3984cc0`, canonical `https://offer.maharamedia.com`. All 17 runtime assets match committed bytes and the upload receipt. Both genuine logos and the published header policies match. Explicitly synthetic English/Arabic mobile checks passed with zero real API requests or event posts. Nested excluded asset paths return 404; root excluded filenames return the generic app shell through the existing code rewrite, without exposing source.
- Backend migration: source `20261027115820_offer_presentations_readiness.sql`, SHA256 `72ba22acf9eb36fb34b2ccb71b8539d4cc2a6f7185e5754bfffb578cd71f8df1`, provider receipt version `20261027153102`, name `offer_presentations_readiness_20261027115820`. Seven functions, ownership/search paths/grants, nine private tables, catalogue deltas and audit receipts read back. Prices, settings, issued proposals and access controls remain unchanged. No Edge Function deployment.
- Client Success: unchanged normal guard completed from `85a87abaa3c3ad1933f786ace0dab3dae67d87af`. Production `dpl_8oamSJ4nxkpmPcyNQuMri1RfuDdq` is READY in the correct `mahara-client-success` project, and canonical `/client-success` serves `index-CEJmbpnk.js`. Independent provider/source verification and authenticated Money > Offers readback confirmed seven decks and the seven-offer video selector. The UGC deck loaded the genuine logo and all three examples. No client or settings writes were used for verification.
- Approved film source and offline evidence tooling: [90](https://github.com/AzizWaheedi/mahara-cockpits/pull/90), merge `7b5f632ec2835666efa11b7c21ee61dd247efb95`. This is source only, not a final-video publication.
