# Client offer page

Static ESM page, no build. It consumes only the public proposal returned by `offer-door`. `core.js` exports the pure `render(publicProposal, strings, opts)` and `stateView(state, strings, contact)`. Pass one language's `STRINGS` and optionally `{preview, proposalUrl, assetBase, posterFallback}`. Signed pictures use `{url}`, never a raw bucket/path. Everything is escaped, external pictures and video embeds have explicit host checks, and WhatsApp actions accept only `https://wa.me/<digits>`.

The design follows a client dossier: name and video first, the actual finding directly below, scope as a ruled list, and investment as a bill. It shares the approved navy/teal palette and architectural example with the deck. The fictional art is always tagged Example. No empty sections or duplicated calls to action. Captures retain their source captions and dates. The desktop columns collapse into a readable phone flow; the print layout retains the proposal URL.

## Preview contract

The builder embeds the exact bytes of `core.js`, `strings.js`, `offer.js` and `offer.css`. It sets `window.__OFFER_PREVIEW__ = true` before importing `offer.js`. The controller installs a parent-only message listener, sends `{type:'offer:ready'}`, and accepts `{type:'offer:preview', proposal, strings?}`. It renders into `<main id="app">`. No preview code reads storage, contacts the door, records events or activates links. An image already present in the public preview can load; the fallback architecture comes from the builder-set `window.__OFFER_ART__` WebP data URL. Only a bounded base64 WebP is accepted, so preview matches the live hero without an external asset request. No shared external CSS imports are needed.

Live mode stores only a random `mm-offer-device`, performs one no-store read with a 12-second timeout, and recognises `?gone=1`, `?busy=1`, `?error=1`. A valid `pv` travels on both read and event requests. The provider iframe is created only on play. The CTA starts the event before navigation and never waits more than 800 ms for analytics. Server errors show generic copy, not returned details. These events record viewing, not acceptance or payment.

## Review and checks

On the VPS after orchestrator approval:

```
bun test sites/offer/core.test.js sites/offer/offer.test.js
bun sites/offer/dev-door.ts 5421
```

The harness binds to loopback and uses only fictional data and the catalog's exact words. Visit `/abcdefghjkmn?mode=open` or `mode=arabic`, `expired`, `archived`, `unknown`, `busy`, `error`, `garbage`. Its CSP prevents any provider iframe from loading. All event writes are local no-ops. No page fixture is a real proposal.

Source stage, 26 Oct 2026: tests and browser review are pending the shared VPS render completing. Review at 390 and 1280 in both languages, including every closed state and print. Do not claim a Hallmark execution score or parity before those checks run. Arabic copy, final video licences/closing clip and deployment remain separate approval gates owned by the orchestrator. No deploy is performed by these files.

`logo.png`, `mark.png`, `favicon.png`, `apple-touch-icon.png` and `og.png` reuse the existing call-link brand files. Metadata is generic and contains no client name or amount. The `/v/:code` redirect targets `offer-door`, never the retired function name. Production headers prohibit framing, indexing, referrers and arbitrary scripts; this is why the internal builder uses inert srcdoc instead of framing the live page.

## Presenter examples and genuine branding, 27 October 2026
All page states use the real Mahara Media image lockup. The matching light-surface image is used for print. Sandboxed previews receive bounded trusted PNG data URLs, without reaching outside the preview for a brand asset.
Frozen work links on the exact Mahara Wistia media path render as portrait example cards. No provider frame loads before a click. The original source link remains available. Example playback does not count as a main offer-demo play, and the preview remains inert.
The fictional public harness also supports websiteen, websitear, campaignen, campaignar, seoen, seoar, smmen, smmar, ugcen, ugcar, closeren, closerar, cameramanen and cameramanar. Its $1,000 non-website figures are synthetic test values only. Wistia posters can load, but its CSP still blocks provider video frames.
