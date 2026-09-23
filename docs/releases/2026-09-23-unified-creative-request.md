# Unified creative request, prepared 23 September 2026

Status: live on 23 September 2026 at https://cockpit.maharamedia.com. Source commit `9256577a4e42fcd3541414899eb0e314c2e56eb8` is on GitHub main. Production Vercel deployment `dpl_DMH3pax5wqyz4iZCYLhaNyvLZhiW` was Ready and aliased to the cockpit domain.

## Buyer flow

- In a campaign's Recommendations panel, **Send to another team** now offers one **New creative** action in place of the former three creative choices. The ad row uses the same action and form.
- The buyer chooses one reason: more ads to test, new message/angle/hook, refresh a fatigued ad, or improve the edit/visuals. Note is optional. Starting from an ad attaches that ad automatically; starting from the campaign offers an optional affected-ad selector.
- One audited Creative Triage request and one Creative Request task on the director's existing board are linked. Existing open requests are reused. The director's work feed recognizes the new task title.
- Changes & Results shows the chosen reason and lets the buyer link the new ad and review results. A campaign-wide request has no original-ad comparison; it shows the new ad and the campaign's observed change without treating missing original-ad data as zero.

## Rollout and verification

1. The Creative Triage migration passed rollback smoke, was applied, and passed read-only verification. Both new nullable source fields, the reason check, campaign deduplication index, RLS, service-role grant, and audit trigger were present. The browser role had no direct table access. Request count was zero at verification.
2. `scripts/ship.sh media-buyer` deployed the production Convex backend, built the Vite/PWA site, uploaded it to Vercel, confirmed the changed live bundle, and returned an `ok` read-only smoke check. The first Vercel attempt lacked locally generated Convex bindings in the upload; a retry with real generated files passed.
3. The live site returned HTTP 200. Its authenticated app chunk contained **New creative** and all four reasons, and did not contain the removed **Replacement creative — fatigue** label. Vercel reported Ready on the production domain.
4. The first real buyer-created request still needs observation through ClickUp, asset handoff, launch link, and result review. No synthetic client request was created.

## Preflight checks

- Schema migration rollback smoke passed, including an audited campaign-wide request. No schema or row persisted during the dry run.
- Media buyer TypeScript build and Vite/PWA production build passed using the existing generated-code and package dependencies.
- `scripts/change-results.test.ts`: 3 passed.
- Targeted Biome lint passed with existing warnings; `git diff --check` passed.

The original local `mahara-cockpits` main checkout and the separate `mahara-context` checkout were preserved. Context sync stopped on pre-existing local changes, so this note is based on the existing context checkout and the current cockpit source.
