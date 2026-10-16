-- A private bucket for whole-system backups (Creative Triage, bldgtotkfmhoxmlzowdx).
--
-- First use, 2026-10-16: the final export of the six Convex deployments before
-- the CEO cancels Convex (backups/2026-10-16-convex-final-export/: one ZIP per
-- deployment from `convex export --include-file-storage`, SHA256SUMS, README.txt).
--
-- No storage policy is created on purpose: no browser role can list, read or
-- write here; only the service key can. Safe to apply twice.

begin;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('cockpit-backups', 'cockpit-backups', false, 52428800,
        array['application/zip', 'application/json', 'text/plain', 'application/gzip', 'application/octet-stream'])
on conflict (id) do update set public = false;

commit;
