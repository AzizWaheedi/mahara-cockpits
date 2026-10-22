-- The client page's Ads tab leaves out the ads on the compromise list
-- (2026-10-21, Creative Triage bldgtotkfmhoxmlzowdx).
--
-- The CEO, 2026-10-21: "make sure it shows the cost per booking correctly for
-- all". The ads outsiders placed during the October 2026 Meta compromise are
-- listed in public.cockpit_excluded_ads (20261010a, 20261021b). The media sync
-- drops them, but its publish only inserts or updates daily rows and never
-- deletes one, so 39 ad-days of 7 listed ads ($3,077.54, 24 Sep to 8 Oct) are
-- still in cockpit_media_daily_stats (20261021d archives them, a separate CEO
-- decision). cockpit_csm_client_ads read those rows as the client's own, so the
-- Ads tab's "This month" (1-20 Oct) showed:
--   Liwan        $1,211.23 spent, 1 booking   (true: $194.58)
--   Khalida      $1,244.98 spent, 1 booking   (true: $191.53)
--   Ideal Elite  $394.86 spent, 0 bookings    (true: none of it is Mahara's)
-- and listed the outsiders' ads as Mahara's, with their spend in every ad's
-- "client's average" meter.
--
-- What changes, and nothing else: each read of cockpit_media_daily_stats that
-- describes the client's ads (the period's rows, the 30 days of history before
-- them, and the client's first and last day with numbers) leaves out a row
-- whose ad is on the list. The match is on the ad id alone, as the media sync,
-- the snapshot trigger and the board (20261021a) match it. feedFirst and
-- feedLast stay as they are: they say what the import covers for every client,
-- not which ads are the client's. The tree, the booking events and the
-- verdicts hold no listed ad (checked on 21 Oct: 0 rows each), because the
-- sync already drops them there.
--
-- Checked read-only on live data on 2026-10-21, with this file's campaign match
-- and filter, "This month" to the last imported day (20 Oct):
--   Liwan (86ewvnqj5)    rows 40 -> 24, $1,211.23 -> $194.58; history 54 -> 53
--   Khalida (86ey2em6q)  rows 43 -> 36, $1,244.98 -> $191.53; history 19 -> 16
--   Ideal Elite (86exfh1x6) rows 7 -> 0, $394.86 -> no ad numbers; coverage
--     24 Sep-7 Oct -> none (the page already reads a null first/last day)
--
-- The body is the live one (prosrc md5 68866291d824a87ad316bcbe7d28daf3, equal
-- to 20261013180100_csm_client_ads_v3.sql) with only those two reads changed.
-- The file refuses, and changes nothing, if the live body is neither that one
-- nor this file's, so a change made since 21 Oct is never overwritten.
-- Read-only: STABLE, no INSERT, UPDATE or DELETE. The gate, SECURITY DEFINER,
-- the empty search_path and the grants (authenticated only) are restated.
--
-- Rollback: ~/.cache/mahara-ship/rollback/cockpit_csm_client_ads.before-20261021200000.sql
-- (the live definition and its grants, dumped before this file).
-- How we know it works: scripts/csm-client-ads-excluded.test.ts. Safe to apply twice.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('public.cockpit_excluded_ads') IS NULL THEN
    RAISE EXCEPTION 'The compromise list (20261010a_exclude_unauthorized_ads.sql) is missing';
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_csm_client_ads(text,date,date)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('68866291d824a87ad316bcbe7d28daf3', 'b7f7b6055141427e1947f54f096b0193') THEN
    RAISE EXCEPTION 'cockpit_csm_client_ads is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_client_ads(p_task_id text, p_start date, p_end date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
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
           'ended', m.source_deleted,
           -- v3: what the media buyer's board says about the campaign. The
           -- board writes these on every sync; a key it has not written
           -- comes back null, and the page reads null as not known.
           'verdict', nullif(btrim(m.raw_data->>'verdict'),''),
           'reason', nullif(btrim(m.raw_data->>'reason'),''),
           'findings', CASE WHEN jsonb_typeof(m.raw_data->'findings')='array' THEN m.raw_data->'findings' END,
           'boardAdStatus', nullif(btrim(m.raw_data->>'boardAdStatus'),''),
           'daysLive', CASE WHEN jsonb_typeof(m.raw_data->'daysLive')='number' THEN m.raw_data->'daysLive' END,
           -- The client's lost leads per ad id. The board keeps one copy of
           -- the client's whole lost pipeline on each of its campaigns, so
           -- the page takes one copy and never adds them up.
           'lostByAd', CASE WHEN jsonb_typeof(m.raw_data->'lost'->'byAd')='object' THEN m.raw_data->'lost'->'byAd' END)
           ORDER BY m.raw_data->>'campaignName'), '[]')
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
  -- An ad on the compromise list is never the client's (2026-10-21): the
  -- publish never deletes the rows the sync stopped sending.
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
   WHERE d.campaign_name = ANY(v_names) AND d.day BETWEEN p_start - 30 AND p_end
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads x WHERE x.ad_id = coalesce(nullif(d.data->>'metaAdId',''), d.source_id));

  SELECT jsonb_build_object('first', min(d.day), 'last', max(d.day))
    INTO v_coverage FROM public.cockpit_media_daily_stats d WHERE d.campaign_name = ANY(v_names)
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads x WHERE x.ad_id = coalesce(nullif(d.data->>'metaAdId',''), d.source_id));

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
NOTIFY pgrst, 'reload schema';

COMMIT;
