# Complete the Mahara cockpit migration to Supabase

## Current execution plan, 2026-09-27

**Continuation:** Stay in this chat. Gemini resumed, but later runs produced no work with a denied file-read action; Codex used recorded fallback. Main baseline `4b90d9f` is reconciled. Clean assembly `9c50b9b` passes five builds, ten typechecks, 251 Bun tests and 35 Python tests. CSM, scoped chat, EOD delivery, CEO People and manual-payment persistence are integrated locally, alongside webinar targets and Goals. An offline history planner has produced a protected one-payment/one-audit candidate from the older snapshot. New SQL remains unapplied; fresh history reconciliation and money recomputation remain unfinished gates. See the single checkpoint for remaining domains and production acceptance work.

**Owner split confirmed by Muhammed:** Codex makes the plan and supervises; Gemini implements bounded code packets. Codex independently runs checks and reviews diffs. The executor permits one focused correction; any exhausted correction fallback must be recorded. Production, outward automations, and client-visible writes remain separate from local implementation.

**Done means:** all five cockpits plus portal and embedded CEO/admin preserve their real working journeys on Supabase; permitted saves survive refresh, forbidden access fails on the server, every write is audited, history is reconciled, workers complete and retry correctly, and the exact production release runs with no Convex dependency. Compiling, copied tables, and success-shaped placeholders do not count.

| Order | Gemini execution packet | Codex acceptance before moving on |
|---|---|---|
| 1 | Repair the readiness checker | Fresh builds/typechecks, offline regressions, missing/invalid evidence rejects release. Implemented locally at `8495ab9`; independent source-change bypass repaired after the correction limit. |
| 2 | Repair Media Buyer/CSM checklist reads, toggles and decision contracts | Real helpers call the existing guarded checklist RPC, both toggle directions work, exact decision parameters preserve details, and errors propagate. Implemented and verified locally at `735aafa` (18 frontend contract tests plus disposable PostgreSQL tests). Migration not applied; staff persistence remains unverified. |
| 3 | Reconcile current main into the migration branch | Preserve newer Sales/webinar work. Merge preview at `0a1bf7b` against `af01995` found conflicts in `.gitignore`, two deleted development harness files, `WebinarFunnel.tsx`, and `scripts/ship.sh`. Rebuild and re-inventory all affected contracts. |
| 4 | Replace the remaining API dispatcher placeholders and repair CSM state | Explicit, typed operations with real persistence; verified identity/roles; profile/language/hot-list/income-plan saves preserve human data. No catch-all success or invented metrics. |
| 5 | Complete server authorization, audits and schema/data compatibility | Real identities: allowed/wrong-role/wrong-client/revoked/founder-only cases; original ownership and history retained; every write audited. Dry-run imports and one-record validation before any approved live change. |
| 6 | Repair and reconcile every background integration | Correct Ask AI queue model, atomic claim, success/failure/retry; preserve existing creative-production requests. Inventory all active writers/schedules/webhooks and prove replacements. No outward sends during routine tests. |
| 7 | Preview, final catch-up, release and retirement | Authenticated journey evidence across every surface with Convex blocked; final data parity; reviewed release through `scripts/ship.sh`; actual production SHA/config verification; rollback rehearsal; then separately approved legacy-writer retirement. |

### Independently confirmed findings

- All five frontend app and node typechecks and fresh Vite builds pass at baseline `0a1bf7b`; the shared-file check passes. This is compilation evidence only.
- A local probe of the real `cockpitApi.ts` dispatcher returned `{ok:true}` with zero database calls for `chat.ask`, `ceo.goals.savePlan`, `ceo.goals.saveTargets`, `ceo.manualPayments.add`, and `ceo.manualPayments.softDelete`. `roles.me` also invents every role.
- Live catalog read-back confirms `authenticated` cannot directly read `cockpit_daily_checks`; use the existing guarded read function. CSM direct profile updates lack browser UPDATE permission and ignore errors.
- Decision callers send unsupported `p_rerouted_to`/`p_amount`. The existing SQL accepts `p_metadata`/`p_reason` but does not store them; verify the full write/read path, not just the function signature.
- CSM income goals use a string plan ID and nonexistent `target_value`/`metadata` fields against the CEO goal-target table. Preserve the original per-person/per-month CSM semantics instead of repurposing CEO goals.
- Ask AI uses `queued/completed/failed` and `result/error` against the creative-production request table; its schema has neither these states nor these result fields.
- The first Gemini review incorrectly called `cockpit_get_ceo_sections` and `eod_outbox` missing. Both exist in migrations. Those claims were rejected and corrected.

