-- Keep the original monitor's other checks intact; reconcile only independently proven receipts.
BEGIN;
CREATE TABLE IF NOT EXISTS public.cockpit_native_still_readback (
  resource text NOT NULL CHECK (resource ~ '^/storage/v1/object/cockpit-ad-stills/([a-f0-9]{64}/)?[a-f0-9]{64}$'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  http_status integer NOT NULL CHECK (http_status=200),
  verified_at timestamptz NOT NULL,
  PRIMARY KEY(resource,verified_at),
  -- The operator must GET the public object, hash its actual bytes and record this proof.
  CHECK (right(resource,64)=sha256)
);
ALTER TABLE public.cockpit_native_still_readback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_native_still_readback FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.cockpit_native_still_readback TO service_role;

-- Preserve the complete original function under a private name; the view is repointed below.
DO $$ BEGIN
 IF to_regprocedure('public.cockpit_native_monitor_base()') IS NULL THEN
  ALTER FUNCTION public.cockpit_native_monitor() RENAME TO cockpit_native_monitor_base;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_native_monitor_base() FROM PUBLIC,anon,authenticated,service_role;

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
      WHERE latest.provider=t.provider AND latest.resource=t.resource AND latest.phase<>'intent'
      ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
  ) THEN
   filtered:=filtered||jsonb_build_array(check_item);
  END IF;
 END LOOP;
 RETURN jsonb_set(snapshot,'{checks}',filtered);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_native_monitor() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_native_monitor() TO service_role;
CREATE OR REPLACE VIEW public.cockpit_native_monitor_state WITH (security_invoker=true) AS SELECT public.cockpit_native_monitor() AS snapshot;
REVOKE ALL ON public.cockpit_native_monitor_state FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.cockpit_native_monitor_state TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
