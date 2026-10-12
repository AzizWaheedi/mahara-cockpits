# Native hiring intake cutover

Prepared 2026-10-08. Scope: four hiring Zaps only. Do not change other Zaps,
publish hiring message workflows, or cancel the Zapier subscription.

## Verified current state

- The selected destination is MaharaMedia Hiring, `2FMeC6zxqelIG07OViBj`.
- Live GHL reads confirmed its six pipelines and 36 workflows. All 36 currently
  report **draft**, despite the September handoff saying they were published.
- Supabase has prior Typeform applications: CSM 186 and closer 26. These are
  stored counts, not evidence of current ingestion.
- The old production Convex deployment `adorable-seahorse-418` rejected a read-only
  hiring health query because the deployment is **paused**. Do not resume the
  whole deployment just to restore this one intake.
- No dedicated hiring intake Edge Function or Supabase cron was found.
- The VPS hiring cron observed is the screening worker, not a form importer.
- Supabase already has `TYPEFORM_TOKEN`; the dedicated hiring PIT and signing
  secrets were absent. The existing GHL hiring PIT remains usable for reads.
- All four Zaps remain enabled. No source webhook has been repointed.

## Mapping

| Zap | Provider/form | Existing hiring role |
| --- | --- | --- |
| 353061533 | Tally / 9qQR6G | sales-closer |
| 364390098 | Typeform / rqv3Fkts | sales-closer |
| 372409656 | Typeform / oW8CWRhi | csm |
| 352676282 | Tally / b5VvQZ | call-centre |

The adapter uses the current hiring role dropdown's verified allowed values.
CSM goes to Client success manager, correcting the old Zap's call-centre label.
CVs are links. Both Arabic and English recording links remain in the portfolio
and full questionnaire. Typeform identity uses the verified stable refs; Tally
uses unique typed identity fields and its exact full-name label.

## Implementation

`supabase/functions/hiring-intake` accepts signed Tally and Typeform submissions.
The new private receipt table commits an application before returning 202.
Each provider/form/response ID has one receipt; changed content conflicts.
Configuration starts in **shadow** and makes no GHL writes.

The authenticated `/drain` route claims one live queued receipt per invocation.
It reuses the cached hiring mappings, contact upsert, additive tags, contact
notes, Application-stage opportunity, and the existing private application and
candidate tables. It never moves an existing opportunity backwards or changes
human scores. GHL messages, workflow enrolment, screening and stage decisions
remain with the existing hiring system. This function has no sending operation.

A provider failure or interrupted worker goes to `review`. Do not blindly retry:
read the saved phase and reconcile GHL contact, note marker and opportunity first.
The new queue has no caller-facing dashboard yet; review rows must be checked at
cutover and in the existing operational health process.

## Release sequence

1. Review and merge this branch under the repository release rules.
2. Apply `20261008z_hiring_native_intake.sql`. Confirm all four source rows are
   shadow and no candidate data changed.
3. Reuse the existing dedicated hiring PIT in Supabase as `GHL_HIRING_PIT`; set
   `GHL_HIRING_LOCATION` to the exact location above. Generate separate
   `HIRING_TALLY_SIGNING_SECRET` and `HIRING_TYPEFORM_SIGNING_SECRET` in private
   secret storage. Never print or commit them. Preserve the existing CRON_SECRET.
4. Deploy `hiring-intake` with platform JWT verification disabled. Each webhook
   route validates its provider HMAC; `/drain` validates the cron secret. Verify
   unsigned requests fail before any receipt or GHL operation.
5. Add signed webhooks in parallel with the current Zaps. Tally forms target the
   function's `/tally` route. Typeform forms target `/typeform`, with SSL checks
   and completed responses only. Do not remove unrelated integrations.
6. Verify one controlled shadow submission per form and a retry: correct role,
   identity, CV and recordings; one durable receipt; zero GHL writes/messages.
7. Check all GHL workflows are still draft before a synthetic destination test.
   Use a distinct labelled test identity with no deliverable candidate address.
   Promote only the four known test receipts, drain each once, read back the
   contact/opportunity/application, then repeat to prove no second opportunity.
8. Set a timestamp for each form. Confirm its latest successful Zap submission
   and its first native receipt overlap without a gap. Inspect submissions since
   the last native Typeform import, especially during the Convex pause. Import
   only verified missing applications; do not reprocess all historical Tally data.
9. Set that source live; promote reviewed real shadow receipts from the cutover
   boundary; disable only its original Zap. Leave the Zap's configuration intact.
10. Install a once-per-minute authenticated native drain schedule. Confirm an
    unattended run and receipt freshness. The schedule must remain independent
    of Convex. Store its secret in private provider configuration, never SQL Git.
11. After successful readback, keep receipt IDs and timestamps in the shared
    handoff. Check for queued/review rows and compare form counts with receipts.

Do not promote shadow receipts in bulk: synthetic tests are deliberately mixed
with the same receiver's protected history. Select known response IDs.

## Reconciliation and rollback

Read only operational columns, not full applications, for routine checks:

```sql
select provider,form_id,status,count(*),max(received_at)
from public.cockpit_hiring_intake_receipts group by provider,form_id,status;
select id,form_id,response_id,phase,error_code,updated_at
from public.cockpit_hiring_intake_receipts where status='review';
```

To stop delivery, set the affected source to `paused`. Keep records and secrets.
If reverting, verify the old Zap's destination, re-enable that one Zap, and
reconcile the overlap by response ID before replaying anything. Do not resume
Convex, publish message workflows, or replay whole forms as a rollback shortcut.

Full questionnaires remain in the same private application store as before.
Receipts also retain their normalized application for recovery; no new automatic
deletion policy is assumed. Define retention with the owner before deleting it.
Other three careers Typeforms are outside this four-Zap migration and may also
need native intake recovery because the old deployment is paused.

## Checks run

- 24 synthetic adapter, HTTP, delivery and actual PGlite/Postgres tests passed.
- TypeScript checked the core and handler without errors.
- Live read-only GHL checks verified pipeline IDs, role dropdown choices, and
  opportunity search/readback response shapes for the existing API version.
- No live test, deployment, migration, cron installation, webhook change,
  workflow publication or Zap shutdown has run in this implementation checkpoint.

Sources: [Tally webhooks](https://tally.so/help/webhooks),
[Typeform webhook configuration](https://www.typeform.com/developers/webhooks/reference/create-or-update-webhook/).
