# Convex to Supabase migration

## Current direction, 23 September 2026

Muhammed rejected ongoing Convex-to-Supabase shadow copying. The target is a
one-time, verified move of existing records followed by direct Supabase reads,
writes, authentication, and jobs. Do not activate either checklist shadow flag.
The old phases below document what was built; they are not the rollout plan.

The media-buyer production deployment `adorable-seahorse-418` now has
`SUPABASE_MIGRATION_DRY_RUN=true`, read back after the change. Its legacy
issue-report mirror is disabled. The checklist mirror remains disabled.

The first direct checklist backend contract is installed in Creative Triage:
`cockpit_get_daily_checks(text,date)` and
`cockpit_set_daily_check(bigint,boolean,boolean)`. Both require a linked,
confirmed, active Supabase member with the owning role or CEO/admin access;
browser roles have no table access. An expected-value check prevents a stale
checkmark overwrite, and the existing trigger audits each accepted write.
Run `scripts/apply-cockpit-check-direct-migration.ps1` for a rolled-back dry run,
`-Apply` to install, and `-VerifyOnly` to read back schema and permissions.
Production installation and a synthetic one-row authenticated read/write inside
`ROLLBACK` passed. Counts remained 268 checks and 268 check audits afterward.

**This is not a live cockpit cutover.** The current screens still use Convex
Auth, Convex queries, and Convex writes. Before routing any screen to the new
contract, build Supabase sign-in and role gating, migrate the daily check
creation job, and perform a fresh one-time source reconciliation. Then replace
each remaining Convex-owned feature and job, verify production parity, and
remove Convex only when no runtime dependency remains.

### Identity gate corrected, 23 September 2026

Production now has `20260923m_cockpit_ceo_gate.sql`. The previous helper
treated every admin as CEO, unlike the production Convex gate. The replacement
requires a confirmed, active Supabase Auth identity linked to one of Aziz's
two founder email addresses. A synthetic founder and a synthetic admin-role
non-founder were tested inside a rolled-back transaction; the latter was
denied CEO access. The persistent member and audit counts did not change.
Run `scripts/apply-cockpit-ceo-gate-migration.ps1` for the rolled-back dry run,
`-Apply` to install, or `-VerifyOnly` to check the live function and grants.

`apps/media-buyer-cockpit/src/auth/supabaseAccess.ts` is an **unwired** future
browser access contract: it verifies the Auth user server-side with `getUser`,
reads only an active matching `cockpit_members` link, and has no static email
fallback. Its public URL is pinned to Creative Triage. The live login remains
Convex until all routes and actions have a direct Supabase path. Do not set the
new browser `VITE_SUPABASE_*` variables yet. Local checks:
`bun run test:supabase-access` and `bun run typecheck` from the media-buyer app.
Existing Convex Scrypt password hashes cannot be silently copied into Supabase
Auth; users without an existing Supabase Auth account need an explicitly
arranged first sign-in or reset, not a fabricated password migration. No
sign-in emails or account changes were sent as part of this slice.

## Phase 1: identity, audit, and media-buyer feedback

This phase creates the shared cockpit member directory and immutable audit log,
then mirrors each new media-buyer issue report into `cockpit_issue_reports`.
The existing `cockpit_feedback` table is Aziz's automated changes queue and
must never receive these reports. Convex remains the
visible read path and keeps delivering the Slack message, so a mirror failure
does not interrupt the cockpit.

The management token belongs in the local root `.env.local` as
`SUPABASE_ACCESS_TOKEN` (the existing `supabase_token` key is also accepted).
From the repository root, run the rolled-back SQL
test, then apply the same migration to Creative Triage (`bldgtotkfmhoxmlzowdx`):

```powershell
powershell -File scripts/apply-cockpit-supabase-migration.ps1
powershell -File scripts/apply-cockpit-supabase-migration.ps1 -Apply
powershell -File scripts/apply-cockpit-supabase-migration.ps1 -VerifyOnly
```

