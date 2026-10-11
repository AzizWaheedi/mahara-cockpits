-- Archive the July/August appointment backups, 2026-10-09 (Creative Triage).
-- They were readable by the browser roles (see
-- mahara-client-portal/docs/WAREHOUSE-PERMISSIONS-PROPOSAL.md) and nothing reads
-- them any more. Moved out of the API schema, not deleted.
CREATE SCHEMA IF NOT EXISTS archive;
REVOKE ALL ON SCHEMA archive FROM PUBLIC, anon, authenticated;
ALTER TABLE public.appointments_backup_20260725 SET SCHEMA archive;
ALTER TABLE public.appointments_location_backfill_20260803 SET SCHEMA archive;
REVOKE ALL ON archive.appointments_backup_20260725 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON archive.appointments_location_backfill_20260803 FROM PUBLIC, anon, authenticated;
COMMENT ON SCHEMA archive IS 'Retired tables kept for recovery only. Not exposed through the API.';
