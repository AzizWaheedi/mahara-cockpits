-- Founder-only CEO frequency cache and source-confirmed Workspace imports.
-- Creative Triage (bldgtotkfmhoxmlzowdx).
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT lower(btrim(email)) FROM public.cockpit_people
    WHERE active AND email IS NOT NULL AND btrim(email) <> ''
    GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Resolve duplicate normalized emails on active cockpit_people rows before applying the CEO provider migration';
  END IF;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_people_active_email_normalized_uidx
  ON public.cockpit_people(lower(btrim(email))) WHERE active AND email IS NOT NULL AND btrim(email) <> '';

CREATE TABLE IF NOT EXISTS public.cockpit_ceo_frequency_cache (
  from_day date NOT NULL,
  to_day date NOT NULL,
  computed_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(from_day,to_day),
  CHECK(to_day>=from_day)
);
ALTER TABLE public.cockpit_ceo_frequency_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_ceo_frequency_cache FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.cockpit_ceo_frequency_cache TO service_role;

CREATE TABLE IF NOT EXISTS public.cockpit_ceo_workspace_imports (
  request_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(result IS NULL OR jsonb_typeof(result)='object')
);
ALTER TABLE public.cockpit_ceo_workspace_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_ceo_workspace_imports FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.cockpit_ceo_workspace_imports TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_verified_actor_email(p_actor_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT lower(btrim(u.email))
  FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
  WHERE m.auth_user_id=p_actor_id AND m.active AND u.email_confirmed_at IS NOT NULL
    AND m.email=lower(btrim(u.email))
    AND lower(btrim(u.email)) IN ('aziz@maharamedia.com','awaheedi2008@gmail.com')
$$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_verified_actor_email(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cockpit_people_write_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text;
BEGIN
  actor:=nullif(current_setting('cockpit.ceo_actor_email',true),'');
  IF actor IS NULL THEN
    SELECT m.email INTO actor FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
    WHERE m.auth_user_id=auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email));
  END IF;
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after)
  VALUES(CASE WHEN TG_OP='INSERT' THEN 'people.add' ELSE 'people.edit' END,'cockpit_people',NEW.id::text,
    coalesce(actor,'service-role'),'ceo','supabase',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_people_write_audit() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS cockpit_people_audit ON public.cockpit_people;
CREATE TRIGGER cockpit_people_audit AFTER INSERT OR UPDATE ON public.cockpit_people
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_people_write_audit();

CREATE OR REPLACE FUNCTION public.cockpit_ceo_frequency_cache_upsert(p_actor_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text; v_from date; v_to date; v_computed_ms numeric; old_payload jsonb; new_payload jsonb;
BEGIN
  actor:=public.cockpit_ceo_verified_actor_email(p_actor_id);
  IF actor IS NULL THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR coalesce(p_payload->>'from','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR coalesce(p_payload->>'to','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR jsonb_typeof(p_payload->'computedAt') IS DISTINCT FROM 'number'
    OR (jsonb_typeof(p_payload->'note') IS DISTINCT FROM 'string' AND jsonb_typeof(p_payload->'note') IS DISTINCT FROM 'null')
    OR (jsonb_typeof(p_payload->'leadGen') IS DISTINCT FROM 'object' AND jsonb_typeof(p_payload->'leadGen') IS DISTINCT FROM 'null')
    OR (jsonb_typeof(p_payload->'retargeting') IS DISTINCT FROM 'object' AND jsonb_typeof(p_payload->'retargeting') IS DISTINCT FROM 'null') THEN
    RAISE EXCEPTION 'Frequency cache payload was not confirmed' USING ERRCODE='22023';
  END IF;
  v_from:=(p_payload->>'from')::date; v_to:=(p_payload->>'to')::date; v_computed_ms:=(p_payload->>'computedAt')::numeric;
  IF to_char(v_from,'YYYY-MM-DD')<>p_payload->>'from' OR to_char(v_to,'YYYY-MM-DD')<>p_payload->>'to' OR v_to<v_from OR v_computed_ms<=0 THEN
    RAISE EXCEPTION 'Frequency cache range or computation time is invalid' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_payload->'leadGen')='object' AND (
    jsonb_typeof(p_payload#>'{leadGen,campaigns}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload#>'{leadGen,impressions}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload#>'{leadGen,reach}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload#>'{leadGen,spend}') IS DISTINCT FROM 'number'
    OR (jsonb_typeof(p_payload#>'{leadGen,frequency}') IS DISTINCT FROM 'number' AND jsonb_typeof(p_payload#>'{leadGen,frequency}') IS DISTINCT FROM 'null')
  ) THEN RAISE EXCEPTION 'Lead-gen frequency values were not confirmed' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_payload->'retargeting')='object' AND (
    jsonb_typeof(p_payload#>'{retargeting,campaigns}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload#>'{retargeting,impressions}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload#>'{retargeting,reach}') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload#>'{retargeting,spend}') IS DISTINCT FROM 'number'
    OR (jsonb_typeof(p_payload#>'{retargeting,frequency}') IS DISTINCT FROM 'number' AND jsonb_typeof(p_payload#>'{retargeting,frequency}') IS DISTINCT FROM 'null')
  ) THEN RAISE EXCEPTION 'Retargeting frequency values were not confirmed' USING ERRCODE='22023'; END IF;
  PERFORM set_config('cockpit.ceo_actor_email',actor,true);
  SELECT payload INTO old_payload FROM public.cockpit_ceo_frequency_cache WHERE from_day=v_from AND to_day=v_to;
  INSERT INTO public.cockpit_ceo_frequency_cache(from_day,to_day,computed_at,payload,updated_at)
  VALUES(v_from,v_to,to_timestamp((v_computed_ms/1000)::double precision),p_payload,now())
  ON CONFLICT(from_day,to_day) DO UPDATE SET computed_at=excluded.computed_at,payload=excluded.payload,updated_at=now();
  SELECT to_jsonb(c) INTO new_payload FROM public.cockpit_ceo_frequency_cache c WHERE c.from_day=v_from AND c.to_day=v_to;
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after)
  VALUES('frequency.cache','cockpit_ceo_frequency_cache',v_from::text||'..'||v_to::text,actor,'ceo','supabase',old_payload,new_payload);
  RETURN jsonb_build_object('ok',true);
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_frequency_cache_upsert(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_frequency_cache_upsert(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_workspace_import(
  p_actor_id uuid,p_request_id uuid,p_source_hash text,p_source_complete boolean,p_users jsonb,p_emails jsonb,p_apply boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor text;
  imported public.cockpit_ceo_workspace_imports;
  user_row jsonb;
  email text;
  normalized_email text;
  person_name text;
  person_role text;
  normalized_name text;
  selected_emails text[]:=ARRAY[]::text[];
  seen_emails text[]:=ARRAY[]::text[];
  seen_names text[]:=ARRAY[]::text[];
  eligible_count integer:=0;
  already_there integer:=0;
  inserted_id bigint;
  added jsonb:='[]'::jsonb;
  v_result jsonb;
BEGIN
  actor:=public.cockpit_ceo_verified_actor_email(p_actor_id);
  IF actor IS NULL THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Workspace import needs a stable request ID' USING ERRCODE='22023'; END IF;
  SELECT * INTO imported FROM public.cockpit_ceo_workspace_imports WHERE request_id=p_request_id;
  IF p_users IS NULL THEN
    IF p_source_complete IS TRUE OR p_apply IS TRUE THEN RAISE EXCEPTION 'Workspace source was not confirmed' USING ERRCODE='22023'; END IF;
    IF FOUND THEN
      IF imported.actor_id<>p_actor_id THEN RAISE EXCEPTION 'Workspace request ID belongs to another founder' USING ERRCODE='42501'; END IF;
      IF imported.result IS NULL THEN RAISE EXCEPTION 'Workspace import receipt is incomplete; retry with the same request ID' USING ERRCODE='40001'; END IF;
      RETURN imported.result||jsonb_build_object('existing',true,'replayed',true);
    END IF;
    RETURN jsonb_build_object('existing',false);
  END IF;
  IF p_source_complete IS DISTINCT FROM true OR p_source_hash IS NULL OR p_source_hash !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_users) IS DISTINCT FROM 'array' OR jsonb_array_length(p_users)>2000
    OR jsonb_typeof(p_emails) IS DISTINCT FROM 'array' OR p_apply IS NULL THEN
    RAISE EXCEPTION 'A complete Google Workspace directory source is required' USING ERRCODE='22023';
  END IF;
  FOR user_row IN SELECT value FROM jsonb_array_elements(p_users) LOOP
    IF jsonb_typeof(user_row) IS DISTINCT FROM 'object'
      OR jsonb_typeof(user_row->'email') IS DISTINCT FROM 'string'
      OR jsonb_typeof(user_row->'name') IS DISTINCT FROM 'string'
      OR jsonb_typeof(user_row->'suspended') IS DISTINCT FROM 'boolean'
      OR (jsonb_typeof(user_row->'title') IS DISTINCT FROM 'string' AND jsonb_typeof(user_row->'title') IS DISTINCT FROM 'null') THEN
      RAISE EXCEPTION 'Workspace directory row is invalid' USING ERRCODE='22023';
    END IF;
    email:=btrim(user_row->>'email'); normalized_email:=lower(email);
    IF email='' OR email !~ '^[^[:space:]@]+@[^[:space:]@]+$' OR normalized_email=ANY(seen_emails) THEN
      RAISE EXCEPTION 'Workspace directory contains an invalid or duplicate normalized email' USING ERRCODE='22023';
    END IF;
    seen_emails:=array_append(seen_emails,normalized_email);
    person_name:=coalesce(nullif(btrim(user_row->>'name'),''),email);
    normalized_name:=regexp_replace(lower(person_name),'[^[:alnum:]]','','g');
    IF normalized_name=ANY(seen_names) THEN RAISE EXCEPTION 'Workspace directory contains duplicate normalized names; no roster rows were changed' USING ERRCODE='22023'; END IF;
    seen_names:=array_append(seen_names,normalized_name);
  END LOOP;
  FOR user_row IN SELECT value FROM jsonb_array_elements(p_emails) LOOP
    IF jsonb_typeof(user_row) IS DISTINCT FROM 'string' OR btrim(user_row#>>'{}')='' THEN
      RAISE EXCEPTION 'Workspace email filter is invalid' USING ERRCODE='22023';
    END IF;
    selected_emails:=array_append(selected_emails,lower(btrim(user_row#>>'{}')));
  END LOOP;
  IF imported.request_id IS NOT NULL AND imported.actor_id<>p_actor_id THEN
    RAISE EXCEPTION 'Workspace request ID belongs to another founder' USING ERRCODE='42501';
  END IF;
  IF imported.request_id IS NOT NULL AND imported.result IS NOT NULL THEN
    IF imported.source_hash<>p_source_hash THEN RAISE EXCEPTION 'Workspace request ID was already used for a different source snapshot' USING ERRCODE='22023'; END IF;
    RETURN imported.result||jsonb_build_object('existing',true,'replayed',true);
  END IF;
  PERFORM set_config('cockpit.ceo_actor_email',actor,true);
  IF p_apply THEN
    INSERT INTO public.cockpit_ceo_workspace_imports(request_id,actor_id,source_hash)
    VALUES(p_request_id,p_actor_id,p_source_hash) ON CONFLICT(request_id) DO NOTHING;
    SELECT * INTO imported FROM public.cockpit_ceo_workspace_imports WHERE request_id=p_request_id FOR UPDATE;
    IF imported.actor_id<>p_actor_id THEN RAISE EXCEPTION 'Workspace request ID belongs to another founder' USING ERRCODE='42501'; END IF;
    IF imported.result IS NOT NULL THEN
      IF imported.source_hash<>p_source_hash THEN RAISE EXCEPTION 'Workspace request ID was already used for a different source snapshot' USING ERRCODE='22023'; END IF;
      RETURN imported.result||jsonb_build_object('existing',true,'replayed',true);
    END IF;
  END IF;
  FOR user_row IN SELECT value FROM jsonb_array_elements(p_users) LOOP
    IF (user_row->>'suspended')::boolean THEN CONTINUE; END IF;
    email:=btrim(user_row->>'email'); normalized_email:=lower(email);
    IF cardinality(selected_emails)>0 AND NOT normalized_email=ANY(selected_emails) THEN CONTINUE; END IF;
    eligible_count:=eligible_count+1;
    person_name:=coalesce(nullif(btrim(user_row->>'name'),''),email);
    person_role:=nullif(btrim(user_row->>'title'),'');
    normalized_name:=regexp_replace(lower(person_name),'[^[:alnum:]]','','g');
    IF EXISTS(SELECT 1 FROM public.cockpit_people p WHERE lower(btrim(coalesce(p.email,'')))=normalized_email OR regexp_replace(lower(p.name),'[^[:alnum:]]','','g')=normalized_name) THEN
      already_there:=already_there+1;
      CONTINUE;
    END IF;
    IF p_apply THEN
      inserted_id:=NULL;
      INSERT INTO public.cockpit_people(name,email,role,engagement,active,monthly_cost,currency,commission_basis,commission_rate,commission_pct,is_sales,source,added_by)
      VALUES(person_name,normalized_email,person_role,'staff',true,NULL,'USD','none',NULL,NULL,false,'workspace',actor)
      ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
      IF inserted_id IS NULL THEN already_there:=already_there+1;
      ELSE added:=added||jsonb_build_array(person_name); END IF;
    ELSE
      added:=added||jsonb_build_array(person_name);
    END IF;
  END LOOP;
  v_result:=jsonb_build_object('ok',true,'requestId',p_request_id,'added',added,'alreadyThere',already_there,
    'dryRun',NOT p_apply,'replayed',false,'sourceUsers',jsonb_array_length(p_users),'eligibleUsers',eligible_count);
  IF p_apply THEN
    UPDATE public.cockpit_ceo_workspace_imports SET result=v_result WHERE request_id=p_request_id;
    INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,after,metadata)
    VALUES('people.workspace.import','cockpit_ceo_workspace_imports',p_request_id::text,actor,'ceo','supabase',v_result,
      jsonb_build_object('sourceHash',p_source_hash,'sourceUsers',jsonb_array_length(p_users),'eligibleUsers',eligible_count));
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_workspace_import(uuid,uuid,text,boolean,jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_workspace_import(uuid,uuid,text,boolean,jsonb,jsonb,boolean) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