The script defaults to `DRY_RUN = True` and checks the project reference
before any query. `-Apply` repeats the dry run before committing; the dry run
checks one issue report and its audit row, a linked confirmed user's role, and
an unlinked user's denial, then rolls everything back.
`-VerifyOnly` checks table counts, RLS, and grants without writing. Keep this
deployment setting while verifying:

```text
SUPABASE_MIGRATION_DRY_RUN=true
```

Dry-run is the default when the setting is absent. It performs no Supabase
write. The earlier instruction to enable this mirror is retired; production is
explicitly set to `true` while direct replacement is built.

## Verification

```sql
select count(*) as members from public.cockpit_members;

select source_system, app, role, count(*)
from public.cockpit_issue_reports
where created_at >= now() - interval '1 day'
group by source_system, app, role;

select action, entity_type, source_app, count(*)
from public.cockpit_audit_log
where created_at >= now() - interval '1 day'
group by action, entity_type, source_app;

select source_id, count(*)
from public.cockpit_issue_reports
where source_system = 'convex'
group by source_id
having count(*) > 1;
```

Expected: six seeded member rows; each new media-buyer feedback has one
Supabase row and one INSERT audit row; the duplicate query returns no rows.

## Rollback

Set `SUPABASE_MIGRATION_DRY_RUN=true` and redeploy the media-buyer backend. Do
not drop the tables or delete audit history. Convex continues to own reads and
the existing Slack workflow in this phase.

## Phase 2 preparation: historical issue reports

The backfill tool accepts the official Convex snapshot ZIP layout
(`feedback/documents.jsonl`) or a standalone feedback JSONL. It does not
extract or modify the source file. From the repository root:

```powershell
python scripts/backfill-cockpit-issue-reports.py --source D:\secure\snapshot.zip
python scripts/backfill-cockpit-issue-reports.py --source D:\secure\snapshot.zip --apply-one
```

The first command is the default `DRY_RUN = True`: it reports source counts,
the skipped non-media-buyer rows, and the first legacy ID without network
access or writes. `--apply-one` checks Creative Triage and inserts at most one
missing historical row per run. Run it again to verify existing rows and
advance to the next missing row. It reads each new row and audit entry back;
existing rows are compared rather than overwritten. Historical rows carry their
old delivery
and reply fields as metadata and are marked `historical`; the tool never
triggers a new Slack/ClickUp delivery. Bulk import is intentionally disabled
until the next domain has its own reviewed mapping and canary.

On 23 September 2026, production snapshot `1790160145656784473` from
`adorable-seahorse-418` contained two media-buyer feedback rows. Both were
inserted separately and read back against the snapshot; each insert had an
audit row. SHA-256 of the downloaded ZIP:
`937EF5C1FC6FBC36AFB81480276D8C03608A62F101B64DAC8C934F05CC6FBB37`.
On 23 September, a second database-only snapshot at `1790165016462021861`
(SHA-256 `6297E462336FC011E8189909FB094E31A5C03CC72A91327530806E5FBF8F9149`)
still contained exactly those two feedback rows. The backfill comparison found
both in Supabase unchanged and made no write. Neither snapshot contains file
storage.

The media-buyer backend and site shipped through `scripts/ship.sh media-buyer`
from GitHub main `c94c371`, with `SHIP_SMOKE_READ_ONLY=1`. Vercel confirmed
production READY and the live bundle changed; the production `smoke:local`
query returned `ok: true` without sending a Slack alert. The mirror helper's
duplicate probe reached Creative Triage using the production configuration;
the existing historical row remained unchanged. Only then was the production
media-buyer `SUPABASE_MIGRATION_DRY_RUN` setting changed from `true` to `false`
and read back. The Supabase issue count remained two. No new organic feedback
arrived during this verification window, so a first new shadow-written row and
its audit entry are still an open acceptance check, not a completed claim.

