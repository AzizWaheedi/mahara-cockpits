# Convex retirement inventory and preparation

Verified preparation: 7 October 2026. This is a local preparation record, not a retirement certificate.

Worktree: `D:/MaharaMedia/worktrees/mahara-cockpits-supabase-completion`.
Branch: `codex/supabase-completion-20261004`.
Baseline: `1bccb342b1e177fb5372935b94e5fd99bd4acda1`.
The five Supabase frontends already shipped. This phase did not repeat shipping.

## Authorization and evidence limits

Muhammed approved local caller inventory, native preparation, report wiring, and protected historical dry runs.
This phase performed no live writes, uploads, schedule changes, deployment, outbound messages, or deletion.
Another session repaired 17 media feeds and uploaded two missing files. The refreshed plans preserve that work.

`evidence/cutover-acceptance.json` remains unchanged.
Its ship-first contract has `full_cutover_ready=false` and `convex_retirement_authorized=false`.
Exports have `write_freeze=false`. They cannot establish final-delta completeness.

“Active” below means observed operation or an enabled host job.
“Declared” means source configuration only.
“Unknown” requires host or provider evidence.
Ownership names identify code modules, deployments, or processes. Human ownership remains unconfirmed.

## Reader, writer, and worker boundaries

| Boundary and owner | Observed state | Native replacement | Evidence and remaining gate |
|---|---|---|---|
| Released frontend readers, five Vercel cockpits | Supabase release already verified in the release receipts | Native gateway and Supabase read models | This phase did not replay authenticated journeys. Save, refresh, denied roles, revoked users, and files need Convex-blocked verification. |
| Media `BackendWait`, frontend module | Conditional `VITE_CONVEX_URL` probe remains at `apps/media-buyer-cockpit/src/components/BackendWait.tsx:24` | Native backend availability probe | Released URL is empty. Remove the dormant dependency after readiness and recovery proof. |
| Three CEO pure-model exports | Build-time exports remain under `src/types/ceo` | Move models into their owning native modules | `webinarTargetsModel`, `webinarRoom`, and `webinarReadiness` are pure code. Their directory name is not a deployment call. |
| Media deployment `adorable-seahorse-418` | HTTP version and OpenID discovery answered 200 | `cockpit-media-api`, `cockpit-sync`, `media-native`, `ceo-refresh` | Latest 200 scheduled rows showed recent writes and notifications. The sample is capped, not an exhaustive count. |
| CSM deployment `impressive-dinosaur-375` | HTTP probes answered 200. Scheduled-functions query returned no documents | `cockpit-csm-api` and native CSM producer | Empty scheduled rows do not prove a writer freeze. Bridge calls and historical data still need reconciliation. |
| Creative deployment `colorful-wombat-644` | HTTP probes answered 200. Scheduled-functions query returned no documents | `cockpit-creative-api` and native creative producer | Reader, bridge, provider, and storage equivalence remain open. |
| Five native gateway owners | No runtime Convex network import found in audited gateway code | Existing native functions | Static independence is insufficient for authenticated action acceptance. No gateway was deployed by this phase. |
| Hermes Cockpit Ask AI job `e4601df61803` | Enabled on host `srv1490962` | `hermes/cockpit-ask-ai/scripts/askai.py`, native leases and health | Both host copies remain stale. Native Ask AI has 15 passing local tests, but it is not installed or activated. |
| Hermes legacy Ask AI helpers | Repository and `/opt/data/skills/mahara` copies call `/askai/health`, `/askai/result`, and `/bridge` | Native claim, result, health, and client-context contracts | Replace both copies during the approved cutover. Verify the actual enabled skill path. |
| Legacy Meta helpers `meta.py`, `meta_bridge.py`, `metacall.py` | Host files point to media Convex `/askai/meta` | Existing server-gated native media actions | Native Ask AI intentionally produces drafts. Disable or reroute old mutation helpers. Do not create a generic credential proxy. |
| Hermes native source producer | Host checkout lacks `hermes/cockpit-sync` | Existing worker, source leases, CAS publication, provider health | 17 media feeds are ready after another session's repair. CSM 11 and creative 12 remain unready. Installation and live production are unverified. |
| Hermes native media worker | Host checkout lacks `hermes/media-native` | Existing durable queue, lease, receipt, and reconciliation contracts | Paused package prepared. Verify doctors, named credentials, providers, and one approved work item before expansion. |
| Hermes CEO producer | Host checkout lacks `hermes/ceo-refresh` | Existing section producer and publication ledger | Package prepared. Prove native source coverage and recent publication. Do not relabel old payloads as fresh. |
| Guardian monitor | Active host code still probes Convex | Local `checks/native.py`, explicit hybrid/native registry | 264 Linux tests pass. Hybrid remains default. Native mode omits only the Convex module. |
| Native monitor SQL owner | `cockpit_native_monitor_state` was absent in the live schema observation | Existing `cockpit_native_monitor()` and service-only view in `20261004z_native_monitor.sql` | No new monitor table was created. The consumer requires independent media-native, Ask AI, and report evidence that the existing monitor does not yet emit. Extend and verify those receipts before activation. |
| Separate portal monitor | `/docker/hermes-agent-ff5p/data/portal-monitor/monitor.py` still contains Convex checks at lines 899, 1021, 1051 | Native monitor and gateway checks | This phase did not modify that external host file. It remains an explicit retirement blocker. |
| Independent Vercel watchdog | Source uses service-only native RPC and five method probes | `apps/media-buyer-cockpit/api/watchdog.ts` | Source cron declares every 15 minutes. Live credential, cron, and alert behavior were not replayed. Its probes do not exercise provider writes. |
| Existing Hermes cron families | About 29 existing entries, including editor, sales, ideation, review-import, EOD, team, webinar, and guardian | Preserve independent jobs. Migrate only proven Convex callers | Do not blanket-stop cron. No cron was changed. Host checkout has 84 dirty paths at `754585045c0c67989ac0728305fb4119d2aac7f7`. |
| Supabase pg_cron | 13 live schedules read. No command explicitly mentioned Convex | Existing native schedules | Command-string absence does not prove transitive provider independence. No schedule was changed. |
| Historical import tools | Source exports, planning tools, and protected maps remain required | Existing guarded importers | Dry-run plans only. These are recovery assets, not obsolete deployment calls. Preserve all protected exports. |
| Original files and legacy storage URLs | 1,137 fresh source references map to 224 unique verified original hashes | Native storage and verified mapping metadata | All 224 native objects matched original bytes during this session. Sources remain unfrozen. Authenticated links and late-delta proof remain open. |
| SDK, generated API, fixtures, tests, and build paths | Three legacy app packages and source tools retain Convex dependencies | Native contracts and retained pure models | Remove only after callers migrate and recovery survives deletion. No alias or compatibility shim is approved. |
| Archived Viktor scripts | Static callers remain in `viktor-side-scripts` | Archive or migrate after execution ownership is proven | `csm/csm_app_bridge.py` names `healthy-cobra-488`. Activity is unknown. It is not an approved deletion target. |
| External secrets and webhooks | Values were never printed or copied into the package | Named server credentials and verified native endpoints | Provider-console inventories and execution ownership are still required. Static scans cannot certify hidden external callers. |

