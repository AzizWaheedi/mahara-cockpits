-- End of day: what Mahara's people changed in Ads Manager on one EOD day.
-- The EOD report listed only decisions logged in the cockpit, so a day of
-- work done in Ads Manager read "No changes logged today". This reads Meta's
-- own activity log (cockpit_csm_meta_activities, about 6 minutes behind
-- Meta) for the accounts of live campaigns, keeps only the people on
-- cockpit_meta_people (kind 'mahara'), and respects the seat's clients.
-- Read only: no table, no write. The EOD day runs 04:00 to 04:00 Kuwait,
-- the same cut as the EOD form.
BEGIN;

CREATE OR REPLACE FUNCTION public.cockpit_media_eod_changes(p_day date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  day_start timestamptz;
BEGIN
  IF NOT (public.cockpit_has_role('media_buyer') OR public.cockpit_has_role('admin') OR public.cockpit_is_ceo()) THEN
    RAISE EXCEPTION 'Verified media-buyer access required' USING ERRCODE = '42501';
  END IF;
  IF p_day IS NULL OR p_day < current_date - 8 OR p_day > current_date + 1 THEN
    RAISE EXCEPTION 'The EOD day must be within the last week' USING ERRCODE = '22023';
  END IF;
  day_start := (p_day::timestamp + interval '4 hours') AT TIME ZONE 'Asia/Kuwait';
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'at', round(extract(epoch FROM a.event_time) * 1000),
      'client', acc.client_name,
      'actor', a.actor_name,
      'eventType', coalesce(nullif(a.translated_event_type, ''), a.event_type),
      'objectType', a.object_type,
      'objectName', a.object_name
    ) ORDER BY a.event_time)
    FROM public.cockpit_csm_meta_activities a
    JOIN LATERAL (
      SELECT c.client_name
      FROM public.cockpit_campaigns c
      WHERE NOT c.source_deleted
        AND c.client_name IS NOT NULL
        AND replace(c.meta_account_id, 'act_', '') = replace(a.account_id, 'act_', '')
      ORDER BY c.updated_at DESC
      LIMIT 1
    ) acc ON true
    WHERE a.event_time >= day_start
      AND a.event_time < day_start + interval '1 day'
      AND EXISTS (
        SELECT 1 FROM public.cockpit_meta_people p
        WHERE p.kind = 'mahara' AND p.actor_name = a.actor_name
      )
      AND public.cockpit_ask_ai_owner_allowed(auth.uid(), 'media-buyer', acc.client_name)
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.cockpit_media_eod_changes(date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_media_eod_changes(date) TO authenticated, service_role;

COMMIT;
