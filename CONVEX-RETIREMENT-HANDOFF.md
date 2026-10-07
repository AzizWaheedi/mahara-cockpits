# Session Handoff: Complete Convex Retirement

**The Supabase frontend release shipped, but Convex retirement remains incomplete; begin with a complete reader, writer, and worker inventory.**

Date: 2026-10-07
Working directory: `D:/MaharaMedia/worktrees/mahara-cockpits-supabase-completion`

## Context

Muhammed requested a handoff for a new session to retire Convex completely. This document transfers that goal, not permission to delete deployments immediately. Frontend shipping does not establish system-wide independence.

**This document supersedes the retirement instructions in the existing `HANDOFF.md`.** Its older instruction to deploy and then retire Convex skips unfinished acceptance gates. Do not repeat the completed shipping work.

## What we did this session

- **Frontend release: LIVE.** Recorded production proof shows five cockpits deployed at the release SHA. Shipping completed with exit code zero.
- **Release verification: LIVE.** Recorded checks passed five gates, ten typechecks, five builds, and 59 offline suites. Five production entries and bundles returned HTTP 200. Their bundles contained the native Supabase project URL and no explicit legacy Convex deployment URL.
- **Native gateways: LIVE.** Five gateways were ACTIVE and returned HTTP 401 without authentication. Four new gateway tables had verified RLS and service-role grants.
- **Merge: BUILT.** The reviewed merge preserved Aziz's layouts and native Supabase behavior. Gemini produced no tracked merge edits and was stopped before the local fallback. No Astra agents ran.
- **Handoff verification: BUILT.** Re-read acceptance evidence and checked all five sealed artifact hashes. Confirmed three protected source exports exist. The source manifest explicitly records no write freeze.
- **Scope of this correction: BUILT.** Created this handoff only. No import, deployment, writer shutdown, provider mutation, or Convex deletion ran.

## Current state: you are here

- **Live and verified: LIVE.** Production release evidence is dated 2026-10-07. This handoff checked saved receipts, not a new authenticated production replay.
- **Repository baseline: BUILT.** Before creating this file, the active worktree was clean at the release SHA on the migration branch. This handoff is a new local file, not committed or pushed.
- **Built, not fully verified: BUILT.** Importers and native media worker contracts exist. Complete historical reconciliation and live worker activation remain unverified.
- **Storage evidence: BUILT.** The protected file map contains 1,095 entries marked verified. That is mapping metadata, not proof of final-delta completeness or a new byte readback.
- **Retirement acceptance: TODO.** The contract is `ship-first`. Both `full_cutover_ready` and `convex_retirement_authorized` remain false.
- **Functional prerequisite: BLOCKED.** The existing report-document producer remains unavailable. Do not claim reports were queued.
- **Legacy deployments: UNCONFIRMED.** No deletion is recorded. Do not assume all legacy writers stopped or that no new records arrived.

## Still open / TODO

1. **Inventory every dependency: TODO.** Audit production source, pure models, development fixtures, tests, SDK generation, import tools, storage URLs, gateways, workers, schedules, webhooks, secrets, and external hosts. Include Hermes processes and cron. Record each active reader/writer, its owner, its native replacement, and equivalence evidence. A directory named `convex` is not itself a deployment call.
2. **Prepare native replacements: TODO.** Reuse existing worker contracts. Keep live schedules disabled until the cutover is ready. Verify named credentials, `doctor`, health-ledger calls, audit receipts, uncertain-outcome reconciliation, cron under `flock`, and the runbook. Missing data must remain unavailable, never zero.
3. **Finish historical dry runs: TODO.** Use the protected manifests and existing importers. Read current help and safeguards before constructing commands. Recheck source hashes and current target values. Cover business rows, original files, saved calendar choices, assist briefs, manual-payment provenance, and human changes. Do not apply stale plans.
4. **Review and apply reconciled data: TODO.** Obtain approval for each live write run. Verify one row and one original file before expanding. Preserve notes, checkboxes, reviewer scores, payments, choices, timestamps, legacy columns, and original bytes. Verify full counts, hashes, values, links, conflicts, and audit receipts.
5. **Coordinate the final writer cutover: TODO.** Obtain approval for the live freeze and activation run. Stop legacy writers, capture fresh final exports, apply the reviewed delta, and prove no late records were missed. Activate native schedules without overlapping legacy provider mutations. Existing exports are not a write freeze.
6. **Exercise production without Convex: TODO.** Verify authenticated staff roles, save/refresh, revoked users, denied actions, server calls, workers, providers, and file links with Convex blocked. Get approval for client-visible or outward test actions. Record actual behavior, not only static scans or unit tests.
7. **Prove recovery and remove obsolete dependencies: TODO.** Verify recovery that survives deletion, not a rollback relying on the original deployment. Move required pure models, migrate all callers, and remove obsolete SDK/source/test/build paths without aliases or shims. Preserve protected exports. Update operational documentation after verification.
8. **Certify and retire: TODO.** Mark full-cutover gates passed only with evidence. Obtain explicit approval for the destructive retirement run. Retire one deployment at a time. Verify production and native schedules after each deletion. Remove only confirmed obsolete secrets, webhooks, and operational configuration.

