# Supabase Cockpit Completion Implementation Plan

> **For agentic workers:** Use executing-plans for the integration owner; independent domain packets may execute concurrently. Do not build, lint, test, format, commit, or deploy mid-flight. The integration owner runs verification after assembly.

**Goal:** Finish the existing migration, preserve current main's features, and release all five cockpits plus portal/CEO/admin with Supabase-owned auth/data/jobs and no runtime Convex dependency.

**Architecture:** Reuse migration commit `2b262f6` and merge fetched main `5f08b5f` in a fresh worktree. Creative Triage Supabase `bldgtotkfmhoxmlzowdx` owns cockpit state and authorization. B2B `flwboeijllbtrufxkhts` remains read-only. Existing Edge Functions and bounded VPS workers replace Convex's actual provider calls, schedules, and outboxes.

**Tech Stack:** Vite/React/TypeScript, Supabase Auth/PostgreSQL/RLS/RPC/Edge Functions, Bun, Python and existing Hermes VPS workers.

**Spec:** Existing `MIGRATION-TO-100-PERCENT.md`, `docs/CUTOVER-ACCEPTANCE.md`, and this conversation's instruction to finish and implement. Historical status statements in those documents require current evidence; their behavioral acceptance criteria remain binding.

## Global Constraints
- Preserve dirty root/original migration worktrees; no reset, stash, overwrite, or undocumented deletion.
- Retain current Sales contracts/payment plans, guardian, CSM churn/projections, CEO cost/next-month calculations, ad ranges/logos, and team/calendar/document changes.
- No ongoing shadow copying or dual live writers. Use finite baseline/final-delta reconciliation.
- Gate every server operation by verified active membership, role/client scope, and founder-only CEO policy where applicable; grants accompany RLS; audit accepted writes.
- Keep service credentials outside browser bundles/Git/logs. Do not send client messages or trigger campaigns to test migration.
- Reuse current UI. No redesign or changed Arabic copy is required.
- Source scans/builds are not runtime proof. Evidence records only observed behavior; missing is not zero.
- Disable old writers only during a rehearsed coordinated cutover with recoverable snapshots; do not delete deployments before independence proof.

## Review Focus
1. Revoked user, wrong role, wrong client, and non-founder admin must be denied by server, not only route guards.
2. Newer edits/deletions and financial/EOD history must survive final import without overwrite or duplicate outward delivery.
3. Provider success followed by timeout/retry must not duplicate campaigns, payments, or messages.
4. Switching accounts must not expose cached previous-owner data or reusable credentials in URLs.
5. New main features must continue to work without resurrected Convex imports, calls, or stale read models.

## Task 1: Reconcile exact release source
**Files:** Eight conflicted files under CSM sidebar/page, media buyer CockpitPage, CEO goalsNext, and team MeetingPage/TeamPage/WhenAndWho/teamKit; auto-merged routes, helpers, migrations and workers.
**Interfaces:** Preserve existing native Supabase client signatures and current main's consumer behavior. Integration owner controls git/index/commits.
- [ ] Record fetched main, migration SHA, live bundle/config and credential availability without exposing values.
- [ ] Integrate CSM churn/projections and sidebar onto native Supabase authorization/data paths.
- [ ] Integrate team document/calendar improvements onto native team RPCs with matching server permissions/audits.
- [ ] Integrate CEO cost/next-month goals and MB ad-range/logo features onto native reads/actions.
- [ ] Inspect auto-merged active consumers for missing native endpoints and reconcile them, not just conflict markers.
- [ ] Install/link existing project dependencies, run shared-source check, five app/node typechecks and focused contracts once after assembly. Observe all five actual preview surfaces.

