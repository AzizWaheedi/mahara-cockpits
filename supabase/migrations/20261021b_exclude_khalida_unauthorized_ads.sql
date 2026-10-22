-- Compromise list: two more ads outsiders placed on Munshaat Khalida's old Meta
-- account act_1275190574533155 after the 10 Oct list (20261010a) was drawn.
-- Sanctioned by the CEO, 2026-10-21. Creative Triage bldgtotkfmhoxmlzowdx.
--
-- Read on Meta with GET only (system-user token on the VPS, 2026-10-21 11:24 UTC):
--   120247012327250088 "New Sales Ad", campaign 120247012327240088 "29/8 - Copy"
--     (named with hidden LRM marks to pass as the client's), ad set 120247012327260088.
--     Created 15 Oct 19:04:56 UTC by "Jonathan Rbn", actor 10241858350185646: one of
--     the two incident actors of the 9 and 15 Oct audits, who also made the listed
--     "29/8" 120246795745530088. OUTCOME_SALES on pixel 1400079798964357 (PURCHASE,
--     the same pixel as the listed "29/8"), United States, $9,220 a day. Creative:
--     reading glasses, Shop Now, from Page 1238268822694488, not the client's Page
--     1215892868273680. Meta: $102.54 and 1,005 impressions (16, 18, 19, 20 Oct).
--   120247083365360088 "New Engagement Ad", campaign 120247083365340088 "New
--     Engagement Campaign", ad set 120247083365350088. Created 20 Oct 11:24:19 UTC by
--     "Lucas J Ortiz", actor 3259949464190222. Egypt, Shopify and page-admin
--     interests, WhatsApp conversations, $525 a day. Creative "Looking for Meta Ads
--     Specialist" from Page 358158590721724. Meta: $0.80 and 452 impressions (21 Oct).
--   Neither person is among the seven Mahara's business has assigned on the account.
--   Mahara's people paused both campaigns, more than once, from 18 to 21 Oct.
--
-- What it does: lists both ads, then moves their creative-dashboard rows
-- (ads_daily_snapshots) to the archive, as 20261010a did. The snapshot trigger
-- keeps them out from then on. One audit row. Nothing else.
-- The media worker reads its own copy of the list (EXCLUDED_AD_IDS in
-- hermes/cockpit-sync/excludedAds.ts). That copy needs the same two ids and a
-- native release. 20261021c then clears the worker's daily rows.
-- It holds ads_daily_snapshots against writes while it runs, so a dashboard feed tick
-- (cockpit_meta_feed_run, every 10 min) cannot write a row back between the listing
-- and the archive. If a tick is writing, it stops after 5 s with a lock timeout and
-- changes nothing: run it again.
-- It refuses if the snapshot trigger is missing, switched off or set to fire on replicas
-- only (ENABLE REPLICA), because then the next feed tick would write the archived rows
-- straight back.
-- The audit row's "after" holds ids and counts only; the spend it archived is in "before".
-- Safe to run twice: the list upserts nothing twice, and an unchanged run writes no audit row.

BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.ads_daily_snapshots IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_ads constant text[] := ARRAY['120247012327250088', '120247083365360088'];
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
    ('120247012327250088', 'act_1275190574533155', '120247012327240088', 'unauthorized_meta_incident_2026_10', 'aziz@maharamedia.com'),
    ('120247083365360088', 'act_1275190574533155', '120247083365340088', 'unauthorized_meta_incident_2026_10', 'aziz@maharamedia.com')
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
    VALUES ('media.excluded_ads.add', 'cockpit_excluded_ads', 'migration 20261021b', 'aziz@maharamedia.com', 'media-buyer', 'migration',
      jsonb_build_object('listed', v_listed_before,
        'ads_daily_snapshots', jsonb_build_object('rows', v_snap_rows, 'spend', v_snap_spend)),
      jsonb_build_object('listed', v_listed_before + v_added, 'added', v_added, 'snapshots_archived', v_archived,
        'ads', jsonb_build_array(
          jsonb_build_object('ad_id', '120247012327250088', 'account_id', 'act_1275190574533155', 'campaign_id', '120247012327240088'),
          jsonb_build_object('ad_id', '120247083365360088', 'account_id', 'act_1275190574533155', 'campaign_id', '120247083365340088'))),
      jsonb_build_object(
        'reason', 'unauthorized_meta_incident_2026_10',
        'client', 'Munshaat Khalida (ClickUp 86ey2em6q, location Xrba2RqDTrA4K4nS1u1Y)',
        'sanctioned_by', 'CEO, 2026-10-21',
        'applied_through', 'the CEO''s Composio Supabase connection',
        'evidence_read_at', '2026-10-21T11:24:43Z',
        'evidence_source', 'Meta Graph GET (ad, campaign, ad set, insights, account activities, assigned_users), system-user token on the VPS',
        'evidence', jsonb_build_array(
          jsonb_build_object('ad_id', '120247012327250088', 'created', '2026-10-15T19:04:56Z', 'created_by', 'Jonathan Rbn',
            'actor_id', '10241858350185646', 'incident_actor', true, 'objective', 'OUTCOME_SALES', 'pixel', '1400079798964357',
            'geo', 'US', 'daily_budget_usd', 9220, 'page', '1238268822694488', 'meta_spend_usd', 102.54, 'impressions', 1005),
          jsonb_build_object('ad_id', '120247083365360088', 'created', '2026-10-20T11:24:19Z', 'created_by', 'Lucas J Ortiz',
            'actor_id', '3259949464190222', 'incident_actor', false, 'objective', 'OUTCOME_ENGAGEMENT', 'geo', 'EG',
            'daily_budget_usd', 525, 'page', '358158590721724', 'meta_spend_usd', 0.80, 'impressions', 452)),
        'worker_copy', 'hermes/cockpit-sync/excludedAds.ts needs the same two ids and a native release; then 20261021c'));
  END IF;
END $$;

COMMIT;
