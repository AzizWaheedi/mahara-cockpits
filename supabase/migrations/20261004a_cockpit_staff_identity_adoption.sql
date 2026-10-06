-- Migration: 20261004a_cockpit_staff_identity_adoption.sql
-- Authenticated self-only confirmed membership adoption, get_my_access RPC,
-- and tightening arbitrary-user link helper.
-- Idempotent, transaction-wrapped, non-destructive.

BEGIN;

-- 1. Tighten existing arbitrary-user link helper:
-- Service-only trusted administrative use. Denied to browser/authenticated users.
-- Does not re-audit/rewrite already-linked same seat; never reassigns conflicting seat.
CREATE OR REPLACE FUNCTION public.cockpit_link_confirmed_member(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_confirmed timestamptz;
  v_member_id uuid;
  v_current_auth_id uuid;
  v_active boolean;
  v_updated bigint := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(email)), email_confirmed_at
  INTO v_email, v_confirmed
  FROM auth.users
  WHERE id = p_user_id
  FOR SHARE;

  IF v_email IS NULL OR v_email = '' OR v_confirmed IS NULL THEN
    RETURN false;
  END IF;

  SELECT id, auth_user_id, active
  INTO v_member_id, v_current_auth_id, v_active
  FROM public.cockpit_members
  WHERE email = v_email
  FOR UPDATE;

  IF v_member_id IS NULL OR NOT v_active THEN
    RETURN false;
  END IF;

  -- If already linked to the same seat, return true without re-writing or re-auditing
  IF v_current_auth_id = p_user_id THEN
    RETURN true;
  END IF;

  -- Never overwrite an existing different auth_user_id
  IF v_current_auth_id IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE public.cockpit_members
  SET auth_user_id = p_user_id
  WHERE id = v_member_id
    AND active = true
    AND auth_user_id IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN (v_updated > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.cockpit_link_confirmed_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_link_confirmed_member(uuid) TO service_role;

-- 2. New browser RPC: authenticated self-only confirmed membership adoption.
-- Caller identity comes strictly from auth.uid() and auth.users confirmed email.
-- Locks matched seat row FOR UPDATE; returns real update result.
CREATE OR REPLACE FUNCTION public.cockpit_adopt_member()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_email text;
  v_confirmed timestamptz;
  v_member_id uuid;
  v_member_auth_user_id uuid;
  v_member_active boolean;
  v_updated bigint := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- Keep the confirmed Auth identity stable while locking and adopting its seat.
  SELECT pg_catalog.lower(pg_catalog.btrim(au.email)), au.email_confirmed_at
  INTO v_email, v_confirmed
  FROM auth.users au
  WHERE au.id = v_uid
  FOR SHARE;

  IF v_email IS NULL OR v_email = '' OR v_confirmed IS NULL THEN
    RETURN false;
  END IF;

  -- Lock matching directory row FOR UPDATE to prevent race conditions
  SELECT cm.id, cm.auth_user_id, cm.active
  INTO v_member_id, v_member_auth_user_id, v_member_active
  FROM public.cockpit_members cm
  WHERE cm.email = v_email
  FOR UPDATE;

  IF v_member_id IS NULL THEN
    RETURN false;
  END IF;

  -- Inactive or revoked seat fails closed (never reactivate revoked seat)
  IF NOT v_member_active THEN
    RETURN false;
  END IF;

  -- Already linked to this caller: no-op, do not re-audit or mutate
  IF v_member_auth_user_id = v_uid THEN
    RETURN true;
  END IF;

  -- Conflicting link (already linked to another auth_user_id): fail closed
  IF v_member_auth_user_id IS NOT NULL THEN
    RETURN false;
  END IF;

  -- Adopt seat: triggers existing trg_cockpit_members_audit exactly once
  UPDATE public.cockpit_members
  SET auth_user_id = v_uid
  WHERE id = v_member_id
    AND active = true
    AND auth_user_id IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN (v_updated > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.cockpit_adopt_member() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_adopt_member() TO authenticated, service_role;

-- 3. Canonical directory access RPC: returns authoritative member access shape or null.
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

REVOKE ALL ON FUNCTION public.cockpit_get_my_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_get_my_access() TO authenticated, service_role;

-- 4. Existing editor RLS policies call this signature. Editor profile/assignment
-- rows remain untouched; they no longer authorize a stale JWT or revoked admin.
CREATE OR REPLACE FUNCTION public.is_editor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.cockpit_has_role('editor')
      OR public.cockpit_has_role('admin')
      OR public.cockpit_is_ceo();
$$;

REVOKE ALL ON FUNCTION public.is_editor() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_editor() TO authenticated, service_role;

-- 5. Personal editor EOD ownership comes from the verified directory, not JWT
-- email or a submitted requested_by value. Shared non-EOD work stays shared.
CREATE OR REPLACE FUNCTION public.cockpit_editor_actor_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT cm.email
  FROM public.cockpit_members cm
  JOIN auth.users au ON au.id = cm.auth_user_id
  WHERE cm.auth_user_id = auth.uid()
    AND cm.active
    AND au.email_confirmed_at IS NOT NULL
    AND cm.email = pg_catalog.lower(pg_catalog.btrim(au.email))
    AND public.is_editor();
$$;
REVOKE ALL ON FUNCTION public.cockpit_editor_actor_email() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_editor_actor_email() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cockpit_editor_request_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
BEGIN
  -- Worker/service imports and historical authors retain their existing meaning.
  IF pg_catalog.current_setting('role', true) = 'authenticated' THEN
    v_email := public.cockpit_editor_actor_email();
    IF v_email IS NULL THEN
      RAISE EXCEPTION 'An active confirmed editor identity is required' USING ERRCODE = '42501';
    END IF;
    NEW.requested_by := v_email;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_editor_request_actor() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_cockpit_editor_request_actor ON public.editor_requests;
CREATE TRIGGER trg_cockpit_editor_request_actor
BEFORE INSERT ON public.editor_requests
FOR EACH ROW EXECUTE FUNCTION public.cockpit_editor_request_actor();

ALTER TABLE public.editor_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS editor_requests_read ON public.editor_requests;
CREATE POLICY editor_requests_read ON public.editor_requests
FOR SELECT TO authenticated
USING (
  (SELECT public.is_editor())
  AND (
    kind <> 'eod'
    OR nullif(pg_catalog.btrim(requested_by), '') IS NULL
    OR pg_catalog.lower(pg_catalog.btrim(requested_by)) = (SELECT public.cockpit_editor_actor_email())
  )
);
DROP POLICY IF EXISTS editor_requests_write ON public.editor_requests;
CREATE POLICY editor_requests_write ON public.editor_requests
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.is_editor())
  AND requested_by = (SELECT public.cockpit_editor_actor_email())
  AND status = 'queued'
  AND kind = ANY (ARRAY['deliver','check','comment','rescan','ask','status','eod','dosdonts','toideation']::text[])
);
REVOKE ALL ON TABLE public.editor_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.editor_requests TO authenticated;
GRANT ALL ON TABLE public.editor_requests TO service_role;

