-- The funnel read also names a campaign that is on the ads board but not in
-- the cockpit's campaign list yet.
-- Muhammed, 2026-10-26: the Lead page said "No website campaign of this client
-- is on the ads board" for Merge Studio's web campaign, which had its card
-- since 17:36. The campaign list counts full days only (through yesterday), so
-- a campaign that first spent today is not listed until the next morning, and
-- cockpit_media_campaign_allowed (20260927j) only allows listed campaigns. The
-- Lead page now shows Meta's clicks for such a campaign and says it has no
-- full day in the numbers yet.
--
-- cockpit_media_campaign_funnels (20261026s), same signature and output. A
-- campaign is read when the seat may see it in the campaign list, as before,
-- or when it has a card in the current board snapshot (boardCards, 20260927w)
-- whose client the seat may see: every client for a seat with no client list,
-- an admin or a founder; otherwise the card's tag is one of the seat's
-- clients, or another current card with the same tag belongs to one of them
-- (the tag is the client: Make 9356423 counts a client's launches by it).
-- A new card's client_names is empty until its campaign is listed.

CREATE OR REPLACE FUNCTION public.cockpit_media_campaign_funnels(
  p_campaigns text[], p_start date DEFAULT NULL, p_end date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE names text[]; seat public.cockpit_members; unrestricted boolean;
BEGIN
  IF NOT (public.cockpit_has_role('media_buyer') OR public.cockpit_has_role('admin') OR public.cockpit_is_ceo()) THEN
    RAISE EXCEPTION 'Verified media-buyer access required' USING ERRCODE = '42501';
  END IF;
  IF p_campaigns IS NULL OR cardinality(p_campaigns) = 0 THEN RETURN '[]'::jsonb; END IF;
  IF cardinality(p_campaigns) > 200 THEN RAISE EXCEPTION 'Read at most 200 campaigns at once'; END IF;
  IF (p_start IS NULL) <> (p_end IS NULL) OR p_start > p_end OR p_end - p_start >= 400 THEN
    RAISE EXCEPTION 'Choose a valid range of at most 400 days';
  END IF;
  SELECT * INTO seat FROM public.cockpit_members WHERE auth_user_id = auth.uid();
  unrestricted := cardinality(seat.clients) = 0 OR 'admin' = ANY (seat.roles) OR public.cockpit_is_ceo();
  -- A campaign outside the seat's clients is left out, never named.
  WITH cards AS (
    SELECT c.data->>'name' AS name, lower(btrim(c.data->>'tag')) AS tag, c.client_names
    FROM public.cockpit_media_sources c
    JOIN public.cockpit_media_source_state st
      ON st.table_name = c.table_name AND st.source_snapshot_at = c.source_snapshot_at AND st.ready
    WHERE c.table_name = 'boardCards'
  ), mine AS (
    SELECT DISTINCT cards.tag FROM cards
    WHERE cards.tag <> '' AND (
      unrestricted
      OR EXISTS (SELECT 1 FROM unnest(seat.clients) s WHERE lower(btrim(s)) = cards.tag)
      OR EXISTS (SELECT 1 FROM unnest(cards.client_names) n, unnest(seat.clients) s
                 WHERE lower(btrim(n)) = lower(btrim(s))))
  )
  SELECT coalesce(array_agg(DISTINCT n), '{}') INTO names
  FROM unnest(p_campaigns) AS n
  WHERE n IS NOT NULL AND (
    public.cockpit_media_campaign_allowed(n) IS TRUE
    OR EXISTS (SELECT 1 FROM cards JOIN mine ON mine.tag = cards.tag WHERE cards.name = n));
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
