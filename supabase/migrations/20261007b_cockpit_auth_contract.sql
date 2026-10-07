-- Restore the five-cockpit access contract missing from the live migration.
-- No directory records or email confirmations are modified.
BEGIN;
INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,source_system,before,after,metadata)
VALUES ('auth.access_contract.repaired','database_function','cockpit_get_my_access','all-cockpits','migration',
  jsonb_build_object('definition',pg_get_functiondef('public.cockpit_get_my_access()'::regprocedure)),
  jsonb_build_object('cockpits',ARRAY['media_buyer','csm','creative','editor','sales']),
  jsonb_build_object('migration','20261007b','directory_data_changed',false,'confirmation_required',true));
CREATE OR REPLACE FUNCTION public.cockpit_get_my_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_email text;
  v_confirmed timestamptz;
  v_member record;
  v_is_ceo boolean;
  v_is_admin boolean;
  v_cockpits text[];
  v_home text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(email)), email_confirmed_at
  INTO v_email, v_confirmed
  FROM auth.users
  WHERE id = v_uid;

  IF v_email IS NULL OR v_confirmed IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_member
  FROM public.cockpit_members
  WHERE active = true
    AND auth_user_id = v_uid
    AND email = v_email;

  IF v_member.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_is_ceo := (v_email IN ('aziz@maharamedia.com', 'awaheedi2008@gmail.com'));
  v_is_admin := ('admin' = ANY(v_member.roles));

  IF v_is_admin THEN
    v_cockpits := ARRAY['media_buyer', 'csm', 'creative', 'editor', 'sales'];
  ELSE
    SELECT pg_catalog.array_agg(c ORDER BY c)
    INTO v_cockpits
    FROM pg_catalog.unnest(ARRAY['media_buyer', 'csm', 'creative', 'editor', 'sales']) AS c
    WHERE c = ANY(v_member.roles);
    v_cockpits := COALESCE(v_cockpits, '{}'::text[]);
  END IF;

  IF v_is_ceo THEN
    v_home := '/ceo';
  ELSIF v_is_admin THEN
    v_home := '/admin';
  ELSIF 'media_buyer' = ANY(v_member.roles) THEN
    v_home := '/dashboard';
  ELSIF 'csm' = ANY(v_member.roles) THEN
    v_home := '/go/csm';
  ELSIF 'creative' = ANY(v_member.roles) THEN
    v_home := '/go/creative';
  ELSIF 'editor' = ANY(v_member.roles) THEN
    v_home := '/go/editor';
  ELSIF 'sales' = ANY(v_member.roles) THEN
    v_home := '/go/sales';
  ELSE
    v_home := NULL;
  END IF;

  RETURN jsonb_build_object(
    'email', v_member.email,
    'name', v_member.name,
    'roles', to_jsonb(v_member.roles),
    'clients', to_jsonb(v_member.clients),
    'is_admin', v_is_admin,
    'is_ceo', v_is_ceo,
    'cockpits', to_jsonb(v_cockpits),
    'home', v_home
  );
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_get_my_access() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_get_my_access() TO authenticated, service_role;
COMMIT;
