CREATE OR REPLACE FUNCTION public.cockpit_get_my_access()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid;
  v_member record;
  v_is_ceo boolean;
  v_is_admin boolean;
  v_cockpits text[];
  v_home text;
  v_roles text[];
  v_first_role text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT cm.id, cm.email, cm.name, cm.roles, cm.clients, cm.active, au.email_confirmed_at
  INTO v_member
  FROM public.cockpit_members AS cm
  JOIN auth.users AS au ON au.id = cm.auth_user_id
  WHERE cm.auth_user_id = v_uid
    AND cm.active = true
    AND au.email_confirmed_at IS NOT NULL
    AND cm.email = pg_catalog.lower(pg_catalog.btrim(au.email));

  IF v_member.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_roles := coalesce(v_member.roles, '{}'::text[]);
  v_is_admin := 'admin' = ANY(v_roles);
  v_is_ceo := public.cockpit_is_ceo();

  IF v_is_admin THEN
    v_cockpits := ARRAY['media_buyer', 'csm', 'creative', 'editor']::text[];
  ELSE
    SELECT coalesce(pg_catalog.array_agg(c ORDER BY c), '{}'::text[])
    INTO v_cockpits
    FROM pg_catalog.unnest(ARRAY['media_buyer', 'csm', 'creative', 'editor']::text[]) AS c
    WHERE c = ANY(v_roles);
  END IF;

  IF v_is_ceo THEN
    v_home := '/ceo';
  ELSIF v_is_admin THEN
    v_home := '/admin';
  ELSIF 'media_buyer' = ANY(v_roles) THEN
    v_home := '/dashboard';
  ELSIF 'csm' = ANY(v_roles) THEN
    v_home := '/go/csm';
  ELSIF 'creative' = ANY(v_roles) THEN
    v_home := '/go/creative';
  ELSIF 'editor' = ANY(v_roles) THEN
    v_home := '/go/editor';
  ELSE
    v_home := NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'email', v_member.email,
    'name', v_member.name,
    'roles', v_roles,
    'clients', coalesce(v_member.clients, '{}'::text[]),
    'is_admin', v_is_admin,
    'is_ceo', v_is_ceo,
    'cockpits', v_cockpits,
    'home', v_home
  );
END;
$function$