After the first new shadow-written row and audit entry pass read-back, compare
a later Convex snapshot with Supabase by source ID, row count, newest timestamp,
and exceptions. Switch this read path only after sustained parity. Daily checks
and EOD each need their own mapping, guarded backfill, and parity gate.

## Next domain: daily checks ownership (read-only inventory)

Before creating or backfilling a Supabase checks table, run
`scripts/reconcile-cockpit-checks.py` against one database-only ZIP from each
production cockpit. It never writes. The media-buyer deployment stores its own
checks **and a second CSM copy**; client success owns the CSM human checkmarks.
Do not union both CSM copies or let the media-buyer copy overwrite them.

The 23 September snapshots selected 165 media-buyer checks, 122 client-success
checks, and zero creative checks: 287 distinct authoritative rows. All 122 CSM
day/key pairs appeared in both deployments. One human completion differed:
`2026-09-14 / sprint_1` is checked in client success but not in the media-buyer
copy. Two labels/details also differed. The tool reports these differences and
refuses a backfill-ready result if a media-buyer CSM key is missing from the
client-success snapshot. The service-only Supabase checks table is live. The
checked CSM canary and all authoritative rows through 22 September were
imported from the three private snapshots. Convex remains the live writer and
read source.

### Checks schema and one-row canary

`scripts/apply-cockpit-checks-migration.ps1` defaults to a rollback-only
`DRY_RUN = True`. The smoke inserts one checked CSM row, verifies its audit
entry and the service-only grants, then rolls the whole transaction back.
`-Apply` repeats that dry run before installing the schema; it imports no
checklist data. `-VerifyOnly` reads row count, RLS, grants and audit trigger.

```powershell
powershell -File scripts/apply-cockpit-checks-migration.ps1
powershell -File scripts/apply-cockpit-checks-migration.ps1 -Apply
powershell -File scripts/apply-cockpit-checks-migration.ps1 -VerifyOnly
```

`scripts/backfill-cockpit-checks.py` also defaults to offline `DRY_RUN = True`.
Give it the three private ZIP paths and their Convex `start_ts` values using
`--media-buyer`, `--media-buyer-ts`, `--client-success`,
`--client-success-ts`, `--creative`, and `--creative-ts`. After comparing the
report, `--apply-one --canary-role csm --canary-day 2026-09-14 --canary-key
sprint_1` inserts only the child cockpit's checked row and verifies Supabase
read-back plus one INSERT audit. After that canary, `--plan-batch --through-day
2026-09-22 --limit 25` prints a read-only live diff for up to 25 rows from
the same three snapshots. Review that output before replacing `--plan-batch`
with `--apply-batch`; each run preflights all eligible historical rows, writes
at most 25, and checks every row and INSERT audit. The cutoff must precede the
current Kuwait day. A live daily-checks mirror is not provided yet, so
reconcile later edits before any read cutover.

On 23 September, the batch plan identified 268 historical rows through the
22nd. The remaining 19 rows are dated the 23rd and were excluded because
that Kuwait day was still open. The canary plus guarded batches imported all
268. The final read-only plan verified all 268 source/logical identities and
full row contents, with zero missing or conflicting rows. `-VerifyOnly`
reported `check_count=268`, `insert_audit_count=268`, RLS and the service-only
grants enabled, and the audit trigger present. Two intermittent remote
connection resets interrupted batches; after each, the read-only plan
reconciled any rows already written before the next capped batch. No duplicate
or overwrite was observed.

## Phase 3: Version-safe daily check shadow writer (pilot)

This phase establishes a generic, version-safe service-only write contract
for `public.cockpit_daily_checks` in Creative Triage (`bldgtotkfmhoxmlzowdx`),
and implements the live shadow writer for the media-buyer cockpit (`adorable-seahorse-418`).
Convex remains the live user-facing read and write source. No read cutover,
CSM/creative bridge, or external client notifications occur in this phase.

### Schema: additive columns and shadow RPC

