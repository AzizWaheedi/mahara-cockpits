-- The client page splits its numbers by funnel.
-- Muhammed, 2026-10-26: "when I opened the merge page, I don't know if it was
-- working on the form or on the page that we made. I think the ads page needs
-- restructuring ... this was firstly built on as the form is the only funnel
-- that we have." Approved plan (same day): one line per funnel under the
-- totals, a funnel tag on each campaign, the Lead page under Numbers with
-- Meta's clicks beside the page's visits, "From ads" fixed, and a Lead page
-- link on the board's client row.
--
-- 1. cockpit_media_funnel_kind: the funnel of one Meta ad-day row, from the
--    campaign's objective and the ad set's destination (the Meta store,
--    20261016121700). ON_AD is Meta's instant form; WhatsApp, Messenger and
--    Instagram Direct are chats; any other destination on a lead campaign is
--    a website (Meta reports a website lead ad set as UNDEFINED: Merge
--    Studio's BR_KU_web_Form, 26 Oct). A lead campaign row whose destination
--    was never read (a deleted ad set) is "unknown"; other objectives
--    (engagement, awareness, sales, traffic) are "other".
-- 2. cockpit_media_campaign_funnels: each campaign's funnel (the kind with
--    the most spend, unknown last), every kind it ran with its spend, and its
--    link clicks and landing page views in a range. The page's own numbers
--    keep coming from the media data; this read only names the funnel and
--    gives Meta's clicks for the Lead page.
-- 3. cockpit_page_forms_listed: the client form pages this seat may see,
--    through cockpit_page_form_scope (20261022q), so the board can link to a
--    client's Lead page without one read per client.
-- 4. cockpit_page_form_funnel: "From ads" also counts Meta's automatic URL
--    parameters. Since 2025 Meta adds utm_medium=paid with the campaign id in
--    utm_campaign and the ad id in utm_content to a website ad's link. Merge
--    Studio's first website campaign (26 Oct) carried only those: 10 visits
--    from its ads read "From ads 0". A visit counts when an event has a Meta
--    ad or campaign id (ad_id, campaign_id) or utm_medium=paid with a
--    numeric utm_campaign or utm_content. fbclid alone still does not count.
BEGIN;

CREATE OR REPLACE FUNCTION public.cockpit_media_funnel_kind(p_objective text, p_destination text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_destination = 'ON_AD' THEN 'form'
    WHEN p_destination LIKE '%WHATSAPP%' THEN 'whatsapp'
    WHEN p_destination LIKE '%MESSENGER%' THEN 'messenger'
    WHEN p_destination LIKE '%INSTAGRAM%' OR p_destination LIKE '%IG_DIRECT%' THEN 'instagram'
    WHEN p_destination ~ '^(LEAD_FROM_|MESSAGING_)' THEN 'chat'
    WHEN p_objective IN ('OUTCOME_LEADS', 'LEAD_GENERATION') AND p_destination IS NOT NULL THEN 'website'
    WHEN p_objective IN ('OUTCOME_LEADS', 'LEAD_GENERATION') THEN 'unknown'
    ELSE 'other'
  END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_media_funnel_kind(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_funnel_kind(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_media_campaign_funnels(
  p_campaigns text[], p_start date DEFAULT NULL, p_end date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE names text[];
BEGIN
  IF NOT (public.cockpit_has_role('media_buyer') OR public.cockpit_has_role('admin') OR public.cockpit_is_ceo()) THEN
    RAISE EXCEPTION 'Verified media-buyer access required' USING ERRCODE = '42501';
  END IF;
  IF p_campaigns IS NULL OR cardinality(p_campaigns) = 0 THEN RETURN '[]'::jsonb; END IF;
  IF cardinality(p_campaigns) > 200 THEN RAISE EXCEPTION 'Read at most 200 campaigns at once'; END IF;
  IF (p_start IS NULL) <> (p_end IS NULL) OR p_start > p_end OR p_end - p_start >= 400 THEN
    RAISE EXCEPTION 'Choose a valid range of at most 400 days';
  END IF;
  -- A campaign outside the seat's clients is left out, never named.
  SELECT coalesce(array_agg(DISTINCT n), '{}') INTO names
  FROM unnest(p_campaigns) AS n
  WHERE n IS NOT NULL AND public.cockpit_media_campaign_allowed(n) IS TRUE;
  RETURN coalesce((
    WITH r AS (
      SELECT d.campaign_name, public.cockpit_media_funnel_kind(d.objective, d.destination_type) AS kind,
             d.day, coalesce(d.spend_usd, 0) AS spend, d.link_clicks, d.landing_page_views
      FROM public.cockpit_meta_ad_days d
      WHERE d.campaign_name = ANY (names)
    ), k AS (
      SELECT campaign_name, kind, sum(spend) AS spend, max(day) AS last_day
      FROM r GROUP BY campaign_name, kind
    ), pick AS (
      SELECT DISTINCT ON (campaign_name) campaign_name, kind
      FROM k
      ORDER BY campaign_name, (kind = 'unknown'), spend DESC, last_day DESC, kind
    ), rng AS (
      SELECT campaign_name, sum(link_clicks) AS link_clicks, sum(landing_page_views) AS lpv
      FROM r
      WHERE p_start IS NOT NULL AND day BETWEEN p_start AND p_end
      GROUP BY campaign_name
    )
    SELECT jsonb_agg(jsonb_build_object(
      'campaign', p.campaign_name,
      'kind', p.kind,
      'kinds', (SELECT jsonb_agg(jsonb_build_object('kind', k.kind, 'spend', round(k.spend, 2))
                                 ORDER BY k.spend DESC, k.kind)
                FROM k WHERE k.campaign_name = p.campaign_name),
      'linkClicks', rng.link_clicks,
      'landingPageViews', rng.lpv
    ) ORDER BY p.campaign_name)
    FROM pick p LEFT JOIN rng ON rng.campaign_name = p.campaign_name
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_media_campaign_funnels(text[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_media_campaign_funnels(text[], date, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cockpit_page_forms_listed()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE scope jsonb;
BEGIN
  -- Raises for a seat that is not a confirmed media buyer, admin or founder.
  scope := public.cockpit_page_form_scope(NULL, NULL);
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'slug', f.slug, 'client', f.client_name, 'title', f.title, 'siteUrl', f.site_url
    ) ORDER BY f.slug)
    FROM public.cockpit_page_forms f
    WHERE f.slug IN (SELECT jsonb_array_elements_text(scope -> 'slugs'))
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_page_forms_listed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_page_forms_listed() TO authenticated, service_role;

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
           (ev.ad_id IS NOT NULL OR ev.campaign_id IS NOT NULL
            OR (lower(ev.utm_medium) = 'paid'
                AND (ev.utm_campaign ~ '^[0-9]{6,30}$' OR ev.utm_content ~ '^[0-9]{6,30}$'))) AS from_ad
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
