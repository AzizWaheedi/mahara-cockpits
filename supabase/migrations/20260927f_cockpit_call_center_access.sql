-- Preserve the existing aggregate report; only the authenticated founder may read it.
BEGIN;
CREATE OR REPLACE FUNCTION public.cockpit_ceo_call_center_report(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF public.cockpit_is_ceo() IS NOT TRUE THEN
    RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to-p_from >= 93 THEN
    RAISE EXCEPTION 'Choose valid dates covering no more than 93 days.' USING ERRCODE='22023';
  END IF;
  RETURN public.mahara_call_center_report(p_from,p_to,NULL::text,NULL::text);
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_call_center_report(date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_call_center_report(date,date) TO authenticated;
COMMIT;