Migration `supabase/migrations/20260923f_cockpit_daily_check_shadow.sql`:
- Adds `source_revision bigint NOT NULL DEFAULT 0` (historical rows through 2026-09-22 have implicit 0)
  and `source_deleted boolean NOT NULL DEFAULT false` for future soft tombstones.
- Provides `public.cockpit_apply_daily_check_shadow(p_row jsonb)` as a `SECURITY INVOKER`
  procedure with `SET search_path = ''` and schema-qualified relations.
- Revokes execute from `PUBLIC`, `anon`, and `authenticated`; grants execute only to `service_role`.
- Enforces strict role/owner_app/deployment mapping across all three cockpits:
  - `media_buyer` / `media-buyer` / `adorable-seahorse-418`
  - `csm` / `client-success` / `impressive-dinosaur-375`
  - `creative` / `creative-director` / `colorful-wombat-644`
- Validates `source_system = 'convex'`, nonblank source ID, day, key, label, boolean `done`,
  positive integral `source_revision`, and full provenance.
- Serializes concurrent writes per source identity and logical key using transaction advisory locks.
- Inserts new checks, updates on rising revision while preserving the primary key (`id`),
  returns `stale` or `duplicate` without writing or creating audit entries,
  and raises exceptions on same-revision divergent content or logical/source key mismatches.
- The existing `trg_cockpit_daily_checks_audit` table trigger remains the sole audit writer.

### Migration script: dry run and apply

`scripts/apply-cockpit-check-shadow-migration.ps1` defaults to `DRY_RUN = True`:
it runs the schema changes and a synthetic smoke sequence (insert, update, stale replay,
duplicate replay, conflicting same-revision rejection, and audit verification) inside
a transaction that rolls back.

```powershell
powershell -File scripts/apply-cockpit-check-shadow-migration.ps1
powershell -File scripts/apply-cockpit-check-shadow-migration.ps1 -Apply
powershell -File scripts/apply-cockpit-check-shadow-migration.ps1 -VerifyOnly
```

`-Apply` repeats the dry run before committing the schema.
`-VerifyOnly` checks column presence, default values, RPC presence, service-only grants,
and current row/audit counts with zero writes.

### Media-buyer Convex shadow writer

- `checks` schema gains optional `shadowRevision`, `shadowActor`, and
  `shadowAckRevision` (the last Supabase-confirmed revision).
- `toggleCheck` and new-day sync-created checks compute a strictly increasing revision
  `Math.max(Date.now(), (prior ?? 0) + 1)`, preserve existing checkmark fields,
  and schedule `internal.cockpit.shadowDailyCheck`.
- Non-media-buyer checks are rejected at the mutation and action/query level. The separate
  CSM copy in `csmSync.ts` is untouched.
- Sync metadata updates schedule the shadow action only when mapped content actually changed.
- Out-of-order scheduled action safety: the action reads the current latest check row from the DB
  rather than an old event payload, and the database revision gate drops stale revisions.
- A successful `inserted`, `updated`, or `duplicate` RPC response acknowledges only the
  revision still current in Convex. An old action cannot acknowledge a newer checkmark.
  The next media-buyer sync schedules up to 25 unacknowledged owned checks, including
  unchanged and older-day rows, so dry-run or transient failures do not leave silent gaps.
- `SUPABASE_CHECKS_SHADOW_CANARY_SOURCE_ID` restricts live writes to one exact Convex
  check ID during the first production canary. Other actions remain no-write until that
  setting is removed. The CSM duplicate copy is excluded from replay.
- Live writes additionally require either that canary ID or
  `SUPABASE_CHECKS_SHADOW_BATCH_ENABLED=true`; the live flag alone cannot fan out.
- Shadow errors are logged and recorded to the `sourceHealth` ledger via `note("supabase", ...)`
  and `flush(ctx)`. Shadow failures never block or roll back the user's Convex checkmark mutation.
- The mirror defaults to no-write (`DRY_RUN = true`) unless explicitly enabled via
  `SUPABASE_CHECKS_SHADOW_DRY_RUN=false`.

