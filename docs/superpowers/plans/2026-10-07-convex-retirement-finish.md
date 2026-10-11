# Convex Retirement Completion Plan

> Execute this plan inline with `executing-plans`. Keep one owner for production writes and cutover. Local delegation may cover isolated code only.

**Goal:** Run the existing cockpits and their required background work through Supabase, preserve Convex history, prove independence, and retire verified legacy dependencies.

**Architecture:** Convex exports seed historical state. Native workers merge new or changed provider records into that state. A guarded cutover replaces confirmed legacy writers without replaying historical outward jobs.

**Stack:** Existing React cockpits, Supabase/PostgreSQL, Bun and Python workers, Hermes host, Vercel.

**Spec:** Muhammed's request to finish the migration with one owner and avoid unnecessary historical provider pulls. Use the current checkpoint in `D:/MaharaMedia/worktrees/mahara-cockpits-supabase-completion/CONVEX-RETIREMENT-HANDOFF.md`.

## Global constraints

- Work in `D:/MaharaMedia/worktrees/mahara-cockpits-supabase-completion`. Preserve dirty and untracked files. Do not restart from the dirty root checkout.
- Writes target Creative Triage `bldgtotkfmhoxmlzowdx`. B2B `flwboeijllbtrufxkhts` stays read-only.
- Preserve human notes, checkboxes, payments, original identities, timestamps, files, and audit history.
- Keep server access gates, matching RLS/grants, audit rows, leases, and provider-health evidence. Missing is never zero.
- Keep public editing for report folder `1YolkzE6ycBQT69hFa_iGUnDMiEMUCQ09`. Its exception stays folder-bound.
- Do not repeat settled choices or ask for general approval again. Check exact authorization for required live automation, outward actions, or irreversible operations.
- No redesign, new dashboard, generic sync framework, full repository cleanup, unrelated bank repair, or new compatibility layer.

## Verified starting point, 2026-10-07 around 18:40 UTC

- Both old sessions stopped. Their source work and repair commits are integrated.
- 11,829 reviewed source imports are present. Do not replay them.
- All 67 billing snapshots, three manual payments, and 118 aliases are verified. Imported financial history is reconciled.
- Checklist reconciliation retained 803 source rows and produced 561 canonical rows. Existing human states remain preserved.
- Missing database functions, EOD contract, report configuration, booking compatibility, and webinar reader were repaired.
- Growth passed a live read. Its previous 30-second deadline was shorter than the measured query runtime.
- A 136-file native package is installed in an isolated server release. Installation and doctors are not proof of complete operation.
- Fathom pacing/retry repair remains under review. Legacy writers remain active. Final cutover and recovery are unverified.

Evidence root: `D:/secure/cockpit-retirement-prep-20261007/consolidation-20261007/`. Recheck newer receipts before acting because the session may progress after this plan was written.

## Review focus

- A limited source read must not replace a complete feed or delete imported history.
- Equal IDs, retries, and changed records must preserve human fields and avoid duplicates.
- Pending or uncertain provider writes must not replay after migration.
- Stale source inputs must remain visibly stale, without false freshness or fabricated totals.
- Recovery must not require a running Convex deployment or surviving Convex file URL.

## Phase 1: Establish one current acceptance checklist

**Files:** Existing checkpoint, `docs/CONVEX-RETIREMENT-INVENTORY-20261007.md`, `scripts/verify-cutover-readiness.py`, and current receipts.

- [ ] Confirm no previous session or child is writing. Record current Git HEAD, dirty paths, active commands, and latest server release.
- [ ] Reuse the existing dependency inventory. Mark each required family as verified, pending, or blocked, with evidence.
- [ ] Cover source sync, CEO refresh, media actions, Ask AI, EOD, team/calendar, webinar/review helpers, gateways, and monitoring.
- [ ] For every pending item, record its native owner, actual failure, smallest next action, and pass condition.

**Pass:** One finite checklist exists. Already verified imports and repairs are closed. No second migration owner is active.

## Phase 2: Finish source updates without replaying history

**Files:** `hermes/cockpit-sync/csmProviders.ts`, `csmProducer.ts`, `transport.ts`, existing transport tests, and `scripts/native-feed.test.ts`.

