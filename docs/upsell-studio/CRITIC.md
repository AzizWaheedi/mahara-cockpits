# Upsell Studio source critique

Initial review 26 October 2026, 21:27 UTC; release-boundary follow-up 27 October 2026, 00:55 UTC; video handoff/still review 27 October 2026, 01:19 UTC, in the `billing-pending` worktree. This is an independent source and sampled-image review, not a production acceptance certificate. No remote writes, renders, builds, paid media calls or deployment were performed by this reviewer.

## Readiness

- Source review: no new critical integration or client-data exposure blocker found in the reviewed paths. This is a bounded finding, not a security guarantee.
- Both earlier proposal UX defects are fixed in the current source, as described below. Their implementation and image-signing test definitions were reviewed; their execution was not independently witnessed here.
- Preview packaging: the four public-page source files and their cockpit copies were byte-identical at review time. This establishes source parity, not rendered or browser parity.
- Artwork: the parent reported the central ART checks passing after the export repairs. The remaining `sizes` TypeScript annotation was corrected locally. This reviewer did not rerun those checks or independently certify the final typecheck.
- Video: the parent reports all 14 Python tests, the local-render doctor and the completed isolated `v4-r2` internal check passed (`ok: true`, `clientReady: false`). This reviewer directly read the received manifest and visually inspected the contact sheet and both posters. Master measurements are recorded metadata, and full-motion/phone-speaker review is still outstanding.
- Other central checks reported by the parent: database 113 passed/0 failed, Edge 157 passed/0 failed, proposal browser 23/23 passed. The final source-fixture typecheck correction still awaits its central rerun at this checkpoint. These counts are attributed reports, not tests executed by this reviewer.
- Release boundary: unset prices/videos and `door_live=false` do not make an enabled production cockpit internal-only. The Arabic and media approval boundaries below remain unresolved. Do not call those defaults a client-exposure lock.
- No production deployment, external video publication or client-ready delivery is certified by this report.

## Reviewed paths and observations

All paths below are relative to this repository.

### Proposal integration

Reviewed `apps/client-success-cockpit/src/pages/money/offers/ProposalPage.tsx`, the files under `proposal/` (`ProposalBuilder`, `ProposalPreview`, `ProposalCard`, `ProposalsCard`, `MakeProposalButton`, `proposalSources`, `proposalContent`, `proposalSaver`, `publicProposal`, `srcdoc`, `srcdocSource`), the proposal route in `auth/authenticated/AuthenticatedAppRoutes.tsx`, and the corresponding client-profile entry points in `pages/CsmPage.tsx`.

Observed safeguards:

- Loading checks that a proposal belongs to the client represented by the route.
- Proposal creation reuses a per-tab request ID for retries. Autosaving serializes writes, retains newer pending edits and provides conflict/error recovery.
- The public DTO uses explicit nested Zod objects, which strip unknown internal keys. Signed image URLs replace private storage paths before the iframe receives the proposal.
- Live-preview activity uses its own server-issued preview token. Client links and internal previews are separate actions.
- The expired-link fast path now refuses to copy an expired link and explains how to extend it. The date field uses the server's `valid_until` problem key.
- Locked prices have an explicit action to apply the current catalog amounts. Desktop preview uses a real 1280-pixel viewport scaled into its container; phone preview uses 390 pixels.

These observations establish implementation presence. They do not establish live permissions, persistence, clipboard behaviour or successful end-to-end use.

### Public page and packaged preview

Reviewed `sites/offer/{core.js,offer.js,offer.css,index.html,vercel.json,README.md}` and the packaging helpers/tests in `apps/client-success-cockpit/scripts/{offer-page-sync.mjs,proposal-srcdoc.test.ts}`.

