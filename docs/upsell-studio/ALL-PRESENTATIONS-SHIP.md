# All seven offer presentations, 27 October 2026

Software release preparation. Provider deployment receipts will be added after verification.

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

Aziz suggested his existing Nabarati subscription instead of buying ElevenLabs. Six internal Arabic/English auditions were generated using 2,133 existing points. No new subscription was purchased. The seven bilingual scripts and a proposed genuine-logo ending are prepared for explicit approval; new Arabic wording and replacing the original real Aziz closing footage are not published. Silent internal picture layouts are not final videos. Do not point client video slots to an unfinished or unlicensed cut.