## Key files, IDs & locations

Paths below are relative to the working directory unless absolute.

| What | Value |
|------|-------|
| Active branch | `codex/supabase-completion-20261004` |
| Released source SHA | `1bccb342b1e177fb5372935b94e5fd99bd4acda1` |
| Reviewed merge SHA | `4a69e22fa44e9cf2109963a6ff022fca6c5a4552` |
| Supabase target | Creative Triage: `bldgtotkfmhoxmlzowdx` |
| Read-only source | B2B: `flwboeijllbtrufxkhts` |
| Media Buyer/shared portal legacy | `adorable-seahorse-418` |
| Client Success legacy | `impressive-dinosaur-375` |
| Creative Director legacy | `colorful-wombat-644` |
| Acceptance evidence | `evidence/cutover-acceptance.json`, especially `option_c_production_release` |
| Protected source manifest | `D:/secure/cockpit-final-source-manifest-20261006.json` |
| Protected file map | `D:/secure/cockpit-final-verified-files-20261006.json` |
| Runtime importer | `scripts/import-cockpit-runtime-sources.py` |
| Other importers | `scripts/import-snapshot-data.py`, `scripts/import-media-statistics.py` |
| Storage/payment planning | `scripts/plan-cockpit-storage-import.py`, `scripts/plan-manual-payments-import.py` |
| Media worker boundary | `hermes/media-native/` |
| Native gateways | `cockpit-csm-api`, `cockpit-media-api`, `cockpit-creative-api`, `cockpit-ceo-api`, `cockpit-team-api` |
| Readiness verifier | `scripts/verify-cutover-readiness.py` |
| Host management helper | `scripts/query-supabase.ps1` |
| Host credential file | `D:/MaharaMedia/mahara-cockpits/.env.local`, values must not be printed |
| Production route/bundle receipt | `D:/MaharaMedia/worktrees/cockpit-option-c-production-verification-20261007.json` |
| Production source receipt | `D:/MaharaMedia/worktrees/cockpit-option-c-production-source-metadata-20261007.json` |
| Canonical release note | `D:/MaharaMedia/mahara-context/shared/sessions/2026-10-07T023634Z-omp-option-c-production.md` |
| Live routes | `https://cockpit.maharamedia.com/`, `/client-success/`, `/creative/`, `/editor/`, `/sales/` |

## Constraints & conventions to carry forward

- **Preserve unrelated work.** Use the active worktree and branch. Preserve primary-repository and canonical-context edits.
- **Keep B2B read-only.** Preserve fixed-project allowlists and management payload `read_only: true`.
- **Default to dry-run.** Review proposed data changes before applying. Preserve human data and original files.
- **Keep credentials server-only.** Read keys by name. Never expose service-role or management credentials through `VITE_*`.
- **Use the supported server secret.** Native management callers use `COCKPIT_MANAGEMENT_TOKEN`. Custom `SUPABASE_` secret names are rejected. Host CLI configuration is separate.
- **Preserve server controls.** Gate every action on the server. Keep audit rows, provider receipts, and uncertain-outcome reconciliation.
- **Require live-run approval.** Each client-visible write, outbound message, provider mutation, and destructive retirement run needs explicit approval.
- **Do not repeat completed checks.** Test new changes and retirement scenarios. Do not rerun old successful suites only to confirm this handoff.
- **Do not change model settings.** No Astra agents, forced compaction, browser relay, or repeated screenshot loops.
- **Use clean contracts.** Publish named TypeScript contracts at owner modules. Preserve required pure models without confusing source-directory names with network dependencies.
- **Keep honest acceptance.** A missing value is unavailable. A successful frontend ship is not proof of complete Convex independence.

## Open questions / decisions for next session

- **Live cutover approval: BLOCKED.** Agree the writer freeze, final-delta application, native schedule activation, and verification run before live mutations.
- **Report producer: BLOCKED.** Resolve its missing prerequisite before claiming full functional acceptance. Architectural changes or reduced acceptance scope require Muhammed's decision.
- **Destructive deletion: BLOCKED.** Obtain explicit approval after all retirement gates pass. The retirement goal alone does not certify safety.
- **Context synchronization: BLOCKED.** The saved release note records pre-existing dirty context changes. Preserve them and synchronize only through safe integration.

