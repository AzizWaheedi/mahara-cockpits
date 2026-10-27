# Website offer deck

## Design plan

The cockpit keeps Geist, its existing navy and teal tokens, compact controls and quiet divided rows. The presentation uses Deep Space #091333, Deep #060d24, Panel #0e1a42, Teal #00cfc8 and Ink #f2f6fa. Amber #f5b84b is reserved for the three things the client supplies. Type is Geist 56/30/24 and IBM Plex Sans Arabic at the larger Arabic floor. The signature is the architectural revision cloud: ink around the actual gap, teal around the proposed work. No generated browser chrome, gradients, glow or looping animation.

Preparation is a working checklist beside a real slide preview. The notes keep the call's choices and negotiated price private. Offers uses a price schedule with one save per completed edit; one quiet row says what is waiting.

Not in scope: other six decks, company Hot list rules, CEO cockpit, sending messages, provider writes during verification, deployment.

How we know it works: price/copy/prep/fixture tests; existing deck regression tests; coordinated VPS typecheck and browser captures at the contract sizes; no claim of verification until those checks run.

## Integration

Offer kinds, source schemas and price helpers are exported for the proposal builder. Offer videos keep a separate registry; the original twelve video slots remain unchanged. The common shell uses the offer registry for its video items and resolves both registries for notes-window playback. Captures and price readiness are attached to offer slide definitions in PresentApp, without changing the common DeckData shape.

## Implemented surface

- Five main website slides share the existing presentation engine, language switch, notes window, preview and keyboard navigation. H reveals the process sheet; V uses the offer video registry. There is no P proof slide until approved proof is supplied.
- Actual captures keep their date, searched-from city and selected revision mark. The small numbered selector switches among selected captures. Missing captures hide the first slide. Site checks distinguish unchecked, failing and broken; the frontend preserves the server wording.
- The bill reads only the opening price. Private notes log held-full, an optional agreed price with reason, answer, follow-up and video recap. Before a production pitch save, the presented language is saved to offer prep and flushed. A fresh server read confirms current price, link, language and client-request fields, so a failed prep save cannot log stale values or choose the wrong recap language.
- Prep manages three captures, exact client words, language and dialect, the opening price and existing payment link, dated project value, client image selection and logo candidates. The project-value controls can explicitly confirm an onboarding answer with amount, stated currency and answer date; ranges are never parsed or guessed. Win marking and a dated client-request override are available on the private refusal view.
- Money > Offers provides CEO-only list edits, one-click hints, the SEO price lock, English/Arabic website video checks, settings and a scoped pitch log. The client Hot row and on-demand picker use server readiness. An unchecked website still exposes its missing prep pieces without being labelled ready. The Hot row uses existing cockpit utility classes and does not depend on a presentation stylesheet having loaded.
- Capture and logo write requests retain retry identities. Capture reserve retries with an already-ready or uploaded object skip duplicate PUTs. Video check refusals preserve nullable fields and the server's exact sentence. A nullable capture filename is accepted and displayed as “Capture”.

## Harness and checks

`/client-success/offer-harness.html?fixture=full&lang=en&view=present&slide=saw&stop=0&still=1`

Views: `present`, `notes`, `prep`, `picker`, `hotrow`, `offers`. `role=ceo` enables in-memory catalogue editing only. Fixtures: `full`, `sparse`, `dwy`, `noprice`, `saudi`, plus `refused` and `asked`. All names and captured browser content are fictional. The harness never invokes a provider write.

Focused tests cover complete versus missing prices, locks and below-list reasons, currency math, every canvas stop in both languages, private final-price exclusion, unsafe raw goals, offer prep keys, malformed-video refusal parsing, idempotent upload retries, picker order, Hot row readiness and list permissions. `offer-shots.mjs` captures the fixture matrix on the VPS.

Verification recorded 27 October 2026: the coordinating VPS runner reported 691 UI regressions passing (662 plus 29 Blueprint-host cases), the production build, 162 API/public tests and 14 Python tests. The full 648-canvas deck matrix passed with no overlap findings; the initial 23 proposal browser checks passed. The earlier capture-footer finding was corrected, and only the process slide's root background is excluded from collision measurements, with descendants still checked. These results precede the final public-page text-wrapping/token patch described below. Its targeted browser, byte-parity and build rerun remains pending. No local build, test or dev server was run by the deck builder; the only local asset command copied canonical public-page files into the packaged preview. No provider or production writes were made by the deck builder.

The visual correction pass adds a dark under-stroke behind the ink/teal revision cloud so it is legible on light captures. Real gap marks retain their source-pixel position in Arabic. Record dates use Arabic-Indic digits, and the first-year formula labels its USD inputs beside a converted total. Colors and fonts are named tokens with unchanged values. The full fixture uses separate fictional parked-page and search captures, a verified example logo, three selected fictional project images, and an onboarding answer consistent with the confirmed KWD figure.

