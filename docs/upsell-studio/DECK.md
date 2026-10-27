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

Verification status: the coordinating VPS runner reported 549 UI tests passing before the final nullable fixture guard, token-only CSS cleanup and Hot-row utility change. This is an intermediate result, not a final ship check. The initial 228-image visual pass found a low sentence on the capture slide and counted the process slide's canvas background as a footer collision. The source now reserves more footer space; only the root background is excluded from collision measurements, with all descendants still checked. The final build and screenshot rerun remain pending. No local build, test or dev server was run. No provider or production writes were made by the deck builder.

The visual correction pass adds a dark under-stroke behind the ink/teal revision cloud so it is legible on light captures. Real gap marks retain their source-pixel position in Arabic. Record dates use Arabic-Indic digits, and the first-year formula labels its USD inputs beside a converted total. Colors and fonts are named tokens with unchanged values. The full fixture uses separate fictional parked-page and search captures, a verified example logo, three selected fictional project images, and an onboarding answer consistent with the confirmed KWD figure.

Remaining acceptance: run the full seven-fixture matrix in English/Arabic at 1920×1080 and 1366×768, including the 0.67 device scale; inspect the revised capture, process, investment and private views; then record the final Hallmark scores and actual check results. The 16:9 presentation canvas retains the existing shared-screen layout rather than adopting marketing-page navigation or mobile section structures.

Known review boundaries: this pilot has no approved website proof; proof stays absent. The other six offers have catalogue/proposal entries but no presentation deck. The public-door switch stays a release step, rather than an unverified UI toggle.

The old prep-key registry remains exact for onboarding/launch. Offer savers use their own allow-list by deck; offer fields cannot be sent to the older decks, and operational budget fields cannot be sent to an offer deck. This small contract adjustment preserves the existing migration-pinned regression instead of weakening it.