## Task 2: Complete real backend contracts and migration data
**Files:** `apps/*/src/lib/*`, `apps/*/src/auth/*`, `supabase/functions/cockpit-*-api/*`, `supabase/migrations/*`, `scripts/import-snapshot-data.py`, `scripts/import-media-statistics.py`, existing finance planner.
**Interfaces:** Frontend commands call existing audited RPCs/authorized Edge Function routes; workers use service-only contracts. Preserve actual request/response types and original source IDs.
- [ ] Inventory every reachable dispatcher path, native RPC, Edge Function, storage link and webhook against source and live catalog.
- [ ] For an observed behavior defect, reproduce on isolated fixtures, add a consumer-visible regression where useful, implement minimal fix and verify after assembly.
- [ ] Complete unknown/unavailable domains with real implementations; remove obsolete no-op clients/aliases after migrating callers. Do not replace missing metrics with zero or success-shaped objects.
- [ ] Read live target schema/grants/function deployments and compare with ordered migrations; run missing migrations against disposable PostgreSQL/PGlite before production application.
- [ ] Export fresh source and target snapshots privately. Default dry-run import, compare stable source IDs/content/deletions/files, validate one representative record, then apply bounded import and read back.
- [ ] Recompute financial/read-model totals from reconciled facts before showing ready. Preserve ownership and personal EOD semantics; never auto-deliver imported history.

## Task 3: Native workers and production preparation
**Files:** `hermes/cockpit-sync/*`, `hermes/cockpit-ask-ai/*`, `hermes/eod-out/*`, existing team-sync/sales/guardian/watchdog runtimes, `scripts/ship.sh`, `scripts/verify-cutover-readiness.py`, deployment/runbook configuration.
**Interfaces:** One active owner per job/outbox. Service claims are atomic and fenced; provider calls land in health ledger. Doctor is read-only, missing prerequisites are explicit.
- [ ] Establish actual VPS access using existing authenticated configuration; inspect cron/process/key names without exposing values.
- [ ] Map every live Convex schedule/webhook/provider action to an implemented native replacement and reconcile newly added guardian contracts.
- [ ] Prove success/failure/retry/lease behavior in isolated fixtures; verify actual worker doctor and harmless read path on intended host.
- [ ] Install/configure native workers paused; prepare exact old/new writer switch and rollback. No outward test sends to real customers.
- [ ] Make shipping preflight run before promotion; Supabase-only release must not deploy Convex. Separate preview readiness from post-release SHA evidence so gates are not circular.

## Task 4: Preview acceptance and release
**Files:** Actual acceptance artifacts outside Git for private data; sanitized records in `docs/verification/`, `RUNBOOK.md`, `supabase/MIGRATION_RUNBOOK.md`.
**Interfaces:** Exact candidate SHA/config, five cockpit paths on one origin, authenticated journeys and server denial evidence.
- [ ] Run one assembled local verification pass, existing contract/domain suites and actual browser previews with Convex blocked.
- [ ] Exercise permitted reads/reversible saves/full refresh, wrong-role/client/revoked/founder-only rejection, sign-in/recovery/session refresh/cockpit switching, previews/reviews/storage, and worker read-model updates.
- [ ] Have a fresh reviewer inspect the integrated branch, security boundaries, data transformations and release procedure; fix actionable defects and smoke changed paths.
- [ ] Freeze writes for final bounded reconciliation; snapshot, stop old writers, catch up changes/deletions, apply verified native schema/config, activate replacements, deploy coordinated frontends and verify actual production SHA/behavior.
- [ ] Merge/push verified source to main without altering dirty user checkout; use `scripts/ship.sh` for release, retain rollback assets.
- [ ] Verify browser/server/worker independence, durable audited saves, fresh feeds and real schedules; disable/remove obsolete runtime credentials/callers only after proof.
- [ ] Record sanitized release evidence and session under mahara-context `shared/sessions/`; report exact URLs/SHA, exercised checks and any unreachable prerequisites.

