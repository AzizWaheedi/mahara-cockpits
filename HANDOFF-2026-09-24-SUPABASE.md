# Mahara cockpit migration: supervised execution checkpoint

Updated 2026-09-26. This is the current checkpoint; keep this filename.

## Objective and working agreement

Muhammed wants all five cockpits, the portal, embedded CEO/admin and background operations functioning on Supabase without Convex. Codex owns the plan, supervision and independent verification; Gemini executes bounded code packets. Local implementation is authorized. No production deployment, outward automation, client-visible write or Convex retirement has been performed in this session.

Completion and ordered work packets: **MIGRATION-TO-100-PERCENT.md**, current section at the top. Acceptance evidence format: **docs/CUTOVER-ACCEPTANCE.md**. Do not reuse historical completion percentages or claim compilation proves working journeys.

## Verified phase: readiness repair

- Migration branch: `codex/supabase-cockpits-migration`, current integrated code commit `f70c5a1`.
- Worktree: `C:/Users/20106/.codex/worktrees/cockpits-supabase-migration`.
- Gemini implemented the checker, documentation and tests; Codex rejected the first pass, supervised one correction, then fixed a reproduced source-change bypass under the executor's recorded correction-limit fallback.
- Twenty offline readiness regressions pass. All five frontend app/node typechecks and fresh Vite builds passed against the original configured migration worktree at baseline `0a1bf7b`; nine meaningful offline test suites passed there.
- The initial clean-checkout run exposed missing Sales public build configuration and a legacy social test that imported generated Convex modules. Gemini extracted the scheduling calculation unchanged into `src/lib/socialSchedule.ts`; all 21 social tests now pass. Public Sales settings are supplied only to the verification process, without storing secrets in source. Final combined checks PASSED locally on clean verification commit `bd5b965`: all five fresh builds, ten app/node typechecks and 148 Bun tests across ten suites. Its application, script, SQL and documentation trees match migration commit `f70c5a1` exactly. Default release verification correctly exits 1 solely because production acceptance evidence is absent.
- Default verification now requires release evidence and exits nonzero without it. No production acceptance bundle exists. No release is certified.
- Checker worker: `C:/Users/20106/.codex/worktrees/cockpit-migration-verification/mahara-cockpits`; commit `83e9e0c` cherry-picked as `8495ab9`.
- Worker manifests: `C:/Users/20106/.codex/gemini-worker/runs/20260926-123700-bed4432b/manifest.json` and correction `20260926-124349-1150b7f7/manifest.json`.

## Verified local packet: checklist and decision contracts

- Gemini worktree: `C:/Users/20106/.codex/worktrees/cockpit-migration-actions/mahara-cockpits`.
- Initial manifest: `C:/Users/20106/.codex/gemini-worker/runs/20260926-124733-3a6e27be/manifest.json`.
- Integrated as `735aafa`. Eighteen offline helper-contract tests pass. Both app typechecks pass, builds succeed, and the changed frontend files pass the repository checker (warnings remain).
- All three checkbox callers now send explicit expected/current values; the snapshots use the existing guarded checklist read function.
- Decision calls now use the actual RPC signature, preserving reason, metric, rerouting and amount zero. `20260926a_cockpit_decision_details.sql` adds the missing stored fields and audit trigger.
- Gemini's SQL correction invented incompatible audit columns. Codex rejected that version and used the recorded correction-limit fallback to preserve the existing audit schema and immutability guard. A separate typecheck caught and corrected a nonexistent checkbox property.
- Disposable PostgreSQL tests against the actual existing audit definition pass: persistence, zero values, insert/update/delete audits, immutable history, forbidden/absent/revoked-role callers, function grants and additive rerun. Fixture auth helpers are substitutes; this is NOT deployed identity/client-isolation verification.
- SQL test runner: `apps/media-buyer-cockpit/scripts/test-decision-details.cjs`. It always uses in-memory PGlite and never DATABASE_URL. Local test dependency: `%TEMP%/cockpit-migration-review-20260926/postgres/node_modules/@electric-sql/pglite` (0.5.8), supplied through PGLITE_MODULE. SQL fixture refuses direct execution without the disposable-test setting.
- No SQL has been applied to Supabase. The new migration must be deployed through the reviewed release procedure before live decision details can persist.
- Correction manifest: `C:/Users/20106/.codex/gemini-worker/runs/20260926-125747-be210959/manifest.json`. No Gemini worker remains running.

## Confirmed migration blockers

- Real dispatcher probe: `chat.ask`, `ceo.goals.savePlan`, `ceo.goals.saveTargets`, `ceo.manualPayments.add` and `softDelete` returned success with zero database calls. The dispatcher also fabricates roles.
- Live catalog reads confirm checklist table SELECT is intentionally unavailable to browser users; use its guarded RPC. Direct CSM profile UPDATE is also unavailable, and current code ignores its errors.
- CSM income-goal code does not match the goal-target schema or original per-person/month ownership.
- Ask AI uses creative-production requests as a queue with nonexistent states/fields. A proper job contract is still required.
- Authenticated role/client/revoked-user tests, full audit coverage, history reconciliation, active schedule parity, blocked-Convex journeys, and production/rollback verification remain outstanding.
- Gemini initially called `cockpit_get_ceo_sections` and `eod_outbox` missing. Both exist; the claims were rejected and corrected.

## Integration and evidence

- Fetched main is `af01995`; baseline migration was 20 ahead / 31 behind. `git merge-tree --write-tree` preview found five conflicts: `.gitignore`, deleted `src/dev/convexStub.ts` and `src/dev/harness.tsx`, `WebinarFunnel.tsx`, and `scripts/ship.sh`. No actual merge was attempted.
- Evidence/logs: `C:/Users/20106/AppData/Local/Temp/cockpit-migration-review-20260926/` (readiness reports, source-change probe, adapter probe, catalog/grants evidence, builds, typechecks, tests, merge preview).
- Main working checkout has unrelated changes; preserved. Migration worktree's existing `scratch/` was not committed or altered.
- Shared context sync stopped on unrelated local edits; using `398a4ed`. No reset/stash/overwrite. ClickUp tracking credentials were not available in the process or documented local paths; no board update was made.

## Next action

Reconcile main on an isolated checkout, resolving the five known conflicts without reintroducing fake production clients or losing newer Sales/webinar behavior. Follow the ordered packets in the completion plan. The remaining dispatcher/state/auth/worker work is substantive; this migration is NOT end-to-end complete.
