# Mahara cockpit migration: current checkpoint

Updated 2026-09-27. Continue in this same chat. Do not suggest a fresh chat for context reduction.

## Objective and authorization

Complete five cockpits, portal and CEO/admin on Supabase while preserving behavior and history. Creative Triage `bldgtotkfmhoxmlzowdx` owns cockpit data; B2B `flwboeijllbtrufxkhts` is read-only. No production deployment, live SQL application, client-visible write or outward send has occurred in this work.

Muhammed chose Codex planning/supervision and Gemini execution, explicitly allowed Codex execution after quota exhaustion, and reconfirmed continuation. Gemini resumed, but later High workers returned no changes/empty response. The latest raw result reports a denied ViewFile/read_file action, not a demonstrated quota error. Do not bypass worker permissions. Scoped Codex fallbacks are recorded; ordinary local work needs no repeat approval.

## Source and workspaces

- Main migration: `C:/Users/20106/.codex/worktrees/cockpits-supabase-migration`, branch `codex/supabase-cockpits-migration`, code `80e35a96354cc47628749cdbacce4e40edaf05ee`.
- Clean tested assembly: `9c50b9bdaf2bcaaa6740ffcf5e61e3ac3328ed9d`. A Git comparison confirms identical apps/supabase/scripts/hermes code in the migration branch; checkpoint/evidence commits differ.
- Preserved merged main baseline `4b90d9f`, including 39 previously missing Sales/webinar commits. Merge `77b4aad` retained both histories; temporary conflict snapshot `d1cece6` is not on the migration branch. Recheck newer main before release.
- Helpers under `C:/Users/20106/.codex/worktrees/`: `cockpit-migration-verification/mahara-cockpits` is clean at `9c50b9b`; `cockpit-migration-actions/mahara-cockpits` is clean at `e83d81e`; both free. `cockpit-webinar-targets/mahara-cockpits` has an older preserved draft. No workers remain running.
- Preserve primary `D:/MaharaMedia/mahara-cockpits` human changes and migration `scratch/`. Do not reset/stash/delete them.

## Implemented and locally verified

1. Readiness verifier requires fresh builds, real app/node typechecks and source-bound acceptance evidence. Empty Python discovery cannot pass. Isolated dev fixtures stay out of production imports; source scanning alone is not runtime independence proof.
2. MB/CSM checklists use guarded RPCs, explicit expected/new checkbox values and correct decision parameters. `20260926a_cockpit_decision_details.sql` stores metadata/reason and immutable audits.
3. Common facade references are stable; roles/auth use verified Supabase membership instead of invented roles. CEO webinar targets use authenticated wrappers and existing versioned targets, historical cutoffs, retries/conflicts and audits (`20260926k`).
4. CEO Goals reads/edits/copies real plan/target tables, preserves omitted values, uses source fingerprints and server Kuwait date, and is founder-gated (`20260926l`). Pure social/webinar math was separated from backend registrations. ship.sh env invocation fixed; shipping did not run.
5. CSM state (`20260926m`): separate preferences, private/manual hot rows, dismissals and per-user/month goals; recursive conservative profile edits; field-level patches, truthful freshness/errors. Financial loose ends cannot be dismissed. Appointments/tasks/churn and other metrics are still incomplete.
6. Chat (`20260927a`, integrated `b84a4a4`): three Hermes UIs use server history, typed receipts, scoped business context, owned clear, roles/client checks and access fingerprints. Claims require original tokens, worker identity and live leases; stale/revoked completions fail. Python helper defaults to dry-run, has no Convex fallback or unrestricted profile access. Legacy AI producers/provider actions and actual model responder activation are NOT migrated by this packet.
7. EOD sender (`20260927b`, `b351ab3`): atomic claims, durable send-start, fenced immutable receipts/report contents, audit, finite retries, uncertain sends held for reconciliation. One HTTP attempt per Slack/Sheets effect; service account via GOOGLE_APPLICATION_CREDENTIALS only, no personal OAuth/retrying POST wrapper. Sales polls processing status. Host configuration, old-sender retirement and live single-report proof remain outstanding.
8. CEO People (`20260927c`, `52ff8fa`, `98a2b70`): real financial roster read/roles/save/soft deactivation, original cost math, audited conservative changes, human notes/commission/schedules/provenance retained, payroll history preserved. Login seats stay separate. Both verified founders allowed; ordinary admin/spoof/unconfirmed/revoked denied. Workspace directory/import explicitly unavailable pending its server integration.
9. Manual payments (`20260927d`, `c39d48b`): live read-only catalog confirmed the former facade table did not exist. New counterpart of ceoManualPayments preserves original IDs/provenance, stored FX, cents/fils, refunds/deals, duplicate confirmations, request retries, soft deletion/restoration and audits. Log/history contacts are masked before browser responses. The UI refreshes confirmed writes and exposes errors.
   - `cockpit_manual_payment_state.history_ready` defaults false. Import/reconcile original history before using the log; an empty new table must not look like no payments existed.
   - Revision/totals_revision explicitly track pending totals. The money refresh is NOT yet consuming/reconciling this log. No “totals update in a minute” claim remains.
   - Tap status is read from the existing money section and can be unknown, never silently false. Actual catalog read found Tap connected; no financial live writes were performed.

