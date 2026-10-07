-- Original booking rows can lack provider IDs. Keep their real source identity.
-- This does not create contact IDs, deduplicate people, or certify source freshness.
BEGIN;
CREATE OR REPLACE FUNCTION public.cockpit_native_grain_key(p_kind text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE event_identity text; original_identity text;
BEGIN
 IF p_kind='dailyStats' THEN
  RETURN jsonb_build_array(p_data->>'campaignName',p_data->>'date',coalesce(p_data->>'metaAdId',p_data->>'adName',''),coalesce(p_data->>'adSetName',''));
 END IF;
 IF p_kind IS DISTINCT FROM 'bookingEvents' THEN RAISE EXCEPTION 'Unsupported statistics table';END IF;
 event_identity:=coalesce(nullif(p_data->>'eventId',''),nullif(p_data->>'id',''),nullif(p_data->>'contactId',''));
 IF event_identity IS NULL THEN
  original_identity:=nullif(p_data->>'_id','');
  IF original_identity IS NULL OR jsonb_typeof(p_data->'_id') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Booking event identity is unavailable';
  END IF;
  RETURN jsonb_build_array('legacy-source-row',original_identity);
 END IF;
 RETURN jsonb_build_array(p_data->>'campaignName',coalesce(p_data->>'locationId',''),event_identity,coalesce(p_data->>'startTime',p_data->>'date'));
END $$;
REVOKE ALL ON FUNCTION public.cockpit_native_grain_key(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_native_grain_key(text,jsonb) TO service_role;
COMMIT;
