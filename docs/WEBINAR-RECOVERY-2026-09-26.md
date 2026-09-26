# Webinar recovery verification, 26 September 2026

Verified in the signed-in Supabase dashboard: Creative Triage has eight completed physical backups, 19–26 September; latest 26 September 00:20:01 UTC. Point-in-time recovery is not enabled. Storage object bytes are not included in these database backups.

The restore-to-new-project preview quoted USD 9.68/month compute and USD 0 additional disk. No restore or purchase was started. This is not yet a safe drill: the source has 12 active scheduled jobs and pg_cron/pg_net/Vault. Supabase documents that a binary clone copies active extensions and jobs begin immediately, without a pre-restore pause/exclude option. Use a logical restore with outbound jobs excluded/disabled before running any restored data.

Official reference: https://supabase.com/docs/guides/platform/clone-project

Required next steps:
1. Obtain the source database connection through its existing private secret location, never chat/Git. The browser and SQL connector do not expose a pg_dump connection. No relevant connection/password is available in this terminal's environment.
2. Take a consistent logical export into a private, encrypted location. Record export time, schema version, per-table counts and checksums. Exclude scheduler definitions, HTTP/webhook triggers, vault secrets and outbox dispatch from the test bootstrap. Keep an untouched encrypted source artifact; derive the inert test input deterministically and record omissions.
3. Restore into an isolated Postgres destination with outbound network disabled. Apply the reviewed inert schema, then restore data. Prove constraints, targets/history, event revisions, registration/source receipts and snapshots reconcile. Current webhook outbox integration is not finished; do not imply it has been restored/tested.
4. Record actual restore duration and loss window. Rebuild the application projection from restored source snapshots and compare exact counts/aggregates. Verify anon/member denials and service reads. Never point the live app at the drill database or turn its jobs on.
5. Separately verify the provider backup restoration path with a vendor-supported outbound hold or controlled recovery environment. A logical-export drill does not prove restoration of the eight provider physical backups. Keep daily-backup availability, logical-drill completion and physical-drill completion distinct.

Until this is done, recovery remains unproven. Daily backup availability does not establish the proposed 15-minute RPO/four-hour RTO.