## Evidence

- `docs/verification/cutover-local-20260927-finance.json`: clean `9c50b9b`, five fresh builds, ten typechecks, **251 Bun tests + 35 Python tests in 26 suites**. Focused finance lint reports no errors (four warnings, including intentional serialized hook dependencies).
- Focused new tests: People 6 cases/67 assertions; payments 7/130; chat 6/96; EOD SQL 9/44; workers 15 + 13 Python cases.
- Readiness infrastructure: 22 regressions passed earlier this continuation. Historical incoming-main checks include 190 Sales worker, 47 webinar worker and 118 Sales API tests; their logs remain available.
- Verifier correctly rejects release solely for missing production acceptance evidence. All new SQL remains unapplied live.
- Logs and read-only catalog proof: `C:/Users/20106/AppData/Local/Temp/cockpit-migration-review-20260926/`; latest files `final-assembled-release-check.{json,log}`, `people-final-tests.log`, `manual-payment-final-tests.log`, `manual-payment-catalog.json`.
- PGlite 0.3.14 is linked from temporary merged-test-deps; SQL tests use actual audit/membership definitions and canonical founder gate, never live DB URLs. Helper node_modules junctions are ignored.
- Worker manifests under `C:/Users/20106/.codex/gemini-worker/runs/`: Ask AI correction `20260927-011831-bfc7635b`, EOD correction `20260927-012210-0dacf791` required Codex repairs; People `20260927-015529-d09c91dc` and payments `20260927-115214-e70a3605` produced no work. Latest interrupted payment run had no edits and was confirmed stopped before retry.

## Next and completion gaps

1. Offline planner `scripts/plan-manual-payments-import.py` is ready, with seven tests. It never connects to live systems and has no apply flag. The Sep 23 source snapshot produced one payment and one related audit candidate with zero transformation errors; protected artifacts are in `D:/secure/manual-payment-import-plan-20260927-0932/`. Target was not compared; source is old; apply_ready stays false. Next: fresh export/catch-up, fresh target comparison, database-enforced audit import deduplication, controlled import/read-back and money/client recomputation. Do not flip readiness flags or create live payments without evidence and authorization.
2. EOD ownership decision is still unanswered: legacy storage is one report per role/day, delivery is per person. Current async question recommends a separate report per person. Preserve legacy records; do not silently rekey. Draft/submission semantics and trusted recipient roster remain unfinished.
3. Finish remaining facade domains and CSM snapshots. Earlier conservative AST inventory found 133 reachable endpoints/116 generic-success branches; Goals/People/payments now cover some, but no updated completeness percentage is justified.
4. Migrate AI producers (assist_copy, draft_copy, call_brief, comment_digest, campaign relays), provider operations, health reporting, schedules/webhooks and file/public-link flows. Queue storage alone is not a deployed model runtime.
5. Reconcile all history/catch-up; verify authenticated staff journeys and forbidden access on preview with Convex blocked; rehearse rollback; review production config and shipping preflight order; deploy only when authorized, verify exact live source; retire old writers only after proof. No full migration completion claim.

Shared context remains `398a4ed`, dirty/diverged. Latest local session notes: `2026-09-26T225800Z-codex-cockpit-workers.md` and `2026-09-27T092211Z-codex-cockpit-finance.md` in `D:/MaharaMedia/mahara-context/shared/sessions/`. Saved locally, not synced; preserve modified derived indexes. ClickUp credentials were unavailable; no board message was sent. Do not crawl the old vault.
