# Sales day review and live demo attribution

Requested by Aziz on 22 October 2026. Built on isolated branch
`codex/sales-eod-live-transfer-20261022` from `8e569fc1`.

## Plan

- Review assigned intro, demo and follow-up outcomes before EOD submission.
- Fill totals from saved outcomes. Preserve manual corrections and compare them with computed values.
- Edit the pipeline from the lead profile with the existing audited HighLevel action.
- Record an intro that became a demo. Preserve the intro and credit the actual demo host, including a setter working full cycle.
- Use the existing navy and teal controls, short forms and clear saved states.

Not in scope: A wider redesign, changes to other agents' checkouts, live client sends, automatic changes to payroll rules, or production rollout in this build.

How we know it works: API and database tests cover seat boundaries, missing outcomes, duplicate submissions, uncertain provider results and correct attribution. Fictional desktop and phone checks cover the real components. A production release requires provider readback.

## Data rules

An explicit terminal CRM outcome already counts as reviewed. A past confirmation does not prove attendance.
The review covers assigned scheduled sales calls, including follow-ups. Maqsam dial totals remain separate reference numbers.
The chosen EOD answers remain the submitted reporting record. The computed values are retained beside them.
The rep can use either the setter or closer report for full-cycle work.
Recording a demo does not declare a sale or create revenue. Existing New Client Forms remain the source for those figures.

HighLevel appointment writes use `toNotify: false` for retrospective records and EOD corrections.
That parameter suppresses HighLevel automations. Provider calendar invite settings are separate, so this is not a promise that no provider invitation can occur.
Reference: https://marketplace.gohighlevel.com/docs/2021-04-15/ghl/calendars/create-appointment/

## Verification, 22 October 2026

- Frontend: production compilation passed with a fictional publishable key (compile check only, never a deploy artifact). Biome passed for changed frontend files. All frontend tests passed: 1,224 pass, 2 existing skips.
- Backend: 27 focused review/handoff tests, 8 authenticated router tests, 10 existing EOD tests, 40 existing core-rule tests, and 17 existing board/router tests passed. New backend modules pass strict TypeScript checking.
- Database: 7 tests ran the migration and RPC on PGlite 0.3.14 with fictional data. Verified atomic report/outbox/audit rollback, duplicate submission, manual-vs-computed values, stale review, missing outcomes, seat links, service-only write grants, and handoff uniqueness.
- Browser: real components with browser-only fixtures at 1440, 820 and 390 pixels. Verified pipeline editing, self-claimed demo with original intro host preserved, lost-answer recovery, missing-outcome submission gate, automatic demo count, manual correction retention, and filed-state readback. No live CRM, Slack or sheet writes.
- Full API TypeScript check reports three existing errors in unchanged `rooms.ts`: lines 1824 (union narrowing and implicit parameter) and 8219 (Outcome.handled). This change does not repair that separate module. New modules and the frontend type check pass.
- Provider packaging: new runtime modules are inside `supabase/functions/sales-api`; no external imported files are required by `scripts/dev/fn_extras.py`.

To repeat the database check, install `@electric-sql/pglite@0.3.14` into a scratch directory and run:

```sh
PGLITE_PATH=/absolute/path/to/node_modules/@electric-sql/pglite/dist/index.js bun test scripts/sales-day-review-sql.test.ts
```

## Rollout and limits

Review and approve the PR before merging or production rollout. Apply `20261022125617_sales_day_review_handoffs.sql` before deploying the Sales API and frontend. Check the live schema, authenticated outcome gate, pipeline readback and an explicitly authorized test appointment before reporting the feature live. Do not deploy the fixture-key compilation.

Retrospective call entry is limited to the last seven days. It preserves a source intro and reuses a demo already on the same day instead of adding another. Ambiguous provider writes stay held for checking. This records an intro-to-demo transition that happened; it does not start or route a phone/video call. Actual clients remain outside these prospect-edit controls. This build does not change payroll logic or the existing CRM-to-report ingestion workers.

For a recorded handoff, its exact source setter takes precedence over the older fallback that infers setter credit from past intros for the same contact. Other appointment booking attribution keeps its existing rule.
