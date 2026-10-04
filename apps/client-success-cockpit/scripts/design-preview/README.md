# CSM design preview

This preview renders the real CSM page components against fictional local data. It does not use Convex, Supabase, GHL, ClickUp or messaging credentials. All writes go to an in-memory adapter. Unsupported actions fail explicitly. Refreshing the page restores the fixtures.

From `apps/client-success-cockpit`:

```sh
bun scripts/design-preview/generate.ts
bun run preview:design
```

Open `http://127.0.0.1:4179/client-success/scripts/design-preview/index.html#/dashboard`.

The banner selects normal, no available times, failed connection, page error, stale data, empty or loading scenarios. Use the normal scenario before moving between screens. A failed-page scenario is scoped to the main CSM snapshot. Change back to Normal, then select Try again or another page. Actions that load on mount need Refresh or navigation after the scenario changes.

The generator runs actual read models in the existing fake database. It uses three fictional clients and a synthetic staff account. The preview aliases live backend hooks only in this Vite config. The production entrypoint and deployment config do not import these adapters.

This verifies layout, navigation and selected interactions. It does not verify production authentication, external resource destinations, live provider delivery, payment reconciliation, Google Calendar sharing, AI completion or report/review workers. See the release checklist in `docs/releases/2026-10-03-csm-design-pass.md` at the repository root.