- Rendering escapes client text. Picture hosts, provider embed paths and WhatsApp URL shapes are checked.
- The preview iframe receives proposal values through a parent-only message listener. Its `allow-scripts` sandbox omits same-origin privileges; CSP blocks connections, provider frames and forms. Preview actions are inert, and the preview branch does not read storage or call the door.
- The trusted inline WebP fallback preserves the shared architectural poster without adding a preview asset fetch. Arbitrary fallback URLs are rejected.
- Live mode creates the provider iframe only after a play click. CTA tracking starts before navigation and has an 800 ms maximum wait. A failed event does not permanently trap the visitor.
- Source has language/direction attributes, logical positioning, price isolation with `bdi`, native controls, focus styles and reduced-motion rules. Explicit list roles and Arabic-Indic deliverable counters are now present.
- Production metadata is generic; the site headers prohibit framing and referrers. These are configuration observations, not deployed-header readbacks.

The matching SHA1 values observed for each canonical file and its cockpit `proposal/page/` copy were:

| File | SHA1 |
| --- | --- |
| `core.js` | `3264a1731a1feb073595085125f5c867b037e1c8` |
| `offer.js` | `cba05bd61b991d97cfb02a42514f1c251bd6873d` |
| `offer.css` | `15f51ded6b51643b248404c965013e052a314bd7` |
| `strings.js` | `e19b50913751a366c9a1e5254529e98a7625f7ff` |

Keyboard, screen-reader, print, mobile, Arabic glyph and screenshot parity checks are not claimed by this source review.

## Previous UX findings, now fixed in source

### Fixed: selected evidence disappeared silently when URL signing failed

The earlier implementation converted a failed signed-URL request to `null` and removed that capture or logo from the preview. Current `proposal/proposalSources.ts:260-300` instead throws an actionable `ProposalError` for missing, failed or thrown signing results. Selected captures are no longer filtered away. The preview's error state explains how to retry.

Reviewed `scripts/proposal-images.test.ts`: success retains selected images; failed logo/capture signing, missing URLs and network errors reject with public recovery copy; existing URLs avoid a signing request. Test source presence is confirmed, execution is not claimed by this reviewer.

### Fixed: adding a capture in preparation left the builder's choices stale

Current `proposal/ProposalBuilder.tsx:294-298` implements a refresh action that first flushes pending edits, then reloads the bundle. The button at lines 846-852 reads "Refresh captures and logos". The existing action guard and revision-aware saver remain in use; a failed save prevents replacement of unsaved edits.

This resolves the missing refresh path in source. A full browser round trip with fixture uploads and pending edits remains a verification item unless separately recorded by the orchestrator.

## Release boundary: reviewable code is not yet client-ready content

The exact rules remain:

- `hw-notes/upsell-studio/PLAN.md:687`: "The CEO approves all new Arabic in one batch before any client sees it." The first paragraph of `docs/upsell-studio/ARABIC-FOR-APPROVAL.md` repeats that boundary. A copy-rule test or source review is not that approval. The exception for a CSM's own edited words does not approve the seeded Arabic catalog, deck, notes or page strings.
- PLAN amendment 7 keeps the existing free-plan English narration for internal review and defers the Arabic recording until commercial use is available. Merely upgrading an account does not demonstrate rights for an older take; the delivery evidence must identify the actual recording and script.
- `CONTRACT.md:904-906` permits a labelled placeholder closing card for a preview while Aziz's real footage is missing. It does not make that cut client-ready. His real close is eight seconds, and no artificial Aziz face or voice is permitted.
- `CONTRACT.md:941` requires CEO OK before uploading to Wistia and saving the per-language `offer_website:demo` slots. Final video readiness also requires technical checks, current narration, Arabic script approval and recorded visual/phone-speaker review for the exact render.
- The original CONTRACT sections 0 and 9 were build-only. The user-supplied handoff section 7 later supplies a conditional ship sequence, only after verification, critic review and its section 4 are complete. That sequence does not waive Arabic approval or the media rights/real-footage requirements. Actual release authorization and final checks remain the orchestrator's responsibility.

Why the proposed defaults are insufficient isolation:

