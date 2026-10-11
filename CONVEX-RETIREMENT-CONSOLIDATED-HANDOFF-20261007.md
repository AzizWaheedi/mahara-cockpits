# Session Handoff: Complete Convex retirement with one owner

**The cockpit repair is complete, the reviewed import is verified, and full Convex retirement remains unfinished.**

Date: 2026-10-07. Last combined observation: approximately 15:06 UTC.

## Context

Muhammed requested stopping the two concurrent sessions and continuing all pending work in one fresh session. Preserve their work and continue from verified results. This file consolidates their state. It does not certify that both old sessions have stopped.

## What we did this session

- **Read-only review:** Compared both sessions, Git state, and verification receipts. **LIVE**
- **Stop requests:** Queued safe-stop instructions through `codex queue` for both session IDs below. At 15:05:56 UTC, the repair session confirmed its child was stopped and no transaction, deployment, or command remained running. It was recording a handoff. The retirement session had not acknowledged the stop. **IN PROGRESS**
- **Preservation:** No worktrees were reset, deleted, cleaned, or force-killed. No production data was changed by this reviewing session. **LIVE**

## Current state

- **Cockpit repair:** Repair session reports completion at commit `c340143d`, with 66 suites, ten typechecks, five builds, and ten final guard regression cases passing. The worktree was clean when checked. **LIVE**
- **Public release:** All five public cockpit entries were independently checked by the repair session against combined release `ffc8ff5a`. Later commit `c340143d` contains the final backend role guard and documentation. Do not assume the frontend bundles were republished at the later SHA. **LIVE**
- **Database repair:** Receipt verifies 55 function definitions, nine new tables with RLS and grants, zero missing names among 139 scanned references, and unchanged content in 28 business tables. A separately timestamped recording sync was preserved. This scan does not establish complete business behavior or historical financial reconciliation. **LIVE**
- **Source import:** All 4,738 reviewed records were published and individually verified. The previous 7,091 imports remain unchanged. Original-file readback also passed. **LIVE**
- **Report operation rule:** Restored and verified the five permitted operations after an older constraint reappeared. No business rows changed. Preserve `checkIns.book` and `reports.create`. **LIVE**
- **Remaining cost/goal functions:** A forward candidate restores eight missing callers through twelve definitions. Review records 15 passing isolated tests, 130 assertions, and a live rollback preview. The saved review says `PREPARED_AND_TESTED_NOT_APPLIED`, but at 15:06:30 UTC the retirement session announced installation. Application and readback are not yet confirmed. Inspect the latest receipt before retrying or applying anything. **IN PROGRESS**
- **Retirement code:** The retirement worktree still sits at `1bccb342` with substantial tracked and untracked changes. It does not contain the latest repair commits. Do not deploy that stale baseline. **IN PROGRESS**
- **Workers:** A corrected 128-file package and offline boot checks exist. Activation, sustained source publication, and provider acceptance are not certified. **BUILT**
- **Convex shutdown:** No verified final writer freeze, late-delta reconciliation, Convex-blocked acceptance, deletion-independent recovery, or deletion is recorded. **TODO**

## Still open / TODO

1. **Confirm exclusive ownership.** Verify both old sessions and their children have stopped. Check for outstanding commands and remote jobs. A queued stop message alone is insufficient. Do not launch concurrent production writes.
2. **Preserve and integrate.** Inventory dirty and untracked files in the retirement worktree. Preserve them before merging the latest repair commit and any subsequent checkpoint. Keep one release branch. Never reset or blindly replay historical migrations.
3. **Finish the narrow backend candidate.** Read its review and compare against the live schema. Preserve human notes, permissions, audits, and the five-operation CSM constraint. Verify approved effects and read back after any application.
4. **Resolve historical differences.** Earlier dry runs found checklist/audit mismatches, media-statistics differences, and 87 extra booking records. Booking identity handling was corrected. Resolve genuine differences conservatively. Do not overwrite human data or mark finance history ready without evidence.
5. **Finish native runtime setup.** Install and verify `cockpit-sync`, `media-native`, `ceo-refresh`, native Ask AI, and native monitoring. Inspect stale Meta helpers and the separate portal monitor. Preserve independent cron families and dirty VPS work. Use named credentials, doctors, targeted tests, `flock`, and receipts.
6. **Finish reports and deployment.** Verify the internal report folder setting, gateway wiring, and selected-period behavior. Integrate prepared frontend changes before publishing. Use `scripts/ship.sh` and confirm actual public domains.
7. **Prove independence and recovery.** Exercise authenticated reads, saves, refreshes, denied/revoked access, files, and worker updates with Convex blocked. Verify recovery from protected exports and original-file mappings.
8. **Perform the guarded cutover.** Freeze confirmed legacy writers, capture final changes, reconcile them, verify native scheduling and monitoring, then retire only proven targets. Confirm run-specific approval where required before activation, outward actions, or irreversible deletion.

