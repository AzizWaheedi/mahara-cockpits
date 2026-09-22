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
checks one issue report and its audit row, then rolls everything back.
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

## Next slice

Backfill historic feedback from a Convex export, compare row counts and newest
timestamps, then switch the feedback read path to Supabase. After that, repeat
the same shadow, compare, cutover sequence for daily checks and EOD reports.