## Execution record
- 2026-10-04: fetched main `5f08b5f`; clean migration assembly `2b262f6`; live portal bundle `index-vKmmCscA.js` contains `https://adorable-seahorse-418.convex.cloud` and no Supabase Auth signal in that entry bundle.
- Fresh workspace: `D:/MaharaMedia/worktrees/mahara-cockpits-supabase-completion`, branch `codex/supabase-completion-20261004`.
- Eight merge-content conflicts are resolved and the affected index entries are staged. Original workspaces remain untouched.
- Ruling: execute the existing approved architecture and this requested completion plan now; do not repeat speculative claims from prior replies or insert another approval loop for local implementation.
- Execution routing: all previous default-model agents stopped at the user's instruction. Local implementation now uses Gemini 3.8 through the headless runner; Codex supervises, reviews and verifies. No automatic model substitution.
- First Gemini task: isolated sanitized snapshot, `gemini-3.8-flash-low`; reviewed native dispatcher routing for CEO costs/pay and team pictures/links. One correction removed an unnecessary unavailable projections branch. Corrected changes integrated only into the fresh assembly.
- Supporting verification: 38 costs/goals/people tests passed with 295 assertions. Disposable native-client/PostgreSQL smoke preserved the note, persisted three seats at USD 81, kept missing statements null, denied an ordinary admin, and recorded INSERT/UPDATE audits. No production writes or deployment.
- Application compiler repairs are integrated. Actual `tsconfig.app.json` compilation passed in all five cockpits; references-only root `tsc --noEmit` is not this evidence.
- Native meeting projections are integrated through `teamProjectionsClient.ts` and the existing dispatcher. The canonical PostgreSQL suite passes 7 tests/45 assertions. A disposable native-client smoke persisted renewal blood/stretch 4/8, read the same model back, recorded the correct actor audit, and denied access after revocation. SQL repairs remove an ambiguous email local, parenthesize range validation, and read the canonical profile `kpi` column.
- Shared-source enforcement passed. The assembled Supabase Edge suite passes 258 tests/775 assertions. Neither result proves production deployment or authenticated five-cockpit acceptance.
- Gemini native feed publication is rejected: an actual canonical-schema smoke fails on nonexistent `cockpit_media_sources.id`; the producer test cannot load its imported Convex generated server. Gemini media queue work is rejected: the application compiler reports an unused import, and real PostgreSQL reports `alreadyCommitted: true` for an intent with zero confirmed provider receipts. These isolated candidate changes are not in the assembly.
- Identity work remains unaccepted: the canonical audit trigger produces the correct seed INSERT plus adoption UPDATE, but two submitted tests miscount them; editor/sales still use metadata roles, and auth fault/race behavior needs correction.
- Gemini correction attempt stopped with `429 RESOURCE_EXHAUSTED` (individual provider quota; reported reset 2h34m39s). No alternate implementation model started. Saved candidates and exact correction findings are retained outside Git in `D:/MaharaMedia/worktrees/gemini-native-workers-review-20261004.json`.
- Production release is still blocked: both available GitHub credentials have `push: false`, Vercel authorization is absent, and Hermes SSH authentication is denied. Source catch-up is partial coverage only. No production schema/data changes, activation, deployment, merge into main, or Convex retirement occurred.
- Actual local sign-in and recovery/email-code forms rendered in all five cockpits with Convex hosts blocked and zero runtime errors. Editor/sales used the existing portal-down fallback; only its UX bounce timestamp was set. Visual screenshots were inspected. No credentials, accounts, emails, authenticated business journeys or production behavior were exercised. Evidence: `D:/MaharaMedia/worktrees/cockpit-native-preview-proof-20261004.json`.
- Removed the encountered mocked auth lookup/filter-forwarding test; retained the consumer-visible confirmed-link, revocation, founder and delegated-admin identity cases. Identity RPC/bootstrap work is still unaccepted.
- User continuation: use Luna Max. Runtime registry resolves Luna Max as `openai-codex/gpt-6-luna:max`; three independent correction agents resume the retained native-feed, media-queue and identity candidates. No accepted code is reimplemented. Each agent owns a separate candidate; the parent retains central dispatcher/shared-file integration and all verification. Production access blockers are unchanged.
- Ruling: extend the native-feed owner to the missing finite runtime-source importer — existing tests reference an absent implementation and canonical feed bootstrap requires it. Reuse core domain mappings; verify or block financial/EOD/history coverage rather than copying those records into source JSON. Cost if wrong: additional importer/schema correction before any live apply.
- Ruling: permit an additive calendar command repair — current unlink/delete semantics lose request receipts and allow uncertain retries to replace newer bindings. Durable receipts, retained revision/tombstones and first-intent revision CAS must prevent replay/rebasing; the historical base migration stays unchanged. Cost if wrong: calendar contract rework before activation.
- Parent removed the unreferenced no-op `ConvexReactClient` constructor and unused `useConvexAuth` facade export. Production source reference search found no callers; native query/auth APIs are unchanged.
- Luna identity candidate: all five application compilers passed and the canonical suite passes 29 tests/100 assertions after correcting a reproduced Bun rejection-matcher gate deadlock. A real isolated PostgreSQL 17.10 UTF8 smoke observed three row-lock waits, denied concurrently revoked adoption, serialized confirmation change, denied unconfirmed access, and recorded one correctly attributed adoption audit with read-only repeats. Not integrated: fresh review requires same-actor refresh draft preservation and verified founder Sales admission.
- Luna media candidate: application compilation passed. Initial canonical suite ran 7 passed/30 failed at an unparenthesized CASE predicate; a real PostgreSQL minimal probe reproduced the parser failure and proved parentheses resolve it. Grammar/teardown corrections are saved. Fresh review requires duplicate-name winner ownership isolation, request-specific acknowledgement cleanup, and safe retirement of definitively rejected calendar CAS intents. No candidate is promoted on compilation alone.
- User requires completion and permits only Luna Max delegation. Generic task/reviewer dispatch is no longer used. A run-local direct RPC supervisor verifies `provider=openai-codex`, `id=gpt-6-luna`, `thinkingLevel=max` before admitting a work prompt, disables fallback/prewalk/advisors, and aborts on a different actual assistant model. Proof: `D:/MaharaMedia/worktrees/luna-runtime-model-proof-20261004.json`. Global/project settings are unchanged.
- Verified media queue is now integrated, including its scoped client/dispatcher, additive SQL, worker/providers/doctor/flock launcher, independent smoke and behavioral tests. Assembly verification: application compiler passed; canonical suite 40 passed/168 assertions; independent worker smoke observed receipt-backed send, real human reply ingestion, uncertain-send reconciliation, zero duplicate POSTs, actor audits/failure health, and dry-run audit delta zero. Standalone pinned SDK package/lock added; no frontend dependency junction required for the worker.
- Retained identity/editor, canonical feed/bootstrap/import and CEO provider candidates are now integrated after the corrections and verification below; their earlier rejection records remain historical.
- Latest user continuation permits Gemini again. Gemini completed the read-only dirty-assembly review and one focused Sales correction review with zero findings. The isolated browser-bridge implementation then failed with individual quota reached and zero changed files. The parent recorded scoped fallback and continued locally; no default/Astra agents or replacement models ran.
- Native identity is integrated across all five exact shared modules: self-only confirmed adoption, mandatory RPCs, verified founder admission, actor generations, account-switch cancellation and same-actor refresh retention. The real editor gate uses the directory, personal EOD uses its actual author, blank/unowned legacy history stays shared, and authenticated inserts plus worker transitions/deletes are audited.
- Canonical Sales smoke reproduced a stale legacy manager retaining seat/manager after native membership revocation. Staged `20261004a` now binds confirmed active exact directory/Auth identity and requires native Sales admission before evaluating manager subroles. The combined identity/editor/Sales suite passes 52 tests/178 assertions.
- Native feeds and CSM producers use actual provider inputs and atomic canonical source/statistics publication with count/hash/stamp/whole-inventory CAS, leases, ownership guards and failure receipts. The finite importer defaults to private dry-run, preserves human/native edits, quarantines pending work, invalidates old sessions and requires verified file maps. An actual assembled SQL/native-client smoke published spend/leads, preserved a human note and verified fencing/rollback/audit. No live providers or target writes ran.
- CEO frequency, ad/content windows and Workspace provider contracts are integrated. Real canonical PostgreSQL smoke verifies founder-only imports, ordinary-admin denial, source-error propagation, pay/history preservation, atomic idempotent receipts and audits. Client request IDs and before/after actor checks prevent cross-account results.
- Fresh serial app/node compilers and production Vite builds pass for all five apps. The real browser smoke then exposed the editor's host-offset error near Kuwait midnight; both form/sidebar now reuse one UTC+3 filing-day helper. Four deterministic midnight/year/leap-day regressions and the editor's fresh app/node/build pass after correction.
- Actual editor App/EodPage and Sales Shell browser smoke passes against canonical PostgreSQL/RLS with synthetic local external Auth transport: peer/unowned EOD isolation, peer filed state, retained draft/same DOM through TOKEN_REFRESHED/SIGNED_IN with access delayed, roleless verified founder admission and metadata-spoof denial. Visual proof: `D:/MaharaMedia/worktrees/cockpit-native-editor-eod-20261005.png`. This is not production GoTrue or authenticated save proof across every cockpit.
- Expanded canonical offline manifest: 421 passed, zero failed, 2,057 assertions in 39 files. All Edge function suites: 272 passed, zero failed, 838 assertions in 25 files. Full Python suites passed 111 tests before removing the obsolete ship mock-echo suite; the finite importer subset passes 22. Shared-source enforcement passes.
- Actual fresh private archive smoke reproduced rejection of Convex `_tables` catalog rows (`name`/numeric `id`, not document `_id`). The importer now validates the exact catalog separately without inventing business IDs. Three unchanged archives validate their SHA-256, 148 table inventories and 97,384 non-catalog rows. Coverage remains blocked on 65 unclassified tables, including financial/user/history records and files. Evidence: `D:/MaharaMedia/worktrees/cockpit-source-coverage-20261005.json`.
- Native shipping no longer deploys Convex or selects it from a flag; it compiles app/node configs and always uses the native build. Obsolete Convex CLI/package test entries, no-op facade and obsolete auth/dispatcher/webinar-action/mock-echo suites are removed. Real shipping preflight exposed Windows Python aliases and CRLF-only false immutable-schedule drift; installed Python is selected consistently, and line-ending comparison preserves actual revision/data immutability. All 12 schedule tests and actual read-only schedule CLI pass; the actual ship program completes its offline preflight and rejects an invalid target before any deployment.
- Local verification evidence: `D:/MaharaMedia/worktrees/cockpit-integrated-verification-20261005.json`. No clean-source release acceptance bundle exists. Remaining gates: native ownership/retention classification and financial/history/file reconciliation, durable saves/authenticated journeys across every surface, real worker schedules/provider completion, production source/config/SHA and rollback proof.
- Production blockers remain ground truth: GitHub push rights absent, Vercel authorization absent, Hermes SSH denied. No production schema/data writes, live automation activation, publish/deployment, main push or Convex retirement occurred. Do not release partial source coverage or mark missing values as zero.
- Historical chat records contain no verified author; their sender roles are `user`/`assistant`. Muhammed subsequently said their treatment is not important. Preserve the protected source archives; do not invent owners, replay jobs, or build a separate history feature.
- Post-retirement full Python verification passes 108 tests; final local evidence also records the 12 schedule tests and actual safe shipping CLI preflight.

