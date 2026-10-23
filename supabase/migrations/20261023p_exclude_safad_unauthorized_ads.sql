-- Compromise list: the two ads outsiders placed on SAFAD's Meta account act_774492648699300
-- (SAFAD Consultant Engineering, ClickUp 86ewvnqgz, location 7eAfjIoYYguSmDaLSz78).
-- Sanctioned by the CEO on 2026-10-23 (cost per booking decisions, D0a: "Yes").
-- Contract: docs/client-performance/CPB-DECISIONS-20261023.md 1.1 and 3.1; evidence:
-- docs/client-performance/CPB-AUDIT-20261021.md "D0a". Creative Triage bldgtotkfmhoxmlzowdx.
--
-- Read live, read only, on 2026-10-23 (cockpit_csm_meta_activities, cockpit_meta_ad_days,
-- cockpit_meta_budget_days, cockpit_meta_ads; times in Kuwait):
--   120254791600360066 "New Engagement Ad", campaign 120254791600340066 "New Engagement
--     Campaign", ad set 120254791600350066. "Mercedes García" made the campaign on 13 Oct at
--     22:51:06 (Egypt, $620 a day, optimised for Replies) and the ad at 22:53:43, paused the
--     campaign on 14 Oct at 10:46 and switched it on again at 22:58; Nada Al Saed paused it on
--     19 Oct at 21:33. Meta store: $0.01 on 13 Oct, $228.26 on 14 Oct, $146.83 on 15 Oct,
--     $375.10 in all, 482,139 impressions, no form lead.
--   120254896955290066 "New Engagement Ad", campaign 120254896955270066 "New Engagement
--     Campaign", ad set 120254896955280066. "Lucas J Ortiz" made the campaign on 20 Oct at
--     00:31:53 (Saudi Arabia, $555 a day, optimised for Replies) and the ad at 00:36:07 (Meta:
--     "Update required"); Nada paused it at 12:57. No ad-day row, $0 spent. Its campaign id
--     is listed so the board takes the campaign's $555 budget-day out of Budget used.
--   Neither person is one of Mahara's people on the account.
--
-- What it does: lists both ads, then moves their creative-dashboard rows (ads_daily_snapshots:
-- 8 rows of the first ad, $375.10, on 23 Oct) to the archive, as 20261010a and 20261021b did.
-- The snapshot trigger keeps them out from then on. One audit row. Nothing else.
-- Every reader that reads the list live by ad id (the board, pay, the client range, the CSM
-- ads, the CEO refresh) follows at once. The media worker reads its own copy of the list
-- (EXCLUDED_AD_IDS in hermes/cockpit-sync/excludedAds.ts, 23 ids with these two) and needs the
-- native release N3; after N3 has published one cycle, 20261021d archives the worker's daily
-- rows of every listed ad, these two included.
-- It holds ads_daily_snapshots against writes while it runs, so a dashboard feed tick
-- (cockpit_meta_feed_run, every 10 min) cannot write a row back between the listing and the
-- archive. If a tick is writing, it stops after 5 s with a lock timeout and changes nothing:
-- run it again.
-- It refuses if the list or its archive is missing, or the snapshot trigger is missing,
-- switched off or set to fire on replicas only (ENABLE REPLICA), because then the next feed
-- tick would write the archived rows straight back.
-- The audit row's "after" holds ids and counts only; the spend it archived is in "before".
-- Safe to run twice: the list upserts nothing twice, and an unchanged run writes no audit row.
-- Test: apps/media-buyer-cockpit/scripts/excluded-ads-safad-supabase.test.ts.
-- Rollback: ~/.cache/mahara-ship/rollback/20261023p.undo.sql (puts both list rows' snapshot
-- rows back from the archive, deletes the two list rows, one media.excluded_ads.remove row).

BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.ads_daily_snapshots IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_ads constant text[] := ARRAY['120254791600360066', '120254896955290066'];
  v_listed_before integer;
  v_added integer;
  v_snap_rows integer;
  v_snap_spend numeric;
  v_archived integer;
