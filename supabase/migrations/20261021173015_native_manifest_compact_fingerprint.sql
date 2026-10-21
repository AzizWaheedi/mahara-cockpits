-- The native worker compares every input row before it publishes. Previously
-- that check sorted and retained each complete table as JSON, then serialized
-- the entire array again. Large source histories amplified memory use twice
-- per cycle (capture and publish).
--
-- Keep the same table coverage, full-row change detection and count contract.
-- Sort fixed-width SHA-256 digests instead of full records. Aggregate state is
-- now 32 bytes per row, independent of the size of a history/creative payload.
-- The version prefix deliberately rejects plans captured before this change;
-- the next ordinary capture recalculates. Never replay an uncertain publish.
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(1835102821, 1);

CREATE OR REPLACE FUNCTION public.cockpit_native_manifest()
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
 name text;
 fingerprint record;
 result jsonb := '{}';
BEGIN
 FOREACH name IN ARRAY ARRAY['cockpit_media_source_state','cockpit_media_sources','cockpit_csm_source_state','cockpit_csm_sources','cockpit_creative_source_state','cockpit_creative_sources','cockpit_campaigns','cockpit_ads','cockpit_media_feed_state','cockpit_media_daily_stats','cockpit_media_booking_events','cockpit_offboard_dismissals','cockpit_client_profiles','cockpit_csm_client_overrides','cockpit_native_stills','cockpit_native_mirror_owners','cockpit_daily_checks','cockpit_decisions','cockpit_media_call_briefs','cockpit_media_calendar_config'] LOOP
  EXECUTE format($query$
   SELECT count(*) AS row_count,
          encode(sha256(coalesce(string_agg(row_hash, ''::bytea ORDER BY row_hash), ''::bytea)), 'hex') AS row_hash
   FROM (
    SELECT sha256(convert_to(to_jsonb(t)::text, 'UTF8')) AS row_hash
    FROM public.%I t
   ) hashed_rows
  $query$, name) INTO fingerprint;
  result := result || jsonb_build_object(name, jsonb_build_object(
   'count', fingerprint.row_count,
   'hash', 'v2:sha256:' || fingerprint.row_hash
  ));
 END LOOP;
 RETURN result;
END $$;

-- Keep this internal helper inaccessible to API roles. The existing privileged
-- state/publish functions retain their own permissions, locks and fences.
REVOKE ALL ON FUNCTION public.cockpit_native_manifest() FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