-- Audit new browser requests and worker transitions without rewriting old history.
CREATE OR REPLACE FUNCTION public.cockpit_editor_request_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := pg_catalog.current_setting('role', true);
BEGIN
  INSERT INTO public.cockpit_audit_log (
    action, entity_type, entity_id, actor_email, source_app, source_system,
    before, after, metadata
  ) VALUES (
    TG_OP, 'editor_requests', CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    CASE WHEN v_role = 'authenticated' THEN public.cockpit_editor_actor_email() ELSE NULL END,
    'video-editor', 'supabase',
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE pg_catalog.to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE pg_catalog.to_jsonb(NEW) END,
    pg_catalog.jsonb_build_object(
      'database_role', v_role,
      'auth_user_id', CASE WHEN v_role = 'authenticated' THEN auth.uid() ELSE NULL END
    )
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_editor_request_audit() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_cockpit_editor_request_audit ON public.editor_requests;
CREATE TRIGGER trg_cockpit_editor_request_audit
AFTER INSERT OR UPDATE OR DELETE ON public.editor_requests
FOR EACH ROW EXECUTE FUNCTION public.cockpit_editor_request_audit();

-- Legacy sales profile rows describe subroles, not authority to bypass the directory.
CREATE OR REPLACE FUNCTION public.cockpit_sales_email()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT m.email FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
 WHERE m.auth_user_id=auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL
 AND m.email=pg_catalog.lower(pg_catalog.btrim(u.email));
$$;
CREATE OR REPLACE FUNCTION public.cockpit_sales_seat()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.cockpit_has_role('sales') OR public.cockpit_is_ceo();
$$;
CREATE OR REPLACE FUNCTION public.cockpit_sales_manager()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor_email text;
BEGIN
 IF public.cockpit_is_ceo() THEN RETURN true;END IF;
 IF NOT public.cockpit_has_role('sales') THEN RETURN false;END IF;
 actor_email:=public.cockpit_sales_email();
 RETURN EXISTS(SELECT 1 FROM public.cockpit_sales_people p
 WHERE p.email=actor_email AND p.via_portal AND p.active AND p.role='manager');
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_sales_email(),public.cockpit_sales_seat(),public.cockpit_sales_manager() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cockpit_sales_email(),public.cockpit_sales_seat(),public.cockpit_sales_manager() TO authenticated,service_role;

COMMIT;