## Legacy chat retention ruling, 2026-10-05

- User: "yes, either way it doesn't matter that much."
- Ruling: retain old `hermesChat` messages in the unchanged protected backups,
  rather than add native history tables/RPCs/UI. New privately owned Ask AI chat
  remains unchanged. This removes the unnecessary architecture/review gate.
- Verified baseline: 33 Media Buyer messages, five CSM messages, zero Creative
  messages. Archive SHA-256, exact table counts and stable source IDs remain in
  the finite source manifest. Final capture must retain subsequent source changes.
- Cost if wrong: old conversations are not visible in the new chat interface,
  but their complete original records remain available for recovery.
- This explicit chat exclusion does not cover financial records, staff choices,
  reports, attachments or other required business history. Reconcile those
  against their canonical native domains; do not silently archive user data.

## Verified continuation, 2026-10-05

- Retained CEO worker code is integrated locally. Actual finance smoke reproduced missing owning-section metadata and absent historical metric definitions. Both contracts are corrected without relaxing SQL validation.
- `bun run smoke` in `hermes/ceo-refresh` now proves dry-run writes nothing, atomic canonical money/expenses publication, exact independent source amounts, repeat preservation and provider-outage preservation. Native monitor reads the actual worker ledger and rejects matching revisions when history reconciliation is missing. External transport is synthetic; production providers and other CEO sections remain unverified.
- Standalone worker bundling passes across 65 modules. Actual doctor refuses absent credentials and lists reconciliation prerequisites without external calls. The launcher remains dry-run by default under `flock`. No worker was activated.
- Original audit mapping now preserves recorded authors, entity IDs, before/after values, original timestamps and complete source records. Real canonical SQL proves repeated imports preserve one original audit and reject update/delete. Audits are append-only, including when a later source snapshot omits them.
- Native bootstrap suite: 17 passed, zero failed, 123 assertions. Finite importer suite: 29 passed, zero failed. Fresh Media Buyer app/node compilers pass.
- Fresh protected exports verify exact catalogs, archive SHA-256 and every storage-file SHA-256: Media Buyer 95,462 business rows, CSM 4,872 and Creative 884. Each archive has 331 storage records and files. Capture times come from actual snapshot timestamps, not report-generation time.
- Actual fresh-source mapping validates all 37 audits, 3 staff choices, 3,653 historical metrics, 67 client billing records and 2 plans. Billing preserves zero versus missing, manually entered LTV, closed lifecycle states and original source records. Real SQL protects a newer native billing value and denies anonymous reads. Legacy relative plan dates resolve from their original day. The current Media Buyer save submits tomorrow's ISO Kuwait date rather than a literal that PostgreSQL rejects.
- Evidence: `D:/secure/cockpit-fresh-source-manifest-20261005.json` and `D:/secure/cockpit-fresh-source-classification-20261005.json`. Files remain protected, not copied into the repository.
- Release remains blocked: 55 source contracts are still unclassified, including storage ownership, calendars, call briefs and WhatsApp drafts. Authenticated save/browser coverage across all surfaces, workers and admin monitoring remain open. Native previews have the local proof below, not production acceptance. The archives are not a write freeze. Existing production access blockers are unchanged.