Personal Aziz `.cockpit-worker` processes had no observed Convex references. They remain outside this Mahara retirement scope.

## Legacy schedule families

The media source declares 16 schedules in `apps/media-buyer-cockpit/convex/crons.ts`.
The two refresh clocks below are separate schedules.
Only the bounded scheduled-functions sample establishes recent activity.

| Declared family | Replacement boundary | Equivalence status |
|---|---|---|
| Working-day and overnight sync | `hermes/cockpit-sync` source production | Built. Native host activation remains unverified. |
| Market plays | Native market producer | Built. Fresh production coverage remains unverified. |
| Assist queue | `hermes/media-native` draft/asset handlers | Built. Live leases and provider behavior remain unverified. |
| Other cockpits' outboxes | Native gated actions and durable outbound queues | Built. Approved single-message/provider tests remain required. |
| Board KPI writeback | Native provider receipts and canonical facts | Provider-write parity remains unverified. |
| Tracking audit | Native tracking facts and provider health | Production parity remains unverified. |
| Smoke checks and alerts | Vercel watchdog, guardian, and native monitor | Local guardian coverage passed. External monitor and worker-receipt gaps remain. |
| Client report documents | Local native CSM report action | Wired and tested locally. Not deployed or accepted live. |
| Hermes relay | Native Ask AI and media chat contracts | Stale host helpers remain active. |
| Client comment watch | Native source capture and briefs | Historical unresolved client scope remains a blocker. |
| Hiring intake, board mirror, engine | Native CEO/hiring source and gated actions | Live engine arming and outward-action equivalence remain unverified. |
| Sales watch | Independent sales mirror plus native monitor | Preserve independent schedules. Live monitoring equivalence remains unverified. |
| CEO refresh | `hermes/ceo-refresh` | Built. Host installation and native publication remain unverified. |

