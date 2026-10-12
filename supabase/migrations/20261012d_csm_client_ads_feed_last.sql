-- The client page's ads read also returns the last imported day (Muhammed,
-- 2026-10-12). Statistics are imported through the day before, so a
-- period that ends today showed today as an empty day and said the numbers
-- ran to today. Only the 'feedLast' key is new; the rest is 20261012c.

CREATE OR REPLACE FUNCTION public.cockpit_csm_client_ads(p_task_id text, p_start date, p_end date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  g jsonb; v_name text; v_key text; v_names text[];
  v_campaigns jsonb; v_adsets jsonb; v_ads jsonb; v_rows jsonb; v_history jsonb;
  v_bookings jsonb; v_verdicts jsonb; v_stills jsonb; v_changes jsonb; v_coverage jsonb;
  v_daily_feed public.cockpit_media_feed_state; v_booking_feed public.cockpit_media_feed_state;
  native_url constant text := '^https://bldgtotkfmhoxmlzowdx[.]supabase[.]co/storage/v1/object/public/cockpit-ad-stills/([a-f0-9]{64}/)?[a-f0-9]{64}$';
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  v_name := g->>'clientName';
  IF p_start IS NULL OR p_end IS NULL OR p_start > p_end OR p_end - p_start >= 400 THEN
    RAISE EXCEPTION 'Choose a valid range of at most 400 days';
  END IF;
  SELECT * INTO v_daily_feed FROM public.cockpit_media_feed_state WHERE feed='dailyStats';
  IF v_daily_feed.ready IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Daily ad statistics have not been imported and verified yet';
  END IF;
  SELECT * INTO v_booking_feed FROM public.cockpit_media_feed_state WHERE feed='bookingEvents';

  v_key := public.cockpit_csm_name_key(v_name);
  -- One row per campaign name; a live row wins over an ended copy.
  WITH matched AS (
    SELECT DISTINCT ON (c.raw_data->>'campaignName') c.*
      FROM public.cockpit_campaigns c
     WHERE v_key <> '' AND nullif(btrim(c.raw_data->>'campaignName'),'') IS NOT NULL
       AND (public.cockpit_csm_name_key(c.raw_data->>'clientName') = v_key
            OR public.cockpit_csm_name_key(c.client_name) = v_key
            OR position(v_key IN public.cockpit_csm_name_key(c.raw_data->>'accountName')) > 0)
     ORDER BY c.raw_data->>'campaignName', c.source_deleted, c.updated_at DESC
  )
  SELECT coalesce(array_agg(m.raw_data->>'campaignName'), '{}'),
         coalesce(jsonb_agg(jsonb_build_object(
           'name', m.raw_data->>'campaignName',
           'metaCampaignId', m.raw_data->>'metaCampaignId',
           'accountId', coalesce(nullif(m.raw_data->>'metaAccountId',''), m.meta_account_id),
           'accountName', m.raw_data->>'accountName',
           'currency', m.raw_data->>'currency',
           'budgetDaily', m.raw_data->'budgetDaily',
           'budgetLevel', m.raw_data->>'budgetLevel',
           'ended', m.source_deleted) ORDER BY m.raw_data->>'campaignName'), '[]')
    INTO v_names, v_campaigns
    FROM matched m;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.data->>'metaId', 'name', s.data->>'name', 'campaignName', s.data->>'campaignName',
           'status', s.data->>'status', 'effectiveStatus', s.data->>'effectiveStatus') ORDER BY s.source_id), '[]')
    INTO v_adsets
    FROM public.cockpit_media_sources s
   WHERE s.table_name='metaTree' AND s.data->>'kind'='adset' AND s.data->>'campaignName' = ANY(v_names);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.data->>'metaId', 'name', s.data->>'name', 'adsetId', s.data->>'adsetId',
           'campaignName', s.data->>'campaignName', 'status', s.data->>'status',
           'effectiveStatus', s.data->>'effectiveStatus', 'accountId', s.data->>'accountId',
           'creativeId', s.data->>'creativeId', 'thumbUrl', s.data->>'thumbUrl') ORDER BY s.source_id), '[]')
    INTO v_ads
    FROM public.cockpit_media_sources s
   WHERE s.table_name='metaTree' AND s.data->>'kind'='ad' AND s.data->>'campaignName' = ANY(v_names);

  -- The period's rows, and the 30 days before it: the earlier rows give the
  -- 7-day cost per lead its first days and name an ad that booked in the
  -- period after it stopped spending. They never add to the period's totals.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'date', d.day, 'campaignName', d.campaign_name, 'adSetName', d.data->>'adSetName',
           'adName', d.data->>'adName', 'adId', d.data->>'metaAdId',
           'spend', d.data->'spend', 'leads', d.data->'leads', 'impressions', d.data->'impressions',
           'linkClicks', d.data->'linkClicks', 'frequency', d.data->'frequency')
           ORDER BY d.day, coalesce((d.data->>'_creationTime')::numeric,0), d.source_id) FILTER (WHERE d.day >= p_start), '[]'),
         coalesce(jsonb_agg(jsonb_build_object(
           'date', d.day, 'campaignName', d.campaign_name, 'adSetName', d.data->>'adSetName',
           'adName', d.data->>'adName', 'adId', d.data->>'metaAdId',
           'spend', d.data->'spend', 'leads', d.data->'leads')
           ORDER BY d.day, coalesce((d.data->>'_creationTime')::numeric,0), d.source_id) FILTER (WHERE d.day < p_start), '[]')
    INTO v_rows, v_history
    FROM public.cockpit_media_daily_stats d
   WHERE d.campaign_name = ANY(v_names) AND d.day BETWEEN p_start - 30 AND p_end;

  SELECT jsonb_build_object('first', min(d.day), 'last', max(d.day))
    INTO v_coverage FROM public.cockpit_media_daily_stats d WHERE d.campaign_name = ANY(v_names);

  IF v_booking_feed.ready IS TRUE THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'date', b.day, 'campaignName', b.campaign_name, 'adId', b.data->>'adId',
             'status', lower(coalesce(b.data->>'status','')), 'startTime', b.data->>'startTime',
             'appointmentDate', b.data->>'appointmentDate') ORDER BY b.day, b.source_id), '[]')
      INTO v_bookings
      FROM public.cockpit_media_booking_events b
     WHERE b.campaign_name = ANY(v_names) AND b.day BETWEEN p_start AND p_end;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'adId', a.meta_ad_id, 'adName', a.ad_name, 'campaignName', a.campaign_name,
           'verdict', a.verdict, 'reason', a.reason) ORDER BY a.campaign_name, a.ad_name), '[]')
    INTO v_verdicts
    FROM public.cockpit_ads a
   WHERE a.campaign_name = ANY(v_names) AND NOT a.source_deleted;

  -- Each ad's saved picture: by its creative (from Meta's tree or the ads
  -- board), else saved under its own id. Pictures are saved for ads that still
  -- run; an ad that no longer runs keeps one only if it was saved before
  -- (Muhammed, 2026-10-12: no backfill for ended ads). Only pictures in this
  -- project's own bucket are returned.
  WITH ids AS (
    SELECT DISTINCT x.id FROM (
      SELECT e->>'adId' id FROM jsonb_array_elements(v_rows) e
      UNION SELECT e->>'adId' FROM jsonb_array_elements(v_history) e
      UNION SELECT e->>'id' FROM jsonb_array_elements(v_ads) e
      UNION SELECT e->>'adId' FROM jsonb_array_elements(coalesce(v_bookings,'[]')) e) x
     WHERE x.id ~ '^[0-9]{5,25}$'
  ), creatives AS (
    SELECT i.id, array_remove(array_agg(DISTINCT 'c:'||c.creative), NULL) keys
      FROM ids i
      LEFT JOIN LATERAL (
        SELECT e->>'creativeId' creative FROM jsonb_array_elements(v_ads) e WHERE e->>'id'=i.id AND e->>'creativeId' ~ '^[0-9]{5,25}$'
        UNION SELECT a.raw_data->>'creativeId' FROM public.cockpit_ads a WHERE a.meta_ad_id=i.id AND a.raw_data->>'creativeId' ~ '^[0-9]{5,25}$'
      ) c ON true
     GROUP BY i.id
  )
  SELECT coalesce(jsonb_object_agg(c.id, jsonb_build_object(
           'url', s.data->>'url',
           'tinyUrl', CASE WHEN s.data->>'tinyUrl' ~ native_url THEN s.data->>'tinyUrl' END)), '{}')
    INTO v_stills
    FROM creatives c
    CROSS JOIN LATERAL (
      SELECT st.data FROM public.cockpit_native_stills st
       WHERE st.data->>'status'='saved' AND st.data->>'url' ~ native_url
         AND (st.key = ANY(c.keys) OR st.key = 'a:'||c.id OR st.data->>'adId' = c.id)
       ORDER BY (st.key = ANY(c.keys)) DESC, (st.key = 'a:'||c.id) DESC, st.updated_at DESC
       LIMIT 1) s;

  SELECT coalesce(jsonb_agg(jsonb_build_object('day', x.day, 'at', (extract(epoch FROM x.at)*1000)::bigint,
           'kind', x.kind, 'action', x.action, 'evidence', x.evidence, 'actor', x.actor,
           'source', x.source, 'subject', x.subject, 'link', x.link) ORDER BY x.at), '[]')
    INTO v_changes
    FROM (SELECT * FROM public.cockpit_csm_changes
           WHERE task_id = p_task_id AND day BETWEEN p_start AND p_end
           ORDER BY at DESC LIMIT 500) x;

  RETURN jsonb_build_object(
    'taskId', p_task_id, 'clientName', v_name, 'start', p_start, 'end', p_end, 'at', now(),
    'statsAt', v_daily_feed.source_snapshot_at,
    'bookingsReady', coalesce(v_booking_feed.ready, false),
    'bookingsAt', v_booking_feed.source_snapshot_at,
    'coverage', v_coverage,
    -- The first day any ad numbers were imported: a period that starts
    -- earlier is cut to this day, and the page says so.
    'feedFirst', (SELECT min(day) FROM public.cockpit_media_daily_stats),
    -- The last day imported for any client. A later day is not in yet, so
    -- the page ends the period there and never draws it as zero.
    'feedLast', (SELECT max(day) FROM public.cockpit_media_daily_stats),
    'campaigns', v_campaigns, 'adsets', v_adsets, 'ads', v_ads,
    'rows', v_rows, 'history', v_history, 'bookings', v_bookings,
    'verdicts', v_verdicts, 'stills', v_stills, 'changes', v_changes);
END $$;
-- CREATE OR REPLACE may reset settings, privileges; state them explicitly.
ALTER FUNCTION public.cockpit_csm_client_ads(text, date, date) SET search_path='';
REVOKE ALL ON FUNCTION public.cockpit_csm_client_ads(text, date, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_client_ads(text, date, date) TO authenticated;