The source-and-screenshot review inspected the revised capture cloud, English process sheet, Arabic investment, private prep/notes, Offers tab, Hot row, proposal builder and Arabic client page at 390 px. The 16:9 presentation matrix covers English/Arabic at 1920×1080 and 1366×768, including 0.67 device scale. The final proposal hardening preserves the design while allowing long client/CSM names, headings and line items to wrap. Canonical hover/print/font values now use named tokens, and the packaged preview was synced from the canonical page. The browser runner now covers 320/375/390/414/768/1280 px and eight additional long-text cases, measuring glyph rectangles inside their container and viewport rather than trusting document scroll width beneath overflow clipping. Those added cases have not yet been reported as passed.

Known review boundaries: this pilot has no approved website proof; proof stays absent. The other six offers have catalogue/proposal entries but no presentation deck. The public-door switch stays a release step, rather than an unverified UI toggle.

The old prep-key registry remains exact for onboarding/launch. Offer savers use their own allow-list by deck; offer fields cannot be sent to the older decks, and operational budget fields cannot be sent to an offer deck. This small contract adjustment preserves the existing migration-pinned regression instead of weakening it.


## Bounded Hallmark review

<!-- Hallmark · bounded pre-emit critique: P4 H4 E4 S5 R4 V4 · Mahara existing system -->

These are reviewer judgments from the inspected source and screenshots, not a claim that all 58 gates were individually browser-certified. Philosophy 4: a conversation proceeds from the actual finding to scope and investment. Hierarchy 4: one slide purpose and a distinct private work area. Execution 4: the reviewed compositions have clear type, rules, mirrored Arabic layout and reserved footer space; the final mobile stress run is still a verification item. Specificity 5: real dated captures, the architectural revision cloud, explicit project provenance and the client bill are particular to this workflow. Restraint 4: no proof without evidence, no invented returns, no decorative chrome or automatic media playback. Variety 4: record, quote, drawing, bill and process compositions differ by purpose while retaining the approved presentation shell.

Applicable visual, motion, typography, honest-content and chrome gates were reviewed against the current design. No purple gradients, equal feature-card template, decorative icon set, italic display type, invented performance figures or browser/phone chrome were found. Icons are Lucide or purposeful custom SVG; the revision cloud is explicitly hidden from assistive technology and anchors to the actual capture. Motion is limited and has a reduced-motion fallback. Media is click-to-play; the public poster uses high fetch priority. The screenshots show readable English and Arabic, with distinct quiet, primary and private regions.

Source palette checks give at least 8.55:1 for the examined muted/body pairs on the navy panels, 9.86:1 for dark action text on teal, and 9.33:1 for teal focus against the public navy page. These are calculations of the named source pairs, not an assertion that every inherited or disabled computed state was measured. The public page has explicit focus, active and disabled styles. Its text-wrap and token findings (gates 48 and 51) are corrected in source, subject to the targeted rerun.

Applicability is deliberately bounded:

- Genre rotation, prior-project diversification, marketing hero/nav/footer formulas and a new theme are not applicable to this addition inside Mahara's approved cockpit and 16:9 presentation contract (gates 6, 8, 21, 32, 42–44, 57). The existing record/title row is retained as specified; it is not a newly invented marketing eyebrow arrangement (54).
- Existing cockpit panels, compact controls, spacing and helper states retain the shared kit. Literal marketing-page card/prose/spacing formulas and a wholesale replacement of the kit's state/44 px prescriptions are not claimed as passed (4, 24–26, 39). This review did not expand the task into a shared-control redesign.
- Tooltip timing and carousel pause rules have no new matching feature here (17–18). The mobile phone-flow rules apply to the public proposal; the deck uses its explicit scaled 16:9 viewport contract. No complete mobile claim is made for private desktop prep.
- Public-page mobile gates 34, 49–53, 55–56 remain tied to the added viewport/text-bounds run. Source uses clipping at the page edge, shrinking text/image tracks, a single-column phone flow, upright non-colliding heads and no competing sticky page headers. Long dynamic copy is allowed to wrap rather than silently truncating client content.

No observed blocker remains in the reviewed deck/private compositions. Final public-page acceptance requires the targeted rerun above; no “58/58” or universal mobile certification is asserted.

Final acceptance update: the coordinating VPS runner completed all 71 public-proposal cases, all 29 targeted proposal unit tests and the full CSM build after the wrapping/token fix. The public mobile/text-bounds item above is closed. Inherited/private-component limits remain as stated. Evidence: `~/upsell-build/media/shots/proposal-final/report.json`.
