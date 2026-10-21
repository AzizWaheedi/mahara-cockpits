-- OPTIONAL, a separate CEO decision. Compromise list: the daily rows the 10 Oct
-- exclusion left in cockpit_media_daily_stats.
-- 20261010a cleared ads_daily_snapshots but not the media worker's daily rows.
-- Those were written at 14:53 on 10 Oct, before a worker carrying the list was
-- released, and the publish never deletes a row. So 39 ad-days of 7 listed ads,
-- $3,077.54 from 24 Sep to 8 Oct, still count:
--   Munshaat Khalida $1,243.28, Liwan $1,133.48, Ideal Elite $578.62, RM Designs $122.16.
-- They count in the CEO refresh (it ties them through their campaign's cockpit_campaigns
-- row, retired rows included) and in the CSM client ads for those dates.
--
-- Same mechanics and refusals as 20261021c, over every ad on the list. It also refuses
-- until 20261021b has listed its two ads, so the "last cycle sent no listed ad" check
-- covers them and cannot pass before the worker release that carries them has published
-- a cycle. Meant to run after 20261021c; run first, it also archives 20261021c's rows,
-- and 20261021c then finds nothing and writes nothing.
-- Audit: one media.excluded_ads.stats_archived row, with ids and counts in "after"
-- (the spend it archived is in "before"), plus the table triggers' rows as in 20261021c.
-- Safe to run twice: a run that archives nothing writes nothing.

BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(1835102821, 1);
LOCK TABLE public.cockpit_media_feed_state, public.cockpit_media_daily_stats IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_since_21b constant text[] := ARRAY['120247012327250088', '120247083365360088'];
  v_ads text[];
  v_hit text[];
  v_run uuid;
  v_run_created timestamptz;
  v_plan_rows jsonb;
  v_rows integer;
  v_spend numeric;
  v_archived integer;
  v_before bigint;
  v_count bigint;
  v_after bigint;
BEGIN
  IF (SELECT count(*) FROM public.cockpit_excluded_ads WHERE ad_id = ANY (v_since_21b)) <> cardinality(v_since_21b) THEN
    RAISE EXCEPTION 'Apply 20261021b_exclude_khalida_unauthorized_ads.sql, release the worker list and apply 20261021c first';
  END IF;
  SELECT array_agg(ad_id ORDER BY ad_id) INTO v_ads FROM public.cockpit_excluded_ads;

  SELECT run_id, created_at, plan->'tables'->'dailyStats' INTO v_run, v_run_created, v_plan_rows
    FROM public.cockpit_native_media_runs
   WHERE status = 'published' ORDER BY published_at DESC NULLS LAST LIMIT 1;
  IF v_run IS NULL OR jsonb_typeof(v_plan_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'No published media cycle with a plan to check. Wait for one published cycle, then run this again';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan_rows) e WHERE e->>'metaAdId' = ANY (v_ads))
     OR EXISTS (SELECT 1 FROM public.cockpit_media_daily_stats
                 WHERE data->>'metaAdId' = ANY (v_ads) AND imported_at >= v_run_created) THEN
    RAISE EXCEPTION 'The last published media cycle still sent a listed ad. Bring the worker''s EXCLUDED_AD_IDS in step with cockpit_excluded_ads, release it, wait for one published cycle, then run this again';
  END IF;

  SELECT source_rows INTO v_before FROM public.cockpit_media_feed_state WHERE feed = 'dailyStats';
  SELECT count(*) INTO v_count FROM public.cockpit_media_daily_stats;
  IF v_before IS DISTINCT FROM v_count THEN
    RAISE EXCEPTION 'cockpit_media_feed_state says % daily rows but the table holds %. Find out why before archiving anything', v_before, v_count;
  END IF;

  SELECT count(*), coalesce(sum(nullif(data->>'spend', '')::numeric), 0),
         array_agg(DISTINCT data->>'metaAdId' ORDER BY data->>'metaAdId')
    INTO v_rows, v_spend, v_hit
    FROM public.cockpit_media_daily_stats WHERE data->>'metaAdId' = ANY (v_ads);

  -- Archived, not destroyed (the 20261010a rule).
  WITH gone AS (
    DELETE FROM public.cockpit_media_daily_stats d WHERE d.data->>'metaAdId' = ANY (v_ads) RETURNING d.*
  )
  INSERT INTO public.ads_daily_snapshots_excluded_archive (row_data)
  SELECT to_jsonb(gone) || jsonb_build_object('_table', 'cockpit_media_daily_stats') FROM gone;
  GET DIAGNOSTICS v_archived = ROW_COUNT;

  IF v_archived > 0 THEN
    SELECT count(*) INTO v_after FROM public.cockpit_media_daily_stats;
    UPDATE public.cockpit_media_feed_state SET source_rows = v_after, updated_at = clock_timestamp()
     WHERE feed = 'dailyStats';
    INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, "before", "after", metadata)
    VALUES ('media.excluded_ads.stats_archived', 'cockpit_media_daily_stats', 'migration 20261021d', 'aziz@maharamedia.com', 'media-buyer', 'migration',
      jsonb_build_object('rows', v_rows, 'spend', v_spend, 'feed_source_rows', v_before),
      jsonb_build_object('rows', 0, 'archived', v_archived, 'feed_source_rows', v_after),
      jsonb_build_object('scope', 'every ad on cockpit_excluded_ads', 'ads', to_jsonb(v_hit),
        'reason', 'unauthorized_meta_incident_2026_10',
        'archive', 'ads_daily_snapshots_excluded_archive (row_data._table = cockpit_media_daily_stats)',
        'last_published_run', v_run, 'sanctioned_by', 'CEO'));
  END IF;
END $$;

COMMIT;