Gemini also removed the offline social test's dependency on generated Convex files without changing scheduling behavior (21 tests pass). Final assembled code is `f70c5a1`. Acceptance format and commands: `docs/CUTOVER-ACCEPTANCE.md`. Current resumable checkpoint: `HANDOFF-2026-09-24-SUPABASE.md`. Evidence is under `%TEMP%/cockpit-migration-review-20260926/`; no production acceptance bundle exists.

---

## Original detailed plan, 2026-09-24 (historical baseline)

Execution brief for the implementing agent. Prepared 2026-09-24 from the review of commit `376e702`.

## Objective and definition of done

Complete the migration of the portal, media buyer, client success, creative director, video editor, Sales, and embedded CEO/admin features. Preserve their current working behavior. Supabase Creative Triage owns cockpit identity, permissions, application state, files where applicable, and durable jobs. Existing approved external services and bounded VPS workers continue their business functions.

100% means the reviewed code is deployed, the actual user journeys and background operations work, historical data is reconciled, access restrictions hold, and no production path depends on Convex. A dummy client, hidden feature, empty result, copied database, or passing compilation does not satisfy this objective. Archive old source and backups for recovery; deletion is not required to prove operational independence.

## Starting state and working locations

| Item | Value |
|---|---|
| Worktree | `C:\Users\20106\.codex\worktrees\cockpits-supabase-migration` |
| Branch / reviewed HEAD | `codex/supabase-cockpits-migration` / `376e702` |
| Root checkout, preserve existing changes | `D:\MaharaMedia\mahara-cockpits` |
| Shared context, preserve existing changes | `D:\MaharaMedia\mahara-context` |
| Cockpit Supabase project | `bldgtotkfmhoxmlzowdx` |
| B2B upstream, read-only | `flwboeijllbtrufxkhts` |
| Local credential file, path only | `D:\MaharaMedia\mahara-cockpits\.env.local` |
| Current plan requiring correction | `docs/CONTRACT_MATRIX.md` |
| Runbook and release scripts | `supabase/MIGRATION_RUNBOOK.md`, `scripts/ship.sh`, `scripts/require-github-main.sh`, `scripts/verify-cutover-readiness.py` |
| Public production entry | `https://cockpit.maharamedia.com` |
| Existing Convex deployments | `adorable-seahorse-418`, `impressive-dinosaur-375`, `colorful-wombat-644` |

- The reviewed branch includes the earlier merge of main and the fifth app, Sales. Fetch again before implementation and integrate any subsequent changes safely.
- The verifier independently confirmed the nine listed tables, their reported counts, RLS-enabled flags, and the presence of 14 RPC names. This proves existence, not correct permissions or complete behavior.
- `NullConvexClient` in the three original apps returns undefined reads and no working writes. CSM and creative screens still use these hooks. Remove this production workaround as genuine implementations replace its consumers.
- Several replacements named by the contract matrix, including `sync-ad-metrics`, `drain-assist-queue`, and `hermes-chat-relay`, were not found in repository implementations. Treat them as proposed until source and deployment evidence establish otherwise.
- The readiness script currently passes despite these failures. Do not deploy based on its existing success message.

## Phase 1: Establish the exact remaining scope

1. Read applicable project instructions and current context. Preserve dirty checkouts. Record branch HEAD, fetched main, and live deployed versions. Work in the isolated migration worktree.
2. Generate an inventory from actual source: routes and components; all Convex queries, mutations, actions and generated imports; HTTP/webhook routes; cron/scheduler calls; bridges; jobs, outboxes and workers; storage/files; provider adapters; health checks. Include browser, server, Vercel API, scripts and deployed VPS configuration.
3. Replace the broad claims in `docs/CONTRACT_MATRIX.md` with one row per real contract. Each row must name its caller, existing behavior, current source, replacement implementation, data ownership, permission rule, audit, side effects and acceptance test.
4. Give each row an evidence-based status: planned, implemented, locally tested, preview verified, production verified. A proposed function name or table is not an implementation.
5. Trace every route to these rows. Identify shared contracts and explicitly prove any retired contract is unused. The existing search counts are starting clues, not a complete migration denominator.

Acceptance: every active feature and background responsibility has an owner and a concrete replacement/test. Save the inventory and continue implementation; do not end the task after planning.

## Phase 2: Finish shared identity and permissions

1. Use one consistent Supabase session/access contract across all five apps. Remove production dependence on Convex Auth, Viktor token exchange and the Convex portal for normal sign-in and switching. Inspect all route guards and automatic sign-in components, not only `App.tsx`.
2. For same-origin cockpit paths, share the supported Supabase session configuration. If a separate origin must be supported, implement a supported redirect/code-exchange flow. Remove the hand-written access-token and refresh-token fragments from `GoPage.tsx`; do not introduce reusable credentials into navigation URLs or logs.
3. Load authorization from active server-side memberships linked to a verified Auth subject. Support the actual Sales role/subrole model and synchronize any separate editor/Sales seat records required by their existing policies. Do not infer authorization from user-editable metadata.
4. Preserve client assignment semantics, admin restrictions, founder-only CEO access, and last-admin protections. Verify the currently approved founder identities against source/context; do not use the erroneous email in the earlier recap.
5. Test first sign-in, recovery, session refresh, reload, sign-out, all cockpit switches, expired session, removed seat, wrong role and wrong client. Authorization must be checked by the backend even when the UI hides controls.