The CSM source declares billing refresh and onboarding sync in `convex/crons.ts`.
Native billing/onboarding contracts exist, but their approved live producer acceptance remains open.
No creative cron file exists in this checkout. External bridge activity still requires proof.

The media scheduled sample included recent `fanout.runFanout`, `ceo/extensions.applyAuto`, `commentWatch.apply`,
`writeback.submitEod`, `previews.captureStills`, `cockpit.shadowDailyCheck`, `smoke.slackLines`, and health notifications.
The latest observed scheduled timestamp was `2026-10-07T09:41:17.787Z`.
No source export or successful frontend build constitutes a writer freeze.

## Local report repair

The previous frontend rejected report requests. The existing producer was not routed.
Its formatter also ignored selected report dates.

The local change reuses `cockpit_csm_actions`, audit triggers, and server role/client gates.
`reports.create` defaults to dry-run and uses actor-bound durable request identity.
Unknown provider outcomes require reconciliation. Deliberate retries reuse the original intent.
Revocation or changed source context prevents confirmation.

Reports use original daily series for the selected period.
Comparison facts, labels, dates, and backlog counts follow that period.
Missing original series remain unavailable.

Google folder permissions are paginated and checked before document creation.
Final document permissions, content, identity, and sharing must also be verified.
Groups, public access, domain access, and unapproved recipients are denied.
The receipt states content readback verification. It does not claim visual rendering verification.

The migration is `supabase/migrations/20261007b_csm_report_generation.sql`.
It is not installed live.
Real report credentials, folder permissions, source readiness, and one approved document run remain required.

## Protected dry-run results

Latest plans are under `D:/secure/cockpit-retirement-prep-20261007/refresh/`.
Fresh exports were captured around 10:50 UTC.
The consistent read-only management inventory was captured at `2026-10-07T13:59:09.725426+03:00`.
Management payloads used `read_only: true`. B2B was not queried or modified.

The runtime plan covers 63 table scopes and proposes 58 operations.
It preserves 7,091 existing source-import rows from the concurrent repair.
Both scope completion and full migration completion remain false.

Five blockers require source-aware review:

1. Media call briefs have unresolved client scope.
2. A media CEO audit differs from canonical durable audit history.
3. A media checklist differs from canonical durable check history.
4. Media decisions have unresolved client scope.
5. A CSM logical checklist has a different source identity.

No client identity was guessed. No canonical human row was overwritten.
Media statistics also have 200 extra target records and six changed records.
The manual-payment plan has one payment and one provenance audit, unchanged, with no conflicts.

The refreshed source manifest contains 1,137 file references.
They map to 224 original content hashes with verified native bytes.
Two objects uploaded by the other session were read back and verified.
This phase did not upload any files.

Runtime-plan SHA-256:
`fbd1faeadb6bd3659e5c08ee8359d8ede52fe0e31860d4393e723f596c679d96`.

## Paused package and verification

`scripts/prepare-native-worker-package.py` defaults to a plan.
Explicit materialization creates a new local ZIP outside the repository.
The fixed inventory contains 125 reviewed runtime files.
It rejects missing files, symlinks, source changes, overwrite, and repository destinations.
It includes pinned dependency manifests, doctors, named configuration, and commented flock schedule examples.
No install, transfer, cron activation, or host overwrite ran.

Current package:
`D:/secure/cockpit-retirement-prep-20261007/native-worker-package-final.zip`.
SHA-256: `cda2b2373ce329a6540bba4bb3c6702d414ae2e9777f2d95245ba2e254f4ff66`.

Affected verification passed:

- 94 report/API/SQL/client tests, with 663 assertions.
- 264 guardian tests on Linux.
- 15 native Ask AI tests.
- Four package tests.
- CSM TypeScript/Vite production build.
- Deno server typecheck.

The build reports the existing large-chunk warning.
Provider tests mock all requests. They do not create live documents.
Independent review found no remaining Critical or Important findings within its targeted local scope.
The review does not certify production activation.

`reportPeriod.ts` in the gateway is a byte-identical copy of the existing frontend pure helper.
It avoids a cross-application Deno runtime dependency.
No credentials, raw exports, protected inventories, or unrelated importer edits enter the review patch.

## Next decision

Review the five runtime blockers and statistics differences before proposing an apply run.
Resolve external caller ownership and native monitor evidence gaps.
Stage native code into an isolated host directory that preserves all 84 dirty host paths.
Keep schedules disabled until a reviewed freeze, fresh delta, and activation run receive explicit approval.
Production actions and destructive retirement each need their own approval.
Deletion-independent recovery and authenticated Convex-blocked journeys remain mandatory.

Canonical context synchronization stopped because existing edits were dirty.
This phase preserves those edits and records its checkpoint in `CONVEX-RETIREMENT-HANDOFF.md`.


## Superseding resumed-work receipt

Muhammed directed completion of retirement after the initial preparation checkpoint.
The work remains active. This phase has made no live mutations.
See [the latest receipt](verification/convex-retirement-resume-20261007.json) for current code hashes and evidence.

The two unresolved scope cases were importer errors and are fixed.
Three historical table scopes remain blocked by canonical checklist/audit differences.
The detailed review found 210 media checklist rows and 41 CSM checklist rows requiring preservation decisions.
The add-only statistics importer also encounters 87 extra booking records, in addition to the previously reported daily-statistics differences.
Original booking records lack provider IDs. Their original identities are now preserved by both Python and canonical SQL.
All 73,435 source booking identities are distinct after the correction. No data was applied.

The frontend Convex availability call is removed.
Four pure models moved into native owner modules without algorithm changes.
The existing native monitor view supplies the required keys. The guardian now consumes that actual contract and does not ignore failed optional provider checks.
Both media producer checks now use the existing 90-minute window.
The monitor still requires live schema installation and real producer evidence.

The current worker package has 128 files.
It includes all three original dependency manifest/lock scopes and the shared frequency module.
Offline dependency installs pass. Media, sync, and CEO doctors boot and correctly reject absent credentials.
The earlier 125-file package and the intermediate resumed packages are superseded.
No host installation or activation occurred.

The sealed live proposal imports 4,738 source records across 23 empty feeds and two history tables.
It preserves the other session's 7,091 imports and existing human data.
Its source plan SHA-256 is bd80bbf6df64d66c0433f134118e450bd74948fe89639a9e7d07aadb41e33d5c.
Approval for that specific live run is pending.
Production reports also need a verified internal folder. That server setting is currently absent.
All freeze, activation, authenticated acceptance, recovery, and deletion gates remain open.


## Approved source run verified: 2026-10-07 14:16 UTC

This receipt supersedes the approval-pending and zero-live-write statements above.
The approved 4,738 records match every planned identity and value in 23 feeds and two histories.
All 7,091 earlier imports remain unchanged. The original file readback matches.
Reporting and monitoring functions are installed with verified grants.
The monitor exposes unavailable worker and delivery prerequisites.
An existing timestamp comparison was fixed without changing stored business timestamps.
Failed requests were reconciled before retry. Native fences and target revision checks remain in force.
Protected proof: `D:/secure/cockpit-retirement-prep-20261007/approved-live-run/approved-backend-run-verification.json`.

The wider read-only inventory found 37 absent functions among 145 referenced functions.
These cover finance, goals, people, reviews, campaign builds, and team calendar actions.
Native EOD claim functions and the team calendar doctor function are also absent.
The host lacks Bun and all three native worker directories. SSH reads succeeded. Docker/admin access was denied.
Function presence does not prove behavior. Dynamic callers and deployed-source equivalence remain unverified.
Writer freeze, final delta, authenticated tests, recovery, and deletion requirements remain open.
No schedules, provider actions, report documents, frontend deployments, or deletions ran in this phase.
