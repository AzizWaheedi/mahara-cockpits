-- Match the production cockpit: CEO access is Aziz's verified identity,
-- never a role another administrator can assign in the member directory.
BEGIN;

CREATE OR REPLACE FUNCTION public.cockpit_is_ceo()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.cockpit_members AS cm
    JOIN auth.users AS au ON au.id = cm.auth_user_id
    WHERE cm.active = true
      AND cm.auth_user_id = auth.uid()
      AND au.email_confirmed_at IS NOT NULL
      AND cm.email = pg_catalog.lower(pg_catalog.btrim(au.email))
      AND pg_catalog.lower(pg_catalog.btrim(au.email)) IN (
        'aziz@maharamedia.com',
        'awaheedi2008@gmail.com'
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_has_role(required_role text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR required_role IS NULL OR
     pg_catalog.btrim(required_role) = '' THEN
    RETURN false;
  END IF;
  IF required_role = 'ceo' THEN
    RETURN public.cockpit_is_ceo();
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.cockpit_members AS cm
    JOIN auth.users AS au ON au.id = cm.auth_user_id
    WHERE cm.active = true
      AND cm.auth_user_id = auth.uid()
      AND au.email_confirmed_at IS NOT NULL
      AND cm.email = pg_catalog.lower(pg_catalog.btrim(au.email))
      AND (required_role = ANY(cm.roles) OR 'admin' = ANY(cm.roles))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cockpit_is_ceo() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_has_role(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_is_ceo() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_has_role(text) TO authenticated, service_role;

COMMIT;
