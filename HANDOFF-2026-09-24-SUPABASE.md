# Mahara cockpit migration: current checkpoint

Updated 2026-09-27. Continue in this same chat; do not suggest another chat just to reduce context.

## Objective and authorization

Complete all five cockpits, portal, CEO/admin and background operations on Supabase, preserving behavior and history. Supabase Creative Triage is `bldgtotkfmhoxmlzowdx`; B2B is read-only. No production release, live SQL application, client-visible write or outward automation has occurred here.

Muhammed initially chose Codex planning/supervision with Gemini execution. Gemini subsequently exhausted its quota (provider 429, approximately until 16:40 UTC). Muhammed explicitly answered **Continue with Codex execution**. Continue implementing and independently testing locally without asking again. Gemini failures and scoped fallbacks are recorded through the efficiency policy helper.

## Assembled source

- Migration worktree: `C:/Users/20106/.codex/worktrees/cockpits-supabase-migration`.
- Branch: `codex/supabase-cockpits-migration`; current code `01bc2c6`. Equivalent worker assembly tested clean at `464a64fb0e327173a8e6930c356c7a691fdf2396` before cherry-picking into the branch containing this checkpoint.
- Incoming main `4b90d9f` is an ancestor. All 39 previously missing main commits were retained, including Sales, webinar target versions and release-project guards.
- Merge commit `77b4aad` was constructed from reviewed resolution of the five conflicts; temporary conflict snapshot `d1cece6` is not in the migration branch history.
- Helpers remain attached for reuse: `cockpit-migration-verification/mahara-cockpits`, `cockpit-migration-actions/mahara-cockpits`, and `cockpit-webinar-targets/mahara-cockpits`, under `C:/Users/20106/.codex/worktrees/`. Gemini CEO People packet is running in the actions checkout from `464a64f`; do not edit its files concurrently. Verification checkout is clean at `464a64f`; webinar helper still has an older preserved draft.

## Verified local work

1. Release checks require fresh builds and source-bound independent evidence. Default without evidence rejects release. Python regressions catch skipped/stale checks, source changes during checks, invalid evidence and source imports of dev fixtures. Isolated src/dev harness code is retained; its imports cannot enter other production source files. Runtime independence still requires network evidence.
2. Media Buyer/CSM checklists use their guarded RPC; all three checkbox callers pass explicit expected/new values. Decision details now have matching client parameters, additive stored fields and immutable audit entries (`20260926a_cockpit_decision_details.sql`).
3. Common API references are stable across renders, initial queries no longer run twice, and roles/auth come from the verified Supabase provider rather than invented identities or roles.
4. CEO webinar targets now read/save through authenticated server wrappers (`20260926k_cockpit_webinar_target_access.sql`). Existing target-version table, revision conflicts and request-id retries retained. Historical rounds do not inherit future defaults. Audits follow actual INSERTs, including service writes; retries do not duplicate them. Actual canonical founder gate tested against admin/role spoofing, unconfirmed and revoked identities in local PostgreSQL.
5. CEO Goals now implements board, savePlan, saveTargets, removeTarget, startFrom and catalogue using the real plan/target tables (`20260926l_cockpit_ceo_goals_access.sql`). Batch edits are transactional; partial edits preserve notes; clones bind to an unchanged source fingerprint, retain prior actual/baseline values and clear new-period manual actuals. Pacing uses server Kuwait date and existing pure scoreboard logic. All operations are founder-gated and audited. The five actively referenced goal endpoints no longer fall through to fake success.
6. Pure social scheduling and webinar attribution calculations were separated from legacy backend registrations so offline tests do not require generated Convex files. Bodies preserved; canonical pure webinar model/room/readiness exports prevent copied-type drift.
7. Fixed ship.sh public-variable invocation (`env` plus properly quoted array). Three offline shell probes pass, including failed-build propagation. Shipping has NOT run. Predeployment acceptance sequencing remains part of release work.
8. CSM scoped persistence is integrated (`aa7b380`, verifier suite registration `e997ca6`): separate language preferences, manual hot rows/private drafts, loose-end dismissals, per-user/month money goals, recursive conservative profile edits, field-level UI patches and truthful snapshot errors/freshness. SQL `20260926m_cockpit_csm_state.sql` has RLS, grants, server scope and audits; finance-related loose ends remain visible. Eight new SQL/client tests cover 98 assertions.
9. Ask AI chat (`b84a4a4`, SQL `20260927a`): dedicated jobs, all three chat UIs, typed adapters, authoritative history/polling, owned clear, verified roles/client scope and scoped server context. Claims have unique tokens, active leases, bounded retries and access fingerprints; stale/revoked results fail. Worker defaults to dry-run, requires original lease, and has no Convex fallback or unrestricted profile command. Six SQL/client cases (96 assertions), 15 Python cases. Legacy AI producers/provider actions and actual model responder deployment remain unfinished.
10. EOD delivery (`b351ab3`, SQL `20260927b`): atomic claims, durable send-start, fenced receipts, immutable confirmed receipts/report content, audit on every write, uncertain effects held for reconciliation. Service-account-only Sheets path makes one append attempt; no personal OAuth or generic retrying POST helper. Sales keeps polling during processing. Nine actual SQL cases (44 assertions), 13 Python cases. Default dry-run; host service-account configuration/activation unverified. EOD report storage/ownership is a separate pending packet.

