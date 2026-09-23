# Convex to Supabase migration

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
write. After the migration has been applied and the checks below pass, change
the setting to `false` for the media-buyer Convex deployment only.

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

### Rollout order

1. **Local verification**: Run focused unit/contract tests:
   ```bash
   cd apps/media-buyer-cockpit && bun test scripts/supabase-daily-check-mirror.test.ts
   ```
2. **Database dry run**: Run `powershell -File scripts/apply-cockpit-check-shadow-migration.ps1`
   against Creative Triage. Confirm synthetic smoke passes and table state remains unchanged.
3. **Database apply**: Run `powershell -File scripts/apply-cockpit-check-shadow-migration.ps1 -Apply`.
4. **Database verification**: Run `powershell -File scripts/apply-cockpit-check-shadow-migration.ps1 -VerifyOnly`.
5. **Ship media-buyer cockpit**: Deploy media-buyer backend while keeping default dry-run
   (`SUPABASE_CHECKS_SHADOW_DRY_RUN` unset or `true`).
6. **Bounded canary**: After deployment, choose one existing media-buyer-owned Convex
   check from a read-only source query. Set `SUPABASE_CHECKS_SHADOW_CANARY_SOURCE_ID`
   to that exact ID, then set `SUPABASE_CHECKS_SHADOW_DRY_RUN=false`. The next sync
   replays that one row without changing its checkmark. Compare its full Supabase row
   and audit before removing the canary setting. Do not flip a teammate's checkmark
   merely to test the mirror.
7. **Guarded catch-up**: Set `SUPABASE_CHECKS_SHADOW_BATCH_ENABLED=true`, then remove
   the canary setting. Each sync sends at most 25
   unacknowledged media-buyer-owned checks; read back and compare every batch until
   there are no unacknowledged rows. If the mirror repeatedly fails, the existing
   health system may send an internal Slack alert; this outward behavior needs its
   own approval before enabling the live flag.

> [!NOTE]
> **Status on 23 September: SCHEMA APPLIED; WRITER UNDEPLOYED AND UNENABLED**
> The additive schema and RPC were applied to Creative Triage after a rollback-only
> synthetic smoke test. Read-only verification returned 268 checks and 268 audit rows,
> both new columns and the RPC present, RLS and service-only access intact, and browser
> roles denied. PR #14 merged the gated writer and this follow-up adds durable
> acknowledgement/replay, but the Convex code is not deployed. `SUPABASE_CHECKS_SHADOW_DRY_RUN` defaults to
> `true` (no-write). No checklist values or credentials were changed.
