# Supabase-Only Cockpit Completion Plan

> **For execution:** Follow this plan sequentially with `executing-plans`. Use Gemini for approved, bounded local edits. Keep credentials and live actions with the primary agent. Do not start implementation from planning approval alone.

**Goal:** Make every required cockpit journey and background job operate through Supabase without any runtime dependence on Convex.

**Architecture:** Preserve the running Supabase source/CEO release. Replace remaining active callers with existing server-gated native contracts. Supabase owns cockpit data, job state, access decisions, and audits. External providers remain source inputs. Convex deployments and protected history remain intact.

**Scope correction, 8 October 2026:** Muhammed wants the cockpit to rely 100% on Supabase. Convex deletion and account cleanup are excluded. Completion measures runtime independence, not infrastructure removal.

**Tech stack:** Supabase, TypeScript/Bun, Python, Hermes cron with flock, and Vercel.

**Spec:** `CONVEX-RETIREMENT-HANDOFF.md`, updated 8 October 2026 at 02:34 UTC. Use `docs/CONVEX-RETIREMENT-INVENTORY-20261007.md` for unresolved boundaries. Its earlier source/CEO status is superseded by the checkpoint.

## Global constraints

- Work in `D:/MaharaMedia/worktrees/mahara-cockpits-supabase-completion`.
- Preserve active release `5da4c4c1` until a verified replacement is approved.
- Write cockpit data only to Creative Triage `bldgtotkfmhoxmlzowdx`.
- Keep B2B `flwboeijllbtrufxkhts` read-only.
- Keep legacy deployments paused throughout acceptance.
- Preserve unrelated local and host edits. Do not reset or auto-stash them.
- Keep completed history imports closed. Reconcile only demonstrated missing deltas.
- Preserve human data, annotations, dates, checklists, and source provenance.
- Keep unavailable sources visibly stale or missing. Missing is never zero.
- Retain server role gates, audit rows, provider health receipts, RLS, and matching grants.
- Default mutation tools to dry-run. Show exact impact before live writes.
- Obtain explicit approval for each outward automation run and client-visible write.
- Do not delete Convex deployments, projects, data, accounts, or recovery assets.
- Keep exports and historical tools available for recovery and provenance.
- Retained historical or build-only Convex references are acceptable when runtime independence is proven.

## Review focus

1. Revoked or incorrect roles must fail before any write or provider call.
2. Provider outages must preserve data and show actionable warnings.
3. Expired leases and retries must not duplicate writes or outward actions.
4. Late files and human edits must survive final reconciliation.
5. Every required live read, save, job, and file journey must work without Convex endpoints.

## Task 1: Confirm the complete Supabase runtime boundary

**Records:** Update the existing inventory and retirement checkpoint after verification. Keep sanitized receipts under the existing protected evidence root.

- [ ] Read back the active native link, source/CEO schedule, and latest successful cycle.
- [ ] Read back the paused state of the three approved deployments.
- [ ] Inventory active frontend, gateway, worker, cron, skill, monitor, webhook, and provider-console callers.
- [ ] Inspect actual enabled host copies, including `/opt/data/skills/mahara` and the separate portal monitor.
- [ ] Classify each caller as native, requiring migration, inactive, or blocked. Record ownership and verification evidence.
- [ ] Record the authoritative Supabase data and execution owner for each required capability.

**Gate:** No unresolved active caller is silently omitted. Historical code references remain separate from runtime dependence.

## Task 2: Verify native data and files, then finish late deltas

**Inputs:** Existing frozen exports, file maps, history receipts, and guarded importers.

- [ ] Verify protected export integrity before any reconciliation.
- [ ] Compare required native records with preserved source identities, human fields, financial values, and relationships.
- [ ] Verify native file access and compare representative original bytes and SHA-256 values.
- [ ] Inventory late records and files against the frozen final exports and verified native mappings.
- [ ] Show a delta-only dry-run report with conflicts and exact proposed writes.
- [ ] After approval, verify one delta before expanding. Read back applied records and files.
- [ ] Document a native rollback procedure with an executable recovery check.

**Gate:** Required data and files are available through the native system. No unresolved critical delta or human-data conflict remains.

## Task 3: Finish remaining native workers and monitors

**Existing owners:** `hermes/cockpit-ask-ai`, `hermes/media-native`, `hermes/cockpit-guardian`, native report contracts, and the external portal monitor.