## Native preview proof, 2026-10-05

- User permits Gemini execution but forbids Astra. Two bounded Gemini 3.8 tasks used sanitized current-source capsules. Both returned provider quota failures, zero edits and safe parent fallback. No Astra or substitute model ran. Exact fallback manifests are under `D:/MaharaMedia/worktrees/gemini-native-{preview,calendar}-20261005-report/`.
- Native previews now use the existing media Edge gateway and receipt helpers. Staged `20261005c_cockpit_ad_previews.sql` enforces confirmed active directory identity, client ownership, existing global-winner access, protected 20-hour cache entries and URL-free actor audits. Provider ad/account/campaign mismatches and unsafe iframe URLs are rejected.
- All three existing preview components retain their own layouts. Requests, pending results and dialog identity are actor-bound. Every opening rechecks server authorization, including cache hits. Old unauthenticated stored-link shortcuts and their media caller props are removed.
- Canonical SQL/provider boundary suites: 8 passed, zero failed, 44 assertions. Fresh app/node compilers pass for Media Buyer, CSM and Creative.
- Actual gateway/installed-SDK HTTP smoke passes with canonical PostgreSQL/RLS: authorized cache reuse, forged-client denial, metadata-spoof denial, revocation during provider reads and sanitized receipts. External Auth and Meta transport are synthetic. Production GoTrue, Meta access and deployment remain unverified.
- Actual rendered components pass in all three apps: authorized native iframe, account-switch removal of the prior iframe and actionable client denial. Visual proof: `D:/MaharaMedia/worktrees/cockpit-native-preview-ui-20261005.png`. Evidence: `D:/MaharaMedia/worktrees/cockpit-native-preview-verification-20261005.json`.
- Browser transport exposed fixture-only CORS, streaming-body and REST-error-shape errors. The local bridge now mirrors Auth headers and PostgREST errors; browser forwarding buffers request bodies for HTTP/1. Temporary HTML fixtures are removed. Owned tabs and four preview services are stopped.
- Next local work at this boundary: client/shared calendars, durable CSM history and call briefs, source/file reconciliation, native admin monitoring and full authenticated save coverage. Admin read monitoring has since reached the local proof below. No live schema/data import, worker activation, source/main commit, deployment or Convex retirement occurred.

