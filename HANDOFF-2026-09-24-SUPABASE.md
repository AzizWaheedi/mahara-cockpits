# Mahara cockpit migration: current checkpoint

Updated 2026-09-26. Continue in this same chat; do not suggest another chat just to reduce context.

## Objective and authorization

Complete all five cockpits, portal, CEO/admin and background operations on Supabase, preserving behavior and history. Supabase Creative Triage is `bldgtotkfmhoxmlzowdx`; B2B is read-only. No production release, live SQL application, client-visible write or outward automation has occurred here.

Muhammed initially chose Codex planning/supervision with Gemini execution. Gemini subsequently exhausted its quota (provider 429, approximately until 16:40 UTC). Muhammed explicitly answered **Continue with Codex execution**. Continue implementing and independently testing locally without asking again. Gemini failures and scoped fallbacks are recorded through the efficiency policy helper.

## Assembled source

- Migration worktree: `C:/Users/20106/.codex/worktrees/cockpits-supabase-migration`.
- Branch: `codex/supabase-cockpits-migration`; tested code HEAD `9d72d7a`.
- Incoming main `4b90d9f` is an ancestor. All 39 previously missing main commits were retained, including Sales, webinar target versions and release-project guards.
- Merge commit `77b4aad` was constructed from reviewed resolution of the five conflicts; temporary conflict snapshot `d1cece6` is not in the migration branch history.
- Helpers remain attached for reuse: `cockpit-migration-verification/mahara-cockpits`, `cockpit-migration-actions/mahara-cockpits`, and `cockpit-webinar-targets/mahara-cockpits`, under `C:/Users/20106/.codex/worktrees/`. No workers are running.

## Verified local work

1. Release checks require fresh builds and source-bound independent evidence. Default without evidence rejects release. Python regressions catch skipped/stale checks, source changes during checks, invalid evidence and source imports of dev fixtures. Isolated src/dev harness code is retained; its imports cannot enter other production source files. Runtime independence still requires network evidence.
2. Media Buyer/CSM checklists use their guarded RPC; all three checkbox callers pass explicit expected/new values. Decision details now have matching client parameters, additive stored fields and immutable audit entries (`20260926a_cockpit_decision_details.sql`).
3. Common API references are stable across renders, initial queries no longer run twice, and roles/auth come from the verified Supabase provider rather than invented identities or roles.
4. CEO webinar targets now read/save through authenticated server wrappers (`20260926k_cockpit_webinar_target_access.sql`). Existing target-version table, revision conflicts and request-id retries retained. Historical rounds do not inherit future defaults. Audits follow actual INSERTs, including service writes; retries do not duplicate them. Actual canonical founder gate tested against admin/role spoofing, unconfirmed and revoked identities in local PostgreSQL.
5. CEO Goals now implements board, savePlan, saveTargets, removeTarget, startFrom and catalogue using the real plan/target tables (`20260926l_cockpit_ceo_goals_access.sql`). Batch edits are transactional; partial edits preserve notes; clones bind to an unchanged source fingerprint, retain prior actual/baseline values and clear new-period manual actuals. Pacing uses server Kuwait date and existing pure scoreboard logic. All operations are founder-gated and audited. The five actively referenced goal endpoints no longer fall through to fake success.
6. Pure social scheduling and webinar attribution calculations were separated from legacy backend registrations so offline tests do not require generated Convex files. Bodies preserved; canonical pure webinar model/room/readiness exports prevent copied-type drift.
7. Fixed ship.sh public-variable invocation (`env` plus properly quoted array). Three offline shell probes pass, including failed-build propagation. Shipping has NOT run. Predeployment acceptance sequencing remains part of release work.

## Evidence

- All five fresh builds, ten app/node typechecks and **215 Bun tests in 18 suites** passed on clean `9d72d7a`.
- Additional incoming-main checks: 190 Sales worker tests, 47 webinar worker tests, 118 Sales API/mirror tests, 11 schedule tests and 3 project guards passed.
- 27 release infrastructure regressions passed; separate in-memory decision, canonical identity and full client-to-SQL webinar/Goals tests passed. Claims are local SQL/fixture verification, not actual deployed staff sessions.
- Report: `docs/verification/cutover-local-20260926-continuation.json`. Full logs under `C:/Users/20106/AppData/Local/Temp/cockpit-migration-review-20260926/`.
- Release verifier exits 1 solely because production acceptance evidence is absent. New SQL migrations are NOT applied live.

## Next: CSM state and profile writes

Read `apps/client-success-cockpit/convex/csm.ts`, `src/lib/useCsmSnapshot.ts` and `src/pages/CsmPage.tsx`. Live catalog/source checks found no existing dedicated CSM preferences/hot-list/dismissals/income-goal tables.

Implement separately owned state rather than writing into refreshed profile JSON: client language, manual hot-list rows, loose-end dismissal records and per-user/month income goals. Preserve the original UI semantics: hot-list Add row creates a blank private draft, named rows are scoped by client; hidden rows remain tombstones; freeform manual names are allowed to unrestricted CSMs. Finance-related loose ends (invoice/payment/past due/billing/pause/refund/card) cannot be dismissed. Income counts merge changed keys, and explicit zero is preserved. The CSM UI currently submits full stale rows/counts; change to field-level patches. Surface snapshot errors instead of endless loading.

Also repair `cockpit_update_client_profile`: existing INSERT/ON CONFLICT coalesces defaults and can erase omitted notes/KPI/overview. Preserve omitted human fields, enforce existing client scope and audit writes. Current profile RLS already scopes CSM/MB by member clients; admins are global. Do not incorrectly claim it has no client scope. An empty client list currently means unrestricted.

## Still incomplete

The conservative AST inventory at the earlier baseline found 133 reachable API references, 116 using generic-success branches. Goals fixes cover four of those generic writes plus a broken explicit read; many dispatcher domains remain. CSM appointments/KPIs/churn/tasks/freshness are still placeholders. EOD ownership/history, Ask AI job schema, all worker schedules/integrations, data catch-up and authenticated production journeys remain open. Complete runtime without Convex is NOT established.

Gemini runner needed a two-line fix for string-valued error responses in run/resume; string and dictionary error-path tests pass. File: `C:/Users/20106/.codex/skills/gemini-executor/scripts/gemini_executor.py`; backup in the log directory. No permission/sandbox rules changed.

Preserve the primary D: checkout's unrelated work and migration `scratch/`. Shared-context sync remains stopped on dirty/diverged state (`398a4ed` local base); notes saved locally only. ClickUp credentials unavailable in the documented local paths/process, so no board update was sent. Do not crawl the old vault.