### Retired rollout

The shadow schema and writer were deployed on 23 September, but checklist
copying was never enabled. The canary and batch steps formerly listed here
must **not** be run. The direct Supabase contract above is the replacement
direction. Keep the old schema and audit history until the full cutover is
verified; do not delete records to tidy up the migration.

## Phase 3 & 4: Direct Migration Architecture and Cutover Verification

As of 24 September 2026, the transition architecture from Convex to Supabase (`bldgtotkfmhoxmlzowdx`) covers all 5 cockpits: Media Buyer, Client Success, Creative Director, Video Editor, and Sales Cockpit.

### Applied Schema & Backend Migrations

1. **`20260923m_cockpit_ceo_gate.sql` & `20260923n_cockpit_identity.sql`**:
   - Shared identity directory `cockpit_members` and audit log `cockpit_audit_log`.
   - Founder CEO gate strictly limited to confirmed identities matching founder email addresses (`aziz@maharamedia.com`, `awaheedi2008@gmail.com`).
   - 8 members linked and active.

2. **`20260923o_cockpit_domain_tables.sql`**:
   - Reconciled domain tables with fail-closed RLS policies:
     - `cockpit_members` (8 rows)
     - `cockpit_daily_checks` (287 rows)
     - `cockpit_issue_reports` (4 rows)
     - `cockpit_eod_reports` (4 rows)
     - `cockpit_campaigns` (15 rows)
     - `cockpit_ads` (42 rows)
     - `cockpit_decisions` (23 rows)
     - `cockpit_client_profiles` (48 rows)
   - Idempotent backfill verified via `scripts/import-snapshot-data.py` (0 duplicate writes).

3. **`20260923p_cockpit_actions_and_rpcs.sql`**:
   - Added `cockpit_plan_items` table with RLS.
   - Enforced unique constraint on `cockpit_eod_reports (role, day)`.
   - 14 security-definer RPC stored procedures deployed and verified in `pg_proc`:
     - `cockpit_get_my_access`
     - `cockpit_link_confirmed_member`
     - `cockpit_admin_upsert_member`
     - `cockpit_admin_remove_member`
     - `cockpit_get_daily_checks`
     - `cockpit_set_daily_check`
     - `cockpit_save_eod`
     - `cockpit_log_decision`
     - `cockpit_remove_decision`
     - `cockpit_update_client_profile`
     - `cockpit_add_plan_item`
     - `cockpit_remove_plan_item`
     - `cockpit_get_dashboard_summary`
     - `cockpit_submit_issue_report`

4. **`20260924a_sales_cockpit.sql` through `20260924j_sales_dialer.sql`**:
   - Added sales domain tables, leads, proposals, dialer integration, and sales compensation rules.

### Frontend Cockpits Integration

- **Media Buyer Cockpit / Portal (`apps/media-buyer-cockpit`)**:
  - Direct Supabase auth provider (`useCockpitAuth`), role/CEO gate, and RPC client.
  - `GoPage` inter-cockpit switcher routes directly with session preservation, without requiring Convex token minting.
  - NullConvexClient and fallback ConvexProvider prevent runtime crashes when Convex is unconfigured.
  - Tests: `scripts/supabase-access.test.ts` (4/4 pass), `scripts/supabase-actions.test.ts` (4/4 pass).

- **Client Success Cockpit (`apps/client-success-cockpit`)**:
  - Integrated `@supabase/supabase-js` with `supabaseAccess.ts`, `SupabaseAuthProvider.tsx`, `SupabaseSignIn.tsx`, and `FirstSignInPage.tsx`.
  - Converted routes and protected gates to `useCockpitAuth()`.
  - NullConvexClient fallback active when `VITE_CONVEX_URL` is empty.

