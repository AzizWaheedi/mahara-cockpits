-- Client Performance board: the campaign tree counts bookings by the facts' rule (2026-10-21, Creative
-- Triage bldgtotkfmhoxmlzowdx).
--
-- The audit of 2026-10-21 (cost per booking across the cockpits, R4 part C): the client page's campaign
-- tree counted every main or online booking with an ad id, so it kept the call centre's call backs and
-- moved bookings and the bookings GoHighLevel no longer holds, which the client row leaves out. On
-- Last 30 (22 Sep to 21 Oct, spend to 20 Oct) a campaign showed more bookings than its client:
--   - Alkhalil 'ALKHALIL- MAHRA-15\9': $618.17 / 6 = $103.03. Without the moved booking
--     (d60PLzjoOj8Qr9qwXnZA) and JTAbzlPF8oImhx5skXu0 (cancelled in GoHighLevel on 11 Oct) it is
--     $618.17 / 4 = $154.54. The audit's $123.63 (5) predates the second; check for $154.54.
--   - Arcturus 'Arcturus-Mahara-3\9': $1,085.29 / 26 = $41.74 -> $1,085.29 / 25 = $43.41 (the moved
--     l1Ar6ZhyTqKN4baJush0 out).
--   - Ardon 'Ardon_mahar-22\9' 8 -> 7, Ocean Home 'ocean home-mahara-9\9' 34 -> 33 and Shades
--     'Shades|mahara|17\10' 5 -> 4 bookings (the bookings GoHighLevel no longer holds). SAFAD
--     'Safad | MAHARA | 16-8' stays 4: the tree never dropped its 20 Oct booking.
-- (Counts checked read-only on 21 and 22 Oct with the rule reproduced over the live tables; spend as
-- the audit read it.)
--
-- Replaces cockpit_board_tree from its live definition (prosrc md5 1e16699defa53bde039deb1e68caf637 on 21
-- and 22 Oct, equal to 20261021a_board_skip_excluded_ads.sql): the bookings branch leaves out the ids of
-- cockpit_board_replaced_booking_ids and cockpit_board_gone_booking_ids (20261021l), nothing else.
-- Meetings due, shows and leads are as before, as in the facts. The file refuses, and changes nothing,
-- if the live body is neither that one nor this file's, so a change made since is never overwritten.
--
-- A read that fails never stops the client page (review of 2026-10-22): cockpit_board_client calls the
-- tree with no handler of its own, so the tree works the two lists out before its query, each in a
-- block of its own. If the gone check fails (say the dialer's inventory cannot be read), nothing is
-- gone and the rule still drops the call backs and moved bookings; if the rule fails, only the gone
-- bookings are dropped; if both fail, the tree counts as it did before 2026-10-21. The facts read the
-- same lists and say on their appointments source when either could not be worked out. (The tree
-- already needed the portal for its meetings, through cockpit_board_appointments; that is unchanged.)
--
-- How we know it works: apps/media-buyer-cockpit/scripts/board-booking-rule-supabase.test.ts applies
-- it after 20261021a and 20261021l (production's order) and checks the bookings an ad carries without
-- a call back, a moved booking and a booking GoHighLevel no longer holds; that the tree still answers
-- when the inventory cannot be read; the guard; and that the file applies twice.
-- Needs 20261021l. Safe to apply twice. Rollback:
-- ~/.cache/mahara-ship/rollback/board-cpb.before-20261021201100.sql (dumped when this file was named
-- 20261021201100). Nothing to re-run: the tree is read live when a client page opens.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
DECLARE v_md5 text;
BEGIN
  IF to_regprocedure('public.cockpit_board_replaced_booking_ids(text[],text[])') IS NULL
     OR to_regprocedure('public.cockpit_board_gone_booking_ids(text[])') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261021l_board_booking_rule.sql first';
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_board_tree(text,text[],date,date,jsonb,jsonb,jsonb)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('1e16699defa53bde039deb1e68caf637', '0c3652110bc32d89d7884fa14ce0a505') THEN
    RAISE EXCEPTION 'cockpit_board_tree is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_board_tree(p_location text, p_accounts text[], p_from date, p_to date,
  p_targets jsonb, p_marks jsonb, p_cover jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_now timestamptz := public.cockpit_meta_ad_days_now();
  v_start timestamptz := p_from::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_end timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_ad_ok boolean := coalesce(p_cover->>'state' IN ('full', 'partial'), false);
  v_win_to date := (p_cover->>'winTo')::date;
  v_pair_from date := (p_cover->>'pairFrom')::date;
  v_pair_to date := (p_cover->>'pairTo')::date;
  v_pair_start timestamptz := (p_cover->>'pairFrom')::date::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_pair_end timestamptz := ((p_cover->>'pairTo')::date + 1)::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_partial jsonb := CASE WHEN coalesce((p_cover->>'partial')::boolean, false)
    THEN jsonb_build_object('partial', true, 'partial_note', p_cover->>'note') ELSE '{}'::jsonb END;
  v_unmeasured jsonb := public.cockpit_board_ad_unmeasured('not_measured',
    coalesce(p_cover->>'note', 'No Meta ad account is linked to this client.'));
  v_pair_days text := CASE WHEN (p_cover->>'pairTo')::date >= (p_cover->>'pairFrom')::date
    THEN format('%s to %s', to_char((p_cover->>'pairFrom')::date, 'DD Mon'), to_char((p_cover->>'pairTo')::date, 'DD Mon')) END;
  v_out jsonb;
  -- (2026-10-21) The bookings that are not bookings, by the facts' rule.
  v_gone text[] := '{}'::text[];
  v_drop text[] := '{}'::text[];
BEGIN
  -- Not a booking, by the facts' rule (2026-10-21): bookings GoHighLevel no longer holds
  -- (cockpit_board_gone_booking_ids), the call centre's call backs and the bookings it moved while the
  -- first still counts (cockpit_board_replaced_booking_ids). Each is read in a block of its own, so a
  -- read that fails leaves the bookings as they were counted before rather than the client page broken.
  BEGIN
    SELECT coalesce(array_agg(DISTINCT g.id), '{}'::text[]) INTO v_gone
    FROM public.cockpit_board_gone_booking_ids(ARRAY[p_location]) g WHERE nullif(g.id, '') IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    v_gone := '{}'::text[];
  END;
  BEGIN
    SELECT coalesce(array_agg(DISTINCT r.id), '{}'::text[]) INTO v_drop
    FROM public.cockpit_board_replaced_booking_ids(ARRAY[p_location], v_gone) r WHERE nullif(r.id, '') IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    v_drop := '{}'::text[];
  END;
  v_drop := v_drop || v_gone;

  WITH m AS (
    -- Ad days the store holds: to yesterday, each finished on its own account's clock.
    SELECT x.* FROM public.cockpit_meta_ad_days x
    WHERE v_ad_ok AND x.account_id = ANY(coalesce(p_accounts, '{}'::text[])) AND x.day BETWEEN p_from AND v_win_to
      AND x.day < (v_now AT TIME ZONE coalesce(x.account_timezone, 'Asia/Kuwait'))::date
      -- Never an ad on the compromise list (cockpit_excluded_ads), matched on the ad id alone.
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xa WHERE xa.ad_id = x.ad_id)
  ), names AS (
    SELECT DISTINCT ON (x.ad_id) x.ad_id, x.ad_name, x.adset_id, x.adset_name, x.campaign_id, x.campaign_name, x.objective,
      x.destination_type, x.account_id
    FROM public.cockpit_meta_ad_days x
    WHERE x.account_id = ANY(coalesce(p_accounts, '{}'::text[]))
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xa WHERE xa.ad_id = x.ad_id)
    ORDER BY x.ad_id, x.day DESC
  ), ap AS (
    SELECT * FROM public.cockpit_board_appointments(p_location, p_from, p_to, p_marks)
  ), crm AS (
    SELECT k.ad_id, sum(k.leads) AS leads, sum(k.bookings) AS bookings, sum(k.bookings_ad) AS bookings_ad, sum(k.shows) AS shows,
      sum(k.no_shows) AS no_shows, sum(k.due) AS due
    FROM (
      SELECT nullif(btrim(l.ad_id), '') AS ad_id, 1 AS leads, 0 AS bookings, 0 AS bookings_ad, 0 AS shows, 0 AS no_shows, 0 AS due
      FROM public.client_leads l
      LEFT JOIN mahara_reporting.facts f ON f.namespace = 'production' AND f.source = 'ghl' AND f.kind = 'contact'
        AND f.external_id = l.location_id || ':' || l.ghl_contact_id
      WHERE l.location_id = p_location AND NOT coalesce(l.deleted, false) AND l.created_at >= v_start AND l.created_at < v_end
        -- A WhatsApp chat (no ad, no campaign, tagged inbound whatsapp) is not a lead, as in the facts' CRM leads.
        AND NOT (nullif(l.ad_id, '') IS NULL AND nullif(l.campaign_id, '') IS NULL
                 AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.data->'tags') = 'array'
                              THEN f.data->'tags' ELSE '[]'::jsonb END) tg(x) WHERE lower(btrim(tg.x)) = 'inbound whatsapp'))
      UNION ALL
      -- bookings_ad: made on the days cost per booking divides over (every linked account stored).
      SELECT a.ad_id, 0, 1, CASE WHEN a.booked_at >= v_pair_start AND a.booked_at < v_pair_end THEN 1 ELSE 0 END, 0, 0, 0 FROM ap a
      WHERE a.kind IN ('main', 'online') AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid')
        AND a.booked_at >= v_start AND a.booked_at < v_end
        -- Before 2026-10-21 the tree dropped none of these, so a campaign could show more bookings than
        -- its client's row. Meetings due below are as before.
        AND NOT (a.id = ANY(v_drop))
      UNION ALL
      -- Every meeting due, and its mark: unmarked is never a no-show.
      SELECT a.ad_id, 0, 0, 0, (a.attendance = 'showed')::int, (a.attendance = 'noshow')::int, 1 FROM ap a WHERE a.due
    ) k
    GROUP BY k.ad_id
  ), per_ad AS (
    SELECT n.ad_id, n.adset_id, n.campaign_id,
      count(m.ad_id) AS rows, sum(m.spend_usd) AS spend, count(*) FILTER (WHERE m.spend IS NOT NULL AND m.spend_usd IS NULL) AS unpriced,
      sum(m.impressions) AS imp, sum(m.link_clicks) AS clicks,
      count(*) FILTER (WHERE m.leads IS NOT NULL) AS lead_rows, sum(m.leads) AS leads,
      sum(m.spend_usd) FILTER (WHERE m.leads IS NOT NULL) AS lead_spend, sum(m.link_clicks) FILTER (WHERE m.leads IS NOT NULL) AS lead_clicks,
      count(*) FILTER (WHERE m.video_3s IS NOT NULL) AS video_rows, sum(m.impressions) FILTER (WHERE m.video_3s IS NOT NULL) AS video_imp,
      sum(m.video_3s) AS v3, sum(m.thruplays) FILTER (WHERE m.video_3s IS NOT NULL) AS thru,
      sum(m.video_plays) AS plays, sum(m.video_p25) FILTER (WHERE m.video_plays IS NOT NULL) AS p25,
      sum(m.video_p50) FILTER (WHERE m.video_plays IS NOT NULL) AS p50, sum(m.video_p75) FILTER (WHERE m.video_plays IS NOT NULL) AS p75,
      sum(m.video_p100) FILTER (WHERE m.video_plays IS NOT NULL) AS p100,
      sum(m.impressions * m.frequency) FILTER (WHERE m.frequency > 0) AS freq_w, sum(m.impressions) FILTER (WHERE m.frequency > 0) AS freq_imp,
      sum(m.spend_usd) FILTER (WHERE m.day BETWEEN v_pair_from AND v_pair_to) AS pair_spend,
      count(*) FILTER (WHERE m.day BETWEEN v_pair_from AND v_pair_to AND m.spend IS NOT NULL AND m.spend_usd IS NULL) AS pair_unpriced,
      coalesce(c.leads, 0) AS crm_leads, coalesce(c.bookings, 0) AS crm_bookings, coalesce(c.bookings_ad, 0) AS crm_bookings_ad,
      coalesce(c.shows, 0) AS crm_shows, coalesce(c.no_shows, 0) AS crm_no_shows, coalesce(c.due, 0) AS crm_due
    FROM names n
    LEFT JOIN m ON m.ad_id = n.ad_id
    LEFT JOIN crm c ON c.ad_id = n.ad_id
    WHERE EXISTS (SELECT 1 FROM m m2 WHERE m2.ad_id = n.ad_id) OR c.ad_id IS NOT NULL
    GROUP BY n.ad_id, n.adset_id, n.campaign_id, c.leads, c.bookings, c.bookings_ad, c.shows, c.no_shows, c.due
  ), lvl AS (
    SELECT 'ad'::text AS level, a.ad_id AS key, a.adset_id, a.campaign_id, to_jsonb(a) - 'ad_id' - 'adset_id' - 'campaign_id' AS s
    FROM per_ad a
    UNION ALL
    SELECT 'adset', x.adset_id, x.adset_id, x.campaign_id, to_jsonb(x) - 'adset_id' - 'campaign_id'
    FROM (SELECT a.adset_id, min(a.campaign_id) AS campaign_id, sum(a.rows) AS rows, sum(a.spend) AS spend, sum(a.unpriced) AS unpriced,
            sum(a.imp) AS imp, sum(a.clicks) AS clicks, sum(a.lead_rows) AS lead_rows, sum(a.leads) AS leads, sum(a.lead_spend) AS lead_spend,
            sum(a.lead_clicks) AS lead_clicks, sum(a.video_rows) AS video_rows, sum(a.video_imp) AS video_imp, sum(a.v3) AS v3, sum(a.thru) AS thru,
            sum(a.plays) AS plays, sum(a.p25) AS p25, sum(a.p50) AS p50, sum(a.p75) AS p75, sum(a.p100) AS p100,
            sum(a.freq_w) AS freq_w, sum(a.freq_imp) AS freq_imp, sum(a.pair_spend) AS pair_spend, sum(a.pair_unpriced) AS pair_unpriced,
            sum(a.crm_leads) AS crm_leads, sum(a.crm_bookings) AS crm_bookings,
            sum(a.crm_bookings_ad) AS crm_bookings_ad, sum(a.crm_shows) AS crm_shows, sum(a.crm_no_shows) AS crm_no_shows,
            sum(a.crm_due) AS crm_due
          FROM per_ad a GROUP BY a.adset_id) x
    UNION ALL
    SELECT 'campaign', x.campaign_id, NULL, x.campaign_id, to_jsonb(x) - 'campaign_id'
    FROM (SELECT a.campaign_id, sum(a.rows) AS rows, sum(a.spend) AS spend, sum(a.unpriced) AS unpriced,
            sum(a.imp) AS imp, sum(a.clicks) AS clicks, sum(a.lead_rows) AS lead_rows, sum(a.leads) AS leads, sum(a.lead_spend) AS lead_spend,
            sum(a.lead_clicks) AS lead_clicks, sum(a.video_rows) AS video_rows, sum(a.video_imp) AS video_imp, sum(a.v3) AS v3, sum(a.thru) AS thru,
            sum(a.plays) AS plays, sum(a.p25) AS p25, sum(a.p50) AS p50, sum(a.p75) AS p75, sum(a.p100) AS p100,
            sum(a.freq_w) AS freq_w, sum(a.freq_imp) AS freq_imp, sum(a.pair_spend) AS pair_spend, sum(a.pair_unpriced) AS pair_unpriced,
            sum(a.crm_leads) AS crm_leads, sum(a.crm_bookings) AS crm_bookings,
            sum(a.crm_bookings_ad) AS crm_bookings_ad, sum(a.crm_shows) AS crm_shows, sum(a.crm_no_shows) AS crm_no_shows,
            sum(a.crm_due) AS crm_due
          FROM per_ad a GROUP BY a.campaign_id) x
  ), reach AS (
    SELECT DISTINCT ON (x.level, x.key) x.level, x.key, jsonb_build_object('reach', x.reach, 'impressions', x.impressions, 'note', x.note) AS j
    FROM public.cockpit_meta_reach x
    JOIN public.cockpit_meta_reach_windows(v_today) w ON w.window_key = x.window_key AND w.from_day = x.from_day AND w.to_day = x.to_day
    WHERE x.level IN ('campaign', 'adset', 'ad') AND w.from_day = p_from AND w.to_day = p_to
    ORDER BY x.level, x.key, (x.reach IS NOT NULL) DESC
  ), node AS (
    SELECT l.level, l.key, l.adset_id, l.campaign_id, (l.s->>'spend')::numeric AS spend,
      CASE WHEN v_ad_ok THEN public.cockpit_board_ad_cells(l.s || v_partial, p_targets, rr.j) ELSE v_unmeasured END
      || jsonb_build_object(
        'crmLeads', jsonb_build_object('v', (l.s->>'crm_leads')::numeric, 'status', NULL),
        'confirmedBookings', jsonb_build_object('v', (l.s->>'crm_bookings')::numeric, 'status', NULL),
        'shows', public.cockpit_board_shows((l.s->>'crm_shows')::numeric, (l.s->>'crm_no_shows')::numeric, (l.s->>'crm_due')::numeric),
        'costPerBooking', CASE
          WHEN NOT v_ad_ok THEN public.cockpit_board_cell('cost_per_booking', NULL, p_targets, NULL, NULL, NULL, 'not_measured', p_cover->>'note')
          WHEN v_pair_days IS NULL THEN public.cockpit_board_cell('cost_per_booking', NULL, p_targets, NULL, NULL, NULL, 'not_measured',
            'No day of this time frame is over on every linked ad account''s clock yet.')
          WHEN coalesce((l.s->>'pair_unpriced')::numeric, 0) > 0 AND coalesce((l.s->>'pair_spend')::numeric, 0) = 0 THEN
            public.cockpit_board_cell('cost_per_booking', NULL, p_targets, NULL, NULL, NULL, 'not_measured', 'The spend is in a currency with no fixed USD rate.')
          WHEN (l.s->>'crm_bookings_ad')::numeric > 0 AND (l.s->>'pair_spend') IS NOT NULL THEN
            public.cockpit_board_cell('cost_per_booking', round((l.s->>'pair_spend')::numeric / (l.s->>'crm_bookings_ad')::numeric, 2), p_targets,
              (l.s->>'crm_bookings_ad')::numeric, round((l.s->>'pair_spend')::numeric, 2), (l.s->>'crm_bookings_ad')::numeric,
              CASE WHEN (l.s->>'pair_unpriced')::numeric > 0 THEN public.cockpit_board_floor_status('cost_per_booking',
                round((l.s->>'pair_spend')::numeric / (l.s->>'crm_bookings_ad')::numeric, 2), p_targets) END,
              format('Confirmed bookings with this ad id and spend over the same days, %s.', v_pair_days),
              CASE WHEN (l.s->>'pair_unpriced')::numeric > 0 THEN jsonb_build_object('atLeast', true) END)
          WHEN coalesce((l.s->>'pair_spend')::numeric, 0) > 0 THEN
            public.cockpit_board_cell('cost_per_booking', NULL, p_targets, 0, round((l.s->>'pair_spend')::numeric, 2), 0,
              public.cockpit_board_floor_status('cost_per_booking', round((l.s->>'pair_spend')::numeric, 2), p_targets),
              format('No confirmed booking with this ad id yet, %s.', v_pair_days), jsonb_build_object('atLeast', round((l.s->>'pair_spend')::numeric, 2)))
          ELSE public.cockpit_board_cell('cost_per_booking', NULL, p_targets, 0, NULL, NULL, 'too_few', 'No spend in these days.') END) AS metrics
    FROM lvl l LEFT JOIN reach rr ON rr.level = l.level AND rr.key = l.key
  ), ads AS (
    SELECT n.adset_id, jsonb_agg(jsonb_build_object('id', n.key, 'name', nm.ad_name, 'metrics', n.metrics)
             ORDER BY n.spend DESC NULLS LAST, nm.ad_name, n.key) AS j
    FROM node n JOIN names nm ON nm.ad_id = n.key WHERE n.level = 'ad' GROUP BY n.adset_id
  ), sets AS (
    SELECT n.campaign_id, jsonb_agg(jsonb_build_object('id', n.key, 'name', sn.adset_name, 'destination', sn.destination_type,
             'metrics', n.metrics, 'ads', coalesce(ads.j, '[]'::jsonb)) ORDER BY n.spend DESC NULLS LAST, sn.adset_name, n.key) AS j
    FROM node n
    LEFT JOIN LATERAL (SELECT x.adset_name, x.destination_type FROM names x WHERE x.adset_id = n.key LIMIT 1) sn ON true
    LEFT JOIN ads ON ads.adset_id = n.key
    WHERE n.level = 'adset' GROUP BY n.campaign_id
  ), camps AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', n.key, 'name', cn.campaign_name, 'objective', cn.objective, 'accountId', cn.account_id,
             'metrics', n.metrics, 'adsets', coalesce(sets.j, '[]'::jsonb)) ORDER BY n.spend DESC NULLS LAST, cn.campaign_name, n.key), '[]'::jsonb) AS j
    FROM node n
    LEFT JOIN LATERAL (SELECT x.campaign_name, x.objective, x.account_id FROM names x WHERE x.campaign_id = n.key LIMIT 1) cn ON true
    LEFT JOIN sets ON sets.campaign_id = n.key
    WHERE n.level = 'campaign'
  ), stray AS (
    SELECT
      coalesce(jsonb_agg(jsonb_build_object('adId', c.ad_id, 'crmLeads', c.leads, 'confirmedBookings', c.bookings,
          'shows', public.cockpit_board_shows(c.shows, c.no_shows, c.due))
        ORDER BY c.leads DESC, c.ad_id) FILTER (WHERE c.ad_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM names n WHERE n.ad_id = c.ad_id))
        , '[]'::jsonb) AS not_in_store,
      jsonb_build_object('crmLeads', coalesce(sum(c.leads) FILTER (WHERE c.ad_id IS NULL), 0),
        'confirmedBookings', coalesce(sum(c.bookings) FILTER (WHERE c.ad_id IS NULL), 0),
        'shows', public.cockpit_board_shows(coalesce(sum(c.shows) FILTER (WHERE c.ad_id IS NULL), 0),
          coalesce(sum(c.no_shows) FILTER (WHERE c.ad_id IS NULL), 0), coalesce(sum(c.due) FILTER (WHERE c.ad_id IS NULL), 0))) AS no_ad
    FROM crm c
  )
  SELECT jsonb_build_object('campaigns', camps.j, 'notInStore', stray.not_in_store, 'noAd', stray.no_ad)
  INTO v_out FROM camps, stray;
  RETURN v_out;
END $$;

-- Privileges, as live on 2026-10-21: nobody but the owner (cockpit_board_client calls it as definer).
REVOKE ALL ON FUNCTION public.cockpit_board_tree(text,text[],date,date,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