- `20261026v_upsell_offer_decks.sql:1375-1378` uses `doorLive` to choose a tracked `/v/` link or the direct saved video URL. False means untracked, not inaccessible.
- `20261026w_upsell_proposals.sql:639` (freeze/send) and `:991-1017` (public open), plus `supabase/functions/offer-door/handler.ts`'s proposal route, do not enforce `door_live` as a release switch.
- The send check blocks a missing default video but accepts the custom-video path. For an unlocked offer, CSMs may supply the client's price even while the catalog list is blank. That is intentional under PLAN amendment 3 and must not be changed into a new CEO price-approval requirement.
- Arabic deck/proposal text and the language selectors are present in the enabled UI. The video manifest's `clientReady` checks are an offline delivery boundary; they are not consulted by the catalog/video URL controls or public proposal door.

Therefore protected internal review, harness work and staging can proceed while approvals are pending. An internal-only production release needs an actual exposure boundary, such as restricted review access or disabled client presentation/publication paths. Do not certify an ordinary staff-facing rollout as safely internal-only from blank defaults and `door_live=false` alone. Keep the unlicensed/placeholder film private, do not publish it or fill its default video slots, and obtain Arabic approval before clients see that text. No approval or guard is weakened by this report.

## Internal video verification and delivery gates

Reviewed `tools/offer-video/scripts/{render-v4.sh,doctor.sh,check.py,manifest_v4.py,copy-check.ts,handoff_v4.py}`, `film/{v4a.py,build.py,delivery.py}` and the delivery package/schema/test additions.

The isolated source root is `~/upsell-build/video-review-20261026`, with `apps`, `supabase` and video `node_modules` linked to the existing mirror. The exact centrally-run command is:

```sh
cd "$HOME/upsell-build/video-review-20261026/tools/offer-video"
PATH="$HOME/upsell-build/bin:$PATH" OFFER_VIDEO_MEDIA="$HOME/upsell-studio-video/website" OFFER_VIDEO_VERSION=v4-r2 INTERNAL_MUSIC_PREVIEW=0 BED=off bash scripts/render-v4.sh en ar
```

This reuses existing media. The absolute copy-check script path avoids resolving through the symlinked application's original checkout. The default media root is intentional: the shell's `OFFER_VIDEO_MEDIA` override is not forwarded as `--media` to the film builder, so a different media root is not certified here.

The orchestrator reports completed outputs at `~/upsell-studio-video/website/out/v4-r2` and projects at `~/upsell-studio-video/website/v4-r2/hf`. The small handoff was received at `hw-notes/upsell-studio/video/website/v4-r2`: two proxies, two posters, two VTTs, manifest and contact sheet. No masters are in that Mac handoff. Existing `out/v4` is preserved, and no optional music preview was generated.

The internal check may pass technical requirements while returning `clientReady: false` and explicit delivery blockers. Client-ready mode requires exact-media evidence for commercial voice use and the current script, matching recorded narration, a reviewed real eight-second Aziz closing clip with narrator audio ending at 52 seconds, CEO approval of the Arabic script, and final picture/phone-speaker review. Missing Arabic narration remains a blocker. Source changes also invalidate older render fingerprints.

Neither a successful internal render nor files merely existing satisfy those approvals. No artificial Aziz voice or face, new synthesis, paid generation, client upload or public delivery is authorized by this verification command. The proxy-only handoff remains separate from the master files.

### Preflight follow-up

The first isolated attempt stopped before building because the global doctor included `Docker running: false`. The CLI reference makes Docker specific to `render --docker`. The local-render profile now requires the actual renderer/resource checks, exempts only the exact unused Docker/transcription/synthesis checks, and fails closed on missing, malformed, duplicate or unknown failed results. Doctor exit 0/1 also requires valid passing local-profile JSON; other exits fail. Output creation moved after dependency/baked-media preflight. The parent subsequently reported all 14 Python tests, preflight and the resumed internal render passing; this reviewer did not execute them.

### Received render evidence and visual limits

