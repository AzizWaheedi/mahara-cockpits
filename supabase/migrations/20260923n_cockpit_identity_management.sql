-- Migration: 20260923n_cockpit_identity_management.sql
-- Phase 2: Shared Identity, Admin Seat Management, Role & Client Restrictions
-- Idempotent, transaction-wrapped, non-destructive

BEGIN;

-- 1. Helper to link a confirmed Auth user to their directory seat
CREATE OR REPLACE FUNCTION public.cockpit_link_confirmed_member(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_linked boolean := false;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(email))
  INTO v_email
  FROM auth.users
  WHERE id = p_user_id
    AND email_confirmed_at IS NOT NULL;

  IF v_email IS NULL OR v_email = '' THEN
    RETURN false;
  END IF;

  UPDATE public.cockpit_members
  SET auth_user_id = p_user_id,
      updated_at = pg_catalog.now()
  WHERE email = v_email
    AND (auth_user_id IS NULL OR auth_user_id = p_user_id)
    AND active = true;

  IF FOUND THEN
    v_linked := true;
  END IF;

  RETURN v_linked;
END;
$$;

-- 2. Current caller's access profile
CREATE OR REPLACE FUNCTION public.cockpit_get_my_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- 3. Admin seat upsert: add/edit directory seat
-- Founder CEO is non-assignable. Even if an admin specifies 'ceo', it is rejected.
CREATE OR REPLACE FUNCTION public.cockpit_admin_upsert_member(
  p_email text,
  p_name text,
  p_roles text[],
  p_clients text[] DEFAULT '{}'::text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_email text;
  v_target_email text;
  v_clean_roles text[];
  v_clean_clients text[];
  v_auth_user_id uuid;
  v_member_id uuid;
  v_allowed_roles CONSTANT text[] := ARRAY['admin', 'media_buyer', 'csm', 'creative', 'editor']::text[];
BEGIN
  -- 1. Authorization: admin or founder CEO only
  IF NOT (public.cockpit_has_role('admin') OR public.cockpit_is_ceo()) THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  v_caller_email := pg_catalog.lower(pg_catalog.btrim(coalesce(
    auth.jwt() ->> 'email',
    pg_catalog.current_setting('request.jwt.claim.email', true),
    ''::text
  )));

  v_target_email := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  IF v_target_email = '' OR pg_catalog.strpos(v_target_email, '@') = 0 THEN
    RAISE EXCEPTION 'Valid email required';
  END IF;

  -- 2. Filter roles to only valid cockpit seats (CEO CANNOT be assigned)
  SELECT coalesce(pg_catalog.array_agg(DISTINCT r ORDER BY r), '{}'::text[])
  INTO v_clean_roles
  FROM pg_catalog.unnest(p_roles) AS r
  WHERE r = ANY(v_allowed_roles);

  IF pg_catalog.cardinality(v_clean_roles) = 0 THEN
    RAISE EXCEPTION 'Give them at least one cockpit role or admin';
  END IF;

  -- 3. Prevent an admin from removing their own admin seat
  IF v_target_email = v_caller_email AND NOT ('admin' = ANY(v_clean_roles)) THEN
    RAISE EXCEPTION 'You cannot remove your own admin role';
  END IF;

  -- 4. Clean client restrictions
  SELECT coalesce(pg_catalog.array_agg(DISTINCT pg_catalog.btrim(c) ORDER BY pg_catalog.btrim(c)), '{}'::text[])
  INTO v_clean_clients
  FROM pg_catalog.unnest(p_clients) AS c
  WHERE pg_catalog.btrim(c) <> '';

  -- 5. Find existing confirmed Auth user if present
  SELECT au.id INTO v_auth_user_id
  FROM auth.users AS au
  WHERE pg_catalog.lower(pg_catalog.btrim(au.email)) = v_target_email
    AND au.email_confirmed_at IS NOT NULL
  LIMIT 1;

  -- 6. Upsert into cockpit_members (trigger trg_cockpit_members_audit records audit row)
  INSERT INTO public.cockpit_members (
    email,
    name,
    roles,
    clients,
    active,
    auth_user_id
  ) VALUES (
    v_target_email,
    nullif(pg_catalog.btrim(p_name), ''),
    v_clean_roles,
    v_clean_clients,
    true,
    v_auth_user_id
  )
  ON CONFLICT (email) DO UPDATE
  SET
    name = coalesce(nullif(pg_catalog.btrim(excluded.name), ''), public.cockpit_members.name),
    roles = excluded.roles,
    clients = excluded.clients,
    active = true,
    auth_user_id = coalesce(public.cockpit_members.auth_user_id, excluded.auth_user_id),
    updated_at = pg_catalog.now()
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END;
$$;

-- 4. Admin removal: disable member access
CREATE OR REPLACE FUNCTION public.cockpit_admin_remove_member(
  p_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_email text;
  v_target_email text;
BEGIN
  IF NOT (public.cockpit_has_role('admin') OR public.cockpit_is_ceo()) THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  v_caller_email := pg_catalog.lower(pg_catalog.btrim(coalesce(
    auth.jwt() ->> 'email',
    pg_catalog.current_setting('request.jwt.claim.email', true),
    ''::text
  )));

  v_target_email := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  IF v_target_email = '' THEN
    RAISE EXCEPTION 'Target email required';
  END IF;

  IF v_target_email = v_caller_email THEN
    RAISE EXCEPTION 'You cannot remove yourself';
  END IF;

  -- Mark inactive and clear roles/clients (audit trigger captures before/after)
  UPDATE public.cockpit_members
  SET active = false,
      roles = '{}'::text[],
      clients = '{}'::text[],
      updated_at = pg_catalog.now()
  WHERE email = v_target_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
END;
$$;

-- 5. Link confirmed Auth user muhammedburhan@maharamedia.com if present
DO $$
DECLARE
  v_mb_uid uuid;
BEGIN
  SELECT id INTO v_mb_uid
  FROM auth.users
  WHERE pg_catalog.lower(pg_catalog.btrim(email)) = 'muhammedburhan@maharamedia.com'
    AND email_confirmed_at IS NOT NULL
  LIMIT 1;

  IF v_mb_uid IS NOT NULL THEN
    INSERT INTO public.cockpit_members (
      email,
      name,
      roles,
      clients,
      active,
      auth_user_id
    ) VALUES (
      'muhammedburhan@maharamedia.com',
      'Muhammed Burhan',
      ARRAY['admin', 'media_buyer', 'csm', 'creative', 'editor']::text[],
      '{}'::text[],
      true,
      v_mb_uid
    )
    ON CONFLICT (email) DO UPDATE
    SET auth_user_id = coalesce(public.cockpit_members.auth_user_id, excluded.auth_user_id),
        roles = (
          SELECT array_agg(DISTINCT r ORDER BY r)
          FROM unnest(coalesce(public.cockpit_members.roles, '{}'::text[]) || excluded.roles) AS r
        ),
        active = true,
        updated_at = now();
  END IF;
END;
$$;

-- 6. Permissions and grants
REVOKE ALL ON FUNCTION public.cockpit_link_confirmed_member(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_get_my_access() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_admin_upsert_member(text, text, text[], text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_admin_remove_member(text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.cockpit_link_confirmed_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_get_my_access() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_admin_upsert_member(text, text, text[], text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_admin_remove_member(text) TO authenticated, service_role;

COMMIT;
