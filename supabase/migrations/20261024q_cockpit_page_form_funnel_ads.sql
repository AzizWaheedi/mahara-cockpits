-- "Where visitors stop" counts visits from ads by default.
-- Muhammed, 2026-10-24: "I don't want to track every lead that clicks on the
-- page because the team can test it ... Can we filter it to be just for the
-- leads that come from the ads". Approved plan: keep every visit, and let the
-- Lead page switch between "From ads" (the default) and "All visits".
--
-- A visit is from an ad when any of its events carries a Meta ad id or
-- campaign id. Those reach the page only through the ad's URL parameters
-- (ad_id={{ad.id}}, campaign_id={{campaign.id}}), which Meta fills only on a
-- real click on a live ad, and page-form-events keeps them only when they are
-- digits. fbclid alone does not count: Facebook and Instagram add it to any
-- link clicked there, a post or a bio as well as an ad.
--
-- The function gains p_ads_only (default false, so the cockpit-media-api
-- already deployed keeps working until its next release) and returns
-- counts.all and counts.ads for the range, so the switch can show both.
-- The three-argument version is dropped first: with the default, keeping it
-- would make a three-argument call ambiguous.
BEGIN;

DROP FUNCTION IF EXISTS public.cockpit_page_form_funnel(text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.cockpit_page_form_funnel(
  p_slug text, p_version text, p_since timestamptz, p_ads_only boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH f AS (
    SELECT event_hosts FROM public.cockpit_page_forms WHERE slug = p_slug
  ), e AS (
    SELECT ev.form_version, ev.screen, ev.session_id, ev.at,
           (ev.ad_id IS NOT NULL OR ev.campaign_id IS NOT NULL) AS from_ad
    FROM public.cockpit_page_form_events ev, f
    WHERE ev.slug = p_slug
      AND ev.at >= p_since
      AND ev.origin_host = ANY (f.event_hosts)
      AND ev.session_id NOT LIKE 'test-%'
  ), ad AS (
    SELECT DISTINCT session_id FROM e WHERE from_ad
  ), c AS (
    SELECT * FROM e WHERE NOT p_ads_only OR session_id IN (SELECT session_id FROM ad)
  )
  SELECT jsonb_build_object(
    'screens', (SELECT coalesce(jsonb_object_agg(screen, n), '{}'::jsonb)
                FROM (SELECT screen, count(DISTINCT session_id) AS n FROM c
                      WHERE form_version = p_version GROUP BY screen) s),
    'versions', (SELECT coalesce(jsonb_agg(jsonb_build_object('version', form_version, 'visits', n) ORDER BY form_version), '[]'::jsonb)
                 FROM (SELECT form_version, count(DISTINCT session_id) AS n FROM c GROUP BY form_version) v),
    'lastAt', (SELECT max(at) FROM c),
    'hosts', (SELECT to_jsonb(event_hosts) FROM f),
    'counts', jsonb_build_object(
      'all', (SELECT count(DISTINCT session_id) FROM e),
      'ads', (SELECT count(*) FROM ad))
  );
$$;
REVOKE ALL ON FUNCTION public.cockpit_page_form_funnel(text, text, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_page_form_funnel(text, text, timestamptz, boolean) TO service_role;

COMMIT;
