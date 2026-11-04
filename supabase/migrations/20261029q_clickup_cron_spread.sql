-- ClickUp: move two pg_cron jobs out of the minutes the VPS native cycle
-- runs in (2026-10-29, Creative Triage bldgtotkfmhoxmlzowdx;
-- docs/requests/CLICKUP-DOWNGRADE.md section 1.5).
--
-- Why: the CEO moves ClickUp from Business Plus (1,000 API calls a minute
-- for a token) to Business (100). One personal token serves the Supabase
-- functions and every VPS worker. The native cycle starts at :00, :15, :30
-- and :45 and makes about 48 calls before it publishes, 5 to 7 minutes later
-- (805 s at most). Its receipts all carry the publish time (run 070ca214:
-- 48 calls between 19:00:05 and 19:07:45 Kuwait, every one stamped
-- 19:07:40), so the minute of each call is not known and the whole run must
-- be counted in every minute it ran. The ledgers' busiest stamped minutes
-- (the publish minute plus the comment watch) say nothing about when the
-- native calls were made, so this file does not rest on them. It rests on
-- this: both jobs run inside the native run, the comment watch at :07, :22,
-- :37 and :52 (about 31 calls) and the KPI writeback at :05 (its minute
-- held up to 51 calls).
-- Read only on 2026-10-29 over the 307 native runs since 25 Oct 22:15
-- Kuwait, a run's calls plus the other calls in the busiest minute of its
-- run came to at most 98 (29 Oct 06:05, the KPI); 3 runs passed 80, all with
-- the KPI; with the comment watch, at most 79. Without the calls of these two
-- jobs, at most 66 (p95 64).
--
-- What this does not move: the requests writer (every minute), the task
-- mirror, the log writeback and the creative drain (*/2) and the onboarding
-- sync (4-59/10, so :04 and :34) still run inside the native run. In those
-- five days they made at most about 20 calls in one of its minutes (p95 17),
-- so a native run plus them stayed under the budget of 80. Their pacing (25
-- to 30 calls a minute a job, CLICKUP-DOWNGRADE.md section 1.4) bounds a
-- backlog, and the guardian's clickup-rate-budget counts each native run in
-- every minute of its run and warns above 80.
--
-- Live, read only on 2026-10-29 (cron.job):
--   jobid 464 mahara-comment-watch          7-59/15 * * * *  command md5 49e2a52769dd3ddfceab803c43e03060
--   jobid 459 mahara-clickup-writeback-kpi  5 3-18 * * *     command md5 39c110fd69f26fd5b58543e63a1ef9ea
-- Check them before applying:
--   SELECT jobid, jobname, schedule, md5(command) FROM cron.job
--    WHERE jobname IN ('mahara-comment-watch', 'mahara-clickup-writeback-kpi');
--
-- What changes, the schedule only (cron.alter_job(job_id, schedule := ...),
-- so the command, the database, the user and active are not touched):
--   mahara-comment-watch          7-59/15 * * * *  ->  13,29,43,59 * * * *
--     All four minutes are odd and none is a multiple of 3 or 5, so no */2,
--     */3 or */5 job shares them, on pg_cron or on the VPS (the editor desk's
--     ClickUp requests run is */3, unledgered; its meetings run is :27). None
--     falls in a typical native run (:00-:07, :15-:22, :30-:37, :45-:52; only
--     a run of more than 13 minutes, 805 s on record, reaches :13). A run at
--     :29 or :59 can last into the first seconds of the next native run: at
--     most the last 35 s of its 95 s budget, about 18 calls at 2,000 ms, while
--     the native run's first call on record came 5 s in. Gaps of 16 and 14
--     minutes; the guardian allows 45 (native-jobs).
--   mahara-clickup-writeback-kpi  5 3-18 * * *     ->  23 3-18 * * *
--     Odd, not a multiple of 3 or 5, after the typical native run (:15 to
--     :22), the same 03-18 UTC hours (the guardian reads the hours, not the
--     minute). The VPS webinar pull also runs at :23; it calls no ClickUp.
--
-- The file refuses and changes nothing (RAISE EXCEPTION, the whole file) when
-- either job is missing or named twice, or its schedule is neither the one
-- read live today nor the new one, so a schedule someone changed since is
-- never overwritten. A job already moved is left alone: a second run changes
-- nothing. With no pg_cron (no cron.job, as in PGlite) it raises a notice and
-- changes nothing. No table, row, function or grant changes; nothing to audit
-- beyond the migration record (the two jobs keep their names and commands).
--
-- How we know it works: apps/media-buyer-cockpit/scripts/clickup-cron-spread-supabase.test.ts
-- (a stand-in cron.job and cron.alter_job): both schedules move with their
-- commands untouched, a second run changes nothing, any other schedule or a
-- missing job refuses and changes nothing, and no cron schema is a notice. It
-- runs in scripts/ship.sh's requests block.
--
-- Read-back after applying: the select above gives 13,29,43,59 * * * * and
-- 23 3-18 * * *, both command md5s unchanged; the next cockpit_comment_watch_runs
-- row starts at :13, :29, :43 or :59 and the next kpi row in
-- cockpit_clickup_writeback_runs at :23.
-- Rollback: SELECT cron.alter_job(464, schedule := '7-59/15 * * * *');
--           SELECT cron.alter_job(459, schedule := '5 3-18 * * *');
-- (look the ids up by name first). Safe to apply twice.

BEGIN;

DO $$
DECLARE
  v_moves constant jsonb := '[
    {"job": "mahara-comment-watch", "from": "7-59/15 * * * *", "to": "13,29,43,59 * * * *"},
    {"job": "mahara-clickup-writeback-kpi", "from": "5 3-18 * * *", "to": "23 3-18 * * *"}
  ]';
  m jsonb;
  v_n integer;
  v_id bigint;
  v_schedule text;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'No pg_cron here (cron.job is missing), so no ClickUp job was moved.';
    RETURN;
  END IF;
  -- Both are checked before either moves, so a refusal changes nothing.
  FOR m IN SELECT e FROM jsonb_array_elements(v_moves) AS x(e) LOOP
    SELECT count(*) INTO v_n FROM cron.job j WHERE j.jobname = m->>'job';
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'pg_cron has % jobs named %, not one. Nothing was moved; check cron.job and rebase this file', v_n, m->>'job';
    END IF;
    SELECT j.schedule INTO v_schedule FROM cron.job j WHERE j.jobname = m->>'job';
    IF v_schedule IS DISTINCT FROM m->>'from' AND v_schedule IS DISTINCT FROM m->>'to' THEN
      RAISE EXCEPTION '% runs at "%", not "%" as read on 2026-10-29. Nothing was moved; check why it changed and rebase this file', m->>'job', v_schedule, m->>'from';
    END IF;
  END LOOP;
  FOR m IN SELECT e FROM jsonb_array_elements(v_moves) AS x(e) LOOP
    SELECT j.jobid, j.schedule INTO v_id, v_schedule FROM cron.job j WHERE j.jobname = m->>'job';
    IF v_schedule = m->>'from' THEN
      PERFORM cron.alter_job(job_id := v_id, schedule := m->>'to');
      RAISE NOTICE '% moved from "%" to "%".', m->>'job', m->>'from', m->>'to';
    END IF;
  END LOOP;
END $$;

COMMIT;
