-- One client's numbers over any range, for the media buyer's client page (cost per
-- booking, build 2, 22 Oct 2026; docs/client-performance/CPB-BUILD2-CONTRACT.md 2.5,
-- audit R8; Creative Triage bldgtotkfmhoxmlzowdx).
--
-- The client page added up the campaigns the cockpit still lists, so a stopped
-- campaign's spend and bookings fell out of the client's totals (Khalida's month to
-- 20 Oct read $91.62 where Mahara's campaigns spent $191.53), and a client whose
-- campaigns had all stopped (ARCWANI, Liwan) could not be opened. This read counts
-- the client the way the Client Performance board does, by its ad accounts
-- (cockpit_board_clients, one row per GoHighLevel location):
-- - spend and leads: Mahara's campaigns on the client's ad accounts, stopped and deleted
--   ones included. Mahara's = a campaign that has, or had, a card on the Ads Management
--   board (taskId, task_id, a retired card or onBoard on any of its cockpit_campaigns
--   rows), never an internal one. Rows from cockpit_media_daily_stats, one per ad and
--   day (the newest import: a renamed campaign repeats its rows), on the row's own
--   accountId, else the campaign's newest meta_account_id. An ad still kept under a
--   name the cockpit no longer lists belongs to the Mahara campaign that carries it.
-- - offBoardSpend: the rest of the same accounts in the board's Meta store
--   (cockpit_meta_ad_days, whole account): campaigns that are not Mahara's, the
--   client's own (Shades' pre-launch campaign, D0d) or outsiders' (SAFAD's "New
--   Engagement Campaign", D0a not built). A campaign is Mahara's there by its Meta id,
--   else by its name on one of its own ad accounts. Named beside the total, never in it.
-- - excludedSpend: ads on the compromise list (cockpit_excluded_ads), out of both, summed
--   from the Meta store, whole account (the media data held less of Liwan's and Khalida's
--   listed ads than Meta did in October).
-- - bookings: the board's rule, confirmed bookings by booking day from
--   cockpit_client_days for the location. Null with the reason when a day is not stored
--   or the client books its own meetings (Done with you). mediaBookings is the second
--   source: the media sync's booking events on the same location and days, null where
--   the sync cannot be tied to the client (Done with you, or no ad account of its own
--   and no event carrying its location).
-- - costPerBooking: spend / bookings when both are known and both are above 0. Bookings
--   with no spend counted on Mahara's campaigns have no cost per booking (null, with why).
--   The Meta store is the second source for spend: when it holds a Mahara campaign on a
--   day the media data does not (Khalida's "...mahara-29/8", 1 to 6 Sep, $133.82), the
--   spend shown leaves that out, the cost per booking is null and why names the amount.
-- - the days counted: from countedFrom = greatest(p_start, the first day the sources
--   vouch for) to through = least(p_end, cockpit_media_week()->>'through'), so spend and
--   bookings cover the same days. The first day the sources vouch for is the day after
--   the cockpit's campaign list was first imported (min(created_at) of cockpit_campaigns,
--   Kuwait time: 23 Sep 2026 23:30, so 24 Sep 2026), and never before the first day of
--   the media data or of the Meta store. Before the list existed, a campaign that had
--   stopped and left it is missing, so Mahara's campaigns cannot be told from the
--   client's own: in September Atlantis's "Atlantis-mahara-30\8" read as off board and
--   Joe and Sera read $0.00 a booking. Days before it are not counted, and why says so.
--   When nothing can be counted every figure is null.
-- An ad account linked to two locations counts once, under the first location_id, and
-- both rows say so; the other location's spend, leads and cost per booking are null.
-- Missing is never zero: what cannot be known is null, with `why`.
--
-- Gate: media buyer, admin or the CEO (42501 otherwise). A seat with a client list reads
-- a client when one of its campaigns is the seat's (cockpit_media_campaign_allowed); a
-- note about a shared account names the other client only when the seat may read it.
-- EXECUTE for authenticated (the page calls it), never anon or PUBLIC.
-- New here: the file refuses when the function exists with a body it did not write.
-- Safe to run twice. Needs 20261022w (cockpit_media_week).
-- Test: apps/media-buyer-cockpit/scripts/media-client-range-supabase.test.ts.
-- Rollback: DROP FUNCTION public.cockpit_media_client_range(date,date,text[]) after the
-- media buyer's previous deployment is promoted.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v_md5 text;
BEGIN
  IF to_regprocedure('public.cockpit_media_week()') IS NULL THEN
    RAISE EXCEPTION 'cockpit_media_week is missing: apply 20261022w_media_week.sql first';
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_media_client_range(date,date,text[])');
  IF v_md5 IS NOT NULL AND v_md5 <> '2f4af67417887e8ad81e17adb2a5958e' THEN
    RAISE EXCEPTION 'cockpit_media_client_range is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', v_md5;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.cockpit_media_client_range(p_start date, p_end date, p_accounts text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_week jsonb;
  v_listed date;
  v_media_first date;
  v_meta_first date;
  v_floor date;
  v_from date;
  v_through date;
  v_days integer;
  v_range_why text;
  v_accounts text[];
  v_all boolean;
  v_books boolean;
  v_out jsonb;
BEGIN
  IF NOT (public.cockpit_has_role('media_buyer') OR public.cockpit_has_role('admin') OR public.cockpit_is_ceo()) THEN
    RAISE EXCEPTION 'Verified media-buyer access required' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_start > p_end OR p_end - p_start >= 400 THEN
    RAISE EXCEPTION 'Choose a valid range of at most 400 days';
  END IF;
  IF p_accounts IS NOT NULL THEN
    IF cardinality(p_accounts) > 200 THEN
      RAISE EXCEPTION 'Read at most 200 ad accounts at once';
    END IF;
    SELECT coalesce(array_agg(DISTINCT regexp_replace(btrim(a), '^act_', '', 'i')), '{}'::text[])
      INTO v_accounts FROM unnest(p_accounts) a WHERE a IS NOT NULL;
    IF EXISTS (SELECT 1 FROM unnest(v_accounts) a WHERE a !~ '^[0-9]{5,25}$') THEN
      RAISE EXCEPTION 'An ad account id is its digits, with or without act_';
    END IF;
  END IF;
  SELECT min(d.day) INTO v_media_first FROM public.cockpit_media_daily_stats d;
  IF v_media_first IS NULL OR NOT EXISTS (SELECT 1 FROM public.cockpit_media_feed_state WHERE feed = 'dailyStats' AND ready) THEN
    RAISE EXCEPTION 'Daily statistics history has not been imported and verified yet';
  END IF;
  -- The day after the cockpit's campaign list was first imported (Kuwait time): before it,
  -- a campaign that had stopped and left the list is missing from it.
  SELECT (min(c.created_at) AT TIME ZONE 'Asia/Kuwait')::date + 1 INTO v_listed FROM public.cockpit_campaigns c;
  IF v_listed IS NULL THEN
    RAISE EXCEPTION 'The cockpit''s campaign list has not been imported yet';
  END IF;
  SELECT min(m.day) INTO v_meta_first FROM public.cockpit_meta_ad_days m;

  -- Every figure counts from the first day the sources vouch for to the paired day: the
  -- range's end, or the media sync's 7-day end when the range runs past it
  -- (cockpit_media_week, 20261022w).
  v_floor := greatest(v_listed, v_media_first, v_meta_first);
  v_from := greatest(p_start, v_floor);
  v_week := public.cockpit_media_week();
  v_through := least(p_end, (v_week->>'through')::date);
  v_days := CASE WHEN v_through >= v_from THEN v_through - v_from + 1 END;
  v_range_why := nullif(concat_ws(' ',
    CASE WHEN p_start < v_floor THEN
      CASE WHEN v_floor = v_listed
        THEN format('The cockpit''s campaign list starts on %s, so spend before it cannot be split into Mahara''s campaigns and the client''s own', to_char(v_floor, 'FMDD Mon YYYY'))
        ELSE format('Meta''s numbers are stored from %s, so the days before it are not counted', to_char(v_floor, 'FMDD Mon YYYY')) END
      || CASE WHEN v_days IS NOT NULL THEN format('; these numbers count from %s.', to_char(v_from, 'FMDD Mon YYYY')) ELSE '.' END END,
    CASE WHEN v_days IS NULL AND p_end >= v_floor THEN 'Meta''s numbers for these days are not in yet.' END), '');
  v_books := EXISTS (SELECT 1 FROM public.cockpit_media_feed_state WHERE feed = 'bookingEvents' AND ready);
  -- A seat with no client list (the CEO, an admin, an unrestricted media buyer) reads every
  -- client; a restricted seat reads a client when one of its campaigns is the seat's
  -- (cockpit_media_campaign_allowed).
  v_all := public.cockpit_is_ceo() OR public.cockpit_has_role('admin') OR EXISTS (
    SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id = m.auth_user_id
    WHERE m.auth_user_id = auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL
      AND m.email = lower(btrim(u.email)) AND cardinality(m.clients) = 0);

  WITH camp AS (
    -- One row per campaign the cockpit lists or listed (stopped and deleted rows too).
    -- Mahara's: it has, or had, a card on the Ads Management board.
    SELECT c.raw_data->>'campaignName' AS name,
      bool_or(coalesce(nullif(btrim(c.raw_data->>'taskId'), ''), nullif(btrim(c.task_id), ''),
                       nullif(btrim(c.raw_data->>'retiredTaskId'), ''), nullif(btrim(c.raw_data->>'taskUrl'), ''),
                       nullif(btrim(c.task_url), '')) IS NOT NULL OR c.raw_data->>'onBoard' = 'true') AS carded,
      bool_or(coalesce(c.raw_data->>'internal', 'false') = 'true') AS internal,
      bool_or(NOT c.source_deleted) AS live,
      (array_agg(regexp_replace(btrim(coalesce(nullif(btrim(c.meta_account_id), ''), c.raw_data->>'metaAccountId')), '^act_', '', 'i')
         ORDER BY c.updated_at DESC NULLS LAST, c.id DESC)
         FILTER (WHERE coalesce(nullif(btrim(c.meta_account_id), ''), nullif(btrim(c.raw_data->>'metaAccountId'), '')) IS NOT NULL))[1] AS account,
      array_agg(DISTINCT regexp_replace(btrim(coalesce(nullif(btrim(c.meta_account_id), ''), c.raw_data->>'metaAccountId')), '^act_', '', 'i'))
        FILTER (WHERE coalesce(nullif(btrim(c.meta_account_id), ''), nullif(btrim(c.raw_data->>'metaAccountId'), '')) IS NOT NULL) AS accounts,
      array_agg(DISTINCT coalesce(nullif(btrim(c.raw_data->>'metaCampaignId'), ''), nullif(btrim(c.meta_campaign_id), '')))
        FILTER (WHERE coalesce(nullif(btrim(c.raw_data->>'metaCampaignId'), ''), nullif(btrim(c.meta_campaign_id), '')) IS NOT NULL) AS meta_ids
    FROM public.cockpit_campaigns c
    WHERE nullif(c.raw_data->>'campaignName', '') IS NOT NULL
    GROUP BY 1
  ), mahara AS (
    SELECT * FROM camp WHERE carded AND NOT internal
  ), known AS (
    -- Campaigns that are not the client's own or outsiders': Mahara's and Mahara's internal
    -- ones, by Meta id, and by name on each of their own ad accounts (any account when the
    -- cockpit holds none for them).
    SELECT c.name, c.carded AND NOT c.internal AS mahara, i.meta_id, a.account
    FROM camp c
    LEFT JOIN LATERAL unnest(c.meta_ids) i(meta_id) ON true
    LEFT JOIN LATERAL unnest(c.accounts) a(account) ON true
    WHERE c.carded OR c.internal
  ), cl AS (
    SELECT b.location_id, b.clickup_id, b.client_name, b.service_mode, b.status,
      coalesce((SELECT array_agg(DISTINCT regexp_replace(btrim(a), '^act_', '', 'i') ORDER BY regexp_replace(btrim(a), '^act_', '', 'i'))
                FROM unnest(b.ad_account_ids) a WHERE nullif(btrim(a), '') IS NOT NULL), '{}'::text[]) AS accounts
    FROM public.cockpit_board_clients b
  ), own AS (
    -- An ad account linked to two locations counts once, under the first.
    SELECT DISTINCT ON (x.acc) x.acc, x.location_id
    FROM (SELECT cl.location_id, unnest(cl.accounts) AS acc FROM cl) x
    ORDER BY x.acc, x.location_id
  ), vis AS (
    SELECT cl.location_id FROM cl
    WHERE v_all OR EXISTS (SELECT 1 FROM camp c WHERE c.account = ANY(cl.accounts) AND public.cockpit_media_campaign_allowed(c.name))
  ), shared AS (
    -- Both rows say where a shared account counts; the other client is named only to a seat
    -- that may read it.
    SELECT x.location_id, string_agg(x.note, ' ' ORDER BY x.acc, x.note) AS note
    FROM (
      SELECT cl.location_id, a.acc, format('Ad account %s is also linked to %s, so its numbers count there.', a.acc,
        CASE WHEN EXISTS (SELECT 1 FROM vis v WHERE v.location_id = oc.location_id) THEN oc.client_name ELSE 'another client' END) AS note
      FROM cl CROSS JOIN LATERAL unnest(cl.accounts) a(acc)
      JOIN own o ON o.acc = a.acc AND o.location_id <> cl.location_id
      JOIN cl oc ON oc.location_id = o.location_id
      UNION ALL
      SELECT o.location_id, o.acc, format('Ad account %s is also linked to %s; its spend counts here, once, against this client''s bookings only.', o.acc,
        string_agg(CASE WHEN EXISTS (SELECT 1 FROM vis v WHERE v.location_id = oc.location_id) THEN oc.client_name ELSE 'another client' END,
                   ' and ' ORDER BY oc.client_name))
      FROM own o JOIN cl oc ON o.acc = ANY(oc.accounts) AND oc.location_id <> o.location_id
      GROUP BY o.location_id, o.acc
    ) x
    GROUP BY x.location_id
  ), drows AS (
    SELECT d.campaign_name, d.day, d.data, d.source_id, d.imported_at,
      coalesce(nullif(d.data->>'metaAdId', ''), d.campaign_name || '|' || nullif(d.data->>'adName', ''), d.source_id) AS ad_key
    FROM public.cockpit_media_daily_stats d
    WHERE d.day BETWEEN v_from AND v_through
  ), one AS (
    -- One row per ad and day, the newest import (a renamed campaign repeats its rows).
    SELECT DISTINCT ON (r.ad_key, r.day) r.* FROM drows r
    ORDER BY r.ad_key, r.day, r.imported_at DESC NULLS LAST, r.source_id DESC
  ), ad_home AS (
    -- An ad kept under a name the cockpit no longer lists belongs to the Mahara campaign that carries it.
    SELECT DISTINCT ON (d.data->>'metaAdId') d.data->>'metaAdId' AS ad_id, d.campaign_name
    FROM public.cockpit_media_daily_stats d JOIN mahara m ON m.name = d.campaign_name
    WHERE nullif(d.data->>'metaAdId', '') IS NOT NULL
    ORDER BY d.data->>'metaAdId', d.day DESC, d.imported_at DESC NULLS LAST
  ), ads AS (
    -- Mahara's ad-days, each on its ad account: the row's own accountId, else its campaign's newest account.
    SELECT coalesce(m.name, mh.name) AS campaign_name, o.day,
      coalesce((o.data->>'spend')::numeric, 0) AS spend, coalesce((o.data->>'leads')::numeric, 0) AS leads,
      coalesce(nullif(regexp_replace(btrim(o.data->>'accountId'), '^act_', '', 'i'), ''), m.account, mh.account) AS account,
      EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xa WHERE xa.ad_id = coalesce(nullif(o.data->>'metaAdId', ''), o.source_id)) AS excluded
    FROM one o
    LEFT JOIN mahara m ON m.name = o.campaign_name
    LEFT JOIN ad_home h ON m.name IS NULL AND h.ad_id = o.data->>'metaAdId'
    LEFT JOIN mahara mh ON mh.name = h.campaign_name
    WHERE m.name IS NOT NULL OR mh.name IS NOT NULL
  ), msp AS (
    SELECT o.location_id,
      sum(a.spend) FILTER (WHERE NOT a.excluded) AS spend,
      sum(a.leads) FILTER (WHERE NOT a.excluded) AS leads
    FROM ads a JOIN own o ON o.acc = a.account
    GROUP BY o.location_id
  ), mrows AS (
    -- The board's Meta store, whole accounts: each ad-day under the client that owns its account,
    -- with the cockpit's campaign it is (by Meta id first), if any, and whether the media data
    -- holds that campaign on that day.
    SELECT o.location_id, m.spend, m.spend_usd,
      EXISTS (SELECT 1 FROM public.cockpit_excluded_ads xa WHERE xa.ad_id = m.ad_id) AS excluded,
      k.name IS NULL AS off, coalesce(k.mahara, false) AS mahara, md.day IS NOT NULL AS in_media
    FROM public.cockpit_meta_ad_days m
    JOIN own o ON o.acc = m.account_id
    LEFT JOIN LATERAL (
      SELECT k.name, k.mahara FROM known k
      WHERE k.meta_id = m.campaign_id OR (k.name = m.campaign_name AND (k.account IS NULL OR k.account = m.account_id))
      ORDER BY (k.meta_id = m.campaign_id) DESC NULLS LAST, k.mahara DESC, k.name
      LIMIT 1) k ON true
    LEFT JOIN (SELECT DISTINCT a.campaign_name, a.day FROM ads a) md ON md.campaign_name = k.name AND md.day = m.day
    WHERE m.day BETWEEN v_from AND v_through
  ), offb AS (
    -- offBoardSpend: campaigns that are not Mahara's (the client's own, or outsiders'). excluded:
    -- every ad on the compromise list, Mahara's campaigns or not (the media data can hold less
    -- of a listed ad than Meta does). Both named beside the total, never in it. missing: Mahara's
    -- campaign-days Meta holds and the media data does not, so `spend` is at least the total.
    SELECT r.location_id,
      sum(r.spend_usd) FILTER (WHERE r.off AND NOT r.excluded) AS spend,
      count(*) FILTER (WHERE r.off AND NOT r.excluded AND r.spend > 0 AND r.spend_usd IS NULL) AS unpriced,
      sum(r.spend_usd) FILTER (WHERE r.excluded) AS excluded,
      count(*) FILTER (WHERE r.mahara AND NOT r.in_media AND NOT r.excluded AND r.spend > 0) AS missing_rows,
      sum(r.spend_usd) FILTER (WHERE r.mahara AND NOT r.in_media AND NOT r.excluded AND r.spend > 0) AS missing
    FROM mrows r
    GROUP BY r.location_id
  ), ev AS (
    -- The media sync's bookings (second source), one per event, on the client's location,
    -- else on the client of its campaign's account.
    SELECT e.campaign_name, coalesce(lc.location_id, o.location_id) AS location_id
    FROM (SELECT DISTINCT ON (coalesce(nullif(e.data->>'eventId', ''), e.source_id)) e.*
          FROM public.cockpit_media_booking_events e
          WHERE v_books AND e.day BETWEEN v_from AND v_through
          ORDER BY coalesce(nullif(e.data->>'eventId', ''), e.source_id), e.imported_at DESC NULLS LAST) e
    LEFT JOIN cl lc ON lc.location_id = e.data->>'locationId'
    LEFT JOIN camp c ON c.name = e.campaign_name
    LEFT JOIN own o ON o.acc = c.account
  ), evc AS (
    SELECT location_id, count(*) AS n FROM ev WHERE location_id IS NOT NULL GROUP BY location_id
  ), bk AS (
    -- The board's rule: confirmed bookings by booking day (cockpit_client_days).
    SELECT d.location_id, sum(d.confirmed_bookings) AS booked, count(d.confirmed_bookings) AS stored
    FROM public.cockpit_client_days d
    WHERE d.day BETWEEN v_from AND v_through
    GROUP BY d.location_id
  ), cs AS (
    -- Each client's campaigns that spent or booked in these days.
    SELECT z.location_id, z.campaign_name, sum(z.spend) AS spend, sum(z.leads) AS leads, sum(z.n) AS n
    FROM (
      SELECT o.location_id, a.campaign_name, a.spend, a.leads, 0 AS n FROM ads a JOIN own o ON o.acc = a.account WHERE NOT a.excluded
      UNION ALL
      SELECT ev.location_id, ev.campaign_name, 0, 0, 1 FROM ev JOIN mahara m ON m.name = ev.campaign_name WHERE ev.location_id IS NOT NULL
    ) z GROUP BY z.location_id, z.campaign_name
  ), pick AS (
    -- With no account given: the clients with spend on Mahara's campaigns or bookings in the
    -- range (spend off Mahara's campaigns alone does not list a client).
    SELECT cl.* FROM cl JOIN vis ON vis.location_id = cl.location_id
    WHERE CASE WHEN v_accounts IS NOT NULL THEN cl.accounts && v_accounts
      WHEN v_days IS NULL THEN EXISTS (SELECT 1 FROM public.cockpit_client_days d WHERE d.location_id = cl.location_id
                                         AND d.day BETWEEN p_start AND p_end AND d.confirmed_bookings > 0)
      ELSE coalesce((SELECT s.spend > 0 FROM msp s WHERE s.location_id = cl.location_id), false)
        OR coalesce((SELECT b.booked > 0 FROM bk b WHERE b.location_id = cl.location_id), false)
        OR EXISTS (SELECT 1 FROM evc WHERE evc.location_id = cl.location_id) END
  ), rowsj AS (
    SELECT p.client_name, p.location_id, jsonb_build_object(
      'clickupId', p.clickup_id, 'locationId', p.location_id, 'name', p.client_name,
      'serviceMode', p.service_mode, 'status', p.status, 'accounts', to_jsonb(p.accounts),
      'spend', CASE WHEN f.known THEN round(coalesce(s.spend, 0), 2) END,
      'leads', CASE WHEN f.known THEN coalesce(s.leads, 0) END,
      'offBoardSpend', CASE WHEN f.known AND v_meta_first IS NOT NULL THEN round(coalesce(ob.spend, 0), 2) END,
      'excludedSpend', CASE WHEN f.known AND v_meta_first IS NOT NULL THEN round(coalesce(ob.excluded, 0), 2) END,
      'campaigns', CASE WHEN v_days IS NULL THEN '[]'::jsonb ELSE coalesce((
        SELECT jsonb_agg(jsonb_build_object('campaignName', x.campaign_name, 'spend', round(x.spend, 2), 'leads', x.leads,
                 'bookings', CASE WHEN v_books THEN x.n END, 'live', coalesce(c.live, false))
               ORDER BY x.spend DESC, x.campaign_name)
        FROM cs x LEFT JOIN camp c ON c.name = x.campaign_name WHERE x.location_id = p.location_id), '[]'::jsonb) END,
      'bookings', f.bookings,
      'days', v_days,
      'storedDays', CASE WHEN v_days IS NOT NULL THEN coalesce(b.stored, 0) END,
      'mediaBookings', CASE WHEN f.media THEN coalesce(e.n, 0) END,
      'costPerBooking', CASE WHEN f.known AND f.bookings > 0 AND s.spend > 0 AND coalesce(ob.missing_rows, 0) = 0
        THEN round(s.spend / f.bookings, 2) END,
      'why', nullif(concat_ws(' ',
        v_range_why,
        CASE WHEN v_days IS NOT NULL AND cardinality(p.accounts) = 0 THEN 'No Meta ad account is linked to this client, so its spend is not known.' END,
        CASE WHEN v_days IS NOT NULL AND p.service_mode = 'DWY' THEN 'Done with you: the client books its own meetings.' END,
        CASE WHEN v_days IS NOT NULL AND p.service_mode IS DISTINCT FROM 'DWY' AND coalesce(b.stored, 0) < v_days
          THEN format('Bookings are not stored for %s of the %s days.', v_days - coalesce(b.stored, 0), v_days) END,
        CASE WHEN v_days IS NOT NULL THEN sh.note END,
        CASE WHEN f.known AND ob.missing_rows > 0 THEN
          format('Meta holds %s on Mahara''s campaigns for days the media data does not have; the spend shown leaves it out, so there is no cost per booking.',
            coalesce('$' || to_char(round(ob.missing, 2), 'FM999,999,990.00'), 'spend'))
        WHEN f.known AND f.bookings > 0 AND coalesce(s.spend, 0) = 0 THEN 'No spend on Mahara''s campaigns is counted for these days, so there is no cost per booking.' END,
        CASE WHEN f.known AND ob.unpriced > 0 THEN 'Some of the account''s other spend is in a currency with no fixed USD rate, so the spend off Mahara''s campaigns is at least this.' END,
        CASE WHEN f.known AND v_meta_first IS NULL THEN 'The Meta ad store has no rows yet, so the spend off Mahara''s campaigns is not known.' END,
        CASE WHEN v_days IS NOT NULL AND NOT v_books THEN 'The media sync''s booking history is not imported yet, so its count is not shown.' END), '')
    ) AS j
    FROM pick p
    LEFT JOIN msp s ON s.location_id = p.location_id
    LEFT JOIN offb ob ON ob.location_id = p.location_id
    LEFT JOIN bk b ON b.location_id = p.location_id
    LEFT JOIN evc e ON e.location_id = p.location_id
    LEFT JOIN shared sh ON sh.location_id = p.location_id
    CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM own o WHERE o.location_id = p.location_id) AS owns) w
    CROSS JOIN LATERAL (SELECT
      -- Spend is known for a client that has an ad account of its own (not one counted under another location).
      v_days IS NOT NULL AND w.owns AS known,
      CASE WHEN v_days IS NOT NULL AND p.service_mode IS DISTINCT FROM 'DWY' AND coalesce(b.stored, 0) = v_days THEN b.booked END AS bookings,
      -- The second source is tied by the client's ad accounts or by the location its events carry.
      v_days IS NOT NULL AND v_books AND p.service_mode IS DISTINCT FROM 'DWY' AND (w.owns OR coalesce(e.n, 0) > 0) AS media) f
  ), lost AS (
    -- Mahara's spend on an ad account no client is linked to.
    SELECT a.account, jsonb_agg(DISTINCT a.campaign_name) AS campaigns, sum(a.spend) AS spend
    FROM ads a
    WHERE NOT a.excluded AND NOT EXISTS (SELECT 1 FROM own o WHERE o.acc = a.account)
      AND (v_accounts IS NULL OR a.account = ANY(v_accounts))
      AND (v_all OR public.cockpit_media_campaign_allowed(a.campaign_name))
    GROUP BY a.account
    HAVING sum(a.spend) > 0
  )
  SELECT jsonb_build_object(
    'from', p_start, 'to', p_end, 'countedFrom', CASE WHEN v_days IS NOT NULL THEN v_from END,
    'through', v_through, 'throughSource', v_week->>'source',
    'clients', coalesce((SELECT jsonb_agg(r.j ORDER BY lower(r.client_name), r.location_id) FROM rowsj r), '[]'::jsonb),
    'unmatched', coalesce((SELECT jsonb_agg(jsonb_build_object('account', l.account, 'campaigns', l.campaigns, 'spend', round(l.spend, 2))
                             ORDER BY l.spend DESC, l.account) FROM lost l), '[]'::jsonb))
  INTO v_out;
  RETURN v_out;
END
$fn$;

COMMENT ON FUNCTION public.cockpit_media_client_range(date,date,text[]) IS
  'The media buyer''s client numbers over a range: Mahara''s campaigns on the client''s ad accounts (stopped ones included), the board''s confirmed bookings, every figure from the first day the cockpit''s campaign list vouches for (countedFrom) to the paired day (cockpit_media_week). 20261022x.';

REVOKE ALL ON FUNCTION public.cockpit_media_client_range(date,date,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_media_client_range(date,date,text[]) TO authenticated;
COMMIT;