## Native admin proof, 2026-10-05

- Gemini 3.8 produced admin, calendar and CSM candidates in isolated sanitized capsules. Parent review rejected unsafe calendar permissions and partial-success providers. The CSM candidate declared seven durable domains without implementing their nonempty mappers; all seven probes failed. Its one focused correction completed. Parent then corrected provenance, audit, owner, timestamp and brief-precedence defects using real canonical SQL. No Astra or substitute model was used.
- The admin candidate allowed founders without active directory seats and invented failure streaks, cron cadence and healthy/zero states. Parent replaced its backend with `20261005e_cockpit_native_admin.sql`, using actual `cockpit_get_my_access` and native ledgers. No synthetic successes or metadata-based privileges were promoted.
- Native admin now reads an atomic, validated directory/health/count/audit overview. Missing client catalogs, live status, timestamps and durations stay unavailable. Worker freshness is separate from unverified host schedules. Native member sales subroles, presence, notes and confirmation state are retained.
- Parent also fixed a reproduced monitor contract mismatch: canonical CSM receipts have no provider column. Monitor reads now use actual row metadata without fabricating that column or a success.
- Canonical admin suite: six passed, zero failed, 26 assertions. Media Buyer app/node compilers passed. Actual HTTP/installed-SDK smoke proves ordinary staff denial, revoked-founder denial and truthful missing-source reads with real canonical SQL/RLS.
- Actual AdminPage proof: directory and audit summaries render; unknown counts stay unavailable; same-actor sign-in retains the member draft; switching actors closes the private dialog, clears the prior directory and shows the server denial. External Auth is synthetic, not production GoTrue.
- Evidence: `D:/MaharaMedia/worktrees/cockpit-native-admin-verification-20261005.json` and `D:/MaharaMedia/worktrees/cockpit-native-admin-ui-20261005.png`. Temporary HTML is removed; owned tab and two admin services are stopped.
- This verifies admin reads and draft isolation, not a production release or every native save. Client calendars, CSM history/briefs, WhatsApp preservation/send contracts, source/file reconciliation and full five-app save/worker acceptance remain open.