- [ ] Verify deployment and execution ownership for Ask AI, media actions, reports, billing, onboarding, and existing independent jobs.
- [ ] Replace stale enabled Ask AI helpers with existing native claim, result, health, and context contracts.
- [ ] Disable or reroute remaining legacy Meta helpers through the approved server-gated native actions.
- [ ] Verify report generation and publication behavior. Queue requests only when an operational consumer can fulfill them.
- [ ] Replace Convex-dependent guardian and portal checks with verified native health receipts.
- [ ] Verify independent watchdog credentials, schedule, and failure behavior.
- [ ] For each changed worker, run doctor, targeted tests, and a provider-safe dry run.
- [ ] Show the exact schedule and external effects before requesting activation approval.
- [ ] After approval, verify one work item before expansion. Test failure and retry without duplicate actions.
- [ ] Record audit, provider health, lease, and schedule receipts for every activated owner.

**Gate:** Every required production capability has a verified native owner. Removing a required feature needs an explicit scope decision.

## Task 4: Ship the remaining UI and complete business journeys

**Owners:** Existing creative stale-warning changes, `scripts/ship.sh`, and the five cockpit apps.

- [ ] Integrate the verified creative UI change through the normal main-branch release process.
- [ ] Preserve unrelated edits and run the checks required by that integration.
- [ ] Obtain production publishing approval. Ship with `scripts/ship.sh <app>` and verify the exact production source.
- [ ] Verify media buyer, client success, creative, editor, sales, portal, and CEO journeys where required by acceptance.
- [ ] Verify authorized saves survive refresh and a new session.
- [ ] Verify wrong roles and revoked users are rejected without side effects.
- [ ] Verify native file links, previews, and approved uploads with Convex unavailable.
- [ ] Capture browser, gateway, and worker traffic. Confirm no runtime request requires legacy Convex endpoints.
- [ ] Compare displayed figures against independent sources. Record exclusions and stale inputs.
- [ ] Resolve bank, portal, Meta form, and churn access gaps where access is available. Otherwise preserve their visible warnings.

**Gate:** Required journeys pass on the production candidate. Public entry bundles and build success alone are insufficient.

## Task 5: Certify Supabase-only operation and document one source of truth

**Owners:** `scripts/verify-cutover-readiness.py`, existing acceptance evidence, retirement checkpoint, and protected receipts.

- [ ] Run the relevant local tests, builds, and typechecks for the final candidate.
- [ ] Run `python scripts/verify-cutover-readiness.py --help` and use its current release-evidence contract.
- [ ] Bind fresh runtime-independence evidence to the exact final commit. Do not reuse ship-first approval as complete acceptance.
- [ ] Use the existing acceptance checks where applicable. Distinguish runtime-independence acceptance from destructive retirement authorization.
- [ ] Cover role gates, persisted saves, reconciled deltas, worker success/failure/retry, network independence, production configuration, and rollback.
- [ ] Require two consecutive successful source/CEO cycles on the final candidate.
- [ ] Require one verified scheduled run for each changed recurring owner. Longer-cadence jobs need an approved controlled run or their next scheduled run.
- [ ] Verify monitors detect a simulated native failure and distinguish expected source warnings from operational errors.
- [ ] Reconcile or quarantine queued legacy outward jobs. Do not resume paused deployments to inspect them.
- [ ] Run release verification without diagnostic skip flags and review every blocked category.
- [ ] Verify cockpit health and availability checks use native receipts rather than Convex probes.
- [ ] Remove active Convex endpoint configuration only where runtime use is proven. Preserve historical tools and build-only models.
- [ ] Update the existing checkpoint and canonical session note with authoritative data owners, active jobs, final evidence, and accepted source gaps.
- [ ] Sync canonical context only after its existing dirty work is safely integrated. Verify the remote commit before claiming synchronization.

**Completion:** All required cockpit reads, saves, files, background jobs, and health checks work with Convex inaccessible. Supabase is the authoritative cockpit backend. Convex remains intact. Source gaps are explicit, and no required runtime depends on Convex.

## Approval boundaries

Plan review authorizes only the planning artifact. Execution approval can authorize local investigation, implementation, tests, and dry runs. Production publishing, worker activation, outward test runs, and client-visible writes require their applicable explicit approvals. Prepare concrete diffs and evidence before requesting each live action. Convex deletion is outside this plan.

## Execution recommendation

Use one sequential owner in the existing worktree. Use Gemini only for bounded local edits with independent verification. Finish each gate before advancing. Update one existing checkpoint at verified boundaries.
