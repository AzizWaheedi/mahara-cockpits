# Shared offer artwork

The current path reuses the four reviewed Website film masters. It does not generate images or require provider credentials. `selection.website.json` owns their filenames, source MD5s, existing job IDs, Example labels and export treatments. The older `prompts.website.json`, generation helper and grading helpers remain available for a separately approved future generation run; their empty picks do not describe this selection.

Run on the VPS, after the active video render finishes and the orchestrator allows a mirror sync:

```
bun run doctor
bun run export
bun run sprite
bun run sheet
bun run check
bun run typecheck
```

The original already-graded PNGs stay at `~/upsell-studio-video/website/final/art`. Override this with `OFFER_ART_SOURCE` only when pointing to the same checksummed files. Staging/report output uses `OFFER_ART_MEDIA` (default `~/upsell-build/media/art`). Source checksum changes fail closed. No overwrite or new generation is attempted.

Exports are 1920×1080 WebP, bounded at 250,000 bytes for the hero, 150,000 for each background and 800,000 for the set. Compression tries quality 88 down to 64; it fails rather than silently shipping a lower quality. The hero gets only a highlight safety cap; backgrounds have an explicit 68% Deep Space composite for quiet text placement. This does not modify or regrade film masters. The exporter decodes each candidate and checks its brightest pixel. Because lossy compression can overshoot an input cap, it increases the highlight reserve from 12 to at most 44 RGB levels below Ink until the actual decoded output passes. The manifest records that reserve and measured peak; the independent decoded-pixel test remains unchanged.

Both consumers receive identical images plus provenance manifests. `sprite.ts` serializes the existing React icon geometry; it is not a second icon set. `sheet.mjs` builds a static review page beside the exports. Do not expose the contact sheet as client work. Before delivery, inspect the final exports at full size and at deck scale; tests cannot prove absence of faces or assess composition.

The Mac is source-edit-only. `doctor` and `export` refuse macOS. Never use the old local fallback in a build wrapper.