BEGIN
  IF to_regclass('public.cockpit_excluded_ads') IS NULL
     OR to_regclass('public.ads_daily_snapshots_excluded_archive') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261010a_exclude_unauthorized_ads.sql first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                  WHERE tgrelid = 'public.ads_daily_snapshots'::regclass
                    AND tgname = 'cockpit_skip_excluded_ad_snapshot'
                    AND tgenabled IN ('O', 'A')) THEN
    RAISE EXCEPTION 'The trigger cockpit_skip_excluded_ad_snapshot is missing or disabled on ads_daily_snapshots. Restore it from 20261010a first';
  END IF;

  SELECT count(*) INTO v_listed_before FROM public.cockpit_excluded_ads;
  SELECT count(*), coalesce(sum(spend), 0) INTO v_snap_rows, v_snap_spend
    FROM public.ads_daily_snapshots WHERE ad_id = ANY (v_ads);

  INSERT INTO public.cockpit_excluded_ads (ad_id, account_id, campaign_id, reason, excluded_by) VALUES
    ('120254791600360066', 'act_774492648699300', '120254791600340066', 'unauthorized_meta_incident_2026_10', 'aziz@maharamedia.com'),
    ('120254896955290066', 'act_774492648699300', '120254896955270066', 'unauthorized_meta_incident_2026_10', 'aziz@maharamedia.com')
  ON CONFLICT (ad_id) DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  -- Archived, not destroyed (the 20261010a rule).
  WITH gone AS (
    DELETE FROM public.ads_daily_snapshots s WHERE s.ad_id = ANY (v_ads) RETURNING s.*
  )
  INSERT INTO public.ads_daily_snapshots_excluded_archive (row_data)
  SELECT to_jsonb(gone) FROM gone;
  GET DIAGNOSTICS v_archived = ROW_COUNT;

  IF v_added > 0 OR v_archived > 0 THEN
    INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, "before", "after", metadata)
    VALUES ('media.excluded_ads.add', 'cockpit_excluded_ads', 'migration 20261023p', 'aziz@maharamedia.com', 'media-buyer', 'migration',
      jsonb_build_object('listed', v_listed_before,
        'ads_daily_snapshots', jsonb_build_object('rows', v_snap_rows, 'spend', v_snap_spend)),
      jsonb_build_object('listed', v_listed_before + v_added, 'added', v_added, 'snapshots_archived', v_archived,
        'ads', jsonb_build_array(
          jsonb_build_object('ad_id', '120254791600360066', 'account_id', 'act_774492648699300', 'campaign_id', '120254791600340066'),
          jsonb_build_object('ad_id', '120254896955290066', 'account_id', 'act_774492648699300', 'campaign_id', '120254896955270066'))),
      jsonb_build_object(
        'reason', 'unauthorized_meta_incident_2026_10',
        'client', 'SAFAD Consultant Engineering (ClickUp 86ewvnqgz, location 7eAfjIoYYguSmDaLSz78)',
        'sanctioned_by', 'CEO, 2026-10-23',
        'decision', 'Cost per booking decisions of 23 Oct 2026, D0a',
        'applied_through', 'the CEO''s Composio Supabase connection',
        'evidence_source', 'cockpit_csm_meta_activities, cockpit_meta_ad_days, cockpit_meta_budget_days and cockpit_meta_ads, read only on 2026-10-23',
        'evidence', jsonb_build_array(
          jsonb_build_object('ad_id', '120254791600360066', 'adset_id', '120254791600350066',
            'campaign_created', '2026-10-13T22:51:06+03:00', 'ad_created', '2026-10-13T22:53:43+03:00', 'created_by', 'Mercedes García',
            'geo', 'EG', 'optimisation', 'Replies', 'daily_budget_usd', 620,
            'run_status', 'paused 2026-10-14 10:46 and switched on 22:58 by Mercedes García; paused 2026-10-19 21:33 by Nada Al Saed',
            'meta_spend_usd', 375.10, 'meta_spend_days', '13 to 15 Oct 2026', 'impressions', 482139, 'form_leads', 'none'),
          jsonb_build_object('ad_id', '120254896955290066', 'adset_id', '120254896955280066',
            'campaign_created', '2026-10-20T00:31:53+03:00', 'ad_created', '2026-10-20T00:36:07+03:00', 'created_by', 'Lucas J Ortiz',
            'geo', 'SA', 'optimisation', 'Replies', 'daily_budget_usd', 555, 'ad_status', 'Update required',
            'run_status', 'paused 2026-10-20 12:57 by Nada Al Saed', 'meta_spend_usd', 0, 'ad_day_rows', 0)),
        'worker_copy', 'hermes/cockpit-sync/excludedAds.ts carries both ids (23 in all) from native release N3; then 20261021d'));
  END IF;
END $$;

COMMIT;