- [ ] Finish the existing Fathom pacing/retry fix. Serialize actual requests, not only delays. Release the queue after errors. Recheck cached responses after waiting.
- [ ] Replace the unconditional 90-day validation fetch with a bounded recent-update read derived from verified coverage metadata.
- [ ] Preserve old calls through the existing merge. Do not use meeting start time as a provider creation watermark.
- [ ] Advance a durable checkpoint only after successful complete collection and publication. Include overlap for late arrivals and retries.
- [ ] If no trustworthy checkpoint exists, name the coverage uncertainty. Use a bounded validation read without claiming complete coverage or silently excluding older changes.
- [ ] Fetch older provider records only for a specific demonstrated gap in the Convex export. Record the scope and reason first.
- [ ] Verify these cases: old calls survive, duplicate replay creates no duplicate, recent updates arrive, human briefs survive, pagination failure preserves prior data, and a failed run does not advance the checkpoint.

**Pass:** A bounded live source read works, and publication/readback preserves existing state. Never label a narrow subset as a complete replacement feed. A dry run alone does not pass this phase.

## Phase 3: Prove the required workers and resolve genuine blockers

**Files:** Existing native worker modules and runbooks, package builder, and staged runtime evidence.

- [ ] Test the actual staged release, including Google authentication dependencies and named credentials. Preserve the host's 84 unrelated dirty paths.
- [ ] Verify one scoped source update and one CEO refresh with successful readback, truthful freshness, and no lost history.
- [ ] Exercise required queues through existing tests or rollback-safe fixtures. Verify access, claim, lease, audit, retry, and receipt behavior.
- [ ] Validate provider connections using bounded read-only calls. Do not send customer messages, launch campaigns, or invite people merely to prove connectivity.
- [ ] Separate missing native functionality from pre-existing stale bank or portal inputs. Preserve prior values and disclose their dates. Do not reset readiness falsely.
- [ ] Fix a stale input only when it prevents a required native contract from operating safely or still depends on Convex.
- [ ] Stop repeating an identical failed request after diagnosis. Change the identified cause before retrying. Run targeted checks during repairs.

**Pass:** Every required dependency has verified native behavior or an explicit existing-source limitation that the native contract handles safely. No unexplained worker failure is hidden.

## Phase 4: Prepare one cutover candidate and recovery proof

**Files:** Existing checkpoint, dependency inventory, worker package, `scripts/ship.sh`, cutover verification scripts, and protected exports.

- [ ] Review the integrated candidate. Run the required full release gate once after integration, then follow `scripts/ship.sh` requirements.
- [ ] Stage native schedules disabled. Record exactly which legacy job, bridge, monitor, webhook, or helper each replaces.
- [ ] Verify database/storage recovery in an isolated fixture using protected exports, original-byte hashes, identity mappings, and quarantine rules.
- [ ] Prepare an explicit rollback map. Retain historical recovery artifacts and exact prior runtime/schedule configuration.

**Pass:** One candidate passes release checks. Recovery works without calling Convex. Every planned shutdown has an identified replacement and rollback path.

## Phase 5: Execute the controlled switch

- [ ] Freeze only confirmed legacy writers and mutation entry points. Do not blanket-stop cron or unrelated editor, sales, or personal systems.
- [ ] Drain or reconcile in-flight provider actions. Quarantine historical outward jobs and uncertain outcomes. Never replay imported notifications or calendar invites.
- [ ] Capture final Convex exports and files after the freeze. Confirm the freeze holds while collecting them.
- [ ] Apply only verified final differences through guarded batches. Compare identities, original bytes, human fields, and audits. Counts alone are insufficient.
- [ ] Publish the verified cockpit source through `scripts/ship.sh`. Confirm the actual public domains serve the candidate.
- [ ] Confirm the exact activation scope is authorized. Activate one native writer per provider, with leases and `flock`. Record a successful scheduled cycle and a successful retry without duplicate effects.

**Pass:** Final changes are reconciled, native schedules operate, and confirmed legacy writers remain stopped. There are no competing writers.

## Phase 6: Prove independence and finish

- [ ] Block Convex traffic during acceptance. Verify login, permissions, revocation, durable saves/refreshes, original files, and representative business journeys.
- [ ] Verify workers and monitors continue without Convex. Inspect any remaining runtime caller rather than deleting directories by name.
- [ ] Test recovery with original Convex deployments unavailable. Keep exports, imported original records, and file evidence.
- [ ] Delete only verified legacy targets after recovery passes and deletion authorization is established. Do not delete an unrelated deployment.
- [ ] Update the existing checkpoint, runbook, and canonical context session note. Report evidence and remaining limitations.

**Completion statement:** Report separately: Supabase operation verified, legacy writers disabled, and Convex deployments deleted. Do not call full retirement complete while a required gate remains open.

## Execution discipline

Use one checklist and one checkpoint. Give short updates when a gate passes or a new measured failure changes the next action. Do not invent percentages or finish times. Do not rerun completed imports or full suites without a changed dependency. If a gate fails, report its exact cause and continue independent work that cannot corrupt data.