## Evidence

- All five fresh builds, ten app/node typechecks, **238 Bun tests and 28 Python tests in 23 suites** passed on clean `464a64f`. The readiness checker also passed 22 infrastructure regressions, including rejection of empty Python discovery.
- Additional incoming-main checks: 190 Sales worker tests, 47 webinar worker tests, 118 Sales API/mirror tests, 11 schedule tests and 3 project guards passed.
- 27 release infrastructure regressions passed; separate in-memory decision, canonical identity and full client-to-SQL webinar/Goals tests passed. Claims are local SQL/fixture verification, not actual deployed staff sessions.
- Latest durable report: `docs/verification/cutover-local-20260927-workers.json`. Full logs: `C:/Users/20106/AppData/Local/Temp/cockpit-migration-review-20260926/`. Older reports remain as historical evidence.
- Release verifier exits 1 solely because production acceptance evidence is absent. New SQL migrations are NOT applied live.

## Next: CEO People; then remaining domains and EOD storage

Gemini quota works. Ask AI and EOD each received one correction, then Codex repaired remaining defects under recorded correction-limit fallback. Initial mocks missed actual SQL incompatibility; final evidence uses canonical in-memory PostgreSQL schemas. Manifests: `20260927-011831-bfc7635b` (Ask AI correction), `20260927-012210-0dacf791` (EOD correction), under `C:/Users/20106/.codex/gemini-worker/runs/`.

CEO People High worker launched in actions checkout, exec session `40500`. Scope: actual `cockpit_people` roster, founder-gated list/roles/save/setActive RPCs, preserved aggregation/notes/pay/schedules/history, audited partial updates and real client-to-SQL tests. Portal login seats stay separate. All later People schema extensions already exist; earlier Low audit wrongly claimed them missing even after correction and was rejected. Workspace directory/import is provider work that must fail truthfully until migrated.

EOD ownership question remains pending: legacy storage is one report per role/day while outbox is role/day/person. User has not yet answered the current async question proposing separate person reports. Draft/submission semantics and trusted roster routing need migration work. New sender safety is locally verified; do not activate it or send anything without explicit outward approval.

## Still incomplete

The earlier AST inventory found 133 reachable API references, 116 using generic-success branches. Goals fixes cover four generic writes plus a broken explicit read; many domains remain. CSM appointments/KPIs/churn/tasks/freshness, EOD ownership/history, legacy AI producers (`assist_copy`, `draft_copy`, `call_brief`, `comment_digest`, campaign chat), all worker schedules/integrations, data catch-up and authenticated production journeys remain open. Complete runtime without Convex is NOT established.

Gemini runner needed a two-line fix for string-valued error responses in run/resume; string and dictionary error-path tests pass. File: `C:/Users/20106/.codex/skills/gemini-executor/scripts/gemini_executor.py`; backup in the log directory. No permission/sandbox rules changed.

Preserve the primary D: checkout's unrelated work and migration `scratch/`. Shared-context sync remains stopped on dirty/diverged state (`398a4ed` local base); notes saved locally only. ClickUp credentials unavailable in the documented local paths/process, so no board update was sent. Do not crawl the old vault.
