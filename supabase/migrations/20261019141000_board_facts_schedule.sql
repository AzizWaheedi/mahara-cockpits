-- Board facts schedule, 2026-10-19 (Creative Triage bldgtotkfmhoxmlzowdx).
--
-- Why: cockpit_board_facts_run('recent') reads about 848 MB of buffers per run.
-- At minutes 10 and 40 it overlapped the media publish and the native monitor
-- reads in the 2026-10-19 memory dips on the Small instance. Minutes 2 and 32
-- keep the 30-minute rhythm, stay clear of those jobs, and run 12 minutes after
-- the GHL syncs at minutes 20 and 50 (20 minutes before), so the board is fresher.
--
-- Change: only the schedule of mahara-board-facts. The command, the nightly
-- job (00:50 UTC) and the doctor are unchanged.
-- Not in scope: what the run reads or writes, the nightly job, the doctor.
-- How we know it works: board-facts-supabase.test.ts applies this file twice
-- and expects one job each with the new schedule; after apply, cron.job shows
-- '2,32 * * * *' and cockpit_board_facts_doctor() reports no problems.
-- Safe to apply twice. Guarded so the file loads where pg_cron is absent.

BEGIN;
DO $$ BEGIN IF to_regclass('cron.job') IS NOT NULL THEN
  EXECUTE 'SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname = ''mahara-board-facts''';
  EXECUTE $q$SELECT cron.schedule('mahara-board-facts', '2,32 * * * *', $job$SELECT public.cockpit_board_facts_run('recent');$job$)$q$;
END IF; END $$;
COMMIT;
