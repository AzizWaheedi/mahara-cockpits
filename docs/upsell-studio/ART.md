# Shared website art

## Design plan

Use the already-reviewed architectural film set: a contemporary Gulf villa, a stone wall, a courtyard and an interior. They belong to the fictional Hosh example. No image is client evidence. Every consumer displaying them as work must keep the content's Example label visible; descriptive English and Arabic alt text also identifies them as examples.

Keep the cockpit palette: Deep Space #091333, Deep #060d24, Panel #0e1a42, Teal #00cfc8 and Ink #f2f6fa. Amber remains reserved for things the client supplies. The hero stays photographic. Quiet background exports receive a documented Deep Space composite, leaving readable negative space. No new generation, people, AI Aziz, logos, decorative browser frames or animation is added. Source masters keep their existing grade.

Icons retain the existing 24-unit drafting grid and 1.5-unit line. The public SVG sprite is serialized from that exact geometry. The WhatsApp tail, form arrow and revision delta mirror in RTL. An unlabelled icon is decorative; a labelled one has a title.

## Consumer interface

`src/present/offer/art/index.ts` exports `ART: Record<OfferKey, OfferArt|null>`. Website provides `hero`, bilingual `heroAlt`, `backgrounds: [{id,url}]` with ids `stone`, `courtyard`, `interior`, and `motion:null`. The six later offers remain null. It also exports `OfferIcon` and its name/tone types. Vite imports the WebPs. The static page uses the identical files in `/art/website/`.

`tools/offer-art/selection.website.json` records the reviewed source names, hashes and original generation jobs. It is separate from the unused generation prompt picks. `export.ts` verifies all masters before encoding, enforces dimensions and byte limits, and emits identical SHA-256 manifests to both consumers. No provider calls occur in export or checks.

## Verification status

26 Oct 2026, source stage: the existing source contact sheet was inspected. It contains empty architecture, with no visible faces, people, writing or client identifiers. This is a review of the reused source set, not yet of the final compressed exports.

VPS export, decoded palette checks, byte/dimension checks, sprite parity, final contact-sheet review and TypeScript checks are queued until the orchestrator releases the shared mirror after the active video render. No test pass, final screenshot or Hallmark execution score is claimed at this stage. Arabic alt text is included in the same pending CEO language review as the offer copy.

See `tools/offer-art/README.md` for reproducible commands. Do not deploy or publish from the art helper.