- **Creative Director Cockpit (`apps/creative-director-cockpit`)**:
  - Integrated `@supabase/supabase-js` with `supabaseAccess.ts`, `SupabaseAuthProvider.tsx`, `SupabaseSignIn.tsx`, and `FirstSignInPage.tsx`.
  - Converted routes and protected gates to `useCockpitAuth()`.
  - NullConvexClient fallback active when `VITE_CONVEX_URL` is empty.

- **Video Editor Cockpit (`apps/video-editor-cockpit`)**:
  - De-Convexed: `adPreview` queries `cockpit_ads` and `winner_ads` directly from Supabase.
  - `signInWithPortalToken` supports native Supabase sessions and OTP tokens without contacting Convex.

- **Sales Cockpit (`apps/sales-cockpit`)**:
  - Pure Supabase data model with dialer, proposals, and pay calculations.
  - `adPreview` queries `cockpit_ads` directly from Supabase.
  - `signInWithPortalToken` supports native Supabase sessions without contacting Convex.
  - Tests: `apps/sales-cockpit/src/lib/pay.test.ts` (36/36 pass).

### Fail-Closed Verification Gate

Run `python scripts/verify-cutover-readiness.py` from the repository root:
- Checks project reference and credentials with 20s network timeouts.
- Verifies exact table existence and row counts in live Supabase.
- Verifies RLS is active (`True`) on all 9 domain tables.
- Verifies all 14 RPCs exist in `pg_proc` in schema `public`.
- Verifies fresh production build outputs (`dist/index.html`) across all 5 cockpits.
- Runs core unit test suites via `bun test` and exits with code 1 if any check fails.

### Production Cutover Procedure

1. **Environment Variables**:
   In Vercel and production deployment environment:
   ```bash
   VITE_SUPABASE_URL="https://bldgtotkfmhoxmlzowdx.supabase.co"
   VITE_SUPABASE_ANON_KEY="<production_anon_key>"
   VITE_CONVEX_URL=""
   COCKPITS_BACKEND="supabase"
   ```

2. **Execute Deployment**:
   ```bash
   USE_SUPABASE=1 scripts/ship.sh all
   ```
   `ship.sh` operates in pure Supabase mode:
   - Bypasses `convex deploy`.
   - Runs linting and typechecking.
   - Builds all 5 Vite cockpits targeting Supabase with `VITE_CONVEX_URL=""`.
   - Deploys sites to production and validates bundle updates.
   - Executes smoke check via `verify-cutover-readiness.py`.

3. **Retire Convex**:
   - Place Convex deployments (`adorable-seahorse-418`, `impressive-dinosaur-375`, `colorful-wombat-644`) in read-only / maintenance mode.
   - Retain snapshot backups in `D:\secure\snapshot-*-20260923.zip`.
   - Confirm zero incoming traffic to Convex before deleting deployments.


## 2026-10-04 candidate verification — not a production cutover

- Work stays in `codex/supabase-completion-20261004`; the original user worktrees are unchanged.
- Native team meeting projections now use the existing CSM SQL contracts. The canonical PostgreSQL suite passes 7 tests with 45 assertions. A disposable native-client smoke proved 4/8 renewal target persistence/readback, actor audit, and revoked-member denial.
- Actual application compilation passed for all five cockpits. Shared-source enforcement passed. The assembled Edge Function suite passes 258 tests with 775 assertions.
- These checks do not prove authenticated production journeys, fresh native feed publication, real queued provider processing, or final data reconciliation.
- Do not apply the rejected Gemini native feed migration: it assumes a singleton `id` in existing per-table `cockpit_*_sources` ledgers and fails against canonical schema. Do not activate the submitted media queue worker: its intent flag can report committed delivery without a provider receipt. Their changes remain isolated and outside the assembly.
- Identity adoption and five-app directory-owned role bootstraps still need reviewed corrections. Gemini 3.8 returned a provider quota error; no alternate model was used.
- Both available GitHub credentials lack push permission. Vercel authorization is absent. Hermes SSH authentication is denied. Production schema, data, deployments, writers and Convex runtimes have not been changed during this completion work.

