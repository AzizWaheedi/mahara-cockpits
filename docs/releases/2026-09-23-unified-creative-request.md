# Unified creative request, prepared 23 September 2026

Status: local branch only. Production was not changed by this preparation.

## Buyer flow

- In a campaign's Recommendations panel, **Send to another team** now offers one **New creative** action in place of the former three creative choices. The ad row uses the same action and form.
- The buyer chooses one reason: more ads to test, new message/angle/hook, refresh a fatigued ad, or improve the edit/visuals. Note is optional. Starting from an ad attaches that ad automatically; starting from the campaign offers an optional affected-ad selector.
- One audited Creative Triage request and one Creative Request task on the director's existing board are linked. Existing open requests are reused. The director's work feed recognizes the new task title.
- Changes & Results shows the chosen reason and lets the buyer link the new ad and review results. A campaign-wide request has no original-ad comparison; it shows the new ad and the campaign's observed change without treating missing original-ad data as zero.

## Rollout order

1. Run `scripts/apply-unified-creative-migration.ps1` with its default rollback dry run, then `-Apply`, then `-VerifyOnly` against Creative Triage.
2. Deploy the media buyer backend, then the front end via `scripts/ship.sh media-buyer` and verify the live form and director work queue.
3. Observe the first real buyer-created request through ClickUp, asset handoff, launch link, and result review. Do not create a synthetic client request for verification.

## Preparation checks

- Schema migration rollback smoke passed, including an audited campaign-wide request. No schema or row persisted.
- Media buyer TypeScript build and Vite/PWA production build passed using the existing generated-code and package dependencies.
- `scripts/change-results.test.ts`: 3 passed.
- Targeted Biome lint passed with existing warnings; `git diff --check` passed.

The original local `mahara-cockpits` main checkout and the separate `mahara-context` checkout were preserved. Context sync stopped on pre-existing local changes, so this note is based on the existing context checkout and the current cockpit source.
