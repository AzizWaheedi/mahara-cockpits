-- Every client's assigned call centre callers in one read, for the client
-- list and the client page header (Aziz, 2026-10-13: "The CSM needs to be able
-- to see the assigned caller for each client easily, the assigned agent").
--
-- The rule is cockpit_client_calls' own (20261013180000): the dialer's active
-- assignments (mahara_console.metadata 'access:agent:<email>', locationIds)
-- kept when the dialer's account says agent, or, with no dialer account, when
-- Team & Payroll says call centre agent. Admin seats that hold assignments to
-- see the queue are left out. Same gate: the CEO, client success or a media
-- buyer, and each client must pass cockpit_client_allowed. Read-only.

BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.cockpit_client_callers() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_out jsonb;
BEGIN
 PERFORM public.cockpit_call_centre_seat();
 WITH agents AS (
  SELECT DISTINCT lower(btrim(m.data->>'email')) AS email, loc
  FROM mahara_console.metadata m, jsonb_array_elements_text(m.data->'locationIds') loc
  WHERE m.namespace='production' AND m.id LIKE 'access:agent:%' AND m.data->>'active'='true'
    AND jsonb_typeof(m.data->'locationIds')='array' AND nullif(btrim(m.data->>'email'),'') IS NOT NULL),
 callers AS (
  SELECT a.loc, a.email, coalesce(nullif(btrim(pp.name),''),a.email) AS name
  FROM agents a
  LEFT JOIN mahara_console.metadata i ON i.namespace='production' AND i.id='identity:account:'||a.email
  LEFT JOIN LATERAL (SELECT p.name,p.role,p.active FROM public.cockpit_people p WHERE lower(btrim(p.email))=a.email
                     ORDER BY p.active DESC,p.id DESC LIMIT 1) pp ON true
  WHERE CASE WHEN i.id IS NOT NULL THEN coalesce(i.data->>'role'='agent' AND i.data->>'enabled'='true',false)
             ELSE coalesce(pp.role ~* '^call cent(re|er) agent' AND pp.active,false) END)
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'taskId',g.clickup_id,'locationId',g.location_id,'clientName',g.client_name,
   'callers',coalesce((SELECT jsonb_agg(jsonb_build_object('email',c.email,'name',c.name) ORDER BY c.name)
                       FROM callers c WHERE c.loc=g.location_id),'[]'::jsonb)) ORDER BY g.client_name),'[]'::jsonb)
 INTO v_out
 FROM public.ghl_clients g
 WHERE nullif(btrim(g.clickup_id),'') IS NOT NULL AND public.cockpit_client_allowed(g.client_name);
 RETURN jsonb_build_object(
  'clients',v_out,
  'source','The dialer''s client assignments',
  'generatedAt',now());
END $$;

REVOKE ALL ON FUNCTION public.cockpit_client_callers() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_client_callers() TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
