-- Native runs checkpoint index, 2026-10-13 (Creative Triage bldgtotkfmhoxmlzowdx).
--
-- The database server restarted on 12 Oct 12:40 UTC and 13 Oct 10:16 UTC.
-- Before both, the cockpit-sync Fathom checkpoint read
-- (hermes/cockpit-sync/transport.ts, native_fathom_checkpoint_get) timed out.
-- It asks PostgREST for the newest published media-core run:
--   status = 'published' AND plan->>'producer' = 'media-core'
--   ORDER BY published_at DESC LIMIT 1, selecting plan->>'begun_at'.
-- No index covers it, so each call (about 5 an hour) unpacked every stored
-- plan: about 120 plans of 5.8 MB JSON (1.9 MB compressed), about 235 MB read
-- from disk, 5.9 s on average, on a 2 GB instance that was already swapping.
-- The same shape was fixed in the monitor on 2026-10-09 (20261009n).
--
-- This partial expression index takes the read straight to the newest
-- media-core row, so only that one plan is unpacked. Same rows, same answer.
-- The build unpacks each published plan once (about one old checkpoint call)
-- and holds writes to the table for those seconds: apply it just after a
-- native publish.
CREATE INDEX IF NOT EXISTS cockpit_native_media_runs_published_producer
  ON public.cockpit_native_media_runs ((plan->>'producer'), published_at DESC)
  WHERE status = 'published';