## Native CSM history and brief proof, 2026-10-05

- The finite importer now maps client preferences, hot rows, loose dismissals, private money goals, weekly projections, renewal cycles and completed call briefs into canonical typed tables. Original records, recorded authors, timestamps, missing values, real zeroes, prior cycles and human annotations remain intact. Missing private owners and ambiguous identities fail closed.
- Staged `20261005f_cockpit_csm_history.sql` reuses the actual CSM audit trigger and confirmed-directory identity resolver. Service grants match row security. Browser reads use existing CSM roles and client assignments. No source-JSON cache replaces these business tables.
- Canonical native-feed/provider suite: 18 passed, zero failed, 143 assertions. Finite-importer suite: 37 passed, zero failed. Provider publication retains original overall and per-call annotations before generated briefs. Repeated imports preserve existing values; newer native edits block replacement.
- Actual protected-archive smoke imported all 19 completed briefs and 33 per-call annotations into isolated canonical PostgreSQL. Every original paragraph, annotation, source record and timestamp matches. Unassigned-client reads return no records. Repeated values remain unchanged, and a newer native annotation blocks replacement. Live writes: zero.
- The fresh source exposed a retired client missing from current directory rosters. Its original typed campaign preserves the exact client identity. The importer now resolves that recorded historical subject without guessing aliases or using campaign display names. This does not broaden client access.
- Evidence: `D:/MaharaMedia/worktrees/cockpit-native-history-verification-20261005.json`. External-provider transports remain synthetic. No live schema/import, deployment, worker activation or Convex retirement occurred. Full five-app saves, calendars, WhatsApp, source/file reconciliation and release acceptance remain open.