## How to resume

- **Saved at:** `D:/MaharaMedia/worktrees/mahara-cockpits-supabase-completion/CONVEX-RETIREMENT-HANDOFF.md`.
- **Start the next session:** Point the agent at this file and ask it to execute the retirement goal under these approval gates.
- **First action:** Read the acceptance evidence, then inventory remaining active Convex dependencies. Do not repeat shipping or delete deployments immediately.
- **Durable record:** The canonical release note remains the production history. This separate handoff preserves the existing tracked release checkpoint.

## Retirement resumed: 2026-10-07

Work remains active. [Inventory](docs/CONVEX-RETIREMENT-INVENTORY-20261007.md).
[Verification](docs/verification/convex-retirement-resume-20261007.json).

- APPLIED AND VERIFIED: approved 4,738-record run. All values and identities match across 23 feeds and two histories.
- Preserved all 7,091 earlier import records. Original file readback matches.
- Reporting and monitoring functions are installed. Server grants and anonymous denial checks pass.
- Fixed UTC timestamp comparison. Stored business times are unchanged. Failed attempts were reconciled before retry.
- Private receipts: `D:/secure/cockpit-retirement-prep-20261007/approved-live-run/`.
- Earlier affected local suites and build passed. The 128-file package boots three doctors offline.
- Live catalog: 37 of 145 referenced functions are absent. Prepare and test their existing Supabase replacements.
- History conflicts, statistics, report folder, host setup, final delta, authenticated tests, and recovery remain open.
- No schedules, outward actions, frontend deployment, freeze, or deletion ran in this phase. Retirement flags remain false.
- Next: finish the remaining backend proposal and approve its exact live run. Preserve concurrent edits and protected exports.

## Single-owner consolidation: 2026-10-07

- Previous repair session completed and safely stopped. Retirement session was aborted at 15:09:38Z after its last completed command. No remaining local worker process was observed.
- Protected backup: `D:/secure/cockpit-retirement-prep-20261007/consolidation-20261007/`. All 57 changed paths were preserved before integration.
- Retirement preparation checkpoint: `6a5d16f1`. Repair merge: `b35e8a9b36de27ea4670c820ada0afd101d53022`. Both runbook histories remain. Root main checkout remains untouched.
- VERIFIED: integrated clean-source local gate passed 66 suites, ten typechecks, five builds, source/shared checks. Receipt: `integrated-local-verification.json` in the protected backup folder.
- VERIFIED LIVE READ: 11,829 source imports. Original 7,091 and approved 4,738 records were not replayed. All media/CSM/creative readiness states remain present.
- The twelve final cost/goal definitions were already applied at 15:06:58Z. Receipt verifies unchanged cost and goal business rows. Do not rerun that installation.
- STAGED AND VERIFIED: 128 runtime files at `/opt/data/mahara-native-staging/b35e8a9b`. Every file hash verified. Bun 1.4.2 installed from its pinned integrity-verified distribution. Three dependency installs passed. No active worker or scheduler was changed.
- CONFIGURED: named native credentials from the existing approved media deployment. Stored remotely with mode 600. Media, source-sync, CEO and Ask AI doctors pass. Guardian still needs its service-user configuration.
- DRY RUN FAILED SAFELY: CEO finance readiness blocks its combined run. No data or provider write occurred. Source-sync dry run also failed before producing a plan; diagnosis is active.
- User selected report folder `1YolkzE6ycBQT69hFa_iGUnDMiEMUCQ09`. Verified owner is active cockpit admin/CSM. Folder currently has anyone/writer access. User explicitly instructed keeping public editing. Implement an explicit folder-bound exception, keeping private default and server/audit checks.
- Still open: exact historical conflict resolution, statistics freshness, finance alias/history proof, report audience completion, native live-run acceptance, final delta/freeze, production deployment and Convex-blocked browser/recovery proof. No schedules, outward report run, writer freeze or deletion occurred.

### Native EOD and chosen report audience, verified 7 October

- Applied the existing `20260927b_eod_delivery_claims.sql` after its nine isolated tests and a live ROLLBACK preview. The queue was empty before and after. Three service-only RPCs, nine missing columns, and both protection/audit triggers are installed. Receipt: `eod-native-contract-receipt.json` under consolidation evidence. No deliveries or schedules ran.
- Report audience change passed 39 focused tests and the Deno server check. Public editing remains denied by default. An explicit folder-ID match accepts anyone/writer for the user-selected folder. Its configured owner must remain an active admin/CEO/CSM member. Both folder and final-document audiences use the same policy.
- Deno's frozen check found the pre-existing root lock out of date. The successful server check used `--node-modules-dir=auto --no-lock`; no source lockfile was changed.