Acceptance: authorized staff can navigate every permitted cockpit; unauthorized and revoked users are denied by the server; no authentication request needs Convex.

## Phase 3: Complete database and historical-data migration

1. Map every required Convex collection and file reference to the existing target model. Classify durable user data, provider-owned facts, rebuildable caches, and transient jobs. Reuse existing Supabase domains where appropriate; do not invent duplicate tables simply to match old declarations.
2. Add versioned migrations for missing fields, relationships, indexes, constraints, policies, grants, functions and audits. Check uniqueness against actual ownership: role/day alone is insufficient if the old system permits separate reports by multiple staff members. Preserve approved existing semantics.
3. Preserve original deployment/source IDs in a stable mapping. Carry client scope, author, timestamps, attachments, human notes and history. Respect null versus zero, currency and business-day rules. Ensure merge rules cannot overwrite a newer Supabase edit with an older snapshot.
4. Snapshot source and target before live imports. Import scripts default to dry-run, emit a scoped diff, support safe reruns and start with one representative client/record. Keep secrets and private exports outside Git.
5. Reconcile baseline and changes made while migration is underway. Document a final write freeze or equivalent capture-and-replay mechanism covering updates and deletions as well as inserts. Prevent the final snapshot from silently losing intervening writes.
6. Validate counts, source IDs, relationships, key-field checksums, files and representative records by client/date/domain. Explain every intentional transformation or exclusion.

Acceptance: all required data is present, no unexplained differences remain, reruns do not duplicate it, and final catch-up and restore procedures are tested.

## Phase 4: Implement real backend contracts

1. Implement database reads and transactional writes using typed Supabase queries/RPCs. Put provider calls behind authorized Edge Functions or existing bounded server workers, never in the browser with a privileged key.
2. Preserve request/response behavior, validation, client scoping, ordering, pagination, errors and transaction boundaries. Existing tables and RPCs must be checked for behavioral compatibility before wiring a screen to them.
3. Move external integrations currently hosted in Convex: discover the exact active Meta, GHL, ClickUp, Google, Fathom, Frame.io, AI and other adapters from source. Retain receipts, bounded retries, rate-limit behavior and source-health reporting through the existing `tools.ts` pattern or its shared replacement.
4. Migrate public review routes, signed/private file access, callbacks and webhooks with their authentication, signature and replay checks. Keep public token access narrowly scoped.
5. Log the actor, object, operation, result and relevant request identity for each write without logging credentials. Make retried commands safe; reconcile uncertain external outcomes before repeating them.

Acceptance: every active backend row in the matrix points to working code, with successful-call, forbidden-call and failure-path tests. No endpoint relies on a hidden Convex proxy.

## Phase 5: Wire and verify every application

Implement complete journeys in this order so the common layer is reused:

| Area | Required coverage |
|---|---|
| Portal and admin | Identity, seats, client assignment, switching, health and audit views |
| Media buyer | Daily snapshot/checklist, ads and campaigns, decisions, tasks, plans, EOD, ideation/swipe, settings and active provider actions |
| Client success | Client roster and performance, checks, tasks, hot list, meetings, money/billing, notes/preferences, EOD and communication workflows |
| Creative director | Dashboard/work, clients, scripts, calendars, ideation, reviews, social planning, media, approvals and scheduling |
| CEO and shared team | Every current CEO tab, finance/people/hiring/goals/calls, meeting pages and shared widgets |
| Editor | Existing Supabase features, portal access, permissions, ad preview and editor-specific storage/actions |
| Sales | Existing data/dialer/proposals/pay behavior, seat/subrole mapping, portal access and ad preview |

1. Replace every active Convex hook/import with real application data functions. Preserve updates via authorized realtime or explicit invalidation/refetch; do not leave screens permanently loading.
2. Remove `NullConvexClient`, fallback `ConvexProvider` and obsolete runtime auth/SDK configuration once their consumers are replaced. Keep mock adapters confined to tests/dev fixtures.
3. Maintain empty, error, loading and success states. Report success only after a confirmed operation; a failed write must never show “saved.” Keep current UI and design conventions.
4. For each journey, test an authorized read, a reversible write, persistence after full reload, applicable cross-cockpit visibility, and unauthorized access. Check preview/video/file behavior, not just thumbnails or row existence.

