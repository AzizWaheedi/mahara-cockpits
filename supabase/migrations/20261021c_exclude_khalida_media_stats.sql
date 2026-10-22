-- Compromise list, step 2 of 2 for the two Khalida ads of 20261021b: their rows in
-- the media buyer's daily statistics (cockpit_media_daily_stats).
-- Sanctioned by the CEO, 2026-10-21. Creative Triage bldgtotkfmhoxmlzowdx.
--
-- The native media publish only inserts or updates daily rows. It never deletes
-- one. So when the worker stops sending an ad, its rows stay, and the CEO refresh,
-- the CSM client ads, Statistics and the ClickUp KPI push keep counting them. (The
-- 19 ads of 20261010a still have 39 such rows, $3,077.54. See 20261021d.)
--
-- Order: 20261021b, then the native release whose hermes/cockpit-sync/excludedAds.ts
-- carries both ids, then one published media cycle on it, then this.
-- It refuses, and changes nothing, when:
--   - 20261021b has not listed both ads;
--   - there is no published media cycle, or its plan is gone, so nothing can be checked;
--   - the last published cycle still sent a daily row for either ad (its plan carries
--     one, or it re-stamped a stored row: the publish sets imported_at on every row it
--     sends), or "29/8 - Copy" (campaign 120247012327240088) is still a live campaign
--     row. Either means the old worker is still running, and it would send the rows
--     straight back;
--   - cockpit_media_feed_state.source_rows already differs from the table's count. Then
--     the media cycles are already failing for another reason, and this must not hide it.
-- It takes the publish's own advisory lock and the publish's table locks, archives the
-- rows, and restates cockpit_media_feed_state.source_rows in the same transaction.
-- Without that, cockpit_native_media_state() refuses every later cycle ("count is
-- incomplete"). A cycle already calculating when this runs fails once ("Source revision
-- conflict; calculate again"), and the next cycle goes through.
-- Audit: one media.excluded_ads.stats_archived row, with ids and counts in "after"
-- (the spend it archived is in "before"). The table's own triggers also write one
-- "delete" row per archived row (the row in "before", nothing in "after") and one
-- feed-state row (counts only).
-- Safe to run twice: a run that archives nothing writes nothing.

BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(1835102821, 1);
LOCK TABLE public.cockpit_media_feed_state, public.cockpit_media_daily_stats IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_ads constant text[] := ARRAY['120247012327250088', '120247083365360088'];
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
  IF (SELECT count(*) FROM public.cockpit_excluded_ads WHERE ad_id = ANY (v_ads)) <> cardinality(v_ads) THEN
    RAISE EXCEPTION 'Apply 20261021b_exclude_khalida_unauthorized_ads.sql first';
  END IF;

  -- The worker must already drop the ads: the last published cycle sent none of
  -- their rows, and it retired "29/8 - Copy" from the campaigns.
  SELECT run_id, created_at, plan->'tables'->'dailyStats' INTO v_run, v_run_created, v_plan_rows
    FROM public.cockpit_native_media_runs
   WHERE status = 'published' ORDER BY published_at DESC NULLS LAST LIMIT 1;
  IF v_run IS NULL OR jsonb_typeof(v_plan_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'No published media cycle with a plan to check. Release hermes/cockpit-sync/excludedAds.ts with both ids, wait for one published cycle, then run this again';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan_rows) e WHERE e->>'metaAdId' = ANY (v_ads))
     OR EXISTS (SELECT 1 FROM public.cockpit_media_daily_stats
                 WHERE data->>'metaAdId' = ANY (v_ads) AND imported_at >= v_run_created)
     OR EXISTS (SELECT 1 FROM public.cockpit_campaigns
                 WHERE meta_campaign_id = '120247012327240088' AND NOT source_deleted) THEN
    RAISE EXCEPTION 'The media worker still sends these ads. Release hermes/cockpit-sync/excludedAds.ts with both ids, wait for one published cycle, then run this again';
  END IF;

  SELECT source_rows INTO v_before FROM public.cockpit_media_feed_state WHERE feed = 'dailyStats';
  SELECT count(*) INTO v_count FROM public.cockpit_media_daily_stats;
  IF v_before IS DISTINCT FROM v_count THEN
    RAISE EXCEPTION 'cockpit_media_feed_state says % daily rows but the table holds %. Find out why before archiving anything', v_before, v_count;
  END IF;

  SELECT count(*), coalesce(sum(nullif(data->>'spend', '')::numeric), 0) INTO v_rows, v_spend
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
    VALUES ('media.excluded_ads.stats_archived', 'cockpit_media_daily_stats', 'migration 20261021c', 'aziz@maharamedia.com', 'media-buyer', 'migration',
      jsonb_build_object('rows', v_rows, 'spend', v_spend, 'feed_source_rows', v_before),
      jsonb_build_object('rows', 0, 'archived', v_archived, 'feed_source_rows', v_after),
      jsonb_build_object('ads', to_jsonb(v_ads), 'reason', 'unauthorized_meta_incident_2026_10',
        'archive', 'ads_daily_snapshots_excluded_archive (row_data._table = cockpit_media_daily_stats)',
        'last_published_run', v_run, 'sanctioned_by', 'CEO, 2026-10-21'));
  END IF;
END $$;

COMMIT;
