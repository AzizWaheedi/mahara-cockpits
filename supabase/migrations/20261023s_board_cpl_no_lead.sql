-- Spend with no lead on the Client Performance board (the CEO, 23 Oct 2026, cost per booking
-- decisions, 4: "Depends on how much spend if 2x target cpl then yes bad if below that then
-- not enough data"). Contract: docs/client-performance/CPB-DECISIONS-20261023.md 1.4 and 3.4.
-- Creative Triage bldgtotkfmhoxmlzowdx.
--
-- Only the zero-lead branch of cockpit_board_ad_cells changes (the client row, and every
-- campaign, ad set and ad of the tree, read their cost per lead from it). Before, a cost per lead
-- with no lead yet was judged as a floor on the $15 / $22.50 lines, so $11.09 was too few,
-- $17.32 watch and $24.10 off. Now, with leads known and none:
--   round(lead-campaign spend, 2) >= 2 x the cost per lead line: off ("atLeast" kept);
--   under it, or no line: too_few (the hollow ring, "$11.09+").
-- The line is p_targets->'cpl'->>'good' (cockpit_board_targets_map: the client's own, else the
-- board's default, else the official $15), so 2 x $15 = $30.00 unless a target was changed; it
-- is computed, never written as 30. The note says the amounts: "No form lead yet for $X of
-- lead-campaign spend: $30.00 or more with no lead is off (2 x the $15.00 cost per lead line)."
-- or "...: under $30.00 (2 x the $15.00 cost per lead line), too few to judge." Unknown leads
-- (no lead-form rows) stay not measured. Unpriced spend (contract 1.4, 9): only the priced part
-- is judged, and the note then says how many ad-days were left out ("at least"); when no
-- lead-form row has a USD amount (lead_spend NULL: a currency with no fixed USD rate, or no
-- spend stored), the cell is not measured, never "$0.00". cockpit_board_floor_status is not touched (the cost per
-- booking, ROAS and cost-per-lead-with-leads floors use it), nor is the golden rule in
-- cockpit_board_rows: a cost per lead off on this line beside a good cost per booking reads watch.
--
-- The body is the live one (prosrc md5 ee9b65892cd1a772109dfc3b318a6a17, the body of 20261016133300; its
-- pg_get_functiondef md5 e43f153d3ca4877d489a5616f815cc48) with that branch replaced. The file
-- refuses, and changes nothing, if the live body is neither that one nor this file's
-- (4bd7436b2d184319a4b0bcd3218830cf). Owner and grants are kept (invoker, EXECUTE for the owner only, as
-- live) and restated. Safe to run twice.
-- Test: apps/media-buyer-cockpit/scripts/board-cpl-no-lead-supabase.test.ts.
-- Rollback: ~/.cache/mahara-ship/rollback/cockpit_board_ad_cells.before-20261023s_board_cpl_no_lead.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_board_ad_cells(jsonb,jsonb,jsonb)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('ee9b65892cd1a772109dfc3b318a6a17', '4bd7436b2d184319a4b0bcd3218830cf') THEN
    RAISE EXCEPTION 'cockpit_board_ad_cells is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.cockpit_board_ad_cells(p jsonb, p_targets jsonb, p_reach jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $fn$
DECLARE
  spend numeric := (p->>'spend')::numeric;
  unpriced integer := coalesce((p->>'unpriced')::integer, 0);
  imp numeric := coalesce((p->>'imp')::numeric, 0);
  clicks numeric := coalesce((p->>'clicks')::numeric, 0);
  lead_rows integer := coalesce((p->>'lead_rows')::integer, 0);
  leads numeric := coalesce((p->>'leads')::numeric, 0);
  lead_spend numeric := coalesce((p->>'lead_spend')::numeric, 0);
  lead_clicks numeric := coalesce((p->>'lead_clicks')::numeric, 0);
  video_rows integer := coalesce((p->>'video_rows')::integer, 0);
  video_imp numeric := coalesce((p->>'video_imp')::numeric, 0);
  v3 numeric := coalesce((p->>'v3')::numeric, 0);
  thru numeric := coalesce((p->>'thru')::numeric, 0);
  plays numeric := coalesce((p->>'plays')::numeric, 0);
  freq_w numeric := (p->>'freq_w')::numeric;
  freq_imp numeric := (p->>'freq_imp')::numeric;
  r_reach numeric := (p_reach->>'reach')::numeric;
  r_imp numeric := (p_reach->>'impressions')::numeric;
  v_partial boolean := coalesce((p->>'partial')::boolean, false);
  v_partial_note text := CASE WHEN coalesce((p->>'partial')::boolean, false) THEN coalesce(nullif(p->>'partial_note', ''),
    'Some days of this time frame have no ad numbers stored, so these are at least what is shown.') END;
  v_spend_note text := nullif(concat_ws(' ', CASE WHEN unpriced > 0 THEN format('%s ad-day%s in a currency with no fixed USD rate %s left out, so spend is at least this.',
    unpriced, CASE WHEN unpriced = 1 THEN '' ELSE 's' END, CASE WHEN unpriced = 1 THEN 'is' ELSE 'are' END) END, v_partial_note), '');
  v_no_lead constant text := 'No lead-form campaign ran in this time frame.';
  v_no_video constant text := 'Not a video: no video ad ran in this time frame.';
  v_floor boolean := unpriced > 0 OR v_partial;
  -- A cost on unpriced spend is at least this; a cost over partial days is a part of the time frame.
  v_at_least jsonb := jsonb_strip_nulls(jsonb_build_object('atLeast', CASE WHEN unpriced > 0 THEN true END,
    'partial', CASE WHEN v_partial THEN true END));
  v_count jsonb := CASE WHEN v_partial THEN jsonb_build_object('atLeast', true, 'partial', true) END;
  v_freq jsonb;
  -- Spend with no lead (the CEO, 23 Oct 2026, cost per booking decisions, 4: "Depends on how
  -- much spend if 2x target cpl then yes bad if below that then not enough data"; 20261023s):
  -- off once the lead-campaign spend reaches 2 x the cost per lead line (the client's own, else
  -- the board's, else the official one, from cockpit_board_targets_map), too few to judge under
  -- it or with no line. NO_LEAD_MULTIPLE in src/lib/kpi.ts.
  v_no_lead_multiple constant numeric := 2;
  v_cpl_line numeric := CASE WHEN (p_targets->'cpl'->>'good')::numeric > 0 THEN (p_targets->'cpl'->>'good')::numeric END;
  v_no_lead_line numeric := v_no_lead_multiple * CASE WHEN (p_targets->'cpl'->>'good')::numeric > 0 THEN (p_targets->'cpl'->>'good')::numeric END;
  -- Lead-form rows with no USD amount at all: both callers sum lead_spend as
  -- sum(spend_usd) FILTER (WHERE leads IS NOT NULL), which is NULL only when no lead row is
  -- priced. Then nothing can be judged, never a written $0.00 (contract 1.4, 9).
  v_lead_unpriced boolean := lead_rows > 0 AND (p->>'lead_spend') IS NULL;
  v_ret jsonb := '{}'::jsonb;
  k text;
BEGIN
  spend := coalesce(spend, CASE WHEN unpriced = 0 THEN 0 END);
  IF r_reach > 0 AND r_imp IS NOT NULL THEN
    v_freq := public.cockpit_board_cell('frequency', round(r_imp / r_reach, 2), p_targets, r_imp, r_imp, r_reach, NULL,
      concat_ws(' ', 'Over the whole time frame: Meta''s reach for it, read to today.', p_reach->>'note'),
      jsonb_build_object('basis', 'window'));
  ELSIF freq_imp > 0 THEN
    v_freq := public.cockpit_board_cell('frequency', round(freq_w / freq_imp, 2), p_targets, imp, NULL, NULL, NULL,
      concat_ws(' ', 'Average daily frequency, weighted by impressions: frequency over a whole time frame is kept for the last 7, 14 and 30 days, this month and last month.',
        p_reach->>'note'),
      jsonb_build_object('basis', 'average_daily'));
  ELSE
    v_freq := public.cockpit_board_cell('frequency', NULL, p_targets, imp, NULL, NULL, CASE WHEN imp = 0 THEN 'too_few' ELSE 'not_measured' END,
      coalesce(p_reach->>'note', CASE WHEN imp = 0 THEN 'No impressions in this time frame.' END));
  END IF;
  FOREACH k IN ARRAY ARRAY['25', '50', '75', '100'] LOOP
    v_ret := v_ret || jsonb_build_object('retention' || k, CASE
      WHEN video_rows = 0 THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_no_video, jsonb_build_object('notVideo', true))
      WHEN plays = 0 THEN public.cockpit_board_cell(NULL, NULL, p_targets, 0, NULL, NULL, 'too_few', 'No video plays in this time frame.')
      ELSE public.cockpit_board_cell(NULL, round(coalesce((p->>('p' || k))::numeric, 0) / plays * 100, 2), p_targets, plays,
        coalesce((p->>('p' || k))::numeric, 0), plays) END);
  END LOOP;
  RETURN jsonb_build_object(
    'spend', public.cockpit_board_cell(NULL, round(spend, 2), p_targets, NULL, NULL, NULL, NULL, v_spend_note,
      CASE WHEN unpriced > 0 OR v_partial THEN jsonb_build_object('atLeast', true) || coalesce(v_count, '{}'::jsonb) END),
    'impressions', public.cockpit_board_cell(NULL, imp, p_targets, NULL, NULL, NULL, NULL, v_partial_note, v_count),
    'linkClicks', public.cockpit_board_cell(NULL, clicks, p_targets, NULL, NULL, NULL, NULL, v_partial_note, v_count),
    'metaLeads', CASE WHEN lead_rows = 0 THEN public.cockpit_board_cell(NULL, NULL, p_targets, NULL, NULL, NULL, 'not_measured',
                        concat_ws(' ', v_no_lead, v_partial_note))
                      ELSE public.cockpit_board_cell(NULL, leads, p_targets, NULL, NULL, NULL, NULL, v_partial_note, v_count) END,
    'cpl', CASE
      WHEN lead_rows = 0 THEN public.cockpit_board_cell('cpl', NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_no_lead)
      WHEN leads > 0 THEN public.cockpit_board_cell('cpl', round(lead_spend / leads, 2), p_targets, leads, round(lead_spend, 2), leads,
        CASE WHEN v_floor THEN public.cockpit_board_floor_status('cpl', round(lead_spend / leads, 2), p_targets) END, v_spend_note, v_at_least)
      WHEN v_lead_unpriced THEN public.cockpit_board_cell('cpl', NULL, p_targets, 0, NULL, 0, 'not_measured',
        concat_ws(' ', CASE WHEN unpriced > 0
            THEN 'No form lead yet, and the lead-campaign spend is in a currency with no fixed USD rate, so it is not judged.'
            ELSE 'No form lead yet, and no lead-campaign spend is stored, so it is not judged.' END,
          v_partial_note))
      ELSE public.cockpit_board_cell('cpl', NULL, p_targets, 0, round(lead_spend, 2), 0,
        CASE WHEN round(lead_spend, 2) >= v_no_lead_line THEN 'off' ELSE 'too_few' END,
        concat_ws(' ', format('No form lead yet for $%s of lead-campaign spend', to_char(round(lead_spend, 2), 'FM999,999,990.00'))
          || CASE WHEN v_no_lead_line IS NULL THEN ', and no cost per lead line is set, so it is too few to judge.'
                  WHEN round(lead_spend, 2) >= v_no_lead_line THEN format(': $%s or more with no lead is off (%s x the $%s cost per lead line).',
                    to_char(v_no_lead_line, 'FM999,999,990.00'), v_no_lead_multiple, to_char(v_cpl_line, 'FM999,999,990.00'))
                  ELSE format(': under $%s (%s x the $%s cost per lead line), too few to judge.',
                    to_char(v_no_lead_line, 'FM999,999,990.00'), v_no_lead_multiple, to_char(v_cpl_line, 'FM999,999,990.00')) END,
          v_spend_note),
        jsonb_build_object('atLeast', round(lead_spend, 2)) || CASE WHEN v_partial THEN jsonb_build_object('partial', true) ELSE '{}'::jsonb END) END,
    'cpm', CASE WHEN spend IS NULL THEN public.cockpit_board_cell('cpm', NULL, p_targets, imp, NULL, NULL, 'not_measured', v_spend_note)
                WHEN imp > 0 THEN public.cockpit_board_cell('cpm', round(spend / imp * 1000, 2), p_targets, imp, round(spend, 2), imp,
                  CASE WHEN v_floor THEN public.cockpit_board_floor_status('cpm', round(spend / imp * 1000, 2), p_targets) END, v_spend_note, v_at_least)
                ELSE public.cockpit_board_cell('cpm', NULL, p_targets, 0, NULL, NULL, 'too_few', 'No impressions in this time frame.') END,
    'frequency', v_freq,
    'linkCtr', CASE WHEN imp > 0 THEN public.cockpit_board_cell('link_ctr', round(clicks / imp * 100, 2), p_targets, imp, clicks, imp)
                    ELSE public.cockpit_board_cell('link_ctr', NULL, p_targets, 0, NULL, NULL, 'too_few', 'No impressions in this time frame.') END,
    'cpc', CASE WHEN spend IS NULL THEN public.cockpit_board_cell('cpc', NULL, p_targets, imp, NULL, NULL, 'not_measured', v_spend_note)
                WHEN clicks > 0 THEN public.cockpit_board_cell('cpc', round(spend / clicks, 2), p_targets, imp, round(spend, 2), clicks,
                  CASE WHEN v_floor THEN public.cockpit_board_floor_status('cpc', round(spend / clicks, 2), p_targets) END, v_spend_note, v_at_least)
                ELSE public.cockpit_board_cell('cpc', NULL, p_targets, imp, NULL, NULL, 'too_few', 'No link clicks in this time frame.') END,
    'optIn', CASE WHEN lead_rows = 0 THEN public.cockpit_board_cell('opt_in', NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_no_lead)
                  WHEN lead_clicks > 0 THEN public.cockpit_board_cell('opt_in', round(leads / lead_clicks * 100, 2), p_targets, lead_clicks, leads, lead_clicks,
                    NULL, 'Form leads / link clicks on lead campaigns.')
                  ELSE public.cockpit_board_cell('opt_in', NULL, p_targets, 0, NULL, NULL, 'too_few', 'No link clicks on lead campaigns in this time frame.') END,
    'hookRate', CASE WHEN video_rows = 0 THEN public.cockpit_board_cell('hook_rate', NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_no_video,
                       jsonb_build_object('notVideo', true))
                     WHEN video_imp > 0 THEN public.cockpit_board_cell('hook_rate', round(v3 / video_imp * 100, 2), p_targets, video_imp, v3, video_imp,
                       NULL, '3-second plays / impressions of video ads.')
                     ELSE public.cockpit_board_cell('hook_rate', NULL, p_targets, 0, NULL, NULL, 'too_few', 'No video impressions in this time frame.') END,
    'holdRate', CASE WHEN video_rows = 0 THEN public.cockpit_board_cell('hold_rate', NULL, p_targets, NULL, NULL, NULL, 'not_measured', v_no_video,
                       jsonb_build_object('notVideo', true))
                     WHEN v3 > 0 THEN public.cockpit_board_cell('hold_rate', round(thru / v3 * 100, 2), p_targets, video_imp, thru, v3,
                       NULL, 'ThruPlays / 3-second plays.')
                     ELSE public.cockpit_board_cell('hold_rate', NULL, p_targets, video_imp, NULL, NULL, 'too_few', 'No 3-second plays in this time frame.') END
  ) || v_ret;
END $fn$;

-- The grants as they are live, restated (CREATE OR REPLACE keeps the live ones; this says them once more).
REVOKE ALL ON FUNCTION public.cockpit_board_ad_cells(jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
