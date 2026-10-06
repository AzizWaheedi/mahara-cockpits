BEGIN;

-- Keep metadata service-only; expose only the verified image path in caller scope.
CREATE OR REPLACE FUNCTION public.cockpit_get_client_logos()
RETURNS TABLE(client_key text, storage_path text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.cockpit_members;
  founder boolean;
BEGIN
  SELECT cm.* INTO m
  FROM public.cockpit_members cm JOIN auth.users u ON u.id = cm.auth_user_id
  WHERE cm.auth_user_id = auth.uid() AND cm.active
    AND u.email_confirmed_at IS NOT NULL AND cm.email = lower(btrim(u.email));
  IF m.auth_user_id IS NULL THEN RAISE EXCEPTION 'Current confirmed membership required'; END IF;
  founder := m.email IN ('aziz@maharamedia.com', 'awaheedi2008@gmail.com');
  IF NOT (founder OR 'admin' = ANY(m.roles) OR 'media_buyer' = ANY(m.roles)) THEN
    RAISE EXCEPTION 'Media buyer access required';
  END IF;
  RETURN QUERY
  SELECT l.client_key, l.storage_path FROM public.cockpit_client_logos l
  WHERE founder OR 'admin' = ANY(m.roles) OR cardinality(m.clients) = 0
    OR EXISTS (SELECT 1 FROM unnest(m.clients) c WHERE lower(btrim(c)) = l.client_key)
  ORDER BY l.client_key;
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_get_client_logos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_get_client_logos() TO authenticated;

COMMIT;
