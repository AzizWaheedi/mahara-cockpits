-- Select the latest CEO publish response, not its paired failure ledger row.
BEGIN;
CREATE OR REPLACE FUNCTION public.cockpit_native_monitor() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb; filtered jsonb; check_item jsonb;
BEGIN
 snapshot:=public.cockpit_native_monitor_base();
 filtered:='[]'::jsonb;
 FOR check_item IN SELECT value FROM jsonb_array_elements(snapshot->'checks') LOOP
  -- The ledger records the upload response, not its later public GET. A proof
  -- alone is insufficient: require the exact content-addressed path in canonical
  -- saved still state and an actual published native media run too.
  IF NOT EXISTS (
   SELECT 1 FROM public.cockpit_media_provider_health t
   JOIN public.cockpit_native_still_readback p ON p.resource=t.resource
   JOIN public.cockpit_native_stills s ON s.data->>'status'='saved'
    AND s.data->>'url'='https://bldgtotkfmhoxmlzowdx.supabase.co/storage/v1/object/public/' || substring(t.resource from length('/storage/v1/object/')+1)
   WHERE check_item->>'key'='source:cockpit_media_provider_health:'||md5(t.resource)
    AND t.method='POST' AND t.provider='storage' AND t.phase='response'
    AND t.http_status>=400 AND p.http_status=200 AND p.verified_at>t.created_at
    AND EXISTS (SELECT 1 FROM public.cockpit_native_media_runs r WHERE r.status='published')
    AND t.id=(SELECT latest.id FROM public.cockpit_media_provider_health latest
      WHERE latest.provider=t.provider AND latest.resource=t.resource AND latest.phase<>'intent'
      ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
  ) AND NOT EXISTS (
   -- A later *canonical* CEO publication supersedes only this exact publish RPC,
   -- never another CEO provider failure. A partial run is a committed publish.
   SELECT 1 FROM public.cockpit_ceo_provider_health t
   JOIN public.cockpit_ceo_refresh_runs r ON r.status IN ('published','partial')
    AND r.created_at>t.created_at AND r.finished_at>t.created_at
   WHERE check_item->>'key'='source:cockpit_ceo_provider_health:'||md5(t.resource)
    AND t.method='POST' AND t.resource ~ '/rest/v1/rpc/cockpit_ceo_refresh_publish$'
    AND t.phase='response' AND t.http_status>=400
    AND t.id=(SELECT latest.id FROM public.cockpit_ceo_provider_health latest
      WHERE latest.provider=t.provider AND latest.resource=t.resource AND latest.phase='response'
      ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
  ) THEN
   filtered:=filtered||jsonb_build_array(check_item);
  END IF;
 END LOOP;
 RETURN jsonb_set(snapshot,'{checks}',filtered);
END $$;
COMMIT;