Direct manifest readback confirms `version: v4-r2`, `clientReady: false`, both `hyperframes_check_ok: true`, and `copy_check: {ok: true, checked: 180, problems: []}`. All four recorded masters are 60.0 s, 1920×1080 at 30 fps. English main/clean are -15.1/-15.2 LUFS with -1.3/-1.4 dBTP; Arabic main/clean are -28.0 LUFS and -1.0 dBTP with no narrator. Both closes remain placeholders. The two received proxies' sizes match the manifest: 2,953,215 bytes English and 2,856,069 bytes Arabic.

The seven-frame-per-language sheet and both 1920×1080 posters were visually inspected. Sampled beats form the intended architectural/site story, and the posters have visible Example labels, a mirrored Arabic layout, connected Arabic headline glyphs and no obvious clipped title. Three additional 1280-pixel-wide VPS-derived frames at English 24.8, 25.0 and 25.2 s confirm that the overlapping mobile view fades out during the switch to the enquiry form and is gone by 25.2. It is a transition, not a persistent double exposure, and no fix was requested. No final visual score is assigned. These samples do not establish every-frame cleanliness, full-motion pacing, phone-size readability or an audio listening pass.

The manifest correctly retains the commercial/current-script narration evidence gaps, old English narration mismatch, missing Arabic narrator, missing real closing clips, missing CEO Arabic approval and missing final picture/phone-speaker approvals. Still-image inspection does not satisfy those delivery approvals. See `VIDEO.md` for the detailed measurement table and handoff paths.

## Final integration verification, 27 October 2026

The coordinating VPS runner completed the latest-main integration: 691 scoped UI tests (662 across 31 files plus 29 Blueprint-host tests), 162 API/public/WhatsApp-probe tests, full CSM typecheck/build, shared parity, art icon/assets checks and 14 Python regressions passed. The earlier nullable fictional-source error is fixed. The seven-fixture deck matrix passed 648 measured canvases plus private views/players; proposal browser checks passed all 23 scenarios. These checks support internal review, not a production or client-ready-media claim.


### Bounded frontend Hallmark follow-up, 27 October 2026

The deck builder reviewed Hallmark's six axes and 58-gate reference against source and sampled final screenshots: revised capture cloud, process sheet, Arabic investment, prep, notes, Offers, Hot row, proposal builder and the Arabic 390 px client page. The judged scores are P4 H4 E4 S5 R4 V4, with evidence and applicability recorded in `DECK.md`. This is not a 58/58 certification and does not replace the separate Arabic/media release approvals above.

No new visual blocker was observed in those deck/private compositions. The public proposal review found missing long-word wrapping and one-off font/hover/print values. The canonical public CSS now wraps long client/CSM names, headings and line items, shrinks its scope track safely, and consumes named tokens. The cockpit preview copy was regenerated with the lightweight sync helper. These changes supersede the historical CSS SHA1 in the earlier source-parity table; the targeted byte-parity/build rerun will establish the new snapshot.

The browser script now examines 320/375/390/414/768/1280 px in both languages and adds eight long unbroken name/CSM/title/scope/bill-label cases. It measures actual text rectangles against their containers and viewport, so root clipping cannot turn hidden text into a false pass, and confirms that stress fields wrap. Expected report count is 71. At this documentation checkpoint the coordinating runner has started this targeted rerun; no 71-case pass is yet claimed.

Measured/source distinctions: the existing 648-canvas and 23-proposal results are reported coordinated browser checks. The screenshot judgments above are direct visual inspection. Named-color WCAG calculations support the examined body/muted/action pairs (at least 8.55:1), not every inherited computed control state. Public focus/active/disabled rules and reduced-motion behavior are present in source. Existing cockpit kit sizing/states and private desktop prep are inherited, not certified as a new mobile component library. Marketing-page hero/nav/footer formulas, theme rotation and cross-project diversification do not override the user-approved cockpit and scaled 16:9 contract. Long dynamic client content may wrap rather than being silently truncated. The pending targeted run is the remaining acceptance item for this CSS-only follow-up.

Final follow-up result: all 71 public-proposal browser checks passed, with 29 targeted proposal unit tests and the full CSM build passing again. The remaining CSS acceptance item above is closed. Both offline Edge bundles also passed against matching merged worktree source manifests. No production or client-media approval is implied.