## Native calendar backend proof, 2026-10-05

- Parent rejected the unsafe retained calendar candidate. Its correction limit is exhausted. Separate sanitized WhatsApp and file-planner Gemini 3.8 jobs stopped safely after provider 503 errors with no edits. No Astra or substitute model ran. Exact manifests are under `gemini-native-{whatsapp,files}-20261005-report/`.
- Existing personal-calendar records, bindings, receipts and worker fences now include the cockpit app. A CSM-only seat can connect without Media Buyer access. One actor retains independent app choices and revisions. Lost acknowledgements, unlink tombstones, definitive CAS rejection and receipt reconciliation remain intact. Ownership revocation hides cached meetings.
- The worker reads the original seven-day-back, twenty-one-day-ahead Google window through every page. It retains original all-day dates and requires real end times. Missing collections, sharing denial, malformed dates, conflicting event IDs and repeated cursors cannot become healthy empty calendars. Today's native SQL projection includes overnight and multi-day meetings.
- Shared reads reuse immutable fenced native publications. GHL calendars come from the existing CSM producer, with real calendar IDs, end times, UTC+3 filing days, verified window metadata and exact provider event IDs. Explicit per-app Google IDs use the existing named-key read transport and its real receipt ledger. Credential identity must match the database configuration. Partial providers block publication.
- Original app distribution is retained: CSM sees shared client calendars; Creative sees GHL Brand Blueprint calendars plus its explicitly configured Google calendars; Media Buyer sees no shared client calls. Current roles and client scope gate every read. Unknown, missing, stale, changed and explicitly empty source states remain distinct.
- Verification: native media 46 passed, zero failed, 195 assertions; calendar SQL four passed/22 assertions; shared Google transport three passed/eight assertions; native feed 18 passed/143 assertions. All three app/node compilers pass.
- Actual standalone worker/installed-SDK smoke confirms CSM app identity, three window events across two pages, correct today's view, wrong-role denial and receipt reuse without relinking. Provider HTTP and Auth are synthetic; global external network access is blocked. This is not production acceptance.
- Remaining at this boundary: replace fabricated comms calendars in existing pages, migrate the two original saved calendar choices, verify actual rendered calendar surfaces, replace fabricated WhatsApp sends, reconcile remaining source/file ownership, and complete all five-app save/runtime coverage. No live schema/import, worker activation, deployment or Convex retirement occurred.

## Local merge completion, 2026-10-06

- User requests cleanup, a clean merge commit, exact-source acceptance evidence and the local readiness command. The user reports all 43 suites and all five Vite builds green. No Astra agents are permitted. No delegation or production write runs during this completion step.
- Existing comms pages now use native calendar and WhatsApp contracts. Actual CSM UI proof retained same-actor draft edits, removed private editors after an account switch, saved and disconnected a real calendar intent, and displayed submitted replies without claiming delivery. Creative showed its Blueprint calendar and an explicit unconnected WhatsApp desk. Media Buyer did not borrow CSM messages. External Auth and provider transport were synthetic.
- Three added SQL regressions exercise late delivery, draft CAS and atomic thread publication. The publication regression exposed an ambiguous `last_at` variable. Its explicit local variable now passes all three cases. Doctor exits safely with missing named configuration. This is not live worker acceptance.
- Temporary HTML, browser bridges, standalone smoke drivers and disposable SQL probes are removed. Permanent domain/access regression suites and their canonical database helpers remain. Runbook commands now reference retained tools.
- Generated `evidence/cutover-acceptance.json` is intentionally ignored. It binds HEAD after commit without a circular self-hash. The local verifier report is written outside the worktree. Neither artifact may convert unknown production/history gates into passed checks.
- Production blockers remain unchanged. Full history/file reconciliation, every durable-save journey, final catchup, real worker schedules, exact production SHA and rollback proof are not certified. Keep all three Convex instances until those gates pass.

