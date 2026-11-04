-- Ads tab: keep a new campaign on the list until the sync lists it (5 Nov 2026,
-- Creative Triage bldgtotkfmhoxmlzowdx).
--
-- 20261104b returned only campaigns whose first spend is today. At midnight
-- such a campaign has spend "before today", so the read dropped it, but the
-- media sync adds a new campaign only the next morning (rows created between
-- 01:06 and 11:51 Kuwait for the 1 to 4 Nov launches). On 5 Nov 00:07 that hid
-- Monshaat_Leads_4/11 and Leads_Arcwani_CBO_4/11 again.
--
-- The read now returns campaigns whose first spend is today or yesterday
-- (Kuwait date) and that still have no live Ads list row. Each row carries
-- startedOn (its first spend day) and its figures since then (today and, when
-- it started yesterday, yesterday). Everything else is as in 20261104b:
-- excluded ads and Mahara's own account left out, the ClickUp card by name,
-- media buyer / admin / CEO only, each row filtered by the member's clients.
-- Read only. Safe to apply twice.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regprocedure('public.cockpit_media_started_today()') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261104b_media_started_today first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_media_started_today()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_day date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_feed_at timestamptz;
  v_rows jsonb;
BEGIN
  IF NOT (public.cockpit_has_role('media_buyer') OR public.cockpit_has_role('admin') OR public.cockpit_is_ceo()) THEN
    RAISE EXCEPTION 'Verified media-buyer access required' USING ERRCODE = '42501';
  END IF;

  SELECT max(m.fetched_at) INTO v_feed_at FROM public.cockpit_meta_ad_days m WHERE m.day >= v_day - 1;

  WITH recent_rows AS (
    SELECT m.* FROM public.cockpit_meta_ad_days m
    WHERE m.day >= v_day - 1 AND m.day <= v_day AND m.spend > 0
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads x WHERE x.ad_id = m.ad_id)
      AND lower(regexp_replace(coalesce(m.account_name, ''), '[^[:alnum:]]', '', 'g')) <> 'maharamedia'
  ), camp AS (
    SELECT r.campaign_id,
      max(r.campaign_name) AS campaign_name,
      max(r.account_id) AS account_id,
      max(r.account_name) AS account_name,
      max(r.account_currency) AS currency,
      min(r.day) AS started_on,
      sum(r.spend) AS spend,
      sum(r.spend_usd) AS spend_usd,
      sum(r.leads) AS leads,
      sum(r.impressions) AS impressions,
      sum(r.link_clicks) AS link_clicks,
      count(DISTINCT r.ad_id) AS ads,
      max(r.fetched_at) AS fetched_at
    FROM recent_rows r GROUP BY r.campaign_id
  ), picked AS (
    SELECT c.*, card.tag AS card_tag, card.task_id, card.url, card.ad_status,
      coalesce(nullif(btrim(card.tag), ''), bc.client_name, c.account_name) AS client_name
    FROM camp c
    LEFT JOIN LATERAL (
      SELECT s.data->>'tag' AS tag, s.data->>'taskId' AS task_id, s.data->>'url' AS url, s.data->>'adStatus' AS ad_status
      FROM public.cockpit_media_sources s
      WHERE s.table_name = 'boardCards' AND lower(btrim(s.data->>'name')) = lower(btrim(c.campaign_name))
      ORDER BY (s.data->>'updatedAt') DESC NULLS LAST LIMIT 1
    ) card ON true
    LEFT JOIN LATERAL (
      SELECT b.client_name FROM public.cockpit_board_clients b
      WHERE c.account_id = ANY(b.ad_account_ids)
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(b.ad_account_ties, '[]'::jsonb)) t WHERE t->>'account' = c.account_id)
         OR EXISTS (SELECT 1 FROM public.cockpit_board_account_ties t WHERE t.account_id = c.account_id AND t.location_id = b.location_id AND NOT t.kept_out)
      ORDER BY b.updated_at DESC NULLS LAST LIMIT 1
    ) bc ON true
    WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_meta_ad_days p WHERE p.campaign_id = c.campaign_id AND p.day < v_day - 1 AND p.spend > 0)
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_campaigns k WHERE NOT k.source_deleted
        AND (k.meta_campaign_id = c.campaign_id OR k.raw_data->>'campaignName' = c.campaign_name))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'campaignId', p.campaign_id,
      'campaignName', p.campaign_name,
      'accountId', p.account_id,
      'accountName', p.account_name,
      'clientName', p.client_name,
      'currency', p.currency,
      'startedOn', p.started_on,
      'spend', round(p.spend, 2),
      'spendUsd', round(p.spend_usd, 2),
      'leads', p.leads,
      'impressions', p.impressions,
      'linkClicks', p.link_clicks,
      'ads', p.ads,
      'fetchedAt', p.fetched_at,
      'card', CASE WHEN p.task_id IS NULL THEN NULL ELSE jsonb_build_object('taskId', p.task_id, 'url', p.url, 'adStatus', p.ad_status) END
    ) ORDER BY p.spend_usd DESC NULLS LAST, p.campaign_name), '[]'::jsonb)
  INTO v_rows
  FROM picked p
  WHERE public.cockpit_ask_ai_owner_allowed(auth.uid(), 'media-buyer', p.client_name);

  RETURN jsonb_build_object('day', v_day, 'feedAt', v_feed_at, 'rows', v_rows);
END
$function$;

REVOKE ALL ON FUNCTION public.cockpit_media_started_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_media_started_today() TO authenticated, service_role;

COMMIT;
