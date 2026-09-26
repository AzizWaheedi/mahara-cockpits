# Mahara cockpit migration: current checkpoint

Updated 2026-09-27. Continue in this same chat; do not suggest another chat just to reduce context.

## Objective and authorization

Complete all five cockpits, portal, CEO/admin and background operations on Supabase, preserving behavior and history. Supabase Creative Triage is `bldgtotkfmhoxmlzowdx`; B2B is read-only. No production release, live SQL application, client-visible write or outward automation has occurred here.

Muhammed initially chose Codex planning/supervision with Gemini execution. Gemini subsequently exhausted its quota (provider 429, approximately until 16:40 UTC). Muhammed explicitly answered **Continue with Codex execution**. Continue implementing and independently testing locally without asking again. Gemini failures and scoped fallbacks are recorded through the efficiency policy helper.

## Assembled source

- Migration worktree: `C:/Users/20106/.codex/worktrees/cockpits-supabase-migration`.
- Branch: `codex/supabase-cockpits-migration`; tested code HEAD `e997ca60c7a88c8647a86b0342891017e2827d0c`.
- Incoming main `4b90d9f` is an ancestor. All 39 previously missing main commits were retained, including Sales, webinar target versions and release-project guards.
- Merge commit `77b4aad` was constructed from reviewed resolution of the five conflicts; temporary conflict snapshot `d1cece6` is not in the migration branch history.
- Helpers remain attached for reuse: `cockpit-migration-verification/mahara-cockpits`, `cockpit-migration-actions/mahara-cockpits`, and `cockpit-webinar-targets/mahara-cockpits`, under `C:/Users/20106/.codex/worktrees/`. Gemini Ask AI packet is running in the actions checkout; do not edit its files concurrently.

## Verified local work

1. Release checks require fresh builds and source-bound independent evidence. Default without evidence rejects release. Python regressions catch skipped/stale checks, source changes during checks, invalid evidence and source imports of dev fixtures. Isolated src/dev harness code is retained; its imports cannot enter other production source files. Runtime independence still requires network evidence.
2. Media Buyer/CSM checklists use their guarded RPC; all three checkbox callers pass explicit expected/new values. Decision details now have matching client parameters, additive stored fields and immutable audit entries (`20260926a_cockpit_decision_details.sql`).
3. Common API references are stable across renders, initial queries no longer run twice, and roles/auth come from the verified Supabase provider rather than invented identities or roles.
4. CEO webinar targets now read/save through authenticated server wrappers (`20260926k_cockpit_webinar_target_access.sql`). Existing target-version table, revision conflicts and request-id retries retained. Historical rounds do not inherit future defaults. Audits follow actual INSERTs, including service writes; retries do not duplicate them. Actual canonical founder gate tested against admin/role spoofing, unconfirmed and revoked identities in local PostgreSQL.
5. CEO Goals now implements board, savePlan, saveTargets, removeTarget, startFrom and catalogue using the real plan/target tables (`20260926l_cockpit_ceo_goals_access.sql`). Batch edits are transactional; partial edits preserve notes; clones bind to an unchanged source fingerprint, retain prior actual/baseline values and clear new-period manual actuals. Pacing uses server Kuwait date and existing pure scoreboard logic. All operations are founder-gated and audited. The five actively referenced goal endpoints no longer fall through to fake success.
6. Pure social scheduling and webinar attribution calculations were separated from legacy backend registrations so offline tests do not require generated Convex files. Bodies preserved; canonical pure webinar model/room/readiness exports prevent copied-type drift.
7. Fixed ship.sh public-variable invocation (`env` plus properly quoted array). Three offline shell probes pass, including failed-build propagation. Shipping has NOT run. Predeployment acceptance sequencing remains part of release work.
8. CSM scoped persistence is integrated (`aa7b380`, verifier suite registration `e997ca6`): separate language preferences, manual hot rows/private drafts, loose-end dismissals, per-user/month money goals, recursive conservative profile edits, field-level UI patches and truthful snapshot errors/freshness. SQL `20260926m_cockpit_csm_state.sql` has RLS, grants, server scope and audits; finance-related loose ends remain visible. Eight new SQL/client tests cover 98 assertions.

## Evidence

- All five fresh builds, ten app/node typechecks and **223 Bun tests in 19 suites** passed on clean `e997ca6`.
- Additional incoming-main checks: 190 Sales worker tests, 47 webinar worker tests, 118 Sales API/mirror tests, 11 schedule tests and 3 project guards passed.
- 27 release infrastructure regressions passed; separate in-memory decision, canonical identity and full client-to-SQL webinar/Goals tests passed. Claims are local SQL/fixture verification, not actual deployed staff sessions.
- Latest report: `C:/Users/20106/AppData/Local/Temp/cockpit-migration-review-20260926/csm-assembled-release-check.json`. Older 215-test report: `docs/verification/cutover-local-20260926-continuation.json`. Full logs remain in that temporary directory.
- Release verifier exits 1 solely because production acceptance evidence is absent. New SQL migrations are NOT applied live.

## Next: Ask AI lifecycle and EOD

User says Gemini quota is ready; resumed High worker for dedicated Ask AI jobs, authenticated submit/read, service-only atomic claim/lease/finish, safe dry-run worker, offline SQL/client/Python tests and runbook. Review output independently. Existing worker incorrectly uses creative-request statuses/result fields that the creative table does not support. No live model call or deployment authorized by this packet.

EOD ownership question remains pending: legacy storage is one report per role/day while outbox is role/day/person. Ask whether to separate reports per person before rekeying. Existing sender `hermes/eod-out/out.py` has no dry-run and reads queued rows without an atomic claim. Do not execute it. Draft/submission/delivery semantics, trusted roster routing and safe retries need migration work.

## Still incomplete

The conservative AST inventory at the earlier baseline found 133 reachable API references, 116 using generic-success branches. Goals fixes cover four of those generic writes plus a broken explicit read; many dispatcher domains remain. CSM appointments/KPIs/churn/tasks/freshness are still placeholders. EOD ownership/history, Ask AI job schema, all worker schedules/integrations, data catch-up and authenticated production journeys remain open. Complete runtime without Convex is NOT established.

Gemini runner needed a two-line fix for string-valued error responses in run/resume; string and dictionary error-path tests pass. File: `C:/Users/20106/.codex/skills/gemini-executor/scripts/gemini_executor.py`; backup in the log directory. No permission/sandbox rules changed.

Preserve the primary D: checkout's unrelated work and migration `scratch/`. Shared-context sync remains stopped on dirty/diverged state (`398a4ed` local base); notes saved locally only. ClickUp credentials unavailable in the documented local paths/process, so no board update was sent. Do not crawl the old vault.