Acceptance: every route in the inventory works with Convex network access blocked. No feature is hidden, disabled or fed placeholder data to pass the test.

## Phase 6: Move jobs, queues and monitoring

1. Inspect actual Convex schedules, scheduled-function calls, HTTP endpoints, and VPS callers. Implement each required replacement from the matrix and deploy it to its intended runtime. Confirm source paths, deployed identifiers and ownership.
2. Move durable job state, outboxes, leases, retries and results to Supabase. Preserve claim ownership, heartbeat, retry ceilings, abandoned-job recovery and visible terminal failure. Prevent old and new workers from processing the same external action during cutover.
3. Migrate Hermes pending/result/health interfaces and all real callers. Test a harmless job from submission through claim, completion and UI display, plus worker failure/retry.
4. Restore feed freshness, provider health, independent watchdogs and runbook guidance. Use worker doctor/tests and `flock` where applicable. Verify real scheduled executions, not just configured schedules.
5. Exercise outward provider actions only in approved test destinations or with the user's existing explicit authorization for the particular live run. Use fakes or isolated fixtures otherwise, and label that verification accurately.

Acceptance: every required background responsibility runs on its new owner, preserves durable state and reports failure. There are no required schedules or workers left in Convex.

## Phase 7: Build a release gate that tests the product

1. Repair `scripts/verify-cutover-readiness.py`: finite timeouts, explicit nonzero failure exits, required-result completeness, configurable environment, and sanitized machine-readable results. Verify exact required schema/functions and relevant grants/policies, not just names or an RLS flag.
2. Run fresh lint, typechecks, builds and meaningful tests for all five apps. Tie artifacts to the reviewed commit/configuration. Existing `dist/index.html` files are not build evidence.
3. Add authenticated integration tests, role/client isolation tests, persistence tests, a harmless job lifecycle and a network check blocking Convex. Include unauthenticated, revoked and wrong-client identities. Dummy API-key rejection is not proof of row-level authorization.
4. Test deliberate failures: required RPC unavailable, forbidden access, failed write, broken job, stale build, and unreachable database must fail the relevant release check.
5. Test `ship.sh` before production with a harmless deployment-command stub, including environment injection, all five app paths and failure propagation. Run readiness before deploying and production acceptance after deploying. Preserve the GitHub-main source guard.

Acceptance: one documented command produces a truthful readiness report, and it cannot pass while the critical journeys fail.

## Phase 8: Deploy, verify and retire Convex

1. Record exact source SHA, database migration versions, configuration names, backup/catch-up checkpoints, worker switch sequence and rollback procedure. Verify the current production SHA is represented in the release so recent work is preserved.
2. Run the full preview and staff-canary checks. Finish final data catch-up with controlled writer ownership. Publish/merge the reviewed release through the authorized repository workflow, respecting existing approval and requesting only genuinely new authority if necessary.
3. Deploy the exact approved GitHub-main commit through the repaired shipping workflow. Verify actual domains, routes, assets, server functions, workers, permitted reads/writes and rejected unauthorized calls.
4. Observe real scheduled cycles and representative staff use. Confirm zero Convex requests from browsers, server routes and workers. Define an observation period covering the relevant schedules; do not invent evidence for weekly jobs that have not run or been safely tested.
5. Disable obsolete Convex writers, schedules and integrations after their replacements and rollback handling are verified. Revoke unused production Convex credentials. Keep archival snapshots/source under the agreed retention policy; deployment/account deletion is separate from operational retirement.
6. Publish the final evidence and update the runbook and Mahara context: live SHA, tests actually run, data reconciliation, identity/worker state, ownership and restore instructions.

Acceptance: production is fully functional on Supabase; all legacy writers are stopped; no production runtime needs Convex; evidence identifies the exact deployed release.

## Execution and reporting rules

- Continue from phase to phase without asking about routine implementation choices. Do not stop after writing another plan or suppressing an error. If one item needs unavailable access, state that exact limitation and continue independent authorized work.
- Preserve other agents' and human changes. Never expose secrets in output, delegated prompts, source or logs. Mahara B2B remains read-only; migration does not authorize unrelated system changes.
- Every mutating migration script defaults to dry-run and produces a report before live changes. Use test identities/data and reversible checks; follow existing restrictions on outward/client-visible actions.
- After each phase, record changed contracts, test evidence, commit and remaining failures. Label built, deployed and verified separately. Use counts of verified contracts/journeys rather than an invented completion percentage.
- Completion report must include the release SHA and URLs, reconciliation result, tested roles/journeys, jobs observed, proof of no Convex dependency, and rollback/archive status. List any unverified behavior explicitly; do not call an incomplete migration 100%.