## Key files, IDs and locations

| What | Value |
|---|---|
| Repair session | `01a115bd-9cbe-72d3-9603-918e216971b6` |
| Retirement session | `01a115b2-9b04-7951-82a8-66b5e39d2000` |
| Session logs | `C:/Users/20106/.codex/sessions/2026/10/07/`, filenames ending in the session IDs |
| Repair worktree | `D:/MaharaMedia/worktrees/mahara-cockpits-auth-hardening-20261007` |
| Retirement worktree | `D:/MaharaMedia/worktrees/mahara-cockpits-supabase-completion` |
| Latest repair commit | `c340143d` |
| Combined public release | `ffc8ff5a272721e285115513f0db82e87ae79dad` |
| Cockpit database | Creative Triage `bldgtotkfmhoxmlzowdx` |
| Read-only B2B source | `flwboeijllbtrufxkhts` |
| Live portal | `https://cockpit.maharamedia.com` |
| Repair evidence | `D:/MaharaMedia/worktrees/cockpit-rpc-production-verification-20261007.json` |
| Public release evidence | `D:/MaharaMedia/worktrees/cockpit-rpc-frontend-production-verification-20261007.json` |
| Import evidence | `D:/secure/cockpit-retirement-prep-20261007/approved-live-run/approved-backend-run-verification.json` |
| Restored report rule | `D:/secure/cockpit-retirement-prep-20261007/approved-live-run/report-action-rule-restoration-receipt.json` |
| Remaining candidate and review | `D:/secure/cockpit-retirement-prep-20261007/remaining-backend-review/` |
| Candidate SQL | `missing-backend-forward-candidate.sql` in the preceding folder |
| Candidate review | `forward-candidate-review.json` in the preceding folder |
| Original retirement inventory | `docs/CONVEX-RETIREMENT-INVENTORY-20261007.md` in the retirement worktree |
| Original retirement handoff | `CONVEX-RETIREMENT-HANDOFF.md` in the retirement worktree |
| Source exports and worker proofs | `D:/secure/cockpit-retirement-prep-20261007/` |
| Shared context | `D:/MaharaMedia/mahara-context` |
| Operating rules | `C:/Users/20106/.agents/OPERATING-RULES.md` |

## Constraints and conventions

- **Approval:** User authorized consolidation and completion of pending work. Do not ask again for already approved local preparation. Verify specific live-run permissions before outward actions, schedules, client writes, and deletion. The previously approved 4,738-record run is already complete.
- **Production safety:** Supabase-first, `cockpit_` tables, matching RLS/grants, server-side access gates, audit coverage, and health-ledger helpers. Missing evidence must not appear as zero.
- **Preservation:** Keep source exports, audit rows, original files, human notes, checkboxes, historical values, and unrelated edits. Do not replay data-changing historical migrations wholesale.
- **Scope:** Continue unfinished tasks. Do not redesign screens or redo completed inventories and broad test suites without a changed dependency or unresolved concern.
- **Context:** Safe context sync previously stopped because local edits exist. Preserve them. Read the canonical context root instructions and only relevant sections. Old inventory approval statuses are superseded by newer receipts.
- **Communication:** Use plain English. Report applied and verified milestones. Previous percentage and timing estimates were subjective and must not become acceptance criteria.

## Open decisions

- **Exclusive ownership:** The retirement stop acknowledgment still needs confirmation before the replacement session makes writes. The repair session confirmed no active commands or child remained.
- **Data conflicts:** Any genuinely conflicting human records may need Muhammed's decision after an exact comparison.
- **Live cutover:** Confirm the exact worker activation and deletion run scope before irreversible operations.

## How to resume

Start one fresh session in the project and point it at this file. Confirm the old sessions are stopped first. Begin with state preservation and integration, then follow the ordered TODO list. Do not repeat the completed 4,738-record import.

This handoff is a local, uncommitted file. No persistent memory update was requested or performed.
